"use client";

import Link from "next/link";
import layout from "./graph.module.css";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";
import { ArrowDown, Building2, Check, ChevronRight, Download, Layers2, Package, Radio, Search, UserRound, Waypoints } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AccountSearch, emptyGraphFilters, findGraphAccounts, graphVerdicts, GraphFilters } from "@/components/graph-filters";
import { VerdictMap } from "@/components/verdict-map";
import { CompanyNetwork } from "@/components/company-network";
import { ExportMenu } from "@/components/export-menu";
import { exportGraph } from "@/lib/graph-export";
import { GraphInsights } from "@/components/graph-insights";
import { EvidenceList, InlineAlert } from "@/components/signal";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Account, Competitor, GraphNode, Product, Recommendation } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-context";

export default function GraphPage() {
  return (
    <AppShell>
      <Suspense><Explorer /></Suspense>
    </AppShell>
  );
}

function Explorer() {
  const { workspace, mode } = useWorkspace();
  const { accounts, product, competitors, competitor } = workspace!;
  const router = useRouter();
  const params = useSearchParams();
  const selectedId = params.get("account");
  const requested = accounts.find((item) => item.id === selectedId);
  const [filters, setFilters] = useState(emptyGraphFilters);
  const branch = graphVerdicts.find((verdict) => verdict === params.get("verdict")) ?? requested?.recommendation ?? null;
  const pathTab = useRef<HTMLButtonElement>(null);
  const availableAccounts = accounts.filter((item) => !filters.verdicts.has(item.recommendation) && !filters.scores.has(item.fit_score) && !filters.companies.has(item.id));
  const selected = availableAccounts.find((item) => item.id === selectedId);
  const account = selected
    ?? availableAccounts.find((item) => item.graph_path.length > 0)
    ?? availableAccounts[0];
  const rivals = competitors?.length ? competitors : competitor ? [competitor] : [];

  function openBranch(verdict: Recommendation | null) {
    router.push(verdict ? `/graph/?verdict=${verdict}` : "/graph/", { scroll: false });
  }

  function openAccountPath(id: string) {
    router.push(`/graph/?account=${encodeURIComponent(id)}`, { scroll: false });
    pathTab.current?.focus();
  }

  return (
    <div className={layout.explorer}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg leading-tight sm:text-[22px] font-bold">Knowledge graph</h1>
        {accounts.length ? (
          <div className="flex items-center gap-1 sm:gap-2">
            <details className="relative">
              <summary title="Export" className="flex size-9 cursor-pointer list-none items-center justify-center gap-1 rounded-md border bg-card text-sm font-medium sm:w-auto sm:px-3"><Download aria-hidden className="size-4" /><span className="sr-only sm:not-sr-only">Export</span></summary>
              <div className="absolute right-0 z-10 mt-1 w-44 rounded-lg border bg-card p-3 shadow-md">
                <ExportMenu label="Export knowledge graph" formats={([
                  ["Nodes CSV", "nodes"], ["Edges CSV", "edges"], ["Graph JSON", "json"],
                ] as const).map(([label, format]) => ({
                  label, download: () => exportGraph({ ...workspace!, accounts: availableAccounts }, format),
                }))} />
              </div>
            </details>
            <GraphFilters accounts={accounts} filters={filters} onChange={setFilters} />
            {account ? <AccountPicker accounts={availableAccounts} selectedId={account.id} onSelect={openAccountPath} /> : null}
          </div>
        ) : null}
      </div>

      {selectedId && !requested ? (
        <InlineAlert tone="info" title="This company is no longer in the workspace">Choose an account from the map.</InlineAlert>
      ) : null}
      {account ? (
        <Tabs value={selected ? "path" : "overview"} activationMode="manual" onValueChange={(value) => {
          if (value === "path") openAccountPath(account.id);
          else openBranch(requested?.recommendation ?? null);
        }} className="min-h-0 flex-1 gap-3">
          <TabsList aria-label="Graph view">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger ref={pathTab} value="path">Account path</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="flex min-h-0 flex-col data-[state=inactive]:hidden">
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <VerdictMap accounts={availableAccounts} product={product} hidden={filters.verdicts} branch={branch} onBranch={openBranch} />
              {!branch && rivals.length ? <Card className="px-4 py-1 sm:px-6"><CompetitorRelationships rivals={rivals} /></Card> : null}
            </div>
          </TabsContent>
          <TabsContent value="path" className="flex min-h-0 flex-col data-[state=inactive]:hidden">
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
              <p role="status" className="sr-only">{account.name} selected</p>
              <AccountPath key={account.id} account={account} product={product} sample={mode === "sample"} />
              {mode === "live" || account.graph_path.length > 3 ? <Accordion type="multiple" className="shrink-0 rounded-lg border bg-card px-4 sm:px-6">
                {mode === "live" ? (
                  <AccordionItem value="insights">
                    <AccordionTrigger>Research graph insights</AccordionTrigger>
                    <AccordionContent><GraphInsights key={account.id} accountId={account.id} /></AccordionContent>
                  </AccordionItem>
                ) : null}
                {account.graph_path.length > 3 ? (
                  <AccordionItem value="full-path">
                    <AccordionTrigger>Full saved path</AccordionTrigger>
                    <AccordionContent><RelationshipPath path={account.graph_path} account={account} /></AccordionContent>
                  </AccordionItem>
                ) : null}
              </Accordion> : null}
            </div>
          </TabsContent>
        </Tabs>
      ) : (
        <Card>
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{accounts.length ? "No companies match your filters" : "No accounts to show"}</EmptyTitle>
              {accounts.length ? null : <EmptyDescription>Run discovery to see the relationships and sources for each account.</EmptyDescription>}
            </EmptyHeader>
            <EmptyContent>
              {accounts.length ? (
                <Button variant="outline" onClick={() => setFilters(emptyGraphFilters)}>Reset filters</Button>
              ) : (
                <Button asChild variant="outline"><Link href="/accounts/">Open accounts</Link></Button>
              )}
            </EmptyContent>
          </Empty>
        </Card>
      )}
    </div>
  );
}

