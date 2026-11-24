import { AppShell } from "@/components/app-shell";
import { SignalAssistantChat } from "@/components/voice-assistant";

export default function HomePage() {
  return (
    <AppShell>
      <section aria-labelledby="assistant-title" className="flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-background">
        <header className="shrink-0 border-b px-5 py-4">
          <div className="mx-auto w-full max-w-3xl">
            <h1 id="assistant-title" className="text-xl font-semibold tracking-tight">Signal Assistant</h1>
            <p className="mt-1 text-sm text-muted-foreground">Ask about accounts, evidence, and pipeline activity.</p>
          </div>
        </header>
        <SignalAssistantChat />
      </section>
    </AppShell>
  );
}
