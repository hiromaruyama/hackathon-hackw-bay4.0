"use client";

import { useState } from "react";
import { EvidenceList, InlineAlert, Panel, PanelHeader } from "@/components/signal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { api, ApiError } from "@/lib/api";
import type { GraphInsight } from "@/lib/types";

const titles: Record<GraphInsight["kind"], string> = {
  employment: "Previous employer",
  education: "Education",
  warm_introduction: "Possible introduction",
  buying_evaluation: "Buying evaluation",
  renewal: "Vendor renewal",
  churn: "Vendor replacement",
};

export function GraphInsights({ accountId, hiddenKinds }: { accountId: string; hiddenKinds?: GraphInsight["kind"][] }) {
  const [items, setItems] = useState<GraphInsight[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visibleItems = items?.filter((item) => !hiddenKinds?.includes(item.kind));

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setItems(await api.graphInsights(accountId));
    } catch (error) {
      setError(error instanceof ApiError ? error.message : "Signal couldn't load the graph paths.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Panel aria-label="Research graph insights" className="flex flex-col gap-3">
      <PanelHeader title="Research graph insights">
        <Button variant="outline" size="sm" disabled={loading} onClick={() => void load()}>
          {loading ? <Spinner data-icon="inline-start" /> : null} {items ? "Refresh paths" : "Explore paths"}
        </Button>
      </PanelHeader>
      {error ? <InlineAlert tone="danger" title="Paths couldn't load">{error}</InlineAlert> : null}
      {items?.length === 0 ? <p className="text-sm text-muted-foreground">No sourced paths were found for this account.</p> : null}
      {items?.length && visibleItems?.length === 0 ? <p className="text-sm text-muted-foreground">No sourced paths match your category filters.</p> : null}
      {visibleItems?.map((item) => (
        <div key={`${item.kind}-${item.path.join("/")}`} className="flex min-w-0 flex-col gap-2 border-t pt-3">
          <Badge variant="secondary">{titles[item.kind]}</Badge>
          <p className="break-words text-sm font-medium">{item.path.join(" → ")}</p>
          {item.kind === "warm_introduction" ? <p className="text-sm text-muted-foreground">Public sources show a shared affiliation. Confirm an introduction with the person first.</p> : null}
          <EvidenceList evidence={item.evidence} numbered={false} />
        </div>
      ))}
    </Panel>
  );
}
