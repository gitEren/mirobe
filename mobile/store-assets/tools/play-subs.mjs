import { B, gapi } from './play.mjs';
const money = (cur, v) => { const [u, n = '0'] = String(v).split('.'); return { currencyCode: cur, units: u, nanos: Number((n + '000000000').slice(0, 9)) }; };
const SUBS = [
  { id: 'mirobe_plus_monthly', plan: 'monthly', period: 'P1M', usd: '9.99', try: '499.99', tr: ['Mirobe Plus Aylık', 'Her ay 100 görsel, 300 Jev isteği'], en: ['Mirobe Plus Monthly', '100 images and 300 Jev requests a month'] },
  { id: 'mirobe_plus_annual', plan: 'annual', period: 'P1Y', usd: '99.99', try: '4999.99', tr: ['Mirobe Plus Yıllık', 'Tüm Plus özellikleri, yıllık ödemeyle'], en: ['Mirobe Plus Yearly', 'All Plus features, billed yearly'] },
  { id: 'mirobe_pro_monthly', plan: 'monthly', period: 'P1M', usd: '19.99', try: '1199.99', tr: ['Mirobe Pro Aylık', 'Her ay 200 görsel, 8 video, 750 Jev isteği'], en: ['Mirobe Pro Monthly', '200 images, 8 videos, 750 Jev requests a month'] },
  { id: 'mirobe_pro_annual', plan: 'annual', period: 'P1Y', usd: '199.99', try: '11999.99', tr: ['Mirobe Pro Yıllık', 'Tüm Pro özellikleri, yıllık ödemeyle'], en: ['Mirobe Pro Yearly', 'All Pro features, billed yearly'] },
];
for (const s of SUBS) {
  const conv = await gapi('POST', `${B}/pricing:convertRegionPrices`, { price: money('USD', s.usd) });
  if (conv.status >= 300) { console.log('convert', conv.status, JSON.stringify(conv.json).slice(0, 300)); break; }
  const regionalConfigs = Object.values(conv.json.convertedRegionPrices).map((r) => ({ regionCode: r.regionCode, newSubscriberAvailability: true, price: r.regionCode === 'TR' ? money('TRY', s.try) : r.price }));
  const body = {
    packageName: 'com.orbexastudio.mirobe', productId: s.id,
    listings: [{ languageCode: 'tr-TR', title: s.tr[0], description: s.tr[1] }, { languageCode: 'en-US', title: s.en[0], description: s.en[1] }],
    basePlans: [{ basePlanId: s.plan, autoRenewingBasePlanType: { billingPeriodDuration: s.period, gracePeriodDuration: 'P3D', resubscribeState: 'RESUBSCRIBE_STATE_ACTIVE', prorationMode: 'SUBSCRIPTION_PRORATION_MODE_CHARGE_ON_NEXT_BILLING_DATE', legacyCompatible: true }, regionalConfigs,
      otherRegionsConfig: { usdPrice: conv.json.convertedOtherRegionsPrice.usdPrice, eurPrice: conv.json.convertedOtherRegionsPrice.eurPrice, newSubscriberAvailability: true } }],
  };
  let r = await gapi('POST', `${B}/subscriptions?productId=${s.id}&regionsVersion.version=${encodeURIComponent(conv.json.regionVersion?.version || "2025/03")}`, body);
  console.log(s.id, 'create', r.status, r.status >= 300 ? JSON.stringify(r.json).slice(0, 400) : `${regionalConfigs.length} regions`);
  if (r.status >= 300 && !JSON.stringify(r.json).includes('already exists')) continue;
  const a = await gapi('POST', `${B}/subscriptions/${s.id}/basePlans/${s.plan}:activate`, {});
  console.log(s.id, 'activate', a.status, a.status >= 300 ? JSON.stringify(a.json).slice(0, 300) : (a.json.basePlans || []).map((p) => p.state).join(','));
}
