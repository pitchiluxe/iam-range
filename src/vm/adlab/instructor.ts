/**
 * vm/adlab/instructor.ts — the Ollama instructor for the AD Enterprise Lab
 * Series.
 *
 *   The validation engine is the examiner. The student is the administrator.
 *   This is the instructor.
 *
 * It observes (a frozen snapshot from observe.ts), teaches, asks, hints and
 * explains. It cannot act: this module imports nothing that changes lab state
 * — not the command engine, not the lab builder — and tests/adLab.test.ts
 * holds it to that. Whatever the model writes is text for the student to read.
 *
 * It never decides correctness either. "Check my work" runs the validation
 * engine first and hands the instructor the results; the prompt forbids it
 * from contradicting them, and the window only ever shows a lab as complete
 * when the engine says so.
 *
 * Without Ollama there is still an instructor: the offline one below builds
 * its replies from the lab definition, the validation results, the hint ladder
 * and the evidence notes. Narrower than the model, never wrong.
 */
import {
  OLLAMA_GENERATE_URL,
  getOllamaModel,
  listOllamaModels,
  pickInstalledModel,
} from '@/config/ollama';
import type { AdLab, InstructorMode } from './labs';
import {
  type Focus,
  type InstructorView,
  describeState,
  evidenceNotes,
  failedAttempts,
  recentActivity,
} from './observe';
import { type ValidationReport, type ValidatorGroup, CHECKS, hintFor } from './validation';

export type { InstructorMode } from './labs';

export const MODE_LABEL: Record<InstructorMode, string> = {
  guided: 'Guided',
  coach: 'Coach',
  interview: 'Interview',
  'real-world': 'Real-World',
};

export const MODE_BLURB: Record<InstructorMode, string> = {
  guided: 'Explains concepts and walks you through the approach step by step. You still type every change.',
  coach: 'Gives objectives and hints; expects you to work out most actions yourself.',
  interview: 'Asks you the questions an interviewer would while you work.',
  'real-world': 'Ticket, business context and resources only. Speaks when asked or when you check your work.',
};

export const METHODOLOGY = [
  'Identify the problem',
  'Gather information',
  'Form a theory',
  'Test the theory',
  'Identify the root cause',
  'Implement the fix (you)',
  'Verify functionality',
  'Document the resolution',
] as const;

export type HintLevel = 1 | 2 | 3;

export const HINT_LEVEL_NAME: Record<HintLevel, string> = {
  1: 'Direction',
  2: 'Investigation',
  3: 'Concept',
};

export interface ChatTurn {
  role: 'student' | 'instructor';
  text: string;
}

/** Everything the instructor remembers about this lab attempt. */
export interface InstructorSession {
  labId: string;
  mode: InstructorMode;
  /** Highest hint rung given, per check. */
  hintLevels: Record<string, HintLevel>;
  /** How many "Check my work" runs a check has failed. */
  failCounts: Record<string, number>;
  checkRuns: number;
  lastReport: ValidationReport | null;
  transcript: ChatTurn[];
  /** Interview questions already asked, by index. */
  interviewAsked: number[];
}

export function newSession(labId: string, mode: InstructorMode): InstructorSession {
  return { labId, mode, hintLevels: {}, failCounts: {}, checkRuns: 0, lastReport: null, transcript: [], interviewAsked: [] };
}

/** Fold a validation report into the session's memory. */
export function recordReport(session: InstructorSession, report: ValidationReport): void {
  session.checkRuns++;
  session.lastReport = report;
  for (const r of report.results) {
    if (!r.pass) session.failCounts[r.id] = (session.failCounts[r.id] ?? 0) + 1;
  }
}

/**
 * The next rung for the first failing check. Null when nothing is failing or
 * the ladder is exhausted for every failing check.
 */
