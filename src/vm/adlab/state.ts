/**
 * vm/adlab/state.ts — the simulated estate of the Active Directory Enterprise
 * Lab Series.
 *
 * Two machines on the architecture the series is built around:
 *
 *   INTERNET ── NIC "Internet" (DHCP from the home router)
 *                    │
 *                  DC01  (Windows Server 2019: AD DS, DNS, DHCP, RAS/NAT)
 *                    │
 *               NIC "Internal" 172.16.0.1/24, no gateway, DNS 127.0.0.1
 *                    │
 *             ── internal lab network ──
 *                    │
 *               NIC "Ethernet" (DHCP from DC01)
 *                    │
 *                CLIENT01 (Windows 10)
 *
 * This file only describes the shape and the starting point. The one thing
 * that changes it is vm/adlab/commands.ts — the commands the *student* types.
 * The instructor gets a frozen copy (vm/adlab/observe.ts) and nothing else.
 */

export type HostName = 'DC01' | 'CLIENT01';

export const DOMAIN_FQDN = 'corp.technobiz.local';
export const DOMAIN_NETBIOS = 'CORP';
export const DOMAIN_DN = 'DC=corp,DC=technobiz,DC=local';

/** Addressing the series is designed around. The validators read these. */
export const PLAN = {
  dcInternalIp: '172.16.0.1',
  mask: '255.255.255.0',
  prefix: 24,
  network: '172.16.0.0',
  scopeStart: '172.16.0.100',
  scopeEnd: '172.16.0.200',
  homeRouter: '192.168.1.1',
  dcInternetIp: '192.168.1.50',
} as const;

export interface Nic {
  /** InterfaceAlias, e.g. "Internet", "Internal", "Ethernet". */
  alias: string;
  /** Which virtual network the adapter is plugged into. */
  network: 'internet' | 'internal';
  mac: string;
  /** Whether IPv4 addressing comes from DHCP or was typed in. */
  dhcp: boolean;
  ip: string | null;
  mask: string | null;
  gateway: string | null;
  /**
   * DNS servers the adapter uses. `dnsStatic` says whether these were typed
   * in — static DNS wins over whatever DHCP offers, exactly as on Windows.
   */
  dns: string[];
  dnsStatic: boolean;
  /** Where the current lease came from, when `dhcp` is true. */
  leaseFrom: string | null;
  connectionSuffix: string | null;
}

export type ServiceStatus = 'Running' | 'Stopped';

export interface Host {
  name: HostName;
  /** The computer name currently in effect. */
  hostname: string;
  /** A Rename-Computer that waits for a restart. */
  pendingHostname: string | null;
  os: string;
  nics: Nic[];
  /** Joined domain FQDN, or null in a workgroup. */
  domain: string | null;
  /** An Add-Computer that waits for a restart. */
  pendingDomain: string | null;
  /** Installed Windows features by name (Install-WindowsFeature). */
  features: string[];
  services: Record<string, ServiceStatus>;
  /** Group Policy objects this computer has applied (gpupdate). */
  appliedGpos: string[];
  /** Directories that exist on disk (for shares). Lowercased paths. */
  folders: string[];
  restartPending: boolean;
}

export interface AdUser {
  sam: string;
  name: string;
  givenName: string;
  surname: string;
  /** Distinguished name of the containing OU/container. */
  parent: string;
  enabled: boolean;
  lockedOut: boolean;
  badPwdCount: number;
  passwordSet: boolean;
  changePasswordAtLogon: boolean;
  /** Epoch ms of the last password reset by an admin, if any. */
  passwordLastResetByAdmin: number | null;
  department: string | null;
}

export interface AdGroup {
  name: string;
  parent: string;
  scope: 'Global' | 'DomainLocal' | 'Universal';
  category: 'Security' | 'Distribution';
  /** sAMAccountNames of members (users or groups). */
  members: string[];
  builtin: boolean;
}

export interface AdComputer {
  name: string;
  parent: string;
}

export interface Gpo {
  name: string;
  /** DNs the GPO is linked to. */
  links: string[];
}

