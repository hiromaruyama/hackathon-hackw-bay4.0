"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ArrowLeft, ArrowUp, ArrowUpRight, ChevronDown, FilePenLine, Lock, Mail, MessageCircle, Save, Send, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { DraftDirectory } from "@/components/draft-directory";
import { WritingAgent } from "@/components/writing-agent";
import { EvidenceList, InlineAlert, Panel } from "@/components/signal";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api";
import { actorLabel, dateTime, enrichmentText, time, verdictClass, verdictLabel } from "@/lib/format";
import type { Account, Draft } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";

export default function OutreachPage() {
  return <Suspense><Outreach /></Suspense>;
}

function Outreach() {
  const { workspace } = useWorkspace();
  const params = useSearchParams();
  const param = params.get("account");
  const account = workspace?.accounts.find((item) => item.id === param);
  const steps = account?.draft ? [account.draft, ...(account.sequence ?? [])] : [];
  const draft = steps.find((step) => step.id === params.get("draft")) ?? account?.draft;

  return (
    <AppShell>
      {account && draft ? <Review key={draft.id} account={account} draft={draft} steps={steps} /> :
        workspace ? <DraftDirectory accounts={workspace.accounts} missingDraft={Boolean(param)} gmailFeedback={Boolean(workspace.pipeline.gmail_feedback_configured)} /> : null}
    </AppShell>
  );
}

const revisionEvents = new Set(["draft_created", "draft_generated", "sequence_step_drafted", "draft_edited"]);

