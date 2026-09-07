/**
 * vm/auditQuery.ts — asking the audit log questions.
 *
 * The log is the most valuable thing this workstation produces and the least
 * used. It was reachable in two places: a scrolling tail at the bottom of the
 * ticket console, and a CSV export. Neither answers the questions an identity
 * engineer is actually asked — who granted this, what changed on Tuesday,
 * show me every privileged activation, what did this account do before it was
 * disabled.
 *
 * So this is a query language rather than a set of dropdowns. Dropdowns would
 * be quicker to build and would teach nothing: every real tool a learner will
 * touch afterwards — Sentinel, Splunk, Entra's own log blade — is a text query
 * with `field:value` terms, and getting fluent in that shape is transferable
 * in a way that clicking a filter chip is not.
 *
 * The grammar is deliberately tiny:
 *
 *   actor:admin           who did it
 *   action:pim.           what happened, matched as a prefix
 *   target:jdoe           what it was done to
 *   subject:jdoe          who it was done for
 *   since:24h  since:7d   how far back
 *   before:2026-09-01     up to when
 *   anything else         free text over the action, note and resolved names
 *
 * Terms combine with AND, because that is what narrowing a search means and
 * an OR that nobody asked for is how a query quietly stops meaning anything.
 */
import type { AuditEvent } from '@/domain';
import type { VmServices } from './session';

export interface QueryTerm {
  field: 'actor' | 'action' | 'target' | 'subject' | 'since' | 'before' | 'text';
  value: string;
  /** Set when a term could not be understood, so the UI can say which one. */
  error?: string;
}

export interface ParsedQuery {
  terms: QueryTerm[];
  errors: string[];
}

const FIELDS = new Set(['actor', 'action', 'target', 'subject', 'since', 'before']);

/**
 * Split a query into terms, respecting quotes.
 *
 * `note:"disabled the wrong account"` has to survive as one term, or a phrase
 * search silently becomes three unrelated word searches that match nothing.
 */
function tokenise(input: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (const ch of input) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) out.push(current);
  return out;
}

/** Turn `24h`, `7d`, `30m` or an ISO date into a timestamp. */
export function parseWhen(value: string, now = Date.now()): number | null {
  const rel = /^(\d+)\s*([mhd])$/i.exec(value.trim());
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2]!.toLowerCase();
    const ms = unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
    return now - n * ms;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function parseQuery(input: string, now = Date.now()): ParsedQuery {
  const terms: QueryTerm[] = [];
  const errors: string[] = [];

  for (const token of tokenise(input)) {
    const colon = token.indexOf(':');
    const head = colon > 0 ? token.slice(0, colon).toLowerCase() : '';

    if (colon > 0 && FIELDS.has(head)) {
      const value = token.slice(colon + 1);
      if (!value) {
        errors.push(`${head}: needs a value.`);
        continue;
      }
      if (head === 'since' || head === 'before') {
        if (parseWhen(value, now) === null) {
          errors.push(`${head}:${value} — try 30m, 24h, 7d or a date like 2026-09-01.`);
          continue;
        }
      }
      terms.push({ field: head as QueryTerm['field'], value });
      continue;
    }

    // A colon with an unknown field is nearly always a typo for a known one,
    // and treating it as free text would silently return nothing.
    if (colon > 0 && !FIELDS.has(head) && !/^https?$/.test(head)) {
      errors.push(`Unknown field "${head}". Try actor, action, target, subject, since or before.`);
      continue;
    }

    terms.push({ field: 'text', value: token });
  }

  return { terms, errors };
}

/** Everything a row can be searched by, with ids resolved to names. */
export interface AuditRow {
  event: AuditEvent;
  at: number;
  actor: string;
  action: string;
  target: string;
  subject: string;
  note: string;
}

/**
 * Resolve an id to a name.
 *
 * A log of `user-a4f1` cannot be read by a person, and being readable is the
 * whole reason to build this rather than point people at the CSV.
 */
