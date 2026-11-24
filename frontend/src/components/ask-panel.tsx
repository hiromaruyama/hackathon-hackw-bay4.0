"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { InlineAlert } from "@/components/signal";
import { api, ApiError, type AskAnswer } from "@/lib/api";
import { enrichmentText } from "@/lib/format";
import type { Account, Evidence } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace-context";

type Msg =
  | { id: number; role: "you"; text: string }
  | { id: number; role: "signal"; status: "loading" }
  | { id: number; role: "signal"; status: "done"; answer: AskAnswer; applied?: boolean; dismissed?: boolean }
  | { id: number; role: "signal"; status: "error"; message: string };

const SUGGESTIONS = ["Why is this account a Contact?", "Is the contact verified?", "What's the weakest claim?"];

export function AskPanel({ account, onApply }: { account: Account; onApply: (before: string, after: string) => Promise<boolean> }) {
  const { mode } = useWorkspace();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);
  const busy = msgs.some((m) => m.role === "signal" && m.status === "loading");

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [msgs]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q) {
      setError("Type a question first.");
      return;
    }
    setError(null);
    setDraft("");
    const id = nextId.current;
    nextId.current += 2;
    setMsgs((m) => [...m, { id, role: "you", text: q }, { id: id + 1, role: "signal", status: "loading" }]);
    let reply: Msg;
    try {
      const answer = mode === "sample" ? await sampleAnswer(account, q) : await api.ask(account.id, q);
      reply = { id: id + 1, role: "signal", status: "done", answer };
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 405)) {
        setUnavailable(true);
        reply = { id: id + 1, role: "signal", status: "error", message: "Ask isn't available on this server yet." };
      } else {
        reply = { id: id + 1, role: "signal", status: "error", message: e instanceof ApiError ? e.message : "Couldn't get an answer. Try again." };
      }
    }
    setMsgs((m) => m.map((x) => (x.id === id + 1 ? reply : x)));
  }

  function update(id: number, patch: { applied?: boolean; dismissed?: boolean }) {
    setMsgs((m) => m.map((x) => (x.id === id && x.role === "signal" && x.status === "done" ? { ...x, ...patch } : x)));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        <p className="text-sm text-muted-foreground">
          Questions about {account.name} are answered from its {account.evidence.length} saved sources only. Suggested edits are saved as a new revision for you to approve.
        </p>
        {unavailable ? (
          <InlineAlert tone="info" title="Ask isn't connected yet">
            The backend needs the proposed <code>POST /api/accounts/{"{id}"}/ask</code> route.
          </InlineAlert>
        ) : null}
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <Button key={s} variant="outline" size="sm" className="h-8 font-normal" disabled={busy} onClick={() => void ask(s)}>
              {s}
            </Button>
          ))}
        </div>

        {msgs.map((m) =>
          m.role === "you" ? (
            <div key={m.id} className="flex flex-col gap-1.5">
              <span className="text-[13px] text-muted-foreground">You</span>
              <div className="rounded-md bg-muted px-3 py-2.5">{m.text}</div>
            </div>
          ) : m.status === "loading" ? (
            <div key={m.id} role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> Reading {account.evidence.length} sources…
            </div>
          ) : m.status === "error" ? (
            <p key={m.id} role="alert" className="text-sm text-destructive">{m.message}</p>
          ) : (
            <div key={m.id} className="flex flex-col gap-2">
              <span className="text-[13px] text-muted-foreground">
                Signal{m.answer.evidence_ids.length ? `, from ${citeLabel(account.evidence, m.answer.evidence_ids)}` : ""}
              </span>
              <p>{m.answer.answer}</p>
              {m.answer.suggested_edit && !m.applied && !m.dismissed ? (
                <div className="rounded-md border">
                  <div className="border-b px-3 py-2.5 text-[13px] font-semibold">Suggested edit</div>
                  <div className="flex flex-col gap-1.5 px-3 py-2.5 font-serif text-sm leading-relaxed">
                    <del className="text-destructive">{m.answer.suggested_edit.before}</del>
                    <ins className="bg-success-bg px-0.5 text-success-ink no-underline">{m.answer.suggested_edit.after}</ins>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2.5">
                    <span className="text-[13px] text-muted-foreground">Saves a new revision</span>
                    <span className="flex gap-1.5">
                      <Button variant="outline" size="sm" onClick={() => update(m.id, { dismissed: true })}>Dismiss</Button>
                      <Button
                        size="sm"
                        onClick={async () => {
                          const ok = await onApply(m.answer.suggested_edit!.before, m.answer.suggested_edit!.after);
                          if (ok) update(m.id, { applied: true });
                        }}
                      >
                        Apply to draft
                      </Button>
                    </span>
                  </div>
                </div>
              ) : null}
              {m.applied ? <InlineAlert tone="success" title="Applied as a new revision">Approve it before sending.</InlineAlert> : null}
              {m.dismissed ? <span className="text-sm text-muted-foreground">Suggestion dismissed. The draft is unchanged.</span> : null}
            </div>
          ),
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(draft);
        }}
        className="sticky bottom-0 flex shrink-0 flex-col gap-1.5 border-t bg-card px-5 pt-3 pb-4"
      >
        <Label htmlFor="ask-input" className="text-[13px] font-normal text-muted-foreground">
          Ask about {account.name}
        </Label>
        <div className="flex items-end gap-2">
          <Textarea
            id="ask-input"
            rows={2}
            value={draft}
            placeholder="Why is this account a Contact?"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "ask-error" : undefined}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(draft);
              }
            }}
            className="min-h-0 resize-y"
          />
          <Button type="submit" variant="outline" className="h-10 border-primary font-semibold text-primary" disabled={busy}>
            Ask
          </Button>
        </div>
        {error ? (
          <p id="ask-error" role="alert" className="text-[13px] text-destructive">{error}</p>
        ) : null}
        <p className="text-xs text-muted-foreground">Signal can suggest edits. It can't approve or send.</p>
      </form>
    </div>
  );
}

