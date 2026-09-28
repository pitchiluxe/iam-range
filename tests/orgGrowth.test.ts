/**
 * tests/orgGrowth.test.ts — "Generate work" keeps producing work, and the work
 * builds a real organisation: department OUs, job-role groups and a hiring
 * wave per department, each graded against the plan that raised it.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { VmSession } from '@/vm/session';
import { generateTickets } from '@/vm/ticketGenerator';
import { reviewTicketSync } from '@/vm/ticketReview';
import { DEPARTMENTS } from '@/config';
import { DEPARTMENT_OUS_ID, JOB_ROLES, ROLE_GROUPS_ID, allPlannedHires, hiringWave, slug, waveFor } from '@/vm/orgPlan';
import { forgetOllamaState, listOllamaModels, ollamaAvailable, ollamaFetch } from '@/config/ollama';
import type { Ticket, UserId } from '@/domain';

const ACTOR = 'admin-1' as UserId;
const deps = (s: VmSession) => ({ dir: s.dir, tickets: s.tickets, audit: s.audit, pim: s.pim, cloud: s.cloud, endpoints: s.endpoints });
const gen = (s: VmSession) => generateTickets(deps(s), { useOllama: false });
const byId = (s: VmSession, id: string): Ticket | undefined => s.tickets.list().find((t) => t.scenarioId === id);
const review = (s: VmSession, t: Ticket) => reviewTicketSync(t, deps(s), ACTOR);

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as { electron?: unknown }).electron;
});

/** Do what the foundation tickets ask. */
function buildFoundation(s: VmSession): void {
  const corp = s.dir.createOu('Corp', 'Corporate', undefined, ACTOR);
  s.dir.createOu('Users', '', corp.id, ACTOR);
  s.dir.createOu('Groups', '', corp.id, ACTOR);
  for (const g of ['grp-helpdesk-tier1', 'grp-hr-readers', 'grp-finance-payroll']) {
    s.dir.createGroup(g, '', ACTOR, s.dir.getOuByName('Groups')!.id);
  }
}

function resolveAll(s: VmSession): void {
  for (const t of s.tickets.list()) if (t.status !== 'resolved') s.tickets.resolve(t.id, ACTOR);
}

describe('Generate work keeps producing work', () => {
  it('a second click on a new domain raises more than the first ticket', async () => {
    const s = new VmSession(null);
    expect(byId(s, 'build-ou-structure')).toBeDefined();
    const r = await gen(s);
    expect(r.raised).toBeGreaterThan(0);
    expect(byId(s, 'define-group-model')).toBeDefined();
  });

  it('plans ahead into the growth program, a few tickets at a time', async () => {
    const s = new VmSession(null);
    buildFoundation(s);
    await gen(s);
    await gen(s);
    const growthOpen = s.tickets.list().filter((t) => t.status !== 'resolved' && (t.scenarioId === DEPARTMENT_OUS_ID || t.scenarioId === ROLE_GROUPS_ID || waveFor(t.scenarioId)));
    expect(growthOpen.length).toBeGreaterThan(0);
    expect(growthOpen.length).toBeLessThanOrEqual(3);
  });

  it('tickets are in the queue before Ollama is asked, and only untouched tickets are reworded', async () => {
    const s = new VmSession(null);
    let queuedWhenRaised = -1;
    let asked = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (!String(url).includes('/api/generate')) return new Response(JSON.stringify({ models: [{ name: 'm' }] }));
      asked++;
      // By the time the model is asked, the ticket is already there.
      expect(queuedWhenRaised).toBeGreaterThan(0);
      return new Response(JSON.stringify({ response: JSON.stringify({ subject: 'Reworded', body: 'Reworded body: ' + s.tickets.list().map((t) => t.body).join(' ') }) }));
    }));
    const r = await generateTickets(deps(s), { onRaised: () => { queuedWhenRaised = s.tickets.list().length; } });
    expect(r.raised).toBeGreaterThan(0);
    expect(asked).toBeGreaterThan(0);

    const t = s.tickets.list().find((x) => x.status === 'open')!;
    s.tickets.comment(t.id, ACTOR, 'Started on this');
    expect(s.tickets.reword(t.id, 'Changed', 'Changed')).toBe(false);
  });

  it('says why when nothing more can be raised yet', async () => {
    const s = new VmSession(null);
    // Nothing done: the queue plans ahead only so far.
    for (let i = 0; i < 5; i++) await gen(s);
    const r = await gen(s);
    if (r.raised === 0) expect(r.note).toMatch(/resolve/i);
  });
});

