/**
 * services/mockAppServer.ts — in-memory catalog of business applications.
 */
import { nanoid } from 'nanoid';
import type { Application, AppId, UserId } from '@/domain';
import type { MockDirectory } from './mockDirectory';
import type { MockIdP } from './mockIdP';
import type { MockAuditLog } from './mockAuditLog';

export type AppLoginResult = { ok: true; appSessionId: string } | { ok: false; reason: string };

export class MockAppServer {
  private appMap = new Map<AppId, Application>();

  constructor(
    private readonly dir: MockDirectory,
    private readonly idp: MockIdP,
    private readonly audit: MockAuditLog,
  ) {}

  registerApp(app: Application): void {
    this.appMap.set(app.id, app);
  }

  apps(): Application[] {
    return Array.from(this.appMap.values());
  }

  getApp(id: AppId): Application | undefined {
    return this.appMap.get(id);
  }

  getAppByName(name: string): Application | undefined {
    return Array.from(this.appMap.values()).find((a) => a.name === name);
  }

  ssoLogin(appId: AppId, userId: UserId): AppLoginResult {
    const app = this.appMap.get(appId);
    if (!app) return { ok: false, reason: 'unknown-app' };
    if (app.status === 'offline') return { ok: false, reason: 'app-offline' };

    const u = this.dir.getUser(userId);
    if (!u) return { ok: false, reason: 'unknown-user' };
    if (u.status === 'disabled') return { ok: false, reason: 'user-disabled' };

    // Config-diff faults (injected by FaultService)
    const diff = app.configDiffFromBaseline ?? {};
    if (diff['redirectUri']) {
      return { ok: false, reason: 'invalid-redirect-uri' };
    }
    if (diff['cert.validUntil']) {
      const { actual } = diff['cert.validUntil'];
      if (new Date(actual as string) < new Date()) return { ok: false, reason: 'expired-cert' };
    }
    if (diff['issuer']) return { ok: false, reason: 'wrong-issuer' };
    if (
      diff['clientSecret.match'] &&
      (diff['clientSecret.match'] as { actual: boolean }).actual === false
    ) {
      return { ok: false, reason: 'wrong-client-secret' };
    }
    if (diff['claim.role'] && (diff['claim.role'] as { actual: string }).actual === 'group') {
      return { ok: false, reason: 'claim-mismatch' };
    }

    if (app.status === 'misconfigured') return { ok: false, reason: 'app-misconfigured' };

    // Required role check
    const effectiveRoles = this.dir.effectiveRoleIds(userId);
    const hasRole =
      app.requiredRoleIds.length === 0 ||
      app.requiredRoleIds.some((r) => effectiveRoles.includes(r));
    if (!hasRole) return { ok: false, reason: 'missing-role' };

    if (app.mfaRequired && u.mfa === 'none') return { ok: false, reason: 'mfa-required' };

    return { ok: true, appSessionId: nanoid(16) };
  }

  fixConfigField(appId: AppId, field: string, value: unknown, by: UserId): void {
    const app = this.appMap.get(appId);
    if (!app) throw new Error(`[appserver] fixConfigField: app ${appId} not found`);
    const beforeValue = (app as unknown as Record<string, unknown>)[field];
    switch (field) {
      case 'redirectUri':
        app.redirectUri = String(value);
        break;
      case 'entityId':
        app.entityId = String(value);
        break;
      case 'issuer':
        app.issuer = String(value);
        break;
      case 'mfaRequired':
        app.mfaRequired = Boolean(value);
        break;
      default:
        if (app.configDiffFromBaseline && field in app.configDiffFromBaseline) {
          delete app.configDiffFromBaseline[field];
        }
    }
    if (app.configDiffFromBaseline) {
      delete app.configDiffFromBaseline[field];
      if (Object.keys(app.configDiffFromBaseline).length === 0) {
        app.status = 'configured';
        app.configDiffFromBaseline = undefined;
      }
    }
    const diff: Record<string, unknown> = { [field]: { before: beforeValue, after: value } };
    this.audit.record({ actorId: by, action: 'app.config.changed', targetId: appId, diff });
  }

  clearFault(appId: AppId, by: UserId): void {
    const app = this.appMap.get(appId);
    if (!app) return;
    app.configDiffFromBaseline = undefined;
    app.status = 'configured';
    this.audit.record({
      actorId: by,
      action: 'app.config.changed',
      targetId: appId,
      diff: { cleared: true },
    });
  }

  reset(): void {
    this.appMap.clear();
  }
}
