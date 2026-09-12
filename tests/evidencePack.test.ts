/**
 * tests/evidencePack.test.ts — the artifact has to be true.
 *
 * The pack is the thing a learner hands an interviewer, so the failure that
 * matters is not a formatting slip: it is the pack claiming work that was
 * never done. Every assertion here is about that. A bare domain must produce
 * a document that says so.
 *
 * The second thing it must do is show its working. "Complete" with nothing
 * behind it is exactly the self-report this product refuses everywhere else,
 * so the audit lines under each task are asserted too.
 */
import { describe, it, expect } from 'vitest';
import { VmSession } from '@/vm/session';
import { buildEvidencePack, packFilename } from '@/vm/evidencePack';
import { MANUAL } from '@/config/manual';
import type { UserId } from '@/domain';

const ACTOR = 'admin-1' as UserId;

/**
 * A domain nobody has touched.
 *
 * The seeded tickets are left open on purpose. Resolving them to tidy the
 * queue would be work claimed without work done, which is the exact thing
 * these tests exist to catch.
 */
function bare(): VmSession {
  return new VmSession();
}

/** A domain with real work in it. */
function worked(): VmSession {
  const s = bare();
  const corps = s.dir.createOu('Corps', 'Corporate', undefined, ACTOR);
  const groupsOu = s.dir.createOu('Groups', 'Security groups', corps.id, ACTOR);
  const g = s.dir.createGroup('grp-helpdesk-tier1', 'Service desk', ACTOR, groupsOu.id);
  s.dir.createGroup('grp-hr-readers', 'HR read', ACTOR, groupsOu.id);
  s.dir.createGroup('grp-finance-payroll', 'Payroll', ACTOR, groupsOu.id);
  const u = s.dir.createUser({
    username: 'jdoe',
    displayName: 'John Doe',
    email: 'jdoe@omari.test',
    department: 'Help Desk',
    title: 'Analyst',
    mfa: 'none',
  });
  s.dir.addToGroup(u.id, g.id, ACTOR);
  s.dir.setUserOu(u.id, corps.id, ACTOR);
  return s;
}

describe('a pack from a domain where nothing was done', () => {
  it('does not claim any completed work', () => {
    // The single most damaging failure: a portfolio asserting work that never
    // happened, handed to somebody who will ask about it.
    const md = buildEvidencePack(bare());
    // Counted from the manual rather than hardcoded, so adding a chapter
    // does not quietly turn this into a test of an old curriculum.
    const total = MANUAL.flatMap((c) => c.lessons).length;
    expect(md).toContain(`0 of ${total} tasks complete`);
  });

  it('lists what is outstanding rather than staying silent', () => {
    const md = buildEvidencePack(bare());
    expect(md).toContain('Still outstanding');
    expect(md).toContain('Build at least a parent OU');
  });

  it('says no tickets were resolved', () => {
    expect(buildEvidencePack(bare())).toContain('No tickets have been resolved yet');
  });
});

describe('a pack from a domain where work was done', () => {
  it('names the tasks that are genuinely complete', () => {
    const md = buildEvidencePack(worked());
    expect(md).toContain('Build the organisational unit structure');
    expect(md).toContain('Define the group model');
    expect(md).toContain('Onboard somebody properly');
  });

  it('shows the estate that was built', () => {
    const md = buildEvidencePack(worked());
    expect(md).toContain('Corps');
    expect(md).toContain('grp-helpdesk-tier1');
  });

  it('quotes the audit entries behind each completed task', () => {
    // "Complete" on its own is a self-report. The log lines are what let a
    // reader check rather than trust.
    const md = buildEvidencePack(worked());
    expect(md).toContain('From the audit log');
    expect(md).toContain('ou.created');
  });

  it('resolves ids to names, because an id proves nothing to a reader', () => {
    const md = buildEvidencePack(worked());
    expect(md).toMatch(/ou\.created\s+(Corps|Groups)/);
    // The raw internal id should not be what a human is shown.
    expect(md).not.toMatch(/ou\.created\s+ou-[0-9a-z]{6,}/);
  });

  it('still reports the parts that are not finished', () => {
    // A pack that only lists successes is a brochure. Naming the gaps is what
    // makes the rest credible.
    const md = buildEvidencePack(worked());
    expect(md).toContain('Still outstanding');
  });
});

describe('the document itself', () => {
  it('says the work was not written by a model', () => {
    // The claim an interviewer most needs, given what the product ships with.
    expect(buildEvidencePack(worked())).toContain('nothing was written by a language model');
  });

  it('names the operator on the cover', () => {
    expect(buildEvidencePack(worked(), { operator: 'Erick Omari' })).toContain('Erick Omari');
  });

  it('can leave the appendix out', () => {
    const full = buildEvidencePack(worked());
    const short = buildEvidencePack(worked(), { includeAppendix: false });
    expect(full).toContain('Appendix');
    expect(short).not.toContain('Appendix');
    expect(short.length).toBeLessThan(full.length);
  });

  it('is stable — the same estate produces the same document', () => {
    // Apart from the date, which is the point of the filename.
    const s = worked();
    expect(buildEvidencePack(s, { operator: 'x' })).toBe(buildEvidencePack(s, { operator: 'x' }));
  });

  it('has a filename that sorts by date and says what it is', () => {
    expect(packFilename()).toMatch(/^iam-range-evidence-\d{4}-\d{2}-\d{2}\.md$/);
  });
});
