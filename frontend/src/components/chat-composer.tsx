"use client";

import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { useConversationClientTool, useConversationControls, useConversationMode, useConversationStatus } from "@elevenlabs/react";
import { ArrowUp, Mic, Phone, PhoneOff, Square } from "lucide-react";
import { InlineAlert } from "@/components/signal";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";
import { useBrowserDictation } from "@/lib/use-browser-dictation";
import { cn } from "@/lib/utils";

type ComposerProps = {
  value: string;
  onChange: Dispatch<SetStateAction<string>>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onSend: (message: string) => void;
  onVoiceLine: (role: "user" | "agent", text: string) => void;
  getContext: () => unknown;
  sending: boolean;
  placeholder: string;
  label: string;
  maxLength: number;
  voiceEnabled?: boolean;
  callContext?: string;
};

export function ChatComposer({ value, onChange, inputRef, onSend, onVoiceLine, getContext, sending,
  placeholder, label, maxLength, voiceEnabled = true, callContext }: ComposerProps) {
  const { startSession, endSession, sendUserMessage, sendContextualUpdate } = useConversationControls();
  const { status } = useConversationStatus();
  const { isSpeaking } = useConversationMode();
  const [gettingSession, setGettingSession] = useState(false);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);
  const attempt = useRef<symbol | null>(null);
  useConversationClientTool("get_workspace_summary", () => JSON.stringify(getContext()));

  const { status: dictation, toggle } = useBrowserDictation((transcript) => {
    onChange((current) => [current.trimEnd(), transcript].filter(Boolean).join(" ").slice(0, maxLength));
    inputRef.current?.focus();
  }, (message) => setError({ title: "Dictation unavailable", message }));

  useEffect(() => () => {
    attempt.current = null;
    endSession();
  }, [endSession]);

  const connected = status === "connected";
  useEffect(() => {
    if (connected && callContext) sendContextualUpdate(callContext);
  }, [connected, callContext, sendContextualUpdate]);

  const connecting = gettingSession || status === "connecting";
  const dictating = dictation !== "idle";
  const busy = sending || connecting || dictating;
  const composerStatus = dictation === "starting" ? "Starting microphone…"
    : dictation === "listening" ? "Listening for dictation…"
    : dictation === "finishing" ? "Finishing dictation…"
    : connecting ? "Connecting voice…"
    : connected ? (isSpeaking ? "Signal is speaking…" : "Voice is listening…") : "";

  async function startCall() {
    if (attempt.current) return;
    const token = Symbol();
    attempt.current = token;
    setGettingSession(true);
    setError(null);
    try {
      const { signed_url } = await api.chatSession();
      if (attempt.current !== token) return;
      startSession({
        signedUrl: signed_url,
        onMessage: ({ message, role }) => {
          if (message?.trim()) onVoiceLine(role, message.trim());
        },
        onError: () => setError({ title: "Voice unavailable", message: "Couldn't connect to voice. You can still type below." }),
      });
    } catch (e) {
      if (attempt.current === token) {
        setError({ title: "Voice unavailable", message: e instanceof ApiError ? e.message : "Couldn't start voice. Try again." });
      }
    } finally {
      if (attempt.current === token) {
        setGettingSession(false);
        attempt.current = null;
      }
    }
  }

  function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = value.trim();
    if (!message || busy) return;
    setError(null);
    if (connected) {
      try {
        sendUserMessage(message);
        onVoiceLine("user", message);
      } catch {
        setError({ title: "Message failed", message: "Couldn't send that message to the call. Try again." });
        return;
      }
    } else {
      onSend(message);
    }
    onChange("");
  }

  return (
    <>
      {error ? <InlineAlert tone="danger" title={error.title}>{error.message}</InlineAlert> : null}
      <form className="rounded-2xl border border-input bg-card p-1.5 shadow-sm focus-within:border-ring" onSubmit={send}>
        <Textarea
          ref={inputRef} value={value} onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          rows={1} placeholder={placeholder} aria-label={label} maxLength={maxLength}
          className="max-h-36 min-h-10 resize-none border-0 bg-transparent px-2.5 py-2 shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <div className="flex items-center justify-between gap-2 px-0.5 pb-0.5">
          <span role="status" className="min-w-0 px-1.5 text-xs text-muted-foreground">{composerStatus}</span>
          <div className="flex shrink-0 items-center gap-1">
            <Button type="button" variant="ghost" size="icon" className={cn("size-9 rounded-full", dictating && "bg-accent text-accent-foreground")}
              aria-label={dictating ? "Stop dictation" : "Dictate message"} title={dictating ? "Stop dictation" : "Dictate with your browser's speech service"}
              disabled={connected || connecting || sending || dictation === "finishing"} onClick={() => { setError(null); toggle(); }}>
              {dictating ? <Square aria-hidden className="size-3.5 fill-current" /> : <Mic aria-hidden />}
            </Button>
            <Button type="button" variant="ghost" size="icon" className="size-9 rounded-full"
              aria-label={connected ? "End live voice chat" : "Start live voice chat"}
              title={!voiceEnabled ? "Calls are available in the live workspace" : connected ? "End call" : "Call through ElevenLabs"}
              disabled={busy || !voiceEnabled} onClick={() => connected ? endSession() : void startCall()}>
              {connecting ? <Spinner /> : connected ? <PhoneOff aria-hidden /> : <Phone aria-hidden />}
            </Button>
            <Button type="submit" size="icon" className="size-9 rounded-full" aria-label="Send message to assistant" disabled={!value.trim() || busy}>
              <ArrowUp aria-hidden />
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}
