/**
 * ui/consoles/challengeWindow.ts — the 90-Day IAM Job-Ready Challenge.
 *
 *   top     start date, "Day N of 90", overall progress, copy all feedback
 *   left    the schedule: 13 labs by phase, with day ranges and status
 *   centre  the lab's workspace bar (the app windows and portal pages it is
 *           done in), its week plan (today highlighted) and the full lab text
 *   right   the validation checklist and the feedback form for this lab
 *
 * Every lab is done inside the app: Active Directory labs in the workstation's
 * own directory, Entra ID labs in the Browser against the learner's real
 * tenant, with the real PowerShell console alongside.
 *
 * Feedback is the point of the window: after each lab the learner records the
 * repo URL, what went wrong and what to improve, then copies it as markdown to
 * send to their mentor. Everything is kept in localStorage on this desktop.
 */
import {
  CHALLENGE_DAYS,
  CHALLENGE_LABS,
  CHALLENGE_PHASES,
  challengeDay,
  challengeLabById,
  dateOfDay,
  isoDate,
  labForDay,
  startDateForLabToday,
  type ChallengeLab,
  type ChallengeTool,
} from '@/config/challenge90';
import { renderMarkdown, ensureMarkdownStyles } from '@/ui/markdown';
import { openInBrowser, requestApp } from '@/util/appLauncher';
import { copyText } from '@/util/copyText';

/** What each workspace button opens: an app window, or a page in the Browser. */
export const TOOLS: Record<ChallengeTool, { label: string; app?: string; url?: string }> = {
  'active-directory': { label: '🗄️ Active Directory', app: 'active-directory' },
  terminal: { label: '>_ Terminal (AD)', app: 'terminal' },
  ise: { label: '📜 PowerShell ISE', app: 'script-editor' },
  pwsh: { label: '💠 PowerShell (this PC)', app: 'host-powershell' },
  'cloud-identity': { label: '☁️ Cloud Identity', app: 'cloud-identity' },
  'access-reviews': { label: '✅ Access Reviews', app: 'access-reviews' },
  tickets: { label: '🎫 Ticket Queue', app: 'ticket-console' },
  sheets: { label: '📊 Sheets', app: 'sheets' },
  interview: { label: '🎤 Interview', app: 'interview' },
  entra: { label: '🌐 Entra admin center', url: 'https://entra.microsoft.com' },
  azure: { label: '🌐 Azure portal', url: 'https://portal.azure.com' },
  myapps: { label: '🌐 My Apps', url: 'https://myapps.microsoft.com' },
  'saml-toolkit': { label: '🌐 SAML Toolkit', url: 'https://samltoolkit.azurewebsites.net' },
  jwt: { label: '🌐 jwt.ms', url: 'https://jwt.ms' },
  'graph-explorer': { label: '🌐 Graph Explorer', url: 'https://developer.microsoft.com/graph/graph-explorer' },
  github: { label: '🌐 GitHub', url: 'https://github.com' },
};

function openTool(tool: ChallengeTool): void {
  const t = TOOLS[tool];
  if (t.url) openInBrowser(t.url);
  else if (t.app) requestApp(t.app);
}

const STORE_KEY = 'c90_challenge_v1';

type LabStatus = 'not-started' | 'in-progress' | 'done';

interface LabRecord {
  status: LabStatus;
  /** Deliverable texts the learner has ticked. Text, not index, so editing a lab's checklist keeps the rest. */
  ticked: string[];
  repoUrl: string;
  wentWell: string;
  challenges: string;
  improve: string;
  /** 0 = not rated, 1–5 difficulty. */
  difficulty: number;
}

interface Store {
  startDate: string;
  labId: string;
  labs: Record<string, LabRecord>;
}

function emptyRecord(): LabRecord {
  return { status: 'not-started', ticked: [], repoUrl: '', wentWell: '', challenges: '', improve: '', difficulty: 0 };
}

function loadStore(): Store {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Store;
      if (s && typeof s.labId === 'string' && s.labs) return s;
    }
  } catch {
    // Blocked or corrupt storage: start clean.
  }
  return { startDate: '', labId: CHALLENGE_LABS[0]!.id, labs: {} };
}

function saveStore(s: Store): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    // Not remembered; the window still works.
  }
}