function nameOf(s: VmServices, id: string | undefined): string {
  if (!id) return '';
  const user = s.dir.listUsers().find((u) => u.id === id);
  if (user) return user.username;
  const group = s.dir.listGroups().find((g) => g.id === id);
  if (group) return group.name;
  const ou = s.dir.listOus().find((o) => o.id === id);
  if (ou) return ou.name;
  const ticket = s.tickets.list().find((t) => t.id === id);
  if (ticket) return ticket.subject;
  return id;
}

export function toRows(s: VmServices): AuditRow[] {
  return s.audit.events.map((event) => ({
    event,
    at: event.at,
    actor: nameOf(s, event.actorId),
    action: event.action,
    target: nameOf(s, event.targetId),
    subject: nameOf(s, event.subjectId),
    note: event.note ?? '',
  }));
}

function matches(row: AuditRow, term: QueryTerm, now: number): boolean {
  const eq = (a: string, b: string): boolean => a.toLowerCase().includes(b.toLowerCase());
  switch (term.field) {
    case 'actor':
      return eq(row.actor, term.value);
    case 'target':
      return eq(row.target, term.value);
    case 'subject':
      return eq(row.subject, term.value);
    case 'action':
      // Prefix, so `action:pim.` finds every PIM event — the way an analyst
      // narrows to a family of events rather than naming each one.
      return row.action.toLowerCase().startsWith(term.value.toLowerCase());
    case 'since': {
      const at = parseWhen(term.value, now);
      return at === null ? true : row.at >= at;
    }
    case 'before': {
      const at = parseWhen(term.value, now);
      return at === null ? true : row.at <= at;
    }
    case 'text':
      return (
        eq(row.action, term.value) ||
        eq(row.note, term.value) ||
        eq(row.actor, term.value) ||
        eq(row.target, term.value) ||
        eq(row.subject, term.value)
      );
  }
}

/** Run a query. Newest first, which is the order an investigation reads in. */
export function runQuery(
  s: VmServices,
  input: string,
  now = Date.now(),
): { rows: AuditRow[]; errors: string[] } {
  const { terms, errors } = parseQuery(input, now);
  const rows = toRows(s)
    .filter((row) => terms.every((t) => matches(row, t, now)))
    .sort((a, b) => b.at - a.at);
  return { rows, errors };
}

/**
 * The questions an identity engineer is actually asked.
 *
 * Presets rather than a blank box, because a query language you cannot see
 * examples of is a query language nobody uses. Each is a real question, and
 * clicking one fills the box so it can be edited — which is how people learn
 * the grammar.
 */
export const SAVED_QUERIES: { label: string; query: string; why: string }[] = [
  {
    label: 'Who granted access, and to whom',
    query: 'action:group.add',
    why: 'Every membership grant. The first question in any access review.',
  },
  {
    label: 'Everything in the last hour',
    query: 'since:1h',
    why: 'What has just happened on this estate.',
  },
  {
    label: 'Privileged activity',
    query: 'action:pim.',
    why: 'Every eligibility, activation, approval and stand-down.',
  },
  {
    label: 'Accounts disabled',
    query: 'action:user.disabled',
    why: 'Leavers, and anything disabled that should not have been.',
  },
  {
    label: 'Failed sign-ins',
    query: 'action:signin.failure',
    why: 'Where a lockout investigation starts.',
  },
  {
    label: 'Cloud synchronisation',
    query: 'action:cloud.',
    why: 'Sync cycles and what they changed in the tenant.',
  },
  {
    label: 'Tickets and their reviews',
    query: 'action:ticket.',
    why: 'What was closed, and what the review found.',
  },
  {
    label: 'Missed response targets',
    query: 'action:ticket.slaBreached',
    why: 'Work that sat too long before anybody picked it up.',
  },
];

/** Rows as CSV, for the people who will always want it in a spreadsheet. */
export function toCsv(rows: readonly AuditRow[]): string {
  const escape = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const head = 'timestamp,action,actor,target,subject,note';
  const body = rows.map((r) =>
    [
      new Date(r.at).toISOString(),
      r.action,
      r.actor,
      r.target,
      r.subject,
      r.note,
    ]
      .map(escape)
      .join(','),
  );
  return [head, ...body].join('\n');
}
