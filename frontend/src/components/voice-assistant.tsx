"use client";

import { useEffect, useRef, useState } from "react";
import {
  ConversationProvider,
  useConversationClientTool,
  useConversationControls,
  useConversationMode,
  useConversationStatus,
} from "@elevenlabs/react";
import { ArrowUp, ArrowUpRight, MessageCircle, Mic, Phone, PhoneOff, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { InlineAlert } from "@/components/signal";
import { api, ApiError } from "@/lib/api";
import type { IntakeMessage, Workspace } from "@/lib/types";
import { useBrowserDictation } from "@/lib/use-browser-dictation";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-context";

// Signal Assistant reads workspace data. Voice sessions use a private ElevenLabs agent
// and a short-lived signed URL from the authenticated backend.

type Line = { id: number; role: "user" | "agent"; text: string };

const MESSAGE_LIMIT = 500;
const STARTER_PROMPTS = [
  "Which accounts should I prioritize and why?",
  "What evidence backs my outreach drafts?",
  "Where does my pipeline stand?",
];

export function VoiceAssistant() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-4 z-40 h-11 gap-2 rounded-full px-4 shadow-lg"
        aria-label="Open Signal Assistant"
      >
        <MessageCircle aria-hidden /> Ask Signal
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex h-dvh w-full flex-col gap-0 p-0 sm:max-w-lg">
          <SheetHeader className="shrink-0 border-b px-5 py-4 pr-12">
            <SheetTitle>Signal Assistant</SheetTitle>
            <SheetDescription>Ask about accounts, evidence, and pipeline activity.</SheetDescription>
          </SheetHeader>
          {/* Mounted only while open, so closing the sheet ends the session and releases the mic. */}
          {open ? <SignalAssistantChat /> : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

export function SignalAssistantChat() {
  return (
    <ConversationProvider>
      <AssistantPanel />
    </ConversationProvider>
  );
}

function AssistantPanel() {
  const { workspace } = useWorkspace();
  const { startSession, endSession, sendUserMessage } = useConversationControls();
  const { status } = useConversationStatus();
  const { isSpeaking } = useConversationMode();
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState("");
  const [startingVoice, setStartingVoice] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);
  const nextId = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const voiceStart = useRef<symbol | null>(null);

  // The handler reads the latest workspace on every call.
  useConversationClientTool("get_workspace_summary", () => JSON.stringify(summarize(workspace)));

  const { status: dictation, toggle: toggleDictation } = useBrowserDictation(
    (transcript) => {
      setText((current) => [current.trimEnd(), transcript].filter(Boolean).join(" ").slice(0, MESSAGE_LIMIT));
      composerRef.current?.focus();
    },
    (message) => setError({ title: "Dictation unavailable", message }),
  );


  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [lines, error]);

  useEffect(() => () => {
    voiceStart.current = null;
    endSession();
  }, [endSession]);

  const connected = status === "connected";
  const connectingVoice = startingVoice || status === "connecting";
  const dictating = dictation !== "idle";
  const busy = sending || connectingVoice || dictating;
  const composerStatus = dictation === "starting" ? "Starting microphone…"
    : dictation === "listening" ? "Listening for dictation…"
    : dictation === "finishing" ? "Finishing dictation…"
    : connectingVoice ? "Connecting voice…"
    : connected ? (isSpeaking ? "Signal is speaking…" : "Voice is listening…")
    : sending ? "Signal is replying…" : "";

  function appendLines(...messages: Omit<Line, "id">[]) {
    const added = messages.map((message) => ({ ...message, id: nextId.current++ }));
    setLines((current) => [...current, ...added]);
  }

  async function startVoice() {
    if (voiceStart.current) return;
    const attempt = Symbol();
    voiceStart.current = attempt;
    setError(null);
    setStartingVoice(true);
    try {
      const { signed_url } = await api.chatSession();
      if (voiceStart.current !== attempt) return;
      startSession({
        signedUrl: signed_url,
        onMessage: ({ message, role }) => {
          const transcript = message?.trim();
          if (transcript) appendLines({ role, text: transcript });
        },
        onError: () => {
          setError({ title: "Voice unavailable", message: "Couldn't connect to voice. You can still type below." });
        },
      });
    } catch (e) {
      if (voiceStart.current === attempt) {
        setError({ title: "Voice unavailable", message: e instanceof ApiError ? e.message : "Couldn't start voice. Try again." });
      }
    } finally {
      if (voiceStart.current === attempt) {
        voiceStart.current = null;
        setStartingVoice(false);
      }
    }
  }

  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const draft = text;
    const message = draft.trim();
    if (!message || busy) return;
    setError(null);

    if (connected) {
      try {
        sendUserMessage(message);
        setText("");
      } catch {
        setError({ title: "Message failed", message: "Couldn't send that message to the voice session. Try again." });
      }
      return;
    }

    setSending(true);
    try {
      const history: IntakeMessage[] = lines.slice(-12).map((line) => ({
        role: line.role === "user" ? "user" : "assistant",
        text: line.text.slice(0, 2000),
      }));
      const { reply } = await api.chatMessage(message, history);
      appendLines({ role: "user", text: message }, { role: "agent", text: reply });
      setText((current) => current === draft ? "" : current);
    } catch (e) {
      setError({ title: "Message failed", message: e instanceof ApiError ? e.message : "Couldn't get an answer. Try again." });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto px-5 py-5">
        {lines.length === 0 && !connected ? (
          <section aria-label="Suggested prompts" className="mt-auto flex w-full max-w-3xl flex-col gap-3 pb-1">
            <h3 className="text-xl font-semibold tracking-tight">Explore your workspace</h3>
            <ul className="grid gap-2">
              {STARTER_PROMPTS.map((prompt) => (
                <li key={prompt}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 rounded-lg border bg-card px-3.5 py-3 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
                    disabled={busy}
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
        <div role="log" aria-label="Assistant conversation" className="flex w-full max-w-3xl flex-col gap-4">
          {lines.map((line) => (
            <div key={line.id} className={cn("flex max-w-[94%] flex-col gap-1", line.role === "user" && "self-end")}>
              <span className="text-xs font-medium text-muted-foreground">{line.role === "user" ? "You" : "Signal"}</span>
              <p className={cn("whitespace-pre-wrap wrap-anywhere text-sm leading-relaxed", line.role === "user" && "rounded-lg bg-muted px-3 py-2")}>
                {line.text}
              </p>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-t bg-background px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-5">
        {error ? (
          <div className="mx-auto w-full max-w-3xl">
            <InlineAlert tone="danger" title={error.title}>{error.message}</InlineAlert>
          </div>
        ) : null}
        <form className="mx-auto w-full max-w-3xl rounded-2xl border border-input bg-card p-1.5 shadow-sm focus-within:border-ring" onSubmit={send}>
          <Textarea
            ref={composerRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            rows={1}
            placeholder="Message Signal Assistant"
            aria-label="Message Signal Assistant"
            maxLength={MESSAGE_LIMIT}
            className="max-h-36 min-h-10 resize-none border-0 bg-transparent px-2.5 py-2 shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <div className="flex items-center justify-between gap-2 px-0.5 pb-0.5">
            <span role="status" className="min-w-0 px-1.5 text-xs text-muted-foreground">{composerStatus}</span>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn("size-9 rounded-full", dictating && "bg-accent text-accent-foreground")}
                aria-label={dictating ? "Stop dictation" : "Dictate message"}
                title={dictating ? "Stop dictation" : "Dictate with your browser's speech service"}
                disabled={connected || connectingVoice || sending || dictation === "finishing"}
                onClick={() => {
                  setError(null);
                  toggleDictation();
                }}
              >
                {dictating ? <Square aria-hidden className="size-3.5 fill-current" /> : <Mic aria-hidden />}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9 rounded-full"
                aria-label={connected ? "End live voice chat" : "Start live voice chat"}
                title={connected ? "End live voice chat" : "Start live voice through ElevenLabs"}
                disabled={busy}
                onClick={() => connected ? endSession() : void startVoice()}
              >
                {connectingVoice ? <Spinner /> : connected ? <PhoneOff aria-hidden /> : <Phone aria-hidden />}
              </Button>
              <Button type="submit" size="icon" className="size-9 rounded-full" aria-label="Send message to assistant" disabled={!text.trim() || busy}>
                <ArrowUp aria-hidden />
              </Button>
            </div>
          </div>
        </form>
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
