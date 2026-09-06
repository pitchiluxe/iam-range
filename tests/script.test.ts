/**
 * tests/script.test.ts — the VM's PowerShell script runner.
 *
 * Supports the shape a real bulk-provisioning script has: a list of names at
 * the top, a foreach over it, and cmdlets inside. Deliberately a small subset —
 * arrays, foreach, comments, variable substitution — not an interpreter. A
 * half-built language teaches worse than an honestly limited one, and this is
 * enough for the learner to automate the work a ticket asks for.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MockAuditLog, MockDirectory, MockIdP, MockTicketQueue } from '@/services';
import type { CapabilityContext } from '@/services';
import { parseScript, runScript } from '@/terminal/script';

function makeCtx(): CapabilityContext {
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
  dir.createGroup('grp-finance-payroll', 'Payroll');
  return { dir, idp, tickets, audit, actor: admin.id };
}

describe('parseScript', () => {
  it('ignores comments and blank lines', () => {
    const cmds = parseScript(`# provision the new hires\n\nGet-ADUser\n`);
    expect(cmds).toEqual(['Get-ADUser']);
  });

  it('expands a foreach over an array variable', () => {
    const cmds = parseScript(
      `$names = @('ana.silva','ben.okafor')\n` +
        `foreach ($n in $names) {\n` +
        `  New-ADUser -SamAccountName $n -Name $n -Department Finance\n` +
        `}\n`,
    );
    expect(cmds).toEqual([
      'New-ADUser -SamAccountName ana.silva -Name ana.silva -Department Finance',
      'New-ADUser -SamAccountName ben.okafor -Name ben.okafor -Department Finance',
    ]);
  });

  it('runs several cmdlets per iteration, in order', () => {
    const cmds = parseScript(
      `$names = @('ana.silva')\n` +
        `foreach ($n in $names) {\n` +
        `  New-ADUser -SamAccountName $n -Name $n -Department Finance\n` +
        `  Add-ADGroupMember -Identity $n -Group grp-finance-payroll\n` +
        `}\n`,
    );
    expect(cmds).toHaveLength(2);
    expect(cmds[0]).toContain('New-ADUser');
    expect(cmds[1]).toContain('Add-ADGroupMember');
  });

  it('accepts double-quoted and unquoted array entries', () => {
    expect(parseScript(`$a = @("x", y , 'z')\nforeach ($i in $a) {\n Get-ADUser -Filter $i\n}`)).toEqual(
      ['Get-ADUser -Filter x', 'Get-ADUser -Filter y', 'Get-ADUser -Filter z'],
    );
  });

  it('substitutes a variable used outside a loop', () => {
    expect(parseScript(`$dept = @('Finance')\nforeach ($d in $dept) {\nGet-ADUser -Department $d\n}`)).toEqual(
      ['Get-ADUser -Department Finance'],
    );
  });

  it('leaves an unknown variable alone rather than silently emptying it', () => {
    // Substituting nothing would turn a typo into a subtly wrong command.
    const cmds = parseScript(`New-ADUser -SamAccountName $missing`);
    expect(cmds).toEqual(['New-ADUser -SamAccountName $missing']);
  });

  it('reports an unterminated foreach instead of running half of it', () => {
    expect(() => parseScript(`$n = @('a')\nforeach ($x in $n) {\nGet-ADUser`)).toThrow(/foreach/i);
  });

  it('reports a foreach over an undeclared variable', () => {
    expect(() => parseScript(`foreach ($x in $nope) {\nGet-ADUser\n}`)).toThrow(/\$nope/);
  });

  it('handles an empty script', () => {
    expect(parseScript('')).toEqual([]);
    expect(parseScript('   \n # only a comment \n')).toEqual([]);
  });
});

describe('runScript', () => {
  let ctx: CapabilityContext;
  beforeEach(() => {
    ctx = makeCtx();
  });

  it('bulk-creates users and reports each line', () => {
    const res = runScript(
      `$names = @('ana.silva','ben.okafor','cara.reid')\n` +
        `foreach ($n in $names) {\n` +
        `  New-ADUser -SamAccountName $n -Name $n -Department Finance\n` +
        `}`,
      ctx,
    );
    expect(res.ok).toBe(true);
    expect(res.results).toHaveLength(3);
    for (const name of ['ana.silva', 'ben.okafor', 'cara.reid']) {
      expect(ctx.dir.getUserByUsername(name)).toBeDefined();
    }
  });

  it('creates users and adds them to a group in one run', () => {
    runScript(
      `$names = @('ana.silva')\n` +
        `foreach ($n in $names) {\n` +
        `  New-ADUser -SamAccountName $n -Name $n -Department Finance\n` +
        `  Add-ADGroupMember -Identity $n -Group grp-finance-payroll\n` +
        `}`,
      ctx,
    );
    const u = ctx.dir.getUserByUsername('ana.silva')!;
    const g = ctx.dir.getGroupByName('grp-finance-payroll')!;
    expect(u.groupIds).toContain(g.id);
  });

  it('keeps going after a failing line and reports which failed', () => {
    // One duplicate in the middle must not abandon the rest of the batch —
    // that is exactly the situation bulk provisioning has to survive.
    ctx.dir.createUser({
      username: 'ben.okafor',
      displayName: 'Ben',
      email: 'b@northwind.example',
      department: 'Finance',
      title: 'Analyst',
      mfa: 'none',
    });
    const res = runScript(
      `$names = @('ana.silva','ben.okafor','cara.reid')\n` +
        `foreach ($n in $names) {\n` +
        `  New-ADUser -SamAccountName $n -Name $n -Department Finance\n` +
        `}`,
      ctx,
    );
    expect(res.ok).toBe(false);
    expect(res.failed).toBe(1);
    expect(res.succeeded).toBe(2);
    expect(ctx.dir.getUserByUsername('cara.reid')).toBeDefined();
  });

  it('surfaces a parse error without running anything', () => {
    const res = runScript(`foreach ($x in $nope) {\nNew-ADUser -SamAccountName a -Name a\n}`, ctx);
    expect(res.ok).toBe(false);
    expect(res.parseError).toMatch(/\$nope/);
    expect(ctx.dir.getUserByUsername('a')).toBeUndefined();
  });

  it('records an audit event per created user, so the log matches the run', () => {
    runScript(
      `$names = @('ana.silva','ben.okafor')\nforeach ($n in $names) {\nNew-ADUser -SamAccountName $n -Name $n -Department Finance\n}`,
      ctx,
    );
    expect(ctx.audit.byAction('user.created').length).toBeGreaterThanOrEqual(2);
  });
});
