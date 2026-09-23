import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { Client } from '@gradio/client';

dotenv.config();

// Legacy prototype server: its AI endpoints are unauthenticated and spend paid
// provider credits. It is not part of the Docker image or deploy; refuse to start
// unless explicitly enabled for local reference work.
if (process.env.LEGACY_WEB_ENABLED !== '1') {
  console.error('legacy-web/server.ts is disabled (unauthenticated paid endpoints). Set LEGACY_WEB_ENABLED=1 to run it locally.');
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);
const FAL_REALTIME_APP = 'decart/lucy2-vton/realtime';
const OPENROUTER_IMAGE_MODEL = process.env.OPENROUTER_IMAGE_MODEL || 'google/gemini-3.1-flash-image';
const OPENROUTER_VISION_MODEL = process.env.OPENROUTER_VISION_MODEL || 'google/gemini-2.5-flash';
const jevDecisionCache = new Map<string, { expiresAt: number; value: any }>();
const photoTryOnCache = new Map<string, { expiresAt: number; value: any }>();
const usageLedger = new Map<string, { photoTokens: number; jevDecisions: number; videoSeconds: number }>();

class OpenRouterImageError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'OpenRouterImageError';
    this.status = status;
    this.code = code;
  }
}

// Increase payload size for base64 camera images
app.use(express.json({ limit: '15mb' }));

function stripDataUrl(value: string): { data: string; mimeType: string } {
  const match = value.match(/^data:([^;]+);base64,(.+)$/);
  return match ? { mimeType: match[1], data: match[2] } : { mimeType: 'image/jpeg', data: value };
}

function dataUrlFromBase64(value: string, mimeType = 'image/png'): string {
  return value.startsWith('data:') || value.startsWith('http://') || value.startsWith('https://')
    ? value
    : `data:${mimeType};base64,${value}`;
}

async function requestOpenRouterVision(imageBase64: string, prompt: string) {
  if (!process.env.OPENROUTER_API_KEY) return null;
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
      'X-Title': 'Mirobe garment scanner',
    },
    body: JSON.stringify({
      model: OPENROUTER_VISION_MODEL,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUrlFromBase64(imageBase64, stripDataUrl(imageBase64).mimeType) } },
        ],
      }],
    }),
  });
  if (!response.ok) return null;
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content || '';
  const match = String(content).match(/\{[\s\S]*\}/);
  return match ? JSON.parse(match[0]) : null;
}

async function requestOpenRouterImage(prompt: string, inputReferences: string[], options: { background: 'transparent' | 'opaque'; aspectRatio: string; user?: string }) {
  if (!process.env.OPENROUTER_API_KEY) return null;
  const response = await fetch('https://openrouter.ai/api/v1/images', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
      'X-Title': 'Mirobe visual wardrobe',
    },
    body: JSON.stringify({
      model: OPENROUTER_IMAGE_MODEL,
      prompt,
      input_references: inputReferences.map((url) => ({ type: 'image_url', image_url: { url } })),
      quality: 'high',
      output_format: 'png',
      background: options.background,
      aspect_ratio: options.aspectRatio,
      n: 1,
      user: options.user || 'mirobe-local-demo',
    }),
  });
  if (!response.ok) {
    const raw = await response.text();
    let providerMessage = raw;
    try {
      providerMessage = JSON.parse(raw)?.error?.message || raw;
    } catch {
      // Keep the raw provider message when it is not JSON.
    }
    console.warn('OpenRouter image request failed:', response.status, providerMessage);
    if (response.status === 402) {
      throw new OpenRouterImageError(402, 'OPENROUTER_CREDITS_REQUIRED', 'OpenRouter hesabında görsel üretim kredisi bulunmuyor.');
    }
    return null;
  }
  const payload = await response.json();
  const image = payload?.data?.[0];
  const imageValue = image?.b64_json || image?.url;
  if (!imageValue) return null;
  return {
    imageUrl: dataUrlFromBase64(imageValue, image.media_type || 'image/png'),
    providerCostUsd: typeof payload?.usage?.cost === 'number' ? payload.usage.cost : undefined,
  };
}

