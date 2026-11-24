"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { GraphInsights } from "@/components/graph-insights";
import { EvidenceList, GraphPath, InlineAlert, Panel, PanelHeader, Verdict } from "@/components/signal";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { ApiError } from "@/lib/api";
import { day, draftStateText, enrichmentText, time } from "@/lib/format";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";

export default function AccountViewPage() {
  return (
    <AppShell>
      <Suspense>
        <AccountView />
      </Suspense>
    </AppShell>
  );
}

function AccountView() {
  const id = useSearchParams().get("id");
  const { workspace, mode, enrichAccount, writeDraft, pending } = useWorkspace();
  const [error, setError] = useState<{ detail: ApiError; action: "contact" | "draft" } | null>(null);
  const a = workspace!.accounts.find((x) => x.id === id);

  if (!a) {
    return (
      <Panel className="flex flex-col items-start gap-2 py-10">
        <span className="text-lg font-bold">This account isn't in your workspace</span>
        <span className="text-muted-foreground">It may have been replaced by a newer search.</span>
        <Button asChild variant="outline" className="mt-2">
          <Link href="/accounts/">Back to accounts</Link>
        </Button>
      </Panel>
    );
  }

  const enr = enrichmentText(a.enrichment_status, a.contact?.verification_status, a.recommendation);
  const drafting = pending === `draft-${a.id}`;
  const enriching = pending === `enrich-${a.id}`;
  const canEnrich = mode === "live" && a.recommendation !== "reject" && a.enrichment_status === "not_started"
    && Boolean(a.buyer_role) && a.icp_revision === workspace!.approved_icp_revision;
  const risk = a.negative_signal;
  const riskSource = a.evidence.find((e) => e.id === risk?.evidence_id);

  async function run(action: "contact" | "draft") {
    setError(null);
    const res = await (action === "contact" ? enrichAccount : writeDraft)(a!.id);
    if (!res.ok && res.error) setError({ detail: res.error, action });
  }

  return (
    <>
      <div className="text-sm text-muted-foreground">
        <Link href="/accounts/" className="text-muted-foreground">Accounts</Link> / {a.name}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] leading-tight font-bold">{a.name}</h1>
          <p className="text-ink-2">
            {[a.domain, a.geography, a.company_size ? `${a.company_size} employees` : null].filter(Boolean).join(", ")}. Researched {time(a.researched_at)}.
          </p>
        </div>
        {a.recommendation === "contact" ? (
          a.draft ? (
            <Button asChild className="h-10 font-semibold">
              <Link href={`/outreach/?account=${a.id}`}>Open draft</Link>
            </Button>
          ) : (
            <Button className="h-10 font-semibold" onClick={() => run("draft")} disabled={Boolean(pending)}>
              {drafting ? <Spinner data-icon="inline-start" /> : null}
              {drafting ? "Writing draft…" : "Write draft"}
            </Button>
          )
        ) : null}
      </div>

      {error ? (
        <InlineAlert tone="danger" title={error.action === "contact" ? "Contact lookup couldn't run" : "The draft wasn't written"} action={<Button variant="outline" size="sm" onClick={() => run(error.action)}>Try again</Button>}>
          {error.detail.message}
        </InlineAlert>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="flex flex-col gap-6">
          <Panel aria-labelledby="why">
            <PanelHeader title={a.recommendation === "contact" ? "Why contact" : a.recommendation === "hold" ? "Why it's on hold" : "Why it's rejected"} id="why">
              <Verdict value={a.recommendation} />
            </PanelHeader>
            <p className="mb-4">{a.reason}</p>
            <dl className="grid grid-cols-3 gap-4">
              <Stat label="Fit" value={a.fit_score} />
              <Stat label="Tier" value={a.tier} />
              <Stat label="Sources" value={a.evidence.length} />
            </dl>
            <div className="mt-5 flex flex-col gap-3">
              {a.signal ? (
                <SignalRow tone="positive" title={a.signal.summary} meta={`${a.signal.kind === "direct" ? "Direct signal" : "Indirect signal"}, ${day(a.signal.occurred_on)}`} />
              ) : (
                <SignalRow tone="none" title="No supported buying signal" />
              )}
              {risk ? <SignalRow tone="negative" title={risk.reason} meta={`Reason to ${a.recommendation === "reject" ? "reject" : "hold"}, ${day(riskSource?.published_at)}`} /> : null}
            </div>
          </Panel>

          <Panel aria-labelledby="sources">
            <PanelHeader title="Sources" id="sources" />
            <EvidenceList evidence={a.evidence} highlightId={riskSource?.id ?? a.signal?.evidence_id} />
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          <Panel aria-labelledby="contact-title">
            <PanelHeader title="Contact" id="contact-title">
              {canEnrich ? (
                <Button variant="outline" size="sm" disabled={Boolean(pending)} onClick={() => run("contact")}>
                  {enriching ? <Spinner data-icon="inline-start" /> : null}
                  {enriching ? "Finding contact…" : "Find contact"}
                </Button>
              ) : null}
            </PanelHeader>
            {a.contact ? (
              <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-y-2 text-sm">
                <dt className="text-muted-foreground">Role</dt><dd>{a.contact.role}</dd>
                <dt className="text-muted-foreground">Email</dt><dd>{a.contact.email_masked ?? "Not provided"}</dd>
                <dt className="text-muted-foreground">Status</dt><dd className={cn("font-semibold", enr.tone)}>{enr.text}</dd>
                {a.contact.mx_valid !== null ? (<><dt className="text-muted-foreground">Mail server</dt><dd>{a.contact.mx_valid ? "Accepts mail" : "No valid MX record"}</dd></>) : null}
                {a.contact.headquarters ? (<><dt className="text-muted-foreground">Headquarters</dt><dd>{a.contact.headquarters}</dd></>) : null}
                {a.contact.linkedin_url ? (<><dt className="text-muted-foreground">LinkedIn</dt><dd><a href={a.contact.linkedin_url} target="_blank" rel="noreferrer noopener">Profile</a></dd></>) : null}
              </dl>
            ) : (
              <p className={cn("text-sm", enr.tone)}>
                {canEnrich ? `Buyer role: ${a.buyer_role ?? "Approved profile role"}` : enr.text}
              </p>
            )}
          </Panel>

          <Panel aria-labelledby="graph-title">
            <PanelHeader title="Graph path" id="graph-title" />
            <GraphPath path={a.graph_path} />
          </Panel>
          {mode === "live" ? <GraphInsights key={`${a.id}-${a.researched_at}`} accountId={a.id} /> : null}

          {a.draft ? (
            <Panel aria-labelledby="draft-title">
              <PanelHeader title="Draft" id="draft-title">
                <Link href={`/outreach/?account=${a.id}`} className="text-sm">Open</Link>
              </PanelHeader>
              <p className="font-serif font-semibold">{a.draft.subject}</p>
              <p className="mt-1 text-sm text-muted-foreground">{draftStateText(a.draft)}</p>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-[30px] leading-tight font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function SignalRow({ tone, title, meta }: { tone: "positive" | "negative" | "none"; title: string; meta?: string }) {
  return (
    <div className={cn("rounded-md border-l-[3px] bg-subtle px-3 py-2", tone === "positive" ? "border-l-success" : tone === "negative" ? "border-l-destructive" : "border-l-input")}>
      <span className="font-semibold">{title}</span>
      {meta ? <span className="block text-[13px] text-muted-foreground">{meta}</span> : null}
    </div>
  );
}
