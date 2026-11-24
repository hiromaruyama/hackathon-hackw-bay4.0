"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { EvidenceList, Panel } from "@/components/signal";
import { Input } from "@/components/ui/input";
import { verdictLabel } from "@/lib/format";
import type { Evidence, Workspace } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";

export default function GraphPage() {
  return (
    <AppShell>
      <Explorer />
    </AppShell>
  );
}

// ---------- Graph model ----------

type NodeType = "company" | "person" | "product" | "competitor" | "signal";

interface GNode {
  id: string;
  type: NodeType;
  label: string;
  score?: number; // company fit score drives size
  accountId?: string;
  risk?: boolean; // negative signal
  meta: string;
}

interface GEdge {
  id: string;
  from: string;
  to: string;
  rel: string;
  saved: boolean; // true when the edge comes from the Neo4j graph_path
  evidenceId: string | null;
}

const TYPES: { type: NodeType; label: string; color: string }[] = [
  { type: "company", label: "Company", color: "#2f72b0" },
  { type: "person", label: "Person", color: "#d9622b" },
  { type: "product", label: "Product", color: "#2e7d5b" },
  { type: "competitor", label: "Competitor", color: "#8b6fd6" },
  { type: "signal", label: "Signal", color: "#c99412" },
];
const colorOf = (n: GNode) => (n.risk ? "#b42318" : TYPES.find((t) => t.type === n.type)!.color);

const typeFromLabel = (label: string): NodeType => {
  const l = label.toLowerCase();
  if (l === "product") return "product";
  if (l === "person" || l === "contact") return "person";
  if (l === "competitor") return "competitor";
  if (l === "signal") return "signal";
  return "company";
};

function buildGraph(w: Workspace) {
  const nodes = new Map<string, GNode>();
  const edges = new Map<string, GEdge>();
  const evidence = new Map<string, Evidence>();
  const addEdge = (e: Omit<GEdge, "id">) => {
    const id = `${e.from}>${e.rel}>${e.to}`;
    if (!edges.has(id)) edges.set(id, { ...e, id });
  };

  const productId = w.product?.id ?? "product-1";
  nodes.set(productId, { id: productId, type: "product", label: w.product?.name ?? "Your product", meta: "Your product" });

  for (const a of w.accounts) {
    a.evidence.forEach((e) => evidence.set(e.id, e));
    nodes.set(a.id, {
      id: a.id,
      type: "company",
      label: a.name,
      score: a.fit_score,
      accountId: a.id,
      meta: `Fit ${a.fit_score}, intent ${a.intent_score}, ${verdictLabel[a.recommendation]}`,
    });

    // Saved Neo4j path first.
    a.graph_path.forEach((n, i) => {
      const type = typeFromLabel(n.label);
      const id = type === "product" ? productId : type === "company" ? a.id : n.id;
      if (!nodes.has(id)) nodes.set(id, { id, type, label: n.name, accountId: a.id, meta: n.label });
      const next = a.graph_path[i + 1];
      if (n.relationship && next) {
        const nt = typeFromLabel(next.label);
        const nextId = nt === "product" ? productId : nt === "company" ? a.id : next.id;
        addEdge({ from: id, to: nextId, rel: n.relationship, saved: true, evidenceId: n.evidence_id });
      }
    });

    // Everything else comes from the account's saved research.
    const matched = [...edges.values()].some((e) => e.from === productId && e.to === a.id);
    if (!matched) addEdge({ from: productId, to: a.id, rel: "EVALUATED", saved: false, evidenceId: null });

    if (a.signal && !nodes.has(a.signal.id)) {
      nodes.set(a.signal.id, { id: a.signal.id, type: "signal", label: a.signal.summary, accountId: a.id, meta: `${a.signal.kind} signal` });
      addEdge({ from: a.id, to: a.signal.id, rel: "HAS_SIGNAL", saved: false, evidenceId: a.signal.evidence_id });
    }
    if (a.negative_signal) {
      const risk = a.negative_signal;
      const id = `risk-${a.id}`;
      nodes.set(id, { id, type: "signal", label: risk.reason, accountId: a.id, risk: true, meta: "Reason to hold or reject" });
      addEdge({ from: a.id, to: id, rel: "HAS_RISK", saved: false, evidenceId: risk.evidence_id });
    }
    if (a.contact) {
      const c = a.contact;
      if (!nodes.has(c.id)) nodes.set(c.id, { id: c.id, type: "person", label: c.role, accountId: a.id, meta: `Contact found by Hunter, ${c.verification_status ?? "status unknown"}` });
      addEdge({ from: c.id, to: a.id, rel: "WORKS_AT", saved: false, evidenceId: null });
    }
  }

  if (w.competitor) {
    const id = "competitor";
    w.competitor.evidence.forEach((e) => evidence.set(e.id, e));
    nodes.set(id, { id, type: "competitor", label: w.competitor.name, meta: w.competitor.positioning });
    addEdge({ from: id, to: productId, rel: "COMPETES_WITH", saved: false, evidenceId: w.competitor.evidence[0]?.id ?? null });
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()], evidence, productId };
}

