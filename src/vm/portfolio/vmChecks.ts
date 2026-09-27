/**
 * vm/portfolio/vmChecks.ts — the examiner for the portfolio VM track.
 *
 * omari-lab/11-IAM-PORTFOLIO/vm/Get-PortfolioFacts.ps1 reads the real DC01
 * (users, nested groups with PAM time-to-live, share ACLs, the learner's files
 * in C:\IAM, identity events). These checks grade that — deterministically,
 * the same answer every time — and the Ollama instructor only explains them.
 *
 * Only work done AFTER the project's scenario was set up counts: every file
 * and password check compares against the scenario's seededAt time.
 */
import { lintSubmission, type Finding } from './lint';

export interface VmUser {
  sam: string;
  name: string;
  enabled: boolean;
  parent: string;
  department: string;
  employeeId: string;
  pwdLastSet: string | null;
  mustChangePassword: boolean;
  lastLogon: string | null;
  description: string;
  memberOf: string[];
}

export interface VmGroupMember {
  name: string;
  type: 'user' | 'group';
  /** Seconds left for a time-bound (PAM) membership; null = permanent. */
  ttl: number | null;
}

export interface VmGroup {
  name: string;
  parent: string;
  scope: string;
  category: string;
  managedBy: string | null;
  members: VmGroupMember[];
}

export interface VmAce {
  identity: string;
  rights: 'F' | 'M' | 'W' | 'RX' | 'R';
  inherited: boolean;
}

export interface VmFile {
  path: string;
  size: number;
  modified: string;
  content: string | null;
}

export interface VmEvent {
  id: number;
  time: string;
  targetUser: string;
  memberName: string;
  subjectUser: string;
  logonType: string;
  group: string | null;
}

export interface PortfolioFacts {
  collectedAt: string;
  domain: string;
  netbios: string;
  scenarios: Record<string, string>;
  pamEnabled: boolean;
  users: VmUser[];
  groups: VmGroup[];
  acls: Record<string, VmAce[]>;
  files: VmFile[];
  events: VmEvent[];
}

export interface VmCheckResult {
  id: string;
  label: string;
  pass: boolean;
  /** What was actually seen on DC01 — facts, never advice. */
  observed: string;
  /** A direction to investigate, never the fix. */
  hint: string;
}

export const VM_PROJECTS = ['p01', 'p02', 'p03', 'p04', 'p08', 'p10'] as const;
export type VmProjectId = (typeof VM_PROJECTS)[number];

export function isVmProject(id: string): id is VmProjectId {
  return (VM_PROJECTS as readonly string[]).includes(id);
}

const PRIVILEGED = [
  'Domain Admins', 'Enterprise Admins', 'Schema Admins', 'Administrators', 'Account Operators',
  'Server Operators', 'Backup Operators', 'Print Operators', 'Group Policy Creator Owners', 'DnsAdmins',
];

// ---------------------------------------------------------------------------
// Helpers over the facts
// ---------------------------------------------------------------------------

const lc = (s: string | null | undefined): string => (s ?? '').toLowerCase();

class View {
  constructor(readonly f: PortfolioFacts, readonly seededAt: Date | null) {}

  user(sam: string): VmUser | undefined {
    return this.f.users.find((u) => lc(u.sam) === lc(sam));
  }

  group(name: string): VmGroup | undefined {
    return this.f.groups.find((g) => lc(g.name) === lc(name));
  }

  isMember(principal: string, groupName: string): boolean {
    return !!this.group(groupName)?.members.some((m) => lc(m.name) === lc(principal));
  }

  /** Every group a principal is in, directly or through nesting — what Windows puts in the token. */
  effectiveGroups(principal: string): Set<string> {
    const out = new Set<string>();
    const queue = [lc(principal)];
    const user = this.user(principal);
    if (user) queue.push(...user.memberOf.map(lc));
    while (queue.length) {
      const name = queue.shift()!;
      for (const g of this.f.groups) {
        const key = lc(g.name);
        if (out.has(key)) continue;
        if (g.members.some((m) => lc(m.name) === name) || (user && name !== lc(principal) && key === name)) {
          out.add(key);
          queue.push(key);
        }
      }
    }
    if (user) for (const g of user.memberOf) out.add(lc(g));
    return out;
  }

  acl(path: string): VmAce[] {
    return this.f.acls[lc(path)] ?? [];
  }

