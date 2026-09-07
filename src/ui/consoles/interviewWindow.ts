/**
 * ui/consoles/interviewWindow.ts — Interview Prep.
 *
 * The manual's `interview` field was shown as a paragraph beside each lesson,
 * where it is read once and nodded at. Reading a good answer and producing one
 * with somebody waiting are different skills, and only the second gets anybody
 * hired.
 *
 * So the drill hides the model answer until you have committed to your own.
 * Revealing it is one-way per question: once seen, the answer is marked
 * prompted, because an answer typed with the model answer on screen proves
 * nothing. The clock runs but never cuts you off — the point is to notice you
 * took two minutes, not to fail you at ninety seconds.
 *
 * Nothing here feeds Lab Plan. Progress there stays derived from the estate;
 * a drill is practice, not evidence, and letting a self-rating count as
 * completion would put a self-report back into the one place this product
 * keeps free of them.
 */
import { MANUAL } from '@/config/manual';
import { appButton } from '@/ui/appChrome';
import {
  allQuestions,
  critiqueAnswer,
  questionsFor,
  shuffle,
  summarise,
} from '@/vm/interviewDrill';
import type { DrillAnswer, DrillQuestion, Recall } from '@/vm/interviewDrill';
import { showToast } from '@/ui/toast';

const RECALL_LABEL: Record<Recall, string> = {
  missed: 'Missed it',
  partial: 'Partly there',
  solid: 'Had it',
};

const RECALL_COLOR: Record<Recall, string> = {
  missed: 'var(--err)',
  partial: '#d7ba7d',
  solid: 'var(--accent)',
};

const STYLES = `
  .iv-root {
    display: flex; flex-direction: column; height: 100%;
    background: var(--panel); color: var(--fg);
    font-family: "Segoe UI", system-ui, sans-serif; font-size: 12.5px;
  }
  .iv-bar {
    flex-shrink: 0; display: flex; align-items: center; gap: 12px;
    padding: 9px 14px; border-bottom: 1px solid var(--border);
    background: var(--panel-alt); flex-wrap: wrap;
  }
  /* Buttons come from the shared chrome (.app-btn). */
  .iv-bar select {
    height: 28px; padding: 0 9px; border-radius: 4px; box-sizing: border-box;
    font-family: inherit; font-size: 12px; cursor: pointer;
    background: var(--panel); color: var(--fg); border: 1px solid var(--border);
  }
  .iv-clock {
    margin-left: auto; font-variant-numeric: tabular-nums; font-size: 15px;
    font-weight: 650; color: var(--muted);
  }
  .iv-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 22px 26px; }
  .iv-wrap { max-width: 720px; margin: 0 auto; }
  .iv-kicker {
    font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.07em;
    color: var(--muted); margin-bottom: 8px;
  }
  .iv-question {
    font-size: 19px; line-height: 1.45; font-weight: 600; margin: 0 0 18px;
  }
  .iv-answer {
    width: 100%; box-sizing: border-box; min-height: 130px; resize: vertical;
    padding: 11px 13px; border-radius: 7px; font-family: inherit; font-size: 13px;
    line-height: 1.6; background: var(--panel-alt); color: var(--fg);
    border: 1px solid var(--border);
  }
  .iv-answer:focus { outline: none; border-color: var(--accent); }
  .iv-actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
  .iv-card {
    margin-top: 18px; padding: 13px 15px; border-radius: 8px;
    background: var(--panel-alt); border: 1px solid var(--border); line-height: 1.65;
  }
  .iv-card.model { border-color: rgba(78, 201, 176, 0.45); }
  .iv-card h4 {
    margin: 0 0 6px; font-size: 10.5px; text-transform: uppercase;
    letter-spacing: 0.07em; color: var(--muted); font-weight: 600;
  }
  .iv-rate { display: flex; gap: 8px; margin-top: 14px; align-items: center; flex-wrap: wrap; }
  .iv-rate-label { font-size: 11.5px; color: var(--muted); }
  .iv-progress {
    display: flex; gap: 4px; margin-top: 4px;
  }
  .iv-pip { width: 22px; height: 4px; border-radius: 2px; background: var(--border); }
  .iv-summary-grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 14px; margin: 18px 0;
  }
  .iv-stat { padding: 12px 14px; border-radius: 8px; background: var(--panel-alt);
    border: 1px solid var(--border); }
  .iv-stat-value { font-size: 22px; font-weight: 650; font-variant-numeric: tabular-nums; }
  .iv-stat-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--muted); margin-top: 2px; }
  .iv-review-row {
    display: flex; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--border);
    align-items: baseline;
  }
  .iv-review-q { flex: 1; }
  .iv-note { color: var(--muted); font-size: 11.5px; line-height: 1.6; }
`;

