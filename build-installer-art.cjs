#!/usr/bin/env node
/**
 * build-installer-art.cjs — the pictures the Windows installer shows.
 *
 * NSIS wants uncompressed BMP at two exact sizes: a 164×314 sidebar for the
 * welcome and finish pages, and a 150×57 header strip for the pages between.
 * Nothing else is accepted — it does not read PNG, and a wrong size is
 * stretched into something that looks broken.
 *
 * sharp cannot write BMP, so the artwork is rendered to raw pixels and wrapped
 * in a BMP header here. That is about forty lines and no new dependency, which
 * beats adding an image library to write one of the simplest formats there is.
 *
 * Run through `npm run build:icons`, which the packaging scripts call before
 * electron-builder.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.dirname(__filename);
const OUT = path.join(ROOT, 'build');

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

/**
 * Wrap raw RGB pixels in a 24-bit BMP.
 *
 * BMP stores rows bottom-up and pads each row to a multiple of four bytes —
 * both of which are easy to get wrong and produce a picture that is skewed
 * rather than absent, so it is worth doing deliberately.
 */
function encodeBmp(rgb, width, height) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowSize * height;
  const fileSize = 54 + pixelBytes;

  const header = Buffer.alloc(54);
  header.write('BM', 0);
  header.writeUInt32LE(fileSize, 2);
  header.writeUInt32LE(54, 10); // pixel data offset
  header.writeUInt32LE(40, 14); // DIB header size
  header.writeInt32LE(width, 18);
  header.writeInt32LE(height, 22); // positive: rows stored bottom-up
  header.writeUInt16LE(1, 26); // planes
  header.writeUInt16LE(24, 28); // bits per pixel
  header.writeUInt32LE(pixelBytes, 34);
  header.writeInt32LE(2835, 38); // 72 DPI
  header.writeInt32LE(2835, 42);

  const pixels = Buffer.alloc(pixelBytes);
  for (let y = 0; y < height; y += 1) {
    const source = (height - 1 - y) * width * 3; // flip vertically
    const target = y * rowSize;
    for (let x = 0; x < width; x += 1) {
      // BMP is BGR, not RGB.
      pixels[target + x * 3] = rgb[source + x * 3 + 2];
      pixels[target + x * 3 + 1] = rgb[source + x * 3 + 1];
      pixels[target + x * 3 + 2] = rgb[source + x * 3];
    }
  }

  return Buffer.concat([header, pixels]);
}

const TEAL = '#4ec9b0';
const INK = '#0a0d12';
const PANEL = '#12161c';
const MUTED = '#8a95a3';

/** The welcome and finish sidebar: the mark, the name, and what it is. */
const sidebarSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="${PANEL}"/>
      <stop offset="1" stop-color="${INK}"/>
    </linearGradient>
  </defs>
  <rect width="164" height="314" fill="url(#bg)"/>

  <!-- The identity graph from the lock screen, quietly. -->
  <g stroke="${TEAL}" stroke-width="0.6" opacity="0.30" fill="none">
    <path d="M82 150 L40 96"/><path d="M82 150 L128 104"/><path d="M82 150 L30 190"/>
    <path d="M82 150 L134 196"/><path d="M82 150 L74 232"/><path d="M82 150 L112 66"/>
  </g>
  <g fill="${TEAL}" opacity="0.55">
    <circle cx="40" cy="96" r="2.6"/><circle cx="128" cy="104" r="2.6"/>
    <circle cx="30" cy="190" r="2.6"/><circle cx="134" cy="196" r="2.6"/>
    <circle cx="74" cy="232" r="2.6"/><circle cx="112" cy="66" r="2.6"/>
  </g>
  <circle cx="82" cy="150" r="9" fill="none" stroke="${TEAL}" stroke-width="1.4"/>
  <circle cx="82" cy="150" r="3.4" fill="${TEAL}"/>

  <text x="18" y="268" font-family="Segoe UI, sans-serif" font-size="19"
        font-weight="600" fill="#ffffff">IAM Range</text>
  <text x="18" y="286" font-family="Segoe UI, sans-serif" font-size="10"
        fill="${MUTED}">Identity operations</text>
  <text x="18" y="299" font-family="Segoe UI, sans-serif" font-size="10"
        fill="${MUTED}">workstation</text>
</svg>`;

/** The header strip on the interior pages. */
const headerSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="57">
  <rect width="150" height="57" fill="#ffffff"/>
  <rect x="14" y="14" width="30" height="26" rx="4" fill="none"
        stroke="${TEAL}" stroke-width="2"/>
  <path d="M20 22h14M20 27h18M20 32h11" stroke="${MUTED}" stroke-width="1.6"
        stroke-linecap="round"/>
  <circle cx="38" cy="33" r="4" fill="none" stroke="#d7ba7d" stroke-width="1.6"/>
  <text x="54" y="27" font-family="Segoe UI, sans-serif" font-size="12"
        font-weight="600" fill="#12161c">IAM Range</text>
  <text x="54" y="40" font-family="Segoe UI, sans-serif" font-size="8"
        fill="#5b6672">Erick Omari</text>
</svg>`;

async function write(name, svg, width, height) {
  const { data } = await sharp(Buffer.from(svg))
    .resize(width, height)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const file = path.join(OUT, name);
  fs.writeFileSync(file, encodeBmp(data, width, height));
  return file;
}

async function main() {
  await write('installerSidebar.bmp', sidebarSvg, 164, 314);
  await write('uninstallerSidebar.bmp', sidebarSvg, 164, 314);
  await write('installerHeader.bmp', headerSvg, 150, 57);
  console.log('Installer artwork written: sidebar (164x314), header (150x57)');
}

main().catch((err) => {
  console.error('Installer artwork failed:', err);
  process.exit(1);
});
