import type { Account, Draft, EnrichmentStatus, Recommendation, Stage, Workspace } from "./types";

const TZ = "America/Los_Angeles";

export function time(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function dateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

// Dates without a time (YYYY-MM-DD) render as calendar dates, not shifted by timezone.
export function day(value: string | null | undefined) {
  if (!value) return "Undated";
  const d = value.length === 10 ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(d);
}

export function percent(rate: number | null | undefined) {
  if (rate === null || rate === undefined) return "—";
  return `${Math.round(rate * 100)}%`;
}

export const verdictLabel: Record<Recommendation, string> = { contact: "Contact", hold: "Hold", reject: "Reject" };

export const verdictClass: Record<Recommendation, string> = {
  contact: "text-success",
  hold: "text-warning",
  reject: "text-destructive",
};

export const verdictDot: Record<Recommendation, string> = {
  contact: "bg-success",
  hold: "bg-warning",
  reject: "bg-destructive",
};

export const stageLabel: Record<Stage, string> = {
  matched: "Matched",
  contacted: "Contacted",
  replied: "Replied",
  meeting_booked: "Meeting booked",
  closed_lost: "Closed or lost",
};

export const stages: Stage[] = ["matched", "contacted", "replied", "meeting_booked", "closed_lost"];

export function enrichmentText(status: EnrichmentStatus, verification?: string | null, recommendation?: Recommendation) {
  switch (status) {
    case "verified":
      return { text: "Hunter: verified", tone: "text-success" };
    case "uncertain":
      return { text: `Hunter: not verified${verification ? ` (${verification.replace(/_/g, "-")})` : ""}`, tone: "text-warning" };
    case "not_found":
      return { text: "Hunter: no contact found", tone: "text-warning" };
    case "failed":
      return { text: "Hunter lookup failed", tone: "text-destructive" };
    default:
      return { text: recommendation === "reject" ? "Lookup skipped" : "Lookup needed", tone: "text-muted-foreground" };
  }
}

export function actorLabel(actor: string) {
  if (actor === "demo") return "Demo rep";
  if (actor === "system") return "Signal";
  return actor;
}

export function sourceTypeLabel(t: string) {
  return t.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function draftStateText(d: Draft) {
  if (d.review_status === "writing_only") return `Writing only · Revision ${d.revision}`;
  if (d.prepared_at) return `Revision ${d.revision} ready in LinkedIn`;
  if (d.dispatch_status === "sent") return `Revision ${d.revision} sent to the test inbox`;
  if (d.dispatch_status === "pending_outcome") return `Revision ${d.revision} send outcome needs checking`;
  if (d.dispatch_status === "failed") return `Revision ${d.revision} send failed`;
  if (d.review_status === "approved") return `Revision ${d.revision} approved, ready to send`;
  if (d.review_status === "rejected") return `Revision ${d.revision} rejected`;
  return `Revision ${d.revision} waiting for your approval`;
}

export type NextAction = { title: string; detail: string; href: string; cta: string; secondary?: { href: string; label: string } };

// The single most useful next step, derived from saved state.
export function nextAction(w: Workspace): NextAction {
  if (!w.icp) {
    return { title: "Describe what you sell to get started", detail: "Signal turns your product details into a customer profile you can edit and approve.", href: "/profile/", cta: "Open customer profile" };
  }
  if (!w.approved_icp_revision || !w.icp.approved) {
    return { title: "Approve your customer profile", detail: `Revision ${w.icp.revision} is a draft. Accounts are found only from an approved profile.`, href: "/profile/", cta: "Review profile" };
  }
  if (w.accounts.length === 0) {
    return { title: "Find accounts that match your profile", detail: `Searches public sources using profile revision ${w.approved_icp_revision}. Up to six accounts, each with cited sources.`, href: "/accounts/", cta: "Find accounts" };
  }
  const withDraft = w.accounts.filter((a) => a.draft);
  const pick = (pred: (a: Account) => boolean) => withDraft.find(pred);
  const unresolved = pick((a) => a.draft!.dispatch_status === "pending_outcome");
  if (unresolved) {
    return { title: `Check whether ${unresolved.name}'s email arrived`, detail: "Gmail didn't confirm the send. Sending stays locked until the outcome is checked.", href: `/outreach/?account=${unresolved.id}`, cta: "Open outreach" };
  }
  const approved = pick((a) => a.draft!.review_status === "approved" && a.draft!.dispatch_status === "not_sent");
  if (approved) {
    return { title: `Send the approved email to ${approved.name}`, detail: `Revision ${approved.draft!.revision} is approved. It goes to the controlled test inbox, not the prospect.`, href: `/outreach/?account=${approved.id}`, cta: "Open outreach" };
  }
  const pending = pick((a) => a.draft!.review_status === "pending_review");
  if (pending) {
    return {
      title: `${pending.name} is ready for outreach`,
      detail: `Revision ${pending.draft!.revision} of the draft needs your approval before the test email can go out. Fit ${pending.fit_score}, intent ${pending.intent_score}, ${pending.evidence.length} sources.`,
      href: `/outreach/?account=${pending.id}`,
      cta: "Review draft",
      secondary: { href: `/accounts/view/?id=${pending.id}`, label: "Open account" },
    };
  }
  const contactable = w.accounts.find((a) => a.recommendation === "contact" && !a.draft);
  if (contactable) {
    return { title: `Write a draft for ${contactable.name}`, detail: "Signal looks up one contact, queries the graph and drafts a short email from cited sources.", href: `/accounts/view/?id=${contactable.id}`, cta: "Open account" };
  }
  const sent = pick((a) => a.draft!.dispatch_status === "sent");
  if (sent) {
    return { title: `${sent.name} moved to Contacted`, detail: "The test email was confirmed by Gmail and the pipeline was updated once.", href: "/pipeline/", cta: "Open pipeline" };
  }
  return { title: "No account is ready to contact", detail: "Every account is on hold or rejected. Refine the profile or search again.", href: "/accounts/", cta: "Open accounts" };
}
