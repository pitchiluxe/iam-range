/**
 * ui/consoles/adLabWindow.ts — the Active Directory Enterprise Lab Series.
 *
 * Three panes, three roles:
 *
 *   left    the brief — scenario, objectives, requirements (or, in Real-World
 *           mode, only the ticket) and the last validation checklist
 *   centre  DC01 and CLIENT01 consoles — the student's hands, and the only
 *           thing in this window that changes the lab
 *   right   the Ollama instructor — observes a frozen snapshot, never acts
 *
 * "Check my work" runs the deterministic validation engine first and hands its
 * results to the instructor to explain. A lab is marked complete only when the
 * engine says every check passed; nothing the model writes can mark it.
 *
 * Self-contained: this series has its own simulated estate and does not touch
 * the directory, tickets or lab progress the rest of the workstation uses.
 *
 * Two environments, one examiner. "Simulated" runs the in-app DC01/CLIENT01.
 * "Real VMs" hides the consoles: the student works in the VirtualBox VMs built
 * by omari-lab/10-AD-ENTERPRISE-VBOX, and Check My Work asks the desktop app's
 * main process to read them (read-only), turns that into the same lab state,
 * and grades it with the same validation engine.
 */
import { AD_LABS, type AdLab, hostsForLab, labById, startingState } from '@/vm/adlab/labs';
import { COMMAND_NAMES, runCommand } from '@/vm/adlab/commands';
import { type HostName, type LabState, freshState } from '@/vm/adlab/state';
import { factsToLabState, type RawFactsDocument } from '@/vm/adlab/realVm';
import { validate, type ValidationReport } from '@/vm/adlab/validation';
import { snapshotForInstructor } from '@/vm/adlab/observe';
import { OLLAMA_HOST } from '@/config/ollama';
import {
  HINT_LEVEL_NAME,
  METHODOLOGY,
  MODE_BLURB,
  MODE_LABEL,
  type InstructorMode,
  type InstructorRequest,
  type InstructorSession,
  askInstructor,
  instructorStatus,
  newSession,
  nextHint,
  recordReport,
} from '@/vm/adlab/instructor';

const STORE_KEY = 'adlab_series_v1';
const MODES: InstructorMode[] = ['guided', 'coach', 'interview', 'real-world'];
const HOSTS: HostName[] = ['DC01', 'CLIENT01'];

interface LabSave {
  state: LabState;
  session: InstructorSession;
  notes: string;
  /** The last reading of the real VMs, when working in Real VMs mode. */
  realState?: LabState | null;
  realAt?: string | null;
}

type LabEnv = 'sim' | 'real';

interface VmStatus {
  vmName: string;
  exists: boolean;
  running: boolean;
}

/** The desktop app's bridge. Absent in a plain browser, where Real VMs mode cannot work. */
function bridge(): { invoke: (cmd: string, ...args: unknown[]) => Promise<unknown> } | null {
  const e = (window as unknown as { electron?: { invoke?: (cmd: string, ...args: unknown[]) => Promise<unknown> } }).electron;
  return e?.invoke ? { invoke: e.invoke } : null;
}

interface Store {
  env?: LabEnv;
  labId: string;
  perLab: Record<string, LabSave>;
  completed: string[];
}

function loadStore(): Store {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Store;
      if (s && typeof s.labId === 'string' && s.perLab && Array.isArray(s.completed)) return s;
    }
  } catch {
    // Blocked or corrupt storage: start clean, the lab still works.
  }
  return { labId: AD_LABS[0]!.id, perLab: {}, completed: [] };
}

function saveStore(s: Store): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    // Quota or privacy mode: progress is simply not remembered.
  }
}

