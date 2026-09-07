/**
 * ui/consoles/sheetWindow.ts — Sheets.
 *
 * Identity work lives in spreadsheets. An access review export, a dormant
 * account list, a group membership dump, a licence reconciliation — the
 * analyst opens all of them and starts counting. The workstation could produce
 * those CSVs from Log Search and Access Reviews and had nowhere to open them.
 *
 * The evaluator is in vm/spreadsheet.ts, tested apart from this. What is here
 * is the grid: selection, editing, keyboard navigation and the formula bar,
 * behaving the way the one people already know behaves — Enter commits and
 * moves down, Tab moves right, Escape abandons, F2 and double-click edit in
 * place, Delete clears.
 *
 * The selected cell shows its formula while the others show their value. That
 * is the single most important behaviour in a spreadsheet: the sheet is a
 * report until you click a number and see how it was worked out.
 */
import {
  cellId,
  columnName,
  evaluate,
  formatValue,
  fromCsv,
  isError,
  toCsv,
  usedBounds,
  FUNCTION_NAMES,
} from '@/vm/spreadsheet';
import type { Grid, Sheet } from '@/vm/spreadsheet';
import { appButton } from '@/ui/appChrome';
import { FS } from '@/terminal/shellIntrinsics';
import { showToast } from '@/ui/toast';

const ROWS = 60;
const COLS = 18;

const STYLES = `
  .sh-root {
    display: flex; flex-direction: column; height: 100%; background: var(--panel);
    color: var(--fg); font-family: "Segoe UI", system-ui, sans-serif; font-size: 12px;
  }
  .sh-bar {
    flex-shrink: 0; display: flex; align-items: center; gap: 8px; padding: 7px 10px;
    background: var(--panel-alt); border-bottom: 1px solid var(--border); flex-wrap: wrap;
  }
  /* Buttons come from the shared chrome (.app-btn). */
  .sh-formula-row {
    flex-shrink: 0; display: flex; align-items: stretch; gap: 6px; padding: 6px 10px;
    background: var(--panel-alt); border-bottom: 1px solid var(--border);
  }
  .sh-addr {
    width: 74px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
    background: var(--panel); border: 1px solid var(--border); border-radius: 4px;
    font-family: ui-monospace, Consolas, monospace; font-weight: 600;
  }
  .sh-fx { color: var(--muted); align-self: center; font-style: italic; padding: 0 2px; }
  .sh-formula {
    flex: 1; min-width: 0; padding: 6px 9px; border-radius: 4px;
    background: var(--panel); color: var(--fg); border: 1px solid var(--border);
    font-family: ui-monospace, Consolas, monospace; font-size: 12.5px;
  }
  .sh-formula:focus { outline: none; border-color: var(--accent); }
  .sh-grid-pane { flex: 1 1 auto; min-height: 0; overflow: auto; }
  .sh-table { border-collapse: collapse; table-layout: fixed; }
  .sh-table th, .sh-table td {
    border: 1px solid var(--border); height: 22px; padding: 0;
  }
  .sh-corner, .sh-colhead, .sh-rowhead {
    background: var(--panel-alt); color: var(--muted); font-weight: 600;
    font-size: 10.5px; text-align: center; position: sticky; user-select: none;
  }
  .sh-colhead { top: 0; z-index: 2; width: 96px; }
  .sh-rowhead { left: 0; z-index: 2; width: 42px; }
  .sh-corner { top: 0; left: 0; z-index: 3; width: 42px; }
  .sh-colhead.on, .sh-rowhead.on { background: var(--accent); color: var(--on-accent); }
  .sh-cell {
    padding: 0 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    cursor: cell; max-width: 96px;
  }
  .sh-cell.num { text-align: right; font-variant-numeric: tabular-nums; }
  .sh-cell.err { color: var(--err); font-weight: 600; }
  .sh-cell.sel { outline: 2px solid var(--accent); outline-offset: -2px; }
  .sh-editor {
    width: 100%; height: 100%; box-sizing: border-box; padding: 0 5px; border: none;
    background: var(--panel); color: var(--fg); font-family: inherit; font-size: 12px;
  }
  .sh-editor:focus { outline: none; }
  .sh-status {
    flex-shrink: 0; display: flex; gap: 16px; padding: 5px 12px; background: var(--panel-alt);
    border-top: 1px solid var(--border); color: var(--muted); font-size: 11px;
  }
`;

