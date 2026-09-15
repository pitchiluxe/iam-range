/**
 * tests/endpoints.test.ts — help-desk labs on end users' computers.
 *
 * Every issue in the catalogue is staged on a real computer, shown to be
 * broken by the same check the ticket review uses, and then repaired with the
 * command its hint ladder teaches. A hint that names a cmdlet which does not
 * exist, or one that does not fix the fault, fails here rather than in front
 * of a learner who followed it.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { VmSession } from '@/vm/session';
import { dispatch } from '@/terminal/dispatcher';
import type { CapabilityContext } from '@/services';
import { OFFICE_CREDENTIAL, OFFICE_PRINTER, CORP_WIFI, INTRANET_HOST, sharePath } from '@/services';
import { ENDPOINT_ISSUES, ENDPOINT_ISSUE_IDS } from '@/vm/endpointIssues';
import { generateTickets } from '@/vm/ticketGenerator';
import { reviewTicketSync } from '@/vm/ticketReview';
import { capabilitiesResolving } from '@/services/capabilities';
import { ENDPOINT_TICKET_KINDS } from '@/domain';
import type { EndpointIssueId, Ticket, UserId } from '@/domain';

const ACTOR = 'admin-1' as UserId;

function staffed(): { s: VmSession; userId: UserId } {
  const s = new VmSession();
  s.dir.createOu('Corp');
  s.dir.createGroup('grp-helpdesk-tier1', 'Tier 1');
  const u = s.dir.createUser({
    username: 'jdoe',
    displayName: 'John Doe',
    email: 'jdoe@omari.test',
    department: 'Help Desk',
    title: 'Service Desk Analyst',
    mfa: 'none',
  });
  return { s, userId: u.id };
}

function shell(s: VmSession, host?: string): CapabilityContext {
  return {
    dir: s.dir,
    idp: s.idp,
    tickets: s.tickets,
    audit: s.audit,
    pim: s.pim,
    cloud: s.cloud,
    endpoints: s.endpoints,
    actor: ACTOR,
    ...(host ? { host } : {}),
  };
}

/** The command each issue's hints teach, run in a shell on that computer. */
const FIXES: Record<EndpointIssueId, (share: string) => string[]> = {
  'printer-spooler-stopped': () => ['Restart-Service -Name Spooler'],
  'printer-queue-stuck': () => [`Remove-PrintJob -PrinterName ${OFFICE_PRINTER} -All`],
  'printer-wrong-default': () => [`Set-DefaultPrinter -Name ${OFFICE_PRINTER}`],
  'printer-offline': () => [`Set-PrinterOnline -Name ${OFFICE_PRINTER}`],
  'outlook-profile-corrupt': () => ['Repair-OutlookProfile'],
  'outlook-work-offline': () => ['Set-OutlookWorkOffline -Enabled false'],
  'outlook-mailbox-full': () => ['Clear-DeletedItems'],
  'outlook-password-loop': () => [`cmdkey /delete:${OFFICE_CREDENTIAL}`],
  'network-wifi-wrong': () => [`netsh wlan connect name=${CORP_WIFI}`],
  'network-apipa': () => ['ipconfig /release', 'ipconfig /renew'],
  'network-dns-stale': () => ['ipconfig /flushdns'],
  'network-adapter-disabled': () => ['Enable-NetAdapter -Name Wi-Fi'],
  'drive-missing': (share) => [`net use S: ${sharePath(share)}`],
  'drive-access-denied': (share) => [
    `Grant-SharePermission -Name ${share} -Trustee jdoe -Access Modify`,
    `net use S: ${sharePath(share)}`,
  ],
  'vpn-cert-expired': () => ['Update-VpnCertificate', 'Connect-Vpn'],
  'software-missing': () => ['Install-Software -Name "Adobe Acrobat Reader"'],
  'disk-full': () => ['Clear-TempFiles'],
};

