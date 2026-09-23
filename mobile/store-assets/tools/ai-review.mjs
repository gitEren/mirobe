// Pulls the demo account's AI outputs (tags, studio images, try-ons) into store-assets/ai-review and, with --video, makes one Pro clip.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
const U = 'https://mirobe.orbexastudio.com.tr';
const OUT = '/Users/eren/Projects/mirobe/mobile/store-assets/ai-review';
const creds = readFileSync(`${homedir()}/.appstoreconnect/mirobe-demo-account.txt`, 'utf8');
const email = creds.match(/Email: (\S+)/)[1], password = creds.match(/Password: (\S+)/)[1];
const j = async (method, path, token, body) => {
  const r = await fetch(U + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, data: d };
};
const login = await j('POST', '/api/auth/login', null, { email, password });
const token = login.data.token;
if (!token) throw new Error('login failed ' + login.status);
const pull = async () => (await j('GET', '/api/sync/pull?since=0&limit=500', token)).data.changes;
const media = async (url, name) => {
  if (!url) return null;
  const file = `${OUT}/${name}`;
  if (!existsSync(file)) writeFileSync(file, Buffer.from(await (await fetch(U + url)).arrayBuffer()));
  return name;
};
try {
  if (process.argv.includes('--video')) {
    const target = process.argv[process.argv.indexOf('--video') + 1];
    console.log('consent on', (await j('POST', '/api/me/ai-consent', token, { granted: true })).status);
    try {
      const r = await j('POST', `/api/tryons/${target}/video`, token, {});
      console.log('video request', r.status, r.data?.code ?? r.data?.tryon?.videoStatus);
      for (let i = 0; i < 60; i++) {
        const t = (await pull()).tryons.find((x) => (x.row ?? x).id === target);
        const row = t?.row ?? t;
        if (row?.videoStatus && row.videoStatus !== 'processing') { console.log('video', row.videoStatus, row.videoUrl ? 'ready' : ''); break; }
        await new Promise((res) => setTimeout(res, 10000));
      }
    } finally {
      console.log('consent back off', (await j('POST', '/api/me/ai-consent', token, { granted: false })).status);
    }
  }
  const changes = await pull();
  const rows = (list) => list.map((x) => x.row ?? x).filter((r) => !r.deletedAt);
  const garments = [];
  for (const g of rows(changes.garments)) {
    garments.push({ ...g, _photo: await media(g.imageUrl, `g-${g.id}-photo.jpg`), _studio: await media(g.packshotUrl, `g-${g.id}-studio.png`) });
  }
  const tryons = [];
  for (const t of rows(changes.tryons)) tryons.push({ ...t, _image: await media(t.imageUrl, `t-${t.id}.png`), _video: await media(t.videoUrl, `t-${t.id}.mp4`) });
  const avatars = [];
  for (const a of rows(changes.avatars)) avatars.push({ ...a, _image: await media(a.imageUrl, `a-${a.id}.jpg`) });
  writeFileSync(`${OUT}/data.json`, JSON.stringify({ garments, tryons, avatars, looks: rows(changes.looks) }, null, 1));
  console.log('garments', garments.length, 'tryons', tryons.length, 'avatars', avatars.length, 'videos', tryons.filter((t) => t._video).length);
} finally {
  await j('POST', '/api/auth/logout', token, {});
}