export function renderSheetWindow(body: HTMLElement): void {
  if (!document.getElementById('sheets-css')) {
    const style = document.createElement('style');
    style.id = 'sheets-css';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  const grid: Grid = new Map();
  const sheet: Sheet = { cells: grid };
  let sel = { col: 0, row: 0 };
  let editing = false;
  /**
   * The cell the formula bar is currently editing.
   *
   * Not the same thing as the selection. With the caret in the bar and a click
   * on another cell, the selection moves first and the blur fires afterwards —
   * committing to the selection would write the old formula into the new cell.
   */
  let formulaFor: string | null = null;

  const root = document.createElement('div');
  root.className = 'sh-root';
  const bar = document.createElement('div');
  bar.className = 'sh-bar';
  const formulaRow = document.createElement('div');
  formulaRow.className = 'sh-formula-row';
  const pane = document.createElement('div');
  pane.className = 'sh-grid-pane';
  const status = document.createElement('div');
  status.className = 'sh-status';
  root.append(bar, formulaRow, pane, status);

  const addr = document.createElement('div');
  addr.className = 'sh-addr';
  const fx = document.createElement('span');
  fx.className = 'sh-fx';
  fx.textContent = 'fx';
  const formula = document.createElement('input');
  formula.className = 'sh-formula';
  formula.spellcheck = false;
  formulaRow.append(addr, fx, formula);

  const selId = (): string => cellId(sel.col, sel.row);
  const inputOf = (id: string): string => grid.get(id)?.input ?? '';

  function setCell(id: string, input: string): void {
    if (input === '') grid.delete(id);
    else grid.set(id, { input });
  }

  function button(label: string, onClick: () => void, title = ''): HTMLButtonElement {
    return appButton(label, onClick, title ? { title } : {});
  }

  // ---- Toolbar -----------------------------------------------------------

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.csv,text/csv,text/plain';
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    void file.text().then((text) => {
      grid.clear();
      for (const [id, cell] of fromCsv(text)) grid.set(id, cell);
      sel = { col: 0, row: 0 };
      showToast(`Opened ${file.name}.`, { kind: 'success' });
      render();
    });
    fileInput.value = '';
  });

  bar.append(
    button('📂 Open CSV', () => fileInput.click(), 'Open an export from Log Search or a review'),
    button('💾 Save CSV', () => {
      const bounds = usedBounds(grid);
      if (bounds.rows === 0) {
        showToast('Nothing to save — the sheet is empty.', { kind: 'warn' });
        return;
      }
      // Values, not formulas: somebody opening this wants the answer.
      const csv = toCsv(sheet, bounds.rows, bounds.cols);
      const name = `sheet-${new Date().toISOString().slice(0, 10)}.csv`;
      try {
        FS.writeFile(`C:\\Users\\admin\\Documents\\${name}`, csv);
      } catch {
        /* the download below is the copy that matters */
      }
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      showToast(`Saved to Documents as ${name}.`, { kind: 'success' });
    }),
    button('🧹 Clear', () => {
      if (!window.confirm('Clear the whole sheet?')) return;
      grid.clear();
      render();
    }),
    button('ƒ Functions', () => {
      showToast(FUNCTION_NAMES.join(', '), { kind: 'info', durationMs: 9000 });
    }, 'What this sheet can calculate'),
    fileInput,
  );

  // ---- The grid ----------------------------------------------------------

  function commitFormula(): void {
    // To the cell the bar was opened on, never to whatever is selected now.
    setCell(formulaFor ?? selId(), formula.value);
    formulaFor = null;
    render();
  }

  formula.addEventListener('focus', () => {
    formulaFor = selId();
  });
  formula.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitFormula();
      move(0, 1);
    } else if (e.key === 'Escape') {
      formulaFor = null;
      formula.value = inputOf(selId());
      focusGrid();
    }
  });
  formula.addEventListener('blur', () => {
    const target = formulaFor;
    if (target !== null && formula.value !== inputOf(target)) commitFormula();
    else formulaFor = null;
  });

  function focusGrid(): void {
    pane.focus();
  }

  function move(dc: number, dr: number): void {
    sel = {
      col: Math.min(COLS - 1, Math.max(0, sel.col + dc)),
      row: Math.min(ROWS - 1, Math.max(0, sel.row + dr)),
    };
    editing = false;
    render();
  }

  function beginEdit(seedWith?: string): void {
    editing = true;
    render();
    const input = pane.querySelector<HTMLInputElement>('.sh-editor');
    if (!input) return;
    if (seedWith !== undefined) input.value = seedWith;
    input.focus();
    // Typing over a cell replaces it; F2 puts the caret at the end to amend.
    input.setSelectionRange(input.value.length, input.value.length);
  }

  pane.tabIndex = 0;
  pane.addEventListener('keydown', (e) => {
    if (editing) return;
    switch (e.key) {
      case 'ArrowUp': e.preventDefault(); move(0, -1); return;
      case 'ArrowDown': e.preventDefault(); move(0, 1); return;
      case 'ArrowLeft': e.preventDefault(); move(-1, 0); return;
      case 'ArrowRight': e.preventDefault(); move(1, 0); return;
      case 'Tab': e.preventDefault(); move(e.shiftKey ? -1 : 1, 0); return;
      case 'Enter': case 'F2': e.preventDefault(); beginEdit(); return;
      case 'Delete': case 'Backspace':
        e.preventDefault();
        setCell(selId(), '');
        render();
        return;
      default:
        // Typing a printable character starts an edit, replacing what was
        // there — the behaviour every spreadsheet has.
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          beginEdit(e.key);
        }
    }
  });

  function renderGrid(): void {
    pane.innerHTML = '';
    const table = document.createElement('table');
    table.className = 'sh-table';

    const head = document.createElement('tr');
    const corner = document.createElement('th');
    corner.className = 'sh-corner';
    head.appendChild(corner);
    for (let c = 0; c < COLS; c += 1) {
      const th = document.createElement('th');
      th.className = 'sh-colhead' + (c === sel.col ? ' on' : '');
      th.textContent = columnName(c);
      head.appendChild(th);
    }
    table.appendChild(head);

    for (let r = 0; r < ROWS; r += 1) {
      const tr = document.createElement('tr');
      const rowHead = document.createElement('th');
      rowHead.className = 'sh-rowhead' + (r === sel.row ? ' on' : '');
      rowHead.textContent = String(r + 1);
      tr.appendChild(rowHead);

      for (let c = 0; c < COLS; c += 1) {
        const id = cellId(c, r);
        const td = document.createElement('td');
        const isSel = c === sel.col && r === sel.row;

        if (isSel && editing) {
          const input = document.createElement('input');
          input.className = 'sh-editor';
          input.value = inputOf(id);
          input.spellcheck = false;
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              setCell(id, input.value);
              editing = false;
              move(0, 1);
              focusGrid();
            } else if (e.key === 'Tab') {
              e.preventDefault();
              setCell(id, input.value);
              editing = false;
              move(e.shiftKey ? -1 : 1, 0);
              focusGrid();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              editing = false;
              render();
              focusGrid();
            }
          });
          input.addEventListener('blur', () => {
            if (!editing) return;
            setCell(id, input.value);
            editing = false;
            render();
          });
          td.appendChild(input);
        } else {
          const value = evaluate(sheet, id);
          const text = formatValue(value);
          td.className =
            'sh-cell' +
            (typeof value === 'number' ? ' num' : '') +
            (isError(value) ? ' err' : '') +
            (isSel ? ' sel' : '');
          td.textContent = text;
          td.title = text;
          td.addEventListener('mousedown', () => {
            // Commit anything pending in the formula bar to the cell it
            // belongs to, before the selection moves.
            if (formulaFor !== null && formula.value !== inputOf(formulaFor)) commitFormula();
            formulaFor = null;
            sel = { col: c, row: r };
            editing = false;
            render();
            focusGrid();
          });
          td.addEventListener('dblclick', () => {
            sel = { col: c, row: r };
            beginEdit();
          });
        }
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    pane.appendChild(table);
  }

  function render(): void {
    const id = selId();
    addr.textContent = id;
    // The selected cell shows its formula; every other cell shows its value.
    // That is what makes a sheet auditable rather than a wall of numbers.
    //
    // Resynced whenever the bar is not editing this exact cell. Skipping the
    // update whenever the bar merely had focus left it showing the previously
    // edited cell's formula after a click elsewhere.
    if (formulaFor !== id) formula.value = inputOf(id);
    renderGrid();

    const value = evaluate(sheet, id);
    const bounds = usedBounds(grid);
    status.innerHTML = '';
    for (const text of [
      `${id}: ${formatValue(value) || '(empty)'}`,
      `${bounds.rows} row(s) × ${bounds.cols} column(s) used`,
      'Enter edits · Tab moves right · Delete clears',
    ]) {
      const span = document.createElement('span');
      span.textContent = text;
      status.appendChild(span);
    }
  }

  render();
  body.innerHTML = '';
  body.appendChild(root);
  focusGrid();
}
