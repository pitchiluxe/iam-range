/**
 * vm/adlab/validation.ts — the examiner.
 *
 * Deterministic checks over the lab state. This, and only this, decides
 * whether a lab is technically correct. The instructor is handed the results
 * and turns them into coaching; it is never asked "is this right?", so a small
 * local model cannot hallucinate a pass or a failure.
 *
 * Each check also carries its three-rung hint ladder:
 *   1. direction      — where to look, no commands, no answers
 *   2. investigation  — which diagnostic tool to run and what field to read
 *   3. concept        — the principle to compare against
 * None of the rungs is the fix. The student still types it.
 */
import {
  DOMAIN_DN,
  DOMAIN_FQDN,
  DOMAIN_NETBIOS,
  type HostName,
  type LabState,
  PLAN,
  findGroup,
  findUser,
  internalNic,
  ipToInt,
  sameSubnet,
} from './state';
import { locateDcProblem, resolve } from './network';

export type HintLadder = readonly [direction: string, investigation: string, concept: string];

export interface ValidationInput {
  state: LabState;
  /** The student's written resolution, for ticket labs. */
  notes?: string;
}

export interface CheckOutcome {
  pass: boolean;
  /** What the examiner actually saw — facts, never advice. Fed to the instructor. */
  observed: string;
}

export interface CheckDef {
  label: string;
  group: ValidatorGroup;
  run: (i: ValidationInput) => CheckOutcome;
  hints: HintLadder;
}

export type ValidatorGroup =
  | 'validateDCNetworking'
  | 'validateADDS'
  | 'validateDNS'
  | 'validateRouting'
  | 'validateDHCP'
  | 'validateDomainJoin'
  | 'validateOUArchitecture'
  | 'validateUsers'
  | 'validateGroups'
  | 'validateGPO'
  | 'validatePermissions'
  | 'validateTicket';

export interface CheckResult extends CheckOutcome {
  id: string;
  label: string;
  group: ValidatorGroup;
}

// ---------------------------------------------------------------------------
// Shared expectations
// ---------------------------------------------------------------------------

export const EXPECT = {
  rootOu: `OU=TechnoBiz,${DOMAIN_DN}`,
  childOus: ['Users', 'Groups', 'Workstations', 'Servers'],
  deptOus: ['Finance', 'Sales', 'IT'],
  users: [
    { sam: 'sjohnson', name: 'Sarah Johnson', dept: 'Finance', group: 'GG-Finance' },
    { sam: 'mchen', name: 'Michael Chen', dept: 'Sales', group: 'GG-Sales' },
    { sam: 'apatel', name: 'Aisha Patel', dept: 'IT', group: 'GG-IT' },
  ],
  gpo: 'TB-Workstation-Baseline',
  minPasswordLength: 12,
  lockoutThreshold: 5,
  shareName: 'Finance',
  sharePath: 'c:\\shares\\finance',
  financeGroup: `${DOMAIN_NETBIOS}\\GG-Finance`,
} as const;

export const ouDn = (name: string): string => `OU=${name},${EXPECT.rootOu}`;
export const deptOuDn = (dept: string): string => `OU=${dept},${ouDn('Users')}`;

const eq = (a: string | null | undefined, b: string): boolean => (a ?? '').toLowerCase() === b.toLowerCase();

function dcNic(s: LabState) {
  return internalNic(s.hosts.DC01);
}

function clientNic(s: LabState) {
  return internalNic(s.hosts.CLIENT01);
}

