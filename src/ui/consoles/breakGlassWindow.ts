/**
 * ui/consoles/breakGlassWindow.ts — Emergency Access.
 *
 * LAB_13_BREAK_GLASS.md specified this and nothing in the workstation
 * implemented it. It is the last lab for a reason: it is the one where the
 * controls you spent the other twelve building are the thing standing between
 * you and the recovery.
 *
 * The window is a posture panel and a drill. The posture is computed from the
 * estate — two accounts, both usable, both on FIDO2, both outside every MFA
 * policy, alerted on, credentials in date — and every failed check says what
 * to do about it rather than only that it failed.
 *
 * The drill breaks MFA across the tenant. That is the honest way to teach
 * this: emergency access nobody has exercised is a belief, not a control, and
 * a learner who runs the drill before setting the posture up finds out what
 * being locked out of their own estate feels like. That is the lesson, so the
 * drill is deliberately allowed to run when the posture is not ready.
 */
import type { VmServices } from '@/vm/session';
import { appButton } from '@/ui/appChrome';
import type { UserId } from '@/domain';
import {
  BREAK_GLASS_NAMES,
  assessPosture,
  breakGlassAccounts,
  drillStatus,
  endOutage,
  startOutage,
} from '@/vm/breakGlass';
import { showToast } from '@/ui/toast';

const STYLES = `
  .bg-root {
    display: flex; flex-direction: column; height: 100%; background: var(--panel);
    color: var(--fg); font-family: "Segoe UI", system-ui, sans-serif; font-size: 12.5px;
  }
  .bg-banner {
    flex-shrink: 0; padding: 11px 16px; border-bottom: 1px solid var(--border);
    display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  }
  .bg-banner.idle { background: var(--panel-alt); }
  .bg-banner.outage {
    background: rgba(255,154,138,0.12); border-bottom-color: rgba(255,154,138,0.5);
  }
  .bg-banner.recovered {
    background: rgba(78,201,176,0.10); border-bottom-color: rgba(78,201,176,0.45);
  }
  .bg-banner-text { flex: 1; min-width: 220px; line-height: 1.55; }
  .bg-banner-title { font-weight: 650; margin-bottom: 2px; }
  /* Buttons come from the shared chrome (.app-btn). */
  .bg-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 16px 18px; }
  .bg-section-title {
    font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.07em;
    color: var(--muted); font-weight: 600; margin: 0 0 10px;
  }
  .bg-check {
    display: flex; gap: 11px; padding: 10px 0; border-bottom: 1px solid var(--border);
  }
  .bg-mark { flex: 0 0 16px; font-weight: 700; line-height: 1.5; }
  .bg-check-label { font-weight: 600; margin-bottom: 2px; }
  .bg-check-detail { color: var(--muted); line-height: 1.6; }
  .bg-check-fix {
    margin-top: 5px; padding: 7px 10px; border-radius: 5px; line-height: 1.6;
    background: var(--panel-alt); border-left: 2px solid var(--err); color: var(--muted);
  }
  .bg-actions { display: flex; gap: 8px; margin: 16px 0 4px; flex-wrap: wrap; }
  .bg-note { color: var(--muted); line-height: 1.7; margin: 0 0 14px; max-width: 660px; }
`;

