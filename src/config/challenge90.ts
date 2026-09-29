/**
 * config/challenge90.ts — the 90-Day IAM Job-Ready Challenge.
 *
 * Thirteen one-week labs, days 1–90, from AD fundamentals to a job-ready
 * portfolio. The lab text lives in omari-lab/12-90-DAY-CHALLENGE/labs/*.md so
 * the learner can copy it straight into their GitHub repos; this module adds
 * the schedule around it. Each lab's deliverables are read from its own
 * "## Validation checklist" section, so the checklist in the window and the
 * one in the markdown can never disagree.
 */
import lab01 from '../../omari-lab/12-90-DAY-CHALLENGE/labs/lab-01-ad-enterprise-base.md?raw';
import lab02 from '../../omari-lab/12-90-DAY-CHALLENGE/labs/lab-02-powershell-ad-automation.md?raw';
import lab03 from '../../omari-lab/12-90-DAY-CHALLENGE/labs/lab-03-ad-troubleshooting.md?raw';
import lab04 from '../../omari-lab/12-90-DAY-CHALLENGE/labs/lab-04-entra-id-foundations.md?raw';
import lab05 from '../../omari-lab/12-90-DAY-CHALLENGE/labs/lab-05-mfa-and-sso.md?raw';
import lab06 from '../../omari-lab/12-90-DAY-CHALLENGE/labs/lab-06-app-registrations.md?raw';
import lab07 from '../../omari-lab/12-90-DAY-CHALLENGE/labs/lab-07-conditional-access.md?raw';
import lab08 from '../../omari-lab/12-90-DAY-CHALLENGE/labs/lab-08-graph-and-oauth.md?raw';
import lab09 from '../../omari-lab/12-90-DAY-CHALLENGE/labs/lab-09-jml-workflow.md?raw';
import lab10 from '../../omari-lab/12-90-DAY-CHALLENGE/labs/lab-10-jit-and-access-reviews.md?raw';
import lab11 from '../../omari-lab/12-90-DAY-CHALLENGE/labs/lab-11-access-request-ticketing.md?raw';
import lab12 from '../../omari-lab/12-90-DAY-CHALLENGE/labs/lab-12-governance-dashboard.md?raw';
import lab13 from '../../omari-lab/12-90-DAY-CHALLENGE/labs/lab-13-capstone-job-ready.md?raw';

export const CHALLENGE_DAYS = 90;

export type ChallengePhaseId = 'ad' | 'entra' | 'governance' | 'job-ready';

export const CHALLENGE_PHASES: readonly { id: ChallengePhaseId; title: string }[] = [
  { id: 'ad', title: 'Phase 1 · AD Foundation' },
  { id: 'entra', title: 'Phase 2 · Entra ID & Cloud Identity' },
  { id: 'governance', title: 'Phase 3 · Lifecycle & Governance' },
  { id: 'job-ready', title: 'Phase 4 · Job-Ready' },
];

/**
 * Where the lab is done inside IAM Range:
 *   ad     the workstation's Active Directory + simulated Terminal / ISE
 *   entra  the Browser (Entra admin center, Azure portal) + PowerShell (this PC)
 *   local  PowerShell (this PC) and the Browser, no directory
 */
export type ChallengeWorkspace = 'ad' | 'entra' | 'local';

/** A button in the lab's workspace bar: an app window or a page in the Browser. */
export type ChallengeTool =
  | 'active-directory' | 'terminal' | 'ise' | 'pwsh' | 'cloud-identity' | 'access-reviews' | 'tickets' | 'sheets' | 'interview'
  | 'entra' | 'azure' | 'myapps' | 'saml-toolkit' | 'jwt' | 'graph-explorer' | 'github';

export interface ChallengeLab {
  id: string;
  workspace: ChallengeWorkspace;
  /** Workspace buttons, in the order the lab uses them. */
  tools: ChallengeTool[];
  number: number;
  title: string;
  phase: ChallengePhaseId;
  /** Inclusive day range within the 90 days. */
  firstDay: number;
  lastDay: number;
  repo: string;
  skills: string[];
  /** What each day of the lab's week is for, first day first. */
  dailyPlan: string[];
  /** Full lab text (markdown). */
  body: string;
  /** Parsed from the lab's "## Validation checklist" section. */
  deliverables: string[];
}

/** The standard week: read, build for three days, break it, write it up, reflect. */
function week(build: [string, string, string]): string[] {
  return [
    'Read the lab and its "Do this lab in the app" steps; answer the quick review',
    ...build,
    'Challenge + troubleshooting: break it and fix it',
    'GitHub: docs, screenshots, diagram, resume bullet',
    'Validation checklist, interview answer out loud, send feedback',
  ];
}

