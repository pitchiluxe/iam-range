/**
 * vm/portfolio/instructor.ts — the Ollama instructor for the 10-project IAM
 * portfolio.
 *
 * It speaks with the exact system prompt in the shared config (code reviewer,
 * security auditor, SOX/SOC 2 compliance auditor, hints before answers). What
 * is objectively wrong comes from lint.ts and is handed over as fact; the
 * model explains, grades against the rubric and coaches. It never marks a
 * project complete — completion is the learner's own attestation.
 */
import {
  getChosenOllamaModel,
  getOllamaModel,
  listOllamaModels,
  ollamaStream,
  pickInstalledModel, ollamaFetch } from '@/config/ollama';
import { PORTFOLIO, SYSTEM_PROMPT, type PortfolioProject } from './config';
import type { Finding } from './lint';
import type { VmCheckResult } from './vmChecks';

export type HintLevel = 1 | 2 | 3;

export interface PortfolioTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface ProjectSession {
  projectId: string;
  /** Deliverable indexes the learner has ticked (self-attested). */
  done: number[];
  submission: string;
  findings: Finding[];
  reviewed: boolean;
  hintLevel: 0 | HintLevel;
  transcript: PortfolioTurn[];
}

export function newProjectSession(projectId: string): ProjectSession {
  return { projectId, done: [], submission: '', findings: [], reviewed: false, hintLevel: 0, transcript: [] };
}

/** Forget the conversation only — the submission, findings and hint level stay. */
export function clearProjectConversation(s: ProjectSession): void {
  s.transcript = [];
}

export type PortfolioRequest =
  | { kind: 'intro' }
  | { kind: 'review' }
  | { kind: 'hint'; level: HintLevel }
  | { kind: 'ask'; question: string }
  | { kind: 'vmCheck'; results: VmCheckResult[] };

export interface PortfolioReply {
  text: string;
  source: 'ollama' | 'offline';
}

const HINT_STEP: Record<HintLevel, string> = {
  1: 'Give a DIRECTION hint only: where to look. No commands, no answer.',
  2: 'Give an INVESTIGATION hint: which tool, log, API or error to examine and what to read in it. No answer.',
  3: 'Give a CONCEPT hint: the principle and the documentation topic to read. Still do not write the solution.',
};

function projectBlock(p: PortfolioProject, s: ProjectSession): string {
  return [
    `PROJECT ${p.number}: ${p.title}`,
    `Phase: ${PORTFOLIO.phases.find((ph) => ph.id === p.phase)?.title ?? p.phase}`,
    `Objective: ${p.objective}`,
    `Lab setup: ${p.labSetup}`,
    `Execution: ${p.execution}`,
    `Portfolio deliverable: ${p.portfolioDeliverable}`,
    ...(p.vm.supported ? [`VM track on ${p.vm.host}: ${p.vm.summary}`, ...p.vm.tasks.map((t) => `  - ${t}`)] : []),
    'Deliverables (learner self-attestation):',
    ...p.deliverables.map((d, i) => `  [${s.done.includes(i) ? 'x' : ' '}] ${d}`),
    `Review focus: ${p.reviewFocus.join('; ')}`,
    `Rubric (score each 0-4): ${PORTFOLIO.rubric.map((r) => `${r.name} — ${r.description}`).join(' | ')}`,
  ].join('\n');
}

function findingsBlock(findings: Finding[]): string {
  if (findings.length === 0) return 'DETERMINISTIC CHECKER: no rule matched. That does not mean the submission is correct; review it yourself.';
  return [
    'DETERMINISTIC CHECKER FINDINGS (facts — do not contradict or downgrade them). You may add your own only if you quote the exact line; label them "Instructor assessment":',
    ...findings.map((f, i) => `${i + 1}. [${f.severity}] ${f.title} — ${f.control} — ${f.line ? `line ${f.line}: ` : ''}${f.evidence}`),
  ].join('\n');
}

