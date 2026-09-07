/**
 * vm/tutor.ts — the in-OS IAM/PIM tutor.
 *
 * Three things are deliberate here.
 *
 * **It retrieves before it answers.** Every question first pulls the closest
 * articles out of config/knowledgeBase.ts, and those articles go into the
 * prompt as the material the answer must be built from. A small local model
 * asked about PIM will produce fluent, confident, occasionally wrong prose,
 * and a learner preparing for interviews cannot tell the difference. Grounding
 * it in written material — and naming that material in the reply — makes an
 * answer checkable rather than authoritative.
 *
 * **It knows where you are.** The current stage of the domain and the ticket
 * you are working goes into the prompt, so "what should I do next" is answered
 * about *this* environment rather than about identity management in general.
 *
 * **It asks before it tells.** Socratic is the default mode; the learner has to
 * switch to explain mode to be handed the answer. That is the tutor rule this
 * whole project is built on: a tutor that solves the lab has removed the lab.
 *
 * Without Ollama there is still a tutor. The offline answer is the retrieved
 * article plus the Socratic question for its topic — narrower than the model's,
 * and never wrong, because it is quoting material rather than generating it.
 */
import { searchArticles, type Article } from '@/config/knowledgeBase';
import {
  OLLAMA_GENERATE_URL,
  OLLAMA_MODEL,
  ollamaAvailable,
} from '@/config/ollama';
import type { EnvironmentState } from './environmentStage';
import { describeForPrompt, STAGE_SUMMARY } from './environmentStage';


/**
 * How much the tutor is willing to give away.
 *
 * `socratic` asks the question that gets the learner to the answer.
 * `explain` teaches the concept directly, still without touching their lab.
 * `walkthrough` names the actual steps — the escape hatch for someone properly
 * stuck, chosen deliberately rather than arrived at by accident.
 */
export type TutorMode = 'socratic' | 'explain' | 'walkthrough';

export const MODE_LABEL: Record<TutorMode, string> = {
  socratic: 'Ask me questions',
  explain: 'Explain the concept',
  walkthrough: 'Walk me through it',
};

const MODE_INSTRUCTION: Record<TutorMode, string> = {
  socratic:
    'Do NOT give the answer. Ask one focused question that moves the learner towards it, ' +
    'and say what evidence would settle it. Two or three sentences.',
  explain:
    'Explain the underlying concept clearly, in a short paragraph. Say why it matters ' +
    'operationally. Do not perform the task for them and do not list the exact commands.',
  walkthrough:
    'The learner is stuck and has asked for the steps. Give them, numbered, in order, ' +
    'naming the cmdlet or the console for each. Say what to check afterwards to prove it worked.',
};

export interface TutorContext {
  env: EnvironmentState;
  /** The ticket the learner is on, if any. */
  ticket?: { subject: string; body: string };
  mode: TutorMode;
}

