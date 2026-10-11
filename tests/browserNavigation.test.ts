import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { isBrowsableUrl } from '@/config/webAllowlist';
const { browserUrlAllowed } = createRequire(import.meta.url)('../shared/allowlistCheck.cjs');
describe('general browser navigation', () => {
  it.each(['https://owasp.org/', 'https://learn.microsoft.com/', 'https://auth0.com/', 'https://www.keycloak.org/', 'https://example.com/', 'http://example.org/', 'https://www.youtube.com/watch?v=123'])('allows website %s in both desktop paths', (url) => {
    expect(isBrowsableUrl(url)).toBe(true);
    expect(browserUrlAllowed(url)).toBe(true);
  });
  it.each(['javascript:alert(1)', 'file:///C:/Windows/', 'data:text/html,hello', 'https://user:password@example.com/', 'not a url'])('rejects non-web or credential-bearing address %s', (url) => {
    expect(isBrowsableUrl(url)).toBe(false);
    expect(browserUrlAllowed(url)).toBe(false);
  });
});
