/**
 * tests/manualExamples.test.ts — every command the manual tells you to copy runs.
 *
 * A step used to show only a cmdlet name when it had no example, so "Copy"
 * gave the learner a bare `New-ADGroup` that fails the moment it is pasted.
 * Now every step carries a full example, and each one is run through the
 * terminal: it may fail on the lab's state (the account does not exist yet),
 * but never on its own syntax.
 */
import { describe, it, expect } from 'vitest';
import { ALL_LESSONS } from '@/config/manual';
import { VmSession } from '@/vm/session';
import { dispatch, createShellState } from '@/terminal/dispatcher';
import type { CapabilityContext } from '@/services';

/** Errors that mean the command itself is wrong, whatever state the lab is in. */
const SYNTAX_ERRORS = [
  /is not recognized as the name of a cmdlet/i,
  /missing required parameter/i,
  /missing mandatory parameters/i,
  /Cannot bind parameter/i,
  /Error parsing query/i,
  /The pipeline does not support/i,
];

const steps = ALL_LESSONS.flatMap((l) => l.steps.map((s) => ({ lesson: l.title, ...s })));

describe('manual examples', () => {
  it('every step that names a cmdlet gives a full example to copy', () => {
    const bare = steps.filter((s) => s.cmdlet && !s.example).map((s) => `${s.lesson}: ${s.do}`);
    expect(bare).toEqual([]);
  });

  it('every example runs without a syntax error', () => {
    const s = new VmSession(null);
    const ctx = { dir: s.dir, idp: s.idp, tickets: s.tickets, audit: s.audit, pim: s.pim, cloud: s.cloud, endpoints: s.endpoints, actor: s.dir.getUserByUsername('admin')!.id } as CapabilityContext;
    const shell = createShellState();
    const broken: string[] = [];
    for (const step of steps) {
      if (!step.example) continue;
      const out = dispatch(step.example, ctx, shell).output;
      // "Try it without a justification, and read the refusal": that refusal is the lesson.
      if (/read the refusal/i.test(step.do)) continue;
      const hit = SYNTAX_ERRORS.find((re) => re.test(out));
      if (hit) broken.push(`${step.lesson} → ${step.example}\n    ${out.split('\n')[0]}`);
    }
    expect(broken).toEqual([]);
  });
});
