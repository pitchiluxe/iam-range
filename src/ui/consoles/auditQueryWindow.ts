/**
 * ui/consoles/auditQueryWindow.ts — Log Search.
 *
 * The audit log was reachable in two places: a scrolling tail at the bottom of
 * the ticket console, and a CSV export. Neither answers what an identity
 * engineer is asked — who granted this, what changed on Tuesday, show me every
 * privileged activation.
 *
 * A query bar rather than filter dropdowns. Dropdowns would have been quicker
 * and would teach nothing; every tool a learner meets afterwards is a text
 * query of `field:value` terms, and fluency in that shape transfers in a way
 * that clicking a chip does not. The saved questions down the side exist so
 * the grammar is learnable by example — clicking one fills the box rather than
 * running something opaque, so the next query can be edited from it.
 */
import type { VmServices } from '@/vm/session';
import { runQuery, SAVED_QUERIES, toCsv } from '@/vm/auditQuery';
import type { AuditRow } from '@/vm/auditQuery';
import { showToast } from '@/ui/toast';

/** Colour by family, so a screenful of events has shape before it is read. */
function actionColor(action: string): string {
  if (action.startsWith('pim.')) return '#b57edc';
  if (action.startsWith('cloud.') || action.startsWith('scim.')) return '#5b8def';
  if (action.startsWith('ticket.')) return '#d7ba7d';
  if (action.startsWith('signin.') || action.startsWith('session.')) return '#7fd1c1';
  if (/deleted|disabled|revoke|failure|remove|Breached/i.test(action)) return 'var(--err)';
  return 'var(--accent)';
}

const STYLES = `
  .ls-root {
    display: flex; flex-direction: column; height: 100%;
    background: var(--panel); color: var(--fg);
    font-family: "Segoe UI", system-ui, sans-serif; font-size: 12px;
  }
  .ls-bar {
    flex-shrink: 0; display: flex; gap: 8px; align-items: center;
    padding: 10px 12px; border-bottom: 1px solid var(--border); background: var(--panel-alt);
  }
  .ls-input {
    flex: 1; min-width: 0; padding: 7px 11px; border-radius: 6px;
    background: var(--panel); color: var(--fg); border: 1px solid var(--border);
    font-family: ui-monospace, Consolas, monospace; font-size: 12.5px;
  }
  .ls-input:focus { outline: none; border-color: var(--accent); }
  .ls-bar button {
    font-family: inherit; font-size: 11.5px; padding: 6px 12px; border-radius: 5px;
    cursor: pointer; background: transparent; color: var(--muted);
    border: 1px solid var(--border); white-space: nowrap;
  }
  .ls-bar button.primary {
    background: var(--accent); color: var(--on-accent); border-color: var(--accent);
  }
  .ls-split { flex: 1 1 auto; min-height: 0; display: flex; }
  .ls-side {
    flex: 0 0 232px; border-right: 1px solid var(--border); overflow: auto;
    background: var(--panel-alt); padding: 10px 0;
  }
  .ls-side h4 {
    margin: 0 0 6px; padding: 0 12px; font-size: 10px; text-transform: uppercase;
    letter-spacing: 0.07em; color: var(--muted); font-weight: 600;
  }
  .ls-saved {
    display: block; width: 100%; text-align: left; background: transparent;
    border: none; border-left: 2px solid transparent; cursor: pointer;
    padding: 7px 12px; color: var(--fg); font-family: inherit; font-size: 11.5px;
  }
  .ls-saved:hover { background: rgba(127,127,127,0.10); }
  .ls-saved.active { border-left-color: var(--accent); background: rgba(78,201,176,0.12); }
  .ls-saved-why { display: block; color: var(--muted); font-size: 10.5px; margin-top: 2px;
    line-height: 1.45; }
  .ls-results { flex: 1 1 auto; min-width: 0; overflow: auto; }
  .ls-table { width: 100%; border-collapse: collapse; }
  .ls-table th {
    position: sticky; top: 0; z-index: 1; text-align: left; padding: 7px 10px;
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--muted); font-weight: 600; background: var(--panel-alt);
    border-bottom: 1px solid var(--border); white-space: nowrap;
  }
  .ls-table td {
    padding: 5px 10px; border-bottom: 1px solid var(--border); vertical-align: top;
    font-size: 11.5px;
  }
  .ls-time {
    font-family: ui-monospace, Consolas, monospace; color: var(--muted);
    white-space: nowrap; font-size: 11px;
  }
  .ls-action { font-family: ui-monospace, Consolas, monospace; white-space: nowrap; }
  .ls-note { color: var(--muted); }
  .ls-status {
    flex-shrink: 0; padding: 6px 12px; border-top: 1px solid var(--border);
    color: var(--muted); font-size: 11px; background: var(--panel-alt);
  }
  .ls-error {
    margin: 8px 12px; padding: 8px 11px; border-radius: 6px; line-height: 1.55;
    background: rgba(255,154,138,0.10); border: 1px solid rgba(255,154,138,0.45);
    color: var(--err); font-size: 11.5px;
  }
  .ls-empty { padding: 30px 16px; color: var(--muted); line-height: 1.7; }
  .ls-empty code {
    font-family: ui-monospace, Consolas, monospace; color: var(--accent);
    background: var(--panel-alt); padding: 1px 5px; border-radius: 3px;
  }
`;

