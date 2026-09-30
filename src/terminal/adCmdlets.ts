/**
 * terminal/adCmdlets.ts — the ActiveDirectory module's syntax, in the terminal.
 *
 * Two jobs:
 *
 *   Reads (Get-ADUser, Get-ADGroup, Get-ADOrganizationalUnit, Get-ADGroupMember,
 *   Get-ADPrincipalGroupMembership) answer here with real AD objects, so
 *   -Filter, -Identity, -Properties and -SearchBase behave as they do on a
 *   domain controller and the output can be piped to Select-Object, Where-Object
 *   and Format-List.
 *
 *   Writes keep running through the IAM capabilities — that is where auditing,
 *   ticket evidence and validation live — but the arguments are translated from
 *   what people actually type first: distinguished names for -Path, the
 *   positional name, `-Identity <group> -Members a,b` for Add-ADGroupMember,
 *   parameter names in any case.
 */
import type { CapabilityContext } from '@/services';
import type { OuId } from '@/domain';
import {
  GROUP_DEFAULT,
  MEMBER_DEFAULT,
  OU_DEFAULT,
  USER_DEFAULT,
  findGroup,
  findUser,
  groupObject,
  inSearchBase,
  looksLikeDn,
  notFoundMessage,
  ouDn,
  USERS_CONTAINER_DN,
  ouObject,
  parseFilter,
  project,
  resolveOuPath,
  userObject,
  type AdObject,
} from './adObjects';

export type ReadResult = { ok: true; rows: AdObject[] } | { ok: false; error: string };

/** Parameter names in the case PowerShell documents them; matching is case-insensitive. */
const KNOWN = [
  'Identity', 'Filter', 'LDAPFilter', 'Properties', 'SearchBase', 'SearchScope', 'ResultSetSize', 'Recursive',
  'Name', 'Path', 'Description', 'DisplayName', 'SamAccountName', 'GroupScope', 'GroupCategory', 'Members',
  'TargetPath', 'TargetDepartment', 'Department', 'Title', 'EmailAddress', 'GivenName', 'Surname',
  'UserPrincipalName', 'AccountPassword', 'NewPassword', 'ChangePasswordAtLogon', 'Enabled', 'Reset',
  'PassThru', 'Confirm', 'Server', 'Credential', 'ProtectedFromAccidentalDeletion', 'Group', 'Reason',
];

/**
 * Normalise what the tokenizer produced: parameter names to their documented
 * case, `-Filter*` (no space) to `-Filter *`, `-Name:value` to `-Name value`.
 */
export function normaliseArgs(args: Record<string, string>, extra: readonly string[] = []): Record<string, string> {
  const names = [...extra, ...KNOWN];
  const out: Record<string, string> = {};
  for (const [rawKey, value] of Object.entries(args)) {
    let key = rawKey;
    let val = value;
    const colon = key.indexOf(':');
    if (colon > 0) {
      val = key.slice(colon + 1) || val;
      key = key.slice(0, colon);
    }
    if (key.endsWith('*') && key.length > 1) {
      // `Get-ADUser -filter*`: PowerShell itself needs the space, but the intent is unambiguous.
      key = key.slice(0, -1);
      if (val === 'true') val = '*';
    }
    const canonical = names.find((n) => n.toLowerCase() === key.toLowerCase()) ?? key;
    out[canonical] = val;
  }
  return out;
}

const splitList = (v: string | undefined): string[] =>
  (v ?? '')
    .split(',')
    .map((x) => x.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);

// ---------------------------------------------------------------------------
// LDAP filters, the small subset people use: (attr=value), (&...), (|...), (!...)
// ---------------------------------------------------------------------------

const LDAP_ATTR: Record<string, string> = {
  samaccountname: 'SamAccountName', name: 'Name', cn: 'Name', displayname: 'DisplayName', department: 'Department',
  title: 'Title', mail: 'EmailAddress', givenname: 'GivenName', sn: 'Surname', objectclass: 'ObjectClass',
  userprincipalname: 'UserPrincipalName', description: 'Description', ou: 'Name',
};

