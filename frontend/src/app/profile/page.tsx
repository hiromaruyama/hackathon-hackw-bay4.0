"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ExternalLink, FilePenLine } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { IntakeChat } from "@/components/intake-chat";
import { focusBriefField, ProfileBriefEditor } from "@/components/profile-brief-editor";
import { InlineAlert } from "@/components/signal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  buyerInput, buyerKeys, buyerLabels, intakeEdits, productInput, productKeys, savedBrief, validateBrief,
  type Brief, type BriefKey,
} from "@/lib/profile-brief";
import type { ExpansionDecision, Icp, IntakeFields } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace-context";
import { dateTime } from "@/lib/format";

export default function ProfilePage() {
  return <AppShell fullWidth><Profile /></AppShell>;
}

function publicEvidenceLink(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if ((url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password) {
      return url.href;
    }
  } catch {
    return null;
  }
  return null;
}

function Profile() {
  const { workspace, generateIcp, approveIcp, pending } = useWorkspace();
  const { product, icp } = workspace!;
  const saved = useMemo(() => savedBrief(product, icp?.fields), [product, icp]);
  const revision = icp?.revision;
  const [tab, setTab] = useState("brief");
  const [edits, setEdits] = useState<Partial<Brief>>({});
  const [carry, setCarry] = useState<Partial<Brief> | null>(null);
  const [seenRevision, setSeenRevision] = useState(revision);
  const [decision, setDecision] = useState<ExpansionDecision>(icp?.expansion_decision ?? "dismiss");
  const [segment, setSegment] = useState(icp?.expansion?.segment ?? "");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<ReturnType<typeof validateBrief>>(null);

  if (revision !== seenRevision) {
    setSeenRevision(revision);
    setEdits(!icp?.approved && carry ? carry : {});
    setCarry(null);
    setFieldError(null);
    setDecision(icp?.expansion_decision ?? (icp?.expansion ? "accept" : "dismiss"));
    setSegment(icp?.expansion?.segment ?? "");
  }

  const brief = useMemo(() => ({ ...saved, ...edits }), [saved, edits]);
  const productChanged = productKeys.some((key) => brief[key].trim() !== saved[key].trim());
  const buyerChanged = buyerKeys.some((key) => brief[key].trim() !== saved[key].trim());
  const segmentChanged = Boolean(icp?.expansion && (decision !== (icp.expansion_decision ?? "dismiss") ||
    (decision === "edit" && segment.trim() !== icp.expansion.segment)));
  const dirty = productChanged || buyerChanged || segmentChanged;
  const generating = !icp || productChanged || (icp.approved && !dirty);
  const busy = pending === "icp-generate" || pending === "icp-approve";
  const status = dirty ? "Unsaved edits" : icp?.approved ? "Approved" : "Draft";

  function updateBrief(next: Brief) {
    setEdits(Object.fromEntries(Object.entries(next).filter(([key, value]) => value !== saved[key as BriefKey])));
    setError(null);
    setFieldError(null);
  }

  function applyProposal(proposal: IntakeFields) {
    updateBrief({ ...brief, ...intakeEdits(proposal) });
    setTab("brief");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const invalid = validateBrief(brief);
    setFieldError(invalid);
    if (invalid) {
      focusBriefField(invalid.key);
      return;
    }
    setError(null);
    if (generating) {
      // When both halves were edited, keep manual buyer changes over the generated suggestions.
      setCarry(Object.fromEntries(buyerKeys.filter((key) => brief[key] !== saved[key]).map((key) => [key, brief[key]])));
      const result = await generateIcp(productInput(brief));
      if (!result.ok) {
        setCarry(null);
        setError(result.error?.message ?? "Try generating the profile again.");
      }
    } else {
      const result = await approveIcp({
        revision: icp.revision, fields: buyerInput(brief), expansion_decision: decision,
        ...(decision === "edit" ? { expansion_segment: segment.trim() } : {}),
      });
      if (!result.ok) setError(result.error?.message ?? "Try approving this revision again.");
    }
  }

  const expansion = icp?.expansion;
  const source = publicEvidenceLink(expansion?.evidence.url);

  return (
    <div className="flex w-full min-w-0 flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[22px] leading-tight font-bold">Product and target buyers</h1>
        <div aria-live="polite" className="flex items-center gap-2">
          {icp && <span className="text-sm text-muted-foreground">Revision {icp.revision}</span>}
          <Badge variant="outline">
            <span aria-hidden className={status === "Approved" ? "size-1.5 rounded-full bg-success" : "size-1.5 rounded-full bg-warning"} />
            {status}
          </Badge>
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="gap-0">
        <div className="sticky top-0 z-10 grid grid-cols-[1fr_auto] items-center gap-x-1 gap-y-1 border-b bg-background py-2 sm:flex sm:flex-wrap sm:gap-x-3">
          <TabsList aria-label="Product intake">
            <TabsTrigger value="brief"><FilePenLine aria-hidden /> Brief</TabsTrigger>
            <TabsTrigger value="chat" disabled={busy}>Intake chat</TabsTrigger>
          </TabsList>
          {tab === "brief" && (
            <nav aria-label="Jump to section" className="col-span-2 row-start-2 flex gap-1">
              <Button type="button" size="sm" variant="ghost" aria-label="Jump to product" onClick={() => focusBriefField("name")}>Product</Button>
              <Button type="button" size="sm" variant="ghost" aria-label="Jump to target buyers" onClick={() => focusBriefField("industries")}>Target buyers</Button>
            </nav>
          )}
          {tab === "brief" && (
            <Button type="submit" form="profile-form" className="col-start-2 row-start-1 ml-auto" disabled={busy || (!generating && decision === "edit" && !segment.trim())}
              variant={icp?.approved && !dirty ? "outline" : "default"}>
              {busy && <Spinner data-icon="inline-start" />}
              {busy ? (pending === "icp-generate" ? "Generating…" : "Approving…") : generating
                ? (icp ? "New revision" : "Generate profile") : "Approve revision"}
            </Button>
          )}
          {tab === "brief" && fieldError && <FieldError id="brief-error" className="col-span-2 sm:basis-full">{fieldError.message}</FieldError>}
        </div>

        <TabsContent value="brief" forceMount className="data-[state=inactive]:hidden">
          <form id="profile-form" onSubmit={submit}>
            <FieldGroup className="gap-0">
              <ProfileBriefEditor value={brief} onChange={updateBrief} disabled={busy} invalidField={fieldError?.key} />

              {expansion && (
                <section aria-labelledby="adjacent-title" className="flex flex-col gap-2 border-t py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 id="adjacent-title" className="text-sm font-semibold">Adjacent segment</h2>
                    {source && <a href={source} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm" title={expansion.evidence.title} aria-label={`Source: ${expansion.evidence.title}`}>View source <ExternalLink aria-hidden className="size-3" /></a>}
                  </div>
                  <p className="text-sm"><strong>{expansion.segment}</strong> · {expansion.reason}</p>
                  {!source && <span className="text-sm text-muted-foreground">{expansion.evidence.title}</span>}
                  <div role="group" aria-label="Adjacent segment decision" className="flex flex-wrap gap-1">
                    {(["accept", "edit", "dismiss"] as const).map((value) => (
                      <Button type="button" key={value} size="sm" variant={decision === value ? "secondary" : "ghost"}
                        aria-pressed={decision === value} disabled={busy} onClick={() => setDecision(value)}>
                        {value === "accept" ? "Accept" : value === "edit" ? "Edit" : "Dismiss"}
                      </Button>
                    ))}
                  </div>
                  {decision === "edit" && (
                    <Field className="max-w-xl gap-1">
                      <FieldLabel htmlFor="segment">Edited segment <span aria-hidden className="text-destructive">*</span></FieldLabel>
                      <Input id="segment" required={!generating} aria-required="true" maxLength={250} value={segment} disabled={busy} onChange={(e) => setSegment(e.target.value)} />
                    </Field>
                  )}
                </section>
              )}
              {error && <InlineAlert tone="danger" title={generating ? "Generation failed" : "Approval failed"} className="my-4">{error}</InlineAlert>}
              {icp && <footer className="border-t py-4"><RevisionDetails icp={icp} /></footer>}
            </FieldGroup>
          </form>
        </TabsContent>
        <TabsContent value="chat" forceMount className="py-5 data-[state=inactive]:hidden">
          <IntakeChat product={{ ...productInput(brief), name: brief.name.trim() || null, description: brief.description.trim() || null }} onApply={applyProposal} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RevisionDetails({ icp }: { icp: Icp }) {
  return (
    <details className="group min-w-0 text-sm">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-muted-foreground [&::-webkit-details-marker]:hidden">
        Revision details <ChevronDown aria-hidden className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <span>{icp.approved ? "Approved" : "Generated"} {dateTime(icp.updated_at)}</span>
        {icp.fields.industry_codes?.map((entry) => <span key={`${entry.system}-${entry.code}`}>{entry.system} {entry.code} {entry.title}</span>)}
        <h3 className="font-medium">Field confidence</h3>
        <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1">
          {buyerKeys.map((key) => icp.confidence[key] === undefined ? null : (
            <div key={key} className="contents"><dt>{buyerLabels[key]}</dt><dd className="tabular-nums">{icp.confidence[key].toFixed(2)}</dd></div>
          ))}
        </dl>
      </div>
    </details>
  );
}