export interface AdState {
  /** Forest root FQDN, or null before promotion. */
  forest: string | null;
  netbios: string | null;
  /** OU distinguished names (not the built-in containers). */
  ous: string[];
  users: AdUser[];
  groups: AdGroup[];
  computers: AdComputer[];
  gpos: Gpo[];
  passwordPolicy: {
    minPasswordLength: number;
    lockoutThreshold: number;
    complexityEnabled: boolean;
  };
}

export interface DhcpScope {
  scopeId: string;
  name: string;
  start: string;
  end: string;
  mask: string;
  active: boolean;
  router: string | null;
  dns: string[];
  dnsDomain: string | null;
}

export interface DhcpLease {
  ip: string;
  hostname: string;
  mac: string;
  scopeId: string;
}

export interface DhcpState {
  authorized: boolean;
  /** Server-level options, inherited by every scope that does not override them. */
  serverOptions: { router: string | null; dns: string[]; dnsDomain: string | null };
  scopes: DhcpScope[];
  leases: DhcpLease[];
}

export interface DnsState {
  zones: string[];
  /** A records per zone: name → IP. */
  records: { zone: string; name: string; ip: string }[];
}

export interface RoutingState {
  /** Install-RemoteAccess -VpnType RoutingOnly has run. */
  configured: boolean;
  natInstalled: boolean;
  /** Interface alias → NAT role. */
  natInterfaces: Record<string, 'public' | 'private'>;
}

export interface ShareAce {
  identity: string;
  rights: 'Full' | 'Change' | 'Read';
}

export interface NtfsAce {
  identity: string;
  rights: 'F' | 'M' | 'RX' | 'R' | 'W';
  /** Inherited from the parent folder — /remove cannot touch it until inheritance is broken. */
  inherited: boolean;
}

export interface Share {
  name: string;
  path: string;
  access: ShareAce[];
}

export interface ShellEntry {
  host: HostName;
  shell: 'powershell';
  command: string;
  /** First lines of what the student saw. */
  output: string;
  ok: boolean;
  /**
   * False when the outcome is unknown — history read from a real VM's
   * PSReadLine file records the command, not whether it worked.
   */
  outcomeKnown?: boolean;
  at: number;
}

export interface EventEntry {
  host: HostName;
  log: 'System' | 'Security' | 'Application' | 'Directory Service' | 'DNS Server';
  id: number;
  level: 'Information' | 'Warning' | 'Error' | 'Audit Success' | 'Audit Failure';
  source: string;
  message: string;
  at: number;
}

export interface LabState {
  hosts: Record<HostName, Host>;
  ad: AdState;
  dhcp: DhcpState;
  dns: DnsState;
  routing: RoutingState;
  shares: Share[];
  /** NTFS ACLs by lowercased folder path. */
  ntfs: Record<string, NtfsAce[]>;
  history: ShellEntry[];
  events: EventEntry[];
  /** A logical clock so ordering survives JSON round trips. */
  tick: number;
}

// ---------------------------------------------------------------------------
// Starting point
// ---------------------------------------------------------------------------

const DC_DEFAULT_SERVICES: Record<string, ServiceStatus> = {
  Dnscache: 'Running',
  LanmanServer: 'Running',
  W32Time: 'Running',
  WinRM: 'Running',
};

const CLIENT_DEFAULT_SERVICES: Record<string, ServiceStatus> = {
  Dnscache: 'Running',
  Dhcp: 'Running',
  Netlogon: 'Stopped',
  gpsvc: 'Running',
};

/**
 * Two freshly installed machines, exactly as they come off the ISOs.
 *
 * DC01 is still called by its random setup name and its internal adapter is
 * on DHCP with nothing to answer it — the first lab's job is to fix both.
 */
