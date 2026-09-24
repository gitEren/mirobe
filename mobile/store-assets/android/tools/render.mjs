// Google Play listing assets, rendered with headless Chrome over the DevTools protocol.
// Usage: node render.mjs [icon] [feature] [shots]   (no argument = all)
//   ../icon-512.png                    512×512 RGBA, opaque, full-bleed square (Play masks it)
//   ../feature-graphic-{tr,en}.png     1024×500 RGB
//   ../screenshots/{tr,en}/NN.png      1080×2160 RGB (2:1), re-laid-out from the App Store
//                                      compose (../../screenshots/compose/slides.mjs + raw captures)
// Sources: icon layers in mobile/assets/mirobe.icon.orig/Assets (same as tools/icon.mjs),
// fonts from node_modules/@expo-google-fonts, raw simulator captures in screenshots/raw.
// The iOS status bar (clock + Dynamic Island) at the top of each raw capture is replaced by a
// neutral Android-style bar, so the Play screenshots don't show an iPhone.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { slides } from '../../screenshots/compose/slides.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '..'); // mobile/store-assets/android
const assets = path.resolve(out, '..'); // mobile/store-assets
const mobile = path.resolve(assets, '..');
const repo = path.resolve(mobile, '..');
const WebSocket = createRequire(path.join(repo, 'package.json'))('ws');
const fonts = path.join(repo, 'node_modules/@expo-google-fonts');
const layers = path.join(mobile, 'assets/mirobe.icon.orig/Assets');
const raw = path.join(assets, 'screenshots/raw');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const C = { ink: '#1A1918', iconBg: '#2B2824', ivory: '#FBF9F5', title: '#F6F3EC', gold: '#D4B06A', goldDark: '#9C7A3C', mark: '#8C877E', stone: '#EFECE6' };
const fontFaces = `
@font-face { font-family: Cormorant; font-weight: 500; src: url("file://${fonts}/cormorant-garamond/500Medium/CormorantGaramond_500Medium.ttf"); }
@font-face { font-family: Cormorant; font-weight: 500; font-style: italic; src: url("file://${fonts}/cormorant-garamond/500Medium_Italic/CormorantGaramond_500Medium_Italic.ttf"); }
@font-face { font-family: Jakarta; font-weight: 600; src: url("file://${fonts}/plus-jakarta-sans/600SemiBold/PlusJakartaSans_600SemiBold.ttf"); }`;
const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rich = (t) => escape(t).replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/\n/g, '<br>');
const doc = (w, h, bg, css, body) => `<!doctype html><html><head><meta charset="utf-8"><style>${fontFaces}
html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:${bg}}*{box-sizing:border-box}${css}</style></head><body>${body}</body></html>`;

// ---------------------------------------------------------------------------------------------
// Icon: the iOS icon (mirror + sparkle scaled up top, "mirobe" wordmark below) on the icon.json
// fill (#2B2824 with Apple's automatic gradient: a little lighter at the top). Drawn at 1024 and
// captured at scale 0.5. Square and opaque: Play applies its own rounded mask and shadow.
// ---------------------------------------------------------------------------------------------
function iconHtml() {
  const img = (f) => `<img src="file://${layers}/${f}" style="position:absolute;left:0;top:0;width:1024px;height:1024px;transform:translateY(-128px) scale(0.72);transform-origin:512px 512px;filter:drop-shadow(0 6px 10px rgba(0,0,0,.28))">`;
  const word = `<div style="position:absolute;left:0;right:0;top:626px;text-align:center;font:500 188px/1 Cormorant;color:${C.ivory};letter-spacing:2px;filter:drop-shadow(0 6px 10px rgba(0,0,0,.28))">mirobe</div>`;
  return doc(1024, 1024, C.iconBg, '', `<div style="position:absolute;inset:0;background:linear-gradient(180deg,#3A3631 0%,#2B2824 55%,#25221F 100%)"></div>${img('mirror.png')}${img('sparkle.png')}${word}`);
}

