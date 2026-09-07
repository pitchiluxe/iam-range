/**
 * vm/spreadsheet.ts — a spreadsheet that actually calculates.
 *
 * Identity work lives in spreadsheets. An access review export, a list of
 * dormant accounts, a group membership dump, a licence reconciliation — the
 * analyst opens all of them in Excel and starts counting. A workstation that
 * teaches the job with no way to do that is missing the tool the job is done
 * in, so this is a real evaluator rather than a grid of text boxes.
 *
 * The engine is here, apart from the UI, because it is the part that has to be
 * correct. A grid that renders beautifully and computes `=SUM(A1:A10)` wrongly
 * is worse than no spreadsheet: an analyst who trusts a wrong total in a
 * review certifies access they meant to revoke.
 *
 * Scope is chosen for the work rather than for completeness. There is no
 * charting, no pivot table, no macro language. There is arithmetic, text,
 * lookup and the counting functions that answer "how many of these are stale",
 * which is what an identity analyst spends the day asking.
 *
 * Two behaviours are load-bearing and easy to get wrong:
 *
 *   - A circular reference has to be detected, not hung on. `A1 = B1 + 1` and
 *     `B1 = A1 + 1` is a mistake people make in minutes, and an engine that
 *     recurses forever takes the window with it.
 *   - An error has to propagate. If A1 is `#DIV/0!` then `=A1*2` is also an
 *     error, not zero — silently treating a broken cell as nought is how a
 *     wrong number reaches a report with nothing to show it went wrong.
 */

/** A1-style address, parsed. */
export interface CellRef {
  col: number;
  row: number;
}

export type CellValue = number | string | boolean | null;

export interface Cell {
  /** What the user typed, verbatim. Formulas keep their leading `=`. */
  input: string;
}

export type Grid = Map<string, Cell>;

/** The spreadsheet errors this engine can produce. */
export const ERRORS = {
  ref: '#REF!',
  div: '#DIV/0!',
  name: '#NAME?',
  value: '#VALUE!',
  circular: '#CIRC!',
} as const;

const ERROR_VALUES = new Set<string>(Object.values(ERRORS));

