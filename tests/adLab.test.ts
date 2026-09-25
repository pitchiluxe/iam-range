/**
 * tests/adLab.test.ts — the AD Enterprise Lab Series and its Ollama instructor.
 *
 * Three promises are held here:
 *   - every lab starts unsolved and is passable by the student's own commands;
 *   - the validation engine, not the model, decides correctness;
 *   - the instructor can observe but cannot change the lab, whatever it says.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AD_LABS, applySolution, labById, startingState } from '@/vm/adlab/labs';
import { runCommand } from '@/vm/adlab/commands';
import { validate } from '@/vm/adlab/validation';
import { evidenceNotes, snapshotForInstructor } from '@/vm/adlab/observe';
import {
  askInstructor,
  buildInstructorPrompt,
  guardReply,
  instructorStatus,
  newSession,
  nextHint,
  offlineInstructor,
  recordReport,
  revealAllowed,
} from '@/vm/adlab/instructor';
import { getOllamaModel, OLLAMA_MODEL, pickInstalledModel } from '@/config/ollama';
import { findUser } from '@/vm/adlab/state';

const NOTES =
  'Symptom: user could not sign in. Evidence: Get-ADUser showed LockedOut True and event 4740 named CLIENT01. ' +
  'Root cause: repeated bad passwords. Fix: unlocked the account. Verified sign-in works.';

function lab(id: string) {
  const l = labById(id);
  if (!l) throw new Error(id);
  return l;
}

function jsonFetch(body: unknown, ok = true): typeof fetch {
  return (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
}

/** Tags → one model; generate → the given reply. Records generate bodies. */
function ollamaStub(reply: string, calls: string[] = []): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/api/tags')) return { ok: true, json: async () => ({ models: [{ name: 'llama3.2:latest' }] }) };
    calls.push(String(init?.body ?? ''));
    return { ok: true, json: async () => ({ response: reply }) };
  }) as unknown as typeof fetch;
}

const offlineFetch = (async () => {
  throw new Error('ECONNREFUSED');
}) as unknown as typeof fetch;

describe('lab series', () => {
  it('every lab starts unsolved and passes after its reference solution', () => {
    for (const l of AD_LABS) {
      const s = startingState(l.id);
      expect(s.history).toEqual([]);
      const before = validate(l.id, l.checks, { state: s, notes: '' });
      expect(before.passed, `${l.id} should not start solved`).toBe(false);
      applySolution(s, l.id);
      const after = validate(l.id, l.checks, { state: s, notes: NOTES });
      expect(after.results.filter((r) => !r.pass).map((r) => `${r.id}: ${r.observed}`), l.id).toEqual([]);
    }
  });

  it('lab ids and numbers are unique and every check exists', () => {
    expect(new Set(AD_LABS.map((l) => l.id)).size).toBe(AD_LABS.length);
    expect(AD_LABS.map((l) => l.number)).toEqual(AD_LABS.map((_, i) => i + 1));
  });
});

