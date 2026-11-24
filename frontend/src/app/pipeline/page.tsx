"use client";

import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Panel, PanelHeader } from "@/components/signal";
import { actorLabel, dateTime, percent, stageLabel, stages } from "@/lib/format";
import { useWorkspace } from "@/lib/workspace-context";

export default function PipelinePage() {
  return (
    <AppShell>
      <PipelineView />
    </AppShell>
  );
}

function PipelineView() {
  const { workspace } = useWorkspace();
  const p = workspace!.pipeline;

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] leading-tight font-bold">Pipeline</h1>
        <p className="text-muted-foreground">Leads move to Contacted only after Gmail confirms a test send. Later stages aren't tracked in this demo.</p>
      </div>

      <dl className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
        <Metric label="Matched" value={p.counts.matched} />
        <Metric label="Contacted" value={p.counts.contacted} />
        <Metric label="Matched to contacted" value={percent(p.matched_to_contacted_rate)} />
        <Metric label="Waiting for approval" value={p.pending_approval_count} />
      </dl>

      <div className="overflow-x-auto pb-1">
        <ol className="grid min-w-[900px] grid-cols-5 gap-3">
          {stages.map((s) => {
            const leads = p.leads.filter((l) => l.stage === s);
            return (
              <li key={s} className="flex flex-col gap-2 rounded-lg border bg-subtle p-3">
                <h2 className="flex items-baseline justify-between font-semibold">
                  {stageLabel[s]}
                  <span className="text-sm font-normal text-muted-foreground tabular-nums">{leads.length}</span>
                </h2>
                {leads.length === 0 ? (
                  <p className="py-4 text-sm text-muted-foreground">No leads</p>
                ) : (
                  leads.map((l) => (
                    <article key={l.account_id} className="flex flex-col gap-1 rounded-md border bg-card p-3">
                      <Link href={`/accounts/view/?id=${l.account_id}`} className="font-semibold text-foreground">
                        {l.company}
                      </Link>
                      <span className="text-sm text-ink-2">{l.role ?? "Role unknown"}, fit {l.fit_score}</span>
                      {l.test_send ? <span className="text-[13px] font-semibold text-primary">Test send</span> : null}
                      {l.next_action ? <span className="text-[13px] text-muted-foreground">Next: {l.next_action}</span> : null}
                      <span className="text-[13px] text-muted-foreground">{actorLabel(l.actor)}, {dateTime(l.updated_at)}</span>
                    </article>
                  ))
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
            {p.events.map((e) => {
              const name = p.leads.find((l) => l.account_id === e.account_id)?.company ?? e.account_id;
              return (
                <li key={e.id} className="grid grid-cols-[130px_minmax(0,1fr)] gap-3 border-b border-hairline py-2.5 last:border-b-0">
                  <span className="text-[13px] text-muted-foreground tabular-nums">{dateTime(e.at)}</span>
                  <span>
                    {name} moved {e.from_stage ? `from ${stageLabel[e.from_stage]} ` : ""}to {stageLabel[e.to_stage]}
                    {e.test_send ? ", test send" : ""}
                    <span className="block text-[13px] text-muted-foreground">{actorLabel(e.actor)}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </Panel>
    </>
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
