/**
 * vm/ticketGenerator.ts — produces the next piece of work for this domain.
 *
 * Two sources, same contract:
 *
 *   Ollama, when it is reachable, writes the prose. It is given the current
 *   environment — which OUs, groups and people exist — and a scenario chosen
 *   for that stage, so it can only dress up work the domain can actually
 *   support.
 *
 *   The built-in generator runs otherwise, and produces the same scenarios
 *   without the prose variation. This is not a degraded mode to apologise for:
 *   most people will not have Ollama running, and a lab that only works with a
 *   local model working is a lab that mostly does not work.
 *
 * In both cases the scenario is chosen HERE, from what the stage allows, and
 * any state the scenario claims — a lockout, failed sign-ins — is applied to
 * the world before the ticket is raised. The model never decides whether a
 * person exists.
 */
import type {
  MockAuditLog,
  MockDirectory,
  MockTicketQueue,
  MockPim,
  MockCloudTenant,
  CloudVendor,
} from '@/services';
import type { Ticket, TicketKind, UserId } from '@/domain';
import { COMPANY } from '@/config';
import { OLLAMA_GENERATE_URL, OLLAMA_MODEL, ollamaAvailable } from '@/config/ollama';
import { readEnvironment, type EnvironmentState, type Stage } from './environmentStage';
import { describeForPrompt } from './environmentStage';

export interface GeneratorDeps {
  dir: MockDirectory;
  tickets: MockTicketQueue;
  audit: MockAuditLog;
  /** Optional: PIM scenarios are simply not offered without it. */
  pim?: MockPim;
  /** Optional: hybrid scenarios are not offered without a tenant. */
  cloud?: Partial<Record<CloudVendor, MockCloudTenant>>;
}

/** A unit of work the environment can currently support. */
interface Scenario {
  id: string;
  kind: TicketKind;
  priority: Ticket['priority'];
  subject: string;
  body: string;
  /** Applied before the ticket is raised, so the evidence is real. */
  prepare?: (deps: GeneratorDeps) => UserId[];
}

// ---------------------------------------------------------------------------
// Scenario catalogue, by stage
// ---------------------------------------------------------------------------

const OU_PLAN = ['Corp', 'Corp/Users', 'Corp/Groups', 'Corp/ServiceAccounts', 'Corp/Workstations'];
const GROUP_PLAN = [
  'grp-helpdesk-tier1',
  'grp-hr-readers',
  'grp-finance-payroll',
  'grp-engineering-dev',
  'grp-iam-admins',
];

/** Names used for generated staff. Kept small and obviously fictional. */
const PEOPLE = [
  { logon: 'jdoe', display: 'John Doe', dept: 'Help Desk', title: 'Service Desk Analyst' },
  { logon: 'mchen', display: 'Maya Chen', dept: 'HR', title: 'HR Business Partner' },
  { logon: 'rpatel', display: 'Ravi Patel', dept: 'Finance', title: 'Payroll Analyst' },
  { logon: 'aokafor', display: 'Ada Okafor', dept: 'Engineering', title: 'Software Engineer' },
  { logon: 'lsilva', display: 'Luca Silva', dept: 'Sales', title: 'Account Executive' },
  { logon: 'nhaddad', display: 'Nadia Haddad', dept: 'Security', title: 'Security Analyst' },
];

function bareStageScenarios(): Scenario[] {
  return [
    {
      id: 'build-ou-structure',
      kind: 'onboarding',
      priority: 'high',
      subject: 'Build the organisational unit structure',
      body:
        'The domain has just been promoted and has no structure. Create the OU hierarchy ' +
        `before anything else: ${OU_PLAN.join(', ')}. Where an account lives decides which ` +
        'policy and delegation reach it, so this comes first. Use Active Directory Users ' +
        'and Computers, or New-ADOrganizationalUnit in the terminal.',
    },
  ];
}

