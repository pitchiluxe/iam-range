/**
 * services/endpointCapabilities.ts — help-desk repairs on end users' computers.
 *
 * Part of the capability registry (spread into CAPABILITIES), kept in its own
 * file because the registry is already long and these share one idea: every
 * action is aimed at a computer.
 *
 * Which computer: -ComputerName when given, which is how a remote fix is run
 * from the admin's own terminal; otherwise the computer the shell is running
 * on, which is the terminal inside a Remote Desktop session. The admin's
 * workstation is not a managed end-user computer, so running one of these
 * there without -ComputerName is refused and says why, rather than quietly
 * picking somebody's machine.
 */
import type { CapabilityContext, CapabilityParam, CapabilityResult, IamCapability } from './capabilities';
import type { Endpoint, EndpointResult } from './mockEndpoints';
import { OFFICE_CREDENTIAL, OFFICE_PRINTER, SOFTWARE_CATALOG, computerNameFor } from './mockEndpoints';

const err = (error: string): CapabilityResult => ({ ok: false, error });
const ok = (message: string, rows?: Record<string, unknown>[]): CapabilityResult =>
  rows ? { ok: true, message, rows } : { ok: true, message };

export const COMPUTER_PARAM: CapabilityParam = {
  name: 'ComputerName',
  label: 'Computer (e.g. WKS-JDOE)',
  kind: 'text',
  required: false,
};

/** The computer a command is aimed at, or the reason there is none. */
export function targetEndpoint(
  ctx: CapabilityContext,
  computerName: string | undefined,
): { endpoint: Endpoint } | { error: string } {
  if (!ctx.endpoints) return { error: 'No managed computers are available on this host.' };
  const name = computerName?.trim() || ctx.host;
  if (!name) {
    const example = ctx.endpoints.list()[0]?.name ?? computerNameFor('jdoe');
    return {
      error:
        'This workstation is not a managed end-user computer. Add -ComputerName ' +
        `(for example -ComputerName ${example}), or run it from a Remote Desktop session on that computer.`,
    };
  }
  const endpoint = ctx.endpoints.get(name);
  if (!endpoint) return { error: `Cannot find a computer named '${name}'. Get-ADComputer lists them.` };
  return { endpoint };
}

const fromResult = (r: EndpointResult): CapabilityResult => (r.ok ? ok(r.message) : err(r.error));

/** Build a capability whose run() receives the resolved computer. */
function onComputer(
  spec: Omit<IamCapability, 'run' | 'consoleSection' | 'params'> & {
    params?: readonly CapabilityParam[];
    run(ctx: CapabilityContext, e: Endpoint, a: Record<string, string>): CapabilityResult;
  },
): IamCapability {
  return {
    ...spec,
    // Anything that changes a computer can gate a lab step.
    ...(spec.readOnly ? {} : { validator: 'endpoint-repaired' as const }),
    consoleSection: 'endpoint',
    params: [...(spec.params ?? []), COMPUTER_PARAM],
    run(ctx, a) {
      const target = targetEndpoint(ctx, a.ComputerName);
      if ('error' in target) return err(target.error);
      return spec.run(ctx, target.endpoint, a);
    },
  };
}

const falsy = (v: string | undefined): boolean => ['false', '0', 'no', '$false', 'off'].includes((v ?? '').trim().toLowerCase());

