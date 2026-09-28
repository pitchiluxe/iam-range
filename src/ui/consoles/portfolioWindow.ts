/**
 * ui/consoles/portfolioWindow.ts — IAM Portfolio: the 10-project IGA / AM /
 * PAM portfolio with its Ollama instructor.
 *
 *   top     the Ollama verification line (the same check the workspace
 *           scripts perform before building anything)
 *   left    projects by phase, with self-attested progress
 *   centre  the brief, the deliverables checklist and the submission box
 *   right   the instructor: review, hint, ask, clear chat
 *
 * The deterministic checker (lint.ts) decides what is objectively wrong; the
 * instructor explains and grades. Nothing here marks a project complete except
 * the learner ticking every deliverable.
 */
import { openLabSetupGuide } from '@/ui/labSetupGuide';
import { PORTFOLIO, projectById, type PortfolioProject } from '@/vm/portfolio/config';
import { renderMarkdown } from '@/ui/markdown';
import { gradeVmProject, isVmProject, type PortfolioFacts, type VmCheckResult } from '@/vm/portfolio/vmChecks';
import { lintSubmission } from '@/vm/portfolio/lint';
import {
  type HintLevel,
  type PortfolioRequest,
  type ProjectSession,
  askPortfolioInstructor,
  clearProjectConversation,
  newProjectSession,
  portfolioStatus,
} from '@/vm/portfolio/instructor';

const STORE_KEY = 'iam_portfolio_v1';

interface Store {
  projectId: string;
  sessions: Record<string, ProjectSession>;
  /** Last real-VM grading per project. */
  vmResults?: Record<string, { at: string; results: VmCheckResult[] }>;
}

/** The desktop app's bridge. Absent in a plain browser, where the VM track cannot run. */
function bridge(): { invoke: (cmd: string, ...args: unknown[]) => Promise<unknown> } | null {
  const e = (window as unknown as { electron?: { invoke?: (cmd: string, ...args: unknown[]) => Promise<unknown> } }).electron;
  return e?.invoke ? { invoke: e.invoke } : null;
}

function loadStore(): Store {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Store;
      if (s && typeof s.projectId === 'string' && s.sessions) return s;
    }
  } catch {
    // Blocked or corrupt storage: start clean.
  }
  return { projectId: PORTFOLIO.projects[0]!.id, sessions: {} };
}

function saveStore(s: Store): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    // Not remembered; the window still works.
  }
}