export interface TutorAnswer {
  text: string;
  /** Articles the answer was built from — shown so it can be checked. */
  citations: Article[];
  source: 'ollama' | 'offline';
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

const SYSTEM = [
  'You are the tutor built into an identity administration training workstation.',
  'You teach Identity and Access Management (IAM) and Privileged Identity Management (PIM)',
  'to people preparing for identity engineering and service desk roles.',
  '',
  'Rules you must follow:',
  '- Answer ONLY from the reference material provided below. If it does not cover the',
  '  question, say so plainly and name the nearest thing it does cover. Never invent',
  '  cmdlets, product behaviour, or configuration you were not given.',
  '- Talk about the learner\'s actual environment, described below, not a generic one.',
  '- Be concrete and operational. Prefer what to check and why over definitions.',
  '- Never claim to have performed an action. You cannot change their environment.',
  '- Plain text. No markdown headings, no code fences.',
].join('\n');

/**
 * How much of each article the model is sent.
 *
 * Whole articles made the prompt around seven thousand characters, and a
 * CPU-bound local model took longer than the request timeout to answer — the
 * learner waited three quarters of a minute and got the offline reply anyway.
 * The lead paragraphs carry the substance; the interview note and the failure
 * list mostly cost tokens.
 */
const PROMPT_ARTICLE_CHARS = 1200;

function forPrompt(a: Article): string {
  const body = a.body.length <= PROMPT_ARTICLE_CHARS
    ? a.body
    : `${a.body.slice(0, PROMPT_ARTICLE_CHARS).trimEnd()}…`;
  return `--- ${a.title} ---
${body}
`;
}

/** The material and situation the model is allowed to answer from. */
export function buildPrompt(question: string, ctx: TutorContext, articles: Article[]): string {
  const parts: string[] = [SYSTEM, '', '=== REFERENCE MATERIAL ==='];

  if (articles.length === 0) {
    parts.push('(No article matched this question. Say the material does not cover it.)');
  } else {
    // Two articles, not three: the third was almost always a weak match paying
    // full price in latency.
    for (const a of articles.slice(0, 2)) parts.push(forPrompt(a));
  }

  parts.push(
    '=== THE LEARNER\'S ENVIRONMENT ===',
    describeForPrompt(ctx.env),
    `Stage: ${STAGE_SUMMARY[ctx.env.stage].title} — ${STAGE_SUMMARY[ctx.env.stage].detail}`,
  );

  if (ctx.ticket) {
    parts.push(
      '',
      '=== THE TICKET THEY ARE WORKING ===',
      `Subject: ${ctx.ticket.subject}`,
      ctx.ticket.body,
    );
  }

  parts.push(
    '',
    '=== HOW TO ANSWER ===',
    MODE_INSTRUCTION[ctx.mode],
    '',
    '=== THE LEARNER ASKS ===',
    question,
  );

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Offline answers
// ---------------------------------------------------------------------------

/**
 * The Socratic question for each topic.
 *
 * These are the questions an interviewer actually asks, which is why they are
 * worth being asked by a tutor. They are also the offline mode's whole
 * contribution in `socratic` — quoting a question is honest in a way that
 * generating an answer without a model is not.
 */
const TOPIC_QUESTION: Record<Article['topic'], string> = {
  directory:
    'Before you change anything: what decides where this object belongs — who needs to ' +
    'administer it, or which policy has to reach it?',
  lifecycle:
    'What has to be *removed* here, not just added? And how would you prove afterwards that ' +
    'it was?',
  access:
    'Is this access being granted to a person or to a group — and if that person left ' +
    'tomorrow, where would you look to take it back?',
  privileged:
    'Does this person need to *hold* the role, or to be *able to take it up*? What would ' +
    'end the access if nobody remembered to?',
  authentication:
    'Is this failing before the application or after it? Which log would tell you which, ' +
    'and what would each one look like?',
  operations:
    'What is your evidence — what did the state look like before, and what proves the ' +
    'change took effect rather than merely being attempted?',
};

/**
 * Answer without a model.
 *
 * Narrow on purpose: it quotes the article and asks the topic's question. It
 * cannot be wrong about IAM, because it is not composing anything about IAM.
 */
export function offlineAnswer(question: string, ctx: TutorContext): TutorAnswer {
  const articles = searchArticles(question, 2);
  const top = articles[0];

  if (!top) {
    return {
      text:
        'Nothing in the reference material matches that. Open Documentation and browse by ' +
        'topic — or ask about OUs, groups, joiner/mover/leaver, least privilege, PIM, ' +
        'lockouts, SSO, MFA, access reviews, service accounts, Okta and Entra, or audit ' +
        'evidence.',
      citations: [],
      source: 'offline',
    };
  }

  const lines: string[] = [];

  if (ctx.mode === 'socratic') {
    lines.push(TOPIC_QUESTION[top.topic], '', `The material that answers it is "${top.title}":`);
  } else {
    lines.push(`From "${top.title}":`);
  }

  // Lead with the article. In explain and walkthrough the learner asked to be
  // told, so give them more of it.
  lines.push('', excerpt(top.body, ctx.mode === 'socratic' ? 2 : 5));

  if (ctx.mode === 'walkthrough') {
    lines.push(
      '',
      'Ollama is not running, so I cannot tailor the steps to your environment. Open ' +
        'Documentation for the full article, and the ticket for the accounts it names.',
    );
  }

  return { text: lines.join('\n'), citations: articles, source: 'offline' };
}

/** First N paragraphs of an article, for a reply rather than a page. */
function excerpt(body: string, paragraphs: number): string {
  return body
    .split(/\n\s*\n/)
    .slice(0, paragraphs)
    .join('\n\n')
    .trim();
}

// ---------------------------------------------------------------------------
// Asking
// ---------------------------------------------------------------------------

/** Whether the tutor will compose an answer or quote one. Named for what the
 *  caller is asking about; the probe itself is shared. */
export const tutorAvailable = ollamaAvailable;

/**
 * Ask the tutor.
 *
 * Any failure — unreachable, slow, empty response — falls through to the
 * offline answer rather than surfacing an error. The learner asked a question
 * about their lab; whether a local model happened to be running is not their
 * problem to solve mid-ticket.
 */
export async function askTutor(
  question: string,
  ctx: TutorContext,
  opts: { timeoutMs?: number } = {},
): Promise<TutorAnswer> {
  const articles = searchArticles(question, 3);
  const prompt = buildPrompt(question, ctx, articles);

  try {
    const ctl = new AbortController();
    // Generous, because the first question after boot also pays for loading
    // the model. Subsequent ones are much faster thanks to keep_alive below.
    const t = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 120_000);
    const res = await fetch(OLLAMA_GENERATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        // Keep the model resident between questions — otherwise every question
        // pays the load cost again.
        keep_alive: '15m',
        // A tutor reply is a few sentences. Without a cap the model rambles,
        // and every extra token is latency the learner waits through.
        options: { temperature: 0.4, num_predict: 320 },
      }),
      signal: ctl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return offlineAnswer(question, ctx);

    const data = (await res.json()) as { response?: string };
    const text = data.response?.trim();
    if (!text) return offlineAnswer(question, ctx);

    return { text, citations: articles, source: 'ollama' };
  } catch {
    return offlineAnswer(question, ctx);
  }
}

/**
 * Openers the tutor offers when you have not asked anything yet.
 *
 * Chosen from the stage, because "what should I be doing" has a different
 * answer in a bare domain than in an operating one, and a learner staring at
 * an empty directory usually does not know what to ask.
 */
export function suggestedQuestions(env: EnvironmentState): string[] {
  const common = ['What does an IAM engineer actually do all day?'];
  switch (env.stage) {
    case 'bare':
      return [
        'Why do I need organisational units before anything else?',
        'How should I structure the OUs for this domain?',
        ...common,
      ];
    case 'structured':
      return [
        'Why grant access to groups instead of directly to people?',
        'What groups should exist in a domain this size?',
        ...common,
      ];
    case 'ready-to-staff':
      return [
        'What are the steps of a proper joiner process?',
        'What do I have to remove when someone changes team?',
        ...common,
      ];
    case 'operating':
      return [
        'What is the difference between eligible and active in PIM?',
        'This user cannot sign in — how do I tell locked from disabled?',
        'What does an access review look for?',
      ];
  }
}