  /** The strongest right any of `identities` gets on `path` (short names, no domain). */
  rightsFor(path: string, identities: Set<string>): VmAce['rights'] | null {
    const order: VmAce['rights'][] = ['F', 'M', 'W', 'RX', 'R'];
    let best: VmAce['rights'] | null = null;
    for (const ace of this.acl(path)) {
      const short = lc(ace.identity.split('\\').pop());
      if (!identities.has(short)) continue;
      if (best === null || order.indexOf(ace.rights) < order.indexOf(best)) best = ace.rights;
    }
    return best;
  }

  after(iso: string | null): boolean {
    if (!iso || !this.seededAt) return false;
    return new Date(iso).getTime() > this.seededAt.getTime();
  }

  /** Files under a folder written after the scenario was set up. */
  filesAfter(folder: string, ext?: RegExp): VmFile[] {
    const prefix = lc(folder).replace(/\\?$/, '\\');
    return this.f.files.filter((x) => x.path.startsWith(prefix) && this.after(x.modified) && (!ext || ext.test(x.path)));
  }

  anyFileMentions(files: VmFile[], ...needles: string[]): VmFile | undefined {
    return files.find((x) => needles.every((n) => lc(x.content).includes(lc(n))));
  }
}

function check(id: string, label: string, pass: boolean, observed: string, hint: string): VmCheckResult {
  return { id, label, pass, observed, hint };
}

function scriptCheck(v: View, id: string, folder: string, label: string): VmCheckResult {
  const scripts = v.filesAfter(folder, /\.(ps1|psm1|py|sh)$/);
  if (scripts.length === 0) {
    return check(id, label, false, `No script written in ${folder} since the scenario was set up.`, `Save your automation as a script in ${folder} so it can be reviewed and re-run.`);
  }
  const serious: Finding[] = scripts.flatMap((s) => lintSubmission(s.content ?? '')).filter((f) => f.severity === 'Critical' || f.severity === 'High');
  return check(id, label, serious.length === 0,
    serious.length ? `Least-privilege checker: ${serious.map((f) => `${f.severity} ${f.title}`).join('; ')}.` : `${scripts.map((s) => s.path.split('\\').pop()).join(', ')}: no Critical/High findings.`,
    'Open the script in the IAM Portfolio submission box to see each finding with its line and hint.');
}

// ---------------------------------------------------------------------------
// Per-project checks
// ---------------------------------------------------------------------------

function p01(v: View): VmCheckResult[] {
  const pn = v.user('pnair');
  const mc = v.user('mchen');
  const tb = v.user('tbrooks');
  const log = v.filesAfter('c:\\iam\\jml', /\.(csv|log|txt|json|md)$/);
  return [
    check('p01-joiner', 'Joiner: pnair provisioned correctly',
      !!pn && pn.enabled && lc(pn.parent).startsWith('ou=engineering,ou=tier2_staff') && pn.employeeId === '1001' && pn.mustChangePassword && v.isMember('pnair', 'GG-Engineering'),
      pn ? `pnair: enabled ${pn.enabled}, in ${pn.parent}, EmployeeID "${pn.employeeId}", must change password ${pn.mustChangePassword}, groups [${pn.memberOf.join(', ')}].` : 'pnair does not exist.',
      'Compare the joiner row with the account: OU from Department, EmployeeID, a temporary password the user must change, and the department group.'),
    check('p01-mover', 'Mover: mchen moved from Sales to Finance',
      !!mc && lc(mc.department) === 'finance' && lc(mc.parent).startsWith('ou=finance') && v.isMember('mchen', 'GG-Finance') && !v.isMember('mchen', 'GG-Sales'),
      mc ? `mchen: department "${mc.department}", in ${mc.parent}, groups [${mc.memberOf.join(', ')}].` : 'mchen does not exist.',
      'A mover must LOSE the old department\'s access, not only gain the new one. Check every place the old department shows up.'),
    check('p01-leaver', 'Leaver: tbrooks disabled, reset, stripped and isolated',
      !!tb && !tb.enabled && lc(tb.parent).startsWith('ou=terminated users') && tb.memberOf.length === 0 && v.after(tb.pwdLastSet),
      tb ? `tbrooks: enabled ${tb.enabled}, in ${tb.parent}, groups [${tb.memberOf.join(', ')}], password last set ${tb.pwdLastSet ?? 'never'}.` : 'tbrooks does not exist.',
      'On-premises "revoke sessions" means the password (and so Kerberos tickets) must change. Check the OU, the groups and the password age too.'),
    check('p01-log', 'Audit log names every account changed',
      !!v.anyFileMentions(log, 'pnair', 'mchen', 'tbrooks'),
      log.length ? `Log files after setup: ${log.map((f) => f.path.split('\\').pop()).join(', ')}.` : 'No log file written in C:\\IAM\\JML since setup.',
      'An auditor asks: what changed, for whom, when, and triggered by which HR row? Where does your pipeline write that?'),
    scriptCheck(v, 'p01-script', 'c:\\iam\\jml', 'JML script passes the least-privilege checker'),
  ];
}

