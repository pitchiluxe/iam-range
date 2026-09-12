/**
 * vm/labProgress.ts — which lessons have actually been done.
 *
 * The manual's four chapters and fifteen lessons are the curriculum. Nothing
 * recorded whether any of them had been completed, so a learner could work
 * through the whole thing with no idea what was left — and, more to the point,
 * no evidence they had done any of it.
 *
 * The obvious implementation is a checklist you tick. That is exactly the
 * mistake this project just removed from the ticket queue, where marking a
 * ticket resolved was a claim nobody checked, and a learner could close the
 * entire queue having done nothing. A self-ticked curriculum would teach the
 * same habit one level up.
 *
 * So completion is derived, never asserted. Each lesson is a predicate over
 * the directory, the audit log, the PIM service and the cloud tenants: the
 * same evidence a real assessor would ask for. You cannot mark "Offboard
 * somebody" complete; you complete it by offboarding somebody, and this
 * notices.
 *
 * Three states, because two is not enough to be useful. "Not started" and
 * "done" leaves a learner who is half way through a long lesson looking at the
 * same thing as one who has not opened it.
 */
import { MANUAL } from '@/config/manual';
import type { Chapter, Lesson } from '@/config/manual';
import type { VmServices } from './session';
import { assessPosture, breakGlassAccounts, drillStatus } from './breakGlass';
import { FS } from '@/terminal/shellIntrinsics';

/**
 * Has an evidence pack been written?
 *
 * Read from the workstation's own disk rather than from a flag, for the same
 * reason every other rule here reads the estate: the lesson is producing the
 * artifact, so the artifact is the evidence.
 */
function evidencePackExists(): boolean {
  try {
    // list() returns null when the folder does not exist, which is an
    // ordinary state on a workstation nobody has saved anything on yet.
    const entries = FS.list('C:\\Users\\admin\\Documents') ?? [];
    return entries.some((entry) => /^iam-range-evidence-.*\.md$/i.test(entry.name));
  } catch {
    // No such folder yet, which means no pack.
    return false;
  }
}

function writerEvidenceExists(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    const raw = localStorage.getItem('writer_documents');
    if (!raw) return false;
    const docs = JSON.parse(raw) as { title: string; html: string }[];
    return Array.isArray(docs) && docs.length >= 3;
  } catch {
    return false;
  }
}

export type LessonState = 'not-started' | 'in-progress' | 'done';

export interface LessonProgress {
  lesson: Lesson;
  chapterId: string;
  state: LessonState;
  /** What was found, in the learner's language. Shown as the evidence column. */
  evidence: string;
  /** What is still missing, when the lesson is not finished. */
  outstanding: string;
  /** Audit actions whose entries prove this lesson's work. */
  actions: readonly string[];
}

export interface ChapterProgress {
  chapter: Chapter;
  lessons: LessonProgress[];
  /** Whole percent, rounded. A part-finished lesson counts as half. */
  percent: number;
}

export interface Progress {
  chapters: ChapterProgress[];
  percent: number;
  done: number;
  total: number;
}

/**
 * One lesson's rule.
 *
 * `done` is the finished state; `started` is evidence of work under way. A
 * lesson with no meaningful partial state leaves `started` undefined and is
 * simply not started until it is done.
 */
interface Rule {
  done: (s: VmServices) => boolean;
  started?: (s: VmServices) => boolean;
  /** Describes what was found when done, and what is missing when not. */
  evidence: (s: VmServices) => string;
  outstanding: string;
  /**
   * The audit actions this lesson's work leaves behind.
   *
   * The evidence pack quotes the matching log entries under each completed
   * task. A pack that says "complete" and nothing else is an assertion, which
   * is the one thing this product refuses to accept anywhere else.
   */
  actions: readonly string[];
}

const has = (s: VmServices, action: string): boolean =>
  s.audit.byAction(action).length > 0;

const count = (s: VmServices, action: string): number => s.audit.byAction(action).length;

/** Accounts that are not the built-in administrator or a service account. */
function staff(s: VmServices) {
  return s.dir
    .listUsers()
    .filter((u) => u.username !== 'admin' && !u.username.startsWith('svc-'));
}

function anyTenant(s: VmServices) {
  return s.cloud?.okta ?? s.cloud?.entra ?? null;
}

/**
 * The rules, by lesson id.
 *
 * Keyed by the manual's own ids. A lesson with no rule here would silently
 * never complete, so the drift guard in the tests walks MANUAL and requires
 * one for every lesson — the same shape of guard the capability registry uses.
 */