describe('the organisation it builds', () => {
  it('plans 35 new people across every department, with unique logons and two jobs per department', () => {
    const hires = allPlannedHires();
    expect(hires).toHaveLength(DEPARTMENTS.length * 5);
    expect(new Set(hires.map((h) => h.logon)).size).toBe(hires.length);
    for (const d of DEPARTMENTS) expect(JOB_ROLES.filter((r) => r.department === d)).toHaveLength(2);
  });

  it('end to end: every growth ticket fails until the work is done, then passes, and every planned person is hired', async () => {
    const s = new VmSession(null);
    buildFoundation(s);
    const users = s.dir.getOuByName('Users')!;
    const groupsOu = s.dir.getOuByName('Groups')!;

    for (let round = 0; round < 20; round++) {
      await gen(s);
      for (const t of s.tickets.list().filter((x) => x.status !== 'resolved')) {
        if (t.scenarioId === DEPARTMENT_OUS_ID) {
          expect(review(s, t).passed).toBe(false);
          for (const d of DEPARTMENTS) if (!s.dir.getOuByName(d)) s.dir.createOu(d, '', users.id, ACTOR);
          expect(review(s, t).passed).toBe(true);
        } else if (t.scenarioId === ROLE_GROUPS_ID) {
          expect(review(s, t).passed).toBe(false);
          for (const r of JOB_ROLES) if (!s.dir.getGroupByName(r.group)) s.dir.createGroup(r.group, r.title, ACTOR, groupsOu.id);
          expect(review(s, t).passed).toBe(true);
        } else if (t.scenarioId?.startsWith('onboard-')) {
          const logon = t.scenarioId.slice('onboard-'.length);
          if (!s.dir.getUserByUsername(logon)) {
            s.dir.createUser({ username: logon, displayName: logon, email: `${logon}@example.test`, department: 'IT', title: 'Staff', ouId: users.id }, ACTOR);
          }
        } else {
          const wave = waveFor(t.scenarioId);
          if (!wave) continue;
          expect(review(s, t).passed).toBe(false);
          for (const h of wave.hires) {
            const u = s.dir.createUser({ username: h.logon, displayName: `${h.first} ${h.last}`, email: `${h.logon}@example.test`, department: wave.department, title: h.role.title, ouId: s.dir.getOuByName(wave.department)!.id }, ACTOR);
            s.dir.addToGroup(u.id, s.dir.getGroupByName(h.role.group)!.id, ACTOR);
          }
          expect(review(s, t).checks.filter((c) => !c.passed)).toEqual([]);
        }
      }
      resolveAll(s);
    }

    for (const d of DEPARTMENTS) expect(byId(s, `hire-${slug(d)}`), d).toBeDefined();
    for (const h of allPlannedHires()) expect(s.dir.getUserByUsername(h.logon), h.logon).toBeDefined();
    const staff = s.dir.listUsers().filter((u) => u.username !== 'admin' && !u.username.startsWith('svc-'));
    // The 35 planned hires, plus the first starters the foundation tickets bring in.
    expect(staff.length).toBeGreaterThan(allPlannedHires().length);
  });

  it('a wave is not done while one starter is missing or in the wrong place', async () => {
    const s = new VmSession(null);
    buildFoundation(s);
    const finance = s.dir.createOu('Finance', '', s.dir.getOuByName('Users')!.id, ACTOR);
    const hires = hiringWave('Finance');
    for (const r of JOB_ROLES) s.dir.createGroup(r.group, '', ACTOR);
    for (const h of hires.slice(1)) {
      const u = s.dir.createUser({ username: h.logon, displayName: h.first, email: `${h.logon}@example.test`, department: 'Finance', title: h.role.title, ouId: finance.id }, ACTOR);
      s.dir.addToGroup(u.id, s.dir.getGroupByName(h.role.group)!.id, ACTOR);
    }
    const t = s.tickets.create({ kind: 'onboarding', scenarioId: 'hire-finance', requesterId: ACTOR, subject: 'x', body: 'x', priority: 'normal', relatedUserIds: [], payload: { proposedGroupIds: [], proposedRoleIds: [], startDate: 0 } });
    const r = review(s, t);
    expect(r.passed).toBe(false);
    expect(r.checks.find((c) => c.label === 'Every starter has an account')!.detail).toContain(hires[0]!.logon);
  });
});

