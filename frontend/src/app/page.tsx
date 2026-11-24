"use client";

import Link from "next/link";
import { AlertTriangle, Check, Lock, PenLine, Search } from "lucide-react";
import { AccountsTable } from "@/components/accounts-table";
import { AppShell, CommandLink } from "@/components/app-shell";
import { ActivityList, Panel, PanelHeader } from "@/components/signal";
import { PipelineBars } from "@/components/pipeline-bars";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useWorkspace } from "@/lib/workspace-context";
import { dateTime, nextAction, time } from "@/lib/format";
import type { UsageEvent, Workspace } from "@/lib/types";
import { cn } from "@/lib/utils";

const usageLabels: Record<UsageEvent["operation"], string> = {
  leads_enriched: "Lead enrichment",
  graph_query_evaluated: "Graph query",
  outreach_sent: "Outreach send",
};

const usageStatus: Record<UsageEvent["status"], string> = {
  pending: "Pending",
  accepted: "Accepted",
  blocked: "Blocked",
  failed: "Failed",
};

export default function HomePage() {
  return (
    <AppShell
      commands={
        <>
          <CommandLink icon={Search} href="/accounts/">Find accounts</CommandLink>
          <CommandLink icon={PenLine} href="/profile/">Edit profile</CommandLink>
        </>
      }
    >
      <Home />
    </AppShell>
  );
}

