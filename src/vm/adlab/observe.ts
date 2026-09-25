/**
 * vm/adlab/observe.ts — what the instructor is allowed to see.
 *
 * Read-only observability, enforced rather than promised: the instructor gets
 * a deep-frozen copy of the lab, so even a bug that tried to write to it would
 * throw instead of reconfiguring the student's estate. The live state never
 * leaves the window that owns it.
 *
 * The second job here is lab memory. `evidenceNotes` reads the student's
 * command history the way a senior technician reads over a junior's shoulder:
 * "ping worked, nslookup failed — so it is DNS, not the network". Those
 * inferences are made deterministically here, so a small model is handed the
 * conclusion instead of being trusted to reach it.
 */
import { DOMAIN_FQDN, type LabState, PLAN, internalNic } from './state';

type DeepReadonly<T> = T extends (infer R)[]
  ? readonly DeepReadonly<R>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

export type InstructorView = DeepReadonly<LabState>;

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

/** A frozen, detached copy of the lab for the instructor. */
export function snapshotForInstructor(s: LabState): InstructorView {
  return deepFreeze(JSON.parse(JSON.stringify(s)) as LabState);
}

/** Which parts of the estate a lab is about. */
export type Focus = 'net' | 'roles' | 'ad' | 'accounts' | 'gpo' | 'dns' | 'dhcp' | 'routing' | 'shares';

/**
 * The estate in a few lines — enough to reason from, short enough for a CPU
 * model. `focus` keeps it to what the current lab touches: a prompt twice the
 * size is an answer twice as slow, and the learner is waiting on it.
 */
export function describeState(v: InstructorView, focus?: readonly Focus[]): string {
  const want = (f: Focus): boolean => !focus || focus.includes(f);
  const lines: string[] = [];
  for (const h of Object.values(v.hosts)) {
    lines.push(
      `${h.name}: hostname ${h.hostname}${h.pendingHostname ? ` (rename to ${h.pendingHostname} pending restart)` : ''}; ` +
        `${h.domain ? `member of ${h.domain}` : h.pendingDomain ? `join to ${h.pendingDomain} pending restart` : 'WORKGROUP'}; ${h.os}`,
    );
    if (!want('net')) continue;
    for (const n of h.nics) {
      lines.push(
        `  NIC "${n.alias}" (${n.network}): ${n.dhcp ? 'DHCP' : 'static'} ip ${n.ip ?? 'none'} mask ${n.mask ?? 'none'} ` +
          `gw ${n.gateway ?? 'none'} dns [${n.dns.join(', ')}]${n.dnsStatic ? ' (static DNS)' : ''}` +
          `${n.leaseFrom ? ` lease from ${n.leaseFrom}` : ''}`,
      );
    }
    if (!want('roles')) continue;
    if (h.features.length) lines.push(`  roles: ${h.features.join(', ')}`);
    const svc = Object.entries(h.services).filter(([k]) => ['DNS', 'DHCPServer', 'NTDS', 'Netlogon', 'RemoteAccess'].includes(k));
    if (svc.length) lines.push(`  services: ${svc.map(([k, st]) => `${k}=${st}`).join(', ')}`);
  }
  const ad = v.ad;
  if (ad.forest) {
    lines.push(`AD: forest ${ad.forest} (NetBIOS ${ad.netbios})`);
    if (want('ad')) lines.push(`  OUs: ${ad.ous.join(' | ') || 'none'}`);
    const users = ad.users.filter((u) => !['Administrator', 'krbtgt'].includes(u.sam));
    if (users.length && want('accounts')) {
      lines.push(`  users: ${users.map((u) => `${u.sam} [${u.enabled ? 'enabled' : 'DISABLED'}${u.lockedOut ? ', LOCKED OUT' : ''}${u.passwordSet ? '' : ', no password'}] in ${u.parent}`).join('; ')}`);
    }
    const groups = ad.groups.filter((g) => !g.builtin);
    if (groups.length && want('accounts')) lines.push(`  groups: ${groups.map((g) => `${g.name} (${g.scope}/${g.category}) members [${g.members.join(', ')}] in ${g.parent}`).join('; ')}`);
    if (want('ad')) lines.push(`  computers: ${ad.computers.map((c) => `${c.name} in ${c.parent}`).join('; ')}`);
    if (want('gpo')) {
      lines.push(`  GPOs: ${ad.gpos.map((g) => `${g.name} -> [${g.links.join('; ')}]`).join('; ')}`);
      lines.push(`  password policy: min ${ad.passwordPolicy.minPasswordLength}, lockout ${ad.passwordPolicy.lockoutThreshold}`);
      lines.push(`  CLIENT01 applied GPOs: ${v.hosts.CLIENT01.appliedGpos.join(', ') || 'none'}`);
    }
  } else lines.push('AD: not promoted yet');
  if (want('dns')) lines.push(`DNS zones: ${v.dns.zones.join(', ') || 'none'}; records: ${v.dns.records.map((r) => `${r.name}.${r.zone}=${r.ip}`).join(', ') || 'none'}`);
  if (want('dhcp')) lines.push(
    `DHCP: authorized ${v.dhcp.authorized}; scopes ${v.dhcp.scopes.map((s) => `${s.scopeId} ${s.start}-${s.end} ${s.active ? 'active' : 'INACTIVE'} router ${s.router ?? '-'} dns [${s.dns.join(', ')}] domain ${s.dnsDomain ?? '-'}`).join('; ') || 'none'}` +
      `; server options router ${v.dhcp.serverOptions.router ?? '-'} dns [${v.dhcp.serverOptions.dns.join(', ')}]; leases ${v.dhcp.leases.map((l) => `${l.hostname}=${l.ip}`).join(', ') || 'none'}`,
  );
  if (want('routing')) lines.push(`RRAS: configured ${v.routing.configured}, NAT ${v.routing.natInstalled ? JSON.stringify(v.routing.natInterfaces) : 'not installed'}`);
  if (want('shares') && v.shares.length) {
    lines.push(`Shares: ${v.shares.map((s) => `${s.name} -> ${s.path} [${s.access.map((a) => `${a.identity}=${a.rights}`).join(', ')}]`).join('; ')}`);
    for (const [path, acl] of Object.entries(v.ntfs)) {
      if (path.includes('shares')) lines.push(`  NTFS ${path}: ${acl.map((a) => `${a.identity}:${a.inherited ? '(I)' : ''}${a.rights}`).join(', ')}`);
    }
  }
  return lines.join('\n');
}

