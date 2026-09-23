// TestFlight metadata, beta review info, internal tester (account holder) and an external "Arkadaşlar" group.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { all, api, errs, APP_ID } from './asc.mjs';
const creds = readFileSync(`${homedir()}/.appstoreconnect/mirobe-demo-account.txt`, 'utf8');
const demoEmail = creds.match(/Email: (\S+)/)[1], demoPassword = creds.match(/Password: (\S+)/)[1];
const say = (label, r) => console.log(label, r.status, errs(r));

const texts = {
  'en-US': 'Mirobe is a digital wardrobe. Photograph your clothes and AI tags them, ask the Jev stylist for an outfit from your own wardrobe, and try looks on a full-length photo of yourself.',
  tr: 'Mirobe dijital gardırobun. Kıyafetlerini fotoğrafla, yapay zekâ etiketlesin; Jev stilistten kendi gardırobundan kombin iste ve kombinleri tam boy fotoğrafının üzerinde dene.',
};
const existing = await all(`/v1/apps/${APP_ID}/betaAppLocalizations`);
for (const [locale, description] of Object.entries(texts)) {
  const found = existing.find((l) => l.attributes.locale === locale);
  const attributes = { description, feedbackEmail: 'support@orbexastudio.com.tr', privacyPolicyUrl: `https://mirobe.orbexastudio.com.tr/api/legal/privacy?lang=${locale === 'tr' ? 'tr' : 'en'}` };
  say(`beta localization ${locale}`, found
    ? await api('PATCH', `/v1/betaAppLocalizations/${found.id}`, { data: { type: 'betaAppLocalizations', id: found.id, attributes } })
    : await api('POST', '/v1/betaAppLocalizations', { data: { type: 'betaAppLocalizations', attributes: { locale, ...attributes }, relationships: { app: { data: { type: 'apps', id: APP_ID } } } } }));
}

say('beta review detail', await api('PATCH', `/v1/betaAppReviewDetails/${APP_ID}`, { data: { type: 'betaAppReviewDetails', id: APP_ID, attributes: {
  contactFirstName: 'Ahmet Eren', contactLastName: 'Baydar', contactPhone: '+90 543 948 21 77', contactEmail: 'erenbaydars@icloud.com',
  demoAccountRequired: true, demoAccountName: demoEmail, demoAccountPassword: demoPassword,
  notes: 'AI features need an account; the demo account has a sample wardrobe and Pro access. In-app purchases in TestFlight use the sandbox and are free.' } } }));

const groups = await all(`/v1/apps/${APP_ID}/betaGroups`);
const internal = groups.find((g) => g.attributes.isInternalGroup);
const internalTesters = await all(`/v1/betaGroups/${internal.id}/betaTesters`);
if (!internalTesters.some((t) => t.attributes.email === 'erenbaydars@icloud.com')) {
  say('internal tester', await api('POST', '/v1/betaTesters', { data: { type: 'betaTesters', attributes: { email: 'erenbaydars@icloud.com', firstName: 'Eren', lastName: 'Baydar' }, relationships: { betaGroups: { data: [{ type: 'betaGroups', id: internal.id }] } } } }));
} else console.log('internal tester already in', internal.attributes.name);

let external = groups.find((g) => !g.attributes.isInternalGroup && g.attributes.name === 'Arkadaşlar');
if (!external) {
  const r = await api('POST', '/v1/betaGroups', { data: { type: 'betaGroups', attributes: { name: 'Arkadaşlar' }, relationships: { app: { data: { type: 'apps', id: APP_ID } } } } });
  say('external group', r); external = r.json?.data;
}
const friends = await all(`/v1/betaGroups/${external.id}/betaTesters`);
if (!friends.some((t) => t.attributes.email === 'm.bugramercanli@gmail.com')) {
  say('external tester', await api('POST', '/v1/betaTesters', { data: { type: 'betaTesters', attributes: { email: 'm.bugramercanli@gmail.com' }, relationships: { betaGroups: { data: [{ type: 'betaGroups', id: external.id }] } } } }));
} else console.log('friend already in Arkadaşlar');
console.log('groups:', internal.id, external.id);
