"use client";

import { useId } from "react";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { Account } from "@/lib/types";

export const graphVerdicts = ["contact", "hold", "reject"] as const;

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
