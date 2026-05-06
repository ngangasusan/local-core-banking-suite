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
