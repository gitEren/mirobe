// Rebuilds the icon layers: mirror + sparkle scaled up-top, "mirobe" wordmark below. Usage: node icon.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const WebSocket = createRequire('/Users/eren/Projects/mirobe/package.json')('ws');
const ROOT = '/Users/eren/Projects/mirobe/mobile';
const ORIG = `${ROOT}/assets/mirobe.icon.orig/Assets`;
const FONT = '/Users/eren/Projects/mirobe/node_modules/@expo-google-fonts/cormorant-garamond/500Medium/CormorantGaramond_500Medium.ttf';
const SCALE = 0.72, SHIFT = -128, BG = '#2B2824';
const layer = (inner) => `<!doctype html><html><head><style>@font-face{font-family:C;src:url("file://${FONT}")}html,body{margin:0;width:1024px;height:1024px;background:transparent;overflow:hidden}</style></head><body>${inner}</body></html>`;
const img = (f) => `<img src="file://${ORIG}/${f}" style="position:absolute;left:0;top:0;width:1024px;height:1024px;transform:translateY(${SHIFT}px) scale(${SCALE});transform-origin:512px 512px">`;
const word = `<div style="position:absolute;left:0;right:0;top:${626}px;text-align:center;font:500 188px/1 C;color:#FBF9F5;letter-spacing:2px">mirobe</div>`;
const pages = {
  [`${ROOT}/assets/mirobe.icon/Assets/mirror.png`]: layer(img('mirror.png')),
  [`${ROOT}/assets/mirobe.icon/Assets/sparkle.png`]: layer(img('sparkle.png')),
  [`${ROOT}/assets/mirobe.icon/Assets/wordmark.png`]: layer(word),
  ['/tmp/icon-preview.png']: layer(`<div style="position:absolute;inset:0;background:${BG};border-radius:228px"></div>${img('mirror.png')}${img('sparkle.png')}${word}`),
};
const work = mkdtempSync(path.join(tmpdir(), 'icon-'));
const port = 9800 + Math.floor(Math.random() * 100);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, '--use-mock-keychain', '--password-store=basic', '--no-first-run', '--allow-file-access-from-files', `--user-data-dir=${work}/p`, 'about:blank'], { stdio: 'ignore' });
try {
  let t; for (let i = 0; i < 100 && !t; i++) { await new Promise((r) => setTimeout(r, 150)); t = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).then((l) => l.find((x) => x.type === 'page')).catch(() => null); }
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.once('open', r));
  let n = 0; const w = new Map(); const ev = [];
  ws.on('message', (m) => { const d = JSON.parse(m); if (d.id && w.has(d.id)) { w.get(d.id)(d.result); w.delete(d.id); } else if (d.method) ev.push(d.method); });
  const cdp = (method, params = {}) => new Promise((r) => { const i = ++n; w.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1024, height: 1024, deviceScaleFactor: 1, mobile: false });
  await cdp('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  for (const [out, html] of Object.entries(pages)) {
    const file = `${work}/${path.basename(out)}.html`; writeFileSync(file, html); ev.length = 0;
    await cdp('Page.navigate', { url: `file://${file}` });
    for (let i = 0; i < 200 && !ev.includes('Page.loadEventFired'); i++) await new Promise((r) => setTimeout(r, 50));
    await cdp('Runtime.evaluate', { expression: 'Promise.all([document.fonts.ready,...[...document.images].map(i=>i.decode())])', awaitPromise: true });
    const { data } = await cdp('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1024, height: 1024, scale: 1 } });
    writeFileSync(out, Buffer.from(data, 'base64')); console.log('wrote', out);
  }
  ws.close();
} finally { chrome.kill('SIGKILL'); await new Promise((r) => setTimeout(r, 300)); rmSync(work, { recursive: true, force: true }); }
