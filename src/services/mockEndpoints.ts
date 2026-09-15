/**
 * services/mockEndpoints.ts — the end users' computers.
 *
 * Help-desk work happens on somebody's machine: their print spooler, their
 * Outlook profile, their Wi-Fi. Each staff account gets one computer here,
 * WKS-<USERNAME>, holding that state for real. A help-desk scenario breaks a
 * piece of it; the learner repairs it through Remote Desktop or the terminal;
 * the ticket review reads it back.
 *
 * The same rule as the directory: checks read the state, never a flag saying
 * which fault was staged. A printer ticket is fixed when the spooler is
 * running, however that happened — and not fixed because somebody clicked
 * something that sounds right.
 */
import type { EndpointIssueId, UserId } from '@/domain';
import { VM_HOST } from '@/config/vmHost';
import type { MockAuditLog } from './mockAuditLog';
import type { MockDirectory } from './mockDirectory';

// ---------------------------------------------------------------------------
// The estate every computer lives in
// ---------------------------------------------------------------------------

export const CORP_WIFI = 'CORP-WIFI';
export const GUEST_WIFI = 'CORP-GUEST';
export const OFFICE_PRINTER = 'HQ-Floor2-MFP';
export const PDF_PRINTER = 'Microsoft Print to PDF';
export const FILE_SERVER = 'FS01';
export const INTRANET_HOST = `intranet.${VM_HOST.domain}`;
export const OFFICE_CREDENTIAL = 'MicrosoftOffice16_Data:SSPI:outlook';
/** Mapped drive letter every department share uses. */
export const SHARE_DRIVE = 'S:';

/** Names that resolve on the corporate network. */
export const CORP_DNS: Readonly<Record<string, string>> = {
  [INTRANET_HOST]: '10.20.1.25',
  [`${FILE_SERVER.toLowerCase()}.${VM_HOST.domain}`]: '10.20.1.30',
  [`${VM_HOST.domainController.toLowerCase()}.${VM_HOST.domain}`]: VM_HOST.dns,
  'outlook.office365.com': '52.96.40.18',
  'www.bing.com': '204.79.197.200',
};

/** What Software Center offers. Anything else is not an approved install. */
export const SOFTWARE_CATALOG = [
  'Adobe Acrobat Reader',
  'Zoom Workplace',
  '7-Zip',
  'Notepad++',
  'Microsoft Visio Viewer',
  'Power BI Desktop',
] as const;

/** Installed on every corporate image. */
const BASE_SOFTWARE = ['Microsoft 365 Apps', 'Microsoft Edge', 'Microsoft Teams', 'Corp VPN Client'];

const MAILBOX_QUOTA_MB = 50 * 1024;
const DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ServiceStatus = 'Running' | 'Stopped';

export interface EndpointService {
  name: string;
  displayName: string;
  status: ServiceStatus;
}

export interface PrintJob {
  id: number;
  document: string;
  owner: string;
  pages: number;
  status: 'Queued' | 'Printing' | 'Error';
}

export interface EndpointPrinter {
  name: string;
  isDefault: boolean;
  /** False when "Use printer offline" is on. */
  online: boolean;
  jobs: PrintJob[];
}

export interface NetworkState {
  adapterName: string;
  adapterEnabled: boolean;
  /** Null when not joined to any network. */
  ssid: string | null;
  /** '0.0.0.0' after a release; 169.254.x.x when DHCP failed. */
  ipv4: string;
  gateway: string;
  dnsServer: string;
  /** Client-side DNS cache: name -> address. */
  dnsCache: Record<string, string>;
}

export interface OutlookState {
  profile: 'ok' | 'corrupt';
  workOffline: boolean;
  mailboxUsedMb: number;
  deletedItemsMb: number;
  quotaMb: number;
}

export interface StoredCredential {
  target: string;
  user: string;
  /** Saved before the password last changed, so it no longer works. */
  stale: boolean;
}

export interface MappedDrive {
  letter: string;
  path: string;
}

export interface Endpoint {
  name: string;
  userId: UserId;
  username: string;
  mac: string;
  /** The address DHCP hands this computer on the corporate network. */
  leaseIp: string;
  services: EndpointService[];
  printers: EndpointPrinter[];
  network: NetworkState;
  outlook: OutlookState;
  credentials: StoredCredential[];
  drives: MappedDrive[];
  /** The department share this user's S: drive should point at. */
  homeShare: string;
  /**
   * Whether that share has been provisioned for this user. Until it is, no S:
   * drive is expected — a fresh domain has no department shares, and a
   * computer should not claim a drive to a share nobody has created.
   */
  shareProvisioned: boolean;
  /** lastAttemptFailed is what the VPN client shows after a failed connect;
   *  only a successful connection clears it. */
  vpn: { certExpiresAt: number; connected: boolean; lastAttemptFailed: boolean };
  installed: string[];
  /** An approved install the user has asked for, if any. */
  requestedSoftware?: string;
  disk: { totalGb: number; freeGb: number; tempGb: number };
}

