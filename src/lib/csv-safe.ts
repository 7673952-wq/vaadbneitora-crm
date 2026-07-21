// Neutralize CSV/XLSX formula injection: values that start with =, +, -, @,
// tab, or CR are prefixed with an apostrophe so spreadsheet apps treat them
// as text instead of formulas.
const DANGEROUS = /^[=+\-@\t\r]/;

export function sanitizeCell(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string" && DANGEROUS.test(value)) return "'" + value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value;
  if (typeof value === "object") return value;
  const s = String(value);
  return DANGEROUS.test(s) ? "'" + s : s;
}

export function sanitizeRow<T extends Record<string, any>>(row: T): T {
  const out: any = {};
  for (const k of Object.keys(row)) out[k] = sanitizeCell(row[k]);
  return out;
}

export function sanitizeRows<T extends Record<string, any>>(rows: T[]): T[] {
  return rows.map(sanitizeRow);
}

export function sanitizeMatrix(rows: unknown[][]): unknown[][] {
  return rows.map((r) => r.map(sanitizeCell));
}