describe('endpoints — every issue can be staged, seen and fixed', () => {
  it('builds a healthy computer with nothing to fix', () => {
    const { s, userId } = staffed();
    const e = s.endpoints.ensureFor(userId)!;
    expect(e.name).toBe('WKS-JDOE');
    for (const issue of ENDPOINT_ISSUE_IDS) {
      expect(s.endpoints.check(e.name, issue).fixed, issue).toBe(true);
    }
  });

  for (const issue of ENDPOINT_ISSUE_IDS) {
    it(`${issue}: staged, detected, fixed by the taught command`, () => {
      const { s, userId } = staffed();
      const e = s.endpoints.ensureFor(userId)!;

      expect(s.endpoints.applyFault(e.name, issue)).toBe(true);
      expect(s.endpoints.check(e.name, issue).fixed, 'fault not visible').toBe(false);
      expect(s.audit.events.some((ev) => ev.action === 'endpoint.fault' && ev.note === issue)).toBe(true);

      // Run from a shell on that computer, as the Remote Desktop terminal is.
      const ctx = shell(s, e.name);
      for (const line of FIXES[issue](e.homeShare)) {
        const r = dispatch(line, ctx);
        expect(r.ok, `${line}: ${r.output}`).toBe(true);
      }
      const after = s.endpoints.check(e.name, issue);
      expect(after.fixed, after.detail).toBe(true);
    });
  }

  it('every issue has a ticket kind that a capability resolves', () => {
    for (const kind of ENDPOINT_TICKET_KINDS) {
      expect(capabilitiesResolving(kind).length, kind).toBeGreaterThan(0);
    }
    for (const spec of Object.values(ENDPOINT_ISSUES)) {
      expect(ENDPOINT_TICKET_KINDS).toContain(spec.kind);
    }
  });
});

describe('endpoints — the diagnosis is not handed out', () => {
  let s: VmSession;
  let name: string;

  beforeEach(() => {
    const st = staffed();
    s = st.s;
    name = s.endpoints.ensureFor(st.userId)!.name;
  });

  it('refuses endpoint commands on the admin workstation without -ComputerName', () => {
    const r = dispatch('Restart-Service -Name Spooler', shell(s));
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/-ComputerName/);
  });

  it('runs a remote fix from the admin workstation with -ComputerName', () => {
    s.endpoints.applyFault(name, 'printer-spooler-stopped');
    const r = dispatch(`Restart-Service -Name Spooler -ComputerName ${name}`, shell(s));
    expect(r.ok, r.output).toBe(true);
    expect(s.endpoints.check(name, 'printer-spooler-stopped').fixed).toBe(true);
  });

  it('shows a stopped spooler as stopped on that computer', () => {
    s.endpoints.applyFault(name, 'printer-spooler-stopped');
    const out = dispatch('Get-Service -Name Spooler', shell(s, name)).output;
    expect(out).toContain('Stopped');
  });

  it('ipconfig on the computer shows an APIPA address when DHCP failed', () => {
    s.endpoints.applyFault(name, 'network-apipa');
    expect(dispatch('ipconfig', shell(s, name)).output).toMatch(/169\.254\./);
    expect(dispatch('hostname', shell(s, name)).output).toBe(name);
  });

  it('a stale DNS cache answers with the old address until it is flushed', () => {
    s.endpoints.applyFault(name, 'network-dns-stale');
    expect(dispatch(`nslookup ${INTRANET_HOST}`, shell(s, name)).output).toContain('10.20.9.99');
    expect(dispatch(`ping ${INTRANET_HOST}`, shell(s, name)).ok).toBe(false);
    dispatch('ipconfig /flushdns', shell(s, name));
    expect(dispatch(`ping ${INTRANET_HOST}`, shell(s, name)).ok).toBe(true);
  });

  it('mapping the drive again does not fix an access-denied share', () => {
    const e = s.endpoints.get(name)!;
    s.endpoints.applyFault(name, 'drive-access-denied');
    const r = dispatch(`net use S: ${sharePath(e.homeShare)}`, shell(s, name));
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/Access is denied/);
    expect(s.endpoints.check(name, 'drive-access-denied').fixed).toBe(false);
  });

  it('a new password does not stop a stale credential loop', () => {
    s.endpoints.applyFault(name, 'outlook-password-loop');
    const e = s.endpoints.get(name)!;
    expect(s.endpoints.outlookOutcome(e)).toMatch(/again and again/);
    dispatch('Repair-OutlookProfile', shell(s, name));
    expect(s.endpoints.check(name, 'outlook-password-loop').fixed).toBe(false);
  });

  it('every repair lands in the audit log against the computer', () => {
    dispatch('Clear-TempFiles', shell(s, name));
    const ev = s.audit.events.find((x) => x.action === 'endpoint.repair');
    expect(ev?.targetId).toBe(name);
    expect(ev?.actorId).toBe(ACTOR);
  });
});

