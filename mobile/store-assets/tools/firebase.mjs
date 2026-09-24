// Firebase Management + FCM helper using the Mirobe service account (~/.personal-dev/firebase/...).
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
const sa = JSON.parse(readFileSync(`${homedir()}/.personal-dev/firebase/mirobe-fcm-service-account.json`, 'utf8'));
export const PROJECT = sa.project_id;
let cached = null;
export async function token() {
  if (cached && cached.exp > Date.now() / 1000 + 60) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/androidpublisher', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
  const jwt = head + '.' + sign('RSA-SHA256', Buffer.from(head), createPrivateKey(sa.private_key)).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}` });
  const d = await r.json(); if (!d.access_token) throw new Error('token: ' + JSON.stringify(d));
  cached = { token: d.access_token, exp: now + 3500 }; return d.access_token;
}
export async function gapi(method, url, body) {
  const r = await fetch(url, { method, headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, json: j };
}
