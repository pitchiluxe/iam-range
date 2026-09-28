/**
 * vm/sessionStore.ts — the VM's work survives closing the app.
 *
 * Everything a learner does lives in the session's services: the accounts,
 * OUs and groups they built, the ticket queue and where each ticket stands,
 * the audit trail, PIM, the cloud tenants and the users' computers. Saving
 * only the tickets would bring back tickets about people who no longer exist,
 * so the whole environment is saved, and restored as one piece.
 *
 * The services are plain data (Maps, arrays, records) plus references to each
 * other. The references are rebuilt by constructing fresh services; only each
 * service's own data is written out, and written back over the fresh copy.
 * A field a newer version adds keeps its default when an older save is loaded.
 */
import type { VmServices } from './session';

/** Bump when a change makes older saves unreadable; they are then ignored. */
export const SESSION_SAVE_VERSION = 1;
export const SESSION_SAVE_KEY = 'iamrange.vmSession';

/** Audit history kept in a save. The trail grows forever; a save must not. */
const AUDIT_KEEP = 4000;

type Encoded = unknown;

class NotPersistable extends Error {}

function encode(value: unknown, skip: ReadonlySet<unknown>): Encoded {
  if (value === null || value === undefined) return value;
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (typeof value !== 'object') return value;
  if (skip.has(value)) return undefined;
  if (value instanceof Map) return { __t: 'Map', v: [...value].map(([k, x]) => [encode(k, skip), encode(x, skip)]) };
  if (value instanceof Set) return { __t: 'Set', v: [...value].map((x) => encode(x, skip)) };
  if (value instanceof Date) return { __t: 'Date', v: value.getTime() };
  if (Array.isArray(value)) return value.map((x) => encode(x, skip));
  const proto = Object.getPrototypeOf(value) as object | null;
  if (proto !== Object.prototype && proto !== null) {
    throw new NotPersistable(`cannot save a ${(proto as { constructor?: { name?: string } }).constructor?.name ?? 'object'}`);
  }
  const out: Record<string, Encoded> = {};
  for (const [k, x] of Object.entries(value)) {
    const e = encode(x, skip);
    if (e !== undefined) out[k] = e;
  }
  return out;
}

function decode(value: Encoded): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(decode);
  const v = value as { __t?: string; v?: unknown };
  if (v.__t === 'Map') return new Map((v.v as [Encoded, Encoded][]).map(([k, x]) => [decode(k), decode(x)]));
  if (v.__t === 'Set') return new Set((v.v as Encoded[]).map(decode));
  if (v.__t === 'Date') return new Date(v.v as number);
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(value)) out[k] = decode(x);
  return out;
}

/** The services that are saved, by name. */
function servicesOf(s: VmServices): Record<string, object> {
  return {
    dir: s.dir, idp: s.idp, apps: s.apps, tickets: s.tickets, audit: s.audit,
    reviews: s.reviews, incidents: s.incidents, pim: s.pim, endpoints: s.endpoints,
    'cloud.okta': s.cloud.okta, 'cloud.entra': s.cloud.entra,
  };
}

/** Everything one service holds, minus its references to other services. */
function ownData(service: object, skip: ReadonlySet<unknown>): Record<string, Encoded> {
  const out: Record<string, Encoded> = {};
  for (const [k, x] of Object.entries(service)) {
    const e = encode(x, skip);
    if (e !== undefined) out[k] = e;
  }
  return out;
}

/** The whole environment as a string. Throws if something cannot be saved. */
export function serializeSession(s: VmServices, now = Date.now()): string {
  const services = servicesOf(s);
  // Other services, and the audit log's event bus, are wiring: rebuilt on load.
  const skip = new Set<unknown>([...Object.values(services), s.cloud, s.audit.bus]);
  const data: Record<string, Record<string, Encoded>> = {};
  for (const [name, svc] of Object.entries(services)) data[name] = ownData(svc, skip);
  const events = data.audit?.events;
  if (Array.isArray(events) && events.length > AUDIT_KEEP) data.audit!.events = events.slice(-AUDIT_KEEP);
  return JSON.stringify({ version: SESSION_SAVE_VERSION, savedAt: now, data });
}

/**
 * Write a saved environment over freshly constructed services.
 * Returns false, changing nothing, when the save is unreadable or from an
 * incompatible version.
 */
export function restoreSession(s: VmServices, json: string): boolean {
  let parsed: { version?: number; data?: Record<string, Record<string, Encoded>> };
  try {
    parsed = JSON.parse(json) as typeof parsed;
  } catch {
    return false;
  }
  if (parsed?.version !== SESSION_SAVE_VERSION || !parsed.data) return false;
  const services = servicesOf(s);
  // Decode everything first, so a bad save cannot leave half an environment.
  const decoded: [object, Record<string, unknown>][] = [];
  try {
    for (const [name, svc] of Object.entries(services)) {
      const saved = parsed.data[name];
      if (!saved || typeof saved !== 'object') return false;
      decoded.push([svc, decode(saved) as Record<string, unknown>]);
    }
  } catch {
    return false;
  }
  for (const [svc, fields] of decoded) {
    for (const [k, v] of Object.entries(fields)) {
      // Only fields the current code still has, and never over wiring.
      if (!(k in svc)) continue;
      const current = (svc as Record<string, unknown>)[k];
      if (typeof current === 'function') continue;
      (svc as Record<string, unknown>)[k] = v;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Browser storage. localStorage in the desktop app lives in the user's profile
// and survives restarts and updates. Every access is guarded: a private
// window, a full disk or a test run without storage must never break the VM.
// ---------------------------------------------------------------------------

export function loadSavedSession(): string | null {
  try {
    return globalThis.localStorage?.getItem(SESSION_SAVE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeSavedSession(json: string): boolean {
  try {
    if (!globalThis.localStorage) return false;
    globalThis.localStorage.setItem(SESSION_SAVE_KEY, json);
    return true;
  } catch {
    return false;
  }
}

export function clearSavedSession(): void {
  try {
    globalThis.localStorage?.removeItem(SESSION_SAVE_KEY);
  } catch {
    /* nothing saved, nothing to clear */
  }
}