function p02(v: View): VmCheckResult[] {
  const roles = ['Role-Finance-Lead', 'Role-Finance-Analyst', 'Role-Engineering-Developer', 'Role-HR-Specialist'];
  const missing = roles.filter((r) => !v.group(r));
  const leadGroups = v.effectiveGroups('flead');
  const analystGroups = v.effectiveGroups('fanalyst');
  const leadRight = v.rightsFor('c:\\shares\\finance', leadGroups);
  const analystRight = v.rightsFor('c:\\shares\\finance', analystGroups);
  const privHits = [...roles, 'flead'].filter((r) => {
    const eff = v.effectiveGroups(r);
    return PRIVILEGED.some((p) => eff.has(lc(p)));
  });
  const shareProblems: string[] = [];
  for (const path of ['c:\\shares\\finance', 'c:\\shares\\engineering', 'c:\\shares\\hr']) {
    for (const ace of v.acl(path)) {
      const short = lc(ace.identity.split('\\').pop());
      if (!ace.inherited && v.user(short)) shareProblems.push(`${path}: user ${ace.identity} granted directly`);
      if (['everyone', 'users', 'authenticated users', 'domain users'].includes(short) && ['F', 'M', 'W'].includes(ace.rights)) shareProblems.push(`${path}: ${ace.identity} has ${ace.rights}`);
    }
  }
  const matrix = v.filesAfter('c:\\iam\\rbac', /\.md$/).find((x) => /engineering/i.test(x.content ?? '') && /\bhr\b/i.test(x.content ?? '') && /finance/i.test(x.content ?? '') && (x.content ?? '').includes('|'));
  return [
    check('p02-roles', 'Role groups exist for every business role', missing.length === 0,
      missing.length ? `Missing role groups: ${missing.join(', ')}.` : 'All four role groups exist.',
      'Model the business roles first, as groups, before any permission is granted.'),
    check('p02-lead', 'Finance Lead: financial application + read-write Finance folder',
      v.isMember('flead', 'Role-Finance-Lead') && (leadRight === 'M' || leadRight === 'F') && leadGroups.has('app-financeledger-users'),
      `flead effective groups: [${[...leadGroups].join(', ')}]; best right on C:\\Shares\\Finance: ${leadRight ?? 'none'}.`,
      'Adding someone to the role group must be the only step. Follow the nesting from Role-Finance-Lead to the folder ACL and to the application group.'),
    check('p02-analyst', 'Finance Analyst is read-only',
      v.isMember('fanalyst', 'Role-Finance-Analyst') && (analystRight === 'RX' || analystRight === 'R'),
      `fanalyst effective right on C:\\Shares\\Finance: ${analystRight ?? 'none'}.`,
      'Two roles in one department should not get the same rights. What does an analyst actually need to do with the files?'),
    check('p02-no-admin', 'No role reaches domain admin rights', privHits.length === 0,
      privHits.length ? `Reaches a privileged group: ${privHits.join(', ')}.` : 'No role group (or flead) is nested into any privileged group.',
      'Check the nesting all the way up, not only direct membership.'),
    check('p02-acls', 'Permissions granted to groups only, never to broad groups', shareProblems.length === 0,
      shareProblems.length ? `${shareProblems.join('; ')}.` : 'Share ACLs grant to groups; no broad group can write.',
      'Run icacls on each share: who is listed, and is every entry a resource group?'),
    check('p02-matrix', 'Markdown access matrix for Engineering, HR and Finance', !!matrix,
      matrix ? `${matrix.path} contains a matrix covering all three departments.` : 'No access-matrix.md (with a table covering Engineering, HR and Finance) written in C:\\IAM\\RBAC since setup.',
      'The matrix is the deliverable an auditor reads: business role -> group -> exact technical permission.'),
  ];
}

