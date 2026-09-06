/**
 * shared/allowlistCheck.cjs — the in-VM browser's URL check, for the Electron
 * main process.
 *
 * Mirrors src/config/webAllowlist.ts. Both read shared/webAllowlist.json for
 * the host list, and tests/allowlistParity.test.ts asserts the two agree on a
 * battery of URLs — including the bypass attempts — so a fix applied to one
 * cannot silently miss the other.
 */
const allowlist = require('./webAllowlist.json');

/** True when `host` equals `allowed` or is a subdomain of it. Never substring:
 *  that would admit `learn.microsoft.com.evil.test`. */
function hostMatches(host, allowed) {
  return host === allowed || host.endsWith('.' + allowed);
}

function matchedEntry(host) {
  return allowlist.hosts.find((a) => hostMatches(host, a));
}

/** Whether the in-VM browser may load this URL. */
function urlAllowed(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;

  const entry = matchedEntry(url.hostname.toLowerCase());
  if (!entry) return false;

  const prefix = allowlist.pathRestricted[entry];
  if (prefix && !url.pathname.startsWith(prefix)) return false;

  return true;
}

module.exports = { urlAllowed };
