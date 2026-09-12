/**
 * ui/consoles/careerLabWindow.ts — Career Lab: the four-year curriculum.
 *
 * A launch pad for the OMARI Technologies four-year identity career path.
 * Each year can be started directly from here: the Manual opens at the first
 * lesson, the Lab Plan shows the derived progress, and the real-VM scenario
 * path is listed for the Hyper-V build.
 */

import { CAREER_YEARS } from '@/config/careerLab';
import { CAREER_LABS } from '@/config';
import { MANUAL } from '@/config/manual';
import { COMPANY } from '@/config';
import { requestApp } from '@/util/appLauncher';

const STYLES = `
  .cl-root {
    display: flex; flex-direction: column; height: 100%;
    background: var(--panel); color: var(--fg);
    font-family: "Segoe UI", system-ui, sans-serif; font-size: 12.5px;
  }
  .cl-header {
    flex-shrink: 0; padding: 14px 18px; border-bottom: 1px solid var(--border);
    background: var(--panel-alt);
  }
  .cl-title { font-size: 16px; font-weight: 650; margin: 0 0 4px; }
  .cl-subtitle { color: var(--muted); font-size: 11.5px; margin: 0; }
  .cl-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 18px; }
  .cl-year { margin-bottom: 22px; padding: 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel-alt); }
  .cl-year-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; margin-bottom: 10px; }
  .cl-year-title { font-size: 14px; font-weight: 600; margin: 0 0 4px; color: var(--accent); }
  .cl-year-summary { color: var(--muted); margin: 0 0 10px; line-height: 1.5; }
  .cl-year-meta { color: var(--muted); font-size: 11px; margin-bottom: 10px; }
  .cl-year-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
  .cl-btn {
    padding: 7px 14px; border: 1px solid var(--border); border-radius: 5px;
    background: var(--bg); color: var(--fg); font-family: inherit; font-size: 12px;
    cursor: pointer; transition: background .1s;
  }
  .cl-btn:hover { background: var(--border); }
  .cl-btn-primary { background: var(--accent); color: white; border-color: var(--accent); }
  .cl-btn-primary:hover { filter: brightness(1.1); }
  .cl-phases { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px; }
  .cl-phase {
    padding: 10px 12px; border: 1px solid var(--border); border-radius: 6px;
    background: var(--panel);
  }
  .cl-phase-title { font-weight: 600; margin: 0 0 4px; }
  .cl-phase-summary { color: var(--muted); font-size: 11.5px; line-height: 1.45; margin: 0 0 6px; }
  .cl-skills { display: flex; flex-wrap: wrap; gap: 4px; }
  .cl-skill {
    font-size: 10px; padding: 2px 6px; border-radius: 3px;
    background: var(--border); color: var(--fg);
  }
  .cl-vm {
    margin-top: 12px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 5px;
    background: var(--panel); color: var(--muted); font-size: 11px; line-height: 1.5;
  }
  .cl-note {
    margin-top: 18px; padding: 10px 12px; border: 1px solid var(--border);
    border-radius: 6px; background: var(--panel-alt); color: var(--muted); line-height: 1.5;
  }
`;

const VM_PATHS: Record<string, string> = {
  'year-1': 'omari-lab/05-CONFIGURATION and 06-CHECKPOINTS (baseline build)',
  'year-2': 'omari-lab/07-YEAR-2-IAM-ANALYST/Set-Y2Scenario.ps1',
  'year-3': 'omari-lab/08-YEAR-3-IAM-ENGINEER/Set-Y3Scenario.ps1',
  'year-4': 'omari-lab/09-YEAR-4-IAM-ARCHITECT (Get-Y4RiskReport.ps1 + Set-Y4Scenario.ps1)',
};

function startYear(yearId: string): void {
  const chapter = MANUAL.find((c) => c.id === yearId);
  const firstLesson = chapter?.lessons[0]?.id;
  if (firstLesson) {
    localStorage.setItem('manual_last_lesson', firstLesson);
  }
  requestApp('manual');
  requestApp('lab-plan');
}

