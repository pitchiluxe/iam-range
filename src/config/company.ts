/**
 * config/company.ts — shared fictional company constants used across all labs.
 * These are the single source of truth for company identity.
 */
export const COMPANY = {
  name: 'Northwind Labs',
  domain: 'northwind.example',
  tld: 'example',
  idpRealm: 'northwind',
  idpUrl: 'https://idp.northwind.example/realms/northwind',
} as const;

export const OU_NAMES = ['Users', 'Groups', 'Computers', 'Servers', 'ServiceAccounts'] as const;

export const DEPARTMENTS = ['HR', 'Finance', 'Engineering', 'IT', 'Security'] as const;

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
