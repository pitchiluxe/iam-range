/**
 * tests/aiThemeGenerator.test.ts — the AI theme generator's non-model half.
 *
 * The model's actual colour choices cannot be asserted on, so this covers
 * everything around them: an unreachable Ollama is reported rather than
 * silently swallowed (unlike the tutor, this feature's only job is to
 * generate — there is no offline answer to fall back to), and a reply that
 * is missing a token, wrapped in prose, or not JSON at all is caught rather
 * than producing a half-built theme.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateThemeWithAI } from '@/util/aiThemeGenerator';

const VALID_TOKENS = {
  name: 'Copper Dusk',
  mode: 'dark',
  panel: '#101418',
  panelAlt: '#181d24',
  bg: '#0b0e12',
  fg: '#e8e8e8',
  muted: '#8a94a0',
  border: '#2a313a',
  accent: '#7fd1ae',
  onAccent: '#05140f',
  err: '#ff9a8a',
  warn: '#e2a03f',
  glassTop: 'rgba(30,40,50,0.6)',
  glassBottom: 'rgba(10,14,18,0.8)',
  glassBorder: 'rgba(255,255,255,0.12)',
  glassText: '#e8e8e8',
  glassHover: 'rgba(255,255,255,0.14)',
};

/** Stubs fetch for both calls generateThemeWithAI makes: the Ollama
 *  availability probe (/api/tags) and the actual generation (/api/generate). */
function stubFetch(opts: { available?: boolean; generateResponse?: string } = {}) {
  const { available = true, generateResponse } = opts;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: unknown) => {
      const href = String(url);
      if (href.includes('/api/tags')) {
        return available
          ? Promise.resolve(new Response('{}', { status: 200 }))
          : Promise.reject(new Error('ECONNREFUSED'));
      }
      if (href.includes('/api/generate')) {
        return Promise.resolve(new Response(JSON.stringify({ response: generateResponse ?? '' })));
      }
      throw new Error(`unexpected fetch: ${href}`);
    }),
  );
}

describe('generateThemeWithAI', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reports when Ollama is not running, rather than falling back to anything', async () => {
    stubFetch({ available: false });
    const result = await generateThemeWithAI();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not running/i);
  });

  it('builds a Theme from a clean JSON reply, using the model\'s own name', async () => {
    stubFetch({ generateResponse: JSON.stringify(VALID_TOKENS) });
    const result = await generateThemeWithAI();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.theme.id).toBe('ai-custom');
      expect(result.theme.mode).toBe('dark');
      expect(result.theme.tokens.accent).toBe('#7fd1ae');
      expect(result.theme.label).toBe('Copper Dusk');
      expect(result.theme.note).toContain('AI-generated');
    }
  });

  it('falls back to a generic label when the model omits a name', async () => {
    const { name: _name, ...rest } = VALID_TOKENS;
    stubFetch({ generateResponse: JSON.stringify(rest) });
    const result = await generateThemeWithAI();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.theme.label).toBe('AI Theme');
  });

  it('extracts the JSON object even when the model wraps it in prose', async () => {
    stubFetch({
      generateResponse: `Sure, here is a theme:\n${JSON.stringify(VALID_TOKENS)}\nEnjoy!`,
    });
    const result = await generateThemeWithAI();
    expect(result.ok).toBe(true);
  });

  it('rejects a reply missing a required token', async () => {
    const { accent: _accent, ...incomplete } = VALID_TOKENS;
    stubFetch({ generateResponse: JSON.stringify(incomplete) });
    const result = await generateThemeWithAI();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/accent/);
  });

  it('rejects a reply that is not JSON', async () => {
    stubFetch({ generateResponse: 'I cannot help with that.' });
    const result = await generateThemeWithAI();
    expect(result.ok).toBe(false);
  });

  it('defaults an invalid or missing mode to dark rather than failing', async () => {
    const { mode: _mode, ...rest } = VALID_TOKENS;
    stubFetch({ generateResponse: JSON.stringify({ ...rest, mode: 'sepia' }) });
    const result = await generateThemeWithAI();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.theme.mode).toBe('dark');
  });

  it('rejects an empty reply', async () => {
    stubFetch({ generateResponse: '' });
    const result = await generateThemeWithAI();
    expect(result.ok).toBe(false);
  });
});