function p03(v: View): VmCheckResult[] {
  const eng = v.acl('c:\\shares\\engineering');
  const rlopezAce = eng.find((a) => lc(a.identity).endsWith('\\rlopez'));
  const req = v.filesAfter('c:\\iam\\uar\\requests');
  const all = v.filesAfter('c:\\iam\\uar');
  const decision = all.find((x) => /rlopez/i.test(x.content ?? '') && /den(y|ied)/i.test(x.content ?? '') && /mgr\.engineering/i.test(x.content ?? ''));
  const remediation = all.find((x) => /rlopez/i.test(x.content ?? '') && /(remov|revok|strip)/i.test(x.content ?? '') && !/\.md$/.test(x.path));
  const report = all.find((x) => /\.md$/.test(x.path) && /before/i.test(x.content ?? '') && /after/i.test(x.content ?? '') && /rlopez/i.test(x.content ?? ''));
  return [
    check('p03-group', 'rlopez removed from GG-Engineering-Restricted', !v.isMember('rlopez', 'GG-Engineering-Restricted'),
      `GG-Engineering-Restricted members: [${v.group('GG-Engineering-Restricted')?.members.map((m) => m.name).join(', ') ?? 'group missing'}].`,
      'The denied membership has to be gone from the directory, not only from your report.'),
    check('p03-ace', 'Explicit rlopez permission removed from C:\\Shares\\Engineering', !rlopezAce,
      rlopezAce ? `rlopez still has ${rlopezAce.rights} on C:\\Shares\\Engineering.` : 'No explicit rlopez entry on C:\\Shares\\Engineering.',
      'Privilege creep often lives in two places. Check the folder ACL as well as the group.'),
    check('p03-legit', 'Legitimate access untouched', v.isMember('aeng', 'GG-Engineering-Restricted') && v.isMember('bdev', 'GG-Engineering-Restricted') && eng.some((a) => lc(a.identity).endsWith('\\gg-engineering-restricted')),
      `aeng member ${v.isMember('aeng', 'GG-Engineering-Restricted')}, bdev member ${v.isMember('bdev', 'GG-Engineering-Restricted')}, group ACE present ${eng.some((a) => lc(a.identity).endsWith('\\gg-engineering-restricted'))}.`,
      'A review removes only what was denied. Mass removal is an outage, not a remediation.'),
    check('p03-request', 'Review sent to the manager (mgr.engineering)', req.some((x) => /mgr\.engineering/i.test(x.path + (x.content ?? '')) && /rlopez/i.test(x.content ?? '')),
      req.length ? `Requests: ${req.map((x) => x.path.split('\\').pop()).join(', ')}.` : 'No review request written in C:\\IAM\\UAR\\requests since setup.',
      'Who owns GG-Engineering-Restricted (its ManagedBy)? The campaign must reach that person, not the requester.'),
    check('p03-decision', 'Manager decision recorded (deny rlopez)', !!decision,
      decision ? `Decision found in ${decision.path}.` : 'No record naming rlopez, a deny decision and reviewer mgr.engineering.',
      'Evidence of the decision: reviewer, subject, access, decision, timestamp.'),
    check('p03-remediation', 'Remediation logged', !!remediation,
      remediation ? `Remediation log: ${remediation.path}.` : 'No log entry showing the rlopez access being removed.',
      'The removal itself must leave a trail that an auditor can match to the decision.'),
    check('p03-report', 'Identity Audit & Attestation Report (before and after)', !!report,
      report ? `Report: ${report.path}.` : 'No Markdown report in C:\\IAM\\UAR with before and after state for rlopez.',
      'The deliverable shows how the unauthorised access was caught and fixed, with state before and after.'),
  ];
}

