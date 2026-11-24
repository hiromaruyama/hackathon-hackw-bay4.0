"use client";

import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Building2, Compass, Package, Radio, TriangleAlert, UserRound, Waypoints } from "lucide-react";
import { GraphCanvas } from "@/components/graph-canvas";
import { EvidenceList } from "@/components/signal";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { enrichmentText } from "@/lib/format";
import type { Account, GraphNode } from "@/lib/types";
import { cn } from "@/lib/utils";
import styles from "./company-network.module.css";

const kinds = {
  company: { icon: Building2, color: "var(--primary)", surface: "border-primary bg-accent", label: "Company" },
  product: { icon: Package, color: "var(--success)", surface: "border-success/60 bg-success-bg", label: "Product" },
  signal: { icon: Radio, color: "var(--warning)", surface: "border-warning/60 bg-warning-bg", label: "Buying signal" },
  risk: { icon: TriangleAlert, color: "var(--destructive)", surface: "border-destructive/60 bg-danger-bg", label: "Risk" },
  person: { icon: UserRound, color: "var(--ink-2)", surface: "border-input bg-card", label: "Person" },
  other: { icon: Waypoints, color: "var(--ink-2)", surface: "border-input bg-card", label: "Related entity" },
};
type Kind = keyof typeof kinds;
type Neighbor = { id: string; name: string; kind: Kind; incoming: boolean; relationship: string; evidenceIds: string[] };

function neighbors(account: Account, path: GraphNode[]) {
  const result: Neighbor[] = [];
  function add(node: Neighbor) {
    const existing = result.find((item) => item.id === node.id && item.relationship === node.relationship && item.incoming === node.incoming);
    if (existing) existing.evidenceIds.push(...node.evidenceIds);
    else result.push(node);
  }
  for (let i = 0; i < path.length - 1; i++) {
    const from = path[i], to = path[i + 1];
    if (!from.relationship) continue;
    const incoming = to.id === account.id;
    if (!incoming && from.id !== account.id) continue;
    const other = incoming ? from : to;
    const type = other.label.toLowerCase();
    const kind: Kind = type === "contact" ? "person" : Object.hasOwn(kinds, type) ? type as Kind : "other";
    add({ id: other.id, name: other.name, kind, incoming, relationship: from.relationship,
      evidenceIds: [from.evidence_id, other.evidence_id].filter((id): id is string => Boolean(id)) });
  }
  const { signal, contact, negative_signal: risk } = account;
  if (signal) add({ id: signal.id, name: signal.summary, kind: "signal", incoming: false, relationship: "HAS_SIGNAL", evidenceIds: signal.evidence_id ? [signal.evidence_id] : [] });
  if (contact) add({ id: contact.id, name: contact.role, kind: "person", incoming: true, relationship: "WORKS_AT", evidenceIds: [] });
  if (risk) add({ id: "risk-" + account.id, name: risk.reason, kind: "risk", incoming: false, relationship: "HAS_RISK", evidenceIds: [risk.evidence_id] });
  return result;
}