export function renderAuditQueryWindow(body: HTMLElement, conductor: VmServices): void {
  if (!document.getElementById('log-search-css')) {
    const style = document.createElement('style');
    style.id = 'log-search-css';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  let query = 'since:24h';
  let lastRows: AuditRow[] = [];

  const root = document.createElement('div');
  root.className = 'ls-root';

  const bar = document.createElement('div');
  bar.className = 'ls-bar';

  const input = document.createElement('input');
  input.className = 'ls-input';
  input.value = query;
  input.spellcheck = false;
  input.placeholder = 'actor:admin action:group.add since:24h';
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      query = input.value;
      render();
    }
  });

  const split = document.createElement('div');
  split.className = 'ls-split';
  const side = document.createElement('div');
  side.className = 'ls-side';
  const results = document.createElement('div');
  results.className = 'ls-results';
  split.append(side, results);

  const status = document.createElement('div');
  status.className = 'ls-status';

  function button(label: string, primary: boolean, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    if (primary) b.className = 'primary';
    b.addEventListener('click', onClick);
    return b;
  }

  bar.append(
    input,
    button('Search', true, () => {
      query = input.value;
      render();
    }),
    button('⬇ CSV', false, () => {
      if (lastRows.length === 0) {
        showToast('Nothing to export — that query returned no rows.', { kind: 'warn' });
        return;
      }
      const blob = new Blob([toCsv(lastRows)], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `iam-range-log-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast(`Exported ${lastRows.length} row(s).`, { kind: 'success' });
    }),
  );

  root.append(bar, split, status);

  function renderSide(): void {
    side.innerHTML = '';
    const h = document.createElement('h4');
    h.textContent = 'Questions worth asking';
    side.appendChild(h);
    for (const saved of SAVED_QUERIES) {
      const b = document.createElement('button');
      b.className = 'ls-saved' + (saved.query === query ? ' active' : '');
      const label = document.createElement('span');
      label.textContent = saved.label;
      const why = document.createElement('span');
      why.className = 'ls-saved-why';
      why.textContent = saved.why;
      b.append(label, why);
      b.addEventListener('click', () => {
        // Fill the box rather than run something opaque: the next query gets
        // edited from this one, which is how the grammar is learned.
        query = saved.query;
        input.value = saved.query;
        render();
      });
      side.appendChild(b);
    }
  }

  function renderResults(): void {
    results.innerHTML = '';
    const { rows, errors } = runQuery(conductor, query);
    lastRows = rows;

    for (const error of errors) {
      const box = document.createElement('div');
      box.className = 'ls-error';
      box.textContent = error;
      results.appendChild(box);
    }

    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ls-empty';
      empty.appendChild(document.createTextNode('No events match that query. Terms combine with AND — try removing one, or widen the window with '));
      const code = document.createElement('code');
      code.textContent = 'since:7d';
      empty.appendChild(code);
      empty.appendChild(document.createTextNode('.'));
      results.appendChild(empty);
      status.textContent = `0 of ${conductor.audit.events.length} events`;
      return;
    }

    const table = document.createElement('table');
    table.className = 'ls-table';
    const head = document.createElement('tr');
    for (const label of ['Time', 'Action', 'Actor', 'Target', 'Subject', 'Note']) {
      const th = document.createElement('th');
      th.textContent = label;
      head.appendChild(th);
    }
    table.appendChild(head);

    // Capped for the DOM's sake; the count in the status bar is the truth and
    // CSV export is unbounded, so nothing is hidden without being said.
    for (const row of rows.slice(0, 500)) {
      const tr = document.createElement('tr');

      const time = document.createElement('td');
      time.className = 'ls-time';
      time.textContent = new Date(row.at).toLocaleString();

      const action = document.createElement('td');
      action.className = 'ls-action';
      action.textContent = row.action;
      action.style.color = actionColor(row.action);

      const actor = document.createElement('td');
      actor.textContent = row.actor;
      const target = document.createElement('td');
      target.textContent = row.target;
      const subject = document.createElement('td');
      subject.textContent = row.subject;
      const note = document.createElement('td');
      note.className = 'ls-note';
      note.textContent = row.note;

      tr.append(time, action, actor, target, subject, note);
      table.appendChild(tr);
    }
    results.appendChild(table);

    const shown = Math.min(rows.length, 500);
    status.textContent =
      `${rows.length} of ${conductor.audit.events.length} events` +
      (shown < rows.length ? ` — showing the newest ${shown}. Export to CSV for all of them.` : '');
  }

  function render(): void {
    renderSide();
    renderResults();
  }

  render();
  body.innerHTML = '';
  body.appendChild(root);
  input.focus();
}
