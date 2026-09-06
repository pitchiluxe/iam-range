/**
 * config/webAllowlist.ts — what the in-VM browser is allowed to reach.
 *
 * The lab is meant to stay an isolated training environment, so the browser is
 * not a general-purpose one: it reaches identity and IAM learning material and
 * nothing else. Host matching is the entire control, so it is done on the
 * parsed URL's hostname — never by substring, which would admit
 * `learn.microsoft.com.evil.test`.
 *
 * To add a resource, add its host to shared/webAllowlist.json. Everything not
 * listed is refused.
 */
import allowlist from '../../shared/webAllowlist.json';

/** Hosts the browser may load. A leading dot is implied: an entry also covers
 *  its subdomains (`okta.com` covers `developer.okta.com`), never a host that
 *  merely ends with the same letters.
 *
 *  Sourced from shared/webAllowlist.json so the renderer check here and the
 *  main-process guard in electron/main.cjs read the same list — two
 *  enforcement points with two copies of the list is how one of them ends up
 *  quietly permitting more than the other. */
export const ALLOWED_HOSTS: readonly string[] = allowlist.hosts;

/** Hosts that are only reachable on a specific path prefix. YouTube's full
 *  site would be a general-purpose browser by the back door, so only its
 *  embed player is permitted. */
const PATH_RESTRICTED: Record<string, string> = allowlist.pathRestricted;

/** True when `host` equals `allowed` or is a subdomain of it. */
function hostMatches(host: string, allowed: string): boolean {
  return host === allowed || host.endsWith('.' + allowed);
}

/** The allowlist entry covering this host, or undefined. */
function matchedEntry(host: string): string | undefined {
  return ALLOWED_HOSTS.find((a) => hostMatches(host, a));
}

/**
 * Whether the in-VM browser may load this URL.
 *
 * Requires https, a parseable URL, an allowlisted host, and — for hosts in
 * PATH_RESTRICTED — the permitted path prefix.
 */
export function isAllowedUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  // https only: no javascript:, data:, file:, and no cleartext http.
  if (url.protocol !== 'https:') return false;

  // `https://allowed.example@evil.test/` has hostname evil.test, so parsing
  // already defeats userinfo smuggling — but reject credentials outright
  // rather than relying on that being obvious to the next reader.
  if (url.username || url.password) return false;

  const host = url.hostname.toLowerCase();
  const entry = matchedEntry(host);
  if (!entry) return false;

  const requiredPrefix = PATH_RESTRICTED[entry];
  if (requiredPrefix && !url.pathname.startsWith(requiredPrefix)) return false;

  return true;
}

/**
 * Tidy what the learner typed into something loadable: assume https for a bare
 * host, and rewrite YouTube watch/share links to the embeddable player, since
 * the normal watch page cannot be framed and is not allowlisted anyway.
 */
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return withScheme;
  }

  const host = url.hostname.toLowerCase();
  if (hostMatches(host, 'youtu.be')) {
    const id = url.pathname.replace(/^\//, '');
    if (id) return `https://www.youtube.com/embed/${id}`;
  }
  if (hostMatches(host, 'youtube.com') && url.pathname === '/watch') {
    const id = url.searchParams.get('v');
    if (id) return `https://www.youtube.com/embed/${id}`;
  }

  return withScheme;
}

/** Curated starting points, shown as the browser's bookmarks bar. */
export const IAM_BOOKMARKS: ReadonlyArray<{ label: string; url: string }> = [
  { label: 'Microsoft Entra ID', url: 'https://learn.microsoft.com/entra/identity/' },
  { label: 'OAuth 2.0', url: 'https://oauth.net/2/' },
  { label: 'OpenID Connect', url: 'https://openid.net/developers/how-connect-works/' },
  { label: 'Okta Developer', url: 'https://developer.okta.com/docs/concepts/saml/' },
  { label: 'Auth0 Docs', url: 'https://auth0.com/docs/authenticate/protocols' },
  { label: 'Keycloak', url: 'https://www.keycloak.org/documentation' },
  { label: 'NIST 800-63 Digital Identity', url: 'https://csrc.nist.gov/pubs/sp/800/63/4/final' },
  { label: 'OWASP Auth Cheat Sheet', url: 'https://owasp.org/www-project-cheat-sheets/' },
];
