import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';

/**
 * The page's frame-src, built from shared/webAllowlist.json.
 *
 * The in-VM browser frames pages in the web build (the desktop app uses a
 * <webview>, which this policy does not govern). Without a frame-src the
 * policy fell back to default-src 'self' and refused every page, so the
 * browser showed a blank box even for allowlisted sites. Listing exactly the
 * allowlisted hosts keeps the allowlist the single source of truth: the
 * renderer check, the Electron fence and this policy all read the same file.
 */
function frameSrcFromAllowlist(): Plugin {
  return {
    name: 'frame-src-from-allowlist',
    transformIndexHtml(html) {
      const { hosts } = JSON.parse(readFileSync(resolve(__dirname, 'shared/webAllowlist.json'), 'utf8')) as { hosts: string[] };
      const sources = hosts.flatMap((h) => [`https://${h}`, `https://*.${h}`]).join(' ');
      return html.replace('%FRAME_SRC%', sources);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [frameSrcFromAllowlist()],
  server: { port: 5174, strictPort: true },
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], setupFiles: ['tests/setup.ts'] },
});
