/**
 * services/mockCloudTenant.ts — Okta and Entra ID in front of the domain.
 *
 * Almost every organisation runs a hybrid: Active Directory on premises, a
 * cloud identity provider in front of SaaS. Four things about that arrangement
 * cause most of the real incidents, and all four are modelled here.
 *
 * **Authority has a direction.** AD is the source of truth; the tenant holds
 * *copies*. Editing a synced attribute in the cloud is refused, because in a
 * real tenant it either fails or is silently overwritten at the next cycle.
 * Knowing which side to change is half of hybrid troubleshooting.
 *
 * **Sync is not instant.** Nothing here runs on a timer. The tenant changes
 * only when a cycle runs, so "I disabled them but they can still get in" is
 * reproducible: the cloud copy is genuinely still enabled, and `pendingDelta()`
 * shows exactly which accounts disagree and for how long.
 *
 * **Deprovisioning stops where provisioning stopped.** An application with
 * SCIM follows the tenant; one without keeps its own local account, working,
 * after the person has been disabled everywhere upstream. That is the leaver
 * gap auditors ask about.
 *
 * **Soft match fails.** Create an account directly in the cloud, then sync one
 * from AD with the same UPN, and you get two objects for one person. This is
 * the classic hybrid mess, and it is representable on purpose — a lab that
 * cannot produce the bad state cannot teach you to find it.
 */
import { nanoid } from 'nanoid';
import type { UserId } from '@/domain';
import type { MockAuditLog } from './mockAuditLog';
import type { MockDirectory } from './mockDirectory';
import { COMPANY } from '@/config';

export type CloudVendor = 'okta' | 'entra';

export interface VendorProfile {
  id: CloudVendor;
  /** Product name, as it would be written in a ticket. */
  label: string;
  /** What the tenant is addressed as. */
  tenantName: string;
  /** What this product calls an account. */
  userTerm: string;
  /** The connect cmdlet a learner would actually type. */
  connectCmdlet: string;
}

export const VENDORS: Record<CloudVendor, VendorProfile> = {
  okta: {
    id: 'okta',
    label: 'Okta',
    tenantName: `${COMPANY.domain.split('.')[0]}.okta.com`,
    userTerm: 'Okta user',
    connectCmdlet: 'Connect-Okta',
  },
  entra: {
    id: 'entra',
    label: 'Microsoft Entra ID',
    tenantName: `${COMPANY.domain.split('.')[0]}.onmicrosoft.com`,
    userTerm: 'Entra user',
    connectCmdlet: 'Connect-Entra',
  },
};

/** Where a cloud object came from. The distinction drives everything else. */
export type CloudOrigin =
  /** A copy of an AD account. Authoritative data lives on premises. */
  | 'synced'
  /** Created directly in the tenant. Nothing on premises owns it. */
  | 'cloud-only';

export interface CloudUser {
  id: string;
  /** The login name. Soft match pairs cloud objects to AD accounts on this. */
  upn: string;
  displayName: string;
  origin: CloudOrigin;
  /** The AD account this copies. Absent for cloud-only accounts. */
  sourceUserId?: UserId;
  status: 'active' | 'disabled';
  /** Live sessions. Disabling an account does not end them. */
  sessions: number;
  lastSyncedAt?: number;
}

/** A SaaS application sitting behind the tenant. */
export interface CloudApp {
  name: string;
  /**
   * Whether the tenant provisions and deprovisions accounts inside the app.
   *
   * Off by default, because off is the common real state and the gap it
   * leaves is the thing worth seeing.
   */
  scim: boolean;
  /** Accounts the app holds, by UPN. */
  accounts: Map<string, 'active' | 'deactivated'>;
}

/** One account whose cloud copy disagrees with the directory. */
export interface SyncDelta {
  upn: string;
  /** What a sync would do about it. */
  change: 'create' | 'disable' | 'enable' | 'rename';
  detail: string;
}

export interface SyncResult {
  created: number;
  updated: number;
  /** Objects that could not be matched to a single AD account. */
  conflicts: string[];
  at: number;
}

