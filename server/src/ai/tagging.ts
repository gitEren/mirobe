import {
  GARMENT_CATEGORIES,
  GarmentTagsSchema,
  nearestColorName,
  normalizeHex,
  OCCASIONS,
  PATTERNS,
  SEASONS,
  STYLE_TAGS,
  type GarmentTags,
} from '@mirobe/shared';
import type { Config } from '../config';
import { chatJson, renderImage } from './openrouter';

const stringArray = (items: readonly string[] | null = null) => ({
  type: 'array',
  items: items ? { type: 'string', enum: [...items] } : { type: 'string' },
});

const TAGS_JSON_SCHEMA = {
  name: 'garment_tags',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'isGarment',
      'onPerson',
      'name',
      'category',
      'subcategory',
      'colors',
      'material',
      'pattern',
      'seasons',
      'formality',
      'occasions',
      'styleTags',
      'extraTags',
      'description',
      'confidence',
    ],
    properties: {
      isGarment: { type: 'boolean' },
      onPerson: { type: 'boolean' },
      name: { type: 'string' },
      category: { type: 'string', enum: [...GARMENT_CATEGORIES] },
      subcategory: { type: 'string' },
      colors: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'hex'],
          properties: { name: { type: 'string' }, hex: { type: 'string' } },
        },
      },
      material: { type: 'string' },
      pattern: { type: 'string', enum: [...PATTERNS] },
      seasons: stringArray(SEASONS),
      formality: { type: 'integer' },
      occasions: stringArray(OCCASIONS),
      styleTags: stringArray(STYLE_TAGS),
      extraTags: stringArray(),
      description: { type: 'string' },
      confidence: { type: 'number' },
    },
  },
};

function taggingPrompt(lang: 'tr' | 'en', source: string) {
  const language = lang === 'tr' ? 'Turkish' : 'English';
  return `You are the cataloguing model of Mirobe, a digital wardrobe app. Look at the photo and describe the single main clothing item.
${source === 'wearing' ? 'The photo shows a person wearing the item: describe only the most prominent garment (usually the top layer on the torso) and ignore face, skin, hair and background.' : 'Ignore hangers, hands, furniture and background.'}

Rules:
- isGarment=false if there is no clothing item, shoe or accessory in the photo.
- onPerson=true if the item is being worn by a person in the photo (legs, torso or feet inside it); false for flat-lays, hangers, mannequins, product shots or items merely held in a hand.
- name: short retail-style product name in ${language}, e.g. "${lang === 'tr' ? 'Siyah Deri Biker Ceket' : 'Black Leather Biker Jacket'}". Never include brand names you cannot read.
- category: one of ${GARMENT_CATEGORIES.join(', ')}. Jackets, coats, blazers, cardigans worn open = outerwear. Jumpsuits = dress.
- subcategory: specific type in ${language} (e.g. ${lang === 'tr' ? 'Tişört, Kot Pantolon, Trençkot, Sneaker' : 'T-shirt, Jeans, Trench coat, Sneakers'}).
- colors: 1-4 dominant colours, most dominant first, with ${language} names and hex values sampled from the fabric.
- material: best guess of the fabric in ${language}; empty string if you cannot tell.
- pattern: one of ${PATTERNS.join(', ')}.
- seasons: every season from [${SEASONS.join(', ')}] it is comfortable to wear in.
- formality: 1 = loungewear/sport, 2 = casual, 3 = smart casual, 4 = business, 5 = black tie.
- occasions: 2-5 from [${OCCASIONS.join(', ')}] where this item realistically works.
- styleTags: 1-4 from [${STYLE_TAGS.join(', ')}].
- extraTags: up to 5 extra lowercase ${language} keywords that are visible (fit, neckline, closure, details) and not already covered. For stripes always include their direction as seen on the garment itself (${lang === 'tr' ? '"dikey çizgili", "yatay çizgili"' : '"vertical stripes", "horizontal stripes"'}); if the item has printed text or a logo, include ${lang === 'tr' ? '"yazı baskılı"' : '"text print"'}.
- description: one sentence in ${language} about how to style it${lang === 'tr' ? ', addressing the user informally as "sen" like the rest of the app (e.g. "… ile kombinleyebilirsin"), never "siz"' : ''}.
- confidence: 0-1, how sure you are about category and colours.
Return JSON only.`;
}

export async function tagGarment(
  config: Config,
  imageDataUrl: string,
  options: { lang: 'tr' | 'en'; source: string }
): Promise<{ tags: GarmentTags; costUsd?: number }> {
  const { value, costUsd } = await chatJson(config, {
    model: config.visionModel,
    schema: TAGS_JSON_SCHEMA,
    content: [
      { type: 'text', text: taggingPrompt(options.lang, options.source) },
      { type: 'image_url', image_url: { url: imageDataUrl } },
    ],
  });
  const raw = value as Record<string, unknown>;
  // Models return colours as {name, hex}, bare hex strings or plain names; normalise
  // all of them before strict validation.
  if (Array.isArray(raw.colors)) {
    raw.colors = raw.colors
      .map((c: unknown) => {
        const text = typeof c === 'string' ? c : `${(c as any)?.hex ?? ''} ${(c as any)?.name ?? ''}`;
        const hex = normalizeHex(text);
        if (!hex) return null;
        const given = typeof c === 'object' && c ? String((c as any).name ?? '').trim() : '';
        return { name: given && !normalizeHex(given) ? given : nearestColorName(hex, options.lang), hex };
      })
      .filter((c, i, all): c is { name: string; hex: string } => Boolean(c) && all.findIndex((o) => o?.name === c!.name) === i)
      .slice(0, 4);
  }
  return { tags: GarmentTagsSchema.parse(raw), costUsd };
}

