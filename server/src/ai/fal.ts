import { createFalClient, type FalClient } from '@fal-ai/client';
import type { Config } from '../config';
import { HttpError } from '../lib/http';

let client: FalClient | null = null;

function fal(config: Config): FalClient {
  if (!config.falKey) throw new HttpError(503, 'FAL_KEY is not configured', 'PROVIDER_UNAVAILABLE');
  client ??= createFalClient({ credentials: config.falKey });
  return client;
}

/** fal workers cannot reach our local /media URLs, so assets go through fal storage. */
export async function uploadToFal(config: Config, buffer: Buffer, mimeType: string): Promise<string> {
  return fal(config).storage.upload(new Blob([new Uint8Array(buffer)], { type: mimeType }));
}

export async function submitMotionClip(config: Config, imageUrl: string): Promise<string> {
  const { request_id } = await fal(config).queue.submit(config.videoModel, {
    input: {
      image_url: imageUrl,
      duration: '5',
      prompt:
        'The person does a slow, natural fashion turn in place: a relaxed quarter turn to the left, then back to face the camera with a small confident pose. The clothing moves naturally with the body; the outfit, face and background stay exactly the same. Static camera, soft studio light.',
      negative_prompt: 'changing clothes, new garments, extra people, text, blur, distortion, morphing face',
    },
  });
  return request_id;
}

export async function checkMotionClip(
  config: Config,
  requestId: string
): Promise<{ status: 'processing' } | { status: 'ready'; videoUrl: string } | { status: 'failed'; error: string }> {
  const client = fal(config);
  let status: { status: string };
  try {
    status = await client.queue.status(config.videoModel, { requestId });
  } catch (error) {
    // An unknown request is final; anything else (network, 5xx) is retried by the poller.
    if ((error as { status?: number }).status === 404) return { status: 'failed', error: 'request not found' };
    throw error;
  }
  if (status.status === 'IN_QUEUE' || status.status === 'IN_PROGRESS') return { status: 'processing' };
  if (status.status !== 'COMPLETED') return { status: 'failed', error: `unexpected status ${status.status}` };
  try {
    const result = await client.queue.result(config.videoModel, { requestId });
    const url = (result.data as { video?: { url?: string } })?.video?.url;
    return url ? { status: 'ready', videoUrl: url } : { status: 'failed', error: 'No video in result' };
  } catch (error) {
    return { status: 'failed', error: (error as Error).message };
  }
}

/** Short-lived token scoped to the realtime try-on app; FAL_KEY never leaves the server. */
export async function createRealtimeToken(config: Config): Promise<string> {
  if (!config.falKey) throw new HttpError(503, 'FAL_KEY is not configured', 'PROVIDER_UNAVAILABLE');
  const response = await fetch('https://rest.alpha.fal.ai/tokens/', {
    signal: AbortSignal.timeout(15_000),
    method: 'POST',
    headers: { Authorization: `Key ${config.falKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ allowed_apps: [config.liveApp], token_expiration: 120 }),
  });
  const raw = await response.text();
  if (!response.ok) throw new HttpError(502, `fal token request failed (${response.status})`, 'PROVIDER_ERROR');
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'string' ? parsed : parsed.token;
  } catch {
    return raw;
  }
}
