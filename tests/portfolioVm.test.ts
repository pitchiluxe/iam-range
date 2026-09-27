/**
 * tests/portfolioVm.test.ts — the portfolio VM track: real-world project
 * definitions and the deterministic checks that grade the real DC01.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PORTFOLIO } from '@/vm/portfolio/config';
import {
  gradeVmProject,
  VM_PROJECTS,
  type PortfolioFacts,
  type VmGroup,
  type VmUser,
} from '@/vm/portfolio/vmChecks';

const SEED = '2026-09-27T10:00:00.000Z';
const LATER = '2026-09-27T10:30:00.000Z';
const EARLIER = '2026-09-27T09:00:00.000Z';
const DN = 'DC=corp,DC=technobiz,DC=local';
const STAFF = `OU=Tier2_Staff,OU=Enterprise_Root,${DN}`;

function user(sam: string, extra: Partial<VmUser> = {}): VmUser {
  return {
    sam, name: sam, enabled: true, parent: `CN=Users,${DN}`, department: '', employeeId: '',
    pwdLastSet: EARLIER, mustChangePassword: false, lastLogon: null, description: '', memberOf: [], ...extra,
  };
}

function group(name: string, members: [string, 'user' | 'group', (number | null)?][] = []): VmGroup {
  return { name, parent: `OU=Security_Groups,OU=Groups,OU=Enterprise_Root,${DN}`, scope: 'Global', category: 'Security', managedBy: null,
    members: members.map(([n, t, ttl]) => ({ name: n, type: t, ttl: ttl ?? null })) };
}

function facts(p: Partial<PortfolioFacts>): PortfolioFacts {
  return { collectedAt: LATER, domain: 'corp.technobiz.local', netbios: 'CORP', scenarios: {}, pamEnabled: false,
    users: [], groups: [], acls: {}, files: [], events: [], ...p };
}

const file = (path: string, content: string, modified = LATER) => ({ path: path.toLowerCase(), size: content.length, modified, content });
const GOOD_SCRIPT = '[CmdletBinding(SupportsShouldProcess)] param()\nStart-Transcript C:\\IAM\\log.txt\n$bytes = New-Object byte[] 32\n[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)\nDisable-ADAccount $u -WhatIf:$WhatIfPreference';

describe('real-world project definitions', () => {
  it('every project carries the real-world lab setup, execution and deliverable', () => {
    for (const p of PORTFOLIO.projects) {
      expect(p.labSetup.length, p.id).toBeGreaterThan(20);
      expect(p.execution.length, p.id).toBeGreaterThan(80);
      expect(p.portfolioDeliverable.length, p.id).toBeGreaterThan(30);
    }
    expect(PORTFOLIO.projects.find((p) => p.id === 'p04')!.execution).toMatch(/random 32-character string/);
    expect(PORTFOLIO.projects.find((p) => p.id === 'p09')!.execution).toMatch(/ExternalID and an MFA check/);
  });

  it('the VM track covers exactly the six on-premises projects, matching the kit and the app', () => {
    const vm = PORTFOLIO.projects.filter((p) => p.vm.supported).map((p) => p.id);
    expect(vm).toEqual([...VM_PROJECTS]);
    const kit = readFileSync(join('omari-lab', '11-IAM-PORTFOLIO', 'vm', 'Set-PortfolioScenario.ps1'), 'utf8');
    for (const id of VM_PROJECTS) expect(kit).toContain(`'${id}'`);
    const main = readFileSync(join('electron', 'main.cjs'), 'utf8');
    expect(main).toContain(`const PORTFOLIO_VM_PROJECTS = [${VM_PROJECTS.map((x) => `'${x}'`).join(', ')}]`);
  });

  it('refuses to grade a project whose scenario was never set up', () => {
    const r = gradeVmProject('p04', facts({}));
    expect(r).toHaveLength(1);
    expect(r[0]!.pass).toBe(false);
  });
});

describe('P01 JML on DC01', () => {
  const done = () => facts({
    scenarios: { p01: SEED },
    users: [
      user('pnair', { parent: `OU=Engineering,${STAFF}`, employeeId: '1001', mustChangePassword: true, memberOf: ['GG-Engineering'], department: 'Engineering' }),
      user('mchen', { parent: `OU=Finance,${STAFF}`, department: 'Finance', memberOf: ['GG-Finance'] }),
      user('tbrooks', { enabled: false, parent: `OU=Terminated Users,OU=Enterprise_Root,${DN}`, pwdLastSet: LATER }),
    ],
    groups: [group('GG-Engineering', [['pnair', 'user']]), group('GG-Finance', [['mchen', 'user']]), group('GG-Sales')],
    files: [file('C:\\IAM\\JML\\jml-log.csv', 'joiner,pnair\nmover,mchen\nleaver,tbrooks'), file('C:\\IAM\\JML\\Invoke-JmlPipeline.ps1', GOOD_SCRIPT)],
  });

  it('passes when the lifecycle is complete', () => {
    expect(gradeVmProject('p01', done()).filter((r) => !r.pass)).toEqual([]);
  });

  it('catches a mover who kept the old department access', () => {
    const f = done();
    f.groups.find((g) => g.name === 'GG-Sales')!.members.push({ name: 'mchen', type: 'user', ttl: null });
    expect(gradeVmProject('p01', f).find((r) => r.id === 'p01-mover')!.pass).toBe(false);
  });

  it('catches a leaver who was only disabled', () => {
    const f = done();
    f.users.find((u) => u.sam === 'tbrooks')!.pwdLastSet = EARLIER;
    expect(gradeVmProject('p01', f).find((r) => r.id === 'p01-leaver')!.pass).toBe(false);
  });
});

describe('P02 RBAC on DC01', () => {
  const done = () => facts({
    scenarios: { p02: SEED },
    users: [user('flead', { memberOf: ['Role-Finance-Lead'] }), user('fanalyst', { memberOf: ['Role-Finance-Analyst'] })],
    groups: [
      group('Role-Finance-Lead', [['flead', 'user']]), group('Role-Finance-Analyst', [['fanalyst', 'user']]),
      group('Role-Engineering-Developer'), group('Role-HR-Specialist'),
      group('Res-Finance-Share-RW', [['Role-Finance-Lead', 'group']]), group('Res-Finance-Share-RO', [['Role-Finance-Analyst', 'group']]),
      group('App-FinanceLedger-Users', [['Role-Finance-Lead', 'group']]), group('Domain Admins', [['Administrator', 'user']]),
    ],
    acls: {
      'c:\\shares\\finance': [{ identity: 'CORP\\Res-Finance-Share-RW', rights: 'M', inherited: false }, { identity: 'CORP\\Res-Finance-Share-RO', rights: 'RX', inherited: false }],
      'c:\\shares\\engineering': [{ identity: 'BUILTIN\\Users', rights: 'RX', inherited: true }],
      'c:\\shares\\hr': [],
    },
    files: [file('C:\\IAM\\RBAC\\access-matrix.md', '| Role | Group | Permission |\n|---|---|---|\n| Finance Lead | Role-Finance-Lead | Finance RW |\n| Engineering Developer | x | y |\n| HR Specialist | x | y |')],
  });

  it('passes with an AGDLP model that reaches the app and RW folder but not admin', () => {
    expect(gradeVmProject('p02', done()).filter((r) => !r.pass)).toEqual([]);
  });

  it('catches a role nested (indirectly) into Domain Admins', () => {
    const f = done();
    f.groups.push(group('Res-Legacy-Ops', [['Role-Finance-Lead', 'group']]));
    f.groups.find((g) => g.name === 'Domain Admins')!.members.push({ name: 'Res-Legacy-Ops', type: 'group', ttl: null });
    expect(gradeVmProject('p02', f).find((r) => r.id === 'p02-no-admin')!.pass).toBe(false);
  });

  it('catches a user granted directly on a folder', () => {
    const f = done();
    f.acls['c:\\shares\\finance']!.push({ identity: 'CORP\\flead', rights: 'M', inherited: false });
    expect(gradeVmProject('p02', f).find((r) => r.id === 'p02-acls')!.pass).toBe(false);
  });
});

describe('P03 access review on DC01', () => {
  const done = () => facts({
    scenarios: { p03: SEED },
    users: [user('rlopez'), user('aeng'), user('bdev')],
    groups: [group('GG-Engineering-Restricted', [['aeng', 'user'], ['bdev', 'user']])],
    acls: { 'c:\\shares\\engineering': [{ identity: 'CORP\\GG-Engineering-Restricted', rights: 'M', inherited: false }] },
    files: [
      file('C:\\IAM\\UAR\\requests\\mgr.engineering.json', '{"reviewer":"mgr.engineering","items":[{"user":"rlopez"}]}'),
      file('C:\\IAM\\UAR\\decisions.csv', 'reviewer,user,decision\nmgr.engineering,rlopez,Deny'),
      file('C:\\IAM\\UAR\\remediation.log', 'Removed rlopez from GG-Engineering-Restricted'),
      file('C:\\IAM\\UAR\\attestation-report.md', '## Before\nrlopez had access\n## After\nremoved'),
    ],
  });

  it('passes when only the denied access is removed, with evidence', () => {
    expect(gradeVmProject('p03', done()).filter((r) => !r.pass)).toEqual([]);
  });

  it('catches the explicit ACE left behind', () => {
    const f = done();
    f.acls['c:\\shares\\engineering']!.push({ identity: 'CORP\\rlopez', rights: 'M', inherited: false });
    expect(gradeVmProject('p03', f).find((r) => r.id === 'p03-ace')!.pass).toBe(false);
  });

  it('catches a mass removal of legitimate members', () => {
    const f = done();
    f.groups[0]!.members = [];
    expect(gradeVmProject('p03', f).find((r) => r.id === 'p03-legit')!.pass).toBe(false);
  });
});

describe('P04 stale accounts on DC01', () => {
  const dormant = ['old.contractor1', 'old.contractor2', 'legacy.intern'];
  const done = () => facts({
    scenarios: { p04: SEED },
    users: [
      ...dormant.map((s) => user(s, { enabled: false, pwdLastSet: LATER })),
      user('active.user', { memberOf: ['GG-Engineering'], lastLogon: EARLIER }), user('svc-backup'), user('bg-admin01'),
    ],
    groups: [group('GG-Engineering', [['active.user', 'user']])],
    files: [
      file('C:\\IAM\\Stale\\stale-accounts-20260927.csv', dormant.join('\n')),
      ...dormant.map((s) => file(`C:\\IAM\\Queue\\${s}.json`, `{"account":"${s}"}`)),
      file('C:\\IAM\\Stale\\Invoke-StaleAccountRemediation.ps1', GOOD_SCRIPT),
    ],
  });

  it('passes when dormant accounts are neutralised and nothing else is touched', () => {
    expect(gradeVmProject('p04', done()).filter((r) => !r.pass)).toEqual([]);
  });

  it('catches a break-glass account swept up by the engine', () => {
    const f = done();
    f.users.find((u) => u.sam === 'bg-admin01')!.enabled = false;
    expect(gradeVmProject('p04', f).find((r) => r.id === 'p04-untouched')!.pass).toBe(false);
  });

  it('flags a non-cryptographic password generator in the script', () => {
    const f = done();
    f.files.find((x) => x.path.endsWith('.ps1'))!.content = '$pwd = -join (1..32 | % { [char](Get-Random -Min 33 -Max 126) })\nDisable-ADAccount $u';
    expect(gradeVmProject('p04', f).find((r) => r.id === 'p04-script')!.pass).toBe(false);
  });
});

describe('P08 JIT on DC01', () => {
  const done = () => facts({
    scenarios: { p08: SEED },
    pamEnabled: true,
    users: [user('dkim'), user('sec.lead', { memberOf: ['GG-SecurityLeads'] })],
    groups: [group('Domain Admins', [['Administrator', 'user'], ['dkim', 'user', 7150]]), group('GG-SecurityLeads', [['sec.lead', 'user']])],
    files: [file('C:\\IAM\\PAM\\elevations.csv', 'requester,ticket,approver,start,expiry,duration\ndkim,INC-4821,sec.lead,10:31,12:31,2h')],
  });

  it('passes with a ticketed, approved, time-bound elevation', () => {
    expect(gradeVmProject('p08', done()).filter((r) => !r.pass)).toEqual([]);
  });

  it('catches standing (no TTL) Domain Admins membership', () => {
    const f = done();
    f.groups[0]!.members[1]!.ttl = null;
    const r = gradeVmProject('p08', f);
    expect(r.find((x) => x.id === 'p08-no-standing')!.pass).toBe(false);
    expect(r.find((x) => x.id === 'p08-ttl')!.pass).toBe(false);
  });

  it('catches self-approval', () => {
    const f = done();
    f.files[0]!.content = 'requester,ticket,approver\ndkim,INC-4821,dkim';
    expect(gradeVmProject('p08', f).find((r) => r.id === 'p08-log')!.pass).toBe(false);
  });
});

describe('P10 SIEM on DC01', () => {
  const done = () => facts({
    scenarios: { p10: SEED },
    events: [
      { id: 1102, time: LATER, targetUser: '', memberName: '', subjectUser: 'Administrator', logonType: '', group: null },
      ...[1, 2, 3, 4].map(() => ({ id: 4625, time: LATER, targetUser: 'siem.victim', memberName: '', subjectUser: '', logonType: '3', group: null })),
      { id: 4624, time: LATER, targetUser: 'siem.victim', memberName: '', subjectUser: '', logonType: '3', group: null },
      { id: 4728, time: LATER, targetUser: 'Domain Admins', memberName: 'siem.temp', subjectUser: 'Administrator', logonType: '', group: 'Domain Admins' },
    ],
    files: [
      file('C:\\IAM\\SIEM\\queries\\failed-then-success.ps1', 'Get-WinEvent ...'),
      file('C:\\IAM\\SIEM\\queries\\privileged-groups.ps1', '4728 4732 4756'),
      file('C:\\IAM\\SIEM\\queries\\mfa-registration.kql', 'AuditLogs | where OperationName has "User registered security info"'),
      file('C:\\IAM\\SIEM\\alerts.csv', 'Rule,Account,Time\nBruteForceThenSuccess,siem.victim,x\nPrivilegedGroupChange,siem.temp,x\nAuditLogCleared (1102),Administrator,x'),
    ],
  });

  it('passes when every indicator is detected', () => {
    expect(gradeVmProject('p10', done()).filter((r) => !r.pass)).toEqual([]);
  });

  it('catches a missing audit-log-cleared detection', () => {
    const f = done();
    f.files[3]!.content = 'Rule,Account\nBruteForceThenSuccess,siem.victim\nPrivilegedGroupChange,siem.temp';
    expect(gradeVmProject('p10', f).find((r) => r.id === 'p10-clear')!.pass).toBe(false);
  });

  it('does not count alerts or queries written before the scenario was set up', () => {
    const f = done();
    for (const x of f.files) x.modified = EARLIER;
    const r = gradeVmProject('p10', f);
    for (const id of ['p10-bruteforce', 'p10-queries', 'p10-mfa']) expect(r.find((x) => x.id === id)!.pass, id).toBe(false);
  });
});
