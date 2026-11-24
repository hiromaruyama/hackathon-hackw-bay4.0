"use client";

import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { IntakeChat } from "@/components/intake-chat";
import { InlineAlert, Panel, PanelHeader } from "@/components/signal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field as FormField, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/lib/workspace-context";
import { dateTime } from "@/lib/format";
import type { ExpansionDecision, IcpFieldKey, IcpFields, IndustryCode, IntakeFields } from "@/lib/types";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function ProfilePage() {
  return (
    <AppShell>
      <Profile />
    </AppShell>
  );
}

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);
const join = (a: string[] | undefined) => (a ?? []).join("\n");

const FIELD_META: { key: IcpFieldKey; label: string; list: boolean; hint?: string }[] = [
  { key: "industries", label: "Industries", list: true },
  { key: "industry_codes", label: "Industry codes", list: true, hint: "One per line, for example NAICS 221114 or SIC 4911" },
  { key: "geography", label: "Geography", list: true },
  { key: "headcount_band", label: "Headcount", list: false, hint: "For example, 50–500" },
  { key: "revenue_band", label: "Revenue", list: false },
  { key: "buyer_titles", label: "Buyer titles", list: true },
  { key: "seniority", label: "Seniority", list: true },
  { key: "triggers", label: "Buying triggers", list: true },
  { key: "exclusions", label: "Exclusions", list: true, hint: "A confirmed exclusion rejects the account" },
];

type FieldDraft = Record<IcpFieldKey, string>;

function toDraft(f: IcpFields): FieldDraft {
  return {
    industries: join(f.industries),
    industry_codes: join(f.industry_codes?.map((entry) => `${entry.system} ${entry.code}`)),
    geography: join(f.geography),
    headcount_band: f.headcount_band ?? "",
    revenue_band: f.revenue_band ?? "",
    buyer_titles: join(f.buyer_titles),
    seniority: join(f.seniority),
    triggers: join(f.triggers),
    exclusions: join(f.exclusions),
  };
}

function fromDraft(d: FieldDraft): IcpFields {
  return {
    industries: lines(d.industries),
    industry_codes: lines(d.industry_codes).map((line) => {
      const [system, code] = line.toUpperCase().split(/\s+/);
      return { system: system as IndustryCode["system"], code };
    }),
    geography: lines(d.geography),
    headcount_band: d.headcount_band.trim() || null,
    revenue_band: d.revenue_band.trim() || null,
    buyer_titles: lines(d.buyer_titles),
    seniority: lines(d.seniority),
    triggers: lines(d.triggers),
    exclusions: lines(d.exclusions),
  };
}

