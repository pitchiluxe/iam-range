/**
 * ui/consoles/manualWindow.ts — the course.
 *
 * Documentation is the reference; this is the sequence. Each lesson says what
 * you will be able to do, why it matters, the exact steps on this workstation,
 * how to prove it worked, and what an interviewer asks about it.
 *
 * Two things make it more than a text file. Every step that has a cmdlet shows
 * a copyable example, and the lesson can open the application it is about, so
 * reading and doing are one motion rather than two. And progress is kept, so a
 * learner returning after a week lands where they left off — the course is
 * long enough that losing your place is a reason to stop.
 */
import { MANUAL, ALL_LESSONS, type Chapter, type Lesson } from '@/config/manual';
import { openDocumentation } from './documentationWindow';
import { requestApp } from '@/util/appLauncher';
import { showToast } from '@/ui/toast';
import { copyText } from '@/util/copyText';
import { openPs1File } from '@/util/ps1Opener';
import { SCRIPT_TEMPLATES } from '@/config/scriptTemplates';
import { manualChapters } from '@/config/manualView';

const DONE_KEY = 'manual_completed';
const LAST_KEY = 'manual_last_lesson';

function loadDone(): Set<string> {
  try {
    const raw = localStorage.getItem(DONE_KEY);
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveDone(done: Set<string>): void {
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify([...done]));
  } catch {
    /* private mode — progress simply is not kept */
  }
}

