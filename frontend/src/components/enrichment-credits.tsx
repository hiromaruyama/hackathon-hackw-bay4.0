import { AlertTriangle } from "lucide-react";
import { Panel, PanelHeader } from "@/components/signal";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dateTime, time } from "@/lib/format";
import type { UsageEvent, Workspace } from "@/lib/types";

const usageLabels: Record<UsageEvent["operation"], string> = {
  leads_enriched: "Lead enrichment",
  graph_query_evaluated: "Graph query",
  outreach_sent: "Outreach send",
};

const usageStatus: Record<UsageEvent["status"], string> = {
  pending: "Pending",
  accepted: "Accepted",
  blocked: "Blocked",
  failed: "Failed",
};

export function EnrichmentCredits({ usage, accounts }: {
  usage: NonNullable<Workspace["usage"]>;
  accounts: Workspace["accounts"];
}) {
  return (
    <Panel aria-labelledby="usage-title">
      <PanelHeader title="Enrichment credits" id="usage-title" />
      <dl className="grid gap-4 sm:grid-cols-3">
        <div><dt className="text-sm text-muted-foreground">Balance</dt><dd className="text-[30px] leading-tight font-semibold tabular-nums">{usage.balance ?? "Unknown"}</dd></div>
        <div><dt className="text-sm text-muted-foreground">Available for enrichment</dt><dd className="text-[30px] leading-tight font-semibold tabular-nums">{usage.available_for_enrichment ?? "Unknown"}</dd></div>
        <div><dt className="text-sm text-muted-foreground">Checked</dt><dd className="text-[30px] leading-tight font-semibold">{time(usage.checked_at)}</dd></div>
      </dl>
      {usage.status === "blocked" ? (
        <Alert variant="destructive" className="mt-4">
          <AlertTriangle aria-hidden />
          <AlertTitle>Enrichment blocked</AlertTitle>
          <AlertDescription>The workspace needs more credits before the next Hunter lookup.</AlertDescription>
        </Alert>
      ) : null}
      {usage.events.length ? (
        <div className="mt-4">
          <Table aria-label="Recent Flexprice usage">
            <TableHeader>
              <TableRow>
                <TableHead>Operation</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead>Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usage.events.slice(-10).reverse().map((event) => (
                <TableRow key={event.id}>
                  <TableCell>{usageLabels[event.operation]}</TableCell>
                  <TableCell>{accounts.find((account) => account.id === event.account_id)?.name ?? "Earlier account"}</TableCell>
                  <TableCell>
                    <Badge variant={event.status === "failed" || event.status === "blocked" ? "destructive" : "secondary"}>
                      {usageStatus[event.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{event.status === "blocked" ? "—" : event.units}</TableCell>
                  <TableCell>{dateTime(event.at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </Panel>
  );
}
