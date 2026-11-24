"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowDown, Building2, Check, ChevronRight, Compass, Layers2, Package, Radio, Search, UserRound, Waypoints } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AccountSearch, emptyGraphFilters, findGraphAccounts, graphCategories, GraphFilters, type GraphCategory } from "@/components/graph-filters";
import { GraphInsights } from "@/components/graph-insights";
import { EvidenceList } from "@/components/signal";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { enrichmentText } from "@/lib/format";
import type { Account, Competitor, GraphInsight, GraphNode, Product } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-context";

export default function GraphPage() {
  return (
    <AppShell>
      <Explorer />
    </AppShell>
  );
}

function Explorer() {
  const { workspace, mode } = useWorkspace();
  const { accounts, product, competitors, competitor } = workspace!;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filters, setFilters] = useState(emptyGraphFilters);
  const [view, setView] = useState("overview");
  const pathTab = useRef<HTMLButtonElement>(null);
  const availableAccounts = accounts.filter((item) => !filters.scores.has(item.fit_score) && !filters.companies.has(item.id));
  const account = availableAccounts.find((item) => item.id === selectedId)
    ?? availableAccounts.find((item) => item.graph_path.length > 0)
    ?? availableAccounts[0];
  const rivals = competitors?.length ? competitors : competitor ? [competitor] : [];

  function openAccountPath(id: string) {
    setSelectedId(id);
    setView("path");
    pathTab.current?.focus();
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[22px] leading-tight font-bold">Knowledge graph</h1>
        {accounts.length ? (
          <div className="flex gap-2">
            <GraphFilters accounts={accounts} filters={filters} onChange={setFilters} />
            {account ? <AccountPicker accounts={availableAccounts} selectedId={account.id} onSelect={openAccountPath} /> : null}
          </div>
        ) : null}
      </div>

      {account ? (
        <Tabs value={view} onValueChange={setView} className="gap-4 pb-12">
          <TabsList aria-label="Graph view">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger ref={pathTab} value="path">Account path</TabsTrigger>
          </TabsList>
          <TabsContent value="overview">
            <GraphOverview
              accounts={availableAccounts}
              product={product}
              rivals={rivals}
              hidden={filters.categories}
              onSelect={openAccountPath}
            />
          </TabsContent>
          <TabsContent value="path">
            <div className="flex flex-col gap-4">
              <p role="status" className="sr-only">{account.name} selected</p>
              <AccountPath account={account} product={product} sample={mode === "sample"} hidden={filters.categories} />
              {mode === "live" ? <GraphInsights key={account.id} accountId={account.id} hiddenKinds={hiddenInsights(filters.categories)} /> : null}
              <MoreRelationships key={`relationships-${account.id}`} account={account} hidden={filters.categories} />
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
    </>
  );
}

function GraphOverview({
  accounts,
  product,
  rivals,
  hidden,
  onSelect,
}: {
  accounts: Account[];
  product: Product | null;
  rivals: Competitor[];
  hidden: Set<GraphCategory>;
  onSelect: (id: string) => void;
}) {
  const showCompanies = !hidden.has("Company");
  const showProduct = product && !hidden.has("Product");
  const scores = new Map<number, Account[]>();
  for (const account of findGraphAccounts(accounts, "")) {
    const group = scores.get(account.fit_score) ?? [];
    group.push(account);
    scores.set(account.fit_score, group);
  }

  return (
    <Card className="min-w-0 gap-4 py-4 wrap-anywhere sm:py-5" role="region" aria-labelledby="graph-overview-title">
      <CardHeader className="px-4 sm:px-6">
        <CardTitle><h2 id="graph-overview-title">Companies by fit</h2></CardTitle>
        {showCompanies ? <CardDescription>Select a company to inspect its path and sources.</CardDescription> : null}
        <CardAction><Badge variant="secondary">{accounts.length} {accounts.length === 1 ? "company" : "companies"}</Badge></CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-4 sm:px-6">
        <GraphLegend />
        <div className="flex flex-col rounded-lg border bg-subtle p-3 sm:p-4">
          {showProduct ? (
            <div className="flex w-full max-w-64">
              <NodeBox node={{ id: product.id, label: "Product", name: product.name, relationship: null, evidence_id: null }} />
            </div>
          ) : null}
          {showCompanies ? (
            <>
              {showProduct ? <ArrowDown aria-hidden className="ml-3.5 size-5 text-primary sm:ml-4" /> : null}
              <div className={cn("flex flex-col gap-5", showProduct && "border-l-2 border-primary/35 pl-3 sm:pl-4")}>
                {[...scores].sort(([a], [b]) => b - a).map(([score, companies]) => (
                  <section key={score} aria-label={`Fit ${score}`} className="flex flex-col gap-2">
                    <h3 className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">Fit {score}</Badge>
                      <span className="text-xs font-normal text-muted-foreground">{companies.length} {companies.length === 1 ? "company" : "companies"}</span>
                    </h3>
                    <ul role="list" className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {companies.map((company) => (
                        <li key={company.id} className={cn("min-w-0 rounded-md border min-[360px]:only:col-span-2 lg:only:col-span-1", nodeStyles.Company.surface)}>
                          <Button
                            variant="ghost"
                            className="h-full min-h-11 w-full justify-between whitespace-normal px-2.5 py-2 text-left sm:px-3"
                            onClick={() => onSelect(company.id)}
                          >
                            <span className="min-w-0">{company.name}</span>
                            <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                              {!hidden.has("Signal") && (company.signal || company.negative_signal) ? (
                                <span title="Saved signal" className={nodeStyles.Signal.color}><Radio aria-hidden /><span className="sr-only">Saved signal</span></span>
                              ) : null}
                              {!hidden.has("Person") && company.contact ? (
                                <span title="Saved contact" className={nodeStyles.Person.color}><UserRound aria-hidden /><span className="sr-only">Saved contact</span></span>
                              ) : null}
                            </span>
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </>
          ) : <p role="status" className="py-2 text-sm text-muted-foreground">Company nodes are hidden by your category filters.</p>}
        </div>
        {!hidden.has("Competitor") && rivals.length ? <CompetitorRelationships rivals={rivals} /> : null}
      </CardContent>
    </Card>
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
        <Button variant="outline"><Search data-icon="inline-start" aria-hidden /> Find account</Button>
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

function AccountPath({ account, product, sample, hidden }: { account: Account; product: Product | null; sample: boolean; hidden: Set<GraphCategory> }) {
  const saved = account.graph_path.length > 0;
  const path = filterPath(saved ? account.graph_path : researchPath(product, account), hidden);
  const origin = saved ? (sample ? "Sample path" : "Neo4j") : "Saved research";
  const evidenceIds = new Set(path.map((node) => node.evidence_id));
  const evidence = account.evidence.filter((source) => evidenceIds.has(source.id));

  return (
    <Card className="min-w-0 gap-4 py-4 wrap-anywhere sm:py-5" role="region" aria-labelledby="account-path-title">
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
      <CardContent className="flex flex-col gap-4 px-4 sm:px-6">
        {path.length ? (
          <div className="rounded-lg border bg-subtle p-3 lg:p-4">
            <RelationshipPath path={path} account={account} />
          </div>
        ) : (
          <p role="status" className="rounded-lg border bg-subtle p-4 text-sm text-muted-foreground">No path nodes match your category filters.</p>
        )}
        <GraphLegend />
        {evidence.length ? (
          <section aria-labelledby="graph-evidence-title" className="flex flex-col gap-2 [&_a]:text-link [&_a]:underline">
            <h3 id="graph-evidence-title" className="text-sm font-semibold">Cited evidence</h3>
            <EvidenceList evidence={evidence} numbered={false} />
          </section>
        ) : null}
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

function nodeCategory(label: string): GraphCategory | undefined {
  const normalized = label.toLowerCase();
  if (normalized === "contact" || normalized === "institution") return "Person";
  return graphCategories.find((category) => category.toLowerCase() === normalized);
}

function filterPath(path: GraphNode[], hidden: Set<GraphCategory>) {
  function isVisible(node: GraphNode) {
    const category = nodeCategory(node.label);
    return !category || !hidden.has(category);
  }

  return path.flatMap((node, index) => {
    if (!isVisible(node)) return [];
    const next = path[index + 1];
    if (node.relationship && next && !isVisible(next)) {
      return [{ ...node, relationship: null, evidence_id: null }];
    }
    return [node];
  });
}

function GraphLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
      <h3 className="flex items-center gap-1.5 font-semibold">
        <Compass aria-hidden className="size-4 text-muted-foreground" /> Legend
      </h3>
      <ul role="list" className="flex flex-wrap gap-x-4 gap-y-2">
        {graphCategories.map((category) => {
          const { icon: Icon, color, legend } = nodeStyles[category];
          return (
            <li key={category} className="flex items-center gap-1.5 text-muted-foreground">
              <Icon aria-hidden className={cn("size-3.5", color)} /> {legend}
            </li>
          );
        })}
      </ul>
    </div>
  );
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

function MoreRelationships({ account, hidden }: { account: Account; hidden: Set<GraphCategory> }) {
  const { signal } = account;
  const contact = hidden.has("Person") ? null : account.contact;
  const risk = hidden.has("Signal") ? null : account.negative_signal;
  const extraSignal = !hidden.has("Signal") && signal && account.graph_path.length > 0
    && !account.graph_path.some((node) => node.id === signal.id) ? signal : null;
  if (!contact && !risk && !extraSignal) return null;
  const enrichment = enrichmentText(account.enrichment_status, contact?.verification_status);

  return (
    <Card className="min-w-0 gap-1 py-4 wrap-anywhere" role="region" aria-labelledby="more-relationships-title">
      <CardHeader className="px-4 sm:px-6">
        <CardTitle><h2 id="more-relationships-title">More relationships</h2></CardTitle>
      </CardHeader>
      <CardContent className="px-4 sm:px-6">
        <Accordion type="multiple">
          {contact ? (
            <AccordionItem value="contact">
              <AccordionTrigger>Contact and employer</AccordionTrigger>
              <AccordionContent className="flex flex-col gap-2">
                <RelationshipPath path={filterPath([
                  { id: contact.id, label: "Person", name: contact.role, relationship: "WORKS_AT", evidence_id: null },
                  { id: account.id, label: "Company", name: account.name, relationship: null, evidence_id: null },
                ], hidden)} />
                <p className={enrichment.tone}>{enrichment.text}</p>
              </AccordionContent>
            </AccordionItem>
          ) : null}
          {extraSignal ? (
            <AccordionItem value="signal">
              <AccordionTrigger>Research signal</AccordionTrigger>
              <AccordionContent className="flex flex-col gap-2">
                <p>{extraSignal.summary}</p>
                <RelatedEvidence account={account} id={extraSignal.evidence_id} />
              </AccordionContent>
            </AccordionItem>
          ) : null}
          {risk ? (
            <AccordionItem value="risk">
              <AccordionTrigger>Risk signal</AccordionTrigger>
              <AccordionContent className="flex flex-col gap-2">
                <p>{risk.reason}</p>
                <RelatedEvidence account={account} id={risk.evidence_id} />
              </AccordionContent>
            </AccordionItem>
          ) : null}
        </Accordion>
      </CardContent>
    </Card>
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

function hiddenInsights(hidden: Set<GraphCategory>): GraphInsight["kind"][] {
  const kinds: GraphInsight["kind"][] = [];
  if (hidden.has("Person")) kinds.push("employment", "education", "warm_introduction");
  if (hidden.has("Signal")) kinds.push("buying_evaluation");
  if (hidden.has("Signal") || hidden.has("Competitor")) kinds.push("renewal", "churn");
  return kinds;
}

function RelatedEvidence({ account, id }: { account: Account; id: string | null }) {
  const source = account.evidence.find((item) => item.id === id);
  return source ? <EvidenceList evidence={[source]} numbered={false} /> : null;
}
