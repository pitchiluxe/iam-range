/**
 * terminal/format.ts — render capability result rows as a PowerShell-style
 * table: headers, a dashed rule, and space-padded columns.
 */

function cell(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  return String(v);
}

export function formatTable(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';

  const cols = Object.keys(rows[0]!);
  const body = rows.map((r) => cols.map((c) => cell(r[c])));

  // Column width is the widest of the header and every value under it.
  const widths = cols.map((c, i) => Math.max(c.length, ...body.map((r) => r[i]!.length)));

  const pad = (parts: string[]): string =>
    parts
      .map((p, i) => (i === parts.length - 1 ? p : p.padEnd(widths[i]!)))
      .join('  ')
      .trimEnd();

  return [pad(cols), pad(widths.map((w) => '-'.repeat(w))), ...body.map((r) => pad(r))].join('\n');
}
