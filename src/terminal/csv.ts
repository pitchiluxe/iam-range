/** Import-Csv records, including escaped quotes and quoted commas/newlines. */
export function parseCsv(source: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], value = '', quoted = false;
  const text = source.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && ch === ',') { row.push(value); value = ''; }
    else if (!quoted && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(value);
      if (row.some(cell => cell.length)) rows.push(row);
      row = []; value = '';
    } else value += ch;
  }
  if (quoted) throw new Error('Import-Csv: unterminated quoted field. No commands were run.');
  row.push(value);
  if (row.some(cell => cell.length)) rows.push(row);
  const headers = rows.shift()?.map(h => h.trim()) ?? [];
  if (!headers.length || headers.some(h => !h) || new Set(headers.map(h => h.toLowerCase())).size !== headers.length) {
    throw new Error('Import-Csv: provide a non-empty, unique header for each column.');
  }
  return rows.map((cells, index) => {
    if (cells.length !== headers.length) throw new Error(`Import-Csv: row ${index + 2} has ${cells.length} fields; expected ${headers.length}.`);
    return Object.fromEntries(headers.map((h, i) => [h, cells[i]!]));
  });
}
