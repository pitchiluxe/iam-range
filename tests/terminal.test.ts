/**
 * tests/terminal.test.ts — PowerShell-style command line over the capability
 * registry. The terminal is a second surface onto the same actions the IAM
 * Console exposes, so a learner can resolve a ticket either way — which is how
 * the job actually works.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MockAuditLog, MockDirectory, MockIdP, MockTicketQueue } from '@/services';
import type { CapabilityContext } from '@/services';
import { tokenize } from '@/terminal/tokenizer';
import { createShellState, dispatch } from '@/terminal/dispatcher';
import { formatTable } from '@/terminal/format';

describe('tokenize', () => {
  it('splits a bare cmdlet', () => {
    expect(tokenize('Get-ADUser')).toEqual({ cmdlet: 'Get-ADUser', args: {}, positional: [] });
  });

  it('reads -Param value pairs', () => {
    expect(tokenize('Unlock-ADAccount -Identity jane.doe')).toEqual({
      cmdlet: 'Unlock-ADAccount',
      args: { Identity: 'jane.doe' },
      positional: [],
    });
  });

  it('keeps quoted values together', () => {
    const r = tokenize('Move-ADObject -Identity jane.doe -TargetDepartment "Engineering Ops"');
    expect(r.args.TargetDepartment).toBe('Engineering Ops');
  });

  it('handles single quotes too', () => {
    expect(tokenize("New-ADGroup -Name 'grp-finance ops'").args.Name).toBe('grp-finance ops');
  });

  it('treats a trailing switch as true', () => {
    const r = tokenize('Set-ADAccountPassword -Identity a -NewPassword b -ChangePasswordAtLogon');
    expect(r.args.ChangePasswordAtLogon).toBe('true');
  });

  it('treats a switch followed by another switch as true', () => {
    const r = tokenize('Set-ADAccountPassword -ChangePasswordAtLogon -Identity a');
    expect(r.args.ChangePasswordAtLogon).toBe('true');
    expect(r.args.Identity).toBe('a');
  });

  it('returns an empty cmdlet for blank input', () => {
    expect(tokenize('   ').cmdlet).toBe('');
  });

  it('is case-preserving for values but not the cmdlet lookup', () => {
    expect(tokenize('get-aduser -Department Finance').cmdlet).toBe('get-aduser');
  });
});

describe('formatTable', () => {
  it('aligns columns under their headers', () => {
    const out = formatTable([
      { Name: 'Ana', Dept: 'Finance' },
      { Name: 'Benjamin', Dept: 'IT' },
    ]);
    const lines = out.split('\n');
    expect(lines[0]).toMatch(/^Name\s+Dept$/);
    expect(lines[1]).toMatch(/^-+\s+-+$/);
    expect(lines[2]!.startsWith('Ana')).toBe(true);
    // Every row must be padded to the same column start.
    const col = lines[0]!.indexOf('Dept');
    expect(lines[2]!.indexOf('Finance')).toBe(col);
    expect(lines[3]!.indexOf('IT')).toBe(col);
  });

  it('renders booleans and nulls readably', () => {
    const out = formatTable([{ Enabled: true, Manager: null }]);
    expect(out).toContain('True');
    expect(out).toContain('—');
  });

  it('returns an empty string for no rows', () => {
    expect(formatTable([])).toBe('');
  });
});

describe('dispatch', () => {
  let ctx: CapabilityContext;

  beforeEach(() => {
    const audit = new MockAuditLog();
    const dir = new MockDirectory(audit);
    const idp = new MockIdP(audit, dir);
    const tickets = new MockTicketQueue(audit);
    const admin = dir.createUser({
      username: 'admin',
      displayName: 'Admin',
      email: 'admin@northwind.example',
      department: 'IT',
      title: 'IAM Admin',
      mfa: 'none',
    });
    dir.createUser({
      username: 'jane.doe',
      displayName: 'Jane Doe',
      email: 'jane.doe@northwind.example',
      department: 'Finance',
      title: 'Analyst',
      mfa: 'totp',
    });
    idp.seedPasswords({ 'jane.doe': 'old' });
    ctx = { dir, idp, tickets, audit, actor: admin.id };
  });

  it('runs a query and returns a table', () => {
    const r = dispatch('Get-ADUser', ctx);
    expect(r.ok).toBe(true);
    expect(r.output).toContain('SamAccountName');
    expect(r.output).toContain('jane.doe');
  });

  it('performs a real mutation', () => {
    const r = dispatch('Set-ADAccountPassword -Identity jane.doe -NewPassword Fresh1', ctx);
    expect(r.ok).toBe(true);
    expect(ctx.idp.signIn('jane.doe', 'Fresh1').ok).toBe(true);
  });

  it('honours a switch parameter', () => {
    dispatch(
      'Set-ADAccountPassword -Identity jane.doe -NewPassword Fresh1 -ChangePasswordAtLogon',
      ctx,
    );
    const r = ctx.idp.signIn('jane.doe', 'Fresh1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('must-change-password');
  });

  it('matches cmdlets case-insensitively, as PowerShell does', () => {
    expect(dispatch('get-aduser', ctx).ok).toBe(true);
    expect(dispatch('GET-ADUSER', ctx).ok).toBe(true);
  });

  it('reports an unknown cmdlet in PowerShell’s wording', () => {
    const r = dispatch('Get-Nonsense', ctx);
    expect(r.ok).toBe(false);
    expect(r.output).toContain("The term 'Get-Nonsense' is not recognized");
  });

  it('names the missing parameter rather than failing silently', () => {
    const r = dispatch('Unlock-ADAccount', ctx);
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/Identity/);
  });

  it('surfaces a capability error verbatim', () => {
    const r = dispatch('Unlock-ADAccount -Identity ghost', ctx);
    expect(r.ok).toBe(false);
    expect(r.output).toContain('Cannot find an object with identity');
  });

  it('Get-Help lists the parameters for a cmdlet', () => {
    const r = dispatch('Get-Help Set-ADAccountPassword', ctx);
    expect(r.ok).toBe(true);
    expect(r.output).toContain('-Identity');
    expect(r.output).toContain('-NewPassword');
  });

  it('bare Get-Help lists every available cmdlet', () => {
    const r = dispatch('Get-Help', ctx);
    expect(r.output).toContain('Get-ADUser');
    expect(r.output).toContain('Unlock-ADAccount');
  });

  it('empty input is a no-op, not an error', () => {
    const r = dispatch('   ', ctx);
    expect(r.ok).toBe(true);
    expect(r.output).toBe('');
  });

  it('signals the clear and exit intrinsics to the caller', () => {
    expect(dispatch('cls', ctx).control).toBe('clear');
    expect(dispatch('Clear-Host', ctx).control).toBe('clear');
    expect(dispatch('exit', ctx).control).toBe('exit');
  });
});

describe('Windows shell built-ins', () => {
  let ctx: CapabilityContext;

  beforeEach(() => {
    const audit = new MockAuditLog();
    const dir = new MockDirectory(audit);
    const idp = new MockIdP(audit, dir);
    const tickets = new MockTicketQueue(audit);
    const admin = dir.createUser({
      username: 'admin',
      displayName: 'Admin',
      email: 'admin@northwind.example',
      department: 'IT',
      title: 'IAM Admin',
      mfa: 'none',
    });
    dir.createUser({
      username: 'jane.doe',
      displayName: 'Jane Doe',
      email: 'jane.doe@northwind.example',
      department: 'Finance',
      title: 'Analyst',
      mfa: 'totp',
    });
    ctx = { dir, idp, tickets, audit, actor: admin.id };
  });

  it('dir lists the simulated filesystem', () => {
    const r = dispatch('dir', ctx);
    expect(r.ok).toBe(true);
    expect(r.output).toContain('Directory of');
    expect(r.output).toContain('Evidence');
  });

  it('cd changes directory and pwd reflects it', () => {
    const shell = createShellState();
    dispatch('cd Runbooks', ctx, shell);
    expect(dispatch('pwd', ctx, shell).output).toContain('Runbooks');
  });

  it('cd .. goes back up', () => {
    const shell = createShellState();
    dispatch('cd Runbooks', ctx, shell);
    dispatch('cd ..', ctx, shell);
    expect(dispatch('pwd', ctx, shell).output).not.toContain('Runbooks');
  });

  it('cd into a missing directory reports it rather than moving', () => {
    const shell = createShellState();
    const before = dispatch('pwd', ctx, shell).output;
    const r = dispatch('cd Nowhere', ctx, shell);
    expect(r.output).toMatch(/Cannot find path/);
    expect(dispatch('pwd', ctx, shell).output).toBe(before);
  });

  it('whoami reports the simulated operator, not the real machine user', () => {
    const out = dispatch('whoami', ctx).output;
    expect(out).toBe(String.raw`IAMLAB\admin`);
  });

  it('hostname and ipconfig describe the simulated workstation', () => {
    expect(dispatch('hostname', ctx).output).toBe('IAMLAB-WS01');
    const ip = dispatch('ipconfig', ctx).output;
    expect(ip).toContain('IPv4 Address');
    expect(ip).toContain('10.20.4.31');
  });

  it('net user lists directory accounts', () => {
    const out = dispatch('net user', ctx).output;
    expect(out).toContain('jane.doe');
  });

  it('net user <name> shows one account from the live directory', () => {
    const out = dispatch('net user jane.doe', ctx).output;
    expect(out).toContain('Jane Doe');
    expect(out).toContain('Account active');
  });

  it('net user for an unknown name gives the real tool wording', () => {
    expect(dispatch('net user ghost', ctx).output).toMatch(/could not be found/i);
  });

  it('echo prints its arguments', () => {
    expect(dispatch('echo hello there', ctx).output).toBe('hello there');
  });

  it('ping and nslookup answer without touching the network', () => {
    expect(dispatch('ping nw-dc01', ctx).output).toContain('Packets: Sent = 4');
    expect(dispatch('nslookup northwind.example', ctx).output).toContain('Address');
  });

  it('built-ins do not shadow IAM cmdlets', () => {
    expect(dispatch('Get-ADUser', ctx).output).toContain('SamAccountName');
  });

  it('Get-Help advertises both cmdlets and shell commands', () => {
    const out = dispatch('Get-Help', ctx).output;
    expect(out).toContain('IAM cmdlets:');
    expect(out).toContain('Shell commands:');
    expect(out).toContain('whoami');
  });
});