function fmtList(xs: readonly string[]): string {
  return xs.length ? xs.join(', ') : '(none)';
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

export const CHECKS: Record<string, CheckDef> = {
  // --- DC networking -------------------------------------------------------
  'dc-hostname': {
    label: 'Server renamed to DC01',
    group: 'validateDCNetworking',
    run: ({ state: s }) => {
      const h = s.hosts.DC01;
      return {
        pass: eq(h.hostname, 'DC01') && !h.pendingHostname,
        observed: `DC01 hostname is "${h.hostname}"${h.pendingHostname ? `, rename to "${h.pendingHostname}" waiting for a restart` : ''}.`,
      };
    },
    hints: [
      'Look at what the server is currently called.',
      'Run hostname on DC01. If you already renamed it, ask yourself whether the change has taken effect yet.',
      'A computer name change is written immediately but only takes effect after a restart — and a DC should be named before it is promoted, because renaming a domain controller afterwards is a project of its own.',
    ],
  },
  'dc-internal-static': {
    label: 'Internal NIC uses a static address',
    group: 'validateDCNetworking',
    run: ({ state: s }) => {
      const n = dcNic(s);
      return { pass: !!n && !n.dhcp, observed: `DC01 "Internal" adapter: DHCP ${n?.dhcp ? 'enabled' : 'disabled'}, IPv4 ${n?.ip ?? 'none'}.` };
    },
    hints: [
      'Investigate how DC01\'s Internal adapter gets its address.',
      'Run ipconfig /all on DC01 and read "DHCP Enabled" and the IPv4 line for the Internal adapter.',
      'Every other machine will be told to find the domain controller at one fixed address. A server that provides DNS and DHCP cannot itself depend on DHCP for its address.',
    ],
  },
  'dc-internal-ip': {
    label: 'Internal NIC is 172.16.0.1 / 255.255.255.0',
    group: 'validateDCNetworking',
    run: ({ state: s }) => {
      const n = dcNic(s);
      return {
        pass: n?.ip === PLAN.dcInternalIp && n?.mask === PLAN.mask,
        observed: `DC01 Internal adapter: IP ${n?.ip ?? 'none'}, mask ${n?.mask ?? 'none'}.`,
      };
    },
    hints: [
      'Compare the Internal adapter\'s addressing with the lab\'s network design.',
      'Run Get-NetIPConfiguration -InterfaceAlias Internal on DC01 and compare the IPv4 address and prefix length with the architecture diagram.',
      'The diagram gives DC01 the first host address of a /24 network. A /24 prefix is the mask 255.255.255.0 — check that both the address and the mask match the plan exactly.',
    ],
  },
  'dc-internal-gateway': {
    label: 'Internal NIC has no default gateway',
    group: 'validateDCNetworking',
    run: ({ state: s }) => {
      const n = dcNic(s);
      return { pass: !!n && !n.gateway, observed: `DC01 Internal adapter default gateway: ${n?.gateway ?? '(empty)'}.` };
    },
    hints: [
      'Look at the default gateways configured on DC01.',
      'Run ipconfig on DC01 and look at the Default Gateway line for each adapter.',
      'A multi-homed server should have exactly one default gateway — on the adapter that actually leads to the internet. DC01 is the router for the internal network, so there is nothing "beyond" the Internal adapter to route to.',
    ],
  },
  'dc-dns-self': {
    label: 'DC01 uses itself for DNS (127.0.0.1)',
    group: 'validateDCNetworking',
    run: ({ state: s }) => {
      const n = dcNic(s);
      const first = n?.dns[0];
      return {
        pass: first === '127.0.0.1' || first === PLAN.dcInternalIp,
        observed: `DC01 Internal adapter DNS servers: ${fmtList(n?.dns ?? [])}${n?.dnsStatic ? ' (static)' : ''}.`,
      };
    },
    hints: [
      'Check which DNS server DC01\'s Internal adapter points at.',
      'Run Get-DnsClientServerAddress on DC01 and read the ServerAddresses for the Internal adapter.',
      'DC01 is about to become the DNS server for the whole domain. A DNS server that is also a domain controller should ask itself — the loopback address — so that it can always find its own domain records.',
    ],
  },
  'dc-internet-dhcp': {
    label: 'Internet NIC left on DHCP from the home router',
    group: 'validateDCNetworking',
    run: ({ state: s }) => {
      const n = s.hosts.DC01.nics.find((x) => x.network === 'internet');
      return { pass: !!n && n.dhcp && !!n.ip, observed: `DC01 "Internet" adapter: DHCP ${n?.dhcp ? 'enabled' : 'disabled'}, IP ${n?.ip ?? 'none'}, gateway ${n?.gateway ?? 'none'}.` };
    },
    hints: [
      'Review the outside-facing adapter as well as the inside one.',
      'Run ipconfig /all on DC01 and read the Internet adapter\'s DHCP Enabled and DHCP Server lines.',
      'The Internet adapter is plugged into the home network, which the lab does not own. It should keep taking whatever the home router hands out — including the only default gateway DC01 needs.',
    ],
  },

  // --- AD DS ---------------------------------------------------------------
  'adds-installed': {
    label: 'AD DS role installed on DC01',
    group: 'validateADDS',
    run: ({ state: s }) => ({
      pass: s.hosts.DC01.features.includes('AD-Domain-Services'),
      observed: `DC01 installed features: ${fmtList(s.hosts.DC01.features)}.`,
    }),
    hints: [
      'Look at which server roles are installed on DC01.',
      'Run Get-WindowsFeature on DC01 and look for Active Directory Domain Services.',
      'Promotion is a two-step process: the role\'s binaries are installed first, and only then does the promotion cmdlet exist to create the forest.',
    ],
  },
  'adds-forest': {
    label: 'Forest corp.technobiz.local (NetBIOS CORP) created',
    group: 'validateADDS',
    run: ({ state: s }) => ({
      pass: eq(s.ad.forest, DOMAIN_FQDN) && eq(s.ad.netbios, DOMAIN_NETBIOS),
      observed: s.ad.forest ? `Forest root is "${s.ad.forest}", NetBIOS "${s.ad.netbios}".` : 'DC01 has not been promoted; no forest exists.',
    }),
    hints: [
      'Confirm whether DC01 is a domain controller, and for which domain.',
      'Run Get-ADDomain on DC01 and read DNSRoot and NetBIOSName.',
      'The forest root name is permanent for this lab: every user principal name, DNS record and distinguished name is built from it. Compare it character by character with the requirement.',
    ],
  },
  'dns-record-internal': {
    label: 'Domain name resolves to the internal address',
    group: 'validateADDS',
    run: ({ state: s }) => {
      const recs = s.dns.records.filter((r) => r.zone === s.ad.forest && r.name === '@');
      return {
        pass: recs.some((r) => r.ip === PLAN.dcInternalIp),
        observed: `The ${s.ad.forest ?? '(no zone)'} zone's host records point at ${recs.map((r) => r.ip).join(', ') || 'nothing'}.`,
      };
    },
    hints: [
      'Check which address the domain name resolves to.',
      'On DC01 run nslookup corp.technobiz.local and compare the answer with DC01\'s Internal adapter address.',
      'A domain controller registers the addresses its adapters had when it was promoted. If the internal address was not in place yet, clients will be sent somewhere they cannot reach.',
    ],
  },

  // --- DNS -----------------------------------------------------------------
  'dns-service': {
    label: 'DNS Server service running on DC01',
    group: 'validateDNS',
    run: ({ state: s }) => ({ pass: s.hosts.DC01.services.DNS === 'Running', observed: `DC01 DNS service: ${s.hosts.DC01.services.DNS ?? 'not installed'}.` }),
    hints: [
      'Look at the state of DC01\'s name service.',
      'Run Get-Service DNS on DC01.',
      'Active Directory clients find domain controllers by asking DNS for service records. If the DNS Server service is not running, nothing can locate the domain even though AD itself is healthy.',
    ],
  },
  'dns-zone': {
    label: 'AD-integrated zone corp.technobiz.local exists',
    group: 'validateDNS',
    run: ({ state: s }) => ({ pass: s.dns.zones.includes(DOMAIN_FQDN), observed: `DNS zones on DC01: ${fmtList(s.dns.zones)}.` }),
    hints: [
      'Check which DNS zones DC01 hosts.',
      'Run nslookup corp.technobiz.local on DC01 and see whether DC01 answers authoritatively.',
      'Promoting the first DC with DNS creates the zone for the domain and the _msdcs zone that holds the service locator records.',
    ],
  },
  'dc-resolves-domain': {
    label: 'DC01 can resolve its own domain',
    group: 'validateDNS',
    run: ({ state: s }) => {
      const r = resolve(s, 'DC01', DOMAIN_FQDN);
      return { pass: r.ok && r.ip === PLAN.dcInternalIp, observed: r.ok ? `DC01 resolved ${DOMAIN_FQDN} to ${r.ip} via ${r.server}.` : `DC01 could not resolve ${DOMAIN_FQDN} (${r.reason}, server ${r.server ?? 'none'}).` };
    },
    hints: [
      'Test name resolution from the domain controller itself.',
      'On DC01 run nslookup corp.technobiz.local and note which server answered and what it returned.',
      'If the server asks someone other than itself, that other server has never heard of an internal .local domain.',
    ],
  },

  // --- Routing / NAT -------------------------------------------------------
  'ras-installed': {
    label: 'Remote Access with Routing installed',
    group: 'validateRouting',
    run: ({ state: s }) => {
      const f = s.hosts.DC01.features;
      return { pass: f.includes('RemoteAccess') && f.includes('Routing'), observed: `DC01 features: ${fmtList(f)}.` };
    },
    hints: [
      'Check which roles DC01 has for forwarding traffic.',
      'Run Get-WindowsFeature *Routing* and Get-WindowsFeature *Remote* on DC01.',
      'NAT on Windows Server is provided by Routing and Remote Access. The Remote Access role alone is not enough — the Routing role service provides the router.',
    ],
  },
  'ras-configured': {
    label: 'RRAS configured for routing and running',
    group: 'validateRouting',
    run: ({ state: s }) => ({
      pass: s.routing.configured && s.hosts.DC01.services.RemoteAccess === 'Running',
      observed: `RRAS configured: ${s.routing.configured}; RemoteAccess service: ${s.hosts.DC01.services.RemoteAccess ?? 'not installed'}.`,
    }),
    hints: [
      'Installing a role is not the same as configuring it.',
      'Run Get-RemoteAccess on DC01 and read RoutingStatus and ServiceStatus.',
      'RRAS stays unconfigured — and its service will not start — until you choose what it should do. This lab only needs it as a router.',
    ],
  },
  'nat-public': {
    label: 'NAT public interface is "Internet"',
    group: 'validateRouting',
    run: ({ state: s }) => ({ pass: s.routing.natInterfaces.Internet === 'public', observed: `NAT interfaces: ${JSON.stringify(s.routing.natInterfaces)}; NAT installed: ${s.routing.natInstalled}.` }),
    hints: [
      'Review which side of NAT each adapter is on.',
      'Run netsh routing ip nat show interface on DC01.',
      'NAT translates private addresses to the address of the adapter facing the outside world. That outside adapter must be marked as the public ("full") interface.',
    ],
  },
  'nat-private': {
    label: 'NAT private interface is "Internal"',
    group: 'validateRouting',
    run: ({ state: s }) => ({ pass: s.routing.natInterfaces.Internal === 'private', observed: `NAT interfaces: ${JSON.stringify(s.routing.natInterfaces)}.` }),
    hints: [
      'Review which side of NAT each adapter is on.',
      'Run netsh routing ip nat show interface on DC01 and look for the inside adapter.',
      'The adapter that faces the machines being translated is the private interface. Compare against the diagram: Outside = Internet, Inside = Internal.',
    ],
  },

  // --- DHCP ----------------------------------------------------------------
  'dhcp-installed': {
    label: 'DHCP Server role installed and running',
    group: 'validateDHCP',
    run: ({ state: s }) => ({
      pass: s.hosts.DC01.features.includes('DHCP') && s.hosts.DC01.services.DHCPServer === 'Running',
      observed: `DHCP feature: ${s.hosts.DC01.features.includes('DHCP')}; DHCPServer service: ${s.hosts.DC01.services.DHCPServer ?? 'not installed'}.`,
    }),
    hints: [
      'Check whether DC01 can hand out addresses at all.',
      'Run Get-WindowsFeature DHCP and Get-Service DHCPServer on DC01.',
      'The DHCP Server role has to be installed and its service running before any scope can answer.',
    ],
  },
  'dhcp-authorized': {
    label: 'DHCP server authorized in AD',
    group: 'validateDHCP',
    run: ({ state: s }) => ({ pass: s.dhcp.authorized, observed: `DHCP authorized in Active Directory: ${s.dhcp.authorized}.` }),
    hints: [
      'A DHCP server in a domain has to be allowed to serve.',
      'Run Get-DhcpServerInDC on DC01 and see whether DC01 is listed.',
      'Authorization in Active Directory prevents rogue DHCP servers. An unauthorized Windows DHCP server in a domain stays silent even when its scopes are perfect.',
    ],
  },
  'dhcp-scope': {
    label: 'Scope 172.16.0.100–200 / 255.255.255.0 exists',
    group: 'validateDHCP',
    run: ({ state: s }) => {
      const sc = s.dhcp.scopes.find((x) => sameSubnet(x.start, PLAN.dcInternalIp, x.mask));
      return {
        pass: !!sc && sc.start === PLAN.scopeStart && sc.end === PLAN.scopeEnd && sc.mask === PLAN.mask,
        observed: s.dhcp.scopes.length
          ? s.dhcp.scopes.map((x) => `scope ${x.scopeId} ${x.start}-${x.end} mask ${x.mask}`).join('; ')
          : 'No DHCP scopes exist.',
      };
    },
    hints: [
      'Compare the scope\'s address pool with the lab design.',
      'Run Get-DhcpServerv4Scope on DC01 and compare StartRange, EndRange and SubnetMask with the requirements.',
      'The pool must sit inside the same /24 as DC01\'s Internal adapter, and must not include addresses you assign statically such as .1.',
    ],
  },
  'dhcp-scope-active': {
    label: 'Scope is active',
    group: 'validateDHCP',
    run: ({ state: s }) => {
      const sc = s.dhcp.scopes.find((x) => sameSubnet(x.start, PLAN.dcInternalIp, x.mask));
      return { pass: !!sc?.active, observed: sc ? `Scope ${sc.scopeId} state: ${sc.active ? 'Active' : 'Inactive'}.` : 'No scope for 172.16.0.0/24.' };
    },
    hints: [
      'Check whether the scope is switched on.',
      'Read the State column of Get-DhcpServerv4Scope.',
      'An inactive scope is configured but hands out nothing — useful while you are building it, a fault when you are not.',
    ],
  },
  'dhcp-router': {
    label: 'Option 003 Router = 172.16.0.1',
    group: 'validateDHCP',
    run: ({ state: s }) => {
      const sc = s.dhcp.scopes.find((x) => sameSubnet(x.start, PLAN.dcInternalIp, x.mask));
      const router = sc?.router ?? s.dhcp.serverOptions.router;
      return { pass: router === PLAN.dcInternalIp, observed: `Effective router option for the internal scope: ${router ?? '(not set)'}.` };
    },
    hints: [
      'Check what default gateway clients will be told to use.',
      'Run Get-DhcpServerv4OptionValue -ScopeId 172.16.0.0 on DC01 and look at option 3.',
      'Clients reach the internet through DC01\'s NAT, so their gateway must be the address of DC01 on their own network. Watch for typos — 172.168.x.x is not the same network as 172.16.x.x.',
    ],
  },
  'dhcp-dns': {
    label: 'Option 006 DNS = 172.16.0.1',
    group: 'validateDHCP',
    run: ({ state: s }) => {
      const sc = s.dhcp.scopes.find((x) => sameSubnet(x.start, PLAN.dcInternalIp, x.mask));
      const dns = sc && sc.dns.length ? sc.dns : s.dhcp.serverOptions.dns;
      return { pass: dns[0] === PLAN.dcInternalIp, observed: `Effective DNS option for the internal scope: ${fmtList(dns)}.` };
    },
    hints: [
      'Check which DNS server the scope hands to clients.',
      'Run Get-DhcpServerv4OptionValue -ScopeId 172.16.0.0 on DC01 and look at option 6.',
      'Domain members must use the AD-integrated DNS service to find domain controllers. A public resolver will never know about corp.technobiz.local.',
    ],
  },
  'dhcp-domain': {
    label: 'Option 015 DNS domain = corp.technobiz.local',
    group: 'validateDHCP',
    run: ({ state: s }) => {
      const sc = s.dhcp.scopes.find((x) => sameSubnet(x.start, PLAN.dcInternalIp, x.mask));
      const d = sc?.dnsDomain ?? s.dhcp.serverOptions.dnsDomain;
      return { pass: eq(d, DOMAIN_FQDN), observed: `Effective DNS domain option: ${d ?? '(not set)'}.` };
    },
    hints: [
      'Check the DNS suffix clients are given.',
      'Look for option 15 in Get-DhcpServerv4OptionValue.',
      'The DNS domain option lets short names like dc01 resolve as dc01.corp.technobiz.local.',
    ],
  },
  'client-lease': {
    label: 'CLIENT01 leased an address from DC01',
    group: 'validateDHCP',
    run: ({ state: s }) => {
      const n = clientNic(s);
      const inRange = !!n?.ip && ipToInt(n.ip)! >= ipToInt(PLAN.scopeStart)! && ipToInt(n.ip)! <= ipToInt(PLAN.scopeEnd)!;
      return {
        pass: !!n?.dhcp && n.leaseFrom === PLAN.dcInternalIp && inRange,
        observed: `CLIENT01 Ethernet: DHCP ${n?.dhcp ? 'enabled' : 'disabled'}, IP ${n?.ip ?? 'none'}, DHCP server ${n?.leaseFrom ?? 'none'}.`,
      };
    },
    hints: [
      'Start from the client: did it actually receive an address?',
      'On CLIENT01 run ipconfig /all and read DHCP Enabled, IPv4 Address and DHCP Server. If you changed the server after the client last asked, the client has not asked again yet.',
      'A 169.254.x.x address means the client asked and nobody answered. A client only asks when its lease is renewed — it does not notice a new scope on its own.',
    ],
  },
  'client-dns-from-dhcp': {
    label: 'CLIENT01 received DNS 172.16.0.1',
    group: 'validateDHCP',
    run: ({ state: s }) => {
      const n = clientNic(s);
      return { pass: n?.dns[0] === PLAN.dcInternalIp, observed: `CLIENT01 DNS servers: ${fmtList(n?.dns ?? [])}${n?.dnsStatic ? ' (statically configured on the client)' : ''}.` };
    },
    hints: [
      'Compare the DNS server CLIENT01 is using with the DNS server you intended it to get.',
      'On CLIENT01 run ipconfig /all and read DNS Servers. Then compare with option 6 on the scope.',
      'If the scope is right and the client is still wrong, look at the client: DNS servers typed into an adapter override whatever DHCP offers.',
    ],
  },

  // --- Domain join ---------------------------------------------------------
  'client-dns-dc': {
    label: 'CLIENT01 uses DC01 for DNS',
    group: 'validateDomainJoin',
    run: ({ state: s }) => {
      const n = clientNic(s);
      return { pass: n?.dns[0] === PLAN.dcInternalIp, observed: `CLIENT01 DNS servers: ${fmtList(n?.dns ?? [])}${n?.dnsStatic ? ' (static)' : ' (from DHCP)'}; IP ${n?.ip ?? 'none'}.` };
    },
    hints: [
      'Investigate the client\'s DNS configuration.',
      'Run ipconfig /all on CLIENT01 and examine the DNS Servers field.',
      'Active Directory clients normally use the domain controller\'s DNS service to discover domain services. Compare CLIENT01\'s DNS server with DC01\'s internal IP address.',
    ],
  },
  'client-resolves-domain': {
    label: 'CLIENT01 can locate a domain controller',
    group: 'validateDomainJoin',
    run: ({ state: s }) => {
      const p = locateDcProblem(s, 'CLIENT01');
      const r = resolve(s, 'CLIENT01', DOMAIN_FQDN);
      return {
        pass: p === null,
        observed: p === null
          ? `CLIENT01 locates a DC for ${DOMAIN_FQDN}.`
          : `CLIENT01 cannot locate a DC (${p}). nslookup ${DOMAIN_FQDN} from CLIENT01: ${r.ok ? `resolves to ${r.ip}` : `${r.reason} via ${r.server ?? 'no server'}`}.`,
      };
    },
    hints: [
      'Separate "can I reach DC01" from "can I find the domain by name".',
      'From CLIENT01 run ping 172.16.0.1, then nslookup corp.technobiz.local. Compare the two results.',
      'If ping works but name resolution fails, the network path is fine and the problem is which DNS server is being asked.',
    ],
  },
  'client-joined': {
    label: 'CLIENT01 joined to corp.technobiz.local',
    group: 'validateDomainJoin',
    run: ({ state: s }) => {
      const h = s.hosts.CLIENT01;
      return {
        pass: eq(h.domain, DOMAIN_FQDN),
        observed: h.domain ? `CLIENT01 is a member of ${h.domain}.` : h.pendingDomain ? `CLIENT01 joined ${h.pendingDomain} but has not restarted yet.` : 'CLIENT01 is in WORKGROUP.',
      };
    },
    hints: [
      'Check CLIENT01\'s current domain membership.',
      'Run systeminfo on CLIENT01 and read the Domain line. If you ran Add-Computer, read what it printed.',
      'A domain join is completed by a restart. Until then, the computer object may exist in AD while the computer itself still thinks it is in a workgroup.',
    ],
  },
  'client-computer-object': {
    label: 'Computer object CLIENT01 exists in AD',
    group: 'validateDomainJoin',
    run: ({ state: s }) => {
      const c = s.ad.computers.find((x) => eq(x.name, 'CLIENT01'));
      return { pass: !!c, observed: c ? `Computer object: CN=CLIENT01,${c.parent}.` : 'No CLIENT01 computer object in AD.' };
    },
    hints: [
      'Look in the directory, not just on the client.',
      'On DC01 run Get-ADComputer -Filter *.',
      'Joining creates a computer account — the machine\'s own identity in the domain, with its own password.',
    ],
  },

  // --- OU architecture -----------------------------------------------------
  'ou-root': {
    label: 'Top-level OU "TechnoBiz"',
    group: 'validateOUArchitecture',
    run: ({ state: s }) => ({ pass: s.ad.ous.some((o) => eq(o, EXPECT.rootOu)), observed: `OUs: ${fmtList(s.ad.ous)}.` }),
    hints: [
      'Review the OU tree against the design.',
      'Run Get-ADOrganizationalUnit -Filter * on DC01 and read the DistinguishedName column.',
      'Custom objects belong in your own OU tree, not in the default CN=Users and CN=Computers containers — those are containers, and Group Policy cannot be linked to them.',
    ],
  },
  'ou-children': {
    label: 'Users, Groups, Workstations, Servers under TechnoBiz',
    group: 'validateOUArchitecture',
    run: ({ state: s }) => {
      const missing = EXPECT.childOus.filter((n) => !s.ad.ous.some((o) => eq(o, ouDn(n))));
      return { pass: missing.length === 0, observed: missing.length ? `Missing under TechnoBiz: ${missing.join(', ')}.` : 'All second-level OUs exist.' };
    },
    hints: [
      'Compare the second level of the tree with the design.',
      'Run Get-ADOrganizationalUnit -Filter * and check each child\'s DistinguishedName ends with OU=TechnoBiz,DC=corp,DC=technobiz,DC=local.',
      'An OU created without -Path lands at the top of the domain. The distinguished name reads from the object up to the root, so the parent OU must appear after it.',
    ],
  },
  'ou-departments': {
    label: 'Finance, Sales, IT under TechnoBiz\\Users',
    group: 'validateOUArchitecture',
    run: ({ state: s }) => {
      const missing = EXPECT.deptOus.filter((n) => !s.ad.ous.some((o) => eq(o, deptOuDn(n))));
      return { pass: missing.length === 0, observed: missing.length ? `Missing department OUs: ${missing.join(', ')}.` : 'All department OUs exist.' };
    },
    hints: [
      'Check the third level of the tree.',
      'Read the DistinguishedName of each department OU in Get-ADOrganizationalUnit -Filter *.',
      'Department OUs sit under TechnoBiz\\Users so that user policy and delegation can be applied per department.',
    ],
  },
  'client-in-workstations': {
    label: 'CLIENT01 moved to TechnoBiz\\Workstations',
    group: 'validateOUArchitecture',
    run: ({ state: s }) => {
      const c = s.ad.computers.find((x) => eq(x.name, 'CLIENT01'));
      return { pass: eq(c?.parent, ouDn('Workstations')), observed: c ? `CLIENT01 lives in ${c.parent}.` : 'CLIENT01 has no computer object.' };
    },
    hints: [
      'Find where CLIENT01\'s computer object lives now.',
      'Run Get-ADComputer CLIENT01 on DC01 and read the DistinguishedName.',
      'Joined computers land in the default Computers container. Workstation policy can only reach them once they are in an OU.',
    ],
  },

  // --- Users and groups ----------------------------------------------------
  'users-exist': {
    label: 'Users sjohnson, mchen, apatel exist',
    group: 'validateUsers',
    run: ({ state: s }) => {
      const missing = EXPECT.users.filter((u) => !findUser(s, u.sam)).map((u) => u.sam);
      return { pass: missing.length === 0, observed: missing.length ? `Missing accounts: ${missing.join(', ')}. Existing: ${s.ad.users.map((u) => u.sam).join(', ')}.` : 'All three accounts exist.' };
    },
    hints: [
      'Check which accounts exist in the directory.',
      'Run Get-ADUser -Filter * on DC01 and compare SamAccountName with the requirements table.',
      'The sAMAccountName is the logon name. If you did not supply one, Windows used the Name you gave — including its space.',
    ],
  },
  'users-placement': {
    label: 'Each user is in their department OU',
    group: 'validateUsers',
    run: ({ state: s }) => {
      const wrong = EXPECT.users.filter((e) => { const u = findUser(s, e.sam); return u && !eq(u.parent, deptOuDn(e.dept)); }).map((e) => `${e.sam} in ${findUser(s, e.sam)!.parent}`);
      return { pass: wrong.length === 0 && EXPECT.users.every((e) => findUser(s, e.sam)), observed: wrong.length ? `Misplaced: ${wrong.join('; ')}.` : 'Placement correct for all existing accounts.' };
    },
    hints: [
      'Check where each account was created.',
      'Run Get-ADUser <name> and read DistinguishedName for each user.',
      'Without -Path, New-ADUser puts accounts in CN=Users. Department OUs only help if the accounts are actually in them.',
    ],
  },
  'users-enabled': {
    label: 'Accounts enabled with a password set',
    group: 'validateUsers',
    run: ({ state: s }) => {
      const bad = EXPECT.users.map((e) => findUser(s, e.sam)).filter((u) => u && (!u.enabled || !u.passwordSet)).map((u) => `${u!.sam} (enabled ${u!.enabled}, password ${u!.passwordSet ? 'set' : 'not set'})`);
      return { pass: bad.length === 0 && EXPECT.users.every((e) => findUser(s, e.sam)), observed: bad.length ? `Not ready: ${bad.join('; ')}.` : 'All accounts enabled with passwords.' };
    },
    hints: [
      'Can these people actually sign in?',
      'Run Get-ADUser <name> and read Enabled.',
      'An account created without a password is created disabled; one that meets the policy can be enabled.',
    ],
  },
  'users-change-at-logon': {
    label: 'Users must change password at first logon',
    group: 'validateUsers',
    run: ({ state: s }) => {
      const bad = EXPECT.users.map((e) => findUser(s, e.sam)).filter((u) => u && !u.changePasswordAtLogon).map((u) => u!.sam);
      return { pass: bad.length === 0 && EXPECT.users.every((e) => findUser(s, e.sam)), observed: bad.length ? `Not flagged to change password: ${bad.join(', ')}.` : 'All flagged.' };
    },
    hints: [
      'Think about who knows the initial password.',
      'Run Get-ADUser <name> -Properties PasswordExpired.',
      'You chose the initial password, so you know it. Forcing a change at first logon means only the user knows the password they actually use.',
    ],
  },
  'groups-exist': {
    label: 'GG-Finance, GG-Sales, GG-IT (Global Security) in TechnoBiz\\Groups',
    group: 'validateGroups',
    run: ({ state: s }) => {
      const bad: string[] = [];
      for (const n of ['GG-Finance', 'GG-Sales', 'GG-IT']) {
        const g = findGroup(s, n);
        if (!g) bad.push(`${n} missing`);
        else if (g.scope !== 'Global' || g.category !== 'Security' || !eq(g.parent, ouDn('Groups'))) bad.push(`${n} is ${g.scope}/${g.category} in ${g.parent}`);
      }
      return { pass: bad.length === 0, observed: bad.length ? bad.join('; ') + '.' : 'All three groups correct.' };
    },
    hints: [
      'Review the groups against the requirement: name, scope, type and location.',
      'Run Get-ADGroup -Filter * and read GroupScope, GroupCategory and DistinguishedName.',
      'Global security groups collect users from this domain so that permissions can be granted once to the group, not to each person.',
    ],
  },
  'group-membership': {
    label: 'Each user is a member of their department group',
    group: 'validateGroups',
    run: ({ state: s }) => {
      const bad: string[] = [];
      for (const e of EXPECT.users) {
        const g = findGroup(s, e.group);
        if (!g?.members.includes(e.sam)) bad.push(`${e.sam} not in ${e.group}`);
        for (const other of EXPECT.users.filter((x) => x.group !== e.group)) {
          if (findGroup(s, other.group)?.members.includes(e.sam)) bad.push(`${e.sam} is also in ${other.group}`);
        }
      }
      return { pass: bad.length === 0, observed: bad.length ? bad.join('; ') + '.' : 'Membership matches departments.' };
    },
    hints: [
      'Compare membership with each person\'s department.',
      'Run Get-ADGroupMember GG-Finance (and the others).',
      'Least privilege: each person is in the group for their own department and no other. An extra membership is access nobody approved.',
    ],
  },

  // --- GPO -----------------------------------------------------------------
  'pwd-policy': {
    label: 'Domain password policy: min length 12, lockout after 5',
    group: 'validateGPO',
    run: ({ state: s }) => {
      const p = s.ad.passwordPolicy;
      return { pass: p.minPasswordLength >= EXPECT.minPasswordLength && p.lockoutThreshold === EXPECT.lockoutThreshold, observed: `MinPasswordLength ${p.minPasswordLength}, LockoutThreshold ${p.lockoutThreshold}, Complexity ${p.complexityEnabled}.` };
    },
    hints: [
      'Review the domain\'s password and lockout policy.',
      'Run Get-ADDefaultDomainPasswordPolicy on DC01.',
      'Domain password policy lives at the domain level (the Default Domain Policy), not in a GPO linked to an OU.',
    ],
  },
  'gpo-created': {
    label: 'GPO TB-Workstation-Baseline exists',
    group: 'validateGPO',
    run: ({ state: s }) => ({ pass: s.ad.gpos.some((g) => eq(g.name, EXPECT.gpo)), observed: `GPOs: ${s.ad.gpos.map((g) => g.name).join(', ') || '(none)'}.` }),
    hints: [
      'Check which Group Policy objects exist.',
      'Run Get-GPO -All on DC01.',
      'A GPO is created once and can then be linked wherever it should apply.',
    ],
  },
  'gpo-linked': {
    label: 'GPO linked to TechnoBiz\\Workstations',
    group: 'validateGPO',
    run: ({ state: s }) => {
      const g = s.ad.gpos.find((x) => eq(x.name, EXPECT.gpo));
      return { pass: !!g?.links.some((l) => eq(l, ouDn('Workstations'))), observed: g ? `${g.name} is linked to: ${fmtList(g.links)}.` : 'GPO does not exist.' };
    },
    hints: [
      'An unlinked GPO applies to nothing.',
      'Run Get-GPO -All and read LinkedTo for the baseline GPO.',
      'Link computer policy to the OU that holds the computers — and check CLIENT01 is actually in that OU.',
    ],
  },
  'gpo-applied': {
    label: 'CLIENT01 has applied the baseline GPO',
    group: 'validateGPO',
    run: ({ state: s }) => ({ pass: s.hosts.CLIENT01.appliedGpos.some((g) => eq(g, EXPECT.gpo)), observed: `CLIENT01 applied GPOs: ${fmtList(s.hosts.CLIENT01.appliedGpos)}.` }),
    hints: [
      'Verify from the client, not from the server.',
      'On CLIENT01 run gpupdate /force, then gpresult /r and read Applied Group Policy Objects.',
      'Policy is pulled by the client on its own schedule. Forcing an update and reading gpresult is how you prove a policy reached the machine.',
    ],
  },

  // --- Permissions ---------------------------------------------------------
  'share-exists': {
    label: 'Share "Finance" → C:\\Shares\\Finance',
    group: 'validatePermissions',
    run: ({ state: s }) => {
      const sh = s.shares.find((x) => eq(x.name, EXPECT.shareName));
      return { pass: !!sh && eq(sh.path.replace(/\\+$/, ''), EXPECT.sharePath), observed: sh ? `Share ${sh.name} → ${sh.path}.` : `Shares: ${s.shares.map((x) => x.name).join(', ') || '(none)'}; folders on DC01: ${s.hosts.DC01.folders.filter((f) => f.includes('share')).join(', ') || '(no share folders)'}.` };
    },
    hints: [
      'Check the folder and the share separately.',
      'Run Test-Path C:\\Shares\\Finance and Get-SmbShare on DC01.',
      'A share is a network doorway onto a folder; the folder has to exist first.',
    ],
  },
  'share-no-everyone': {
    label: 'Share permissions do not grant Everyone',
    group: 'validatePermissions',
    run: ({ state: s }) => {
      const sh = s.shares.find((x) => eq(x.name, EXPECT.shareName));
      return { pass: !!sh && !sh.access.some((a) => a.identity === 'Everyone'), observed: sh ? `Share ACL: ${sh.access.map((a) => `${a.identity}=${a.rights}`).join(', ')}.` : 'Share missing.' };
    },
    hints: [
      'Who can open this share over the network?',
      'Run Get-SmbShareAccess Finance on DC01.',
      'When no access is specified, a new share grants Everyone read. Finance data should be reachable only by the group that needs it.',
    ],
  },
  'share-finance-access': {
    label: 'GG-Finance has Change on the share',
    group: 'validatePermissions',
    run: ({ state: s }) => {
      const sh = s.shares.find((x) => eq(x.name, EXPECT.shareName));
      const a = sh?.access.find((x) => eq(x.identity, EXPECT.financeGroup));
      return { pass: a?.rights === 'Change' || a?.rights === 'Full', observed: sh ? `Share ACL: ${sh.access.map((x) => `${x.identity}=${x.rights}`).join(', ')}.` : 'Share missing.' };
    },
    hints: [
      'Check the group, not the people.',
      'Run Get-SmbShareAccess Finance and look for CORP\\GG-Finance.',
      'Grant access to the department group so that joiners and leavers are handled by group membership, not by editing ACLs.',
    ],
  },
  'ntfs-finance-modify': {
    label: 'NTFS: GG-Finance has Modify',
    group: 'validatePermissions',
    run: ({ state: s }) => {
      const acl = s.ntfs[EXPECT.sharePath] ?? [];
      const a = acl.find((x) => eq(x.identity, EXPECT.financeGroup));
      return { pass: a?.rights === 'M' || a?.rights === 'F', observed: acl.length ? `NTFS ACL: ${acl.map((x) => `${x.identity}:${x.inherited ? '(I)' : ''}${x.rights}`).join(', ')}.` : 'Folder has no ACL (does not exist).' };
    },
    hints: [
      'Share permissions are only half the story.',
      'Run icacls C:\\Shares\\Finance on DC01.',
      'Effective access over the network is the more restrictive of the share and NTFS permissions — the group needs Modify on the folder itself too.',
    ],
  },
  'ntfs-no-users': {
    label: 'NTFS: BUILTIN\\Users removed',
    group: 'validatePermissions',
    run: ({ state: s }) => {
      const acl = s.ntfs[EXPECT.sharePath] ?? [];
      const u = acl.find((x) => x.identity === 'BUILTIN\\Users');
      return { pass: acl.length > 0 && !u, observed: acl.length ? `NTFS ACL: ${acl.map((x) => `${x.identity}:${x.inherited ? '(I)' : ''}${x.rights}`).join(', ')}.` : 'Folder missing.' };
    },
    hints: [
      'Look for broad groups that can still read the folder.',
      'Run icacls C:\\Shares\\Finance and look for BUILTIN\\Users. Note whether the entry is marked (I).',
      'An (I) entry is inherited from the parent folder; removing it has no effect until inheritance is broken on this folder and the entries are copied in as explicit ones.',
    ],
  },

  // --- Tickets -------------------------------------------------------------
  'ticket-unlocked': {
    label: 'Sarah Johnson can sign in (account not locked)',
    group: 'validateTicket',
    run: ({ state: s }) => {
      const u = findUser(s, 'sjohnson');
      return { pass: !!u && !u.lockedOut, observed: u ? `sjohnson: LockedOut ${u.lockedOut}, BadLogonCount ${u.badPwdCount}, Enabled ${u.enabled}.` : 'sjohnson not found.' };
    },
    hints: [
      'Start with the account, before the computer.',
      'On DC01 run Get-ADUser sjohnson -Properties LockedOut,BadLogonCount,Enabled.',
      'Locked, disabled and expired are three different states with three different fixes. Establish which one you are looking at before changing anything.',
    ],
  },
  'ticket-enabled': {
    label: 'Account still enabled',
    group: 'validateTicket',
    run: ({ state: s }) => {
      const u = findUser(s, 'sjohnson');
      return { pass: !!u?.enabled, observed: u ? `sjohnson Enabled: ${u.enabled}.` : 'sjohnson not found.' };
    },
    hints: [
      'Make sure the fix did not create a new problem.',
      'Run Get-ADUser sjohnson and read Enabled.',
      'A help-desk fix should change as little as possible — disabling an account is a leaver action, not a lockout fix.',
    ],
  },
  'ticket-client-dns': {
    label: 'CLIENT01 is back on AD DNS',
    group: 'validateTicket',
    run: (i) => CHECKS['client-dns-dc']!.run(i),
    hints: [
      'Gather information on the affected computer first.',
      'On CLIENT01 run ipconfig /all and compare DNS Servers with the design.',
      'Active Directory clients normally use the domain controller\'s DNS service to discover domain services. Compare CLIENT01\'s DNS server with DC01\'s internal IP address.',
    ],
  },
  'ticket-client-locates-dc': {
    label: 'CLIENT01 can locate the domain again',
    group: 'validateTicket',
    run: (i) => CHECKS['client-resolves-domain']!.run(i),
    hints: [
      'Separate connectivity from name resolution.',
      'On CLIENT01 run ping 172.16.0.1, then nslookup corp.technobiz.local.',
      'If ping succeeds and name resolution fails, the network path is fine — the question is which DNS server is being asked.',
    ],
  },
  'ticket-verified': {
    label: 'Fix verified from CLIENT01 after the change',
    group: 'validateTicket',
    run: ({ state: s }) => verifiedAfterChange(s, 'CLIENT01'),
    hints: [
      'A fix is not finished until you have seen it work.',
      'After your change, run a test on CLIENT01 that would have failed before: name resolution, the secure channel, or a policy update.',
      'Verification proves the root cause was the one you fixed. Without it, you are closing a ticket on a theory.',
    ],
  },
  'ticket-documented': {
    label: 'Resolution documented',
    group: 'validateTicket',
    run: ({ notes }) => {
      const n = (notes ?? '').trim();
      const words = n.split(/\s+/).filter(Boolean).length;
      return { pass: words >= 15, observed: n ? `Resolution notes: ${words} words.` : 'No resolution notes written.' };
    },
    hints: [
      'The ticket is not closed until the next technician can read what happened.',
      'Write the resolution in the notes box: symptom, evidence, root cause, fix, verification.',
      'Good resolution notes let someone else recognise the same problem in thirty seconds next time. At least a few full sentences.',
    ],
  },
};

const CHANGE_COMMANDS = /^(set-dnsclientserveraddress|new-netipaddress|set-netipinterface|netsh|ipconfig\s+\/renew|remove-netipaddress)/i;
const VERIFY_COMMANDS = /^(nslookup|resolve-dnsname|test-computersecurechannel|gpupdate|test-netconnection|tnc|ping)/i;

/** The student changed something on `host` and then proved it worked. */
function verifiedAfterChange(s: LabState, host: HostName): CheckOutcome {
  const mine = s.history.filter((h) => h.host === host);
  let lastChange = -1;
  // A real VM's history has no outcomes; there the live network state (below)
  // proves the test would pass, and the history proves it was run.
  mine.forEach((h, i) => {
    if (CHANGE_COMMANDS.test(h.command) && h.ok) lastChange = i;
  });
  const verified = mine.some((h, i) => i > lastChange && lastChange >= 0 && h.ok && VERIFY_COMMANDS.test(h.command));
  return {
    pass: verified && locateDcProblem(s, host) === null,
    observed: lastChange < 0
      ? `No configuration change has been made on ${host} yet.`
      : verified
        ? `A successful test ran on ${host} after the last change.`
        : `No successful test (nslookup, Test-ComputerSecureChannel, gpupdate…) has run on ${host} since the last change.`,
  };
}

// ---------------------------------------------------------------------------
// Running checks
// ---------------------------------------------------------------------------

export function runChecks(ids: readonly string[], input: ValidationInput): CheckResult[] {
  return ids.map((id) => {
    const def = CHECKS[id];
    if (!def) throw new Error(`Unknown lab check: ${id}`);
    let out: CheckOutcome;
    try {
      out = def.run(input);
    } catch (e) {
      out = { pass: false, observed: `Check could not run: ${(e as Error).message}` };
    }
    return { id, label: def.label, group: def.group, ...out };
  });
}

function group(g: ValidatorGroup): string[] {
  return Object.entries(CHECKS).filter(([, d]) => d.group === g).map(([id]) => id);
}

export const validateDCNetworking = (i: ValidationInput): CheckResult[] => runChecks(group('validateDCNetworking'), i);
export const validateADDS = (i: ValidationInput): CheckResult[] => runChecks(group('validateADDS'), i);
export const validateDNS = (i: ValidationInput): CheckResult[] => runChecks(group('validateDNS'), i);
export const validateRouting = (i: ValidationInput): CheckResult[] => runChecks(group('validateRouting'), i);
export const validateDHCP = (i: ValidationInput): CheckResult[] => runChecks(group('validateDHCP'), i);
export const validateDomainJoin = (i: ValidationInput): CheckResult[] => runChecks(group('validateDomainJoin'), i);
export const validateOUArchitecture = (i: ValidationInput): CheckResult[] => runChecks(group('validateOUArchitecture'), i);
export const validateUsers = (i: ValidationInput): CheckResult[] => runChecks(group('validateUsers'), i);
export const validateGroups = (i: ValidationInput): CheckResult[] => runChecks(group('validateGroups'), i);
export const validateGPO = (i: ValidationInput): CheckResult[] => runChecks(group('validateGPO'), i);
export const validatePermissions = (i: ValidationInput): CheckResult[] => runChecks(group('validatePermissions'), i);

export interface ValidationReport {
  labId: string;
  results: CheckResult[];
  passed: boolean;
  score: { passed: number; total: number };
}

export function validate(labId: string, checkIds: readonly string[], input: ValidationInput): ValidationReport {
  const results = runChecks(checkIds, input);
  const passedCount = results.filter((r) => r.pass).length;
  return {
    labId,
    results,
    passed: passedCount === results.length,
    score: { passed: passedCount, total: results.length },
  };
}

/** The check's rung-`level` hint (1–3). */
export function hintFor(checkId: string, level: 1 | 2 | 3): string {
  return CHECKS[checkId]?.hints[level - 1] ?? '';
}