export type EndpointResult = { ok: true; message: string } | { ok: false; error: string };

export interface IssueCheck {
  fixed: boolean;
  /** What was observed on the computer. */
  detail: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** WKS-JDOE for jdoe. Punctuation in a logon is not legal in a NetBIOS name. */
export function computerNameFor(username: string): string {
  const clean = username.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return `WKS-${clean}`.slice(0, 15);
}

/** A stable small number per name, so a computer keeps its address and MAC. */
function hashOf(text: string): number {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** Dept-HelpDesk for 'Help Desk'. */
export function departmentShareName(department: string): string {
  return `Dept-${department.replace(/[^A-Za-z0-9]/g, '')}`;
}

export function sharePath(share: string): string {
  return `\\\\${FILE_SERVER}\\${share}`;
}

const isApipa = (ip: string): boolean => ip.startsWith('169.254.');
const hasAddress = (ip: string): boolean => ip !== '0.0.0.0' && !isApipa(ip);

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class MockEndpoints {
  private computers = new Map<string, Endpoint>();

  constructor(
    private readonly audit: MockAuditLog,
    private readonly dir: MockDirectory,
  ) {}

  list(): Endpoint[] {
    return [...this.computers.values()];
  }

  /** Look a computer up by name, case-insensitively, as Windows does. */
  get(name: string): Endpoint | undefined {
    return this.computers.get(name.trim().toUpperCase());
  }

  forUser(userId: UserId): Endpoint | undefined {
    return this.list().find((e) => e.userId === userId);
  }

  /** The computer this user signs in to, built healthy the first time it is asked for. */
  ensureFor(userId: UserId): Endpoint | undefined {
    const existing = this.forUser(userId);
    if (existing) return existing;
    const user = this.dir.getUser(userId);
    if (!user) return undefined;

    const name = computerNameFor(user.username);
    const h = hashOf(name);
    const leaseIp = `10.20.4.${100 + (h % 150)}`;
    const share = departmentShareName(user.department);
    const endpoint: Endpoint = {
      name,
      userId,
      username: user.username,
      mac: `00-15-5D-${[h >> 16, h >> 8, h]
        .map((n) => (n & 0xff).toString(16).padStart(2, '0').toUpperCase())
        .join('-')}`,
      leaseIp,
      services: [
        { name: 'Spooler', displayName: 'Print Spooler', status: 'Running' },
        { name: 'Dhcp', displayName: 'DHCP Client', status: 'Running' },
        { name: 'Dnscache', displayName: 'DNS Client', status: 'Running' },
        { name: 'WlanSvc', displayName: 'WLAN AutoConfig', status: 'Running' },
        { name: 'wuauserv', displayName: 'Windows Update', status: 'Running' },
      ],
      printers: [
        { name: OFFICE_PRINTER, isDefault: true, online: true, jobs: [] },
        { name: PDF_PRINTER, isDefault: false, online: true, jobs: [] },
      ],
      network: {
        adapterName: 'Wi-Fi',
        adapterEnabled: true,
        ssid: CORP_WIFI,
        ipv4: leaseIp,
        gateway: VM_HOST.gateway,
        dnsServer: VM_HOST.dns,
        dnsCache: {},
      },
      outlook: {
        profile: 'ok',
        workOffline: false,
        mailboxUsedMb: 6200 + (h % 9000),
        deletedItemsMb: 300 + (h % 500),
        quotaMb: MAILBOX_QUOTA_MB,
      },
      credentials: [{ target: OFFICE_CREDENTIAL, user: `${user.username}@${VM_HOST.domain}`, stale: false }],
      drives: [],
      homeShare: share,
      shareProvisioned: false,
      vpn: { certExpiresAt: Date.now() + 200 * DAY, connected: false, lastAttemptFailed: false },
      installed: [...BASE_SOFTWARE],
      disk: { totalGb: 237, freeGb: 96, tempGb: 3.2 },
    };
    this.computers.set(name, endpoint);
    return endpoint;
  }

  // -------------------------------------------------------------------------
  // Faults
  // -------------------------------------------------------------------------

  /**
   * Break one thing on a computer, for real, and record that it was staged.
   *
   * Returns false when the fault cannot be staged on this estate — the
   * access-denied drive needs a share to deny, for one.
   */
  applyFault(name: string, issue: EndpointIssueId): boolean {
    const e = this.get(name);
    if (!e) return false;
    const staged = this.stage(e, issue);
    if (staged) {
      this.audit.record({
        actorId: 'system' as UserId,
        action: 'endpoint.fault',
        targetId: e.name,
        note: issue,
      });
    }
    return staged;
  }

  private stage(e: Endpoint, issue: EndpointIssueId): boolean {
    const office = e.printers.find((p) => p.name === OFFICE_PRINTER);
    switch (issue) {
      case 'printer-spooler-stopped': {
        this.service(e, 'Spooler')!.status = 'Stopped';
        return true;
      }
      case 'printer-queue-stuck': {
        if (!office) return false;
        office.jobs = [
          { id: 41, document: 'Q3 budget review.xlsx', owner: e.username, pages: 12, status: 'Error' },
          { id: 42, document: 'Timesheet.pdf', owner: e.username, pages: 1, status: 'Queued' },
          { id: 43, document: 'Meeting notes.docx', owner: e.username, pages: 3, status: 'Queued' },
        ];
        return true;
      }
      case 'printer-wrong-default': {
        for (const p of e.printers) p.isDefault = p.name === PDF_PRINTER;
        return true;
      }
      case 'printer-offline': {
        if (!office) return false;
        office.online = false;
        return true;
      }
      case 'outlook-profile-corrupt':
        e.outlook.profile = 'corrupt';
        return true;
      case 'outlook-work-offline':
        e.outlook.workOffline = true;
        return true;
      case 'outlook-mailbox-full':
        e.outlook.deletedItemsMb = 9800;
        e.outlook.mailboxUsedMb = e.outlook.quotaMb - 60;
        return true;
      case 'outlook-password-loop': {
        const cred = e.credentials.find((c) => c.target === OFFICE_CREDENTIAL);
        if (cred) cred.stale = true;
        else e.credentials.push({ target: OFFICE_CREDENTIAL, user: e.username, stale: true });
        return true;
      }
      case 'network-wifi-wrong':
        e.network.ssid = GUEST_WIFI;
        e.network.ipv4 = `192.168.50.${20 + (hashOf(e.name) % 200)}`;
        e.network.gateway = '192.168.50.1';
        e.network.dnsServer = '192.168.50.1';
        return true;
      case 'network-apipa':
        e.network.ipv4 = `169.254.${hashOf(e.name) % 250}.${(hashOf(e.mac) % 250) + 2}`;
        e.network.gateway = '';
        return true;
      case 'network-dns-stale':
        // The intranet moved servers last night; this client still remembers
        // the old address.
        e.network.dnsCache[INTRANET_HOST] = '10.20.9.99';
        return true;
      case 'network-adapter-disabled':
        e.network.adapterEnabled = false;
        e.network.ssid = null;
        e.network.ipv4 = '0.0.0.0';
        return true;
      case 'drive-missing':
        this.ensureShareAccess(e);
        e.drives = e.drives.filter((d) => d.letter !== SHARE_DRIVE);
        return true;
      case 'drive-access-denied': {
        const share = this.ensureShareAccess(e);
        if (!share) return false;
        // Whoever granted it was removed. Direct grants only: taking somebody
        // out of a group would touch every other member of it too.
        const direct = share.permissions.find((p) => p.trusteeName === e.username);
        if (direct) this.dir.revokeSharePermission(share.name, e.username);
        e.drives = e.drives.filter((d) => d.letter !== SHARE_DRIVE);
        return this.dir.getEffectiveAccess(share.name, e.username) === 'None';
      }
      case 'vpn-cert-expired':
        e.vpn.certExpiresAt = Date.now() - 3 * DAY;
        e.vpn.connected = false;
        e.vpn.lastAttemptFailed = true;
        return true;
      case 'software-missing': {
        const wanted = SOFTWARE_CATALOG.find((s) => !e.installed.includes(s));
        if (!wanted) return false;
        e.requestedSoftware = wanted;
        return true;
      }
      case 'disk-full':
        e.disk.tempGb = 58.4;
        e.disk.freeGb = 1.2;
        return true;
    }
  }

  /**
   * Make sure the user's department share exists and lets them in.
   *
   * Granted to the user directly so a staged denial can take exactly their
   * access away and nobody else's.
   */
  private ensureShareAccess(e: Endpoint) {
    let share = this.dir.getShare(e.homeShare);
    if (!share) share = this.dir.createShare(e.homeShare, sharePath(e.homeShare));
    if (this.dir.getEffectiveAccess(share.name, e.username) === 'None') {
      this.dir.grantSharePermission(share.name, e.username, 'Modify');
    }
    e.shareProvisioned = true;
    return share;
  }

  // -------------------------------------------------------------------------
  // Checks — what the review reads
  // -------------------------------------------------------------------------

  check(name: string, issue: EndpointIssueId): IssueCheck {
    const e = this.get(name);
    if (!e) return { fixed: false, detail: `No computer named ${name} exists.` };
    const office = e.printers.find((p) => p.name === OFFICE_PRINTER);
    const def = e.printers.find((p) => p.isDefault);
    const yes = (detail: string): IssueCheck => ({ fixed: true, detail });
    const no = (detail: string): IssueCheck => ({ fixed: false, detail });

    switch (issue) {
      case 'printer-spooler-stopped': {
        const s = this.service(e, 'Spooler');
        return s?.status === 'Running'
          ? yes('The Print Spooler service is running.')
          : no('The Print Spooler service is still stopped, so nothing reaches any printer.');
      }
      case 'printer-queue-stuck': {
        const blocked = e.printers.flatMap((p) => p.jobs).filter((j) => j.status === 'Error');
        return blocked.length === 0
          ? yes('No failed job is blocking a print queue.')
          : no(`${blocked.length} failed job(s) still block the queue: ${blocked.map((j) => j.document).join(', ')}.`);
      }
      case 'printer-wrong-default':
        return def?.name === OFFICE_PRINTER
          ? yes(`The default printer is ${OFFICE_PRINTER}.`)
          : no(`The default printer is ${def?.name ?? 'not set'}, not ${OFFICE_PRINTER}.`);
      case 'printer-offline':
        return office?.online
          ? yes(`${OFFICE_PRINTER} is online.`)
          : no(`${OFFICE_PRINTER} is still set to "Use printer offline".`);
      case 'outlook-profile-corrupt':
        return e.outlook.profile === 'ok'
          ? yes('Outlook opens with a working mail profile.')
          : no('The Outlook profile is still corrupt; Outlook cannot open.');
      case 'outlook-work-offline':
        return !e.outlook.workOffline
          ? yes('Outlook is connected to Exchange (Work Offline is off).')
          : no('Work Offline is still on, so Outlook shows Disconnected.');
      case 'outlook-mailbox-full': {
        const pct = Math.round((e.outlook.mailboxUsedMb / e.outlook.quotaMb) * 100);
        return pct < 90
          ? yes(`The mailbox is at ${pct}% of its quota.`)
          : no(`The mailbox is still at ${pct}% of its quota; sending stays blocked above 90%.`);
      }
      case 'outlook-password-loop': {
        const stale = e.credentials.some((c) => c.target === OFFICE_CREDENTIAL && c.stale);
        return !stale
          ? yes('No stale Office credential is stored in Credential Manager.')
          : no(`A stale ${OFFICE_CREDENTIAL} credential is still stored; Outlook keeps offering it.`);
      }
      case 'network-wifi-wrong':
        return e.network.ssid === CORP_WIFI && hasAddress(e.network.ipv4) && !e.network.ipv4.startsWith('192.168.50.')
          ? yes(`Connected to ${CORP_WIFI} with address ${e.network.ipv4}.`)
          : no(`Connected to ${e.network.ssid ?? 'no network'} (${e.network.ipv4}), not ${CORP_WIFI}.`);
      case 'network-apipa':
        return hasAddress(e.network.ipv4)
          ? yes(`The adapter has a DHCP address, ${e.network.ipv4}.`)
          : no(`The adapter still has ${e.network.ipv4}, which is not a DHCP lease.`);
      case 'network-dns-stale': {
        const cached = e.network.dnsCache[INTRANET_HOST];
        return !cached || cached === CORP_DNS[INTRANET_HOST]
          ? yes(`${INTRANET_HOST} resolves to ${CORP_DNS[INTRANET_HOST]}.`)
          : no(`${INTRANET_HOST} still resolves from cache to the old address ${cached}.`);
      }
      case 'network-adapter-disabled':
        return e.network.adapterEnabled && hasAddress(e.network.ipv4)
          ? yes(`The ${e.network.adapterName} adapter is enabled and has ${e.network.ipv4}.`)
          : no(`The ${e.network.adapterName} adapter is ${e.network.adapterEnabled ? 'enabled but has no address' : 'disabled'}.`);
      case 'drive-missing':
      case 'drive-access-denied': {
        if (!e.shareProvisioned) return yes(`No ${e.homeShare} share is provisioned for ${e.username}, so no drive is expected.`);
        const drive = e.drives.find((d) => d.letter === SHARE_DRIVE);
        const want = sharePath(e.homeShare);
        if (!drive || drive.path.toLowerCase() !== want.toLowerCase()) {
          return no(`${SHARE_DRIVE} is not mapped to ${want}.`);
        }
        const share = this.dir.getShare(e.homeShare);
        const access = share ? this.dir.getEffectiveAccess(share.name, e.username) : 'None';
        return access === 'None' || access === 'Deny'
          ? no(`${SHARE_DRIVE} is mapped, but ${e.username} has ${access} access to ${e.homeShare}.`)
          : yes(`${SHARE_DRIVE} is mapped to ${want} and ${e.username} has ${access} access.`);
      }
      case 'vpn-cert-expired': {
        const valid = e.vpn.certExpiresAt > Date.now();
        if (!valid) return no('The VPN certificate is still expired.');
        return !e.vpn.lastAttemptFailed
          ? yes('The VPN certificate is valid and the VPN connected.')
          : no('The certificate was renewed, but the VPN has not been connected to prove it.');
      }
      case 'software-missing': {
        const wanted = e.requestedSoftware;
        if (!wanted) return yes('No software request is outstanding.');
        return e.installed.includes(wanted)
          ? yes(`${wanted} is installed.`)
          : no(`${wanted} is still not installed.`);
      }
      case 'disk-full':
        return e.disk.freeGb >= 10
          ? yes(`C: has ${e.disk.freeGb.toFixed(1)} GB free.`)
          : no(`C: still has only ${e.disk.freeGb.toFixed(1)} GB free.`);
    }
  }

  // -------------------------------------------------------------------------
  // Observation — what the user sees, and what diagnostic tools report
  // -------------------------------------------------------------------------

  service(e: Endpoint, name: string): EndpointService | undefined {
    return e.services.find((s) => s.name.toLowerCase() === name.toLowerCase());
  }

  /** Whether this computer has a working corporate network path. */
  onCorpNetwork(e: Endpoint): boolean {
    return (
      e.network.adapterEnabled &&
      e.network.ssid === CORP_WIFI &&
      hasAddress(e.network.ipv4) &&
      e.network.ipv4.startsWith('10.20.')
    );
  }

  /** Resolve a name the way this client would: cache first, then its DNS server. */
  resolveName(name: string, host: string): { ip: string; fromCache: boolean } | { error: string } {
    const e = this.get(name);
    if (!e) return { error: `No computer named ${name}.` };
    const key = host.trim().toLowerCase();
    const cached = e.network.dnsCache[key];
    if (cached) return { ip: cached, fromCache: true };
    if (!e.network.adapterEnabled || !hasAddress(e.network.ipv4)) {
      return { error: 'DNS request timed out. No network connection.' };
    }
    const qualified = key.includes('.') ? key : `${key}.${VM_HOST.domain}`;
    const internal = qualified.endsWith(VM_HOST.domain);
    if (internal && !this.onCorpNetwork(e)) {
      return { error: `*** ${e.network.dnsServer} can't find ${host}: Non-existent domain` };
    }
    const ip = CORP_DNS[qualified] ?? CORP_DNS[key];
    return ip ? { ip, fromCache: false } : { error: `*** can't find ${host}: Non-existent domain` };
  }

  /** Whether an address answers from this computer. */
  reachable(name: string, ip: string): boolean {
    const e = this.get(name);
    if (!e || !e.network.adapterEnabled || !hasAddress(e.network.ipv4)) return false;
    const known = Object.values(CORP_DNS).includes(ip) || ip === e.network.gateway;
    if (!known) return false;
    // The guest network reaches the internet and nothing internal.
    if (ip.startsWith('10.20.')) return this.onCorpNetwork(e);
    return true;
  }

  /** What happens when the user prints to their default printer. */
  printOutcome(e: Endpoint): string {
    const def = e.printers.find((p) => p.isDefault);
    if (this.service(e, 'Spooler')?.status !== 'Running') {
      return 'Nothing happens. The Print Spooler service is not running.';
    }
    if (!def) return 'No default printer is set.';
    if (def.name === PDF_PRINTER) return 'A "Save Print Output As" dialog appears instead of printing.';
    if (!def.online) return `${def.name} is offline. The job waits in the queue.`;
    if (def.jobs.some((j) => j.status === 'Error')) {
      return `The job joins the queue behind a failed job and never prints.`;
    }
    return `Printed on ${def.name}.`;
  }

  /** What the user sees when they open Outlook. */
  outlookOutcome(e: Endpoint): string {
    if (e.outlook.profile === 'corrupt') {
      return 'Cannot start Microsoft Outlook. Cannot open the Outlook window. The set of folders cannot be opened.';
    }
    if (e.credentials.some((c) => c.target === OFFICE_CREDENTIAL && c.stale)) {
      return 'Outlook opens, then asks for the password again and again.';
    }
    if (!this.onCorpNetwork(e) && !e.vpn.connected) return 'Outlook shows Disconnected: no network.';
    if (e.outlook.workOffline) return 'Outlook opens and shows "Working Offline" in the status bar.';
    if (e.outlook.mailboxUsedMb / e.outlook.quotaMb >= 0.9) {
      return 'Your mailbox is full. You cannot send messages.';
    }
    return 'Outlook is connected to Microsoft Exchange.';
  }

  // -------------------------------------------------------------------------
  // Repairs
  // -------------------------------------------------------------------------

  private done(e: Endpoint, actor: UserId, message: string): EndpointResult {
    this.audit.record({ actorId: actor, action: 'endpoint.repair', targetId: e.name, note: message });
    return { ok: true, message };
  }

  private refused(e: Endpoint | undefined, actor: UserId, error: string): EndpointResult {
    if (e) {
      this.audit.record({ actorId: actor, action: 'endpoint.repair.failed', targetId: e.name, note: error });
    }
    return { ok: false, error };
  }

  private need(name: string): Endpoint | undefined {
    return this.get(name);
  }

  setServiceState(name: string, service: string, action: 'start' | 'stop' | 'restart', actor: UserId): EndpointResult {
    const e = this.need(name);
    if (!e) return { ok: false, error: `Cannot find a computer named ${name}.` };
    const s = this.service(e, service);
    if (!s) return this.refused(e, actor, `Cannot find any service with service name '${service}'.`);
    s.status = action === 'stop' ? 'Stopped' : 'Running';
    if (s.name === 'Spooler' && action !== 'stop') {
      // A spooler restart releases jobs that were only waiting on it.
      for (const p of e.printers) {
        if (p.online && !p.jobs.some((j) => j.status === 'Error')) p.jobs = [];
      }
    }
    const verb = action === 'restart' ? 'Restarted' : action === 'start' ? 'Started' : 'Stopped';
    return this.done(e, actor, `${verb} ${s.displayName} (${s.name}) on ${e.name}.`);
  }

  clearPrintQueue(name: string, printer: string, actor: UserId): EndpointResult {
    const e = this.need(name);
    if (!e) return { ok: false, error: `Cannot find a computer named ${name}.` };
    const p = e.printers.find((x) => x.name.toLowerCase() === printer.trim().toLowerCase());
    if (!p) return this.refused(e, actor, `No printer named '${printer}' on ${e.name}.`);
    const n = p.jobs.length;
    p.jobs = [];
    return this.done(e, actor, `Cancelled ${n} print job(s) on ${p.name} (${e.name}).`);
  }

  setDefaultPrinter(name: string, printer: string, actor: UserId): EndpointResult {
    const e = this.need(name);
    if (!e) return { ok: false, error: `Cannot find a computer named ${name}.` };
    const p = e.printers.find((x) => x.name.toLowerCase() === printer.trim().toLowerCase());
    if (!p) return this.refused(e, actor, `No printer named '${printer}' on ${e.name}.`);
    for (const x of e.printers) x.isDefault = x === p;
    return this.done(e, actor, `${p.name} is now the default printer on ${e.name}.`);
  }

  setPrinterOnline(name: string, printer: string, online: boolean, actor: UserId): EndpointResult {
    const e = this.need(name);
    if (!e) return { ok: false, error: `Cannot find a computer named ${name}.` };
    const p = e.printers.find((x) => x.name.toLowerCase() === printer.trim().toLowerCase());
    if (!p) return this.refused(e, actor, `No printer named '${printer}' on ${e.name}.`);
    p.online = online;
    return this.done(e, actor, `${p.name} set ${online ? 'online' : 'to Use Printer Offline'} on ${e.name}.`);
  }

  /** Print a test page. Returns what happened, as the user would see it. */
  printTestPage(name: string, actor: UserId): EndpointResult {
    const e = this.need(name);
    if (!e) return { ok: false, error: `Cannot find a computer named ${name}.` };
    const outcome = this.printOutcome(e);
    const def = e.printers.find((p) => p.isDefault);
    if (outcome.startsWith('Printed')) return this.done(e, actor, `Test page: ${outcome}`);
    if (def && def.name !== PDF_PRINTER && this.service(e, 'Spooler')?.status === 'Running') {
      def.jobs.push({ id: 100 + def.jobs.length, document: 'Test Page', owner: e.username, pages: 1, status: 'Queued' });
    }
    return this.refused(e, actor, `Test page did not print: ${outcome}`);
  }

  repairOutlookProfile(name: string, actor: UserId): EndpointResult {
    const e = this.need(name);
    if (!e) return { ok: false, error: `Cannot find a computer named ${name}.` };
    const was = e.outlook.profile;
    e.outlook.profile = 'ok';
    return this.done(
      e,
      actor,
      was === 'corrupt'
        ? `Created a new Outlook profile for ${e.username} on ${e.name} and set it as the default.`
        : `The Outlook profile on ${e.name} was already healthy; a new profile was created anyway.`,
    );
  }

  setWorkOffline(name: string, offline: boolean, actor: UserId): EndpointResult {
    const e = this.need(name);
    if (!e) return { ok: false, error: `Cannot find a computer named ${name}.` };
    if (e.outlook.profile === 'corrupt') return this.refused(e, actor, 'Outlook cannot start: the profile is corrupt.');
    e.outlook.workOffline = offline;
    return this.done(e, actor, `Outlook Work Offline turned ${offline ? 'on' : 'off'} on ${e.name}.`);
  }

  emptyDeletedItems(name: string, actor: UserId): EndpointResult {
    const e = this.need(name);
    if (!e) return { ok: false, error: `Cannot find a computer named ${name}.` };
    if (e.outlook.profile === 'corrupt') return this.refused(e, actor, 'Outlook cannot start: the profile is corrupt.');
    const freed = e.outlook.deletedItemsMb;
    e.outlook.mailboxUsedMb = Math.max(0, e.outlook.mailboxUsedMb - freed);
    e.outlook.deletedItemsMb = 0;
    return this.done(e, actor, `Emptied Deleted Items for ${e.username}: ${(freed / 1024).toFixed(1)} GB freed.`);
  }

  removeCredential(name: string, target: string, actor: UserId): EndpointResult {
    const e = this.need(name);
    if (!e) return { ok: false, error: `Cannot find a computer named ${name}.` };
    const before = e.credentials.length;
    e.credentials = e.credentials.filter((c) => c.target.toLowerCase() !== target.trim().toLowerCase());
    if (e.credentials.length === before) {
      return this.refused(e, actor, `Element not found: no stored credential for ${target}.`);
    }
    return this.done(e, actor, `Deleted stored credential ${target} on ${e.name}. Outlook will ask once and save the new password.`);
  }

  setAdapterEnabled(name: string, enabled: boolean, actor: UserId): EndpointResult {
    const e = this.need(name);
    if (!e) return { ok: false, error: `Cannot find a computer named ${name}.` };
    e.network.adapterEnabled = enabled;
    if (!enabled) {
      e.network.ssid = null;
      e.network.ipv4 = '0.0.0.0';
    } else if (!e.network.ssid) {
      // Windows rejoins the last known network, which is the corporate one.
      this.join(e, CORP_WIFI);
    }
    return this.done(e, actor, `${e.network.adapterName} adapter ${enabled ? 'enabled' : 'disabled'} on ${e.name}.`);
  }

  connectWifi(name: string, ssid: string, actor: UserId): EndpointResult {
    const e = this.need(name);
    if (!e) return { ok: false, error: `Cannot find a computer named ${name}.` };
    if (!e.network.adapterEnabled) return this.refused(e, actor, 'The wireless adapter is disabled.');
    const wanted = ssid.trim();
    if (wanted.toUpperCase() !== CORP_WIFI && wanted.toUpperCase() !== GUEST_WIFI) {
      return this.refused(e, actor, `There is no wireless network named "${wanted}" in range.`);
    }
    this.join(e, wanted.toUpperCase());
    return this.done(e, actor, `${e.name} connected to ${e.network.ssid} with address ${e.network.ipv4}.`);
  }

  private join(e: Endpoint, ssid: string): void {
    e.network.ssid = ssid;
    if (ssid === CORP_WIFI) {
      e.network.ipv4 = e.leaseIp;
      e.network.gateway = VM_HOST.gateway;
      e.network.dnsServer = VM_HOST.dns;
    } else {
      e.network.ipv4 = `192.168.50.${20 + (hashOf(e.name) % 200)}`;
      e.network.gateway = '192.168.50.1';
      e.network.dnsServer = '192.168.50.1';
    }
  }

  releaseIp(name: string, actor: UserId): EndpointResult {
    const e = this.need(name);
    if (!e) return { ok: false, error: `Cannot find a computer named ${name}.` };
    if (!e.network.adapterEnabled) {
      return this.refused(e, actor, 'An error occurred while releasing interface Wi-Fi : The media is disconnected.');
    }
    e.network.ipv4 = '0.0.0.0';
    e.network.gateway = '';
    return this.done(e, actor, `Released the DHCP lease on ${e.name}.`);
  }

  renewIp(name: string, actor: UserId): EndpointResult {
    const e = this.need(name);
    if (!e) return { ok: false, error: `Cannot find a computer named ${name}.` };
    if (!e.network.adapterEnabled || !e.network.ssid) {
      return this.refused(e, actor, 'An error occurred while renewing interface Wi-Fi : The media is disconnected.');
    }
    if (this.service(e, 'Dhcp')?.status !== 'Running') {
      return this.refused(e, actor, 'An error occurred while renewing interface Wi-Fi : The DHCP Client service is not running.');
    }
    this.join(e, e.network.ssid);
    return this.done(e, actor, `Renewed the DHCP lease on ${e.name}: ${e.network.ipv4}.`);
  }

  flushDns(name: string, actor: UserId): EndpointResult {
    const e = this.need(name);
    if (!e) return { ok: false, error: `Cannot find a computer named ${name}.` };
    e.network.dnsCache = {};
    return this.done(e, actor, `Successfully flushed the DNS Resolver Cache on ${e.name}.`);
  }

  mapDrive(name: string, letter: string, path: string, actor: UserId): EndpointResult {
    const e = this.need(name);
    if (!e) return { ok: false, error: `Cannot find a computer named ${name}.` };
    const drive = letter.trim().toUpperCase().replace(/:?$/, ':');
    const unc = path.trim();
    const m = /^\\\\([^\\]+)\\([^\\]+)\\?$/.exec(unc);
    if (!m) return this.refused(e, actor, `The network path ${unc} is not a valid UNC path (\\\\server\\share).`);
    if (m[1]!.toUpperCase() !== FILE_SERVER || !this.dir.getShare(m[2]!)) {
      return this.refused(e, actor, 'System error 67 has occurred. The network name cannot be found.');
    }
    if (!this.onCorpNetwork(e) && !e.vpn.connected) {
      return this.refused(e, actor, 'System error 53 has occurred. The network path was not found.');
    }
    const access = this.dir.getEffectiveAccess(m[2]!, e.username);
    if (access === 'None' || access === 'Deny') {
      return this.refused(e, actor, 'System error 5 has occurred. Access is denied.');
    }
    e.drives = e.drives.filter((d) => d.letter !== drive);
    e.drives.push({ letter: drive, path: sharePath(m[2]!) });
    return this.done(e, actor, `Mapped ${drive} to ${sharePath(m[2]!)} for ${e.username} on ${e.name}.`);
  }

  removeDrive(name: string, letter: string, actor: UserId): EndpointResult {
    const e = this.need(name);
    if (!e) return { ok: false, error: `Cannot find a computer named ${name}.` };
    const drive = letter.trim().toUpperCase().replace(/:?$/, ':');
    if (!e.drives.some((d) => d.letter === drive)) {
      return this.refused(e, actor, 'The network connection could not be found.');
    }
    e.drives = e.drives.filter((d) => d.letter !== drive);
    return this.done(e, actor, `${drive} was deleted successfully on ${e.name}.`);
  }

  renewVpnCertificate(name: string, actor: UserId): EndpointResult {
    const e = this.need(name);
    if (!e) return { ok: false, error: `Cannot find a computer named ${name}.` };
    e.vpn.certExpiresAt = Date.now() + 365 * DAY;
    return this.done(e, actor, `Enrolled a new VPN certificate for ${e.username} on ${e.name}, valid for 365 days.`);
  }

  connectVpn(name: string, actor: UserId): EndpointResult {
    const e = this.need(name);
    if (!e) return { ok: false, error: `Cannot find a computer named ${name}.` };
    if (e.vpn.certExpiresAt <= Date.now()) {
      e.vpn.connected = false;
      e.vpn.lastAttemptFailed = true;
      return this.refused(e, actor, 'VPN connection failed: the client certificate has expired (error 13801).');
    }
    if (!e.network.adapterEnabled || !hasAddress(e.network.ipv4)) {
      return this.refused(e, actor, 'VPN connection failed: no internet connection.');
    }
    e.vpn.connected = true;
    e.vpn.lastAttemptFailed = false;
    return this.done(e, actor, `Corp VPN connected on ${e.name}.`);
  }

  installSoftware(name: string, app: string, actor: UserId): EndpointResult {
    const e = this.need(name);
    if (!e) return { ok: false, error: `Cannot find a computer named ${name}.` };
    const match = SOFTWARE_CATALOG.find((s) => s.toLowerCase() === app.trim().toLowerCase());
    if (!match) {
      return this.refused(e, actor, `'${app}' is not in Software Center. Unapproved software needs a separate request.`);
    }
    if (e.installed.includes(match)) return this.refused(e, actor, `${match} is already installed on ${e.name}.`);
    if (e.disk.freeGb < 2) return this.refused(e, actor, `Installation failed: not enough disk space on ${e.name}.`);
    e.installed.push(match);
    e.disk.freeGb = Math.max(0, e.disk.freeGb - 0.4);
    return this.done(e, actor, `Installed ${match} on ${e.name}.`);
  }

  cleanupDisk(name: string, actor: UserId): EndpointResult {
    const e = this.need(name);
    if (!e) return { ok: false, error: `Cannot find a computer named ${name}.` };
    const freed = e.disk.tempGb;
    e.disk.freeGb = Math.min(e.disk.totalGb, e.disk.freeGb + freed);
    e.disk.tempGb = 0;
    return this.done(e, actor, `Disk Cleanup freed ${freed.toFixed(1)} GB of temporary files on ${e.name}.`);
  }

  reset(): void {
    this.computers.clear();
  }
}
