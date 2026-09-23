// Evaluate JS in the Mirobe dev app (Metro :8082). Usage: node cdp.mjs '<expr>'. Defines M = { store, router, billing, notif }.
// Async results: run `park(promise)` then read globalThis.__out in a second call (promises don't resolve over CDP).
import { createRequire } from 'node:module';
const WebSocket = createRequire('/Users/eren/Projects/mirobe/package.json')('ws');
const targets = await (await fetch('http://127.0.0.1:8082/json/list')).json();
const target = targets.find((t) => t.title?.startsWith('com.orbexastudio.mirobe')) ?? targets[0];
if (!target) throw new Error('no debug target on :8082');
const prelude = `(() => { const f = {}; for (const [, m] of globalThis.__r.getModules()) { if (!m.isInitialized) continue; const e = m.publicModule?.exports; if (!e) continue;
  if (e.getState && e.setLang && e.chatWithStylist) f.store = e; if (e.router?.push && e.useLocalSearchParams) f.router = e.router;
  if (e.fallbackAmount && e.restore) f.billing = e; if (e.setDailyReminder && e.registerDevice) f.notif = e; if (e.LogBox?.ignoreAllLogs) f.rn = e; }
  globalThis.M = f; globalThis.park = (p) => { globalThis.__out = { done: false }; Promise.resolve(p).then((v) => { globalThis.__out = { done: true, value: v }; }, (e) => { globalThis.__out = { done: true, error: String(e?.message ?? e), code: e?.code ?? null }; }); return 'parked'; }; })()`;
const ws = new WebSocket(target.webSocketDebuggerUrl, { headers: { Origin: 'http://127.0.0.1:8082' } });
let id = 0; const pending = new Map();
ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
const evaluate = (expression) => new Promise((resolve) => { const n = ++id; pending.set(n, (m) => resolve(m.result?.exceptionDetails ? { error: m.result.exceptionDetails.exception?.description } : m.result?.result?.value)); ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression, returnByValue: true } })); });
await evaluate(prelude);
const out = await evaluate(process.argv[2] ?? 'Object.keys(M)');
console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 1));
ws.close();
