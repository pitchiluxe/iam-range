/**
 * vm/adlab/labs.ts — the Active Directory Enterprise Lab Series.
 *
 * Eleven labs that build TechnoBiz's first domain from two bare machines and
 * then break it in the ways real domains break. Each lab can be started on its
 * own: its starting estate is built by replaying the reference solutions of
 * every lab before it through the same command engine the student uses, so a
 * lab never begins from a state the student could not have produced.
 *
 * Labs describe what to achieve, never how. The commands in `solution` are the
 * lab designer's answer key — used to build later labs' starting points and to
 * prove in tests that every lab is passable. They are never shown to the
 * instructor model.
 */
import { runCommand } from './commands';
import { type HostName, type LabState, freshState, findUser } from './state';
import { EXPECT, deptOuDn, ouDn } from './validation';

export type InstructorMode = 'guided' | 'coach' | 'interview' | 'real-world';

export interface LabTicket {
  id: string;
  user: string;
  computer: HostName;
  issue: string;
  business: string;
  priority: 'P2' | 'P3';
}

export interface AdLab {
  id: string;
  number: number;
  title: string;
  /** One paragraph: what TechnoBiz needs and why. */
  scenario: string;
  objectives: string[];
  requirements: string[];
  expectedResult: string;
  tools: string[];
  /** Validation engine checks, in the order they are reported. */
  checks: string[];
  /** Questions Interview Mode asks while the lab is worked. */
  interviewQuestions: string[];
  /** Short, correct reference notes the instructor may teach from. */
  concepts: string[];
  ticket?: LabTicket;
  defaultMode: InstructorMode;
  /** Commands (host, line) that solve this lab from the previous lab's end state. */
  solution: [HostName, string][];
  /** Faults planted after the previous labs are replayed. */
  plant?: (s: LabState) => void;
}

const DN = 'DC=corp,DC=technobiz,DC=local';
const PW = '(ConvertTo-SecureString "TechnoBiz!2026x" -AsPlainText -Force)';

