/**
 * tests/setup.ts — runs around every test file.
 *
 * The Ollama transport remembers a recent answer so a busy Ollama is not
 * declared offline. Tests stub Ollama differently from one test to the next,
 * so none may inherit another's "it answered a moment ago".
 */
import { afterEach, beforeEach } from 'vitest';
import { forgetOllamaState } from '@/config/ollama';

beforeEach(() => forgetOllamaState());
afterEach(() => forgetOllamaState());