function structuredStageScenarios(env: EnvironmentState): Scenario[] {
  const missing = GROUP_PLAN.filter((g) => !env.groupNames.includes(g));
  return [
    {
      id: 'define-group-model',
      kind: 'access-request',
      priority: 'high',
      subject: 'Define the security group model',
      body:
        'The OU structure is in place. Create the security groups access will be granted ' +
        `through: ${missing.join(', ')}. Grant access to groups rather than to people — ` +
        'otherwise every leaver becomes an archaeology exercise across individual accounts.',
    },
  ];
}

function staffingScenarios(env: EnvironmentState): Scenario[] {
  const unprovisioned = PEOPLE.filter((p) => !env.staffLogons.includes(p.logon));
  return unprovisioned.slice(0, 3).map((p) => ({
    id: `onboard-${p.logon}`,
    kind: 'onboarding' as TicketKind,
    priority: 'normal' as Ticket['priority'],
    subject: `New starter: ${p.display} (${p.title})`,
    body:
      `${p.display} joins the ${p.dept} team. Create the account ${p.logon}, set a password, ` +
      `and place them in the right OU and groups for ${p.dept}. Then sign out and sign in as ` +
      `${p.logon} to confirm the account works and their desktop has the right tools.`,
  }));
}

function operatingScenarios(env: EnvironmentState): Scenario[] {
  const out: Scenario[] = [];
  const pick = (exclude: string[] = []): string | undefined =>
    env.staffLogons.filter((l) => !exclude.includes(l))[
      Math.floor(Math.random() * Math.max(1, env.staffLogons.filter((l) => !exclude.includes(l)).length))
    ];

  // Lockout — only offered when there is somebody to lock, and the lock is
  // applied for real before the ticket is raised.
  const lockTarget = pick(env.lockedLogons);
  if (lockTarget) {
    out.push({
      id: `lockout-${lockTarget}`,
      kind: 'password-reset',
      priority: 'urgent',
      subject: `Account locked out: ${lockTarget}`,
      body:
        `${lockTarget} cannot sign in and reports repeated failed attempts. Check the audit ` +
        'log for the attempts, unlock the account, and reset the password with a forced ' +
        'change at next sign-in. Then sign in as them to prove it is fixed.',
      prepare: ({ dir, audit }) => {
        const u = dir.getUserByUsername(lockTarget);
        if (!u) return [];
        u.status = 'locked';
        for (let i = 0; i < 5; i++) {
          audit.record({
            actorId: u.id,
            action: 'signin.failure',
            targetId: u.id,
            ip: '10.20.4.88',
          });
        }
        return [u.id];
      },
    });
  }

  const disableTarget = pick([...env.lockedLogons, ...env.disabledLogons]);
  if (disableTarget) {
    out.push({
      id: `leaver-${disableTarget}`,
      kind: 'leaver',
      priority: 'high',
      subject: `Offboarding: ${disableTarget} leaves today`,
      body:
        `${disableTarget} leaves the company today. Disable the account and revoke any live ` +
        'sessions. Order matters: a disabled account with a live session can still be used ' +
        'until that session is killed. Then confirm they can no longer sign in.',
      prepare: ({ dir }) => {
        const u = dir.getUserByUsername(disableTarget);
        return u ? [u.id] : [];
      },
    });
  }

  const moveTarget = pick(env.disabledLogons);
  if (moveTarget && env.ouCount > 1) {
    out.push({
      id: `mover-${moveTarget}`,
      kind: 'transfer',
      priority: 'normal',
      subject: `Transfer: ${moveTarget} moves department`,
      body:
        `${moveTarget} is changing team. Move the account to the correct OU, add the groups ` +
        'the new role needs and remove the ones it does not. Removing the old access is the ' +
        'half people forget — that is how privilege creeps.',
      prepare: ({ dir }) => {
        const u = dir.getUserByUsername(moveTarget);
        return u ? [u.id] : [];
      },
    });
  }

  // Keep provisioning work flowing alongside operations.
  out.push(...staffingScenarios(env).slice(0, 1));
  return out;
}


