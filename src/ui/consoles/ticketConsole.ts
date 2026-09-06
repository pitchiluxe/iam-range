/**
 * ui/consoles/ticketConsole.ts — Ticket Queue console.
 *
 * Features:
 *   - Priority color coding (urgent=red, high=orange, normal=blue, low=gray)
 *   - Sort by priority / created / kind / status (default: priority)
 *   - Search box (subject + body)
 *   - Filter chips (by kind)
 *   - SLA timer badge on urgent / high priority cards
 *   - Per-ticket elapsed time
 *   - Bulk select with checkboxes + bulk resolve
 *   - Ticket comments (expand per card, post a comment)
 *   - Keyboard shortcuts: 1-9 (focus nth card), R (resolve), A (assign),
 *     F (focus search), / (focus search), Esc (clear selection)
 *   - Environment reset button
 *   - Quick-create ticket templates
 *   - Export audit log to CSV
 *   - Notification sounds (urgent alert, normal blip, resolved chime)
 *   - Real-time SLA color shift (green → yellow → red)
 */
import type { VmServices } from '@/vm/session';
import { ticketStore } from '@/stores';
import {mkTicketId} from '@/domain';
import type { Ticket, TicketId, TicketKind, TicketPriority, UserId } from '@/domain';
import { showToast } from '@/ui/toast';
import { ticketBlip, ticketResolved, urgentAlert } from '@/ui/audio';

type SortMode = 'priority' | 'created' | 'kind' | 'status';
type FilterKind = 'all' | TicketKind;

const priorityColors: Record<
  TicketPriority,
  { bg: string; border: string; badge: string; emoji: string; rank: number }
> = {
  urgent: { bg: '#2a1414', border: '#ef4444', badge: '#ef4444', emoji: '🔴', rank: 0 },
  high: { bg: '#2a1f14', border: '#f97316', badge: '#f97316', emoji: '🟠', rank: 1 },
  normal: { bg: '#1b1f24', border: '#3b82f6', badge: '#3b82f6', emoji: '🔵', rank: 2 },
  low: { bg: '#18191b', border: '#6b7280', badge: '#6b7280', emoji: '⚪', rank: 3 },
};

/** SLA windows (ms). Urgent = 15m, high = 30m. Normal/low = no SLA. */
const SLA_MS: Record<TicketPriority, number> = {
  urgent: 15 * 60 * 1000,
  high: 30 * 60 * 1000,
  normal: 0,
  low: 0,
};

const statusRank: Record<Ticket['status'], number> = {
  open: 0,
  'in-progress': 1,
  'pending-approval': 2,
  resolved: 3,
  closed: 4,
  cancelled: 5,
};

