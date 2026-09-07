/**
 * seed/baseline.ts — the canonical baseline seed applied to a fresh service set.
 * All labs (except Lab 01) start from this state.
 *
 * Creating users, groups, roles, and applications here means later labs can
 * mutate the world (move Bob, disable Jane, etc.) without breaking this baseline.
 */
import {
  COMPANY,
  GROUP_NAMES,
  SERVICE_ACCOUNT_NAMES,
  SEED_USERS,
  SEED_ADMINS,
  seedEmail,
} from '@/config';
import { mkRoleId, mkAppId } from '@/domain';
import type { Application, MfaMethod, RoleId, GroupId, AppId, UserId } from '@/domain';
import type { MockDirectory } from '@/services';
import type { MockIdP } from '@/services';
import type { MockAppServer } from '@/services';

export interface SeedResult {
  userIds: Record<string, UserId>; // username → UserId
  groupIds: Record<string, GroupId>; // group name → GroupId
  roleIds: Record<string, RoleId>; // role name → RoleId
  appIds: Record<string, AppId>; // app name → AppId
}

/**
 * Build the environment.
 *
 * `structure: false` — the default — leaves the domain bare: the built-in
 * administrator, the service accounts, and the federated applications the
 * organisation already subscribes to. No OUs, no groups, no staff. Creating
 * those is the administrator's job, and a lab that pre-builds them teaches
 * nothing about building them.
 *
 * `structure: true` restores the fully populated fixture, which the tests use.
 */
