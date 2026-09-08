/**
 * vm/ticketReview.ts — checking that a resolved ticket was actually resolved.
 *
 * Marking a ticket resolved is a claim. This checks it against the directory
 * and the audit log, and records the verdict — which is the same principle the
 * rest of the workstation is built on: the log records what was attempted, the
 * state tells you what took effect, and only the second one counts.
 *
 * The checks are deterministic. A language model writes the feedback when one
 * is available, but it never decides pass or fail: a reviewer that
 * hallucinates approval is worse than no reviewer, and a learner who is told
 * they did it right when they did not has been actively taught the wrong
 * lesson.
 *
 * Everything lands in the audit log — the verdict, and every check behind it —
 * so a reviewed ticket can be re-read later the way a real one can.
 */
import type { Ticket, UserId } from '@/domain';
import type { MockAuditLog, MockDirectory, MockPim, MockCloudTenant } from '@/services';
import type { CloudVendor } from '@/services';
import { OLLAMA_GENERATE_URL, OLLAMA_MODEL, ollamaAvailable } from '@/config/ollama';

export interface ReviewDeps {
  dir: MockDirectory;
  audit: MockAuditLog;
  pim?: MockPim;
  cloud?: Partial<Record<CloudVendor, MockCloudTenant>>;
}

/** One thing that was checked, and what was found. */
export interface ReviewCheck {
  label: string;
  passed: boolean;
  /** What was actually observed — the evidence, not the expectation. */
  detail: string;
}

export interface TicketReview {
  ticketId: string;
  /** Passed only when every check passed. */
  passed: boolean;
  checks: ReviewCheck[];
  /** Written feedback. From the model when it is running, from here if not. */
  summary: string;
  source: 'ollama' | 'offline';
  at: number;
}

const pass = (label: string, detail: string): ReviewCheck => ({ label, passed: true, detail });
const fail = (label: string, detail: string): ReviewCheck => ({ label, passed: false, detail });

/** What may appear inside a logon, and therefore what does not end one. */
const NAME_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789._-';

/**
 * The accounts a ticket is about.
 *
 * relatedUserIds is set when the scenario prepared real state; falling back to
 * scanning the body for a logon name covers tickets a learner wrote by hand.
 */
function subjectsOf(ticket: Ticket, dir: MockDirectory): ReturnType<MockDirectory['listUsers']> {
  const byId = ticket.relatedUserIds
    ?.map((id) => dir.getUser(id))
    .filter((u): u is NonNullable<typeof u> => Boolean(u));
  if (byId && byId.length > 0) return byId;

  // Whole words only. `includes` made a ticket about jdoe2 a ticket about
  // jdoe as well, and any ticket containing the word "administrator" a ticket
  // about the admin account -- so the review graded somebody the ticket was
  // never about, and the learner could not answer the failing check. Logons
  // contain dots and hyphens, which a regex word boundary does not treat as
  // boundaries, so the rule is
  // spelled out here as "no name character on either side" and scanned by
  // hand. Building a pattern out of a logon would mean escaping directory
  // data into regex syntax — a second bug waiting behind the first.
  const haystack = `${ticket.subject} ${ticket.body}`.toLowerCase();
  const isNameChar = (ch: string | undefined): boolean =>
    ch !== undefined && NAME_CHARS.includes(ch);

  const namedInText = (username: string): boolean => {
    const name = username.toLowerCase();
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(name, from);
      if (at === -1) return false;
      if (!isNameChar(haystack[at - 1]) && !isNameChar(haystack[at + name.length])) return true;
      from = at + 1;
    }
  };
  return dir.listUsers().filter((u) => namedInText(u.username));
}

/**
 * Run the checks for a ticket kind.
 *
 * Each kind asks about the thing that kind is for, and each check reports what
 * it saw rather than whether it liked it — "still enabled" is more useful to a
 * learner than "failed".
 */
