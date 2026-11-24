import { downloadFile, toCsv } from "./download";
import { verdictLabel } from "./format";
import type { Evidence, Workspace } from "./types";

type NodeType = "company" | "person" | "product" | "competitor" | "signal";

interface GNode {
  id: string;
  type: NodeType;
  label: string;
  score?: number;
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

  for (const competitor of w.competitors ?? (w.competitor ? [w.competitor] : [])) {
    const id = `competitor-${competitor.name}`;
    competitor.evidence.forEach((e) => evidence.set(e.id, e));
    nodes.set(id, { id, type: "competitor", label: competitor.name, meta: competitor.positioning });
    addEdge({ from: productId, to: id, rel: "COMPETES_WITH", saved: Boolean(w.competitors?.length), evidenceId: competitor.evidence[0]?.id ?? null });
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()], evidence, productId };
}

export function exportGraph(workspace: Workspace, format: "nodes" | "edges" | "json") {
  const { nodes: visibleNodes, edges: visibleEdges, evidence } = buildGraph(workspace);
  const sourceUrl = (id: string | null) => id ? evidence.get(id)?.url : undefined;
  if (format === "json") {
    const edges = visibleEdges.map((edge) => ({ ...edge, sourceUrl: sourceUrl(edge.evidenceId) }));
    downloadFile("signal-graph.json", "application/json", JSON.stringify({ nodes: visibleNodes, edges }, null, 2));
    return;
  }

  const csv = format === "nodes"
    ? toCsv(["ID", "Type", "Label", "Fit", "Account ID", "Details"],
        visibleNodes.map((node) => [node.id, node.type, node.label, node.score, node.accountId, node.meta]))
    : toCsv(["From node ID", "To node ID", "Relationship", "Saved in Neo4j", "Source URL"],
        visibleEdges.map((edge) => [edge.from, edge.to, edge.rel, edge.saved, sourceUrl(edge.evidenceId)]));
  downloadFile(`signal-graph-${format}.csv`, "text/csv;charset=utf-8", csv);
}