/**
 * Privileged-access work. Offered only once there are people and a privileged
 * role to hold, because eligibility for a role nobody defined is not a task.
 */
function pimScenarios(env: EnvironmentState, deps: GeneratorDeps): Scenario[] {
  if (!deps.pim) return [];
  const adminRole = deps.dir.getRoleByName('role-domain-admins') ?? deps.dir.listRoles()[0];
  if (!adminRole || env.staffLogons.length === 0) return [];

  const out: Scenario[] = [];
  const target = env.staffLogons[Math.floor(Math.random() * env.staffLogons.length)]!;

  // 1. Standing privilege discovered in a review. Created for real so the
  //    review has something to find.
  out.push({
    id: `pim-standing-${target}`,
    kind: 'access-request',
    priority: 'high',
    subject: `Access review: ${target} holds permanent admin rights`,
    body:
      `The quarterly privileged access review flagged ${target} as holding ` +
      `${adminRole.name} permanently, with no expiry and no approval on record. ` +
      'Standing privilege is what PIM exists to remove. Make them eligible instead, ' +
      'so the role has to be activated with a reason and lapses on its own, then ' +
      'remove the permanent assignment. Confirm with Get-PimStandingPrivilege.',
    prepare: ({ dir, pim }) => {
      const u = dir.getUserByUsername(target);
      if (!u || !pim) return [];
      pim.grantPermanent(u.id, adminRole.id, u.id);
      return [u.id];
    },
  });

  // 2. Just-in-time elevation for a real piece of work.
  out.push({
    id: `pim-jit-${target}`,
    kind: 'access-request',
    priority: 'normal',
    subject: `Elevation request: ${target} needs admin for a change window`,
    body:
      `${target} has a change to make tonight and needs ${adminRole.name} for the ` +
      'window only. Make them eligible rather than granting it outright, then have ' +
      'the role activated with a justification and a duration that matches the ' +
      'change. Check afterwards that it lapsed rather than staying on.',
    prepare: ({ dir }) => {
      const u = dir.getUserByUsername(target);
      return u ? [u.id] : [];
    },
  });

  return out;
}


/**
 * Hybrid-identity work.
 *
 * Each of these creates the bad state for real before describing it, so the
 * learner investigates an estate rather than reading a story about one. The
 * evidence they will find — a stale cloud copy, a live app account, two
 * objects with one UPN — is genuinely there to be found.
 */