function openTerminal(): void {
  requestApp('terminal');
}

export function renderCareerLabWindow(body: HTMLElement): void {
  if (!document.getElementById('career-lab-css')) {
    const style = document.createElement('style');
    style.id = 'career-lab-css';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  const root = document.createElement('div');
  root.className = 'cl-root';

  const header = document.createElement('div');
  header.className = 'cl-header';
  const title = document.createElement('h2');
  title.className = 'cl-title';
  title.textContent = 'OMARI Career Lab';
  const subtitle = document.createElement('p');
  subtitle.className = 'cl-subtitle';
  subtitle.textContent = `${COMPANY.name} — four-year identity career curriculum`;
  header.append(title, subtitle);

  const view = document.createElement('div');
  view.className = 'cl-body';

  for (const year of CAREER_YEARS) {
    const lab = CAREER_LABS.find((l) => l.id === year.id);

    const yearEl = document.createElement('div');
    yearEl.className = 'cl-year';

    const head = document.createElement('div');
    head.className = 'cl-year-head';

    const left = document.createElement('div');
    const yt = document.createElement('h3');
    yt.className = 'cl-year-title';
    yt.textContent = year.title;
    const ys = document.createElement('p');
    ys.className = 'cl-year-summary';
    ys.textContent = year.summary;
    const meta = document.createElement('p');
    meta.className = 'cl-year-meta';
    meta.textContent = lab
      ? `${lab.durationMinutes} minutes · ${lab.objectives.length} objectives · ${lab.steps.length} steps`
      : '';
    left.append(yt, ys, meta);

    const actions = document.createElement('div');
    actions.className = 'cl-year-actions';

    const startBtn = document.createElement('button');
    startBtn.className = 'cl-btn cl-btn-primary';
    startBtn.textContent = 'Start this year';
    startBtn.addEventListener('click', () => startYear(year.id));

    const termBtn = document.createElement('button');
    termBtn.className = 'cl-btn';
    termBtn.textContent = 'Open terminal';
    termBtn.addEventListener('click', openTerminal);

    actions.append(startBtn, termBtn);
    head.append(left, actions);
    yearEl.appendChild(head);

    const phases = document.createElement('div');
    phases.className = 'cl-phases';
    for (const phase of year.phases) {
      const phaseEl = document.createElement('div');
      phaseEl.className = 'cl-phase';

      const pt = document.createElement('h4');
      pt.className = 'cl-phase-title';
      pt.textContent = phase.title;

      const ps = document.createElement('p');
      ps.className = 'cl-phase-summary';
      ps.textContent = phase.summary;

      const skills = document.createElement('div');
      skills.className = 'cl-skills';
      for (const skill of phase.skills) {
        const badge = document.createElement('span');
        badge.className = 'cl-skill';
        badge.textContent = skill;
        skills.appendChild(badge);
      }

      phaseEl.append(pt, ps, skills);
      phases.appendChild(phaseEl);
    }
    yearEl.appendChild(phases);

    const vm = document.createElement('div');
    vm.className = 'cl-vm';
    vm.textContent = `Real-VM scenario: ${VM_PATHS[year.id] ?? 'see omari-lab/README.md'}`;
    yearEl.appendChild(vm);

    view.appendChild(yearEl);
  }

  const note = document.createElement('div');
  note.className = 'cl-note';
  note.innerHTML =
    'Click <strong>Start this year</strong> to open the Manual at the first lesson and the Lab Plan so ' +
    'you can track progress from actual work. The terminal is the PowerShell-like prompt for all four years. ' +
    'The real-VM build is in the <code>omari-lab/</code> folder and is optional.';
  view.appendChild(note);

  root.append(header, view);
  body.innerHTML = '';
  body.appendChild(root);
}
