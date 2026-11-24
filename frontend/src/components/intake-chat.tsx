"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Send } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";
import type { IntakeFields, IntakeMessage } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";

const fieldNames: Record<keyof IntakeFields, string> = {
  name: "Product name",
  description: "Description",
  capabilities: "Capabilities",
  constraints: "Constraints",
  customers_and_wins: "Customers and wins",
  pricing: "Pricing",
  contract_value: "Contract value",
};

export function IntakeChat({ product, onApply }: { product: IntakeFields; onApply: (proposal: IntakeFields) => void }) {
  const { mode, refresh } = useWorkspace();
  const [history, setHistory] = useState<IntakeMessage[]>([]);
  const [message, setMessage] = useState("");
  const [proposal, setProposal] = useState<IntakeFields>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef<HTMLLIElement>(null);

  useEffect(() => {
    latest.current?.scrollIntoView({ block: "nearest" });
  }, [history]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = message.trim();
    if (!input || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = mode === "sample"
        ? { reply: "Sample intake captured your text for the form. Add pricing, constraints, and customer wins in the form.", proposal: { description: input } }
        : await api.intakeChat({ ...product, ...proposal }, history.slice(-12), input);
      const updated = Object.fromEntries(Object.entries(result.proposal).filter(([, value]) => value != null));
      setProposal((previous) => ({ ...previous, ...updated }));
      setHistory((previous) => [...previous, { role: "user", text: input }, { role: "assistant", text: result.reply }]);
      setMessage("");
    } catch (error) {
      setError(error instanceof ApiError ? error.message : "Signal couldn't process that message. Try again.");
      if (error instanceof ApiError && error.status === 401) await refresh();
    } finally {
      setBusy(false);
    }
  }

  const proposedFields = (Object.keys(fieldNames) as (keyof IntakeFields)[]).filter((key) => proposal[key] != null);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {history.length ? (
        <ScrollArea className="h-64">
          <ol role="log" aria-label="Intake conversation" className="flex flex-col gap-3 pr-3">
            {history.map((turn, index) => (
              <li key={index} ref={index === history.length - 1 ? latest : undefined} className={cn("rounded-lg border p-3", turn.role === "user" && "bg-muted")}>
                <span className="text-xs font-semibold text-muted-foreground">{turn.role === "user" ? "You" : "Signal"}</span>
                <p className="text-sm whitespace-pre-wrap break-words">{turn.text}</p>
              </li>
            ))}
          </ol>
        </ScrollArea>
      ) : (
        <p className="text-sm text-muted-foreground">Describe your product, who buys it, and any pricing or constraints. You can review suggested values before adding them to the form.</p>
      )}

      <form onSubmit={submit}>
        <FieldGroup className="gap-3">
          <Field>
            <FieldLabel htmlFor="intake-message">Tell us about your product</FieldLabel>
            <Textarea id="intake-message" rows={3} maxLength={2000} value={message} onChange={(event) => setMessage(event.target.value)} disabled={busy} />
          </Field>
          <Button type="submit" className="self-end" disabled={busy || !message.trim()}>
            {busy ? <Spinner data-icon="inline-start" /> : <Send data-icon="inline-start" />}
            {busy ? "Sending…" : "Send message"}
          </Button>
        </FieldGroup>
      </form>

      {error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertTitle>Intake message failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {proposedFields.length ? (
        <section aria-labelledby="intake-proposal" className="flex flex-col gap-3 rounded-lg border p-4">
          <h3 id="intake-proposal" className="font-semibold">Suggested form values</h3>
          <dl className="flex flex-col gap-2 text-sm">
            {proposedFields.map((key) => {
              const value = proposal[key];
              return (
                <div key={key}>
                  <dt className="text-muted-foreground">{fieldNames[key]}</dt>
                  <dd className="break-words">{Array.isArray(value) ? value.join(" · ") || "Clear this field" : value}</dd>
                </div>
              );
            })}
          </dl>
          <Button variant="outline" className="self-start" disabled={busy} onClick={() => { onApply(proposal); setProposal({}); }}>
            Apply to form
          </Button>
        </section>
      ) : null}
    </div>
  );
}
