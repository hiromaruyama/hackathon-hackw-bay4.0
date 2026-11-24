"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, Search } from "lucide-react";
import { InlineAlert, Verdict } from "@/components/signal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import type { Account, Draft } from "@/lib/types";
import { cn } from "@/lib/utils";

function DraftStatus({ draft }: { draft: Draft | null }) {
  if (!draft) return <Badge variant="secondary">No draft</Badge>;
  const success = "bg-success-bg text-success-ink";
  const attention = "bg-review-bg text-review-ink";
  const danger = "bg-danger-bg text-danger-ink";
  const status = draft.dispatch_status === "failed" ? ["Send failed", danger]
    : draft.dispatch_status === "pending_outcome" ? ["Check send outcome", attention]
    : draft.dispatch_status === "sent" ? ["Sent", success]
    : draft.prepared_at ? ["Handoff ready", success]
    : draft.review_status === "rejected" ? ["Rejected", danger]
    : draft.review_status === "approved" ? ["Approved", success]
    : ["Needs review", attention];

  return <Badge variant="outline" className={cn("border-transparent", status[1])}>{status[0]}</Badge>;
}

const columns = "md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.2fr)_8rem]";

export function DraftDirectory({ accounts, missingDraft, gmailFeedback }: {
  accounts: Account[];
  missingDraft: boolean;
  gmailFeedback: boolean;
}) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const rows = accounts.filter(({ name, domain }) => `${name} ${domain}`.toLowerCase().includes(normalized))
    .sort((a, b) => Number(Boolean(b.draft)) - Number(Boolean(a.draft)) || a.name.localeCompare(b.name));
  const draftCount = accounts.filter((a) => a.draft).length;

  return (
    <>
      <h1 className="text-[22px] leading-tight font-bold">Outreach</h1>
      {missingDraft ? <InlineAlert tone="info" title="This draft is unavailable">Choose a company below to continue.</InlineAlert> : null}
      <section aria-labelledby="drafts-title" className="min-w-0 rounded-lg border bg-card">
        <header className="flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5">
          <div>
            <h2 id="drafts-title" className="text-lg font-semibold">Company drafts</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{accounts.length} {accounts.length === 1 ? "company" : "companies"} · {draftCount} with a draft</p>
          </div>
          {accounts.length > 0 ? <label className="relative w-full sm:w-60">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" aria-label="Search companies" placeholder="Company name or domain" value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" />
          </label> : null}
        </header>
        {rows.length > 0 ? <>
          <div aria-hidden className={cn("hidden items-center gap-3 border-y bg-subtle px-5 py-2 text-xs font-semibold text-muted-foreground md:grid", columns)}>
            <span>Company</span><span>Verdict</span><span>Draft status</span>
          </div>
          <ul aria-label="Company drafts" className="divide-y border-t md:border-t-0">
            {rows.map((account) => {
              const id = encodeURIComponent(account.id);
              return (
                <li key={id} className={cn("grid grid-cols-2 items-center gap-3 p-4 md:px-5", columns)}>
                  <div className="col-span-2 min-w-0 wrap-anywhere md:col-span-1">
                    <Link href={`/accounts/view/?id=${id}`} className="font-semibold underline-offset-2 hover:underline">{account.name}</Link>
                    <p className="text-xs text-muted-foreground">{account.domain}</p>
                  </div>
                  <div className="flex flex-col items-start gap-1 text-sm"><span className="text-xs text-muted-foreground md:sr-only">Verdict</span><Verdict value={account.recommendation} /></div>
                  <div className="flex flex-col items-start gap-1"><span className="text-xs text-muted-foreground md:sr-only">Draft status</span><DraftStatus draft={account.draft} /></div>
                  <Button variant={account.draft ? "outline" : "ghost"} size="sm" className="col-span-2 justify-self-start md:col-span-1 md:justify-self-end" asChild>
                    <Link href={account.draft ? `/outreach/?account=${id}` : `/accounts/view/?id=${id}`}>
                      {account.draft ? "Open Draft" : "View account"}<ArrowUpRight data-icon="inline-end" aria-hidden />
                    </Link>
                  </Button>
                </li>
              );
            })}
          </ul>
        </> : (
          <Empty className="border-t">
            <EmptyHeader>
              <EmptyTitle>{accounts.length ? "No matching companies" : "No companies yet"}</EmptyTitle>
              <EmptyDescription>{accounts.length ? "Try a different name or domain." : "Find companies in Accounts to start reviewing outreach."}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>{accounts.length
              ? <Button variant="outline" onClick={() => setQuery("")}>Clear search</Button>
              : <Button variant="outline" asChild><Link href="/accounts/">Open accounts</Link></Button>}</EmptyContent>
          </Empty>
        )}
      </section>
      {gmailFeedback ? <Link className="self-start text-sm text-link hover:underline" href="/pipeline/">Gmail feedback in Pipeline</Link> : null}
    </>
  );
}
