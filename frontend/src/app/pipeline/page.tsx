"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { EnrichmentCredits } from "@/components/enrichment-credits";
import { InlineAlert, Panel, PanelHeader } from "@/components/signal";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { actorLabel, dateTime, enrichmentText, percent, stageLabel, stages } from "@/lib/format";
import type { Account, Lead, Pipeline, PipelineChange, PipelineEvent, Stage } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace-context";

export default function PipelinePage() {
  return (
    <AppShell>
      <PipelineView />
    </AppShell>
  );
}

type Move = Pick<PipelineChange, "to_stage" | "outcome"> & { label: string };
const moveActions: Partial<Record<Stage, Move[]>> = {
  contacted: [{ to_stage: "replied", label: "Record reply" }, { to_stage: "closed_lost", outcome: "lost", label: "Close as lost" }],
  replied: [{ to_stage: "meeting_booked", label: "Record meeting" }, { to_stage: "closed_lost", outcome: "lost", label: "Close as lost" }],
  meeting_booked: [{ to_stage: "closed_lost", outcome: "won", label: "Close as won" }, { to_stage: "closed_lost", outcome: "lost", label: "Close as lost" }],
};

function stageAttribution(actor: string, event?: PipelineEvent) {
  if (event?.source === "gmail" || event?.test_send) {
    return {
      source: "Gmail automation",
      detail: (event.action === "send" || event.test_send) && actor !== "system"
        ? `Requested by ${actorLabel(actor)}` : null,
    };
  }
  if (event?.source === "rep" || actor !== "system") {
    return { source: "Rep action", detail: actorLabel(actor) };
  }
  return { source: "Signal automation", detail: null };
}

