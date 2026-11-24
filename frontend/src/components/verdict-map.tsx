import { ArrowDown, ArrowUpRight, ChevronDown, Compass, Network } from "lucide-react";
import { findGraphAccounts, graphVerdicts } from "@/components/graph-filters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { verdictClass, verdictDot, verdictLabel } from "@/lib/format";
import type { Account, Product, Recommendation } from "@/lib/types";
import { cn } from "@/lib/utils";
import styles from "./verdict-map.module.css";

const verdictSurface = {
  contact: "border-success/40 bg-success-bg",
  hold: "border-warning/40 bg-warning-bg",
  reject: "border-destructive/40 bg-danger-bg",
};

export function VerdictMap({ accounts, product, hidden, branch, onBranch, onSelect }: {
  accounts: Account[];
  product: Product | null;
  hidden: Set<Recommendation>;
  branch: Recommendation | null;
  onBranch: (verdict: Recommendation | null) => void;
  onSelect: (id: string) => void;
}) {
  const groups = graphVerdicts.filter((verdict) => !hidden.has(verdict)).map((verdict) => ({
    verdict,
    companies: accounts.filter((company) => company.recommendation === verdict),
  }));
  const selected = groups.find(({ verdict, companies }) => verdict === branch && companies.length);
  return (
    <Card role="region" aria-labelledby="graph-overview-title" className="min-w-0 gap-4">
      <CardHeader className="px-4 sm:px-6">
        <CardTitle><h2 id="graph-overview-title">Account map</h2></CardTitle>
        <CardDescription>Choose a verdict to explore its companies and their evidence.</CardDescription>
        <CardAction><Badge variant="secondary">{accounts.length} {accounts.length === 1 ? "company" : "companies"}</Badge></CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-4 sm:px-6">
        <div className={cn(styles.canvas, "rounded-lg border bg-subtle px-4 py-6 sm:px-6 sm:py-8")}>
          <div className="mx-auto max-w-3xl">
            <div className="flex w-fit max-w-full items-center gap-3 rounded-lg border border-primary/45 bg-card px-4 py-3 shadow-sm sm:mx-auto">
              <Network aria-hidden className="size-5 shrink-0 text-primary" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{product ? "Product" : "Workspace"}</p>
                <p className="font-semibold wrap-anywhere">{product?.name ?? "All accounts"}</p>
              </div>
            </div>
            <ul aria-label="Account verdicts" className={styles.branches}>
              {groups.map(({ verdict, companies }) => {
                const expanded = selected?.verdict === verdict;
                return (
                  <li key={verdict} className={styles.branch}>
                    <span aria-hidden className={cn(styles.arrow, verdictClass[verdict])}><ArrowDown /></span>
                    <button type="button" disabled={companies.length === 0} aria-expanded={expanded}
                      aria-controls={expanded ? "verdict-companies" : undefined}
                      onClick={() => onBranch(expanded ? null : verdict)}
                      className={cn("flex w-full items-center justify-between gap-2 rounded-lg border p-3 text-left enabled:cursor-pointer enabled:hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:p-4", verdictSurface[verdict], expanded && "ring-2 ring-foreground/50")}
                    >
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="flex items-center gap-2 font-semibold"><span aria-hidden className={cn("size-2 rounded-full", verdictDot[verdict])} />{verdictLabel[verdict]}</span>
                        <span className="text-sm text-muted-foreground">{companies.length} {companies.length === 1 ? "company" : "companies"}</span>
                      </span>
                      {companies.length > 0 ? <ChevronDown aria-hidden className={cn("size-4 shrink-0", expanded && "rotate-180")} /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
        {selected ? <section id="verdict-companies" aria-labelledby="verdict-title" className="flex flex-col gap-3">
          <h3 id="verdict-title" className="font-semibold">{verdictLabel[selected.verdict]} companies</h3>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {findGraphAccounts(selected.companies, "").map((company) => (
              <li key={company.id} className="min-w-0">
                <Button variant="outline" className="h-full min-h-11 w-full justify-between whitespace-normal py-2.5 text-left" onClick={() => onSelect(company.id)}>
                  <span className="min-w-0 wrap-anywhere">{company.name}</span><ArrowUpRight data-icon="inline-end" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        </section> : null}
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Compass aria-hidden className="size-4 shrink-0" /> Arrows group companies by their saved Accounts verdict.
        </p>
      </CardContent>
    </Card>
  );
}
