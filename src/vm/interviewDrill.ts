/**
 * vm/interviewDrill.ts — rehearsing the answers out loud.
 *
 * Every lesson already carried an `interview` field: the question an
 * interviewer asks about that topic and what a good answer contains. It was
 * shown as a paragraph in the manual, next to the lesson, where it is read
 * once and nodded at. Reading a good answer and being able to give one under
 * time pressure are different skills, and only the second one gets anybody a
 * job.
 *
 * So the field is split into its two halves and used as a drill: the question
 * on its own with a clock running, your answer typed before you see anything
 * else, and only then the model answer to compare against. Revealing the model
 * answer is one-way per question — once seen, that question is marked as
 * prompted, because an answer written with the model answer already on screen
 * is not evidence of anything.
 *
 * Scoring is deliberately not automated. There is no grader here that can
 * judge a free-text answer about delegation, and a scored drill that marks a
 * right answer wrong teaches people to write for the marker. The learner rates
 * their own recall, and — this is the important part — none of it feeds Lab
 * Plan. Progress there stays derived from the estate. A drill is practice, not
 * evidence, and mixing the two would put a self-report back into the one place
 * this product keeps free of them.
 *
 * A model, when one is running, writes a critique of the answer. It never
 * scores it: the same rule the ticket review follows, where checks decide and
 * the model only writes prose.
 */
import { MANUAL } from '@/config/manual';
import { OLLAMA_GENERATE_URL, OLLAMA_MODEL, ollamaAvailable } from '@/config/ollama';

export interface DrillQuestion {
  /** The lesson this came from. */
  lessonId: string;
  chapterId: string;
  chapterTitle: string;
  lessonTitle: string;
  /** What the interviewer asks. */
  question: string;
  /** What a good answer contains. */
  modelAnswer: string;
}

export type Recall = 'missed' | 'partial' | 'solid';

export interface DrillAnswer {
  lessonId: string;
  /** What the learner typed. */
  text: string;
  /** Seconds spent before submitting. */
  seconds: number;
  /** Whether the model answer was revealed before answering. */
  prompted: boolean;
  /** The learner's own rating of their recall. */
  recall: Recall;
}

/**
 * Split an interview field into question and model answer.
 *
 * Every one is written as `"The question?" What a good answer contains.` — the
 * shape is checked by a test rather than assumed, because a field that stopped
 * matching would otherwise show a learner the whole answer as the question.
 */
export function splitInterview(text: string): { question: string; modelAnswer: string } | null {
  const trimmed = text.trim();
  // Straight or curly quotes: the manual uses both apostrophes and quotes.
  const match = /^[“"]([^”"]+)[”"]\s*(.*)$/s.exec(trimmed);
  if (!match) return null;
  const question = match[1]!.trim();
  const modelAnswer = match[2]!.trim();
  if (!question || !modelAnswer) return null;
  return { question, modelAnswer };
}

/** Every question the manual can ask, in curriculum order. */
export function allQuestions(): DrillQuestion[] {
  const out: DrillQuestion[] = [];
  for (const chapter of MANUAL) {
    for (const lesson of chapter.lessons) {
      const split = splitInterview(lesson.interview);
      if (!split) continue;
      out.push({
        lessonId: lesson.id,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        lessonTitle: lesson.title,
        question: split.question,
        modelAnswer: split.modelAnswer,
      });
    }
  }
  return out;
}

/** Questions from one chapter, or all of them. */
export function questionsFor(chapterId: string | 'all'): DrillQuestion[] {
  const all = allQuestions();
  return chapterId === 'all' ? all : all.filter((q) => q.chapterId === chapterId);
}

/**
 * Shuffle, so the drill is not answerable from the order.
 *
 * Fisher-Yates with an injectable source, so a test can pin it. Sorting by
 * `Math.random() - 0.5` is the usual shortcut and is measurably biased.
 */
export function shuffle<T>(items: readonly T[], rand: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const a = out[i]!;
    const b = out[j]!;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

export interface DrillSummary {
  answered: number;
  total: number;
  solid: number;
  partial: number;
  missed: number;
  /** Answered without revealing the model answer first. */
  unprompted: number;
  /** Total seconds spent answering. */
  seconds: number;
  /** Mean seconds per answered question, rounded. */
  meanSeconds: number;
}

export function summarise(answers: readonly DrillAnswer[], total: number): DrillSummary {
  const seconds = answers.reduce((n, a) => n + a.seconds, 0);
  return {
    answered: answers.length,
    total,
    solid: answers.filter((a) => a.recall === 'solid').length,
    partial: answers.filter((a) => a.recall === 'partial').length,
    missed: answers.filter((a) => a.recall === 'missed').length,
    unprompted: answers.filter((a) => !a.prompted).length,
    seconds,
    meanSeconds: answers.length === 0 ? 0 : Math.round(seconds / answers.length),
  };
}

/**
 * Ask a model to critique one answer.
 *
 * It compares the learner's answer to the model answer and says what is
 * missing. It does not score, and nothing it returns changes any recorded
 * state — the same division the ticket review keeps, where the checks decide
 * and the model only writes the prose.
 *
 * Returns null when no model is running, which is the normal case: this
 * product works offline and the drill is fully usable without it.
 */
export async function critiqueAnswer(
  question: DrillQuestion,
  answer: string,
  timeoutMs = 30000,
): Promise<string | null> {
  if (!answer.trim()) return null;
  if (!(await ollamaAvailable())) return null;

  const prompt = [
    'You are an interview coach for identity and access management roles.',
    '',
    `The interview question was: "${question.question}"`,
    '',
    `A strong answer contains: ${question.modelAnswer}`,
    '',
    `The candidate answered: "${answer.trim()}"`,
    '',
    'In at most three sentences, say what the candidate got right and the single most',
    'important thing they left out. Address the candidate directly. Do not give a score,',
    'a grade or a mark. Do not repeat the question.',
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(OLLAMA_GENERATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        keep_alive: '15m',
        options: { temperature: 0.4, num_predict: 180 },
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { response?: string };
    const text = data.response?.trim();
    return text && text.length > 0 ? text : null;
  } catch {
    // No model, no network, or it took too long. The drill works without it.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
