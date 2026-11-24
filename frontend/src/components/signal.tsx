"use client";

import { AlertTriangle, CheckCircle2, Clock, Info, XCircle } from "lucide-react";
import type { ActivityEvent, Evidence, GraphNode, Recommendation } from "@/lib/types";
import { actorLabel, day, sourceTypeLabel, time, verdictClass, verdictDot, verdictLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Panel({ className, ...props }: React.ComponentProps<"section">) {
  return <section className={cn("rounded-lg border bg-card p-5 md:px-6", className)} {...props} />;
}

export function PanelHeader({ title, id, children }: { title: string; id?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 id={id} className="text-[17px] font-semibold">
        {title}
      </h2>
      {children}
    </div>
  );
}

export function Verdict({ value, className }: { value: Recommendation; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold", verdictClass[value], className)}>
      <span aria-hidden className={cn("size-2 rounded-full", verdictDot[value])} />
      {verdictLabel[value]}
    </span>
  );
}

const toneStyles = {
  warning: { box: "bg-warning-bg border-l-warning text-warning-ink", icon: AlertTriangle, iconClass: "text-warning" },
  danger: { box: "bg-danger-bg border-l-destructive text-danger-ink", icon: XCircle, iconClass: "text-destructive" },
  success: { box: "bg-success-bg border-l-success text-[#1f5a40]", icon: CheckCircle2, iconClass: "text-success" },
  info: { box: "bg-accent border-l-primary text-primary", icon: Info, iconClass: "text-primary" },
  pending: { box: "bg-warning-bg border-l-warning text-warning-ink", icon: Clock, iconClass: "text-warning" },
};

export function InlineAlert({
  tone,
  title,
  children,
  action,
  className,
}: {
  tone: keyof typeof toneStyles;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const s = toneStyles[tone];
  const Icon = s.icon;
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex flex-wrap items-start gap-3 rounded-md border-l-[3px] px-3.5 py-3", s.box, className)}>
      <Icon aria-hidden className={cn("mt-0.5 size-[18px] shrink-0", s.iconClass)} />
      <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
        <span className="font-semibold">{title}</span>
        {children ? <span>{children}</span> : null}
      </div>
      {action ? <div className="self-center">{action}</div> : null}
    </div>
  );
}

export function EvidenceList({ evidence, numbered = true, highlightId }: { evidence: Evidence[]; numbered?: boolean; highlightId?: string | null }) {
  if (evidence.length === 0) {
    return <p className="text-muted-foreground">No sources were saved for this account.</p>;
  }
  return (
    <ol className="flex flex-col gap-3">
      {evidence.map((e, i) => (
        <li key={e.id} className={cn("flex flex-col gap-2 rounded-md border p-3", highlightId === e.id && "border-primary")}>
          <div className="flex items-baseline gap-2.5">
            {numbered ? <span className="font-bold text-primary">{i + 1}</span> : null}
            <div className="flex min-w-0 flex-col">
              <a href={e.url} target="_blank" rel="noreferrer noopener" className="font-semibold text-foreground underline-offset-2 hover:underline">
                {e.title}
              </a>
              <span className="text-[13px] text-muted-foreground">
                {sourceTypeLabel(e.source_type)}, {day(e.published_at)}, {safeHost(e.url)}
              </span>
            </div>
          </div>
          <blockquote className="border-l-2 pl-2.5 font-serif text-sm text-[#4a4c47]">{e.excerpt}</blockquote>
        </li>
      ))}
    </ol>
  );
}

export function GraphPath({ path }: { path: GraphNode[] }) {
  if (path.length === 0) {
    return <p className="text-sm text-muted-foreground">No graph path is saved for this account yet.</p>;
  }
  return (
    <ol aria-label="Graph path" className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
      {path.map((n) => (
        <li key={n.id} className="flex items-center gap-2">
          <span className="rounded-md border bg-subtle px-2 py-0.5">
            <span className="text-muted-foreground">{n.label} </span>
            <span className="font-semibold">{n.name}</span>
          </span>
          {n.relationship ? <span className="text-xs text-muted-foreground">{n.relationship.toLowerCase().replace(/_/g, " ")}</span> : null}
        </li>
      ))}
    </ol>
  );
}

export function ActivityList({ events, limit }: { events: ActivityEvent[]; limit?: number }) {
  const list = limit ? events.slice(0, limit) : events;
  if (list.length === 0) return <p className="text-muted-foreground">Nothing has happened yet. Actions you take show up here.</p>;
  return (
    <ol>
      {list.map((e) => (
        <li key={e.id} className="grid grid-cols-[72px_minmax(0,1fr)] gap-3 border-b border-[#ececeb] py-2.5 last:border-b-0">
          <span className="pt-px text-[13px] text-muted-foreground tabular-nums">{time(e.at)}</span>
          <span>
            {e.message}
            <span className="block text-[13px] text-muted-foreground">{actorLabel(e.actor)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function safeHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
