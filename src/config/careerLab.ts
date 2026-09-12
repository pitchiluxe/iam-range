/**
 * config/careerLab.ts — the four-year OMARI Technologies career curriculum.
 *
 * The Career Lab window uses this registry to show the learner where they are
 * in the four-year progression. The simulated workstation covers these topics
 * in the Manual and the documentation; the companion `omari-lab/` PowerShell
 * scripts build the real Hyper-V environment when the learner is on a host that
 * supports it.
 */

export interface CareerPhase {
  id: string;
  title: string;
  summary: string;
  skills: string[];
}

export interface CareerYear {
  id: string;
  number: number;
  title: string;
  summary: string;
  phases: CareerPhase[];
}

export const CAREER_YEARS: readonly CareerYear[] = [
  {
    id: 'year-1',
    number: 1,
    title: 'Year 1 · Help Desk / IT Support',
    summary:
      'Host readiness, Hyper-V, Windows administration, networking, Active Directory, ' +
      'DNS, DHCP, GPO, PowerShell, help-desk tickets and security fundamentals.',
    phases: [
      {
        id: 'y1-host',
        title: 'Host and Hyper-V readiness',
        summary: 'Validate the host, create a private virtual switch and prepare the VM storage.',
        skills: ['Hyper-V', 'virtual switches', 'host validation'],
      },
      {
        id: 'y1-windows',
        title: 'Windows administration',
        summary: 'Install Windows on the domain controller and client, configure services and local accounts.',
        skills: ['Windows Server', 'Windows 11', 'services', 'event viewer'],
      },
      {
        id: 'y1-network',
        title: 'Networking',
        summary: 'Set addresses, test connectivity, and understand private lab networking.',
        skills: ['IPv4', 'ping', 'nslookup', 'ipconfig'],
      },
      {
        id: 'y1-ad',
        title: 'Active Directory',
        summary: 'Promote DC01, create the OU tree and groups, and practise JML lifecycle.',
        skills: ['AD DS', 'OUs', 'groups', 'PowerShell'],
      },
      {
        id: 'y1-gpo',
        title: 'Group Policy',
        summary: 'Apply password and lockout policies, map drives, and control security settings.',
        skills: ['GPO', 'gpresult', 'gpupdate'],
      },
      {
        id: 'y1-helpdesk',
        title: 'Help-desk tickets',
        summary: 'Resolve realistic tickets using the simulated Ticket Queue and the real VM when available.',
        skills: ['troubleshooting', 'lockouts', 'mapped drives', 'printer issues'],
      },
    ],
  },
  {
    id: 'year-2',
    number: 2,
    title: 'Year 2 · IAM Analyst',
    summary:
      'IAM fundamentals, lifecycle, RBAC, SSO, MFA, access reviews, Entra/Okta workflows, ' +
      'and evidence collection.',
    phases: [
      {
        id: 'y2-fundamentals',
        title: 'IAM fundamentals',
        summary: 'Least privilege, joiner/mover/leaver, and the language of access control.',
        skills: ['RBAC', 'least privilege', 'JML'],
      },
      {
        id: 'y2-rbac',
        title: 'RBAC and entitlement',
        summary: 'Design role groups, find privilege creep and remediate it with evidence.',
        skills: ['group design', 'privilege creep', 'access reviews'],
      },
      {
        id: 'y2-sso',
        title: 'SSO and federation',
        summary: 'SAML, OIDC, claims and the common misconfigurations that break sign-in.',
        skills: ['SAML', 'OIDC', 'claims', 'certificates'],
      },
      {
        id: 'y2-mfa',
        title: 'MFA and conditional access',
        summary: 'Configure factors, block legacy auth and respond to prompt-fatigue attacks.',
        skills: ['MFA', 'conditional access', 'break-glass'],
      },
      {
        id: 'y2-hybrid',
        title: 'Hybrid identity and Entra sync',
        summary: 'Connect Active Directory to a cloud tenant and verify sync.',
        skills: ['Entra ID', 'Okta', 'directory sync', 'SCIM'],
      },
      {
        id: 'y2-capstone',
        title: 'IAM Analyst capstone',
        summary: 'Produce an evidence pack with findings, audit events and remediation.',
        skills: ['evidence', 'auditor review', 'SOPs'],
      },
    ],
  },
  {
    id: 'year-3',
    number: 3,
    title: 'Year 3 · IAM Engineer',
    summary:
      'Engineering standards, automation, REST APIs, IGA, PAM, secrets, and incident response.',
    phases: [
      {
        id: 'y3-standards',
        title: 'Engineering standards',
        summary: 'Write idempotent scripts, review code, and build safe automation.',
        skills: ['PowerShell', 'Python', 'code review', 'version control'],
      },
      {
        id: 'y3-apis',
        title: 'REST APIs and integrations',
        summary: 'Call identity APIs, handle tokens and build connectors safely.',
        skills: ['REST', 'JSON', 'OAuth', 'API keys'],
      },
      {
        id: 'y3-iga',
        title: 'Identity Governance Administration',
        summary: 'Run access-review campaigns, attestation and reporting.',
        skills: ['IGA', 'certification', 'recertification'],
      },
      {
        id: 'y3-pam',
        title: 'Privileged Access Management',
        summary: 'JIT elevation, break-glass and vaulting privileged credentials.',
        skills: ['PIM', 'JIT', 'PAM', 'session recording'],
      },
      {
        id: 'y3-incidents',
        title: 'IAM incidents',
        summary: 'Investigate leaked credentials, anomalous sign-ins and failed integrations.',
        skills: ['incident response', 'timelines', 'containment'],
      },
    ],
  },
  {
    id: 'year-4',
    number: 4,
    title: 'Year 4 · IAM Architect',
    summary:
      'IAM architecture, Zero Trust, governance, risk, IGA/PAM strategy, resilience, ' +
      'leadership and executive communication.',
    phases: [
      {
        id: 'y4-architecture',
        title: 'IAM architecture',
        summary: 'Produce architecture decision records for on-prem, cloud and hybrid identity.',
        skills: ['ADRs', 'reference architectures', 'hybrid identity'],
      },
      {
        id: 'y4-zerotrust',
        title: 'Zero Trust and identity perimeters',
        summary: 'Design identity as the primary security boundary.',
        skills: ['Zero Trust', 'conditional access', 'device trust'],
      },
      {
        id: 'y4-governance',
        title: 'Governance, risk and compliance',
        summary: 'Map controls to frameworks, build a risk register and lead attestation.',
        skills: ['NIST', 'ISO 27001', 'risk register', 'compliance'],
      },
      {
        id: 'y4-strategy',
        title: 'IGA/PAM strategy',
        summary: 'Select and integrate the tools that make IAM operations repeatable.',
        skills: ['tool selection', 'roadmaps', 'total cost of ownership'],
      },
      {
        id: 'y4-resilience',
        title: 'Resilience and DR',
        summary: 'Plan for identity provider failure, forest recovery and continuity.',
        skills: ['DR', 'backup', 'forests', 'break-glass drills'],
      },
      {
        id: 'y4-leadership',
        title: 'Leadership and executive capstone',
        summary: 'Present architecture decisions to a board and defend trade-offs.',
        skills: ['executive briefings', 'stakeholder management', 'communication'],
      },
    ],
  },
] as const;
