// Deterministic currency formatter for SSR/CSR parity.
// Intl.NumberFormat("en-KE", { currency: "KES" }) renders differently across
// Node (server) and browser ICU builds (e.g. "KSh" vs "KES"), causing React
// hydration mismatches. We format manually so output is identical everywhere.

export function fmtKES(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  if (!isFinite(v)) return "KES 0";
  const sign = v < 0 ? "-" : "";
  const abs = Math.round(Math.abs(v));
  const s = abs.toString();
  const withSep = s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `KES ${sign}${withSep}`;
}

export function fmtNumber(n: number | string | null | undefined, digits = 0): string {
  const v = Number(n ?? 0);
  if (!isFinite(v)) return "0";
  const fixed = v.toFixed(digits);
  const [int, dec] = fixed.split(".");
  const sign = int.startsWith("-") ? "-" : "";
  const intAbs = sign ? int.slice(1) : int;
  const withSep = intAbs.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return dec ? `${sign}${withSep}.${dec}` : `${sign}${withSep}`;
}

/** Display a stored date (ISO 8601 or yyyy-mm-dd) as dd/mm/yyyy. Storage format is unchanged. */
export function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const s = typeof v === "string" ? v : v.toISOString();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(s);
  if (isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/** dd/mm/yyyy HH:mm (UTC-stable). */
export function fmtDateTime(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v as any);
  if (isNaN(d.getTime())) return fmtDate(v);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${fmtDate(d)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