function ldapToFilter(ldap: string): string | null {
  const s = ldap.trim();
  if (!s.startsWith('(') || !s.endsWith(')')) return null;
  const inner = s.slice(1, -1).trim();
  const op = inner[0];
  if (op === '&' || op === '|' || op === '!') {
    const parts: string[] = [];
    let depth = 0;
    let start = -1;
    for (let i = 1; i < inner.length; i++) {
      if (inner[i] === '(') { if (depth === 0) start = i; depth++; }
      else if (inner[i] === ')') { depth--; if (depth === 0 && start >= 0) parts.push(inner.slice(start, i + 1)); }
    }
    const sub = parts.map(ldapToFilter);
    if (sub.some((x) => x === null) || sub.length === 0) return null;
    if (op === '!') return `-not (${sub[0]})`;
    return sub.map((x) => `(${x})`).join(op === '&' ? ' -and ' : ' -or ');
  }
  const m = /^([A-Za-z]+)\s*=\s*(.*)$/.exec(inner);
  if (!m) return null;
  const attr = LDAP_ATTR[m[1]!.toLowerCase()] ?? m[1]!;
  const value = m[2]!.replace(/"/g, '');
  if (value === '*') return `${attr} -like "*"`;
  return value.includes('*') ? `${attr} -like "${value}"` : `${attr} -eq "${value}"`;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

type Kind = 'user' | 'group' | 'ou';

function query(
  ctx: CapabilityContext,
  cmdlet: string,
  kind: Kind,
  a: Record<string, string>,
  positional: string[],
): ReadResult {
  const dir = ctx.dir;
  const identity = a.Identity ?? (a.Filter === undefined && a.LDAPFilter === undefined ? positional[0] : undefined);
  const defaults = kind === 'user' ? USER_DEFAULT : kind === 'group' ? GROUP_DEFAULT : OU_DEFAULT;

  if (identity !== undefined) {
    const id = identity.replace(/^["']|["']$/g, '');
    if (kind === 'user') {
      const u = findUser(dir, id);
      return u ? { ok: true, rows: [project(userObject(dir, u), defaults, a.Properties)] } : { ok: false, error: `${cmdlet} : ${notFoundMessage(id)}` };
    }
    if (kind === 'group') {
      const g = findGroup(dir, id);
      return g ? { ok: true, rows: [project(groupObject(dir, g), defaults, a.Properties)] } : { ok: false, error: `${cmdlet} : ${notFoundMessage(id)}` };
    }
    const o = dir.listOus().find((x) => x.name.toLowerCase() === id.toLowerCase() || ouDn(dir, x.id).toLowerCase() === id.toLowerCase());
    return o ? { ok: true, rows: [project(ouObject(dir, o), defaults, a.Properties)] } : { ok: false, error: `${cmdlet} : ${notFoundMessage(id)}` };
  }

  // The console's "Find Users" form still filters by -Department.
  const filterSource =
    a.LDAPFilter !== undefined ? ldapToFilter(a.LDAPFilter) : a.Filter !== undefined ? a.Filter : a.Department !== undefined ? '*' : null;
  if (filterSource === null) {
    return {
      ok: false,
      error: a.LDAPFilter !== undefined
        ? `${cmdlet} : The search filter cannot be recognized: '${a.LDAPFilter}'.`
        : `${cmdlet} : Cannot process command because of one or more missing mandatory parameters: Filter.\n` +
          `(PowerShell would prompt for it. For every object use: ${cmdlet} -Filter *)`,
    };
  }
  const parsed = parseFilter(filterSource);
  if (!parsed.ok) return { ok: false, error: `${cmdlet} : ${parsed.error}` };

  let base: OuId | undefined;
  if (a.SearchBase) {
    const r = resolveOuPath(dir, a.SearchBase);
    if (!r.ok) return { ok: false, error: `${cmdlet} : ${r.error}` };
    base = r.ouId;
  }

  let rows: AdObject[];
  if (kind === 'user') {
    const dept = a.Department?.trim().toLowerCase();
    rows = dir
      .listUsers()
      .filter((u) => inSearchBase(dir, u.ouId, base, a.SearchScope))
      .filter((u) => !dept || u.department.toLowerCase() === dept)
      .map((u) => userObject(dir, u));
  } else if (kind === 'group') {
    rows = dir.listGroups().filter((g) => inSearchBase(dir, g.ouId, base, a.SearchScope)).map((g) => groupObject(dir, g));
  } else {
    rows = dir.listOus().filter((o) => base === undefined || inSearchBase(dir, o.id, base, a.SearchScope) || o.id === base).map((o) => ouObject(dir, o));
  }
  rows = rows.filter(parsed.test).map((o) => project(o, defaults, a.Properties));
  const limit = Number(a.ResultSetSize);
  if (Number.isFinite(limit) && limit > 0) rows = rows.slice(0, limit);
  return { ok: true, rows };
}

/**
 * Answer a read-only AD cmdlet with real objects, or null when `name` is not
 * one of them (the caller then carries on to the capabilities).
 */
export function runAdRead(
  name: string,
  rawArgs: Record<string, string>,
  positional: string[],
  ctx: CapabilityContext,
): ReadResult | null {
  const a = normaliseArgs(rawArgs);
  switch (name) {
    case 'get-aduser':
      return query(ctx, 'Get-ADUser', 'user', a, positional);
    case 'get-adgroup':
      return query(ctx, 'Get-ADGroup', 'group', a, positional);
    case 'get-adorganizationalunit':
      return query(ctx, 'Get-ADOrganizationalUnit', 'ou', a, positional);
    case 'get-adgroupmember': {
      const id = (a.Identity ?? a.Group ?? positional[0])?.replace(/^["']|["']$/g, '');
      if (!id) return { ok: false, error: 'Get-ADGroupMember : Cannot process command because of one or more missing mandatory parameters: Identity.' };
      const g = findGroup(ctx.dir, id);
      if (!g) return { ok: false, error: `Get-ADGroupMember : ${notFoundMessage(id)}` };
      const rows = g.memberIds
        .map((uid) => ctx.dir.getUser(uid))
        .filter((u): u is NonNullable<typeof u> => Boolean(u))
        .map((u) => {
          const o = userObject(ctx.dir, u);
          const out: AdObject = {};
          for (const k of MEMBER_DEFAULT) {
            const src = Object.keys(o).find((x) => x.toLowerCase() === k.toLowerCase())!;
            out[k] = o[src]!;
          }
          return out;
        });
      return { ok: true, rows };
    }
    case 'get-adprincipalgroupmembership': {
      const id = (a.Identity ?? positional[0])?.replace(/^["']|["']$/g, '');
      if (!id) return { ok: false, error: 'Get-ADPrincipalGroupMembership : Cannot process command because of one or more missing mandatory parameters: Identity.' };
      const u = findUser(ctx.dir, id);
      if (!u) return { ok: false, error: `Get-ADPrincipalGroupMembership : ${notFoundMessage(id)}` };
      const rows = ctx.dir
        .listGroups()
        .filter((g) => g.memberIds.includes(u.id))
        .map((g) => {
          const o = groupObject(ctx.dir, g);
          return {
            distinguishedName: o.DistinguishedName!, GroupCategory: o.GroupCategory!, GroupScope: o.GroupScope!,
            name: o.Name!, objectClass: 'group', objectGUID: o.ObjectGUID!, SamAccountName: o.SamAccountName!, SID: o.SID!,
          };
        });
      return { ok: true, rows };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Writes: translate real syntax into the capability's arguments
// ---------------------------------------------------------------------------

function setIf(a: Record<string, string>, key: string, value: string | undefined): void {
  if (value !== undefined) a[key] = value;
}

export type Adapted = { ok: true; runs: Record<string, string>[] } | { ok: false; error: string };

const SCOPES: Record<string, string> = { domainlocal: 'DomainLocal', '0': 'DomainLocal', global: 'Global', '1': 'Global', universal: 'Universal', '2': 'Universal' };
const CATEGORIES: Record<string, string> = { security: 'Security', '1': 'Security', distribution: 'Distribution', '0': 'Distribution' };

/** A user identity as the capability wants it: the SamAccountName. */
function samOf(ctx: CapabilityContext, id: string | undefined): string | undefined {
  if (id === undefined) return undefined;
  const clean = id.replace(/^["']|["']$/g, '');
  return findUser(ctx.dir, clean)?.username ?? clean;
}

/** An OU given as a DN, canonical name or bare name, as its path ("USA/Users"). */
function ouRefOf(ctx: CapabilityContext, id: string | undefined): string | undefined {
  if (id === undefined) return undefined;
  const clean = id.replace(/^["']|["']$/g, '');
  const r = resolveOuPath(ctx.dir, clean);
  return r.ok && r.ouId ? ctx.dir.ouPath(r.ouId) : clean;
}

function groupNameOf(ctx: CapabilityContext, id: string | undefined): string | undefined {
  if (id === undefined) return undefined;
  const clean = id.replace(/^["']|["']$/g, '');
  return findGroup(ctx.dir, clean)?.name ?? clean;
}

/**
 * -Path / -TargetPath: a DN or canonical name becomes the OU's path
 * ("USA/Users"), which stays unambiguous when two OUs share a name; the domain
 * root drops it, except for Move-ADObject, where it means CN=Users.
 */
function pathArg(ctx: CapabilityContext, cmdlet: string, a: Record<string, string>, key: 'Path' | 'TargetPath'): string | null {
  const raw = a[key];
  if (raw === undefined) return '';
  const r = resolveOuPath(ctx.dir, raw);
  if (!r.ok) return null;
  if (r.ouId === undefined) {
    if (key === 'TargetPath') {
      a[key] = USERS_CONTAINER_DN;
      return a[key];
    }
    delete a[key];
    return '';
  }
  a[key] = ctx.dir.ouPath(r.ouId);
  void cmdlet;
  return a[key];
}

/**
 * Translate one write cmdlet's arguments. Returns null for cmdlets this does
 * not know, which run unchanged apart from case-insensitive parameter names.
 */
export function adaptAdWrite(name: string, rawArgs: Record<string, string>, positional: string[], ctx: CapabilityContext): Adapted | null {
  const a = normaliseArgs(rawArgs);
  const pos = [...positional];
  const one = (): Adapted => ({ ok: true, runs: [a] });
  const pathError = (cmdlet: string, key: 'Path' | 'TargetPath'): Adapted => ({
    ok: false,
    error: `${cmdlet} : Directory object not found: '${rawArgs[key] ?? a[key] ?? Object.entries(rawArgs).find(([k]) => k.toLowerCase().startsWith(key.toLowerCase()))?.[1]}'.`,
  });

  switch (name) {
    case 'new-adgroup': {
      setIf(a, 'Name', a.Name ?? pos.shift());
      setIf(a, 'GroupScope', a.GroupScope ?? pos.shift() ?? 'Global');
      const scope = SCOPES[(a.GroupScope ?? 'Global').toLowerCase()];
      if (!scope) {
        return {
          ok: false,
          error:
            `New-ADGroup : Cannot bind parameter 'GroupScope'. Cannot convert value "${a.GroupScope}" to type ` +
            '"Microsoft.ActiveDirectory.Management.ADGroupScope". Specify one of the following enumerator names and try again: DomainLocal, Global, Universal',
        };
      }
      a.GroupScope = scope;
      const category = CATEGORIES[(a.GroupCategory ?? 'Security').toLowerCase()];
      if (!category) {
        return { ok: false, error: `New-ADGroup : Cannot bind parameter 'GroupCategory'. Specify one of the following enumerator names and try again: Distribution, Security` };
      }
      a.GroupCategory = category;
      if (pathArg(ctx, 'New-ADGroup', a, 'Path') === null) return pathError('New-ADGroup', 'Path');
      return one();
    }
    case 'new-adorganizationalunit': {
      setIf(a, 'Name', a.Name ?? pos.shift());
      if (pathArg(ctx, 'New-ADOrganizationalUnit', a, 'Path') === null) return pathError('New-ADOrganizationalUnit', 'Path');
      return one();
    }
    case 'new-aduser': {
      setIf(a, 'Name', a.Name ?? pos.shift() ?? ([a.GivenName, a.Surname].filter(Boolean).join(' ') || undefined));
      // AD needs a logon name; when a script leaves it out, the common case is a Name with no spaces.
      if (!a.SamAccountName && a.UserPrincipalName) a.SamAccountName = a.UserPrincipalName.split('@')[0]!;
      if (!a.SamAccountName && a.Name && !/\s/.test(a.Name)) a.SamAccountName = a.Name;
      if (a.Enabled !== undefined && !/^(\$?true|1)$/i.test(a.Enabled)) {
        return { ok: false, error: 'New-ADUser : This lab creates enabled accounts only. Leave out -Enabled, or use -Enabled $true.' };
      }
      if (pathArg(ctx, 'New-ADUser', a, 'Path') === null) return pathError('New-ADUser', 'Path');
      return one();
    }
    case 'add-adgroupmember':
    case 'remove-adgroupmember': {
      // Real syntax: -Identity <group> -Members <user>[,<user>...]
      if (a.Members !== undefined || (a.Group === undefined && pos.length >= 1)) {
        const group = groupNameOf(ctx, a.Identity ?? pos.shift());
        const members = a.Members !== undefined ? splitList(a.Members) : splitList(pos.shift());
        if (!group) return { ok: false, error: 'Cannot process command because of one or more missing mandatory parameters: Identity.' };
        if (members.length === 0) return { ok: false, error: 'Cannot process command because of one or more missing mandatory parameters: Members.' };
        return { ok: true, runs: members.map((m) => ({ ...a, Identity: samOf(ctx, m)!, Group: group })) };
      }
      a.Identity = samOf(ctx, a.Identity)!;
      a.Group = groupNameOf(ctx, a.Group)!;
      return one();
    }
    case 'remove-adgroup': {
      setIf(a, 'Name', a.Name ?? groupNameOf(ctx, a.Identity ?? pos.shift()));
      return one();
    }
    case 'remove-adorganizationalunit': {
      const id = a.Name ?? a.Identity ?? pos.shift();
      if (id && looksLikeDn(id)) {
        const r = resolveOuPath(ctx.dir, id);
        a.Name = r.ok && r.ouId ? ctx.dir.ouPath(r.ouId) : id;
      } else if (id) a.Name = id;
      return one();
    }
    case 'set-adgroup': {
      a.Identity = groupNameOf(ctx, a.Identity ?? pos.shift())!;
      if (a.Identity === undefined) delete a.Identity;
      if (a.ManagedBy !== undefined) a.ManagedBy = samOf(ctx, a.ManagedBy)!;
      return one();
    }
    case 'set-adorganizationalunit': {
      a.Identity = ouRefOf(ctx, a.Identity ?? pos.shift())!;
      if (a.Identity === undefined) delete a.Identity;
      if (a.ManagedBy !== undefined) a.ManagedBy = samOf(ctx, a.ManagedBy)!;
      return one();
    }
    case 'rename-adobject': {
      const raw = a.Identity ?? pos.shift();
      const clean = raw?.replace(/^["']|["']$/g, '');
      a.Identity = (clean && (findUser(ctx.dir, clean)?.username ?? findGroup(ctx.dir, clean)?.name)) ?? ouRefOf(ctx, raw)!;
      setIf(a, 'NewName', a.NewName ?? pos.shift());
      return one();
    }
    case 'move-adobject': {
      const raw = a.Identity ?? pos.shift();
      const clean = raw?.replace(/^["']|["']$/g, '');
      // An OU given by its DN travels as its path, which stays unambiguous.
      a.Identity =
        clean && !findUser(ctx.dir, clean) && !findGroup(ctx.dir, clean) && looksLikeDn(clean)
          ? ouRefOf(ctx, clean)!
          : samOf(ctx, raw)!;
      setIf(a, 'TargetPath', a.TargetPath ?? pos.shift());
      if (pathArg(ctx, 'Move-ADObject', a, 'TargetPath') === null) return pathError('Move-ADObject', 'TargetPath');
      return one();
    }
    case 'set-aduser':
    case 'remove-aduser':
    case 'disable-adaccount':
    case 'enable-adaccount':
    case 'unlock-adaccount':
    case 'set-adaccountpassword': {
      a.Identity = samOf(ctx, a.Identity ?? pos.shift())!;
      if (a.Identity === undefined) delete a.Identity;
      return one();
    }
    default:
      return null;
  }
}

/**
 * `(ConvertTo-SecureString "P@ss" -AsPlainText -Force)` → `"P@ss"`, so
 * -AccountPassword and -NewPassword accept what every real script passes.
 */
export function unwrapSecureStrings(line: string): string {
  return line.replace(
    /\(\s*ConvertTo-SecureString\s+(?:-String\s+)?("[^"]*"|'[^']*'|\S+)(?:\s+-AsPlainText)?(?:\s+-Force)?(?:\s+-AsPlainText)?\s*\)/gi,
    (_m, value: string) => (value.startsWith('"') || value.startsWith("'") ? value : `"${value}"`),
  );
}
