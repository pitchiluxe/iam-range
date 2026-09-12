/**
 * ui/consoles/careerLabWindow.ts — Career Lab: the four-year curriculum.
 *
 * A read-only overview of the OMARI Technologies four-year career path.
 * The simulated workstation links each phase to the relevant Manual chapters,
 * documentation and real-VM build instructions in `omari-lab/`.
 */

import { CAREER_YEARS } from '@/config/careerLab';
import { COMPANY } from '@/config';

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
  .cl-year { margin-bottom: 18px; }
  .cl-year-title {
    font-size: 14px; font-weight: 600; margin: 0 0 6px;
    color: var(--accent);
  }
  .cl-year-summary { color: var(--muted); margin: 0 0 10px; line-height: 1.5; }
  .cl-phases { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px; }
  .cl-phase {
    padding: 10px 12px; border: 1px solid var(--border); border-radius: 6px;
    background: var(--panel-alt);
  }
  .cl-phase-title { font-weight: 600; margin: 0 0 4px; }
  .cl-phase-summary { color: var(--muted); font-size: 11.5px; line-height: 1.45; margin: 0 0 6px; }
  .cl-skills { display: flex; flex-wrap: wrap; gap: 4px; }
  .cl-skill {
    font-size: 10px; padding: 2px 6px; border-radius: 3px;
    background: var(--border); color: var(--fg);
  }
  .cl-note {
    margin-top: 18px; padding: 10px 12px; border: 1px solid var(--border);
    border-radius: 6px; background: var(--panel-alt); color: var(--muted); line-height: 1.5;
  }
`;

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
    const yearEl = document.createElement('div');
    yearEl.className = 'cl-year';

    const yt = document.createElement('h3');
    yt.className = 'cl-year-title';
    yt.textContent = year.title;

    const ys = document.createElement('p');
    ys.className = 'cl-year-summary';
    ys.textContent = year.summary;

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

    yearEl.append(yt, ys, phases);
    view.appendChild(yearEl);
  }

  const note = document.createElement('div');
  note.className = 'cl-note';
  note.innerHTML =
    'The real-VM build is in the <code>omari-lab/</code> folder. It is optional and ' +
    'not run by the simulated workstation. Use it when you have a Windows host with ' +
    'Hyper-V and the required installation media.';
  view.appendChild(note);

  root.append(header, view);
  body.innerHTML = '';
  body.appendChild(root);
}