async function persistImageAsset(dataUrl: string, prefix: string): Promise<string> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'mirobe-media';
  if (!supabaseUrl || !serviceRoleKey || !dataUrl.startsWith('data:')) return dataUrl;

  try {
    const { data, mimeType } = stripDataUrl(dataUrl);
    const extension = mimeType.includes('jpeg') ? 'jpg' : mimeType.includes('webp') ? 'webp' : 'png';
    const objectPath = `${prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${extension}`;
    const upload = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${objectPath}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        'Content-Type': mimeType,
        'x-upsert': 'true',
      },
      body: Buffer.from(data, 'base64'),
    });
    if (!upload.ok) return dataUrl;

    const signed = await fetch(`${supabaseUrl}/storage/v1/object/sign/${bucket}/${objectPath}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 60 * 60 * 24 * 7 }),
    });
    if (!signed.ok) return dataUrl;
    const payload = await signed.json();
    const signedPath = payload?.signedURL || payload?.signedUrl;
    return signedPath ? `${supabaseUrl}/storage/v1${signedPath}` : dataUrl;
  } catch (error) {
    console.warn('Supabase media fallback to local data URL:', error);
    return dataUrl;
  }
}

// ---------------------------------------------------------------------------
// 1. API: Scan Garment with AI Vision & Automatic Tagging
// ---------------------------------------------------------------------------
app.post('/api/scan-garment', async (req, res) => {
  try {
    const { imageBase64, lang = 'tr', isWearingScan = false } = req.body;
    const fallback = {
      name: lang === 'tr' ? 'Bej Bisiklet Yaka Sweatshirt' : 'Oatmeal Crewneck Sweatshirt',
      category: 'top',
      subcategory: lang === 'tr' ? 'Sweatshirt & Triko' : 'Sweatshirt & Fleece',
      colors: [lang === 'tr' ? 'Bej / Krem' : 'Beige / Oatmeal'],
      material: lang === 'tr' ? '%100 Pamuk Şardonlu İki İplik' : '100% Brushed French Terry Cotton',
      occasions: ['pub', 'bar', 'günlük', 'hafta sonu', 'arkadaşlar', 'casual', 'kahve'],
      styleTags: ['casual', 'minimalist', 'streetwear', 'oversize', 'zamansız'],
    };
    if (!imageBase64) return res.json({ success: true, data: fallback, provider: 'local-fallback' });

    const parsed = await requestOpenRouterVision(imageBase64, `You are Mirobe's garment cataloging model. Analyze only the clothing item. If the image contains a person, ignore the face, skin and background and describe the garment worn on the torso. Return JSON only with name, category (top, bottom, outerwear, dress, shoes, accessory), subcategory, colors, material, occasions, styleTags and confidence (a number from 0 to 1). Use ${lang === 'tr' ? 'Turkish' : 'English'}. Wearing scan: ${isWearingScan}.`);
    return res.json({ success: true, data: parsed || fallback, provider: parsed ? 'openrouter-vision' : 'local-fallback' });
  } catch (error: any) {
    console.error('Scan garment error:', error?.message || error);
    res.status(500).json({
      success: false,
      error: error?.message || 'Scanning failed',
    });
  }
});

