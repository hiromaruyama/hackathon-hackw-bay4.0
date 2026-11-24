"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "./api";
import { sampleWorkspace } from "./fixture";
import { simulate } from "./sample-actions";
import type { Account, IcpApproveInput, IcpGenerateInput, PipelineChange, Signal, Workspace } from "./types";

export type DataMode = "live" | "sample";
type LoadStatus = "loading" | "ready" | "error" | "signin";

export const SAMPLE_MODE = process.env.NEXT_PUBLIC_SAMPLE_DATA === "1";
const SAMPLE_KEY = "signal-sample-workspace-v1";

type StoredSample = Omit<Workspace, "accounts"> & {
  accounts: (Omit<Account, "negative_signal"> & { negative_signal: Account["negative_signal"] | Signal })[];
};

// Sample mode keeps its state for this browser tab so reloads and direct links continue the demo.
function loadSample(): Workspace {
  try {
    const saved = sessionStorage.getItem(SAMPLE_KEY);
    if (saved) {
      const snapshot = JSON.parse(saved) as StoredSample;
      return {
        ...snapshot,
        accounts: snapshot.accounts.map((account) => {
          const risk = account.negative_signal;
          const negative_signal = risk && "summary" in risk
            ? { reason: risk.summary, evidence_id: risk.evidence_id ?? "", hard_exclusion: risk.kind === "exclusion" }
            : risk;
          return { ...account, negative_signal };
        }),
      };
    }
  } catch {
    // Storage can be unavailable (private mode); fall back to the fixture.
  }
  return structuredClone(sampleWorkspace);
}

function saveSample(w: Workspace) {
  try {
    sessionStorage.setItem(SAMPLE_KEY, JSON.stringify(w));
  } catch {
    // Not critical: the demo still works without persistence.
  }
}

interface ActionResult {
  ok: boolean;
  error?: ApiError;
}

interface WorkspaceState {
  mode: DataMode;
  status: LoadStatus;
  workspace: Workspace | null;
  loadError: ApiError | null;
  pending: string | null;
  refresh: () => Promise<void>;
  signIn: (password: string) => Promise<ActionResult>;
  generateIcp: (input: IcpGenerateInput) => Promise<ActionResult>;
  approveIcp: (input: IcpApproveInput) => Promise<ActionResult>;
  discover: (refresh?: boolean, deeperSources?: boolean) => Promise<ActionResult>;
  discoverMore: () => Promise<ActionResult>;
  enrichAccount: (accountId: string) => Promise<ActionResult>;
  writeDraft: (accountId: string) => Promise<ActionResult>;
  writeSequence: (accountId: string) => Promise<ActionResult>;
  saveDraft: (draftId: string, expected: number, subject: string, body: string) => Promise<ActionResult>;
  review: (draftId: string, revision: number, decision: "approve" | "reject") => Promise<ActionResult>;
  send: (draftId: string, revision: number) => Promise<ActionResult>;
  schedule: (draftId: string, revision: number, scheduledAt: string | null) => Promise<ActionResult>;
  prepareLinkedIn: (draftId: string, revision: number) => Promise<ActionResult>;
  moveLead: (accountId: string, change: PipelineChange) => Promise<ActionResult>;
  syncFeedback: () => Promise<ActionResult>;
}

