import { ApiError } from "./api";
import { sampleWorkspace } from "./fixture";
import type { ActivityEvent, IcpApproveInput, IcpGenerateInput, Workspace } from "./types";

// Local stand-ins for the backend routes, used only when NEXT_PUBLIC_SAMPLE_DATA=1.
// They follow the same rules as the server so the UI can be exercised end to end:
// exact-revision edits and reviews, approval cleared by edits, one send per approved revision.

const now = () => new Date().toISOString();

function log(w: Workspace, e: Omit<ActivityEvent, "id" | "at">) {
  w.activity.unshift({ ...e, id: `local-${w.activity.length + 1}-${Date.now()}`, at: now() });
}

function findDraft(w: Workspace, draftId: string) {
  const account = w.accounts.find((a) => a.draft?.id === draftId);
  if (!account?.draft) throw new ApiError(404, "draft_not_found", "That draft no longer exists.");
  return { account, draft: account.draft };
}

function conflict(message: string): never {
  throw new ApiError(409, "revision_conflict", message);
}

export const simulate = {
  generateIcp(w: Workspace, input: IcpGenerateInput): Workspace {
    w.product = { id: "product-1", ...input };
    const base = w.icp ?? structuredClone(sampleWorkspace.icp!);
    w.icp = { ...base, revision: base.revision + 1, approved: false, updated_at: now() };
    log(w, { type: "icp_generated", actor: "system", account_id: null, draft_id: null, revision: w.icp.revision, message: `Proposed customer profile revision ${w.icp.revision}.` });
    return w;
  },

  approveIcp(w: Workspace, input: IcpApproveInput): Workspace {
    if (!w.icp || w.icp.revision !== input.revision) conflict("The profile changed since you opened it.");
    const revision = input.revision + 1;
    w.icp = { ...w.icp, revision, approved: true, fields: input.fields, expansion_decision: input.expansion_decision, updated_at: now() };
    w.approved_icp_revision = revision;
    log(w, { type: "icp_approved", actor: "demo", account_id: null, draft_id: null, revision, message: `Approved customer profile revision ${revision}.` });
    return w;
  },

  discover(w: Workspace): Workspace {
    if (!w.approved_icp_revision) throw new ApiError(422, "icp_not_approved", "Approve a customer profile first.");
    if (w.accounts.length === 0) w.accounts = structuredClone(sampleWorkspace.accounts);
    log(w, { type: "discovery_completed", actor: "system", account_id: null, draft_id: null, revision: w.approved_icp_revision, message: `Saved ${w.accounts.length} accounts from profile revision ${w.approved_icp_revision}.` });
    return w;
  },

  draft(w: Workspace, accountId: string): Workspace {
    const account = w.accounts.find((a) => a.id === accountId);
    if (!account) throw new ApiError(404, "account_not_found", "That account no longer exists.");
    if (account.recommendation !== "contact") throw new ApiError(422, "account_not_qualified", "Only accounts marked Contact can get a draft.");
    if (!account.draft) {
      account.draft = {
        id: `draft-${account.id}`,
        account_id: account.id,
        revision: 1,
        subject: `A question about ${account.name}'s site pipeline`,
        body: `Hi,\n\n${account.reason}\n\nGeoFlow helps development teams compare sites and interconnection constraints early.\n\nWould a short walkthrough be useful?`,
        test_recipient: "demo-inbox@geoflow.test",
        evidence_ids: account.evidence.map((e) => e.id),
        role_based: account.enrichment_status !== "verified",
        synthesis_mode: "claude",
        review_status: "pending_review",
        dispatch_status: "not_sent",
        updated_at: now(),
      };
      log(w, { type: "draft_generated", actor: "system", account_id: account.id, draft_id: account.draft.id, revision: 1, message: `Wrote a draft from ${account.evidence.length} sources.` });
    }
    return w;
  },

  saveDraft(w: Workspace, draftId: string, expected: number, subject: string, body: string): Workspace {
    const { account, draft } = findDraft(w, draftId);
    if (draft.revision !== expected) conflict("Someone saved a newer revision.");
    if (draft.dispatch_status === "pending_outcome") conflict("This draft is locked until the send outcome is checked.");
    const wasApproved = draft.review_status === "approved";
    Object.assign(draft, { revision: expected + 1, subject, body, review_status: "pending_review", dispatch_status: "not_sent", updated_at: now() });
    log(w, {
      type: "draft_edited",
      actor: "demo",
      account_id: account.id,
      draft_id: draftId,
      revision: draft.revision,
      message: wasApproved ? `Saved revision ${draft.revision}. The earlier approval no longer applies.` : `Saved revision ${draft.revision}.`,
    });
    return w;
  },

  review(w: Workspace, draftId: string, revision: number, decision: "approve" | "reject"): Workspace {
    const { account, draft } = findDraft(w, draftId);
    if (draft.revision !== revision) conflict("You can only review the current revision.");
    draft.review_status = decision === "approve" ? "approved" : "rejected";
    log(w, { type: `draft_${decision === "approve" ? "approved" : "rejected"}`, actor: "demo", account_id: account.id, draft_id: draftId, revision, message: `${decision === "approve" ? "Approved" : "Rejected"} revision ${revision}.` });
    return w;
  },

  send(w: Workspace, draftId: string, revision: number): Workspace {
    const { account, draft } = findDraft(w, draftId);
    if (draft.revision !== revision || draft.review_status !== "approved") conflict("Only the approved current revision can be sent.");
    if (draft.dispatch_status !== "not_sent") return w; // a repeat reads the saved attempt
    draft.dispatch_status = "sent";
    const lead = w.pipeline.leads.find((l) => l.account_id === account.id);
    const at = now();
    if (lead && lead.stage === "matched") {
      lead.stage = "contacted";
      lead.test_send = true;
      lead.actor = "demo";
      lead.updated_at = at;
      lead.next_action = "Wait for a reply";
      w.pipeline.counts.matched -= 1;
      w.pipeline.counts.contacted += 1;
      w.pipeline.events.unshift({ id: `pe-${Date.now()}`, account_id: account.id, from_stage: "matched", to_stage: "contacted", test_send: true, actor: "demo", at });
      const eligible = w.pipeline.leads.length;
      w.pipeline.matched_to_contacted_rate = eligible ? w.pipeline.counts.contacted / eligible : null;
      w.pipeline.pending_approval_count = Math.max(0, w.pipeline.pending_approval_count - 1);
    }
    log(w, { type: "draft_sent", actor: "demo", account_id: account.id, draft_id: draftId, revision, message: `Test email delivered for revision ${revision}. ${account.name} moved to Contacted.` });
    return w;
  },
};
