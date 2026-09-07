/**
 * tests/spreadsheet.test.ts — the arithmetic has to be right.
 *
 * A grid that renders beautifully and computes =SUM(A1:A10) wrongly is worse
 * than no spreadsheet at all: an analyst who trusts a wrong total in an access
 * review certifies access they meant to revoke. So the engine is tested apart
 * from the UI, and the two behaviours easiest to get wrong are tested hardest.
 *
 * A circular reference must be detected rather than recursed into — `A1=B1+1`
 * with `B1=A1+1` is a mistake people make within minutes, and an engine that
 * loops forever takes the window with it.
 *
 * An error must propagate. If A1 is #DIV/0! then =A1*2 is an error too, not
 * zero. Silently treating a broken cell as nought is how a wrong number
 * reaches a report with nothing to show that anything went wrong.
 */
import { describe, it, expect } from 'vitest';
import {
  ERRORS,
  cellId,
  columnIndex,
  columnName,
  evaluate,
  expandRange,
  formatValue,
  fromCsv,
  parseRef,
  toCsv,
  usedBounds,
} from '@/vm/spreadsheet';
import type { Grid, Sheet } from '@/vm/spreadsheet';

/** Build a sheet from `{ A1: '1', B1: '=A1*2' }`. */
function sheet(cells: Record<string, string>): Sheet {
  const grid: Grid = new Map();
  for (const [id, input] of Object.entries(cells)) grid.set(id.toUpperCase(), { input });
  return { cells: grid };
}

const val = (cells: Record<string, string>, id: string) => evaluate(sheet(cells), id);
const shown = (cells: Record<string, string>, id: string) => formatValue(evaluate(sheet(cells), id));

describe('addresses', () => {
  it('names columns past Z', () => {
    expect(columnName(0)).toBe('A');
    expect(columnName(25)).toBe('Z');
    expect(columnName(26)).toBe('AA');
    expect(columnName(51)).toBe('AZ');
    expect(columnName(52)).toBe('BA');
  });

  it('round-trips a column name', () => {
    for (const i of [0, 5, 25, 26, 51, 52, 700]) {
      expect(columnIndex(columnName(i)), String(i)).toBe(i);
    }
  });

  it('parses A1 notation, absolute or not', () => {
    expect(parseRef('B3')).toEqual({ col: 1, row: 2 });
    expect(parseRef('$B$3')).toEqual({ col: 1, row: 2 });
    expect(parseRef('nonsense')).toBeNull();
  });

  it('expands a range row-major', () => {
    expect(expandRange('A1', 'B2')).toEqual(['A1', 'B1', 'A2', 'B2']);
  });

  it('expands a range given backwards', () => {
    expect(expandRange('B2', 'A1')).toEqual(['A1', 'B1', 'A2', 'B2']);
  });
});

describe('literals', () => {
  it('reads a number as a number and text as text', () => {
    expect(val({ A1: '42' }, 'A1')).toBe(42);
    expect(val({ A1: 'jdoe' }, 'A1')).toBe('jdoe');
  });

  it('treats an empty cell as blank rather than zero', () => {
    expect(val({}, 'A1')).toBeNull();
    expect(shown({}, 'A1')).toBe('');
  });
});

describe('arithmetic', () => {
  it('applies precedence and parentheses', () => {
    expect(val({ A1: '=2+3*4' }, 'A1')).toBe(14);
    expect(val({ A1: '=(2+3)*4' }, 'A1')).toBe(20);
  });

  it('raises to a power, right-associatively', () => {
    // 2^(3^2) = 512, not (2^3)^2 = 64.
    expect(val({ A1: '=2^3^2' }, 'A1')).toBe(512);
  });

  it('handles unary minus', () => {
    expect(val({ A1: '=-5+2' }, 'A1')).toBe(-3);
  });

  it('refuses to divide by zero', () => {
    expect(val({ A1: '=1/0' }, 'A1')).toBe(ERRORS.div);
  });

  it('does not show floating point noise', () => {
    // 0.1 + 0.2 is 0.30000000000000004 in binary floating point. A cell that
    // shows that is a cell somebody stops trusting.
    expect(shown({ A1: '=0.1+0.2' }, 'A1')).toBe('0.3');
  });

  it('joins text with &', () => {
    expect(val({ A1: 'grp-', B1: 'payroll', C1: '=A1&B1' }, 'C1')).toBe('grp-payroll');
  });
});

