import { describe, expect, it } from 'vitest';
import { appsForDepartment } from '@/config/desktopProfiles';
import { DEPARTMENTS } from '@/config/company';

describe('remote desktop feature consistency', () => {
  it.each([...DEPARTMENTS, 'Unknown'])('keeps learning and desktop tools available to %s', (department) => {
    const apps = appsForDepartment(department);
    for (const id of ['tutor', 'manual', 'bootcamp-12', 'career-roadmap', 'ad-lab', 'challenge-90', 'documentation', 'sticky-notes', 'settings', 'explorer', 'notepad', 'script-editor', 'browser']) {
      expect(apps).toContain(id);
    }
    expect(new Set(apps).size).toBe(apps.length);
  });
  it('preserves department permissions for identity administration', () => {
    expect(appsForDepartment('Finance')).not.toContain('active-directory');
    expect(appsForDepartment('IT')).toContain('active-directory');
  });
});
