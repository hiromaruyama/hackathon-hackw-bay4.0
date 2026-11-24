"use client";

import { useId, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { verdictLabel } from "@/lib/format";
import type { Account, Recommendation } from "@/lib/types";

export const graphVerdicts = ["contact", "hold", "reject"] as const;

export type GraphFilterState = {
  verdicts: Set<Recommendation>;
  scores: Set<number>;
  companies: Set<string>;
};

export const emptyGraphFilters: GraphFilterState = {
  verdicts: new Set(),
  scores: new Set(),
  companies: new Set(),
};

export function findGraphAccounts(accounts: Account[], query: string) {
  const term = query.trim().toLowerCase();
  return accounts
    .filter((account) => account.name.toLowerCase().includes(term) || account.domain.toLowerCase().includes(term))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function AccountSearch({ value, onChange }: { value: string; onChange: (query: string) => void }) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id} className="sr-only">Company name or domain</FieldLabel>
      <Input id={id} type="search" placeholder="Company name or domain" autoComplete="off" value={value} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );
}

export function GraphFilters({
  accounts,
  filters,
  onChange,
}: {
  accounts: Account[];
  filters: GraphFilterState;
  onChange: (filters: GraphFilterState) => void;
}) {
  const [query, setQuery] = useState("");
  const results = findGraphAccounts(accounts, query);
  const scores = [...new Set(accounts.map((account) => account.fit_score))].sort((a, b) => b - a);
  const count = filters.verdicts.size + filters.scores.size + filters.companies.size;

  return (
    <Sheet onOpenChange={(open) => { if (!open) setQuery(""); }}>
      <SheetTrigger asChild>
        <Button variant="outline">
          <SlidersHorizontal data-icon="inline-start" aria-hidden /> Filters{count > 0 ? ` (${count})` : ""}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>Graph filters</SheetTitle>
          <SheetDescription>Uncheck verdicts, fit scores, or companies to hide them from the graph.</SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-5 px-4 pb-4">
            <fieldset className="flex flex-wrap gap-x-4 gap-y-3">
              <legend className="mb-2 font-semibold">Account verdicts</legend>
              {graphVerdicts.map((verdict) => (
                <FilterOption
                  key={verdict}
                  label={verdictLabel[verdict]}
                  checked={!filters.verdicts.has(verdict)}
                  onChange={() => onChange({ ...filters, verdicts: toggled(filters.verdicts, verdict) })}
                />
              ))}
            </fieldset>
            <fieldset className="flex flex-wrap gap-x-4 gap-y-3">
              <legend className="mb-2 font-semibold">Fit scores</legend>
              {scores.map((score) => (
                <FilterOption
                  key={score}
                  label={`Fit ${score}`}
                  checked={!filters.scores.has(score)}
                  onChange={() => onChange({ ...filters, scores: toggled(filters.scores, score) })}
                />
              ))}
            </fieldset>
            <fieldset className="min-w-0">
              <legend className="mb-2 font-semibold">Companies</legend>
              <div className="flex flex-col gap-3">
                <AccountSearch value={query} onChange={setQuery} />
                {results.length ? (
                  <ul className="flex flex-col gap-1">
                    {results.map((account) => (
                      <li className="rounded-md px-1 py-1.5 hover:bg-muted" key={account.id}>
                        <FilterOption
                          label={account.name}
                          description={account.domain}
                          checked={!filters.companies.has(account.id)}
                          onChange={() => onChange({ ...filters, companies: toggled(filters.companies, account.id) })}
                        />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p role="status" className="text-sm text-muted-foreground">No companies match your search.</p>
                )}
              </div>
            </fieldset>
          </div>
        </ScrollArea>
        <SheetFooter className="flex-row justify-between border-t">
          <Button variant="outline" disabled={count === 0} onClick={() => onChange(emptyGraphFilters)}>Reset filters</Button>
          <SheetClose asChild><Button>Done</Button></SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function FilterOption({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: () => void;
}) {
  const id = useId();
  return (
    <Field orientation="horizontal" className="w-auto gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={onChange} aria-describedby={description ? `${id}-description` : undefined} />
      <div className="flex min-w-0 flex-col gap-0.5 wrap-anywhere">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {description ? <span id={`${id}-description`} className="text-xs text-muted-foreground">{description}</span> : null}
      </div>
    </Field>
  );
}

function toggled<T>(values: Set<T>, value: T) {
  const next = new Set(values);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