const Ctx = createContext<WorkspaceState | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const mode: DataMode = SAMPLE_MODE ? "sample" : "live";
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const latest = useRef<Workspace | null>(null);
  useEffect(() => {
    latest.current = workspace;
  }, [workspace]);

  const refresh = useCallback(async () => {
    if (SAMPLE_MODE) {
      setWorkspace((w) => w ?? loadSample());
      setStatus("ready");
      return;
    }
    try {
      const ws = await api.workspace();
      setWorkspace(ws);
      setLoadError(null);
      setStatus("ready");
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, "unknown", "Couldn't load the workspace.");
      if (err.status === 401) {
        setStatus("signin");
        return;
      }
      setLoadError(err);
      // Keep the last saved view visible if we already have one.
      setStatus((s) => (s === "ready" ? "ready" : "error"));
    }
  }, []);

  useEffect(() => {
    // Initial load from the server (or the sample fixture).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const run = useCallback(
    async (key: string, live: () => Promise<Workspace>, sample: (w: Workspace) => Workspace, done?: string): Promise<ActionResult> => {
      setPending(key);
      try {
        if (SAMPLE_MODE) {
          await new Promise((r) => setTimeout(r, 450));
          if (latest.current) {
            // Runs outside the state updater so sample-mode conflicts reach the catch below.
            const next = sample(structuredClone(latest.current));
            saveSample(next);
            latest.current = next;
            setWorkspace(next);
          }
        } else {
          setWorkspace(await live());
        }
        if (done) toast.success(done);
        return { ok: true };
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError(0, "unknown", "Something went wrong. Try again.");
        if (err.status === 401) setStatus("signin");
        if (err.status === 409) {
          toast.warning("This changed since you loaded it. Showing the latest version.");
          await refresh();
        }
        if (err.status === 402) await refresh();
        return { ok: false, error: err };
      } finally {
        setPending(null);
      }
    },
    [refresh],
  );

  const value = useMemo<WorkspaceState>(
    () => ({
      mode,
      status,
      workspace,
      loadError,
      pending,
      refresh,
      signIn: async (password) => {
        try {
          await api.signIn(password);
          setStatus("loading");
          await refresh();
          return { ok: true };
        } catch (e) {
          return { ok: false, error: e instanceof ApiError ? e : undefined };
        }
      },
      generateIcp: (input) =>
        run("icp-generate", () => api.generateIcp(input), (w) => simulate.generateIcp(w, input), "Profile generated"),
      approveIcp: (input) =>
        run("icp-approve", () => api.approveIcp(input), (w) => simulate.approveIcp(w, input), `Profile revision ${input.revision + 1} approved`),
      discover: (refreshResults = false, deeperSources = false) =>
        run(
          "discover",
          () => api.discover(workspace?.approved_icp_revision ?? 0, refreshResults, deeperSources),
          (w) => simulate.discover(w),
          "Accounts saved",
        ),
      discoverMore: () => run("discover-more", () => api.discoverMore(workspace?.approved_icp_revision ?? 0), (w) => w, "Search complete"),
      enrichAccount: (accountId) => run(`enrich-${accountId}`, () => api.enrichAccount(accountId), (w) => w),
      writeDraft: (accountId) => run(`draft-${accountId}`, () => api.draft(accountId), (w) => simulate.draft(w, accountId), "Draft written"),
      writeSequence: (accountId) => run("sequence", () => api.sequence(accountId), (w) => w, "Follow-up drafts saved"),
      saveDraft: (draftId, expected, subject, body) =>
        run("draft-save", () => api.saveDraft(draftId, expected, subject, body), (w) => simulate.saveDraft(w, draftId, expected, subject, body), `Saved as revision ${expected + 1}`),
      review: (draftId, revision, decision) =>
        run(
          `review-${decision}`,
          () => api.review(draftId, revision, decision),
          (w) => simulate.review(w, draftId, revision, decision),
          decision === "approve" ? `Revision ${revision} approved` : `Revision ${revision} rejected`,
        ),
      send: (draftId, revision) => run("send", () => api.send(draftId, revision), (w) => simulate.send(w, draftId, revision)),
      schedule: (draftId, revision, scheduledAt) => run("schedule", () => api.schedule(draftId, revision, scheduledAt), (w) => w, "Schedule saved"),
      prepareLinkedIn: (draftId, revision) => run("linkedin-handoff", () => api.prepareLinkedIn(draftId, revision), (w) => w),
      moveLead: (accountId, change) => run("move-lead", () => api.moveLead(accountId, change), (w) => w, "Lead updated"),
      syncFeedback: () => run("sync-feedback", api.syncFeedback, (w) => w, "Gmail feedback checked"),
    }),
    [mode, status, workspace, loadError, pending, refresh, run],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx;
}