describe('references', () => {
  it('follows a chain of cells', () => {
    expect(val({ A1: '2', B1: '=A1*3', C1: '=B1+1' }, 'C1')).toBe(7);
  });

  it('is case-insensitive about addresses', () => {
    expect(val({ A1: '5', B1: '=a1*2' }, 'B1')).toBe(10);
  });

  it('reads an absolute reference the same as a relative one', () => {
    expect(val({ A1: '5', B1: '=$A$1*2' }, 'B1')).toBe(10);
  });
});

describe('circular references', () => {
  it('reports a direct cycle instead of hanging', () => {
    expect(val({ A1: '=A1+1' }, 'A1')).toBe(ERRORS.circular);
  });

  it('reports an indirect cycle', () => {
    // The mistake people make within minutes of opening a spreadsheet.
    expect(val({ A1: '=B1+1', B1: '=A1+1' }, 'A1')).toBe(ERRORS.circular);
  });

  it('reports a three-cell cycle', () => {
    expect(val({ A1: '=B1', B1: '=C1', C1: '=A1' }, 'A1')).toBe(ERRORS.circular);
  });

  it('does not mistake a diamond for a cycle', () => {
    // B1 and C1 both read A1. Visiting A1 twice is not a loop, and an engine
    // that says it is would break most real sheets.
    expect(val({ A1: '2', B1: '=A1*2', C1: '=A1*3', D1: '=B1+C1' }, 'D1')).toBe(10);
  });
});

describe('errors propagate', () => {
  it('carries a division error through arithmetic', () => {
    expect(val({ A1: '=1/0', B1: '=A1*2' }, 'B1')).toBe(ERRORS.div);
  });

  it('carries an error out of a range function', () => {
    expect(val({ A1: '1', A2: '=1/0', A3: '=SUM(A1:A2)' }, 'A3')).toBe(ERRORS.div);
  });

  it('names an unknown function rather than returning zero', () => {
    expect(val({ A1: '=NOTAFUNCTION(1)' }, 'A1')).toBe(ERRORS.name);
  });

  it('reports a formula it cannot parse', () => {
    expect(val({ A1: '=1+' }, 'A1')).toBe(ERRORS.value);
    expect(val({ A1: '=SUM(' }, 'A1')).toBe(ERRORS.value);
  });
});

