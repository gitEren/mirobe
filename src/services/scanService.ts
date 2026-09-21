import { Garment, GarmentCategory } from '../types';
import { createGarmentCutout, createStudioGarmentImage, validateTransparentGarment } from './imageCutout';

export interface ScannedGarmentResult {
  name: string;
  category: GarmentCategory;
  subcategory: string;
  colors: string[];
  material: string;
  occasions: string[];
  styleTags: string[];
  imageUrl: string;
  studioUrl?: string;
  cutoutUrl: string;
  originalImageUrl: string;
  scanSource: 'wearing' | 'hanger' | 'gallery' | 'demo';
  confidence: number;
  renderer?: string;
  qualityStatus?: 'processing' | 'ready' | 'rejected';
}

export async function processScannedGarment(
  rawImageBase64: string,
  lang: 'tr' | 'en' = 'tr',
  isWearingScan = true
): Promise<ScannedGarmentResult> {
  let name = lang === 'tr' ? 'Bej Bisiklet Yaka Sweatshirt' : 'Oatmeal Crewneck Sweatshirt';
  let category: GarmentCategory = 'top';
  let subcategory = lang === 'tr' ? 'Sweatshirt & Triko' : 'Sweatshirt & Fleece';
  let colors = [lang === 'tr' ? 'Bej / Krem' : 'Beige / Oatmeal'];
  let material = lang === 'tr' ? '%100 Pamuk Şardonlu İki İplik' : '100% Brushed Cotton';
  let occasions = ['pub', 'bar', 'günlük', 'hafta sonu', 'arkadaşlar', 'casual', 'kahve'];
  let styleTags = ['casual', 'minimalist', 'streetwear', 'oversize'];
  let confidence = 0.68;
  let provider = 'local-segmentation';
  let cutoutUrlFromProvider: string | null = null;

  try {
    const response = await fetch('/api/garments/prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: rawImageBase64,
        userId: 'local-demo',
        lang,
        isWearingScan,
      }),
    });

    if (response.ok) {
      const json = await response.json();
      if (json.success && json.metadata) {
        const d = json.metadata;
        if (d.name) name = d.name;
        if (d.category && ['top', 'bottom', 'outerwear', 'dress', 'shoes', 'accessory'].includes(d.category)) {
          category = d.category as GarmentCategory;
        }
        if (d.subcategory) subcategory = d.subcategory;
        if (Array.isArray(d.colors) && d.colors.length > 0) colors = d.colors;
        if (d.material) material = d.material;
        if (Array.isArray(d.occasions) && d.occasions.length > 0) occasions = d.occasions;
        if (Array.isArray(d.styleTags) && d.styleTags.length > 0) styleTags = d.styleTags;
        if (typeof d.confidence === 'number') confidence = Math.max(0, Math.min(1, d.confidence));
      }
      if (json.provider) provider = json.provider;
      if (json.transparentUrl) cutoutUrlFromProvider = json.transparentUrl;
    }
  } catch (err) {
    console.warn('AI garment preparation fallback to local inference', err);
  }

  // Ensure 'pub' or 'bar' or 'gece' is available for casual & streetwear pieces
  if (!occasions.includes('pub')) {
    occasions.push('pub', 'bar', 'gece');
  }

  // Create clean cutout by removing background and isolating garment
  if (cutoutUrlFromProvider && !(await validateTransparentGarment(cutoutUrlFromProvider))) {
    cutoutUrlFromProvider = null;
    provider = 'local-segmentation-quality-fallback';
  }
  const cutoutUrl = cutoutUrlFromProvider || (await createGarmentCutout(rawImageBase64, isWearingScan));
  const studioUrl = await createStudioGarmentImage(cutoutUrl);
  const qualityStatus = provider === 'openrouter-image'
    ? 'ready'
    : provider === 'local-segmentation-quality-fallback'
      ? 'rejected'
      : 'processing';

  return {
    name,
    category,
    subcategory,
    colors,
    material,
    occasions,
    styleTags,
    imageUrl: studioUrl,
    cutoutUrl,
    originalImageUrl: rawImageBase64,
    studioUrl,
    scanSource: isWearingScan ? 'wearing' : 'hanger',
    confidence,
    renderer: provider,
    qualityStatus,
  };
}