/** Bulleted lines under "## Validation checklist", up to the next "## " heading. */
export function parseDeliverables(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Validation checklist\s*$/i.test(l));
  if (start < 0) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    const m = /^\s*[-*]\s+(.+)$/.exec(line);
    if (m) out.push(m[1]!.trim());
  }
  return out;
}

type LabSeed = Omit<ChallengeLab, 'id' | 'firstDay' | 'lastDay' | 'deliverables'>;

const SEEDS: LabSeed[] = [
  {
    number: 1, workspace: 'ad', tools: ['active-directory', 'terminal'],
    title: 'AD Enterprise Base', phase: 'ad', repo: 'iam-ad-enterprise-lab', body: lab01,
    skills: ['AD DS', 'OUs', 'security groups', 'lockout policy', 'event 4740'],
    dailyPlan: week(['Terminal: the Challenge90 OU tree and Sales-Team', 'Create Alex; first sign-in as Alex on the lock screen', 'Lockout policy, lock Alex, investigate and unlock']),
  },
  {
    number: 2, workspace: 'ad', tools: ['terminal', 'ise', 'active-directory', 'sheets'],
    title: 'PowerShell AD Automation Toolkit', phase: 'ad', repo: 'iam-ad-enterprise-lab', body: lab02,
    skills: ['PowerShell modules', 'CSV', '-WhatIf', 'idempotency', 'reporting'],
    dailyPlan: week(['Department groups in Terminal', 'Bulk onboarding script in PowerShell ISE, run it twice', 'Offboarding, report into Sheets, write the real module']),
  },
  {
    number: 3, workspace: 'ad', tools: ['terminal', 'active-directory', 'ise'],
    title: 'AD Troubleshooting Deep Dive', phase: 'ad', repo: 'iam-ad-enterprise-lab', body: lab03,
    skills: ['lockout source', 'password policy', 'replication', 'Kerberos tokens'],
    dailyPlan: week(['IAM-2034 lockout and IAM-2035 password policy', 'IAM-2036 sync and IAM-2037 share access', 'Write-ups, then the real diagnostics toolkit in ISE']),
  },
  {
    number: 4, workspace: 'entra', tools: ['entra', 'azure', 'pwsh', 'cloud-identity'],
    title: 'Entra ID Foundations', phase: 'entra', repo: 'iam-entra-id-lab', body: lab04,
    skills: ['Entra ID', 'admin roles', 'Graph PowerShell', 'least privilege'],
    dailyPlan: week(['Create the tenant, protect your admin account', 'Portal: users, groups, Helpdesk Administrator', 'Graph PowerShell: script the cloud users']),
  },
  {
    number: 5, workspace: 'entra', tools: ['entra', 'myapps', 'saml-toolkit', 'pwsh'],
    title: 'MFA & SSO', phase: 'entra', repo: 'iam-entra-id-lab', body: lab05,
    skills: ['Conditional Access', 'break-glass', 'Authenticator', 'SAML'],
    dailyPlan: week(['P2 trial, break-glass accounts, disable security defaults', 'CA001 in report-only, then On', 'SAML Toolkit SSO and the MFA status script']),
  },
  {
    number: 6, workspace: 'entra', tools: ['entra', 'pwsh', 'jwt', 'sheets'],
    title: 'Enterprise Apps & App Registrations', phase: 'entra', repo: 'iam-entra-id-lab', body: lab06,
    skills: ['app registrations', 'consent', 'client credentials', 'app inventory'],
    dailyPlan: week(['Internal API: scope and app role', 'Daemon app: least-privilege permissions, token test', 'App inventory script (and optional SCIM)']),
  },
  {
    number: 7, workspace: 'entra', tools: ['pwsh', 'entra', 'sheets', 'terminal'],
    title: 'Conditional Access Deep Dive', phase: 'entra', repo: 'iam-entra-id-lab', body: lab07,
    skills: ['CA baseline', 'named locations', 'What If', 'policy as code'],
    dailyPlan: week(['Named location, CA002 and CA003 in report-only', 'CA004–CA006, then turn policies On', 'What If testing and the export script']),
  },
  {
    number: 8, workspace: 'entra', tools: ['entra', 'pwsh', 'graph-explorer', 'jwt'],
    title: 'Microsoft Graph & OAuth', phase: 'entra', repo: 'iam-graph-automation', body: lab08,
    skills: ['OAuth 2.0', 'REST', 'paging', '429 retry', 'JWT'],
    dailyPlan: week(['Token + generic Graph caller with paging', 'Group membership and licensing functions', 'Stale-user report, delegated vs app-only tokens']),
  },
  {
    number: 9, workspace: 'ad', tools: ['terminal', 'active-directory', 'cloud-identity', 'ise', 'sheets'],
    title: 'JML Workflow Automation', phase: 'governance', repo: 'iam-jml-automation', body: lab09,
    skills: ['Joiner', 'Mover', 'Leaver', 'approvals', 'audit log'],
    dailyPlan: week(['JOIN Lena, sync to the cloud; refuse the unapproved row', 'MOVE Lena: remove old access first', 'LEAVE Priya, revoke sessions, export the audit log']),
  },
  {
    number: 10, workspace: 'ad', tools: ['terminal', 'access-reviews', 'active-directory', 'ise'],
    title: 'Just-in-Time Access & Access Reviews', phase: 'governance', repo: 'iam-access-governance', body: lab10,
    skills: ['JIT', 'separation of duties', 'scheduled revocation', 'access reviews'],
    dailyPlan: week(['Group, share and the JIT role', 'PIM eligibility, activation and expiry', 'Access Reviews campaign and proof of removal']),
  },
  {
    number: 11, workspace: 'ad', tools: ['pwsh', 'terminal', 'tickets'],
    title: 'Access Request Ticketing', phase: 'governance', repo: 'iam-access-governance', body: lab11,
    skills: ['state machine', 'SLA', 'fulfilment', 'evidence'],
    dailyPlan: week(['Ticket module in PowerShell (this PC)', 'Owner approval, fulfil with Enable-PimRole in Terminal', 'SLA report and Ticket Queue comparison']),
  },
  {
    number: 12, workspace: 'local', tools: ['terminal', 'pwsh', 'sheets'],
    title: 'Identity Governance Dashboard', phase: 'governance', repo: 'iam-access-governance', body: lab12,
    skills: ['KPIs', 'Chart.js', 'data hygiene', 'reporting'],
    dailyPlan: week(['Generate tickets and the grants file, define the KPI formulas', 'Build the dashboard page', 'Serve from PowerShell (this PC), pin SRI, check each number by hand']),
  },
  {
    number: 13, workspace: 'ad', tools: ['terminal', 'active-directory', 'pwsh', 'access-reviews', 'github', 'sheets', 'interview'],
    title: 'Capstone & Job-Ready', phase: 'job-ready', repo: 'iam-90-day-capstone', body: lab13,
    skills: ['end-to-end lifecycle', 'portfolio', 'resume', 'interviews'],
    dailyPlan: [
      'End-to-end run in the app: join, sign in, request, JIT, expiry',
      'End-to-end run: review, move, leave, dashboard; runbook and video',
      'Portfolio polish: six READMEs, profile README, secret scan',
      'Resume and LinkedIn',
      'Interview rehearsal: 12 answers recorded',
      'Apply: 10 applications, tracker in Sheets',
    ],
  },
];

