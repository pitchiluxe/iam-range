#!/usr/bin/env node
/**
 * build-icons.cjs — generates the application icon.
 *
 * The mark is a workstation, not a shield: this is an operator's console, and
 * the thing on screen is a directory tree. A title bar, a tree of objects, and
 * a key on the frame, in the palette the app itself uses.
 *
 * Outputs build/icon.svg, PNGs at the sizes Windows and Linux ask for, a
 * multi-resolution build/icon.ico, and public/favicon.svg so the browser tab
 * and the installed application carry the same mark.
 *
 * Run through `npm run build:icons`, which the packaging scripts call before
 * electron-builder — an installer built against a missing icon silently ships
 * the Electron default, which is how an app ends up shipping someone else's
 * logo.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIcoMod = require('png-to-ico');
const pngToIco = pngToIcoMod.default || pngToIcoMod.imagesToIco || pngToIcoMod;

const ROOT = path.dirname(__filename);
const OUT = path.join(ROOT, 'build');
const PUB = path.join(ROOT, 'public');
const SITE = path.join(ROOT, 'site');

for (const dir of [OUT, PUB, SITE]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const C = {
  bg: '#0e1116',
  panel: '#161b22',
  chrome: '#21262d',
  teal: '#4ec9b0',
  tealDim: '#2a7a6a',
  white: '#e6e6e6',
  muted: '#6b7482',
  gold: '#d7ba7d',
};

/** A directory node: folder tick plus a label bar. */
function node(x, y, width, colour) {
  return `
    <rect x="${x}" y="${y}" width="14" height="11" rx="2" fill="${colour}"/>
    <rect x="${x + 20}" y="${y + 2}" width="${width}" height="7" rx="3.5" fill="${C.muted}"/>`;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="frame" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.chrome}"/>
      <stop offset="1" stop-color="${C.bg}"/>
    </linearGradient>
  </defs>

  <!-- Rounded app tile -->
  <rect x="26" y="26" width="460" height="460" rx="96" fill="${C.bg}"/>
  <rect x="26" y="26" width="460" height="460" rx="96" fill="none"
        stroke="${C.tealDim}" stroke-width="6"/>

  <!-- Window frame -->
  <rect x="96" y="128" width="320" height="256" rx="18" fill="url(#frame)"
        stroke="${C.teal}" stroke-width="5"/>

  <!-- Title bar -->
  <path d="M96 146a18 18 0 0 1 18-18h284a18 18 0 0 1 18 18v26H96z" fill="${C.panel}"/>
  <circle cx="122" cy="159" r="6" fill="${C.teal}"/>
  <circle cx="144" cy="159" r="6" fill="${C.muted}"/>
  <circle cx="166" cy="159" r="6" fill="${C.muted}"/>

  <!-- Directory tree -->
  <g transform="translate(126 196)">
    ${node(0, 0, 150, C.teal)}
    ${node(24, 30, 118, C.white)}
    ${node(24, 60, 132, C.white)}
    ${node(48, 90, 96, C.muted)}
  </g>

  <!-- Key on the frame: this is identity, not file management -->
  <g transform="translate(330 300)">
    <circle cx="0" cy="0" r="26" fill="none" stroke="${C.gold}" stroke-width="10"/>
    <rect x="22" y="-5" width="58" height="10" rx="5" fill="${C.gold}"/>
    <rect x="62" y="-5" width="10" height="24" rx="5" fill="${C.gold}"/>
  </g>
</svg>`;

const SIZES = [16, 32, 48, 64, 128, 256, 512];
/** Sizes Windows actually stores in an .ico. */
const ICO_SIZES = [16, 32, 48, 64, 128, 256];

async function main() {
  fs.writeFileSync(path.join(OUT, 'icon.svg'), svg, 'utf8');
  fs.writeFileSync(path.join(PUB, 'favicon.svg'), svg, 'utf8');
  // The landing page carries the same mark as the application.
  fs.writeFileSync(path.join(SITE, 'favicon.svg'), svg, 'utf8');

  const buffer = Buffer.from(svg);
  const written = [];
  for (const size of SIZES) {
    const file = path.join(OUT, `icon-${size}.png`);
    await sharp(buffer).resize(size, size).png().toFile(file);
    written.push(file);
  }

  const ico = await pngToIco(ICO_SIZES.map((s) => path.join(OUT, `icon-${s}.png`)));
  fs.writeFileSync(path.join(OUT, 'icon.ico'), ico);

  // electron-builder looks for build/icon.png on Linux.
  fs.copyFileSync(path.join(OUT, 'icon-512.png'), path.join(OUT, 'icon.png'));

  console.log(
    `Icons written: ${written.length} PNG, icon.ico, icon.svg, ` +
      'public/favicon.svg, site/favicon.svg',
  );
}

main().catch((err) => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});
