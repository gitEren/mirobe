import { readFileSync } from 'node:fs';
import { B, gapi, upload } from './play.mjs';
const A = '/Users/eren/Projects/mirobe/mobile/store-assets/android';
const md = readFileSync(`${A}/listing.md`, 'utf8');
const en = md.slice(md.indexOf('## English (en-US)'), md.indexOf('## Graphics'));
const blocks = [...en.matchAll(/```text\n([\s\S]*?)\n```/g)].map((m) => m[1]);
const [title, shortDescription, fullDescription] = blocks;
console.log('lengths', title.length, shortDescription.length, fullDescription.length);
const e = await gapi('POST', `${B}/edits`, {}); const E = `${B}/edits/${e.json.id}`; const UP = E.replace('/androidpublisher/v3/', '/upload/androidpublisher/v3/');
const l = await gapi('PUT', `${E}/listings/en-US`, { language: 'en-US', title, shortDescription, fullDescription });
console.log('listing', l.status, l.json.title || JSON.stringify(l.json).slice(0, 300));
for (const [type, files] of [['icon', ['icon-512.png']], ['featureGraphic', ['feature-graphic-en.png']], ['phoneScreenshots', ['01', '02', '03', '04', '05', '06'].map((n) => `screenshots/en/${n}.png`)]]) {
  await gapi('DELETE', `${E}/listings/en-US/${type}`);
  for (const f of files) { const r = await upload(`${UP}/listings/en-US/${type}?uploadType=media`, `${A}/${f}`, 'image/png'); console.log(type, f, r.status, r.status >= 300 ? JSON.stringify(r.json).slice(0, 200) : ''); }
}
let c = await gapi('POST', `${E}:commit`);
if (c.status >= 300 && JSON.stringify(c.json).includes('changesNotSentForReview')) c = await gapi('POST', `${E}:commit?changesNotSentForReview=true`);
console.log('commit', c.status, c.status >= 300 ? JSON.stringify(c.json).slice(0, 400) : 'ok');
