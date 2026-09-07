/**
 * ui/consoles/calculatorWindow.ts — Windows-style calculator for the VM.
 *
 * Standard four-function calculator with a running expression line, keyboard
 * support and a short history, so it behaves the way a learner expects when
 * they reach for it mid-ticket (SLA arithmetic, licence counts, review
 * percentages).
 *
 * Evaluation is a hand-written shunting-yard over a tokenised expression, not
 * eval() — the input is trusted here, but a calculator that reaches for eval is
 * a habit worth not teaching, and this keeps division-by-zero and malformed
 * input as explicit, testable cases.
 */
import { evaluateExpression } from '@/util/calculator';

const KEYS: ReadonlyArray<ReadonlyArray<string>> = [
  ['C', '±', '%', '÷'],
  ['7', '8', '9', '×'],
  ['4', '5', '6', '−'],
  ['1', '2', '3', '+'],
  ['0', '.', '⌫', '='],
];

/** Operator glyphs on the buttons vs what the evaluator parses. */
const OP_FOR: Record<string, string> = { '÷': '/', '×': '*', '−': '-', '+': '+' };

export function renderCalculatorWindow(body: HTMLElement): void {
  body.innerHTML = '';
  // Additive, so the window manager's flex sizing survives.
  Object.assign(body.style, {
    overflow: 'hidden',
    background: '#1a1d22',
    flex: '1',
    minHeight: '0',
  });

  const root = document.createElement('div');
  root.style.cssText =
    'display:flex;flex-direction:column;height:100%;' +
    "font-family:'Segoe UI',-apple-system,sans-serif;color:var(--fg);";
  body.appendChild(root);

  // ── Display ───────────────────────────────────────────────────────────────
  const display = document.createElement('div');
  display.style.cssText =
    'padding:14px 16px 10px;text-align:right;background:var(--panel);flex-shrink:0;';

  const exprEl = document.createElement('div');
  exprEl.style.cssText =
    'font-size:12px;color:#6b7280;min-height:16px;font-family:Consolas,monospace;' +
    'word-break:break-all;';
  const valueEl = document.createElement('div');
  valueEl.style.cssText = 'font-size:30px;font-weight:300;margin-top:4px;word-break:break-all;';
  valueEl.textContent = '0';
  display.append(exprEl, valueEl);
  root.appendChild(display);

  // ── State ─────────────────────────────────────────────────────────────────
  /** The expression being typed, in evaluator syntax. */
  let expr = '';
  /** What the big line shows: the live entry, or the last result. */
  let shown = '0';

  const redraw = (): void => {
    exprEl.textContent = expr;
    valueEl.textContent = shown;
  };

  const endsWithOperator = (): boolean => /[+\-*/]$/.test(expr);

  function press(key: string): void {
    if (key === 'C') {
      expr = '';
      shown = '0';
    } else if (key === '⌫') {
      expr = expr.slice(0, -1);
      shown = expr || '0';
    } else if (key === '±') {
      // Negate the number currently being entered.
      const m = expr.match(/(-?\d*\.?\d+)$/);
      if (m) {
        const n = m[1]!;
        const negated = n.startsWith('-') ? n.slice(1) : `-${n}`;
        expr = expr.slice(0, -n.length) + negated;
        shown = expr;
      }
    } else if (key === '%') {
      const m = expr.match(/(\d*\.?\d+)$/);
      if (m) {
        const n = m[1]!;
        expr = expr.slice(0, -n.length) + String(Number(n) / 100);
        shown = expr;
      }
    } else if (key === '=') {
      if (!expr) return;
      const result = evaluateExpression(expr);
      if (result.ok) {
        exprEl.textContent = `${expr} =`;
        shown = String(result.value);
        expr = String(result.value);
        valueEl.textContent = shown;
        return; // exprEl already set to the completed sum
      }
      shown = result.error;
      expr = '';
    } else if (key in OP_FOR) {
      const op = OP_FOR[key]!;
      if (!expr) {
        // Allow a leading minus, but not a leading times/divide.
        if (op !== '-') return;
        expr = '-';
      } else if (endsWithOperator()) {
        expr = expr.slice(0, -1) + op; // replace, don't stack
      } else {
        expr += op;
      }
      shown = expr;
    } else if (key === '.') {
      // One decimal point per number.
      const current = expr.split(/[+\-*/]/).pop() ?? '';
      if (current.includes('.')) return;
      expr += current === '' ? '0.' : '.';
      shown = expr;
    } else {
      // Digit. Avoid a leading run of zeros.
      if (expr === '0') expr = '';
      expr += key;
      shown = expr;
    }
    redraw();
  }

  // ── Keypad ────────────────────────────────────────────────────────────────
  const pad = document.createElement('div');
  pad.style.cssText =
    'flex:1;display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--border);' +
    'min-height:0;';
  for (const row of KEYS) {
    for (const key of row) {
      const b = document.createElement('button');
      b.textContent = key;
      const isOp = key in OP_FOR || key === '=';
      b.style.cssText =
        `border:none;cursor:pointer;font-size:16px;color:${key === '=' ? '#06231d' : 'var(--fg)'};` +
        `background:${key === '=' ? 'var(--accent)' : isOp ? '#242a32' : '#1f242b'};` +
        'transition:background .1s;';
      b.addEventListener('mouseenter', () => {
        if (key !== '=') b.style.background = 'var(--border)';
      });
      b.addEventListener('mouseleave', () => {
        b.style.background = key === '=' ? 'var(--accent)' : isOp ? '#242a32' : '#1f242b';
      });
      b.addEventListener('click', () => press(key));
      pad.appendChild(b);
    }
  }
  root.appendChild(pad);

  // ── Keyboard ──────────────────────────────────────────────────────────────
  // Scoped to this window: the handler checks the body is still in the DOM and
  // that the calculator is the focused window's content, so typing elsewhere in
  // the VM is unaffected.
  const onKey = (e: KeyboardEvent): void => {
    if (!document.contains(body)) {
      document.removeEventListener('keydown', onKey);
      return;
    }
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
      return;
    }
    if (
      !body.closest('[data-win-id]')?.contains(document.activeElement) &&
      document.activeElement !== document.body
    ) {
      // Another window owns focus.
      return;
    }

    const k = e.key;
    if (/^[0-9]$/.test(k)) press(k);
    else if (k === '.') press('.');
    else if (k === '+') press('+');
    else if (k === '-') press('−');
    else if (k === '*') press('×');
    else if (k === '/') press('÷');
    else if (k === 'Enter' || k === '=') press('=');
    else if (k === 'Backspace') press('⌫');
    else if (k === 'Escape') press('C');
    else return;
    e.preventDefault();
  };
  document.addEventListener('keydown', onKey);

  redraw();
}
