/**
 * tests/webAllowlist.test.ts
 *
 * The browser inside the VM may only reach IAM/identity learning material.
 * Host matching is the whole control, so it has to resist the usual tricks —
 * suffix confusion, userinfo in the authority, encoded hosts. A substring
 * check would let `learn.microsoft.com.evil.test` through, which is exactly
 * what these cover.
 */
import { describe, it, expect } from 'vitest';
import { isAllowedUrl, normalizeUrl, ALLOWED_HOSTS } from '@/config/webAllowlist';

describe('isAllowedUrl', () => {
  it('allows the listed identity documentation hosts', () => {
    expect(isAllowedUrl('https://learn.microsoft.com/entra/identity/')).toBe(true);
    expect(isAllowedUrl('https://openid.net/developers/how-connect-works/')).toBe(true);
    expect(isAllowedUrl('https://oauth.net/2/')).toBe(true);
  });

  it('allows subdomains of a listed host', () => {
    expect(isAllowedUrl('https://developer.okta.com/docs/')).toBe(true);
  });

  it('rejects a host that merely ends with an allowed name', () => {
    expect(isAllowedUrl('https://learn.microsoft.com.evil.test/')).toBe(false);
    expect(isAllowedUrl('https://notoauth.net/')).toBe(false);
  });

  it('rejects an allowed host smuggled into the path or query', () => {
    expect(isAllowedUrl('https://evil.test/?next=learn.microsoft.com')).toBe(false);
    expect(isAllowedUrl('https://evil.test/learn.microsoft.com')).toBe(false);
  });

  it('rejects an allowed host placed in the userinfo section', () => {
    expect(isAllowedUrl('https://learn.microsoft.com@evil.test/')).toBe(false);
  });

  it('requires https', () => {
    expect(isAllowedUrl('http://learn.microsoft.com/')).toBe(false);
  });

  it('rejects non-http schemes outright', () => {
    expect(isAllowedUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedUrl('data:text/html,<h1>hi</h1>')).toBe(false);
    expect(isAllowedUrl('file:///C:/Windows/System32/')).toBe(false);
  });

  it('rejects unparseable input rather than guessing', () => {
    expect(isAllowedUrl('')).toBe(false);
    expect(isAllowedUrl('not a url')).toBe(false);
  });

  it('is case-insensitive about the host', () => {
    expect(isAllowedUrl('https://LEARN.Microsoft.COM/entra/')).toBe(true);
  });

  it('only permits YouTube through its embed path', () => {
    expect(isAllowedUrl('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe(true);
    // The full site would let the learner browse anything at all.
    expect(isAllowedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(false);
    expect(isAllowedUrl('https://www.youtube.com/')).toBe(false);
  });

  it('keeps the allowlist non-empty and https-only by construction', () => {
    expect(ALLOWED_HOSTS.length).toBeGreaterThan(0);
    for (const h of ALLOWED_HOSTS) expect(h).not.toContain('/');
  });
});

describe('normalizeUrl', () => {
  it('adds https to a bare host', () => {
    expect(normalizeUrl('oauth.net/2/')).toBe('https://oauth.net/2/');
  });

  it('leaves an absolute URL alone', () => {
    expect(normalizeUrl('https://oauth.net/2/')).toBe('https://oauth.net/2/');
  });

  it('rewrites a YouTube watch link to its embeddable form', () => {
    expect(normalizeUrl('https://www.youtube.com/watch?v=abc123')).toBe(
      'https://www.youtube.com/embed/abc123',
    );
    expect(normalizeUrl('https://youtu.be/abc123')).toBe('https://www.youtube.com/embed/abc123');
  });
});
