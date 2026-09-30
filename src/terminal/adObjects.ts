/**
 * terminal/adObjects.ts — directory objects the way the ActiveDirectory
 * PowerShell module presents them.
 *
 * The terminal used to answer `Get-ADUser` with a table of its own design and
 * a "1 user(s)." footer, ignore -Filter, -Identity and -Properties, and refuse
 * the distinguished names every real script passes to -Path. A learner who
 * copied a command from Microsoft's documentation, or from their job, got an
 * error or a different answer. This module gives the terminal the real shapes:
 * distinguished names, the default property set, -Properties, the -Filter
 * language, -SearchBase, and "Cannot find an object with identity".
 */
import { COMPANY } from '@/config';
import type { Group, OrganizationalUnit, OuId, User } from '@/domain';
import type { MockDirectory } from '@/services';

/** DC=omari,DC=test */
export const DOMAIN_DN = COMPANY.domain
  .split('.')
  .map((p) => `DC=${p}`)
  .join(',');

/** The default container for accounts and groups nobody placed. */
export const USERS_CONTAINER_DN = `CN=Users,${DOMAIN_DN}`;

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

const escRdn = (v: string): string => v.replace(/([,+"\\<>;=])/g, '\\$1');

/** The OU and its parents, leaf first. */
export function ouChain(dir: MockDirectory, ouId: OuId | undefined): OrganizationalUnit[] {
  const out: OrganizationalUnit[] = [];
  const seen = new Set<string>();
  let cur = ouId ? dir.getOu(ouId) : undefined;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.push(cur);
    cur = cur.parentId ? dir.getOu(cur.parentId) : undefined;
  }
  return out;
}

export function ouDn(dir: MockDirectory, ouId: OuId): string {
  return `${ouChain(dir, ouId).map((o) => `OU=${escRdn(o.name)}`).join(',')},${DOMAIN_DN}`;
}

/** Where an account or group lives: its OU, or CN=Users. */
export function containerDn(dir: MockDirectory, ouId: OuId | undefined): string {
  return ouId && dir.getOu(ouId) ? ouDn(dir, ouId) : USERS_CONTAINER_DN;
}

export const userDn = (dir: MockDirectory, u: User): string => `CN=${escRdn(u.displayName)},${containerDn(dir, u.ouId)}`;
export const groupDn = (dir: MockDirectory, g: Group): string => `CN=${escRdn(g.name)},${containerDn(dir, g.ouId)}`;

function canonical(dir: MockDirectory, ouId: OuId | undefined, leaf: string): string {
  const path = ouId && dir.getOu(ouId) ? ouChain(dir, ouId).map((o) => o.name).reverse() : ['Users'];
  return [COMPANY.domain, ...path, leaf].join('/');
}

/** Split a DN into [type, value] pairs, honouring escaped commas. */
function parseDn(dn: string): [string, string][] | null {
  const parts: string[] = [];
  let buf = '';
  for (let i = 0; i < dn.length; i++) {
    const ch = dn[i]!;
    if (ch === '\\' && i + 1 < dn.length) {
      buf += dn[++i];
      continue;
    }
    if (ch === ',') {
      parts.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  parts.push(buf.trim());
  const out: [string, string][] = [];
  for (const p of parts) {
    const m = /^([A-Za-z]+)\s*=\s*(.*)$/.exec(p);
    if (!m) return null;
    out.push([m[1]!.toUpperCase(), m[2]!]);
  }
  return out;
}

export const looksLikeDn = (s: string): boolean => /^\s*(CN|OU|DC)\s*=/i.test(s);

export type OuTarget = { ok: true; ouId: OuId | undefined } | { ok: false; error: string };

/**
 * Resolve a -Path / -TargetPath / -SearchBase value.
 *
 * Accepts what people actually type: a distinguished name
 * ("OU=Groups,OU=Corp,DC=omari,DC=test"), a canonical name
 * ("omari.test/Corp/Groups" or "Corp/Groups"), or the OU's name ("Groups").
 * The domain itself, or CN=Users, means "not in an OU".
 */
export function resolveOuPath(dir: MockDirectory, raw: string): OuTarget {
  const path = raw.trim().replace(/^["']|["']$/g, '');
  const notFound: OuTarget = { ok: false, error: `Directory object not found: '${path}'.` };
  if (!path) return { ok: true, ouId: undefined };

  if (looksLikeDn(path)) {
    const rdns = parseDn(path);
    if (!rdns) return notFound;
    const dcs = rdns.filter(([t]) => t === 'DC').map(([, v]) => v.toLowerCase());
    if (dcs.length && dcs.join('.') !== COMPANY.domain.toLowerCase()) return notFound;
    const rest = rdns.filter(([t]) => t !== 'DC');
    if (rest.length === 0) return { ok: true, ouId: undefined };
    if (rest.length === 1 && rest[0]![0] === 'CN' && rest[0]![1].toLowerCase() === 'users') return { ok: true, ouId: undefined };
    if (rest.some(([t]) => t !== 'OU')) return notFound;
    return matchChain(dir, rest.map(([, v]) => v), notFound);
  }

  if (/[/\\]/.test(path)) {
    const segs = path.split(/[/\\]/).filter(Boolean);
    if (segs[0]?.toLowerCase() === COMPANY.domain.toLowerCase()) segs.shift();
    if (segs.length === 0) return { ok: true, ouId: undefined };
    return matchChain(dir, segs.reverse(), notFound);
  }

  const r = dir.resolveOuRef(path);
  return r.ou ? { ok: true, ouId: r.ou.id } : { ok: false, error: r.matches ? r.error! : `Directory object not found: '${path}'.` };
}

/**
 * names: leaf first. The leaf must exist and sit under exactly those parents.
 * Every OU of that name is tried: USA/Users and Europe/Users share a leaf name.
 */
function matchChain(dir: MockDirectory, names: string[], notFound: OuTarget): OuTarget {
  const want = names.map((n) => n.toLowerCase());
  for (const leaf of dir.listOus().filter((o) => o.name.toLowerCase() === want[0])) {
    const chain = ouChain(dir, leaf.id).map((o) => o.name.toLowerCase());
    if (chain.length === want.length && chain.every((n, i) => n === want[i])) return { ok: true, ouId: leaf.id };
  }
  return notFound;
}

// ---------------------------------------------------------------------------
// Stable identifiers. Real objects have a GUID and a SID; these are derived
// from the object's id so they are the same every time they are shown.
// ---------------------------------------------------------------------------

function hash(s: string, seed = 2166136261): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

const hex = (n: number, len: number): string => n.toString(16).padStart(len, '0').slice(-len);

export function guidFor(id: string): string {
  const a = hash(id, 1);
  const b = hash(id, 2);
  const c = hash(id, 3);
  const d = hash(id, 4);
  return `${hex(a, 8)}-${hex(b, 4)}-4${hex(b >>> 16, 3)}-${hex(8 + (c & 3), 1)}${hex(c >>> 4, 3)}-${hex(d, 8)}${hex(c >>> 16, 4)}`;
}

const DOMAIN_SID = `S-1-5-21-${hash(COMPANY.domain, 11) % 4000000000}-${hash(COMPANY.domain, 12) % 4000000000}-${hash(COMPANY.domain, 13) % 4000000000}`;
const WELL_KNOWN_RID: Record<string, number> = { admin: 500, administrator: 500, guest: 501, krbtgt: 502 };

export function sidFor(id: string, samAccountName: string): string {
  const rid = WELL_KNOWN_RID[samAccountName.toLowerCase()] ?? 1100 + (hash(id, 7) % 800000);
  return `${DOMAIN_SID}-${rid}`;
}

// ---------------------------------------------------------------------------
// Objects
// ---------------------------------------------------------------------------

export type AdValue = string | number | boolean | null | string[] | Date;
export type AdObject = Record<string, AdValue>;

export const USER_DEFAULT = [
  'DistinguishedName', 'Enabled', 'GivenName', 'Name', 'ObjectClass', 'ObjectGUID',
  'SamAccountName', 'SID', 'Surname', 'UserPrincipalName',
] as const;

export const GROUP_DEFAULT = [
  'DistinguishedName', 'GroupCategory', 'GroupScope', 'Name', 'ObjectClass', 'ObjectGUID', 'SamAccountName', 'SID',
] as const;

export const OU_DEFAULT = [
  'City', 'Country', 'DistinguishedName', 'LinkedGroupPolicyObjects', 'ManagedBy', 'Name',
  'ObjectClass', 'ObjectGUID', 'PostalCode', 'State', 'StreetAddress',
] as const;

export const MEMBER_DEFAULT = ['distinguishedName', 'name', 'objectClass', 'objectGUID', 'SamAccountName', 'SID'] as const;

/** Everything the lab knows about an account, under the attribute names PowerShell uses. */
export function userObject(dir: MockDirectory, u: User): AdObject {
  // A one-word name (Administrator, a service account) has no given name or surname in AD.
  const words = u.displayName.trim().split(/\s+/);
  const [given, ...rest] = words.length > 1 ? words : ['', ''];
  const manager = u.managerId ? dir.getUser(u.managerId) : undefined;
  const memberOf = dir
    .listGroups()
    .filter((g) => g.memberIds.includes(u.id))
    .map((g) => groupDn(dir, g));
  return {
    DistinguishedName: userDn(dir, u),
    Enabled: u.status !== 'disabled',
    GivenName: given ?? '',
    Name: u.displayName,
    ObjectClass: 'user',
    ObjectGUID: guidFor(u.id),
    SamAccountName: u.username,
    SID: sidFor(u.id, u.username),
    Surname: rest.join(' '),
    UserPrincipalName: `${u.username}@${COMPANY.domain}`,
    // -Properties
    CanonicalName: canonical(dir, u.ouId, u.displayName),
    Created: new Date(u.createdAt),
    Department: u.department ?? '',
    DisplayName: u.displayName,
    EmailAddress: u.email ?? '',
    LastLogonDate: u.lastSignInAt ? new Date(u.lastSignInAt) : null,
    LockedOut: u.status === 'locked',
    Manager: manager ? userDn(dir, manager) : null,
    MemberOf: memberOf,
    // Not an AD attribute: the lab's MFA registration, shown with -Properties MfaMethod (or *).
    MfaMethod: u.mfa,
    PasswordExpired: Boolean(u.mustChangePassword),
    Title: u.title ?? '',
    whenCreated: new Date(u.createdAt),
  };
}

export function groupObject(dir: MockDirectory, g: Group): AdObject {
  return {
    DistinguishedName: groupDn(dir, g),
    GroupCategory: g.category ?? 'Security',
    GroupScope: g.scope ?? 'Global',
    Name: g.name,
    ObjectClass: 'group',
    ObjectGUID: guidFor(g.id),
    SamAccountName: g.name,
    SID: sidFor(g.id, g.name),
    // -Properties
    CanonicalName: canonical(dir, g.ouId, g.name),
    Description: g.description ?? '',
    Members: g.memberIds.map((id) => dir.getUser(id)).filter((u): u is User => Boolean(u)).map((u) => userDn(dir, u)),
  };
}

export function ouObject(dir: MockDirectory, o: OrganizationalUnit): AdObject {
  return {
    City: null,
    Country: null,
    DistinguishedName: ouDn(dir, o.id),
    LinkedGroupPolicyObjects: [],
    ManagedBy: null,
    Name: o.name,
    ObjectClass: 'organizationalUnit',
    ObjectGUID: guidFor(o.id),
    PostalCode: null,
    State: null,
    StreetAddress: null,
    // -Properties
    CanonicalName: canonical(dir, o.parentId, o.name),
    Created: new Date(o.createdAt),
    Description: o.description ?? '',
  };
}

/** Keep the default set, plus whatever -Properties asked for ("*" = everything). */
export function project(obj: AdObject, defaults: readonly string[], properties: string | undefined): AdObject {
  const wanted = (properties ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (wanted.includes('*')) return { ...obj };
  const out: AdObject = {};
  for (const k of defaults) out[k] = obj[k] ?? null;
  for (const w of wanted) {
    const key = Object.keys(obj).find((k) => k.toLowerCase() === w.toLowerCase());
    if (key && !(key in out)) out[key] = obj[key]!;
  }
  return out;
}

/** An account by any identity PowerShell accepts: SamAccountName, DN, GUID or SID. */
export function findUser(dir: MockDirectory, identity: string): User | undefined {
  const id = identity.trim();
  const lower = id.toLowerCase();
  return (
    dir.getUserByUsername(id) ??
    dir.listUsers().find((u) => {
      if (lower.endsWith(`@${COMPANY.domain}`) && u.username.toLowerCase() === lower.split('@')[0]) return true;
      return userDn(dir, u).toLowerCase() === lower || guidFor(u.id) === lower || sidFor(u.id, u.username).toLowerCase() === lower;
    })
  );
}

export function findGroup(dir: MockDirectory, identity: string): Group | undefined {
  const id = identity.trim();
  const lower = id.toLowerCase();
  return (
    dir.getGroupByName(id) ??
    dir.listGroups().find((g) => g.name.toLowerCase() === lower || groupDn(dir, g).toLowerCase() === lower || guidFor(g.id) === lower || sidFor(g.id, g.name).toLowerCase() === lower)
  );
}

export const notFoundMessage = (identity: string): string =>
  `Cannot find an object with identity: '${identity}' under: '${DOMAIN_DN}'.`;

/** Whether an object with this OU sits under the -SearchBase OU. */
export function inSearchBase(dir: MockDirectory, ouId: OuId | undefined, base: OuId | undefined, scope: string | undefined): boolean {
  if (base === undefined) return true;
  const s = (scope ?? 'Subtree').toLowerCase();
  if (s === 'onelevel' || s === '1') return ouId === base;
  if (s === 'base' || s === '0') return false;
  return ouChain(dir, ouId).some((o) => o.id === base);
}

// ---------------------------------------------------------------------------
// The -Filter language: Name -like "j*" -and Enabled -eq $true
// ---------------------------------------------------------------------------

type Tok = { t: 'op' | 'val' | 'word' | 'lp' | 'rp'; v: string };

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '(') { out.push({ t: 'lp', v: ch }); i++; continue; }
    if (ch === ')') { out.push({ t: 'rp', v: ch }); i++; continue; }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let buf = '';
      while (j < src.length && src[j] !== ch) buf += src[j++];
      out.push({ t: 'val', v: buf });
      i = j + 1;
      continue;
    }
    let j = i;
    let buf = '';
    while (j < src.length && !/[\s()]/.test(src[j]!)) buf += src[j++];
    i = j;
    if (/^-[a-z]+$/i.test(buf)) out.push({ t: 'op', v: buf.slice(1).toLowerCase() });
    else out.push({ t: 'word', v: buf });
  }
  return out;
}

export type Predicate = (obj: AdObject) => boolean;

const wildcard = (pattern: string): RegExp =>
  new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');

function valueOf(tok: Tok): string | boolean | null {
  if (tok.t === 'val') return tok.v;
  const w = tok.v.toLowerCase();
  if (w === '$true') return true;
  if (w === '$false') return false;
  if (w === '$null') return null;
  return tok.v;
}

function compare(actual: AdValue | undefined, op: string, expected: string | boolean | null): boolean {
  const values = Array.isArray(actual) ? actual : [actual ?? null];
  const one = (a: AdValue | null): boolean => {
    if (expected === null) return op === 'eq' ? a === null || a === '' : op === 'ne' ? !(a === null || a === '') : false;
    if (typeof expected === 'boolean' || typeof a === 'boolean') {
      const ab = String(a).toLowerCase() === 'true';
      const eb = String(expected).toLowerCase() === 'true';
      return op === 'eq' ? ab === eb : op === 'ne' ? ab !== eb : false;
    }
    const as = a instanceof Date ? a.toISOString() : String(a ?? '');
    const es = String(expected);
    switch (op) {
      case 'eq': return as.toLowerCase() === es.toLowerCase();
      case 'ne': return as.toLowerCase() !== es.toLowerCase();
      case 'like': return wildcard(es).test(as);
      case 'notlike': return !wildcard(es).test(as);
      case 'match': try { return new RegExp(es, 'i').test(as); } catch { return false; }
      case 'notmatch': try { return !new RegExp(es, 'i').test(as); } catch { return false; }
      case 'gt': return as.localeCompare(es, undefined, { numeric: true, sensitivity: 'base' }) > 0;
      case 'ge': return as.localeCompare(es, undefined, { numeric: true, sensitivity: 'base' }) >= 0;
      case 'lt': return as.localeCompare(es, undefined, { numeric: true, sensitivity: 'base' }) < 0;
      case 'le': return as.localeCompare(es, undefined, { numeric: true, sensitivity: 'base' }) <= 0;
      default: return false;
    }
  };
  return op === 'ne' || op === 'notlike' || op === 'notmatch' ? values.every(one) : values.some(one);
}

const COMPARISONS = new Set(['eq', 'ne', 'like', 'notlike', 'match', 'notmatch', 'gt', 'ge', 'lt', 'le']);

/**
 * Parse a -Filter (or a Where-Object block). "*" matches everything.
 * `$_.` prefixes are accepted so the same parser serves Where-Object.
 */
export function parseFilter(source: string): { ok: true; test: Predicate } | { ok: false; error: string } {
  const src = source.trim().replace(/^\{|\}$/g, '').trim().replace(/\$_\./g, '').replace(/\$PSItem\./gi, '');
  if (src === '*' || src === '') return { ok: true, test: () => true };
  const toks = lex(src);
  let i = 0;
  const bad = (why: string): never => {
    throw new Error(`Error parsing query: '${source.trim()}' Error Message: '${why}'`);
  };

  const primary = (): Predicate => {
    const tok = toks[i];
    if (!tok) return bad('syntax error at end of filter');
    if (tok.t === 'op' && tok.v === 'not') {
      i++;
      const inner = primary();
      return (o) => !inner(o);
    }
    if (tok.t === 'lp') {
      i++;
      const inner = orExpr();
      if (toks[i]?.t !== 'rp') bad('missing closing parenthesis');
      i++;
      return inner;
    }
    if (tok.t !== 'word') return bad(`syntax error at position of '${tok.v}'`);
    const prop = tok.v;
    i++;
    const op = toks[i];
    if (!op || op.t !== 'op' || !COMPARISONS.has(op.v)) return bad(`Operator Not supported: ${op?.v ?? '(none)'}`);
    i++;
    const valTok = toks[i];
    if (!valTok || (valTok.t !== 'val' && valTok.t !== 'word')) return bad('syntax error: value expected');
    i++;
    const expected = valueOf(valTok);
    return (o) => {
      const key = Object.keys(o).find((k) => k.toLowerCase() === prop.toLowerCase());
      return compare(key ? o[key] : undefined, op.v, expected);
    };
  };

  const andExpr = (): Predicate => {
    let left = primary();
    while (toks[i]?.t === 'op' && toks[i]!.v === 'and') {
      i++;
      const l = left;
      const r = primary();
      left = (o) => l(o) && r(o);
    }
    return left;
  };

  const orExpr = (): Predicate => {
    let left = andExpr();
    while (toks[i]?.t === 'op' && toks[i]!.v === 'or') {
      i++;
      const l = left;
      const r = andExpr();
      left = (o) => l(o) || r(o);
    }
    return left;
  };

  try {
    const test = orExpr();
    if (i < toks.length) bad(`syntax error at position of '${toks[i]!.v}'`);
    return { ok: true, test };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Output, the way PowerShell prints it
// ---------------------------------------------------------------------------

export function formatValue(v: AdValue | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (v instanceof Date) {
    const d = v;
    const h = d.getHours() % 12 || 12;
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${h}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
  }
  if (Array.isArray(v)) return `{${v.join(', ')}}`;
  return String(v);
}

/** Format-List: one block per object, names aligned, a blank line between. */
export function formatList(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const blocks = rows.map((r) => {
    const keys = Object.keys(r);
    const width = Math.max(...keys.map((k) => k.length));
    return keys.map((k) => `${k.padEnd(width)} : ${formatValue(r[k] as AdValue)}`).join('\n');
  });
  return `\n${blocks.join('\n\n')}\n`;
}
