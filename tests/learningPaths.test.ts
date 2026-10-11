import { describe, expect, it } from 'vitest';
import { MANUAL, lessonById } from '@/config/manual';
import { articleById } from '@/config/knowledgeBase';
import { appsForDepartment } from '@/config/desktopProfiles';

describe('career learning pathways', () => {
  it('provides five roadmap steps and eight bootcamp projects', () => {
    expect(MANUAL.find(c => c.id === 'career-roadmap')?.lessons).toHaveLength(5);
    expect(MANUAL.find(c => c.id === 'bootcamp')?.lessons).toHaveLength(8);
  });

  it('bundles the complete guides for offline reading', () => {
    for (const id of ['career-roadmap-guide', 'bootcamp-guide', 'lab-pathways-guide']) {
      expect(articleById(id)?.body.length).toBeGreaterThan(1000);
    }
  });

  it('every pathway launches existing lessons and available applications', () => {
    const chapters = MANUAL.filter(c => ['career-roadmap', 'bootcamp'].includes(c.id));
    expect(chapters).toHaveLength(2);
    const apps = new Set(appsForDepartment('IT'));
    for (const chapter of chapters) {
      for (const lesson of chapter.lessons) {
        expect(lesson.lessonLinks?.length).toBeGreaterThan(0);
        for (const id of lesson.lessonLinks ?? []) expect(lessonById(id), id).toBeDefined();
        for (const link of lesson.appLinks ?? []) expect(apps.has(link.app), link.app).toBe(true);
      }
    }
  });
});