/** The messages sent to /api/chat. Exported so tests can see what the model is told. */
export function buildPortfolioMessages(
  req: PortfolioRequest,
  p: PortfolioProject,
  s: ProjectSession,
): { role: 'system' | 'user' | 'assistant'; content: string }[] {
  const context = [projectBlock(p, s)];
  if (s.submission.trim()) {
    context.push('', 'CURRENT SUBMISSION (numbered):',
      s.submission.split(/\r?\n/).slice(0, 220).map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join('\n'));
    context.push('', findingsBlock(s.findings));
  } else {
    context.push('', 'The learner has not submitted any code or policy yet.');
  }

  let task: string;
  switch (req.kind) {
    case 'intro':
      task = 'Introduce this project in under 150 words: the business risk it addresses, what an auditor will ask for, and ONE question the learner should answer before writing any code. No solution.';
      break;
    case 'review':
      task = 'Review the submission. Start with the checker findings, then add your own. Use the numbered finding format (Severity, Control, Evidence, Hint). Then score the rubric 0-4 per criterion with a total /20 and name the single highest-risk gap. Hints, not fixes.';
      break;
    case 'hint':
      task = `${HINT_STEP[req.level]} Base it on the most serious open issue for this project.`;
      break;
    case 'ask':
      task = `The learner asks: "${req.question}". Answer as the instructor, following every rule (hints before answers).`;
      break;
    case 'vmCheck':
      task = [
        "The deterministic checker just graded the learner's work on the REAL DC01 VM. These results are facts; never contradict them and never call a failed check passed.",
        ...req.results.map((r) => `- ${r.pass ? 'PASS' : 'FAIL'} ${r.label} — observed: ${r.observed}`),
        'Explain what is already right, then where to start on the first failing check, as a hint (not the fix). If everything passed, ask one audit question about their evidence and remind them of the portfolio deliverable.',
      ].join('\n');
      break;
  }

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: context.join('\n') },
    { role: 'assistant', content: 'Understood. I have the project, the submission and the checker findings.' },
    ...s.transcript.slice(-6).map((t) => ({ role: t.role, content: t.text })),
    { role: 'user', content: task },
  ];
}

/** What the learner gets when Ollama is not running: rules-based, never invented. */
export function offlinePortfolioReply(req: PortfolioRequest, p: PortfolioProject, s: ProjectSession): string {
  switch (req.kind) {
    case 'intro':
      return `### Project ${p.number}: ${p.title}\n\n${p.objective}\n\n**Before writing code:** what evidence would prove to an auditor that this control works, and who approves each change?\n\n### Deliverables\n${p.deliverables.map((d) => `- ${d}`).join('\n')}`;
    case 'review': {
      if (!s.submission.trim()) return 'Paste a script, policy or query first, then run the review.';
      if (s.findings.length === 0) {
        return `The checker found **no rule violations**. That is not a pass — review it yourself against this project's focus:\n\n${p.reviewFocus.map((f) => `- ${f}`).join('\n')}`;
      }
      return ['### Findings (deterministic checker)', '', ...s.findings.map((f, i) =>
        `${i + 1}. [${f.severity}] **${f.title}**\n   Control: ${f.control}\n   Evidence: ${f.line ? `line ${f.line}: ` : ''}\`${f.evidence}\`\n   *Hint:* ${f.hint}`),
        '', '*Ollama is offline: this is the checker only, without the instructor\'s review and rubric score.*'].join('\n');
    }
    case 'hint': {
      const top = s.findings[0];
      if (top) return `**Hint ${req.level}/3 — ${req.level === 1 ? 'Direction' : req.level === 2 ? 'Investigation' : 'Concept'}**\n\n${top.hint}`;
      return `**Hint ${req.level}/3:** compare your work with this review focus — ${p.reviewFocus[Math.min(req.level - 1, p.reviewFocus.length - 1)] ?? p.reviewFocus[0]}.`;
    }
    case 'vmCheck': {
      const failed = req.results.filter((r) => !r.pass);
      const lines = [`### DC01 check: ${req.results.length - failed.length}/${req.results.length} passed`, ''];
      for (const r of req.results) lines.push(`- ${r.pass ? '✅' : '❌'} **${r.label}** — ${r.observed}`);
      if (failed[0]) lines.push('', `**Start here:** ${failed[0].hint}`);
      else lines.push('', `**All checks passed.** Now build the portfolio deliverable: ${p.portfolioDeliverable}`);
      return lines.join('\n');
    }
    case 'ask':
      return `*Ollama is offline, so I can only point you at the project material.*\n\n**Objective:** ${p.objective}\n\n**Review focus:**\n${p.reviewFocus.map((f) => `- ${f}`).join('\n')}`;
  }
}

