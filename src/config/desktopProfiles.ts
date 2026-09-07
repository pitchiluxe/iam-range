/**
 * config/desktopProfiles.ts — which applications each department is given.
 *
 * A real estate of workstations is not uniform. Help Desk has the directory
 * tools; Finance does not. That difference is the point: when a ticket says a
 * user cannot reach something, "what does their desktop actually have" is a
 * real diagnostic step, and signing in as them to look is how you answer it.
 *
 * Adding a department in config/company.ts means deciding here what its people
 * are given — the exhaustive `Record` below makes that a compile error rather
 * than a silent default.
 */
import type { DEPARTMENTS } from './company';

export type Department = (typeof DEPARTMENTS)[number];

/** Applications everyone gets, whatever they do. */
const BASELINE_APPS = [
  // The tutor and the reference are on every desktop, including Finance's.
  // Learning is not a departmental entitlement.
  'tutor',
  'manual',
  // The plan view of the manual. On every desktop for the same reason the
  // manual is: knowing where you are in the course is not a departmental
  // entitlement.
  'lab-plan',
  // Rehearsing the answers is part of the course, not a departmental perk.
  'interview',
  'documentation',
  'explorer',
  'notepad',
  'writer',
  'calculator',
  'sticky-notes',
  'browser',
  'app-portal',
  'settings',
  'control-panel',
  'recycle-bin',
] as const;

/** Identity administration — the tools that change other people's access. */
const IDENTITY_ADMIN_APPS = [
  // Certification belongs to whoever administers access, because the campaign
  // is about the access they granted.
  'access-reviews',
  'active-directory',
  'terminal',
  'script-editor',
  // The tenants in front of the domain. Whoever administers accounts on
  // premises administers their cloud copies too.
  'cloud-identity',
] as const;

/** Ticket handling and investigation. */
const SERVICE_DESK_APPS = ['ticket-console', 'log-search'] as const;
// Reading the audit log is an investigation skill, so it sits with the
// investigation tools rather than on a Finance desktop.
const SECURITY_APPS = ['secops-dashboard', 'log-search'] as const;

/**
 * Extra applications per department, on top of BASELINE_APPS.
 *
 * Help Desk gets the directory but not the SecOps dashboard: resetting a
 * password is their job, hunting incidents is not.
 */
const EXTRA_BY_DEPARTMENT: Record<Department, readonly string[]> = {
  IT: [...IDENTITY_ADMIN_APPS, ...SERVICE_DESK_APPS, ...SECURITY_APPS],
  'Help Desk': [...IDENTITY_ADMIN_APPS, ...SERVICE_DESK_APPS],
  Security: [...SECURITY_APPS, ...SERVICE_DESK_APPS, 'terminal'],
  Engineering: ['terminal'],
  HR: [],
  Finance: [],
  Sales: [],
};

/** Departments whose members administer identity. */
export function isIdentityAdmin(department: string): boolean {
  const extras = EXTRA_BY_DEPARTMENT[department as Department] ?? [];
  return extras.includes('active-directory');
}

/**
 * The application ids this department's desktop should show.
 *
 * An unknown department gets the baseline only — a new department should not
 * silently inherit administrative tooling.
 */
export function appsForDepartment(department: string): string[] {
  const extras = EXTRA_BY_DEPARTMENT[department as Department] ?? [];
  return [...BASELINE_APPS, ...extras];
}

/** One-line description of what a department's desktop is for, shown in
 *  Settings so a learner can see why their icons differ. */
export const PROFILE_SUMMARY: Record<Department, string> = {
  IT: 'Full identity administration, service desk and security tooling.',
  'Help Desk': 'Directory and ticket tools for day-to-day account support.',
  Security: 'Investigation and incident tooling, with shell access.',
  Engineering: 'Standard desktop plus a shell.',
  HR: 'Standard corporate desktop.',
  Finance: 'Standard corporate desktop.',
  Sales: 'Standard corporate desktop.',
};
