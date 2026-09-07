/**
 * tests/manual.test.ts — the manual has to be true.
 *
 * A course that tells you to run a cmdlet the shell does not implement is
 * worse than no course: the learner runs it, gets an error, and concludes
 * they are the problem. Same for an article link that goes nowhere and an
 * "open the application" button for an application that does not exist.
 *
 * So every cmdlet, every reading reference and every app id in the manual is
 * checked against the registry, the knowledge base and the desktop profile.
 * The manual cannot drift away from the workstation it describes.
 */
import { describe, it, expect } from 'vitest';
import { MANUAL, ALL_LESSONS } from '@/config/manual';
import { CAPABILITY_BY_CMDLET } from '@/services';
import { articleById } from '@/config/knowledgeBase';
import { appsForDepartment } from '@/config/desktopProfiles';

/** Cmdlets the shell provides that are not capabilities — the intrinsics. */
const SHELL_INTRINSICS = new Set(['Get-SignInLog', 'Get-Help', 'Get-Date', 'Clear-Host']);

function cmdletExists(name: string): boolean {
  return Boolean(CAPABILITY_BY_CMDLET[name.toLowerCase()]) || SHELL_INTRINSICS.has(name);
}

describe('manual integrity', () => {
  it('every cmdlet it tells you to run exists', () => {
    const missing: string[] = [];
    for (const lesson of ALL_LESSONS) {
      for (const step of lesson.steps) {
        if (step.cmdlet && !cmdletExists(step.cmdlet)) {
          missing.push(`${lesson.id}: ${step.cmdlet}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('every example starts with the cmdlet the step names', () => {
    // An example that drifts from its own step teaches the wrong invocation.
    const wrong: string[] = [];
    for (const lesson of ALL_LESSONS) {
      for (const step of lesson.steps) {
        if (step.example && step.cmdlet && !step.example.startsWith(step.cmdlet)) {
          wrong.push(`${lesson.id}: "${step.example}" is not a ${step.cmdlet} call`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('every article it sends you to exists', () => {
    const missing = ALL_LESSONS.filter((l) => l.reading && !articleById(l.reading)).map(
      (l) => `${l.id}: ${l.reading}`,
    );
    expect(missing).toEqual([]);
  });

  it('every application it offers to open is on an IT desktop', () => {
    // The manual is written for somebody administering identity. If it points
    // at an application even IT does not have, the button does nothing.
    const itApps = new Set(appsForDepartment('IT'));
    const missing = ALL_LESSONS.filter((l) => l.app && !itApps.has(l.app)).map(
      (l) => `${l.id}: ${l.app}`,
    );
    expect(missing).toEqual([]);
  });

  it('lesson ids are unique, because progress is stored against them', () => {
    const ids = ALL_LESSONS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every lesson states how to verify it worked', () => {
    // The habit being taught is "prove it", so a lesson without a check is a
    // lesson teaching the opposite.
    const thin = ALL_LESSONS.filter((l) => l.verify.trim().length < 40).map((l) => l.id);
    expect(thin).toEqual([]);
  });

  it('every lesson carries the interview question it prepares you for', () => {
    const thin = ALL_LESSONS.filter((l) => l.interview.trim().length < 40).map((l) => l.id);
    expect(thin).toEqual([]);
  });

  it('the chapters run in the order the environment can support', () => {
    // You cannot onboard before there is an OU, or practise a lockout before
    // there is an account. The manual follows the same chronology the ticket
    // generator uses, so working it top to bottom builds the domain the
    // tickets then ask about.
    expect(MANUAL.map((c) => c.id)).toEqual([
      'directory',
      'lifecycle',
      'privileged',
      'cloud',
      // Review, recovery and evidence come last because they are about work
      // already done: you cannot certify access you have not granted, and an
      // evidence pack of an empty domain proves nothing.
      'operations',
    ]);
  });
});