// ---------------------------------------------------------------------------------------------
// Phone: a raw capture in a rounded frame with an Android-style status bar in place of the iOS one.
// ---------------------------------------------------------------------------------------------
const RAW_W = 1206, RAW_H = 2622, IOS_BAR = 186, BAR = 104; // raw px
function phone({ shot, width, radius, outline, shadow, left, top, extraStyle = '' }) {
  const k = width / RAW_W;
  const bar = Math.round(BAR * k);
  const height = Math.round((RAW_H - IOS_BAR + BAR) * k);
  const icon = '#1A1918';
  const s = (v) => (v * k).toFixed(2);
  // The bar's background is the capture's own status bar area (its left 8 px, stretched), so it
  // keeps the screen's colour and gradient; clock and system icons are drawn on top.
  const statusBar = `<div style="position:absolute;left:0;top:0;width:100%;height:${bar}px;overflow:hidden;z-index:2">
    <img src="file://${shot}" style="position:absolute;left:0;top:0;width:${(width * RAW_W) / 8}px;height:${(bar * RAW_H) / IOS_BAR}px;max-width:none">
    <div style="position:absolute;left:${s(72)}px;top:0;height:100%;display:flex;align-items:center;font:600 ${s(36)}px/1 Jakarta;color:${icon}">9:41</div>
    <div style="position:absolute;left:50%;top:50%;width:${s(36)}px;height:${s(36)}px;margin:-${s(18)}px 0 0 -${s(18)}px;border-radius:50%;background:#0B0B0B"></div>
    <svg viewBox="0 0 120 36" style="position:absolute;right:${s(66)}px;top:50%;width:${s(124)}px;height:${s(37)}px;transform:translateY(-50%)" fill="${icon}">
      <path d="M2 14 A26 26 0 0 1 40 14 L21 34 Z"/>
      <path d="M50 34 L80 4 L80 34 Z"/>
      <rect x="92" y="6" width="16" height="28" rx="3"/><rect x="96" y="2" width="8" height="5" rx="1.5"/>
    </svg></div>`;
  return `<div style="position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;border-radius:${radius}px;overflow:hidden;background:${C.ink};box-shadow:0 0 0 ${Math.max(2, Math.round(3 * k * 1.1))}px ${outline},${shadow};${extraStyle}">
    ${statusBar}
    <img src="file://${shot}" style="position:absolute;left:0;top:${bar - Math.round(IOS_BAR * k)}px;width:${width}px;height:${Math.round(RAW_H * k)}px;max-width:none;display:block">
  </div>`;
}

// ---------------------------------------------------------------------------------------------
// Phone screenshots 1080×2160: the App Store slide layout scaled to 1080 wide (×0.818), with the
// top margin tightened (the App Store slide leaves room for the iPhone status area) so the phone
// keeps ~85 % of its height on the 2:1 canvas.
// ---------------------------------------------------------------------------------------------
const SW = 1080, SH = 2160;
const themes = {
  dark: { bg: C.ink, title: C.title, kicker: C.gold, mark: C.mark, outline: 'rgba(255,255,255,0.16)', shadow: '0 32px 74px rgba(0,0,0,0.45)' },
  light: { bg: C.stone, title: C.ink, kicker: C.goldDark, mark: C.mark, outline: 'rgba(26,25,24,0.10)', shadow: '0 32px 74px rgba(26,25,24,0.14)' },
};
function shotHtml(slide, lang) {
  const t = themes[slide.theme];
  const copy = slide[lang];
  const css = `
.top{position:absolute;left:88px;right:88px;top:170px;display:flex;align-items:center;justify-content:space-between}
.kicker{display:flex;align-items:center;gap:21px;font:600 25px/1 Jakarta,sans-serif;letter-spacing:.32em;color:${t.kicker}}
.kicker::before{content:'';width:47px;height:3px;background:${t.kicker}}
.mark{font:500 36px/1 Cormorant,serif;color:${t.mark};letter-spacing:.01em}
h1{position:absolute;left:88px;right:70px;top:228px;margin:0;font:500 92px/1.04 Cormorant,serif;color:${t.title};letter-spacing:-.01em}
h1 em{font-style:italic}`;
  const body = `<div class="top"><div class="kicker">${escape(copy.kicker)}</div><div class="mark">mirobe</div></div>
<h1>${rich(copy.title)}</h1>
${phone({ shot: path.join(raw, lang, `${slide.raw}.png`), width: 904, radius: 96, outline: t.outline, shadow: t.shadow, left: 88, top: 548 })}`;
  return doc(SW, SH, t.bg, css, body);
}

