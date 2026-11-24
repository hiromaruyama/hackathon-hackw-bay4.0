import type { IcpFields, IcpGenerateInput, IndustryCode, IntakeFields } from "./types";

export const productLabels = {
  name: "Product name", description: "Description", capabilities: "Capabilities",
  constraints: "Constraints", customers_and_wins: "Customers and wins",
  pricing: "Pricing", contract_value: "Contract value",
} satisfies Record<keyof IcpGenerateInput, string>;

export const buyerLabels = {
  industries: "Industries", industry_codes: "Industry codes", geography: "Geography",
  headcount_band: "Headcount", revenue_band: "Revenue", buyer_titles: "Buyer titles",
  seniority: "Seniority", triggers: "Buying triggers", exclusions: "Exclusions",
} satisfies Record<keyof IcpFields, string>;

export const labels = { ...productLabels, ...buyerLabels };
export type BriefKey = keyof typeof labels;
export type Brief = Record<BriefKey, string>;
export const productKeys = Object.keys(productLabels) as (keyof IcpGenerateInput)[];
export const buyerKeys = Object.keys(buyerLabels) as (keyof IcpFields)[];
export const briefKeys = [...productKeys, ...buyerKeys];
export const requiredKeys = new Set<BriefKey>(["name", "description"]);
const listKeys = new Set<BriefKey>(["capabilities", "constraints", "customers_and_wins", "industries",
  "industry_codes", "geography", "buyer_titles", "seniority", "triggers", "exclusions"]);
export const isMultiline = (key: BriefKey) => key === "description" || listKeys.has(key);

const lines = (value: string) => value.split("\n").map((line) => line.trim()).filter(Boolean);

export function intakeEdits(input: IntakeFields): Partial<Brief> {
  const edits: Partial<Brief> = {};
  for (const key of productKeys) {
    const value = input[key];
    if (value != null) edits[key] = Array.isArray(value) ? value.join("\n") : value;
  }
  return edits;
}

export function savedBrief(product: IcpGenerateInput | null, fields?: IcpFields): Brief {
  const brief = Object.fromEntries(briefKeys.map((key) => [key, ""])) as Brief;
  Object.assign(brief, intakeEdits(product ?? {}));
  for (const key of buyerKeys) {
    if (key === "industry_codes") {
      brief[key] = (fields?.industry_codes ?? []).map(({ system, code }) => `${system} ${code}`).join("\n");
    } else {
      const value = fields?.[key];
      brief[key] = Array.isArray(value) ? value.join("\n") : value ?? "";
    }
  }
  return brief;
}

export function productInput(brief: Brief): IcpGenerateInput {
  return {
    name: brief.name.trim(), description: brief.description.trim(), capabilities: lines(brief.capabilities),
    constraints: lines(brief.constraints), customers_and_wins: lines(brief.customers_and_wins),
    pricing: brief.pricing.trim() || null, contract_value: brief.contract_value.trim() || null,
  };
}

export function buyerInput(brief: Brief): IcpFields {
  return {
    industries: lines(brief.industries), geography: lines(brief.geography),
    industry_codes: lines(brief.industry_codes).map((entry) => {
      const [system, code] = entry.toUpperCase().split(/\s+/);
      return { system: system as IndustryCode["system"], code };
    }),
    headcount_band: brief.headcount_band.trim() || null, revenue_band: brief.revenue_band.trim() || null,
    buyer_titles: lines(brief.buyer_titles), seniority: lines(brief.seniority),
    triggers: lines(brief.triggers), exclusions: lines(brief.exclusions),
  };
}

export function validateBrief(brief: Brief): { key: BriefKey; message: string } | null {
  for (const key of briefKeys) {
    const value = brief[key].trim();
    if (requiredKeys.has(key) && !value) return { key, message: `Enter a ${labels[key].toLowerCase()}.` };
    const entries = listKeys.has(key) ? lines(value) : [value];
    const limit = key === "description" ? 4000 : 250;
    if (entries.length > 12) return { key, message: `${labels[key]} allows up to 12 entries.` };
    if (entries.some((entry) => entry.length > limit)) return { key, message: `Shorten ${labels[key].toLowerCase()} to ${limit} characters per entry.` };
    if (key === "industry_codes" && entries.some((entry) => !/^(NAICS|SIC)\s+[0-9]{2,6}(?:-[0-9]{2})?$/i.test(entry))) {
      return { key, message: "Enter an industry code such as NAICS 221114 or SIC 4911." };
    }
  }
  return null;
}
