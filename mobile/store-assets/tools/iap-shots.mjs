// Replaces the App Review screenshot of every subscription. Usage: node iap-shots.mjs <png>
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { all, api, errs, APP_ID } from './asc.mjs';
const bytes = readFileSync(process.argv[2]);
const md5 = createHash('md5').update(bytes).digest('hex');
const group = (await all(`/v1/apps/${APP_ID}/subscriptionGroups`))[0];
for (const sub of await all(`/v1/subscriptionGroups/${group.id}/subscriptions`)) {
  const old = (await api('GET', `/v1/subscriptions/${sub.id}/appStoreReviewScreenshot`)).json?.data;
  if (old) await api('DELETE', `/v1/subscriptionAppStoreReviewScreenshots/${old.id}`);
  const c = await api('POST', '/v1/subscriptionAppStoreReviewScreenshots', { data: { type: 'subscriptionAppStoreReviewScreenshots', attributes: { fileName: 'mirobe-paywall.png', fileSize: bytes.length }, relationships: { subscription: { data: { type: 'subscriptions', id: sub.id } } } } });
  if (c.status !== 201) { console.log(sub.attributes.productId, c.status, errs(c)); continue; }
  for (const op of c.json.data.attributes.uploadOperations) {
    const put = await fetch(op.url, { method: op.method, headers: Object.fromEntries((op.requestHeaders ?? []).map((h) => [h.name, h.value])), body: bytes.subarray(op.offset, op.offset + op.length) });
    if (!put.ok) throw new Error(`upload ${put.status}`);
  }
  const d = await api('PATCH', `/v1/subscriptionAppStoreReviewScreenshots/${c.json.data.id}`, { data: { type: 'subscriptionAppStoreReviewScreenshots', id: c.json.data.id, attributes: { uploaded: true, sourceFileChecksum: md5 } } });
  console.log(sub.attributes.productId, 'replaced', d.status, errs(d));
}
await new Promise((r) => setTimeout(r, 8000));
for (const sub of await all(`/v1/subscriptionGroups/${group.id}/subscriptions`)) {
  const s = (await api('GET', `/v1/subscriptions/${sub.id}/appStoreReviewScreenshot`)).json?.data;
  console.log(sub.attributes.productId.padEnd(20), sub.attributes.state, s?.attributes?.assetDeliveryState?.state);
}