function cloudScenarios(env: EnvironmentState, deps: GeneratorDeps): Scenario[] {
  const tenant = deps.cloud?.okta ?? deps.cloud?.entra;
  if (!tenant || env.staffLogons.length === 0) return [];

  /**
   * Refuse to stage a second hybrid fault while one is still outstanding.
   *
   * These scenarios all act on the same tenant, and they interfere: the
   * duplicate scenario runs a sync cycle, which quietly repairs the leaver
   * scenario's stale cloud copy, and the leaver's sync claims the UPN the
   * duplicate scenario needs to be free. Either way a ticket ends up
   * describing evidence that is no longer there, which is the one thing this
   * generator exists to prevent.
   *
   * Only the faults these scenarios create count. An account that has never
   * been synced is pending 'create', which is the ordinary state of a domain
   * nobody has synced yet rather than a fault someone staged.
   */
  const faultOutstanding =
    tenant.duplicates().length > 0 ||
    tenant.orphanedAppAccounts().length > 0 ||
    tenant.pendingDelta().some((d) => d.change === 'disable');
  if (faultOutstanding) return [];

  const vendor = tenant.vendor;
  const target = env.staffLogons[Math.floor(Math.random() * env.staffLogons.length)]!;
  const upn = `${target}@${COMPANY.domain}`;
  const app = tenant.listApps()[0]?.name ?? 'HR Portal';
  const out: Scenario[] = [];

  // 1. The leaver who still has access. Two causes at once, which is realistic:
  //    the cloud copy is stale AND the application has no SCIM.
  out.push({
    id: `cloud-leaver-${target}`,
    kind: 'termination',
    priority: 'urgent',
    subject: `${target} left on Friday and can still reach ${app}`,
    body:
      `${target} was disabled in Active Directory on Friday. Security have just ` +
      `watched them sign in to ${app} this morning. Work out how they still have ` +
      `access: check what ${vendor.label} currently believes about ${upn}, when the ` +
      'last sync cycle ran, and whether the application is provisioned through the ' +
      'tenant at all. Close every route, not the first one you find.',
    prepare: ({ dir, cloud }) => {
      const u = dir.getUserByUsername(target);
      const t = cloud?.okta ?? cloud?.entra;
      if (!u || !t) return [];
      // Build the estate as it was while they still worked here...
      t.connect();
      t.grantAppAccount(app, upn);
      t.sync('system' as UserId);
      t.openSession(upn);
      // ...then offboard them on premises only, which is the actual mistake.
      dir.disableUser(u.id, 'system' as UserId);
      return [u.id];
    },
  });

  // 2. Duplicate identity. Made by the same shortcut that makes it at work:
  //    somebody created the account in the cloud instead of waiting for sync.
  out.push({
    id: `cloud-duplicate-${target}`,
    kind: 'incident',
    priority: 'high',
    subject: `Two ${vendor.label} accounts exist for ${target}`,
    body:
      `${target} reports that their ${vendor.label} sign-in sometimes lands them in ` +
      'an empty account with none of their groups. There are two objects with the ' +
      `UPN ${upn}: one created directly in the tenant, one synced from Active ` +
      'Directory. Find them, work out which one is authoritative, and say what should ' +
      'happen to the other. Get-CloudDuplicate lists them.',
    prepare: ({ dir, cloud }) => {
      const u = dir.getUserByUsername(target);
      const t = cloud?.okta ?? cloud?.entra;
      if (!u || !t) return [];
      t.connect();
      // Cloud-only object first, then the sync that cannot soft-match it.
      t.createCloudOnly(upn, `${u.displayName} (cloud)`, 'system' as UserId);
      t.sync('system' as UserId);
      return [u.id];
    },
  });

  // One per pass. Both stage a fault in the same tenant; raising them together
  // means whichever prepares second overwrites the first one's evidence.
  const chosen = out[Math.floor(Math.random() * out.length)];
  return chosen ? [chosen] : [];
}

function scenariosFor(env: EnvironmentState, deps: GeneratorDeps): Scenario[] {
  const byStage: Record<Stage, () => Scenario[]> = {
    bare: () => bareStageScenarios(),
    structured: () => structuredStageScenarios(env),
    'ready-to-staff': () => staffingScenarios(env),
    // Privileged-access work joins the ordinary queue once the domain is
    // staffed: PIM is a day-to-day discipline, not a separate mode.
    operating: () => [
      ...operatingScenarios(env),
      ...pimScenarios(env, deps),
      ...cloudScenarios(env, deps),
    ],
  };
  return byStage[env.stage]();
}

// ---------------------------------------------------------------------------
// Ollama
// ---------------------------------------------------------------------------

export { ollamaAvailable } from '@/config/ollama';

/**
 * Ask Ollama to rewrite a scenario as a ticket a colleague would actually send.
 *
 * The scenario decides what the ticket is about; the model only supplies the
 * wording. If it returns something unusable the original text is kept, because
 * a lab that breaks when the model has an off day is worse than a plain one.
 */
