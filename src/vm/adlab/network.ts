/**
 * vm/adlab/network.ts — how packets and names actually move in the lab.
 *
 * Pure functions over a LabState. Nothing here changes anything; the command
 * engine uses them to produce what `ping` and `nslookup` print, and the
 * validation engine uses the very same functions to decide whether CLIENT01
 * can find the domain. One model of the network, so what the student sees in
 * the shell and what "Check my work" reports can never disagree.
 */
import {
  DOMAIN_FQDN,
  type HostName,
  type LabState,
  type Nic,
  PLAN,
  internalNic,
  sameSubnet,
} from './state';

/** Addresses on "the internet" that answer ping and DNS. */
export const PUBLIC_DNS = new Set(['8.8.8.8', '8.8.4.4', '1.1.1.1', '1.0.0.1']);

export type PingResult = 'ok' | 'unreachable' | 'timeout';

/** The host (and adapter) that owns an address, if any. */
export function ownerOf(s: LabState, ip: string): { host: HostName; nic: Nic } | null {
  for (const host of Object.values(s.hosts)) {
    for (const nic of host.nics) if (nic.ip === ip) return { host: host.name, nic };
  }
  return null;
}

function isApipa(ip: string | null): boolean {
  return !!ip && ip.startsWith('169.254.');
}

/** Whether `from` can reach an internet address at all. */
export function hasInternet(s: LabState, from: HostName): boolean {
  const h = s.hosts[from];
  if (h.nics.some((n) => n.network === 'internet' && n.ip && n.gateway)) return true;
  // A client reaches the internet through DC01, if DC01 is routing for it.
  const nic = internalNic(h);
  if (!nic?.ip || !nic.gateway || isApipa(nic.ip)) return false;
  const dcNic = internalNic(s.hosts.DC01);
  if (!dcNic?.ip || nic.gateway !== dcNic.ip) return false;
  return natWorks(s);
}

/** RAS/NAT is configured with the right inside and outside interfaces. */
export function natWorks(s: LabState): boolean {
  const r = s.routing;
  return (
    r.configured &&
    r.natInstalled &&
    s.hosts.DC01.services.RemoteAccess === 'Running' &&
    r.natInterfaces.Internet === 'public' &&
    r.natInterfaces.Internal === 'private'
  );
}

/** Whether `from` gets a reply from `ip`. */
export function ping(s: LabState, from: HostName, ip: string): PingResult {
  const src = s.hosts[from];
  if (src.nics.some((n) => n.ip === ip) || ip === '127.0.0.1') return 'ok';

  if (PUBLIC_DNS.has(ip) || ip === PLAN.homeRouter) {
    if (ip === PLAN.homeRouter) {
      return src.nics.some((n) => n.network === 'internet' && n.ip) ? 'ok' : 'unreachable';
    }
    return hasInternet(s, from) ? 'ok' : internalNic(src)?.gateway ? 'timeout' : 'unreachable';
  }

  const target = ownerOf(s, ip);
  // Every internal adapter shares one virtual switch; two hosts talk if they
  // agree on the subnet from both ends.
  for (const nic of src.nics) {
    if (!nic.ip || !nic.mask || isApipa(nic.ip)) continue;
    if (!sameSubnet(nic.ip, ip, nic.mask)) continue;
    if (!target) return 'timeout';
    if (target.nic.network !== nic.network) return 'timeout';
    if (!target.nic.mask || !sameSubnet(target.nic.ip!, nic.ip, target.nic.mask)) return 'timeout';
    return 'ok';
  }
  return 'unreachable';
}

/**
 * The DNS servers a host will ask, in order. The internal adapter is treated
 * as the preferred one — on DC01 that keeps the home router's resolver, handed
 * out on the Internet adapter, from answering for the AD domain.
 */
export function dnsServersOf(s: LabState, host: HostName): string[] {
  const out: string[] = [];
  const nics = [...s.hosts[host].nics].sort((a, b) =>
    a.network === b.network ? 0 : a.network === 'internal' ? -1 : 1,
  );
  for (const nic of nics) for (const d of nic.dns) if (!out.includes(d)) out.push(d);
  return out;
}

