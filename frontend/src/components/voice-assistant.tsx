"use client";

import { useEffect, useRef, useState } from "react";
import {
  ConversationProvider,
  useConversationClientTool,
  useConversationControls,
  useConversationMode,
  useConversationStatus,
} from "@elevenlabs/react";
import { MessageCircle, Mic, PhoneOff, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { InlineAlert } from "@/components/signal";
import { api, ApiError } from "@/lib/api";
import type { IntakeMessage, Workspace } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace-context";

// Signal Assistant reads workspace data. Voice sessions use a private ElevenLabs agent
// and a short-lived signed URL from the authenticated backend.

type Line = { id: number; role: "user" | "agent"; text: string };

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
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b px-5 py-4">
            <SheetTitle>Signal Assistant</SheetTitle>
            <SheetDescription>Ask a question about your workspace. You can type or use the microphone.</SheetDescription>
          </SheetHeader>
          {/* Mounted only while open, so closing the sheet ends the session and releases the mic. */}
          {open ? (
            <ConversationProvider>
              <AssistantPanel />
            </ConversationProvider>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
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
  const voiceStart = useRef<symbol | null>(null);

  // The handler reads the latest workspace on every call.
  useConversationClientTool("get_workspace_summary", () => JSON.stringify(summarize(workspace)));

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [lines, error]);

  useEffect(() => () => {
    voiceStart.current = null;
    endSession();
  }, [endSession]);

  const connected = status === "connected";
  const connectingVoice = startingVoice || status === "connecting";

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
    if (!message || sending || connectingVoice) return;
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
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4" aria-live="polite">
        {lines.length === 0 && !connected ? (
          <p className="text-sm text-muted-foreground">
            Ask why an account is a Contact, what evidence backs the draft, or where the pipeline stands.
          </p>
        ) : null}
        {lines.map((line) => (
          <div key={line.id} className="flex flex-col gap-1">
            <span className="text-[13px] text-muted-foreground">{line.role === "user" ? "You" : "Signal"}</span>
            <p className={line.role === "user" ? "rounded-md bg-muted px-3 py-2 break-words" : "break-words"}>{line.text}</p>
          </div>
        ))}
        {error ? <InlineAlert tone="danger" title={error.title}>{error.message}</InlineAlert> : null}
        <div ref={endRef} />
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-t bg-card px-5 pt-3 pb-4">
        <div className="flex items-center justify-between text-[13px] text-muted-foreground">
          <span role="status">
            {connected ? (isSpeaking ? "Signal is speaking…" : "Listening…") : connectingVoice ? "Connecting voice…" : sending ? "Replying…" : "Text chat"}
          </span>
          {connected ? (
            <Button variant="outline" size="sm" onClick={() => endSession()}>
              <PhoneOff aria-hidden /> End
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled={connectingVoice || sending} onClick={() => void startVoice()}>
              {connectingVoice ? <Spinner /> : <Mic aria-hidden />} Talk
            </Button>
          )}
        </div>
        <form className="flex gap-2" onSubmit={send}>
          <Input className="min-w-0" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message" aria-label="Message Signal Assistant" maxLength={500} />
          <Button type="submit" size="icon" aria-label="Send message to assistant" disabled={!text.trim() || connectingVoice || sending}>
            <Send aria-hidden />
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">Voice audio is processed by ElevenLabs.</p>
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
