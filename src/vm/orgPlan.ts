/**
 * vm/orgPlan.ts — the organisation the ticket queue builds, one ticket at a time.
 *
 * The first tickets lay the foundation (the OU tree, the group model, the
 * first starters). This plan is what comes after: a department OU for every
 * team, a job-role group for every job, and a hiring wave per department, so
 * the domain grows into a company of forty-odd people with real roles rather
 * than stopping at six accounts.
 *
 * Shared by the generator, which raises the tickets, and the reviewer, which
 * grades them, so the two can never disagree about who was meant to be hired
 * or which group a job belongs in.
 */
import { DEPARTMENTS } from '@/config';

export type Department = (typeof DEPARTMENTS)[number];

export interface JobRole {
  group: string;
  title: string;
  department: Department;
  /** Leads and managers: one per wave. */
  lead: boolean;
}

export interface Hire {
  logon: string;
  first: string;
  last: string;
  role: JobRole;
}

/** Two jobs per department: the people who do the work, and the one who leads it. */
export const JOB_ROLES: readonly JobRole[] = [
  { group: 'role-it-sysadmin', title: 'Systems Administrator', department: 'IT', lead: false },
  { group: 'role-it-manager', title: 'IT Manager', department: 'IT', lead: true },
  { group: 'role-helpdesk-analyst', title: 'Service Desk Analyst', department: 'Help Desk', lead: false },
  { group: 'role-helpdesk-lead', title: 'Service Desk Lead', department: 'Help Desk', lead: true },
  { group: 'role-security-analyst', title: 'Security Analyst', department: 'Security', lead: false },
  { group: 'role-security-manager', title: 'Security Manager', department: 'Security', lead: true },
  { group: 'role-hr-partner', title: 'HR Business Partner', department: 'HR', lead: false },
  { group: 'role-hr-manager', title: 'HR Manager', department: 'HR', lead: true },
  { group: 'role-finance-analyst', title: 'Financial Analyst', department: 'Finance', lead: false },
  { group: 'role-finance-controller', title: 'Financial Controller', department: 'Finance', lead: true },
  { group: 'role-eng-developer', title: 'Software Engineer', department: 'Engineering', lead: false },
  { group: 'role-eng-lead', title: 'Engineering Lead', department: 'Engineering', lead: true },
  { group: 'role-sales-exec', title: 'Account Executive', department: 'Sales', lead: false },
  { group: 'role-sales-manager', title: 'Sales Manager', department: 'Sales', lead: true },
];

/** Fictional names; five per department (one lead, four staff). */
const NAMES: Record<Department, [string, string][]> = {
  IT: [['Grace', 'Hopper'], ['Omar', 'Farouk'], ['Lena', 'Novak'], ['Tariq', 'Bello'], ['Mei', 'Tanaka']],
  'Help Desk': [['Sam', 'Rivera'], ['Ivy', 'Mensah'], ['Noah', 'Brandt'], ['Zara', 'Quinn'], ['Eli', 'Moreau']],
  Security: [['Hana', 'Kovacs'], ['Dev', 'Anand'], ['Rosa', 'Lindqvist'], ['Kwame', 'Asante'], ['Yuki', 'Sato']],
  HR: [['Clara', 'Jensen'], ['Amir', 'Rahimi'], ['Beth', 'Coleman'], ['Jonas', 'Weber'], ['Ines', 'Duarte']],
  Finance: [['Victor', 'Hale'], ['Priya', 'Raman'], ['Lucas', 'Ferreira'], ['Anna', 'Berg'], ['Tomas', 'Kral']],
  Engineering: [['Iris', 'Chandra'], ['Felix', 'Wagner'], ['Nia', 'Owusu'], ['Oscar', 'Lund'], ['Sofia', 'Marin']],
  Sales: [['Marco', 'Rossi'], ['Leah', 'Goldberg'], ['Ken', 'Ito'], ['Ada', 'Nwosu'], ['Pablo', 'Ortega']],
};

export function slug(department: Department): string {
  return department.toLowerCase().replace(/[^a-z]/g, '');
}

function rolesOf(department: Department): { lead: JobRole; staff: JobRole } {
  const roles = JOB_ROLES.filter((r) => r.department === department);
  return { lead: roles.find((r) => r.lead)!, staff: roles.find((r) => !r.lead)! };
}

/** Who joins each department. The first person listed leads it. */
export function hiringWave(department: Department): Hire[] {
  const { lead, staff } = rolesOf(department);
  return NAMES[department].map(([first, last], i) => ({
    logon: `${first[0]}${last}`.toLowerCase(),
    first,
    last,
    role: i === 0 ? lead : staff,
  }));
}

export const HIRE_PREFIX = 'hire-';
export const DEPARTMENT_OUS_ID = 'org-department-ous';
export const ROLE_GROUPS_ID = 'org-role-groups';

/** The hiring wave a scenario id refers to, if it is one. */
export function waveFor(scenarioId: string | undefined): { department: Department; hires: Hire[] } | null {
  if (!scenarioId?.startsWith(HIRE_PREFIX)) return null;
  const department = DEPARTMENTS.find((d) => `${HIRE_PREFIX}${slug(d)}` === scenarioId);
  return department ? { department, hires: hiringWave(department) } : null;
}

/** Every account the plan hires, across all departments. */
export function allPlannedHires(): Hire[] {
  return DEPARTMENTS.flatMap((d) => hiringWave(d));
}
