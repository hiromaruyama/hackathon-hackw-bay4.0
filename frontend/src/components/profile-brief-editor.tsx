import type { ChangeEvent } from "react";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { buyerKeys, isMultiline, labels, productKeys, requiredKeys, type Brief, type BriefKey } from "@/lib/profile-brief";

const sections = [
  { title: "Product", keys: productKeys },
  { title: "Target buyers", keys: buyerKeys },
];

export function focusBriefField(key: BriefKey) {
  const field = document.getElementById(`brief-${key}`);
  field?.focus({ preventScroll: true });
  field?.scrollIntoView({ block: "center" });
}

export function ProfileBriefEditor({ value, onChange, disabled, invalidField }: {
  value: Brief; onChange: (value: Brief) => void; disabled: boolean; invalidField?: BriefKey;
}) {
  return sections.map(({ title, keys }) => (
    <section key={title} aria-label={title} className="flex min-w-0 flex-col gap-4 border-b py-5 last:border-b-0">
      <h2 className="text-base font-semibold">{title}</h2>
      <FieldGroup className="grid items-start gap-x-5 gap-y-4 sm:grid-cols-2 xl:grid-cols-6">
        {keys.map((key) => {
          const required = requiredKeys.has(key);
          const invalid = key === invalidField;
          const props = {
            id: `brief-${key}`, value: value[key], disabled, required,
            "aria-invalid": invalid || undefined, "aria-describedby": invalid ? "brief-error" : undefined,
            onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ ...value, [key]: event.target.value }),
          };
          let width = "xl:col-span-2";
          if (key === "description") width = "xl:col-span-4";
          if (key === "pricing" || key === "contract_value") width = "xl:col-span-3";
          return (
            <Field key={key} data-invalid={invalid || undefined} className={`min-w-0 gap-1.5 ${width}`}>
              <FieldLabel htmlFor={props.id} className="gap-1">
                {labels[key]} {required && <span aria-hidden className="text-destructive">*</span>}
              </FieldLabel>
              {isMultiline(key)
                ? <Textarea {...props} rows={2} maxLength={key === "description" ? 4000 : undefined} />
                : <Input {...props} maxLength={250} />}
            </Field>
          );
        })}
      </FieldGroup>
    </section>
  ));
}
