/**
 * vm/adlab/realVm.ts — the real VirtualBox VMs, seen as lab state.
 *
 * omari-lab/10-AD-ENTERPRISE-VBOX/Get-AdLabFacts.ps1 reads DC01 and CLIENT01
 * (read-only, through VirtualBox Guest Control) and prints JSON. This turns
 * that JSON into the same LabState the simulator produces, so the real VMs
 * are graded by exactly the same validation engine and coached by exactly
 * the same instructor. One examiner for both worlds.
 *
 * Anything the collector could not see stays at its fresh-install default,
 * and `problems` says why — the window refuses to grade a half-read estate.
 */
import {
  type AdGroup,
  type AdUser,
  type HostName,
  type LabState,
  type Nic,
  type ShareAce,
  freshState,
  prefixToMask,
} from './state';

/** The subset of the collector's JSON this reads. Everything optional: it is external input. */
interface RawNic {
  alias?: string;
  mac?: string;
  dhcp?: boolean;
  ip?: string | null;
  prefix?: number | null;
  gateway?: string | null;
  dns?: string[] | null;
  dnsStatic?: boolean;
  leaseFrom?: string | null;
  suffix?: string | null;
}

interface RawFacts {
  hostname?: string;
  os?: string;
  pendingHostname?: string | null;
  domain?: string | null;
  joinPending?: boolean;
  nics?: RawNic[];
  features?: string[];
  services?: Record<string, string>;
  appliedGpos?: string[];
  history?: string[];
  events?: { log?: string; id?: number; level?: string; source?: string; message?: string }[];
  ad?: {
    forest?: string;
    netbios?: string;
    ous?: string[];
    users?: Partial<AdUser>[];
    groups?: (Partial<AdGroup> & { members?: string[] | null })[];
    computers?: { name?: string; parent?: string }[];
    gpos?: { name?: string; links?: string[] | null }[];
    passwordPolicy?: { minPasswordLength?: number; lockoutThreshold?: number; complexityEnabled?: boolean };
  };
  dns?: { zones?: string[]; records?: { zone?: string; name?: string; ip?: string }[] };
  dhcp?: {
    authorized?: boolean;
    serverOptions?: { router?: string | null; dns?: string[] | null; dnsDomain?: string | null };
    scopes?: { scopeId?: string; name?: string; start?: string; end?: string; mask?: string; active?: boolean; router?: string | null; dns?: string[] | null; dnsDomain?: string | null }[];
    leases?: { ip?: string; hostname?: string; mac?: string; scopeId?: string }[];
  };
  routing?: { configured?: boolean; natInstalled?: boolean; natInterfaces?: Record<string, string> };
  shares?: { name?: string; path?: string; access?: { identity?: string; rights?: string }[]; ntfs?: { identity?: string; rights?: string; inherited?: boolean }[] }[];
}

export interface RawVmEntry {
  vmName?: string;
  exists?: boolean;
  running?: boolean;
  /** VirtualBox's VMState: running, paused, poweroff, saved… */
  state?: string | null;
  facts?: RawFacts | null;
  error?: string | null;
}

export interface RawFactsDocument {
  collectedAt?: string;
  vms?: Partial<Record<HostName, RawVmEntry>>;
  /** MAC (08-00-27-..) → which virtual network the adapter is plugged into. */
  networks?: Record<string, 'internal' | 'internet'>;
}

export interface RealVmReading {
  state: LabState;
  /** Why the reading cannot be graded (VM missing, stopped, unreadable). Empty = gradeable. */
  problems: string[];
  /** The same problems, by machine — a lab only cares about the machines it uses. */
  problemsByHost: Partial<Record<HostName, string>>;
  collectedAt: string | null;
}