/**
 * Checks for a ticket about the directory's shape rather than about a person.
 *
 * Returns null when this is an ordinary ticket, so the caller carries on to
 * the per-kind checks.
 *
 * Keyed on the scenario id, which is deterministic. The fallback below reads
 * the subject, and exists only for tickets raised before the id was carried
 * through -- a learner with the queue already open when they update should
 * not be left with a ticket they still cannot close.
 */
function estateChecks(ticket: Ticket, deps: ReviewDeps): ReviewCheck[] | null {
  const { dir } = deps;
  const named = ticket.relatedUserIds.length > 0;
  const subject = ticket.subject.toLowerCase();

  const wantsOus =
    ticket.scenarioId === 'build-ou-structure' ||
    (!ticket.scenarioId && !named && subject.includes('organisational unit'));

  const wantsGroups =
    ticket.scenarioId === 'define-group-model' ||
    (!ticket.scenarioId && !named && subject.includes('group model'));

  if (wantsOus) {
    const ous = dir.listOus();
    // A hierarchy, not one box. The lesson is delegation, which needs a
    // parent and something beneath it.
    const nested = ous.filter((o) => o.parentId !== undefined);
    return [
      ous.length >= 2
        ? pass('Structure exists', `${ous.length} OU(s): ${ous.map((o) => o.name).join(', ')}.`)
        : fail(
            'Structure exists',
            ous.length === 0
              ? 'No organisational unit has been created.'
              : `Only ${ous[0]!.name} exists. An OU structure needs more than one container.`,
          ),
      nested.length >= 1
        ? pass('It is a hierarchy', `${nested.length} OU(s) sit beneath another.`)
        : fail(
            'It is a hierarchy',
            'Every OU is at the top level. Delegation and Group Policy follow the tree, so ' +
              'the point of the structure is what sits beneath what.',
          ),
    ];
  }

  if (wantsGroups) {
    const groups = dir.listGroups();
    const placed = groups.filter((g) => g.ouId !== undefined);
    return [
      groups.length >= 3
        ? pass('Groups exist', `${groups.length} security group(s) defined.`)
        : fail(
            'Groups exist',
            `${groups.length} group(s) so far. Access is granted through groups, so the model ` +
              'needs one per role people actually hold.',
          ),
      placed.length > 0
        ? pass('They live somewhere', `${placed.length} group(s) placed in an OU.`)
        : fail(
            'They live somewhere',
            'Every group is in the default container. A group is a directory object like an ' +
              'account, and it is placed where delegation reaches it.',
          ),
    ];
  }

  return null;
}