describe('Ollama transport', () => {
  it('in the desktop app, requests go through the main process and stream back as a normal Response', async () => {
    const seen: { path: string; method?: string; body?: string }[] = [];
    (globalThis as { electron?: unknown }).electron = {
      ollamaRequest: (req: { path: string; method?: string; body?: string }, onEvent: (k: string, d?: unknown) => void) => {
        seen.push(req);
        queueMicrotask(() => {
          onEvent('head', { status: 200, statusText: 'OK' });
          onEvent('data', '{"response":"Hel');
          onEvent('data', 'lo"}');
          onEvent('end');
        });
        return () => undefined;
      },
    };
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await ollamaFetch('http://127.0.0.1:11434/api/generate', { method: 'POST', body: '{"x":1}' });
    expect(await res.json()).toEqual({ response: 'Hello' });
    expect(seen).toEqual([{ path: '/api/generate', method: 'POST', body: '{"x":1}' }]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a failure before any reply rejects like fetch does, so callers fall back', async () => {
    (globalThis as { electron?: unknown }).electron = {
      ollamaRequest: (_req: unknown, onEvent: (k: string, d?: unknown) => void) => {
        queueMicrotask(() => onEvent('error', 'connect ECONNREFUSED'));
        return () => undefined;
      },
    };
    await expect(ollamaFetch('http://127.0.0.1:11434/api/tags')).rejects.toThrow(/ECONNREFUSED/);
  });

  it('an abort cancels the request in the main process', async () => {
    let aborted = false;
    (globalThis as { electron?: unknown }).electron = {
      ollamaRequest: () => () => { aborted = true; },
    };
    const ctl = new AbortController();
    const p = ollamaFetch('http://127.0.0.1:11434/api/generate', { method: 'POST', body: '{}', signal: ctl.signal });
    ctl.abort();
    await expect(p).rejects.toThrow(/abort/i);
    expect(aborted).toBe(true);
  });

  it('a busy Ollama is not reported offline: a recent answer counts, and its model list is reused', async () => {
    let busy = false;
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (busy) throw new DOMException('Aborted', 'AbortError'); // slower than the timeout
      return new Response(JSON.stringify({ models: [{ name: 'llama3:latest' }] }));
    }));
    expect(await listOllamaModels()).toEqual(['llama3:latest']);
    busy = true;
    expect(await ollamaAvailable()).toBe(true);
    expect(await listOllamaModels()).toEqual(['llama3:latest']);
    // Never answered at all: offline, straight away.
    forgetOllamaState();
    expect(await ollamaAvailable()).toBe(false);
    expect(await listOllamaModels()).toBeNull();
  });

  it('outside the desktop app it is plain fetch', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchSpy);
    await ollamaFetch('http://127.0.0.1:11434/api/tags');
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});
