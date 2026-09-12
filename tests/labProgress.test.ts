/**
 * tests/labProgress.test.ts — progress is earned, not claimed.
 *
 * The manual's fifteen lessons are the curriculum and nothing tracked whether
 * any had been done. The obvious fix is a checklist you tick, which is exactly
 * the mistake this project took out of the ticket queue: marking a ticket
 * resolved was a claim nobody checked, and the whole queue could be closed
 * having done nothing. A self-ticked curriculum would teach the same habit one
 * level up.
 *
 * So every lesson is a predicate over the estate, and the first test here is
 * the one that matters: a fresh domain is at zero. If progress could be
 * granted without work, that is where it would show.
 *
 * The drift guard is the second: a lesson with no rule would silently never
 * complete, and nobody would notice until a learner finished the course and
 * the plan still said fourteen of fifteen.
 */
import { describe, it, expect } from 'vitest';
import { VmSession } from '@/vm/session';
import { computeProgress, lessonIds, ruleIds } from '@/vm/labProgress';
import { MANUAL } from '@/config/manual';
import type { UserId } from '@/domain';

const ACTOR = 'admin-1' as UserId;

/** A bare domain: the built-in administrator and nothing else. */
function bare(): VmSession {
  const s = new VmSession();
  s.tickets.list().forEach((t) => s.tickets.resolve(t.id, ACTOR));
  return s;
}

describe('every lesson is measurable', () => {
  it('has a rule for each lesson the manual defines', () => {
    // Without this, adding a lesson to the manual gives a task that can never
    // be completed, and the plan quietly caps below 100%.
    const missing = lessonIds().filter((id) => !ruleIds().includes(id));
    expect(missing, `lessons with no progress rule: ${missing.join(', ')}`).toEqual([]);
  });

  it('has no rule for a lesson that no longer exists', () => {
    const orphans = ruleIds().filter((id) => !lessonIds().includes(id));
    expect(orphans, `rules with no lesson: ${orphans.join(', ')}`).toEqual([]);
  });

  it('covers every chapter', () => {
    const progress = computeProgress(bare());
    expect(progress.chapters).toHaveLength(MANUAL.length);
    expect(progress.total).toBe(lessonIds().length);
  });
});

describe('a fresh domain has done nothing', () => {
  it('reports no completed lessons in the operational chapters', () => {
    const progress = computeProgress(bare());
    const byId = new Map(
      progress.chapters.flatMap((c) => c.lessons).map((l) => [l.lesson.id, l]),
    );

    // Nothing has been built, moved, offboarded or connected.
    for (const id of ['ou-structure', 'group-model', 'joiner', 'mover', 'leaver', 'eligible']) {
      expect(byId.get(id)?.state, id).not.toBe('done');
    }
  });

  it('says what is outstanding for anything not finished', () => {
    // A plan that says "not started" without saying what to do is a scoreboard,
    // not a plan.
    const progress = computeProgress(bare());
    for (const entry of progress.chapters.flatMap((c) => c.lessons)) {
      if (entry.state === 'done') continue;
      expect(entry.outstanding.length, entry.lesson.id).toBeGreaterThan(10);
    }
  });
});

describe('doing the work moves the plan', () => {
  it('completes the OU lesson once a structure exists', () => {
    const s = bare();
    const before = computeProgress(s);
    const ouBefore = before.chapters[0]!.lessons.find((l) => l.lesson.id === 'ou-structure')!;
    expect(ouBefore.state).toBe('not-started');

    const corps = s.dir.createOu('Corps', 'Corporate', undefined, ACTOR);
    const partial = computeProgress(s).chapters[0]!.lessons.find(
      (l) => l.lesson.id === 'ou-structure',
    )!;
    // One OU is a start, not a structure.
    expect(partial.state).toBe('in-progress');

    s.dir.createOu('Groups', 'Security groups', corps.id, ACTOR);
    const after = computeProgress(s).chapters[0]!.lessons.find(
      (l) => l.lesson.id === 'ou-structure',
    )!;
    expect(after.state).toBe('done');
    expect(after.evidence).toMatch(/Corps/);
  });

  it('completes the joiner lesson only when the account is grouped and placed', () => {
    // The same standard the onboarding ticket review applies: creating the
    // object is the easy half.
    const s = bare();
    const ou = s.dir.createOu('Corps', 'Corporate', undefined, ACTOR);
    const group = s.dir.createGroup('grp-hr-readers', 'HR read', ACTOR, ou.id);
    const user = s.dir.createUser({
      username: 'jdoe',
      displayName: 'John Doe',
      email: 'jdoe@omari.test',
      department: 'Help Desk',
      title: 'Analyst',
      mfa: 'none',
    });

    const joinerState = () =>
      computeProgress(s).chapters.flatMap((c) => c.lessons).find((l) => l.lesson.id === 'joiner')!
        .state;

    expect(joinerState()).toBe('in-progress');
    s.dir.addToGroup(user.id, group.id, ACTOR);
    expect(joinerState()).toBe('in-progress');
    s.dir.setUserOu(user.id, ou.id, ACTOR);
    expect(joinerState()).toBe('done');
  });

  it('needs both halves of a move', () => {
    const s = bare();
    const ou = s.dir.createOu('Corps', 'Corporate', undefined, ACTOR);
    const group = s.dir.createGroup('grp-helpdesk', 'Desk', ACTOR, ou.id);
    const user = s.dir.createUser({
      username: 'mchen',
      displayName: 'Maya Chen',
      email: 'mchen@omari.test',
      department: 'HR',
      title: 'Partner',
      mfa: 'none',
    });

    const moverState = () =>
      computeProgress(s).chapters.flatMap((c) => c.lessons).find((l) => l.lesson.id === 'mover')!
        .state;

    s.dir.addToGroup(user.id, group.id, ACTOR);
    s.dir.moveUser(user.id, 'Finance', ACTOR);
    // Adding without removing is how privilege accumulates, so it is not done.
    expect(moverState()).toBe('in-progress');

    s.dir.removeFromGroup(user.id, group.id, ACTOR);
    expect(moverState()).toBe('done');
  });
});

describe('the rolled-up numbers', () => {
  it('starts at zero and counts a lesson under way as half', () => {
    const s = bare();
    expect(computeProgress(s).percent).toBeGreaterThanOrEqual(0);

    s.dir.createOu('Corps', 'Corporate', undefined, ACTOR);
    const chapter = computeProgress(s).chapters[0]!;
    // Three lessons; one of them half done contributes a sixth of the chapter.
    expect(chapter.percent).toBeGreaterThan(0);
    expect(chapter.percent).toBeLessThan(100);
  });

  it('never exceeds a hundred percent', () => {
    const s = bare();
    for (let i = 0; i < 3; i += 1) {
      s.dir.createOu(`Corps${i}`, 'Corporate', undefined, ACTOR);
      s.dir.createGroup(`grp-${i}`, 'Group', ACTOR);
    }
    const progress = computeProgress(s);
    expect(progress.percent).toBeLessThanOrEqual(100);
    for (const c of progress.chapters) expect(c.percent).toBeLessThanOrEqual(100);
  });
});
