import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VmSession } from '@/vm/session';
import { dispatch, createShellState } from '@/terminal/dispatcher';
import { runScript } from '@/terminal/script';
import { FS } from '@/terminal/shellIntrinsics';
import { saveScript, loadSavedScripts, SCRIPT_TEMPLATES } from '@/config/scriptTemplates';
import { lessonById } from '@/config/manual';
import { CORP_WIFI, GUEST_WIFI } from '@/services/mockEndpoints';
import type { CapabilityContext } from '@/services';
import { offlineAnswer } from '@/vm/tutor';
import { readEnvironment } from '@/vm/environmentStage';

let session: VmSession;
let ctx: CapabilityContext;
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  FS.reset();
  session = new VmSession(null);
  ctx = { ...session, actor: session.dir.getUserByUsername('admin')!.id };
});
afterEach(() => vi.unstubAllGlobals());

describe('analyst onboarding', () => {
  it('runs the Tutor reference script and provisions all twenty CSV employees', () => {
    for (const cmd of ['New-ADOrganizationalUnit -Name Corp', 'New-ADOrganizationalUnit -Name Users -Path Corp', 'New-ADOrganizationalUnit -Name Groups -Path Corp']) expect(dispatch(cmd, ctx).ok).toBe(true);
    const answer = offlineAnswer('Create me a PowerShell script to onboard 20 employees', { env: readEnvironment(session.dir), mode: 'answer' });
    const csv = answer.text.match(/```csv\n([\s\S]*?)\n```/)![1]!;
    const script = answer.text.match(/```powershell\n([\s\S]*?)\n```/)![1]!;
    expect(FS.writeFile('C:\\Users\\admin\\Documents\\onboarding.csv', csv).ok).toBe(true);
    const result = runScript(script, ctx);
    expect(result.ok, JSON.stringify(result.results.filter(r => !r.result.ok))).toBe(true);
    for (let i = 1; i <= 20; i++) {
      const username = `employee${String(i).padStart(3, '0')}`;
      expect(session.dir.getUserByUsername(username)).toBeDefined();
      expect(dispatch(`Get-ADPrincipalGroupMembership -Identity ${username}`, ctx).output).toContain('grp-hr-readers');
    }
  });
  it('loads the onboarding template from the lesson and explains missing sample accounts', () => {
    expect(lessonById('analyst-provision')?.scriptTemplate).toBe('bulk-onboarding-csv');
    const missing = dispatch('Get-ADPrincipalGroupMembership -Identity ana.smith', ctx);
    expect(missing.ok).toBe(false);
    expect(missing.output).toContain('Get-ADUser -Filter *');
    expect(missing.output).toContain('Bulk onboarding from a CSV list');
    for (const cmd of ['New-ADOrganizationalUnit -Name Corp', 'New-ADOrganizationalUnit -Name Users -Path Corp', 'New-ADOrganizationalUnit -Name Groups -Path Corp']) {
      expect(dispatch(cmd, ctx).ok).toBe(true);
    }
    const result = runScript(SCRIPT_TEMPLATES.find(t => t.id === 'bulk-onboarding-csv')!.body, ctx);
    expect(result.ok, JSON.stringify(result.results.filter(r => !r.result.ok))).toBe(true);
    const groups = dispatch('Get-ADPrincipalGroupMembership -Identity ana.smith', ctx);
    expect(groups.ok).toBe(true);
    expect(groups.output).toContain('grp-hr-readers');
  });
});