const STYLES = `
.adl-root{display:flex;flex-direction:column;height:100%;background:var(--panel);color:var(--fg);font-family:"Segoe UI",system-ui,sans-serif;font-size:12.5px;}
.adl-head{flex-shrink:0;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 12px;background:var(--panel-alt);border-bottom:1px solid var(--border);}
.adl-title{font-weight:650;font-size:13.5px;margin-right:6px;}
.adl-head select,.adl-btn{padding:5px 9px;border-radius:4px;border:1px solid var(--border);background:var(--panel);color:var(--fg);font:inherit;font-size:12px;cursor:pointer;}
.adl-btn:hover{background:var(--border);}
.adl-btn:disabled{opacity:.55;cursor:default;}
.adl-primary{background:#2563eb;border-color:#2563eb;color:#fff;font-weight:600;}
.adl-primary:hover{background:#1d4ed8;}
.adl-badge{margin-left:auto;font-size:11px;color:var(--muted);white-space:nowrap;}
.adl-badge.on{color:var(--accent);}
.adl-badge.off{color:#e2a03f;}
.adl-main{flex:1;min-height:0;display:grid;grid-template-columns:270px minmax(0,1fr) 350px;}
.adl-brief{overflow:auto;padding:12px 14px;border-right:1px solid var(--border);line-height:1.5;}
.adl-brief h3{margin:12px 0 4px;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);}
.adl-brief h2{margin:0 0 6px;font-size:14px;color:var(--accent);}
.adl-brief ul{margin:0;padding-left:16px;}
.adl-brief li{margin:2px 0;}
.adl-ticket{border:1px solid var(--border);border-left:3px solid #e2a03f;border-radius:5px;padding:8px 10px;background:var(--panel-alt);}
.adl-ticket div{margin:2px 0;}
.adl-notes{width:100%;box-sizing:border-box;min-height:110px;margin-top:4px;padding:6px 8px;border-radius:4px;border:1px solid var(--border);background:var(--panel-alt);color:var(--fg);font:inherit;resize:vertical;}
.adl-check{display:flex;gap:6px;margin:3px 0;}
.adl-check .ok{color:#22c55e;}
.adl-check .no{color:#ef4444;}
.adl-done{margin-top:8px;padding:6px 8px;border-radius:4px;background:rgba(34,197,94,.12);color:#22c55e;font-weight:600;}
.adl-consoles{display:flex;flex-direction:column;min-width:0;min-height:0;background:#0c0c0c;}
.adl-tabs{flex-shrink:0;display:flex;background:#1a1a1a;border-bottom:1px solid #333;}
.adl-tab{padding:7px 14px;color:#9ca3af;cursor:pointer;border:none;background:transparent;font:inherit;font-size:12px;border-right:1px solid #333;}
.adl-tab.on{color:#fff;background:#0c0c0c;}
.adl-screen{flex:1;overflow:auto;padding:10px 12px;font-family:Consolas,'Cascadia Mono',Menlo,monospace;font-size:12px;line-height:1.45;color:#d4d4d4;}
.adl-screen pre{margin:0;white-space:pre-wrap;word-break:break-word;font:inherit;}
.adl-line{display:flex;gap:6px;align-items:baseline;}
.adl-ps{color:#60a5fa;flex-shrink:0;}
.adl-input{flex:1;background:transparent;border:none;outline:none;color:#f5f5f5;font:inherit;padding:0;}
.adl-coach{display:flex;flex-direction:column;min-height:0;border-left:1px solid var(--border);}
.adl-coach-head{flex-shrink:0;padding:8px 12px;border-bottom:1px solid var(--border);font-size:11.5px;color:var(--muted);line-height:1.45;}
.adl-log{flex:1;overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:10px;}
.adl-msg{padding:8px 10px;border-radius:7px;white-space:pre-wrap;line-height:1.55;font-size:12.3px;max-width:94%;}
.adl-msg.ins{align-self:flex-start;background:var(--panel-alt);border:1px solid var(--border);}
.adl-msg.me{align-self:flex-end;background:#2563eb;color:#fff;}
.adl-msg.sys{align-self:center;background:transparent;color:var(--muted);font-size:11px;text-align:center;}
.adl-src{font-size:10px;color:var(--muted);margin-top:4px;}
.adl-actions{flex-shrink:0;display:flex;flex-wrap:wrap;gap:6px;padding:8px 12px;border-top:1px solid var(--border);}
.adl-ask{flex-shrink:0;display:flex;gap:6px;padding:0 12px 10px;}
.adl-ask input{flex:1;padding:7px 9px;border-radius:4px;border:1px solid var(--border);background:var(--panel);color:var(--fg);font:inherit;outline:none;}
.adl-foot{flex-shrink:0;padding:0 12px 8px;font-size:10.5px;color:var(--muted);}
.adl-reset{position:relative;display:inline-block;}
.adl-menu{position:absolute;top:calc(100% + 4px);left:0;z-index:20;min-width:300px;padding:6px;border:1px solid var(--border);border-radius:6px;background:var(--panel);box-shadow:0 8px 24px rgba(0,0,0,.35);}
.adl-menu button{display:block;width:100%;text-align:left;padding:7px 9px;border:none;border-radius:4px;background:transparent;color:var(--fg);font:inherit;font-size:12px;cursor:pointer;}
.adl-menu button:hover{background:var(--panel-alt);}
.adl-menu small{display:block;color:var(--muted);font-size:10.5px;margin-top:2px;}
.adl-menu hr{border:none;border-top:1px solid var(--border);margin:4px 0;}
.adl-real{overflow:auto;padding:16px 18px;line-height:1.55;min-width:0;}
.adl-real h2{margin:0 0 6px;font-size:15px;}
.adl-real p{margin:6px 0;color:var(--fg);}
.adl-real .muted{color:var(--muted);font-size:11.5px;}
.adl-vms{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin:12px 0;}
.adl-vm{border:1px solid var(--border);border-radius:7px;padding:10px 12px;background:var(--panel-alt);}
.adl-vm b{font-size:13px;}
.adl-vm .st{margin:4px 0 8px;font-size:11.5px;}
.adl-vm .st.on{color:#22c55e;}
.adl-vm .st.off{color:#e2a03f;}
.adl-steps{margin:8px 0;padding-left:18px;}
.adl-steps li{margin:3px 0;}
.adl-problem{margin:4px 0;color:#f87171;}
.adl-real code{background:var(--panel-alt);border:1px solid var(--border);border-radius:3px;padding:0 5px;font-size:11.5px;}
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function renderAdLabWindow(body: HTMLElement): void {
  if (!document.getElementById('adl-css')) {
    const style = document.createElement('style');
    style.id = 'adl-css';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }
  body.innerHTML = '';
  body.style.height = '100%';

  const store = loadStore();
  let lab: AdLab = labById(store.labId) ?? AD_LABS[0]!;
  let save: LabSave = store.perLab[lab.id] ?? freshSave(lab);
  let activeHost: HostName = 'DC01';
  let busy = false;
  let commandsSinceQuestion = 0;
  const scrollback: Record<HostName, HTMLElement[]> = { DC01: [], CLIENT01: [] };
  const cmdHistory: Record<HostName, string[]> = { DC01: [], CLIENT01: [] };
  let histIdx = -1;

  function freshSave(l: AdLab): LabSave {
    return { state: startingState(l.id), session: newSession(l.id, l.defaultMode), notes: '' };
  }
  function persist(): void {
    store.labId = lab.id;
    store.perLab[lab.id] = save;
    saveStore(store);
  }

  const root = el('div', 'adl-root');

  // --- Header ---------------------------------------------------------------
  const head = el('div', 'adl-head');
  head.appendChild(el('span', 'adl-title', 'AD Enterprise Lab Series'));
  const labSel = el('select');
  labSel.title = 'Lab';
  const modeSel = el('select');
  modeSel.title = 'Instructor mode';
  for (const m of MODES) {
    const o = el('option', undefined, `${MODE_LABEL[m]} mode`);
    o.value = m;
    modeSel.appendChild(o);
  }
  const envSel = el('select');
  envSel.title = 'Where you do the lab';
  for (const [v, t] of [['sim', 'Simulated lab'], ['real', 'Real VMs (VirtualBox)']] as const) {
    const o = el('option', undefined, t);
    o.value = v;
    envSel.appendChild(o);
  }
  let env: LabEnv = store.env ?? 'sim';
  envSel.value = env;
  const resetWrap = el('div', 'adl-reset');
  const resetBtn = el('button', 'adl-btn', 'Start over ▾');
  resetBtn.title = 'Restart this lab or the whole series — any time';
  resetWrap.appendChild(resetBtn);
  const badge = el('span', 'adl-badge', 'Checking Ollama…');
  head.append(labSel, envSel, modeSel, resetWrap, badge);

  /** The state being examined: the simulator's, or the last reading of the real VMs. */
  function activeState(): LabState {
    return env === 'real' ? (save.realState ?? freshState()) : save.state;
  }

  function paintLabSelect(): void {
    labSel.innerHTML = '';
    for (const l of AD_LABS) {
      const o = el('option', undefined, `${store.completed.includes(l.id) ? '✓ ' : ''}Lab ${String(l.number).padStart(2, '0')} — ${l.title}`);
      o.value = l.id;
      labSel.appendChild(o);
    }
    labSel.value = lab.id;
  }

  async function refreshStatus(): Promise<void> {
    const st = await instructorStatus();
    badge.className = `adl-badge ${st.online ? 'on' : 'off'}`;
    badge.textContent = st.online ? `● Ollama Instructor — ${st.model}` : '○ Ollama Instructor Offline';
    badge.title = st.online
      ? 'The instructor composes replies with your local model. Change the model in Settings → AI Assistant.'
      : st.reason === 'no-models'
        ? 'Ollama is running but has no models. Pull one (see Settings → AI Assistant). The lab works without it.'
        : `Ollama is not reachable at ${OLLAMA_HOST}. The lab and validation work without it; the instructor answers from the lab material.`;
  }

  // --- Brief (left) -----------------------------------------------------------
  const brief = el('div', 'adl-brief');

  function renderBrief(): void {
    brief.innerHTML = '';
    const mode = save.session.mode;
    brief.appendChild(el('h2', undefined, `Lab ${String(lab.number).padStart(2, '0')}: ${lab.title}`));
    if (lab.ticket) {
      const t = el('div', 'adl-ticket');
      t.append(
        el('div', undefined, `${lab.ticket.id} · ${lab.ticket.priority}`),
        el('div', undefined, `USER: ${lab.ticket.user}`),
        el('div', undefined, `COMPUTER: ${lab.ticket.computer}`),
        el('div', undefined, `ISSUE: ${lab.ticket.issue}`),
      );
      brief.appendChild(t);
      brief.append(el('h3', undefined, 'Business context'), el('div', undefined, lab.ticket.business));
    } else {
      brief.append(el('h3', undefined, 'Business scenario'), el('div', undefined, lab.scenario));
    }
    const section = (title: string, items: string[]): void => {
      brief.appendChild(el('h3', undefined, title));
      const ul = el('ul');
      for (const i of items) ul.appendChild(el('li', undefined, i));
      brief.appendChild(ul);
    };
    if (mode !== 'real-world') {
      section('Objectives', lab.objectives);
      if (!lab.ticket) section('Requirements', lab.requirements);
      brief.append(el('h3', undefined, 'Expected result'), el('div', undefined, lab.expectedResult));
    }
    section('Available tools', lab.tools);
    brief.append(el('h3', undefined, 'Troubleshooting method'), el('div', undefined, METHODOLOGY.map((m, i) => `${i + 1}. ${m}`).join('  ')));

    if (lab.checks.includes('ticket-documented')) {
      brief.appendChild(el('h3', undefined, 'Resolution notes'));
      const ta = el('textarea', 'adl-notes');
      ta.placeholder = 'Symptom, evidence, root cause, fix, verification…';
      ta.value = save.notes;
      ta.addEventListener('input', () => {
        save.notes = ta.value;
        persist();
      });
      brief.appendChild(ta);
    }

    const report = save.session.lastReport;
    if (report) {
      brief.appendChild(el('h3', undefined, `Validation (${report.score.passed}/${report.score.total})`));
      for (const r of report.results) {
        const row = el('div', 'adl-check');
        row.append(el('span', r.pass ? 'ok' : 'no', r.pass ? '✓' : '✗'), el('span', undefined, r.label));
        brief.appendChild(row);
      }
      if (report.passed) brief.appendChild(el('div', 'adl-done', 'Validation engine: lab complete'));
    }
  }

  // --- Consoles (centre) ----------------------------------------------------
  const consoles = el('div', 'adl-consoles');
  const tabs = el('div', 'adl-tabs');
  const screen = el('div', 'adl-screen');
  const tabBtns = HOSTS.map((h) => {
    const b = el('button', 'adl-tab');
    b.addEventListener('click', () => switchHost(h));
    tabs.appendChild(b);
    return { h, b };
  });
  consoles.append(tabs, screen);

  const inputLine = el('div', 'adl-line');
  const ps = el('span', 'adl-ps');
  const input = el('input', 'adl-input');
  input.spellcheck = false;
  input.autocomplete = 'off';
  inputLine.append(ps, input);

  function promptText(): string {
    const h = save.state.hosts[activeHost];
    return `PS ${h.hostname}> `;
  }

  function paintTabs(): void {
    for (const { h, b } of tabBtns) {
      const host = save.state.hosts[h];
      b.textContent = `${h === 'DC01' ? '🖥️' : '💻'} ${h}${host.hostname !== h ? ` (${host.hostname})` : ''}`;
      b.classList.toggle('on', h === activeHost);
    }
  }

  function print(text: string, color = '#d4d4d4'): void {
    const pre = el('pre', undefined, text);
    pre.style.color = color;
    scrollback[activeHost].push(pre);
    screen.insertBefore(pre, inputLine);
    screen.scrollTop = screen.scrollHeight;
  }

  function paintScreen(): void {
    screen.innerHTML = '';
    for (const node of scrollback[activeHost]) screen.appendChild(node);
    screen.appendChild(inputLine);
    ps.textContent = promptText();
    screen.scrollTop = screen.scrollHeight;
  }

  function switchHost(h: HostName): void {
    activeHost = h;
    histIdx = -1;
    paintTabs();
    if (scrollback[h].length === 0) greet(h);
    paintScreen();
    input.focus();
  }

  function greet(h: HostName): void {
    const host = save.state.hosts[h];
    const pre = el('pre', undefined, `Windows PowerShell — ${host.os}\nSigned in as Administrator on ${host.hostname}. Type "help" for the commands this lab supports.\n`);
    pre.style.color = '#9ca3af';
    scrollback[h].push(pre);
  }

  function run(line: string): void {
    const echo = el('pre', undefined, `${promptText()}${line}`);
    echo.style.color = '#f5f5f5';
    scrollback[activeHost].push(echo);
    screen.insertBefore(echo, inputLine);
    if (line.trim()) cmdHistory[activeHost].push(line);
    histIdx = -1;

    const res = runCommand(save.state, activeHost, line);
    if (res.clear) {
      scrollback[activeHost] = [];
      paintScreen();
      // Re-attaching the prompt line drops focus; keep the student typing.
      input.focus();
    } else if (res.output) print(res.output, res.ok ? '#d4d4d4' : '#f87171');
    ps.textContent = promptText();
    paintTabs();
    persist();

    // Interview mode asks while you work, not only when you ask it.
    if (save.session.mode === 'interview' && line.trim() && res.ok) {
      commandsSinceQuestion++;
      if (commandsSinceQuestion >= 5 && !busy) {
        commandsSinceQuestion = 0;
        void instruct({ kind: 'interview' });
      }
    }
  }

  input.addEventListener('keydown', (e) => {
    const hist = cmdHistory[activeHost];
    if (e.key === 'Enter') {
      const line = input.value;
      input.value = '';
      run(line);
    } else if (e.key === 'ArrowUp') {
      if (hist.length === 0) return;
      histIdx = histIdx < 0 ? hist.length - 1 : Math.max(0, histIdx - 1);
      input.value = hist[histIdx]!;
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      if (histIdx < 0) return;
      histIdx++;
      if (histIdx >= hist.length) {
        histIdx = -1;
        input.value = '';
      } else input.value = hist[histIdx]!;
      e.preventDefault();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const v = input.value;
      if (v.includes(' ')) return;
      const matches = COMMAND_NAMES.filter((n) => n.startsWith(v.toLowerCase()) && n.includes('-'));
      if (matches.length === 1) input.value = properCase(matches[0]!) + ' ';
      else if (matches.length > 1) print(matches.map(properCase).join('   '), '#9ca3af');
    } else if (e.key.toLowerCase() === 'l' && e.ctrlKey) {
      e.preventDefault();
      scrollback[activeHost] = [];
      paintScreen();
      input.focus();
    }
  });
  screen.addEventListener('click', () => {
    if (!window.getSelection()?.toString()) input.focus();
  });

  // --- Instructor (right) ---------------------------------------------------
  const coach = el('div', 'adl-coach');
  const coachHead = el('div', 'adl-coach-head');
  const log = el('div', 'adl-log');
  const actions = el('div', 'adl-actions');
  const checkBtn = el('button', 'adl-btn adl-primary', 'CHECK MY WORK');
  const hintBtn = el('button', 'adl-btn', 'Hint');
  const interviewBtn = el('button', 'adl-btn', 'Ask me a question');
  actions.append(checkBtn, hintBtn, interviewBtn);
  const ask = el('div', 'adl-ask');
  const askInput = el('input');
  askInput.placeholder = 'Ask your instructor…';
  const askBtn = el('button', 'adl-btn', 'Ask');
  ask.append(askInput, askBtn);
  const foot = el('div', 'adl-foot', 'The instructor can see your lab but cannot change it. You make every change.');
  coach.append(coachHead, log, actions, ask, foot);

  function paintCoachHead(): void {
    coachHead.textContent = `${MODE_LABEL[save.session.mode]} mode — ${MODE_BLURB[save.session.mode]}`;
    interviewBtn.style.display = save.session.mode === 'interview' || save.session.mode === 'guided' ? '' : 'none';
  }

  function bubble(kind: 'ins' | 'me' | 'sys', text: string, source?: 'ollama' | 'offline'): HTMLElement {
    const b = el('div', `adl-msg ${kind}`, text);
    if (source) b.appendChild(el('div', 'adl-src', source === 'ollama' ? 'Ollama instructor' : 'Offline instructor (from lab material)'));
    log.appendChild(b);
    log.scrollTop = log.scrollHeight;
    return b;
  }

  function repaintTranscript(): void {
    log.innerHTML = '';
    for (const t of save.session.transcript) bubble(t.role === 'student' ? 'me' : 'ins', t.text);
  }

  function setBusy(v: boolean): void {
    busy = v;
    for (const b of [checkBtn, hintBtn, interviewBtn, askBtn]) b.disabled = v;
  }

  async function instruct(req: InstructorRequest): Promise<void> {
    setBusy(true);
    const pending = bubble('ins', '…');
    try {
      // A frozen copy: the instructor observes the lab as it is right now and
      // has no way to reach the live state the consoles are changing.
      const reply = await askInstructor(req, {
        lab,
        view: snapshotForInstructor(activeState()),
        session: save.session,
        notes: save.notes,
      });
      pending.textContent = reply.text;
      pending.appendChild(el('div', 'adl-src', reply.source === 'ollama' ? 'Ollama instructor' : 'Offline instructor (from lab material)'));
      persist();
    } finally {
      setBusy(false);
      log.scrollTop = log.scrollHeight;
      void refreshStatus();
    }
  }

  function runValidation(record: boolean): ValidationReport {
    const report = validate(lab.id, lab.checks, { state: activeState(), notes: save.notes });
    if (record) recordReport(save.session, report);
    else save.session.lastReport = report;
    if (report.passed && !store.completed.includes(lab.id)) {
      store.completed.push(lab.id);
      paintLabSelect();
    }
    renderBrief();
    persist();
    return report;
  }

  /** Read both real VMs through the desktop app. False (with messages shown) when they cannot be graded. */
  async function readRealVms(): Promise<boolean> {
    const b = bridge();
    if (!b) {
      bubble('sys', 'Real VMs mode needs the IAM Range desktop app: a browser tab cannot talk to VirtualBox.');
      return false;
    }
    setBusy(true);
    const note = bubble('sys', 'Reading DC01 and CLIENT01 (read-only)… this takes 20–60 seconds.');
    try {
      const res = (await b.invoke('adlab:vm-facts')) as { ok: boolean; doc?: RawFactsDocument; error?: string };
      if (!res?.ok || !res.doc) {
        note.textContent = `Could not read the VMs: ${res?.error ?? 'no answer from the desktop app'}`;
        return false;
      }
      const reading = factsToLabState(res.doc);
      // Only the machines this lab's checks read have to be ready.
      realProblems = hostsForLab(lab).map((h) => reading.problemsByHost[h]).filter((p): p is string => !!p);
      if (realProblems.length) {
        note.textContent = `Cannot grade yet:\n${realProblems.join('\n')}`;
        paintReal();
        return false;
      }
      save.realState = reading.state;
      save.realAt = reading.collectedAt;
      note.textContent = 'Read both VMs.';
      paintReal();
      persist();
      return true;
    } finally {
      setBusy(false);
    }
  }

  checkBtn.addEventListener('click', async () => {
    if (busy) return;
    if (env === 'real' && !(await readRealVms())) return;
    const report = runValidation(true);
    // Passing a lab on the real VMs is exactly the next lab's starting point.
    // Saving restarts the VMs, so ask rather than surprise.
    const next = AD_LABS[AD_LABS.indexOf(lab) + 1];
    if (env === 'real' && report.passed && next
      && window.confirm(`Lab ${labNo(lab)} passed. Save this as Lab ${labNo(next)}'s start point, so you can restart Lab ${labNo(next)} later? The VMs restart once (about a minute).`)) {
      void saveStartPoint(next, true);
    }
    bubble('sys', `Validation engine: ${report.score.passed}/${report.score.total} checks passed`);
    void instruct({ kind: 'check', report });
  });

  hintBtn.addEventListener('click', () => {
    if (busy) return;
    if (env === 'real' && !save.realState) {
      bubble('sys', 'Click CHECK MY WORK first so the VMs are read — hints follow what the checker finds.');
      return;
    }
    // The engine, not the model, decides what is failing and so what to hint at.
    const report = runValidation(false);
    if (report.passed) {
      bubble('sys', 'Every check passes — no hints needed. Click CHECK MY WORK to have it reviewed.');
      return;
    }
    const h = nextHint(save.session);
    if (!h) {
      bubble('sys', 'You have had all three hints for every failing check. Ask the instructor to explain the solution — you will still make the change yourself.');
      return;
    }
    bubble('sys', `Hint ${h.level} of 3 — ${HINT_LEVEL_NAME[h.level]}`);
    void instruct({ kind: 'hint', checkId: h.checkId, level: h.level });
  });

  interviewBtn.addEventListener('click', () => {
    if (!busy) void instruct({ kind: 'interview' });
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

  // --- Lab switching --------------------------------------------------------
  function openLab(l: AdLab, fresh: boolean): void {
    lab = l;
    save = !fresh && store.perLab[l.id] ? store.perLab[l.id]! : freshSave(l);
    modeSel.value = save.session.mode;
    scrollback.DC01 = [];
    scrollback.CLIENT01 = [];
    cmdHistory.DC01 = save.state.history.filter((h) => h.host === 'DC01').map((h) => h.command);
    cmdHistory.CLIENT01 = save.state.history.filter((h) => h.host === 'CLIENT01').map((h) => h.command);
    // Client-side labs open on the client; tickets open on the admin console,
    // because investigating starts from the directory, not the user's desk.
    activeHost = !lab.ticket && lab.checks[0]?.startsWith('client-') ? 'CLIENT01' : 'DC01';
    commandsSinceQuestion = 0;
    persist();
    paintLabSelect();
    paintCoachHead();
    renderBrief();
    repaintTranscript();
    switchHost(activeHost);
    if (save.session.transcript.length === 0) void instruct({ kind: 'intro' });
    else bubble('sys', 'Lab restored where you left it.');
  }

  labSel.addEventListener('change', () => {
    const l = labById(labSel.value);
    if (l) openLab(l, false);
  });
  modeSel.addEventListener('change', () => {
    save.session.mode = modeSel.value as InstructorMode;
    commandsSinceQuestion = 0;
    paintCoachHead();
    renderBrief();
    persist();
    bubble('sys', `Instructor switched to ${MODE_LABEL[save.session.mode]} mode.`);
  });
  // --- Start over ------------------------------------------------------------
  // Always available, in both environments. Simulated: rebuild state. Real
  // VMs: restore VirtualBox snapshots — "LabNN-Start" for one lab,
  // "Lab01-Start" for the whole series.
  const labNo = (l: AdLab): string => String(l.number).padStart(2, '0');
  const startPoint = (l: AdLab): string => `Lab${labNo(l)}-Start`;
  let menu: HTMLElement | null = null;

  function closeMenu(): void {
    menu?.remove();
    menu = null;
  }

  function menuItem(title: string, detail: string, action: () => void): HTMLButtonElement {
    const b = el('button');
    b.append(document.createTextNode(title), el('small', undefined, detail));
    b.addEventListener('click', () => {
      closeMenu();
      action();
    });
    return b;
  }

  /** Forget the app's own progress for these labs (transcripts, checks, completion). */
  function forgetProgress(ids: string[]): void {
    for (const id of ids) delete store.perLab[id];
    store.completed = store.completed.filter((id) => !ids.includes(id));
    saveStore(store);
  }

  function restartLabSim(): void {
    if (!window.confirm(`Start Lab ${labNo(lab)} over? Everything you changed in this lab is discarded.`)) return;
    forgetProgress([lab.id]);
    openLab(lab, true);
    bubble('sys', `Lab ${labNo(lab)} restarted from its starting state.`);
  }

  function restartSeriesSim(): void {
    if (!window.confirm('Start the whole series over? All 11 labs, their progress and completion marks are cleared.')) return;
    forgetProgress(AD_LABS.map((l) => l.id));
    openLab(AD_LABS[0]!, true);
    bubble('sys', 'The series was reset. You are back at Lab 01 with fresh machines.');
  }

  async function restoreReal(name: string, forget: string[], firstLab: AdLab): Promise<void> {
    const b = bridge();
    if (!b) {
      bubble('sys', 'Restoring VMs needs the IAM Range desktop app.');
      return;
    }
    setBusy(true);
    const note = bubble('sys', `Restoring the VMs to "${name}"… this powers them off and back on (about a minute).`);
    try {
      const res = (await b.invoke('adlab:vm-restore', name)) as { ok: boolean; restored?: string[]; missing?: string[]; error?: string };
      if (!res?.ok) {
        note.textContent = `Could not restore "${name}": ${res?.error ?? 'no answer from the desktop app'}`;
        if (name !== 'Lab01-Start') {
          bubble('sys', `Tip: use "Save this lab's start point" at the beginning of a lab, or restart the whole series from Lab01-Start.`);
        }
        return;
      }
      forgetProgress(forget);
      openLab(firstLab, true);
      save.realState = null;
      save.realAt = null;
      persist();
      note.textContent = `Restored ${res.restored?.join(' and ')} to "${name}".`
        + (res.missing?.length ? ` ${res.missing.join(', ')} had no "${name}" snapshot and was left as it is.` : '');
      await refreshVms();
    } finally {
      setBusy(false);
    }
  }

  async function saveStartPoint(l: AdLab, quiet = false): Promise<void> {
    const b = bridge();
    if (!b) return;
    const note = quiet ? null : bubble('sys', `Saving "${startPoint(l)}": the running VMs shut down cleanly, are snapshotted and start again (about a minute)…`);
    const res = (await b.invoke('adlab:vm-save', startPoint(l))) as { ok: boolean; saved?: string[]; error?: string };
    const text = res?.ok
      ? `Saved start point "${startPoint(l)}" (${res.saved?.join(', ')}). "Restart this lab" can now return here.`
      : `Could not save "${startPoint(l)}": ${res?.error ?? 'no answer'}`;
    if (note) note.textContent = text;
    else bubble('sys', text);
  }

  resetBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu) {
      closeMenu();
      return;
    }
    menu = el('div', 'adl-menu');
    if (env === 'sim') {
      menu.append(
        menuItem(`Restart Lab ${labNo(lab)}`, 'Rebuild this lab\'s starting machines and clear its progress.', restartLabSim),
        menuItem('Restart the whole series', 'Clear every lab and go back to Lab 01.', restartSeriesSim),
      );
    } else {
      menu.append(
        menuItem(`Restart Lab ${labNo(lab)}`, `Restore both VMs to snapshot "${startPoint(lab)}".`, () => {
          if (window.confirm(`Restore the VMs to "${startPoint(lab)}"? Changes made since then inside the VMs are lost.`)) {
            void restoreReal(startPoint(lab), [lab.id], lab);
          }
        }),
        menuItem('Restart the whole series', 'Restore both VMs to "Lab01-Start" (fresh Windows) and clear all progress.', () => {
          if (window.confirm('Restore both VMs to "Lab01-Start" and clear all progress? Everything done inside the VMs is lost.')) {
            void restoreReal('Lab01-Start', AD_LABS.map((l) => l.id), AD_LABS[0]!);
          }
        }),
        el('hr'),
        menuItem(`Save Lab ${labNo(lab)}'s start point`, `Snapshot the VMs now as "${startPoint(lab)}" (replaces an older one).`, () => {
          void saveStartPoint(lab);
        }),
      );
    }
    resetWrap.appendChild(menu);
  });
  document.addEventListener('click', (e) => {
    if (menu && !resetWrap.contains(e.target as Node)) closeMenu();
  });

  // --- Real VMs (centre, replaces the consoles) -----------------------------
  const realPanel = el('div', 'adl-real');
  let realProblems: string[] = [];
  let vmStatus: Record<string, VmStatus> | null = null;
  let statusError: string | null = null;

  async function refreshVms(): Promise<void> {
    const b = bridge();
    if (!b) {
      statusError = 'Open this lab in the IAM Range desktop app to use Real VMs — a browser tab cannot talk to VirtualBox.';
      paintReal();
      return;
    }
    const res = (await b.invoke('adlab:vm-status')) as { ok: boolean; vms?: Record<string, VmStatus>; error?: string };
    statusError = res?.ok ? null : (res?.error ?? 'No answer from the desktop app.');
    vmStatus = res?.vms ?? null;
    paintReal();
  }

  function paintReal(): void {
    realPanel.innerHTML = '';
    realPanel.appendChild(el('h2', undefined, 'Real VMs — VirtualBox'));
    realPanel.appendChild(el('p', undefined,
      'Do this lab inside the real machines, in their VirtualBox windows. Nothing is typed here: the consoles are the VMs.'));
    const cards = el('div', 'adl-vms');
    for (const key of HOSTS) {
      const st = vmStatus?.[key];
      const card = el('div', 'adl-vm');
      card.appendChild(el('b', undefined, `${key === 'DC01' ? '🖥️' : '💻'} ${key}`));
      const line = el('div', `st ${st?.running ? 'on' : 'off'}`,
        !st ? 'Status unknown' : !st.exists ? `Not built yet (${st.vmName})` : st.running ? `Running — ${st.vmName}` : `Powered off — ${st.vmName}`);
      card.appendChild(line);
      if (st?.exists && !st.running) {
        const start = el('button', 'adl-btn', 'Start VM');
        start.addEventListener('click', async () => {
          start.disabled = true;
          start.textContent = 'Starting…';
          await bridge()?.invoke('adlab:vm-start', key);
          await refreshVms();
        });
        card.appendChild(start);
      }
      cards.appendChild(card);
    }
    realPanel.appendChild(cards);
    const refresh = el('button', 'adl-btn', 'Refresh status');
    refresh.addEventListener('click', () => void refreshVms());
    realPanel.appendChild(refresh);
    if (statusError) realPanel.appendChild(el('div', 'adl-problem', statusError));
    for (const p of realProblems) realPanel.appendChild(el('div', 'adl-problem', p));

    realPanel.appendChild(el('h3', undefined, 'How to work'));
    const steps = el('ol', 'adl-steps');
    for (const s of [
      'Click inside the VM window. Sign in as Administrator (the lab password is in omari-lab\\10-AD-ENTERPRISE-VBOX\\adlab.vbox.json).',
      'Open PowerShell as administrator: right-click Start → Terminal (Admin) or Windows PowerShell (Admin).',
      'Work the lab on the left with the same commands as the simulator — or the GUI tools (Server Manager, ncpa.cpl, ADUC, DHCP console).',
      'Click CHECK MY WORK. The app reads both VMs without changing them and runs the same checker; the instructor explains the result.',
    ]) steps.appendChild(el('li', undefined, s));
    realPanel.appendChild(steps);
    realPanel.appendChild(el('p', 'muted',
      'One real environment runs the whole series: Lab 02 builds on what you did in Lab 01. To go back, use '
      + 'Start over ▾ — restart this lab (its "LabNN-Start" snapshot) or the whole series ("Lab01-Start"). Passing a '
      + 'lab offers to save the next lab\'s start point.'));
    if (save.realAt) realPanel.appendChild(el('p', 'muted', `Last reading of the VMs: ${new Date(save.realAt).toLocaleString()}`));
  }

  function paintEnv(): void {
    consoles.style.display = env === 'sim' ? '' : 'none';
    realPanel.style.display = env === 'real' ? '' : 'none';
    if (env === 'real') {
      paintReal();
      void refreshVms();
    }
  }

  envSel.addEventListener('change', () => {
    env = envSel.value as LabEnv;
    store.env = env;
    saveStore(store);
    paintEnv();
    bubble('sys', env === 'real'
      ? 'Real VMs mode: work in the VirtualBox windows. CHECK MY WORK reads the VMs and grades them with the same checker.'
      : 'Simulated mode: use the DC01 and CLIENT01 consoles in the middle.');
  });

  const main = el('div', 'adl-main');
  main.append(brief, consoles, realPanel, coach);
  root.append(head, main);
  body.appendChild(root);

  paintLabSelect();
  void refreshStatus();
  openLab(lab, false);
  paintEnv();
}

