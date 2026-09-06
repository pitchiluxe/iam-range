/**
 * domain/ids.ts — branded ID constructors.
 * Using the brand pattern prevents mixing e.g. UserId with TicketId at compile time.
 */
import type {
  UserId,
  GroupId,
  RoleId,
  AppId,
  TicketId,
  AuditId,
  IncidentId,
  ReviewId,
  LabId,
  EvidenceId,
  SessionId,
} from './types';
import { nanoid } from 'nanoid';

/** Create a UserId branded string. */
export function mkUserId(raw?: string): UserId {
  return (raw ?? nanoid(12)) as UserId;
}

/** Create a GroupId branded string. */
export function mkGroupId(raw?: string): GroupId {
  return (raw ?? nanoid(10)) as GroupId;
}

/** Create a RoleId branded string. */
export function mkRoleId(raw?: string): RoleId {
  return (raw ?? nanoid(10)) as RoleId;
}

/** Create an AppId branded string. */
export function mkAppId(raw?: string): AppId {
  return (raw ?? nanoid(10)) as AppId;
}

/** Create a TicketId branded string. */
export function mkTicketId(raw?: string): TicketId {
  return (raw ?? nanoid(10)) as TicketId;
}

/** Create an AuditId branded string. */
export function mkAuditId(raw?: string): AuditId {
  return (raw ?? nanoid(10)) as AuditId;
}

/** Create an IncidentId branded string. */
export function mkIncidentId(raw?: string): IncidentId {
  return (raw ?? nanoid(10)) as IncidentId;
}

/** Create a ReviewId branded string. */
export function mkReviewId(raw?: string): ReviewId {
  return (raw ?? nanoid(10)) as ReviewId;
}

/** Create a LabId branded string. */
export function mkLabId(raw?: string): LabId {
  return (raw ?? nanoid(10)) as LabId;
}

/** Create an EvidenceId branded string. */
export function mkEvidenceId(raw?: string): EvidenceId {
  return (raw ?? nanoid(10)) as EvidenceId;
}

/** Create a SessionId branded string. */
export function mkSessionId(raw?: string): SessionId {
  return (raw ?? nanoid(16)) as SessionId;
}

/** Well-known system actor ID for fault injections. */
export const SYSTEM_ACTOR: UserId = 'system' as UserId;