/** DC01's DNS service is up and holds the domain zone. */
export function dcDnsServes(s: LabState, zone = DOMAIN_FQDN): boolean {
  return s.hosts.DC01.services.DNS === 'Running' && s.dns.zones.includes(zone);
}

export type Resolution =
  | { ok: true; server: string; ip: string }
  | { ok: false; server: string | null; reason: 'no-server' | 'timeout' | 'nxdomain' };

/**
 * Resolve a name the way the host's resolver would: first configured server
 * that answers decides, and a public resolver has never heard of
 * corp.technobiz.local.
 */
export function resolve(s: LabState, from: HostName, rawName: string): Resolution {
  const name = rawName.toLowerCase().replace(/\.$/, '');
  const servers = dnsServersOf(s, from);
  if (servers.length === 0) return { ok: false, server: null, reason: 'no-server' };

  for (const server of servers) {
    const isSelf = server === '127.0.0.1' || server === '::1';
    const serverHost = isSelf ? from : ownerOf(s, server)?.host;
    const reach = isSelf ? 'ok' : ping(s, from, server);
    if (reach !== 'ok') continue;

    if (serverHost === 'DC01') {
      if (s.hosts.DC01.services.DNS !== 'Running') continue;
      const ans = answerFromDc(s, name);
      if (ans) return { ok: true, server, ip: ans };
      // The DC forwards what it is not authoritative for, when it can.
      if (publicName(name) && hasInternet(s, 'DC01')) return { ok: true, server, ip: '142.250.72.4' };
      return { ok: false, server, reason: 'nxdomain' };
    }
    if (PUBLIC_DNS.has(server) || server === PLAN.homeRouter) {
      if (publicName(name)) return { ok: true, server, ip: '142.250.72.4' };
      return { ok: false, server, reason: 'nxdomain' };
    }
  }
  return { ok: false, server: servers[0] ?? null, reason: 'timeout' };
}

function publicName(name: string): boolean {
  return !name.endsWith('.local') && name.includes('.') && !/^\d+\.\d+\.\d+\.\d+$/.test(name);
}

function answerFromDc(s: LabState, name: string): string | null {
  for (const zone of s.dns.zones) {
    if (name === zone) {
      // The domain name resolves to its domain controllers. A real multi-homed
      // DC registers every adapter; clients get the one on their own subnet.
      return pickRecord(s, s.dns.records.filter((r) => r.zone === zone && r.name === '@'));
    }
    if (name === `_ldap._tcp.dc._msdcs.${zone}`) {
      const dc = s.hosts.DC01.hostname.toLowerCase();
      return pickRecord(s, s.dns.records.filter((r) => r.zone === zone && r.name === dc));
    }
    if (name.endsWith(`.${zone}`)) {
      const label = name.slice(0, -zone.length - 1);
      const rec = s.dns.records.find((r) => r.zone === zone && r.name === label);
      if (rec) return rec.ip;
    }
  }
  return null;
}

function pickRecord(s: LabState, recs: { ip: string }[]): string | null {
  const internal = recs.find((r) => r.ip === PLAN.dcInternalIp);
  return (internal ?? recs[0])?.ip ?? null;
}

/** Why CLIENT01 (or any host) cannot locate a DC for the domain, or null if it can. */
export function locateDcProblem(s: LabState, from: HostName): string | null {
  if (!s.ad.forest) return 'no-forest';
  const nic = internalNic(s.hosts[from]);
  if (!nic?.ip || isApipa(nic.ip)) return 'no-address';
  const srv = resolve(s, from, `_ldap._tcp.dc._msdcs.${s.ad.forest}`);
  if (!srv.ok) return srv.reason === 'no-server' ? 'no-dns' : 'dns-cannot-locate';
  if (ping(s, from, srv.ip) !== 'ok') return 'dc-unreachable';
  return null;
}