function properCase(name: string): string {
  return name.split('-').map((p) => {
    const special: Record<string, string> = {
      ad: 'AD', addsforest: 'ADDSForest', netipaddress: 'NetIPAddress', netipconfiguration: 'NetIPConfiguration',
      netipinterface: 'NetIPInterface', netadapter: 'NetAdapter', dnsclientserveraddress: 'DnsClientServerAddress',
      dhcpserverindc: 'DhcpServerInDC', dhcpserverv4scope: 'DhcpServerv4Scope', dhcpserverv4optionvalue: 'DhcpServerv4OptionValue',
      dhcpserverv4lease: 'DhcpServerv4Lease', adorganizationalunit: 'ADOrganizationalUnit', aduser: 'ADUser', adgroup: 'ADGroup',
      adgroupmember: 'ADGroupMember', adaccount: 'ADAccount', adaccountpassword: 'ADAccountPassword', adcomputer: 'ADComputer',
      adobject: 'ADObject', addomain: 'ADDomain', adforest: 'ADForest', gpo: 'GPO', gplink: 'GPLink', smbshare: 'SmbShare',
      smbshareaccess: 'SmbShareAccess', windowsfeature: 'WindowsFeature', remoteaccess: 'RemoteAccess', dnsname: 'DnsName',
      netconnection: 'NetConnection', computersecurechannel: 'ComputerSecureChannel', winevent: 'WinEvent', eventlog: 'EventLog',
      addefaultdomainpasswordpolicy: 'ADDefaultDomainPasswordPolicy', adprincipalgroupmembership: 'ADPrincipalGroupMembership',
      netroute: 'NetRoute',
    };
    return special[p] ?? p.charAt(0).toUpperCase() + p.slice(1);
  }).join('-');
}