export function renderBreakGlassWindow(body: HTMLElement, conductor: VmServices): void {
  if (!document.getElementById('break-glass-css')) {
    const style = document.createElement('style');
    style.id = 'break-glass-css';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  const root = document.createElement('div');
  root.className = 'bg-root';
  const banner = document.createElement('div');
  const view = document.createElement('div');
  view.className = 'bg-body';
  root.append(banner, view);

  const actor = (): UserId => conductor.dir.getUserByUsername('admin')?.id ?? ('admin-1' as UserId);

  function button(label: string, kind: '' | 'primary' | 'danger', onClick: () => void): HTMLButtonElement {
    return appButton(label, onClick, kind ? { variant: kind } : {});
  }

  /**
   * Stand the accounts up.
   *
   * Provided because the alternative is twenty minutes of clicking before the
   * lesson starts, and the lesson is the exclusion and the drill rather than
   * the typing. Every step it performs is one the learner can also do by hand
   * in Active Directory and the terminal.
   */
  function provision(): void {
    const existing = new Set(breakGlassAccounts(conductor).map((a) => a.username));
    for (const name of BREAK_GLASS_NAMES) {
      if (existing.has(name)) continue;
      conductor.dir.createUser({
        username: name,
        displayName: `Break-glass ${name.slice(-1)}`,
        email: `${name}@iamlab.com`,
        department: 'IT',
        title: 'Emergency access',
        // Phishing-resistant, and independent of a phone network or an app on
        // a device nobody can reach in an outage.
        mfa: 'fido2',
      });
    }
    showToast('Break-glass accounts created. They are not yet excluded from anything.', {
      kind: 'success',
    });
    render();
  }

  /** Ensure there is an MFA policy, then put both accounts outside it. */
  function excludeBoth(): void {
    const accounts = breakGlassAccounts(conductor);
    if (accounts.length === 0) {
      showToast('Create the accounts first — there is nothing to exclude.', { kind: 'warn' });
      return;
    }
    if (conductor.idp.listPolicies().filter((p) => p.requireMfa).length === 0) {
      conductor.idp.setConditionalPolicy(
        { name: 'CA-002 — MFA for privileged accounts', requireMfa: true },
        actor(),
      );
    }
    for (const policy of conductor.idp.listPolicies()) {
      if (!policy.requireMfa || !policy.name) continue;
      for (const a of accounts) conductor.idp.excludeFromPolicy(policy.name, a.id, actor());
    }
    showToast('Both accounts excluded. That exclusion is a risk accepted on purpose.', {
      kind: 'success',
    });
    render();
  }

  function enableAlerting(): void {
    conductor.audit.record({
      actorId: actor(),
      action: 'policy.updated',
      note:
        'P0 alert configured: any sign-in by a break-glass account pages the on-call channel.',
    });
    showToast('Alerting on. These are now the most watched accounts in the estate.', {
      kind: 'success',
    });
    render();
  }

  function renderBanner(): void {
    const status = drillStatus(conductor);
    banner.className = `bg-banner ${status.state}`;
    banner.innerHTML = '';

    const text = document.createElement('div');
    text.className = 'bg-banner-text';
    const title = document.createElement('div');
    title.className = 'bg-banner-title';
    title.textContent =
      status.state === 'outage'
        ? 'Identity provider fault — MFA is failing tenant-wide'
        : status.state === 'recovered'
          ? 'Recovered'
          : 'No fault in progress';
    const next = document.createElement('div');
    next.className = 'bg-check-detail';
    next.textContent = status.next;
    text.append(title, next);
    banner.appendChild(text);

    if (status.state === 'outage') {
      banner.appendChild(
        button('End the outage', 'primary', () => {
          endOutage(conductor, actor());
          showToast('MFA restored. Rotate the break-glass credentials — they have been used.', {
            kind: 'success',
          });
          render();
        }),
      );
    } else {
      banner.appendChild(
        button('Start the drill', 'danger', () => {
          const ready = assessPosture(conductor).ready;
          const warning = ready
            ? 'Break MFA across the tenant? Your excluded accounts will still be able to sign in.'
            : 'Break MFA across the tenant? Emergency access is NOT ready — nothing will be ' +
              'able to complete a sign-in. That is the point of the drill, but know it before ' +
              'you start.';
          if (!window.confirm(warning)) return;
          startOutage(conductor, actor());
          render();
        }),
      );
    }
  }

  function render(): void {
    renderBanner();
    view.innerHTML = '';

    const note = document.createElement('p');
    note.className = 'bg-note';
    note.textContent =
      'A break-glass account is the identity you use when the normal way in has failed. It sits ' +
      'outside the controls that protect everyone else, which makes it the most valuable account ' +
      'in the estate and the one most worth watching. Emergency access nobody has exercised is a ' +
      'belief rather than a control — so there is a drill.';
    view.appendChild(note);

    const h = document.createElement('div');
    h.className = 'bg-section-title';
    h.textContent = 'Posture';
    view.appendChild(h);

    const posture = assessPosture(conductor);
    for (const check of posture.checks) {
      const row = document.createElement('div');
      row.className = 'bg-check';
      const mark = document.createElement('div');
      mark.className = 'bg-mark';
      mark.textContent = check.passed ? '✓' : '✗';
      mark.style.color = check.passed ? 'var(--accent)' : 'var(--err)';

      const text = document.createElement('div');
      const label = document.createElement('div');
      label.className = 'bg-check-label';
      label.textContent = check.label;
      const detail = document.createElement('div');
      detail.className = 'bg-check-detail';
      detail.textContent = check.detail;
      text.append(label, detail);

      if (!check.passed && check.fix) {
        const fix = document.createElement('div');
        fix.className = 'bg-check-fix';
        fix.textContent = check.fix;
        text.appendChild(fix);
      }

      row.append(mark, text);
      view.appendChild(row);
    }

    const actions = document.createElement('div');
    actions.className = 'bg-actions';
    actions.append(
      button('Create the two accounts', '', provision),
      button('Exclude both from MFA policy', '', excludeBoth),
      button('Turn on sign-in alerting', '', enableAlerting),
    );
    view.appendChild(actions);

    const footer = document.createElement('p');
    footer.className = 'bg-note';
    footer.style.marginTop = '10px';
    footer.textContent = posture.ready
      ? 'Emergency access is ready. Run the drill to prove it — a recovery path that has never ' +
        'been tested is one nobody knows still works.'
      : 'Emergency access is not ready. Each unticked item above says what it needs.';
    view.appendChild(footer);
  }

  render();
  body.innerHTML = '';
  body.appendChild(root);
}