/** The student's last few commands, with outcome and the first line they saw. */
export function recentActivity(v: InstructorView, n = 12): string {
  const recent = v.history.slice(-n);
  if (recent.length === 0) return '(The student has not run any commands yet.)';
  return recent
    .map((h) => {
      const first = h.output.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
      if (h.outcomeKnown === false) return `[${h.host}] ${h.command}  (typed in the real VM; outcome not captured)`;
      return `[${h.host}] ${h.command}  => ${h.ok ? 'OK' : 'FAILED'}${first ? `: ${first.slice(0, 140)}` : ''}`;
    })
    .join('\n');
}

const DC = PLAN.dcInternalIp;

/**
 * What the history already proves. Each note is a fact plus the narrowing it
 * allows — never the fix.
 */
export function evidenceNotes(v: InstructorView): string[] {
  const notes: string[] = [];
  // Only reason from outcomes we actually saw; a real VM's history has none.
  const h = v.history.filter((e) => e.outcomeKnown !== false);
  const on = (host: string) => h.filter((e) => e.host === host);

  for (const host of ['CLIENT01', 'DC01'] as const) {
    const mine = on(host);
    const pings = mine.filter((e) => /^ping\s+/i.test(e.command) && (e.command.includes(DC) || /dc01/i.test(e.command)));
    const lookups = mine.filter((e) => /^(nslookup|resolve-dnsname)\s+/i.test(e.command) && e.command.toLowerCase().includes(DOMAIN_FQDN));
    const lastPing = pings[pings.length - 1];
    const lastLookup = lookups[lookups.length - 1];
    if (lastPing?.ok && lastLookup && !lastLookup.ok) {
      notes.push(`${host}: ping to DC01 succeeds but name resolution of ${DOMAIN_FQDN} fails. Basic IP connectivity works; that narrows the investigation to DNS rather than the network.`);
    } else if (lastPing && !lastPing.ok && host === 'CLIENT01') {
      notes.push(`${host}: ping to DC01 fails. Before looking at DNS, the addressing itself (IP, mask, APIPA) needs checking.`);
    } else if (lastLookup?.ok && lastPing?.ok) {
      notes.push(`${host}: both connectivity and name resolution to the domain have been shown to work.`);
    }
  }

  const join = h.filter((e) => /^add-computer/i.test(e.command));
  if (join.length && !join[join.length - 1]!.ok) {
    notes.push('Add-Computer failed with "domain either does not exist or could not be contacted". A domain join starts with a DNS lookup for a domain controller.');
  }
  const renew = h.filter((e) => /^ipconfig\s+\/renew/i.test(e.command));
  if (renew.length && !renew[renew.length - 1]!.ok) {
    notes.push('The last ipconfig /renew timed out: no DHCP server answered the client.');
  }
  if (h.some((e) => e.host === 'CLIENT01' && /is not recognized/.test(e.output) && /-AD/i.test(e.command))) {
    notes.push('The student ran an Active Directory cmdlet on CLIENT01, which has no RSAT tools. AD administration happens on DC01.');
  }
  if (h.some((e) => /^get-aduser/i.test(e.command) && /LockedOut\s*:\s*True/i.test(e.output))) {
    notes.push('The student has confirmed from AD that the account is locked out.');
  }
  if (h.some((e) => /^search-adaccount\s+-lockedout/i.test(e.command) && e.ok && e.output.includes('True'))) {
    notes.push('The student has listed locked-out accounts in AD.');
  }
  const reset = h.filter((e) => /^set-adaccountpassword/i.test(e.command) && e.ok);
  const locked = v.ad.users.filter((u) => u.lockedOut);
  if (reset.length && locked.length) {
    notes.push('A password was reset but the account is still locked out: a reset does not clear a lockout.');
  }
  if (h.some((e) => /^(get-winevent|get-eventlog)/i.test(e.command) && /4740/.test(e.output))) {
    notes.push('The student found event 4740 (account lockout) and its caller computer.');
  }

  // Doing the same thing again and expecting a different result.
  const last = h.slice(-3);
  if (last.length === 3 && last.every((e) => !e.ok && e.command.toLowerCase() === last[0]!.command.toLowerCase())) {
    notes.push(`The student has run "${last[0]!.command}" three times with the same failure. Suggest changing approach and gathering information instead.`);
  }

  const client = internalNic(v.hosts.CLIENT01 as LabState['hosts']['CLIENT01']);
  if (client?.dnsStatic && client.dhcp && client.dns[0] !== DC) {
    notes.push('CLIENT01 is on DHCP for its address but has DNS servers typed in statically; static DNS overrides the DHCP option.');
  }
  return notes;
}

/** Commands that failed recently — "previous troubleshooting attempts". */
export function failedAttempts(v: InstructorView, n = 6): string[] {
  return v.history.filter((e) => !e.ok && e.outcomeKnown !== false).slice(-n).map((e) => `[${e.host}] ${e.command}`);
}
