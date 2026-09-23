import type { Config } from '../config';
import { checkMotionClip, submitMotionClip, uploadToFal } from './fal';
import { ProviderError } from '../lib/http';
import { checkVideo, submitVideo, TIMEOUTS } from './openrouter';

const MOTION_PROMPT =
  'The person does a slow, natural fashion turn in place: a relaxed quarter turn to the left, then back to face the camera with a small confident pose. The clothing moves naturally with the body; the outfit, face and background stay exactly the same. Static camera, soft studio light.';

export type ClipCheck = { status: 'processing' } | { status: 'ready'; buffer: Buffer; costUsd?: number } | { status: 'failed'; error: string };

/** Starts a 5 s motion clip from a try-on photo. Returns an opaque job id ("provider:id"). */
export async function startMotionClip(config: Config, image: { buffer: Buffer; mimeType: string }): Promise<string> {
  if (config.videoProvider === 'fal') {
    const url = await uploadToFal(config, image.buffer, image.mimeType);
    return `fal:${await submitMotionClip(config, url)}`;
  }
  const id = await submitVideo(config, {
    model: config.videoModel,
    prompt: MOTION_PROMPT,
    imageDataUrl: `data:${image.mimeType};base64,${image.buffer.toString('base64')}`,
    durationSeconds: 5,
    resolution: config.videoResolution,
    loop: true,
  });
  return `openrouter:${id}`;
}

/**
 * One poll of a clip job. Throws when the provider could not be reached or a
 * finished clip could not be downloaded: the caller retries until the job's max age.
 */
export async function checkMotionClipJob(config: Config, job: string): Promise<ClipCheck> {
  const [provider, id] = job.split(/:(.+)/);
  if (provider === 'openrouter') return checkVideo(config, id);
  if (provider !== 'fal' || !id) return { status: 'failed', error: 'unknown job' };
  const result = await checkMotionClip(config, id);
  if (result.status !== 'ready') return result;
  const response = await fetch(result.videoUrl, { signal: AbortSignal.timeout(TIMEOUTS.poll) });
  if (!response.ok) throw new ProviderError('fal', response.status, `clip download failed (${response.status})`);
  return { status: 'ready', buffer: Buffer.from(await response.arrayBuffer()) };
}
