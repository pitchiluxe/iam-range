/**
 * config/careerLabs.ts — the four-year OMARI Technologies career labs.
 *
 * Each year is a complete Lab with objectives, steps, evidence and debrief
 * questions. The simulated workstation and the real-VM package in omari-lab/
 * both draw from this registry.
 */
import type { Lab, LabId, LabObjective, LabStep, ScoreCategory, ScorePoints } from '@/domain';
import { CAREER_YEARS } from './careerLab';

const CATEGORIES: ScoreCategory[] = ['exec', 'troubleshoot', 'least-privilege', 'docs', 'evidence', 'comms'];

const ZONE = 'IT';

function stepFor(yearId: string, index: number, phaseId: string, title: string, brief: string): LabStep {
  const category = CATEGORIES[index % CATEGORIES.length]!;
  const points: ScorePoints = { [category]: 10 * ((index % 3) + 1) } as ScorePoints;
  return {
    id: `${yearId}-${phaseId}-step`,
    title,
    brief,
    validator: { kind: 'evidence-collected', params: { phase: phaseId } },
    evidence: [{ kind: 'log-excerpt', capture: 'auto' }],
    tutorPrompts: [],
    hintIds: [],
    points,
  };
}

function objectiveFor(index: number, description: string): LabObjective {
  return {
    id: `objective-${index}`,
    description,
    points: 10 * ((index % 3) + 1),
    category: CATEGORIES[index % CATEGORIES.length]!,
  };
}

export const CAREER_LABS: readonly Lab[] = CAREER_YEARS.map((year, yearIndex) => {
  const steps: LabStep[] = year.phases.map((phase, i) =>
    stepFor(year.id, i, phase.id, phase.title, phase.summary),
  );
  const objectives: LabObjective[] = year.phases.map((phase, i) =>
    objectiveFor(i, `Demonstrate the skills in ${phase.title}: ${phase.skills.join(', ')}.`),
  );
  const debriefQuestions: string[] = year.phases.map(
    (phase) => `For ${phase.title}: what was the most important risk you identified, and how did you prove it?`,
  );
  return {
    id: `${year.id}` as LabId,
    number: year.number,
    title: year.title,
    brief: year.summary,
    durationMinutes: 120,
    zoneIds: [ZONE],
    startingZone: ZONE,
    startingSeed: yearIndex === 0 ? 'baseline' : `after-year-${year.number - 1}`,
    objectives,
    steps,
    faults: [],
    debriefQuestions,
  } as Lab;
});