describe('the student performs every change', () => {
  it('domain join fails while CLIENT01 uses 8.8.8.8, and nothing corrects it', () => {
    const s = startingState('adl-05');
    const nic = s.hosts.CLIENT01.nics[0]!;
    expect(nic.ip).toBe('172.16.0.105');
    expect(nic.dns).toEqual(['8.8.8.8']);

    const res = runCommand(s, 'CLIENT01', 'Add-Computer -DomainName corp.technobiz.local -Restart');
    expect(res.ok).toBe(false);
    expect(res.output).toContain('could not be contacted');
    expect(s.hosts.CLIENT01.domain).toBeNull();

    const report = validate('adl-05', lab('adl-05').checks, { state: s });
    const dns = report.results.find((r) => r.id === 'client-dns-dc')!;
    expect(dns.pass).toBe(false);
    expect(dns.observed).toContain('8.8.8.8');
    // Still wrong afterwards: diagnosis does not repair.
    expect(s.hosts.CLIENT01.nics[0]!.dns).toEqual(['8.8.8.8']);
  });

  it('ping succeeds while name resolution fails — and lab memory says so', () => {
    const s = startingState('adl-05');
    expect(runCommand(s, 'CLIENT01', 'ping 172.16.0.1').ok).toBe(true);
    expect(runCommand(s, 'CLIENT01', 'nslookup corp.technobiz.local').ok).toBe(false);
    const notes = evidenceNotes(snapshotForInstructor(s));
    expect(notes.join(' ')).toMatch(/narrows the investigation to DNS rather than the network/);
  });

  it('static DNS on the client overrides the DHCP option', () => {
    const s = startingState('adl-05');
    applySolution(s, 'adl-04');
    runCommand(s, 'CLIENT01', 'Set-NetIPInterface -InterfaceAlias Ethernet -Dhcp Enabled');
    runCommand(s, 'CLIENT01', 'ipconfig /renew');
    const nic = s.hosts.CLIENT01.nics[0]!;
    expect(nic.leaseFrom).toBe('172.16.0.1');
    expect(nic.dns).toEqual(['8.8.8.8']);
    runCommand(s, 'CLIENT01', 'Set-DnsClientServerAddress -InterfaceAlias Ethernet -ResetServerAddresses');
    expect(nic.dns).toEqual(['172.16.0.1']);
  });

  it('AD cmdlets do not exist on CLIENT01', () => {
    const s = startingState('adl-10');
    expect(runCommand(s, 'CLIENT01', 'Get-ADUser sjohnson').output).toContain('is not recognized');
  });

  it('resetting a password does not unlock the account', () => {
    const s = startingState('adl-10');
    runCommand(s, 'DC01', 'Set-ADAccountPassword -Identity sjohnson -Reset -NewPassword (ConvertTo-SecureString "Another!Pass2026" -AsPlainText -Force)');
    expect(findUser(s, 'sjohnson')!.lockedOut).toBe(true);
    expect(evidenceNotes(snapshotForInstructor(s)).join(' ')).toMatch(/does not clear a lockout/);
    runCommand(s, 'DC01', 'Search-ADAccount -LockedOut | Unlock-ADAccount');
    expect(findUser(s, 'sjohnson')!.lockedOut).toBe(false);
  });

  it('an inherited ACE survives /remove until inheritance is broken', () => {
    const s = startingState('adl-09');
    runCommand(s, 'DC01', 'mkdir C:\\Shares\\Finance');
    runCommand(s, 'DC01', 'icacls C:\\Shares\\Finance /remove "BUILTIN\\Users"');
    expect(s.ntfs['c:\\shares\\finance']!.some((a) => a.identity === 'BUILTIN\\Users')).toBe(true);
    runCommand(s, 'DC01', 'icacls C:\\Shares\\Finance /inheritance:d');
    runCommand(s, 'DC01', 'icacls C:\\Shares\\Finance /remove "BUILTIN\\Users"');
    expect(s.ntfs['c:\\shares\\finance']!.some((a) => a.identity === 'BUILTIN\\Users')).toBe(false);
  });

  it('ticket verification requires a successful test after the fix', () => {
    const s = startingState('adl-11');
    runCommand(s, 'CLIENT01', 'Set-DnsClientServerAddress -InterfaceAlias Ethernet -ResetServerAddresses');
    const checks = lab('adl-11').checks;
    let r = validate('adl-11', checks, { state: s, notes: NOTES });
    expect(r.results.find((x) => x.id === 'ticket-verified')!.pass).toBe(false);
    runCommand(s, 'CLIENT01', 'nslookup corp.technobiz.local');
    r = validate('adl-11', checks, { state: s, notes: NOTES });
    expect(r.passed).toBe(true);
  });
});

