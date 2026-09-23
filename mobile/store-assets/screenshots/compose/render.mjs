// Renders the App Store screenshots from raw simulator captures with headless Chrome.
// Usage: node render.mjs [en|tr] [01 02 …]   → ../<lang>/<nn>.png and ../index.html
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slides } from './slides.mjs';

const WebSocket = createRequire(import.meta.url)('ws');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const repo = path.resolve(root, '../../..');
const fonts = path.join(repo, 'node_modules/@expo-google-fonts');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const W = 1320;
const H = 2868;

const themes = {
  dark: { bg: '#1A1918', title: '#F6F3EC', kicker: '#D4B06A', mark: '#8C877E', outline: 'rgba(255,255,255,0.16)', shadow: '0 40px 90px rgba(0,0,0,0.45)' },
  light: { bg: '#EFECE6', title: '#1A1918', kicker: '#9C7A3C', mark: '#8C877E', outline: 'rgba(26,25,24,0.10)', shadow: '0 40px 90px rgba(26,25,24,0.14)' },
};

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const titleHtml = (t) => escape(t).replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/\n/g, '<br>');

function page(slide, lang) {
  const theme = themes[slide.theme];
  const copy = slide[lang];
  const shot = path.join(root, 'raw', lang, `${slide.raw}.png`);
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>
@font-face { font-family: Cormorant; font-weight: 500; src: url("file://${fonts}/cormorant-garamond/500Medium/CormorantGaramond_500Medium.ttf"); }
@font-face { font-family: Cormorant; font-weight: 500; font-style: italic; src: url("file://${fonts}/cormorant-garamond/500Medium_Italic/CormorantGaramond_500Medium_Italic.ttf"); }
@font-face { font-family: Jakarta; font-weight: 600; src: url("file://${fonts}/plus-jakarta-sans/600SemiBold/PlusJakartaSans_600SemiBold.ttf"); }
html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: ${theme.bg}; }
.top { position: absolute; left: 108px; right: 108px; top: 292px; display: flex; align-items: center; justify-content: space-between; }
.kicker { display: flex; align-items: center; gap: 26px; font: 600 30px/1 Jakarta, sans-serif; letter-spacing: 0.32em; color: ${theme.kicker}; }
.kicker::before { content: ''; width: 58px; height: 3px; background: ${theme.kicker}; }
.mark { font: 500 44px/1 Cormorant, serif; color: ${theme.mark}; letter-spacing: 0.01em; }
h1 { position: absolute; left: 108px; right: 90px; top: 362px; margin: 0; font: 500 112px/1.04 Cormorant, serif; color: ${theme.title}; letter-spacing: -0.01em; }
h1 em { font-style: italic; }
.phone { position: absolute; left: 108px; top: 800px; width: 1104px; height: ${Math.round((2622 * 1104) / 1206)}px; border-radius: 150px; overflow: hidden; box-shadow: 0 0 0 3px ${theme.outline}, ${theme.shadow}; }
.phone img { width: 100%; height: 100%; display: block; }
</style></head><body>
<div class="top"><div class="kicker">${escape(copy.kicker)}</div><div class="mark">mirobe</div></div>
<h1>${titleHtml(copy.title)}</h1>
<div class="phone"><img src="file://${shot}"></div>
</body></html>`;
}

const langs = process.argv[2] ? [process.argv[2]] : ['en', 'tr'];
const only = process.argv.slice(3);
const work = mkdtempSync(path.join(tmpdir(), 'mirobe-shots-'));
const port = 9400 + Math.floor(Math.random() * 400);
// One headless Chrome driven over the DevTools protocol: `--screenshot` writes the file but never exits here.
const browser = spawn(chrome, [
  '--headless=new', `--remote-debugging-port=${port}`, '--hide-scrollbars', '--use-mock-keychain', '--password-store=basic',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--allow-file-access-from-files',
  `--user-data-dir=${path.join(work, 'profile')}`, 'about:blank',
], { stdio: 'ignore' });
try {
  let pageTarget;
  for (let i = 0; i < 100 && !pageTarget; i++) {
    await new Promise((r) => setTimeout(r, 150));
    pageTarget = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).then((list) => list.find((t) => t.type === 'page')).catch(() => undefined);
  }
  if (!pageTarget) throw new Error('headless Chrome did not start');
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  let seq = 0;
  const waiting = new Map();
  const events = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
    else if (msg.method) events.push(msg.method);
  });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++seq;
    waiting.set(n, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  for (const lang of langs) {
    mkdirSync(path.join(root, lang), { recursive: true });
    for (const [i, slide] of slides.entries()) {
      const nn = String(i + 1).padStart(2, '0');
      if (only.length && !only.includes(nn)) continue;
      const shot = path.join(root, 'raw', lang, `${slide.raw}.png`);
      if (!existsSync(shot)) { console.log(`skip ${lang}/${nn}: no raw capture ${slide.raw}`); continue; }
      const html = path.join(work, `${lang}-${nn}.html`);
      writeFileSync(html, page(slide, lang));
      events.length = 0;
      await cdp('Page.navigate', { url: `file://${html}` });
      for (let t = 0; t < 200 && !events.includes('Page.loadEventFired'); t++) await new Promise((r) => setTimeout(r, 50));
      await cdp('Runtime.evaluate', { expression: 'Promise.all([document.fonts.ready, ...[...document.images].map((i) => i.decode())]).then(() => true)', awaitPromise: true });
      const { data } = await cdp('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
      writeFileSync(path.join(root, lang, `${nn}.png`), Buffer.from(data, 'base64'));
      console.log(`${lang}/${nn}.png`);
    }
  }
  ws.close();
} finally {
  const exited = new Promise((resolve) => browser.once('exit', resolve));
  browser.kill('SIGKILL');
  await exited;
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

// Contact sheet for review.
const rows = ['tr', 'en']
  .map((lang) => `<h2>${lang === 'tr' ? 'Türkçe' : 'English'}</h2><div class="row">${slides
    .map((_, i) => {
      const file = `${lang}/${String(i + 1).padStart(2, '0')}.png`;
      return existsSync(path.join(root, file)) ? `<img src="${file}">` : `<div class="todo">${file}<br>hazırlanıyor</div>`;
    })
    .join('')}</div>`)
  .join('');
writeFileSync(path.join(root, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><title>Mirobe App Store screenshots</title>
<style>body{background:#e9e6e0;font:14px -apple-system,sans-serif;margin:24px;color:#1a1918}h2{font-weight:600;margin:24px 0 12px}
.row{display:flex;gap:16px;overflow-x:auto;padding-bottom:12px}img{height:640px;border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.18)}.todo{height:640px;width:295px;flex:0 0 auto;border-radius:14px;border:2px dashed #b9b3a8;display:flex;align-items:center;justify-content:center;text-align:center;color:#78746d}</style>
</head><body><h1>Mirobe · App Store (1320×2868)</h1>${rows}</body></html>`);
