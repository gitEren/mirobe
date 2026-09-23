/**
 * Optional on-device foreground segmentation for scans.
 * The model is loaded lazily so a missing network/model cache never blocks saving a garment.
 */
export async function createMediaPipeGarmentCutout(imageSrc: string, isWearingScan: boolean): Promise<string | null> {
  if (!isWearingScan || typeof window === 'undefined') return null;

  try {
    const [{ FilesetResolver, ImageSegmenter }, image] = await Promise.all([
      import('@mediapipe/tasks-vision'),
      loadImage(imageSrc),
    ]);
    const fileset = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'
    );
    const segmenter = await ImageSegmenter.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite',
      },
      runningMode: 'IMAGE',
      outputConfidenceMasks: true,
    });
    const result = segmenter.segment(image);
    const masks = result.confidenceMasks || [];
    if (masks.length === 0) {
      segmenter.close();
      return null;
    }

    const width = Math.min(800, image.naturalWidth || image.width);
    const height = Math.round(width * ((image.naturalHeight || image.height) / (image.naturalWidth || image.width)));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      segmenter.close();
      return null;
    }
    ctx.drawImage(image, 0, 0, width, height);
    const pixels = ctx.getImageData(0, 0, width, height);
    const maskData = masks.map((mask) => mask.getAsFloat32Array());
    const maskWidth = masks[0].width;
    const maskHeight = masks[0].height;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const maskX = Math.min(maskWidth - 1, Math.floor((x / width) * maskWidth));
        const maskY = Math.min(maskHeight - 1, Math.floor((y / height) * maskHeight));
        const maskIndex = maskY * maskWidth + maskX;
        const confidence = Math.max(...maskData.map((data) => data[maskIndex] || 0));
        const alphaIndex = (y * width + x) * 4 + 3;
        pixels.data[alphaIndex] = Math.round(Math.max(0, Math.min(1, (confidence - 0.2) / 0.55)) * 255);
      }
    }

    ctx.putImageData(pixels, 0, 0);
    segmenter.close();
    if (isWearingScan && height > width * 1.1) {
      const cropCanvas = document.createElement('canvas');
      const cropX = Math.round(width * 0.08);
      const cropY = Math.round(height * 0.38);
      const cropWidth = Math.round(width * 0.84);
      const cropHeight = Math.round(height * 0.5);
      cropCanvas.width = cropWidth;
      cropCanvas.height = cropHeight;
      cropCanvas.getContext('2d')?.drawImage(canvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
      return cropCanvas.toDataURL('image/png');
    }
    return canvas.toDataURL('image/png');
  } catch (error) {
    console.info('On-device garment segmentation unavailable; using local edge fallback.', error);
    return null;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image could not be loaded'));
    image.src = src;
  });
}