describe('saved PowerShell scripts', () => {
  it('previews the CSV in the terminal with an object pipeline', () => {
    const result = dispatch('Import-Csv -Path "C:\\Users\\admin\\Documents\\new-hires.csv" | Select-Object SamAccountName,Department', ctx);
    expect(result.ok, result.output).toBe(true);
    expect(result.output).toContain('ana.smith');
    expect(result.output).toContain('Help Desk');
  });
  it('reads actual CSV rows, including quoted commas, before provisioning', () => {
    expect(FS.readFile('C:\\Users\\admin\\Documents\\new-hires.csv')).toContain('ana.smith');
    FS.writeFile('C:\\Users\\admin\\Documents\\intake.csv', 'Username,Name,Department\nintake.one,"One, Intake",Help Desk\n');
    const result = runScript('$users = Import-Csv -Path "C:\\Users\\admin\\Documents\\intake.csv"\nforeach ($user in $users) {\nNew-ADUser -SamAccountName $user.Username -Name $user.Name -Department $user.Department\n}', ctx);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(session.dir.getUserByUsername('intake.one')?.displayName).toBe('One, Intake');
  });
  it('saves a real ps1 file and updates it instead of duplicating it', () => {
    saveScript('membership', 'Get-ADUser');
    saveScript('membership.ps1', 'Get-ADGroup');
    expect(loadSavedScripts()).toHaveLength(1);
    expect(FS.readFile('C:\\Users\\admin\\Scripts\\membership.ps1')).toBe('Get-ADGroup');
  });
  it('executes relative and quoted saved script paths against the directory', () => {
    saveScript('create test.ps1', "New-ADUser -SamAccountName test.runner -Name 'Test Runner' -Department IT");
    const shell = createShellState();
    expect(dispatch('cd Scripts', ctx, shell).ok).toBe(true);
    const result = dispatch('& ".\\create test.ps1"', ctx, shell);
    expect(result.ok, result.output).toBe(true);
    expect(session.dir.getUserByUsername('test.runner')).toBeDefined();
    expect(dispatch('& ".\\missing.ps1"', ctx, shell).ok).toBe(false);
  });
  it('supports scalar variables without replacing literals in single quotes', () => {
    const result = runScript("$department = 'Help Desk'\n$names = @('test.one','test.two')\nforeach ($name in $names) {\nNew-ADUser -SamAccountName $name -Name $name -Department $department\n}\nWrite-Output '$department'", ctx);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(session.dir.getUserByUsername('test.one')?.department).toBe('Help Desk');
    expect(result.results.at(-1)?.result.output).toContain('$department');
  });
  it('rejects recursive saved scripts without hanging the workstation', () => {
    saveScript('loop.ps1', '.\\loop.ps1');
    const shell = createShellState();
    dispatch('cd Scripts', ctx, shell);
    expect(dispatch('.\\loop.ps1', ctx, shell).ok).toBe(false);
  });
});

describe('endpoint browsing', () => {
  it('blocks public sites while Wi-Fi is off, disconnected, or missing a DHCP lease', () => {
    const endpoint = session.endpoints.ensureFor(ctx.actor)!;
    const url = 'https://learn.microsoft.com/';
    expect(session.endpoints.webAccess(endpoint.name, url).ok).toBe(true);
    session.endpoints.setAdapterEnabled(endpoint.name, false, ctx.actor);
    expect(session.endpoints.webAccess(endpoint.name, url).ok).toBe(false);
    session.endpoints.setAdapterEnabled(endpoint.name, true, ctx.actor);
    expect(session.endpoints.webAccess(endpoint.name, url).ok).toBe(true);
    session.endpoints.disconnectWifi(endpoint.name, ctx.actor);
    expect(session.endpoints.webAccess(endpoint.name, url).ok).toBe(false);
    session.endpoints.connectWifi(endpoint.name, CORP_WIFI, ctx.actor);
    session.endpoints.releaseIp(endpoint.name, ctx.actor);
    expect(session.endpoints.webAccess(endpoint.name, url).ok).toBe(false);
  });
  it('allows guest internet but requires the corporate network for internal sites', () => {
    const endpoint = session.endpoints.ensureFor(ctx.actor)!;
    session.endpoints.connectWifi(endpoint.name, GUEST_WIFI, ctx.actor);
    expect(session.endpoints.webAccess(endpoint.name, 'https://learn.microsoft.com/').ok).toBe(true);
    expect(session.endpoints.webAccess(endpoint.name, 'https://intranet.omari.test/').ok).toBe(false);
    session.endpoints.connectWifi(endpoint.name, CORP_WIFI, ctx.actor);
    expect(session.endpoints.webAccess(endpoint.name, 'https://intranet.omari.test/').ok).toBe(true);
  });
});