// ---------------------------------------------------------------------------
// 1b. API: AI garment asset preparation and fixed studio catalog image
// ---------------------------------------------------------------------------
app.post('/api/garments/prepare', async (req, res) => {
  try {
    const { imageBase64, isWearingScan = false, lang = 'tr', userId = 'local-demo' } = req.body;
    if (!imageBase64) return res.status(400).json({ success: false, error: 'Missing garment image' });

    const metadataResponse = await fetch(`http://127.0.0.1:${PORT}/api/scan-garment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64, isWearingScan, lang }),
    });
    const metadataPayload = await metadataResponse.json();
    const metadata = metadataPayload?.data || {};
    const generated = await requestOpenRouterImage(
      'Extract the exact garment from the reference photo as a clean product asset. Preserve its real color, fabric texture, seams, silhouette, collar, sleeves and proportions. Remove every person, face, body part, hanger, room and background. Do not invent logos or change the garment. Center the complete garment with generous margins. Return a realistic transparent PNG suitable for a digital wardrobe and later virtual try-on.',
      [imageBase64],
      { background: 'transparent', aspectRatio: '3:4', user: userId }
    );

    const transparentUrl = generated?.imageUrl ? await persistImageAsset(generated.imageUrl, `garments/${userId}`) : null;
    return res.json({
      success: true,
      metadata,
      transparentUrl,
      provider: generated ? 'openrouter-image' : 'local-segmentation',
      providerCostUsd: generated?.providerCostUsd,
      qualityStatus: generated ? 'ready' : 'processing',
    });
  } catch (error: any) {
    console.error('Garment preparation error:', error?.message || error);
    return res.json({ success: true, metadata: {}, transparentUrl: null, provider: 'local-segmentation', qualityStatus: 'processing' });
  }
});

// ---------------------------------------------------------------------------
// 1c. API: Photo try-on through OpenRouter Image API
// ---------------------------------------------------------------------------
app.post('/api/photo-try-on', async (req, res) => {
  try {
    const { personImageBase64, garmentImages = [], garmentIds = [], userId = 'local-demo' } = req.body;
    if (!personImageBase64 || !Array.isArray(garmentImages) || garmentImages.length === 0) {
      return res.status(400).json({ success: false, error: 'Person and garment images are required' });
    }
    const cacheKey = `${userId}:${garmentIds.slice().sort().join(',')}:${personImageBase64.slice(-180)}`;
    const cached = photoTryOnCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return res.json({ success: true, data: { ...cached.value, cached: true } });

    const generated = await requestOpenRouterImage(
      'Create a realistic full-body fashion try-on photo using the person reference and the clothing references. Dress the same person in the selected exact garments. Preserve face identity, body proportions, pose, hands, hair, lighting and camera perspective. Do not add extra people, accessories or text. Use a clean warm ivory Mirobe studio background and keep the garments sharp, natural and physically fitted. If multiple garments are supplied, layer them correctly.',
      [personImageBase64, ...garmentImages],
      { background: 'opaque', aspectRatio: '9:16', user: userId }
    );
    if (!generated) return res.status(503).json({ success: false, error: 'Photo renderer unavailable' });

    const data = {
      id: `photo_${Date.now()}`,
      status: 'ready',
      imageUrl: await persistImageAsset(generated.imageUrl, `tryons/${userId}`),
      cached: false,
      garmentIds,
      provider: 'openrouter-image',
      providerCostUsd: generated.providerCostUsd,
    };
    photoTryOnCache.set(cacheKey, { expiresAt: Date.now() + 10 * 60 * 1000, value: data });
    return res.json({ success: true, data });
  } catch (error: any) {
    console.error('Photo try-on error:', error?.message || error);
    if (error?.code === 'OPENROUTER_CREDITS_REQUIRED') {
      return res.status(402).json({
        success: false,
        code: error.code,
        error: error.message,
      });
    }
    return res.status(502).json({ success: false, error: 'Photo try-on failed' });
  }
});

// ---------------------------------------------------------------------------
// 2. API: Structured Jev decision adapter (OpenRouter, server-side only)
// ---------------------------------------------------------------------------
app.post('/api/jev/decision', async (req, res) => {
  try {
    const { query = '', wardrobe = [], lang = 'tr' } = req.body;
    const normalizedQuery = String(query).trim().toLowerCase().replace(/\s+/g, ' ');
    const wardrobeKey = wardrobe
      .map((item: any) => `${item.id}:${item.category}:${(item.occasions || []).join(',')}`)
      .sort()
      .join('|');
    const cacheKey = `${lang}:${normalizedQuery}:${wardrobeKey}`;
    const cached = jevDecisionCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return res.json({ success: true, data: cached.value, cached: true });

    const compactWardrobe = wardrobe.map((item: any) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      colors: item.colors || [],
      styleTags: item.styleTags || [],
      occasions: item.occasions || [],
    }));

    const fallbackDecision = () => {
      const lower = normalizedQuery;
      const pub = ['pub', 'bar', 'gece', 'bira', 'içki', 'night', 'konser'].some((term) => lower.includes(term));
      const office = ['ofis', 'iş', 'work', 'office', 'toplantı'].some((term) => lower.includes(term));
      const date = ['date', 'randevu', 'romantik', 'akşam yemeği', 'dinner'].some((term) => lower.includes(term));
      const matches = (category: string, terms: string[]) =>
        compactWardrobe.find((item: any) => item.category === category && terms.some((term) =>
          [...item.occasions, ...item.styleTags, item.name].join(' ').toLowerCase().includes(term)
        )) || compactWardrobe.find((item: any) => item.category === category);

      const moodTerms = pub ? ['pub', 'gece', 'edgy', 'casual'] : office ? ['ofis', 'work', 'tailored'] : date ? ['date', 'gece', 'evening'] : ['casual', 'günlük', 'weekend'];
      const outerwear = matches('outerwear', moodTerms);
      const top = matches('top', moodTerms);
      const bottom = matches('bottom', moodTerms);
      const dress = matches('dress', moodTerms);
      const shoes = matches('shoes', moodTerms);
      const accessory = matches('accessory', moodTerms);

      return {
        decision: {
          topGarmentId: dress ? undefined : top?.id,
          outerwearGarmentId: outerwear?.id,
          bottomGarmentId: dress ? undefined : bottom?.id,
          shoesGarmentId: shoes?.id,
          accessoryGarmentId: accessory?.id,
          occasion: pub ? 'Pub / Gece' : office ? 'Ofis' : date ? 'Date' : 'Günlük',
          style: pub ? 'Effortless night-out' : office ? 'Tailored minimal' : date ? 'Polished evening' : 'Relaxed casual',
          confidence: wardrobe.length > 0 ? 0.72 : 0.2,
        },
        text:
          lang === 'tr'
            ? `${pub ? 'Pub gecesi' : office ? 'Ofis günü' : date ? 'Randevu' : 'Bugün'} için gardırobundaki gerçek parçalarla dengeli bir kombin hazırladım.`
            : `I built a balanced outfit from your actual wardrobe for this occasion.`,
        lookTitle: pub ? 'Pub & Gece Seçkisi' : office ? 'Ofis Seçkisi' : date ? 'Date Seçkisi' : 'Günlük Seçki',
      };
    };

    let result = fallbackDecision();
    if (process.env.OPENROUTER_API_KEY && wardrobe.length > 0) {
      const model = process.env.JEV_MODEL || 'typesafe/jev';
      const openRouterResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
          'X-Title': 'Mirobe Jev adapter',
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                `You are Jev, a wardrobe decision engine. Return JSON only. Never invent garment IDs. Select only IDs from the wardrobe. Required shape: {"decision":{"topGarmentId":string|null,"outerwearGarmentId":string|null,"bottomGarmentId":string|null,"shoesGarmentId":string|null,"accessoryGarmentId":string|null,"occasion":string,"style":string,"confidence":number},"text":string,"lookTitle":string}. User language: ${lang}.`,
            },
            {
              role: 'user',
              content: `Request: ${query}\nWardrobe:\n${JSON.stringify(compactWardrobe)}`,
            },
          ],
        }),
      });
      if (openRouterResponse.ok) {
        const payload = await openRouterResponse.json();
        const content = payload?.choices?.[0]?.message?.content || '';
        const jsonMatch = String(content).match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const candidate = JSON.parse(jsonMatch[0]);
          const validIds = new Set(compactWardrobe.map((item: any) => item.id));
          const decision = candidate.decision || candidate;
          const cleanId = (id: unknown) => (typeof id === 'string' && validIds.has(id) ? id : undefined);
          result = {
            decision: {
              topGarmentId: cleanId(decision.topGarmentId),
              outerwearGarmentId: cleanId(decision.outerwearGarmentId),
              bottomGarmentId: cleanId(decision.bottomGarmentId),
              shoesGarmentId: cleanId(decision.shoesGarmentId),
              accessoryGarmentId: cleanId(decision.accessoryGarmentId),
              occasion: String(decision.occasion || 'Günlük'),
              style: String(decision.style || 'Balanced'),
              confidence: Math.max(0, Math.min(1, Number(decision.confidence) || 0.5)),
            },
            text: String(candidate.text || result.text),
            lookTitle: String(candidate.lookTitle || result.lookTitle),
          };
        }
      }
    }

    jevDecisionCache.set(cacheKey, { expiresAt: Date.now() + 5 * 60 * 1000, value: result });
    return res.json({ success: true, data: result, cached: false });
  } catch (error: any) {
    console.error('Jev decision error:', error?.message || error);
    return res.status(500).json({ success: false, error: error?.message || 'Jev decision failed' });
  }
});

// ---------------------------------------------------------------------------
// 2. API: AI Stylist (Jev) Recommendation Engine
// ---------------------------------------------------------------------------
app.post('/api/stylist', async (req, res) => {
  try {
    const { query, wardrobe = [], lang = 'tr' } = req.body;

    const lowerQuery = (query || '').toLowerCase();
    const isPubRequest =
      lowerQuery.includes('pub') ||
      lowerQuery.includes('bar') ||
      lowerQuery.includes('gece') ||
      lowerQuery.includes('bira') ||
      lowerQuery.includes('içki') ||
      lowerQuery.includes('night out');

    // The structured /api/jev/decision route is the only model-backed stylist
    // adapter. This legacy route intentionally stays heuristic for offline demo
    // mode so no direct Gemini key is ever required by the client.

    // Heuristic Matching for Jev Stylist
    if (isPubRequest) {
      // Find leather jacket or outerwear
      const leatherJacket = wardrobe.find(
        (g: any) =>
          g.id === 'g_leather_jacket' ||
          (g.occasions && g.occasions.includes('pub')) ||
          (g.styleTags && g.styleTags.includes('Biker'))
      ) || wardrobe.find((g: any) => g.category === 'outerwear') || wardrobe[0];

      const denim = wardrobe.find(
        (g: any) => g.id === 'g_blue_jeans' || g.category === 'bottom'
      ) || wardrobe[1];

      const tee = wardrobe.find(
        (g: any) => g.id === 'g_white_tee' || g.category === 'top'
      ) || wardrobe[2];

      const selectedIds = [leatherJacket?.id, denim?.id, tee?.id].filter(Boolean);

      const replyText =
        lang === 'tr'
          ? `Akşam pub için harika bir seçim! ${leatherJacket?.name || 'Deri ceket'} parçanı ${denim?.name || 'denim'} ve ${tee?.name || 'klasik tişört'} ile birleştirdim. Salaş ama bir o kadar iddialı, pub havasına tam oturan zamansız bir silüet oluşturduk.`
          : `Perfect for a pub evening! I paired your ${leatherJacket?.name || 'Leather Jacket'} with ${denim?.name || 'denim'} and ${tee?.name || 'white tee'}. Effortless, cool, and ideal for the relaxed pub atmosphere.`;

      return res.json({
        success: true,
        data: {
          text: replyText,
          lookTitle: lang === 'tr' ? 'Pub & Gece Buluşması' : 'Pub & Night Out Edit',
          garmentIds: selectedIds,
          occasion: 'Pub / Night Out',
        },
      });
    }

    // Default general response
    res.json({
      success: true,
      data: {
        text:
          lang === 'tr'
            ? 'Gardrobundaki parçaları inceledim. Sana hem rahat hem de sofistike bir kombin hazırladım.'
            : 'I reviewed your wardrobe and assembled a balanced, sophisticated silhouette.',
        lookTitle: lang === 'tr' ? 'Kişisel Stil Seçkisi' : 'Curated Wardrobe Edit',
        garmentIds: wardrobe.slice(0, 3).map((g: any) => g.id),
        occasion: 'Casual',
      },
    });
  } catch (error: any) {
    console.error('Stylist error:', error?.message || error);
    res.status(500).json({
      success: false,
      error: error?.message || 'Stylist failed',
    });
  }
});

// ---------------------------------------------------------------------------
// 3. API: Short-lived fal realtime token. FAL_KEY remains server-side.
// ---------------------------------------------------------------------------
app.post('/api/fal/realtime-token', async (req, res) => {
  try {
    const plan = String(req.body?.plan || 'free');
    if (plan === 'free') {
      return res.status(402).type('text/plain').send('Video mirror requires Premium or Pro');
    }
    if (!process.env.FAL_KEY) {
      return res.status(503).type('text/plain').send('FAL_KEY is not configured');
    }

    const requestedApp = typeof req.body?.app === 'string' ? req.body.app : FAL_REALTIME_APP;
    if (requestedApp !== FAL_REALTIME_APP) {
      return res.status(400).type('text/plain').send('Realtime app is not allowed');
    }

    const tokenResponse = await fetch('https://rest.alpha.fal.ai/tokens/', {
      method: 'POST',
      headers: {
        Authorization: `Key ${process.env.FAL_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ allowed_apps: [FAL_REALTIME_APP], token_expiration: 45 }),
    });
    const raw = await tokenResponse.text();
    if (!tokenResponse.ok) return res.status(tokenResponse.status).type('text/plain').send(raw || 'Fal token request failed');

    try {
      const parsed = JSON.parse(raw);
      return res.type('text/plain').send(typeof parsed === 'string' ? parsed : parsed.token || raw);
    } catch {
      return res.type('text/plain').send(raw);
    }
  } catch (error: any) {
    console.error('Fal realtime token error:', error?.message || error);
    return res.status(502).type('text/plain').send('Fal token service unavailable');
  }
});