// ---------------------------------------------------------------------------------------------
// Feature graphic 1024×500: mark + wordmark + tagline on the left, the try-on screen on the right.
// Copy comes from the first App Store slide (kicker and title); the kicker line adds the stylist.
// ---------------------------------------------------------------------------------------------
const FW = 1024, FH = 500;
const feature = {
  tr: { kicker: 'SANAL DENEME · YAPAY ZEKÂ STİLİST', tagline: rich(slides[0].tr.title).replace('<br>', ' ') },
  en: { kicker: 'VIRTUAL TRY-ON · AI STYLIST', tagline: rich(slides[0].en.title) },
};
function featureHtml(lang) {
  const f = feature[lang];
  const markImg = (file) => `<img src="file://${layers}/${file}" style="position:absolute;left:-${(358 - 8) * 0.25}px;top:-${200 * 0.25}px;width:256px;height:256px;max-width:none">`;
  const css = `
.glow{position:absolute;left:-140px;top:-160px;width:760px;height:760px;background:radial-gradient(closest-side,rgba(212,176,106,.16),rgba(212,176,106,0))}
.glow2{position:absolute;right:-60px;top:-40px;width:520px;height:600px;background:radial-gradient(closest-side,rgba(246,243,236,.07),rgba(246,243,236,0))}
.brand{position:absolute;left:84px;top:132px;display:flex;align-items:center;gap:22px}
.markbox{position:relative;width:96px;height:162px;overflow:hidden;flex:0 0 auto}
.word{font:500 124px/1 Cormorant,serif;color:${C.ivory};letter-spacing:1px;margin-top:-14px}
.kicker{position:absolute;left:86px;top:84px;display:flex;align-items:center;gap:16px;font:600 15px/1 Jakarta,sans-serif;letter-spacing:.3em;color:${C.gold}}
.kicker::before{content:'';width:36px;height:2px;background:${C.gold}}
.tag{position:absolute;left:86px;top:330px;width:520px;font:500 42px/1.12 Cormorant,serif;color:${C.title}}.tag em{font-style:italic;color:${C.gold}}`;
  const body = `<div class="glow"></div><div class="glow2"></div>
<div class="kicker">${escape(f.kicker)}</div>
<div class="brand"><div class="markbox">${markImg('mirror.png')}${markImg('sparkle.png')}</div><div class="word">mirobe</div></div>
<div class="tag">${f.tagline}</div>
${phone({ shot: path.join(raw, lang, `${slides[0].raw}.png`), width: 236, radius: 30, outline: 'rgba(255,255,255,0.16)', shadow: '0 18px 44px rgba(0,0,0,.5)', left: 690, top: 58 })}`;
  return doc(FW, FH, C.ink, css, body);
}