async function embellish(scenario: Scenario, env: EnvironmentState): Promise<Scenario> {
  const prompt = [
    'You are writing an IT service desk ticket for an identity administration lab.',
    '',
    'CURRENT ENVIRONMENT — do not contradict any of this:',
    describeForPrompt(env),
    '',
    'The ticket must be about exactly this task:',
    `Subject: ${scenario.subject}`,
    `Task: ${scenario.body}`,
    '',
    'Rewrite it as a short ticket from a colleague. Keep every account name, group name and',
    'OU name exactly as given. Do not invent people, systems or accounts that are not listed',
    'above. Do not add steps that were not in the task. Two or three sentences.',
    '',
    'Reply with JSON only: {"subject": "...", "body": "..."}',
  ].join('\n');

  try {
    const res = await fetch(OLLAMA_GENERATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false, format: 'json' }),
    });
    if (!res.ok) return scenario;
    const data = (await res.json()) as { response?: string };
    const parsed = JSON.parse(data.response ?? '{}') as { subject?: string; body?: string };

    // Guard against a model that drops the account it was told to name: if the
    // rewrite loses the subject of the task, keep the original.
    const namesInOriginal = env.staffLogons.filter((l) => scenario.body.includes(l));
    const keptNames = namesInOriginal.every((l) => (parsed.body ?? '').includes(l));
    if (!parsed.subject || !parsed.body || !keptNames) return scenario;

    return { ...scenario, subject: parsed.subject, body: parsed.body };
  } catch {
    return scenario;
  }
}

// ---------------------------------------------------------------------------
// Raising tickets
// ---------------------------------------------------------------------------

function raise(deps: GeneratorDeps, scenario: Scenario): void {
  const admin = deps.dir.getUserByUsername('admin') ?? deps.dir.listUsers()[0];
  if (!admin) return;

  // Make the scenario true before describing it.
  const related = scenario.prepare?.(deps) ?? [];

  // Payload shape varies per ticket kind and the union is wide; the ticket
  // queue only reads userId, so a narrow cast beats threading every variant.
  const payload = related[0]
    ? { userId: related[0], method: 'helpdesk' as const }
    : { proposedGroupIds: [], proposedRoleIds: [], startDate: Date.now() };

  deps.tickets.create({
    kind: scenario.kind as 'onboarding',
    requesterId: admin.id,
    subject: scenario.subject,
    body: scenario.body,
    priority: scenario.priority,
    relatedUserIds: related,
    // The payload union is per-kind and wide; the queue only reads userId.
    payload: payload as { proposedGroupIds: never[]; proposedRoleIds: never[]; startDate: number },
  });
}

export interface GenerateResult {
  raised: number;
  usedOllama: boolean;
  stage: Stage;
}

/**
 * Raise the work this domain is ready for.
 *
 * Existing open tickets for the same scenario are not duplicated — the queue
 * should grow as the domain does, not repeat itself.
 */
export async function generateTickets(
  deps: GeneratorDeps,
  options: { useOllama?: boolean; max?: number } = {},
): Promise<GenerateResult> {
  const env = readEnvironment(deps.dir);
  const open = deps.tickets.list().filter((t) => t.status !== 'resolved');
  const openSubjects = new Set(open.map((t) => t.subject));

  const candidates = scenariosFor(env, deps)
    .filter((s) => !openSubjects.has(s.subject))
    .slice(0, options.max ?? 3);

  if (candidates.length === 0) {
    return { raised: 0, usedOllama: false, stage: env.stage };
  }

  const useOllama = (options.useOllama ?? true) && (await ollamaAvailable());
  const finalScenarios = useOllama
    ? await Promise.all(candidates.map((s) => embellish(s, env)))
    : candidates;

  for (const s of finalScenarios) raise(deps, s);
  return { raised: finalScenarios.length, usedOllama: useOllama, stage: env.stage };
}

/** Synchronous variant for boot, where waiting on a network call would delay
 *  the first paint. Always uses the built-in scenarios. */
export function generateTicketsSync(deps: GeneratorDeps, max = 3): number {
  const env = readEnvironment(deps.dir);
  const openSubjects = new Set(
    deps.tickets
      .list()
      .filter((t) => t.status !== 'resolved')
      .map((t) => t.subject),
  );
  const candidates = scenariosFor(env, deps)
    .filter((s) => !openSubjects.has(s.subject))
    .slice(0, max);
  for (const s of candidates) raise(deps, s);
  return candidates.length;
}
