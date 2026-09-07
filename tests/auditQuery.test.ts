/**
 * tests/auditQuery.test.ts — a search that quietly returns nothing is worse
 * than an error.
 *
 * The failure mode of a query language is not a crash. It is a typo that
 * silently matches no rows, read as "there is no such activity" — which in an
 * investigation is the wrong conclusion drawn confidently. So the parser
 * reports unknown fields and unreadable time windows rather than falling back
 * to free text, and that is asserted here alongside the matching.
 */
import { describe, it, expect } from 'vitest';
import { VmSession } from '@/vm/session';
import { parseQuery, parseWhen, runQuery, toCsv, toRows, SAVED_QUERIES } from '@/vm/auditQuery';
import type { UserId } from '@/domain';

const ACTOR = 'admin-1' as UserId;

function seeded() {
  const s = new VmSession();
  const ou = s.dir.createOu('Corps', 'Corporate', undefined, ACTOR);
  const g = s.dir.createGroup('grp-hr-readers', 'HR read', ACTOR, ou.id);
  const u = s.dir.createUser({
    username: 'jdoe',
    displayName: 'John Doe',
    email: 'jdoe@iamlab.com',
    department: 'HR',
    title: 'Analyst',
    mfa: 'none',
  });
  s.dir.addToGroup(u.id, g.id, ACTOR);
  s.dir.disableUser(u.id, ACTOR);
  return s;
}

describe('parsing a query', () => {
  it('reads field terms', () => {
    const { terms, errors } = parseQuery('actor:admin action:group.add');
    expect(errors).toEqual([]);
    expect(terms).toEqual([
      { field: 'actor', value: 'admin' },
      { field: 'action', value: 'group.add' },
    ]);
  });

  it('keeps a quoted phrase as one term', () => {
    // Without this a phrase search becomes three word searches that match
    // nothing, and the learner concludes the event is not there.
    const { terms } = parseQuery('"disabled the wrong account"');
    expect(terms).toEqual([{ field: 'text', value: 'disabled the wrong account' }]);
  });

  it('names an unknown field instead of searching for it as text', () => {
    const { errors } = parseQuery('user:jdoe');
    expect(errors[0]).toMatch(/Unknown field "user"/);
  });

  it('rejects a time window it cannot read', () => {
    const { errors } = parseQuery('since:yesterday');
    expect(errors[0]).toMatch(/since:yesterday/);
  });

  it('complains about a field with no value', () => {
    expect(parseQuery('actor:').errors[0]).toMatch(/needs a value/);
  });
});

describe('time windows', () => {
  const now = Date.parse('2026-09-07T12:00:00Z');

  it('reads relative windows', () => {
    expect(parseWhen('30m', now)).toBe(now - 30 * 60_000);
    expect(parseWhen('24h', now)).toBe(now - 24 * 3_600_000);
    expect(parseWhen('7d', now)).toBe(now - 7 * 86_400_000);
  });

  it('reads a date', () => {
    expect(parseWhen('2026-09-01', now)).toBe(Date.parse('2026-09-01'));
  });

  it('returns null for nonsense, so the caller can say so', () => {
    expect(parseWhen('soonish', now)).toBeNull();
  });
});

describe('running a query', () => {
  it('resolves ids to names, because an id cannot be read by a person', () => {
    const rows = toRows(seeded());
    const grant = rows.find((r) => r.action === 'group.add');
    expect(grant?.target).toBe('grp-hr-readers');
    expect(grant?.subject).toBe('jdoe');
  });

  it('matches an action family by prefix', () => {
    // How an analyst narrows to a family rather than naming each event.
    const { rows } = runQuery(seeded(), 'action:group.');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.action.startsWith('group.'))).toBe(true);
  });

  it('combines terms with AND', () => {
    const s = seeded();
    const both = runQuery(s, 'action:user. jdoe').rows;
    expect(both.every((r) => r.action.startsWith('user.'))).toBe(true);
    expect(both.some((r) => r.action === 'user.disabled')).toBe(true);
    // Narrowing has to actually narrow.
    expect(both.length).toBeLessThan(runQuery(s, 'action:user.').rows.length);
  });

  it('finds an account by name across actor, target and subject', () => {
    const { rows } = runQuery(seeded(), 'jdoe');
    expect(rows.length).toBeGreaterThan(1);
  });

  it('honours a time window', () => {
    const s = seeded();
    expect(runQuery(s, 'since:1h').rows.length).toBeGreaterThan(0);
    // Everything was recorded now, so a window ending yesterday holds nothing.
    expect(runQuery(s, 'before:2020-01-01').rows).toEqual([]);
  });

  it('returns the newest first, which is how an investigation reads', () => {
    const rows = runQuery(seeded(), '').rows;
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i - 1]!.at).toBeGreaterThanOrEqual(rows[i]!.at);
    }
  });
});

describe('the saved questions', () => {
  it('all parse without error', () => {
    // A preset that does not parse teaches the wrong grammar by example.
    for (const saved of SAVED_QUERIES) {
      expect(parseQuery(saved.query).errors, saved.label).toEqual([]);
    }
  });

  it('each says why it is worth asking', () => {
    for (const saved of SAVED_QUERIES) {
      expect(saved.why.length, saved.label).toBeGreaterThan(15);
    }
  });
});

describe('CSV export', () => {
  it('has a header and one line per row', () => {
    const rows = runQuery(seeded(), 'action:group.').rows;
    const lines = toCsv(rows).split('\n');
    expect(lines[0]).toBe('timestamp,action,actor,target,subject,note');
    expect(lines).toHaveLength(rows.length + 1);
  });

  it('quotes a value containing a comma so the columns survive', () => {
    const csv = toCsv([
      {
        event: {} as never,
        at: 0,
        actor: 'admin',
        action: 'ticket.slaBreached',
        target: 'x',
        subject: '',
        note: 'urgent ticket "Locked out", missed its target',
      },
    ]);
    expect(csv).toContain('"urgent ticket ""Locked out"", missed its target"');
  });
});
