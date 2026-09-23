import { Directory, File, Paths } from 'expo-file-system';
import { FlipType, ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { api } from './api';
import { isLocalPath, resolveLocalUri } from './localPath';

const MEDIA_DIR = new Directory(Paths.document, 'media');
const MAX_EDGE = 1280;

function ensureDir() {
  if (!MEDIA_DIR.exists) MEDIA_DIR.create({ intermediates: true, idempotent: true });
}

/**
 * Downscales a captured/picked photo and keeps it in the app's documents
 * folder, so a garment can be added offline and uploaded later.
 *
 * Every stored (and so every uploaded) photo is upright in its pixels: manipulate()
 * applies the EXIF orientation before anything else, and the re-encoded JPEG carries
 * none. The AI models read raw pixels and ignore EXIF, so a phone photo stored as
 * "sensor pixels + rotate 90°" would reach them sideways.
 */
export async function persistPhoto(uri: string, size?: { width: number; height: number }): Promise<string> {
  ensureDir();
  // Also bakes the EXIF orientation into the pixels (see above), resize or not.
  const context = ImageManipulator.manipulate(uri);
  if (size && Math.max(size.width, size.height) > MAX_EDGE) {
    context.resize(size.width >= size.height ? { width: MAX_EDGE } : { height: MAX_EDGE });
  } else if (!size) {
    context.resize({ height: MAX_EDGE });
  }
  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.82 });
  const target = new File(MEDIA_DIR, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`);
  await new File(result.uri).copy(target);
  return target.uri;
}

/** How the phone was held when a photo was taken (expo-camera's responsive orientation). */
export type HeldOrientation = 'portrait' | 'portraitUpsideDown' | 'landscapeLeft' | 'landscapeRight';

/**
 * Clockwise degrees that turn a photo taken with the phone held `held` into what the
 * portrait-locked screen showed. The camera saves landscape photos when the phone is
 * tilted sideways (it follows gravity, the app's UI does not), so a garment framed
 * upright on screen came out lying on its side. landscapeLeft is the phone turned
 * counter-clockwise: the screen showed the scene turned clockwise. A mirrored (selfie)
 * photo turns the other way.
 */
export function screenRotation(held: HeldOrientation, mirrored: boolean): 0 | 90 | -90 {
  const turn = held === 'landscapeLeft' ? 90 : held === 'landscapeRight' ? -90 : 0;
  if (turn === 0) return 0;
  return mirrored ? (-turn as 90 | -90) : turn;
}

/**
 * Re-renders a captured photo turned by `rotate` degrees and/or un-mirrored. Returns the
 * photo unchanged when there is nothing to do. The result is upright in its pixels.
 */
export async function alignPhoto(
  photo: { uri: string; width: number; height: number },
  { rotate = 0, unmirror = false }: { rotate?: number; unmirror?: boolean }
): Promise<{ uri: string; width: number; height: number }> {
  if (!rotate && !unmirror) return photo;
  const context = ImageManipulator.manipulate(photo.uri);
  if (rotate) context.rotate(rotate);
  if (unmirror) context.flip(FlipType.Horizontal);
  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.92 });
  return { uri: result.uri, width: result.width, height: result.height };
}

/** Keeps an already-processed file (e.g. an on-device cutout PNG) next to the photos. */
export async function persistFile(uri: string, extension: string): Promise<string> {
  ensureDir();
  const target = new File(MEDIA_DIR, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`);
  await new File(uri).copy(target);
  return target.uri;
}

/** A photo that only exists on this device (not uploaded yet). */
export function isLocalUri(uri: string | null | undefined): uri is string {
  return isLocalPath(uri);
}

/** The local file a row points at is gone (deleted, or lost with an old app container). */
export class MissingLocalPhotoError extends Error {
  constructor(public uri: string) {
    super(`Local photo missing: ${uri}`);
  }
}

/** Uploads a local photo (a `file://` URI or a stored `local:` path) and returns the server's relative media path. */
export async function uploadLocalPhoto(uri: string): Promise<string> {
  const file = new File(resolveLocalUri(uri));
  if (!file.exists) throw new MissingLocalPhotoError(uri);
  const base64 = await file.base64();
  const mimeType = uri.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  const { url } = await api.uploadImage(`data:${mimeType};base64,${base64}`);
  return url;
}

export function deleteLocalPhoto(uri: string) {
  try {
    const file = new File(resolveLocalUri(uri));
    if (file.exists) file.delete();
  } catch {
    // Best effort cleanup.
  }
}

/** Signing out: photos of the previous account must not stay on the device for the next one. */
export function clearLocalMedia() {
  try {
    if (MEDIA_DIR.exists) MEDIA_DIR.delete();
  } catch {
    // Best effort cleanup; the rows pointing at these files are gone already.
  }
}
