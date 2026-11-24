"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, ArrowUpRight, Check, Network } from "lucide-react";
import { Popover } from "radix-ui";
import { Button } from "@/components/ui/button";
import { DraftStatus, draftStatuses, draftStatusKey, type DraftStatusKey } from "@/components/draft-status";
import { GraphCanvas } from "@/components/graph-canvas";
import { Verdict } from "@/components/signal";
import { verdictClass, verdictLabel } from "@/lib/format";
import type { Account, Recommendation } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-context";
import styles from "./category-graph.module.css";

type Sort = DraftStatusKey | "name" | "fit";
type Brief = { id: string; pinned: boolean };

export function CategoryGraph({ accounts, product, verdict, onBack }: {
  accounts: Account[]; product: string; verdict: Recommendation; onBack: () => void;
}) {
  const states = Object.keys(draftStatuses) as DraftStatusKey[];
  const present = states.filter((state) => accounts.some((a) => draftStatusKey(a.draft) === state));
  const [sort, setSort] = useState<Sort>("review");
  const order = sort === "name" || sort === "fit" || present.includes(sort) ? sort : "name";
  const sorted = useMemo(() => [...accounts].sort((a, b) => {
    const rank = order === "name" ? 0 : order === "fit" ? b.fit_score - a.fit_score
      : Number(draftStatusKey(b.draft) === order) - Number(draftStatusKey(a.draft) === order);
    return rank || a.name.localeCompare(b.name);
  }), [accounts, order]);
  const [brief, setBrief] = useState<Brief | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const keyboard = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function cancelClose() { clearTimeout(closeTimer.current); }
  function leave() {
    cancelClose();
    closeTimer.current = setTimeout(() => setBrief((current) => current?.pinned ? current : null), 200);
  }
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const frame = useRef<HTMLDivElement>(null);
  const marker = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [edges, setEdges] = useState<string[]>([]);
  useLayoutEffect(() => {
    const board = frame.current;
    if (!board) return;
    const hub = board.querySelector<HTMLElement>('[data-hub]');
    const nodes = Array.from(board.querySelectorAll<HTMLElement>('[data-company]'));
    function measure() {
      if (!board || !hub) return;
      const box = board.getBoundingClientRect(), root = hub.getBoundingClientRect();
      const scale = box.width / board.offsetWidth;
      if (!scale) return;
      const x = (v: number) => (v - box.left) / scale, y = (v: number) => (v - box.top) / scale;
      const grid = getComputedStyle(board).getPropertyValue("--branches").trim() === "grid";
      setEdges(nodes.map((node) => {
        const n = node.getBoundingClientRect(), cy = y(n.top + n.height / 2);
        if (grid) {
          const startX = x(root.left + root.width / 2), startY = y(root.bottom);
          const rail = x(n.left) - 12, top = startY + 13;
          return `M ${startX} ${startY} V ${top} H ${rail} V ${cy} H ${x(n.left)}`;
        }
        const left = n.left < root.left;
        const sx = x(left ? root.left : root.right), sy = y(root.top + root.height / 2);
        const tx = x(left ? n.right : n.left), mid = (sx + tx) / 2;
        return `M ${sx} ${sy} C ${mid} ${sy} ${mid} ${cy} ${tx} ${cy}`;
      }));
    }
    measure();
    const ro = new ResizeObserver(measure);
    [board, ...nodes].forEach((node) => ro.observe(node));
    if (hub) ro.observe(hub);
    return () => ro.disconnect();
  }, [sorted]);

  return (
    <section aria-label={`${verdictLabel[verdict]} companies`} className="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft aria-hidden /> All verdicts</Button>
        <h2 className="font-semibold">{verdictLabel[verdict]} companies <span className="ml-1 text-muted-foreground">{accounts.length}</span></h2>
      </div>
      <div role="group" aria-label="Company sort order" className="flex shrink-0 items-center gap-1.5 overflow-x-auto py-0.5 text-xs whitespace-nowrap sm:flex-wrap">
        <span className="mr-1 shrink-0 text-muted-foreground">Show first</span>
        {([...present, "name", "fit"] as Sort[]).map((key) => {
          const status = key === "name" || key === "fit" ? null : draftStatuses[key];
          const active = order === key;
          return <button key={key} type="button" aria-pressed={active}
            onClick={() => { setSort(active ? "name" : key); setBrief(null); }}
            className={cn("inline-flex min-h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 font-medium focus-visible:outline-2 focus-visible:outline-ring", status?.tone ?? "bg-card", active && "border-current")}>
            {active ? <Check aria-hidden className="size-3" /> : null}
            {status?.label ?? (key === "name" ? "A–Z" : "Highest fit")}
          </button>;
        })}
      </div>
      <GraphCanvas fill className={styles.canvas}>
        <div ref={frame} className={cn(styles.board, verdictClass[verdict])} data-dense={sorted.length > 14}
          style={{ "--rows": Math.ceil(sorted.length / 2) } as CSSProperties} role="group" aria-label="Connected companies">
          <svg className={styles.lines} aria-hidden>
            <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="currentColor" /></marker></defs>
            {sorted.map((a, i) => <path key={a.id} d={edges[i]} stroke="currentColor" strokeWidth="1.7" fill="none" markerEnd={`url(#${marker})`} />)}
          </svg>
          <div data-hub className={styles.hub}><Network aria-hidden className="size-5" /><strong className="text-foreground">{product}</strong><Verdict value={verdict} className="text-xs" /></div>
          {sorted.map((account, index) => {
            const open = brief?.id === account.id;
            return <Popover.Root key={account.id} open={open} onOpenChange={(show) => { if (!show) setBrief(null); }}>
              <Popover.Anchor asChild>
                <button type="button" data-company={account.id} aria-haspopup="dialog" aria-expanded={open}
                  style={{ "--column": index % 2 === 0 ? 1 : 3, "--row": Math.floor(index / 2) + 1 } as CSSProperties}
                  onPointerEnter={(e) => { if (e.pointerType === "mouse") { cancelClose(); keyboard.current = false; setBrief((current) => current?.pinned ? current : { id: account.id, pinned: false }); } }}
                  onPointerLeave={leave}
                  onClick={(e) => {
                    cancelClose();
                    keyboard.current = e.detail === 0;
                    opener.current = e.currentTarget;
                    setBrief(open && brief.pinned ? null : { id: account.id, pinned: true });
                    if (open && keyboard.current) document.getElementById(marker + "-brief")?.focus();
                  }}
                  className={cn(styles.node, open && "border-primary ring-1 ring-primary")}>
                  <span className="font-semibold leading-tight wrap-anywhere">{account.name}</span><DraftStatus draft={account.draft} />
                </button>
              </Popover.Anchor>
              <Popover.Portal>
                <Popover.Content aria-label={`${account.name} brief`} sideOffset={5} collisionPadding={10} id={marker + "-brief"} tabIndex={-1} onOpenAutoFocus={(e) => {
                    if (!keyboard.current) e.preventDefault();
                  }}
                  onCloseAutoFocus={(e) => e.preventDefault()} onEscapeKeyDown={() => { setBrief(null); opener.current?.focus(); keyboard.current = false; }}
                  onInteractOutside={(event) => { if (event.target instanceof Element && event.target.closest("[data-company]")) event.preventDefault(); }}
                  onPointerEnter={cancelClose} onPointerLeave={leave}
                  className="z-50 w-72 max-w-[calc(100vw-1.5rem)] rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg">
                  <CompanyBrief account={account} />
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>;
          })}
        </div>
      </GraphCanvas>
    </section>
  );
}