const RULES: Record<string, Rule> = {
  // --- 1. The directory ---
  survey: {
    // Reading is the lesson. Running any query at all is the evidence, and
    // the terminal records what was asked.
    done: (s) => s.dir.listOus().length > 0 || staff(s).length > 0 || has(s, 'signin.success'),
    evidence: (s) =>
      `${s.dir.listUsers().length} accounts, ${s.dir.listGroups().length} groups, ` +
      `${s.dir.listOus().length} OUs on ${s.dir.listUsers().length > 0 ? 'a live domain' : 'a bare domain'}.`,
    outstanding: 'Sign in and look at what the domain already contains.',
    actions: ['signin.success'],
  },
  'ou-structure': {
    done: (s) => s.dir.listOus().length >= 2,
    started: (s) => s.dir.listOus().length >= 1,
    evidence: (s) =>
      s.dir.listOus().length === 0
        ? 'No organisational units exist.'
        : `${s.dir.listOus().length} OU(s): ${s.dir.listOus().map((o) => o.name).join(', ')}.`,
    outstanding: 'Build at least a parent OU and one beneath it.',
    actions: ['ou.created'],
  },
  'group-model': {
    done: (s) => s.dir.listGroups().length >= 3,
    started: (s) => s.dir.listGroups().length >= 1,
    evidence: (s) =>
      s.dir.listGroups().length === 0
        ? 'No security groups exist.'
        : `${s.dir.listGroups().length} group(s) defined.`,
    outstanding: 'Define at least three security groups for the roles people hold.',
    actions: ['group.created'],
  },

  // --- 2. Joiner, mover, leaver ---
  joiner: {
    // An account is not onboarded until it has access and a place. The same
    // standard the onboarding ticket review applies.
    done: (s) =>
      staff(s).some(
        (u) => u.status === 'active' && u.ouId !== undefined &&
          s.dir.listGroups().some((g) => g.memberIds.includes(u.id)),
      ),
    started: (s) => staff(s).length > 0,
    evidence: (s) => {
      const full = staff(s).filter(
        (u) => u.status === 'active' && u.ouId !== undefined &&
          s.dir.listGroups().some((g) => g.memberIds.includes(u.id)),
      );
      return full.length > 0
        ? `${full.length} account(s) enabled, grouped and placed in an OU.`
        : `${staff(s).length} staff account(s), none fully provisioned.`;
    },
    outstanding: 'Create an account, put it in a group, and place it in an OU.',
    actions: ['user.created', 'group.add', 'user.moved'],
  },
  mover: {
    done: (s) => has(s, 'user.moved') && has(s, 'group.remove') && has(s, 'group.add'),
    started: (s) => has(s, 'user.moved') || has(s, 'group.remove'),
    evidence: (s) =>
      `${count(s, 'user.moved')} move(s), ${count(s, 'group.add')} grant(s), ` +
      `${count(s, 'group.remove')} removal(s) recorded.`,
    outstanding:
      'Move an account and swap its access — both halves. Adding without removing is how privilege accumulates.',
    actions: ['user.moved', 'group.add', 'group.remove'],
  },
  leaver: {
    done: (s) => {
      const disabled = staff(s).some((u) => u.status === 'disabled');
      const tenant = anyTenant(s);
      if (!tenant) return disabled;
      // Offboarding stops where deprovisioning stops, so the tenant side counts.
      return disabled && has(s, 'cloud.session.revoked');
    },
    started: (s) => staff(s).some((u) => u.status === 'disabled'),
    evidence: (s) => {
      const disabled = staff(s).filter((u) => u.status === 'disabled').length;
      return disabled === 0
        ? 'No account has been disabled.'
        : `${disabled} disabled on premises, ${count(s, 'cloud.session.revoked')} session revocation(s).`;
    },
    outstanding:
      'Disable the account and close every other route — the tenant, the sessions, the applications.',
    actions: ['user.disabled', 'cloud.user.disabled', 'cloud.session.revoked', 'session.revoked'],
  },
  lockout: {
    done: (s) => has(s, 'account.unlock'),
    started: (s) => staff(s).some((u) => u.status === 'locked'),
    evidence: (s) =>
      has(s, 'account.unlock')
        ? `${count(s, 'account.unlock')} unlock(s) recorded.`
        : 'No account has been unlocked.',
    outstanding: 'Unlock a locked account, and be able to say how it differs from a disabled one.',
    actions: ['account.unlock'],
  },

  // --- 3. Privileged access ---
  standing: {
    // Finding it is the lesson. Any PIM assignment existing means the estate
    // has been looked at through the PIM console.
    done: (s) => (s.pim?.list().length ?? 0) > 0 || has(s, 'pim.permanent'),
    evidence: (s) => {
      const standing = s.pim?.standingPrivilege().length ?? 0;
      const all = s.pim?.list().length ?? 0;
      return all === 0
        ? 'No privileged assignments have been looked at.'
        : `${all} assignment(s), ${standing} of them standing.`;
    },
    outstanding: 'Look at who holds privilege permanently.',
    actions: ['pim.permanent', 'pim.eligible'],
  },
  eligible: {
    done: (s) => has(s, 'pim.eligible'),
    evidence: (s) =>
      has(s, 'pim.eligible')
        ? `${count(s, 'pim.eligible')} eligibility grant(s).`
        : 'Nobody has been made eligible.',
    outstanding: 'Replace a permanent assignment with eligibility.',
    actions: ['pim.eligible', 'pim.removed'],
  },
  activate: {
    done: (s) => has(s, 'pim.activated'),
    started: (s) => has(s, 'pim.requested'),
    evidence: (s) =>
      has(s, 'pim.activated')
        ? `${count(s, 'pim.activated')} activation(s), ${count(s, 'pim.deactivated')} stood down.`
        : 'No role has been activated.',
    outstanding: 'Activate an eligible role for a change window.',
    actions: ['pim.requested', 'pim.activated', 'pim.deactivated'],
  },
  approval: {
    done: (s) => has(s, 'pim.approved'),
    started: (s) => has(s, 'pim.requested'),
    evidence: (s) =>
      has(s, 'pim.approved')
        ? `${count(s, 'pim.approved')} approval(s) granted.`
        : 'No activation has been approved.',
    outstanding: 'Approve somebody else’s activation request.',
    actions: ['pim.approved'],
  },

  // --- 4. Cloud identity ---
  authority: {
    done: (s) => Boolean(anyTenant(s)?.isConnected()),
    evidence: (s) => {
      const t = anyTenant(s);
      return t?.isConnected()
        ? `Connected to ${t.vendor.label}; ${t.list().length} object(s) visible.`
        : 'No cloud tenant is connected.';
    },
    outstanding: 'Connect a tenant and work out which side is authoritative.',
    actions: ['cloud.synced'],
  },
  latency: {
    done: (s) => has(s, 'cloud.synced'),
    evidence: (s) =>
      has(s, 'cloud.synced')
        ? `${count(s, 'cloud.synced')} sync cycle(s) run.`
        : 'No sync cycle has been run.',
    outstanding: 'Run a sync and see what the delay does to a disabled account.',
    actions: ['cloud.synced', 'cloud.user.disabled'],
  },
  scim: {
    done: (s) => has(s, 'scim.enabled'),
    evidence: (s) =>
      has(s, 'scim.enabled')
        ? `SCIM switched on ${count(s, 'scim.enabled')} time(s).`
        : 'SCIM has not been switched on for any application.',
    outstanding: 'Turn on SCIM so deprovisioning reaches inside the applications.',
    actions: ['scim.enabled'],
  },
  // --- 5. Review, recovery and evidence ---
  certification: {
    // Completed, not merely decided. A campaign everybody decided and nobody
    // finished removed no access, which is the lesson.
    done: (s) => has(s, 'review.completed'),
    started: (s) => has(s, 'review.opened'),
    evidence: (s) => {
      const opened = count(s, 'review.opened');
      const done = count(s, 'review.completed');
      if (opened === 0) return 'No access review has been opened.';
      return `${opened} campaign(s) opened, ${done} completed, ` +
        `${count(s, 'review.revoked')} membership(s) marked for removal.`;
    },
    outstanding:
      'Open a campaign, decide every row, and complete it. Until it is completed nothing has ' +
      'been removed.',
    actions: ['review.opened', 'review.approved', 'review.revoked', 'review.completed'],
  },
  'emergency-access': {
    // Both halves: a posture that would survive the outage, and having
    // actually run the drill rather than assuming it.
    done: (s) => assessPosture(s).ready && drillStatus(s).state === 'recovered',
    started: (s) => breakGlassAccounts(s).length > 0,
    evidence: (s) => {
      const accounts = breakGlassAccounts(s);
      if (accounts.length === 0) return 'No break-glass account exists.';
      const posture = assessPosture(s);
      const passed = posture.checks.filter((c) => c.passed).length;
      return `${accounts.length} account(s), ${passed} of ${posture.checks.length} posture ` +
        `checks passing, drill ${drillStatus(s).state}.`;
    },
    outstanding:
      'Create two accounts, exclude both from every MFA policy, alert on them, then run the ' +
      'drill and recover from it.',
    actions: ['policy.updated', 'signin.failure'],
  },
  evidence: {
    // The artifact itself. Producing it is the lesson, and a file on disk is
    // the only honest way to know it was produced.
    done: () => evidencePackExists(),
    evidence: () =>
      evidencePackExists()
        ? 'An evidence pack has been written to Documents.'
        : 'No evidence pack has been produced yet.',
    outstanding:
      'Investigate something in Log Search, then export the evidence pack from Lab Plan.',
    actions: ['ticket.review.passed', 'review.completed'],
  },

  duplicates: {
    done: (s) => {
      const t = anyTenant(s);
      // Done when the estate has been examined and no duplicate remains.
      return Boolean(t?.isConnected()) && (t?.duplicates().length ?? 1) === 0 && has(s, 'cloud.synced');
    },
    started: (s) => (anyTenant(s)?.duplicates().length ?? 0) > 0,
    evidence: (s) => {
      const t = anyTenant(s);
      if (!t?.isConnected()) return 'No tenant connected, so nothing to compare.';
      const d = t.duplicates().length;
      return d === 0 ? 'One object per person.' : `${d} duplicate object(s) outstanding.`;
    },
    outstanding: 'Resolve the duplicate identities so each person has one object.',
    actions: ['cloud.synced', 'cloud.user.created'],
  },

  // --- 6. IAM Analyst lab ---
  'analyst-env': {
    done: (s) => s.dir.listOus().length >= 5,
    started: (s) => s.dir.listOus().length >= 1,
    evidence: (s) =>
      `${s.dir.listOus().length} OU(s): ${s.dir.listOus().map((o) => o.name).join(', ') || 'none'}.`,
    outstanding:
      'Build the department OUs and a Groups OU before accounts are created, otherwise the new ' +
      'accounts have nowhere to live.',
    actions: ['ou.created'],
  },
  'analyst-provision': {
    done: (s) => staff(s).length >= 10,
    started: (s) => staff(s).length >= 1,
    evidence: (s) =>
      `${staff(s).length} staff account(s) exist${staff(s).length >= 10 ? ', the bulk batch is complete' : ''}.`,
    outstanding:
      'Run the bulk onboarding script and verify the accounts are in their department groups.',
    actions: ['user.created', 'group.add'],
  },
  'analyst-rbac': {
    done: (s) => s.dir.listGroups().length >= 4 && has(s, 'group.add') && has(s, 'group.remove'),
    started: (s) => s.dir.listGroups().length >= 1,
    evidence: (s) =>
      `${s.dir.listGroups().length} group(s), ${count(s, 'group.add')} add(s), ${count(s, 'group.remove')} removal(s).`,
    outstanding:
      'Create role groups, place people in the right ones, and remove old groups so privilege does ' +
      'not accumulate.',
    actions: ['group.created', 'group.add', 'group.remove'],
  },
  'analyst-policy': {
    done: (s) => {
      const pwd = s.idp.getPasswordPolicy();
      const lock = s.idp.getLockoutPolicy();
      return (
        pwd.minimumLength >= 14 &&
        pwd.complexityEnabled &&
        pwd.maximumAge === 90 &&
        lock.threshold === 5 &&
        lock.duration === 30 &&
        has(s, 'policy.updated')
      );
    },
    started: (s) => has(s, 'policy.updated'),
    evidence: (s) => {
      const pwd = s.idp.getPasswordPolicy();
      const lock = s.idp.getLockoutPolicy();
      return `Password: min ${pwd.minimumLength}, complexity ${pwd.complexityEnabled}, max age ${pwd.maximumAge}; ` +
        `lockout: ${lock.threshold} attempts, ${lock.duration} minutes.`;
    },
    outstanding:
      'Set the password policy to 14 characters, complex, 90 days and the lockout to 5 attempts ' +
      'for 30 minutes.',
    actions: ['policy.updated'],
  },
  'analyst-shares': {
    done: (s) =>
      s.dir.listShares().length >= 1 &&
      has(s, 'share.created') &&
      has(s, 'share.permission') &&
      has(s, 'share.effective.checked'),
    started: (s) => s.dir.listShares().length >= 1,
    evidence: (s) =>
      `${s.dir.listShares().length} share(s), ${count(s, 'share.permission')} permission change(s), ` +
      `${count(s, 'share.effective.checked')} effective-access check(s).`,
    outstanding:
      'Create a share, grant Allow and Deny permissions, and verify the effective access for a user.',
    actions: ['share.created', 'share.permission', 'share.effective.checked'],
  },
  'analyst-audit': {
    done: (s) => has(s, 'group.remove') && has(s, 'iam.audit.exported'),
    started: (s) => has(s, 'iam.audit.exported') || has(s, 'group.remove'),
    evidence: (s) =>
      `${count(s, 'group.remove')} privilege-removal(s); ${count(s, 'iam.audit.exported')} CSV export(s).`,
    outstanding:
      'Query the audit log, export it to CSV, and remove the unexpected group membership.',
    actions: ['iam.audit.exported', 'group.remove'],
  },
  'analyst-dormant': {
    done: (s) => has(s, 'dormant.reviewed'),
    started: (s) => staff(s).some((u) => !u.lastSignInAt),
    evidence: (s) =>
      has(s, 'dormant.reviewed')
        ? `${count(s, 'dormant.reviewed')} dormant-account review(s).`
        : 'No dormant-account review has been run.',
    outstanding:
      'Run Get-DormantAccount and document any accounts that have never signed in or are stale.',
    actions: ['dormant.reviewed'],
  },
  'analyst-cloud': {
    done: (s) =>
      s.cloud.entra.isConnected() && s.cloud.entra.list().some((u) => u.origin === 'synced'),
    started: (s) => s.cloud.entra.isConnected() || has(s, 'cloud.synced'),
    evidence: (s) => {
      const synced = s.cloud.entra.list().filter((u) => u.origin === 'synced').length;
      return s.cloud.entra.isConnected()
        ? `Entra connected; ${synced} synced account(s).`
        : 'Entra tenant has not been connected.';
    },
    outstanding: 'Connect to Entra, run Start-DirectorySync, and verify a synced user.',
    actions: ['cloud.synced'],
  },
  'analyst-helpdesk': {
    done: (s) => has(s, 'account.unlock') && has(s, 'group.add'),
    started: (s) => has(s, 'account.unlock') || staff(s).some((u) => u.status === 'locked'),
    evidence: (s) =>
      `${count(s, 'account.unlock')} unlock(s), ${count(s, 'group.add')} group grant(s).`,
    outstanding:
      'Unlock the locked account and fix the access-denied issue by adjusting group membership.',
    actions: ['account.unlock', 'group.add'],
  },
  'analyst-docs': {
    done: () => writerEvidenceExists(),
    evidence: () =>
      writerEvidenceExists()
        ? 'Writer documents have been saved.'
        : 'The offboarding SOP, password guide and auditor evidence pack have not been saved yet.',
    outstanding:
      'Use Writer to complete the offboarding SOP, the new-hire password guide and the auditor ' +
      'evidence pack, then save each one.',
    actions: ['document.saved'],
  },
};

