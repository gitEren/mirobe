import {
  labelFor,
  OCCASIONS,
  type GarmentRow,
  type Occasion,
  type OutfitSelection,
  type OutfitSlot,
  type StylistDecision,
} from '@mirobe/shared';
import type { Config } from '../config';
import { decide, type DecisionQuestion } from './openrouter';

type Lang = 'tr' | 'en';
const MAX_CANDIDATES_PER_SLOT = 80;
const OPTIONAL_SLOTS: OutfitSlot[] = ['outerwear', 'accessory'];

const OCCASION_KEYWORDS: Record<Occasion, string[]> = {
  casual: ['günlük', 'rahat', 'casual', 'hafta sonu', 'weekend', 'kahve', 'coffee', 'alışveriş', 'shopping'],
  work: ['ofis', 'iş', 'work', 'office', 'toplantı', 'meeting', 'mülakat', 'interview'],
  formal: ['resmi', 'formal', 'gala', 'takım', 'suit', 'black tie'],
  date: ['date', 'randevu', 'romantik', 'akşam yemeği', 'dinner', 'buluşma'],
  night_out: ['pub', 'bar', 'gece', 'bira', 'içki', 'night', 'konser', 'concert', 'kulüp', 'club'],
  party: ['parti', 'party', 'doğum günü', 'birthday', 'kutlama'],
  sport: ['spor', 'gym', 'koşu', 'run', 'antrenman', 'yoga', 'workout'],
  travel: ['seyahat', 'travel', 'uçak', 'flight', 'tatil', 'havalimanı', 'airport'],
  lounge: ['ev', 'home', 'lounge', 'pijama'],
  beach: ['plaj', 'beach', 'deniz', 'havuz', 'pool'],
  wedding: ['düğün', 'wedding', 'nikah', 'nişan'],
};

export function detectOccasion(query: string): Occasion {
  const lower = query.toLocaleLowerCase('tr');
  for (const occasion of OCCASIONS) {
    if (OCCASION_KEYWORDS[occasion].some((keyword) => lower.includes(keyword))) return occasion;
  }
  return 'casual';
}

export function currentSeason(date = new Date()): string {
  const month = date.getUTCMonth();
  return month < 2 || month === 11 ? 'winter' : month < 5 ? 'spring' : month < 8 ? 'summer' : 'autumn';
}

const slotOf = (garment: GarmentRow): OutfitSlot | null => garment.category;

function candidatesBySlot(garments: GarmentRow[], exclude: string[]) {
  const bySlot = new Map<OutfitSlot, GarmentRow[]>();
  for (const garment of garments) {
    const slot = slotOf(garment);
    if (!slot || garment.deletedAt || garment.taggingStatus !== 'ready') continue;
    bySlot.set(slot, [...(bySlot.get(slot) ?? []), garment]);
  }
  for (const [slot, items] of bySlot) {
    // "Show me another one": drop previous picks while alternatives exist.
    const fresh = items.filter((item) => !exclude.includes(item.id));
    const pool = fresh.length > 0 ? fresh : items;
    pool.sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt.localeCompare(a.updatedAt));
    bySlot.set(slot, pool.slice(0, MAX_CANDIDATES_PER_SLOT));
  }
  return bySlot;
}

