"use client";

import { useEffect, useRef, useState } from "react";
import { ConversationProvider, useConversationStatus } from "@elevenlabs/react";
import { ArrowUpRight, MessageCircle } from "lucide-react";
import { ChatComposer } from "@/components/chat-composer";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { api, ApiError } from "@/lib/api";
import type { IntakeMessage, Workspace } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-context";

// Signal Assistant reads workspace data. Voice sessions use a private ElevenLabs agent
// and a short-lived signed URL from the authenticated backend.

type Line = { id: number; role: "user" | "agent"; text: string; replyError?: string };

const MESSAGE_LIMIT = 500;
const STARTER_PROMPTS = [
  "Which accounts should I prioritize and why?",
  "What evidence backs my outreach drafts?",
  "Where does my pipeline stand?",
];

export function VoiceAssistant({ onChatPage }: { onChatPage: boolean }) {
  const [open, setOpen] = useState(false);
  const launcher = (
    <Button type="button" aria-label="Ask Signal"
      className="fixed bottom-[max(.75rem,env(safe-area-inset-bottom))] left-3 z-40 h-11 gap-2 rounded-full shadow-sm md:left-1.5 md:h-14 md:w-16 md:flex-col md:gap-1 md:rounded-lg md:px-0 md:text-xs"
      onClick={onChatPage ? () => document.getElementById("signal-chat-message")?.focus() : undefined}>
      <MessageCircle aria-hidden /> Ask Signal
    </Button>
  );
  if (onChatPage) return launcher;
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{launcher}</SheetTrigger>
      <SheetContent side="right" className="flex h-dvh w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="shrink-0 border-b px-5 py-4 pr-12">
          <SheetTitle>Signal Assistant</SheetTitle>
          <SheetDescription>Ask about accounts, evidence, and pipeline activity.</SheetDescription>
        </SheetHeader>
        {open ? <AgentChat /> : null}
      </SheetContent>
    </Sheet>
  );
}

export function AgentChat({ fullPage = false }: { fullPage?: boolean }) {
  return (
    <ConversationProvider>
      <AssistantPanel fullPage={fullPage} />
    </ConversationProvider>
  );
}

function AssistantPanel({ fullPage }: { fullPage: boolean }) {
  const { workspace } = useWorkspace();
  const { status } = useConversationStatus();
  const connected = status === "connected";
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const nextId = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [lines, sending]);

  function appendLine(role: Line["role"], text: string) {
    const line = { role, text, id: nextId.current++ };
    setLines((current) => [...current, line]);
    return line;
  }

  async function requestReply(turn: Line) {
    setSending(true);
    if (turn.replyError) setLines((current) => current.map((line) => line.id === turn.id ? { ...line, replyError: undefined } : line));
    try {
      const history: IntakeMessage[] = lines.filter((line) => line.id < turn.id && !line.replyError).slice(-12).map((line) => ({
        role: line.role === "user" ? "user" : "assistant",
        text: line.text.slice(0, 2000),
      }));
      const { reply } = await api.chatMessage(turn.text, history);
      appendLine("agent", reply);
    } catch (error) {
      const replyError = error instanceof ApiError ? error.message : "Couldn't get an answer. Try again.";
      setLines((current) => current.map((line) => line.id === turn.id ? { ...line, replyError } : line));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cn("flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-5", fullPage ? "px-1" : "px-5")}>
        {lines.length === 0 && !connected ? (
          <section aria-label="Suggested prompts" className={cn("mt-auto flex flex-col gap-3 pb-1", fullPage && "mx-auto w-full")}>
            <h2 className="text-xl font-semibold tracking-tight">Explore your workspace</h2>
            <ul className="grid gap-2">
              {STARTER_PROMPTS.map((prompt) => (
                <li key={prompt}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 rounded-lg border bg-card px-3.5 py-3 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
                    disabled={sending || status === "connecting"}
                    onClick={() => {
                      setText(prompt);
                      composerRef.current?.focus();
                    }}
                  >
                    {prompt}
                    <ArrowUpRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <div role="log" aria-label="Assistant conversation" className="flex flex-col gap-4">
          {lines.map((line) => (
            <div key={line.id} className={cn("flex max-w-[94%] flex-col gap-1", line.role === "user" && "self-end")}>
              <span className="text-xs font-medium text-muted-foreground">{line.role === "user" ? "You" : "Signal"}</span>
              <p className={cn("whitespace-pre-wrap wrap-anywhere text-sm leading-relaxed", line.role === "user" && "rounded-lg bg-muted px-3 py-2")}>
                {line.text}
              </p>
              {line.replyError ? (
                <div className="flex flex-wrap items-center gap-2">
                  <p role="alert" className="text-xs text-destructive">{line.replyError}</p>
                  {line.id === lines.at(-1)?.id && !connected ? (
                    <Button size="sm" variant="outline" disabled={sending || status === "connecting"} onClick={() => void requestReply(line)}>Retry reply</Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
          {sending ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner aria-hidden /> Signal is replying…</p> : null}
          <div ref={endRef} />
        </div>
      </div>

      <div className={cn(
        "flex shrink-0 flex-col gap-2 bg-background pt-3",
        fullPage ? "pb-[env(safe-area-inset-bottom)]" : "px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-5",
      )}>
        <ChatComposer
          inputId={fullPage ? "signal-chat-message" : undefined}
          value={text}
          onChange={setText}
          inputRef={composerRef}
          label="Message Signal Assistant"
          placeholder="Ask Signal a question"
          maxLength={MESSAGE_LIMIT}
          sending={sending}
          onSend={(message) => void requestReply(appendLine("user", message))}
          onVoiceLine={appendLine}
          getContext={() => summarize(workspace)}
        />
      </div>
    </div>
  );
}

// What the agent may see: the same facts the UI shows, with contact details reduced to role and status.
function summarize(w: Workspace | null) {
  if (!w) return { workspace: "not loaded" };
  return {
    product: w.product?.name ?? null,
    icp: w.icp ? { revision: w.icp.revision, approved: w.icp.approved, industries: w.icp.fields.industries, geography: w.icp.fields.geography, buyer_titles: w.icp.fields.buyer_titles } : null,
    accounts: w.accounts.map((a) => ({
      name: a.name,
      domain: a.domain,
      tier: a.tier,
      recommendation: a.recommendation,
      fit_score: a.fit_score,
      intent_score: a.intent_score,
      reason: a.reason,
      signal: a.signal?.summary ?? null,
      negative_signal: a.negative_signal?.reason ?? null,
      sources: a.evidence.map((e) => ({ title: e.title, type: e.source_type, published: e.published_at })),
      contact: a.contact ? { role: a.contact.role, verification: a.contact.verification_status } : null,
      draft: a.draft ? { revision: a.draft.revision, subject: a.draft.subject, review: a.draft.review_status, dispatch: a.draft.dispatch_status } : null,
    })),
    competitor: w.competitor ? { name: w.competitor.name, differentiator: w.competitor.differentiator, pricing: w.competitor.pricing ?? "Unknown" } : null,
    pipeline: { counts: w.pipeline.counts, matched_to_contacted_rate: w.pipeline.matched_to_contacted_rate, pending_approval: w.pipeline.pending_approval_count },
  };
}