function Profile() {
  const { workspace, generateIcp, approveIcp, pending } = useWorkspace();
  const w = workspace!;
  const p = w.product;

  const [intake, setIntake] = useState({
    name: p?.name ?? "GeoFlow",
    description: p?.description ?? "",
    capabilities: join(p?.capabilities),
    constraints: join(p?.constraints),
    customers: join(p?.customers_and_wins),
    pricing: p?.pricing ?? "",
    contract: p?.contract_value ?? "",
  });
  const [intakeError, setIntakeError] = useState<string | null>(null);
  const [genError, setGenError] = useState<ApiError | null>(null);
  const [intakeTab, setIntakeTab] = useState("form");

  const icp = w.icp;
  const [fields, setFields] = useState<FieldDraft | null>(icp ? toDraft(icp.fields) : null);
  const [decision, setDecision] = useState<ExpansionDecision>(icp?.expansion_decision ?? "dismiss");
  const [segment, setSegment] = useState(icp?.expansion?.segment ?? "");
  const [approveError, setApproveError] = useState<ApiError | null>(null);

  // Reset the editor whenever the server returns a new revision.
  const [seenRevision, setSeenRevision] = useState(icp?.revision);
  if (icp && icp.revision !== seenRevision) {
    setSeenRevision(icp.revision);
    setFields(toDraft(icp.fields));
    setDecision(icp.expansion_decision ?? (icp.expansion ? "accept" : "dismiss"));
    setSegment(icp.expansion?.segment ?? "");
  }

  const dirty = Boolean(icp && fields && (
    JSON.stringify(fromDraft(fields)) !== JSON.stringify(fromDraft(toDraft(icp.fields))) ||
    (icp.approved && icp.expansion && (decision !== icp.expansion_decision || (decision === "edit" && segment.trim() !== icp.expansion.segment)))
  ));
  const intakeValues = {
    name: intake.name.trim() || "GeoFlow",
    description: intake.description.trim(),
    capabilities: lines(intake.capabilities),
    constraints: lines(intake.constraints),
    customers_and_wins: lines(intake.customers),
    pricing: intake.pricing.trim() || null,
    contract_value: intake.contract.trim() || null,
  };

  async function onGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!intakeValues.description) {
      setIntakeError("Describe what you sell first.");
      return;
    }
    setGenError(null);
    const res = await generateIcp(intakeValues);
    if (!res.ok) setGenError(res.error ?? null);
  }

  function applyIntake(proposal: IntakeFields) {
    setIntake((current) => ({
      name: proposal.name ?? current.name,
      description: proposal.description ?? current.description,
      capabilities: proposal.capabilities ? join(proposal.capabilities) : current.capabilities,
      constraints: proposal.constraints ? join(proposal.constraints) : current.constraints,
      customers: proposal.customers_and_wins ? join(proposal.customers_and_wins) : current.customers,
      pricing: proposal.pricing ?? current.pricing,
      contract: proposal.contract_value ?? current.contract,
    }));
    setIntakeError(null);
    setGenError(null);
    setIntakeTab("form");
  }

  async function onApprove() {
    if (!icp || !fields) return;
    if (lines(fields.industry_codes).some((line) => !/^(NAICS|SIC)\s+[0-9]{2,6}(?:-[0-9]{2})?$/i.test(line))) {
      setApproveError(new ApiError(422, "invalid_industry_code", "Use one industry code per line, such as NAICS 221114 or SIC 4911."));
      return;
    }
    setApproveError(null);
    const res = await approveIcp({
      revision: icp.revision,
      fields: fromDraft(fields),
      expansion_decision: decision,
      ...(decision === "edit" ? { expansion_segment: segment.trim() } : {}),
    });
    if (!res.ok) setApproveError(res.error ?? null);
  }

  const set = (k: keyof typeof intake) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setIntake((s) => ({ ...s, [k]: e.target.value }));
    if (k === "description") setIntakeError(null);
  };

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] leading-tight font-bold">Product and target buyers</h1>
        <p className="text-muted-foreground">
          {icp
            ? icp.approved
              ? `Revision ${icp.revision} approved ${dateTime(icp.updated_at)}. Discovery uses this revision.`
              : `Revision ${icp.revision} is a draft. Edit anything, then approve it to find accounts.`
            : "Describe what you sell in chat or in the form. Review the proposed profile before discovering accounts."}
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Panel aria-labelledby="intake-title">
          <PanelHeader title="Your product" id="intake-title" />
          <Tabs value={intakeTab} onValueChange={setIntakeTab} className="gap-4">
            <TabsList aria-label="Product intake">
              <TabsTrigger value="form">Form</TabsTrigger>
              <TabsTrigger value="chat">Intake chat</TabsTrigger>
            </TabsList>
            <TabsContent value="chat" forceMount className="data-[state=inactive]:hidden">
              <IntakeChat product={{ ...intakeValues, description: intakeValues.description || null }} onApply={applyIntake} />
            </TabsContent>
            <TabsContent value="form">
              <form onSubmit={onGenerate}>
                <FieldGroup className="gap-4">
                  <Field id="name" label="Product name">
                    <Input id="name" value={intake.name} onChange={set("name")} maxLength={250} />
                  </Field>
                  <Field id="description" label="Description" error={intakeError}>
                    <Textarea id="description" rows={3} value={intake.description} onChange={set("description")} aria-invalid={intakeError ? true : undefined} aria-describedby={intakeError ? "description-error" : undefined} maxLength={4000} placeholder="Site analysis software for US renewable energy developers." />
                  </Field>
                  <Field id="capabilities" label="Capabilities" hint="One per line">
                    <Textarea id="capabilities" rows={3} value={intake.capabilities} onChange={set("capabilities")} />
                  </Field>
                  <Field id="constraints" label="Constraints" hint="One per line">
                    <Textarea id="constraints" rows={2} value={intake.constraints} onChange={set("constraints")} />
                  </Field>
                  <Field id="customers" label="Customers and wins" hint="One per line">
                    <Textarea id="customers" rows={2} value={intake.customers} onChange={set("customers")} />
                  </Field>
                  <FieldGroup className="grid gap-4 sm:grid-cols-2">
                    <Field id="pricing" label="Pricing">
                      <Input id="pricing" value={intake.pricing} onChange={set("pricing")} maxLength={250} />
                    </Field>
                    <Field id="contract" label="Contract value">
                      <Input id="contract" value={intake.contract} onChange={set("contract")} maxLength={250} />
                    </Field>
                  </FieldGroup>
                  {genError ? (
                    <InlineAlert tone="danger" title="The profile wasn't generated">
                      {genError.message}
                    </InlineAlert>
                  ) : null}
                  <Button type="submit" variant={icp ? "outline" : "default"} className="self-end" disabled={pending === "icp-generate"}>
                    {pending === "icp-generate" ? <Spinner data-icon="inline-start" /> : null}
                    {pending === "icp-generate" ? "Generating…" : icp ? "Generate a new revision" : "Generate profile"}
                  </Button>
                </FieldGroup>
              </form>
            </TabsContent>
          </Tabs>
        </Panel>

        <Panel aria-labelledby="icp-title">
          <PanelHeader title={icp ? `Ideal customer profile, revision ${icp.revision}` : "Ideal customer profile"} id="icp-title">
            {icp ? (
              <span className={cn("text-sm font-semibold", icp.approved && !dirty ? "text-success" : "text-warning")}>
                {icp.approved && !dirty ? "Approved" : dirty ? "Edited, not approved" : "Draft"}
              </span>
            ) : null}
          </PanelHeader>

          {!icp || !fields ? (
            <div className="flex flex-col items-start gap-2 py-10">
              <span className="text-lg font-bold">No profile yet</span>
              <span className="max-w-[48ch] text-muted-foreground">Fill in what you sell and generate a profile. You'll be able to edit every field before approving it.</span>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                {FIELD_META.map((m) => {
                  const conf = icp.confidence[m.key];
                  const empty = !fields[m.key].trim();
                  return (
                    <Field
                      key={m.key}
                      id={`f-${m.key}`}
                      label={m.label}
                      hint={empty ? "Unknown. Leave blank if you don't know." : m.hint ?? (m.list ? "One per line" : undefined)}
                      aside={conf !== undefined ? <span className="text-xs text-muted-foreground tabular-nums">Confidence {conf.toFixed(1)}</span> : null}
                    >
                      {m.list ? (
                        <Textarea id={`f-${m.key}`} rows={2} value={fields[m.key]} onChange={(e) => setFields({ ...fields, [m.key]: e.target.value })} />
                      ) : (
                        <Input id={`f-${m.key}`} value={fields[m.key]} placeholder="Unknown" onChange={(e) => setFields({ ...fields, [m.key]: e.target.value })} />
                      )}
                    </Field>
                  );
                })}
              </div>

              {icp.fields.industry_codes?.length ? (
                <ul aria-label="Recognized industry codes" className="flex flex-col gap-2">
                  {icp.fields.industry_codes.map((entry) => (
                    <li key={`${entry.system}-${entry.code}`} className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge variant="outline">{entry.system} {entry.code}</Badge>
                      <span>{entry.title}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="rounded-md border p-4">
                <h3 className="font-semibold">Adjacent segment</h3>
                {icp.expansion ? (
                  <div className="mt-2 flex flex-col gap-3">
                    <p>
                      <span className="font-semibold">{icp.expansion.segment}</span>
                      <span className="text-muted-foreground"> {icp.expansion.reason}</span>
                    </p>
                    <a className="text-sm" href={icp.expansion.evidence.url} target="_blank" rel="noreferrer noopener">
                      {icp.expansion.evidence.title}
                    </a>
                    <div role="radiogroup" aria-label="Adjacent segment decision" className="flex flex-wrap gap-2">
                      {(["accept", "edit", "dismiss"] as const).map((d) => (
                        <Button key={d} type="button" role="radio" aria-checked={decision === d} variant={decision === d ? "default" : "outline"} size="sm" onClick={() => setDecision(d)}>
                          {d === "accept" ? "Accept" : d === "edit" ? "Edit" : "Dismiss"}
                        </Button>
                      ))}
                    </div>
                    {decision === "edit" ? (
                      <Field id="segment" label="Edited segment">
                        <Input id="segment" value={segment} onChange={(e) => setSegment(e.target.value)} />
                      </Field>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">No adjacent segment was suggested. Signal only suggests one when a public source supports it.</p>
                )}
              </div>

              {approveError ? (
                <InlineAlert tone="danger" title="The profile wasn't approved">
                  {approveError.message}
                </InlineAlert>
              ) : null}

              <div className="flex flex-wrap items-center justify-end gap-3">
                {icp.approved && !dirty ? <span className="text-sm text-muted-foreground">Edit a field to approve a new revision.</span> : null}
                <Button className="h-10 font-semibold" onClick={onApprove} disabled={pending === "icp-approve" || (icp.approved && !dirty) || (decision === "edit" && !segment.trim())}>
                  {pending === "icp-approve" ? <Spinner /> : null}
                  {pending === "icp-approve" ? "Approving…" : `Approve as revision ${icp.revision + 1}`}
                </Button>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

function Field({ id, label, hint, error, aside, children }: { id: string; label: string; hint?: string; error?: string | null; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <FormField className="gap-1.5" data-invalid={Boolean(error) || undefined}>
      <div className="flex items-baseline justify-between gap-2">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {aside}
      </div>
      {children}
      {error ? (
        <FieldError id={`${id}-error`}>{error}</FieldError>
      ) : hint ? (
        <FieldDescription>{hint}</FieldDescription>
      ) : null}
    </FormField>
  );
}