function runChecks(ticket: Ticket, deps: ReviewDeps): ReviewCheck[] {
  const { dir, audit } = deps;
  const subjects = subjectsOf(ticket, dir);
  const checks: ReviewCheck[] = [];

  // Some tickets are not about a person. "Build the organisational unit
  // structure" and "Define the security group model" ask you to change the
  // shape of the directory, and they name nobody because there is nobody to
  // name. Judging those by looking for an account made them impossible to
  // resolve once the review became binding.
  const estate = estateChecks(ticket, deps);
  if (estate) return estate;

  if (subjects.length === 0) {
    return [
      fail(
        'Subject identified',
        'This ticket names no account that exists in the directory, so there is nothing to ' +
          'check against. If you resolved it by doing work on somebody, the ticket did not ' +
          'record who.',
      ),
    ];
  }

  for (const user of subjects) {
    switch (ticket.kind) {
      case 'onboarding': {
        checks.push(
          user.status === 'active'
            ? pass('Account is usable', `${user.username} exists and is enabled.`)
            : fail('Account is usable', `${user.username} exists but is ${user.status}.`),
        );
        const groups = dir.listGroups().filter((g) => g.memberIds.includes(user.id));
        checks.push(
          groups.length > 0
            ? pass('Access granted', `Member of ${groups.map((g) => g.name).join(', ')}.`)
            : fail(
                'Access granted',
                `${user.username} is in no groups. An account with no access is not an ` +
                  'onboarded person.',
              ),
        );
        checks.push(
          user.ouId
            ? pass('Placed in the structure', 'The account sits in an organisational unit.')
            : fail(
                'Placed in the structure',
                'The account is still in the default container, so no delegation or policy ' +
                  'reaches it.',
              ),
        );
        break;
      }

      // 'leaver' is the same event under the other vocabulary. Sharing the
      // branch is what stops the two drifting into different standards for
      // identical work.
      case 'leaver':
      case 'termination': {
        checks.push(
          user.status === 'disabled'
            ? pass('Disabled on premises', `${user.username} is disabled in the directory.`)
            : fail('Disabled on premises', `${user.username} is still ${user.status}.`),
        );

        const tenant = deps.cloud?.okta ?? deps.cloud?.entra;
        if (tenant) {
          const cloud = tenant.list().find((c) => c.upn.startsWith(`${user.username}@`));
          if (cloud) {
            checks.push(
              cloud.status === 'disabled'
                ? pass('Disabled in the tenant', `${cloud.upn} is disabled in ${tenant.vendor.label}.`)
                : fail(
                    'Disabled in the tenant',
                    `${cloud.upn} is still active in ${tenant.vendor.label}. Run a sync cycle.`,
                  ),
            );
            checks.push(
              cloud.sessions === 0
                ? pass('Sessions revoked', 'No live sessions remain.')
                : fail(
                    'Sessions revoked',
                    `${cloud.sessions} session(s) are still open. Disabling an account does ` +
                      'not end the sessions it already has.',
                  ),
            );
          }
          const orphans = tenant.orphanedAppAccounts().filter((o) => o.upn.startsWith(`${user.username}@`));
          checks.push(
            orphans.length === 0
              ? pass('Applications deprovisioned', 'No application account is still active.')
              : fail(
                  'Applications deprovisioned',
                  `Still active in ${orphans.map((o) => o.app).join(', ')}. Deprovisioning ` +
                    'stopped at the identity provider.',
                ),
          );
        }
        break;
      }

      case 'password-reset': {
        // Since the ticket was raised. Without the bound, a reset from the
        // last lockout about the same person closed this one for free -- and
        // password-reset is the most-generated kind in the app.
        const reset = audit.events.some(
          (e) =>
            e.action === 'password.reset' &&
            e.at >= ticket.createdAt &&
            (e.targetId === user.id || e.subjectId === user.id),
        );
        checks.push(
          reset
            ? pass('Password was reset', 'The audit log records a reset for this account.')
            : fail(
                'Password was reset',
                'No reset appears in the audit log for this account since the ticket was ' +
                  'raised, so whatever was done was not this.',
              ),
        );
        checks.push(
          user.status !== 'locked'
            ? pass('Account is not locked', `${user.username} is ${user.status}.`)
            : fail(
                'Account is not locked',
                'The account is still locked out. A reset does not clear a lockout.',
              ),
        );
        break;
      }

      case 'mover':
      case 'transfer': {
        const groups = dir.listGroups().filter((g) => g.memberIds.includes(user.id));
        // Both bounded to this ticket, as the move check below already was.
        // Unbounded, the group they were put in when they joined counted as
        // "new access granted" for every transfer they ever have.
        const removed = audit.events.some(
          (e) =>
            e.action === 'group.remove' && e.at >= ticket.createdAt && e.subjectId === user.id,
        );
        const added = audit.events.some(
          (e) => e.action === 'group.add' && e.at >= ticket.createdAt && e.subjectId === user.id,
        );
        checks.push(
          added
            ? pass('New access granted', `Now in ${groups.map((g) => g.name).join(', ') || 'no groups'}.`)
            : fail('New access granted', 'No group was added for this account.'),
        );
        checks.push(
          removed
            ? pass('Old access removed', 'A group removal is recorded for this account.')
            : fail(
                'Old access removed',
                'No group was removed for this account since the ticket was raised. This is ' +
                  'the half of a transfer people skip, and it is how privilege accumulates.',
              ),
        );
        // A move is not only a change of access. The account has to end up
        // where the person now works, or the next person to read the
        // directory is misled about who they are.
        const moved = audit.events.some(
          (e) => e.action === 'user.moved' && e.at >= ticket.createdAt && e.targetId === user.id,
        );
        checks.push(
          moved
            ? pass('Account was moved', 'A move is recorded for this account.')
            : fail(
                'Account was moved',
                'The account is where it started. Changing group membership without moving ' +
                  'the account leaves the directory disagreeing with the org chart.',
              ),
        );
        break;
      }

      case 'access-request': {
        if (deps.pim) {
          const standing = deps.pim.standingPrivilege().filter((a) => a.userId === user.id);
          checks.push(
            standing.length === 0
              ? pass('No standing privilege', `${user.username} holds no permanent privileged role.`)
              : fail(
                  'No standing privilege',
                  `${user.username} still holds ${standing.length} permanent assignment(s).`,
                ),
          );
        }
        const groups = dir.listGroups().filter((g) => g.memberIds.includes(user.id));
        checks.push(
          groups.length > 0 || Boolean(deps.pim?.list({ userId: user.id }).length)
            ? pass('Access is in place', 'The account has the access the request was about.')
            : fail('Access is in place', 'Nothing was granted to this account.'),
        );
        break;
      }

      case 'mfa-issue': {
        // Clearing a registration is the fix; leaving it cleared is not. An
        // account with no second factor is the thing the ticket was about,
        // so re-enrolment has to be part of resolving it.
        const cleared = audit.events.some(
          (e) => e.action === 'mfa.reset' && e.at >= ticket.createdAt && e.targetId === user.id,
        );
        checks.push(
          cleared
            ? pass('Registration was cleared', 'A reset is recorded for this account.')
            : fail(
                'Registration was cleared',
                'No MFA reset appears in the audit log since the ticket was raised, so ' +
                  'whatever was done was not this.',
              ),
        );
        checks.push(
          user.mfa !== 'none'
            ? pass('A second factor is in place', `${user.username} is enrolled for ${user.mfa}.`)
            : fail(
                'A second factor is in place',
                `${user.username} has no second factor. Clearing the old registration and ` +
                  'stopping there leaves the account weaker than before the ticket.',
              ),
        );
        break;
      }

      case 'incident': {
        const tenant = deps.cloud?.okta ?? deps.cloud?.entra;
        if (tenant) {
          const duplicates = tenant.duplicates().filter((d) => d.upn.startsWith(`${user.username}@`));
          checks.push(
            duplicates.length === 0
              ? pass('No duplicate identity', 'One object for this person.')
              : fail(
                  'No duplicate identity',
                  `${duplicates.length} objects still share ${duplicates[0]!.upn}.`,
                ),
          );
        }
        break;
      }

      default: {
        /*
         * Unreachable, and the compiler proves it: every member of TicketKind
         * now has a branch, so `ticket` narrows to never here.
         *
         * This used to be a live fallback asking only whether anything in the
         * audit log had touched the account since the ticket was raised.
         * mover, leaver and mfa-issue landed on it, and it passed for any
         * change at all -- disable the wrong person on a leaver ticket and
         * the review congratulated you. A vacuous check is worse than no
         * check, because it produces a green verdict the learner calibrates
         * on.
         *
         * Keeping it as an exhaustiveness guard rather than a fallback means
         * the next ticket kind added to the union fails the build until
         * somebody writes checks for it, instead of silently inheriting a
         * standard that cannot be failed.
         */
        const unhandled: never = ticket;
        throw new Error(
          `[ticketReview] no checks for ticket kind '${(unhandled as Ticket).kind}'.`,
        );
      }
    }
  }

  /*
   * A review that examined nothing is not a pass.
   *
   * `checks.every()` is true of an empty array, so any path that pushed no
   * checks returned a green verdict having looked at nothing -- an incident
   * ticket on a host with no cloud tenant did exactly that, because its whole
   * branch sits behind `if (tenant)`. This is the same failure the
   * exhaustiveness guard above was added to prevent, one level up: a vacuous
   * check produces a verdict the learner calibrates on.
   */
  if (checks.length === 0) {
    return [
      fail(
        'Something was checked',
        'There was nothing to check this ticket against on this host, so it cannot be ' +
          'confirmed as done. This is a gap in the lab rather than in your work — report it.',
      ),
    ];
  }

  return checks;
}