export const ENDPOINT_CAPABILITIES: readonly IamCapability[] = [
  {
    id: 'endpoint.list',
    label: 'Managed Computers',
    synopsis: 'List end-user computers and who uses each one.',
    consoleSection: 'endpoint',
    cmdlet: 'Get-ADComputer',
    readOnly: true,
    params: [{ name: 'Identity', label: 'User or computer', kind: 'text', required: false }],
    resolvesTicketKinds: [],
    run(ctx, a) {
      if (!ctx.endpoints) return err('No managed computers are available on this host.');
      const filter = (a.Identity ?? '').trim().toLowerCase();
      const rows = ctx.endpoints
        .list()
        .filter((e) => !filter || e.name.toLowerCase().includes(filter) || e.username.toLowerCase().includes(filter))
        .map((e) => ({ Name: e.name, User: e.username, IPv4: e.network.ipv4, Network: e.network.ssid ?? '(none)' }));
      return ok(rows.length ? `${rows.length} computer(s).` : 'No managed computers match.', rows);
    },
  },

  // ── Services ─────────────────────────────────────────────────────────────
  ...(['Restart', 'Start', 'Stop'] as const).map((verb) =>
    onComputer({
      id: `endpoint.service.${verb.toLowerCase()}`,
      label: `${verb} Service`,
      synopsis: `${verb} a Windows service on a computer.`,
      cmdlet: `${verb}-Service`,
      params: [{ name: 'Name', label: 'Service name', kind: 'text', required: true }],
      resolvesTicketKinds: verb === 'Stop' ? [] : ['printer-issue'],
      run: (ctx, e, a) =>
        fromResult(
          ctx.endpoints!.setServiceState(
            e.name,
            a.Name ?? '',
            verb.toLowerCase() as 'restart' | 'start' | 'stop',
            ctx.actor,
          ),
        ),
    }),
  ),

  // ── Printers ─────────────────────────────────────────────────────────────
  onComputer({
    id: 'endpoint.printer.list',
    label: 'Printers',
    synopsis: 'List printers on a computer, with default, status and queued jobs.',
    cmdlet: 'Get-Printer',
    readOnly: true,
    resolvesTicketKinds: [],
    run: (_ctx, e) =>
      ok(
        `${e.printers.length} printer(s) on ${e.name}.`,
        e.printers.map((p) => ({
          Name: p.name,
          Default: p.isDefault ? 'Yes' : '',
          Status: p.online ? 'Normal' : 'Offline',
          Jobs: p.jobs.length,
        })),
      ),
  }),
  onComputer({
    id: 'endpoint.printjob.list',
    label: 'Print Jobs',
    synopsis: 'List the jobs waiting in a printer queue.',
    cmdlet: 'Get-PrintJob',
    readOnly: true,
    params: [{ name: 'PrinterName', label: 'Printer', kind: 'text', required: false }],
    resolvesTicketKinds: [],
    run(_ctx, e, a) {
      const name = (a.PrinterName ?? OFFICE_PRINTER).trim().toLowerCase();
      const p = e.printers.find((x) => x.name.toLowerCase() === name);
      if (!p) return err(`No printer named '${a.PrinterName}' on ${e.name}.`);
      if (p.jobs.length === 0) return ok(`The ${p.name} queue on ${e.name} is empty.`);
      return ok(
        `${p.jobs.length} job(s) in the ${p.name} queue.`,
        p.jobs.map((j) => ({ Id: j.id, Document: j.document, Owner: j.owner, Pages: j.pages, Status: j.status })),
      );
    },
  }),
  onComputer({
    id: 'endpoint.printjob.clear',
    label: 'Clear Print Queue',
    synopsis: 'Cancel every job in a printer queue.',
    cmdlet: 'Remove-PrintJob',
    params: [
      { name: 'PrinterName', label: 'Printer', kind: 'text', required: false },
      { name: 'All', label: 'All jobs', kind: 'bool', required: false },
    ],
    resolvesTicketKinds: ['printer-issue'],
    run: (ctx, e, a) => fromResult(ctx.endpoints!.clearPrintQueue(e.name, a.PrinterName ?? OFFICE_PRINTER, ctx.actor)),
  }),
  onComputer({
    id: 'endpoint.printer.default',
    label: 'Set Default Printer',
    synopsis: 'Make a printer the default on a computer.',
    cmdlet: 'Set-DefaultPrinter',
    params: [{ name: 'Name', label: 'Printer', kind: 'text', required: true }],
    resolvesTicketKinds: ['printer-issue'],
    run: (ctx, e, a) => fromResult(ctx.endpoints!.setDefaultPrinter(e.name, a.Name ?? '', ctx.actor)),
  }),
  onComputer({
    id: 'endpoint.printer.online',
    label: 'Set Printer Online',
    synopsis: 'Turn "Use printer offline" off (or on, with -Online false).',
    cmdlet: 'Set-PrinterOnline',
    params: [
      { name: 'Name', label: 'Printer', kind: 'text', required: true },
      { name: 'Online', label: 'Online', kind: 'bool', required: false },
    ],
    resolvesTicketKinds: ['printer-issue'],
    run: (ctx, e, a) =>
      fromResult(ctx.endpoints!.setPrinterOnline(e.name, a.Name ?? '', !falsy(a.Online), ctx.actor)),
  }),
  onComputer({
    id: 'endpoint.printer.test',
    label: 'Print Test Page',
    synopsis: 'Print a test page to the default printer and report what happened.',
    cmdlet: 'Invoke-PrintTestPage',
    resolvesTicketKinds: [],
    run: (ctx, e) => fromResult(ctx.endpoints!.printTestPage(e.name, ctx.actor)),
  }),

  // ── Outlook and credentials ──────────────────────────────────────────────
  onComputer({
    id: 'endpoint.outlook.status',
    label: 'Outlook Status',
    synopsis: 'Show the Outlook profile, connection and mailbox size on a computer.',
    cmdlet: 'Get-OutlookStatus',
    readOnly: true,
    resolvesTicketKinds: [],
    run(ctx, e) {
      const o = e.outlook;
      return ok(ctx.endpoints!.outlookOutcome(e), [
        { Property: 'Profile', Value: o.profile === 'ok' ? 'Outlook (OK)' : 'Outlook (corrupt)' },
        { Property: 'WorkOffline', Value: o.workOffline ? 'True' : 'False' },
        { Property: 'MailboxUsed', Value: `${(o.mailboxUsedMb / 1024).toFixed(1)} GB of ${(o.quotaMb / 1024).toFixed(0)} GB` },
        { Property: 'DeletedItems', Value: `${(o.deletedItemsMb / 1024).toFixed(1)} GB` },
      ]);
    },
  }),
  onComputer({
    id: 'endpoint.outlook.repair',
    label: 'Repair Outlook Profile',
    synopsis: 'Create a new Outlook mail profile and make it the default.',
    cmdlet: 'Repair-OutlookProfile',
    resolvesTicketKinds: ['email-issue'],
    run: (ctx, e) => fromResult(ctx.endpoints!.repairOutlookProfile(e.name, ctx.actor)),
  }),
  onComputer({
    id: 'endpoint.outlook.offline',
    label: 'Set Work Offline',
    synopsis: 'Turn Outlook Work Offline on or off (-Enabled false reconnects).',
    cmdlet: 'Set-OutlookWorkOffline',
    params: [{ name: 'Enabled', label: 'Work offline', kind: 'bool', required: true }],
    resolvesTicketKinds: ['email-issue'],
    run: (ctx, e, a) => fromResult(ctx.endpoints!.setWorkOffline(e.name, !falsy(a.Enabled), ctx.actor)),
  }),
  onComputer({
    id: 'endpoint.outlook.cleanup',
    label: 'Empty Deleted Items',
    synopsis: 'Empty the Deleted Items folder to bring a mailbox under quota.',
    cmdlet: 'Clear-DeletedItems',
    resolvesTicketKinds: ['email-issue'],
    run: (ctx, e) => fromResult(ctx.endpoints!.emptyDeletedItems(e.name, ctx.actor)),
  }),
  onComputer({
    id: 'endpoint.credential.list',
    label: 'Stored Credentials',
    synopsis: 'List credentials saved in Credential Manager on a computer.',
    cmdlet: 'Get-StoredCredential',
    readOnly: true,
    resolvesTicketKinds: [],
    run: (_ctx, e) =>
      ok(
        `${e.credentials.length} stored credential(s) on ${e.name}.`,
        e.credentials.map((c) => ({
          Target: c.target,
          User: c.user,
          Saved: c.stale ? 'Before the last password change' : 'Current',
        })),
      ),
  }),
  onComputer({
    id: 'endpoint.credential.remove',
    label: 'Remove Stored Credential',
    synopsis: 'Delete a saved credential from Credential Manager.',
    cmdlet: 'Remove-StoredCredential',
    params: [{ name: 'Target', label: 'Target', kind: 'text', required: true }],
    resolvesTicketKinds: ['email-issue'],
    run: (ctx, e, a) => fromResult(ctx.endpoints!.removeCredential(e.name, a.Target ?? OFFICE_CREDENTIAL, ctx.actor)),
  }),

  // ── Network ──────────────────────────────────────────────────────────────
  onComputer({
    id: 'endpoint.net.adapter',
    label: 'Network Adapters',
    synopsis: 'Show the network adapter, its status and the network it is on.',
    cmdlet: 'Get-NetAdapter',
    readOnly: true,
    resolvesTicketKinds: [],
    run: (_ctx, e) =>
      ok(`Adapters on ${e.name}.`, [
        {
          Name: e.network.adapterName,
          Status: e.network.adapterEnabled ? (e.network.ssid ? 'Up' : 'Disconnected') : 'Disabled',
          Network: e.network.ssid ?? '',
          IPv4: e.network.ipv4,
          MacAddress: e.mac,
        },
      ]),
  }),
  ...(['Enable', 'Disable'] as const).map((verb) =>
    onComputer({
      id: `endpoint.net.${verb.toLowerCase()}`,
      label: `${verb} Network Adapter`,
      synopsis: `${verb} a network adapter.`,
      cmdlet: `${verb}-NetAdapter`,
      params: [{ name: 'Name', label: 'Adapter', kind: 'text', required: false }],
      resolvesTicketKinds: verb === 'Enable' ? ['network-issue'] : [],
      run: (ctx, e) => fromResult(ctx.endpoints!.setAdapterEnabled(e.name, verb === 'Enable', ctx.actor)),
    }),
  ),
  onComputer({
    id: 'endpoint.wifi.connect',
    label: 'Connect Wi-Fi',
    synopsis: 'Join a wireless network.',
    cmdlet: 'Connect-WiFi',
    params: [{ name: 'Ssid', label: 'Network name', kind: 'text', required: true }],
    resolvesTicketKinds: ['network-issue'],
    run: (ctx, e, a) => fromResult(ctx.endpoints!.connectWifi(e.name, a.Ssid ?? '', ctx.actor)),
  }),
  onComputer({
    id: 'endpoint.dhcp.renew',
    label: 'Renew DHCP Lease',
    synopsis: 'Release and renew the DHCP address (ipconfig /release, /renew).',
    cmdlet: 'Update-DhcpLease',
    resolvesTicketKinds: ['network-issue'],
    run(ctx, e) {
      const released = ctx.endpoints!.releaseIp(e.name, ctx.actor);
      if (!released.ok) return err(released.error);
      return fromResult(ctx.endpoints!.renewIp(e.name, ctx.actor));
    },
  }),
  onComputer({
    id: 'endpoint.dns.flush',
    label: 'Clear DNS Cache',
    synopsis: 'Flush the client DNS resolver cache (ipconfig /flushdns).',
    cmdlet: 'Clear-DnsClientCache',
    resolvesTicketKinds: ['network-issue'],
    run: (ctx, e) => fromResult(ctx.endpoints!.flushDns(e.name, ctx.actor)),
  }),

  // ── Drives ───────────────────────────────────────────────────────────────
  onComputer({
    id: 'endpoint.drive.list',
    label: 'Mapped Drives',
    synopsis: 'List mapped network drives (net use).',
    cmdlet: 'Get-MappedDrive',
    readOnly: true,
    resolvesTicketKinds: [],
    run: (_ctx, e) =>
      e.drives.length
        ? ok(`${e.drives.length} mapped drive(s) on ${e.name}.`, e.drives.map((d) => ({ Drive: d.letter, Path: d.path })))
        : ok(`There are no mapped drives on ${e.name}.`),
  }),
  onComputer({
    id: 'endpoint.drive.map',
    label: 'Map Network Drive',
    synopsis: 'Map a drive letter to a share (net use S: \\\\FS01\\Share).',
    cmdlet: 'New-MappedDrive',
    params: [
      { name: 'Letter', label: 'Drive letter', kind: 'text', required: true },
      { name: 'Path', label: 'UNC path', kind: 'text', required: true },
    ],
    resolvesTicketKinds: ['drive-mapping'],
    run: (ctx, e, a) => fromResult(ctx.endpoints!.mapDrive(e.name, a.Letter ?? '', a.Path ?? '', ctx.actor)),
  }),
  onComputer({
    id: 'endpoint.drive.remove',
    label: 'Remove Mapped Drive',
    synopsis: 'Disconnect a mapped drive.',
    cmdlet: 'Remove-MappedDrive',
    params: [{ name: 'Letter', label: 'Drive letter', kind: 'text', required: true }],
    resolvesTicketKinds: [],
    run: (ctx, e, a) => fromResult(ctx.endpoints!.removeDrive(e.name, a.Letter ?? '', ctx.actor)),
  }),

  // ── VPN ──────────────────────────────────────────────────────────────────
  onComputer({
    id: 'endpoint.vpn.status',
    label: 'VPN Status',
    synopsis: 'Show the VPN connection and certificate expiry.',
    cmdlet: 'Get-VpnStatus',
    readOnly: true,
    resolvesTicketKinds: [],
    run(_ctx, e) {
      const expired = e.vpn.certExpiresAt <= Date.now();
      return ok(`Corp VPN on ${e.name}.`, [
        { Property: 'Connection', Value: e.vpn.connected ? 'Connected' : 'Disconnected' },
        { Property: 'Certificate', Value: expired ? 'Expired' : 'Valid' },
        { Property: 'CertificateExpires', Value: new Date(e.vpn.certExpiresAt).toLocaleDateString() },
      ]);
    },
  }),
  onComputer({
    id: 'endpoint.vpn.renew',
    label: 'Renew VPN Certificate',
    synopsis: 'Enrol a new VPN client certificate.',
    cmdlet: 'Update-VpnCertificate',
    resolvesTicketKinds: ['vpn-issue'],
    run: (ctx, e) => fromResult(ctx.endpoints!.renewVpnCertificate(e.name, ctx.actor)),
  }),
  onComputer({
    id: 'endpoint.vpn.connect',
    label: 'Connect VPN',
    synopsis: 'Connect the corporate VPN.',
    cmdlet: 'Connect-Vpn',
    resolvesTicketKinds: ['vpn-issue'],
    run: (ctx, e) => fromResult(ctx.endpoints!.connectVpn(e.name, ctx.actor)),
  }),

  // ── Software and disk ────────────────────────────────────────────────────
  onComputer({
    id: 'endpoint.software.list',
    label: 'Installed Software',
    synopsis: 'List installed applications, and what Software Center offers.',
    cmdlet: 'Get-InstalledSoftware',
    readOnly: true,
    resolvesTicketKinds: [],
    run: (_ctx, e) =>
      ok(
        `${e.installed.length} installed on ${e.name}.` +
          (e.requestedSoftware ? ` Requested: ${e.requestedSoftware}.` : ''),
        [
          ...e.installed.map((name) => ({ Name: name, State: 'Installed' })),
          ...SOFTWARE_CATALOG.filter((s) => !e.installed.includes(s)).map((name) => ({
            Name: name,
            State: 'Available in Software Center',
          })),
        ],
      ),
  }),
  onComputer({
    id: 'endpoint.software.install',
    label: 'Install Software',
    synopsis: 'Install an approved application from Software Center.',
    cmdlet: 'Install-Software',
    params: [{ name: 'Name', label: 'Application', kind: 'text', required: true }],
    resolvesTicketKinds: ['software-request'],
    run: (ctx, e, a) => fromResult(ctx.endpoints!.installSoftware(e.name, a.Name ?? '', ctx.actor)),
  }),
  onComputer({
    id: 'endpoint.disk.status',
    label: 'Disk Space',
    synopsis: 'Show free space on C: and how much is temporary files.',
    cmdlet: 'Get-DiskSpace',
    readOnly: true,
    resolvesTicketKinds: [],
    run: (_ctx, e) =>
      ok(`Local Disk (C:) on ${e.name}.`, [
        { Drive: 'C:', SizeGB: e.disk.totalGb, FreeGB: e.disk.freeGb.toFixed(1), TempFilesGB: e.disk.tempGb.toFixed(1) },
      ]),
  }),
  onComputer({
    id: 'endpoint.disk.cleanup',
    label: 'Clear Temporary Files',
    synopsis: 'Run Disk Cleanup to remove temporary files.',
    cmdlet: 'Clear-TempFiles',
    resolvesTicketKinds: ['performance-issue'],
    run: (ctx, e) => fromResult(ctx.endpoints!.cleanupDisk(e.name, ctx.actor)),
  }),
];