export type CloudResult = { ok: true; message: string } | { ok: false; error: string };

/** Minutes between scheduled cycles. Entra Connect's default is 30. */
const DEFAULT_CYCLE_MINUTES = 30;

export class MockCloudTenant {
  readonly vendor: VendorProfile;
  private users = new Map<string, CloudUser>();
  private apps = new Map<string, CloudApp>();
  private connected = false;
  private lastSyncAt: number | null = null;
  private cycleMinutes = DEFAULT_CYCLE_MINUTES;

  constructor(
    vendor: CloudVendor,
    private readonly dir: MockDirectory,
    private readonly audit: MockAuditLog,
  ) {
    this.vendor = VENDORS[vendor];
  }

  // --- Connection -----------------------------------------------------------

  /**
   * Connect to the tenant.
   *
   * A gate rather than a formality: every other cmdlet refuses without it, the
   * way the real modules do, so "I ran the command and nothing happened" has
   * the same first answer here as at work.
   */
  connect(): CloudResult {
    this.connected = true;
    return { ok: true, message: `Connected to ${this.vendor.tenantName}.` };
  }

  disconnect(): void {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  /** The refusal when there is no session, or null when there is one. Typed as
   *  the failure alone so callers returning richer results still narrow. */
  private requireConnection(): { ok: false; error: string } | null {
    return this.connected
      ? null
      : {
          ok: false,
          error: `Not connected to ${this.vendor.label}. Run ${this.vendor.connectCmdlet} first.`,
        };
  }

  // --- Reading --------------------------------------------------------------

  list(): CloudUser[] {
    return Array.from(this.users.values());
  }

  find(upn: string): CloudUser | undefined {
    const needle = upn.toLowerCase();
    return this.list().find((u) => u.upn.toLowerCase() === needle);
  }

  /** Every object sharing a UPN with another — the soft-match failure. */
  duplicates(): CloudUser[] {
    const byUpn = new Map<string, CloudUser[]>();
    for (const u of this.users.values()) {
      const key = u.upn.toLowerCase();
      byUpn.set(key, [...(byUpn.get(key) ?? []), u]);
    }
    return Array.from(byUpn.values())
      .filter((group) => group.length > 1)
      .flat();
  }

  lastSync(): number | null {
    return this.lastSyncAt;
  }

  /** Minutes since the last cycle, or null if one has never run. */
  minutesSinceSync(): number | null {
    if (this.lastSyncAt === null) return null;
    return Math.floor((Date.now() - this.lastSyncAt) / 60_000);
  }

  /** Whether a scheduled cycle would be due by now. */
  isOverdue(): boolean {
    const mins = this.minutesSinceSync();
    return mins === null || mins >= this.cycleMinutes;
  }

  setCycleMinutes(minutes: number): void {
    this.cycleMinutes = Math.max(1, minutes);
  }

  getCycleMinutes(): number {
    return this.cycleMinutes;
  }

  /**
   * What the directory says that the tenant does not yet reflect.
   *
   * The diagnostic for "I disabled them and they can still sign in": this
   * names the accounts, so the answer is evidence rather than a shrug about
   * eventual consistency.
   */
  pendingDelta(): SyncDelta[] {
    const deltas: SyncDelta[] = [];

    for (const u of this.dir.listUsers()) {
      const upn = this.upnFor(u.username);
      const cloud = this.syncedCopyOf(u.id);

      if (!cloud) {
        deltas.push({ upn, change: 'create', detail: `${u.displayName} has no cloud account yet.` });
        continue;
      }

      const shouldBeDisabled = u.status === 'disabled';
      if (shouldBeDisabled && cloud.status === 'active') {
        deltas.push({
          upn,
          change: 'disable',
          detail: `Disabled in the directory, still active in ${this.vendor.label}.`,
        });
      } else if (!shouldBeDisabled && cloud.status === 'disabled') {
        deltas.push({
          upn,
          change: 'enable',
          detail: `Enabled in the directory, still disabled in ${this.vendor.label}.`,
        });
      }

      if (cloud.displayName !== u.displayName) {
        deltas.push({
          upn,
          change: 'rename',
          detail: `Name differs: "${cloud.displayName}" here, "${u.displayName}" on premises.`,
        });
      }
    }

    return deltas;
  }

  // --- Sync -----------------------------------------------------------------

  /**
   * Run a sync cycle: reconcile the tenant against the directory.
   *
   * Reconciliation rather than a change queue, because that is what the real
   * connector does and it survives anything the learner did in between —
   * including changes made while nobody was watching.
   */
  sync(actor: UserId): SyncResult | { ok: false; error: string } {
    const gate = this.requireConnection();
    if (gate) return gate;

    const at = Date.now();
    let created = 0;
    let updated = 0;
    const conflicts: string[] = [];

    for (const u of this.dir.listUsers()) {
      const upn = this.upnFor(u.username);
      let cloud = this.syncedCopyOf(u.id);

      if (!cloud) {
        // Soft match: an existing cloud-only object with this UPN should be
        // adopted. It is not, deliberately — the real failure is that the
        // connector cannot decide, and you end up with two objects.
        const clash = this.find(upn);
        if (clash && clash.origin === 'cloud-only') {
          conflicts.push(upn);
        }
        cloud = {
          id: nanoid(10),
          upn,
          displayName: u.displayName,
          origin: 'synced',
          sourceUserId: u.id,
          status: 'active',
          sessions: 0,
        };
        this.users.set(cloud.id, cloud);
        created += 1;
      }

      const wanted = u.status === 'disabled' ? 'disabled' : 'active';
      if (cloud.status !== wanted || cloud.displayName !== u.displayName) {
        cloud.status = wanted;
        cloud.displayName = u.displayName;
        updated += 1;
      }
      cloud.lastSyncedAt = at;

      // Downstream applications follow only where SCIM is switched on.
      this.pushToApps(cloud);
    }

    this.lastSyncAt = at;
    this.audit.record({ actorId: actor, action: 'cloud.synced', targetId: this.vendor.id });
    return { created, updated, conflicts, at };
  }

  // --- Writing --------------------------------------------------------------

  /**
   * Create an account directly in the tenant.
   *
   * Legitimate for genuinely cloud-only identities — contractors, service
   * principals — and the usual way a duplicate gets made when someone uses it
   * for a person who also has an AD account.
   */
  createCloudOnly(upn: string, displayName: string, actor: UserId): CloudResult {
    const gate = this.requireConnection();
    if (gate) return gate;
    if (this.find(upn)) return { ok: false, error: `${upn} already exists in this tenant.` };

    const user: CloudUser = {
      id: nanoid(10),
      upn,
      displayName,
      origin: 'cloud-only',
      status: 'active',
      sessions: 0,
    };
    this.users.set(user.id, user);
    this.audit.record({ actorId: actor, action: 'cloud.user.created', targetId: upn });
    return { ok: true, message: `Created cloud-only ${this.vendor.userTerm} ${upn}.` };
  }

  /**
   * Disable an account in the tenant.
   *
   * Refused for synced accounts. The change belongs on premises, and doing it
   * here would be undone by the next cycle — the refusal teaches where
   * authority lives instead of letting the learner watch their work vanish.
   */
  disable(upn: string, actor: UserId): CloudResult {
    const gate = this.requireConnection();
    if (gate) return gate;

    const user = this.find(upn);
    if (!user) return { ok: false, error: `No ${this.vendor.userTerm} with UPN ${upn}.` };
    if (user.origin === 'synced') {
      return {
        ok: false,
        error:
          `${upn} is synced from Active Directory, which is authoritative. ` +
          'Disable the account on premises and run a sync cycle.',
      };
    }

    user.status = 'disabled';
    this.pushToApps(user);
    this.audit.record({ actorId: actor, action: 'cloud.user.disabled', targetId: upn });
    return { ok: true, message: `Disabled cloud-only account ${upn}.` };
  }

  /** Give an account live sessions, so revoking them is a visible act. */
  openSession(upn: string): void {
    const user = this.find(upn);
    if (user) user.sessions += 1;
  }

  /**
   * Revoke live sessions.
   *
   * The step people skip. A disabled account with an open session keeps
   * working until that session expires, so disabling and walking away leaves
   * a window exactly as long as the session lifetime.
   */
  revokeSessions(upn: string, actor: UserId): CloudResult {
    const gate = this.requireConnection();
    if (gate) return gate;

    const user = this.find(upn);
    if (!user) return { ok: false, error: `No ${this.vendor.userTerm} with UPN ${upn}.` };

    const had = user.sessions;
    user.sessions = 0;
    this.audit.record({ actorId: actor, action: 'cloud.session.revoked', targetId: upn });
    return {
      ok: true,
      message:
        had === 0
          ? `${upn} had no live sessions.`
          : `Revoked ${had} live session(s) for ${upn}.`,
    };
  }

  // --- Applications ---------------------------------------------------------

  registerApp(name: string, scim = false): CloudApp {
    const app: CloudApp = { name, scim, accounts: new Map() };
    this.apps.set(name.toLowerCase(), app);
    return app;
  }

  listApps(): CloudApp[] {
    return Array.from(this.apps.values());
  }

  getApp(name: string): CloudApp | undefined {
    return this.apps.get(name.toLowerCase());
  }

  /** Turn SCIM on for an application — the fix for a leaver gap. */
  setScim(name: string, enabled: boolean, actor: UserId): CloudResult {
    const gate = this.requireConnection();
    if (gate) return gate;

    const app = this.getApp(name);
    if (!app) return { ok: false, error: `No application named '${name}' in this tenant.` };

    app.scim = enabled;
    this.audit.record({
      actorId: actor,
      action: enabled ? 'scim.enabled' : 'scim.disabled',
      targetId: name,
    });

    if (enabled) {
      // Switching it on reconciles what was missed while it was off, which is
      // what makes it a remediation rather than a setting.
      for (const user of this.users.values()) this.pushToApps(user);
      return { ok: true, message: `SCIM provisioning enabled for ${app.name}. Existing accounts reconciled.` };
    }
    return { ok: true, message: `SCIM provisioning disabled for ${app.name}.` };
  }

  /** Give an application an account, as an app admin would have done. */
  grantAppAccount(name: string, upn: string): void {
    this.getApp(name)?.accounts.set(upn.toLowerCase(), 'active');
  }

  /**
   * Accounts still working inside applications for people who are disabled
   * upstream — the leaver gap, stated as a list.
   */
  orphanedAppAccounts(): { app: string; upn: string }[] {
    const out: { app: string; upn: string }[] = [];
    for (const app of this.apps.values()) {
      for (const [upn, state] of app.accounts) {
        if (state !== 'active') continue;
        const cloud = this.find(upn);
        if (cloud && cloud.status === 'disabled') out.push({ app: app.name, upn });
      }
    }
    return out;
  }

  private pushToApps(user: CloudUser): void {
    for (const app of this.apps.values()) {
      if (!app.scim) continue; // No SCIM, no reach. That is the whole lesson.
      const key = user.upn.toLowerCase();
      if (!app.accounts.has(key)) continue;
      app.accounts.set(key, user.status === 'disabled' ? 'deactivated' : 'active');
    }
  }

  // --- Internals ------------------------------------------------------------

  private syncedCopyOf(userId: UserId): CloudUser | undefined {
    return this.list().find((c) => c.origin === 'synced' && c.sourceUserId === userId);
  }

  private upnFor(username: string): string {
    return `${username}@${COMPANY.domain}`;
  }

  reset(): void {
    this.users.clear();
    this.apps.clear();
    this.connected = false;
    this.lastSyncAt = null;
    this.cycleMinutes = DEFAULT_CYCLE_MINUTES;
  }
}
