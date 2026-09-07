/**
 * tests/interviewDrill.test.ts — the drill has to ask a question, not give it away.
 *
 * Each lesson's `interview` field is written as `"The question?" What a good
 * answer contains.` The drill splits it and shows only the first half until
 * the learner commits. If a field stopped matching that shape the split would
 * fail — and the failure mode is not a crash, it is a drill that shows the
 * answer as the question, which nobody would notice from a screenshot.
 *
 * So the parse is asserted across every lesson rather than assumed, and the
 * separation is asserted directly: no question may contain its own answer.
 */
import { describe, it, expect } from 'vitest';
import { MANUAL } from '@/config/manual';
import {
  allQuestions,
  questionsFor,
  shuffle,
  splitInterview,
  summarise,
} from '@/vm/interviewDrill';
import type { DrillAnswer } from '@/vm/interviewDrill';

describe('splitting an interview field', () => {
  it('separates the question from the model answer', () => {
    const split = splitInterview('"What are OUs for?" Delegation and Group Policy.');
    expect(split).toEqual({
      question: 'What are OUs for?',
      modelAnswer: 'Delegation and Group Policy.',
    });
  });

  it('handles curly quotes as well as straight ones', () => {
    expect(splitInterview('“Why?” Because.')?.question).toBe('Why?');
  });

  it('refuses a field with no quoted question', () => {
    // Better to drop the question than to show the answer as the question.
    expect(splitInterview('Delegation and Group Policy.')).toBeNull();
  });

  it('refuses a field with a question and no answer', () => {
    expect(splitInterview('"What are OUs for?"')).toBeNull();
  });
});

describe('the question bank', () => {
  it('has a question for every lesson in the manual', () => {
    // A lesson whose field stopped parsing would silently vanish from the
    // drill, and the count is the only thing that would show it.
    const lessons = MANUAL.flatMap((c) => c.lessons);
    expect(allQuestions()).toHaveLength(lessons.length);
  });

  it('never leaks the answer into the question', () => {
    for (const q of allQuestions()) {
      expect(q.question, q.lessonId).not.toContain(q.modelAnswer);
      // A question is a question. If the split drifted, this is where a
      // paragraph of model answer would show up.
      expect(q.question.length, q.lessonId).toBeLessThan(120);
      expect(q.modelAnswer.length, q.lessonId).toBeGreaterThan(20);
    }
  });

  it('carries the lesson it came from, so a weak answer points somewhere', () => {
    for (const q of allQuestions()) {
      expect(q.lessonTitle.length).toBeGreaterThan(0);
      expect(q.chapterTitle.length).toBeGreaterThan(0);
    }
  });

  it('filters to one chapter', () => {
    const first = MANUAL[0]!;
    const scoped = questionsFor(first.id);
    expect(scoped).toHaveLength(first.lessons.length);
    expect(scoped.every((q) => q.chapterId === first.id)).toBe(true);
  });
});

describe('shuffling', () => {
  it('keeps every question exactly once', () => {
    const all = allQuestions();
    const mixed = shuffle(all, () => 0.42);
    expect(mixed).toHaveLength(all.length);
    expect(new Set(mixed.map((q) => q.lessonId)).size).toBe(all.length);
  });

  it('does not mutate the input', () => {
    const all = allQuestions();
    const firstBefore = all[0]!.lessonId;
    shuffle(all, () => 0.9);
    expect(all[0]!.lessonId).toBe(firstBefore);
  });
});

describe('the summary', () => {
  const answer = (recall: DrillAnswer['recall'], seconds: number, prompted = false): DrillAnswer => ({
    lessonId: `l-${recall}-${seconds}`,
    text: 'something',
    seconds,
    prompted,
    recall,
  });

  it('counts each rating and the mean time', () => {
    const s = summarise([answer('solid', 30), answer('partial', 60), answer('missed', 90)], 5);
    expect(s).toMatchObject({
      answered: 3,
      total: 5,
      solid: 1,
      partial: 1,
      missed: 1,
      seconds: 180,
      meanSeconds: 60,
    });
  });

  it('counts answers given before the model answer was revealed', () => {
    // The number that means anything. An answer typed with the model answer
    // on screen is not evidence of recall.
    const s = summarise([answer('solid', 10), answer('solid', 10, true)], 2);
    expect(s.unprompted).toBe(1);
  });

  it('reports zero rather than dividing by nothing', () => {
    expect(summarise([], 15).meanSeconds).toBe(0);
  });
});
