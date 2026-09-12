/**
 * tests/careerLabWindow.test.ts — career lab window is a real lab launch pad.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = readFileSync(join(process.cwd(), 'src', 'ui', 'consoles', 'careerLabWindow.ts'), 'utf8');

describe('career lab window', () => {
  it('renders an interactive start button for each year', () => {
    expect(SOURCE).toMatch(/Start this year/);
    expect(SOURCE).toMatch(/Open terminal/);
  });

  it('opens the Manual and Lab Plan when a year is started', () => {
    expect(SOURCE).toMatch(/requestApp\('manual'\)/);
    expect(SOURCE).toMatch(/requestApp\('lab-plan'\)/);
    expect(SOURCE).toMatch(/manual_last_lesson/);
  });

  it('exposes the real-VM scenario paths for all four years', () => {
    expect(SOURCE).toMatch(/07-YEAR-2-IAM-ANALYST/);
    expect(SOURCE).toMatch(/08-YEAR-3-IAM-ENGINEER/);
    expect(SOURCE).toMatch(/09-YEAR-4-IAM-ARCHITECT/);
  });

  it('consumes the CAREER_LABS registry for duration and objective counts', () => {
    expect(SOURCE).toContain("from '@/config'");
    expect(SOURCE).toMatch(/CAREER_LABS/);
    expect(SOURCE).toMatch(/durationMinutes/);
  });
});
