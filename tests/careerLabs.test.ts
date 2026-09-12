/**
 * tests/careerLabs.test.ts — the career-lab registry is complete and unique.
 */
import { describe, it, expect } from 'vitest';
import { CAREER_LABS } from '@/config';

describe('career lab registry', () => {
  it('has one lab for each of the four years', () => {
    expect(CAREER_LABS).toHaveLength(4);
  });

  it('has unique lab ids', () => {
    const ids = CAREER_LABS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every lab has at least one step and one objective', () => {
    for (const lab of CAREER_LABS) {
      expect(lab.steps.length, lab.id).toBeGreaterThan(0);
      expect(lab.objectives.length, lab.id).toBeGreaterThan(0);
      expect(lab.debriefQuestions.length, lab.id).toBeGreaterThan(0);
    }
  });

  it('lab numbers are 1 through 4 in order', () => {
    expect(CAREER_LABS.map((l) => l.number)).toEqual([1, 2, 3, 4]);
  });
});