export function isError(v: CellValue): boolean {
  return typeof v === 'string' && ERROR_VALUES.has(v);
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

/** `0 -> A`, `25 -> Z`, `26 -> AA`. */
export function columnName(col: number): string {
  let n = col;
  let out = '';
  while (n >= 0) {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  }
  return out;
}

export function columnIndex(name: string): number {
  let n = 0;
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function cellId(col: number, row: number): string {
  return `${columnName(col)}${row + 1}`;
}

export function parseRef(ref: string): CellRef | null {
  const m = /^\$?([A-Za-z]+)\$?([0-9]+)$/.exec(ref.trim());
  if (!m) return null;
  const row = Number(m[2]) - 1;
  if (row < 0) return null;
  return { col: columnIndex(m[1]!), row };
}

/** Expand `A1:B3` into every address it covers, row-major. */
export function expandRange(from: string, to: string): string[] {
  const a = parseRef(from);
  const b = parseRef(to);
  if (!a || !b) return [];
  const out: string[] = [];
  for (let r = Math.min(a.row, b.row); r <= Math.max(a.row, b.row); r += 1) {
    for (let c = Math.min(a.col, b.col); c <= Math.max(a.col, b.col); c += 1) {
      out.push(cellId(c, r));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tokenising and parsing
// ---------------------------------------------------------------------------

type Token =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'ref'; value: string }
  | { kind: 'range'; from: string; to: string }
  | { kind: 'name'; value: string }
  | { kind: 'op'; value: string }
  | { kind: 'paren'; value: '(' | ')' }
  | { kind: 'comma' };

function tokenise(src: string): Token[] | null {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let text = '';
      while (j < src.length && src[j] !== '"') {
        text += src[j];
        j += 1;
      }
      if (j >= src.length) return null; // unterminated
      out.push({ kind: 'string', value: text });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?/.exec(src.slice(i));
      if (!m) return null;
      out.push({ kind: 'number', value: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_$.]*/.exec(src.slice(i));
      const word = m![0];
      const after = src.slice(i + word.length);
      // `A1:B3` is a range; `SUM(` is a function; `A1` alone is a reference.
      const rangeMatch = /^:\s*(\$?[A-Za-z]+\$?[0-9]+)/.exec(after);
      if (parseRef(word) && rangeMatch) {
        out.push({ kind: 'range', from: word, to: rangeMatch[1]! });
        i += word.length + rangeMatch[0].length;
        continue;
      }
      if (parseRef(word) && !/^\s*\(/.test(after)) {
        out.push({ kind: 'ref', value: word.replace(/\$/g, '').toUpperCase() });
        i += word.length;
        continue;
      }
      out.push({ kind: 'name', value: word.toUpperCase() });
      i += word.length;
      continue;
    }
    if (ch === '(' || ch === ')') {
      out.push({ kind: 'paren', value: ch });
      i += 1;
      continue;
    }
    if (ch === ',' || ch === ';') {
      out.push({ kind: 'comma' });
      i += 1;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['<=', '>=', '<>'].includes(two)) {
      out.push({ kind: 'op', value: two });
      i += 2;
      continue;
    }
    if ('+-*/^&=<>%'.includes(ch)) {
      out.push({ kind: 'op', value: ch });
      i += 1;
      continue;
    }
    return null; // a character this grammar does not have
  }
  return out;
}

type Node =
  | { type: 'lit'; value: CellValue }
  | { type: 'ref'; id: string }
  | { type: 'range'; ids: string[] }
  | { type: 'call'; name: string; args: Node[] }
  | { type: 'binary'; op: string; left: Node; right: Node }
  | { type: 'unary'; op: string; operand: Node };

/** Binding power. Comparison loosest, then `&`, then arithmetic. */
const PRECEDENCE: Record<string, number> = {
  '=': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '<>': 1,
  '&': 2,
  '+': 3, '-': 3,
  '*': 4, '/': 4,
  '^': 5,
};

function parse(tokens: Token[]): Node | null {
  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];

  function parseExpression(minPower = 0): Node | null {
    let left = parseUnary();
    if (!left) return null;
    for (;;) {
      const t = peek();
      if (!t || t.kind !== 'op') break;
      const power = PRECEDENCE[t.value];
      if (power === undefined || power < minPower) break;
      pos += 1;
      // `^` is right-associative, everything else left.
      const right = parseExpression(t.value === '^' ? power : power + 1);
      if (!right) return null;
      left = { type: 'binary', op: t.value, left, right };
    }
    return left;
  }

  function parseUnary(): Node | null {
    const t = peek();
    if (t && t.kind === 'op' && (t.value === '-' || t.value === '+')) {
      pos += 1;
      const operand = parseUnary();
      return operand ? { type: 'unary', op: t.value, operand } : null;
    }
    return parsePrimary();
  }

  function parsePrimary(): Node | null {
    const t = peek();
    if (!t) return null;
    if (t.kind === 'number' || t.kind === 'string') {
      pos += 1;
      return { type: 'lit', value: t.value };
    }
    if (t.kind === 'ref') {
      pos += 1;
      return { type: 'ref', id: t.value };
    }
    if (t.kind === 'range') {
      pos += 1;
      return { type: 'range', ids: expandRange(t.from, t.to) };
    }
    if (t.kind === 'paren' && t.value === '(') {
      pos += 1;
      const inner = parseExpression(0);
      const close = peek();
      if (!inner || !close || close.kind !== 'paren' || close.value !== ')') return null;
      pos += 1;
      return inner;
    }
    if (t.kind === 'name') {
      pos += 1;
      const next = peek();
      if (next && next.kind === 'paren' && next.value === '(') {
        pos += 1;
        const args: Node[] = [];
        if (peek()?.kind === 'paren' && (peek() as { value: string }).value === ')') {
          pos += 1;
          return { type: 'call', name: t.value, args };
        }
        for (;;) {
          const arg = parseExpression(0);
          if (!arg) return null;
          args.push(arg);
          const sep = peek();
          if (sep?.kind === 'comma') {
            pos += 1;
            continue;
          }
          if (sep?.kind === 'paren' && sep.value === ')') {
            pos += 1;
            return { type: 'call', name: t.value, args };
          }
          return null;
        }
      }
      // TRUE / FALSE are the only bare names with meaning.
      if (t.value === 'TRUE') return { type: 'lit', value: true };
      if (t.value === 'FALSE') return { type: 'lit', value: false };
      return { type: 'lit', value: ERRORS.name };
    }
    return null;
  }

  const node = parseExpression(0);
  return node && pos === tokens.length ? node : null;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

function toNumber(v: CellValue): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toText(v: CellValue): string {
  if (v === null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}

/** Flatten arguments, so SUM(A1:A3, 5) works the way people expect. */
function flatten(values: (CellValue | CellValue[])[]): CellValue[] {
  const out: CellValue[] = [];
  for (const v of values) {
    if (Array.isArray(v)) out.push(...v);
    else out.push(v);
  }
  return out;
}

/** Numbers only — text in a range is skipped rather than counted as zero. */
function numbersIn(values: CellValue[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (typeof v === 'number') out.push(v);
    else if (typeof v === 'boolean') out.push(v ? 1 : 0);
    else if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
      out.push(Number(v));
    }
  }
  return out;
}

/** Does a value satisfy a criterion like `">60"`, `"never"` or `42`? */
function meets(value: CellValue, criterion: CellValue): boolean {
  const raw = toText(criterion).trim();
  const m = /^(<=|>=|<>|<|>|=)?\s*(.*)$/.exec(raw);
  const op = m?.[1] ?? '=';
  const operand = m?.[2] ?? '';
  const asNumber = Number(operand);
  const numeric = operand !== '' && Number.isFinite(asNumber) && typeof value !== 'string';
  const left = numeric ? (toNumber(value) ?? 0) : toText(value).toLowerCase();
  const right = numeric ? asNumber : operand.toLowerCase();
  switch (op) {
    case '<': return left < right;
    case '>': return left > right;
    case '<=': return left <= right;
    case '>=': return left >= right;
    case '<>': return left !== right;
    default: return left === right;
  }
}

type Fn = (args: (CellValue | CellValue[])[]) => CellValue;

/**
 * The functions.
 *
 * Chosen for identity work rather than for coverage: counting, filtering by a
 * condition, joining text and looking a value up in a table is most of what an
 * access-review or dormancy spreadsheet does.
 */
const FUNCTIONS: Record<string, Fn> = {
  SUM: (a) => numbersIn(flatten(a)).reduce((x, y) => x + y, 0),
  PRODUCT: (a) => numbersIn(flatten(a)).reduce((x, y) => x * y, 1),
  AVERAGE: (a) => {
    const n = numbersIn(flatten(a));
    return n.length === 0 ? ERRORS.div : n.reduce((x, y) => x + y, 0) / n.length;
  },
  MIN: (a) => {
    const n = numbersIn(flatten(a));
    return n.length === 0 ? 0 : Math.min(...n);
  },
  MAX: (a) => {
    const n = numbersIn(flatten(a));
    return n.length === 0 ? 0 : Math.max(...n);
  },
  COUNT: (a) => numbersIn(flatten(a)).length,
  COUNTA: (a) => flatten(a).filter((v) => v !== null && v !== '').length,
  COUNTBLANK: (a) => flatten(a).filter((v) => v === null || v === '').length,
  COUNTIF: (a) => {
    const range = Array.isArray(a[0]) ? a[0] : [a[0] as CellValue];
    const criterion = (Array.isArray(a[1]) ? a[1][0] : a[1]) ?? null;
    return range.filter((v) => meets(v, criterion)).length;
  },
  SUMIF: (a) => {
    const range = Array.isArray(a[0]) ? a[0] : [a[0] as CellValue];
    const criterion = (Array.isArray(a[1]) ? a[1][0] : a[1]) ?? null;
    const sumRange = Array.isArray(a[2]) ? a[2] : range;
    let total = 0;
    range.forEach((v, i) => {
      if (meets(v, criterion)) total += toNumber(sumRange[i] ?? null) ?? 0;
    });
    return total;
  },
  IF: (a) => {
    const cond = Array.isArray(a[0]) ? a[0][0] ?? null : (a[0] as CellValue);
    const truthy = typeof cond === 'boolean' ? cond : (toNumber(cond) ?? 0) !== 0;
    const branch = truthy ? a[1] : a[2];
    if (branch === undefined) return truthy;
    return Array.isArray(branch) ? branch[0] ?? null : branch;
  },
  ROUND: (a) => {
    const n = toNumber(Array.isArray(a[0]) ? a[0][0] ?? null : (a[0] as CellValue));
    const digits = toNumber(Array.isArray(a[1]) ? a[1][0] ?? null : (a[1] as CellValue) ?? 0) ?? 0;
    if (n === null) return ERRORS.value;
    const f = 10 ** digits;
    return Math.round(n * f) / f;
  },
  ABS: (a) => {
    const n = toNumber(Array.isArray(a[0]) ? a[0][0] ?? null : (a[0] as CellValue));
    return n === null ? ERRORS.value : Math.abs(n);
  },
  LEN: (a) => toText(Array.isArray(a[0]) ? a[0][0] ?? null : (a[0] as CellValue)).length,
  UPPER: (a) => toText(Array.isArray(a[0]) ? a[0][0] ?? null : (a[0] as CellValue)).toUpperCase(),
  LOWER: (a) => toText(Array.isArray(a[0]) ? a[0][0] ?? null : (a[0] as CellValue)).toLowerCase(),
  TRIM: (a) => toText(Array.isArray(a[0]) ? a[0][0] ?? null : (a[0] as CellValue)).trim(),
  CONCAT: (a) => flatten(a).map(toText).join(''),
  CONCATENATE: (a) => flatten(a).map(toText).join(''),
  TODAY: () => new Date().toISOString().slice(0, 10),
  /**
   * Vertical lookup — the function every analyst reaches for when reconciling
   * two exports, which is most of what identity reporting is.
   */
  VLOOKUP: (a) => {
    const needle = Array.isArray(a[0]) ? a[0][0] ?? null : (a[0] as CellValue);
    const table = Array.isArray(a[1]) ? a[1] : [];
    const colIndex = toNumber(Array.isArray(a[2]) ? a[2][0] ?? null : (a[2] as CellValue)) ?? 1;
    const width = toNumber(Array.isArray(a[3]) ? a[3][0] ?? null : (a[3] as CellValue)) ?? 2;
    if (width < 1 || colIndex < 1 || colIndex > width) return ERRORS.ref;
    for (let i = 0; i < table.length; i += width) {
      if (toText(table[i] ?? null).toLowerCase() === toText(needle).toLowerCase()) {
        return table[i + colIndex - 1] ?? null;
      }
    }
    return ERRORS.ref;
  },
};

/** Every function name, for the UI's help. */
export const FUNCTION_NAMES = Object.keys(FUNCTIONS).sort();

export interface Sheet {
  cells: Grid;
}

/**
 * Work out what a cell shows.
 *
 * `seen` carries the cells already being evaluated further up the stack, which
 * is what turns an infinite recursion into a `#CIRC!`.
 */
export function evaluate(sheet: Sheet, id: string, seen: Set<string> = new Set()): CellValue {
  const upper = id.toUpperCase();
  if (seen.has(upper)) return ERRORS.circular;
  const cell = sheet.cells.get(upper);
  if (!cell || cell.input === '') return null;
  if (!cell.input.startsWith('=')) {
    const n = Number(cell.input);
    return cell.input.trim() !== '' && Number.isFinite(n) ? n : cell.input;
  }

  const next = new Set(seen);
  next.add(upper);

  const tokens = tokenise(cell.input.slice(1));
  if (!tokens) return ERRORS.value;
  const ast = parse(tokens);
  if (!ast) return ERRORS.value;
  return evalNode(sheet, ast, next);
}

function evalNode(sheet: Sheet, node: Node, seen: Set<string>): CellValue {
  switch (node.type) {
    case 'lit':
      return node.value;
    case 'ref':
      return evaluate(sheet, node.id, seen);
    case 'range': {
      // A bare range outside a function collapses to its first cell, which is
      // what a spreadsheet does rather than erroring.
      const first = node.ids[0];
      return first ? evaluate(sheet, first, seen) : null;
    }
    case 'unary': {
      const v = evalNode(sheet, node.operand, seen);
      if (isError(v)) return v;
      const n = toNumber(v);
      if (n === null) return ERRORS.value;
      return node.op === '-' ? -n : n;
    }
    case 'binary': {
      const left = evalNode(sheet, node.left, seen);
      // Errors propagate. Treating a broken cell as zero is how a wrong number
      // reaches a report with nothing to show that it went wrong.
      if (isError(left)) return left;
      const right = evalNode(sheet, node.right, seen);
      if (isError(right)) return right;

      if (node.op === '&') return toText(left) + toText(right);
      if (['=', '<>', '<', '>', '<=', '>='].includes(node.op)) {
        const bothNumeric = toNumber(left) !== null && toNumber(right) !== null &&
          typeof left !== 'string' && typeof right !== 'string';
        const a = bothNumeric ? (toNumber(left) ?? 0) : toText(left).toLowerCase();
        const b = bothNumeric ? (toNumber(right) ?? 0) : toText(right).toLowerCase();
        switch (node.op) {
          case '=': return a === b;
          case '<>': return a !== b;
          case '<': return a < b;
          case '>': return a > b;
          case '<=': return a <= b;
          default: return a >= b;
        }
      }

      const a = toNumber(left);
      const b = toNumber(right);
      if (a === null || b === null) return ERRORS.value;
      switch (node.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return b === 0 ? ERRORS.div : a / b;
        case '^': return a ** b;
        default: return ERRORS.value;
      }
    }
    case 'call': {
      const fn = FUNCTIONS[node.name];
      if (!fn) return ERRORS.name;
      const args: (CellValue | CellValue[])[] = [];
      for (const arg of node.args) {
        if (arg.type === 'range') {
          const values = arg.ids.map((id) => evaluate(sheet, id, seen));
          const bad = values.find(isError);
          // IF is the exception: it must be able to choose a branch even when
          // the other one is broken.
          if (bad !== undefined && node.name !== 'IF') return bad;
          args.push(values);
        } else {
          const v = evalNode(sheet, arg, seen);
          if (isError(v) && node.name !== 'IF') return v;
          args.push(v);
        }
      }
      return fn(args);
    }
  }
}

/** How a value is shown in the grid. */
export function formatValue(v: CellValue): string {
  if (v === null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return ERRORS.value;
    // Trim floating-point noise: 0.1 + 0.2 should read 0.3, not 0.30000000000000004.
    return String(Math.round(v * 1e10) / 1e10);
  }
  return v;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** Parse CSV into a grid, honouring quotes and embedded commas. */
export function fromCsv(text: string): Grid {
  const grid: Grid = new Map();
  let row = 0;
  let col = 0;
  let field = '';
  let quoted = false;
  let i = 0;

  const commit = (): void => {
    if (field !== '') grid.set(cellId(col, row), { input: field });
    field = '';
    col += 1;
  };

  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      commit();
      i += 1;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      commit();
      col = 0;
      row += 1;
      // Swallow CRLF as one break.
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field !== '' || col > 0) commit();
  return grid;
}

/** The evaluated grid as CSV — values, not formulas, which is what a reader wants. */
export function toCsv(sheet: Sheet, rows: number, cols: number): string {
  const escape = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines: string[] = [];
  for (let r = 0; r < rows; r += 1) {
    const line: string[] = [];
    for (let c = 0; c < cols; c += 1) {
      line.push(escape(formatValue(evaluate(sheet, cellId(c, r)))));
    }
    // Trailing empties add nothing to a file somebody opens elsewhere.
    while (line.length > 0 && line[line.length - 1] === '') line.pop();
    lines.push(line.join(','));
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

/** The furthest cell holding anything, so the UI knows how much to export. */
export function usedBounds(grid: Grid): { rows: number; cols: number } {
  let rows = 0;
  let cols = 0;
  for (const [id, cell] of grid) {
    if (cell.input === '') continue;
    const ref = parseRef(id);
    if (!ref) continue;
    rows = Math.max(rows, ref.row + 1);
    cols = Math.max(cols, ref.col + 1);
  }
  return { rows, cols };
}
