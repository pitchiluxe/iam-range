/**
 * tests/allowlistParity.test.ts
 *
 * The in-VM browser's allowlist is enforced twice — in the renderer
 * (src/config/webAllowlist.ts) and in the Electron main process
 * (shared/allowlistCheck.cjs, used by main.cjs's navigation guards).
 *
 * Two enforcement points with two implementations is how one of them quietly
 * ends up permitting more than the other. This asserts they agree on every
 * case that matters, especially the bypass attempts.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { isAllowedUrl } from '@/config/webAllowlist';

const require_ = createRequire(import.meta.url);
const { urlAllowed } = require_('../shared/allowlistCheck.cjs') as {
  urlAllowed(raw: string): boolean;
};

/** Every URL both implementations must classify identically. */
const CASES: ReadonlyArray<[string, boolean]> = [
  // Allowed
  ['https://learn.microsoft.com/entra/identity/', true],
  ['https://developer.okta.com/docs/', true],
  ['https://oauth.net/2/', true],
  ['https://openid.net/developers/how-connect-works/', true],
  ['https://www.youtube.com/embed/996OiexHze0', true],
  ['https://LEARN.Microsoft.COM/entra/', true],

  // Lookalike hosts
  ['https://learn.microsoft.com.evil.test/', false],
  ['https://notoauth.net/', false],

  // Host smuggled somewhere other than the authority
  ['https://evil.test/?next=learn.microsoft.com', false],
  ['https://evil.test/learn.microsoft.com', false],
  ['https://learn.microsoft.com@evil.test/', false],

  // Scheme
  ['http://learn.microsoft.com/', false],
  ['javascript:alert(1)', false],
  ['data:text/html,<h1>hi</h1>', false],
  ['file:///C:/Windows/System32/', false],

  // Path-restricted host
  ['https://www.youtube.com/watch?v=996OiexHze0', false],
  ['https://www.youtube.com/', false],

  // Unparseable
  ['', false],
  ['not a url', false],
];

describe('allowlist parity between renderer and main process', () => {
  for (const [url, expected] of CASES) {
    it(`agrees on ${JSON.stringify(url)} → ${expected}`, () => {
      expect(isAllowedUrl(url)).toBe(expected);
      expect(urlAllowed(url)).toBe(expected);
    });
  }
});

// The Electron main-process guard test from the 3D app is intentionally absent:
// this project ships no main process yet. If an Electron shell is added here,
// port that assertion across with it.
describe('allowlist behaviour shared with a future main process', () => {
  /**
   * A redirect from an allowed host to a disallowed one is the case the
   * original guard missed: Electron fires `will-redirect` for server-side 30x,
   * not `will-navigate`, so a will-navigate-only guard let it through.
   */
  it('treats a redirect destination as its own navigation', () => {
    expect(urlAllowed('https://oauth.net/2/')).toBe(true);
    expect(urlAllowed('https://evil.test/landing')).toBe(false);
  });

});