/** Every lesson id the manual defines, in order. */
export function lessonIds(): string[] {
  return MANUAL.flatMap((c) => c.lessons.map((l) => l.id));
}

/** The rule table, exposed so the drift guard can compare it to the manual. */
export function ruleIds(): string[] {
  return Object.keys(RULES);
}

function stateOf(rule: Rule | undefined, s: VmServices): LessonState {
  if (!rule) return 'not-started';
  if (rule.done(s)) return 'done';
  if (rule.started?.(s)) return 'in-progress';
  return 'not-started';
}

/** Work out where the learner is, from the estate rather than from a checkbox. */
export function computeProgress(s: VmServices): Progress {
  const chapters: ChapterProgress[] = MANUAL.map((chapter) => {
    const lessons: LessonProgress[] = chapter.lessons.map((lesson) => {
      const rule = RULES[lesson.id];
      const state = stateOf(rule, s);
      return {
        lesson,
        chapterId: chapter.id,
        state,
        evidence: rule ? rule.evidence(s) : 'No rule defined for this lesson.',
        outstanding: rule ? rule.outstanding : '',
        actions: rule ? rule.actions : [],
      };
    });
    // A lesson under way counts as half, so a chapter in progress does not
    // read as untouched.
    const score = lessons.reduce(
      (acc, l) => acc + (l.state === 'done' ? 1 : l.state === 'in-progress' ? 0.5 : 0),
      0,
    );
    return {
      chapter,
      lessons,
      percent: lessons.length === 0 ? 0 : Math.round((score / lessons.length) * 100),
    };
  });

  const all = chapters.flatMap((c) => c.lessons);
  const done = all.filter((l) => l.state === 'done').length;
  const score = all.reduce(
    (acc, l) => acc + (l.state === 'done' ? 1 : l.state === 'in-progress' ? 0.5 : 0),
    0,
  );

  return {
    chapters,
    done,
    total: all.length,
    percent: all.length === 0 ? 0 : Math.round((score / all.length) * 100),
  };
}
