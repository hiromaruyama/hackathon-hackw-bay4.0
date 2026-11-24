"use client";

import Link from "next/link";
import { ArrowRight, ArrowUpRight, BriefcaseBusiness, Building2, FilePenLine, MessageCircle } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Panel, PanelHeader } from "@/components/signal";
import { Button } from "@/components/ui/button";
import { day, stageLabel } from "@/lib/format";
import { useWorkspace } from "@/lib/workspace-context";

export default function HomePage() {
  return <AppShell><HomeDashboard /></AppShell>;
}

function HomeDashboard() {
  const { workspace } = useWorkspace();
  if (!workspace) return null;

  const { accounts, pipeline, product } = workspace;
  const drafts = accounts.flatMap(account =>
    [account.draft, ...(account.sequence ?? [])].flatMap(draft =>
      draft?.review_status === "pending_review" && draft.dispatch_status === "not_sent" ? [{ account, draft }] : []
    )
  ).sort((a, b) => b.draft.updated_at.localeCompare(a.draft.updated_at));
  const signals = accounts.flatMap(account => account.signal?.occurred_on ? [{ account, signal: account.signal }] : [])
    .sort((a, b) => b.signal.occurred_on!.localeCompare(a.signal.occurred_on!) || a.account.name.localeCompare(b.account.name));
  const changes = [...pipeline.events].sort((a, b) => b.at.localeCompare(a.at));
  const companies = new Map(pipeline.leads.map(lead => [lead.account_id, lead.company]));
  const metrics = [
    { label: "Accounts", count: accounts.length, href: "/accounts/", icon: Building2 },
    { label: "Pipeline leads", count: pipeline.leads.length, href: "/pipeline/", icon: BriefcaseBusiness },
    { label: "Drafts to review", count: pipeline.pending_approval_count, href: "/outreach/", icon: FilePenLine },
  ];

  return <>
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        {product && <p className="mb-1 text-sm font-medium text-muted-foreground">{product.name}</p>}
        <h1 className="text-3xl font-semibold tracking-tight">Workspace overview</h1>
      </div>
      <Button asChild>
        <Link href="/chat/"><MessageCircle aria-hidden /> Ask about tasks in Agents tab</Link>
      </Button>
    </header>
    <nav aria-label="Workspace totals" className="grid grid-cols-3 gap-2 sm:gap-4">
      {metrics.map(({ label, count, href, icon: Icon }) => (
        <Link key={label} href={href} className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-3 text-foreground no-underline hover:border-primary/50 sm:p-5">
          <span className="flex items-center justify-between gap-1 text-xs font-medium text-muted-foreground sm:text-sm">{label}<Icon aria-hidden className="hidden size-4 sm:block" /></span>
          <strong className="mt-auto text-2xl font-semibold tabular-nums sm:text-3xl">{count.toLocaleString("en-US")}</strong>
        </Link>
      ))}
    </nav>
    {!accounts.length ? <Panel><PanelHeader title="Find your first accounts" />
      <p className="mb-4 text-sm text-muted-foreground">{workspace.icp?.approved ? "Discover companies that match your approved buyer profile." : "Start with your product and the buyers you want to reach."}</p>
      <Button asChild><Link href={workspace.icp?.approved ? "/accounts/" : "/profile/"}>{workspace.icp?.approved ? "Open accounts" : "Open profile"}<ArrowRight aria-hidden /></Link></Button>
    </Panel> : <>
      <Panel aria-labelledby="review-title">
        <PanelHeader title="Drafts awaiting review" id="review-title"><Link className="text-sm text-link" href="/outreach/">All drafts <ArrowRight aria-hidden className="inline size-3.5" /></Link></PanelHeader>
        {drafts.length ? <ul className="divide-y">{drafts.slice(0, 4).map(({ account, draft }) =>
          <li key={draft.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0"><p className="font-semibold wrap-anywhere">{account.name}</p><p className="mt-1 text-sm text-muted-foreground wrap-anywhere">{draft.subject || "Untitled draft"} · Revision {draft.revision}</p></div>
            <Button asChild size="sm" variant="outline"><Link href={`/outreach/?account=${encodeURIComponent(account.id)}&draft=${encodeURIComponent(draft.id)}`}>Open Draft <ArrowUpRight aria-hidden /></Link></Button>
          </li>
        )}</ul> : <p className="text-sm text-muted-foreground">No drafts are waiting for approval.</p>}
      </Panel>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Panel aria-labelledby="signal-title"><PanelHeader title="Recent buying signals" id="signal-title" />
          {signals.length ? <ul className="divide-y">{signals.slice(0, 3).map(({ account, signal }) =>
            <li key={account.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-3"><Link href={`/accounts/view/?id=${encodeURIComponent(account.id)}`} className="font-semibold text-foreground hover:underline">{account.name}</Link><time className="shrink-0 text-xs text-muted-foreground" dateTime={signal.occurred_on!}>{day(signal.occurred_on)}</time></div>
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{signal.summary}</p>
            </li>
          )}</ul> : <p className="text-sm text-muted-foreground">No dated buying signals yet.</p>}
        </Panel>
        <Panel aria-labelledby="pipeline-title"><PanelHeader title="Pipeline changes" id="pipeline-title"><Link className="text-sm text-link" href="/pipeline/">Open pipeline <ArrowRight aria-hidden className="inline size-3.5" /></Link></PanelHeader>
          {changes.length ? <ul className="divide-y">{changes.slice(0, 3).map(event =>
            <li key={event.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-3"><span className="font-semibold">{companies.get(event.account_id) ?? "Archived account"}</span><time dateTime={event.at} className="shrink-0 text-xs text-muted-foreground">{day(event.at)}</time></div>
              <p className="mt-1 text-sm text-muted-foreground">{event.action === "bounce" ? "Delivery bounced" : event.outcome === "won" ? "Closed won" : stageLabel[event.to_stage]} · {event.source === "rep" ? "Rep action" : event.source === "gmail" || event.test_send ? "Gmail" : "Signal"}</p>
            </li>
          )}</ul> : <p className="text-sm text-muted-foreground">Confirmed sends, replies, and stage changes will appear here.</p>}
        </Panel>
      </div>
    </>}
  </>;
}
