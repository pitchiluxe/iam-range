/**
 * tests/site.test.ts — the landing page has no build step.
 *
 * Vercel serves site/ verbatim: `buildCommand` is null and `outputDirectory`
 * is site/. Nothing resolves imports, rewrites paths or fails loudly, so a
 * reference to a file that is not in the repository is a 404 on the live site
 * and nowhere else. site/favicon.svg shipped exactly that way — generated,
 * gitignored, referenced, and missing in production.
 *
 * The other half is the origin. The page was written against iamrange.dev, a
 * domain that was never bought, and the canonical link, Open Graph tags,
 * JSON-LD, sitemap and robots.txt each carried it independently. A canonical
 * URL pointing at a domain that does not resolve tells Google the real page is
 * a duplicate of nothing — the one SEO tag whose failure mode is invisible on
 * the page itself.
 *
 * Both are checked here rather than noticed after a deploy.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SITE = join(process.cwd(), 'site');
const HTML = readFileSync(join(SITE, 'index.html'), 'utf8');
const ROBOTS = readFileSync(join(SITE, 'robots.txt'), 'utf8');
const SITEMAP = readFileSync(join(SITE, 'sitemap.xml'), 'utf8');

/** Where the site actually lives. One place, so the guard has something to compare against. */
const ORIGIN = 'https://iam-range.vercel.app';

/** Domains this project has used and moved on from. */
const DEAD_DOMAINS = ['iamrange.dev'];

describe('landing page assets', () => {
  it('references only files that are in the repository', () => {
    // src="…", href="…" and srcset="…" that are relative — absolute URLs and
    // data URIs are somebody else's problem.
    const refs = new Set<string>();
    for (const m of HTML.matchAll(/(?:src|href|srcset)="([^"]+)"/g)) {
      const raw = m[1];
      if (!raw || /^(https?:|data:|mailto:|#|\/\/)/.test(raw)) continue;
      refs.add(raw.split('?')[0] as string);
    }

    expect(refs.size).toBeGreaterThan(0);
    const missing = [...refs].filter((r) => !existsSync(join(SITE, r)));
    expect(missing, 'referenced by index.html but not present in site/').toEqual([]);
  });

  it('ships the favicon, which is generated and was once gitignored', () => {
    expect(existsSync(join(SITE, 'favicon.svg'))).toBe(true);
  });
});

describe('landing page origin', () => {
  it('names no domain the project has abandoned', () => {
    for (const file of [HTML, ROBOTS, SITEMAP]) {
      for (const dead of DEAD_DOMAINS) {
        expect(file).not.toContain(dead);
      }
    }
  });

  it('agrees with itself about where the site lives', () => {
    expect(HTML).toContain(`<link rel="canonical" href="${ORIGIN}/" />`);
    expect(HTML).toContain(`content="${ORIGIN}/"`); // og:url
    expect(SITEMAP).toContain(`<loc>${ORIGIN}/</loc>`);
    expect(ROBOTS).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
  });

  it('gives social cards an absolute image, since relative ones do not resolve off-site', () => {
    for (const prop of ['og:image', 'twitter:image']) {
      const m = new RegExp(`(?:property|name)="${prop}" content="([^"]+)"`).exec(HTML);
      expect(m, `${prop} is missing`).not.toBeNull();
      expect(m?.[1]).toMatch(/^https:\/\//);
    }
  });
});
