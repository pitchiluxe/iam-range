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
    // The built-in credential, changed at first sign-in.
    password: '123!',
    // No groups: a fresh domain has none, and the administrator's rights come
    // from being the built-in account rather than from membership.
    groups: [],
    privileged: true,
  },
];

/** Resolve username → email using the company domain. */
export function seedEmail(u: SeedUser): string {
  // Real directories rarely derive the address from the logon name — the
  // administrator signs in as erickomari and receives mail as eomari.
  return u.email ?? `${u.username}@${COMPANY.domain}`;
}
