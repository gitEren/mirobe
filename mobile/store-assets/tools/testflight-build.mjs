import { all, api, errs } from './asc.mjs';
const BUILD = process.argv[2], INTERNAL = '2c3a96a0-b963-4148-a86a-3a61397d4a47', EXTERNAL = 'a9a8bc28-9952-454b-933d-6c67cc3e8080';
const say = (l, r) => console.log(l, r.status, errs(r));
const b = (await api('GET', `/v1/builds/${BUILD}`)).json.data.attributes;
console.log('build', b.version, 'encryption declared:', b.usesNonExemptEncryption, 'expired:', b.expired);
const notes = {
  'en-US': 'First test build. Please try: sign up, allow AI processing, scan a few clothes, ask Jev for an outfit, try a look on your mirror photo, and buy Plus or Pro (TestFlight purchases are free sandbox purchases). Check that the "Payment received" notification arrives.',
  tr: 'İlk test sürümü. Lütfen dene: kayıt ol, yapay zekâ iznini ver, birkaç kıyafet tara, Jev’den kombin iste, kombini ayna fotoğrafında dene ve Plus ya da Pro satın al (TestFlight satın almaları ücretsiz sandbox’tır). "Ödemen alındı" bildiriminin geldiğini kontrol et.',
};
const locs = await all(`/v1/builds/${BUILD}/betaBuildLocalizations`);
for (const [locale, whatsNew] of Object.entries(notes)) {
  const f = locs.find((l) => l.attributes.locale === locale);
  say(`what to test ${locale}`, f
    ? await api('PATCH', `/v1/betaBuildLocalizations/${f.id}`, { data: { type: 'betaBuildLocalizations', id: f.id, attributes: { whatsNew } } })
    : await api('POST', '/v1/betaBuildLocalizations', { data: { type: 'betaBuildLocalizations', attributes: { locale, whatsNew }, relationships: { build: { data: { type: 'builds', id: BUILD } } } } }));
}
say('internal group', await api('POST', `/v1/betaGroups/${INTERNAL}/relationships/builds`, { data: [{ type: 'builds', id: BUILD }] }));
say('external group', await api('POST', `/v1/betaGroups/${EXTERNAL}/relationships/builds`, { data: [{ type: 'builds', id: BUILD }] }));
say('beta review submission', await api('POST', '/v1/betaAppReviewSubmissions', { data: { type: 'betaAppReviewSubmissions', relationships: { build: { data: { type: 'builds', id: BUILD } } } } }));
const s = (await api('GET', `/v1/builds/${BUILD}/betaAppReviewSubmission`)).json?.data?.attributes;
const d = (await api('GET', `/v1/builds/${BUILD}/buildBetaDetail`)).json?.data?.attributes;
console.log('beta review state:', s?.betaReviewState, '| internal:', d?.internalBuildState, '| external:', d?.externalBuildState);