export const AD_LABS: readonly AdLab[] = [
  {
    id: 'adl-01',
    number: 1,
    title: 'DC01 Server Networking',
    scenario:
      'TechnoBiz has two freshly installed machines. The server that will become the first domain ' +
      'controller still has its random setup name, and its adapter on the internal lab network is ' +
      'waiting for a DHCP server that does not exist yet. Before any role goes on this box, it needs ' +
      'a permanent identity and a permanent address.',
    objectives: [
      'Rename the server to DC01.',
      'Give the Internal adapter the address from the network design, with no default gateway.',
      'Point DC01\'s internal DNS at itself.',
      'Leave the Internet adapter on DHCP from the home router.',
    ],
    requirements: [
      'Computer name: DC01',
      'Internal NIC: 172.16.0.1 / 255.255.255.0, gateway empty',
      'Internal NIC DNS: 127.0.0.1',
      'Internet NIC: DHCP (addressing from the home router)',
    ],
    expectedResult: 'hostname prints DC01, and ipconfig /all shows a static 172.16.0.1/24 Internal adapter using 127.0.0.1 for DNS.',
    tools: ['hostname', 'ipconfig /all', 'Get-NetAdapter', 'Get-NetIPConfiguration', 'Rename-Computer', 'New-NetIPAddress', 'Set-DnsClientServerAddress', 'Restart-Computer'],
    checks: ['dc-hostname', 'dc-internal-static', 'dc-internal-ip', 'dc-internal-gateway', 'dc-dns-self', 'dc-internet-dhcp'],
    interviewQuestions: [
      'Why should a domain controller use a static IP address?',
      'Why does the Internal adapter have no default gateway?',
      'Why does a DC point its DNS at itself rather than at a public resolver?',
    ],
    concepts: [
      'Servers that provide network services (DNS, DHCP, AD) use static addresses so clients can always find them.',
      'A multi-homed server should have one default gateway, on the adapter that leads towards the internet.',
      'A computer rename takes effect after a restart. Rename before promoting to a domain controller.',
    ],
    defaultMode: 'guided',
    solution: [
      ['DC01', 'Rename-Computer -NewName DC01'],
      ['DC01', 'Restart-Computer'],
      ['DC01', 'New-NetIPAddress -InterfaceAlias Internal -IPAddress 172.16.0.1 -PrefixLength 24'],
      ['DC01', 'Set-DnsClientServerAddress -InterfaceAlias Internal -ServerAddresses 127.0.0.1'],
    ],
  },
  {
    id: 'adl-02',
    number: 2,
    title: 'Deploy AD DS and DNS',
    scenario:
      'DC01 has a stable identity. TechnoBiz now needs its directory: a new forest, corp.technobiz.local, ' +
      'with DNS integrated so that every future computer can find the domain by name.',
    objectives: [
      'Install the Active Directory Domain Services role with its management tools.',
      'Create the forest corp.technobiz.local with NetBIOS name CORP and DNS.',
      'Confirm DC01 resolves its own domain to its internal address.',
    ],
    requirements: [
      'Forest / domain FQDN: corp.technobiz.local',
      'NetBIOS: CORP',
      'DNS Server installed with the domain',
      'The domain name must resolve to 172.16.0.1',
    ],
    expectedResult: 'Get-ADDomain shows corp.technobiz.local, and nslookup corp.technobiz.local on DC01 returns 172.16.0.1.',
    tools: ['Get-WindowsFeature', 'Install-WindowsFeature', 'Install-ADDSForest', 'Get-ADDomain', 'Get-Service', 'nslookup'],
    checks: ['adds-installed', 'adds-forest', 'dns-service', 'dns-zone', 'dns-record-internal', 'dc-resolves-domain'],
    interviewQuestions: [
      'What is the difference between a forest, a domain and a domain controller?',
      'Why does Active Directory depend on DNS?',
      'What would go wrong if the DC registered its Internet adapter address in DNS?',
    ],
    concepts: [
      'Installing the AD DS role only adds binaries; promotion (Install-ADDSForest) creates the forest.',
      'Clients locate domain controllers through DNS SRV records such as _ldap._tcp.dc._msdcs.<domain>.',
      'The first DC in a forest normally hosts the AD-integrated DNS zone for the domain.',
    ],
    defaultMode: 'guided',
    solution: [
      ['DC01', 'Install-WindowsFeature -Name AD-Domain-Services -IncludeManagementTools'],
      ['DC01', 'Install-ADDSForest -DomainName corp.technobiz.local -DomainNetbiosName CORP -InstallDns -Force'],
    ],
  },
  {
    id: 'adl-03',
    number: 3,
    title: 'RAS / NAT Routing',
    scenario:
      'Workstations on the internal network will need Windows Update and the web, but the internal ' +
      'network has no way out. DC01 has a foot in both networks, so it will route and translate for them.',
    objectives: [
      'Install Remote Access with the Routing role service.',
      'Configure RRAS for routing only.',
      'Enable NAT with Internet as the outside (public) interface and Internal as the inside (private) interface.',
    ],
    requirements: ['Outside: Internet', 'Inside: Internal', 'RemoteAccess service running'],
    expectedResult: 'netsh routing ip nat show interface lists Internet as public (full) and Internal as private.',
    tools: ['Install-WindowsFeature', 'Install-RemoteAccess', 'Get-RemoteAccess', 'netsh routing ip nat', 'Get-Service RemoteAccess'],
    checks: ['ras-installed', 'ras-configured', 'nat-public', 'nat-private'],
    interviewQuestions: [
      'What does NAT do, and why do the internal machines need it here?',
      'Why would a production network not normally route through a domain controller?',
    ],
    concepts: [
      'Network Address Translation rewrites private source addresses to the public interface address.',
      'On Windows Server, NAT is part of Routing and Remote Access (RRAS).',
    ],
    defaultMode: 'coach',
    solution: [
      ['DC01', 'Install-WindowsFeature -Name RemoteAccess,Routing -IncludeManagementTools'],
      ['DC01', 'Install-RemoteAccess -VpnType RoutingOnly'],
      ['DC01', 'netsh routing ip nat install'],
      ['DC01', 'netsh routing ip nat add interface "Internet" full'],
      ['DC01', 'netsh routing ip nat add interface "Internal" private'],
    ],
  },
  {
    id: 'adl-04',
    number: 4,
    title: 'DHCP Configuration',
    scenario:
      'TechnoBiz has deployed its first domain controller, but workstations on the corporate LAN currently ' +
      'require manual IP configuration. Your task is to deploy DHCP on DC01 so Windows workstations ' +
      'automatically receive valid network configurations.',
    objectives: [
      'Install and authorize the DHCP Server role on DC01.',
      'Create one scope for the internal network.',
      'Configure the router, DNS server and DNS domain options.',
      'Prove CLIENT01 receives the expected configuration.',
    ],
    requirements: [
      'Range: 172.16.0.100 – 172.16.0.200',
      'Mask: 255.255.255.0',
      'Gateway (003): 172.16.0.1',
      'DNS (006): 172.16.0.1',
      'DNS domain (015): corp.technobiz.local',
    ],
    expectedResult: 'ipconfig /all on CLIENT01 shows an address from the scope, DHCP Server 172.16.0.1, gateway 172.16.0.1 and DNS 172.16.0.1.',
    tools: ['Install-WindowsFeature', 'Add-DhcpServerInDC', 'Add-DhcpServerv4Scope', 'Set-DhcpServerv4OptionValue', 'Get-DhcpServerv4Scope', 'Get-DhcpServerv4Lease', 'ipconfig /renew', 'ipconfig /all'],
    checks: ['dhcp-installed', 'dhcp-authorized', 'dhcp-scope', 'dhcp-scope-active', 'dhcp-router', 'dhcp-dns', 'dhcp-domain', 'client-lease', 'client-dns-from-dhcp'],
    interviewQuestions: [
      'Why must a Windows DHCP server be authorized in Active Directory?',
      'What does a 169.254.x.x address tell you?',
      'What is the DORA process?',
    ],
    concepts: [
      'DHCP leases follow Discover, Offer, Request, Acknowledge (DORA).',
      'APIPA (169.254.0.0/16) means the client asked for an address and no DHCP server answered.',
      'DNS servers configured statically on an adapter override DNS servers offered by DHCP.',
    ],
    defaultMode: 'coach',
    solution: [
      ['DC01', 'Install-WindowsFeature -Name DHCP -IncludeManagementTools'],
      ['DC01', 'Add-DhcpServerInDC -DnsName dc01.corp.technobiz.local -IPAddress 172.16.0.1'],
      ['DC01', 'Add-DhcpServerv4Scope -Name "TechnoBiz LAN" -StartRange 172.16.0.100 -EndRange 172.16.0.200 -SubnetMask 255.255.255.0 -State Active'],
      ['DC01', 'Set-DhcpServerv4OptionValue -ScopeId 172.16.0.0 -Router 172.16.0.1 -DnsServer 172.16.0.1 -DnsDomain corp.technobiz.local'],
      ['CLIENT01', 'ipconfig /renew'],
    ],
  },
  {
    id: 'adl-05',
    number: 5,
    title: 'Join CLIENT01 to the Domain',
    scenario:
      'A technician on the night shift set CLIENT01 up by hand before DHCP existed and left a note: ' +
      '"network done, just needs joining." It now needs to become a member of corp.technobiz.local.',
    objectives: [
      'Make sure CLIENT01 can locate the domain.',
      'Join CLIENT01 to corp.technobiz.local and complete the join.',
      'Confirm the computer account exists in AD.',
    ],
    requirements: ['Domain: corp.technobiz.local', 'CLIENT01 must use AD DNS', 'Computer account CLIENT01 in AD'],
    expectedResult: 'systeminfo on CLIENT01 shows Domain: corp.technobiz.local and Get-ADComputer CLIENT01 succeeds on DC01.',
    tools: ['ipconfig /all', 'ping', 'nslookup', 'Set-NetIPInterface', 'Set-DnsClientServerAddress', 'Add-Computer', 'Restart-Computer', 'Get-ADComputer'],
    checks: ['client-dns-dc', 'client-resolves-domain', 'client-joined', 'client-computer-object'],
    interviewQuestions: [
      'What happens when an Active Directory client uses the wrong DNS server?',
      'What does joining a computer to a domain actually create?',
      'Why does a domain join need a restart?',
    ],
    concepts: [
      'Domain join begins with a DNS SRV lookup for a domain controller; a public resolver cannot answer for an internal domain.',
      'Joining creates a computer account with its own password (the secure channel).',
    ],
    defaultMode: 'coach',
    plant: (s) => {
      // The night-shift build: a hand-typed address and a public resolver.
      replay(s, [
        ['CLIENT01', 'New-NetIPAddress -InterfaceAlias Ethernet -IPAddress 172.16.0.105 -PrefixLength 24'],
        ['CLIENT01', 'Set-DnsClientServerAddress -InterfaceAlias Ethernet -ServerAddresses 8.8.8.8'],
      ]);
    },
    solution: [
      ['CLIENT01', 'Set-NetIPInterface -InterfaceAlias Ethernet -Dhcp Enabled'],
      ['CLIENT01', 'Set-DnsClientServerAddress -InterfaceAlias Ethernet -ResetServerAddresses'],
      ['CLIENT01', 'ipconfig /renew'],
      ['CLIENT01', 'Add-Computer -DomainName corp.technobiz.local -Credential CORP\\Administrator -Restart'],
    ],
  },
  {
    id: 'adl-06',
    number: 6,
    title: 'OU Architecture',
    scenario:
      'Everything in the domain is sitting in the default containers, where Group Policy cannot be ' +
      'linked and administration cannot be delegated. TechnoBiz needs an OU tree that mirrors how it ' +
      'will manage people and computers.',
    objectives: [
      'Create a top-level TechnoBiz OU.',
      'Create Users, Groups, Workstations and Servers beneath it.',
      'Create Finance, Sales and IT beneath TechnoBiz\\Users.',
      'Move CLIENT01 into TechnoBiz\\Workstations.',
    ],
    requirements: [
      `OU=TechnoBiz,${DN}`,
      'Second level: Users, Groups, Workstations, Servers',
      'Third level under Users: Finance, Sales, IT',
      'CLIENT01 in OU=Workstations',
    ],
    expectedResult: 'Get-ADOrganizationalUnit -Filter * shows the full tree and Get-ADComputer CLIENT01 lives in Workstations.',
    tools: ['New-ADOrganizationalUnit', 'Get-ADOrganizationalUnit', 'Get-ADComputer', 'Move-ADObject'],
    checks: ['ou-root', 'ou-children', 'ou-departments', 'client-in-workstations'],
    interviewQuestions: [
      'Explain the difference between an OU and a security group.',
      'Why can you not link a GPO to CN=Computers?',
      'How would you design OUs for delegation versus for policy?',
    ],
    concepts: [
      'OUs organise objects for administration and Group Policy; groups grant access.',
      'CN=Users and CN=Computers are containers, not OUs — GPOs cannot be linked to them.',
      'A distinguished name reads from the object up to the domain root.',
    ],
    defaultMode: 'coach',
    solution: [
      ['DC01', 'New-ADOrganizationalUnit -Name TechnoBiz'],
      ...EXPECT.childOus.map((n): [HostName, string] => ['DC01', `New-ADOrganizationalUnit -Name ${n} -Path "${EXPECT.rootOu}"`]),
      ...EXPECT.deptOus.map((n): [HostName, string] => ['DC01', `New-ADOrganizationalUnit -Name ${n} -Path "${ouDn('Users')}"`]),
      ['DC01', `Move-ADObject -Identity "CN=CLIENT01,CN=Computers,${DN}" -TargetPath "${ouDn('Workstations')}"`],
    ],
  },
  {
    id: 'adl-07',
    number: 7,
    title: 'Users and Security Groups',
    scenario:
      'Three new starters begin on Monday. HR has sent the details. Create their accounts where they ' +
      'belong and give them access through groups, never directly.',
    objectives: [
      'Create the three user accounts in their department OUs.',
      'Set an initial password, enable them, and require a change at first logon.',
      'Create one global security group per department in TechnoBiz\\Groups.',
      'Add each user to their own department group only.',
    ],
    requirements: [
      'Sarah Johnson — sjohnson — Finance — GG-Finance',
      'Michael Chen — mchen — Sales — GG-Sales',
      'Aisha Patel — apatel — IT — GG-IT',
      'Groups: Global, Security, in OU=Groups,OU=TechnoBiz',
    ],
    expectedResult: 'Get-ADUser and Get-ADGroupMember show each person enabled, in the right OU and in exactly one department group.',
    tools: ['New-ADUser', 'Get-ADUser', 'Set-ADUser', 'New-ADGroup', 'Add-ADGroupMember', 'Get-ADGroupMember'],
    checks: ['users-exist', 'users-placement', 'users-enabled', 'users-change-at-logon', 'groups-exist', 'group-membership'],
    interviewQuestions: [
      'Why grant access to groups rather than to users?',
      'What is the difference between Global, Domain Local and Universal groups?',
      'Why force a password change at first logon?',
    ],
    concepts: [
      'Role-based access: permissions are granted to groups; people get access by membership.',
      'Global groups hold accounts from their own domain.',
      'New-ADUser without -Path creates the account in CN=Users.',
    ],
    defaultMode: 'coach',
    solution: [
      ...EXPECT.users.map((u): [HostName, string] => {
        const [given, surname] = u.name.split(' ');
        return ['DC01', `New-ADUser -Name "${u.name}" -GivenName ${given} -Surname ${surname} -SamAccountName ${u.sam} -Department ${u.dept} -Path "${deptOuDn(u.dept)}" -AccountPassword ${PW} -Enabled $true -ChangePasswordAtLogon $true`];
      }),
      ...['GG-Finance', 'GG-Sales', 'GG-IT'].map((g): [HostName, string] => ['DC01', `New-ADGroup -Name ${g} -GroupScope Global -GroupCategory Security -Path "${ouDn('Groups')}"`]),
      ...EXPECT.users.map((u): [HostName, string] => ['DC01', `Add-ADGroupMember -Identity ${u.group} -Members ${u.sam}`]),
    ],
  },
  {
    id: 'adl-08',
    number: 8,
    title: 'Group Policy Baseline',
    scenario:
      'The auditors want a password and lockout policy that matches TechnoBiz\'s security standard, and a ' +
      'baseline GPO for every workstation that IT can build on.',
    objectives: [
      'Set the domain password policy: minimum length 12, lockout after 5 bad attempts.',
      'Create the GPO TB-Workstation-Baseline.',
      'Link it to TechnoBiz\\Workstations.',
      'Prove CLIENT01 has applied it.',
    ],
    requirements: ['MinPasswordLength ≥ 12', 'LockoutThreshold = 5', 'GPO TB-Workstation-Baseline linked to OU=Workstations,OU=TechnoBiz'],
    expectedResult: 'gpresult /r on CLIENT01 lists TB-Workstation-Baseline under Applied Group Policy Objects.',
    tools: ['Get-ADDefaultDomainPasswordPolicy', 'Set-ADDefaultDomainPasswordPolicy', 'New-GPO', 'New-GPLink', 'Get-GPO', 'gpupdate /force', 'gpresult /r'],
    checks: ['pwd-policy', 'gpo-created', 'gpo-linked', 'gpo-applied'],
    interviewQuestions: [
      'Why is the domain password policy not set in a GPO linked to an OU?',
      'What is the processing order LSDOU?',
      'How do you prove a GPO applied to a machine?',
    ],
    concepts: [
      'The domain password policy is defined at the domain (Default Domain Policy); OU-linked GPOs do not change it for domain accounts.',
      'GPOs apply in Local, Site, Domain, OU order; later wins.',
      'gpresult /r shows the GPOs a computer actually applied.',
    ],
    defaultMode: 'coach',
    solution: [
      ['DC01', 'Set-ADDefaultDomainPasswordPolicy -Identity corp.technobiz.local -MinPasswordLength 12 -LockoutThreshold 5'],
      ['DC01', `New-GPO -Name ${EXPECT.gpo}`],
      ['DC01', `New-GPLink -Name ${EXPECT.gpo} -Target "${ouDn('Workstations')}"`],
      ['CLIENT01', 'gpupdate /force'],
    ],
  },
  {
    id: 'adl-09',
    number: 9,
    title: 'Finance Share Permissions',
    scenario:
      'Finance needs a shared folder on DC01. Only Finance may open it, and a quarterly audit will read ' +
      'the ACLs, so broad groups inherited from the drive have to go.',
    objectives: [
      'Create C:\\Shares\\Finance on DC01 and share it as "Finance".',
      'Give GG-Finance Change on the share and nobody else broad access.',
      'Give GG-Finance Modify on the folder.',
      'Remove BUILTIN\\Users from the folder ACL.',
    ],
    requirements: ['Share: \\\\DC01\\Finance → C:\\Shares\\Finance', 'Share ACL: CORP\\GG-Finance Change, no Everyone', 'NTFS: CORP\\GG-Finance Modify, no BUILTIN\\Users'],
    expectedResult: 'Get-SmbShareAccess Finance and icacls C:\\Shares\\Finance show only administrators, SYSTEM and GG-Finance.',
    tools: ['New-Item', 'New-SmbShare', 'Get-SmbShareAccess', 'Grant-SmbShareAccess', 'Revoke-SmbShareAccess', 'icacls'],
    checks: ['share-exists', 'share-no-everyone', 'share-finance-access', 'ntfs-finance-modify', 'ntfs-no-users'],
    interviewQuestions: [
      'How do share and NTFS permissions combine?',
      'What does (I) mean in icacls output?',
      'Why grant to GG-Finance rather than to Sarah?',
    ],
    concepts: [
      'Over the network, effective access is the more restrictive of the share and NTFS permissions.',
      'Inherited ACEs cannot be removed from a child until inheritance is disabled on it.',
    ],
    defaultMode: 'coach',
    solution: [
      ['DC01', 'New-Item -Path C:\\Shares\\Finance -ItemType Directory'],
      ['DC01', 'New-SmbShare -Name Finance -Path C:\\Shares\\Finance -ChangeAccess "CORP\\GG-Finance"'],
      ['DC01', 'icacls C:\\Shares\\Finance /grant "CORP\\GG-Finance:(OI)(CI)M"'],
      ['DC01', 'icacls C:\\Shares\\Finance /inheritance:d'],
      ['DC01', 'icacls C:\\Shares\\Finance /remove "BUILTIN\\Users"'],
    ],
  },
  {
    id: 'adl-10',
    number: 10,
    title: 'Help Desk: INC-1047 Sign-in Failure',
    scenario: 'A ticket has come in from Finance. Work it the way the service desk works tickets.',
    objectives: [
      'Identify the problem.',
      'Gather evidence before changing anything.',
      'Fix the root cause with the smallest correct change.',
      'Verify and document the resolution.',
    ],
    requirements: ['User can sign in', 'Account left enabled', 'Resolution documented'],
    expectedResult: 'The user can sign in and the ticket notes explain symptom, cause, fix and verification.',
    tools: ['Get-ADUser -Properties', 'Search-ADAccount', 'Get-WinEvent', 'Unlock-ADAccount', 'Set-ADAccountPassword'],
    checks: ['ticket-unlocked', 'ticket-enabled', 'ticket-documented'],
    interviewQuestions: [
      'How do you tell a locked account from a disabled one?',
      'Does resetting a password unlock an account?',
      'Where would you find which computer caused the lockout?',
    ],
    concepts: [
      'Locked out (too many bad passwords), disabled (administratively off) and expired password are different states.',
      'Event 4740 on a domain controller records a lockout and the caller computer.',
      'Resetting a password does not clear a lockout.',
    ],
    ticket: {
      id: 'INC-1047',
      user: 'Sarah Johnson (sjohnson)',
      computer: 'CLIENT01',
      issue: '"I cannot sign into my computer this morning."',
      business: 'Month-end close starts at 10:00 and Sarah runs the Finance reconciliations.',
      priority: 'P2',
    },
    defaultMode: 'real-world',
    plant: (s) => {
      const u = findUser(s, 'sjohnson');
      if (u) {
        u.lockedOut = true;
        u.badPwdCount = 5;
      }
      for (let i = 0; i < 5; i++) {
        s.events.push({ host: 'DC01', log: 'Security', id: 4625, level: 'Audit Failure', source: 'Microsoft-Windows-Security-Auditing', message: 'An account failed to log on. Account Name: sjohnson. Workstation Name: CLIENT01. Failure Reason: Unknown user name or bad password.', at: ++s.tick });
      }
      s.events.push({ host: 'DC01', log: 'Security', id: 4740, level: 'Audit Success', source: 'Microsoft-Windows-Security-Auditing', message: 'A user account was locked out. Account That Was Locked Out: CORP\\sjohnson. Caller Computer Name: CLIENT01.', at: ++s.tick });
    },
    solution: [['DC01', 'Unlock-ADAccount -Identity sjohnson']],
  },
  {
    id: 'adl-11',
    number: 11,
    title: 'Help Desk: INC-1052 Workstation Cannot Reach the Domain',
    scenario: 'Another ticket. The user is signed in with cached credentials but nothing works properly.',
    objectives: [
      'Identify the problem.',
      'Gather information and form a theory.',
      'Test the theory, find the root cause, fix it yourself.',
      'Verify from the affected computer and document.',
    ],
    requirements: ['CLIENT01 locates the domain', 'Fix verified from CLIENT01 after the change', 'Resolution documented'],
    expectedResult: 'Name resolution and the secure channel work from CLIENT01, proven after the fix, with notes written.',
    tools: ['ipconfig /all', 'ping', 'nslookup', 'Test-ComputerSecureChannel', 'Get-WinEvent -LogName System', 'gpupdate /force'],
    checks: ['ticket-client-dns', 'ticket-client-locates-dc', 'ticket-verified', 'ticket-documented'],
    interviewQuestions: [
      'Ping works but nslookup fails. What does that narrow the problem down to?',
      'Why can someone still sign in when the DC is unreachable?',
    ],
    concepts: [
      'Cached credentials let a domain user sign in without contacting a DC.',
      'Successful ping plus failed name resolution points at DNS, not connectivity.',
      'Static DNS on an adapter overrides DHCP-provided DNS.',
    ],
    ticket: {
      id: 'INC-1052',
      user: 'Michael Chen (mchen)',
      computer: 'CLIENT01',
      issue: '"My mapped drives are gone and the intranet won\'t load. It was fine yesterday — someone from IT was on my PC last night fixing Wi-Fi."',
      business: 'Sales pipeline review with the regional director at 14:00.',
      priority: 'P3',
    },
    defaultMode: 'real-world',
    plant: (s) => {
      replay(s, [['CLIENT01', 'Set-DnsClientServerAddress -InterfaceAlias Ethernet -ServerAddresses 8.8.8.8,1.1.1.1']]);
      s.events.push({ host: 'CLIENT01', log: 'System', id: 5719, level: 'Error', source: 'NETLOGON', message: 'This computer was not able to set up a secure session with a domain controller in domain CORP due to the following: There are currently no logon servers available to service the logon request.', at: ++s.tick });
      s.events.push({ host: 'CLIENT01', log: 'System', id: 1129, level: 'Error', source: 'GroupPolicy', message: 'The processing of Group Policy failed because of lack of network connectivity to a domain controller.', at: ++s.tick });
    },
    solution: [
      ['CLIENT01', 'Set-DnsClientServerAddress -InterfaceAlias Ethernet -ResetServerAddresses'],
      ['CLIENT01', 'nslookup corp.technobiz.local'],
    ],
  },
];