describe('functions', () => {
  const column = { A1: '10', A2: '20', A3: '30', A4: 'text' };

  it('sums a range, skipping text', () => {
    expect(val({ ...column, B1: '=SUM(A1:A4)' }, 'B1')).toBe(60);
  });

  it('averages only the numbers', () => {
    expect(val({ ...column, B1: '=AVERAGE(A1:A4)' }, 'B1')).toBe(20);
  });

  it('refuses to average nothing', () => {
    expect(val({ B1: '=AVERAGE(A1:A3)' }, 'B1')).toBe(ERRORS.div);
  });

  it('counts numbers and non-blanks differently', () => {
    expect(val({ ...column, B1: '=COUNT(A1:A4)' }, 'B1')).toBe(3);
    expect(val({ ...column, B1: '=COUNTA(A1:A4)' }, 'B1')).toBe(4);
  });

  it('counts by a condition, which is the dormancy question', () => {
    // "How many accounts have not signed in for more than sixty days" is the
    // single most useful thing an analyst asks of an export.
    const days = { A1: '5', A2: '90', A3: '120', A4: '0' };
    expect(val({ ...days, B1: '=COUNTIF(A1:A4,">60")' }, 'B1')).toBe(2);
  });

  it('counts by a text condition', () => {
    const status = { A1: 'active', A2: 'disabled', A3: 'active' };
    expect(val({ ...status, B1: '=COUNTIF(A1:A3,"active")' }, 'B1')).toBe(2);
  });

  it('sums by a condition', () => {
    const g = { A1: 'HR', A2: 'IT', A3: 'HR', B1: '5', B2: '3', B3: '2' };
    expect(val({ ...g, C1: '=SUMIF(A1:A3,"HR",B1:B3)' }, 'C1')).toBe(7);
  });

  it('chooses a branch with IF', () => {
    expect(val({ A1: '90', B1: '=IF(A1>60,"stale","fresh")' }, 'B1')).toBe('stale');
    expect(val({ A1: '5', B1: '=IF(A1>60,"stale","fresh")' }, 'B1')).toBe('fresh');
  });

  it('looks a value up in a table', () => {
    // Reconciling two exports, which is most of identity reporting.
    const table = {
      A1: 'jdoe', B1: 'Finance',
      A2: 'mchen', B2: 'HR',
      D1: '=VLOOKUP("mchen",A1:B2,2,2)',
    };
    expect(val(table, 'D1')).toBe('HR');
  });

  it('reports a lookup that finds nothing', () => {
    const table = { A1: 'jdoe', B1: 'Finance', D1: '=VLOOKUP("nobody",A1:B1,2,2)' };
    expect(val(table, 'D1')).toBe(ERRORS.ref);
  });

  it('handles text functions', () => {
    expect(val({ A1: '  jdoe  ', B1: '=UPPER(TRIM(A1))' }, 'B1')).toBe('JDOE');
    expect(val({ A1: 'jdoe', B1: '=LEN(A1)' }, 'B1')).toBe(4);
  });

  it('rounds', () => {
    expect(val({ A1: '=ROUND(2.567,2)' }, 'A1')).toBe(2.57);
    expect(val({ A1: '=ROUND(2.567,0)' }, 'A1')).toBe(3);
  });

  it('compares with the comparison operators', () => {
    expect(val({ A1: '=5>3' }, 'A1')).toBe(true);
    expect(val({ A1: '=5<>5' }, 'A1')).toBe(false);
  });
});

describe('CSV', () => {
  it('reads a file into cells', () => {
    const grid = fromCsv('user,dept\njdoe,Finance');
    expect(grid.get('A1')?.input).toBe('user');
    expect(grid.get('B2')?.input).toBe('Finance');
  });

  it('honours quotes and embedded commas', () => {
    // The Log Search export quotes notes containing commas; losing that would
    // shift every column after it.
    const grid = fromCsv('a,"one, two",c');
    expect(grid.get('B1')?.input).toBe('one, two');
    expect(grid.get('C1')?.input).toBe('c');
  });

  it('honours escaped quotes', () => {
    expect(fromCsv('"he said ""no"""').get('A1')?.input).toBe('he said "no"');
  });

  it('handles CRLF as one line break', () => {
    const grid = fromCsv('a\r\nb');
    expect(grid.get('A1')?.input).toBe('a');
    expect(grid.get('A2')?.input).toBe('b');
  });

  it('writes values rather than formulas', () => {
    // Somebody opening the export wants the answer, not the working.
    const s = sheet({ A1: '2', B1: '=A1*3' });
    expect(toCsv(s, 1, 2)).toBe('2,6');
  });

  it('quotes a value containing a comma on the way out', () => {
    const s = sheet({ A1: 'one, two' });
    expect(toCsv(s, 1, 1)).toBe('"one, two"');
  });

  it('round-trips', () => {
    const original = 'user,dept\njdoe,Finance\nmchen,HR';
    const grid = fromCsv(original);
    const bounds = usedBounds(grid);
    expect(toCsv({ cells: grid }, bounds.rows, bounds.cols)).toBe(original);
  });
});

describe('used bounds', () => {
  it('measures the furthest cell holding anything', () => {
    expect(usedBounds(fromCsv('a,b,c\nd'))).toEqual({ rows: 2, cols: 3 });
  });

  it('is empty for an empty grid', () => {
    expect(usedBounds(new Map())).toEqual({ rows: 0, cols: 0 });
  });
});

describe('cell ids', () => {
  it('builds an id from coordinates', () => {
    expect(cellId(0, 0)).toBe('A1');
    expect(cellId(27, 9)).toBe('AB10');
  });
});
