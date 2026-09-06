/**
 * config/credentials.ts — the canonical set of fictional users shared across all labs.
 * Each user is fictional. Passwords are always '<username>123' for demo purposes.
 *
 * Labs 02-10 mutate post-Lab-01 state; these objects are the immutable seed source.
 */
import { COMPANY } from './company';

export interface SeedUser {
  /** Used as the login username */
  username: string;
  displayName: string;
  department: string;
  title: string;
  manager?: string; // username of manager
  mfa: 'none' | 'totp';
  /** Password for mock IdP sign-in; always '<username>123' */
  password: string;
  groups: string[]; // group name strings, resolved to IDs at seed time
  privileged?: boolean; // domain-admin / iam-admin / etc.
}

export const SEED_USERS: SeedUser[] = [
  {
    username: 'alex.morgan',
    displayName: 'Alex Morgan',
    department: 'Finance',
    title: 'Payroll Analyst',
    mfa: 'none',
    password: 'alex.morgan123',
    groups: ['grp-finance-payroll'],
  },
  {
    username: 'bob.sato',
    displayName: 'Bob Sato',
    department: 'Engineering',
    title: 'Software Developer',
    mfa: 'none',
    password: 'bob.sato123',
    groups: ['grp-engineering-dev'],
  },
  {
    username: 'cara.patel',
    displayName: 'Cara Patel',
    department: 'HR',
    title: 'HR Business Partner',
    mfa: 'none',
    password: 'cara.patel123',
    groups: ['grp-hr-readers'],
  },
  {
    username: 'dan.rivera',
    displayName: 'Dan Rivera',
    department: 'IT',
    title: 'Help Desk Tier 1',
    manager: 'ivy.park',
    mfa: 'totp',
    password: 'dan.rivera123',
    groups: ['grp-helpdesk-tier1'],
  },
  {
    username: 'erin.cho',
    displayName: 'Erin Cho',
    department: 'IT',
    title: 'IAM Administrator',
    mfa: 'none', // Lab 05 enrolls MFA
    password: 'erin.cho123',
    groups: ['grp-iam-admins'],
    privileged: true,
  },
  {
    username: 'finn.muller',
    displayName: 'Finn Müller',
    department: 'Security',
    title: 'Security Operations Analyst',
    mfa: 'totp',
    password: 'finn.muller123',
    groups: ['grp-sec-ops'],
    privileged: true,
  },
  {
    username: 'greta.olsen',
    displayName: 'Greta Olsen',
    department: 'Finance',
    title: 'Chief Financial Officer',
    mfa: 'none',
    password: 'greta.olsen123',
    groups: ['grp-finance-payroll'],
  },
  {
    username: 'hank.oneill',
    displayName: "Hank O'Neill",
    department: 'IT',
    title: 'Server Administrator',
    mfa: 'totp',
    password: 'hank.oneill123',
    groups: ['grp-server-admins', 'grp-domain-admins'],
    privileged: true,
  },
  {
    username: 'ivy.park',
    displayName: 'Ivy Park',
    department: 'IT',
    title: 'Help Desk Manager',
    mfa: 'totp',
    password: 'ivy.park123',
    groups: ['grp-helpdesk-tier1', 'grp-iam-admins'],
    privileged: true,
  },
  {
    username: 'jane.doe',
    displayName: 'Jane Doe',
    department: 'Finance',
    title: 'Junior Financial Analyst',
    mfa: 'none',
    password: 'jane.doe123',
    groups: ['grp-finance-analysts'],
  },
];

export const SEED_ADMINS: SeedUser[] = [
  {
    username: 'admin',
    displayName: 'IAM Admin',
    department: 'IT',
    title: 'IAM Administrator',
    mfa: 'totp',
    password: 'admin123',
    groups: ['grp-iam-admins', 'grp-domain-admins'],
    privileged: true,
  },
];

/** Resolve username → email using the company domain. */
export function seedEmail(u: SeedUser): string {
  return `${u.username}@${COMPANY.domain}`;
}
