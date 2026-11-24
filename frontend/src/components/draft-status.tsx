import { Badge } from "@/components/ui/badge";
import type { Draft } from "@/lib/types";
import { cn } from "@/lib/utils";

const attention = "bg-review-bg text-review-ink";
const success = "bg-success-bg text-success-ink";
const danger = "bg-danger-bg text-danger-ink";

export const draftStatuses = {
  review: { label: "Needs review", tone: attention },
  checking: { label: "Check send outcome", tone: attention },
  failed: { label: "Send failed", tone: danger },
  rejected: { label: "Rejected", tone: danger },
  approved: { label: "Approved", tone: success },
  prepared: { label: "Handoff ready", tone: success },
  sent: { label: "Sent", tone: success },
  none: { label: "No draft", tone: "bg-muted text-muted-foreground" },
};
export type DraftStatusKey = keyof typeof draftStatuses;

export function draftStatusKey(draft: Draft | null): DraftStatusKey {
  if (!draft) return "none";
  if (draft.dispatch_status === "pending_outcome") return "checking";
  if (draft.dispatch_status === "failed" || draft.dispatch_status === "sent") return draft.dispatch_status;
  if (draft.prepared_at) return "prepared";
  return draft.review_status === "pending_review" ? "review" : draft.review_status;
}

export function DraftStatus({ draft }: { draft: Draft | null }) {
  const status = draftStatuses[draftStatusKey(draft)];
  return <Badge variant="outline" className={cn("border-transparent", status.tone)}>{status.label}</Badge>;
}
