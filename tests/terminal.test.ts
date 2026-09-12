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
import { FS } from '@/terminal/shellIntrinsics';

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
    // The disk is a module singleton shared with File Explorer, so without
    // this each test inherits whatever the last one created.
    FS.reset();
  });

  it('dir lists the real tree, not a fixed array', () => {
    const r = dispatch('dir', ctx);
    expect(r.ok).toBe(true);
    expect(r.output).toContain('Directory of');
    // The home folders a domain-joined workstation actually has.
    expect(r.output).toContain('Documents');
    expect(r.output).toContain('Scripts');
  });

  it('cd changes directory and pwd reflects it', () => {
    const shell = createShellState();
    dispatch('cd Scripts', ctx, shell);
    expect(dispatch('pwd', ctx, shell).output).toContain('Scripts');
  });

  it('cd .. goes back up', () => {
    const shell = createShellState();
    dispatch('cd Scripts', ctx, shell);
    dispatch('cd ..', ctx, shell);
    expect(dispatch('pwd', ctx, shell).output).not.toContain('Scripts');
  });

  it('cd takes a multi-segment relative path', () => {
    // The old implementation matched a single name against a flat array, so
    // anything containing a backslash simply failed.
    const shell = createShellState();
    dispatch('cd C:\\\\', ctx, shell);
    dispatch(String.raw`cd Windows\System32`, ctx, shell);
    expect(dispatch('pwd', ctx, shell).output).toBe(String.raw`C:\Windows\System32`);
  });

  it('cd takes an absolute path with a space in it', () => {
    const shell = createShellState();
    dispatch(String.raw`cd C:\Program Files`, ctx, shell);
    expect(dispatch('pwd', ctx, shell).output).toBe(String.raw`C:\Program Files`);
  });

  it('cd into a missing directory reports it rather than moving', () => {
    const shell = createShellState();
    const before = dispatch('pwd', ctx, shell).output;
    const r = dispatch('cd Nowhere', ctx, shell);
    expect(r.output).toMatch(/Cannot find path/);
    expect(dispatch('pwd', ctx, shell).output).toBe(before);
  });

  it('mkdir creates a directory that dir then lists', () => {
    const shell = createShellState();
    dispatch('mkdir reports', ctx, shell);
    expect(dispatch('dir', ctx, shell).output).toContain('reports');
    expect(dispatch('cd reports', ctx, shell).output).toBe('');
  });

  it('echo writes a file and type reads it back', () => {
    const shell = createShellState();
    dispatch('echo hello there > note.txt', ctx, shell);
    expect(dispatch('type note.txt', ctx, shell).output).toBe('hello there');
  });

  it('a non-empty directory is not deleted without -Recurse', () => {
    // The refusal is the safety: rm quietly taking a whole tree with it is how
    // people lose work.
    const shell = createShellState();
    dispatch('mkdir keep', ctx, shell);
    dispatch(String.raw`echo x > keep\a.txt`, ctx, shell);

    const refused = dispatch('rm keep', ctx, shell);
    expect(refused.output).toMatch(/not empty/i);
    expect(dispatch('dir', ctx, shell).output).toContain('keep');

    dispatch('rm keep -Recurse', ctx, shell);
    expect(dispatch('dir', ctx, shell).output).not.toContain('keep');
  });

  it('system folders refuse deletion', () => {
    const shell = createShellState();
    const r = dispatch(String.raw`rm C:\Windows -Recurse`, ctx, shell);
    expect(r.output).toMatch(/protected/i);
  });

  it('copy and rename do what they say', () => {
    const shell = createShellState();
    dispatch('echo one > a.txt', ctx, shell);
    dispatch('copy a.txt b.txt', ctx, shell);
    expect(dispatch('type b.txt', ctx, shell).output).toBe('one');

    dispatch('ren b.txt c.txt', ctx, shell);
    const listing = dispatch('dir', ctx, shell).output;
    expect(listing).toContain('c.txt');
    expect(listing).not.toContain('b.txt');
  });

  it('a copied directory is a copy, not the same folder twice', () => {
    const shell = createShellState();
    dispatch('mkdir src', ctx, shell);
    dispatch(String.raw`echo original > src\f.txt`, ctx, shell);
    dispatch('copy src dst', ctx, shell);

    dispatch(String.raw`echo changed > src\f.txt`, ctx, shell);
    expect(dispatch(String.raw`type dst\f.txt`, ctx, shell).output).toBe('original');
  });

  it('tree draws the hierarchy', () => {
    const shell = createShellState();
    const out = dispatch(String.raw`tree C:\Users`, ctx, shell).output;
    expect(out).toContain('admin');
    expect(out).toContain('Documents');
  });

  it('cd.. works without a space, as it does in cmd', () => {
    // Reported as broken. cmd has always let the directory commands run
    // straight into their argument, and everybody types it.
    const shell = createShellState();
    dispatch('cd Scripts', ctx, shell);
    const r = dispatch('cd..', ctx, shell);

    expect(r.output).not.toMatch(/not recognized/i);
    expect(dispatch('pwd', ctx, shell).output).not.toContain('Scripts');
  });

  it('the other glued forms work too', () => {
    const shell = createShellState();
    dispatch('mkdir glued', ctx, shell);

    // cd\ goes to the drive root; cd.. goes up; md<path> makes a directory.
    dispatch('cd glued', ctx, shell);
    expect(dispatch('pwd', ctx, shell).output).toContain('glued');
    dispatch('cd\\', ctx, shell);
    expect(dispatch('pwd', ctx, shell).output).toBe('C:\\');
  });

  it('.. on its own goes up', () => {
    const shell = createShellState();
    dispatch('cd Documents', ctx, shell);
    dispatch('..', ctx, shell);
    expect(dispatch('pwd', ctx, shell).output).not.toContain('Documents');
  });

  it('cdx is not cd x', () => {
    // The unglue rule only fires when the argument starts like a path, so an
    // unknown command is still reported as unknown rather than silently
    // becoming a directory change.
    const shell = createShellState();
    const before = dispatch('pwd', ctx, shell).output;
    dispatch('cdx', ctx, shell);
    expect(dispatch('pwd', ctx, shell).output).toBe(before);
  });

  it('several commands run on one line', () => {
    const shell = createShellState();
    dispatch('mkdir chained; cd chained', ctx, shell);
    expect(dispatch('pwd', ctx, shell).output).toContain('chained');
  });

  it('&& stops when the first command fails', () => {
    const shell = createShellState();
    const before = dispatch('pwd', ctx, shell).output;
    dispatch('cd nowhere-at-all && mkdir should-not-exist', ctx, shell);

    expect(dispatch('dir', ctx, shell).output).not.toContain('should-not-exist');
    expect(dispatch('pwd', ctx, shell).output).toBe(before);
  });

  it('output can be filtered through a pipe', () => {
    const shell = createShellState();
    dispatch('mkdir alpha', ctx, shell);
    dispatch('mkdir beta', ctx, shell);

    const filtered = dispatch('dir | findstr alpha', ctx, shell).output;
    expect(filtered).toContain('alpha');
    expect(filtered).not.toContain('beta');
  });

  it('where finds a cmdlet from the registry rather than a second list', () => {
    const out = dispatch('where New-ADUser', ctx).output;
    expect(out).toContain('New-ADUser');
  });

  it('set reports the domain session, from config', () => {
    const out = dispatch('set', ctx).output;
    expect(out).toContain('COMPUTERNAME=OMARI-WS01');
    expect(out).toContain('USERDOMAIN=OMARI');
  });

  it('pushd and popd go somewhere and come back', () => {
    const shell = createShellState();
    const home = dispatch('pwd', ctx, shell).output;
    dispatch('pushd Scripts', ctx, shell);
    expect(dispatch('pwd', ctx, shell).output).toContain('Scripts');
    dispatch('popd', ctx, shell);
    expect(dispatch('pwd', ctx, shell).output).toBe(home);
  });

  it('taskkill refuses rather than pretending', () => {
    // A command that reports success without doing anything is the exact
    // dishonesty this project keeps removing.
    const out = dispatch('taskkill /IM explorer.exe', ctx).output;
    expect(out).toMatch(/denied|managed/i);
  });

  it('whoami reports the simulated operator, not the real machine user', () => {
    const out = dispatch('whoami', ctx).output;
    expect(out).toBe(String.raw`OMARI\admin`);
  });

  it('hostname and ipconfig describe the simulated workstation', () => {
    expect(dispatch('hostname', ctx).output).toBe('OMARI-WS01');
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