export function applyBaseline(
  dir: MockDirectory,
  idp: MockIdP,
  apps: MockAppServer,
  options: { structure?: boolean } = {},
): SeedResult {
  const withStructure = options.structure ?? false;
  const groupIds: Record<string, GroupId> = {};
  const roleIds: Record<string, RoleId> = {};
  const userIds: Record<string, UserId> = {};
  const appIds: Record<string, AppId> = {};

  // --- Groups ---
  // Security groups exist only in the populated fixture.
  //
  // Braced deliberately. This was a bare `if (withStructure)` followed by a
  // blank line and then the loop, which works -- the loop is the consequent --
  // and reads as though the guard applies to nothing. Anyone adding a line
  // above the loop would silently move it out of the fixture and seed groups
  // into the bare domain the first tickets ask the learner to build.
  if (withStructure) {
    for (const name of GROUP_NAMES) {
      const g = dir.createGroup(name, `Security group ${name}`, 'system' as UserId);
      groupIds[name] = g.id;
    }
  }

  // --- Apps (register with directory for role lookup; full app records on AppServer) ---
  const appHr: Application = {
    id: mkAppId('app-hr-portal'),
    name: 'HR Portal',
    protocol: 'OIDC',
    redirectUri: 'https://hr.${APP_DOMAIN}/callback',
    clientId: 'hr-portal',
    issuer: COMPANY.idpUrl,
    requiredRoleIds: [mkRoleId('grp-hr-readers')],
    mfaRequired: false,
    status: 'configured',
  };
  const appFinance: Application = {
    id: mkAppId('app-finance'),
    name: 'Finance Portal',
    protocol: 'SAML',
    redirectUri: 'https://finance.${APP_DOMAIN}/callback',
    clientId: 'finance-portal',
    entityId: 'urn:finance.${APP_DOMAIN}',
    requiredRoleIds: [mkRoleId('role-finance-payroll-writer')],
    mfaRequired: false,
    status: 'configured',
  };
  const appHelpDesk: Application = {
    id: mkAppId('app-helpdesk-portal'),
    name: 'Help Desk Portal',
    protocol: 'OIDC',
    redirectUri: 'https://helpdesk.${APP_DOMAIN}/callback',
    clientId: 'helpdesk-portal',
    issuer: COMPANY.idpUrl,
    requiredRoleIds: [mkRoleId('grp-helpdesk-tier1')],
    mfaRequired: false,
    status: 'configured',
  };
  const appVpn: Application = {
    id: mkAppId('app-vpn-portal'),
    name: 'VPN Portal',
    protocol: 'OIDC',
    redirectUri: 'https://vpn.${APP_DOMAIN}/callback',
    clientId: 'vpn-portal',
    issuer: COMPANY.idpUrl,
    requiredRoleIds: [mkRoleId('role-vpn-users')],
    mfaRequired: false,
    status: 'configured',
  };
  const appAdmin: Application = {
    id: mkAppId('app-admin-console'),
    name: 'Admin Console',
    protocol: 'OIDC',
    redirectUri: 'https://admin.${APP_DOMAIN}/callback',
    clientId: 'admin-console',
    issuer: COMPANY.idpUrl,
    requiredRoleIds: [mkRoleId('grp-iam-admins')],
    mfaRequired: true,
    status: 'configured',
  };
  apps.registerApp(appHr);
  apps.registerApp(appFinance);
  apps.registerApp(appHelpDesk);
  apps.registerApp(appVpn);
  apps.registerApp(appAdmin);
  dir.registerApp(appAdmin);
  appIds[appHr.name] = appHr.id;
  appIds[appFinance.name] = appFinance.id;
  appIds[appHelpDesk.name] = appHelpDesk.id;
  appIds[appVpn.name] = appVpn.id;
  appIds[appAdmin.name] = appAdmin.id;

  // --- Roles ---
  for (const [name, gid] of Object.entries(groupIds)) {
    const r = dir.createRole(
      name, // role name = group name (so group membership is the role grant)
      `Role granted via group ${name}`,
      [`${name}:access`],
      undefined,
      'system' as UserId,
    );
    roleIds[name] = r.id;
    // Wire role as the group owner so group membership grants the role
    const g = dir.getGroup(gid);
    if (g) g.ownerRoleId = r.id;
  }
  // Privileged roles
  // Built-in privileged roles come with the populated fixture. A bare domain
  // has none: the administrator defines the role model as part of the work.
  if (withStructure) {
    const iamAdminRole = dir.createRole(
      'role-iam-admins',
      'IAM Administrators',
      ['iam:*'],
      undefined,
      'system' as UserId,
    );
    const domainAdminRole = dir.createRole(
      'role-domain-admins',
      'Domain Administrators',
      ['domain:*'],
      undefined,
      'system' as UserId,
    );
    const serverAdminRole = dir.createRole(
      'role-server-admins',
      'Server Administrators',
      ['server:*'],
      undefined,
      'system' as UserId,
    );
    roleIds['role-iam-admins'] = iamAdminRole.id;
    roleIds['role-domain-admins'] = domainAdminRole.id;
    roleIds['role-server-admins'] = serverAdminRole.id;

    // Wire admin group → privileged role
    const gIamAdmins = dir.getGroup(groupIds['grp-iam-admins']!);
    if (gIamAdmins) gIamAdmins.ownerRoleId = iamAdminRole.id;
    const gDomainAdmins = dir.getGroup(groupIds['grp-domain-admins']!);
    if (gDomainAdmins) gDomainAdmins.ownerRoleId = domainAdminRole.id;
    const gServerAdmins = dir.getGroup(groupIds['grp-server-admins']!);
    if (gServerAdmins) gServerAdmins.ownerRoleId = serverAdminRole.id;
  }

  // --- Users (resolve manager IDs first) ---
  // First pass: create users with no manager
  const allSeeds = [...SEED_USERS, ...SEED_ADMINS];
  const tempIds: Record<string, UserId> = {};
  for (const s of allSeeds) {
    const u = dir.ensureUser(
      {
        username: s.username,
        displayName: s.displayName,
        email: seedEmail(s),
        department: s.department,
        title: s.title,
        mfa: s.mfa as MfaMethod,
        groupIds: s.groups.map((g) => groupIds[g]).filter((g): g is GroupId => Boolean(g)),
      },
      'system' as UserId,
    );
    tempIds[s.username] = u.id;
    userIds[s.username] = u.id;
  }
  // Second pass: set manager IDs
  for (const s of allSeeds) {
    if (!s.manager) continue;
    const mgrId = tempIds[s.manager];
    const uId = tempIds[s.username];
    if (mgrId && uId) {
      const u = dir.getUser(uId);
      if (u) u.managerId = mgrId;
    }
  }

  // --- Service accounts (created like users but flagged) ---
  // Service accounts are provisioned by the organisation, not by DCPROMO.
  if (withStructure)
  for (const name of SERVICE_ACCOUNT_NAMES) {
    const u = dir.ensureUser(
      {
        username: name,
        displayName: name,
        email: `${name}@${COMPANY.domain}`,
        department: 'IT',
        title: 'Service Account',
        mfa: 'none',
      },
      'system' as UserId,
    );
    userIds[name] = u.id;
  }

  // --- Passwords ---
  const passwords: Record<string, string> = {};
  for (const s of allSeeds) passwords[s.username] = s.password;
  idp.seedPasswords(passwords);

  return { userIds, groupIds, roleIds, appIds };
}

/** Snapshot the current state of all services — used for reset. */
export interface WorldSnapshot {
  users: import('@/domain').User[];
  groups: import('@/domain').Group[];
  roles: import('@/domain').RoleRecord[];
  apps: import('@/domain').Application[];
  passwords: Record<string, string>;
  idpNow: () => number;
}

export function snapshotWorld(
  dir: MockDirectory,
  idp: MockIdP,
  apps: MockAppServer,
  passwords: Record<string, string>,
): WorldSnapshot {
  return {
    users: dir.listUsers(),
    groups: dir.listGroups(),
    roles: dir.listRoles(),
    apps: apps.apps(),
    passwords: { ...passwords },
    idpNow: idp.now,
  };
}

export function restoreWorld(
  dir: MockDirectory,
  idp: MockIdP,
  apps: MockAppServer,
  snap: WorldSnapshot,
): void {
  dir.reset();
  idp.reset();
  apps.reset();
  idp.now = snap.idpNow;
  idp.seedPasswords(snap.passwords);
  // Re-create baseline world
  applyBaseline(dir, idp, apps);
  // We could replay exact mutations, but for the thin slice a clean baseline is sufficient.
}