// ---------------------------------------------------------------------------
// 3b. Local usage ledger API. Supabase/RevenueCat can replace persistence later.
// ---------------------------------------------------------------------------
app.get('/api/usage', (req, res) => {
  const userId = String(req.query.userId || 'local-demo');
  const used = usageLedger.get(userId) || { photoTokens: 0, jevDecisions: 0, videoSeconds: 0 };
  return res.json({ success: true, data: used });
});

app.post('/api/usage/reserve', (req, res) => {
  const { userId = 'local-demo', kind, units = 1 } = req.body || {};
  if (!['garment_prep', 'photo_try_on', 'jev_decision', 'video_seconds'].includes(kind)) {
    return res.status(400).json({ success: false, error: 'Unsupported usage kind' });
  }
  const current = usageLedger.get(userId) || { photoTokens: 0, jevDecisions: 0, videoSeconds: 0 };
  const next = { ...current };
  if (kind === 'garment_prep' || kind === 'photo_try_on') next.photoTokens += Number(units);
  if (kind === 'jev_decision') next.jevDecisions += Number(units);
  if (kind === 'video_seconds') next.videoSeconds += Number(units);
  usageLedger.set(userId, next);
  return res.json({ success: true, reservationId: `usage_${Date.now()}`, data: next });
});

