// Tiny CSV + XLSX helpers used by the Clients and Loans export/import actions.
import * as XLSX from "xlsx";

/** Build and download an .xlsx workbook from row objects. */
export function downloadXLSX(filename: string, rows: Record<string, unknown>[], columns?: string[]) {
  const cols = columns ?? Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const data = rows.map((r) => cols.map((c) => {
    const v = r[c];
    if (v === null || v === undefined) return "";
    return typeof v === "object" ? JSON.stringify(v) : (v as string | number | boolean);
  }));
  const ws = XLSX.utils.aoa_to_sheet([cols, ...data]);
  ws["!cols"] = cols.map((c) => ({ wch: Math.min(40, Math.max(12, c.length + 4)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  XLSX.writeFile(wb, filename);
}

/** Parse an .xlsx/.xls file into row objects keyed by header (all values as strings). */
export async function parseXLSX(file: File): Promise<Record<string, string>[]> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: false });
  return raw.map((r) => {
    const o: Record<string, string> = {};
    Object.entries(r).forEach(([k, v]) => { o[k.trim()] = String(v ?? "").trim(); });
    return o;
  });
}

/** Parse any supported spreadsheet file (csv / xlsx / xls). */
export async function parseSpreadsheet(file: File): Promise<Record<string, string>[]> {
  return /\.(xlsx|xls)$/i.test(file.name) ? parseXLSX(file) : parseCSV(await file.text());
}


export function toCSV(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns ?? Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\r\n");
}

export function downloadCSV(filename: string, csv: string) {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Minimal RFC-4180 parser: returns an array of row objects keyed by header. */
export function parseCSV(text: string): Record<string, string>[] {
  const src = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ",") { row.push(field); field = ""; continue; }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
      continue;
    }
    field += ch;
  }
  row.push(field);
  if (row.some((c) => c !== "")) rows.push(row);
  if (!rows.length) return [];

  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    header.forEach((h, i) => { o[h] = (r[i] ?? "").trim(); });
    return o;
  });
}

export const csvTimestamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