/** Product-style asset on the app's stone card colour so it blends into the UI. */
export const CUTOUT_BACKGROUND = '#F4F1EA';

/** What the catalogue already knows about a garment (its tags); every field is optional. */
export interface PackshotFacts {
  name?: string;
  category?: string | null;
  subcategory?: string;
  colors?: { name: string; hex: string }[];
  material?: string;
  pattern?: string;
  extraTags?: string[];
}

/** One line of user-editable text inside the prompt: no line breaks, no quotes, bounded. */
const fact = (value: unknown, max = 80) =>
  String(value ?? '')
    .replace(/[\r\n"`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/** The catalogue facts as prompt lines; empty when nothing is known (an untagged piece). */
function factLines(facts: PackshotFacts | undefined): string[] {
  if (!facts) return [];
  const lines: string[] = [];
  const kind = [fact(facts.category, 30), fact(facts.subcategory, 60)].filter(Boolean).join(' / ');
  const name = fact(facts.name);
  if (name || kind) lines.push(`- Item: ${[name, kind && `(${kind})`].filter(Boolean).join(' ')}`);
  const colors = (facts.colors ?? []).map((c) => `${fact(c.name, 30)} ${fact(c.hex, 9)}`.trim()).filter(Boolean);
  if (colors.length) lines.push(`- Colours, most dominant first: ${colors.join(', ')}. Keep all of them, with these hues and roughly these proportions.`);
  const pattern = fact(facts.pattern, 30);
  if (pattern) lines.push(`- Pattern: ${pattern}${pattern === 'solid' ? '' : ', laid out exactly as in the photo'}`);
  const material = fact(facts.material, 60);
  if (material) lines.push(`- Material: ${material}`);
  const details = (facts.extraTags ?? []).map((tag) => fact(tag, 40)).filter(Boolean);
  if (details.length) lines.push(`- Details: ${details.join(', ')}`);
  return lines;
}

/**
 * The packshot prompt: a faithful studio photo of the SAME garment, never a redesign.
 * A real case it guards against: a vertically striped cream/pink/navy sweatshirt printed
 * "NEVER TOOK" came back mostly cream with a horizontal pink band and re-spelt text.
 * The garment's tags, when known, are passed in as hard constraints.
 */
export function packshotPrompt(source: string, facts?: PackshotFacts): string {
  const subject =
    source === 'wearing'
      ? 'The reference shows a person wearing the garment. Remove the person completely (face, skin, hair, hands, other clothes) and show only this garment, as if on an invisible mannequin (ghost mannequin).'
      : 'Remove hangers, hands, furniture and the room; show only this garment, as if on an invisible mannequin (ghost mannequin) or laid perfectly flat.';
  const known = factLines(facts);
  return [
    'Create a studio product photo (packshot) of the SAME garment shown in the reference photo. This is a faithful reproduction of one specific real item, not a new design or a similar product.',
    subject,
    '',
    'Reproduce exactly:',
    '- Colours: the same colours with the same hue, saturation and brightness, in the same proportions and places. Do not shift, simplify, merge, recolour or drop any colour; a multicolour garment stays multicolour.',
    '- Pattern: the same pattern type, scale and direction as on the garment itself. Vertical stripes stay vertical, horizontal stripes stay horizontal, diagonal stays diagonal. Keep every stripe with its width, colour and order; never turn stripes into bands, blocks, colour-blocking or a different pattern. Checks, prints and graphics keep their layout, size and position.',
    '- Text, prints and logos: copy every letter, number, logo and graphic exactly as it appears, in the same place, size, font style and colour. Never invent, translate, re-spell, complete or "correct" letters. If some text is too small or blurry to read, reproduce it as the same unreadable print (same shape, colour and position) rather than making up words. Do not add text or logos that are not on the garment.',
    '- Construction: the same fabric and surface texture (knit, rib, fleece, denim, sheen), neckline, collar, cuffs, hem, seams, pockets, buttons, zips and trims, with the same fit, sleeve length and overall length.',
    '',
    'Change only this: remove everything that is not the garment, smooth out wrinkles and folds, and present it front-facing and symmetric. If the photo shows it worn, at an angle, folded or partly hidden, reconstruct the flat front view of THAT same garment from what is visible, continuing the visible pattern and colours; do not redesign hidden areas.',
    ...(known.length
      ? [
          '',
          'Known facts about this garment from the catalogue. Treat them as hard constraints; where the photo shows finer detail (exact stripe order, print, text), follow the photo:',
          ...known,
        ]
      : []),
    '',
    `Composition: centre the complete item with generous margins on a perfectly flat, seamless ${CUTOUT_BACKGROUND} background with a very soft contact shadow. No watermark, caption, label or any text that is not printed on the garment itself.`,
  ].join('\n');
}

export async function renderCutout(config: Config, imageDataUrl: string, source: string, facts?: PackshotFacts) {
  return renderImage(config, {
    model: config.imageModel,
    aspectRatio: '3:4',
    prompt: packshotPrompt(source, facts),
    images: [imageDataUrl],
  });
}
