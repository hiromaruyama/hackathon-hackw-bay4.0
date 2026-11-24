"use client";

import { useEffect, useRef, useState } from "react";
import { ConversationProvider } from "@elevenlabs/react";
import { ArrowUpRight } from "lucide-react";
import { ChatComposer } from "@/components/chat-composer";
import { InlineAlert } from "@/components/signal";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { api, ApiError } from "@/lib/api";
import { enrichmentText, verdictLabel } from "@/lib/format";
import type { Account, Draft, IntakeMessage } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace-context";

type AskAnswer = {
  answer: string;
  evidence_ids: string[];
  suggested_edit: { before: string; after: string } | null;
};

type Msg =
  | { id: number; role: "you"; text: string }
  | { id: number; role: "signal"; status: "loading" }
  | { id: number; role: "signal"; status: "done"; revision: number; answer: AskAnswer; applied?: boolean; dismissed?: boolean }
  | { id: number; role: "signal"; status: "error"; message: string };

const sourcesPrompt = "Which sources does this draft cite?";
const openingPrompt = "Suggest a clearer opening.";
const prompts = [openingPrompt, "What's the weakest claim?", sourcesPrompt];

function writingContext(account: Account, draft: Draft) {
  const redact = (text: string) => {
    for (const address of [draft.test_recipient, account.contact?.email_masked]) {
      if (address) text = text.replaceAll(address, "[recipient]");
    }
    return text.replace(/[^\s<>@]+@[\w.-]+\.[a-z]{2,}/gi, "[email]");
  };
  return {
    company: account.name,
    domain: account.domain,
    verdict: verdictLabel[account.recommendation],
    channel: draft.channel ?? "email",
    revision: draft.revision,
    subject: redact(draft.subject),
    body: redact(draft.body),
    citations: account.evidence.filter((source) => draft.evidence_ids.includes(source.id)).map(({ title, excerpt }) => ({
      title: redact(title), excerpt: redact(excerpt),
    })),
  };
}

function textHistory(context: ReturnType<typeof writingContext>, messages: Msg[]): IntakeMessage[] {
  const { company, domain, verdict, channel, revision, subject, body } = context;
  const history: IntakeMessage[] = [{
    role: "user",
    text: `I am reviewing a saved ${channel} draft for ${company} (${domain}), revision ${revision}, verdict ${verdict}. Subject: ${subject}`.slice(0, 2000),
  }];
  // Each history entry accepts 2,000 characters. A saved draft body can contain 4,000.
  for (let offset = 0; offset < body.length; offset += 1900) {
    history.push({ role: "user", text: `Draft text (part ${1 + offset / 1900}): ${body.slice(offset, offset + 1900)}` });
  }
  if (context.citations.length) history.push({
    role: "user",
    text: `Sources cited in this revision: ${context.citations.map((source) => source.title).join("; ")}`.slice(0, 2000),
  });
  const completed: IntakeMessage[] = [];
  for (let index = 1; index < messages.length; index++) {
    const question = messages[index - 1], reply = messages[index];
    if (question.role === "you" && reply.role === "signal" && reply.status === "done") {
      completed.push({ role: "user", text: question.text.slice(0, 2000) }, { role: "assistant", text: reply.answer.answer.slice(0, 2000) });
    }
  }
  const pairs = Math.floor((12 - history.length) / 2);
  return pairs > 0 ? [...history, ...completed.slice(-pairs * 2)] : history;
}

type WritingProps = {
  active: boolean;
  account: Account;
  revision: Draft;
  onApply: (expectedRevision: number, before: string, after: string) => Promise<boolean>;
};