function p04(v: View): VmCheckResult[] {
  const dormant = ['old.contractor1', 'old.contractor2', 'legacy.intern'];
  const us = dormant.map((s) => v.user(s));
  const stillEnabled = dormant.filter((s, i) => !us[i] || us[i]!.enabled);
  const withGroups = dormant.filter((s, i) => (us[i]?.memberOf.length ?? 1) > 0);
  const notReset = dormant.filter((s, i) => !v.after(us[i]?.pwdLastSet ?? null));
  const active = v.user('active.user');
  const keep = ['svc-backup', 'bg-admin01'].map((s) => v.user(s));
  const collateral: string[] = [];
  if (!active?.enabled || !v.isMember('active.user', 'GG-Engineering')) collateral.push('active.user');
  keep.forEach((u, i) => { if (!u?.enabled) collateral.push(['svc-backup', 'bg-admin01'][i]!); });
  const logs = v.filesAfter('c:\\iam\\stale', /\.(csv|log|txt|json)$/);
  const queue = v.filesAfter('c:\\iam\\queue');
  const queued = dormant.filter((s) => queue.some((q) => lc(q.content).includes(s) || q.path.includes(s)));
  return [
    check('p04-disabled', 'Dormant accounts disabled', stillEnabled.length === 0,
      stillEnabled.length ? `Still enabled or missing: ${stillEnabled.join(', ')}.` : 'All three dormant accounts are disabled.',
      'Which accounts has nobody ever signed in to? Your query must find never-used accounts too, not only old lastLogonTimestamp values.'),
    check('p04-groups', 'Security groups stripped', withGroups.length === 0,
      withGroups.length ? `Still in groups: ${withGroups.map((s) => `${s} [${v.user(s)?.memberOf.join(', ')}]`).join('; ')}.` : 'No dormant account is in any group.',
      'A disabled account that keeps its groups is one "Enable" away from full access again.'),
    check('p04-password', 'Passwords reset since the scenario was set up', notReset.length === 0,
      notReset.length ? `Password not reset: ${notReset.join(', ')}.` : 'All three passwords were reset.',
      'Reset to a cryptographically random 32-character string, not one you could guess or re-use.'),
    check('p04-untouched', 'Active user and exclusions untouched', collateral.length === 0,
      collateral.length ? `Collateral damage: ${collateral.join(', ')}.` : 'active.user, svc-backup and bg-admin01 are unchanged.',
      'Service accounts and break-glass accounts need exclusions, and active users must never match your query.'),
    check('p04-log', 'Account details logged to a file', !!v.anyFileMentions(logs, ...dormant),
      logs.length ? `Log files: ${logs.map((l) => l.path.split('\\').pop()).join(', ')}.` : 'No log written in C:\\IAM\\Stale since setup.',
      'Log each target BEFORE changing it: that is your only record of what the account had.'),
    check('p04-queue', 'IT queue notification per account', queued.length === dormant.length,
      `Queue items name: ${queued.join(', ') || 'none'}.`,
      'Every remediated account should reach a human in the IT queue.'),
    scriptCheck(v, 'p04-script', 'c:\\iam\\stale', 'Remediation script passes the least-privilege checker'),
  ];
}

function p08(v: View): VmCheckResult[] {
  const standing = PRIVILEGED.filter((g) => v.group(g)?.members.some((m) => lc(m.name) === 'dkim' && m.ttl === null));
  const da = v.group('Domain Admins')?.members.find((m) => lc(m.name) === 'dkim');
  const addEvents = v.f.events.filter((e) => e.id === 4728 && lc(e.memberName) === 'dkim' && lc(e.group) === 'domain admins' && v.after(e.time));
  const logs = v.filesAfter('c:\\iam\\pam');
  const leads = new Set((v.group('GG-SecurityLeads')?.members ?? []).map((m) => lc(m.name)));
  const entry = logs.flatMap((l) => (l.content ?? '').split(/\r?\n/)).find((line) => /dkim/i.test(line) && /\b(INC|CHG|REQ)-\d{3,}\b/i.test(line) && [...leads].some((s) => s !== 'dkim' && lc(line).includes(s)));
  const durationOk = logs.some((l) => /(\b2\s*h(ou)?rs?\b|02:00:00|\b120\s*min|\b7200\b|PT2H)/i.test(l.content ?? ''));
  return [
    check('p08-feature', 'AD Privileged Access Management feature enabled', v.f.pamEnabled,
      `PAM feature enabled: ${v.f.pamEnabled}.`, 'Time-bound membership needs the forest-wide PAM optional feature.'),
    check('p08-no-standing', 'dkim has zero standing admin rights', standing.length === 0,
      standing.length ? `Permanent (no TTL) membership in: ${standing.join(', ')}.` : 'dkim has no permanent membership in any privileged group.',
      'Zero standing privileges: any admin membership must carry an expiry.'),
    check('p08-elevated', 'An approved elevation actually happened', addEvents.length > 0 || !!da,
      da ? `dkim is in Domain Admins now, TTL ${da.ttl ?? 'none'} s.` : addEvents.length ? `Event 4728 at ${addEvents[0]!.time}: dkim added to Domain Admins.` : 'No elevation of dkim to Domain Admins since setup.',
      'Run your request -> approve -> activate workflow once, end to end.'),
    check('p08-ttl', 'Elevation expires on its own after 2 hours',
      (!!da && da.ttl !== null && da.ttl > 0 && da.ttl <= 7200) || (!da && addEvents.length > 0 && durationOk),
      da ? `Current TTL: ${da.ttl ?? 'permanent'} s (limit 7200).` : `Duration recorded as 2 hours in the log: ${durationOk}.`,
      'Look at Add-ADGroupMember -MemberTimeToLive. What proves the expiry, rather than a promise to remove it later?'),
    check('p08-log', 'Elevation log: ticket, requester, approving security lead', !!entry,
      entry ? `Log entry: ${entry.trim().slice(0, 160)}` : `No log line in C:\\IAM\\PAM naming dkim, a ticket (INC-/CHG-/REQ-nnnn) and an approver from GG-SecurityLeads [${[...leads].join(', ')}].`,
      'Each elevation needs: who asked, which ticket, who approved (not the requester), when it started and when it ends.'),
  ];
}

