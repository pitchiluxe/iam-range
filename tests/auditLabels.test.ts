/**
 * tests/auditLabels.test.ts
 *
 * The audit log is meant to be investigated, so it shows usernames rather than
 * branded ids. Those usernames are learner-supplied — Create User takes free
 * text — so the label is returned as plain text and the callers render it with
 * textContent, never innerHTML.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MockAuditLog, MockDirectory } from '@/services';
import { describeAuditId } from '@/util/auditLabels';

describe('describeAuditId', () => {
  let dir: MockDirectory;

  beforeEach(() => {
    dir = new MockDirectory(new MockAuditLog());
  });

  it('resolves a user id to its username', () => {
    const u = dir.createUser({
      username: 'greta.olsen',
      displayName: 'Greta Olsen',
      email: 'g@northwind.example',
      department: 'Finance',
      title: 'CFO',
      mfa: 'none',
    });
    // The raw id carries a nanoid suffix, which is not what a log should show.
    expect(u.id).not.toBe('greta.olsen');
    expect(describeAuditId(u.id, dir)).toBe('greta.olsen');
  });

  it('resolves a group id to its name', () => {
    const g = dir.createGroup('grp-finance-payroll', 'Payroll');
    expect(describeAuditId(g.id, dir)).toBe('grp-finance-payroll');
  });

  it('resolves a role id to its name', () => {
    const r = dir.createRole('payroll-admin', 'Payroll admin', ['payroll:write']);
    expect(describeAuditId(r.id, dir)).toBe('payroll-admin');
  });

  it('returns the id unchanged when it belongs to something else', () => {
    // Ticket and session ids must still appear rather than vanish.
    expect(describeAuditId('tkt-2847', dir)).toBe('tkt-2847');
  });

  it('handles a missing id or directory', () => {
    expect(describeAuditId(undefined, dir)).toBe('');
    expect(describeAuditId('anything', undefined)).toBe('anything');
  });

  it('returns markup in a username verbatim, for the caller to set as text', () => {
    // Create User takes free text, so a username can contain anything. The
    // label must not be pre-escaped or mangled — callers render it with
    // textContent, which is what makes it safe.
    const nasty = '<img src=x onerror=alert(1)>';
    const u = dir.createUser({
      username: nasty,
      displayName: 'X',
      email: 'x@northwind.example',
      department: 'IT',
      title: 'T',
      mfa: 'none',
    });
    expect(describeAuditId(u.id, dir)).toBe(nasty);
  });
});
