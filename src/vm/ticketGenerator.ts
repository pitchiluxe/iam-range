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
import type { MockAuditLog, MockDirectory, MockTicketQueue } from '@/services';
import type { Ticket, TicketKind, UserId } from '@/domain';
import { readEnvironment, type EnvironmentState, type Stage } from './environmentStage';
import { describeForPrompt } from './environmentStage';

export interface GeneratorDeps {
  dir: MockDirectory;
  tickets: MockTicketQueue;
  audit: MockAuditLog;
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

function scenariosFor(env: EnvironmentState): Scenario[] {
  const byStage: Record<Stage, () => Scenario[]> = {
    bare: () => bareStageScenarios(),
    structured: () => structuredStageScenarios(env),
    'ready-to-staff': () => staffingScenarios(env),
    operating: () => operatingScenarios(env),
  };
  return byStage[env.stage]();
}

// ---------------------------------------------------------------------------
// Ollama
// ---------------------------------------------------------------------------

const OLLAMA_URL = 'http://localhost:11434';
const OLLAMA_MODEL = 'llama3.2';

/** Whether a local Ollama is answering. Cached per call site, not globally:
 *  the user may start it while the workstation is open. */
export async function ollamaAvailable(timeoutMs = 1200): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: ctl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

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
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
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

  const candidates = scenariosFor(env)
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
  const candidates = scenariosFor(env)
    .filter((s) => !openSubjects.has(s.subject))
    .slice(0, max);
  for (const s of candidates) raise(deps, s);
  return candidates.length;
}
