/**
 * config/company.ts — shared fictional company constants used across all labs.
 * These are the single source of truth for company identity.
 */
export const COMPANY = {
  name: 'IAM Lab',
  domain: 'iamlab.com',
  tld: 'com',
  idpRealm: 'iamlab',
  idpUrl: 'https://idp.iamlab.com/realms/iamlab',
} as const;

export const OU_NAMES = ['Users', 'Groups', 'Computers', 'Servers', 'ServiceAccounts'] as const;

/**
 * Departments a user can belong to. Department decides which applications
 * appear on that user's desktop — see config/desktopProfiles.ts — so adding one
 * here means deciding what its people are given.
 */
export const DEPARTMENTS = [
  'IT',
  'Help Desk',
  'Security',
  'HR',
  'Finance',
  'Engineering',
  'Sales',
] as const;

/** All security groups used across labs. */
export const GROUP_NAMES = [
  'grp-hr-readers',
  'grp-finance-payroll',
  'grp-engineering-dev',
  'grp-helpdesk-tier1',
  'grp-iam-admins',
  'grp-sec-ops',
  'grp-domain-admins',
  'grp-server-admins',
  'grp-vpn-users',
  'grp-finance-analysts',
] as const;

/** Service account names used across labs. */
export const SERVICE_ACCOUNT_NAMES = ['svc-backup', 'svc-monitor', 'svc-idp-sync'] as const;

/** MFA required for these privileged roles. */
export const PRIVILEGED_ROLES = [
  'role-iam-admins',
  'role-domain-admins',
  'role-server-admins',
] as const;

/**
 * Domain the seeded applications live on.
 *
 * `.example` is reserved by the IETF for exactly this, so nothing here can
 * ever resolve to somebody's real site. Derived from COMPANY so the estate
 * cannot end up belonging to a company this project has renamed away from.
 */
export const APP_DOMAIN = `${COMPANY.domain.split('.')[0]}.example`;

/** Issuer the mock identity provider signs assertions with. */
export const IDP_ISSUER = `${COMPANY.domain.split('.')[0]}-idp`;