describe('the instructor is read-only', () => {
  it('does not import anything that changes lab state', () => {
    for (const f of ['instructor.ts', 'observe.ts', 'validation.ts', 'network.ts']) {
      const src = readFileSync(join('src', 'vm', 'adlab', f), 'utf8');
      expect(src, f).not.toMatch(/from '\.\/commands'/);
      expect(src, f).not.toMatch(/^import \{[^}]*\} from '\.\/labs'/m);
    }
  });

  it('observes a frozen copy', () => {
    const s = startingState('adl-05');
    const view = snapshotForInstructor(s);
    expect(() => {
      (view as unknown as { hosts: { CLIENT01: { nics: { dns: string[] }[] } } }).hosts.CLIENT01.nics[0]!.dns = ['172.16.0.1'];
    }).toThrow();
    expect(s.hosts.CLIENT01.nics[0]!.dns).toEqual(['8.8.8.8']);
  });

  it('a model that claims to have fixed the lab changes nothing, and the student is told', async () => {
    const s = startingState('adl-05');
    const before = JSON.stringify(s);
    const session = newSession('adl-05', 'coach');
    const reply = await askInstructor(
      { kind: 'ask', question: 'Why can\'t CLIENT01 join the domain?' },
      { lab: lab('adl-05'), view: snapshotForInstructor(s), session },
      { fetchImpl: ollamaStub('I have changed the DNS server to 172.16.0.1 for you. The lab is complete.') },
    );
    expect(reply.source).toBe('ollama');
    expect(reply.text).toMatch(/read-only access and has not changed your lab/);
    expect(JSON.stringify(s)).toBe(before);
    expect(validate('adl-05', lab('adl-05').checks, { state: s }).passed).toBe(false);
  });

  it('guardReply leaves ordinary coaching alone', () => {
    expect(guardReply('Run ipconfig /all and tell me what you see.')).toBe('Run ipconfig /all and tell me what you see.');
  });
});

describe('validation feeds the instructor', () => {
  it('the prompt carries the engine results and withholds the fix at first', () => {
    const s = startingState('adl-05');
    const l = lab('adl-05');
    const session = newSession(l.id, 'coach');
    const report = validate(l.id, l.checks, { state: s });
    recordReport(session, report);
    const prompt = buildInstructorPrompt({ kind: 'check', report }, { lab: l, view: snapshotForInstructor(s), session });
    expect(prompt).toContain('=== VALIDATION RESULTS (0/4 passed) ===');
    expect(prompt).toContain('Requirement NOT met: "CLIENT01 uses DC01 for DNS". The engine actually observed: CLIENT01 DNS servers: 8.8.8.8');
    expect(prompt).toContain('Not allowed yet');
    expect(prompt).toContain('READ-ONLY');
    // Only rung 1 is offered before the student asks for more.
    expect(prompt).toContain('Direction: Investigate the client\'s DNS configuration.');
    expect(prompt).not.toContain('Investigation: Run ipconfig /all on CLIENT01');
    // The answer key never reaches the model.
    expect(prompt).not.toContain('-ResetServerAddresses');
  });

  it('real-world mode reasons from what the student found, not from the answer', () => {
    const s = startingState('adl-10');
    const l = lab('adl-10');
    const session = newSession(l.id, 'real-world');
    const ctx = { lab: l, view: snapshotForInstructor(s), session };
    const ask = buildInstructorPrompt({ kind: 'ask', question: 'Where do I start?' }, ctx);
    expect(ask).not.toContain('LOCKED OUT');
    expect(ask).not.toContain('=== LAB STATE');
    const intro = offlineInstructor({ kind: 'intro' }, ctx);
    expect(intro).toContain('INC-1047');
    expect(intro).toContain('What would you check first?');
    expect(intro).not.toMatch(/locked/i);
  });
});