function citeLabel(evidence: Evidence[], ids: string[]) {
  const nums = ids.map((id) => evidence.findIndex((e) => e.id === id) + 1).filter((n) => n > 0);
  return nums.length === 1 ? `source ${nums[0]}` : `sources ${nums.join(" and ")}`;
}

// Sample mode only: answers built from the account's saved data, so nothing here is invented.
async function sampleAnswer(a: Account, q: string): Promise<AskAnswer> {
  await new Promise((r) => setTimeout(r, 700));
  const lower = q.toLowerCase();
  if (lower.includes("verif") || lower.includes("email")) {
    const e = enrichmentText(a.enrichment_status, a.contact?.verification_status);
    return { answer: `${e.text}. ${a.contact ? `The contact is the ${a.contact.role}.` : "No contact has been looked up."} The email goes to the controlled test inbox either way.`, evidence_ids: [], suggested_edit: null };
  }
  if (lower.includes("weak") || lower.includes("short") || lower.includes("guess")) {
    const before = "I would guess early screening is eating real hours.";
    const body = a.draft?.body ?? "";
    if (body.includes(before)) {
      const job = a.evidence.find((e) => e.source_type === "job_post");
      return {
        answer: "Paragraph 2. The job post says the analyst will support site screening, but nothing says screening is slow. That line is a guess, so a question is safer.",
        evidence_ids: job ? [job.id] : [],
        suggested_edit: { before, after: "is early screening taking more of their time than you'd like?" },
      };
    }
    return { answer: "Every claim about the prospect in the current draft is backed by a cited source.", evidence_ids: a.draft?.evidence_ids ?? [], suggested_edit: null };
  }
  return { answer: a.reason, evidence_ids: a.signal?.evidence_id ? [a.signal.evidence_id] : [], suggested_edit: null };
}