export function describe(garment: GarmentRow): string {
  return [
    garment.name,
    garment.subcategory,
    `colours: ${garment.colors.map((c) => c.name).join(', ')}`,
    garment.pattern && `pattern: ${garment.pattern}`,
    garment.material && `material: ${garment.material}`,
    `formality ${garment.formality}/5`,
    `occasions: ${garment.occasions.join(', ')}`,
    `style: ${garment.styleTags.join(', ')}`,
    `seasons: ${garment.seasons.join(', ')}`,
    garment.extraTags.length ? `details: ${garment.extraTags.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('; ');
}

function finalize(
  selection: OutfitSelection,
  occasion: string,
  style: string,
  confidence: number,
  garments: GarmentRow[],
  lang: Lang,
  provider: StylistDecision['provider'],
  startedAt: number
): StylistDecision {
  if (selection.dress) {
    delete selection.top;
    delete selection.bottom;
  }
  const order: OutfitSlot[] = ['outerwear', 'dress', 'top', 'bottom', 'shoes', 'accessory'];
  const garmentIds = order.map((slot) => selection[slot]).filter((id): id is string => Boolean(id));
  const names = garmentIds.map((id) => garments.find((g) => g.id === id)?.name).filter(Boolean) as string[];
  const occasionLabel = labelFor(occasion, lang);
  const styleLabel = style ? labelFor(style, lang) : '';
  const text =
    garmentIds.length === 0
      ? lang === 'tr'
        ? 'Bu istek için gardırobunda uygun parça bulamadım. Birkaç kıyafet daha ekleyince tekrar dene.'
        : 'I could not find matching pieces in your wardrobe yet. Add a few more items and try again.'
      : lang === 'tr'
        ? `${occasionLabel} için gardırobundan seçtim: ${names.join(', ')}.`
        : `For ${occasionLabel.toLowerCase()} I picked from your wardrobe: ${names.join(', ')}.`;
  return {
    selection,
    garmentIds,
    title: styleLabel ? `${occasionLabel} · ${styleLabel}` : occasionLabel,
    occasion,
    style,
    text,
    confidence,
    provider,
    latencyMs: Date.now() - startedAt,
  };
}

/** Deterministic tag-scoring fallback used when Jev is unavailable. */
export function heuristicDecision(
  query: string,
  garments: GarmentRow[],
  lang: Lang,
  exclude: string[] = [],
  startedAt = Date.now()
): StylistDecision {
  const occasion = detectOccasion(query);
  const season = currentSeason();
  const lower = query.toLocaleLowerCase('tr');
  const targetFormality = { formal: 5, wedding: 5, work: 4, date: 3, party: 3, night_out: 3, travel: 2, casual: 2, beach: 1, sport: 1, lounge: 1 }[occasion];
  const score = (g: GarmentRow) =>
    (g.occasions.includes(occasion) ? 4 : 0) +
    (g.seasons.length === 0 || g.seasons.includes(season) ? 1 : -1) -
    Math.abs((g.formality || 2) - targetFormality) +
    g.styleTags.filter((tag) => lower.includes(tag.replace('_', ' '))).length * 2 +
    g.colors.filter((c) => lower.includes(c.name.toLocaleLowerCase('tr'))).length * 2 +
    (g.favorite ? 0.5 : 0) -
    g.wornCount * 0.02;

  const selection: OutfitSelection = {};
  let total = 0;
  for (const [slot, items] of candidatesBySlot(garments, exclude)) {
    const best = [...items].sort((a, b) => score(b) - score(a))[0];
    if (!best) continue;
    if (OPTIONAL_SLOTS.includes(slot) && score(best) < 2) continue;
    selection[slot] = best.id;
    total += score(best);
  }
  // Prefer separates unless the dress clearly fits better than top+bottom.
  const dress = garments.find((g) => g.id === selection.dress);
  if (dress && selection.top && selection.bottom) {
    const top = garments.find((g) => g.id === selection.top)!;
    const bottom = garments.find((g) => g.id === selection.bottom)!;
    if (score(dress) < (score(top) + score(bottom)) / 2) delete selection.dress;
  }
  const count = Object.keys(selection).length || 1;
  return finalize(selection, occasion, '', Math.max(0.2, Math.min(0.8, total / count / 8)), garments, lang, 'heuristic', startedAt);
}

export interface JevOptions {
  exclude?: string[];
  userId?: string;
  /** Rich English brief written by the conversation model (occasion, weather, vibe, constraints). */
  brief?: string;
  /** Recent turns, oldest first, so follow-ups like "make it warmer" have context. */
  history?: string[];
  /** Pieces the user explicitly asked for; their slots are not asked. */
  mustInclude?: string[];
  /** Slots the user does not want (e.g. no jacket). */
  skipSlots?: OutfitSlot[];
}

/**
 * Jev picks one item per outfit slot in a single Decisions request: every slot
 * is a `choice` question whose options are the user's real garment ids, so the
 * model cannot invent items.
 */
export async function jevDecision(
  config: Config,
  query: string,
  garments: GarmentRow[],
  lang: Lang,
  options: JevOptions = {}
): Promise<StylistDecision> {
  const startedAt = Date.now();
  const forced: OutfitSelection = {};
  for (const id of options.mustInclude ?? []) {
    const garment = garments.find((g) => g.id === id && g.taggingStatus === 'ready' && !g.deletedAt);
    if (garment?.category) forced[garment.category] = garment.id;
  }
  const slots = candidatesBySlot(garments, options.exclude ?? []);
  for (const slot of [...Object.keys(forced), ...(options.skipSlots ?? [])] as OutfitSlot[]) slots.delete(slot);
  if (forced.dress) {
    slots.delete('top');
    slots.delete('bottom');
  }
  if (!config.openRouterKey || slots.size === 0) {
    const fallback = heuristicDecision(options.brief ?? query, garments, lang, options.exclude, startedAt);
    return Object.keys(forced).length ? finalize({ ...fallback.selection, ...forced }, fallback.occasion, '', fallback.confidence, garments, lang, fallback.provider, startedAt) : fallback;
  }

  const questions: Record<string, DecisionQuestion> = {
    occasion: {
      type: 'choice',
      instructions: 'Which occasion is the user dressing for?',
      criteria: Object.fromEntries(OCCASIONS.map((o) => [o, labelFor(o, 'en')])),
    },
    style: {
      type: 'choice',
      instructions: 'Which overall style direction fits the request best?',
      criteria: {
        minimalist: 'Clean, neutral, few details',
        classic: 'Timeless, polished basics',
        streetwear: 'Relaxed, urban, sneakers and graphics',
        edgy: 'Leather, dark tones, statement pieces',
        elegant: 'Refined, dressy, sophisticated',
        sporty: 'Athletic, comfortable, active',
        smart_casual: 'Relaxed but put-together',
        romantic: 'Soft, feminine, flowing',
      },
    },
  };
  const hasSeparates = slots.has('top') && slots.has('bottom');
  if (slots.has('dress') && hasSeparates) {
    questions.silhouette = {
      type: 'choice',
      instructions: 'Should this outfit be built around a one-piece dress/jumpsuit or separates (top + bottom)?',
      criteria: { dress: 'A dress or jumpsuit', separates: 'A top with a bottom' },
    };
  }
  for (const [slot, items] of slots) {
    const criteria: Record<string, string> = Object.fromEntries(items.map((g) => [g.id, describe(g)]));
    if (OPTIONAL_SLOTS.includes(slot)) criteria.none = `No ${slot} is needed for this request, weather or occasion`;
    questions[`slot_${slot}`] = {
      type: 'choice',
      instructions: `Pick the ${slot} from the user's wardrobe that best fits the request and works with a coherent outfit (colour harmony, matching formality, right season).`,
      criteria,
    };
  }

  try {
    const response = await decide(config, {
      model: config.jevModel,
      user: options.userId,
      state: {
        request: options.brief ?? query,
        user_said: query,
        ...(options.history?.length ? { recent_conversation: options.history } : {}),
        ...(Object.keys(forced).length
          ? { already_chosen: Object.values(forced).map((id) => describe(garments.find((g) => g.id === id)!)) }
          : {}),
        date: new Date().toISOString().slice(0, 10),
        season: currentSeason(),
        note: 'The user wants one complete, wearable outfit made only from their own wardrobe. Every pick must work with the already chosen pieces.',
      },
      questions,
    });
    const answer = (key: string) => {
      const a = response.answers[key];
      return a?.type === 'choice' ? a : undefined;
    };
    const selection: OutfitSelection = { ...forced };
    const confidences: number[] = [];
    for (const [slot, items] of slots) {
      const picked = answer(`slot_${slot}`);
      if (picked && items.some((g) => g.id === picked.choice)) {
        selection[slot] = picked.choice;
        confidences.push(picked.confidence ?? 0.5);
      }
    }
    const silhouette = answer('silhouette')?.choice;
    if (silhouette === 'separates') delete selection.dress;
    const occasion = answer('occasion')?.choice ?? detectOccasion(query);
    const style = answer('style')?.choice ?? '';
    const confidence = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0.5;
    console.info(`[mirobe] jev decision in ${Date.now() - startedAt}ms, cost $${response.usage.cost ?? '?'}`);
    return finalize(selection, occasion, style, confidence, garments, lang, 'jev', startedAt);
  } catch (error) {
    console.warn('[mirobe] Jev unavailable, using heuristic:', (error as Error).message);
    const fallback = heuristicDecision(options.brief ?? query, garments, lang, options.exclude, startedAt);
    return finalize({ ...fallback.selection, ...forced }, fallback.occasion, '', fallback.confidence, garments, lang, fallback.provider, startedAt);
  }
}
