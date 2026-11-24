"use client";

import Link from "next/link";
import { useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { AccountsTable } from "@/components/accounts-table";
import { AppShell } from "@/components/app-shell";
import { EvidenceList, InlineAlert, Panel, PanelHeader } from "@/components/signal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ApiError } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { useWorkspace } from "@/lib/workspace-context";

export default function AccountsPage() {
  return (
    <AppShell>
      <Accounts />
    </AppShell>
  );
}

function Accounts() {
  const { workspace, discover, pending } = useWorkspace();
  const w = workspace!;
  const [error, setError] = useState<ApiError | null>(null);
  const searching = pending === "discover";
  const approved = w.approved_icp_revision;
  const competitors = w.competitors ?? (w.competitor ? [w.competitor] : []);
  const [deeper, setDeeper] = useState(false);

  async function run(refresh: boolean) {
    setError(null);
    const res = await discover(refresh, deeper);
    if (!res.ok) setError(res.error ?? null);
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] leading-tight font-bold">Accounts</h1>
          <p className="text-muted-foreground">
            {approved ? `Matched against customer profile revision ${approved}. Each claim links to its source.` : "Accounts are found from an approved customer profile."}
          </p>
        </div>
        {approved ? (
          <div className="flex gap-2">
            {w.accounts.length > 0 ? (
              <Button variant="outline" className="h-10 font-semibold" disabled={searching} onClick={() => run(true)}>
                <RefreshCw /> Search again
              </Button>
            ) : (
              <Button className="h-10 font-semibold" disabled={searching} onClick={() => run(false)}>
                {searching ? <Spinner /> : <Search />}
                {searching ? "Finding accounts…" : "Find accounts"}
              </Button>
            )}
          </div>
        ) : null}
      </div>

      {approved ? (
        <label className="flex items-center gap-2 self-start text-sm">
          <input type="checkbox" checked={deeper} disabled={searching} onChange={(event) => setDeeper(event.target.checked)} />
          Include targeted filings and job searches
        </label>
      ) : null}
      {w.research_schedule?.interval_minutes && w.research_schedule.next_due_at ? (
        <p className="text-sm text-muted-foreground">Next scheduled research refresh {dateTime(w.research_schedule.next_due_at)} Pacific.</p>
      ) : null}

      {error ? (
        <InlineAlert
          tone="danger"
          title="The search didn't finish"
          action={
            <Button variant="outline" size="sm" onClick={() => run(false)} className="border-destructive text-destructive">
              Retry search
            </Button>
          }
        >
          {error.message}
          {w.accounts.length ? ` Your ${w.accounts.length} saved accounts are unchanged.` : ""}
        </InlineAlert>
      ) : null}

      {!approved ? (
        <Panel className="flex flex-col items-start gap-2 py-10">
          <span className="text-lg font-bold">Approve a customer profile to find accounts</span>
          <span className="max-w-[56ch] text-ink-2">Signal searches only for companies that match an approved profile.</span>
          <Button asChild className="mt-2 h-10 font-semibold">
            <Link href="/profile/">Open customer profile</Link>
          </Button>
        </Panel>
      ) : searching ? (
        <Panel aria-busy="true">
          <PanelHeader title="Accounts">
            <span role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> Searching public sources. This can take up to 20 seconds.
            </span>
          </PanelHeader>
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        </Panel>
      ) : w.accounts.length === 0 ? (
        <Panel className="flex flex-col items-start gap-2 py-10">
          <span className="text-lg font-bold">No accounts yet</span>
          <span className="max-w-[56ch] text-ink-2">Find up to three companies that match profile revision {approved}, each with the sources behind its score.</span>
          <Button className="mt-2 h-10 font-semibold" onClick={() => run(false)}>
            <Search /> Find accounts
          </Button>
        </Panel>
      ) : (
        <Tabs defaultValue="accounts" className="gap-4">
          <TabsList>
            <TabsTrigger value="accounts">Accounts</TabsTrigger>
            <TabsTrigger value="competitor">Competitors</TabsTrigger>
          </TabsList>
          <TabsContent value="accounts">
            <AccountsTable workspace={w} />
          </TabsContent>
          <TabsContent value="competitor">
            <div className="flex flex-col gap-4">
              {competitors.length ? competitors.map((competitor) => (
                <Panel key={competitor.name} className="flex flex-col gap-4">
                  <PanelHeader title={competitor.name}>
                    <Badge variant="secondary" className="capitalize">{competitor.category ?? "direct"}</Badge>
                  </PanelHeader>
                  <dl className="grid gap-4 sm:grid-cols-3">
                    <div><dt className="text-sm text-muted-foreground">Positioning</dt><dd>{competitor.positioning}</dd></div>
                    <div><dt className="text-sm text-muted-foreground">How {w.product?.name ?? "the product"} differs</dt><dd>{competitor.differentiator}</dd></div>
                    <div><dt className="text-sm text-muted-foreground">Public pricing</dt><dd>{competitor.pricing ?? "Unknown"}</dd></div>
                  </dl>
                  {competitor.plans?.length ? (
                    <section aria-label="Public plans and packaging" className="flex flex-col gap-2">
                      <h3 className="font-semibold">Public plans and packaging</h3>
                      <ul className="grid gap-2 sm:grid-cols-2">
                        {competitor.plans.map((plan) => {
                          const source = competitor.evidence.find((item) => item.id === plan.evidence_id);
                          return (
                            <li key={plan.name} className="flex flex-col gap-1 rounded-md border p-3">
                              <span className="font-semibold">{plan.name}</span>
                              <span className="text-sm">{plan.price ?? "Price undisclosed"}</span>
                              {source ? <a href={source.url} target="_blank" rel="noreferrer noopener" className="text-sm text-muted-foreground">{source.title}</a> : null}
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  ) : null}
                  <EvidenceList evidence={competitor.evidence} />
                </Panel>
              )) : <Panel><p className="text-muted-foreground">No competitor was found with enough public evidence.</p></Panel>}
            </div>
          </TabsContent>
        </Tabs>
      )}
    </>
  );
}
