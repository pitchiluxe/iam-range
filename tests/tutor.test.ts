/**
 * tests/tutor.test.ts — the tutor's non-LLM half.
 *
 * The model's output cannot be asserted on, so everything around it is:
 * retrieval finds the right article, the prompt carries the environment and
 * the ticket, the mode changes what the tutor is told to do, and an
 * unreachable Ollama still produces a usable answer rather than an error.
 *
 * The last one matters most. Most learners will never run Ollama, so the
 * offline path is the tutor for them — not a degraded corner case.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MockAuditLog, MockDirectory } from '@/services';
import { readEnvironment } from '@/vm/environmentStage';
import { askTutor, buildPrompt, offlineAnswer, suggestedQuestions } from '@/vm/tutor';
import { ARTICLES, searchArticles, articleById } from '@/config/knowledgeBase';
import type { EnvironmentState } from '@/vm/environmentStage';

function bareEnv(): EnvironmentState {
  return readEnvironment(new MockDirectory(new MockAuditLog()));
}

/** A directory built out far enough to be 'operating'. */
function operatingEnv(): EnvironmentState {
  const dir = new MockDirectory(new MockAuditLog());
  dir.createOu('Corp');
  dir.createGroup('grp-helpdesk-tier1', 'Help Desk Tier 1');
  dir.createUser({
    username: 'jdoe',
    displayName: 'John Doe',
    email: 'jdoe@omari.test',
    department: 'Help Desk',
    title: 'Analyst',
    mfa: 'none',
  });
  return readEnvironment(dir);
}

describe('knowledge base retrieval', () => {
  it('finds the PIM article from the language a learner would use', () => {
    const hits = searchArticles('what is the difference between eligible and active');
    expect(hits.map((a) => a.id)).toContain('pim-basics');
  });

  it('finds the lockout article from the symptom, not the jargon', () => {
    const hits = searchArticles('user cannot sign in, account locked');
    expect(hits.map((a) => a.id)).toContain('lockouts');
  });

  it('returns nothing for a question it does not cover', () => {
    // Better to say "not covered" than to hand back an unrelated article and
    // let the model build a confident answer on it.
    expect(searchArticles('how do I bake sourdough bread')).toHaveLength(0);
  });

  it('every article id is unique', () => {
    // Citations address articles by id; a duplicate would silently open the
    // wrong one from the tutor's sources strip.
    const ids = ARTICLES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every topic the offline fallback offers actually retrieves an article', () => {
    // The fallback message promises these topics by name. If an article is
    // renamed or removed, that promise has to break here rather than in front
    // of a learner.
    const promised = [
      'OUs',
      'groups',
      'joiner mover leaver',
      'least privilege',
      'PIM',
      'lockouts',
      'SSO',
      'MFA',
      'access reviews',
      'service accounts',
      'Okta and Entra',
      'audit evidence',
    ];
    for (const topic of promised) {
      expect(searchArticles(topic).length, `no article for "${topic}"`).toBeGreaterThan(0);
    }
  });

  it('every article resolves by id', () => {
    for (const a of ARTICLES) expect(articleById(a.id)).toBe(a);
  });
});

describe('prompt construction', () => {
  it('carries the retrieved article into the prompt', () => {
    const articles = searchArticles('pim eligible');
    const prompt = buildPrompt('what is eligible?', { env: bareEnv(), mode: 'socratic' }, articles);
    expect(prompt).toContain('REFERENCE MATERIAL');
    expect(prompt).toContain(articles[0]!.title);
  });

  it('describes the learner\'s actual environment', () => {
    const env = operatingEnv();
    const prompt = buildPrompt('what next?', { env, mode: 'explain' }, []);
    // The model must answer about this domain, not identity in the abstract.
    expect(prompt).toContain('jdoe');
    expect(prompt).toContain('Stage:');
  });

  it('includes the ticket being worked, when there is one', () => {
    const prompt = buildPrompt(
      'where do I start?',
      {
        env: bareEnv(),
        mode: 'socratic',
        ticket: { subject: 'Build the OU structure', body: 'Create Corp, Corp/Users…' },
      },
      [],
    );
    expect(prompt).toContain('Build the OU structure');
  });

  it('tells the model not to answer when nothing matched', () => {
    const prompt = buildPrompt('sourdough?', { env: bareEnv(), mode: 'explain' }, []);
    expect(prompt).toMatch(/No article matched/i);
  });

  it('socratic forbids the answer; walkthrough asks for the steps', () => {
    const env = bareEnv();
    const socratic = buildPrompt('how?', { env, mode: 'socratic' }, []);
    const walkthrough = buildPrompt('how?', { env, mode: 'walkthrough' }, []);
    expect(socratic).toMatch(/Do NOT give the answer/);
    expect(walkthrough).toMatch(/numbered/);
    expect(walkthrough).not.toMatch(/Do NOT give the answer/);
  });
});