export function renderInterviewWindow(body: HTMLElement): void {
  if (!document.getElementById('interview-css')) {
    const style = document.createElement('style');
    style.id = 'interview-css';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  // ----- Drill state -----
  let queue: DrillQuestion[] = [];
  let index = 0;
  let answers: DrillAnswer[] = [];
  let revealed = false;
  let critique: string | null = null;
  let critiquePending = false;
  let startedAt = 0;
  let scope: string = 'all';
  let running = false;
  let clockTimer: number | null = null;

  const root = document.createElement('div');
  root.className = 'iv-root';
  const bar = document.createElement('div');
  bar.className = 'iv-bar';
  const view = document.createElement('div');
  view.className = 'iv-body';
  root.append(bar, view);

  function stopClock(): void {
    if (clockTimer !== null) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  }

  function elapsed(): number {
    return startedAt === 0 ? 0 : Math.floor((Date.now() - startedAt) / 1000);
  }

  function clockText(): string {
    const s = elapsed();
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function button(label: string, primary: boolean, onClick: () => void): HTMLButtonElement {
    return appButton(label, onClick, primary ? { variant: 'primary' } : {});
  }

  function start(): void {
    queue = shuffle(questionsFor(scope));
    index = 0;
    answers = [];
    running = true;
    beginQuestion();
  }

  function beginQuestion(): void {
    revealed = false;
    critique = null;
    critiquePending = false;
    startedAt = Date.now();
    stopClock();
    // The clock is information, not a threat: it keeps counting past any
    // target rather than ending the question.
    clockTimer = window.setInterval(() => {
      const el = view.querySelector<HTMLElement>('.iv-clock-live');
      if (el) el.textContent = clockText();
    }, 1000);
    render();
  }

  function record(recall: Recall): void {
    const q = queue[index];
    if (!q) return;
    const textarea = view.querySelector<HTMLTextAreaElement>('.iv-answer');
    answers.push({
      lessonId: q.lessonId,
      text: textarea?.value.trim() ?? '',
      seconds: elapsed(),
      prompted: revealed,
      recall,
    });
    stopClock();
    index += 1;
    if (index >= queue.length) {
      running = false;
      render();
      return;
    }
    beginQuestion();
  }

  // ----- Views -----

  function renderBar(): void {
    bar.innerHTML = '';

    const select = document.createElement('select');
    const allOpt = document.createElement('option');
    allOpt.value = 'all';
    allOpt.textContent = `Everything (${allQuestions().length} questions)`;
    select.appendChild(allOpt);
    for (const chapter of MANUAL) {
      const opt = document.createElement('option');
      opt.value = chapter.id;
      opt.textContent = `${chapter.title} (${questionsFor(chapter.id).length})`;
      select.appendChild(opt);
    }
    select.value = scope;
    select.addEventListener('change', () => {
      scope = select.value;
      if (!running) render();
    });
    bar.appendChild(select);

    bar.appendChild(
      button(running ? 'Restart' : 'Start drill', true, () => {
        if (running && !window.confirm('Restart the drill? Your answers so far are discarded.')) {
          return;
        }
        start();
      }),
    );

    if (running) {
      const pos = document.createElement('span');
      pos.className = 'iv-note';
      pos.textContent = `Question ${index + 1} of ${queue.length}`;
      bar.appendChild(pos);

      const clock = document.createElement('span');
      clock.className = 'iv-clock iv-clock-live';
      clock.textContent = clockText();
      bar.appendChild(clock);
    }
  }

  function renderIdle(): void {
    const wrap = document.createElement('div');
    wrap.className = 'iv-wrap';

    const h = document.createElement('h2');
    h.style.cssText = 'margin:0 0 10px;font-size:18px;';
    h.textContent = 'Interview prep';

    const p = document.createElement('p');
    p.className = 'iv-note';
    p.style.cssText = 'margin:0 0 16px;';
    p.textContent =
      'One question at a time, with the model answer hidden until you have written yours. ' +
      'The clock runs but never stops you — it is there so you notice how long you took, ' +
      'which is the thing that changes with practice.';

    const p2 = document.createElement('p');
    p2.className = 'iv-note';
    p2.style.cssText = 'margin:0 0 16px;';
    p2.textContent =
      'Nothing here counts towards Lab Plan. Progress there is derived from the estate you ' +
      'built; this is rehearsal, and rating your own recall is not evidence of anything.';

    const count = document.createElement('div');
    count.className = 'iv-stat';
    count.style.cssText += 'display:inline-block;';
    const cv = document.createElement('div');
    cv.className = 'iv-stat-value';
    cv.textContent = String(questionsFor(scope).length);
    const cl = document.createElement('div');
    cl.className = 'iv-stat-label';
    cl.textContent = 'questions in this set';
    count.append(cv, cl);

    wrap.append(h, p, p2, count);
    view.appendChild(wrap);
  }

  function renderQuestion(q: DrillQuestion): void {
    const wrap = document.createElement('div');
    wrap.className = 'iv-wrap';

    const kicker = document.createElement('div');
    kicker.className = 'iv-kicker';
    kicker.textContent = `${q.chapterTitle} · ${q.lessonTitle}`;

    const pips = document.createElement('div');
    pips.className = 'iv-progress';
    queue.forEach((_, i) => {
      const pip = document.createElement('div');
      pip.className = 'iv-pip';
      if (i < index) {
        const a = answers[i];
        pip.style.background = a ? RECALL_COLOR[a.recall] : 'var(--accent)';
      } else if (i === index) {
        pip.style.background = 'var(--fg)';
      }
      pips.appendChild(pip);
    });

    const question = document.createElement('p');
    question.className = 'iv-question';
    question.textContent = q.question;

    const textarea = document.createElement('textarea');
    textarea.className = 'iv-answer';
    textarea.placeholder = 'Answer out loud, then type the short version here…';
    textarea.spellcheck = false;

    const actions = document.createElement('div');
    actions.className = 'iv-actions';

    if (!revealed) {
      actions.appendChild(
        button('Show the model answer', true, () => {
          revealed = true;
          // Keep what was typed: re-rendering must not discard the answer.
          const typed = textarea.value;
          render();
          const next = view.querySelector<HTMLTextAreaElement>('.iv-answer');
          if (next) next.value = typed;
        }),
      );
      const hint = document.createElement('span');
      hint.className = 'iv-note';
      hint.style.cssText = 'align-self:center;';
      hint.textContent = 'Commit to your answer first — this is marked once you look.';
      actions.appendChild(hint);
    }

    wrap.append(kicker, pips, question, textarea, actions);

    if (revealed) {
      const card = document.createElement('div');
      card.className = 'iv-card model';
      const h4 = document.createElement('h4');
      h4.textContent = 'What a strong answer contains';
      const p = document.createElement('p');
      p.style.cssText = 'margin:0;';
      p.textContent = q.modelAnswer;
      card.append(h4, p);
      wrap.appendChild(card);

      // Optional critique. Never a score — the same division the ticket
      // review keeps, where checks decide and a model only writes prose.
      const critiqueBtn = button('Ask the tutor to critique mine', false, () => {
        const typed = view.querySelector<HTMLTextAreaElement>('.iv-answer')?.value ?? '';
        if (!typed.trim()) {
          showToast('Write an answer first — there is nothing to critique.', { kind: 'warn' });
          return;
        }
        critiquePending = true;
        render();
        void critiqueAnswer(q, typed).then((text) => {
          critiquePending = false;
          critique =
            text ??
            'No local model answered, so there is no critique. The drill works without one — ' +
              'compare your answer to the model answer above.';
          render();
          const restore = view.querySelector<HTMLTextAreaElement>('.iv-answer');
          if (restore) restore.value = typed;
        });
      });
      const critiqueRow = document.createElement('div');
      critiqueRow.className = 'iv-actions';
      critiqueRow.appendChild(critiqueBtn);
      wrap.appendChild(critiqueRow);

      if (critiquePending || critique) {
        const card2 = document.createElement('div');
        card2.className = 'iv-card';
        const h4b = document.createElement('h4');
        h4b.textContent = 'Tutor';
        const p2 = document.createElement('p');
        p2.style.cssText = 'margin:0;';
        p2.textContent = critiquePending ? 'Reading your answer…' : (critique ?? '');
        card2.append(h4b, p2);
        wrap.appendChild(card2);
      }

      const rate = document.createElement('div');
      rate.className = 'iv-rate';
      const label = document.createElement('span');
      label.className = 'iv-rate-label';
      label.textContent = 'How did you do?';
      rate.appendChild(label);
      for (const recall of ['missed', 'partial', 'solid'] as const) {
        const b = button(RECALL_LABEL[recall], recall === 'solid', () => record(recall));
        b.style.borderColor = RECALL_COLOR[recall];
        if (recall !== 'solid') b.style.color = RECALL_COLOR[recall];
        rate.appendChild(b);
      }
      wrap.appendChild(rate);
    }

    view.appendChild(wrap);
    if (!revealed) textarea.focus();
  }

  function renderSummary(): void {
    const wrap = document.createElement('div');
    wrap.className = 'iv-wrap';
    const summary = summarise(answers, queue.length);

    const h = document.createElement('h2');
    h.style.cssText = 'margin:0 0 4px;font-size:18px;';
    h.textContent = 'Drill complete';

    const sub = document.createElement('p');
    sub.className = 'iv-note';
    sub.style.cssText = 'margin:0 0 6px;';
    sub.textContent =
      `${summary.unprompted} of ${summary.answered} answered before looking at the model answer.`;

    const grid = document.createElement('div');
    grid.className = 'iv-summary-grid';
    const stats: [string, string, string?][] = [
      [String(summary.solid), 'had it', RECALL_COLOR.solid],
      [String(summary.partial), 'partly there', RECALL_COLOR.partial],
      [String(summary.missed), 'missed', RECALL_COLOR.missed],
      [`${summary.meanSeconds}s`, 'mean time'],
    ];
    for (const [value, label, color] of stats) {
      const cell = document.createElement('div');
      cell.className = 'iv-stat';
      const v = document.createElement('div');
      v.className = 'iv-stat-value';
      v.textContent = value;
      if (color) v.style.color = color;
      const l = document.createElement('div');
      l.className = 'iv-stat-label';
      l.textContent = label;
      cell.append(v, l);
      grid.appendChild(cell);
    }

    wrap.append(h, sub, grid);

    const weakest = answers.filter((a) => a.recall !== 'solid');
    const head = document.createElement('h4');
    head.style.cssText =
      'margin:14px 0 4px;font-size:10.5px;text-transform:uppercase;letter-spacing:0.07em;' +
      'color:var(--muted);';
    head.textContent = weakest.length > 0 ? 'Worth another pass' : 'Every question was solid';
    wrap.appendChild(head);

    for (const answer of weakest) {
      const q = queue.find((x) => x.lessonId === answer.lessonId);
      if (!q) continue;
      const row = document.createElement('div');
      row.className = 'iv-review-row';
      const dot = document.createElement('span');
      dot.textContent = '●';
      dot.style.color = RECALL_COLOR[answer.recall];
      const text = document.createElement('div');
      text.className = 'iv-review-q';
      const qs = document.createElement('div');
      qs.textContent = q.question;
      const ls = document.createElement('div');
      ls.className = 'iv-note';
      ls.textContent = `${q.lessonTitle} — read the lesson again in the manual.`;
      text.append(qs, ls);
      row.append(dot, text);
      wrap.appendChild(row);
    }

    view.appendChild(wrap);
  }

  function render(): void {
    renderBar();
    view.innerHTML = '';
    if (!running) {
      if (answers.length > 0 && index >= queue.length) renderSummary();
      else renderIdle();
      return;
    }
    const q = queue[index];
    if (!q) {
      renderSummary();
      return;
    }
    renderQuestion(q);
  }

  render();
  body.innerHTML = '';
  body.appendChild(root);
}