export function nextHint(session: InstructorSession): { checkId: string; level: HintLevel } | null {
  const failing = session.lastReport?.results.filter((r) => !r.pass) ?? [];
  for (const r of failing) {
    const cur = session.hintLevels[r.id] ?? 0;
    if (cur < 3) {
      const level = (cur + 1) as HintLevel;
      session.hintLevels[r.id] = level;
      return { checkId: r.id, level };
    }
  }
  return null;
}

/**
 * Whether the instructor may describe the fix in words.
 *
 * Not trapping the student: after the concept hint, or three failed checks on
 * the same item, or in Guided mode, the instructor can say what the fix is.
 * It still never performs it.
 */
export function revealAllowed(session: InstructorSession, checkId?: string): boolean {
  if (session.mode === 'guided') return true;
  const ids = checkId ? [checkId] : (session.lastReport?.results.filter((r) => !r.pass).map((r) => r.id) ?? []);
  return ids.some((id) => (session.hintLevels[id] ?? 0) >= 3 || (session.failCounts[id] ?? 0) >= 3);
}

const ASKS_FOR_ANSWER = /\b(explain the solution|just tell me|give me the (answer|solution|fix)|what('s| is) the (answer|solution|fix)|how do i fix|what command|show me the command|do it for me|fix it for me)\b/i;

export type InstructorRequest =
  | { kind: 'intro' }
  | { kind: 'check'; report: ValidationReport }
  | { kind: 'hint'; checkId: string; level: HintLevel }
  | { kind: 'ask'; question: string }
  | { kind: 'interview' };

export interface InstructorContext {
  lab: AdLab;
  view: InstructorView;
  session: InstructorSession;
  notes?: string;
}

export interface InstructorReply {
  text: string;
  source: 'ollama' | 'offline';
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const SYSTEM = [
  'You are a senior Windows System Administrator and IAM engineer training a junior technician',
  'inside a simulated Active Directory lab for the company TechnoBiz (domain corp.technobiz.local).',
  '',
  'Hard rules:',
  '- You have READ-ONLY visibility of the lab. You cannot change anything and must never claim or',
  '  offer to: no changing IP or DNS settings, creating users, unlocking accounts, resetting',
  '  passwords, joining computers, configuring DHCP or GPOs. The student performs every change.',
  '- The VALIDATION RESULTS come from a deterministic engine and are the only judge of correctness.',
  '  Never say something is correct, fixed or complete unless the results say so. Never declare the',
  '  lab complete unless every check passed.',
  '- Do not hand over the fix (the exact corrective command or the corrected value) unless the',
  '  section REVEAL says it is allowed. Otherwise teach the troubleshooting method: point at what to',
  '  investigate, which tool to use, and what to compare it with.',
  '- Use only facts from the sections below. Do not invent cmdlets, output or settings.',
  '- Plain text, under 160 words, no markdown headings, no code fences, no bullet lists of tools.',
  '- Talk TO the student directly as "you" (never "the student").',
].join('\n');

const MODE_RULES: Record<InstructorMode, string> = {
  guided:
    'GUIDED MODE: explain the concept behind the current step and walk the student through the approach in ' +
    'order, naming the tool or cmdlet for each step and the values from the REQUIREMENTS. The student types them.',
  coach:
    'COACH MODE: restate the objective, point at what to investigate and which tool shows it, and ask what they ' +
    'found. Do not give complete commands with values.',
  interview:
    'INTERVIEW MODE: behave like an interviewer watching them work. React briefly to what they did, then ask ' +
    'ONE probing question about why, drawn from the lab concepts. Do not give answers to your own question.',
  'real-world':
    'REAL-WORLD MODE: you are the senior technician on the desk. Be brief. Do not reveal the root cause. ' +
    'Answer only what was asked, and ask what they would check next. Reason only from what the student has ' +
    'actually discovered in STUDENT ACTIVITY.',
};

const GROUP_FOCUS: Record<ValidatorGroup, Focus[]> = {
  validateDCNetworking: ['net'],
  validateADDS: ['net', 'roles', 'dns'],
  validateDNS: ['net', 'roles', 'dns'],
  validateRouting: ['net', 'roles', 'routing'],
  validateDHCP: ['net', 'roles', 'dhcp'],
  validateDomainJoin: ['net', 'ad', 'dns'],
  validateOUArchitecture: ['ad'],
  validateUsers: ['ad', 'accounts'],
  validateGroups: ['ad', 'accounts'],
  validateGPO: ['ad', 'gpo'],
  validatePermissions: ['accounts', 'shares'],
  validateTicket: ['net', 'accounts'],
};

/** The parts of the estate this lab is about. */
export function labFocus(lab: AdLab): Focus[] {
  const out = new Set<Focus>();
  for (const id of lab.checks) {
    const g = CHECKS[id]?.group;
    if (g) for (const f of GROUP_FOCUS[g]) out.add(f);
  }
  return [...out];
}

function labSection(lab: AdLab, mode: InstructorMode): string[] {
  const out = [`=== LAB ${String(lab.number).padStart(2, '0')}: ${lab.title} ===`];
  if (lab.ticket) {
    out.push(
      `Ticket ${lab.ticket.id} (${lab.ticket.priority}) — user ${lab.ticket.user}, computer ${lab.ticket.computer}`,
      `Issue: ${lab.ticket.issue}`,
      `Business context: ${lab.ticket.business}`,
    );
  } else out.push(lab.scenario);
  if (mode !== 'real-world') {
    out.push('Objectives:', ...lab.objectives.map((o) => `- ${o}`));
    if (!lab.ticket) out.push('Requirements:', ...lab.requirements.map((r) => `- ${r}`));
  }
  out.push(`Available tools: ${lab.tools.join(', ')}`);
  return out;
}

function hintsSection(ctx: InstructorContext): string[] {
  const failing = ctx.session.lastReport?.results.filter((r) => !r.pass) ?? [];
  if (failing.length === 0) return [];
  const out = ['=== HINTS YOU MAY USE (nothing beyond these rungs) ==='];
  for (const r of failing.slice(0, 3)) {
    // Rung 1 is always available; further rungs only once the student asked for them.
    const upTo = Math.max(1, ctx.session.hintLevels[r.id] ?? 0);
    for (let l = 1; l <= upTo; l++) out.push(`${r.label} — ${HINT_LEVEL_NAME[l as HintLevel]}: ${hintFor(r.id, l as HintLevel)}`);
  }
  return out;
}

/** Build the full prompt. Exported so tests can prove what the model is and is not told. */
export function buildInstructorPrompt(req: InstructorRequest, ctx: InstructorContext): string {
  const { lab, view, session } = ctx;
  const mode = session.mode;
  const parts: string[] = [SYSTEM, '', MODE_RULES[mode], '', `Troubleshooting method you teach: ${METHODOLOGY.map((m, i) => `${i + 1}. ${m}`).join('  ')}`, ''];
  parts.push(...labSection(lab, mode), '');
  parts.push('=== REFERENCE NOTES (correct material you may teach from) ===', ...lab.concepts.map((c) => `- ${c}`), '');

  // The intro sets the scene and needs no state. Real-World mode reasons from
  // what the student has found, not from a privileged view of the answer — the
  // instructor is a colleague, not an oracle.
  const showState = req.kind !== 'intro' && (mode !== 'real-world' || req.kind === 'check');
  if (showState) parts.push('=== LAB STATE (read-only observation) ===', describeState(view, labFocus(lab)), '');
  if (view.history.length) parts.push('=== STUDENT ACTIVITY (most recent last) ===', recentActivity(view, 8), '');
  const failed = failedAttempts(view);
  if (failed.length) parts.push('=== PREVIOUS FAILED ATTEMPTS ===', ...failed, '');
  const ev = evidenceNotes(view);
  if (ev.length) parts.push('=== WHAT THE EVIDENCE ALREADY SHOWS ===', ...ev.map((e) => `- ${e}`), '');

  const report = req.kind === 'check' ? req.report : session.lastReport;
  if (report) {
    parts.push(
      `=== VALIDATION RESULTS (${report.score.passed}/${report.score.total} passed${req.kind === 'check' ? '' : ', from the last check'}) ===`,
      ...(report.results.some((r) => r.pass) ? [`Requirements MET: ${report.results.filter((r) => r.pass).map((r) => r.label).join('; ')}`] : []),
      // Worded as an unmet requirement plus the evidence, so a small model does
      // not read the label ("has no default gateway") as the finding.
      ...report.results.filter((r) => !r.pass).map((r) => `Requirement NOT met: "${r.label}". The engine actually observed: ${r.observed}`),
      '',
    );
  }
  parts.push(...hintsSection(ctx), '');

  const reveal = revealAllowed(session, req.kind === 'hint' ? req.checkId : undefined);
  parts.push('=== REVEAL ===', reveal
    ? 'Allowed: if asked, you may state the fix in words (what to change and to what). The student still performs it; never say you did it.'
    : 'Not allowed yet: do not state the corrective command or value. Guide the investigation instead.', '');

  const convo = session.transcript.slice(-6);
  if (convo.length) parts.push('=== CONVERSATION SO FAR ===', ...convo.map((t) => `${t.role === 'student' ? 'Student' : 'You'}: ${t.text}`), '');

  parts.push('=== YOUR TASK ===');
  switch (req.kind) {
    case 'intro':
      parts.push(mode === 'real-world'
        ? 'Hand the student the ticket as a senior colleague would, in two or three sentences, then ask: "What would you check first?" Do not suggest a cause.'
        : `Welcome the student to Lab ${String(lab.number).padStart(2, '0')}: ${lab.title}. Set the business scenario, then briefly list the objectives, the expected result and the tools. Do not give the solution.`);
      break;
    case 'check':
      parts.push(report?.passed
        ? 'Every check passed. Congratulate them briefly, ask them to explain in one sentence why their configuration works, and remind them to document what they did.'
        : 'Interpret the validation results for the student: what is already correct, and what still needs investigation. If failures look related, say so. Tell them where to START investigating and which tool shows it. Do not fix it and do not give the corrected value unless REVEAL allows.');
      break;
    case 'hint':
      parts.push(`Give the student this ${HINT_LEVEL_NAME[req.level]} hint for "${CHECKS[req.checkId]?.label ?? req.checkId}" in your own words, without going beyond it: ${hintFor(req.checkId, req.level)}`);
      break;
    case 'ask':
      if (ASKS_FOR_ANSWER.test(req.question) && !reveal) {
        parts.push(`The student asked: "${req.question}". They have not earned the answer yet. Do not give it. Say "Let's diagnose it", list two or three concrete things to check and which tool shows each, and ask them to tell you what they find.`);
      } else parts.push(`The student asks: "${req.question}". Answer as their instructor in this mode.`);
      break;
    case 'interview': {
      const q = nextInterviewQuestion(session, lab, false);
      parts.push(`Ask the student this interview question, in your own words, and nothing else: ${q ?? 'Ask them to summarise what they built and why.'}`);
      break;
    }
  }
  return parts.join('\n');
}

function nextInterviewQuestion(session: InstructorSession, lab: AdLab, record: boolean): string | null {
  const idx = lab.interviewQuestions.findIndex((_, i) => !session.interviewAsked.includes(i));
  if (idx < 0) return null;
  if (record) session.interviewAsked.push(idx);
  return lab.interviewQuestions[idx]!;
}

// ---------------------------------------------------------------------------
// Offline instructor
// ---------------------------------------------------------------------------

export function offlineInstructor(req: InstructorRequest, ctx: InstructorContext): string {
  const { lab, view, session } = ctx;
  const n = String(lab.number).padStart(2, '0');
  switch (req.kind) {
    case 'intro': {
      if (session.mode === 'real-world' && lab.ticket) {
        const t = lab.ticket;
        return [
          `${t.id} just landed in your queue (${t.priority}).`,
          '',
          `USER: ${t.user}`,
          `COMPUTER: ${t.computer}`,
          `ISSUE: ${t.issue}`,
          `BUSINESS: ${t.business}`,
          '',
          `Resources: DC01 and CLIENT01 consoles. Tools: ${lab.tools.join(', ')}.`,
          '',
          'What would you check first?',
        ].join('\n');
      }
      const lines = [`Welcome to Lab ${n}: ${lab.title}.`, '', lab.ticket ? `${lab.ticket.id}: ${lab.ticket.issue}\n${lab.ticket.business}` : lab.scenario, ''];
      lines.push('OBJECTIVES', ...lab.objectives.map((o) => `  • ${o}`), '');
      if (!lab.ticket) lines.push('REQUIREMENTS', ...lab.requirements.map((r) => `  • ${r}`), '');
      lines.push('EXPECTED RESULT', `  ${lab.expectedResult}`, '', 'AVAILABLE TOOLS', `  ${lab.tools.join(', ')}`, '');
      lines.push(session.mode === 'guided'
        ? 'Start with the first objective. Look at the current state before you change anything, and ask me about any step.'
        : 'Work through it your way. Click "Check my work" whenever you want the validation engine to examine the lab.');
      return lines.join('\n');
    }
    case 'check': {
      const r = req.report;
      if (r.passed) {
        return `All ${r.score.total} checks passed — the validation engine confirms Lab ${n} is complete.\n\n` +
          'Before you move on: in one sentence, why does your configuration work? Then document what you changed.';
      }
      const good = r.results.filter((x) => x.pass);
      const bad = r.results.filter((x) => !x.pass);
      const lines = [`${r.score.passed} of ${r.score.total} checks pass.`, ''];
      if (good.length) lines.push(`Correct so far: ${good.map((x) => x.label).join('; ')}.`, '');
      lines.push(`Still needs investigation: ${bad.map((x) => x.label).join('; ')}.`, '');
      const first = bad[0]!;
      lines.push(`Start with "${first.label}". ${hintFor(first.id, Math.max(1, session.hintLevels[first.id] ?? 1) as HintLevel)}`);
      const ev = evidenceNotes(view);
      if (ev.length) lines.push('', `What your own commands already show: ${ev[0]}`);
      if (bad.length > 1) lines.push('', 'Several failures can share one cause — fix the first, then check again.');
      return lines.join('\n');
    }
    case 'hint':
      return `Hint ${req.level} — ${HINT_LEVEL_NAME[req.level]} (${CHECKS[req.checkId]?.label ?? req.checkId}):\n\n${hintFor(req.checkId, req.level)}\n\nTell me what you find.`;
    case 'interview': {
      const q = nextInterviewQuestion(session, lab, false);
      return q ? `Interview question: ${q}` : 'That is every question I have for this lab. Summarise what you built and why, as you would to a hiring manager.';
    }
    case 'ask': {
      const ev = evidenceNotes(view);
      const failing = session.lastReport?.results.filter((r) => !r.pass) ?? [];
      const reveal = revealAllowed(session);
      if (ASKS_FOR_ANSWER.test(req.question) && !reveal) {
        const f = failing[0];
        return [
          'Let\'s diagnose it rather than jump to the answer.',
          '',
          f ? `Start here: ${hintFor(f.id, 2)}` : 'Click "Check my work" first so we know exactly what is failing.',
          ...(ev.length ? ['', `Your own evidence so far: ${ev.join(' ')}`] : []),
          '',
          'Tell me what you find. If you are still stuck after the third hint, I will explain the fix in words — you will still make the change yourself.',
        ].join('\n');
      }
      if (ASKS_FOR_ANSWER.test(req.question) && reveal && failing[0]) {
        const f = failing[0];
        return [
          `You have worked "${f.label}" hard enough — here is the reasoning in full.`,
          '',
          hintFor(f.id, 3),
          '',
          `What the engine sees: ${f.observed}`,
          `What the lab requires: ${lab.requirements.join('; ')}.`,
          '',
          'Make the change yourself, verify it, then click "Check my work".',
        ].join('\n');
      }
      const lines = [`Ollama is offline, so I can only answer from the lab material.`];
      if (ev.length) lines.push('', ...ev);
      lines.push('', 'Reference notes for this lab:', ...lab.concepts.map((c) => `  • ${c}`));
      lines.push('', `Method: ${METHODOLOGY.join(' → ')}.`);
      return lines.join('\n');
    }
  }
}

// ---------------------------------------------------------------------------
// Asking the model
// ---------------------------------------------------------------------------

/**
 * A model that says it changed something is wrong about what it can do. The
 * lab is untouched either way; this makes sure the student is not misled.
 */
const CLAIMS_ACTION = /\bI(?:'ve| have| just| went ahead and)\s+(?:\w+\s+)?(changed|fixed|updated|unlocked|reset|configured|set|joined|created|modified|enabled|restarted|corrected)\b/i;

export function guardReply(text: string): string {
  if (!CLAIMS_ACTION.test(text)) return text;
  return `${text}\n\n(Note: the instructor has read-only access and has not changed your lab. Every change is yours to make.)`;
}

export interface InstructorStatus {
  online: boolean;
  /** The installed model the instructor will use, when online. */
  model: string | null;
  /** Why it is offline, for the badge's tooltip. */
  reason?: 'unreachable' | 'no-models';
}

/** Is Ollama answering, and with which model? */
export async function instructorStatus(fetchImpl: typeof fetch = fetch): Promise<InstructorStatus> {
  const models = await listOllamaModels(1500, fetchImpl);
  if (models === null) return { online: false, model: null, reason: 'unreachable' };
  const model = pickInstalledModel(models, getOllamaModel());
  if (!model) return { online: false, model: null, reason: 'no-models' };
  return { online: true, model };
}

/**
 * Ask the instructor. Records the exchange in the session transcript and never
 * throws: any failure is answered by the offline instructor.
 */
export async function askInstructor(
  req: InstructorRequest,
  ctx: InstructorContext,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number; model?: string | null } = {},
): Promise<InstructorReply> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  if (req.kind === 'ask') ctx.session.transcript.push({ role: 'student', text: req.question });

  const finish = (text: string, source: InstructorReply['source']): InstructorReply => {
    if (req.kind === 'interview') nextInterviewQuestion(ctx.session, ctx.lab, true);
    ctx.session.transcript.push({ role: 'instructor', text });
    if (ctx.session.transcript.length > 40) ctx.session.transcript.splice(0, ctx.session.transcript.length - 40);
    return { text, source };
  };

  let model = opts.model;
  if (model === undefined) model = (await instructorStatus(fetchImpl)).model;
  if (!model) return finish(offlineInstructor(req, ctx), 'offline');

  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 120_000);
    const res = await fetchImpl(OLLAMA_GENERATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: buildInstructorPrompt(req, ctx),
        stream: false,
        keep_alive: '15m',
        options: { temperature: 0.3, num_predict: 280 },
      }),
      signal: ctl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return finish(offlineInstructor(req, ctx), 'offline');
    const data = (await res.json()) as { response?: string };
    const text = data.response?.trim();
    if (!text) return finish(offlineInstructor(req, ctx), 'offline');
    return finish(guardReply(text), 'ollama');
  } catch {
    return finish(offlineInstructor(req, ctx), 'offline');
  }
}