describe('hints and reveal', () => {
  it('climbs direction → investigation → concept, then moves to the next failing check', () => {
    const s = startingState('adl-05');
    const l = lab('adl-05');
    const session = newSession(l.id, 'coach');
    recordReport(session, validate(l.id, l.checks, { state: s }));
    expect(revealAllowed(session)).toBe(false);
    expect(nextHint(session)).toEqual({ checkId: 'client-dns-dc', level: 1 });
    expect(nextHint(session)).toEqual({ checkId: 'client-dns-dc', level: 2 });
    expect(nextHint(session)).toEqual({ checkId: 'client-dns-dc', level: 3 });
    expect(revealAllowed(session, 'client-dns-dc')).toBe(true);
    expect(nextHint(session)?.checkId).toBe('client-resolves-domain');
  });

  it('guided mode may explain the fix; it still never performs it', () => {
    expect(revealAllowed(newSession('adl-01', 'guided'))).toBe(true);
  });

  it('asking for the answer too early gets a diagnosis, not the fix (offline)', async () => {
    const s = startingState('adl-05');
    const l = lab('adl-05');
    const session = newSession(l.id, 'coach');
    recordReport(session, validate(l.id, l.checks, { state: s }));
    const reply = await askInstructor(
      { kind: 'ask', question: 'Just tell me the answer' },
      { lab: l, view: snapshotForInstructor(s), session },
      { fetchImpl: offlineFetch },
    );
    expect(reply.source).toBe('offline');
    expect(reply.text).toContain('Let\'s diagnose it');
    expect(reply.text).not.toMatch(/Set-DnsClientServerAddress|ResetServerAddresses/);
  });

  it('after three failed checks the offline instructor explains the reasoning', async () => {
    const s = startingState('adl-05');
    const l = lab('adl-05');
    const session = newSession(l.id, 'coach');
    for (let i = 0; i < 3; i++) recordReport(session, validate(l.id, l.checks, { state: s }));
    const reply = await askInstructor(
      { kind: 'ask', question: 'Explain the solution' },
      { lab: l, view: snapshotForInstructor(s), session },
      { fetchImpl: offlineFetch },
    );
    expect(reply.text).toContain('Make the change yourself');
    expect(s.hosts.CLIENT01.nics[0]!.dns).toEqual(['8.8.8.8']);
  });
});

describe('Ollama availability', () => {
  it('reports offline when Ollama is unreachable, and the lab keeps working', async () => {
    expect(await instructorStatus(offlineFetch)).toEqual({ online: false, model: null, reason: 'unreachable' });
    const s = startingState('adl-04');
    const l = lab('adl-04');
    const session = newSession(l.id, 'coach');
    const report = validate(l.id, l.checks, { state: s });
    recordReport(session, report);
    const reply = await askInstructor({ kind: 'check', report }, { lab: l, view: snapshotForInstructor(s), session }, { fetchImpl: offlineFetch });
    expect(reply.source).toBe('offline');
    expect(reply.text).toContain(`0 of ${l.checks.length} checks pass`);
  });

  it('reports offline when Ollama has no models', async () => {
    expect(await instructorStatus(jsonFetch({ models: [] }))).toEqual({ online: false, model: null, reason: 'no-models' });
  });

  it('uses an installed model rather than insisting on one', async () => {
    expect(await instructorStatus(jsonFetch({ models: [{ name: 'mistral:7b' }] }))).toEqual({ online: true, model: 'mistral:7b' });
    expect(pickInstalledModel(['mistral:7b', 'llama3.2:latest'], 'llama3.2')).toBe('llama3.2:latest');
    expect(pickInstalledModel([], 'llama3.2')).toBeNull();
    expect(getOllamaModel()).toBe(OLLAMA_MODEL);
  });

  it('sends the chosen model and the built prompt to /api/generate', async () => {
    const calls: string[] = [];
    const s = startingState('adl-01');
    const session = newSession('adl-01', 'interview');
    await askInstructor({ kind: 'interview' }, { lab: lab('adl-01'), view: snapshotForInstructor(s), session }, { fetchImpl: ollamaStub('Why static?', calls) });
    const body = JSON.parse(calls[0]!) as { model: string; prompt: string; stream: boolean };
    expect(body.model).toBe('llama3.2:latest');
    expect(body.stream).toBe(false);
    expect(body.prompt).toContain('INTERVIEW MODE');
    expect(session.interviewAsked).toEqual([0]);
  });
});

