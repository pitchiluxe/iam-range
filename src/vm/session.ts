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
} from '@/services';
import type { CloudVendor } from '@/services';
import { applyBaseline } from '@/seed/baseline';
import { generateTicketsSync } from './ticketGenerator';
import { auditStore, ticketStore } from '@/stores';

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

  constructor() {
    this.boot();
  }

  /**
   * Build a fresh environment and seed the directory.
   *
   * Every service is replaced, not cleared: windows that captured a reference
   * would otherwise keep writing to the old instance. The windows in this app
   * resolve services per action for exactly that reason.
   */
  boot(): void {
    this.audit = new MockAuditLog();
    this.dir = new MockDirectory(this.audit);
    this.idp = new MockIdP(this.audit, this.dir);
    this.apps = new MockAppServer(this.dir, this.idp, this.audit);
    this.tickets = new MockTicketQueue(this.audit);
    this.reviews = new MockAccessReviews(this.audit);
    this.incidents = new MockIncidents();
    this.pim = new MockPim(this.audit);
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
    });

    // Mirror seeded state into the stores the windows subscribe to.
    auditStore.getState().reset();
    for (const e of this.audit.events) auditStore.getState().append(e);
    ticketStore.getState().setTickets(this.tickets.list());
  }

  /** Discard all work and re-seed — the sandbox's "start over". */
  reset(): void {
    this.boot();
  }
}

/** The single session this app runs on. */
export const session = new VmSession();
