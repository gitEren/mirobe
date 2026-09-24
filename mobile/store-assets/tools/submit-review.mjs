// Submits version 1.0.0 with its four first-time subscriptions to App Review. Usage: node submit-review.mjs [--dry]
import { all, api, errs, APP_ID } from './asc.mjs';
const dry = process.argv.includes('--dry');
const say = (l, r) => console.log(l, r.status, errs(r));
const version = (await all(`/v1/apps/${APP_ID}/appStoreVersions`)).find((v) => v.attributes.appStoreState === 'PREPARE_FOR_SUBMISSION');
if (!version) throw new Error('no version in PREPARE_FOR_SUBMISSION');
const build = (await api('GET', `/v1/appStoreVersions/${version.id}/build`)).json?.data;
const group = (await all(`/v1/apps/${APP_ID}/subscriptionGroups`))[0];
const subs = await all(`/v1/subscriptionGroups/${group.id}/subscriptions`);
console.log('version', version.attributes.versionString, 'build', build?.attributes?.version, '| subs', subs.map((s) => `${s.attributes.productId}:${s.attributes.state}`).join(', '));
if (!build) throw new Error('no build attached');
if (dry) process.exit(0);
// First subscriptions go in with the version: submit each, then the version's review submission.
for (const s of subs.filter((x) => x.attributes.state === 'READY_TO_SUBMIT')) {
  say(`subscription ${s.attributes.productId}`, await api('POST', '/v1/subscriptionSubmissions', { data: { type: 'subscriptionSubmissions', relationships: { subscription: { data: { type: 'subscriptions', id: s.id } } } } }));
}
let sub = (await all(`/v1/reviewSubmissions?filter[app]=${APP_ID}&filter[state]=READY_FOR_REVIEW`))[0];
if (!sub) {
  const r = await api('POST', '/v1/reviewSubmissions', { data: { type: 'reviewSubmissions', attributes: { platform: 'IOS' }, relationships: { app: { data: { type: 'apps', id: APP_ID } } } } });
  say('review submission', r); sub = r.json.data;
}
say('add version', await api('POST', '/v1/reviewSubmissionItems', { data: { type: 'reviewSubmissionItems', relationships: { reviewSubmission: { data: { type: 'reviewSubmissions', id: sub.id } }, appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } } } } }));
const items = await all(`/v1/reviewSubmissions/${sub.id}/items`);
console.log('items in submission:', items.length);
say('submit', await api('PATCH', `/v1/reviewSubmissions/${sub.id}`, { data: { type: 'reviewSubmissions', id: sub.id, attributes: { submitted: true } } }));
const after = (await api('GET', `/v1/reviewSubmissions/${sub.id}`)).json?.data?.attributes;
const v2 = (await api('GET', `/v1/appStoreVersions/${version.id}`)).json?.data?.attributes;
console.log('submission state:', after?.state, '| version state:', v2?.appStoreState);
for (const s of await all(`/v1/subscriptionGroups/${group.id}/subscriptions`)) console.log(' ', s.attributes.productId, s.attributes.state);