function PipelineView() {
  const { workspace, mode, moveLead, syncFeedback, pending } = useWorkspace();
  const { accounts, pipeline: p, usage } = workspace!;
  const [dragging, setDragging] = useState<Lead | null>(null);
  const [change, setChange] = useState<{ lead: Lead; move: Move } | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const latestEvent = new Map(p.events.map((event) => [event.account_id, event]));
  const leadIds = new Set(p.leads.map((lead) => lead.account_id));
  const researchQueue = accounts.filter((account) => account.recommendation === "hold" && !leadIds.has(account.id))
    .sort((a, b) => b.fit_score - a.fit_score || b.intent_score - a.intent_score || a.name.localeCompare(b.name));

  function choose(lead: Lead, move: Move) {
    setError(null);
    setNote("");
    setChange({ lead, move });
  }

  async function confirm() {
    if (!change) return;
    const { lead, move } = change;
    const res = await moveLead(lead.account_id, {
      expected_stage: lead.stage, to_stage: move.to_stage, outcome: move.outcome,
      note: note.trim() || undefined,
    });
    if (res.ok) setChange(null);
    else setError(res.error?.message ?? "Signal couldn't update the stage.");
  }

  async function sync() {
    setFeedbackError(null);
    const res = await syncFeedback();
    if (!res.ok) setFeedbackError(res.error?.message ?? "Signal couldn't check Gmail feedback.");
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] leading-tight font-bold">Pipeline</h1>
          <p className="text-muted-foreground">Gmail acceptance moves a lead to Contacted. Gmail can record replies, and reps can log replies, meetings, and outcomes.</p>
        </div>
        {p.gmail_feedback_configured ? (
          <Button variant="outline" disabled={pending !== null} onClick={() => void sync()}>
            {pending === "sync-feedback" ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
            Sync Gmail feedback
          </Button>
        ) : null}
      </div>
      {feedbackError ? <InlineAlert tone="danger" title="Gmail feedback couldn't sync">{feedbackError}</InlineAlert> : null}

      <dl className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
        <Metric label="Matched" value={p.counts.matched} />
        <Metric label="Contacted" value={p.counts.contacted} />
        <Metric label="Matched to contacted" value={percent(p.matched_to_contacted_rate)} />
        <Metric label="Waiting for approval" value={p.pending_approval_count} />
      </dl>

      {researchQueue.length > 0 ? <ResearchQueue accounts={researchQueue} /> : null}

      <div className="overflow-x-auto pb-1">
        <ol className="grid min-w-[900px] grid-cols-5 gap-3">
          {stages.map((s) => {
            const leads = p.leads.filter((l) => l.stage === s);
            const dropAction = dragging && moveActions[dragging.stage]?.find((action) => action.to_stage === s);
            return (
              <li key={s} className="flex flex-col gap-2 rounded-lg border bg-subtle p-3"
                onDragOver={(event) => { if (dropAction) event.preventDefault(); }}
                onDrop={(event) => {
                  if (!dropAction || !dragging) return;
                  event.preventDefault();
                  choose(dragging, dropAction);
                  setDragging(null);
                }}>
                <h2 className="flex items-baseline justify-between font-semibold">
                  {stageLabel[s]}
                  <span className="text-sm font-normal text-muted-foreground tabular-nums">{leads.length}</span>
                </h2>
                {leads.length === 0 ? (
                  <p className="py-4 text-sm text-muted-foreground">No leads</p>
                ) : (
                  leads.map((l) => {
                    const attribution = stageAttribution(l.actor, latestEvent.get(l.account_id));
                    return (
                      <article key={l.account_id} className="flex flex-col gap-1 rounded-md border bg-card p-3"
                        draggable={mode === "live" && Boolean(moveActions[l.stage]) && pending === null}
                        onDragStart={(event) => {
                          event.dataTransfer.setData("text/plain", l.company);
                          setDragging(l);
                        }}
                        onDragEnd={() => setDragging(null)}>
                        <Link href={`/accounts/view/?id=${l.account_id}`} className="font-semibold text-foreground">
                          {l.company}
                        </Link>
                        <span className="text-sm text-ink-2">{l.role ?? "Role unknown"}, fit {l.fit_score}</span>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant="outline">{attribution.source}</Badge>
                          {l.test_send ? <Badge variant="secondary">Test send</Badge> : null}
                          {l.bounced ? <Badge variant="destructive">Bounced</Badge> : null}
                          {l.outcome ? <Badge variant="outline">{l.outcome === "won" ? "Won" : "Lost"}</Badge> : null}
                        </div>
                        {l.next_action ? <span className="text-[13px] text-muted-foreground">Next: {l.next_action}</span> : null}
                        <span className="text-[13px] text-muted-foreground">{[attribution.detail, dateTime(l.updated_at)].filter(Boolean).join(" · ")}</span>
                        {mode === "live" ? (moveActions[l.stage] ?? []).map((move) => (
                          <Button key={move.label} variant="outline" size="sm" className="mt-1 self-start" onClick={() => choose(l, move)} disabled={pending !== null}>
                            {move.label}
                          </Button>
                        )) : null}
                      </article>
                    );
                  })
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <Panel aria-labelledby="moves">
        <PanelHeader title="Stage changes" id="moves" />
        {p.events.length === 0 ? (
          <p className="text-muted-foreground">No lead has changed stage yet. Sending an approved test email moves its lead to Contacted.</p>
        ) : (
          <ol>
            {p.events.slice().reverse().map((e) => {
              const name = p.leads.find((l) => l.account_id === e.account_id)?.company ?? e.account_id;
              const attribution = stageAttribution(e.actor, e);
              return (
                <li key={e.id} className="grid grid-cols-[130px_minmax(0,1fr)] gap-3 border-b border-hairline py-2.5 last:border-b-0">
                  <span className="text-[13px] text-muted-foreground tabular-nums">{dateTime(e.at)}</span>
                  <span>
                    {e.action === "bounce" ? `Gmail recorded a bounce for ${name}`
                      : e.from_stage === e.to_stage ? `${name} stayed at ${stageLabel[e.to_stage]}`
                        : `${name} moved ${e.from_stage ? `from ${stageLabel[e.from_stage]} ` : ""}to ${stageLabel[e.to_stage]}`}
                    {e.test_send ? ", test send" : ""}{e.outcome ? ` (${e.outcome})` : ""}
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
                      <Badge variant="outline">{attribution.source}</Badge>
                      {attribution.detail ? <span>{attribution.detail}</span> : null}
                      {e.revision ? <span>Revision {e.revision}</span> : null}
                    </span>
                    {e.note ? <span className="block text-sm text-muted-foreground">{e.note}</span> : null}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </Panel>

      {p.analytics ? <FunnelAnalytics analytics={p.analytics} /> : null}
      {usage ? <EnrichmentCredits usage={usage} accounts={accounts} /> : null}

      <AlertDialog open={Boolean(change)} onOpenChange={(open) => { if (!open && pending !== "move-lead") setChange(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{change?.move.label} for {change?.lead.company}?</AlertDialogTitle>
            <AlertDialogDescription>This adds an attributed pipeline event with the current timestamp.</AlertDialogDescription>
          </AlertDialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="pipeline-note">Note (optional)</FieldLabel>
              <Textarea id="pipeline-note" rows={2} maxLength={250} value={note} onChange={(event) => setNote(event.target.value)} />
            </Field>
          </FieldGroup>
          {error ? <InlineAlert tone="danger" title="Stage change failed">{error}</InlineAlert> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending === "move-lead"}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={pending === "move-lead"} onClick={(event) => { event.preventDefault(); void confirm(); }}>
              {pending === "move-lead" ? <Spinner data-icon="inline-start" /> : null}
              Confirm stage change
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ResearchQueue({ accounts }: { accounts: Account[] }) {
  return (
    <Panel className="py-3">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-sm py-1 font-semibold focus-visible:ring-2 focus-visible:ring-ring">
          Research queue <Badge variant="secondary">{accounts.length}</Badge>
          <ChevronDown aria-hidden className="ml-auto size-4 text-muted-foreground group-open:rotate-180" />
        </summary>
        <div role="region" aria-label="Accounts on research hold" tabIndex={0} className="mt-3 max-h-96 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Fit</TableHead>
                <TableHead>Reason for hold</TableHead>
                <TableHead>Hunter</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((account) => {
                const contact = enrichmentText(account.enrichment_status, account.contact?.verification_status);
                return (
                  <TableRow key={account.id}>
                    <TableCell>
                      <Link href={`/accounts/view/?id=${account.id}`} className="font-medium underline-offset-2 hover:underline">{account.name}</Link>
                    </TableCell>
                    <TableCell className="tabular-nums">{account.fit_score}</TableCell>
                    <TableCell className="whitespace-normal">{account.reason}</TableCell>
                    <TableCell className={contact.tone}>{contact.text}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </details>
    </Panel>
  );
}

const analyticsDimensions = [
  { key: "industry", label: "Industry" }, { key: "tier", label: "Tier" },
  { key: "message_variant", label: "Message variant" }, { key: "channel", label: "Channel" },
  { key: "value_proposition", label: "Value proposition" },
];

function FunnelAnalytics({ analytics }: { analytics: NonNullable<Pipeline["analytics"]> }) {
  return (
    <Panel aria-labelledby="funnel-title">
      <PanelHeader title="Funnel analytics" id="funnel-title" />
      <Tabs defaultValue="industry" className="gap-4">
        <div className="overflow-x-auto">
          <TabsList aria-label="Group conversion data">
            {analyticsDimensions.map(({ key, label }) => <TabsTrigger key={key} value={key}>{label}</TabsTrigger>)}
          </TabsList>
        </div>
        {analyticsDimensions.map(({ key, label }) => (
          <TabsContent key={key} value={key}>
            {analytics[key]?.length ? (
              <Table aria-label={label + " conversion"}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{label}</TableHead>
                    {stages.map((stage) => <TableHead key={stage} className="text-right">{stageLabel[stage]}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analytics[key].map((group) => (
                    <TableRow key={group.label}>
                      <TableCell>{group.label}</TableCell>
                      {stages.map((stage) => (
                        <TableCell key={stage} className="text-right tabular-nums">
                          {group.reached[stage]}{stage !== "matched" && group.reached.matched ? ` (${percent(group.reached[stage] / group.reached.matched)})` : ""}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : <p className="text-sm text-muted-foreground">Conversion data for this group appears when a lead is recorded.</p>}
          </TabsContent>
        ))}
      </Tabs>
    </Panel>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-subtle px-5 py-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-[30px] leading-tight font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
