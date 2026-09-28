/**
 * tests/adTerminal.test.ts — the terminal speaks the ActiveDirectory module's
 * language: real -Path distinguished names, -Filter, -Identity, -Properties,
 * real output, and a pipeline that carries objects.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { VmSession } from '@/vm/session';
import { dispatch, createShellState } from '@/terminal/dispatcher';
import { tokenize } from '@/terminal/tokenizer';
import { parseFilter, resolveOuPath, DOMAIN_DN } from '@/terminal/adObjects';
import { runCommand } from '@/vm/adlab/commands';
import { startingState } from '@/vm/adlab/labs';
import { BROWSER_HOME, IAM_BOOKMARKS, isAllowedUrl } from '@/config/webAllowlist';
import type { CapabilityContext } from '@/services';

let s: VmSession;
let ctx: CapabilityContext;
const sh = createShellState();
const run = (line: string) => dispatch(line, ctx, sh);

beforeEach(() => {
  s = new VmSession(null);
  ctx = { dir: s.dir, idp: s.idp, tickets: s.tickets, audit: s.audit, pim: s.pim, cloud: s.cloud, endpoints: s.endpoints, actor: s.dir.getUserByUsername('admin')!.id } as CapabilityContext;
  for (const line of [
    'New-ADOrganizationalUnit -Name Corp',
    `New-ADOrganizationalUnit -Name Groups -Path "OU=Corp,${DOMAIN_DN}"`,
    `New-ADOrganizationalUnit Users -Path "OU=Corp,${DOMAIN_DN}"`,
  ]) expect(run(line).ok, line).toBe(true);
});

describe('New-ADGroup, as written in real scripts', () => {
  it('accepts the full real-world form with a distinguished-name -Path', () => {
    const r = run(`New-ADGroup -Name "grp-finance" -SamAccountName grp-finance -GroupCategory Security -GroupScope Global -DisplayName "Finance" -Path "OU=Groups,OU=Corp,${DOMAIN_DN}" -Description "Finance team"`);
    expect(r.ok, r.output).toBe(true);
    expect(r.output).toBe(''); // the real cmdlet prints nothing on success
    const g = s.dir.getGroupByName('grp-finance')!;
    expect(s.dir.getOu(g.ouId!)?.name).toBe('Groups');
    expect(g.scope).toBe('Global');
  });

  it('takes Name and GroupScope by position, in any case', () => {
    expect(run('new-adgroup grp-dl DomainLocal -path Groups').ok).toBe(true);
    expect(s.dir.getGroupByName('grp-dl')?.scope).toBe('DomainLocal');
  });

  it('defaults a missing -GroupScope to Global instead of failing', () => {
    expect(run('New-ADGroup -Name grp-plain').ok).toBe(true);
    expect(s.dir.getGroupByName('grp-plain')?.scope).toBe('Global');
  });

  it('refuses a scope that does not exist, with PowerShell\'s message', () => {
    const r = run('New-ADGroup -Name grp-bad -GroupScope Worldwide');
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/DomainLocal, Global, Universal/);
  });

  it('refuses a -Path that does not exist and creates nothing', () => {
    const r = run(`New-ADGroup -Name grp-x -Path "OU=Nowhere,${DOMAIN_DN}"`);
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/Directory object not found/);
    expect(s.dir.getGroupByName('grp-x')).toBeUndefined();
  });
});

describe('Get-ADUser, as on a domain controller', () => {
  beforeEach(() => {
    run(`New-ADUser -Name "Priya Nair" -GivenName Priya -Surname Nair -SamAccountName pnair -Path "OU=Users,OU=Corp,${DOMAIN_DN}" -AccountPassword (ConvertTo-SecureString "Pass@word1!" -AsPlainText -Force) -Enabled $true -Department Finance`);
  });

  it('-Filter * lists every account with the default property set', () => {
    const out = run('Get-ADUser -Filter *').output;
    for (const k of ['DistinguishedName', 'Enabled', 'GivenName', 'Name', 'ObjectClass', 'ObjectGUID', 'SamAccountName', 'SID', 'Surname', 'UserPrincipalName']) {
      expect(out).toContain(`${k}`);
    }
    expect(out).toContain(`CN=Priya Nair,OU=Users,OU=Corp,${DOMAIN_DN}`);
    expect(out).not.toMatch(/user\(s\)/);
  });

  it('-filter* typed without the space still works', () => {
    expect(run('Get-ADUser -filter*').output).toContain('pnair');
  });

  it('needs -Filter or -Identity, like the real cmdlet', () => {
    const r = run('Get-ADUser');
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/missing mandatory parameters: Filter/);
  });

  it('-Identity, positionally or by DN, and the real not-found error', () => {
    expect(run('Get-ADUser pnair').output).toContain('SamAccountName    : pnair');
    expect(run(`Get-ADUser -Identity "CN=Priya Nair,OU=Users,OU=Corp,${DOMAIN_DN}"`).output).toContain('pnair');
    expect(run('Get-ADUser nobody').output).toBe(`Get-ADUser : Cannot find an object with identity: 'nobody' under: '${DOMAIN_DN}'.`);
  });

  it('-Properties adds attributes; the filter language works', () => {
    expect(run('Get-ADUser pnair -Properties Department,MemberOf').output).toMatch(/Department\s+: Finance/);
    expect(run("Get-ADUser -Filter 'Department -eq \"Finance\" -and Enabled -eq $true' | Select-Object -ExpandProperty SamAccountName").output).toBe('pnair');
    expect(run('Get-ADUser -Filter {Name -like "Pri*"} | Select-Object -ExpandProperty SamAccountName').output).toBe('pnair');
    expect(run('Get-ADUser -LDAPFilter "(sAMAccountName=pn*)" | Select-Object -ExpandProperty Name').output).toBe('Priya Nair');
    expect(run(`Get-ADUser -Filter * -SearchBase "OU=Corp,${DOMAIN_DN}" | Measure-Object`).output).toMatch(/Count\s+: 1/);
  });

  it('pipes objects: Select-Object, Where-Object, Sort-Object, Format-Table', () => {
    const t = run('Get-ADUser -Filter * | Where-Object { $_.Enabled -eq $true } | Sort-Object Name | Select-Object Name,SamAccountName').output;
    expect(t).toMatch(/Name\s+SamAccountName/);
    expect(t.indexOf('Administrator')).toBeLessThan(t.indexOf('Priya Nair'));
    expect(run('Get-ADUser -Filter * | ft Name').output).not.toContain('SamAccountName');
    expect(run('Get-ADUser -Filter * | Where-Object Name -like "Pri*" | Select-Object -First 1 -ExpandProperty SamAccountName').output).toBe('pnair');
  });
});

describe('real syntax for the other AD cmdlets', () => {
  it('Add-ADGroupMember -Identity <group> -Members a,b', () => {
    run('New-ADGroup grp-team Global -Path Groups');
    run('New-ADUser -Name ana -Department IT');
    expect(run('Add-ADGroupMember -Identity grp-team -Members ana,admin').ok).toBe(true);
    expect(run('Get-ADGroupMember grp-team | Select-Object -ExpandProperty SamAccountName').output.split('\n').sort()).toEqual(['admin', 'ana']);
  });

  it('Get-ADGroup and Get-ADOrganizationalUnit return real objects', () => {
    run('New-ADGroup grp-u Universal -Path Groups');
    expect(run('Get-ADGroup grp-u').output).toMatch(/GroupScope\s+: Universal/);
    expect(run('Get-ADOrganizationalUnit -Filter * | Select-Object -ExpandProperty DistinguishedName').output).toContain(`OU=Groups,OU=Corp,${DOMAIN_DN}`);
  });
});

describe('parsing pieces', () => {
  it('keeps a { script block } together as one argument', () => {
    expect(tokenize('Where-Object { $_.Name -like "j*" }').positional).toEqual(['{ $_.Name -like "j*" }']);
  });

  it('resolves DNs, canonical names and plain OU names, and refuses a wrong parent', () => {
    const ou = s.dir.getOuByName('Groups')!;
    expect(resolveOuPath(s.dir, `OU=Groups,OU=Corp,${DOMAIN_DN}`)).toEqual({ ok: true, ouId: ou.id });
    expect(resolveOuPath(s.dir, 'Corp/Groups')).toEqual({ ok: true, ouId: ou.id });
    expect(resolveOuPath(s.dir, 'Groups')).toEqual({ ok: true, ouId: ou.id });
    expect(resolveOuPath(s.dir, DOMAIN_DN)).toEqual({ ok: true, ouId: undefined });
    expect(resolveOuPath(s.dir, `OU=Groups,OU=Users,${DOMAIN_DN}`).ok).toBe(false);
  });

  it('reports a malformed filter instead of matching everything', () => {
    expect(parseFilter('Name -frob "x"').ok).toBe(false);
  });
});

describe('AD Lab (DC01 simulator)', () => {
  it('accepts -filter* and prints Get-ADUser -Filter * as property lists', () => {
    const lab = startingState('adl-12');
    const out = runCommand(lab, 'DC01', 'Get-ADUser -filter*').output;
    expect(out).toMatch(/SamAccountName\s+: Administrator/);
    expect(out).toMatch(/Enabled\s+: True/);
  });

  it('New-ADGroup takes the scope by position, and defaults it', () => {
    const lab = startingState('adl-12');
    expect(runCommand(lab, 'DC01', 'New-ADGroup grp-a Global').ok).toBe(true);
    expect(runCommand(lab, 'DC01', 'New-ADGroup -Name grp-b').ok).toBe(true);
    expect(lab.ad.groups.find((g) => g.name === 'grp-a')?.scope).toBe('Global');
    expect(lab.ad.groups.find((g) => g.name === 'grp-b')?.scope).toBe('Global');
    expect(runCommand(lab, 'DC01', 'New-ADGroup grp-c Planet').output).toMatch(/DomainLocal, Global, Universal/);
  });
});

describe('browser home page', () => {
  it('opens on erickomari.vercel.app, which is allowlisted and bookmarked', () => {
    expect(BROWSER_HOME).toBe('https://erickomari.vercel.app/');
    expect(isAllowedUrl(BROWSER_HOME)).toBe(true);
    expect(IAM_BOOKMARKS[0]).toEqual({ label: 'Home', url: BROWSER_HOME });
  });
});
