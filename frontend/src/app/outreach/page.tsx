"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Lock, Send } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { AskPanel } from "@/components/ask-panel";
import { ActivityList, EvidenceList, GraphPath, InlineAlert, Panel } from "@/components/signal";
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
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api";
import { dateTime, draftStateText, enrichmentText, time, verdictLabel } from "@/lib/format";
import type { Account, Draft } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";

export default function OutreachPage() {
  return (
    <AppShell>
      <Suspense>
        <Outreach />
      </Suspense>
    </AppShell>
  );
}

function Outreach() {
  const { workspace } = useWorkspace();
  const w = workspace!;
  const params = useSearchParams();
  const param = params.get("account");
  const withDrafts = w.accounts.filter((a) => a.draft);
  const account = (param ? w.accounts.find((a) => a.id === param) : null) ?? withDrafts[0];

  if (!account?.draft) {
    const contactable = w.accounts.find((a) => a.recommendation === "contact");
    return (
      <>
        <h1 className="text-[22px] leading-tight font-bold">Outreach</h1>
        <div className="grid gap-4 sm:grid-cols-2">
          <Panel aria-labelledby="gmail-channel" className="flex flex-col items-start gap-2">
            <h2 id="gmail-channel" className="font-semibold">Gmail</h2>
            <p className="text-sm text-muted-foreground">Approve an initial or follow-up email before sending it to the controlled test inbox.</p>
            {w.pipeline.gmail_feedback_configured ? (
              <Button variant="link" size="sm" className="px-0" asChild>
                <Link href="/pipeline/">Gmail feedback in Pipeline</Link>
              </Button>
            ) : null}
          </Panel>
          <Panel aria-labelledby="linkedin-channel" className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="linkedin-channel" className="font-semibold">LinkedIn</h2>
              <Badge variant="secondary">Manual handoff</Badge>
            </div>
            <p className="text-sm text-muted-foreground">Generate a follow-up, then review and approve the message for your configured test profile.</p>
          </Panel>
        </div>
        <Empty className="border bg-card">
          <EmptyHeader>
            <EmptyTitle role="heading" aria-level={2}>No draft to review yet</EmptyTitle>
            <EmptyDescription>
              {contactable ? `Open ${contactable.name} and write the initial Gmail draft to start its sequence.` : "Drafts start with accounts marked Contact. Open Accounts to review the recommendations or search again."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link href={contactable ? `/accounts/view/?id=${contactable.id}` : "/accounts/"}>{contactable ? `Open ${contactable.name}` : "Open accounts"}</Link>
            </Button>
          </EmptyContent>
        </Empty>
      </>
    );
  }

  const steps = [account.draft, ...(account.sequence ?? [])];
  const draft = steps.find((step) => step.id === params.get("draft")) ?? account.draft;
  return <Review key={draft.id} account={account} draft={draft} steps={steps} others={withDrafts.filter((a) => a.id !== account.id)} />;
}

function Review({ account, draft, steps, others }: { account: Account; draft: Draft; steps: Draft[]; others: Account[] }) {
  const { workspace, mode, saveDraft, review, send, writeSequence, schedule, prepareLinkedIn, pending } = useWorkspace();
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [error, setError] = useState<ApiError | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [scheduledTime, setScheduledTime] = useState("");

  // A new revision from the server replaces local text; the Ask history stays.
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

  const canSave = editable && dirty && subject.trim().length > 0 && body.trim().length > 0;
  const canApprove = editable && !dirty && draft.review_status !== "approved";
  const canReject = editable && !dirty && draft.review_status !== "rejected";
  const readyForOutreach = !dirty && draft.review_status === "approved" && Boolean(draft.test_recipient) && priorComplete && !lead?.bounced;
  const canSend = editable && readyForOutreach && !linkedin;

  const cited = account.evidence.filter((e) => draft.evidence_ids.includes(e.id));
  const draftEvents = workspace!.activity.filter((e) => e.draft_id === draft.id || e.account_id === account.id);
  const lastEdit = draftEvents.find((e) => e.type === "draft_edited" && e.revision === draft.revision);
  const enr = enrichmentText(account.enrichment_status, account.contact?.verification_status);

  async function act(fn: () => Promise<{ ok: boolean; error?: ApiError }>) {
    setError(null);
    const res = await fn();
    if (!res.ok && res.error && res.error.status !== 401) setError(res.error);
    return res.ok;
  }

  async function applySuggestion(before: string, after: string) {
    if (!editable) {
      setError(new ApiError(0, "dispatch_already_reserved", "The draft is locked because a send was already reserved."));
      return false;
    }
    if (dirty) {
      setError(new ApiError(0, "unsaved", "Save or undo your own edits before applying a suggestion."));
      return false;
    }
    if (!draft.body.includes(before)) {
      setError(new ApiError(0, "stale", "The draft changed, so that suggestion no longer fits. Ask again."));
      return false;
    }
    return act(() => saveDraft(draft.id, draft.revision, draft.subject, draft.body.replace(before, after)));
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
      <div className="text-sm text-muted-foreground">
        <Link href="/accounts/" className="text-muted-foreground">Accounts</Link> /{" "}
        <Link href={`/accounts/view/?id=${account.id}`} className="text-muted-foreground">{account.name}</Link> / Draft
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h1 className="text-[22px] leading-tight font-bold">{account.name}</h1>
              <p className="text-ink-2">
                {account.domain}. <span className={cn("font-semibold", account.recommendation === "contact" ? "text-success" : "text-warning")}>{verdictLabel[account.recommendation]}</span>, fit {account.fit_score}, intent {account.intent_score}.
              </p>
            </div>
            <span className="text-sm text-muted-foreground">{draftStateText(draft)}</span>
          </div>

          {mode === "live" ? (
            <Panel aria-label="Outreach sequence" className="flex flex-wrap items-center gap-2">
              {steps.map((item, index) => (
                <Button key={item.id} variant={item.id === draft.id ? "default" : "outline"} size="sm" asChild>
                  <Link href={`/outreach/?account=${account.id}&draft=${item.id}`} aria-current={item.id === draft.id ? "page" : undefined}>
                    {index === 0 ? "Initial Gmail email" : item.channel === "linkedin" ? "LinkedIn follow-up" : "Gmail follow-up"}
                  </Link>
                </Button>
              ))}
              {steps.length === 1 ? (
                <Button variant="outline" size="sm" disabled={busy} onClick={() => void act(() => writeSequence(account.id))}>
                  {pending === "sequence" ? <Spinner data-icon="inline-start" /> : null} Generate Gmail and LinkedIn follow-ups
                </Button>
              ) : null}
              {draft.message_variant ? <Badge variant="secondary">Variant {draft.message_variant}</Badge> : null}
            </Panel>
          ) : null}

          {others.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              Other drafts:{" "}
              {others.map((o, i) => (
                <span key={o.id}>
                  {i > 0 ? ", " : ""}
                  <Link href={`/outreach/?account=${o.id}`}>{o.name}</Link>
                </span>
              ))}
            </p>
          ) : null}

          {/* Prospect vs. the address that actually receives the email */}
          <div className="grid rounded-lg border bg-card sm:grid-cols-2">
            <div className="flex flex-col gap-0.5 border-b px-[18px] py-3.5 sm:border-r sm:border-b-0">
              <span className="text-[13px] text-muted-foreground">Prospect</span>
              <span className="font-semibold">{account.contact?.role ?? account.buyer_role ?? "Role not found"}</span>
              <span className="text-ink-2">{account.contact?.email_masked ?? "No address found"}</span>
              <span className={cn("text-[13px] font-semibold", enr.tone)}>{enr.text}</span>
            </div>
            <div className="flex flex-col gap-0.5 bg-subtle px-[18px] py-3.5">
              <span className="text-[13px] text-muted-foreground">{linkedin ? "LinkedIn" : "Gmail"}</span>
              <span className="font-semibold">{linkedin ? "Controlled LinkedIn profile" : "Controlled test inbox"}</span>
              <span className="break-all text-ink-2">{draft.test_recipient ?? (linkedin ? "LinkedIn test profile setup needed" : "Gmail test inbox setup needed")}</span>
            </div>
          </div>

          <StatusAlert draft={draft} dirty={dirty} lastEditMessage={lastEdit?.message} />
          {draft.role_based ? (
            <InlineAlert tone="info" title="Role-based draft">
              Hunter couldn't verify a named contact, so this draft addresses the role.
            </InlineAlert>
          ) : null}
          {draft.synthesis_mode === "grounded_template" ? (
            <InlineAlert tone="info" title="A claim was replaced with a quote">
              Copy review couldn't confirm a sentence, so it uses the source's own words instead.
            </InlineAlert>
          ) : null}
          {error ? (
            <InlineAlert tone="danger" title="That didn't go through">
              {error.message}
            </InlineAlert>
          ) : null}

          <section aria-label={linkedin ? "LinkedIn draft" : "Gmail draft"} className="rounded-lg border bg-card">
            <div className="flex items-baseline gap-4 border-b px-5 py-3.5">
              <label htmlFor="subject" className="w-14 shrink-0 text-[13px] text-muted-foreground">{linkedin ? "Step title" : "Subject"}</label>
              <Input
                id="subject"
                value={subject}
                disabled={!editable}
                onChange={(e) => setSubject(e.target.value)}
                className="h-auto border-0 bg-transparent p-0 font-serif text-lg font-semibold shadow-none focus-visible:ring-0 dark:bg-transparent"
              />
            </div>
            <div className="px-5 py-4 md:pl-[92px]">
              <label htmlFor="body" className="sr-only">{linkedin ? "LinkedIn message" : "Email body"}</label>
              <Textarea
                id="body"
                value={body}
                disabled={!editable}
                onChange={(e) => setBody(e.target.value)}
                rows={Math.max(10, body.split("\n").length + 2)}
                maxLength={linkedin ? 450 : 4000}
                className="max-w-[660px] resize-y border-0 bg-transparent p-0 font-serif text-[17px] leading-[1.65] text-foreground shadow-none focus-visible:ring-0 dark:bg-transparent"
              />
            </div>
            <div className="border-t px-5 py-3 md:pl-[92px]">
              <span className="text-[13px] text-muted-foreground">
                Cites {cited.length} {cited.length === 1 ? "source" : "sources"}:{" "}
                {cited.map((e, i) => (
                  <span key={e.id}>
                    {i > 0 ? ", " : ""}
                    <a href={e.url} target="_blank" rel="noreferrer noopener">{i + 1}. {e.title}</a>
                  </span>
                ))}
              </span>
            </div>
          </section>

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

          <div className="flex flex-wrap items-center justify-end gap-2">
            {dirty ? (
              <Button variant="ghost" className="h-10" onClick={() => { setSubject(draft.subject); setBody(draft.body); }}>
                Undo changes
              </Button>
            ) : null}
            <Button variant="ghost" className="h-10 font-semibold text-destructive hover:text-destructive" disabled={!canReject || busy} onClick={() => act(() => review(draft.id, draft.revision, "reject"))}>
              {pending === "review-reject" ? <Spinner /> : null}
              Reject draft
            </Button>
            <Button variant="outline" className="h-10 font-semibold" disabled={!canSave || busy} onClick={() => act(() => saveDraft(draft.id, draft.revision, subject, body))}>
              {pending === "draft-save" ? <Spinner /> : null}
              {pending === "draft-save" ? "Saving…" : "Save edit"}
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
          </div>
        </div>

        <aside aria-label="Account details" className="flex min-h-[560px] flex-col overflow-hidden rounded-lg border bg-card lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)]">
          <Tabs defaultValue="ask" className="flex min-h-0 flex-1 flex-col gap-0">
            <TabsList className="h-12 w-full shrink-0 justify-start gap-6 rounded-none border-b bg-transparent px-5">
              {["ask", "evidence", "activity"].map((t) => (
                <TabsTrigger
                  key={t}
                  value={t}
                  className="h-full flex-none rounded-none border-0 px-0 text-sm text-muted-foreground shadow-none data-[state=active]:font-semibold data-[state=active]:text-primary data-[state=active]:shadow-[inset_0_-3px_0_var(--primary)]"
                >
                  {t === "ask" ? "Ask" : t === "evidence" ? "Evidence" : "Activity"}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="ask" className="flex min-h-0 flex-1 flex-col">
              <AskPanel account={account} onApply={applySuggestion} />
            </TabsContent>
            <TabsContent value="evidence" className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <div className="flex flex-col gap-4">
                <EvidenceList evidence={account.evidence} highlightId={account.signal?.evidence_id} />
                <div className="rounded-md border p-3">
                  <h3 className="mb-2 font-semibold">Graph path</h3>
                  <GraphPath path={account.graph_path} />
                </div>
              </div>
            </TabsContent>
            <TabsContent value="activity" className="min-h-0 flex-1 overflow-y-auto px-5 py-2">
              <ActivityList events={draftEvents} />
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
