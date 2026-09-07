/**
 * ui/consoles/accessReviewWindow.ts — Access Reviews.
 *
 * Certification is a standing quarterly job in every real identity team, and
 * it was the one part of this estate with a working service and no way to
 * reach it. The console is the campaign: scope it, decide every row, then
 * complete it.
 *
 * Two things are deliberate and both are the lesson rather than the feature.
 *
 * Revocations apply on completion, not on the click. A campaign where every
 * reviewer has decided and nobody pressed Complete has changed nothing, and
 * that is one of the commonest ways real reviews fail to remove access. The
 * button says how many memberships it is about to remove, because that is the
 * moment somebody should hesitate.
 *
 * And a campaign cannot be completed with rows nobody decided. Defaulting
 * those to approve is rubber-stamping with extra steps, which is the habit
 * certification exists to break.
 */
import type { VmServices } from '@/vm/session';
import { appButton } from '@/ui/appChrome';
import type { AccessReview, GroupId, ReviewId, UserId } from '@/domain';
import { PENDING } from '@/services/mockAccessReviews';
import { showToast } from '@/ui/toast';

const STYLES = `
  .ar-root {
    display: flex; flex-direction: column; height: 100%;
    background: var(--panel); color: var(--fg);
    font-family: "Segoe UI", system-ui, sans-serif; font-size: 12px;
  }
  .ar-bar {
    flex-shrink: 0; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    padding: 10px 14px; border-bottom: 1px solid var(--border); background: var(--panel-alt);
  }
  /* Buttons come from the shared chrome (.app-btn). Only the select, which
     the chrome does not build, is styled here. */
  .ar-bar select {
    height: 28px; padding: 0 9px; border-radius: 4px; box-sizing: border-box;
    font-family: inherit; font-size: 12px; cursor: pointer;
    background: var(--panel); color: var(--fg); border: 1px solid var(--border);
  }
  .ar-progress { margin-left: auto; display: flex; align-items: center; gap: 10px; }
  .ar-track { width: 150px; height: 8px; border-radius: 4px; background: var(--border);
    overflow: hidden; }
  .ar-fill { height: 100%; background: var(--accent); }
  .ar-body { flex: 1 1 auto; min-height: 0; overflow: auto; }
  .ar-table { width: 100%; border-collapse: collapse; }
  .ar-table th {
    position: sticky; top: 0; z-index: 1; text-align: left; padding: 7px 12px;
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted);
    font-weight: 600; background: var(--panel-alt); border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  .ar-table td {
    padding: 6px 12px; border-bottom: 1px solid var(--border); vertical-align: middle;
  }
  .ar-decide { display: flex; gap: 5px; }
  .ar-decide button {
    font-family: inherit; font-size: 11px; padding: 3px 10px; border-radius: 4px;
    cursor: pointer; background: transparent; border: 1px solid var(--border);
    color: var(--muted);
  }
  .ar-decide button.on-approve {
    background: rgba(78,201,176,0.16); border-color: var(--accent); color: var(--accent);
  }
  .ar-decide button.on-revoke {
    background: rgba(255,154,138,0.14); border-color: var(--err); color: var(--err);
  }
  .ar-stale { color: #d7ba7d; }
  .ar-muted { color: var(--muted); }
  .ar-empty { padding: 32px 18px; color: var(--muted); line-height: 1.75; max-width: 640px; }
  .ar-empty h3 { margin: 0 0 8px; font-size: 15px; color: var(--fg); }
  .ar-status {
    flex-shrink: 0; padding: 6px 14px; border-top: 1px solid var(--border);
    background: var(--panel-alt); color: var(--muted); font-size: 11px;
  }
`;