// ---------------------------------------------------------------------------------------------
// PNG: Chrome picks RGB or RGBA by content. Play wants a 32-bit PNG for the icon and accepts
// 24-bit for the rest, so every capture is re-encoded: icon RGBA (opaque), the rest RGB.
// ---------------------------------------------------------------------------------------------
function crcTable() { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; }
const CRC = crcTable();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function pngConvert(png, outBpp) {
  let pos = 8, w = 0, h = 0, colorType = 0, depth = 0, interlace = 0; const idat = [];
  while (pos < png.length) {
    const len = png.readUInt32BE(pos); const type = png.toString('latin1', pos + 4, pos + 8); const data = png.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; colorType = data[9]; interlace = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  if (depth !== 8 || interlace || (colorType !== 6 && colorType !== 2)) throw new Error(`unsupported PNG (depth ${depth}, type ${colorType}, interlace ${interlace})`);
  const bpp = colorType === 6 ? 4 : 3, stride = w * bpp;
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = inflated[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride, prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[row + x - bpp] : 0, b = y ? px[prev + x] : 0, c = x >= bpp && y ? px[prev + x - bpp] : 0;
      let v = inflated[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[row + x] = v & 0xff;
    }
  }
  // Output rows (RGB, or RGBA with opaque alpha), each with the Paeth filter (compresses photos well).
  const ob = outBpp, rs = w * ob, rgb = Buffer.alloc(h * rs), outRows = Buffer.alloc(h * (rs + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = y * stride + x * bpp, d = y * rs + x * ob; rgb[d] = px[s]; rgb[d + 1] = px[s + 1]; rgb[d + 2] = px[s + 2]; if (ob === 4) rgb[d + 3] = bpp === 4 ? px[s + 3] : 255; }
  for (let y = 0; y < h; y++) {
    const o = y * (rs + 1); outRows[o] = 4;
    for (let x = 0; x < rs; x++) {
      const a = x >= ob ? rgb[y * rs + x - ob] : 0, b = y ? rgb[(y - 1) * rs + x] : 0, c = x >= ob && y ? rgb[(y - 1) * rs + x - ob] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      outRows[o + 1 + x] = (rgb[y * rs + x] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = ob === 4 ? 6 : 2;
  return Buffer.concat([png.subarray(0, 8), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(outRows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------------------------------------
const want = new Set(process.argv.slice(2));
const all = want.size === 0;
const work = mkdtempSync(path.join(tmpdir(), 'mirobe-play-'));
const port = 9500 + Math.floor(Math.random() * 300);
const browser = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, '--hide-scrollbars', '--use-mock-keychain', '--password-store=basic',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--allow-file-access-from-files', `--user-data-dir=${path.join(work, 'profile')}`, 'about:blank'], { stdio: 'ignore' });
try {
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    await new Promise((r) => setTimeout(r, 150));
    target = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).then((l) => l.find((t) => t.type === 'page')).catch(() => undefined);
  }
  if (!target) throw new Error('headless Chrome did not start');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  let seq = 0; const waiting = new Map(); const events = [];
  ws.on('message', (m) => { const d = JSON.parse(m.toString()); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } else if (d.method) events.push(d.method); });
  const cdp = (method, params = {}) => new Promise((res, rej) => { const n = ++seq; waiting.set(n, (d) => (d.error ? rej(new Error(`${method}: ${d.error.message}`)) : res(d.result))); ws.send(JSON.stringify({ id: n, method, params })); });
  await cdp('Page.enable');
  const render = async (html, w, h, file, { scale = 1, alpha = false } = {}) => {
    await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    const page = path.join(work, `${path.basename(file)}.html`);
    writeFileSync(page, html); events.length = 0;
    await cdp('Page.navigate', { url: `file://${page}` });
    for (let t = 0; t < 200 && !events.includes('Page.loadEventFired'); t++) await new Promise((r) => setTimeout(r, 50));
    await cdp('Runtime.evaluate', { expression: 'Promise.all([document.fonts.ready,...[...document.images].map((i)=>i.decode())]).then(()=>true)', awaitPromise: true });
    const { data } = await cdp('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: h, scale } });
    const png = Buffer.from(data, 'base64');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, pngConvert(png, alpha ? 4 : 3));
    console.log(path.relative(out, file));
  };
  if (all || want.has('icon')) await render(iconHtml(), 1024, 1024, path.join(out, 'icon-512.png'), { scale: 0.5, alpha: true });
  if (all || want.has('feature')) for (const lang of ['tr', 'en']) await render(featureHtml(lang), FW, FH, path.join(out, `feature-graphic-${lang}.png`));
  if (all || want.has('shots')) {
    for (const lang of ['tr', 'en']) for (const [i, slide] of slides.entries()) {
      if (!existsSync(path.join(raw, lang, `${slide.raw}.png`))) { console.log(`skip ${lang}/${slide.raw}: no raw capture`); continue; }
      await render(shotHtml(slide, lang), SW, SH, path.join(out, 'screenshots', lang, `${String(i + 1).padStart(2, '0')}.png`));
    }
  }
  ws.close();
} finally {
  const exited = new Promise((r) => browser.once('exit', r));
  browser.kill('SIGKILL');
  await exited;
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
