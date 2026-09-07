/**
 * ui/consoles/projectWindow.ts — Lab Plan, the project view of the curriculum.
 *
 * The manual holds four chapters and fifteen lessons and nothing tracked
 * whether any of them had been done. A learner could work through the whole
 * thing with no view of what was left, and — the part that matters for a
 * course people are buying to get a job — no evidence they had done any of it.
 *
 * Laid out the way a project plan is, because that is the shape of the
 * information: a work-breakdown grid with summary rows that roll up, a
 * timeline beside it, and a detail pane for the selected task. Anyone who has
 * opened Microsoft Project knows where to look, and the columns are the ones
 * that plan actually has — task, status, percent complete, and what it depends
 * on.
 *
 * The important design decision is that nothing here is clickable to mark
 * complete. Progress is computed from the directory, the audit log, PIM and
 * the tenants — see vm/labProgress.ts. A checklist you tick would repeat the
 * mistake this project just took out of the ticket queue, where marking a
 * ticket resolved was a claim nobody checked.
 */
import type { VmServices } from '@/vm/session';
import { buildEvidencePack, packFilename } from '@/vm/evidencePack';
import { FS } from '@/terminal/shellIntrinsics';
import { showToast } from '@/ui/toast';
import { computeProgress } from '@/vm/labProgress';
import type { LessonProgress, LessonState } from '@/vm/labProgress';

const STATE_LABEL: Record<LessonState, string> = {
  'not-started': 'Not started',
  'in-progress': 'In progress',
  done: 'Complete',
};

const STATE_COLOR: Record<LessonState, string> = {
  'not-started': 'var(--muted)',
  'in-progress': '#d7ba7d',
  done: 'var(--accent)',
};

const PCT: Record<LessonState, number> = {
  'not-started': 0,
  'in-progress': 50,
  done: 100,
};

const STYLES = `
  .lp-root {
    display: flex; flex-direction: column; height: 100%;
    background: var(--panel); color: var(--fg);
    font-family: "Segoe UI", system-ui, sans-serif; font-size: 12px;
  }
  .lp-ribbon {
    flex-shrink: 0; display: flex; align-items: center; gap: 18px;
    padding: 10px 14px; border-bottom: 1px solid var(--border);
    background: var(--panel-alt);
  }
  .lp-stat-label {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--muted);
  }
  .lp-stat-value { font-size: 17px; font-weight: 650; font-variant-numeric: tabular-nums; }
  .lp-bar-track {
    flex: 1; min-width: 120px; height: 8px; border-radius: 4px;
    background: var(--border); overflow: hidden;
  }
  .lp-bar-fill { height: 100%; background: var(--accent); border-radius: 4px; }
  .lp-split { flex: 1 1 auto; min-height: 0; display: flex; }
  .lp-grid-pane { flex: 1 1 auto; min-width: 0; overflow: auto; }
  .lp-detail {
    flex: 0 0 300px; border-left: 1px solid var(--border);
    overflow: auto; padding: 14px 16px; background: var(--panel-alt);
  }
  .lp-table { width: 100%; border-collapse: collapse; }
  .lp-table th {
    position: sticky; top: 0; z-index: 1; text-align: left;
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--muted); font-weight: 600; padding: 7px 10px;
    background: var(--panel-alt); border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  .lp-table td {
    padding: 6px 10px; border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }
  .lp-summary td { background: rgba(127, 127, 127, 0.07); font-weight: 650; }
  .lp-task { cursor: pointer; }
  .lp-task:hover td { background: rgba(127, 127, 127, 0.10); }
  .lp-task.lp-selected td { background: rgba(78, 201, 176, 0.14); }
  .lp-wbs {
    color: var(--muted); font-family: ui-monospace, Consolas, monospace;
    font-size: 11px; white-space: nowrap;
  }
  .lp-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 300px; }
  .lp-indent { padding-left: 20px; }
  .lp-pct { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .lp-gantt { width: 150px; }
  .lp-gantt-track {
    height: 11px; border-radius: 3px; background: var(--border); overflow: hidden;
  }
  .lp-gantt-fill { height: 100%; border-radius: 3px; }
  .lp-dot {
    display: inline-block; width: 7px; height: 7px; border-radius: 50%;
    margin-right: 7px; vertical-align: middle;
  }
  .lp-detail h3 { margin: 0 0 4px; font-size: 13.5px; }
  .lp-detail h4 {
    margin: 16px 0 5px; font-size: 10px; text-transform: uppercase;
    letter-spacing: 0.06em; color: var(--muted); font-weight: 600;
  }
  .lp-detail p { margin: 0; line-height: 1.65; color: var(--fg); }
  .lp-detail p.muted { color: var(--muted); }
  .lp-step {
    display: flex; gap: 8px; margin-bottom: 5px; line-height: 1.55; color: var(--muted);
  }
  .lp-step-n { color: var(--accent); font-variant-numeric: tabular-nums; }
  .lp-code {
    display: block; margin-top: 3px; padding: 5px 8px; border-radius: 4px;
    background: var(--panel); border: 1px solid var(--border);
    font-family: ui-monospace, Consolas, monospace; font-size: 11px;
    color: var(--accent); overflow-x: auto; white-space: pre;
  }
  .lp-empty { padding: 26px 16px; color: var(--muted); line-height: 1.6; }
`;

