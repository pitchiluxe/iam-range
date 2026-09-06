/**
 * util/auditLabels.ts — turn audit-event ids into something a human can read.
 *
 * Audit events carry branded ids (`greta.olsen-OxcdL_`, `grp-finance-payroll`),
 * which is right for matching but poor for a log the learner is meant to
 * investigate. This resolves an id against the directory and falls back to the
 * raw value when it belongs to something else (a ticket, a session, an app).
 */
import type { MockDirectory } from '@/services';

/**
 * Best available label for an audit target/actor/subject id.
 *
 * @returns the username, group name or role name; otherwise the id unchanged,
 *   so nothing is ever silently hidden from the log.
 */
export function describeAuditId(id: string | undefined, dir: MockDirectory | undefined): string {
  if (!id) return '';
  if (!dir) return id;

  const user = dir.getUser(id as never);
  if (user) return user.username;

  const group = dir.getGroup(id as never);
  if (group) return group.name;

  const role = dir.getRole(id as never);
  if (role) return role.name;

  return id;
}
