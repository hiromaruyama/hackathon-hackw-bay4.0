import type { GraphInsight, IcpApproveInput, IcpGenerateInput, IntakeFields, IntakeMessage, IntakeReply, PipelineChange, Workspace } from "./types";

// Same origin in production. For local dev against uvicorn, set NEXT_PUBLIC_API_BASE=http://localhost:8000
// and make the backend's SIGNAL_PUBLIC_ORIGIN match the Next dev origin.
const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      credentials: "include",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "network_error", "Signal's server didn't respond. Check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error;
    throw new ApiError(res.status, err?.code ?? "http_error", err?.message ?? `Request failed with status ${res.status}.`);
  }
  return data as T;
}

export const api = {
  session: () => request<{ actor: string }>("GET", "/api/session"),
  signIn: (password: string) => request<{ actor: string }>("POST", "/api/session", { password }),
  signOut: () => request<void>("DELETE", "/api/session"),
  workspace: () => request<Workspace>("GET", "/api/workspace"),
  intakeChat: (product: IntakeFields, history: IntakeMessage[], message: string) =>
    request<IntakeReply>("POST", "/api/intake/chat", { product, history, message }),
  generateIcp: (input: IcpGenerateInput) => request<Workspace>("POST", "/api/icp/generate", input),
  approveIcp: (input: IcpApproveInput) => request<Workspace>("POST", "/api/icp/approve", input),
  discover: (revision: number, refresh = false, deeper_sources = false) =>
    request<Workspace>("POST", "/api/discover", { revision, refresh, deeper_sources }),
  discoverMore: (revision: number) => request<Workspace>("POST", "/api/discover/more", { revision }),
  enrichAccount: (accountId: string) => request<Workspace>("POST", `/api/accounts/${encodeURIComponent(accountId)}/enrich`),
  draft: (accountId: string) => request<Workspace>("POST", `/api/accounts/${encodeURIComponent(accountId)}/draft`),
  graphInsights: (accountId: string) => request<GraphInsight[]>("GET", `/api/accounts/${encodeURIComponent(accountId)}/insights`),
  sequence: (accountId: string) => request<Workspace>("POST", `/api/accounts/${encodeURIComponent(accountId)}/sequence`),
  saveDraft: (draftId: string, expected_revision: number, subject: string, body: string) =>
    request<Workspace>("PATCH", `/api/drafts/${encodeURIComponent(draftId)}`, { expected_revision, subject, body }),
  review: (draftId: string, revision: number, decision: "approve" | "reject") =>
    request<Workspace>("POST", `/api/drafts/${encodeURIComponent(draftId)}/review`, { revision, decision }),
  send: (draftId: string, revision: number) =>
    request<Workspace>("POST", `/api/drafts/${encodeURIComponent(draftId)}/send`, { revision }),
  schedule: (draftId: string, revision: number, scheduled_at: string | null) =>
    request<Workspace>("POST", `/api/drafts/${encodeURIComponent(draftId)}/schedule`, { revision, scheduled_at }),
  prepareLinkedIn: (draftId: string, revision: number) =>
    request<Workspace>("POST", `/api/drafts/${encodeURIComponent(draftId)}/linkedin-handoff`, { revision }),
  moveLead: (accountId: string, change: PipelineChange) =>
    request<Workspace>("POST", `/api/pipeline/${encodeURIComponent(accountId)}/stage`, change),
  syncFeedback: () => request<Workspace>("POST", "/api/feedback/gmail/sync"),
  // Proposed route, not in the contract yet: returns a short-lived ElevenLabs signed URL for the
  // private Signal Assistant agent. JSON body so the backend's same-origin write checks apply.
  chatSession: () => request<{ signed_url: string }>("POST", "/api/chat/session", {}),
  // Proposed route, not in the contract yet. The UI shows "not available" on 404.
  ask: (accountId: string, question: string) =>
    request<AskAnswer>("POST", `/api/accounts/${encodeURIComponent(accountId)}/ask`, { question }),
};

export interface AskAnswer {
  answer: string;
  evidence_ids: string[];
  suggested_edit: { before: string; after: string } | null;
}