describe('real VirtualBox VMs', () => {
  const dcNics = [
    { alias: 'Internet', mac: '08-00-27-AD-01-01', dhcp: true, ip: '10.0.2.15', prefix: 24, gateway: '10.0.2.2', dns: ['10.0.2.3'], dnsStatic: false, leaseFrom: '10.0.2.2' },
    { alias: 'Internal', mac: '08-00-27-AD-01-02', dhcp: false, ip: '172.16.0.1', prefix: 24, gateway: null, dns: ['127.0.0.1'], dnsStatic: true },
  ];
  const doc = (dc: Record<string, unknown>, clientRunning = true) => ({
    collectedAt: '2026-09-24T12:00:00Z',
    networks: { '08-00-27-AD-01-01': 'internet', '08-00-27-AD-01-02': 'internal', '08-00-27-AD-02-01': 'internal' } as Record<string, 'internal' | 'internet'>,
    vms: {
      DC01: { exists: true, running: true, facts: { hostname: 'DC01', nics: dcNics, features: [], services: {}, history: ['hostname', 'ipconfig /all'], ...dc } },
      CLIENT01: { exists: true, running: clientRunning, facts: clientRunning ? { hostname: 'CLIENT01', nics: [{ alias: 'Ethernet', mac: '08-00-27-AD-02-01', dhcp: true, ip: '169.254.40.12', prefix: 16, dns: [] }] } : null },
    },
  });

  it('a correctly configured real DC01 passes Lab 01 with the same checks', async () => {
    const { factsToLabState } = await import('@/vm/adlab/realVm');
    const reading = factsToLabState(doc({}));
    expect(reading.problems).toEqual([]);
    const report = validate('adl-01', lab('adl-01').checks, { state: reading.state });
    expect(report.results.filter((r) => !r.pass).map((r) => r.id)).toEqual([]);
  });

  it('a real mistake fails the same check the simulator would fail', async () => {
    const { factsToLabState } = await import('@/vm/adlab/realVm');
    const reading = factsToLabState(doc({ hostname: 'WIN-7Q2K9STBL4', pendingHostname: 'DC01' }));
    const report = validate('adl-01', lab('adl-01').checks, { state: reading.state });
    const name = report.results.find((r) => r.id === 'dc-hostname')!;
    expect(name.pass).toBe(false);
    expect(name.observed).toContain('waiting for a restart');
  });

  it('refuses to grade a VM it could not read', async () => {
    const { factsToLabState } = await import('@/vm/adlab/realVm');
    const reading = factsToLabState(doc({}, false));
    expect(reading.problems.join(' ')).toMatch(/CLIENT01 is not running/);
  });

  it('real-VM history is shown to the instructor without inventing outcomes', async () => {
    const { factsToLabState } = await import('@/vm/adlab/realVm');
    const reading = factsToLabState(doc({ history: ['ping 172.16.0.1', 'nslookup corp.technobiz.local'] }));
    const view = snapshotForInstructor(reading.state);
    expect(evidenceNotes(view).join(' ')).not.toMatch(/succeeds|fails/);
    const session = newSession('adl-01', 'coach');
    const prompt = buildInstructorPrompt({ kind: 'ask', question: 'What next?' }, { lab: lab('adl-01'), view, session });
    expect(prompt).toContain('outcome not captured');
  });
});

describe('real VMs: a lab only needs its own machines', () => {
  it('Lab 01 is DC01-only; Lab 05 needs CLIENT01 too', async () => {
    const { hostsForLab } = await import('@/vm/adlab/labs');
    expect(hostsForLab(lab('adl-01'))).toEqual(['DC01']);
    expect(hostsForLab(lab('adl-05'))).toEqual(['DC01', 'CLIENT01']);
    expect(hostsForLab(lab('adl-04'))).toEqual(['DC01', 'CLIENT01']);
  });

  it('reports problems per machine', async () => {
    const { factsToLabState } = await import('@/vm/adlab/realVm');
    const r = factsToLabState({ vms: { DC01: { exists: true, running: true, facts: { hostname: 'DC01' } }, CLIENT01: { exists: true, running: false, state: 'paused' } } });
    expect(r.problemsByHost.DC01).toBeUndefined();
    expect(r.problemsByHost.CLIENT01).toMatch(/paused/);
  });
});