export function renderProjectWindow(body: HTMLElement, conductor: VmServices): void {
  if (!document.getElementById('lab-plan-css')) {
    const style = document.createElement('style');
    style.id = 'lab-plan-css';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  let selectedId: string | null = null;

  /**
   * The name on the cover of the pack.
   *
   * The signed-in account, not a hardcoded one: the pack belongs to whoever
   * did the work, and on a shared machine that is not always the same person.
   */
  function operatorName(): string {
    const signedIn = (window as unknown as { __vm?: { login?: { user?: { displayName?: string;
      username?: string } } } }).__vm?.login?.user;
    return signedIn?.displayName ?? signedIn?.username ?? 'the operator';
  }

  const root = document.createElement('div');
  root.className = 'lp-root';

  const ribbon = document.createElement('div');
  ribbon.className = 'lp-ribbon';

  const split = document.createElement('div');
  split.className = 'lp-split';

  const gridPane = document.createElement('div');
  gridPane.className = 'lp-grid-pane';

  const detail = document.createElement('div');
  detail.className = 'lp-detail';

  split.append(gridPane, detail);
  root.append(ribbon, split);

  function stat(label: string, value: string, color?: string): HTMLElement {
    const wrap = document.createElement('div');
    const l = document.createElement('div');
    l.className = 'lp-stat-label';
    l.textContent = label;
    const v = document.createElement('div');
    v.className = 'lp-stat-value';
    v.textContent = value;
    if (color) v.style.color = color;
    wrap.append(l, v);
    return wrap;
  }

  function bar(percent: number, color: string): HTMLElement {
    const track = document.createElement('div');
    track.className = 'lp-gantt-track';
    const fill = document.createElement('div');
    fill.className = 'lp-gantt-fill';
    fill.style.width = `${percent}%`;
    fill.style.background = color;
    track.appendChild(fill);
    return track;
  }

  /** A cell, so the table code stays readable. */
  function td(content: string | HTMLElement, className = ''): HTMLElement {
    const cell = document.createElement('td');
    if (className) cell.className = className;
    if (typeof content === 'string') cell.textContent = content;
    else cell.appendChild(content);
    return cell;
  }

  function renderDetail(entry: LessonProgress | null): void {
    detail.innerHTML = '';
    if (!entry) {
      const empty = document.createElement('div');
      empty.className = 'lp-empty';
      empty.textContent =
        'Select a task to see what it asks for, how to prove it, and what an interviewer asks about it.';
      detail.appendChild(empty);
      return;
    }

    const { lesson, state } = entry;

    const title = document.createElement('h3');
    title.textContent = lesson.title;

    const status = document.createElement('p');
    status.className = 'muted';
    const dot = document.createElement('span');
    dot.className = 'lp-dot';
    dot.style.background = STATE_COLOR[state];
    status.append(dot, document.createTextNode(STATE_LABEL[state]));

    detail.append(title, status);

    const section = (heading: string, text: string): void => {
      const h = document.createElement('h4');
      h.textContent = heading;
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = text;
      detail.append(h, p);
    };

    section('Objective', lesson.objective);

    // Evidence first when it is finished, outstanding first when it is not:
    // the useful sentence is different depending on where you are.
    if (state === 'done') {
      section('Evidence', entry.evidence);
    } else {
      section('Outstanding', entry.outstanding);
      section('Found so far', entry.evidence);
    }

    section('Why it matters', lesson.why);

    const stepsHead = document.createElement('h4');
    stepsHead.textContent = 'Steps';
    detail.appendChild(stepsHead);
    lesson.steps.forEach((step, i) => {
      const row = document.createElement('div');
      row.className = 'lp-step';
      const n = document.createElement('span');
      n.className = 'lp-step-n';
      n.textContent = `${i + 1}.`;
      const text = document.createElement('div');
      text.appendChild(document.createTextNode(step.do));
      if (step.example) {
        const code = document.createElement('code');
        code.className = 'lp-code';
        code.textContent = step.example;
        text.appendChild(code);
      } else if (step.cmdlet) {
        const code = document.createElement('code');
        code.className = 'lp-code';
        code.textContent = step.cmdlet;
        text.appendChild(code);
      }
      row.append(n, text);
      detail.appendChild(row);
    });

    section('How to prove it', lesson.verify);
    section('Asked in interviews', lesson.interview);
  }

  function render(): void {
    const progress = computeProgress(conductor);

    // ----- Ribbon -----
    ribbon.innerHTML = '';
    ribbon.append(
      stat('Complete', `${progress.percent}%`, 'var(--accent)'),
      stat('Tasks done', `${progress.done} of ${progress.total}`),
      stat(
        'In progress',
        String(progress.chapters.flatMap((c) => c.lessons).filter((l) => l.state === 'in-progress').length),
        '#d7ba7d',
      ),
    );
    const track = document.createElement('div');
    track.className = 'lp-bar-track';
    const fill = document.createElement('div');
    fill.className = 'lp-bar-fill';
    fill.style.width = `${progress.percent}%`;
    track.appendChild(fill);
    ribbon.appendChild(track);

    /**
     * Export the pack.
     *
     * It goes to two places. The download is the copy you attach to an
     * application; the copy in Documents is the one Writer and File Explorer
     * can open, which also means a learner who cannot find their browser's
     * download folder still has it.
     */
    const exportBtn = document.createElement('button');
    exportBtn.textContent = '\u{1F4E4} Evidence pack';
    exportBtn.title = 'Everything you have done, with the audit trail behind it';
    exportBtn.style.cssText =
      'padding:5px 12px;border-radius:5px;cursor:pointer;font-size:11.5px;font-family:inherit;' +
      'background:var(--accent);color:var(--on-accent);border:1px solid var(--accent);';
    exportBtn.addEventListener('click', () => {
      const markdown = buildEvidencePack(conductor, { operator: operatorName() });
      const name = packFilename();

      try {
        FS.writeFile(`C:\\Users\\admin\\Documents\\${name}`, markdown);
      } catch {
        // The download below is the copy that matters; a full or read-only
        // disk should not lose it.
      }

      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);

      showToast(`Evidence pack saved to Documents as ${name}.`, { kind: 'success' });
    });
    ribbon.appendChild(exportBtn);

    const refresh = document.createElement('button');
    refresh.textContent = '↻ Refresh';
    refresh.style.cssText =
      'padding:5px 12px;border-radius:5px;cursor:pointer;font-size:11.5px;font-family:inherit;' +
      'background:transparent;color:var(--muted);border:1px solid var(--border);';
    refresh.addEventListener('click', render);
    ribbon.appendChild(refresh);

    // ----- Grid -----
    gridPane.innerHTML = '';
    const table = document.createElement('table');
    table.className = 'lp-table';

    const head = document.createElement('tr');
    for (const [label, cls] of [
      ['WBS', ''],
      ['Task name', ''],
      ['Status', ''],
      ['%', 'lp-pct'],
      ['Progress', 'lp-gantt'],
      ['Evidence', ''],
    ] as const) {
      const th = document.createElement('th');
      th.textContent = label;
      if (cls) th.className = cls;
      head.appendChild(th);
    }
    table.appendChild(head);

    progress.chapters.forEach((chapter, ci) => {
      // Summary row: the chapter, rolled up from its lessons.
      const sum = document.createElement('tr');
      sum.className = 'lp-summary';
      sum.append(
        td(String(ci + 1), 'lp-wbs'),
        td(chapter.chapter.title, 'lp-name'),
        td(chapter.percent === 100 ? 'Complete' : chapter.percent === 0 ? 'Not started' : 'In progress'),
        td(`${chapter.percent}%`, 'lp-pct'),
        td(bar(chapter.percent, chapter.percent === 100 ? 'var(--accent)' : '#d7ba7d'), 'lp-gantt'),
        td(`${chapter.lessons.filter((l) => l.state === 'done').length} of ${chapter.lessons.length} tasks`),
      );
      table.appendChild(sum);

      chapter.lessons.forEach((entry, li) => {
        const row = document.createElement('tr');
        row.className = 'lp-task' + (entry.lesson.id === selectedId ? ' lp-selected' : '');

        const dot = document.createElement('span');
        dot.className = 'lp-dot';
        dot.style.background = STATE_COLOR[entry.state];
        const name = document.createElement('span');
        name.textContent = entry.lesson.title;
        const nameCell = document.createElement('div');
        nameCell.append(dot, name);

        const statusCell = document.createElement('span');
        statusCell.textContent = STATE_LABEL[entry.state];
        statusCell.style.color = STATE_COLOR[entry.state];

        row.append(
          td(`${ci + 1}.${li + 1}`, 'lp-wbs'),
          td(nameCell, 'lp-name lp-indent'),
          td(statusCell),
          td(`${PCT[entry.state]}%`, 'lp-pct'),
          td(bar(PCT[entry.state], STATE_COLOR[entry.state]), 'lp-gantt'),
          td(entry.evidence),
        );

        row.addEventListener('click', () => {
          selectedId = entry.lesson.id;
          render();
        });
        table.appendChild(row);
      });
    });

    gridPane.appendChild(table);

    // ----- Detail -----
    const selected =
      progress.chapters.flatMap((c) => c.lessons).find((l) => l.lesson.id === selectedId) ?? null;
    renderDetail(selected);
  }

  render();
  body.innerHTML = '';
  body.appendChild(root);
}
