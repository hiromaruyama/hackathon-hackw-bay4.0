import { AppShell } from "@/components/app-shell";
import { AgentChat } from "@/components/voice-assistant";

export default function ChatPage() {
  return (
    <AppShell>
      <section aria-labelledby="agent-chat-title" className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-4">
        <h1 id="agent-chat-title" className="text-[22px] leading-tight font-bold">Signal Agent</h1>
        <AgentChat fullPage />
      </section>
    </AppShell>
  );
}