function p10(v: View): VmCheckResult[] {
  const ev = v.f.events;
  const fails = ev.filter((e) => e.id === 4625 && lc(e.targetUser) === 'siem.victim').length;
  const ok = ev.some((e) => e.id === 4624 && lc(e.targetUser) === 'siem.victim');
  const grp = ev.some((e) => e.id === 4728 && lc(e.memberName) === 'siem.temp');
  const cleared = ev.some((e) => e.id === 1102);
  const queries = v.filesAfter('c:\\iam\\siem\\queries');
  const alerts = v.filesAfter('c:\\iam\\siem', /alerts?\.(csv|json|txt|log)$/);
  const text = alerts.map((a) => lc(a.content)).join('\n');
  const kql = queries.find((q) => /\.kql$/.test(q.path) && /auditlogs/i.test(q.content ?? '') && /(security info|strongauthentication|authentication method|mfa)/i.test(q.content ?? ''));
  return [
    check('p10-source', 'Scenario events present on DC01', fails >= 3 && ok && grp && cleared,
      `siem.victim failed logons ${fails}, success ${ok}; siem.temp added to Domain Admins ${grp}; Security log cleared (1102) ${cleared}.`,
      'If these are missing, set the scenario up again: they are the ground truth your detections must find.'),
    check('p10-queries', 'Saved detection queries (at least three)', queries.length >= 3,
      `Queries saved since setup: ${queries.map((q) => q.path.split('\\').pop()).join(', ') || 'none'}.`,
      'One saved query per indicator: failed-then-success, sensitive group change, audit log cleared.'),
    check('p10-bruteforce', 'Alert: failed logons followed by a success (siem.victim)', /siem\.victim/.test(text),
      alerts.length ? `Alerts file(s): ${alerts.map((a) => a.path.split('\\').pop()).join(', ')}.` : 'No alerts file written in C:\\IAM\\SIEM since setup.',
      'Correlate 4625 then 4624 for the same account in a short window.'),
    check('p10-group', 'Alert: Domain Admins membership change (siem.temp)', /siem\.temp|domain admins/.test(text),
      /siem\.temp|domain admins/.test(text) ? 'Group-change alert present.' : 'No alert naming siem.temp or Domain Admins.',
      'Which event IDs record membership changes to global, local and universal security groups?'),
    check('p10-clear', 'Alert: audit log cleared', /1102|clear/.test(text),
      /1102|clear/.test(text) ? 'Log-clear alert present.' : 'No alert for the Security log being cleared.',
      'Clearing the Security log leaves one event behind. Which one?'),
    check('p10-mfa', 'Cloud alert rule: MFA method registration changed (KQL)', !!kql,
      kql ? `${kql.path} queries Entra AuditLogs for authentication-method changes.` : 'No .kql query over AuditLogs for MFA / security info changes in C:\\IAM\\SIEM\\queries.',
      'In Entra ID audit logs, look at the activities recorded when a user registers or changes security info.'),
  ];
}

/** Grade one project from the facts. Deterministic: same facts, same result. */
export function gradeVmProject(project: VmProjectId, facts: PortfolioFacts): VmCheckResult[] {
  const seeded = facts.scenarios[project];
  if (!seeded) {
    return [check(`${project}-setup`, 'Scenario set up on DC01', false, `The ${project} scenario has not been set up on DC01.`, 'Click "Set up this project in DC01" first.')];
  }
  const v = new View(facts, new Date(seeded));
  switch (project) {
    case 'p01': return p01(v);
    case 'p02': return p02(v);
    case 'p03': return p03(v);
    case 'p04': return p04(v);
    case 'p08': return p08(v);
    case 'p10': return p10(v);
  }
}
