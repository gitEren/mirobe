// Google Play Developer API helper (service account from firebase.mjs).
import { readFileSync } from 'node:fs';
import { gapi, token } from './firebase.mjs';
export const PKG = 'com.orbexastudio.mirobe';
export const B = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PKG}`;
export { gapi };
export async function upload(url, file, contentType) {
  const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': contentType }, body: readFileSync(file) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, json: j };
}