// ---------- Layout ----------

const W = 960;
const H = 620;
const CX = W / 2;
const CY = H / 2;

// Product in the middle, companies on a ring (best fit at the top), their signals and people fanned outside.
function layout(nodes: GNode[], edges: GEdge[], productId: string) {
  const pos = new Map<string, { x: number; y: number }>();
  pos.set(productId, { x: CX, y: CY });
  const companies = nodes.filter((n) => n.type === "company").sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const ring = Math.min(230, 150 + companies.length * 16);
  companies.forEach((c, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, companies.length);
    pos.set(c.id, { x: CX + ring * Math.cos(angle), y: CY + ring * Math.sin(angle) });
    const kids = edges
      .filter((e) => e.from === c.id || e.to === c.id)
      .map((e) => (e.from === c.id ? e.to : e.from))
      .filter((id) => id !== productId && !pos.has(id));
    kids.forEach((k, j) => {
      const spread = 0.75;
      const a2 = angle + (j - (kids.length - 1) / 2) * spread;
      const r2 = ring + 105;
      const x = CX + r2 * Math.cos(a2) * 1.25;
      const y = CY + r2 * Math.sin(a2) * 0.92;
      // Small nodes carry their label underneath, so keep room for it at the edges.
      pos.set(k, { x: Math.min(W - 130, Math.max(130, x)), y: Math.min(H - 40, Math.max(40, y)) });
    });
  });
  // Anything left (a competitor) goes in the widest empty gap between companies, inside the ring.
  const angles = companies.map((_, i) => -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, companies.length));
  let gapMid = Math.PI / 2;
  if (angles.length > 1) {
    let best = -1;
    angles.forEach((a, i) => {
      const next = i === angles.length - 1 ? angles[0] + 2 * Math.PI : angles[i + 1];
      if (next - a > best) {
        best = next - a;
        gapMid = (a + next) / 2;
      }
    });
  }
  let k = 0;
  for (const n of nodes) {
    if (!pos.has(n.id)) {
      const r = ring * (0.62 + k * 0.18);
      pos.set(n.id, { x: CX + r * Math.cos(gapMid + k * 0.35) * 1.15, y: CY + r * Math.sin(gapMid + k * 0.35) });
      k++;
    }
  }
  // Keep everything on the canvas.
  for (const [id, p] of pos) pos.set(id, { x: Math.min(W - 40, Math.max(40, p.x)), y: Math.min(H - 30, Math.max(30, p.y)) });
  return pos;
}

const sizeOf = (n: GNode) => {
  if (n.type === "product") return 26;
  if (n.type === "company") return 12 + ((n.score ?? 0) / 100) * 26; // 12 to 38, bigger for a better match
  if (n.type === "competitor") return 12;
  return 9;
};

// ---------- View ----------

