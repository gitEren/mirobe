// Renders the app icon, Android adaptive icon layers, the iOS Icon Composer
// layers and the splash image from the single mark in src/lib/brand.ts.
//
//   npm run brand -w mobile
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { BRAND, MARK, markElements, sparklePath } from '../src/lib/brand.ts';

const root = path.resolve(import.meta.dirname, '..');
const out = (file) => path.join(root, 'assets', file);
const { x: vx, y: vy, width: vw, height: vh } = MARK.viewBox;

function png(file, svg) {
  mkdirSync(path.dirname(out(file)), { recursive: true });
  writeFileSync(out(file), new Resvg(svg, { background: 'rgba(0,0,0,0)' }).render().asPng());
  console.info('wrote', path.relative(root, out(file)));
}

/** Places the mark (or any viewBox-unit content) on a square canvas, `height` px tall, centred. */
function place(canvas, height, content, dy = 0) {
  const scale = height / vh;
  const left = (canvas - vw * scale) / 2 - vx * scale;
  const top = (canvas - height) / 2 - vy * scale + dy;
  return `<g transform="translate(${left} ${top}) scale(${scale})">${content}</g>`;
}

const square = (size, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;

// Warm charcoal with a soft gold glow behind the glass, like a lit fitting-room mirror.
const backdrop = (size) => `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2B2824"/>
      <stop offset="1" stop-color="#121110"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.44" r="0.42">
      <stop offset="0" stop-color="${BRAND.goldBright}" stop-opacity="0.16"/>
      <stop offset="1" stop-color="${BRAND.goldBright}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#bg)"/>
  <rect width="${size}" height="${size}" fill="url(#glow)"/>`;

const onDark = markElements({ ink: BRAND.ivory, accent: BRAND.goldBright });

// App icon (Android legacy and store listings).
png('images/icon.png', square(1024, backdrop(1024) + place(1024, 660, onDark, 8)));

// Android adaptive icon: the mark stays inside the 66dp safe circle of the 108dp canvas.
png('images/android-icon-background.png', square(1024, backdrop(1024)));
png('images/android-icon-foreground.png', square(1024, place(1024, 520, onDark, 4)));
png('images/android-icon-monochrome.png', square(1024, place(1024, 520, markElements({ ink: '#FFFFFF', accent: '#FFFFFF' }), 4)));

// iOS 26 Icon Composer layers (the backdrop comes from icon.json's fill).
png('mirobe.icon/Assets/mirror.png', square(1024, place(1024, 660, markElements({ ink: BRAND.ivory, accent: BRAND.goldBright, sparkles: false }), 8)));
png('mirobe.icon/Assets/sparkle.png', square(1024, place(1024, 660, `<path d="${sparklePath('both')}" fill="${BRAND.goldBright}"/>`, 8)));

// Splash: expo-splash-screen fits the image into an imageWidth x imageWidth square, so the mark is
// drawn full-height on a square canvas; its height on screen is then exactly app.json's imageWidth.
png('images/splash-icon.png', square(900, place(900, 900, markElements({ ink: BRAND.ink, accent: BRAND.gold }))));
