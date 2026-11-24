"use client";

import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { AgentChat } from "@/components/voice-assistant";
import { useWorkspace } from "@/lib/workspace-context";

export default function HomePage() {
  return (
    <AppShell>
      <HomeChat />
    </AppShell>
  );
}

function HomeChat() {
  const { workspace } = useWorkspace();
  if (!workspace) return null;

  const metrics = [
    { label: "Accounts", value: workspace.accounts.length, href: "/accounts/" },
    { label: "Pipeline leads", value: workspace.pipeline.leads.length, href: "/pipeline/" },
    { label: "Drafts to review", value: workspace.pipeline.pending_approval_count, href: "/outreach/" },
  ];

  return (
    <section aria-labelledby="assistant-title" className="flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b">
        <div className="mx-auto w-full max-w-3xl px-4 py-3 sm:py-4">
          <h1 id="assistant-title" className="text-xl font-semibold tracking-tight">Signal Assistant</h1>
          <nav aria-label="Workspace overview" className="mt-3 grid grid-cols-3 gap-2 sm:gap-3">
            {metrics.map(({ label, value, href }) => (
              <Link key={href} href={href} className="flex min-w-0 flex-col gap-0.5 rounded-lg border bg-card px-3 py-2 text-foreground no-underline transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:px-4">
                <strong className="text-lg/6 font-semibold tabular-nums sm:text-xl/7">{value.toLocaleString("en-US")}</strong>
                <span className="text-xs text-muted-foreground sm:text-sm">{label}</span>
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-4 pb-4">
        <AgentChat fullPage />
      </div>
    </section>
  );
}
