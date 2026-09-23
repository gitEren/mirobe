import crypto from 'node:crypto';
import type { GarmentRow } from '@mirobe/shared';
import type { Config } from '../config';
import { renderImage } from './openrouter';

export const TRYON_PROMPT_VERSION = 'tryon-v3';

export function tryOnCacheKey(avatarId: string, garmentIds: string[], model: string) {
  return crypto
    .createHash('sha256')
    .update([avatarId, [...garmentIds].sort().join(','), model, TRYON_PROMPT_VERSION].join('|'))
    .digest('hex');
}

const LAYER_ORDER = ['dress', 'top', 'bottom', 'outerwear', 'shoes', 'accessory'];

export function renderTryOn(config: Config, avatarDataUrl: string, garments: { row: GarmentRow; dataUrl: string }[]) {
  const ordered = [...garments].sort(
    (a, b) => LAYER_ORDER.indexOf(a.row.category ?? '') - LAYER_ORDER.indexOf(b.row.category ?? '')
  );
  const hasShoes = ordered.some((g) => g.row.category === 'shoes');
  const list = ordered
    .map((g, i) => `Image ${i + 2}: ${g.row.name} (${g.row.category}${g.row.subcategory ? `, ${g.row.subcategory}` : ''})`)
    .join('\n');
  return renderImage(config, {
    model: config.tryonModel,
    aspectRatio: '9:16',
    prompt: `Virtual try-on. Image 1 is the person. The following images are clothing items from their own wardrobe:
${list}

Create a photorealistic full-length photo of the SAME person from image 1 wearing ALL of these items together, replacing whatever they currently wear in those categories.
- Keep face, identity, skin tone, hair, body shape and proportions exactly as in image 1. Keep the pose as close as possible.
- Framing: always show the whole body from head to feet, centred, with a little space above the head and below the shoes. If image 1 is cropped (waist-up or knee-up), extend the picture downward and draw the rest of the body naturally with consistent proportions.${hasShoes ? '\n- The shoes from the references must be clearly visible on both feet.' : ''}
- Reproduce every garment faithfully: exact colour, fabric texture, print, visible logos, cut, length and fit. Do not invent new garments.
- Layer correctly: outerwear over the top, tuck or drape naturally, shoes on the feet.
- Keep a clean warm ivory studio background (#FBF9F5) with soft natural light.
- One person only. No text, no watermark, no frames.`,
    images: [avatarDataUrl, ...ordered.map((g) => g.dataUrl)],
  });
}