/**
 * The machines a lab's checks read. Lab 01 only needs DC01, so a CLIENT01
 * that is still installing (or switched off to save RAM) must not block it.
 */
export function hostsForLab(lab: AdLab): HostName[] {
  const client = lab.checks.some((id) => /^(client-|ticket-client|ticket-verified|gpo-applied)/.test(id));
  return client ? ['DC01', 'CLIENT01'] : ['DC01'];
}

export function labById(id: string): AdLab | undefined {
  return AD_LABS.find((l) => l.id === id);
}

function replay(s: LabState, lines: readonly [HostName, string][]): void {
  for (const [host, line] of lines) runCommand(s, host, line);
}

/**
 * The estate a lab starts from: a fresh build with every earlier lab's
 * reference solution replayed, then this lab's faults planted. The replay's
 * command history is wiped — the student's lab memory starts empty.
 */
export function startingState(labId: string): LabState {
  const s = freshState();
  const idx = AD_LABS.findIndex((l) => l.id === labId);
  if (idx < 0) throw new Error(`Unknown lab: ${labId}`);
  for (const lab of AD_LABS.slice(0, idx)) {
    lab.plant?.(s);
    replay(s, lab.solution);
  }
  AD_LABS[idx]!.plant?.(s);
  s.history = [];
  return s;
}

/** Apply a lab's reference solution — tests use this to prove every lab is passable. */
export function applySolution(s: LabState, labId: string): void {
  const lab = labById(labId);
  if (lab) replay(s, lab.solution);
}