export const CHALLENGE_LABS: readonly ChallengeLab[] = (() => {
  let day = 1;
  return SEEDS.map((seed) => {
    const firstDay = day;
    const lastDay = day + seed.dailyPlan.length - 1;
    day = lastDay + 1;
    return {
      ...seed,
      id: `c90-lab-${String(seed.number).padStart(2, '0')}`,
      firstDay,
      lastDay,
      deliverables: parseDeliverables(seed.body),
    };
  });
})();

export function challengeLabById(id: string): ChallengeLab | undefined {
  return CHALLENGE_LABS.find((l) => l.id === id);
}

export function labForDay(day: number): ChallengeLab | undefined {
  return CHALLENGE_LABS.find((l) => day >= l.firstDay && day <= l.lastDay);
}

/**
 * Which challenge day `today` is, counting the start date as day 1.
 * Before the start → 0; after day 90 the count keeps going so the window can
 * say the challenge is over. Calendar days, not 24-hour periods, so a
 * daylight-saving change never skips or repeats a day.
 */
export function challengeDay(startIso: string, today: Date = new Date()): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startIso);
  if (!m) return 0;
  const start = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((now - start) / 86_400_000);
  return diff < 0 ? 0 : diff + 1;
}

/** Calendar date (YYYY-MM-DD) of a challenge day for a given start date. */
export function dateOfDay(startIso: string, day: number): string {
  const [y, mo, d] = startIso.split('-').map(Number);
  const t = new Date(Date.UTC(y!, mo! - 1, d! + day - 1));
  return t.toISOString().slice(0, 10);
}

/** Local calendar date as YYYY-MM-DD. */
export function isoDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The start date that makes `lab` begin today.
 *
 * Restarting a lab moves the whole schedule, so the lab gets its full week
 * again and every later lab slides with it; earlier labs keep their dates
 * relative to it.
 */
export function startDateForLabToday(lab: ChallengeLab, today: Date = new Date()): string {
  return isoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - (lab.firstDay - 1)));
}
