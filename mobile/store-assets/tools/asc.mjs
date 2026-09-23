// Minimal App Store Connect API client (key 5H5S5DGPBZ; see memory apple-account).
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
const KID = '5H5S5DGPBZ', ISS = '0e336571-15f9-4bf4-bac6-a14f880a7752';
export const APP_ID = '6815128043';
const key = createPrivateKey(readFileSync(`${homedir()}/.appstoreconnect/private_keys/AuthKey_${KID}.p8`));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function token() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'ES256', kid: KID, typ: 'JWT' }) + '.' + b64({ iss: ISS, iat: now, exp: now + 1100, aud: 'appstoreconnect-v1' });
  return head + '.' + sign('sha256', Buffer.from(head), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
}
export async function api(method, path, body) {
  const r = await fetch(path.startsWith('http') ? path : `https://api.appstoreconnect.apple.com${path}`, { method, headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: r.status, json };
}
export async function all(path) {
  const out = []; let next = path;
  while (next) { const r = await api('GET', next); if (r.status >= 300) throw new Error(`${path}: ${r.status}`); out.push(...(r.json.data ?? [])); next = r.json.links?.next ?? null; }
  return out;
}
export const errs = (r) => (r.json?.errors ?? []).map((e) => `${e.code}: ${e.detail ?? e.title}`).join(' | ');
