/**
 * vm/session.ts — the running identity environment behind the VM's windows.
 *
 * In the 3D lab this role is played by the Conductor, which also owns labs,
 * steps, scoring and faults. The standalone VM needs none of that: it is an
 * always-on IAM sandbox, so a session is just the seven services plus a reset.
 *
 * The console windows only ever referenced the Conductor through
 * `import type`, so they bind to this by shape without a single change to
 * their logic — which is why this extraction is a re-host rather than a
 * rewrite.
 */
import {
  MockAccessReviews,
  MockAppServer,
  MockAuditLog,
  MockDirectory,
  MockIdP,
  MockIncidents,
  MockTicketQueue,
  MockPim,
  MockCloudTenant,
  MockEndpoints,
} from '@/services';
import type { CloudVendor } from '@/services';
import { applyBaseline } from '@/seed/baseline';
import { generateTicketsSync } from './ticketGenerator';
import { auditStore, ticketStore } from '@/stores';
import { clearSavedSession, loadSavedSession, restoreSession, serializeSession, writeSavedSession } from './sessionStore';

/**
 * The service surface the VM windows expect.
 *
 * Deliberately the same property names the Conductor exposes, so the windows
 * are portable between the two hosts.
 */
export interface VmServices {
  dir: MockDirectory;
  idp: MockIdP;
  apps: MockAppServer;
  tickets: MockTicketQueue;
  audit: MockAuditLog;
  reviews: MockAccessReviews;
  incidents: MockIncidents;
  pim: MockPim;
  /** The cloud tenants in front of the domain. Both exist from boot: a hybrid
   *  estate is the normal shape, and the sync between them is the lesson. */
  cloud: Record<CloudVendor, MockCloudTenant>;
  /** The end users' computers, for help-desk work over Remote Desktop. */
  endpoints: MockEndpoints;
  /** Discard all work and re-seed. The Ticket Queue's reset button calls this. */
  reset(): void;
}

export class VmSession implements VmServices {
  dir!: MockDirectory;
  idp!: MockIdP;
  apps!: MockAppServer;
  tickets!: MockTicketQueue;
  audit!: MockAuditLog;
  reviews!: MockAccessReviews;
  incidents!: MockIncidents;
  pim!: MockPim;
  cloud!: Record<CloudVendor, MockCloudTenant>;
  endpoints!: MockEndpoints;

  /** Whether this session resumed saved work rather than starting fresh. */
  resumed = false;
  private lastSaved = '';
  private persistent = false;

  /**
   * @param saved a saved environment to resume, or null to start fresh.
   * @param opts.autosave keep saving while the page is open. Only the app's
   *   own session does; a session built in a test must never write over, or
   *   resume from, anyone else's work.
   */
  constructor(saved: string | null = null, opts: { autosave?: boolean } = {}) {
    this.persistent = opts.autosave ?? false;
    this.boot(saved);
    if (this.persistent) this.startAutosave();
  }

  /**
   * Save the environment now, if it changed since the last save.
   * Returns false when nothing could be written (no storage, or a value that
   * cannot be saved) — the lab keeps working either way.
   */
  save(): boolean {
    let json: string;
    try {
      json = serializeSession(this);
    } catch {
      return false;
    }
    // savedAt changes every call; compare what matters.
    const body = json.replace(/"savedAt":\d+,/, '');
    if (body === this.lastSaved) return true;
    const ok = writeSavedSession(json);
    if (ok) this.lastSaved = body;
    return ok;
  }

  /**
   * Save every few seconds while the VM is open, and on the way out, so a
   * learner who closes the window mid-ticket resumes exactly there.
   */
  private startAutosave(): void {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    setInterval(() => this.save(), 5000);
    const flush = (): void => { this.save(); };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  }

  /**
   * Build a fresh environment and seed the directory.
   *
   * Every service is replaced, not cleared: windows that captured a reference
   * would otherwise keep writing to the old instance. The windows in this app
   * resolve services per action for exactly that reason.
   */
  boot(saved: string | null = null): void {
    this.audit = new MockAuditLog();
    this.dir = new MockDirectory(this.audit);
    this.idp = new MockIdP(this.audit, this.dir);
    this.apps = new MockAppServer(this.dir, this.idp, this.audit);
    this.tickets = new MockTicketQueue(this.audit);
    this.reviews = new MockAccessReviews(this.audit);
    this.incidents = new MockIncidents();
    this.pim = new MockPim(this.audit);
    this.endpoints = new MockEndpoints(this.audit, this.dir);
    this.cloud = {
      okta: new MockCloudTenant('okta', this.dir, this.audit),
      entra: new MockCloudTenant('entra', this.dir, this.audit),
    };
    // The SaaS estate behind each tenant, provisioned the way most real ones
    // are: SCIM off. That is not a shortcut — an application the IdP cannot
    // deprovision is the most common finding in a leaver audit, and it has to
    // be the starting state for finding it to be a lesson.
    for (const tenant of Object.values(this.cloud)) {
      for (const app of ['HR Portal', 'Finance Portal', 'VPN Portal']) {
        tenant.registerApp(app, false);
      }
    }

    this.resumed = saved !== null && restoreSession(this, saved);
    if (!this.resumed) this.seedFresh();

    // Mirror seeded state into the stores the windows subscribe to.
    auditStore.getState().reset();
    for (const e of this.audit.events) auditStore.getState().append(e);
    ticketStore.getState().setTickets(this.tickets.list());
  }

  /** A brand-new domain: the baseline, and the first work it is ready for. */
  private seedFresh(): void {
    applyBaseline(this.dir, this.idp, this.apps);
    // Raise the work this domain is ready for. On a fresh install that is
    // building the OU structure, not onboarding — there is nowhere to put
    // anyone yet.
    generateTicketsSync({
      dir: this.dir,
      tickets: this.tickets,
      audit: this.audit,
      pim: this.pim,
      cloud: this.cloud,
      endpoints: this.endpoints,
    });
  }

  /** Discard all work and re-seed — the sandbox's "start over". The save goes too. */
  reset(): void {
    if (this.persistent) clearSavedSession();
    this.lastSaved = '';
    this.boot(null);
    if (this.persistent) this.save();
  }
}

/** The single session this app runs on. */
export const session = new VmSession(loadSavedSession(), { autosave: true });