const STYLES = `
.pf-root{display:flex;flex-direction:column;height:100%;background:var(--panel);color:var(--fg);font-family:"Segoe UI",system-ui,sans-serif;font-size:12.5px;}
.pf-head{flex-shrink:0;display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--panel-alt);border-bottom:1px solid var(--border);}
.pf-title{font-weight:650;font-size:13.5px;}
.pf-verify{margin-left:auto;font-size:11px;font-family:Consolas,monospace;padding:3px 8px;border-radius:4px;}
.pf-verify.on{color:#22c55e;background:rgba(34,197,94,.1);}
.pf-verify.off{color:#e2a03f;background:rgba(226,160,63,.12);}
.pf-main{flex:1;min-height:0;display:grid;grid-template-columns:250px minmax(0,1fr) 360px;}
.pf-list{overflow:auto;padding:10px;border-right:1px solid var(--border);}
.pf-phase{margin:10px 4px 4px;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);}
.pf-item{display:block;width:100%;text-align:left;padding:7px 8px;margin:2px 0;border:1px solid transparent;border-radius:5px;background:transparent;color:var(--fg);font:inherit;cursor:pointer;}
.pf-item:hover{background:var(--panel-alt);}
.pf-item.on{background:var(--panel-alt);border-color:var(--border);}
.pf-item small{display:block;color:var(--muted);font-size:10.5px;margin-top:2px;}
.pf-work{overflow:auto;padding:14px 16px;min-width:0;}
.pf-work h2{margin:0 0 6px;font-size:15px;color:var(--accent);}
.pf-work h3{margin:14px 0 5px;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);}
.pf-work p{margin:4px 0;line-height:1.55;}
.pf-deliv label{display:flex;gap:8px;align-items:flex-start;margin:4px 0;line-height:1.45;cursor:pointer;}
.pf-editor{width:100%;box-sizing:border-box;min-height:220px;padding:8px 10px;border-radius:5px;border:1px solid var(--border);background:#0c0c0c;color:#e5e5e5;font-family:Consolas,'Cascadia Mono',monospace;font-size:12px;line-height:1.45;resize:vertical;}
.pf-row{display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap;}
.pf-btn{padding:6px 11px;border-radius:4px;border:1px solid var(--border);background:var(--panel);color:var(--fg);font:inherit;font-size:12px;cursor:pointer;}
.pf-btn:hover{background:var(--border);}
.pf-btn:disabled{opacity:.55;cursor:default;}
.pf-primary{background:#2563eb;border-color:#2563eb;color:#fff;font-weight:600;}
.pf-finding{border:1px solid var(--border);border-left:3px solid var(--muted);border-radius:5px;padding:7px 9px;margin:6px 0;background:var(--panel-alt);line-height:1.45;}
.pf-finding.Critical{border-left-color:#dc2626;}.pf-finding.High{border-left-color:#f97316;}.pf-finding.Medium{border-left-color:#eab308;}.pf-finding.Low{border-left-color:#60a5fa;}
.pf-finding code{font-size:11px;}
.pf-brief{margin:0 0 6px;line-height:1.55;}
.pf-brief b{color:var(--muted);font-weight:600;}
.pf-vm{border:1px solid var(--border);border-left:3px solid #22c55e;border-radius:6px;padding:10px 12px;margin:12px 0;background:var(--panel-alt);}
.pf-vm.off{border-left-color:var(--muted);}
.pf-vm ol{margin:6px 0;padding-left:20px;}
.pf-vm li{margin:3px 0;}
.pf-vm-res{margin:6px 0;display:flex;gap:6px;line-height:1.45;}
.pf-vm-res .ok{color:#22c55e;}.pf-vm-res .no{color:#ef4444;}
.pf-coach{display:flex;flex-direction:column;min-height:0;border-left:1px solid var(--border);}
.pf-log{flex:1;overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:10px;}
.pf-msg{padding:8px 10px;border-radius:7px;white-space:pre-wrap;line-height:1.55;font-size:12.3px;max-width:94%;}
.pf-msg.ins{white-space:normal;align-self:flex-start;background:var(--panel-alt);border:1px solid var(--border);}
.pf-msg.me{align-self:flex-end;background:#2563eb;color:#fff;}
.pf-msg.sys{align-self:center;color:var(--muted);font-size:11px;text-align:center;}
.pf-src{font-size:10px;color:var(--muted);margin-top:4px;}
.pf-actions{flex-shrink:0;display:flex;gap:6px;padding:8px 12px;border-top:1px solid var(--border);}
.pf-ask{flex-shrink:0;display:flex;gap:6px;padding:0 12px 8px;}
.pf-ask input{flex:1;padding:7px 9px;border-radius:4px;border:1px solid var(--border);background:var(--panel);color:var(--fg);font:inherit;outline:none;}
.pf-foot{flex-shrink:0;padding:0 12px 8px;font-size:10.5px;color:var(--muted);}
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function renderPortfolioWindow(body: HTMLElement): void {
  if (!document.getElementById('pf-css')) {
    const style = document.createElement('style');
    style.id = 'pf-css';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }
  body.innerHTML = '';
  body.style.height = '100%';

  const store = loadStore();
  let project: PortfolioProject = projectById(store.projectId) ?? PORTFOLIO.projects[0]!;
  let busy = false;

  const session = (): ProjectSession => {
    store.sessions[project.id] ??= newProjectSession(project.id);
    return store.sessions[project.id]!;
  };
  const persist = (): void => {
    store.projectId = project.id;
    saveStore(store);
  };

  const root = el('div', 'pf-root');
  const head = el('div', 'pf-head');
  head.append(el('span', 'pf-title', 'IAM Portfolio — 10 projects · IGA · AM · PAM'));
  const verify = el('span', 'pf-verify off', 'Verifying local Ollama…');
  head.append(verify);

  // Checked again on click, and every 20 s while offline, so starting Ollama
  // after opening the window is noticed without reopening it.
  let verifyTimer: ReturnType<typeof setTimeout> | null = null;
  verify.style.cursor = 'pointer';
  verify.addEventListener('click', () => { verify.textContent = 'Verifying local Ollama…'; void refreshVerify(); });
  // --- Reset ------------------------------------------------------------------
  // Start a project (or the whole portfolio) over: conversation, submission,
  // deliverable ticks and VM results. DC01 itself is reset separately, from its
  // Portfolio-Base snapshot, because that powers the VM off and back on.
  const resetWrap = el('div');
  resetWrap.style.cssText = 'position:relative;';
  const resetBtn = el('button', 'pf-btn', 'Reset ▾');
  resetBtn.title = 'Start a project, or the whole portfolio, over';
  const resetMenu = el('div');
  resetMenu.style.cssText =
    'display:none;position:absolute;right:0;top:calc(100% + 4px);z-index:20;min-width:250px;background:var(--panel);' +
    'border:1px solid var(--border);border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.35);padding:4px;';
  const menuItem = (label: string, detail: string, action: () => void | Promise<void>): HTMLElement => {
    const b = el('button');
    b.style.cssText =
      'display:block;width:100%;text-align:left;background:transparent;border:none;color:var(--fg);padding:7px 10px;' +
      'border-radius:4px;cursor:pointer;font:inherit;';
    b.append(el('div', undefined, label));
    const small = el('div', undefined, detail);
    small.style.cssText = 'font-size:11px;color:var(--muted);margin-top:2px;';
    b.append(small);
    b.addEventListener('mouseenter', () => { b.style.background = 'var(--border)'; });
    b.addEventListener('mouseleave', () => { b.style.background = 'transparent'; });
    b.addEventListener('click', () => {
      resetMenu.style.display = 'none';
      void action();
    });
    return b;
  };
  const repaintAll = (): void => {
    persist();
    paintList();
    paintWork();
    repaintLog();
  };
  resetMenu.append(
    menuItem('Reset this project', 'Clears its chat, submission, ticked deliverables and VM results.', () => {
      if (busy || !window.confirm(`Reset Project ${project.number}: ${project.title}? Its conversation, submission, ticked deliverables and VM results are cleared.`)) return;
      delete store.sessions[project.id];
      if (store.vmResults) delete store.vmResults[project.id];
      repaintAll();
      bubble('sys', `Project ${project.number} was reset. Start again from the brief above.`);
    }),
    menuItem('Reset all projects', 'Every project back to the start.', () => {
      if (busy || !window.confirm('Reset ALL ten projects? Every conversation, submission, ticked deliverable and VM result is cleared.')) return;
      store.sessions = {};
      store.vmResults = {};
      repaintAll();
      bubble('sys', 'The whole portfolio was reset.');
    }),
    menuItem('Reset DC01 to Portfolio-Base', 'Undo everything done inside the VM (desktop app, about a minute).', async () => {
      const b = bridge();
      if (!b) {
        bubble('sys', 'Resetting DC01 needs the IAM Range desktop app: a browser tab cannot talk to VirtualBox.');
        return;
      }
      if (!window.confirm('Restore DC01 to the Portfolio-Base snapshot? Everything done inside the VM since "Prepare DC01" is undone. DC01 is powered off and back on.')) return;
      const note = bubble('sys', 'Restoring DC01 to Portfolio-Base… (about a minute)');
      try {
        const r = (await b.invoke('adlab:vm-restore', 'Portfolio-Base')) as { ok: boolean; restored?: string[]; error?: string };
        if (!r?.ok || !r.restored?.includes('DC01')) {
          note.textContent = `Could not restore DC01: ${r?.error ?? 'DC01 has no Portfolio-Base snapshot yet. Run "Prepare DC01" first.'}`;
          return;
        }
        store.vmResults = {};
        persist();
        paintWork();
        note.textContent = 'DC01 is back at Portfolio-Base. Set a project up again to continue.';
      } catch (e) {
        note.textContent = `Could not restore DC01: ${String(e)}`;
      }
    }),
  );
  resetBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    resetMenu.style.display = resetMenu.style.display === 'none' ? 'block' : 'none';
  });
  document.addEventListener('click', (e) => {
    if (!resetWrap.contains(e.target as Node)) resetMenu.style.display = 'none';
  });
  resetWrap.append(resetBtn, resetMenu);
  const guideBtn = el('button', 'pf-btn', '📘 Setup guide');
  guideBtn.title = 'Download Windows Server and the Windows client, and build the real VMs';
  guideBtn.addEventListener('click', () => openLabSetupGuide('portfolio'));
  head.append(guideBtn, resetWrap);

  async function refreshVerify(): Promise<void> {
    if (verifyTimer) clearTimeout(verifyTimer);
    const st = await portfolioStatus();
    // Stops once the window is closed (the banner is no longer in the page).
    if (!st.online) verifyTimer = setTimeout(() => { if (verify.isConnected) void refreshVerify(); }, 20_000);
    verify.className = `pf-verify ${st.online ? 'on' : 'off'}`;
    verify.textContent = st.online ? `${st.message} (${st.model})` : st.message;
    verify.title = st.online
      ? 'The instructor uses this local model. Change it in Settings → AI Assistant.'
      : 'Start Ollama (see omari-lab/11-IAM-PORTFOLIO/Test-OllamaInstructor.ps1), then click here to check again. The checker still works offline.';
  }

  // --- Left: projects -------------------------------------------------------
  const list = el('div', 'pf-list');
  function paintList(): void {
    list.innerHTML = '';
    for (const phase of PORTFOLIO.phases) {
      list.appendChild(el('div', 'pf-phase', phase.title.replace(/^Phase \d+:\s*/, '')));
      for (const p of PORTFOLIO.projects.filter((x) => x.phase === phase.id)) {
        const s = store.sessions[p.id];
        const done = s?.done.length ?? 0;
        const b = el('button', `pf-item${p.id === project.id ? ' on' : ''}`);
        b.append(document.createTextNode(`${done === p.deliverables.length ? '✓ ' : ''}${String(p.number).padStart(2, '0')} ${p.title}`),
          el('small', undefined, `${done}/${p.deliverables.length} deliverables · ${p.folder}`));
        b.addEventListener('click', () => openProject(p));
        list.appendChild(b);
      }
    }
  }

  // --- Centre: brief, deliverables, submission -------------------------------
  const work = el('div', 'pf-work');
  const editor = el('textarea', 'pf-editor');
  editor.spellcheck = false;
  editor.placeholder = 'Paste a script, policy (JSON/YAML) or query (KQL/Lucene) for this project…';
  const findingsBox = el('div');

  function paintFindings(): void {
    findingsBox.innerHTML = '';
    const s = session();
    if (!s.reviewed) return;
    findingsBox.appendChild(el('h3', undefined, `Deterministic checker — ${s.findings.length} finding${s.findings.length === 1 ? '' : 's'}`));
    if (s.findings.length === 0) {
      findingsBox.appendChild(el('p', undefined, 'No rule matched. That is not a pass — read the instructor\'s review.'));
    }
    for (const f of s.findings) {
      const card = el('div', `pf-finding ${f.severity}`);
      card.append(el('b', undefined, `[${f.severity}] ${f.title}`), el('div', undefined, f.control));
      const ev = el('div');
      ev.append(document.createTextNode(f.line ? `Line ${f.line}: ` : ''), el('code', undefined, f.evidence));
      card.append(ev, el('div', undefined, `Hint: ${f.hint}`));
      findingsBox.appendChild(card);
    }
  }

  function paintWork(): void {
    work.innerHTML = '';
    const s = session();
    work.appendChild(el('h2', undefined, `Project ${project.number}: ${project.title}`));
    work.appendChild(el('p', undefined, project.objective));
    for (const [label, text] of [['Lab setup', project.labSetup], ['Execution', project.execution], ['Portfolio deliverable', project.portfolioDeliverable]] as const) {
      const para = el('p', 'pf-brief');
      para.append(el('b', undefined, `${label}: `), document.createTextNode(text));
      work.appendChild(para);
    }
    work.appendChild(vmSection());
    work.appendChild(el('h3', undefined, 'Deliverables — tick when done (your attestation)'));
    const deliv = el('div', 'pf-deliv');
    project.deliverables.forEach((d, i) => {
      const lab = el('label');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = s.done.includes(i);
      cb.addEventListener('change', () => {
        s.done = cb.checked ? [...new Set([...s.done, i])] : s.done.filter((x) => x !== i);
        persist();
        paintList();
      });
      lab.append(cb, document.createTextNode(d));
      deliv.appendChild(lab);
    });
    work.appendChild(deliv);
    work.appendChild(el('h3', undefined, 'What the reviewer will look at'));
    work.appendChild(el('p', undefined, project.reviewFocus.join(' · ')));
    work.appendChild(el('h3', undefined, `Your submission (save it in IAM-Portfolio-Labs/${project.folder}/scripts/)`));
    editor.value = s.submission;
    work.appendChild(editor);
    const row = el('div', 'pf-row');
    const reviewBtn = el('button', 'pf-btn pf-primary', 'Run checks & review');
    reviewBtn.addEventListener('click', () => void review());
    const clearSub = el('button', 'pf-btn', 'Clear submission');
    clearSub.addEventListener('click', () => {
      if (!editor.value || !window.confirm('Clear the pasted submission and its findings?')) return;
      s.submission = '';
      s.findings = [];
      s.reviewed = false;
      persist();
      paintWork();
    });
    row.append(reviewBtn, clearSub);
    work.appendChild(row);
    work.appendChild(findingsBox);
    paintFindings();
  }

  editor.addEventListener('input', () => {
    session().submission = editor.value;
    persist();
  });

  // --- Right: instructor ---------------------------------------------------
  const coach = el('div', 'pf-coach');
  const log = el('div', 'pf-log');
  const actions = el('div', 'pf-actions');
  const hintBtn = el('button', 'pf-btn', 'Hint');
  const clearBtn = el('button', 'pf-btn', 'Clear chat');
  clearBtn.title = 'Clear this project\'s conversation. Your submission, findings and progress are kept.';
  clearBtn.style.marginLeft = 'auto';
  actions.append(hintBtn, clearBtn);
  const ask = el('div', 'pf-ask');
  const askInput = el('input');
  askInput.placeholder = 'Ask the instructor about this project…';
  const askBtn = el('button', 'pf-btn', 'Ask');
  ask.append(askInput, askBtn);
  coach.append(log, actions, ask, el('div', 'pf-foot', 'Code reviewer · security auditor · SOX/SOC 2 compliance auditor. Hints before answers; it never changes anything.'));

  /** Instructor replies are Markdown, rendered safely (no innerHTML). */
  function fill(b: HTMLElement, kind: 'ins' | 'me' | 'sys', text: string, source?: 'ollama' | 'offline'): void {
    b.replaceChildren(kind === 'ins' ? renderMarkdown(text) : document.createTextNode(text));
    if (source) b.appendChild(el('div', 'pf-src', source === 'ollama' ? 'Ollama instructor' : 'Offline instructor (checker + project material)'));
  }

  function bubble(kind: 'ins' | 'me' | 'sys', text: string): HTMLElement {
    const b = el('div', `pf-msg ${kind}`);
    fill(b, kind, text);
    log.appendChild(b);
    log.scrollTop = log.scrollHeight;
    return b;
  }

  function repaintLog(): void {
    log.innerHTML = '';
    for (const t of session().transcript) bubble(t.role === 'user' ? 'me' : 'ins', t.text);
  }

  function setBusy(v: boolean): void {
    busy = v;
    for (const b of [hintBtn, askBtn, clearBtn]) b.disabled = v;
  }

  async function instruct(req: PortfolioRequest): Promise<void> {
    setBusy(true);
    const pending = bubble('ins', '…');
    try {
      const reply = await askPortfolioInstructor(req, project, session(), {
        // Stream: a long review from a CPU model appears as it is written.
        onText: (partial) => {
          fill(pending, 'ins', partial);
          log.scrollTop = log.scrollHeight;
        },
      });
      fill(pending, 'ins', reply.text, reply.source);
      persist();
    } finally {
      setBusy(false);
      void refreshVerify();
    }
  }

  async function review(): Promise<void> {
    const s = session();
    s.submission = editor.value;
    if (!s.submission.trim()) {
      bubble('sys', 'Paste something to review first.');
      return;
    }
    // The deterministic checker never waits for the model.
    s.findings = lintSubmission(s.submission);
    s.reviewed = true;
    persist();
    paintFindings();
    const count = `Checker: ${s.findings.length} finding${s.findings.length === 1 ? '' : 's'}.`;
    if (busy) {
      bubble('sys', `${count} The instructor is still answering — click "Run checks & review" again for its review.`);
      return;
    }
    bubble('sys', `${count} Asking the instructor for the review…`);
    await instruct({ kind: 'review' });
  }

  hintBtn.addEventListener('click', () => {
    if (busy) return;
    const s = session();
    const level = Math.min(3, (s.hintLevel || 0) + 1) as HintLevel;
    s.hintLevel = level;
    persist();
    bubble('sys', `Hint ${level} of 3 — ${level === 1 ? 'Direction' : level === 2 ? 'Investigation' : 'Concept'}`);
    void instruct({ kind: 'hint', level });
  });

  function sendQuestion(): void {
    const q = askInput.value.trim();
    if (!q || busy) return;
    askInput.value = '';
    bubble('me', q);
    void instruct({ kind: 'ask', question: q });
  }
  askBtn.addEventListener('click', sendQuestion);
  askInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendQuestion();
  });

  clearBtn.addEventListener('click', () => {
    if (busy || session().transcript.length === 0) return;
    if (!window.confirm('Clear the conversation for this project? Your submission, findings and progress are kept.')) return;
    clearProjectConversation(session());
    persist();
    log.innerHTML = '';
    bubble('sys', 'Conversation cleared.');
    askInput.focus();
  });

  function openProject(p: PortfolioProject): void {
    project = p;
    persist();
    paintList();
    paintWork();
    repaintLog();
    if (session().transcript.length === 0) void instruct({ kind: 'intro' });
  }

  // --- Real VM track (DC01) --------------------------------------------------
  function vmSection(): HTMLElement {
    const box = el('div', `pf-vm${project.vm.supported ? '' : ' off'}`);
    if (!project.vm.supported) {
      box.append(el('b', undefined, 'Cloud track'), el('p', 'pf-brief', project.vm.summary));
      return box;
    }
    box.append(el('b', undefined, `Real VM track — ${project.vm.host}`), el('p', 'pf-brief', project.vm.summary));
    const ol = el('ol');
    for (const t of project.vm.tasks) ol.appendChild(el('li', undefined, t));
    box.appendChild(ol);
    const guideRow = el('p', 'pf-brief');
    const guideLink = el('button', 'pf-btn', '📘 Need the VMs? Setup guide');
    guideLink.addEventListener('click', () => openLabSetupGuide('portfolio'));
    guideRow.append(guideLink);
    box.appendChild(guideRow);
    const row = el('div', 'pf-row');
    const initBtn = el('button', 'pf-btn', '1. Prepare DC01 (once)');
    initBtn.title = 'Promotes DC01 to corp.technobiz.local if needed, builds the enterprise baseline and saves snapshot Portfolio-Base. Takes 10-30 minutes the first time.';
    const setupBtn = el('button', 'pf-btn', '2. Set up this project in DC01');
    setupBtn.title = 'Creates (or restarts) this project\'s scenario inside DC01.';
    const checkBtn = el('button', 'pf-btn pf-primary', '3. Check my work on the VM');
    row.append(initBtn, setupBtn, checkBtn);
    box.appendChild(row);
    const results = el('div');
    box.appendChild(results);

    const paintResults = (): void => {
      results.innerHTML = '';
      const last = store.vmResults?.[project.id];
      if (!last) return;
      const passed = last.results.filter((r) => r.pass).length;
      results.appendChild(el('p', 'pf-brief', `Last check on DC01 (${new Date(last.at).toLocaleString()}): ${passed}/${last.results.length} passed.`));
      for (const r of last.results) {
        const line = el('div', 'pf-vm-res');
        line.append(el('span', r.pass ? 'ok' : 'no', r.pass ? '✓' : '✗'), el('span', undefined, `${r.label} — ${r.observed}`));
        results.appendChild(line);
      }
    };
    paintResults();

    const needBridge = (): ReturnType<typeof bridge> => {
      const b = bridge();
      if (!b) bubble('sys', 'The VM track needs the IAM Range desktop app: a browser tab cannot talk to VirtualBox.');
      return b;
    };
    const lock = (on: boolean): void => {
      for (const b of [initBtn, setupBtn, checkBtn]) b.disabled = on;
    };

    initBtn.addEventListener('click', async () => {
      const b = needBridge();
      if (!b || !window.confirm('Prepare DC01 for the portfolio? If DC01 is not a domain controller yet it is promoted to corp.technobiz.local (your AD-lab progress stays in its own snapshots). This can take 10-30 minutes.')) return;
      lock(true);
      const note = bubble('sys', 'Preparing DC01… promotion, baseline and the Portfolio-Base snapshot. You can keep reading the brief meanwhile.');
      try {
        const r = (await b.invoke('portfolio:vm-init')) as { ok: boolean; steps?: string[]; error?: string };
        note.textContent = r?.ok ? `DC01 is ready:\n${(r.steps ?? []).join('\n')}` : `Could not prepare DC01: ${r?.error ?? 'no answer'}`;
      } finally {
        lock(false);
      }
    });

    setupBtn.addEventListener('click', async () => {
      const b = needBridge();
      if (!b || !window.confirm(`Set up Project ${project.number} in DC01? If you already set it up, this restarts it (your files in C:\\IAM are kept).`)) return;
      lock(true);
      const note = bubble('sys', `Setting up Project ${project.number} inside DC01…`);
      try {
        const r = (await b.invoke('portfolio:vm-setup', project.id)) as { ok: boolean; message?: string; error?: string };
        note.textContent = r?.ok ? `DC01: ${r.message}` : `Could not set up the project: ${r?.error ?? 'no answer'}`;
      } finally {
        lock(false);
      }
    });

    checkBtn.addEventListener('click', async () => {
      const b = needBridge();
      if (!b || !isVmProject(project.id)) return;
      lock(true);
      const note = bubble('sys', 'Reading DC01 (read-only)…');
      try {
        const r = (await b.invoke('portfolio:vm-facts')) as { ok: boolean; facts?: PortfolioFacts; error?: string };
        if (!r?.ok || !r.facts) {
          note.textContent = `Could not read DC01: ${r?.error ?? 'no answer'}`;
          return;
        }
        const graded = gradeVmProject(project.id, r.facts);
        store.vmResults = { ...(store.vmResults ?? {}), [project.id]: { at: new Date().toISOString(), results: graded } };
        persist();
        paintResults();
        note.textContent = `DC01 checker: ${graded.filter((x) => x.pass).length}/${graded.length} passed.`;
        if (!busy) await instruct({ kind: 'vmCheck', results: graded });
      } finally {
        lock(false);
      }
    });
    return box;
  }

  const main = el('div', 'pf-main');
  main.append(list, work, coach);
  root.append(head, main);
  body.appendChild(root);

  void refreshVerify();
  openProject(project);
}