function AccountPicker({
  accounts,
  selectedId,
  onSelect,
}: {
  accounts: Account[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const results = findGraphAccounts(accounts, query);

  return (
    <Sheet onOpenChange={(open) => { if (!open) setQuery(""); }}>
      <SheetTrigger asChild>
        <Button variant="outline" title="Find account" className="max-sm:size-9 max-sm:p-0"><Search aria-hidden /><span className="sr-only sm:not-sr-only">Find account</span></Button>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>Find an account</SheetTitle>
          <SheetDescription>{accounts.length} {accounts.length === 1 ? "company" : "companies"} available</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-3"><AccountSearch value={query} onChange={setQuery} /></div>
        <ScrollArea className="min-h-0 flex-1">
          {results.length ? (
            <ul className="flex flex-col gap-1 px-4 pb-4">
              {results.map((account) => (
                <li key={account.id}>
                  <SheetClose asChild>
                    <Button
                      variant={account.id === selectedId ? "secondary" : "ghost"}
                      className="h-auto w-full justify-between py-2.5 text-left whitespace-normal"
                      aria-current={account.id === selectedId ? "true" : undefined}
                      onClick={() => onSelect(account.id)}
                    >
                      <span className="flex min-w-0 flex-col gap-0.5 wrap-anywhere">
                        {account.name}
                        <span className="text-xs font-normal text-muted-foreground">{account.domain}</span>
                      </span>
                      {account.id === selectedId ? <Check data-icon="inline-end" aria-hidden /> : null}
                    </Button>
                  </SheetClose>
                </li>
              ))}
            </ul>
          ) : (
            <p role="status" className="px-4 py-2 text-sm text-muted-foreground">No accounts match your search.</p>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function AccountPath({ account, product, sample }: { account: Account; product: Product | null; sample: boolean }) {
  const saved = account.graph_path.length > 0;
  const path = saved ? account.graph_path : researchPath(product, account);
  const origin = saved ? (sample ? "Sample path" : "Neo4j") : "Saved research";

  return (
    <Card className="min-h-72 min-w-0 flex-1 gap-3 py-4 wrap-anywhere" role="region" aria-labelledby="account-path-title">
      <CardHeader className="items-center px-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-2.5">
          <CardTitle><h2 id="account-path-title">Account path</h2></CardTitle>
          <Badge variant="secondary">{origin}</Badge>
        </div>
        <CardAction>
          <Button asChild variant="ghost" size="sm">
            <Link href={`/accounts/view/?id=${encodeURIComponent(account.id)}`}>
              Open account <ChevronRight data-icon="inline-end" aria-hidden />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col px-4 sm:px-6">
        <CompanyNetwork account={account} path={path} />
      </CardContent>
    </Card>
  );
}

function researchPath(product: Product | null, account: Account): GraphNode[] {
  const { signal } = account;
  const path: GraphNode[] = [];
  if (product) {
    path.push({ id: product.id, label: "Product", name: product.name, relationship: "EVALUATED", evidence_id: null });
  }
  path.push({ id: account.id, label: "Company", name: account.name, relationship: signal ? "HAS_SIGNAL" : null, evidence_id: null });
  if (signal) {
    path.push({ id: signal.id, label: "Signal", name: signal.summary, relationship: null, evidence_id: signal.evidence_id });
  }
  return path;
}

const nodeStyles = {
  Product: { icon: Package, color: "text-success", surface: "border-success/30 bg-success-bg", legend: "Product" },
  Company: { icon: Building2, color: "text-primary", surface: "border-primary/35 bg-accent", legend: "Account match" },
  Signal: { icon: Radio, color: "text-warning", surface: "border-warning/30 bg-warning-bg", legend: "Signal" },
  Person: { icon: UserRound, color: "text-ink-2", surface: "border-input bg-muted", legend: "Employment" },
  Competitor: { icon: Layers2, color: "text-destructive", surface: "border-destructive/30 bg-danger-bg", legend: "Competition" },
};

const graphCategories = ["Product", "Company", "Signal", "Person", "Competitor"] as const;
type GraphCategory = typeof graphCategories[number];

function nodeCategory(label: string): GraphCategory | undefined {
  const normalized = label.toLowerCase();
  if (normalized === "contact" || normalized === "institution") return "Person";
  return graphCategories.find((category) => category.toLowerCase() === normalized);
}

function NodeBox({ node, fit }: { node: GraphNode; fit?: number }) {
  const category = nodeCategory(node.label);
  const { icon: Icon, color, surface } = category ? nodeStyles[category] : { icon: Waypoints, color: "text-muted-foreground", surface: "bg-card" };
  return (
    <div className={cn("flex min-w-0 flex-1 flex-col justify-center gap-1.5 rounded-md border p-3 lg:p-4", surface)}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-muted-foreground">
        <Icon aria-hidden className={cn("size-4 shrink-0", color)} />
        <span>{node.label}</span>
        {fit !== undefined ? <Badge variant="outline" className="ml-auto">Fit {fit}</Badge> : null}
      </div>
      <p className="font-semibold leading-snug">{node.name}</p>
    </div>
  );
}

function RelationshipPath({ path, account }: { path: GraphNode[]; account?: Account }) {
  const horizontal = path.length <= 3;
  return (
    <ol
      role="list"
      aria-label="Relationship path"
      className={cn("flex flex-col gap-1.5", horizontal && "lg:flex-row lg:items-stretch lg:gap-x-10")}
    >
      {path.map((node, index) => {
        const next = path[index + 1];
        const edgeCategory = node.relationship === "WORKS_AT" ? "Person" : next && nodeCategory(next.label);
        const edgeColor = edgeCategory ? nodeStyles[edgeCategory].color : "text-muted-foreground";
        return (
          <li key={`${index}-${node.id}`} className={cn("flex min-w-0 flex-col gap-1.5", horizontal && "lg:relative lg:flex-1")}>
            <NodeBox node={node} fit={node.id === account?.id ? account.fit_score : undefined} />
            {node.relationship && next ? (
              <div
                title={node.relationship.toLowerCase().replaceAll("_", " ")}
                className={cn("flex items-center px-3", edgeColor, horizontal && "lg:absolute lg:top-1/2 lg:left-full lg:w-10 lg:-translate-y-1/2 lg:justify-center lg:px-0")}
              >
                <ArrowDown aria-hidden className={cn("size-4 shrink-0", horizontal && "lg:size-5 lg:-rotate-90")} />
                <span className="sr-only">{node.relationship.toLowerCase().replaceAll("_", " ")}</span>
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function CompetitorRelationships({ rivals }: { rivals: Competitor[] }) {
  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="competitors">
        <AccordionTrigger>Product competitors</AccordionTrigger>
        <AccordionContent>
          <ul className="flex flex-col gap-4">
            {rivals.map((item) => (
              <li key={item.name} className="flex flex-col gap-2">
                <NodeBox node={{ id: item.name, label: "Competitor", name: item.name, relationship: null, evidence_id: null }} />
                <p className="text-muted-foreground">{item.positioning}</p>
                {item.evidence.length ? <EvidenceList evidence={item.evidence} numbered={false} /> : null}
              </li>
            ))}
          </ul>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
