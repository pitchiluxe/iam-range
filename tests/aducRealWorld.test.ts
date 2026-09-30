/**
 * tests/aducRealWorld.test.ts — the directory behaves like the real one behind
 * the redesigned Active Directory Users and Computers console.
 *
 * The classic ADUC exercise builds USA, Europe and Asia, each with Users,
 * Computers and Servers beneath it. That needs OU names to be unique among
 * siblings rather than across the domain, which is what AD actually enforces.
 * The rest covers what the new property sheets and menus write: Set-ADUser
 * attributes, protection from accidental deletion, group scope conversion
 * rules, Rename-ADObject, moving OUs, and the Delegation of Control Wizard.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { VmSession } from '@/vm/session';
import { dispatch, createShellState } from '@/terminal/dispatcher';
import { DOMAIN_DN } from '@/terminal/adObjects';
import { CAPABILITY_BY_ID, type CapabilityContext } from '@/services';
import { userAccountControl } from '@/services/adAttributes';
import { childrenOf, objectByKey, parentKey, canonicalOf } from '@/ui/consoles/aduc/model';
import { serializeSession, restoreSession } from '@/vm/sessionStore';

let s: VmSession;
let ctx: CapabilityContext;
const sh = createShellState();
const run = (line: string) => dispatch(line, ctx, sh);
const cap = (id: string, args: Record<string, string>) => CAPABILITY_BY_ID[id]!.run(ctx, args);

beforeEach(() => {
  s = new VmSession(null);
  ctx = { dir: s.dir, idp: s.idp, tickets: s.tickets, audit: s.audit, pim: s.pim, cloud: s.cloud, endpoints: s.endpoints, actor: s.dir.getUserByUsername('admin')!.id } as CapabilityContext;
});

describe('OU names are unique among siblings, not across the domain', () => {
  beforeEach(() => {
    for (const region of ['USA', 'Europe', 'Asia']) {
      expect(run(`New-ADOrganizationalUnit -Name ${region} -Path "${DOMAIN_DN}"`).ok).toBe(true);
      for (const sub of ['Users', 'Computers', 'Servers']) {
        const r = run(`New-ADOrganizationalUnit -Name ${sub} -Path "OU=${region},${DOMAIN_DN}"`);
        expect(r.ok, `${region}/${sub}: ${r.output}`).toBe(true);
      }
    }
  });

  it('builds USA, Europe and Asia each with Users, Computers and Servers', () => {
    expect(s.dir.listOus()).toHaveLength(12);
    expect(s.dir.listOus().filter((o) => o.name === 'Users')).toHaveLength(3);
    expect(new Set(s.dir.listOus().map((o) => o.id)).size).toBe(12);
  });

  it('still refuses two OUs of the same name under the same parent', () => {
    const r = run(`New-ADOrganizationalUnit -Name Users -Path "OU=USA,${DOMAIN_DN}"`);
    expect(r.ok).toBe(false);
  });

  it('places a user by distinguished name into the right one of three "Users" OUs', () => {
    const r = run(`New-ADUser -Name "Ana Lima" -SamAccountName ana.lima -Path "OU=Users,OU=Europe,${DOMAIN_DN}"`);
    expect(r.ok, r.output).toBe(true);
    const u = s.dir.getUserByUsername('ana.lima')!;
    expect(s.dir.ouPath(u.ouId!)).toBe('Europe/Users');
  });

  it('refuses to guess when a bare name is ambiguous, and names the choices', () => {
    const r = cap('user.create', { SamAccountName: 'x.y', Name: 'X Y', Path: 'Users' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/USA\/Users.*Europe\/Users|Europe\/Users.*USA\/Users/);
    expect(cap('user.create', { SamAccountName: 'x.y', Name: 'X Y', Path: 'Asia/Users' }).ok).toBe(true);
  });

  it('shows each region with its own children in the console tree', () => {
    const view = { advanced: false, types: null };
    const usa = s.dir.getOuByName('USA')!;
    const names = childrenOf(`ou:${usa.id}`, s.dir, view).map((o) => o.name);
    expect(names).toEqual(['Computers', 'Servers', 'Users']);
    const europeUsers = s.dir.resolveOuRef('Europe/Users').ou!;
    expect(canonicalOf(`ou:${europeUsers.id}`, s.dir)).toBe('omari.test/Europe/Users');
  });

  it('survives a save and restore', () => {
    const json = serializeSession(s);
    const t = new VmSession(null);
    expect(restoreSession(t, json)).toBe(true);
    expect(t.dir.resolveOuRef('Asia/Servers').ou).toBeDefined();
  });
});

describe('the console tree looks like a new domain controller', () => {
  it('has the default containers, Domain Controllers as an OU, and advanced ones only on request', () => {
    const basic = childrenOf('domain', s.dir, { advanced: false, types: null }).map((o) => o.name);
    expect(basic).toEqual(['Builtin', 'Computers', 'Domain Controllers', 'ForeignSecurityPrincipals', 'Managed Service Accounts', 'Users']);
    const adv = childrenOf('domain', s.dir, { advanced: true, types: null }).map((o) => o.name);
    expect(adv).toContain('LostAndFound');
    expect(adv).toContain('System');
    expect(adv.slice(-2)).toEqual(['NTDS Quotas', 'TPM Devices']);
  });

  it('lists the default groups in Users without a second Administrator', () => {
    // A default group made real (Add to a group > Domain Admins) replaces its placeholder.
    expect(CAPABILITY_BY_ID['group.create']!.run(ctx, { Name: 'Domain Admins' }).ok).toBe(true);
    expect(childrenOf('c:users', s.dir, { advanced: false, types: null }).filter((o) => o.name === 'Domain Admins')).toHaveLength(1);
    const users = childrenOf('c:users', s.dir, { advanced: false, types: null });
    const names = users.map((o) => o.name);
    expect(names).toContain('Domain Admins');
    expect(names).toContain('krbtgt');
    expect(users.find((o) => o.name === 'Domain Admins')?.type).toBe('Security Group - Global');
    expect(names.filter((n) => /^administrator$/i.test(n))).toHaveLength(1);
  });

  it('knows where every object lives, for Up One Level', () => {
    const admin = s.dir.getUserByUsername('admin')!;
    expect(parentKey(`user:${admin.id}`, s.dir)).toBe('c:users');
    expect(objectByKey('c:dcs', s.dir)?.type).toBe('Organizational Unit');
  });
});

describe('Set-ADUser writes what the Properties sheet shows', () => {
  beforeEach(() => {
    expect(run('New-ADUser -Name "Alex Rivera" -SamAccountName alex.rivera').ok).toBe(true);
  });

  it('stores named attributes under their LDAP names', () => {
    expect(run('Set-ADUser alex.rivera -Office "B-12" -City Paris -OfficePhone "555-0100" -Company OMARI').ok).toBe(true);
    const a = s.dir.getUserByUsername('alex.rivera')!.attrs!;
    expect(a.physicalDeliveryOfficeName).toBe('B-12');
    expect(a.l).toBe('Paris');
    expect(a.telephoneNumber).toBe('555-0100');
    expect(a.company).toBe('OMARI');
  });

  it('supports -Replace and -Clear', () => {
    expect(run(`Set-ADUser alex.rivera -Replace @{info='Contractor'; pager='555-0199'}`).ok).toBe(true);
    expect(s.dir.getUserByUsername('alex.rivera')!.attrs?.info).toBe('Contractor');
    expect(run('Set-ADUser alex.rivera -Clear info').ok).toBe(true);
    expect(s.dir.getUserByUsername('alex.rivera')!.attrs?.info).toBeUndefined();
    expect(s.dir.getUserByUsername('alex.rivera')!.attrs?.pager).toBe('555-0199');
  });

  it('sets account options and folds them into userAccountControl', () => {
    expect(run('Set-ADUser alex.rivera -PasswordNeverExpires $true').ok).toBe(true);
    const u = s.dir.getUserByUsername('alex.rivera')!;
    const uac = userAccountControl(u.attrs, u.status);
    expect(uac.value).toBe(0x10200);
    expect(uac.names).toContain('DONT_EXPIRE_PASSWORD');
  });

  it('toggles "must change password" without touching the password', () => {
    expect(run('Set-ADUser alex.rivera -ChangePasswordAtLogon $true').ok).toBe(true);
    expect(s.dir.getUserByUsername('alex.rivera')!.mustChangePassword).toBe(true);
  });

  it('resolves -Manager to an existing account', () => {
    expect(run('Set-ADUser alex.rivera -Manager admin').ok).toBe(true);
    expect(s.dir.getUserByUsername('alex.rivera')!.attrs?.manager).toBe('admin');
    expect(run('Set-ADUser alex.rivera -Manager nobody').ok).toBe(false);
  });

  it('refuses to delete a protected account until protection is cleared', () => {
    expect(run(`Set-ADUser alex.rivera -Replace @{ProtectedFromAccidentalDeletion='TRUE'}`).ok).toBe(true);
    const r = cap('user.delete', { Identity: 'alex.rivera' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/protected from accidental deletion/);
    expect(run('Set-ADUser alex.rivera -Clear ProtectedFromAccidentalDeletion').ok).toBe(true);
    expect(cap('user.delete', { Identity: 'alex.rivera' }).ok).toBe(true);
  });
});

describe('protect container from accidental deletion', () => {
  it('refuses to delete a protected OU with the console\'s message, until cleared', () => {
    expect(cap('ou.create', { Name: 'HR', ProtectedFromAccidentalDeletion: 'true' }).ok).toBe(true);
    const r = run('Remove-ADOrganizationalUnit -Identity "OU=HR,' + DOMAIN_DN + '" -Confirm:$false');
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/protected from accidental deletion/);
    expect(run(`Set-ADOrganizationalUnit -Identity "OU=HR,${DOMAIN_DN}" -ProtectedFromAccidentalDeletion $false`).ok).toBe(true);
    expect(run(`Remove-ADOrganizationalUnit -Identity "OU=HR,${DOMAIN_DN}" -Confirm:$false`).ok).toBe(true);
  });

  it('is off by default from the terminal, so existing labs are unchanged', () => {
    expect(run('New-ADOrganizationalUnit -Name Temp').ok).toBe(true);
    expect(s.dir.getOuByName('Temp')?.protectedFromDeletion).toBeUndefined();
  });
});

describe('group scope conversion follows AD\'s rules', () => {
  beforeEach(() => expect(run('New-ADGroup -Name grp-sales -GroupScope Global').ok).toBe(true));

  it('refuses Global -> Domain Local in one step', () => {
    const r = cap('group.update', { Identity: 'grp-sales', GroupScope: 'DomainLocal' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Universal first/);
  });

  it('allows Global -> Universal -> Domain Local', () => {
    expect(run('Set-ADGroup grp-sales -GroupScope Universal').ok).toBe(true);
    expect(run('Set-ADGroup grp-sales -GroupScope DomainLocal').ok).toBe(true);
    expect(s.dir.getGroupByName('grp-sales')?.scope).toBe('DomainLocal');
  });

  it('sets description, manager and e-mail', () => {
    expect(run(`Set-ADGroup grp-sales -Description "Sales team" -ManagedBy admin -Replace @{mail='sales@omari.test'}`).ok).toBe(true);
    const g = s.dir.getGroupByName('grp-sales')!;
    expect(g.description).toBe('Sales team');
    expect(g.attrs?.managedBy).toBe('admin');
    expect(g.attrs?.mail).toBe('sales@omari.test');
    expect(run('Set-ADGroup grp-sales -Clear description').ok).toBe(true);
    expect(s.dir.getGroupByName('grp-sales')!.description).toBe('');
  });
});

describe('Rename-ADObject and moving OUs', () => {
  beforeEach(() => {
    for (const l of ['New-ADOrganizationalUnit -Name Corp', `New-ADOrganizationalUnit -Name Staff -Path "OU=Corp,${DOMAIN_DN}"`, 'New-ADOrganizationalUnit -Name Archive']) {
      expect(run(l).ok, l).toBe(true);
    }
  });

  it('renames an OU, a group and an account', () => {
    expect(run(`Rename-ADObject -Identity "OU=Staff,OU=Corp,${DOMAIN_DN}" -NewName Employees`).ok).toBe(true);
    expect(s.dir.resolveOuRef('Corp/Employees').ou).toBeDefined();
    expect(run('New-ADGroup -Name grp-a').ok).toBe(true);
    expect(run('Rename-ADObject grp-a -NewName grp-b').ok).toBe(true);
    expect(s.dir.getGroupByName('grp-b')).toBeDefined();
    expect(run('New-ADUser -Name "Sam Doe" -SamAccountName sam.doe').ok).toBe(true);
    expect(run('Rename-ADObject sam.doe -NewName "Samuel Doe"').ok).toBe(true);
    expect(s.dir.getUserByUsername('sam.doe')?.displayName).toBe('Samuel Doe');
  });

  it('moves an OU under another, but never inside itself', () => {
    expect(run(`Move-ADObject -Identity "OU=Staff,OU=Corp,${DOMAIN_DN}" -TargetPath "OU=Archive,${DOMAIN_DN}"`).ok).toBe(true);
    expect(s.dir.resolveOuRef('Archive/Staff').ou).toBeDefined();
    const r = cap('user.move', { Identity: 'Archive', TargetPath: 'Archive/Staff' });
    expect(r.ok).toBe(false);
  });

  it('moves an account back to CN=Users', () => {
    expect(run(`New-ADUser -Name "Kim Lee" -SamAccountName kim.lee -Path "OU=Corp,${DOMAIN_DN}"`).ok).toBe(true);
    expect(run(`Move-ADObject -Identity kim.lee -TargetPath "CN=Users,${DOMAIN_DN}"`).ok).toBe(true);
    expect(s.dir.getUserByUsername('kim.lee')?.ouId).toBeUndefined();
  });
});

describe('Delegation of Control Wizard', () => {
  it('records the tasks delegated to a group on an OU', () => {
    expect(run('New-ADOrganizationalUnit -Name Staff').ok).toBe(true);
    expect(run('New-ADGroup -Name grp-helpdesk').ok).toBe(true);
    const r = cap('ou.delegate', { Path: 'Staff', Trustee: 'grp-helpdesk', Tasks: '2,3' });
    expect(r.ok, !r.ok ? r.error : '').toBe(true);
    const d = s.dir.listDelegations();
    expect(d).toHaveLength(1);
    expect(d[0]!.trustee).toBe('grp-helpdesk');
    expect(d[0]!.tasks[0]).toMatch(/^Reset user passwords/);
    expect(s.audit.events.some((e) => e.action === 'ou.delegated')).toBe(true);
  });

  it('rejects unknown tasks and trustees', () => {
    expect(cap('ou.delegate', { Trustee: 'nobody', Tasks: '1' }).ok).toBe(false);
    expect(cap('ou.delegate', { Trustee: 'admin', Tasks: '99' }).ok).toBe(false);
  });
});
