"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Verdict } from "@/components/signal";
import type { Account, Recommendation, Workspace } from "@/lib/types";
import { day, enrichmentText, stageLabel, time } from "@/lib/format";
import { cn } from "@/lib/utils";

type Filter = "all" | Recommendation;
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "contact", label: "Contact" },
  { id: "hold", label: "Hold" },
  { id: "reject", label: "Reject" },
];

export function AccountsTable({ workspace, title = "Accounts" }: { workspace: Workspace; title?: string }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const accounts = workspace.accounts;
  const stageOf = (a: Account) => workspace.pipeline.leads.find((l) => l.account_id === a.id)?.stage;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return accounts
      .filter((a) => filter === "all" || a.recommendation === filter)
      .filter((a) => !q || `${a.name} ${a.domain}`.toLowerCase().includes(q));
  }, [accounts, filter, query]);

  const count = (f: Filter) => accounts.filter((a) => f === "all" || a.recommendation === f).length;

  return (
    <section aria-labelledby="accounts-title" className="flex flex-col gap-4 rounded-lg border bg-card p-5 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <h2 id="accounts-title" className="text-[17px] font-semibold">
            {title}
          </h2>
          <div role="group" aria-label="Filter by verdict" className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  "h-8 rounded-full border px-3 text-sm",
                  filter === f.id ? "border-foreground bg-foreground font-semibold text-background" : "border-muted bg-muted hover:border-input",
                )}
              >
                {f.label} <span className="tabular-nums">{count(f.id)}</span>
              </button>
            ))}
          </div>
        </div>
        <label className="flex h-9 w-full items-center gap-2 rounded-md border border-input px-2.5 text-muted-foreground sm:w-60">
          <Search aria-hidden className="size-4" />
          <Input
            aria-label="Filter accounts by keyword"
            placeholder="Filter by keyword"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-auto border-0 p-0 text-sm text-foreground shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
        </label>
      </div>

      <div className="overflow-x-auto">
        <Table className="min-w-[760px] text-sm">
          <TableHeader>
            <TableRow className="text-[13px]">
              <TableHead className="pl-0">Company</TableHead>
              <TableHead>Fit</TableHead>
              <TableHead>Intent</TableHead>
              <TableHead>Verdict</TableHead>
              <TableHead>Strongest signal</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead className="pr-0">Stage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((a) => {
              const risk = a.negative_signal;
              const signal = risk && a.recommendation === "reject" ? null : a.signal;
              const summary = signal?.summary ?? risk?.reason;
              const signalDate = signal ? signal.occurred_on : a.evidence.find((e) => e.id === risk?.evidence_id)?.published_at;
              const enr = enrichmentText(a.enrichment_status, a.contact?.verification_status);
              const stage = stageOf(a);
              return (
                <TableRow key={a.id} className="align-top">
                  <TableCell className="py-3 pl-0">
                    <Link href={`/accounts/view/?id=${a.id}`} className="font-semibold text-foreground underline-offset-2 hover:underline">
                      {a.name}
                    </Link>
                    <span className="block text-[13px] text-muted-foreground">{a.domain}</span>
                  </TableCell>
                  <TableCell className="py-3">
                    <span className="flex items-center gap-2.5">
                      <span className={cn("w-6 font-semibold tabular-nums", a.fit_score >= 70 && "text-success")}>{a.fit_score}</span>
                      <span aria-hidden className="block h-2 w-20 bg-hairline">
                        <span className="block h-full bg-chart-1" style={{ width: `${a.fit_score}%` }} />
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="py-3 font-semibold tabular-nums">{a.intent_score}</TableCell>
                  <TableCell className="py-3">
                    <Verdict value={a.recommendation} />
                  </TableCell>
                  <TableCell className="max-w-[240px] py-3 whitespace-normal">
                    {summary ?? <span className="text-muted-foreground">No supported signal</span>}
                    <span className="block text-[13px] text-muted-foreground">{summary ? day(signalDate) : `Researched ${time(a.researched_at)}`}</span>
                  </TableCell>
                  <TableCell className="py-3 whitespace-normal">
                    {a.contact ? a.contact.role : <span className="text-muted-foreground">—</span>}
                    <span className={cn("block text-[13px]", enr.tone)}>{enr.text}</span>
                  </TableCell>
                  <TableCell className="py-3 pr-0">{stage ? stageLabel[stage] : <span className="text-muted-foreground">Not in pipeline</span>}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {rows.length === 0 && accounts.length > 0 ? (
          <div className="flex flex-col items-start gap-2 py-7">
            <span className="font-semibold">No accounts match these filters</span>
            <span className="text-sm text-muted-foreground">Try a company name or domain, or show all verdicts.</span>
            <Button variant="outline" size="sm" onClick={() => { setQuery(""); setFilter("all"); }}>
              Clear filters
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