/** The written verdict, when there is no model to write one. */
function offlineSummary(checks: ReviewCheck[]): string {
  const failed = checks.filter((c) => !c.passed);
  if (failed.length === 0) {
    return 'Every check passed. The work the ticket asked for is visible in the directory.';
  }
  return [
    `${failed.length} of ${checks.length} checks did not pass.`,
    '',
    ...failed.map((c) => `· ${c.label}: ${c.detail}`),
  ].join('\n');
}

/**
 * Ask the model to write the feedback.
 *
 * It is given the findings and told to explain them. It cannot change the
 * verdict — the checks decided that before this was called.
 */
async function writeSummary(
  ticket: Ticket,
  checks: ReviewCheck[],
  passed: boolean,
): Promise<string | null> {
  const prompt = [
    'You are reviewing a junior identity administrator’s work on a service desk ticket.',
    '',
    `Ticket: ${ticket.subject}`,
    ticket.body,
    '',
    'These checks were run against the directory. You did not run them and you cannot',
    'change them — report and explain them.',
    '',
    ...checks.map((c) => `${c.passed ? 'PASS' : 'FAIL'} — ${c.label}: ${c.detail}`),
    '',
    passed
      ? 'Everything passed. In two or three sentences, say what they got right, and name one ' +
        'thing a reviewer would look at next.'
      : 'Something failed. In two or three sentences, say plainly what is still wrong and what ' +
        'to do about it. Do not congratulate them for the parts that passed.',
    '',
    'Plain text. No headings, no lists, no markdown.',
  ].join('\n');

  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 60_000);
    const res = await fetch(OLLAMA_GENERATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        keep_alive: '15m',
        options: { temperature: 0.3, num_predict: 220 },
      }),
      signal: ctl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { response?: string };
    return data.response?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Ask a model to rewrite the summary. Returns null when it cannot.
 *
 * Separate from the review itself so the verdict can be shown the instant the
 * checks finish. Waiting on a local model to write a paragraph before showing
 * any of it made the learner sit through "Reviewing…" for a minute to be told
 * something the checks already knew — and on a machine with no Ollama, for the
 * whole timeout.
 *
 * It cannot change the verdict. It is given the findings and asked to explain
 * them, because a reviewer that hallucinates approval is worse than none.
 */
export async function explainReview(
  ticket: Ticket,
  review: TicketReview,
): Promise<string | null> {
  if (!(await ollamaAvailable())) return null;
  return writeSummary(ticket, review.checks, review.passed);
}

/**
 * Review a resolved ticket, and record what was found.
 *
 * Every check is written to the audit log individually, not just the verdict:
 * a reviewer who says "failed" without saying what they looked at is asking to
 * be taken on trust, which is the opposite of what this teaches.
 */
export function reviewTicketSync(ticket: Ticket, deps: ReviewDeps, actor: UserId): TicketReview {
  const checks = runChecks(ticket, deps);
  const passed = checks.every((c) => c.passed);

  for (const check of checks) {
    deps.audit.record({
      actorId: actor,
      action: passed ? 'ticket.review.passed' : 'ticket.review.failed',
      targetId: ticket.id,
      note: `${check.passed ? 'PASS' : 'FAIL'} ${check.label}: ${check.detail}`,
    });
  }

  return {
    ticketId: ticket.id,
    passed,
    checks,
    summary: offlineSummary(checks),
    source: 'offline',
    at: Date.now(),
  };
}