export function CompanyNetwork({ account, path }: { account: Account; path: GraphNode[] }) {
  const connections = useMemo(() => neighbors(account, path), [account, path]);
  const [focus, setFocus] = useState<number | null>(null);
  const selected = focus === null ? undefined : connections[focus];
  const [edgePaths, setEdgePaths] = useState<string[]>([]);
  const frame = useRef<HTMLDivElement>(null);
  const marker = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const sourceIds = new Set(selected ? selected.evidenceIds : [...path.map((node) => node.evidence_id), ...connections.flatMap((node) => node.evidenceIds)]);
  const evidence = account.evidence.filter((item) => sourceIds.has(item.id));

  useLayoutEffect(() => {
    const element = frame.current;
    const hub = element?.querySelector<HTMLElement>('[data-node="company"]');
    if (!element || !hub) return;
    const buttons = connections.map((_, index) => element.querySelector<HTMLElement>(`[data-node="${index}"]`));
    function measure() {
      if (!element || !hub) return;
      const box = element.getBoundingClientRect(), center = hub.getBoundingClientRect();
      const scale = box.width / element.offsetWidth;
      if (!scale) return;
      const vertical = getComputedStyle(element).flexDirection === "column";
      const localX = (coord: number) => (coord - box.left) / scale;
      const localY = (coord: number) => (coord - box.top) / scale;
      setEdgePaths(buttons.map((button, i) => {
        if (!button) return "";
        const other = button.getBoundingClientRect();
        const [from, to] = connections[i].incoming ? [other, center] : [center, other];
        if (vertical) {
          const x1 = localX(from.left + from.width / 2), x2 = localX(to.left + to.width / 2);
          const y1 = localY(from.bottom), y2 = localY(to.top), mid = (y1 + y2) / 2;
          return `M ${x1} ${y1} C ${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`;
        }
        const x1 = localX(from.right), x2 = localX(to.left), mid = (x1 + x2) / 2;
        const y1 = localY(from.top + from.height / 2), y2 = localY(to.top + to.height / 2);
        return `M ${x1} ${y1} C ${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`;
      }));
    }
    measure();
    const observer = new ResizeObserver(measure);
    [element, hub, ...buttons].forEach((node) => { if (node) observer.observe(node); });
    return () => observer.disconnect();
  }, [connections]);

  function nodeButton(index: number | null) {
    const neighbor = index === null ? undefined : connections[index];
    const style = kinds[neighbor?.kind ?? "company"];
    const title = neighbor?.name ?? account.name;
    return (
      <button key={index ?? "company"} type="button" data-node={index ?? "company"} aria-pressed={focus === index}
        title={title} onClick={() => setFocus(index === focus ? null : index)}
        className={cn(styles.node, style.surface, neighbor ? "rounded-xl" : "rounded-2xl shadow-sm", focus !== null && focus === index && "ring-2 ring-ring ring-offset-2 ring-offset-background")}>
        <span className="flex items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground">
          <style.icon aria-hidden className="size-4" style={{ color: style.color }} />{style.label}
        </span>
        <span className={cn("line-clamp-3 font-semibold wrap-anywhere", neighbor ? "text-sm" : "text-base")}>{title}</span>
      </button>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <GraphCanvas fill className={styles.canvas}>
        <div ref={frame} role="group" aria-label={`${account.name} relationship network`} className={styles.network}>
          <svg aria-hidden className={styles.lines}>
            <defs>{connections.map((node, i) => (
              <marker key={i} id={`${marker}-${i}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                <path d="M0 0 L10 5 L0 10 Z" fill={kinds[node.kind].color} />
              </marker>
            ))}</defs>
            {connections.map((node, i) => <path key={i} d={edgePaths[i]} fill="none" stroke={kinds[node.kind].color} strokeWidth={focus === i ? 3 : 2} markerEnd={`url(#${marker}-${i})`}><title>{node.relationship.replaceAll("_", " ").toLowerCase()}</title></path>)}
          </svg>
          <div className={styles.peers}>{connections.map((node, i) => node.incoming ? nodeButton(i) : null)}</div>
          <div className={styles.hub}>{nodeButton(null)}</div>
          <div className={styles.peers}>{connections.map((node, i) => !node.incoming ? nodeButton(i) : null)}</div>
        </div>
      </GraphCanvas>
      {selected ? <div role="status" className="rounded-md border bg-card px-3 py-2 text-sm wrap-anywhere">
        <strong>{selected.incoming ? selected.name : account.name}</strong>{" "}{selected.relationship.replaceAll("_", " ").toLowerCase()}{" "}<strong>{selected.incoming ? account.name : selected.name}</strong>
        {selected.kind === "person" && account.contact?.id === selected.id ? <p className="text-muted-foreground">{enrichmentText(account.enrichment_status, account.contact.verification_status).text}</p> : null}
      </div> : <p className="flex items-center gap-2 text-xs text-muted-foreground"><Compass aria-hidden className="size-4" /> Select a connected node to inspect its relationship.</p>}
      {evidence.length > 0 ? (
        <Accordion key={focus ?? "company"} type="single" collapsible defaultValue={selected ? "sources" : undefined}>
          <AccordionItem value="sources"><AccordionTrigger>Cited evidence ({evidence.length})</AccordionTrigger>
            <AccordionContent><EvidenceList evidence={evidence} numbered={false} /></AccordionContent>
          </AccordionItem>
        </Accordion>
      ) : null}
    </div>
  );
}
