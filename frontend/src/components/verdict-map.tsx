import { ArrowDown, ChevronRight, Network } from "lucide-react";
import { CategoryGraph } from "@/components/category-graph";
import { graphVerdicts } from "@/components/graph-filters";
import { Badge } from "@/components/ui/badge";
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

export function VerdictMap({ accounts, product, branch, onBranch }: {
  accounts: Account[];
  product: Product | null;
  branch: Recommendation | null;
  onBranch: (verdict: Recommendation | null) => void;
}) {
  const groups = graphVerdicts.map((verdict) => ({
    verdict,
    companies: accounts.filter((company) => company.recommendation === verdict),
  }));
  const selected = groups.find(({ verdict }) => verdict === branch);
  if (selected) return <CategoryGraph key={selected.verdict} accounts={selected.companies} product={product?.name ?? "Workspace"} verdict={selected.verdict} onBack={() => onBranch(null)} />;
  return (
    <Card role="region" aria-labelledby="graph-overview-title" className="min-h-0 min-w-0 flex-1 gap-3">
      <CardHeader className="px-4 sm:px-6">
        <CardTitle><h2 id="graph-overview-title">Account map</h2></CardTitle>
        <CardDescription>Choose a verdict to explore its companies and their evidence.</CardDescription>
        <CardAction><Badge variant="secondary">{accounts.length} {accounts.length === 1 ? "company" : "companies"}</Badge></CardAction>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 px-4 sm:px-6">
        <div className={cn(styles.canvas, "flex min-h-0 flex-1 flex-col justify-center overflow-auto rounded-lg border bg-subtle")}>
          <div className="mx-auto my-auto w-full max-w-3xl px-4 pt-6 pb-3 sm:px-6 sm:pt-8">
            <div className="flex w-fit max-w-full items-center gap-3 rounded-lg border border-primary/45 bg-card px-4 py-3 shadow-sm sm:mx-auto">
              <Network aria-hidden className="size-5 shrink-0 text-primary" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{product ? "Product" : "Workspace"}</p>
                <p className="font-semibold wrap-anywhere">{product?.name ?? "All accounts"}</p>
              </div>
            </div>
            <ul aria-label="Account verdicts" className={styles.branches}>
              {groups.map(({ verdict, companies }) => {
                return (
                  <li key={verdict} className={styles.branch}>
                    <span aria-hidden className={cn(styles.arrow, verdictClass[verdict])}><ArrowDown /></span>
                    <button type="button" disabled={companies.length === 0}
                      onClick={() => onBranch(verdict)}
                      className={cn("flex w-full items-center justify-between gap-2 rounded-lg border p-3 text-left enabled:cursor-pointer enabled:hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:p-4", verdictSurface[verdict])}
                    >
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="flex items-center gap-2 font-semibold"><span aria-hidden className={cn("size-2 rounded-full", verdictDot[verdict])} />{verdictLabel[verdict]}</span>
                        <span className="text-sm text-muted-foreground">{companies.length} {companies.length === 1 ? "company" : "companies"}</span>
                      </span>
                      {companies.length > 0 ? <ChevronRight aria-hidden className="size-4 shrink-0" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
