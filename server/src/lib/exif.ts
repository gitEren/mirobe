/**
 * Reads the EXIF orientation tag (1-8) of a JPEG, or null when there is none.
 *
 * The app bakes the orientation into the pixels before it uploads a photo (mobile
 * lib/media.ts), because the AI models read raw pixels and ignore this tag: a photo
 * still carrying a rotation here reaches them sideways. The server has no image
 * library to rotate pixels itself (sharp would be a heavy native dependency), so it
 * only reports such uploads; see README "Photo orientation".
 */
export function jpegOrientation(buffer: Buffer): number | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    // Start of scan / end of image: the metadata segments are over.
    if (marker === 0xda || marker === 0xd9) return null;
    const size = buffer.readUInt16BE(offset + 2);
    if (size < 2) return null;
    if (marker === 0xe1 && buffer.toString('latin1', offset + 4, offset + 10) === 'Exif\0\0') {
      return tiffOrientation(buffer.subarray(offset + 10, Math.min(buffer.length, offset + 2 + size)));
    }
    offset += 2 + size;
  }
  return null;
}

function tiffOrientation(tiff: Buffer): number | null {
  if (tiff.length < 8) return null;
  const order = tiff.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') return null;
  const little = order === 'II';
  const u16 = (at: number) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const u32 = (at: number) => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return null;
  const count = u16(ifd);
  for (let index = 0; index < count; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > tiff.length) return null;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}
