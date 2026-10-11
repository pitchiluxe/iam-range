import { MANUAL, type Chapter } from './manual';

/** Dedicated desktop courses expose only their own chapter. */
export function manualChapters(startLessonId?: string): readonly Chapter[] {
  if (!startLessonId) return MANUAL;
  const course = MANUAL.find(chapter =>
    ['bootcamp', 'career-roadmap'].includes(chapter.id)
    && chapter.lessons.some(lesson => lesson.id === startLessonId));
  return course ? [course] : MANUAL;
}
