/**
 * tests/ollamaConfig.test.ts — one definition of where the model lives.
 *
 * The host and the model name were written out in four places: the tutor, the
 * ticket generator, the Settings page and the Electron main process. Changing
 * the model would have meant changing three files and discovering later which
 * one was missed.
 *
 * The main process is the awkward one. It is CommonJS and cannot import a
 * TypeScript module, so it genuinely needs its own literal — which is why this
 * checks it against the shared definition rather than trusting it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  OLLAMA_HOST,
  OLLAMA_MODEL,
  OLLAMA_TAGS_URL,
  OLLAMA_GENERATE_URL,
  OLLAMA_PULL_COMMAND,
} from '@/config/ollama';

const DEFINITION = join('src', 'config', 'ollama.ts');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('Ollama configuration', () => {
  it('the URLs are built from the host', () => {
    expect(OLLAMA_TAGS_URL).toBe(`${OLLAMA_HOST}/api/tags`);
    expect(OLLAMA_GENERATE_URL).toBe(`${OLLAMA_HOST}/api/generate`);
  });

  it('the pull command names the model the code actually requests', () => {
    // Settings shows this command. Telling a learner to pull a model the app
    // does not ask for would leave them with a working Ollama and a tutor
    // that still cannot answer.
    expect(OLLAMA_PULL_COMMAND).toContain(OLLAMA_MODEL);
  });

  it('no other source file writes out the port or the model name', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('src')) {
      if (file.endsWith(DEFINITION)) continue;
      const text = readFileSync(file, 'utf8');
      if (text.includes('11434')) offenders.push(`${file}: hardcodes the port`);
      if (text.includes(`'${OLLAMA_MODEL}'`)) offenders.push(`${file}: hardcodes the model name`);
    }
    expect(offenders).toEqual([]);
  });

  it('the Electron main process agrees with the shared definition', () => {
    // It cannot import this module, so it is checked rather than trusted.
    const main = readFileSync(join('electron', 'main.cjs'), 'utf8');
    const port = new URL(OLLAMA_HOST).port;
    expect(main).toContain(port);
    expect(main).toContain('/api/tags');
  });
});
