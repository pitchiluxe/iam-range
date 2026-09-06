/**
 * config/index.ts — public re-exports.
 *
 * The lab's scoring rubric is absent: this app has no scored steps.
 */
export {
  COMPANY,
  OU_NAMES,
  DEPARTMENTS,
  GROUP_NAMES,
  SERVICE_ACCOUNT_NAMES,
  PRIVILEGED_ROLES,
} from './company';
export { SEED_USERS, SEED_ADMINS, seedEmail } from './credentials';
export type { SeedUser } from './credentials';