function sortTickets(tickets: Ticket[], mode: SortMode): Ticket[] {
  const copy = [...tickets];
  if (mode === 'priority') {
    copy.sort(
      (a, b) =>
        priorityColors[a.priority].rank - priorityColors[b.priority].rank ||
        b.createdAt - a.createdAt,
    );
  } else if (mode === 'created') {
    copy.sort((a, b) => b.createdAt - a.createdAt);
  } else if (mode === 'kind') {
    copy.sort((a, b) => a.kind.localeCompare(b.kind) || b.createdAt - a.createdAt);
  } else {
    copy.sort(
      (a, b) =>
        statusRank[a.status] - statusRank[b.status] ||
        priorityColors[a.priority].rank - priorityColors[b.priority].rank,
    );
  }
  return copy;
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

function formatSLA(
  createdAt: number,
  priority: TicketPriority,
): { text: string; color: string } | null {
  const sla = SLA_MS[priority];
  if (!sla) return null;
  const remaining = sla - (Date.now() - createdAt);
  if (remaining <= 0) return { text: '⚠️ OVERDUE', color: '#ef4444' };
  const totalMin = Math.floor(remaining / 60000);
  const sec = Math.floor((remaining % 60000) / 1000);
  // Color shift: > 50% remaining = green, > 25% = yellow, else red
  const pct = remaining / sla;
  const color = pct > 0.5 ? '#4ec9b0' : pct > 0.25 ? '#d7ba7d' : '#f48771';
  return { text: `⏱️ ${totalMin}m ${String(sec).padStart(2, '0')}s`, color };
}

function kindEmoji(kind: TicketKind): string {
  return (
    {
      onboarding: '🔓',
      mover: '🔄',
      leaver: '🚪',
      transfer: '🔀',
      termination: '⚰️',
      'access-request': '🔐',
      'password-reset': '🔑',
      'mfa-issue': '📱',
      incident: '⚠️',
    }[kind] ?? '🎫'
  );
}

const TICKET_TEMPLATES: Array<{
  kind: TicketKind;
  label: string;
  emoji: string;
  defaultPriority: TicketPriority;
  defaultSubject: string;
  defaultBody: string;
}> = [
  {
    kind: 'onboarding',
    label: 'New Hire Onboarding',
    emoji: '🔓',
    defaultPriority: 'normal',
    defaultSubject: 'Onboard new team member',
    defaultBody: 'Provision account, assign to department group, schedule orientation.',
  },
  {
    kind: 'transfer',
    label: 'Department Transfer',
    emoji: '🔀',
    defaultPriority: 'normal',
    defaultSubject: 'Transfer employee to new department',
    defaultBody: 'Move user to new group, revoke old group memberships, verify access.',
  },
  {
    kind: 'termination',
    label: 'Termination',
    emoji: '⚰️',
    defaultPriority: 'high',
    defaultSubject: 'Terminate employee access',
    defaultBody: 'Disable account, revoke active sessions, remove from all groups.',
  },
  {
    kind: 'password-reset',
    label: 'Password Reset',
    emoji: '🔑',
    defaultPriority: 'high',
    defaultSubject: 'Password reset request',
    defaultBody: 'User locked out — verify identity, reset password, communicate securely.',
  },
  {
    kind: 'mfa-issue',
    label: 'MFA Issue',
    emoji: '📱',
    defaultPriority: 'high',
    defaultSubject: 'MFA device problem',
    defaultBody:
      'User reports repeated MFA prompts or lost device. Verify, reset MFA, audit recent sign-ins.',
  },
  {
    kind: 'access-request',
    label: 'Access Request',
    emoji: '🔐',
    defaultPriority: 'normal',
    defaultSubject: 'Application access request',
    defaultBody:
      'User requests access to additional app/role. Verify justification, check least-privilege.',
  },
  {
    kind: 'incident',
    label: 'Security Incident',
    emoji: '⚠️',
    defaultPriority: 'urgent',
    defaultSubject: 'Possible security incident',
    defaultBody:
      'Suspicious activity detected. Triage, contain, document, and escalate per IR plan.',
  },
];

export function renderTicketConsole(body: HTMLElement, conductor: VmServices) {
  // One-time injection of thin scrollbar CSS for Webkit browsers
  if (!document.getElementById('ticket-console-scroll-css')) {
    const style = document.createElement('style');
    style.id = 'ticket-console-scroll-css';
    style.textContent =
      '#ticket-console-wrap::-webkit-scrollbar{width:6px}' +
      '#ticket-console-wrap::-webkit-scrollbar-track{background:#0e1116}' +
      '#ticket-console-wrap::-webkit-scrollbar-thumb{background:#2d343d;border-radius:3px}' +
      '#ticket-console-wrap::-webkit-scrollbar-thumb:hover{background:#3d4a56}';
    document.head.appendChild(style);
  }

  // Always use a dedicated scrollable inner container so the scrollbar always
  // works regardless of how the caller's body is styled (desktop overlay vs
  // console overlay both pass in differently-styled divs).
  const wrap = document.createElement('div');
  wrap.id = 'ticket-console-wrap';
  wrap.style.cssText =
    'height:100%;overflow-y:auto;padding:16px;box-sizing:border-box;' +
    'scrollbar-width:thin;scrollbar-color:#2d343d #0e1116;';
  body.innerHTML = '';
  body.style.cssText = 'overflow:hidden;';
  body.appendChild(wrap);

  if (!conductor.tickets || !conductor.audit) {
    wrap.innerHTML = `
      <div style="text-align:center;padding:24px 16px;color:var(--muted);font-size:13px;line-height:1.6;">
        <div style="font-size:32px;margin-bottom:8px;">🎫</div>
        <div style="color:var(--accent);font-size:14px;font-weight:600;margin-bottom:6px;">Ticket Queue</div>
        <div>Identity services unavailable.</div>
        <div style="margin-top:12px;font-size:12px;line-height:1.5;">
          Reset the environment from the Ticket Queue to re-seed the directory.<br/>
          to manage tickets, access requests, and escalations.
        </div>
      </div>
    `;
    return;
  }
  const queue = conductor.tickets;
  const audit = conductor.audit;


  // ----- UI state (declared before render so the keyboard handler can read it) -----
  let sortMode: SortMode = 'priority';
  let filterKind: FilterKind = 'all';
  let searchQuery = '';
  const selectedIds = new Set<TicketId>();
  const expandedCommentIds = new Set<TicketId>(); // tracks which ticket comment sections are open
  /** Half-typed comments, kept across re-renders. render() rebuilds the card
   *  DOM, so without this a store update or SLA change wiped what you typed. */
  const commentDrafts = new Map<TicketId, string>();
  /** Set only when the learner just opened a comment box, so focus() runs once
   *  on open instead of on every re-render — focusing an element inside a
   *  scroll container yanks the view to it, which read as "scrolls by itself". */
  let focusCommentFor: TicketId | null = null;
  let lastSeenIds = new Set<TicketId>(queue.list().map((t) => t.id));
  let slaInterval: number | null = null;

  // ----- Subscribe to ticket store so we know when new ones arrive (for sounds) -----
  const tickSub = ticketStore.subscribe(() => {
    const now = queue.list().map((t) => t.id);
    const fresh = now.filter((id) => !lastSeenIds.has(id));
    for (const id of fresh) {
      const t = queue.get(id as TicketId);
      if (t && t.priority === 'urgent') {
        urgentAlert();
        showToast(`🚨 Urgent ticket arrived: ${t.subject}`, { kind: 'warn' });
      } else if (t) {
        ticketBlip();
      }
    }
    lastSeenIds = new Set(now);
  });

  /** Rewrite just the SLA countdown badges, leaving the rest of the DOM alone. */
  function updateSLABadges(): void {
    const badges = body.querySelectorAll<HTMLElement>('[data-sla-for]');
    for (const el of badges) {
      const t = queue.get(el.dataset.slaFor as TicketId);
      if (!t) continue;
      const sla = formatSLA(t.createdAt, t.priority);
      if (!sla) {
        el.remove();
        continue;
      }
      el.textContent = sla.text;
      el.style.background = `${sla.color}22`;
      el.style.borderColor = sla.color;
      el.style.color = sla.color;
    }
  }

  // ----- Tick SLA timers once a second so the visible countdowns update -----
  function startSLATick() {
    if (slaInterval !== null) return;
    slaInterval = window.setInterval(() => {
      if (!document.contains(body)) {
        if (slaInterval !== null) {
          clearInterval(slaInterval);
          slaInterval = null;
        }
        return;
      }
      // Update the countdown badges in place. This used to call render(),
      // which rebuilt every card once a second — destroying the scroll
      // position, any half-typed comment, and stealing focus. Nothing outside
      // the badges changes on a clock tick, so nothing else should be touched.
      updateSLABadges();
    }, 1000);
  }
  startSLATick();

  const render = () => {
    // A re-render replaces the whole list, which resets the scroll box to the
    // top. Capture the offset first and put it back after, so resolving or
    // commenting on a ticket leaves you where you were instead of jumping.
    const prevScroll = wrap.scrollTop;
    const all = queue.list();
    let open = all.filter((t) => t.status !== 'resolved');

    // Apply kind filter
    if (filterKind !== 'all') {
      open = open.filter((t) => t.kind === filterKind);
    }
    // Apply search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      open = open.filter(
        (t) => t.subject.toLowerCase().includes(q) || t.body.toLowerCase().includes(q),
      );
    }

    // Sort
    open = sortTickets(open, sortMode);

    const resolved = all.filter((t) => t.status === 'resolved');
    wrap.innerHTML = '';

    /* Priority counts for the summary (uses unfiltered open list) */
    const allOpen = all.filter((t) => t.status !== 'resolved');
    const priorityCounts: Record<TicketPriority, number> = {
      urgent: 0,
      high: 0,
      normal: 0,
      low: 0,
    };
    for (const t of allOpen) priorityCounts[t.priority]++;
    const priorityBreakdown = (Object.keys(priorityColors) as TicketPriority[])
      .filter((p) => priorityCounts[p] > 0)
      .map((p) => {
        const c = priorityColors[p];
        return `<span style="display:inline-flex;align-items:center;gap:3px;padding:1px 6px;border-radius:3px;background:${c.bg};border:1px solid ${c.border};font-size:10px;">${c.emoji} ${priorityCounts[p]} ${p}</span>`;
      })
      .join(' ');

    /* Summary — always show, even with 1-2 tickets */
    const sum = document.createElement('div');
    sum.style.cssText =
      'display:flex;align-items:center;gap:10px;padding:8px 12px;background:#1b1f24;border:1px solid var(--border);border-radius:6px;margin-bottom:12px;';
    sum.innerHTML = `
      <span style="font-size:20px;">🎫</span>
      <div style="flex:1;">
        <div style="font-size:13px;color:var(--accent);font-weight:600;">
          ${allOpen.length} open · ${resolved.length} resolved
        </div>
        <div style="font-size:11px;color:var(--muted);margin-top:1px;">
          ${allOpen.length > 0 ? 'Work the queue' : allOpen.length === 0 && resolved.length > 0 ? 'All tickets resolved — great work!' : 'No tickets yet — use Quick Create to raise one.'}
        </div>
        ${allOpen.length > 0 ? `<div style="display:flex;gap:4px;margin-top:6px;flex-wrap:wrap;">${priorityBreakdown}</div>` : ''}
      </div>
    `;
    wrap.appendChild(sum);

    /* Toolbar: search, filter, sort, bulk, lab reset, quick-create */
    if (allOpen.length > 0 || resolved.length > 0) {
      const toolbar = document.createElement('div');
      toolbar.style.cssText =
        'display:flex;flex-direction:column;gap:8px;margin-bottom:10px;padding:8px 10px;background:#15181d;border:1px solid var(--border);border-radius:4px;';

      // Row 1: search + sort + create
      const row1 = document.createElement('div');
      row1.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;';

      const search = document.createElement('input');
      search.type = 'text';
      search.id = 'ticket-search';
      search.placeholder = '🔍 Search subject / body…';
      search.value = searchQuery;
      search.style.cssText =
        'flex:1;min-width:160px;background:#0e1116;color:var(--fg);border:1px solid var(--border);border-radius:3px;padding:5px 8px;font-size:12px;';
      search.addEventListener('input', () => {
        searchQuery = search.value;
        render();
      });
      row1.appendChild(search);

      const sortLabel = document.createElement('span');
      sortLabel.style.cssText =
        'color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:0.05em;';
      sortLabel.textContent = 'Sort:';
      row1.appendChild(sortLabel);

      const select = document.createElement('select');
      select.id = 'ticket-sort-select';
      select.style.cssText =
        'background:#0e1116;color:var(--fg);border:1px solid var(--border);border-radius:3px;padding:3px 6px;font-size:11px;cursor:pointer;';
      const options: { value: SortMode; label: string }[] = [
        { value: 'priority', label: 'Priority (Urgent → Low)' },
        { value: 'created', label: 'Created (Newest First)' },
        { value: 'kind', label: 'Kind (A → Z)' },
        { value: 'status', label: 'Status (Open First)' },
      ];
      for (const o of options) {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        if (o.value === sortMode) opt.selected = true;
        select.appendChild(opt);
      }
      select.addEventListener('change', () => {
        sortMode = select.value as SortMode;
        render();
      });
      row1.appendChild(select);

      const createBtn = btn('➕ New', 'var(--accent)', () => {
        showQuickCreate();
      });
      row1.appendChild(createBtn);

      // Resets the whole environment, not a lab: the directory is re-seeded
      // and every ticket, session and audit entry is discarded.
      const resetBtn = btn('🔄 Reset Environment', '#f48771', () => {
        if (window.confirm('Reset the environment? Every change you have made will be lost.')) {
          conductor.reset();
          selectedIds.clear();
          render();
          showToast('Environment reset — directory re-seeded.', { kind: 'info' });
        }
      });
      row1.appendChild(resetBtn);

      toolbar.appendChild(row1);

      // Row 2: filter chips
      const row2 = document.createElement('div');
      row2.style.cssText = 'display:flex;align-items:center;gap:4px;flex-wrap:wrap;';

      const filterLabel = document.createElement('span');
      filterLabel.style.cssText =
        'color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:0.05em;margin-right:4px;';
      filterLabel.textContent = 'Filter:';
      row2.appendChild(filterLabel);

      const filterValues: FilterKind[] = [
        'all',
        'onboarding',
        'transfer',
        'termination',
        'access-request',
        'password-reset',
        'mfa-issue',
        'incident',
      ];
      for (const fk of filterValues) {
        const chip = document.createElement('button');
        const isActive = fk === filterKind;
        const count = fk === 'all' ? allOpen.length : allOpen.filter((t) => t.kind === fk).length;
        chip.style.cssText = `
          background:${isActive ? 'var(--accent)' : '#0e1116'};
          color:${isActive ? '#0e1116' : 'var(--muted)'};
          border:1px solid ${isActive ? 'var(--accent)' : 'var(--border)'};
          border-radius:12px;padding:2px 10px;font-size:11px;cursor:pointer;
          font-weight:${isActive ? '600' : '400'};
        `;
        chip.textContent = `${fk === 'all' ? 'All' : `${kindEmoji(fk as TicketKind)} ${fk}`} (${count})`;
        chip.addEventListener('click', () => {
          filterKind = fk;
          render();
        });
        row2.appendChild(chip);
      }

      // Select-all
      if (open.length > 0) {
        const allSelected = open.every((t) => selectedIds.has(t.id));
        const selectAllBtn = document.createElement('button');
        selectAllBtn.style.cssText =
          'background:transparent;color:var(--muted);border:1px dashed var(--border);border-radius:12px;padding:2px 10px;font-size:11px;cursor:pointer;margin-left:auto;';
        selectAllBtn.textContent = allSelected ? '☐ Deselect all' : '☑ Select all';
        selectAllBtn.addEventListener('click', () => {
          if (allSelected) {
            for (const t of open) selectedIds.delete(t.id);
          } else {
            for (const t of open) selectedIds.add(t.id);
          }
          render();
        });
        row2.appendChild(selectAllBtn);
      }

      toolbar.appendChild(row2);

      // Row 3: bulk action bar (shown when items selected)
      if (selectedIds.size > 0) {
        const row3 = document.createElement('div');
        row3.style.cssText =
          'display:flex;align-items:center;gap:6px;padding:6px 8px;background:rgba(78,201,176,0.08);border:1px solid var(--accent);border-radius:3px;';
        row3.innerHTML = `<span style="color:var(--accent);font-size:12px;font-weight:600;">${selectedIds.size} selected</span>`;
        const bulkResolve = btn('✓ Resolve all', 'var(--accent)', () => {
          let count = 0;
          for (const id of selectedIds) {
            try {
              queue.resolve(id, 'system' as UserId);
              ticketStore.getState().incrementResolved();
              count++;
            } catch {
              /* skip */
            }
          }
          if (count > 0) {
            ticketResolved();
            showToast(`Resolved ${count} ticket${count > 1 ? 's' : ''}.`, { kind: 'success' });
          }
          selectedIds.clear();
          render();
        });
        const bulkAssign = btn('👤 Assign all to me', '#60a5fa', () => {
          for (const id of selectedIds) queue.assign(id, 'player' as UserId);
          selectedIds.clear();
          showToast('Assigned tickets to you.', { kind: 'success' });
          render();
        });
        const clearSel = btn('Clear', 'var(--muted)', () => {
          selectedIds.clear();
          render();
        });
        row3.appendChild(bulkResolve);
        row3.appendChild(bulkAssign);
        row3.appendChild(clearSel);
        toolbar.appendChild(row3);
      }

      wrap.appendChild(toolbar);
    }

    /* Open tickets */
    if (open.length === 0 && allOpen.length > 0) {
      const noResults = document.createElement('div');
      noResults.style.cssText =
        'text-align:center;padding:24px 12px;color:var(--muted);font-size:13px;border:1px dashed var(--border);border-radius:4px;';
      noResults.textContent = `No tickets match your search/filter. ${allOpen.length} ticket${allOpen.length > 1 ? 's' : ''} hidden.`;
      wrap.appendChild(noResults);
    }

    open.forEach((t, idx) => {
      const card = document.createElement('div');
      card.className = 'ticket-card';
      const pc = priorityColors[t.priority];
      const sla = formatSLA(t.createdAt, t.priority);
      const slaHtml = sla
        ? `<span data-sla-for="${t.id}" style="display:inline-flex;align-items:center;gap:3px;padding:1px 6px;border-radius:3px;background:${sla.color}22;border:1px solid ${sla.color};color:${sla.color};font-size:10px;font-weight:600;">${sla.text}</span>`
        : '';
      const isSelected = selectedIds.has(t.id);
      card.style.cssText = `
        background:${pc.bg};border:1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'};
        border-left:3px solid ${pc.border};border-radius:4px;
        padding:10px 12px;margin-bottom:8px;font-size:12px;min-height:80px;
        position:relative;
        ${isSelected ? 'box-shadow: 0 0 0 1px var(--accent);' : ''}
      `;
      const kindColors: Record<string, string> = {
        onboarding: 'var(--accent)',
        termination: 'var(--err)',
        transfer: 'var(--warn)',
        'access-request': '#a78bfa',
        'password-reset': '#60a5fa',
        'mfa-issue': '#fb923c',
        incident: 'var(--err)',
      };
      const color = kindColors[t.kind] ?? 'var(--muted)';
      const elapsed = formatElapsed(Date.now() - t.createdAt);
      const indexLabel =
        allOpen.length > 1
          ? `<span style="color:var(--muted);font-size:10px;background:#0e1116;padding:1px 5px;border-radius:3px;font-family:monospace;">${idx + 1}</span>`
          : '';
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:4px;">
          <div style="display:flex;align-items:center;gap:6px;flex:1;">
            <input type="checkbox" class="ticket-card-checkbox" ${isSelected ? 'checked' : ''} style="cursor:pointer;" />
            ${indexLabel}
            <span style="font-weight:600;flex:1;">${t.subject}</span>
          </div>
          <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">
            ${slaHtml}
            <span style="display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:3px;background:${pc.badge};color:#fff;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;white-space:nowrap;">${pc.emoji} ${t.priority}</span>
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;gap:6px;margin-bottom:6px;">
          <span style="color:${color};font-size:10px;text-transform:uppercase;letter-spacing:0.05em;">${kindEmoji(t.kind)} ${t.kind}</span>
          <span style="color:var(--muted);font-size:10px;">${t.assigneeId ? `👤 ${t.assigneeId}` : 'Unassigned'} · ⏱️ ${elapsed}</span>
        </div>
        <div style="color:var(--muted);margin-bottom:8px;">${t.body}</div>
      `;
      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center;';
      actions.appendChild(
        btn('Assign to me', '#60a5fa', () => {
          queue.assign(t.id, 'player' as UserId);
          render();
        }),
      );
      actions.appendChild(
        btn('Resolve', 'var(--accent)', () => {
          try {
            queue.resolve(t.id, 'system' as UserId);
            ticketStore.getState().incrementResolved();
            ticketResolved();
            selectedIds.delete(t.id);
            showToast(`✓ Resolved: ${t.subject}`, { kind: 'success' });
          } catch (e) {
            showToast(String(e), { kind: 'error' });
          }
          render();
        }),
      );
      const escalateBtn = btn('⚠️ Escalate', '#f97316', () => {
        queue.escalate(t.id, 'system' as UserId);
        showToast(`Escalated to urgent.`, { kind: 'warn' });
        render();
      });
      actions.appendChild(escalateBtn);
      const commentToggle = btn(`💬 Comments (${t.comments.length})`, 'var(--muted)', () => {
        if (expandedCommentIds.has(t.id)) {
          expandedCommentIds.delete(t.id);
        } else {
          expandedCommentIds.add(t.id);
          focusCommentFor = t.id; // focus once, on this open — not on re-renders
        }
        render();
      });
      actions.appendChild(commentToggle);
      card.appendChild(actions);

      // Render the comment block inline if expanded — survives re-renders.
      if (expandedCommentIds.has(t.id)) {
        card.appendChild(buildCommentBlock(card, t));
      }

      wrap.appendChild(card);

      // Checkbox handler
      const cb = card.querySelector('.ticket-card-checkbox') as HTMLInputElement | null;
      if (cb) {
        cb.addEventListener('change', () => {
          if (cb.checked) selectedIds.add(t.id);
          else selectedIds.delete(t.id);
          render();
        });
      }
    });

    /* Empty state */
    if (allOpen.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.style.cssText =
        'text-align:center;padding:24px 12px;color:var(--muted);font-size:13px;';
      emptyState.innerHTML = '✓ No open tickets';
      wrap.appendChild(emptyState);
    }

    /* Resolved */
    if (resolved.length > 0) {
      const hdr = document.createElement('h3');
      hdr.style.cssText =
        'color:var(--muted);font-size:12px;text-transform:uppercase;margin:16px 0 6px;letter-spacing:0.05em;';
      hdr.textContent = 'Recently Resolved';
      wrap.appendChild(hdr);
      for (const t of resolved.slice(-5).reverse()) {
        const r = document.createElement('div');
        r.style.cssText =
          'font-size:12px;color:var(--muted);padding:4px 0;border-bottom:1px solid var(--border);';
        r.textContent = `✓ ${t.subject}`;
        wrap.appendChild(r);
      }
    }

    /* Audit events for tickets */
    const auditHdr = document.createElement('h3');
    auditHdr.style.cssText =
      'color:var(--muted);font-size:12px;text-transform:uppercase;margin:16px 0 6px;letter-spacing:0.05em;display:flex;align-items:center;justify-content:space-between;';
    auditHdr.innerHTML = '<span>Ticket Audit Events</span>';

    const exportBtn = btn('📥 Export CSV', 'var(--muted)', () => exportAuditLog());
    auditHdr.appendChild(exportBtn);
    wrap.appendChild(auditHdr);

    const auditList = document.createElement('div');
    auditList.style.cssText =
      'max-height:120px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;';
    const ticketEvents = audit.events
      .filter((e) => e.action.startsWith('ticket.'))
      .slice(-15)
      .reverse();
    if (ticketEvents.length === 0) {
      auditList.appendChild(empty('No ticket audit events yet'));
    } else {
      for (const ev of ticketEvents) {
        const row = document.createElement('div');
        row.style.cssText =
          'padding:4px 10px;border-bottom:1px solid var(--border);font-size:11px;color:var(--muted);font-family:monospace;';
        row.textContent = `[${new Date(ev.at).toLocaleTimeString()}] ${ev.action} ${ev.targetId ?? ''}`;
        auditList.appendChild(row);
      }
    }
    wrap.appendChild(auditList);

    /* Keyboard shortcut hint */
    if (allOpen.length > 0) {
      const hint = document.createElement('div');
      hint.style.cssText =
        'margin-top:10px;padding:6px 10px;background:#0e1116;border:1px dashed var(--border);border-radius:3px;color:var(--muted);font-size:10px;';
      hint.innerHTML =
        '⌨️ <strong>Shortcuts:</strong> <kbd>1-9</kbd> focus card · <kbd>R</kbd> resolve top · <kbd>A</kbd> assign top · <kbd>F</kbd> or <kbd>/</kbd> search · <kbd>Esc</kbd> clear selection';
      wrap.appendChild(hint);
    }

    // Put the scroll position back after the rebuild. Clamped by the browser if
    // the list got shorter (e.g. the ticket you resolved is gone).
    wrap.scrollTop = prevScroll;
  };

  // ----- Comments UI: built per card when expanded. Returns a DOM element so
  // the render() function owns the lifecycle. The SLA tick no longer re-renders,
  // so this block is rebuilt only on real ticket changes; the draft text and
  // focus are preserved across those rebuilds by commentDrafts/focusCommentFor.
  function buildCommentBlock(card: HTMLElement, ticket: Ticket): HTMLElement {
    const block = document.createElement('div');
    block.className = 'ticket-comments';
    block.style.cssText =
      'margin-top:8px;padding:8px 10px;background:#0e1116;border:1px solid var(--border);border-radius:3px;';

    if (ticket.comments.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:var(--muted);font-size:11px;margin-bottom:6px;';
      empty.textContent = 'No comments yet.';
      block.appendChild(empty);
    } else {
      for (const c of ticket.comments) {
        const row = document.createElement('div');
        row.style.cssText =
          'padding:4px 0;border-bottom:1px solid #1b1f24;font-size:11px;color:var(--fg);';
        row.innerHTML = `<div><strong style="color:var(--accent);">${c.authorId}</strong> <span style="color:var(--muted);font-size:10px;">${new Date(c.at).toLocaleTimeString()}</span></div><div style="color:var(--muted);margin-top:2px;">${c.body}</div>`;
        block.appendChild(row);
      }
    }

    const inputRow = document.createElement('div');
    inputRow.style.cssText = 'display:flex;gap:4px;margin-top:6px;';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Add a comment…';
    input.style.cssText =
      'flex:1;background:#1b1f24;color:var(--fg);border:1px solid var(--border);border-radius:3px;padding:4px 6px;font-size:11px;';
    // Re-renders rebuild this element, so the draft lives outside the DOM.
    input.value = commentDrafts.get(ticket.id) ?? '';
    input.addEventListener('input', () => commentDrafts.set(ticket.id, input.value));
    const post = btn('Post', 'var(--accent)', () => {
      const text = input.value.trim();
      if (!text) return;
      queue.comment(ticket.id, 'player' as UserId, text);
      commentDrafts.delete(ticket.id);
      // Re-render to pick up the new comment. expandedCommentIds still has
      // this ticket id, so the new block will be rebuilt with the new comment.
      render();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') post.click();
    });
    inputRow.appendChild(input);
    inputRow.appendChild(post);
    block.appendChild(inputRow);

    // Focus only the box the learner just opened. The old guard here tested
    // `expandedCommentIds.has(id)`, which stays true for as long as the section
    // is open — so every re-render re-focused it and dragged the scroll
    // container along with it.
    if (focusCommentFor === ticket.id) {
      focusCommentFor = null;
      requestAnimationFrame(() => {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      });
    }

    return block;
  }

  // ----- Quick-create ticket from template -----
  function showQuickCreate(): void {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:300;
      display:flex;align-items:center;justify-content:center;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    `;
    const modal = document.createElement('div');
    modal.style.cssText =
      'background:#1b1f24;border:1px solid #2d343d;border-radius:8px;padding:20px;max-width:480px;width:90%;max-height:80vh;overflow-y:auto;';

    modal.innerHTML = `
      <h3 style="color:var(--accent);margin:0 0 12px;font-size:16px;">Quick Create — Choose Template</h3>
      <div id="template-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;"></div>
      <div id="template-form" style="display:none;flex-direction:column;gap:8px;">
        <label style="font-size:11px;color:var(--muted);text-transform:uppercase;">Subject</label>
        <input id="tc-subject" type="text" style="background:#0e1116;color:var(--fg);border:1px solid var(--border);border-radius:3px;padding:6px 8px;font-size:13px;" />
        <label style="font-size:11px;color:var(--muted);text-transform:uppercase;">Body</label>
        <textarea id="tc-body" rows="3" style="background:#0e1116;color:var(--fg);border:1px solid var(--border);border-radius:3px;padding:6px 8px;font-size:13px;resize:vertical;"></textarea>
        <label style="font-size:11px;color:var(--muted);text-transform:uppercase;">Priority</label>
        <select id="tc-priority" style="background:#0e1116;color:var(--fg);border:1px solid var(--border);border-radius:3px;padding:6px 8px;font-size:13px;">
          <option value="urgent">🔴 Urgent</option>
          <option value="high">🟠 High</option>
          <option value="normal">🔵 Normal</option>
          <option value="low">⚪ Low</option>
        </select>
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button id="tc-create" style="background:var(--accent);color:#0e1116;border:none;border-radius:4px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;flex:1;">Create Ticket</button>
          <button id="tc-cancel" style="background:transparent;color:var(--muted);border:1px solid var(--border);border-radius:4px;padding:8px 14px;font-size:13px;cursor:pointer;">Cancel</button>
        </div>
      </div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const grid = modal.querySelector('#template-grid') as HTMLElement;
    const form = modal.querySelector('#template-form') as HTMLElement;
    let chosen: (typeof TICKET_TEMPLATES)[number] | null = null;

    for (const t of TICKET_TEMPLATES) {
      const card = document.createElement('div');
      card.style.cssText =
        'background:#0e1116;border:1px solid var(--border);border-radius:4px;padding:10px;cursor:pointer;text-align:left;';
      card.innerHTML = `<div style="font-size:18px;margin-bottom:4px;">${t.emoji}</div><div style="color:var(--fg);font-size:12px;font-weight:600;">${t.label}</div><div style="color:var(--muted);font-size:10px;margin-top:2px;">${t.defaultPriority} priority</div>`;
      card.addEventListener('click', () => {
        chosen = t;
        grid.style.display = 'none';
        form.style.display = 'flex';
        (modal.querySelector('#tc-subject') as HTMLInputElement).value = t.defaultSubject;
        (modal.querySelector('#tc-body') as HTMLTextAreaElement).value = t.defaultBody;
        (modal.querySelector('#tc-priority') as HTMLSelectElement).value = t.defaultPriority;
      });
      card.addEventListener('mouseenter', () => (card.style.borderColor = 'var(--accent)'));
      card.addEventListener('mouseleave', () => (card.style.borderColor = 'var(--border)'));
      grid.appendChild(card);
    }

    modal.querySelector('#tc-cancel')?.addEventListener('click', () => overlay.remove());
    modal.querySelector('#tc-create')?.addEventListener('click', () => {
      if (!chosen) return;
      const subject = (modal.querySelector('#tc-subject') as HTMLInputElement).value.trim();
      const body = (modal.querySelector('#tc-body') as HTMLTextAreaElement).value.trim();
      const priority = (modal.querySelector('#tc-priority') as HTMLSelectElement)
        .value as TicketPriority;
      if (!subject) {
        showToast('Subject is required.', { kind: 'error' });
        return;
      }
      try {
        const payload = buildTemplatePayload(chosen);
        queue.create({
          id: mkTicketId(),
          kind: chosen.kind,
          requesterId: 'player' as UserId,
          subject,
          body: body || chosen.defaultBody,
          priority,
          payload,
        } as never);
        if (priority === 'urgent') {
          urgentAlert();
        } else {
          ticketBlip();
        }
        showToast(`✓ Created ${chosen.label} ticket.`, { kind: 'success' });
        overlay.remove();
        render();
      } catch (e) {
        showToast(`Could not create: ${e instanceof Error ? e.message : String(e)}`, {
          kind: 'error',
        });
      }
    });
  }

  /** Minimal default payload for each ticket kind. The form only takes a
   *  subject and body, so we prefill the rest with sane placeholders. */
  function buildTemplatePayload(template: (typeof TICKET_TEMPLATES)[number]) {
    const k = template.kind;
    if (k === 'onboarding') {
      return {
        proposedGroupIds: [] as never[],
        proposedRoleIds: [] as never[],
        startDate: Date.now(),
      };
    }
    if (k === 'transfer' || k === 'mover') {
      return { userId: 'player' as UserId, fromGroupIds: [] as never[], toGroupIds: [] as never[] };
    }
    if (k === 'leaver' || k === 'termination') {
      return {
        userId: 'player' as UserId,
        lastDay: Date.now(),
        revokeSessions: true,
        reason: '',
        immediate: false,
      };
    }
    if (k === 'access-request') {
      return { userId: 'player' as UserId, requestedRoleIds: [] as never[], justification: '' };
    }
    if (k === 'password-reset') {
      return { userId: 'player' as UserId, method: 'helpdesk' as const };
    }
    if (k === 'mfa-issue') {
      return { userId: 'player' as UserId, symptom: 'repeated-prompts' as const };
    }
    if (k === 'incident') {
      return { affectedUserId: 'player' as UserId };
    }
    throw new Error(`unknown kind: ${k}`);
  }

  // ----- Export audit log to CSV -----
  function exportAuditLog(): void {
    const events = audit.events.filter((e) => e.action.startsWith('ticket.'));
    const header = 'Timestamp,Action,Actor,Target\n';
    const rows = events
      .map((e) => `${new Date(e.at).toISOString()},${e.action},${e.actorId},${e.targetId ?? ''}`)
      .join('\n');
    const csv = header + rows;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `iam-ticket-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Exported ${events.length} audit events.`, { kind: 'success' });
  }

  // ----- Keyboard shortcuts (only active when console is open) -----
  const keyHandler = (e: KeyboardEvent) => {
    if (!document.contains(body)) return;
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
    ) {
      // Don't hijack typing in input/textarea/select
      if (e.key !== 'Escape') return;
    }

    // Esc clears selection
    if (e.key === 'Escape') {
      if (selectedIds.size > 0) {
        selectedIds.clear();
        render();
        e.preventDefault();
        return;
      }
    }

    // Number keys 1-9 focus nth card
    const num = parseInt(e.key, 10);
    if (!isNaN(num) && num >= 1 && num <= 9) {
      const cards = wrap.querySelectorAll('.ticket-card');
      if (num <= cards.length) {
        cards[num - 1]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        e.preventDefault();
        return;
      }
    }

    // Search focus
    if (e.key === '/' || (e.ctrlKey && e.key.toLowerCase() === 'f')) {
      e.preventDefault();
      wrap.querySelector<HTMLInputElement>('#ticket-search')?.focus();
      return;
    }
    if (e.key === 'f' || e.key === 'F') {
      wrap.querySelector<HTMLInputElement>('#ticket-search')?.focus();
      e.preventDefault();
      return;
    }

    // R resolves the first open ticket (or selected)
    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      const openTickets = queue.list().filter((t) => t.status !== 'resolved');
      let target: Ticket | undefined;
      if (selectedIds.size > 0) {
        const id = [...selectedIds][0]!;
        target = openTickets.find((t) => t.id === id);
      } else {
        target = openTickets[0];
      }
      if (target) {
        try {
          queue.resolve(target.id, 'system' as UserId);
          ticketStore.getState().incrementResolved();
          ticketResolved();
          selectedIds.delete(target.id);
          showToast(`✓ Resolved: ${target.subject}`, { kind: 'success' });
        } catch (err) {
          showToast(String(err), { kind: 'error' });
        }
        render();
      }
      return;
    }

    // A assigns top ticket
    if (e.key === 'a' || e.key === 'A') {
      e.preventDefault();
      const openTickets = queue.list().filter((t) => t.status !== 'resolved');
      const target =
        selectedIds.size > 0 ? openTickets.find((t) => selectedIds.has(t.id)) : openTickets[0];
      if (target) {
        queue.assign(target.id, 'player' as UserId);
        showToast(`Assigned to you: ${target.subject}`, { kind: 'info' });
        render();
      }
      return;
    }
  };
  document.addEventListener('keydown', keyHandler, true);

  // Subscribe to the ticket store so the console re-renders whenever tickets
  // are created (lab seed) or the store is otherwise updated.
  const unsub = ticketStore.subscribe(render);

  // Also re-render if the console is revisited (e.g. after lab reset/switch).
  const observer = new MutationObserver(() => {
    if (document.contains(body)) {
      // body still in DOM — no-op, unsubscribe will fire when window closes
    } else {
      observer.disconnect();
      unsub();
      tickSub();
      document.removeEventListener('keydown', keyHandler, true);
      if (slaInterval !== null) {
        clearInterval(slaInterval);
        slaInterval = null;
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  render();
}

function btn(label: string, color: string, onClick: () => void): HTMLElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = `background:transparent;color:${color};border:1px solid ${color};border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer;`;
  b.addEventListener('click', onClick);
  return b;
}

function empty(msg: string): HTMLElement {
  const d = document.createElement('div');
  d.style.cssText = 'color:var(--muted);font-size:12px;text-align:center;padding:20px;';
  d.textContent = msg;
  return d;
}