function Review({ account, draft, steps }: { account: Account; draft: Draft; steps: Draft[] }) {
  const { workspace, mode, saveDraft, review, send, writeDraft, writeSequence, schedule, prepareLinkedIn, pending } = useWorkspace();
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [error, setError] = useState<ApiError | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [panel, setPanel] = useState("writing");
  const [scheduledTime, setScheduledTime] = useState("");

  // A new revision from the server replaces local text; the writing conversation stays.
  const [seenRevision, setSeenRevision] = useState(draft.revision);
  if (draft.revision !== seenRevision) {
    setSeenRevision(draft.revision);
    setSubject(draft.subject);
    setBody(draft.body);
  }

  const dirty = subject !== draft.subject || body !== draft.body;
  const editable = draft.dispatch_status === "not_sent" && !draft.prepared_at;
  const sent = draft.dispatch_status === "sent";
  const busy = pending !== null;
  const linkedin = draft.channel === "linkedin";
  const step = draft.sequence_step ?? 1;
  const lead = workspace!.pipeline.leads.find((item) => item.account_id === account.id);
  const priorComplete = step === 1 || (lead?.stage === "contacted" && steps[step - 2]?.dispatch_status === "sent");

  const writingOnly = draft.review_status === "writing_only";
  const canSave = editable && dirty && (writingOnly || (subject.trim().length > 0 && body.trim().length > 0));
  const canApprove = editable && !dirty && draft.review_status !== "approved";
  const canReject = editable && !dirty && draft.review_status !== "rejected";
  const readyForOutreach = !dirty && draft.review_status === "approved" && Boolean(draft.test_recipient) && priorComplete && !lead?.bounced;
  const canSend = editable && readyForOutreach && !linkedin;

  const cited = account.evidence.filter((e) => draft.evidence_ids.includes(e.id));
  const draftEvents = workspace!.activity.filter((e) => e.draft_id === draft.id && revisionEvents.has(e.type));
  const lastEdit = draftEvents.find((e) => e.type === "draft_edited" && e.revision === draft.revision);
  const enr = enrichmentText(account.enrichment_status, account.contact?.verification_status);

  async function act(fn: () => Promise<{ ok: boolean; error?: ApiError }>) {
    setError(null);
    const res = await fn();
    if (!res.ok && res.error && res.error.status !== 401) setError(res.error);
    return res.ok;
  }

  async function applySuggestion(expectedRevision: number, before: string, after: string) {
    if (!editable) {
      setError(new ApiError(0, "dispatch_already_reserved", "The draft is locked because a send was already reserved."));
      return false;
    }
    if (dirty) {
      setError(new ApiError(0, "unsaved", "Save or undo your own edits before applying a suggestion."));
      return false;
    }
    if (expectedRevision !== draft.revision || !draft.body.includes(before)) {
      setError(new ApiError(0, "stale", "The draft changed, so that suggestion no longer fits. Ask again."));
      return false;
    }
    const updated = draft.body.replace(before, () => after);
    if (updated.length > (linkedin ? 450 : 4000)) {
      setError(new ApiError(422, "too_long", "This suggestion exceeds the draft length limit. Ask for a shorter version."));
      return false;
    }
    return act(() => saveDraft(draft.id, expectedRevision, draft.subject, updated));
  }

  async function saveSchedule() {
    const time = new Date(scheduledTime);
    if (!Number.isFinite(time.getTime()) || time.getTime() <= Date.now()) {
      setError(new ApiError(422, "schedule_in_past", "Choose a time in the future."));
      return;
    }
    await act(() => schedule(draft.id, draft.revision, time.toISOString()));
  }

  async function copyHandoff() {
    if (!(await act(() => prepareLinkedIn(draft.id, draft.revision)))) return;
    try {
      await navigator.clipboard.writeText(draft.body);
      toast.success("Approved LinkedIn message copied");
    } catch {
      toast.info("The handoff is saved. Select the approved text to copy it.");
    }
  }

  return (
    <>
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link href="/outreach/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground hover:underline">
            <ArrowLeft aria-hidden className="size-4" /> All company drafts
          </Link>
          <Button asChild variant="outline" size="sm" className="lg:hidden">
            <a href="#draft-assistant" onClick={() => setPanel("writing")}><MessageCircle data-icon="inline-start" aria-hidden /> Go to Writing Agent</a>
          </Button>
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-[22px] leading-tight font-bold wrap-anywhere">{account.name}</h1>
            <Badge variant="outline" className={verdictClass[account.recommendation]}>{verdictLabel[account.recommendation]}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            <Link href={`/accounts/view/?id=${encodeURIComponent(account.id)}`} className="underline-offset-2 hover:underline">{account.domain}</Link> · Fit {account.fit_score} · Intent {account.intent_score}
          </p>
        </div>
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(315px,0.46fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <section id="draft-document" tabIndex={-1} aria-label={writingOnly ? "Writing-only draft" : linkedin ? "LinkedIn draft" : "Gmail draft"} className="min-w-0 scroll-mt-3 rounded-lg border bg-subtle">
            <div role="group" aria-label="Document controls" className="flex flex-wrap items-center justify-between gap-2 rounded-t-lg border-b bg-card px-3 py-2.5 sm:px-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <FilePenLine aria-hidden className="size-5 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{writingOnly ? "Writing-only draft" : linkedin ? "LinkedIn follow-up" : step > 1 ? "Gmail follow-up" : "Initial Gmail email"}</p>
                  <p role="status" className="text-xs text-muted-foreground">{dirty ? "Unsaved changes" : "Saved"} · Revision {draft.revision}</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" disabled={!dirty || busy} onClick={() => { setSubject(draft.subject); setBody(draft.body); }}>
                  <Undo2 data-icon="inline-start" aria-hidden /> Undo
                </Button>
                <Button size="sm" disabled={!canSave || busy} onClick={() => void act(() => saveDraft(draft.id, draft.revision, subject, body))}>
                  {pending === "draft-save" ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" aria-hidden />}
                  {pending === "draft-save" ? "Saving…" : "Save edit"}
                </Button>
              </div>
            </div>
            {!writingOnly && <details className="group border-b bg-card">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-3 py-2.5 text-xs sm:px-4 [&::-webkit-details-marker]:hidden">
                <Mail aria-hidden className="size-3.5 text-muted-foreground" />
                <span className="font-medium">{linkedin ? "Controlled LinkedIn profile" : "Controlled test inbox"}</span>
                <span className="ml-auto text-muted-foreground">Delivery details</span>
                <ChevronDown aria-hidden className="size-3.5 text-muted-foreground group-open:rotate-180" />
              </summary>
              <div className="flex flex-col gap-4 border-t px-4 py-4 text-sm">
                <dl className="grid gap-3 sm:grid-cols-2">
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">Prospect</dt>
                    <dd className="mt-1 flex flex-col">
                      <span className="font-semibold">{account.contact?.role ?? account.buyer_role ?? "Role not found"}</span>
                      <span className="wrap-anywhere">{account.contact?.email_masked ?? "No address found"}</span>
                      <span className={cn("text-xs", enr.tone)}>{enr.text}</span>
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">{linkedin ? "Handoff destination" : "Actual test recipient"}</dt>
                    <dd className="mt-1 wrap-anywhere">{draft.test_recipient ?? "Test recipient setup needed"}</dd>
                  </div>
                </dl>
                {mode === "live" ? (
                  <section aria-label="Outreach sequence" className="flex flex-col gap-2 border-t pt-3">
                    <div className="flex items-center gap-2"><h2 className="text-sm font-medium">Outreach sequence</h2>{draft.message_variant ? <Badge variant="secondary">Variant {draft.message_variant}</Badge> : null}</div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {steps.map((item, index) => (
                        <Button key={item.id} variant={item.id === draft.id ? "secondary" : "outline"} size="sm" asChild>
                          <Link href={`/outreach/?account=${encodeURIComponent(account.id)}&draft=${encodeURIComponent(item.id)}`} aria-current={item.id === draft.id ? "page" : undefined}>
                            {index === 0 ? "Initial Gmail email" : item.channel === "linkedin" ? "LinkedIn follow-up" : "Gmail follow-up"}
                          </Link>
                        </Button>
                      ))}
                      {steps.length === 1 ? (
                        <Button variant="outline" size="sm" className="h-auto min-h-8 whitespace-normal" disabled={busy} onClick={() => void act(() => writeSequence(account.id))}>
                          {pending === "sequence" ? <Spinner data-icon="inline-start" /> : null} Generate Gmail and LinkedIn follow-ups
                        </Button>
                      ) : null}
                    </div>
                  </section>
                ) : null}
              </div>
            </details>}

            <div className="p-2.5 sm:p-5 xl:p-6">
              <article className="mx-auto flex w-full max-w-3xl flex-col gap-6 rounded-sm border bg-card px-5 py-6 shadow-sm sm:px-9 sm:py-9 xl:px-12 xl:py-10">
                <div className="flex flex-col gap-2">
                  <label htmlFor="subject" className="text-xs font-medium text-muted-foreground">{linkedin ? "Step title" : "Subject"}</label>
                  <div className="relative font-serif text-[24px] leading-tight font-semibold tracking-tight sm:text-[28px]">
                    <span aria-hidden className="invisible block min-h-[1.25em] whitespace-pre-wrap wrap-anywhere">{subject || " "}</span>
                    <Textarea id="subject" rows={1} maxLength={250} value={subject} readOnly={!editable || busy} placeholder={linkedin ? "Step title" : "Email subject"}
                      onChange={(event) => setSubject(event.target.value.replace(/[\r\n]+/g, " "))}
                      onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); document.getElementById("body")?.focus(); } }}
                      style={{ font: "inherit", letterSpacing: "inherit" }}
                      className="absolute inset-0 h-full min-h-0 resize-none overflow-hidden rounded-none border-0 bg-transparent p-0 wrap-anywhere shadow-none focus-visible:ring-1 dark:bg-transparent"
                    />
                  </div>
                </div>
                <div className="border-t pt-5">
                  <label htmlFor="body" className="sr-only">{linkedin ? "LinkedIn message" : "Email body"}</label>
                  <Textarea id="body" value={body} rows={12} readOnly={!editable || busy} maxLength={linkedin ? 450 : 4000} placeholder={linkedin ? "Write the LinkedIn message…" : "Write the email…"}
                    onChange={(event) => setBody(event.target.value)}
                    className="min-h-60 resize-y rounded-none border-0 bg-transparent p-0 font-serif text-[17px] leading-[1.7] text-foreground shadow-none focus-visible:ring-1 sm:min-h-72 md:text-[17px] dark:bg-transparent"
                  />
                </div>
              </article>
            </div>
            <details className="group rounded-b-lg border-t bg-card">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-xs font-medium [&::-webkit-details-marker]:hidden">
                Cited sources ({cited.length}) <ChevronDown aria-hidden className="size-3.5 text-muted-foreground group-open:rotate-180" />
              </summary>
              <div className="px-4 pb-3"><EvidenceList evidence={cited} /></div>
            </details>
          </section>

          {error ? <InlineAlert tone="danger" title="That didn't go through">{error.message}</InlineAlert> : null}
          <StatusAlert draft={draft} dirty={dirty} lastEditMessage={lastEdit?.message} />
          {draft.role_based ? (
            <InlineAlert tone="info" title="Role-based draft">Hunter couldn't verify a named contact, so this draft addresses the role.</InlineAlert>
          ) : null}
          {draft.synthesis_mode === "grounded_template" ? (
            <InlineAlert tone="info" title="A claim was replaced with a quote">Copy review couldn't confirm a sentence, so it uses the source's own words instead.</InlineAlert>
          ) : null}
          {step > 1 && draft.review_status === "approved" && !dirty ? (
            <Panel aria-label="Schedule follow-up" className="flex flex-col gap-3">
              {draft.scheduled_at ? <p className="text-sm">Scheduled for {dateTime(draft.scheduled_at)} Pacific.</p> : null}
              {!priorComplete ? <p className="text-sm text-muted-foreground">Complete the previous touch to continue. Replies and closed outcomes pause follow-ups.</p> : null}
              {editable ? (
                <FieldGroup className="gap-3">
                  <Field>
                    <FieldLabel htmlFor="followup-time">Follow-up time (your local time)</FieldLabel>
                    <Input id="followup-time" type="datetime-local" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} />
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" disabled={busy || !scheduledTime} onClick={() => void saveSchedule()}>Save schedule</Button>
                    {draft.scheduled_at ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => void act(() => schedule(draft.id, draft.revision, null))}>Clear schedule</Button> : null}
                  </div>
                </FieldGroup>
              ) : null}
            </Panel>
          ) : null}

          {!writingOnly && <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" className="h-10 font-semibold text-destructive hover:text-destructive" disabled={!canReject || busy} onClick={() => act(() => review(draft.id, draft.revision, "reject"))}>
              {pending === "review-reject" ? <Spinner /> : null}
              Reject draft
            </Button>
            <Button className="h-10 px-[18px] font-semibold" disabled={!canApprove || busy} onClick={() => act(() => review(draft.id, draft.revision, "approve"))}>
              {pending === "review-approve" ? <Spinner /> : null}
              Approve revision {draft.revision}
            </Button>
            {linkedin ? (
              <>
                <Button variant="outline" disabled={!readyForOutreach || busy} onClick={() => void copyHandoff()}>Copy approved LinkedIn message</Button>
                {draft.prepared_at && draft.test_recipient ? (
                  <Button variant="outline" asChild>
                    <Link href={draft.test_recipient} target="_blank" rel="noreferrer noopener">Open test profile</Link>
                  </Button>
                ) : null}
              </>
            ) : <Button
              variant={canSend ? "default" : "outline"}
              className={cn("h-10 font-semibold", !canSend && "border-dashed")}
              disabled={!canSend || busy}
              onClick={() => setConfirmOpen(true)}
            >
              {pending === "send" ? <Spinner data-icon="inline-start" /> : canSend ? <Send data-icon="inline-start" /> : <Lock data-icon="inline-start" />}
              {pending === "send" ? "Sending…" : sent ? "Sent" : "Send test email"}
            </Button>}
          </div>}
          {writingOnly && account.recommendation === "contact" && account.icp_revision === workspace!.approved_icp_revision ? (
            <Button className="self-start" disabled={dirty || busy} onClick={() => void act(() => writeDraft(account.id))}>Generate outreach revision</Button>
          ) : null}
        </div>

        <aside id="draft-assistant" tabIndex={-1} aria-label="Account details" className="flex scroll-mt-3 h-[min(40rem,85svh)] min-w-0 flex-col overflow-hidden rounded-lg border bg-card lg:sticky lg:top-4 lg:h-[min(46rem,calc(100dvh-12rem))] lg:min-h-72">
          <div className="flex justify-end border-b px-2 py-1 lg:hidden">
            <Button variant="ghost" size="sm" asChild><a href="#draft-document"><ArrowUp data-icon="inline-start" aria-hidden /> Back to document</a></Button>
          </div>
          <Tabs value={panel} onValueChange={setPanel} className="flex min-h-0 flex-1 flex-col gap-0">
            <TabsList variant="line" aria-label="Draft details" className="h-12 w-full shrink-0 justify-start gap-2 rounded-none border-b px-3">
              <TabsTrigger value="writing">Writing Agent</TabsTrigger>
              <TabsTrigger value="evidence">Evidence</TabsTrigger>
              <TabsTrigger value="history">Edit History</TabsTrigger>
            </TabsList>
            <TabsContent value="writing" forceMount className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
              <WritingAgent active={panel === "writing"} account={account} revision={draft} editorText={{ subject, body }} onApply={applySuggestion} />
            </TabsContent>
            <TabsContent value="evidence" className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              <div className="flex flex-col items-start gap-4">
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/graph/?account=${encodeURIComponent(account.id)}`}>View company graph <ArrowUpRight data-icon="inline-end" aria-hidden /></Link>
                </Button>
                <EvidenceList evidence={account.evidence} highlightId={account.signal?.evidence_id} />
              </div>
            </TabsContent>
            <TabsContent value="history" className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {draftEvents.length ? (
                <ol aria-label="Saved draft revisions" className="divide-y">
                  {draftEvents.map((event) => (
                    <li key={event.id} className="flex flex-col gap-1 py-3 first:pt-0">
                      <p className="text-sm font-semibold">{event.revision ? `Revision ${event.revision}` : "Saved revision"}</p>
                      <p className="text-sm">{event.message}</p>
                      <p className="text-xs text-muted-foreground">{actorLabel(event.actor)} · <time dateTime={event.at}>{dateTime(event.at)} Pacific</time></p>
                    </li>
                  ))}
                </ol>
              ) : <p className="text-sm text-muted-foreground">No saved edits are available for this draft.</p>}
            </TabsContent>
          </Tabs>
        </aside>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send revision {draft.revision} to the test inbox?</AlertDialogTitle>
            <AlertDialogDescription>
              The message goes to {draft.test_recipient}. This draft allows one send attempt. When Gmail accepts it, {account.name} moves to Contacted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void act(() => send(draft.id, draft.revision))}>Send test email</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function StatusAlert({ draft, dirty, lastEditMessage }: { draft: Draft; dirty: boolean; lastEditMessage?: string }) {
  const r = draft.revision;
  if (draft.review_status === "writing_only") {
    return <InlineAlert tone="info" title="Writing only">You can save edits and use the Writing Agent here. Sending requires a qualified Contact and an evidence-backed outreach revision.</InlineAlert>;
  }
  if (draft.prepared_at) {
    return <InlineAlert tone="info" title={`LinkedIn handoff prepared for revision ${r}`}>The approved message is ready for the controlled test profile. Delivery happens in LinkedIn.</InlineAlert>;
  }
  if (draft.dispatch_status === "sent") {
    return <InlineAlert tone="success" title={`Gmail accepted revision ${r}`}>The test send was recorded at {time(draft.updated_at)} and the pipeline was updated once. Check the test inbox for delivery.</InlineAlert>;
  }
  if (draft.dispatch_status === "pending_outcome") {
    return <InlineAlert tone="pending" title="Gmail didn't confirm the send">The request timed out, so the email may or may not have gone out. Signal won't send this draft again, and the pipeline stage is unchanged until the outcome is checked.</InlineAlert>;
  }
  if (draft.dispatch_status === "failed") {
    return <InlineAlert tone="danger" title={`The test send failed for revision ${r}`}>The attempt is recorded and the draft is locked. The lead remains at its previous stage.</InlineAlert>;
  }
  if (dirty) {
    return <InlineAlert tone="info" title="You have unsaved changes">Save them as revision {r + 1}, then approve that revision before sending.</InlineAlert>;
  }
  if (draft.review_status === "approved") {
    if (!draft.test_recipient) {
      return <InlineAlert tone="warning" title="Test recipient setup needed">Configure the controlled recipient, then save and approve a new revision.</InlineAlert>;
    }
    return <InlineAlert tone="success" title={`Revision ${r} is approved`}>{draft.channel === "linkedin" ? "Approved for the controlled LinkedIn profile." : "Approved for the controlled test inbox."} Any edit clears this approval.</InlineAlert>;
  }
  if (draft.review_status === "rejected") {
    return <InlineAlert tone="danger" title={`Revision ${r} was rejected`}>It can't be sent. Edit and save a new revision to continue.</InlineAlert>;
  }
  return <InlineAlert tone="warning" title={`Revision ${r} needs your approval`}>{lastEditMessage ?? "Read it through, then approve or reject this exact revision."}</InlineAlert>;
}