app.post('/api/usage/commit', (req, res) => {
  const userId = String(req.body?.userId || 'local-demo');
  return res.json({ success: true, data: usageLedger.get(userId) || { photoTokens: 0, jevDecisions: 0, videoSeconds: 0 } });
});

app.post('/api/usage/refund', (req, res) => {
  const { userId = 'local-demo', kind, units = 1 } = req.body || {};
  const current = usageLedger.get(userId) || { photoTokens: 0, jevDecisions: 0, videoSeconds: 0 };
  const next = { ...current };
  if (kind === 'garment_prep' || kind === 'photo_try_on') next.photoTokens = Math.max(0, next.photoTokens - Number(units));
  if (kind === 'jev_decision') next.jevDecisions = Math.max(0, next.jevDecisions - Number(units));
  if (kind === 'video_seconds') next.videoSeconds = Math.max(0, next.videoSeconds - Number(units));
  usageLedger.set(userId, next);
  return res.json({ success: true, data: next });
});

// ---------------------------------------------------------------------------
// 4. API: Virtual Try-On (IDM-VTON legacy fallback)
// ---------------------------------------------------------------------------
app.post('/api/virtual-try-on', async (req, res) => {
  try {
    const { human_image_url, garment_image_url, category = 'upper_body' } = req.body;
    
    if (!human_image_url || !garment_image_url) {
      return res.status(400).json({ success: false, error: 'Missing images for try-on' });
    }

    console.log('Starting free VTON via Hugging Face Spaces (yisol/IDM-VTON)...');
    
    // Fetch base64/URLs into Blobs for Gradio
    const [humanBlob, garmentBlob] = await Promise.all([
      fetch(human_image_url).then(r => r.blob()),
      fetch(garment_image_url).then(r => r.blob())
    ]);

    // Connect to the free Hugging Face Space
    const gradioApp = await Client.connect("yisol/IDM-VTON");
    
    const result = await gradioApp.predict("/tryon", [
      humanBlob,
      garmentBlob,
      "", // parameter_13 (Description)
      true, // use auto mask
      true, // use auto crop
      30, // denoising steps
      42, // seed
    ]) as any;

    console.log('Gradio VTON Result:', result.data);
    
    if (result && result.data && result.data[0]) {
      // Gradio returns a file object with a URL
      const outputUrl = result.data[0].url;
      return res.json({ success: true, image_url: outputUrl });
    } else {
      throw new Error('Invalid response from Gradio Space');
    }
  } catch (error: any) {
    console.error('VTON error:', error?.message || error);
    res.status(500).json({ success: false, error: error?.message || 'VTON failed' });
  }
});

// ---------------------------------------------------------------------------
// 5. Vite Middleware & Server Initialization
// ---------------------------------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Mirobe server running on port ${PORT}`);
  });
}

startServer();
