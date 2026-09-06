/**
 * ui/consoles/secOpsDashboard.ts — Security Operations dashboard.
 * Shows: audit log search, incidents, access review campaigns.
 * Used by labs 06 (reviews), 08 (incident), 10 (capstone).
 */
import { describeAuditId } from '@/util/auditLabels';
import type { VmServices } from '@/vm/session';

export function renderSecOpsDashboard(body: HTMLElement, conductor: VmServices) {
  body.innerHTML = '';
  if (!conductor.audit || !conductor.incidents || !conductor.reviews) {
    body.style.cssText = 'padding:24px;color:var(--muted);font-size:13px;line-height:1.6;';
    body.innerHTML = `
      <div style="text-align:center;">
        <div style="font-size:32px;margin-bottom:8px;">🛡️</div>
        <div style="color:var(--accent);font-size:14px;font-weight:600;margin-bottom:6px;">SecOps Dashboard</div>
        <div>Identity services unavailable.</div>
        <div style="margin-top:12px;font-size:12px;line-height:1.5;">
          Reset the environment from the Ticket Queue to re-seed the directory.<br/>
          Then search the audit log, contain incidents, and run access reviews.
        </div>
      </div>
    `;
    return;
  }
  const audit = conductor.audit;
  const dir = conductor.dir;
  const incidents = conductor.incidents;
  const reviews = conductor.reviews;


  const refresh = () => {
    body.innerHTML = '';

    /* Top: tabs */
    const tabs = document.createElement('div');
    tabs.style.cssText =
      'display:flex;gap:4px;margin-bottom:12px;border-bottom:1px solid var(--border);';
    body.appendChild(tabs);

    let activeTab: 'audit' | 'incidents' | 'reviews' = 'audit';

    const renderTab = () => {
      // Clear and redraw everything below the tabs
      while (body.children.length > 1) body.removeChild(body.lastChild!);

      if (activeTab === 'audit') renderAudit();
      else if (activeTab === 'incidents') renderIncidents();
      else renderReviews();
    };

    const makeTab = (id: 'audit' | 'incidents' | 'reviews', label: string) => {
      const t = document.createElement('div');
      t.textContent = label;
      t.style.cssText = `padding:6px 12px;cursor:pointer;font-size:12px;color:${activeTab === id ? 'var(--accent)' : 'var(--muted)'};border-bottom:2px solid ${activeTab === id ? 'var(--accent)' : 'transparent'};`;
      t.addEventListener('click', () => {
        activeTab = id;
        renderTab();
        refreshTabs();
      });
      tabs.appendChild(t);
    };
    const refreshTabs = () => {
      tabs.innerHTML = '';
      makeTab('audit', 'Audit Log');
      makeTab('incidents', `Incidents (${incidents.list().length})`);
      makeTab('reviews', `Access Reviews (${reviews.list().length})`);
    };

    const renderAudit = () => {
      const h = document.createElement('h3');
      h.style.cssText =
        'color:var(--accent);font-size:12px;text-transform:uppercase;margin-bottom:6px;';
      h.textContent = 'Audit Log Search';
      body.appendChild(h);

      const search = document.createElement('input');
      search.type = 'text';
      search.placeholder = 'Filter by action, target, subject…';
      search.style.cssText =
        'width:100%;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:4px;padding:6px 8px;font-size:12px;margin-bottom:8px;';
      body.appendChild(search);

      const list = document.createElement('div');
      list.style.cssText =
        'max-height:400px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;';
      body.appendChild(list);

      const doSearch = (q: string) => {
        const query = q.toLowerCase().trim();
        list.innerHTML = '';
        const filtered = !query
          ? audit.events
          : audit.events.filter(
              (e) =>
                e.action.toLowerCase().includes(query) ||
                // Match what the learner can see, not just the internal id.
                describeAuditId(e.targetId, dir).toLowerCase().includes(query) ||
                describeAuditId(e.subjectId, dir).toLowerCase().includes(query) ||
                describeAuditId(e.actorId, dir).toLowerCase().includes(query),
            );
        const recent = filtered.slice(-50).reverse();
        for (const ev of recent) {
          const row = document.createElement('div');
          row.style.cssText =
            'padding:6px 10px;border-bottom:1px solid var(--border);font-size:11px;font-family:monospace;cursor:pointer;';
          // Built from DOM nodes rather than innerHTML: usernames here are
          // learner-supplied (Create User takes free text), so interpolating
          // them into markup would inject whatever they typed into this page.
          const span = (text: string, color?: string): HTMLElement => {
            const el = document.createElement('span');
            el.textContent = text;
            if (color) el.style.color = color;
            return el;
          };
          row.append(
            span(`[${new Date(ev.at).toLocaleTimeString()}] `, 'var(--muted)'),
            span(`${ev.action} `, 'var(--accent)'),
            span(describeAuditId(ev.targetId, dir)),
          );
          if (ev.subjectId) {
            row.append(span(` by ${describeAuditId(ev.subjectId, dir)}`, 'var(--muted)'));
          }
          if (ev.ip) row.append(span(` [ip:${ev.ip}]`, 'var(--muted)'));
          list.appendChild(row);
        }
        if (recent.length === 0) {
          list.appendChild(empty('No matching events'));
        }
      };
      doSearch('');
      search.addEventListener('input', () => doSearch(search.value));

      // "Save as evidence" button
      const saveBtn = btn('Save current filter as evidence', 'var(--accent)', () => {
        saveBtn.textContent = '✓ Saved';
        setTimeout(() => (saveBtn.textContent = 'Save current filter as evidence'), 1500);
      });
      body.appendChild(saveBtn);
    };

    const renderIncidents = () => {
      const h = document.createElement('h3');
      h.style.cssText =
        'color:var(--accent);font-size:12px;text-transform:uppercase;margin-bottom:6px;';
      h.textContent = 'Identity Incidents';
      body.appendChild(h);

      const all = incidents.list();
      if (all.length === 0) {
        body.appendChild(empty('No incidents'));
        return;
      }
      for (const inc of all) {
        const card = document.createElement('div');
        card.style.cssText =
          'background:var(--panel-2);border:1px solid var(--border);border-radius:4px;padding:10px 12px;margin-bottom:8px;font-size:12px;';
        const sevColor =
          inc.severity === 'critical'
            ? 'var(--err)'
            : inc.severity === 'high'
              ? 'var(--warn)'
              : 'var(--accent)';
        card.innerHTML = `
          <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
            <strong>${inc.title}</strong>
            <span style="color:${sevColor}">${inc.severity.toUpperCase()}</span>
          </div>
          <div style="color:var(--muted);margin-bottom:6px;">${inc.summary}</div>
          <div style="color:var(--muted);font-size:11px;">Status: <strong>${inc.status}</strong> · Affected: ${inc.affectedUserIds.length} user(s), ${inc.affectedAppIds.length} app(s)</div>
        `;
        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;';
        if (inc.status === 'open') {
          actions.appendChild(
            btn('Contain', 'var(--warn)', () => {
              for (const uid of inc.affectedUserIds) {
                incidents.contain(inc.id, `Disabled user ${uid}`, 'system' as never);
              }
              renderTab();
            }),
          );
        }
        if (inc.status === 'contained') {
          actions.appendChild(
            btn('Mark recovered', 'var(--accent)', () => {
              incidents.recover(inc.id, 'system' as never);
              renderTab();
            }),
          );
        }
        if (inc.status === 'recovered') {
          actions.appendChild(
            btn('Close', 'var(--accent)', () => {
              incidents.close(inc.id, 'system' as never);
              renderTab();
            }),
          );
        }
        actions.appendChild(
          btn('Write report', '#60a5fa', () => {
            const body2 = `## Incident Report\n\n${inc.title}\n\nSeverity: ${inc.severity}\n\nSummary: ${inc.summary}\n\nContainment actions: ${inc.containmentActions.length}\n\nIndicators: ${inc.indicators.join(', ')}`;
            incidents.writeReport(inc.id, body2, 'system' as never);
            renderTab();
          }),
        );
        card.appendChild(actions);
        body.appendChild(card);
      }
    };

    const renderReviews = () => {
      const h = document.createElement('h3');
      h.style.cssText =
        'color:var(--accent);font-size:12px;text-transform:uppercase;margin-bottom:6px;';
      h.textContent = 'Access Review Campaigns';
      body.appendChild(h);

      const all = reviews.list();
      if (all.length === 0) {
        body.appendChild(empty('No active campaigns'));
        return;
      }
      for (const r of all) {
        const card = document.createElement('div');
        card.style.cssText =
          'background:var(--panel-2);border:1px solid var(--border);border-radius:4px;padding:10px 12px;margin-bottom:8px;font-size:12px;';
        card.innerHTML = `
          <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
            <strong>${r.campaign}</strong>
            <span style="color:var(--muted)">${r.status}</span>
          </div>
          <div style="color:var(--muted);font-size:11px;margin-bottom:6px;">
            ${r.decisions.length} decisions · opened ${new Date(r.openedAt).toLocaleDateString()}
          </div>
        `;
        const list = document.createElement('div');
        list.style.cssText =
          'max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;margin-bottom:8px;';
        for (const d of r.decisions) {
          const row = document.createElement('div');
          row.style.cssText =
            'padding:4px 8px;border-bottom:1px solid var(--border);font-size:11px;display:flex;justify-content:space-between;align-items:center;';
          row.innerHTML = `<span>${d.userId} → ${d.groupId ?? d.roleId}</span><span style="color:${d.decision === 'approve' ? 'var(--accent)' : 'var(--err)'}">${d.decision}</span>`;
          list.appendChild(row);
        }
        card.appendChild(list);

        // Manager actions
        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';
        actions.appendChild(
          btn('Record all approvals', 'var(--accent)', () => {
            for (const d of r.decisions) {
              reviews.recordDecision(r.id, {
                ...d,
                decision: 'approve',
                decidedBy: 'ivy.park' as never,
              });
            }
            renderTab();
          }),
        );
        actions.appendChild(
          btn('Record revocations', 'var(--err)', () => {
            for (const d of r.decisions) {
              reviews.recordDecision(r.id, {
                ...d,
                decision: 'revoke',
                decidedBy: 'ivy.park' as never,
              });
            }
            renderTab();
          }),
        );
        actions.appendChild(
          btn('Close campaign', '#60a5fa', () => {
            reviews.close(r.id);
            renderTab();
          }),
        );
        card.appendChild(actions);
        body.appendChild(card);
      }
    };

    refreshTabs();
    renderTab();
  };

  refresh();
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
