"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowUpRight, FilePlus2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { Account } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-context";

export function AccountDraftAction({ account, compact = false, className }: {
  account: Account;
  compact?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const { workspace, pending, writeDraft } = useWorkspace();
  const [error, setError] = useState("");
  const href = `/outreach/?account=${encodeURIComponent(account.id)}`;
  const creating = pending === `draft-${account.id}`;
  const size = compact ? "sm" : "default";
  const variant = compact ? "outline" : "default";
  if (account.draft) {
    return <Button asChild size={size} variant={variant} className={className}>
      <Link href={href}>Open Draft <ArrowUpRight aria-hidden /></Link>
    </Button>;
  }

  const current = workspace?.icp?.approved && workspace.icp.revision === account.icp_revision && workspace.approved_icp_revision === account.icp_revision;
  const writingOnly = account.recommendation !== "contact";
  const unavailable = !current ? "Requires the current approved profile."
    : !writingOnly && !account.buyer_role ? "Requires a buyer role." : null;

  async function create() {
    setError("");
    const result = await writeDraft(account.id, writingOnly);
    if (result.ok) router.push(href);
    else setError(result.error?.message ?? "Couldn’t create the draft. Try again.");
  }

  return <div className={cn("flex min-w-0 flex-col items-start gap-1", className)}>
    <Button type="button" size={size} variant={variant} disabled={Boolean(unavailable || pending)} onClick={() => void create()}>
      {creating ? <Spinner aria-hidden /> : <FilePlus2 aria-hidden />}
      {creating ? "Creating…" : "Create Draft"}
    </Button>
    {unavailable ? <span className="text-xs text-muted-foreground">{unavailable}</span> : null}
    {error ? <span role="alert" className="text-xs text-destructive">{error}</span> : null}
  </div>;
}