export function renderManualWindow(body: HTMLElement, startLessonId?: string): void {
  body.classList.add('iam-reading');
  body.innerHTML = '';
  body.style.cssText =
    'display:flex;height:100%;background:var(--panel);color:var(--fg);' +
    'font-family:"Segoe UI",system-ui,sans-serif;';

  const done = loadDone();
  const chapters = manualChapters(startLessonId);
  const lessons = chapters.flatMap(chapter => chapter.lessons);
  const scoped = chapters.length === 1;
  const lastKey = scoped ? `${LAST_KEY}_${chapters[0]!.id}` : LAST_KEY;
  let current: Lesson =
    lessons.find((l) => l.id === localStorage.getItem(lastKey))
    ?? lessons.find((l) => l.id === startLessonId) ?? lessons[0]!;

  // --- Contents -------------------------------------------------------------
  const side = document.createElement('div');
  side.style.cssText =
    'flex-shrink:0;width:280px;background:var(--panel-alt);border-right:1px solid var(--border);' +
    'display:flex;flex-direction:column;';

  const sideHead = document.createElement('div');
  sideHead.style.cssText = 'padding:14px 16px 10px;border-bottom:1px solid var(--border);';
  const title = document.createElement('div');
  title.textContent = startLessonId?.startsWith('bootcamp-') ? '12-Week Bootcamp'
    : startLessonId?.startsWith('roadmap-') ? '5-Step Career Roadmap' : 'IAM Range manual';
  title.style.cssText = 'font-size:13px;font-weight:600;';
  const progress = document.createElement('div');
  progress.style.cssText = 'font-size:11px;color:var(--muted);margin-top:3px;';
  sideHead.append(title, progress);
  for (const [label, id] of scoped ? [] : [
    ['Start the 5-Step Roadmap', 'roadmap-step-1'],
    ['Start the 12-Week Bootcamp', 'bootcamp-project-1'],
  ]) {
    const start = document.createElement('button');
    start.textContent = label!;
    start.style.cssText = 'display:block;width:100%;margin-top:8px;padding:7px;text-align:left;' +
      'background:var(--panel);color:var(--fg);border:1px solid var(--border);cursor:pointer;';
    start.addEventListener('click', () => open(ALL_LESSONS.find(l => l.id === id)!));
    sideHead.appendChild(start);
  }
  side.appendChild(sideHead);

  const contents = document.createElement('div');
  contents.style.cssText = 'flex:1;overflow-y:auto;padding:8px 0;';
  side.appendChild(contents);

  const pane = document.createElement('div');
  pane.style.cssText = 'flex:1;overflow-y:auto;padding:24px 30px;min-width:0;';

  body.append(side, pane);

  // --- Building blocks ------------------------------------------------------
  function sectionLabel(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'reading-section';
    el.textContent = text;
    el.style.cssText =
      'font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);' +
      'margin:22px 0 8px;';
    return el;
  }

  function paragraph(text: string): HTMLElement {
    const el = document.createElement('p');
    el.textContent = text;
    el.style.cssText = 'font-size:13px;line-height:1.75;margin:0 0 12px;max-width:70ch;color:var(--fg);';
    return el;
  }

  function codeLine(text: string): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.cssText =
      'display:flex;align-items:center;gap:8px;background:var(--bg);border:1px solid var(--border);' +
      'border-radius:4px;padding:7px 10px;margin-top:6px;';
    const code = document.createElement('code');
    code.textContent = text;
    code.style.cssText =
      'flex:1;font-family:Consolas,Monaco,monospace;font-size:11.5px;color:var(--accent);' +
      'overflow-x:auto;white-space:pre;';
    const copy = document.createElement('button');
    copy.textContent = 'Copy';
    copy.style.cssText =
      'flex-shrink:0;padding:3px 9px;border-radius:3px;border:1px solid var(--border);' +
      'background:var(--panel-alt);color:var(--muted);font-size:10.5px;cursor:pointer;font-family:inherit;';
    copy.addEventListener('click', () => {
      copyText(text).then((ok) =>
        ok
          ? showToast('Copied. Paste it into the terminal.', { kind: 'success' })
          : showToast('Could not reach the clipboard.', { kind: 'error' }),
      );
    });
    wrap.append(code, copy);
    return wrap;
  }

  function button(label: string, onClick: () => void, primary = false): HTMLElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText =
      'padding:7px 14px;border-radius:4px;cursor:pointer;font-size:11.5px;margin-right:8px;' +
      'font-family:inherit;' +
      (primary
        ? 'background:#2563eb;color:#fff;border:1px solid #2563eb;'
        : 'background:var(--panel-alt);color:var(--fg);border:1px solid var(--border);');
    b.addEventListener('click', onClick);
    return b;
  }

  // --- Contents rendering ---------------------------------------------------
  function renderContents(): void {
    contents.innerHTML = '';
    progress.textContent = `${lessons.filter(lesson => done.has(lesson.id)).length} of ${lessons.length} lessons complete`;

    for (const chapter of chapters) {
      const head = document.createElement('div');
      head.textContent = chapter.title;
      head.style.cssText =
        'padding:12px 16px 5px;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;' +
        'color:var(--muted);';
      contents.appendChild(head);

      for (const lesson of chapter.lessons) {
        const row = document.createElement('button');
        const isOpen = lesson.id === current.id;
        const isDone = done.has(lesson.id);
        row.style.cssText =
          'display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:7px 16px;' +
          'border:none;cursor:pointer;font-size:12px;line-height:1.4;font-family:inherit;' +
          (isOpen ? 'background:#2563eb;color:#fff;' : 'background:transparent;color:var(--fg);');

        const tick = document.createElement('span');
        tick.textContent = isDone ? '✓' : '○';
        tick.style.cssText = `flex-shrink:0;color:${isDone ? 'var(--accent)' : 'var(--muted)'};font-size:11px;`;

        const name = document.createElement('span');
        name.textContent = lesson.title;

        row.append(tick, name);
        row.addEventListener('click', () => open(lesson));
        contents.appendChild(row);
      }
    }
  }

  // --- Lesson rendering -----------------------------------------------------
  function renderLesson(): void {
    pane.innerHTML = '';
    pane.scrollTop = 0;

    const chapter = MANUAL.find((c) => c.lessons.includes(current)) as Chapter;

    const crumb = document.createElement('div');
    crumb.textContent = chapter.title;
    crumb.style.cssText =
      'font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--accent);margin-bottom:6px;';

    const h = document.createElement('h1');
    h.textContent = current.title;
    h.style.cssText = 'margin:0 0 6px;font-size:22px;font-weight:600;';

    const objective = document.createElement('div');
    objective.textContent = current.objective;
    objective.style.cssText = 'font-size:13.5px;color:var(--muted);margin-bottom:4px;max-width:70ch;';

    pane.append(crumb, h, objective);
    if (current.lessonLinks && !scoped) {
      pane.appendChild(paragraph(chapter.summary));
      pane.appendChild(sectionLabel('Supporting lessons — start here'));
      for (const id of current.lessonLinks) {
        const lesson = ALL_LESSONS.find(l => l.id === id);
        if (!lesson) continue;
        const link = button(`${done.has(id) ? '✓ ' : ''}${lesson.title}`, () => open(lesson));
        link.style.marginBottom = '8px';
        pane.appendChild(link);
      }
      pane.appendChild(button('Read the lab pathway and environment guide',
        () => openDocumentation('lab-pathways-guide')));
    }

    pane.appendChild(sectionLabel('Why it matters'));
    pane.appendChild(paragraph(current.why));

    pane.appendChild(sectionLabel('Do this'));
    const list = document.createElement('ol');
    list.style.cssText = 'margin:0;padding-left:20px;max-width:70ch;';
    for (const step of current.steps) {
      const li = document.createElement('li');
      li.style.cssText = 'font-size:13px;line-height:1.7;margin-bottom:10px;color:var(--fg);';
      const instruction = scoped && step.do === 'Complete the supporting lessons below in order.'
        ? 'Follow this project’s instructions and complete the hands-on work.' : step.do;
      li.appendChild(document.createTextNode(instruction));
      if (step.example) li.appendChild(codeLine(step.example));
      else if (step.cmdlet) li.appendChild(codeLine(step.cmdlet));
      list.appendChild(li);
    }
    pane.appendChild(list);

    pane.appendChild(sectionLabel('How you know it worked'));
    pane.appendChild(paragraph(current.verify));
    if (current.lessonLinks) {
      pane.appendChild(sectionLabel('Evidence checklist'));
      const checklist = document.createElement('div');
      const key = `manual_evidence_${current.id}`;
      let checked: number[] = [];
      try { checked = JSON.parse(localStorage.getItem(key) ?? '[]') as number[]; } catch { /* ignore */ }
      for (const [index, text] of [
        'Problem statement and environment recorded',
        'Supporting lessons and hands-on work completed',
        'Before-and-after evidence and verification saved',
        'Demonstration and professional reflection prepared',
      ].entries()) {
        const label = document.createElement('label');
        label.style.cssText = 'display:block;font-size:13px;margin:8px 0;';
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = checked.includes(index);
        check.addEventListener('change', () => {
          checked = checked.filter(n => n !== index);
          if (check.checked) checked.push(index);
          try { localStorage.setItem(key, JSON.stringify(checked)); } catch { /* ignore */ }
        });
        label.append(check, document.createTextNode(` ${text}`));
        checklist.appendChild(label);
      }
      pane.appendChild(checklist);
      pane.appendChild(paragraph('Progress here is your personal checklist. Lab validation, Portfolio reviews, Challenge progress and program assessments are tracked separately.'));
    }

    pane.appendChild(sectionLabel('In an interview'));
    pane.appendChild(paragraph(current.interview));

    // --- Actions ------------------------------------------------------------
    const actions = document.createElement('div');
    actions.style.cssText = 'margin-top:22px;display:flex;flex-wrap:wrap;gap:0 0;align-items:center;';

    for (const link of current.appLinks ?? []) {
      actions.appendChild(button(link.label, () => requestApp(link.app), true));
    }
    if (current.scriptTemplate) {
      const template = SCRIPT_TEMPLATES.find(t => t.id === current.scriptTemplate);
      if (template) actions.appendChild(button('Load onboarding script in PowerShell ISE',
        () => openPs1File(`${template.id}.ps1`, template.body), true));
    }
    if (current.app && !current.appLinks?.length && !current.scriptTemplate) {
      actions.appendChild(
        button('Open the application', () => requestApp(current.app!), true),
      );
    }
    if (current.reading) {
      actions.appendChild(button('Read the article', () => openDocumentation(current.reading!)));
    }

    const isDone = done.has(current.id);
    actions.appendChild(
      button(isDone ? '✓ Completed — mark as not done' : 'Mark complete', () => {
        if (done.has(current.id)) done.delete(current.id);
        else done.add(current.id);
        saveDone(done);
        renderContents();
        renderLesson();
      }),
    );

    const index = lessons.indexOf(current);
    const next = lessons[index + 1];
    if (next) {
      actions.appendChild(button('Next lesson →', () => open(next)));
    }
    pane.appendChild(actions);
  }

  function open(lesson: Lesson): void {
    if (!lessons.includes(lesson)) return;
    current = lesson;
    try {
      localStorage.setItem(lastKey, lesson.id);
    } catch {
      /* ignore */
    }
    renderContents();
    renderLesson();
  }

  renderContents();
  renderLesson();
}
