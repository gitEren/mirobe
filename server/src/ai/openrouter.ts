import type { Config } from '../config';
import { HttpError, ProviderError } from '../lib/http';

export { ProviderError };

/**
 * Provider time budgets. Cloudflare drops a proxied request after 100 s, so
 * everything one API request does must finish well inside ~95 s.
 */
export const TIMEOUTS = {
  /** Structured JSON (tagging, stylist steps), both attempts together. */
  json: 60_000,
  /** One image render (packshot or try-on). */
  image: 85_000,
  decisions: 20_000,
  /** Status polls and downloads of finished videos. */
  poll: 30_000,
};

/** One operator alert per window, however many requests hit the empty balance meanwhile. */
export const CREDITS_ALERT_INTERVAL_MS = 10 * 60 * 1000;
let lastCreditsAlert = -Infinity;

/**
 * The provider refused a request for lack of credits: logs one line operators can search
 * for, at most every 10 minutes. Users only see a neutral "temporarily unavailable", and
 * every paid call that failed this way is refunded. Returns whether it logged.
 */
export function alertOutOfCredits(provider: string, now = Date.now()): boolean {
  if (now - lastCreditsAlert < CREDITS_ALERT_INTERVAL_MS) return false;
  lastCreditsAlert = now;
  console.error(`[mirobe] ALERT: AI provider out of credits (${provider}). AI features fail until the balance is topped up.`);
  return true;
}

