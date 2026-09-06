/**
 * vm/environmentStage.ts — what state is this domain actually in?
 *
 * The ticket generator must not ask for work the environment cannot support. A
 * bare domain cannot have a locked-out user, because there is nobody to lock
 * out; a domain with no OUs cannot have someone moved between them. Asking
 * anyway produces the exact failure this whole project has been removing:
 * a ticket describing a world that is not there.
 *
 * So the generator is told the stage first, and only offered scenarios that
 * stage can support. The stages are chronological — a domain moves forward
 * through them as the administrator builds it out, and never backwards on its
 * own.
 */
import type { MockDirectory } from '@/services';
import type { VmServices } from './session';

export type Stage =
  /** Nothing but the built-in administrator. Build the OU structure. */
  | 'bare'
  /** OUs exist, but no groups yet. Define the group model. */
  | 'structured'
  /** OUs and groups exist, but nobody is in the directory. Provision staff. */
  | 'ready-to-staff'
  /** People exist. Day-to-day identity operations become possible. */
  | 'operating';

export interface EnvironmentState {
  stage: Stage;
  ouCount: number;
  groupCount: number;
  /** Accounts excluding the built-in administrator and service accounts. */
  staffCount: number;
  ouNames: string[];
  groupNames: string[];
  /** Staff logon names, for scenarios that must name a real person. */
  staffLogons: string[];
  lockedLogons: string[];
  disabledLogons: string[];
}

const BUILTIN_LOGONS = new Set(['admin']);
const isStaff = (username: string): boolean =>
  !BUILTIN_LOGONS.has(username) && !username.startsWith('svc-');

export function readEnvironment(dir: MockDirectory): EnvironmentState {
  const ous = dir.listOus();
  const groups = dir.listGroups();
  const staff = dir.listUsers().filter((u) => isStaff(u.username));

  const stage: Stage =
    ous.length === 0
      ? 'bare'
      : groups.length === 0
        ? 'structured'
        : staff.length === 0
          ? 'ready-to-staff'
          : 'operating';

  return {
    stage,
    ouCount: ous.length,
    groupCount: groups.length,
    staffCount: staff.length,
    ouNames: ous.map((o) => o.name),
    groupNames: groups.map((g) => g.name),
    staffLogons: staff.map((u) => u.username),
    lockedLogons: staff.filter((u) => u.status === 'locked').map((u) => u.username),
    disabledLogons: staff.filter((u) => u.status === 'disabled').map((u) => u.username),
  };
}

/** Human summary of the stage, shown at the top of the ticket queue. */
export const STAGE_SUMMARY: Record<Stage, { title: string; detail: string }> = {
  bare: {
    title: 'New domain — no structure yet',
    detail:
      'The domain has just been promoted. Build the organisational unit structure before ' +
      'anything else: where accounts live decides how policy and delegation apply to them.',
  },
  structured: {
    title: 'Structure in place — no groups yet',
    detail:
      'Organisational units exist. Define the security groups next: access is granted to ' +
      'groups, not to people, or every leaver becomes an archaeology exercise.',
  },
  'ready-to-staff': {
    title: 'Ready to provision — no staff yet',
    detail:
      'The structure and group model are in place. Provision the staff into the right OUs ' +
      'and groups, then confirm each account can actually sign in.',
  },
  operating: {
    title: 'Operating — day-to-day identity work',
    detail:
      'The domain has people in it, so the ordinary work begins: lockouts, joiners, movers, ' +
      'leavers, access requests and the investigations that follow them.',
  },
};

/** The environment as a short brief for the ticket generator's prompt. */
export function describeForPrompt(env: EnvironmentState): string {
  const lines = [
    `Stage: ${env.stage}`,
    `Organisational units (${env.ouCount}): ${env.ouNames.join(', ') || 'none'}`,
    `Security groups (${env.groupCount}): ${env.groupNames.join(', ') || 'none'}`,
    `Staff accounts (${env.staffCount}): ${env.staffLogons.join(', ') || 'none'}`,
  ];
  if (env.lockedLogons.length) lines.push(`Locked out: ${env.lockedLogons.join(', ')}`);
  if (env.disabledLogons.length) lines.push(`Disabled: ${env.disabledLogons.join(', ')}`);
  return lines.join('\n');
}

/** Convenience for callers that hold the whole service bundle. */
export function stageOf(services: VmServices): Stage {
  return readEnvironment(services.dir).stage;
}