export function renderAccessReviewWindow(body: HTMLElement, conductor: VmServices): void {
  if (!document.getElementById('access-review-css')) {
    const style = document.createElement('style');
    style.id = 'access-review-css';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  let currentId: ReviewId | null = conductor.reviews.list()[0]?.id ?? null;

  const root = document.createElement('div');
  root.className = 'ar-root';
  const bar = document.createElement('div');
  bar.className = 'ar-bar';
  const view = document.createElement('div');
  view.className = 'ar-body';
  const status = document.createElement('div');
  status.className = 'ar-status';
  root.append(bar, view, status);

  const actor = (): UserId =>
    (conductor.dir.getUserByUsername('admin')?.id ?? ('admin-1' as UserId));

  function button(label: string, primary: boolean, onClick: () => void): HTMLButtonElement {
    return appButton(label, onClick, primary ? { variant: 'primary' } : {});
  }

  /** A campaign name that reads like a real one: quarter and year. */
  function quarterName(): string {
    const now = new Date();
    return `Q${Math.floor(now.getMonth() / 3) + 1}-${now.getFullYear()}`;
  }

  function startCampaign(): void {
    const groups = conductor.dir.listGroups();
    const memberships = groups.reduce((n, g) => n + g.memberIds.length, 0);
    if (memberships === 0) {
      showToast(
        'Nothing to review — no account is in any group yet. Grant some access first.',
        { kind: 'warn' },
      );
      return;
    }
    const review = conductor.reviews.openCampaign(
      {
        campaign: quarterName(),
        openedAt: Date.now(),
        // Fourteen days is the window Entra defaults to, and long enough that
        // "we ran out of time" is a choice rather than an excuse.
        dueAt: Date.now() + 14 * 24 * 60 * 60 * 1000,
      },
      actor(),
    );
    const count = conductor.reviews.scopeToDirectory(review.id, conductor.dir);
    currentId = review.id;
    showToast(`Campaign ${review.campaign} opened with ${count} item(s) to certify.`, {
      kind: 'success',
    });
    render();
  }

  function decide(review: AccessReview, userId: UserId, groupId: GroupId, decision: 'approve' | 'revoke'): void {
    conductor.reviews.recordDecision(
      review.id,
      { userId, groupId, decision, decidedBy: actor() },
      conductor.dir,
    );
    render();
  }

  function complete(review: AccessReview): void {
    const toRevoke = review.decisions.filter(
      (d) => d.decision === 'revoke' && d.decidedBy !== PENDING,
    ).length;
    const message =
      toRevoke === 0
        ? `Complete ${review.campaign}? Every item was approved, so no access changes.`
        : `Complete ${review.campaign}? This removes ${toRevoke} membership(s) and cannot be undone from here.`;
    if (!window.confirm(message)) return;

    const result = conductor.reviews.complete(review.id, actor(), conductor.dir);
    if (result.error) {
      showToast(result.error, { kind: 'warn' });
      render();
      return;
    }
    showToast(
      `${review.campaign} completed — ${result.revoked.length} revoked, ${result.approved} approved.`,
      { kind: 'success' },
    );
    render();
  }

  // ----- Views -----

  function renderEmpty(): void {
    const wrap = document.createElement('div');
    wrap.className = 'ar-empty';
    const h = document.createElement('h3');
    h.textContent = 'No campaign is open';
    const p1 = document.createElement('p');
    p1.textContent =
      'An access review asks one question of every membership in the directory: does this ' +
      'person still need this? It is the standing quarterly job on every identity team, and ' +
      'the control an auditor asks about first.';
    const p2 = document.createElement('p');
    p2.textContent =
      'Decisions are recorded as you make them, but nothing is removed until the campaign is ' +
      'completed. A campaign where everybody decided and nobody completed it has changed ' +
      'nothing — which is how real reviews most often fail.';
    wrap.append(h, p1, p2);
    view.appendChild(wrap);
  }

  function renderCampaign(review: AccessReview): void {
    const table = document.createElement('table');
    table.className = 'ar-table';
    const head = document.createElement('tr');
    for (const label of ['Account', 'Department', 'Access', 'Last sign-in', 'Decision']) {
      const th = document.createElement('th');
      th.textContent = label;
      head.appendChild(th);
    }
    table.appendChild(head);

    const closed = review.status === 'closed';

    for (const d of review.decisions) {
      const user = conductor.dir.getUser(d.userId);
      const group = conductor.dir.listGroups().find((g) => g.id === d.groupId);
      const tr = document.createElement('tr');

      const account = document.createElement('td');
      account.textContent = user?.username ?? String(d.userId);

      const dept = document.createElement('td');
      dept.className = 'ar-muted';
      dept.textContent = user?.department ?? '';

      const access = document.createElement('td');
      access.textContent = group?.name ?? String(d.groupId);

      // Dormancy is the single most useful column on a review: access nobody
      // has used is the easiest access to take away.
      const seen = document.createElement('td');
      if (!user?.lastSignInAt) {
        seen.textContent = 'never';
        seen.className = 'ar-stale';
      } else {
        const days = Math.floor((Date.now() - user.lastSignInAt) / 86_400_000);
        seen.textContent = days === 0 ? 'today' : `${days} day(s) ago`;
        if (days > 60) seen.className = 'ar-stale';
      }

      const decide_ = document.createElement('td');
      const group_ = document.createElement('div');
      group_.className = 'ar-decide';
      const undecided = d.decidedBy === PENDING;

      for (const choice of ['approve', 'revoke'] as const) {
        const b = document.createElement('button');
        b.textContent = choice === 'approve' ? 'Keep' : 'Revoke';
        if (!undecided && d.decision === choice) {
          b.className = choice === 'approve' ? 'on-approve' : 'on-revoke';
        }
        b.disabled = closed;
        b.addEventListener('click', () => decide(review, d.userId, d.groupId, choice));
        group_.appendChild(b);
      }
      decide_.appendChild(group_);

      tr.append(account, dept, access, seen, decide_);
      table.appendChild(tr);
    }

    view.appendChild(table);
  }

  function renderBar(review: AccessReview | null): void {
    bar.innerHTML = '';

    const campaigns = conductor.reviews.list();
    if (campaigns.length > 0) {
      const select = document.createElement('select');
      for (const c of campaigns) {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = `${c.campaign} — ${c.status}`;
        select.appendChild(opt);
      }
      if (review) select.value = review.id;
      select.addEventListener('change', () => {
        currentId = select.value as ReviewId;
        render();
      });
      bar.appendChild(select);
    }

    bar.appendChild(button('New campaign', campaigns.length === 0, startCampaign));

    if (review && review.status !== 'closed') {
      const pending = conductor.reviews.pending(review.id).length;
      const toRevoke = review.decisions.filter(
        (d) => d.decision === 'revoke' && d.decidedBy !== PENDING,
      ).length;

      const done = button(
        toRevoke > 0 ? `Complete — revokes ${toRevoke}` : 'Complete campaign',
        true,
        () => complete(review),
      );
      // Disabled rather than hidden, with the count in the status line: a
      // button that vanishes teaches nothing about why.
      done.disabled = pending > 0;
      bar.appendChild(done);

      const wrap = document.createElement('div');
      wrap.className = 'ar-progress';
      const decided = review.decisions.length - pending;
      const label = document.createElement('span');
      label.className = 'ar-muted';
      label.textContent = `${decided} of ${review.decisions.length} decided`;
      const track = document.createElement('div');
      track.className = 'ar-track';
      const fill = document.createElement('div');
      fill.className = 'ar-fill';
      fill.style.width =
        review.decisions.length === 0 ? '0%' : `${(decided / review.decisions.length) * 100}%`;
      track.appendChild(fill);
      wrap.append(label, track);
      bar.appendChild(wrap);
    }
  }

  function render(): void {
    const review = currentId ? (conductor.reviews.get(currentId) ?? null) : null;
    renderBar(review);
    view.innerHTML = '';

    if (!review) {
      renderEmpty();
      status.textContent = 'No campaign open.';
      return;
    }

    renderCampaign(review);

    const pending = conductor.reviews.pending(review.id).length;
    const revokes = review.decisions.filter(
      (d) => d.decision === 'revoke' && d.decidedBy !== PENDING,
    ).length;

    if (review.status === 'closed') {
      status.textContent =
        `${review.campaign} is closed. ${revokes} membership(s) were removed when it completed.`;
    } else if (pending > 0) {
      status.textContent =
        `${pending} item(s) still need a decision. Completing with undecided rows would ` +
        'approve them by default, which is rubber-stamping — so it is refused.';
    } else {
      status.textContent =
        `Every item decided. Completing removes ${revokes} membership(s); until then nothing ` +
        'has changed.';
    }
  }

  render();
  body.innerHTML = '';
  body.appendChild(root);
}