describe('help-desk tickets — generated, reviewed, resolved', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('raises tickets whose fault is really on the named computer', async () => {
    const { s } = staffed();
    const res = await generateTickets(
      { dir: s.dir, tickets: s.tickets, audit: s.audit, endpoints: s.endpoints },
      { useOllama: false, focus: 'helpdesk' },
    );
    expect(res.raised).toBe(1);
    const t = s.tickets.list().find((x) => (ENDPOINT_TICKET_KINDS as readonly string[]).includes(x.kind))!;
    const { computer, issue } = t.payload as { computer: string; issue: EndpointIssueId };
    expect(computer).toBe('WKS-JDOE');
    expect(t.body).toContain(computer);
    expect(s.endpoints.check(computer, issue).fixed).toBe(false);
  });

  it('does not stack a second help-desk ticket on a computer with one open', async () => {
    const { s } = staffed();
    const deps = { dir: s.dir, tickets: s.tickets, audit: s.audit, endpoints: s.endpoints };
    await generateTickets(deps, { useOllama: false, focus: 'helpdesk' });
    const again = await generateTickets(deps, { useOllama: false, focus: 'helpdesk' });
    expect(again.raised).toBe(0);
  });

  it('review refuses until the computer is fixed and a work note is written', async () => {
    const { s } = staffed();
    const deps = { dir: s.dir, tickets: s.tickets, audit: s.audit, endpoints: s.endpoints };
    await generateTickets(deps, { useOllama: false, focus: 'helpdesk' });
    const t = s.tickets.list()[s.tickets.list().length - 1] as Ticket;
    const { computer, issue } = t.payload as { computer: string; issue: EndpointIssueId };

    const before = reviewTicketSync(t, deps, ACTOR);
    expect(before.passed).toBe(false);

    const e = s.endpoints.get(computer)!;
    for (const line of FIXES[issue](e.homeShare)) {
      // The software ticket asks for whichever app was missing, not always Acrobat.
      const cmd = issue === 'software-missing' ? `Install-Software -Name "${e.requestedSoftware}"` : line;
      dispatch(cmd, shell(s, computer));
    }
    const fixedNoNote = reviewTicketSync(t, deps, ACTOR);
    expect(fixedNoNote.passed).toBe(false);
    expect(fixedNoNote.checks.find((c) => c.label === 'Work note recorded')?.passed).toBe(false);

    s.tickets.addWorkNote(t.id, ACTOR, 'Found the cause on the computer and fixed it; user confirmed.');
    const after = reviewTicketSync(t, deps, ACTOR);
    expect(after.checks.filter((c) => !c.passed)).toEqual([]);
    expect(after.passed).toBe(true);
  });

  it('keeps the computer name when Ollama rewrites the ticket', async () => {
    const { s } = staffed();
    vi.stubGlobal('fetch', async (url: string) => {
      if (!String(url).includes('/api/generate')) {
        return { ok: true, json: async () => ({ models: [{ name: 'stub' }] }) } as never;
      }
      // A rewrite that drops the computer name must be rejected.
      return {
        ok: true,
        json: async () => ({ response: JSON.stringify({ subject: 'Help!', body: 'My PC is broken.' }) }),
      } as never;
    });
    await generateTickets(
      { dir: s.dir, tickets: s.tickets, audit: s.audit, endpoints: s.endpoints },
      { focus: 'helpdesk' },
    );
    const t = s.tickets.list()[s.tickets.list().length - 1]!;
    expect(t.body).toContain('WKS-JDOE');
  });
});

describe('help-desk tickets — the tutor climbs the ladder, it does not jump', () => {
  it('gives the nudge and question in socratic mode, and the fix only in walkthrough', async () => {
    const { ladderFor, offlineAnswer } = await import('@/vm/tutor');
    const { readEnvironment } = await import('@/vm/environmentStage');
    const { s } = staffed();
    const hints = ENDPOINT_ISSUES['network-apipa'].hints({
      display: 'John Doe',
      username: 'jdoe',
      computer: 'WKS-JDOE',
      department: 'Help Desk',
      share: 'Dept-HelpDesk',
    });
    const base = { env: readEnvironment(s.dir), ticket: { subject: 's', body: 'b', hints } };

    const socratic = ladderFor({ ...base, mode: 'socratic' });
    expect(socratic).toHaveLength(2);
    expect(socratic.join(' ')).not.toContain('/renew');

    expect(ladderFor({ ...base, mode: 'walkthrough' }).join(' ')).toContain('/renew');
    expect(offlineAnswer('I am stuck', { ...base, mode: 'socratic' }).text).not.toContain('/renew');
  });
});
