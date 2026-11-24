type CsvCell = string | number | boolean | null | undefined;

export function toCsv(headers: string[], rows: CsvCell[][]) {
  function encode(value: CsvCell) {
    let cell = String(value ?? "");
    // Keep externally sourced text from being interpreted as a spreadsheet formula.
    if (typeof value === "string" && /^(?:\s*[=+@-]|[\t\r\n])/.test(cell)) {
      cell = "'" + cell;
    }
    return `"${cell.replaceAll('"', '""')}"`;
  }

  return [headers, ...rows].map((row) => row.map(encode).join(",")).join("\r\n") + "\r\n";
}

export function downloadFile(filename: string, mimeType: string, contents: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
