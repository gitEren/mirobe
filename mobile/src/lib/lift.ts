import SubjectLift from '../../modules/subject-lift/src/SubjectLiftModule';
import { persistFile } from './media';

/**
 * Cuts the garment out of the photo on-device (iOS 17+ Vision, Android ML Kit
 * Subject Segmentation). Free, instant and pixel-faithful. Returns null when unsupported or when the mask looks
 * wrong (nothing found, or the "subject" is the whole frame).
 */
export async function liftGarment(photoUri: string): Promise<string | null> {
  if (!SubjectLift?.isSupported) return null;
  try {
    const result = await SubjectLift.liftSubject(photoUri);
    if (!result || result.coverage < 0.03 || result.coverage > 0.97) return null;
    return await persistFile(result.uri, 'png');
  } catch (error) {
    console.warn('[mirobe] on-device lift failed', error);
    return null;
  }
}
