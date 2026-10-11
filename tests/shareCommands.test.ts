import { describe, it, expect } from 'vitest';
import { VmSession } from '@/vm/session';
import { dispatch } from '@/terminal/dispatcher';
import type { CapabilityContext } from '@/services';

function setup() {
  const session = new VmSession(null);
  const user = session.dir.createUser({ username: 'iduarte', displayName: 'Isabel Duarte', email: 'iduarte@omari.test', department: 'HR', title: 'Analyst', mfa: 'none' });
  const endpoint = session.endpoints.ensureFor(user.id)!;
  session.dir.createShare('Dept-HR', '\\\\FS01\\Dept-HR');
  const ctx = { ...session, actor: session.dir.getUserByUsername('admin')!.id, host: endpoint.name } as CapabilityContext;
  return { session, ctx };
}

describe('share command guidance and identity alias', () => {
  it('grants and revokes access using Identity, including case-insensitive parameters', () => {
    const { ctx } = setup();
    expect(dispatch('Grant-SharePermission -name Dept-HR -identity iduarte -access Modify', ctx).ok).toBe(true);
    expect(dispatch('Get-EffectiveAccess -Name Dept-HR -Identity iduarte', ctx).output).toContain('Modify');
    expect(dispatch('net use S: \\\\FS01\\Dept-HR', ctx).ok).toBe(true);
    expect(dispatch('Revoke-SharePermission -Name Dept-HR -Identity iduarte', ctx).ok).toBe(true);
    expect(dispatch('Get-EffectiveAccess -Name Dept-HR -Identity iduarte', ctx).output).toContain('None');
  });
  it('keeps Trustee working and refuses conflicting aliases', () => {
    const { ctx } = setup();
    expect(dispatch('Grant-SharePermission -Name Dept-HR -Trustee iduarte -Access Read', ctx).ok).toBe(true);
    expect(dispatch('Grant-SharePermission -Name Dept-HR -Trustee admin -Identity iduarte -Access Full', ctx).ok).toBe(false);
    expect(dispatch('Get-EffectiveAccess -Name Dept-HR -Identity iduarte', ctx).output).toContain('Read');
  });
  it('does not silently choose permissions and offers a complete example', () => {
    const { ctx } = setup();
    const result = dispatch('Grant-SharePermission -Name Dept-HR -Identity iduarte', ctx);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('missing required parameter -Access');
    expect(result.output).toContain("-Name 'Dept-HR' -Identity 'iduarte' -Access Modify");
    expect(dispatch('Grant-SharePermission', ctx).output).toContain('Example:');
    expect(dispatch('Get-Help Grant-SharePermission', ctx).output).toContain('-Identity is an alias');
    expect(dispatch('map Network Drive', ctx).output).toContain('net use S:');
  });
});