function CompanyBrief({ account }: { account: Account }) {
  const { workspace, pending, writeDraft } = useWorkspace();
  const router = useRouter();
  const [error, setError] = useState("");
  const id = encodeURIComponent(account.id);
  const draftUrl = `/outreach/?account=${id}`;
  const eligible = account.recommendation === "contact" && account.icp_revision === workspace?.approved_icp_revision;
  async function create() {
    setError("");
    const result = await writeDraft(account.id);
    if (result.ok) router.push(draftUrl);
    else setError(result.error?.message ?? "The draft could not be created.");
  }
  return <div className="flex flex-col gap-2">
    <h3 className="font-semibold wrap-anywhere">{account.name}</h3>
    <div className="flex flex-wrap items-center gap-2 text-xs"><Verdict value={account.recommendation} /> <span>Fit {account.fit_score} · Intent {account.intent_score}</span></div>
    <p className="line-clamp-3 text-sm text-muted-foreground">{account.reason}</p>
    <div className="mt-1 flex flex-wrap gap-2">
      {account.draft ? <Button asChild size="sm"><Link href={draftUrl}>Edit draft</Link></Button>
        : <Button size="sm" disabled={!eligible || Boolean(pending)} onClick={() => void create()}>{eligible ? "Create draft" : "Edit draft"}</Button>}
      <Button size="sm" variant="outline" asChild><Link href={`/accounts/view/?id=${id}`}>View details <ArrowUpRight aria-hidden /></Link></Button>
    </div>
    {!account.draft && !eligible ? <p className="text-xs text-muted-foreground">Drafts start with a Contact verdict on the current profile.</p> : null}
    {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
  </div>;
}
