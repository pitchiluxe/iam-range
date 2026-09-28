/**
 * terminal/objectPipeline.ts — PowerShell pipes objects, not text.
 *
 * `Get-ADUser -Filter * | Select-Object Name,SamAccountName` used to print the
 * same table unchanged, because the pipeline only knew how to cut lines of
 * text. When a command returns objects, these stages now work on the objects,
 * and the result is formatted once at the end, the way PowerShell does it:
 * a table for four properties or fewer, a list for more.
 */
import { tokenize } from './tokenizer';
import { formatTable } from './format';
import { formatList, formatValue, parseFilter, type AdValue } from './adObjects';

export type Row = Record<string, unknown>;
export type View = 'list' | 'table' | 'auto';

export type StageResult =
  | { kind: 'rows'; rows: Row[]; view?: View }
  | { kind: 'text'; text: string }
  | { kind: 'error'; error: string }
  | { kind: 'unsupported' };

const str = (v: unknown): string => formatValue(v as AdValue);

function stringify(rows: Row[]): Record<string, string>[] {
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, str(v)])));
}

/** Render objects the way PowerShell's default formatter would. */
export function renderRows(rows: Row[], view: View = 'auto', props?: string[]): string {
  if (rows.length === 0) return '';
  const picked = props && props.length && !props.includes('*') ? pick(rows, props) : rows;
  const cols = Object.keys(picked[0] ?? {}).length;
  const asList = view === 'list' || (view === 'auto' && cols > 4);
  if (asList) return formatList(picked);
  return `\n${formatTable(stringify(picked), { empty: '' })}\n`;
}

function keyOf(row: Row, name: string): string | undefined {
  return Object.keys(row).find((k) => k.toLowerCase() === name.toLowerCase());
}

function pick(rows: Row[], props: string[]): Row[] {
  return rows.map((r) => {
    const out: Row = {};
    for (const p of props) {
      if (p === '*') Object.assign(out, r);
      else {
        const k = keyOf(r, p);
        out[k ?? p] = k ? r[k] : null;
      }
    }
    return out;
  });
}

/** "Name,SamAccountName" / "Name, SamAccountName" / -Property Name,SID → names. */
function propList(args: Record<string, string>, positional: string[], key = 'property'): string[] {
  const fromArg = Object.entries(args).find(([k]) => k.toLowerCase() === key)?.[1];
  const src = fromArg ?? positional.filter((p) => !p.startsWith('{')).join(' ');
  return src
    .split(/[,\s]+/)
    .map((p) => p.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

const argOf = (args: Record<string, string>, name: string): string | undefined =>
  Object.entries(args).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];

const hasSwitch = (args: Record<string, string>, name: string): boolean => argOf(args, name) !== undefined;

const WHERE_OPS = ['eq', 'ne', 'like', 'notlike', 'match', 'notmatch', 'gt', 'ge', 'lt', 'le'];

/** Apply one pipeline stage to objects. */
export function objectStage(rows: Row[], stage: string): StageResult {
  const { cmdlet, args, positional } = tokenize(stage);
  const name = cmdlet.toLowerCase();

  switch (name) {
    case 'select-object':
    case 'select': {
      let out = rows;
      const skip = Number(argOf(args, 'Skip') ?? 0);
      if (skip > 0) out = out.slice(skip);
      const first = argOf(args, 'First');
      const last = argOf(args, 'Last');
      if (first !== undefined) out = out.slice(0, Math.max(0, Number(first) || 0));
      if (last !== undefined) out = out.slice(-Math.max(0, Number(last) || 0));
      const expand = argOf(args, 'ExpandProperty');
      if (expand) {
        const lines = out.flatMap((r) => {
          const k = keyOf(r, expand);
          const v = k ? r[k] : undefined;
          return Array.isArray(v) ? v.map(String) : [str(v)];
        });
        return { kind: 'text', text: lines.join('\n') };
      }
      const props = propList(args, positional);
      if (hasSwitch(args, 'Unique')) {
        const seen = new Set<string>();
        out = out.filter((r) => {
          const k = JSON.stringify(props.length ? pick([r], props)[0] : r);
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      }
      return { kind: 'rows', rows: props.length ? pick(out, props) : out, view: 'auto' };
    }

    case 'where-object':
    case 'where':
    case '?': {
      const block = positional.find((p) => p.startsWith('{')) ?? argOf(args, 'FilterScript');
      let source: string;
      if (block) source = block;
      else {
        const prop = positional[0] ?? argOf(args, 'Property');
        if (!prop) return { kind: 'error', error: 'Where-Object : Specify a condition, for example: Where-Object { $_.Enabled -eq $true }' };
        const op = WHERE_OPS.find((o) => argOf(args, o) !== undefined);
        source = op ? `${prop} -${op} "${argOf(args, op)}"` : `${prop} -eq $true`;
      }
      const parsed = parseFilter(source);
      if (!parsed.ok) return { kind: 'error', error: `Where-Object : ${parsed.error}` };
      return { kind: 'rows', rows: rows.filter((r) => parsed.test(r as never)) };
    }

    case 'sort-object':
    case 'sort': {
      const props = propList(args, positional);
      const desc = hasSwitch(args, 'Descending');
      const keyName = props[0];
      const sorted = [...rows].sort((a, b) => {
        const ka = keyName ? keyOf(a, keyName) : Object.keys(a)[0];
        const kb = keyName ? keyOf(b, keyName) : Object.keys(b)[0];
        return str(ka ? a[ka] : '').localeCompare(str(kb ? b[kb] : ''), undefined, { numeric: true, sensitivity: 'base' });
      });
      return { kind: 'rows', rows: desc ? sorted.reverse() : sorted };
    }

    case 'format-table':
    case 'ft': {
      const props = propList(args, positional);
      return { kind: 'text', text: renderRows(rows, 'table', props) };
    }

    case 'format-list':
    case 'fl': {
      const props = propList(args, positional);
      return { kind: 'text', text: renderRows(rows, 'list', props.length ? props : undefined) };
    }

    case 'measure-object':
    case 'measure':
      return {
        kind: 'text',
        text: `\nCount    : ${rows.length}\nAverage  :\nSum      :\nMaximum  :\nMinimum  :\nProperty :\n`,
      };

    case 'foreach-object':
    case 'foreach':
    case '%': {
      const member = argOf(args, 'MemberName');
      const block = positional.find((p) => p.startsWith('{'));
      const m = block ? /^\{\s*\$(?:_|PSItem)\.(\w+)\s*\}$/i.exec(block) : null;
      const prop = member ?? m?.[1];
      if (!prop) return { kind: 'unsupported' };
      return {
        kind: 'text',
        text: rows
          .map((r) => {
            const k = keyOf(r, prop);
            return str(k ? r[k] : '');
          })
          .join('\n'),
      };
    }

    case 'convertto-csv': {
      if (rows.length === 0) return { kind: 'text', text: '' };
      const keys = Object.keys(rows[0]!);
      const q = (v: string): string => `"${v.replace(/"/g, '""')}"`;
      return { kind: 'text', text: [keys.map(q).join(','), ...rows.map((r) => keys.map((k) => q(str(r[k]))).join(','))].join('\n') };
    }

    case 'out-string':
    case 'out-host':
    case 'out-default':
      return { kind: 'rows', rows };

    default:
      return { kind: 'unsupported' };
  }
}