export interface PortfolioStatus {
  online: boolean;
  model: string | null;
  message: string;
}

/**
 * The last model that answered. While Ollama is busy generating, /api/tags can
 * be slower than the status timeout; that is "busy", not "offline", so a model
 * that worked a moment ago is still used rather than falling back.
 */
let lastModel: string | null = null;

/** The Ollama verification the workspace scripts perform, done from the app. */
export async function portfolioStatus(fetchImpl: typeof fetch = ollamaFetch): Promise<PortfolioStatus> {
  // A cold or busy Ollama can miss the first window; one longer retry before "offline".
  const models = (await listOllamaModels(5000, fetchImpl)) ?? (await listOllamaModels(12_000, fetchImpl));
  if (!models) return { online: false, model: null, message: PORTFOLIO.verification.failureMessage };
  let model: string | null = null;
  // An explicit choice in Settings wins; otherwise the portfolio's own preference
  // (larger models such as llama3 review policies more reliably than llama3.2).
  const chosen = getChosenOllamaModel();
  for (const preferred of [...(chosen ? [chosen] : []), ...PORTFOLIO.ollama.preferredModels]) {
    const hit = models.find((m) => m === preferred || m === `${preferred}:latest` || m.startsWith(`${preferred}:`));
    if (hit) { model = hit; break; }
  }
  model ??= pickInstalledModel(models, getOllamaModel());
  if (!model) return { online: false, model: null, message: 'Ollama is running but has no models. Run: ollama pull llama3' };
  return { online: true, model, message: PORTFOLIO.verification.successMessage };
}

export async function askPortfolioInstructor(
  req: PortfolioRequest,
  p: PortfolioProject,
  s: ProjectSession,
  opts: {
    fetchImpl?: typeof fetch;
    model?: string | null;
    timeoutMs?: number;
    /** Stream the reply: called with the growing text as tokens arrive. */
    onText?: (text: string) => void;
  } = {},
): Promise<PortfolioReply> {
  const fetchImpl = opts.fetchImpl ?? ollamaFetch;
  if (req.kind === 'ask') s.transcript.push({ role: 'user', text: req.question });
  const finish = (text: string, source: PortfolioReply['source']): PortfolioReply => {
    s.transcript.push({ role: 'assistant', text });
    if (s.transcript.length > 40) s.transcript.splice(0, s.transcript.length - 40);
    return { text, source };
  };

  let model = opts.model;
  if (model === undefined) model = (await portfolioStatus(fetchImpl)).model ?? lastModel;
  if (!model) return finish(offlinePortfolioReply(req, p, s), 'offline');

  const body = {
    model,
    messages: buildPortfolioMessages(req, p, s),
    keep_alive: PORTFOLIO.ollama.keepAlive,
    options: PORTFOLIO.ollama.options,
  };
  if (opts.onText) {
    const text = await ollamaStream(`${PORTFOLIO.ollama.endpoint}${PORTFOLIO.ollama.chatPath}`, body, opts.onText, {
      fetchImpl,
      idleMs: opts.timeoutMs ?? 180_000,
    });
    if (text) {
      lastModel = model;
      return finish(text.trim(), 'ollama');
    }
    return finish(offlinePortfolioReply(req, p, s), 'offline');
  }

  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 180_000);
    const res = await fetchImpl(`${PORTFOLIO.ollama.endpoint}${PORTFOLIO.ollama.chatPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, stream: false }),
      signal: ctl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return finish(offlinePortfolioReply(req, p, s), 'offline');
    const data = (await res.json()) as { message?: { content?: string } };
    const text = data.message?.content?.trim();
    if (text) lastModel = model;
    return text ? finish(text, 'ollama') : finish(offlinePortfolioReply(req, p, s), 'offline');
  } catch {
    return finish(offlinePortfolioReply(req, p, s), 'offline');
  }
}
