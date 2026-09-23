import {
  OCCASIONS,
  OUTFIT_SLOTS,
  type GarmentRow,
  type OutfitSlot,
  type StylistChatMessage,
  type StylistDecision,
} from '@mirobe/shared';
import type { Config } from '../config';
import { chatJson } from './openrouter';
import { HttpError, ProviderError } from '../lib/http';
import { currentSeason, describe, jevDecision } from './stylist';

type Lang = 'tr' | 'en';

/** Whole turn (understand + Jev + reply) stays inside Cloudflare's 100 s; the app waits 90 s. */
export const STYLIST_CHAT_BUDGET_MS = 80_000;
const STEP_TIMEOUT_MS = 25_000;

/** The request never reached the provider (DNS, connection reset): safe to send once more. */
const isNetworkError = (error: unknown) => !(error instanceof ProviderError) && error instanceof TypeError;
const LANGUAGE = { tr: 'Turkish', en: 'English' } as const;

/** Pictographs plus the joiners, variation selectors, skin tones, keycaps and flag letters that build emoji sequences. */
const EMOJI = /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}\u200D\uFE0E\uFE0F\u20E3]/gu;

/** Jev's text without emoji: the prompt asks for none, but models still add one now and then and it reads as machine-written. */
export function withoutEmoji(text: string): string {
  return text
    .replace(EMOJI, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([.,!?;:…])/g, '$1')
    .trim();
}

export interface StylistChatResult {
  intent: 'outfit' | 'refine' | 'chat';
  reply: string;
  suggestions: string[];
  decision?: StylistDecision;
}

const INTERPRET_SCHEMA = {
  name: 'stylist_turn',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['intent', 'reply', 'brief', 'occasion', 'mustIncludeIds', 'avoidIds', 'skipSlots', 'keepFromCurrentIds'],
    properties: {
      intent: { type: 'string', enum: ['outfit', 'refine', 'chat'] },
      reply: { type: 'string' },
      brief: { type: 'string' },
      occasion: { type: 'string', enum: [...OCCASIONS] },
      mustIncludeIds: { type: 'array', items: { type: 'string' } },
      avoidIds: { type: 'array', items: { type: 'string' } },
      skipSlots: { type: 'array', items: { type: 'string', enum: [...OUTFIT_SLOTS] } },
      keepFromCurrentIds: { type: 'array', items: { type: 'string' } },
    },
  },
};

const REPLY_SCHEMA = {
  name: 'stylist_reply',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'reply', 'suggestions'],
    properties: {
      title: { type: 'string' },
      reply: { type: 'string' },
      suggestions: { type: 'array', items: { type: 'string' } },
    },
  },
};

const compact = (g: GarmentRow) =>
  `${g.id} | ${g.name} | ${g.category} | ${g.colors.map((c) => c.name).join('/')} | ${[...g.styleTags, ...g.occasions].join(', ')}`;

function transcript(messages: StylistChatMessage[], garments: GarmentRow[]) {
  return messages
    .slice(-10)
    .map((m) => {
      const outfit = m.garmentIds?.length
        ? ` [outfit shown: ${m.garmentIds.map((id) => garments.find((g) => g.id === id)?.name ?? id).join(', ')}]`
        : '';
      return `${m.role === 'user' ? 'User' : 'Jev'}: ${m.text}${outfit}`;
    })
    .join('\n');
}

/**
 * One stylist turn: a fast LLM understands the message (occasion, weather,
 * colours, "with my black jacket", "change the shoes", small talk), Jev picks
 * real garments for each slot, then the LLM answers like a stylist would.
 */
export async function stylistChat(
  config: Config,
  input: { messages: StylistChatMessage[]; lang: Lang; garments: GarmentRow[]; userId: string }
): Promise<StylistChatResult> {
  const result = await stylistTurn(config, input);
  return {
    ...result,
    reply: withoutEmoji(result.reply),
    suggestions: result.suggestions.map(withoutEmoji).filter(Boolean),
    ...(result.decision ? { decision: { ...result.decision, title: withoutEmoji(result.decision.title), text: withoutEmoji(result.decision.text) } } : {}),
  };
}