const arr = <T>(v: T[] | null | undefined): T[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const HOSTS: HostName[] = ['DC01', 'CLIENT01'];

function normMac(mac: string): string {
  return mac.replace(/[:-]/g, '').toUpperCase().replace(/(..)(?!$)/g, '$1-');
}

function toNic(raw: RawNic, networks: Record<string, string>): Nic {
  const mac = normMac(str(raw.mac));
  const known = networks[mac];
  return {
    alias: str(raw.alias) || 'Ethernet',
    network: known === 'internet' ? 'internet' : known === 'internal' ? 'internal' : /internet/i.test(str(raw.alias)) ? 'internet' : 'internal',
    mac,
    dhcp: !!raw.dhcp,
    ip: raw.ip || null,
    mask: typeof raw.prefix === 'number' && raw.prefix > 0 ? prefixToMask(raw.prefix) : null,
    gateway: raw.gateway || null,
    dns: arr(raw.dns).filter((d) => typeof d === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(d)),
    dnsStatic: !!raw.dnsStatic,
    leaseFrom: raw.leaseFrom || null,
    connectionSuffix: raw.suffix || null,
  };
}

function shareRights(r: string): ShareAce['rights'] {
  return /full/i.test(r) ? 'Full' : /change/i.test(r) ? 'Change' : 'Read';
}

/** Turn the collector's JSON into lab state the validation engine understands. */
export function factsToLabState(doc: RawFactsDocument): RealVmReading {
  const s = freshState();
  const problems: string[] = [];
  const problemsByHost: Partial<Record<HostName, string>> = {};
  const note = (host: HostName, msg: string): void => {
    problems.push(msg);
    problemsByHost[host] = msg;
  };
  const networks = doc.networks ?? {};

  for (const key of HOSTS) {
    const entry = doc.vms?.[key];
    if (!entry?.exists) {
      note(key, `${key} does not exist in VirtualBox yet. Build it with omari-lab/10-AD-ENTERPRISE-VBOX/01-New-AdLabVMs.ps1.`);
      continue;
    }
    if (!entry.running) {
      note(key, entry.state === 'paused'
        ? `${key} is paused. Resume it in VirtualBox and check again.`
        : `${key} is not running. Start it, sign in, and check again.`);
      continue;
    }
    const f = entry.facts;
    if (!f) {
      note(key, `${key} could not be read${entry.error ? `: ${entry.error.split('\n')[0]}` : '.'} Is Windows finished installing and signed in?`);
      continue;
    }
    const h = s.hosts[key];
    h.hostname = str(f.hostname) || h.hostname;
    h.os = str(f.os) || h.os;
    h.pendingHostname = f.pendingHostname || null;
    h.domain = f.domain || null;
    h.pendingDomain = f.joinPending ? 'join pending restart' : null;
    h.restartPending = !!(h.pendingHostname || h.pendingDomain);
    const nics = arr(f.nics).map((n) => toNic(n, networks));
    if (nics.length) h.nics = nics;
    h.features = arr(f.features);
    h.services = {};
    for (const [name, status] of Object.entries(f.services ?? {})) h.services[name] = status === 'Running' ? 'Running' : 'Stopped';
    h.appliedGpos = arr(f.appliedGpos);
    for (const line of arr(f.history)) {
      // PSReadLine keeps the command, not whether it worked.
      s.history.push({ host: key, shell: 'powershell', command: str(line), output: '', ok: true, outcomeKnown: false, at: ++s.tick });
    }
    for (const e of arr(f.events)) {
      s.events.push({
        host: key,
        log: (['System', 'Security', 'Application'].includes(str(e.log)) ? e.log : 'System') as LabState['events'][number]['log'],
        id: e.id ?? 0,
        level: /error/i.test(str(e.level)) ? 'Error' : /warn/i.test(str(e.level)) ? 'Warning' : 'Information',
        source: str(e.source),
        message: str(e.message),
        at: ++s.tick,
      });
    }

    if (key !== 'DC01') continue;
    const ad = f.ad;
    if (ad?.forest) {
      s.ad.forest = ad.forest.toLowerCase();
      s.ad.netbios = str(ad.netbios) || null;
      s.ad.ous = arr(ad.ous);
      s.ad.users = arr(ad.users).map((u) => ({
        sam: str(u.sam), name: str(u.name), givenName: str(u.givenName), surname: str(u.surname), parent: str(u.parent),
        enabled: !!u.enabled, lockedOut: !!u.lockedOut, badPwdCount: u.badPwdCount ?? 0, passwordSet: !!u.passwordSet,
        changePasswordAtLogon: !!u.changePasswordAtLogon, passwordLastResetByAdmin: null, department: u.department ?? null,
      }));
      s.ad.groups = arr(ad.groups).map((g) => ({
        name: str(g.name), parent: str(g.parent),
        scope: g.scope === 'DomainLocal' ? 'DomainLocal' : g.scope === 'Universal' ? 'Universal' : 'Global',
        category: g.category === 'Distribution' ? 'Distribution' : 'Security',
        members: arr(g.members), builtin: !!g.builtin,
      }));
      s.ad.computers = arr(ad.computers).map((c) => ({ name: str(c.name), parent: str(c.parent) }));
      s.ad.gpos = arr(ad.gpos).map((g) => ({ name: str(g.name), links: arr(g.links) }));
      if (ad.passwordPolicy) {
        s.ad.passwordPolicy = {
          minPasswordLength: ad.passwordPolicy.minPasswordLength ?? 7,
          lockoutThreshold: ad.passwordPolicy.lockoutThreshold ?? 0,
          complexityEnabled: ad.passwordPolicy.complexityEnabled ?? true,
        };
      }
    }
    if (f.dns) {
      s.dns.zones = arr(f.dns.zones);
      s.dns.records = arr(f.dns.records).map((r) => ({ zone: str(r.zone), name: str(r.name) || '@', ip: str(r.ip) }));
    }
    if (f.dhcp) {
      s.dhcp.authorized = !!f.dhcp.authorized;
      s.dhcp.serverOptions = {
        router: f.dhcp.serverOptions?.router || null,
        dns: arr(f.dhcp.serverOptions?.dns),
        dnsDomain: f.dhcp.serverOptions?.dnsDomain || null,
      };
      s.dhcp.scopes = arr(f.dhcp.scopes).map((sc) => ({
        scopeId: str(sc.scopeId), name: str(sc.name), start: str(sc.start), end: str(sc.end), mask: str(sc.mask),
        active: !!sc.active, router: sc.router || null, dns: arr(sc.dns), dnsDomain: sc.dnsDomain || null,
      }));
      s.dhcp.leases = arr(f.dhcp.leases).map((l) => ({ ip: str(l.ip), hostname: str(l.hostname), mac: normMac(str(l.mac)), scopeId: str(l.scopeId) }));
    }
    if (f.routing) {
      s.routing.configured = !!f.routing.configured;
      s.routing.natInstalled = !!f.routing.natInstalled;
      s.routing.natInterfaces = {};
      for (const [alias, mode] of Object.entries(f.routing.natInterfaces ?? {})) {
        s.routing.natInterfaces[alias] = mode === 'public' ? 'public' : 'private';
      }
    }
    for (const sh of arr(f.shares)) {
      const path = str(sh.path);
      s.shares.push({ name: str(sh.name), path, access: arr(sh.access).map((a) => ({ identity: str(a.identity), rights: shareRights(str(a.rights)) })) });
      const key2 = path.replace(/\\+$/, '').toLowerCase();
      if (!h.folders.includes(key2)) h.folders.push(key2);
      s.ntfs[key2] = arr(sh.ntfs).map((a) => ({
        identity: str(a.identity),
        rights: (['F', 'M', 'RX', 'R', 'W'].includes(str(a.rights)) ? a.rights : 'R') as 'F' | 'M' | 'RX' | 'R' | 'W',
        inherited: !!a.inherited,
      }));
    }
  }

  return { state: s, problems, problemsByHost, collectedAt: doc.collectedAt ?? null };
}