export function WritingAgent({ active, account, revision, onApply }: WritingProps) {
  const { mode, pending } = useWorkspace();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const transcriptRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nextId = useRef(1);
  const busy = msgs.some((m) => m.role === "signal" && m.status === "loading");

  useEffect(() => {
    const scroller = transcriptRef.current;
    if (scroller && active && msgs.length) scroller.scrollTop = scroller.scrollHeight;
  }, [msgs, active]);

  function voiceLine(role: "user" | "agent", text: string) {
    const id = nextId.current++;
    const line: Msg = role === "user" ? { id, role: "you", text } : {
      id, role: "signal", status: "done", revision: revision.revision, answer: { answer: text, evidence_ids: [], suggested_edit: null },
    };
    setMsgs((current) => [...current, line]);
  }

  async function ask(q: string) {
    if (busy) return;
    const id = nextId.current++;
    const replyId = nextId.current++;
    setMsgs((current) => [...current, { id, role: "you", text: q }, { id: replyId, role: "signal", status: "loading" }]);
    let reply: Msg;
    try {
      let answer: AskAnswer;
      if (q === sourcesPrompt) {
        const cited = account.evidence.filter((source) => revision.evidence_ids.includes(source.id));
        answer = {
          answer: cited.length ? "This revision cites the following sources." : "This revision has no saved citations.",
          evidence_ids: cited.map((source) => source.id), suggested_edit: null,
        };
      } else if (mode === "sample") {
        answer = await sampleAnswer(account, revision, q);
      } else {
        const context = writingContext(account, revision);
        const opening = context.body.split(/\n\s*\n/).map((paragraph) => paragraph.trim())
          .find((paragraph) => paragraph && !/^(?:hi|hello|hey|dear)\b.{0,50}[,!]$/i.test(paragraph));
        const before = q === openingPrompt && opening && opening.length <= 1200 && revision.body.includes(opening) ? opening : null;
        const prompt = before
          ? `Suggest a clearer opening for this draft. Return only a replacement for this exact passage, keeping its facts and the rest of the draft intact: ${before}`
          : q;
        const { reply: response } = await api.chatMessage(prompt, textHistory(context, msgs));
        answer = before && response.trim() && response.trim() !== before ? {
          answer: "Review this opening before applying it.", evidence_ids: [], suggested_edit: { before, after: response.trim() },
        } : { answer: response, evidence_ids: [], suggested_edit: null };
      }
      reply = { id: replyId, role: "signal", status: "done", revision: revision.revision, answer };
    } catch (e) {
      reply = { id: replyId, role: "signal", status: "error", message: e instanceof ApiError ? e.message : "Couldn't get a reply. Try again." };
    }
    setMsgs((current) => current.map((line) => line.id === replyId ? reply : line));
  }

  function update(id: number, patch: { applied?: boolean; dismissed?: boolean }) {
    setMsgs((current) => current.map((line) => line.id === id && line.role === "signal" && line.status === "done" ? { ...line, ...patch } : line));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={transcriptRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-5">
        {msgs.length === 0 ? (
          <section aria-label="Writing prompts" className="my-auto flex flex-col gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Work on this draft</h2>
            <p className="text-sm text-muted-foreground">{account.name} · Revision {revision.revision}</p>
            <ul className="grid gap-2">
              {prompts.map((prompt) => (
                <li key={prompt}>
                  <Button type="button" variant="outline" className="h-auto w-full justify-between whitespace-normal py-3 text-left"
                    onClick={() => { setDraft(prompt); inputRef.current?.focus(); }}>
                    {prompt}<ArrowUpRight aria-hidden data-icon="inline-end" />
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <div role="log" aria-label="Writing Agent conversation" className="flex flex-col gap-4">
          {msgs.map((m) => m.role === "you" ? (
            <div key={m.id} className="flex max-w-[94%] flex-col gap-1 self-end">
              <span className="text-xs font-medium text-muted-foreground">You</span>
              <p className="rounded-lg bg-muted px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap wrap-anywhere">{m.text}</p>
            </div>
          ) : m.status === "loading" ? (
            <div key={m.id} role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner /> Writing Agent is replying…</div>
          ) : m.status === "error" ? (
            <p key={m.id} role="alert" className="text-sm text-destructive">{m.message}</p>
          ) : (
            <div key={m.id} className="flex flex-col gap-2">
              <span className="text-xs font-medium text-muted-foreground">Writing Agent</span>
              <p className="text-sm leading-relaxed whitespace-pre-line wrap-anywhere">{m.answer.answer}</p>
              {m.answer.evidence_ids.length ? (
                <ul className="flex flex-col gap-1 text-sm">
                  {account.evidence.filter((source) => m.answer.evidence_ids.includes(source.id)).map((source) => (
                    <li key={source.id}><a href={source.url} target="_blank" rel="noopener noreferrer" className="text-link underline">{source.title}</a></li>
                  ))}
                </ul>
              ) : null}
              {m.answer.suggested_edit && !m.applied && !m.dismissed ? (
                <div className="rounded-md border">
                  <div className="border-b px-3 py-2.5 text-[13px] font-semibold">Suggested edit</div>
                  <div className="flex flex-col gap-1.5 px-3 py-2.5 font-serif text-sm leading-relaxed">
                    <del className="text-destructive">{m.answer.suggested_edit.before}</del>
                    <ins className="bg-success-bg px-0.5 text-success-ink no-underline">{m.answer.suggested_edit.after}</ins>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2.5">
                    <span className="text-[13px] text-muted-foreground">{revision.revision === m.revision ? "Saves a new revision" : `Suggested for revision ${m.revision}`}</span>
                    <span className="flex gap-1.5">
                      <Button variant="outline" size="sm" onClick={() => update(m.id, { dismissed: true })}>Dismiss</Button>
                      <Button
                        size="sm"
                        disabled={Boolean(pending) || revision.revision !== m.revision}
                        onClick={async () => {
                          const ok = await onApply(m.revision, m.answer.suggested_edit!.before, m.answer.suggested_edit!.after);
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
              {m.dismissed ? <span className="text-sm text-muted-foreground">Suggestion dismissed.</span> : null}
            </div>
          ))}
        </div>
      </div>
      {active ? <div className="flex shrink-0 flex-col gap-2 border-t bg-background px-3 py-3">
        <ConversationProvider>
          <ChatComposer value={draft} onChange={setDraft} inputRef={inputRef} onSend={ask} onVoiceLine={voiceLine}
            getContext={() => writingContext(account, revision)} sending={busy} maxLength={2000} voiceEnabled={mode === "live"}
            callContext={`Writing Agent call about ${account.name}, draft revision ${revision.revision}. The workspace summary tool contains the selected draft and its citations.`}
            label="Message Writing Agent" placeholder="Message the Writing Agent…" />
        </ConversationProvider>
      </div> : null}
    </div>
  );
}

// Sample mode only: answers built from the account's saved data, so nothing here is invented.
async function sampleAnswer(a: Account, revision: Draft, q: string): Promise<AskAnswer> {
  await new Promise((r) => setTimeout(r, 700));
  const lower = q.toLowerCase();
  if (lower.includes("verif") || lower.includes("email")) {
    const e = enrichmentText(a.enrichment_status, a.contact?.verification_status);
    return { answer: `${e.text}. ${a.contact ? `The contact is the ${a.contact.role}.` : "No contact has been looked up."} The email goes to the controlled test inbox either way.`, evidence_ids: [], suggested_edit: null };
  }
  if (q === openingPrompt || lower.includes("weak") || lower.includes("short") || lower.includes("guess")) {
    const before = "I would guess early screening is eating real hours.";
    const body = revision.body;
    if (body.includes(before)) {
      const job = a.evidence.find((e) => e.source_type === "job_post");
      return {
        answer: "Paragraph 2. The job post says the analyst will support site screening, but nothing says screening is slow. That line is a guess, so a question is safer.",
        evidence_ids: job ? [job.id] : [],
        suggested_edit: { before, after: "is early screening taking more of their time than you'd like?" },
      };
    }
    return { answer: "Compare the current wording with these saved sources before approving this revision.", evidence_ids: revision.evidence_ids, suggested_edit: null };
  }
  return { answer: a.reason, evidence_ids: a.signal?.evidence_id ? [a.signal.evidence_id] : [], suggested_edit: null };
}