function headers(config: Config) {
  if (!config.openRouterKey) throw new ProviderError('openrouter', 503, 'OPENROUTER_API_KEY is not configured');
  return {
    Authorization: `Bearer ${config.openRouterKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': config.appUrl,
    'X-Title': 'Mirobe',
  };
}

async function post<T>(config: Config, path: string, body: unknown, timeoutMs: number): Promise<T> {
  const response = await fetch(`${config.openRouterBase}${path}`, {
    method: 'POST',
    headers: headers(config),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Math.max(1, timeoutMs)),
  });
  const raw = await response.text();
  if (!response.ok) {
    let message = raw.slice(0, 300);
    try {
      const error = JSON.parse(raw)?.error;
      message = [error?.message, error?.metadata?.raw].filter(Boolean).join(': ').slice(0, 400) || message;
    } catch {
      // Non-JSON error bodies are kept as text.
    }
    if (response.status === 402) {
      alertOutOfCredits('openrouter');
      throw new HttpError(503, 'AI provider has no credits left', 'PROVIDER_CREDITS');
    }
    throw new ProviderError('openrouter', response.status, message);
  }
  return JSON.parse(raw) as T;
}

type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

interface ChatResponse {
  choices?: {
    message?: {
      content?: string | null;
      images?: { type: string; image_url: { url: string } }[];
    };
  }[];
  usage?: { cost?: number };
}

export interface JsonSchemaSpec {
  name: string;
  schema: Record<string, unknown>;
}

/** Chat completion that must return a JSON object matching `schema`. */
export async function chatJson(
  config: Config,
  options: { model: string; system?: string; content: ContentPart[]; schema: JsonSchemaSpec; temperature?: number; timeoutMs?: number }
): Promise<{ value: unknown; costUsd?: number }> {
  // One budget for both attempts, so the fallback cannot double the worst case.
  const deadline = Date.now() + (options.timeoutMs ?? TIMEOUTS.json);
  const body = {
    model: options.model,
    temperature: options.temperature ?? 0.1,
    usage: { include: true },
    messages: [
      ...(options.system ? [{ role: 'system', content: options.system }] : []),
      { role: 'user', content: options.content },
    ],
  };
  const structured = {
    ...body,
    // Tagging is perception, not reasoning: thinking tokens would only add cost.
    reasoning: { enabled: false },
    response_format: { type: 'json_schema', json_schema: { name: options.schema.name, strict: true, schema: options.schema.schema } },
  };
  // Some providers reject structured outputs; the prompt already demands JSON and the
  // caller validates with zod, so retry once without response_format.
  const payload = await post<ChatResponse>(config, '/api/v1/chat/completions', structured, deadline - Date.now()).catch((error) => {
    if (error instanceof ProviderError && error.status === 400 && deadline - Date.now() > 5_000) {
      return post<ChatResponse>(config, '/api/v1/chat/completions', body, deadline - Date.now());
    }
    throw error;
  });
  const content = String(payload.choices?.[0]?.message?.content ?? '');
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) {
    if (process.env.DEBUG_AI) console.warn('[mirobe] non-JSON model output:', JSON.stringify(payload).slice(0, 600));
    throw Object.assign(new ProviderError('openrouter', 502, 'Model returned no JSON'), { text: content.trim() });
  }
  return { value: JSON.parse(match[0]), costUsd: payload.usage?.cost };
}

/** Image generation/editing through a chat model with image output (Gemini Flash Image). */
export async function generateImage(
  config: Config,
  options: { model: string; prompt: string; images: string[]; aspectRatio?: string; timeoutMs?: number }
): Promise<{ dataUrl: string; costUsd?: number }> {
  const payload = await post<ChatResponse>(
    config,
    '/api/v1/chat/completions',
    {
      model: options.model,
      modalities: ['image', 'text'],
      usage: { include: true },
      ...(options.aspectRatio ? { image_config: { aspect_ratio: options.aspectRatio } } : {}),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: options.prompt },
            ...options.images.map((url) => ({ type: 'image_url', image_url: { url } })),
          ],
        },
      ],
    },
    options.timeoutMs ?? TIMEOUTS.image
  );
  const dataUrl = payload.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!dataUrl) throw new ProviderError('openrouter', 502, 'Model returned no image');
  return { dataUrl, costUsd: payload.usage?.cost };
}

/**
 * Images API (`POST /api/v1/images`): flat-priced editors such as Seedream take
 * the person and garments as `input_references` instead of chat content.
 */
export async function generateImageViaImagesApi(
  config: Config,
  options: { model: string; prompt: string; images: string[]; aspectRatio?: string; resolution?: string; timeoutMs?: number }
): Promise<{ dataUrl: string; costUsd?: number }> {
  const deadline = Date.now() + (options.timeoutMs ?? TIMEOUTS.image);
  const payload = await post<{ data?: { b64_json?: string; url?: string; media_type?: string }[]; usage?: { cost?: number } }>(
    config,
    '/api/v1/images',
    {
      model: options.model,
      prompt: options.prompt,
      input_references: options.images.map((url) => ({ type: 'image_url', image_url: { url } })),
      ...(options.aspectRatio ? { aspect_ratio: options.aspectRatio } : {}),
      ...(options.resolution ? { resolution: options.resolution } : {}),
      n: 1,
    },
    deadline - Date.now()
  );
  const image = payload.data?.[0];
  if (image?.b64_json) return { dataUrl: `data:${image.media_type || 'image/png'};base64,${image.b64_json}`, costUsd: payload.usage?.cost };
  if (image?.url) {
    const response = await fetch(image.url, { signal: AbortSignal.timeout(Math.max(5_000, deadline - Date.now())) });
    if (!response.ok) throw new ProviderError('openrouter', 502, `Image download failed (${response.status})`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const type = response.headers.get('content-type') || 'image/png';
    return { dataUrl: `data:${type};base64,${buffer.toString('base64')}`, costUsd: payload.usage?.cost };
  }
  throw new ProviderError('openrouter', 502, 'Images API returned no image');
}

/**
 * `resolution` for the Images API, only for models known to accept it: Seedream bills
 * a flat price per image but needs at least ~3.7 MP, so it asks for 2K. Other editors
 * (e.g. MAI-Image) get no resolution parameter and use their own default size.
 */
export function imagesApiResolution(model: string): string | undefined {
  return model.includes('seedream') ? '2K' : undefined;
}

/** Gemini image models answer through chat completions; everything else through the Images API. */
export function renderImage(config: Config, options: { model: string; prompt: string; images: string[]; aspectRatio?: string; timeoutMs?: number }) {
  return options.model.startsWith('google/gemini')
    ? generateImage(config, options)
    : generateImageViaImagesApi(config, { ...options, resolution: imagesApiResolution(options.model) });
}

// ---------------------------------------------------------------------------
// Video API (async): submit, poll, download.
// ---------------------------------------------------------------------------

export async function submitVideo(
  config: Config,
  options: { model: string; prompt: string; imageDataUrl: string; durationSeconds: number; resolution: string; loop: boolean }
): Promise<string> {
  const frame = (frame_type: 'first_frame' | 'last_frame') => ({ type: 'image_url', image_url: { url: options.imageDataUrl }, frame_type });
  const payload = await post<{ id: string }>(config, '/api/v1/videos', {
    model: options.model,
    prompt: options.prompt,
    duration: options.durationSeconds,
    resolution: options.resolution,
    aspect_ratio: '9:16',
    // Same image as first and last frame: the turn comes back to the exact try-on photo and loops cleanly.
    frame_images: options.loop ? [frame('first_frame'), frame('last_frame')] : [frame('first_frame')],
    generate_audio: false,
  }, TIMEOUTS.json);
  return payload.id;
}

/** Job states that mean "still working"; anything unknown is treated as a failure. */
const VIDEO_PENDING = new Set(['pending', 'queued', 'in_queue', 'submitted', 'starting', 'processing', 'in_progress', 'running']);

/**
 * One poll of an OpenRouter video job. A missing job (404) or an unknown state
 * is a failure; an unreachable API or a failed download of a finished clip
 * throws, so the poller retries it (the provider has already charged for it).
 */
export async function checkVideo(
  config: Config,
  id: string
): Promise<{ status: 'processing' } | { status: 'ready'; buffer: Buffer; costUsd?: number } | { status: 'failed'; error: string }> {
  const response = await fetch(`${config.openRouterBase}/api/v1/videos/${id}`, { headers: headers(config), signal: AbortSignal.timeout(TIMEOUTS.poll) });
  if (response.status === 404) return { status: 'failed', error: 'job not found' };
  if (!response.ok) throw new ProviderError('openrouter', response.status, `video status ${response.status}`);
  const job = (await response.json().catch(() => ({}))) as { status?: string; error?: unknown; usage?: { cost?: number } };
  const status = String(job.status ?? '').toLowerCase();
  if (status === 'completed' || status === 'succeeded') {
    const content = await fetch(`${config.openRouterBase}/api/v1/videos/${id}/content?index=0`, { headers: headers(config), signal: AbortSignal.timeout(TIMEOUTS.poll) });
    if (!content.ok) throw new ProviderError('openrouter', content.status, `video download failed (${content.status})`);
    return { status: 'ready', buffer: Buffer.from(await content.arrayBuffer()), costUsd: job.usage?.cost };
  }
  if (VIDEO_PENDING.has(status) && !job.error) return { status: 'processing' };
  return { status: 'failed', error: typeof job.error === 'string' && job.error ? job.error : status || 'unknown job state' };
}

// ---------------------------------------------------------------------------
// Decisions API (Jev). Alpha endpoint, no /v1 prefix.
// ---------------------------------------------------------------------------

export type DecisionQuestion =
  | { type: 'noul'; instructions: string; criteria: { true: string; false: string } }
  | { type: 'choice'; instructions: string; criteria: Record<string, string | Record<string, unknown>> }
  | { type: 'score'; instructions: string; criteria: string[] };

export type DecisionAnswer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; confidence?: number; probabilities?: Record<string, number> }
  | { type: 'score'; score: number; confidence?: number };

export interface DecisionsResponse {
  model: string;
  answers: Record<string, DecisionAnswer>;
  usage: { input_tokens: number; output_tokens: number; cost?: number };
}

export function decide(
  config: Config,
  body: { model: string; state: unknown; questions: Record<string, DecisionQuestion>; user?: string }
) {
  return post<DecisionsResponse>(config, '/api/alpha/decisions', body, TIMEOUTS.decisions);
}