async function stylistTurn(
  config: Config,
  input: { messages: StylistChatMessage[]; lang: Lang; garments: GarmentRow[]; userId: string }
): Promise<StylistChatResult> {
  const { messages, lang, userId } = input;
  const deadline = Date.now() + STYLIST_CHAT_BUDGET_MS;
  const remaining = () => Math.min(STEP_TIMEOUT_MS, deadline - Date.now());
  const garments = input.garments.filter((g) => g.taggingStatus === 'ready' && !g.deletedAt && g.category);
  const last = messages[messages.length - 1]?.text ?? '';
  const currentOutfit = [...messages].reverse().find((m) => m.role === 'assistant' && m.garmentIds?.length)?.garmentIds ?? [];
  const validIds = new Set(garments.map((g) => g.id));
  const clean = (ids: string[]) => ids.filter((id) => validIds.has(id));

  let plan: {
    intent: StylistChatResult['intent'];
    reply: string;
    brief: string;
    occasion: string;
    mustIncludeIds: string[];
    avoidIds: string[];
    skipSlots: OutfitSlot[];
    keepFromCurrentIds: string[];
  };
  try {
    const { value, costUsd } = await chatJson(config, {
      model: config.chatModel,
      temperature: 0.2,
      timeoutMs: STEP_TIMEOUT_MS,
      schema: INTERPRET_SCHEMA,
      system: `You are the understanding step of Jev, a personal stylist inside the Mirobe wardrobe app. Today is ${new Date().toISOString().slice(0, 10)} (${currentSeason()}). Decide what the user's latest message needs:
- "outfit": they want a new outfit (any occasion, mood, weather, activity, even vague like "something comfy").
- "refine": they want to change the outfit Jev just showed (e.g. "different shoes", "warmer", "no jacket", "make it darker"). keepFromCurrentIds = pieces of the current outfit that should stay.
- "chat": greetings, thanks, questions or small talk that need no outfit. Then write "reply" in ${LANGUAGE[lang]}: warm, 1-2 sentences, no emoji, and nudge them towards telling you where they are going. You don't know today's weather: never describe it unless the user told you.
For outfit/refine: "reply" is "", and "brief" is a precise English brief for the garment picker (setting, time of day, weather/season, formality, vibe, colours to favour or avoid). mustIncludeIds = wardrobe ids the user explicitly wants (e.g. "with my black leather jacket"). avoidIds = ids they reject. skipSlots = slots they don't want (e.g. "no jacket" → outerwear). Only use ids from the wardrobe list.`,
      content: [
        {
          type: 'text',
          text: `Wardrobe (id | name | category | colours | tags):\n${garments.map(compact).join('\n') || '(empty)'}\n\nCurrent outfit: ${currentOutfit.join(', ') || 'none'}\n\nConversation:\n${transcript(messages, input.garments)}`,
        },
      ],
    });
    console.info(`[mirobe] stylist understand, cost $${costUsd ?? '?'}`);
    const raw = value as typeof plan;
    plan = {
      intent: raw.intent === 'chat' || raw.intent === 'refine' ? raw.intent : 'outfit',
      reply: String(raw.reply ?? ''),
      brief: String(raw.brief ?? last),
      occasion: (OCCASIONS as readonly string[]).includes(raw.occasion) ? raw.occasion : 'casual',
      mustIncludeIds: clean(raw.mustIncludeIds ?? []),
      avoidIds: clean(raw.avoidIds ?? []),
      skipSlots: (raw.skipSlots ?? []).filter((s): s is OutfitSlot => (OUTFIT_SLOTS as readonly string[]).includes(s)),
      keepFromCurrentIds: clean(raw.keepFromCurrentIds ?? []),
    };
  } catch (error) {
    // Out of credits, Jev would fail the same way: the turn fails and is refunded instead of
    // being answered (and charged) by the tag-matching fallback.
    if (error instanceof HttpError && error.code === 'PROVIDER_CREDITS') throw error;
    console.warn('[mirobe] stylist understand failed, falling back to Jev only:', (error as Error).message);
    const decision = await jevDecision(config, last, garments, lang, { userId });
    return { intent: 'outfit', reply: decision.text, suggestions: [], decision };
  }

  if (plan.intent === 'chat') {
    return { intent: 'chat', reply: plan.reply, suggestions: [] };
  }

  const refine = plan.intent === 'refine';
  const decision = await jevDecision(config, last, garments, lang, {
    userId,
    brief: plan.brief,
    history: messages.slice(-6, -1).map((m) => `${m.role}: ${m.text}`),
    mustInclude: [...plan.mustIncludeIds, ...(refine ? plan.keepFromCurrentIds : [])],
    // For a refinement, steer away from the pieces being replaced.
    exclude: [...plan.avoidIds, ...(refine ? currentOutfit.filter((id) => !plan.keepFromCurrentIds.includes(id)) : [])],
    skipSlots: plan.skipSlots,
  });
  decision.occasion = plan.occasion;

  const picked = decision.garmentIds.map((id) => garments.find((g) => g.id === id)).filter((g) => g !== undefined);
  // Tell the writer what actually changed, so it can be honest when there is no alternative.
  const unchanged = refine ? currentOutfit.filter((id) => decision.garmentIds.includes(id) && !plan.keepFromCurrentIds.includes(id)) : [];
  const note = unchanged.length
    ? `\nNote: the user asked to change these but the wardrobe has no suitable alternative, so they stayed: ${unchanged.map((id) => garments.find((g) => g.id === id)?.name).join(', ')}. Say so briefly and suggest adding such a piece.`
    : '';
  const writeReply = () =>
    chatJson(config, {
      model: config.chatModel,
      temperature: 0.7,
      timeoutMs: remaining(),
      schema: REPLY_SCHEMA,
      system: `You are Jev, a warm, confident personal stylist in the Mirobe app, talking to the user in ${LANGUAGE[lang]}. Write like a friend with great taste, not like a catalogue.
- "reply": 2-3 short sentences. React to what they said (their plan, mood or constraint), then explain why these exact pieces work together (colour, proportion, formality, weather) and add one concrete styling tip. Mention pieces by their name. No lists, no hashtags, no emoji. You don't know today's weather: never describe it unless the user told you.
- If no pieces were picked, say kindly what is missing from the wardrobe for this request.
- "title": a 2-4 word look name in ${LANGUAGE[lang]}.
- "suggestions": exactly 3 short follow-ups the user might tap next, written as the user speaking in ${LANGUAGE[lang]} (e.g. make it warmer, swap the shoes, a dressier version). Max 5 words each, no emoji.`,
      content: [
        {
          type: 'text',
          text: `Conversation:\n${transcript(messages, input.garments)}\n\nBrief: ${plan.brief}\nSeason: ${currentSeason()}\nPicked pieces:\n${picked.map((g) => `- ${describe(g)}`).join('\n') || '(none)'}${note}`,
        },
      ],
    });

  try {
    // One retry, and only when the first request never got a response: a timeout or a
    // provider error may already have been billed, so it is not repeated.
    const { value, costUsd } = await writeReply().catch((error) => {
      if (isNetworkError(error) && remaining() > 5_000) return writeReply();
      throw error;
    });
    console.info(`[mirobe] stylist reply, cost $${costUsd ?? '?'}`);
    const reply = value as { title?: string; reply?: string; suggestions?: string[] };
    if (reply.reply) decision.text = String(reply.reply);
    if (reply.title) decision.title = String(reply.title).slice(0, 48);
    return { intent: plan.intent, reply: decision.text, suggestions: (reply.suggestions ?? []).slice(0, 3).map(String), decision };
  } catch (error) {
    // A model that answered in prose is still better than the template.
    const text = (error as { text?: string }).text;
    if (text) decision.text = text;
    console.warn('[mirobe] stylist reply failed:', (error as Error).message);
    return { intent: plan.intent, reply: decision.text, suggestions: [], decision };
  }
}

