import * as ImagePicker from 'expo-image-picker';
import type { GarmentRow } from '@mirobe/shared';
import { liftGarment } from './lift';
import { persistPhoto } from './media';
import { addGarment } from './store';

/** Stores the photo, lifts the garment on-device when it isn't worn, and queues it for AI tagging. */
export async function addGarmentFromPhoto(
  uri: string,
  size: { width: number; height: number } | undefined,
  source: GarmentRow['source']
): Promise<{ garment: GarmentRow; imageUri: string }> {
  const imageUri = await persistPhoto(uri, size);
  // "On me" photos would lift the whole person; those get the AI packshot instead.
  const cutoutUri = source === 'wearing' ? null : await liftGarment(imageUri);
  return { garment: addGarment({ imageUri, cutoutUri, source }), imageUri };
}

/** Multi-select from the photo library. Returns how many garments were added. */
export async function addGarmentsFromLibrary(onAdded?: (item: { garment: GarmentRow; imageUri: string }) => void): Promise<number> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 12, quality: 0.9 });
  if (result.canceled) return 0;
  for (const asset of result.assets) {
    // Not `onAdded?.(await …)`: without a callback that would skip adding the garment altogether.
    const added = await addGarmentFromPhoto(asset.uri, { width: asset.width, height: asset.height }, 'gallery');
    onAdded?.(added);
  }
  return result.assets.length;
}
