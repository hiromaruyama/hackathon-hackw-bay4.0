"use client";

import Link from "next/link";
import { AccountDraftAction } from "@/components/account-draft-action";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, ArrowUpRight, Network } from "lucide-react";
import { Popover } from "radix-ui";
import { Button } from "@/components/ui/button";
import { DraftStatus } from "@/components/draft-status";
import { Verdict } from "@/components/signal";
import { verdictClass, verdictLabel } from "@/lib/format";
import type { Account, Recommendation } from "@/lib/types";
import { cn } from "@/lib/utils";
import styles from "./category-graph.module.css";


export function CategoryGraph({ accounts, product, verdict, onBack }: {
  accounts: Account[]; product: string; verdict: Recommendation; onBack: () => void;
}) {
  const sorted = useMemo(() => [...accounts].sort((a, b) => b.fit_score - a.fit_score || a.name.localeCompare(b.name)), [accounts]);
  const [brief, setBrief] = useState<{ id: string; pinned: boolean } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function keepPreview() { clearTimeout(closeTimer.current); }
  function leavePreview() {
    keepPreview();
    closeTimer.current = setTimeout(() => setBrief((current) => current?.pinned ? current : null), 180);
  }
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const opener = useRef<HTMLButtonElement | null>(null);
  const keyboard = useRef(false);
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
      {!accounts.length && <p role="status" className="text-sm text-muted-foreground">No companies match this fit score.</p>}
      <div className={cn(styles.canvas, "min-h-0 flex-1 overflow-auto rounded-lg border bg-subtle")}>
        <div ref={frame} className={cn(styles.board, verdictClass[verdict])} data-dense={sorted.length > 14}
          style={{ "--rows": Math.max(1, Math.ceil(sorted.length / 2)) } as CSSProperties} role="group" aria-label="Connected companies">
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
                  onPointerMove={(e) => {
                    if (e.pointerType !== "mouse" || brief?.pinned) return;
                    keepPreview();
                    if (!open) {
                      keyboard.current = false;
                      setBrief({ id: account.id, pinned: false });
                    }
                  }}
                  onPointerLeave={leavePreview}
                  onClick={(e) => {
                    keepPreview();
                    keyboard.current = e.detail === 0;
                    opener.current = e.currentTarget;
                    setBrief(open && brief.pinned ? null : { id: account.id, pinned: true });
                    if (open && keyboard.current) document.getElementById(marker + "-brief")?.focus();
                  }}
                  className={cn(styles.node, open && "border-primary ring-1 ring-primary")}>
                  <span className="font-semibold leading-tight wrap-anywhere">{account.name}</span>
                </button>
              </Popover.Anchor>
              <Popover.Portal>
                <Popover.Content aria-label={`${account.name} brief`} sideOffset={5} collisionPadding={10} id={marker + "-brief"} tabIndex={-1} onOpenAutoFocus={(e) => {
                    if (!keyboard.current) e.preventDefault();
                  }}
                  onCloseAutoFocus={(e) => e.preventDefault()} onEscapeKeyDown={() => { setBrief(null); opener.current?.focus(); keyboard.current = false; }}
                  onPointerEnter={keepPreview} onPointerLeave={leavePreview}
                  onInteractOutside={(event) => { if (event.target instanceof Element && event.target.closest("[data-company]")) event.preventDefault(); }}
                  className="z-50 w-72 max-w-[calc(100vw-1.5rem)] rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg">
                  <CompanyBrief account={account} />
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>;
          })}
        </div>
      </div>
    </section>
  );
}

function CompanyBrief({ account }: { account: Account }) {
  const id = encodeURIComponent(account.id);
  const draftUrl = `/outreach/?account=${id}`;
  return <div className="flex flex-col gap-2">
    <h3 className="font-semibold wrap-anywhere">{account.name}</h3>
    <div className="flex flex-wrap items-center gap-2 text-xs"><Verdict value={account.recommendation} /> <span>Fit {account.fit_score} · Intent {account.intent_score}</span></div>
    <DraftStatus draft={account.draft} />
    <p className="line-clamp-3 text-sm text-muted-foreground">{account.reason}</p>
    <div className="mt-1 flex flex-wrap gap-2">
      {account.draft ? <Button asChild size="sm"><Link href={draftUrl}>Edit draft</Link></Button>
        : <AccountDraftAction compact account={account} />}
      <Button size="sm" variant="outline" asChild><Link href={`/graph/?account=${id}`}>Account path</Link></Button>
      <Button size="sm" variant="outline" asChild><Link href={`/accounts/view/?id=${id}`}>View details <ArrowUpRight aria-hidden /></Link></Button>
    </div>

  </div>;
}
