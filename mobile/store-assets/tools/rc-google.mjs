const KEY = process.env.RCK, P = 'projec0e66d8', APP = 'app9c1ae40401';
const base = `https://api.revenuecat.com/v2/projects/${P}`;
const rc = async (method, path, body) => { const r = await fetch(base + path, { method, headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => ({})); if (r.status >= 300) console.log('  !', method, path, r.status, j.message); return j; };
const list = async (p) => (await rc('GET', p + (p.includes('?') ? '&' : '?') + 'limit=100'))?.items || [];
const items = [['mirobe_plus_monthly:monthly', 'Plus Monthly', 'mirobe_plus', 'plus_monthly'], ['mirobe_plus_annual:annual', 'Plus Yearly', 'mirobe_plus', 'plus_annual'], ['mirobe_pro_monthly:monthly', 'Pro Monthly', 'mirobe_pro', 'pro_monthly'], ['mirobe_pro_annual:annual', 'Pro Yearly', 'mirobe_pro', 'pro_annual']];
const prods = await list('/products'); const ents = await list('/entitlements'); const off = (await list('/offerings')).find((o) => o.lookup_key === 'default'); const pkgs = await list(`/offerings/${off.id}/packages`);
for (const [sid, name, ent, pkg] of items) {
  const p = prods.find((x) => x.store_identifier === sid && x.app_id === APP) || await rc('POST', '/products', { store_identifier: sid, app_id: APP, type: 'subscription', display_name: name });
  const e = ents.find((x) => x.lookup_key === ent);
  const a = await rc('POST', `/entitlements/${e.id}/actions/attach_products`, { product_ids: [p.id] });
  const k = pkgs.find((x) => x.lookup_key === pkg);
  const b = await rc('POST', `/packages/${k.id}/actions/attach_products`, { products: [{ product_id: p.id, eligibility_criteria: 'all' }] });
  console.log(sid, 'product', p.id, '| entitlement', a ? 'ok' : 'fail', '| package', b ? 'ok' : 'fail');
}
for (const k of pkgs) console.log(k.lookup_key, ((await list(`/packages/${k.id}/products`))).map((x) => x.product?.store_identifier || x.product_id).join(' + '));
