"use client";

import { useEffect, useRef, useState } from "react";
import {
  ConversationProvider,
  useConversationClientTool,
  useConversationControls,
  useConversationMode,
  useConversationStatus,
} from "@elevenlabs/react";
import { Keyboard, MessageCircle, Mic, PhoneOff, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { InlineAlert } from "@/components/signal";
import { api, ApiError } from "@/lib/api";
import type { Workspace } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace-context";

// Signal Assistant: an ElevenLabs agent the founder can talk or type to.
// It is read-only by design. Its one tool returns what this page already shows (contacts masked),
// and it has no way to edit, approve, or send. The agent is private, so every session needs a
// short-lived signed URL from the authenticated backend route POST /api/chat/session.

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
            <SheetDescription>Talk or type. It answers from your workspace and can't edit, approve, or send.</SheetDescription>
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
  const [voice, setVoice] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextId = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);

  // The handler reads the latest workspace on every call.
  useConversationClientTool("get_workspace_summary", () => JSON.stringify(summarize(workspace)));

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [lines]);

  useEffect(() => () => endSession(), [endSession]);

  const connected = status === "connected";
  const busy = starting || status === "connecting";

  async function start(withVoice: boolean) {
    setError(null);
    setStarting(true);
    try {
      const { signed_url } = await api.chatSession();
      setVoice(withVoice);
      startSession({
        signedUrl: signed_url,
        textOnly: !withVoice,
        onMessage: ({ message, role }) => {
          if (!message) return;
          setLines((l) => [...l, { id: nextId.current++, role, text: message }]);
        },
        onError: (message) => setError(typeof message === "string" ? message : "The assistant hit an error. Try again."),
      });
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 405)) {
        setError("The assistant isn't connected on this server yet. The backend needs POST /api/chat/session.");
      } else if (e instanceof ApiError && e.status === 401) {
        setError("Sign in to use the assistant.");
      } else {
        setError(e instanceof ApiError ? e.message : "Couldn't start the assistant. Try again.");
      }
    } finally {
      setStarting(false);
    }
  }

  function send() {
    const msg = text.trim();
    if (!msg || !connected) return;
    setText("");
    // In voice mode the transcript arrives through onMessage; in text mode we add it ourselves.
    if (!voice) setLines((l) => [...l, { id: nextId.current++, role: "user", text: msg }]);
    sendUserMessage(msg);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4" aria-live="polite">
        {lines.length === 0 && !connected ? (
          <p className="text-sm text-muted-foreground">
            Ask why an account is a Contact, what evidence backs the draft, or where the pipeline stands.
          </p>
        ) : null}
        {lines.map((l) => (
          <div key={l.id} className="flex flex-col gap-1">
            <span className="text-[13px] text-muted-foreground">{l.role === "user" ? "You" : "Signal"}</span>
            <p className={l.role === "user" ? "rounded-md bg-muted px-3 py-2" : ""}>{l.text}</p>
          </div>
        ))}
        {error ? <InlineAlert tone="danger" title="Assistant unavailable">{error}</InlineAlert> : null}
        <div ref={endRef} />
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-t bg-card px-5 pt-3 pb-4">
        {connected ? (
          <>
            <div className="flex items-center justify-between text-[13px] text-muted-foreground">
              <span role="status">{voice ? (isSpeaking ? "Signal is speaking…" : "Listening… you can also type.") : "Text chat"}</span>
              <Button variant="outline" size="sm" onClick={() => endSession()}>
                <PhoneOff aria-hidden /> End
              </Button>
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message" aria-label="Message Signal Assistant" maxLength={500} />
              <Button type="submit" size="icon" aria-label="Send message to assistant" disabled={!text.trim()}>
                <Send aria-hidden />
              </Button>
            </form>
          </>
        ) : (
          <div className="flex gap-2">
            <Button className="flex-1" disabled={busy} onClick={() => void start(true)}>
              {busy ? <Spinner /> : <Mic aria-hidden />} Talk
            </Button>
            <Button variant="outline" className="flex-1" disabled={busy} onClick={() => void start(false)}>
              <Keyboard aria-hidden /> Type
            </Button>
          </div>
        )}
        <p className="text-xs text-muted-foreground">Voice sessions end after 5 minutes. Audio is processed by ElevenLabs.</p>
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