describe('offline answers', () => {
  it('asks rather than tells in socratic mode', () => {
    const answer = offlineAnswer('should I make her a domain admin?', {
      env: operatingEnv(),
      mode: 'socratic',
    });
    expect(answer.source).toBe('offline');
    expect(answer.text).toContain('?');
    expect(answer.citations.length).toBeGreaterThan(0);
  });

  it('cites what it quoted, so the learner can check it', () => {
    const answer = offlineAnswer('what is standing privilege', {
      env: operatingEnv(),
      mode: 'explain',
    });
    expect(answer.citations.map((a) => a.id)).toContain('pim-basics');
    expect(answer.text).toContain(answer.citations[0]!.title);
  });

  it('gives more of the article when asked to explain than when asking', () => {
    const q = 'joiner mover leaver';
    const asking = offlineAnswer(q, { env: operatingEnv(), mode: 'socratic' });
    const telling = offlineAnswer(q, { env: operatingEnv(), mode: 'explain' });
    expect(telling.text.length).toBeGreaterThan(asking.text.length);
  });

  it('says plainly when the material does not cover the question', () => {
    const answer = offlineAnswer('how do I bake sourdough', { env: bareEnv(), mode: 'explain' });
    expect(answer.citations).toHaveLength(0);
    expect(answer.text).toMatch(/Documentation/);
  });

  it('admits it cannot tailor a walkthrough without a model', () => {
    // A walkthrough is the one mode the offline tutor genuinely cannot deliver.
    // Saying so beats presenting a generic article as if it were the steps.
    const answer = offlineAnswer('walk me through unlocking an account', {
      env: operatingEnv(),
      mode: 'walkthrough',
    });
    expect(answer.text).toMatch(/Ollama is not running/);
  });
});

describe('askTutor degradation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('falls back to the offline answer when Ollama is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
    );
    const answer = await askTutor('what is PIM?', { env: operatingEnv(), mode: 'explain' });
    expect(answer.source).toBe('offline');
    expect(answer.text.length).toBeGreaterThan(0);
  });

  it('falls back when Ollama answers with nothing usable', async () => {
    // An empty completion is a failure that returns 200. Treating it as an
    // answer would show the learner a blank reply.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ response: '   ' })))),
    );
    const answer = await askTutor('what is PIM?', { env: operatingEnv(), mode: 'explain' });
    expect(answer.source).toBe('offline');
  });

  it('uses the model when it answers, and cites what it was given', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ response: 'Eligible means you may activate.' }))),
      ),
    );
    const answer = await askTutor('eligible vs active in pim', {
      env: operatingEnv(),
      mode: 'explain',
    });
    expect(answer.source).toBe('ollama');
    expect(answer.text).toBe('Eligible means you may activate.');
    expect(answer.citations.map((a) => a.id)).toContain('pim-basics');
  });
});

describe('suggested questions', () => {
  it('asks about structure in a bare domain and about PIM in an operating one', () => {
    // A learner staring at an empty directory does not yet know to ask about
    // access reviews, and one with staff does not need to be told about OUs.
    expect(suggestedQuestions(bareEnv()).join(' ')).toMatch(/organisational unit/i);
    expect(suggestedQuestions(operatingEnv()).join(' ')).toMatch(/PIM/);
  });

  it('always offers something to ask', () => {
    for (const env of [bareEnv(), operatingEnv()]) {
      expect(suggestedQuestions(env).length).toBeGreaterThan(0);
    }
  });
});
