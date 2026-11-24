"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ExportMenu({ label, formats, disabled = false }: {
  label: string;
  formats: { label: string; download: () => void }[];
  disabled?: boolean;
}) {
  const [format, setFormat] = useState(0);

  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2">
      <select aria-label="Download format" value={format} disabled={disabled}
        onChange={(event) => setFormat(Number(event.target.value))}
        className="h-9 rounded-md border border-input bg-card px-2 text-sm text-foreground disabled:opacity-50">
        {formats.map((option, index) => <option key={option.label} value={index}>{option.label}</option>)}
      </select>
      <Button type="button" variant="outline" disabled={disabled} onClick={formats[format].download}>
        <Download aria-hidden /> Download
      </Button>
    </div>
  );
}
