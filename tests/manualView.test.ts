import { describe, expect, it } from 'vitest';
import { manualChapters } from '@/config/manualView';
import { MANUAL } from '@/config/manual';

describe('dedicated desktop courses', () => {
  it('keeps all eight bootcamp projects together without other courses', () => {
    const chapters = manualChapters('bootcamp-project-1');
    expect(chapters.map(chapter => chapter.id)).toEqual(['bootcamp']);
    const lessons = chapters.flatMap(chapter => chapter.lessons);
    expect(lessons).toHaveLength(8);
    expect(lessons.every(lesson => lesson.id.startsWith('bootcamp-project-'))).toBe(true);
    expect(lessons.at(-1)?.id).toBe('bootcamp-project-8');
  });

  it('keeps all five roadmap steps together without bootcamp projects', () => {
    const chapters = manualChapters('roadmap-step-1');
    expect(chapters.map(chapter => chapter.id)).toEqual(['career-roadmap']);
    const lessons = chapters.flatMap(chapter => chapter.lessons);
    expect(lessons).toHaveLength(5);
    expect(lessons.every(lesson => lesson.id.startsWith('roadmap-step-'))).toBe(true);
    expect(lessons.at(-1)?.id).toBe('roadmap-step-5');
  });

  it('preserves the complete manual and tolerates unknown starting lessons', () => {
    expect(manualChapters()).toBe(MANUAL);
    expect(manualChapters('unknown')).toBe(MANUAL);
  });
});