export function freshState(): LabState {
  return {
    hosts: {
      DC01: {
        name: 'DC01',
        hostname: 'WIN-7Q2K9STBL4',
        pendingHostname: null,
        os: 'Windows Server 2019 Standard',
        nics: [
          {
            alias: 'Internet',
            network: 'internet',
            mac: '00-15-5D-01-0A-01',
            dhcp: true,
            ip: PLAN.dcInternetIp,
            mask: PLAN.mask,
            gateway: PLAN.homeRouter,
            dns: [PLAN.homeRouter],
            dnsStatic: false,
            leaseFrom: PLAN.homeRouter,
            connectionSuffix: 'home',
          },
          {
            alias: 'Internal',
            network: 'internal',
            mac: '00-15-5D-01-0A-02',
            dhcp: true,
            // Nothing on the internal network hands out addresses yet.
            ip: '169.254.18.77',
            mask: '255.255.0.0',
            gateway: null,
            dns: [],
            dnsStatic: false,
            leaseFrom: null,
            connectionSuffix: null,
          },
        ],
        domain: null,
        pendingDomain: null,
        features: [],
        services: { ...DC_DEFAULT_SERVICES },
        appliedGpos: [],
        folders: ['c:\\', 'c:\\windows', 'c:\\users'],
        restartPending: false,
      },
      CLIENT01: {
        name: 'CLIENT01',
        hostname: 'CLIENT01',
        pendingHostname: null,
        os: 'Windows 10 Pro',
        nics: [
          {
            alias: 'Ethernet',
            network: 'internal',
            mac: '00-15-5D-01-0B-01',
            dhcp: true,
            ip: '169.254.40.12',
            mask: '255.255.0.0',
            gateway: null,
            dns: [],
            dnsStatic: false,
            leaseFrom: null,
            connectionSuffix: null,
          },
        ],
        domain: null,
        pendingDomain: null,
        features: [],
        services: { ...CLIENT_DEFAULT_SERVICES },
        appliedGpos: [],
        folders: ['c:\\', 'c:\\windows', 'c:\\users'],
        restartPending: false,
      },
    },
    ad: {
      forest: null,
      netbios: null,
      ous: [],
      users: [],
      groups: [],
      computers: [],
      gpos: [],
      passwordPolicy: { minPasswordLength: 7, lockoutThreshold: 0, complexityEnabled: true },
    },
    dhcp: {
      authorized: false,
      serverOptions: { router: null, dns: [], dnsDomain: null },
      scopes: [],
      leases: [],
    },
    dns: { zones: [], records: [] },
    routing: { configured: false, natInstalled: false, natInterfaces: {} },
    shares: [],
    ntfs: {},
    history: [],
    events: [],
    tick: 0,
  };
}

/** A deep copy that shares nothing with the original. */
export function cloneState(s: LabState): LabState {
  return JSON.parse(JSON.stringify(s)) as LabState;
}

// ---------------------------------------------------------------------------
// Small read helpers shared by the command engine, validators and observer
// ---------------------------------------------------------------------------

export function ipToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!;
}

export function intToIp(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

export function isValidIp(ip: string): boolean {
  return ipToInt(ip) !== null;
}

export function prefixToMask(prefix: number): string {
  const bits = prefix <= 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return intToIp(bits);
}

export function maskToPrefix(mask: string): number | null {
  const n = ipToInt(mask);
  if (n === null) return null;
  let count = 0;
  let seenZero = false;
  for (let i = 31; i >= 0; i--) {
    const bit = (n >>> i) & 1;
    if (bit === 1) {
      if (seenZero) return null;
      count++;
    } else seenZero = true;
  }
  return count;
}

export function sameSubnet(a: string, b: string, mask: string): boolean {
  const ai = ipToInt(a);
  const bi = ipToInt(b);
  const mi = ipToInt(mask);
  if (ai === null || bi === null || mi === null) return false;
  return (ai & mi) >>> 0 === (bi & mi) >>> 0;
}

export function internalNic(h: Host): Nic | undefined {
  return h.nics.find((n) => n.network === 'internal');
}

export function findUser(s: LabState, identity: string): AdUser | undefined {
  const id = identity.toLowerCase();
  return s.ad.users.find(
    (u) =>
      u.sam.toLowerCase() === id ||
      u.name.toLowerCase() === id ||
      `cn=${u.name},${u.parent}`.toLowerCase() === id,
  );
}

export function findGroup(s: LabState, identity: string): AdGroup | undefined {
  const id = identity.toLowerCase();
  return s.ad.groups.find(
    (g) => g.name.toLowerCase() === id || `cn=${g.name},${g.parent}`.toLowerCase() === id,
  );
}

export function dcIsPromoted(s: LabState): boolean {
  return s.ad.forest !== null;
}
