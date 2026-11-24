"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";
import { ArrowDown, Building2, Check, ChevronRight, Compass, Layers2, Package, Radio, Search, UserRound, Waypoints } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AccountSearch, emptyGraphFilters, findGraphAccounts, GraphFilters } from "@/components/graph-filters";
import { VerdictMap } from "@/components/verdict-map";
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
import { enrichmentText } from "@/lib/format";
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
  const selectedId = useSearchParams().get("account");
  const requested = accounts.find((item) => item.id === selectedId);
  const [filters, setFilters] = useState(emptyGraphFilters);
  const [branch, setBranch] = useState<Recommendation | null>(requested?.recommendation ?? null);
  const pathTab = useRef<HTMLButtonElement>(null);
  const availableAccounts = accounts.filter((item) => !filters.verdicts.has(item.recommendation) && !filters.scores.has(item.fit_score) && !filters.companies.has(item.id));
  const selected = availableAccounts.find((item) => item.id === selectedId);
  const account = selected
    ?? availableAccounts.find((item) => item.graph_path.length > 0)
    ?? availableAccounts[0];
  const rivals = competitors?.length ? competitors : competitor ? [competitor] : [];

  function openAccountPath(id: string) {
    setBranch(availableAccounts.find((item) => item.id === id)?.recommendation ?? null);
    router.push(`/graph/?account=${encodeURIComponent(id)}`, { scroll: false });
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

      {selectedId && !requested ? (
        <InlineAlert tone="info" title="This company is no longer in the workspace">Choose an account from the map.</InlineAlert>
      ) : null}
      {account ? (
        <Tabs value={selected ? "path" : "overview"} activationMode="manual" onValueChange={(value) => {
          if (value === "path") openAccountPath(account.id);
          else router.push("/graph/", { scroll: false });
        }} className="gap-4 pb-12">
          <TabsList aria-label="Graph view">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger ref={pathTab} value="path">Account path</TabsTrigger>
          </TabsList>
          <TabsContent value="overview">
            <div className="flex flex-col gap-4">
              <VerdictMap accounts={availableAccounts} product={product} hidden={filters.verdicts} branch={branch} onBranch={setBranch} onSelect={openAccountPath} />
              {rivals.length ? <Card className="px-4 py-1 sm:px-6"><CompetitorRelationships rivals={rivals} /></Card> : null}
            </div>
          </TabsContent>
          <TabsContent value="path">
            <div className="flex flex-col gap-4">
              <p role="status" className="sr-only">{account.name} selected</p>
              <AccountPath account={account} product={product} sample={mode === "sample"} />
              {mode === "live" ? <GraphInsights key={account.id} accountId={account.id} /> : null}
              <MoreRelationships key={`relationships-${account.id}`} account={account} />
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

function AccountPath({ account, product, sample }: { account: Account; product: Product | null; sample: boolean }) {
  const saved = account.graph_path.length > 0;
  const path = saved ? account.graph_path : researchPath(product, account);
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
        <div className="rounded-lg border bg-subtle p-3 lg:p-4">
          <RelationshipPath path={path} account={account} />
        </div>
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

const graphCategories = ["Product", "Company", "Signal", "Person", "Competitor"] as const;
type GraphCategory = typeof graphCategories[number];

function nodeCategory(label: string): GraphCategory | undefined {
  const normalized = label.toLowerCase();
  if (normalized === "contact" || normalized === "institution") return "Person";
  return graphCategories.find((category) => category.toLowerCase() === normalized);
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

function MoreRelationships({ account }: { account: Account }) {
  const { signal, contact, negative_signal: risk } = account;
  const extraSignal = signal && account.graph_path.length > 0
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
                <RelationshipPath path={[
                  { id: contact.id, label: "Person", name: contact.role, relationship: "WORKS_AT", evidence_id: null },
                  { id: account.id, label: "Company", name: account.name, relationship: null, evidence_id: null },
                ]} />
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

function RelatedEvidence({ account, id }: { account: Account; id: string | null }) {
  const source = account.evidence.find((item) => item.id === id);
  return source ? <EvidenceList evidence={[source]} numbered={false} /> : null;
}