function Explorer() {
  const { workspace } = useWorkspace();
  const w = workspace!;
  const { nodes, edges, evidence, productId } = useMemo(() => buildGraph(w), [w]);
  const pos = useMemo(() => layout(nodes, edges, productId), [nodes, edges, productId]);

  const [hidden, setHidden] = useState<Set<NodeType>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const visibleNodes = nodes.filter((n) => !hidden.has(n.type));
  const visibleIds = new Set(visibleNodes.map((n) => n.id));
  const visibleEdges = edges.filter((e) => visibleIds.has(e.from) && visibleIds.has(e.to));

  const sel = selected && visibleIds.has(selected) ? selected : null;
  const neighborhood = new Set<string>();
  if (sel) {
    neighborhood.add(sel);
    visibleEdges.forEach((e) => {
      if (e.from === sel) neighborhood.add(e.to);
      if (e.to === sel) neighborhood.add(e.from);
    });
  }
  const q = query.trim().toLowerCase();
  const matches = q ? visibleNodes.filter((n) => n.label.toLowerCase().includes(q)) : [];
  const matchIds = new Set(matches.map((m) => m.id));

  const selNode = nodes.find((n) => n.id === sel) ?? null;
  const selEdges = sel ? visibleEdges.filter((e) => e.from === sel || e.to === sel) : [];
  const selEvidence = [...new Set(selEdges.map((e) => e.evidenceId).filter(Boolean) as string[])]
    .map((id) => evidence.get(id))
    .filter(Boolean) as Evidence[];
  const nameOf = (id: string) => nodes.find((n) => n.id === id)?.label ?? id;

  const toggle = (t: NodeType) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  if (w.accounts.length === 0) {
    return (
      <>
        <h1 className="text-[22px] leading-tight font-bold">Knowledge graph</h1>
        <Panel className="flex flex-col items-start gap-2 py-10">
          <span className="text-lg font-bold">No graph yet</span>
          <span className="max-w-[56ch] text-muted-foreground">Nodes appear when discovery saves accounts, signals and contacts.</span>
          <Link href="/accounts/" className="mt-1 font-semibold">Open accounts</Link>
        </Panel>
      </>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] leading-tight font-bold">Knowledge graph</h1>
        <p className="text-muted-foreground">Companies are sized by fit score. Solid lines are saved in Neo4j; dashed lines come from the account's saved research.</p>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel className="flex flex-col gap-3 p-4 md:px-5">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <fieldset className="flex flex-wrap gap-x-5 gap-y-2">
              <legend className="sr-only">Show node types</legend>
              {TYPES.map((t) => {
                const count = nodes.filter((n) => n.type === t.type).length;
                return (
                  <label key={t.type} className={cn("flex cursor-pointer items-center gap-2 text-sm", count === 0 && "opacity-50")}>
                    <input type="checkbox" checked={!hidden.has(t.type)} onChange={() => toggle(t.type)} className="size-4 accent-[#2f72b0]" />
                    <span aria-hidden className={cn("inline-block size-3", t.type === "company" ? "rounded-[2px]" : t.type === "competitor" ? "rotate-45 rounded-[1px]" : "rounded-full")} style={{ background: t.color }} />
                    {t.label} ({count})
                  </label>
                );
              })}
            </fieldset>
            <label className="ml-auto flex h-9 w-full items-center gap-2 rounded-md border border-input bg-card px-2.5 text-muted-foreground sm:w-56">
              <Search aria-hidden className="size-4" />
              <Input
                aria-label="Find node"
                placeholder="Find node…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && matches[0]) setSelected(matches[0].id);
                  if (e.key === "Escape") setQuery("");
                }}
                className="h-auto border-0 p-0 text-sm text-foreground shadow-none focus-visible:ring-0"
              />
            </label>
          </div>
          {q && matches.length === 0 ? <p role="status" className="text-sm text-muted-foreground">No node matches “{query}”.</p> : null}

          <div className="overflow-hidden rounded-md border bg-subtle">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="block h-auto w-full"
              role="group"
              aria-label="Knowledge graph"
              onClick={(e) => {
                if (e.target === e.currentTarget) setSelected(null);
              }}
            >
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill="#9a9b98" />
                </marker>
              </defs>

              {visibleEdges.map((e) => {
                const a = pos.get(e.from)!;
                const b = pos.get(e.to)!;
                const toNode = nodes.find((n) => n.id === e.to)!;
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const len = Math.hypot(dx, dy) || 1;
                const pad = sizeOf(toNode) + 4;
                const ex = b.x - (dx / len) * pad;
                const ey = b.y - (dy / len) * pad;
                const active = sel ? e.from === sel || e.to === sel : false;
                const dim = sel && !active;
                return (
                  <g key={e.id} opacity={dim ? 0.12 : 1}>
                    <line
                      x1={a.x}
                      y1={a.y}
                      x2={ex}
                      y2={ey}
                      stroke={active ? "#2f312d" : e.rel === "HAS_RISK" ? "#d98b84" : "#a9aaa7"}
                      strokeWidth={active ? 2 : 1.4}
                      strokeDasharray={e.saved ? undefined : "5 4"}
                      markerEnd="url(#arrow)"
                    />
                    {active || (!sel && e.saved) ? (
                      <text x={(a.x + ex) / 2} y={(a.y + ey) / 2 - 6} textAnchor="middle" fontSize="11" fill="#6e706b" style={{ paintOrder: "stroke", stroke: "#f5f5f5", strokeWidth: 4 }}>
                        {e.rel.toLowerCase().replace(/_/g, " ")}
                      </text>
                    ) : null}
                  </g>
                );
              })}

              {visibleNodes.map((n) => {
                const p = pos.get(n.id)!;
                const r = sizeOf(n);
                const isSel = n.id === sel;
                const dim = sel && !neighborhood.has(n.id);
                const showLabel = visibleNodes.length <= 25 || n.type === "product" || n.type === "company" || n.type === "competitor" || neighborhood.has(n.id) || matchIds.has(n.id);
                const fill = colorOf(n);
                return (
                  <g
                    key={n.id}
                    transform={`translate(${p.x},${p.y})`}
                    opacity={dim ? 0.18 : 1}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSel}
                    aria-label={`${TYPES.find((t) => t.type === n.type)!.label}: ${n.label}${n.score !== undefined ? `, fit ${n.score}` : ""}`}
                    className="cursor-pointer outline-none [&:focus-visible>.focus]:opacity-100"
                    onClick={() => setSelected(isSel ? null : n.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelected(isSel ? null : n.id);
                      }
                    }}
                  >
                    <title>{`${n.label}${n.score !== undefined ? ` (fit ${n.score})` : ""}`}</title>
                    <circle className="focus" r={r + 7} fill="none" stroke="#2f72b0" strokeWidth="2" opacity="0" />
                    {isSel || matchIds.has(n.id) ? <circle r={r + 5} fill="none" stroke={isSel ? "#2f312d" : "#2f72b0"} strokeWidth="2" /> : null}
                    {n.type === "company" ? (
                      <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={3} fill={fill} />
                    ) : n.type === "competitor" ? (
                      <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={2} fill={fill} transform="rotate(45)" />
                    ) : (
                      <circle r={r} fill={fill} />
                    )}
                    {n.type === "company" && n.score !== undefined && r >= 16 ? (
                      <text textAnchor="middle" dy="5" fontSize="14" fontWeight="700" fill="#ffffff">
                        {n.score}
                      </text>
                    ) : null}
                    {showLabel ? (
                      <text
                        x={n.type === "signal" || n.type === "person" ? 0 : r + 7}
                        y={n.type === "signal" || n.type === "person" ? r + 17 : 0}
                        dy={n.type === "signal" || n.type === "person" ? 0 : 4}
                        textAnchor={n.type === "signal" || n.type === "person" ? "middle" : "start"}
                        fontSize={n.type === "product" || n.type === "company" ? 15 : 13}
                        fontWeight={n.type === "product" || n.type === "company" ? 600 : 400}
                        fill="#2f312d"
                        style={{ paintOrder: "stroke", stroke: "#f5f5f5", strokeWidth: 4 }}
                      >
                        {n.label.length > 30 ? `${n.label.slice(0, 29)}…` : n.label}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </svg>
          </div>
          <p className="text-[13px] text-muted-foreground">
            {visibleNodes.length} nodes, {visibleEdges.length} edges shown. Click a node to focus its neighborhood; click empty space to reset.
          </p>
        </Panel>

        <Panel aria-labelledby="node-title" className="flex flex-col gap-4 xl:sticky xl:top-4">
          {selNode ? (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-[13px] text-muted-foreground">{TYPES.find((t) => t.type === selNode.type)!.label}</span>
                <h2 id="node-title" className="text-[17px] font-semibold">{selNode.label}</h2>
                <span className="text-sm text-muted-foreground">{selNode.meta}</span>
                {selNode.accountId ? (
                  <Link href={`/accounts/view/?id=${selNode.accountId}`} className="mt-1 text-sm font-semibold">Open account</Link>
                ) : null}
              </div>
              <div>
                <h3 className="mb-1.5 text-sm font-semibold">Edges ({selEdges.length})</h3>
                <ul className="flex flex-col gap-1.5 text-sm">
                  {selEdges.map((e) => {
                    const other = e.from === sel ? e.to : e.from;
                    return (
                      <li key={e.id} className="flex flex-wrap items-baseline gap-x-1.5">
                        <span className="text-muted-foreground">{e.from === sel ? "" : `${nameOf(e.from)} `}</span>
                        <span className="font-semibold">{e.rel.toLowerCase().replace(/_/g, " ")}</span>
                        <button type="button" className="text-link underline-offset-2 hover:underline" onClick={() => setSelected(other)}>
                          {e.from === sel ? nameOf(e.to) : "this"}
                        </button>
                        <span className="text-xs text-muted-foreground">{e.saved ? "Neo4j" : "research"}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div>
                <h3 className="mb-1.5 text-sm font-semibold">Sources</h3>
                {selEvidence.length ? <EvidenceList evidence={selEvidence} numbered={false} /> : <p className="text-sm text-muted-foreground">No source is attached to these edges.</p>}
              </div>
            </>
          ) : (
            <>
              <h2 id="node-title" className="text-[17px] font-semibold">Select a node</h2>
              <p className="text-sm text-muted-foreground">Click a company, signal, person or competitor to see its connections and the sources behind them.</p>
              <ul className="flex flex-col gap-2 text-sm">
                {nodes
                  .filter((n) => n.type === "company")
                  .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
                  .map((n) => (
                    <li key={n.id} className="flex items-center justify-between gap-3">
                      <button type="button" className="text-left font-semibold text-foreground underline-offset-2 hover:underline" onClick={() => setSelected(n.id)}>
                        {n.label}
                      </button>
                      <span className="tabular-nums text-muted-foreground">fit {n.score}</span>
                    </li>
                  ))}
              </ul>
            </>
          )}
        </Panel>
      </div>
    </>
  );
}