/** One lab's feedback as markdown, ready to paste to a mentor. */
export function feedbackMarkdown(lab: ChallengeLab, r: LabRecord): string {
  const done = lab.deliverables.filter((d) => r.ticked.includes(d)).length;
  const missing = lab.deliverables.filter((d) => !r.ticked.includes(d));
  const lines = [
    `### Lab ${lab.number} — ${lab.title} (days ${lab.firstDay}–${lab.lastDay})`,
    `- Status: ${r.status.replace('-', ' ')}`,
    `- Checklist: ${done}/${lab.deliverables.length}`,
    `- Repo: ${r.repoUrl || '(not yet)'}`,
    `- Difficulty: ${r.difficulty ? `${r.difficulty}/5` : '(not rated)'}`,
    '',
    `**What went well:** ${r.wentWell || '—'}`,
    '',
    `**Challenges / errors:** ${r.challenges || '—'}`,
    '',
    `**One improvement:** ${r.improve || '—'}`,
  ];
  if (missing.length) lines.push('', '**Not yet done:**', ...missing.map((m) => `- ${m}`));
  return lines.join('\n');
}

const STYLES = `
.c90-root{display:flex;flex-direction:column;height:100%;background:var(--panel);color:var(--fg);font-family:"Segoe UI",system-ui,sans-serif;font-size:12.5px;}
.c90-head{flex-shrink:0;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:8px 12px;background:var(--panel-alt);border-bottom:1px solid var(--border);}
.c90-title{font-weight:650;font-size:13.5px;}
.c90-day{font-weight:600;color:var(--accent);}
.c90-bar{width:140px;height:7px;border-radius:4px;background:var(--border);overflow:hidden;}
.c90-bar>i{display:block;height:100%;background:#22c55e;}
.c90-head label{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:11.5px;}
.c90-head input[type=date]{padding:3px 6px;border-radius:4px;border:1px solid var(--border);background:var(--panel);color:var(--fg);font:inherit;}
.c90-spacer{flex:1;}
.c90-main{flex:1;min-height:0;display:grid;grid-template-columns:240px minmax(0,1fr) 330px;}
.c90-list{overflow:auto;padding:8px 10px;border-right:1px solid var(--border);}
.c90-phase{margin:10px 4px 4px;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);}
.c90-item{display:flex;gap:8px;align-items:flex-start;width:100%;text-align:left;padding:6px 8px;margin:2px 0;border:1px solid transparent;border-radius:5px;background:transparent;color:var(--fg);font:inherit;cursor:pointer;}
.c90-item:hover{background:var(--panel-alt);}
.c90-item.on{background:var(--panel-alt);border-color:var(--border);}
.c90-item.today{border-left:3px solid var(--accent);}
.c90-item small{display:block;color:var(--muted);font-size:10.5px;margin-top:2px;}
.c90-dot{flex-shrink:0;width:18px;text-align:center;}
.c90-work{overflow:auto;padding:14px 18px;min-width:0;}
.c90-work h2{margin:0 0 4px;font-size:15px;color:var(--accent);}
.c90-meta{color:var(--muted);margin:0 0 10px;}
.c90-skills{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px;}
.c90-skill{font-size:10.5px;padding:2px 7px;border-radius:9px;background:var(--border);}
.c90-plan{border-collapse:collapse;width:100%;margin:0 0 14px;font-size:12px;}
.c90-plan td{border:1px solid var(--border);padding:4px 8px;vertical-align:top;}
.c90-plan td:first-child{white-space:nowrap;color:var(--muted);width:1%;}
.c90-plan tr.now td{background:rgba(37,99,235,.14);font-weight:600;}
.c90-side{overflow:auto;padding:12px;border-left:1px solid var(--border);}
.c90-side h3{margin:12px 0 6px;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);}
.c90-side h3:first-child{margin-top:0;}
.c90-check{display:flex;gap:7px;align-items:flex-start;margin:4px 0;line-height:1.4;cursor:pointer;}
.c90-check code{font-family:Consolas,'Cascadia Mono',monospace;font-size:11px;padding:0 3px;border-radius:3px;background:rgba(127,127,127,.18);}
.c90-side input[type=text],.c90-side textarea,.c90-side select{width:100%;box-sizing:border-box;padding:6px 8px;margin:2px 0 8px;border-radius:4px;border:1px solid var(--border);background:var(--panel);color:var(--fg);font:inherit;}
.c90-side textarea{min-height:58px;resize:vertical;}
.c90-side .lbl{font-size:11.5px;color:var(--muted);}
.c90-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;}
.c90-tools{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:0 0 12px;padding:8px 10px;border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:6px;background:var(--panel-alt);}
.c90-tools-lbl{font-weight:600;margin-right:4px;}
.c90-btn{padding:6px 11px;border-radius:4px;border:1px solid var(--border);background:var(--panel);color:var(--fg);font:inherit;font-size:12px;cursor:pointer;}
.c90-btn:hover{background:var(--border);}
.c90-primary{background:#2563eb;border-color:#2563eb;color:#fff;font-weight:600;}
.c90-note{font-size:11px;color:var(--muted);margin-top:6px;min-height:14px;}
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const STATUS_ICON: Record<LabStatus, string> = { 'not-started': '○', 'in-progress': '◐', done: '●' };

export function renderChallengeWindow(body: HTMLElement): void {
  if (!document.getElementById('c90-css')) {
    const style = document.createElement('style');
    style.id = 'c90-css';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }
  ensureMarkdownStyles();
  body.innerHTML = '';
  body.style.height = '100%';

  const store = loadStore();
  let lab: ChallengeLab = challengeLabById(store.labId) ?? CHALLENGE_LABS[0]!;

  const record = (l: ChallengeLab): LabRecord => {
    store.labs[l.id] = { ...emptyRecord(), ...store.labs[l.id] };
    return store.labs[l.id]!;
  };
  const persist = (): void => {
    store.labId = lab.id;
    saveStore(store);
  };
  const today = (): number => (store.startDate ? challengeDay(store.startDate) : 0);

  const root = el('div', 'c90-root');

  // --- Header -----------------------------------------------------------------
  const head = el('div', 'c90-head');
  head.append(el('span', 'c90-title', '90-Day IAM Job-Ready Challenge'));
  const dayLabel = el('span', 'c90-day');
  const bar = el('div', 'c90-bar');
  const barFill = el('i');
  bar.append(barFill);
  const progressLabel = el('span');
  progressLabel.style.cssText = 'font-size:11.5px;color:var(--muted);';

  const startLabel = el('label', undefined, 'Start date');
  const startInput = el('input');
  startInput.type = 'date';
  startInput.value = store.startDate;
  startInput.addEventListener('change', () => {
    store.startDate = startInput.value;
    const current = labForDay(today());
    if (current) lab = current;
    persist();
    paintAll();
  });
  startLabel.append(startInput);

  const todayBtn = el('button', 'c90-btn', 'Go to today');
  todayBtn.addEventListener('click', () => {
    const current = labForDay(today());
    if (current) {
      lab = current;
      persist();
      paintAll();
    }
  });

  const copyAllBtn = el('button', 'c90-btn', 'Copy all feedback');
  copyAllBtn.title = 'Every lab you have started, as markdown';
  copyAllBtn.addEventListener('click', () => {
    const started = CHALLENGE_LABS.filter((l) => store.labs[l.id] && store.labs[l.id]!.status !== 'not-started');
    const text = started.length
      ? [`## 90-Day Challenge feedback — day ${today() || '?'} of ${CHALLENGE_DAYS}`, '', ...started.map((l) => feedbackMarkdown(l, record(l)) + '\n')].join('\n')
      : 'No lab started yet.';
    void copyText(text).then((ok) => { copyAllBtn.textContent = ok ? 'Copied ✓' : 'Copy failed'; setTimeout(() => (copyAllBtn.textContent = 'Copy all feedback'), 1600); });
  });

  // Starting over starts today: Day 1 is the day of the click, and every lab's
  // dates are recomputed from it.
  const resetBtn = el('button', 'c90-btn', 'Restart challenge…');
  resetBtn.addEventListener('click', () => {
    const start = isoDate();
    if (!window.confirm(
      `Restart the whole challenge from today?\n\nDay 1 becomes ${start} and Day ${CHALLENGE_DAYS} becomes ${dateOfDay(start, CHALLENGE_DAYS)}. ` +
        'Every ticked item and all feedback are cleared.',
    )) return;
    store.startDate = start;
    store.labs = {};
    lab = CHALLENGE_LABS[0]!;
    startInput.value = start;
    persist();
    paintAll();
  });

  head.append(dayLabel, bar, progressLabel, el('span', 'c90-spacer'), startLabel, todayBtn, copyAllBtn, resetBtn);

  // --- Columns ----------------------------------------------------------------
  const main = el('div', 'c90-main');
  const list = el('div', 'c90-list');
  const work = el('div', 'c90-work');
  const side = el('div', 'c90-side');
  main.append(list, work, side);
  root.append(head, main);
  body.appendChild(root);

  function paintHeader(): void {
    const d = today();
    dayLabel.textContent = !store.startDate
      ? 'Set your start date →'
      : d === 0
        ? `Starts ${store.startDate}`
        : d > CHALLENGE_DAYS
          ? `Challenge complete (day ${d})`
          : `Day ${d} of ${CHALLENGE_DAYS} · Lab ${labForDay(d)?.number}`;
    const total = CHALLENGE_LABS.reduce((n, l) => n + l.deliverables.length, 0);
    const ticked = CHALLENGE_LABS.reduce(
      (n, l) => n + l.deliverables.filter((x) => store.labs[l.id]?.ticked.includes(x)).length,
      0,
    );
    const pct = total ? Math.round((100 * ticked) / total) : 0;
    barFill.style.width = `${pct}%`;
    progressLabel.textContent = `${ticked}/${total} checklist items · ${pct}%`;
  }

  function paintList(): void {
    list.innerHTML = '';
    const current = labForDay(today());
    for (const phase of CHALLENGE_PHASES) {
      list.append(el('div', 'c90-phase', phase.title));
      for (const l of CHALLENGE_LABS.filter((x) => x.phase === phase.id)) {
        const r = store.labs[l.id];
        const btn = el('button', 'c90-item' + (l.id === lab.id ? ' on' : '') + (current?.id === l.id ? ' today' : ''));
        btn.append(el('span', 'c90-dot', STATUS_ICON[r?.status ?? 'not-started']));
        const text = el('span');
        text.append(document.createTextNode(`${l.number}. ${l.title}`));
        const done = l.deliverables.filter((x) => r?.ticked.includes(x)).length;
        text.append(el('small', undefined, `Days ${l.firstDay}–${l.lastDay} · ${done}/${l.deliverables.length}`));
        btn.append(text);
        btn.addEventListener('click', () => {
          lab = l;
          persist();
          paintList();
          paintWork();
          paintSide();
        });
        list.append(btn);
      }
    }
  }

  function paintWork(): void {
    work.innerHTML = '';
    work.scrollTop = 0;
    work.append(el('h2', undefined, `Lab ${lab.number} — ${lab.title}`));
    work.append(el('p', 'c90-meta', `Days ${lab.firstDay}–${lab.lastDay} · repo ${lab.repo}`));

    // Where this lab is done. The lab text's first section says which button
    // each step uses.
    const bar = el('div', 'c90-tools');
    bar.append(el('span', 'c90-tools-lbl', 'Do it in:'));
    for (const tool of lab.tools) {
      const b = el('button', 'c90-btn', TOOLS[tool].label);
      b.title = TOOLS[tool].url ? `Open ${TOOLS[tool].url} in the Browser` : `Open ${TOOLS[tool].label.replace(/^\S+\s/, '')}`;
      b.addEventListener('click', () => openTool(tool));
      bar.append(b);
    }
    work.append(bar);

    const skills = el('div', 'c90-skills');
    for (const s of lab.skills) skills.append(el('span', 'c90-skill', s));
    work.append(skills);

    const plan = el('table', 'c90-plan');
    const d = today();
    lab.dailyPlan.forEach((task, i) => {
      const day = lab.firstDay + i;
      const tr = plan.insertRow();
      if (day === d) tr.className = 'now';
      const when = store.startDate ? `Day ${day} · ${dateOfDay(store.startDate, day)}` : `Day ${day}`;
      tr.insertCell().textContent = when;
      tr.insertCell().textContent = task;
    });
    work.append(plan);

    const actions = el('div', 'c90-row');
    const tutor = el('button', 'c90-btn', 'Ask the IAM Tutor');
    tutor.addEventListener('click', () => requestApp('tutor'));
    const copyLab = el('button', 'c90-btn', 'Copy lab as markdown');
    copyLab.addEventListener('click', () => {
      void copyText(lab.body).then((ok) => { copyLab.textContent = ok ? 'Copied ✓' : 'Copy failed'; setTimeout(() => (copyLab.textContent = 'Copy lab as markdown'), 1600); });
    });
    actions.append(tutor, copyLab);
    actions.style.marginBottom = '14px';
    work.append(actions);

    const md = renderMarkdown(lab.body);
    work.append(md);
  }

  function paintSide(): void {
    side.innerHTML = '';
    const r = record(lab);

    side.append(el('h3', undefined, `Validation checklist (${lab.deliverables.length})`));
    for (const item of lab.deliverables) {
      const row = el('label', 'c90-check');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = r.ticked.includes(item);
      cb.addEventListener('change', () => {
        r.ticked = cb.checked ? [...new Set([...r.ticked, item])] : r.ticked.filter((x) => x !== item);
        if (r.status === 'not-started' && r.ticked.length) r.status = 'in-progress';
        if (lab.deliverables.every((x) => r.ticked.includes(x))) r.status = 'done';
        else if (r.status === 'done') r.status = 'in-progress';
        statusSel.value = r.status;
        persist();
        paintHeader();
        paintList();
      });
      // `code` spans become <code> nodes; every piece is set as text, never HTML.
      const text = el('span');
      item.split('`').forEach((part, i) => text.append(i % 2 ? el('code', undefined, part) : document.createTextNode(part)));
      row.append(cb, text);
      side.append(row);
    }

    side.append(el('h3', undefined, 'Your feedback on this lab'));

    side.append(el('div', 'lbl', 'Status'));
    const statusSel = el('select');
    for (const [v, t] of [['not-started', 'Not started'], ['in-progress', 'In progress'], ['done', 'Done']] as const) {
      const o = el('option', undefined, t);
      o.value = v;
      statusSel.append(o);
    }
    statusSel.value = r.status;
    statusSel.addEventListener('change', () => {
      r.status = statusSel.value as LabStatus;
      persist();
      paintList();
    });
    side.append(statusSel);

    const field = (label: string, key: 'repoUrl' | 'wentWell' | 'challenges' | 'improve', multiline: boolean, placeholder: string): void => {
      side.append(el('div', 'lbl', label));
      const input = multiline ? el('textarea') : el('input');
      if (input instanceof HTMLInputElement) input.type = 'text';
      input.placeholder = placeholder;
      input.value = r[key];
      input.addEventListener('input', () => {
        r[key] = input.value;
        if (r.status === 'not-started' && input.value) {
          r.status = 'in-progress';
          statusSel.value = r.status;
          paintList();
        }
        persist();
      });
      side.append(input);
    };
    field('GitHub repo URL', 'repoUrl', false, `https://github.com/<you>/${lab.repo}`);
    field('What went well', 'wentWell', true, 'What clicked, what you are proud of');
    field('Challenges / errors', 'challenges', true, 'Paste exact error messages');
    field('One improvement', 'improve', true, 'What you would change in the lab or your solution');

    side.append(el('div', 'lbl', 'Difficulty'));
    const diff = el('select');
    ['Not rated', '1 — easy', '2', '3', '4', '5 — very hard'].forEach((t, i) => {
      const o = el('option', undefined, t);
      o.value = String(i);
      diff.append(o);
    });
    diff.value = String(r.difficulty);
    diff.addEventListener('change', () => {
      r.difficulty = Number(diff.value);
      persist();
    });
    side.append(diff);

    const note = el('div', 'c90-note');
    const row = el('div', 'c90-row');
    const copy = el('button', 'c90-btn c90-primary', 'Copy feedback');
    copy.addEventListener('click', () => {
      void copyText(feedbackMarkdown(lab, r)).then((ok) => {
        note.textContent = ok ? 'Copied as markdown — paste it to your mentor.' : 'Copy failed: select and copy by hand.';
      });
    });
    // Restarting a lab gives it a full week from today: the start date moves so
    // this lab's first day is the day of the click, and later labs slide with it.
    const clear = el('button', 'c90-btn', 'Restart this lab');
    clear.addEventListener('click', () => {
      const start = startDateForLabToday(lab);
      const first = dateOfDay(start, lab.firstDay);
      const last = dateOfDay(start, lab.lastDay);
      if (!window.confirm(
        `Restart Lab ${lab.number} from today?\n\nIt runs ${first} to ${last}, and every later lab moves with it. ` +
          'This lab\'s ticks and feedback are cleared; other labs keep theirs.',
      )) return;
      delete store.labs[lab.id];
      store.startDate = start;
      startInput.value = start;
      persist();
      paintAll();
    });
    row.append(copy, clear);
    side.append(row, note);
    side.append(el('div', 'c90-note', 'Saved automatically on this desktop.'));
  }

  function paintAll(): void {
    paintHeader();
    paintList();
    paintWork();
    paintSide();
  }

  paintAll();
}