function Home() {
  const { workspace } = useWorkspace();
  const w = workspace!;
  const next = nextAction(w);

  return (
    <>
      <section aria-labelledby="next" className="flex flex-wrap items-center justify-between gap-5 rounded-lg border bg-card p-6">
        <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-1.5">
          <h1 id="next" className="text-[22px] leading-tight font-bold">
            {next.title}
          </h1>
          <p className="max-w-[62ch] text-ink-2">{next.detail}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {next.secondary ? (
            <Button asChild variant="outline" className="h-10 px-4 font-semibold">
              <Link href={next.secondary.href}>{next.secondary.label}</Link>
            </Button>
          ) : null}
          <Button asChild className="h-10 px-[18px] font-semibold">
            <Link href={next.href}>{next.cta}</Link>
          </Button>
        </div>
      </section>

      <Workflow w={w} />

      {w.accounts.length > 0 ? <AccountsTable workspace={w} compact /> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel aria-labelledby="pipe-title">
          <PanelHeader title="Pipeline" id="pipe-title">
            <Link href="/pipeline/" className="text-sm">Open pipeline</Link>
          </PanelHeader>
          <PipelineBars pipeline={w.pipeline} />
        </Panel>
        <Panel aria-labelledby="activity-title">
          <PanelHeader title="Activity" id="activity-title" />
          <ActivityList events={w.activity} limit={6} />
        </Panel>
      </div>

      {w.usage ? (
        <Panel aria-labelledby="usage-title">
          <PanelHeader title="Enrichment credits" id="usage-title" />
          <dl className="grid gap-4 sm:grid-cols-3">
            <div><dt className="text-sm text-muted-foreground">Balance</dt><dd className="text-[30px] leading-tight font-semibold tabular-nums">{w.usage.balance ?? "Unknown"}</dd></div>
            <div><dt className="text-sm text-muted-foreground">Available for enrichment</dt><dd className="text-[30px] leading-tight font-semibold tabular-nums">{w.usage.available_for_enrichment ?? "Unknown"}</dd></div>
            <div><dt className="text-sm text-muted-foreground">Checked</dt><dd className="text-[30px] leading-tight font-semibold">{time(w.usage.checked_at)}</dd></div>
          </dl>
          {w.usage.status === "blocked" ? (
            <Alert variant="destructive" className="mt-4">
              <AlertTriangle aria-hidden />
              <AlertTitle>Enrichment blocked</AlertTitle>
              <AlertDescription>The workspace needs more credits before the next Hunter lookup.</AlertDescription>
            </Alert>
          ) : null}
          {w.usage.events.length ? (
            <div className="mt-4">
              <Table aria-label="Recent Flexprice usage">
                <TableHeader>
                  <TableRow>
                    <TableHead>Operation</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                    <TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {w.usage.events.slice(-10).reverse().map((event) => (
                    <TableRow key={event.id}>
                      <TableCell>{usageLabels[event.operation]}</TableCell>
                      <TableCell>{w.accounts.find((account) => account.id === event.account_id)?.name ?? "Earlier account"}</TableCell>
                      <TableCell>
                        <Badge variant={event.status === "failed" || event.status === "blocked" ? "destructive" : "secondary"}>
                          {usageStatus[event.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{event.status === "blocked" ? "—" : event.units}</TableCell>
                      <TableCell>{dateTime(event.at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </Panel>
      ) : null}
    </>
  );
}

type StepState = "done" | "warn" | "current" | "locked" | "todo";

function Workflow({ w }: { w: Workspace }) {
  const focus = w.accounts.find((a) => a.draft) ?? w.accounts.find((a) => a.recommendation === "contact");
  const d = focus?.draft;
  const steps: { title: string; detail: string; state: StepState; href?: string }[] = [
    {
      title: "Customer profile",
      href: "/profile/",
      state: w.approved_icp_revision ? "done" : w.icp ? "current" : "current",
      detail: w.approved_icp_revision ? `Revision ${w.approved_icp_revision} approved` : w.icp ? `Revision ${w.icp.revision} waiting for approval` : "Not started",
    },
    {
      title: "Find accounts",
      href: "/accounts/",
      state: !w.approved_icp_revision ? "locked" : w.accounts.length ? "done" : "current",
      detail: !w.approved_icp_revision ? "Unlocks after you approve a profile" : w.accounts.length ? `${w.accounts.length} accounts, ${w.accounts.reduce((n, a) => n + a.evidence.length, 0)} sources` : "Not run yet",
    },
    {
      title: "Find contact",
      href: focus ? `/accounts/view/?id=${focus.id}` : undefined,
      state: !focus ? "locked" : focus.enrichment_status === "verified" ? "done" : focus.enrichment_status === "not_started" ? "current" : "warn",
      detail: !focus
        ? "Needs an account marked Contact"
        : focus.enrichment_status === "verified"
          ? "1 contact, verified by Hunter"
          : focus.enrichment_status === "uncertain"
            ? "1 found. Hunter couldn't verify it."
            : focus.enrichment_status === "not_started"
              ? `Not looked up for ${focus.name}`
              : "Hunter didn't return a contact",
    },
    {
      title: "Approve draft",
      href: focus ? `/outreach/?account=${focus.id}` : undefined,
      state: !d ? "locked" : d.review_status === "approved" ? "done" : "current",
      detail: !d ? "Unlocks after a draft is written" : d.review_status === "approved" ? `Revision ${d.revision} approved` : d.review_status === "rejected" ? `Revision ${d.revision} rejected` : `Revision ${d.revision} waiting since ${time(d.updated_at)}`,
    },
    {
      title: "Send test email",
      href: d?.review_status === "approved" ? `/outreach/?account=${focus!.id}` : undefined,
      state: !d || d.review_status !== "approved" ? "locked" : d.dispatch_status === "sent" ? "done" : d.dispatch_status === "pending_outcome" || d.dispatch_status === "failed" ? "warn" : "current",
      detail:
        !d || d.review_status !== "approved"
          ? "Unlocks after you approve the draft"
          : d.dispatch_status === "sent"
            ? "Delivered to the test inbox"
            : d.dispatch_status === "pending_outcome"
              ? "Outcome needs checking"
              : d.dispatch_status === "failed"
                ? "Gmail rejected the send"
                : "Ready to send",
    },
  ];
  // Only the first actionable step is "now".
  let seenCurrent = false;
  for (const s of steps) {
    if (s.state === "current") {
      if (seenCurrent) s.state = "todo";
      seenCurrent = true;
    }
  }

  return (
    <section aria-labelledby="wf" className="flex flex-col gap-3">
      <h2 id="wf" className="text-[17px] font-semibold">Workflow</h2>
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {steps.map((s, i) => {
          const body = (
            <>
              <span className="flex items-center justify-between">
                <span className={cn("text-[13px] text-muted-foreground", s.state === "current" && "font-semibold text-primary")}>
                  {s.state === "current" ? `Step ${i + 1}, now` : `Step ${i + 1}`}
                </span>
                {s.state === "done" ? <Check aria-label="Done" className="size-[18px] text-success" strokeWidth={2.4} /> : null}
                {s.state === "warn" ? <AlertTriangle aria-label="Needs attention" className="size-[18px] text-warning" /> : null}
                {s.state === "locked" ? <Lock aria-label="Locked" className="size-4 text-muted-foreground" /> : null}
              </span>
              <span className={cn("font-semibold", s.state === "locked" && "text-ink-2")}>{s.title}</span>
              <span className="text-sm text-muted-foreground">{s.detail}</span>
            </>
          );
          const cls = cn(
            "flex h-full flex-col gap-2.5 rounded-lg border bg-card p-4 text-foreground no-underline",
            s.state === "current" && "border-2 border-primary",
            s.state === "locked" && "border-dashed border-input bg-subtle text-muted-foreground",
          );
          return (
            <li key={s.title}>
              {s.href && s.state !== "locked" ? (
                <Link href={s.href} aria-current={s.state === "current" ? "step" : undefined} className={cn(cls, "hover:border-input")}>
                  {body}
                </Link>
              ) : (
                <div className={cls}>{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
