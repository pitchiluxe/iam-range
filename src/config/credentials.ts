/**
 * config/credentials.ts — the accounts a fresh install ships with.
 *
 * Which is one: the built-in administrator. Every other account in the
 * directory got there because someone provisioned it, and its password is
 * whatever they set. The old '<username>123' convention described a seeded
 * population that no longer exists, and the login screen used to repeat that
 * promise to people it was no longer true for.
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
  /** Password for mock IdP sign-in. */
  password: string;
  /** Overrides the derived address when it differs from the logon name. */
  email?: string;
  groups: string[]; // group name strings, resolved to IDs at seed time
  privileged?: boolean; // domain-admin / iam-admin / etc.
}

/**
 * Staff accounts seeded at boot.
 *
 * Deliberately empty. The directory starts with the administrator and nothing
 * else, because populating it IS the work: every user in Active Directory got
 * there because someone provisioned them, and the account they can then sign in
 * with is the one that provisioning created.
 */
export const SEED_USERS: SeedUser[] = [];

/**
 * The built-in administrator — the only account that exists on a fresh
 * install, and the one used to create everyone else.
 */
export const SEED_ADMINS: SeedUser[] = [
  {
    username: 'admin',
    displayName: 'Administrator',
    department: 'IT',
    title: 'Domain Administrator',
    mfa: 'none',
    // The built-in credential. Shaped like a real default — upper, lower,
    // digits, symbol — so the first thing a learner types is a password that
    // would actually pass a domain policy, and changing it in Settings is a
    // meaningful exercise rather than a formality.
    password: 'Password123!',
    // No groups: a fresh domain has none, and the administrator's rights come
    // from being the built-in account rather than from membership.
    groups: [],
    privileged: true,
  },
];

/** Resolve username → email using the company domain. */
export function seedEmail(u: SeedUser): string {
  // Real directories rarely derive the address from the logon name, which is
  // why the override exists: someone can sign in as one string and receive
  // mail at another.
  return u.email ?? `${u.username}@${COMPANY.domain}`;
}
