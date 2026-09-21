/**
 * Client-side Smart Garment Cutout & Background Isolation
 * Takes a raw clothing photo (from camera or file upload) and removes uniform / light
 * backgrounds to produce a clean, transparent PNG cutout for AR try-on.
 */
import { createMediaPipeGarmentCutout } from './segmentation';

export async function createGarmentCutout(
  imageSrc: string,
  isWearingScan = false
): Promise<string> {
  const segmentedCutout = await createMediaPipeGarmentCutout(imageSrc, isWearingScan);
  if (segmentedCutout) return segmentedCutout;

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(imageSrc);
          return;
        }

        // Limit dimensions for fast client-side processing
        const maxDim = 800;
        let w = img.width;
        let h = img.height;

        // If scanning a garment worn on person (selfie), focus on the chest/torso region
        let srcX = 0;
        let srcY = 0;
        let srcW = w;
        let srcH = h;

        if (isWearingScan && h > w * 1.1) {
          // Portrait selfie: torso starts below the chin (~38% of height) to mid-torso (~85%)
          srcX = Math.round(w * 0.08);
          srcY = Math.round(h * 0.38);
          srcW = Math.round(w * 0.84);
          srcH = Math.round(h * 0.50);
        }

        let targetW = srcW;
        let targetH = srcH;
        if (targetW > maxDim || targetH > maxDim) {
          if (targetW > targetH) {
            targetH = Math.round((targetH * maxDim) / targetW);
            targetW = maxDim;
          } else {
            targetW = Math.round((targetW * maxDim) / targetH);
            targetH = maxDim;
          }
        }

        canvas.width = targetW;
        canvas.height = targetH;

        // Draw the extracted clothing region
        ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, targetW, targetH);

        const imgData = ctx.getImageData(0, 0, targetW, targetH);
        const data = imgData.data;

        // Sample background from top corners of the cropped area
        const sampleCorners = [
          [0, 0],
          [targetW - 1, 0],
          [Math.floor(targetW * 0.05), Math.floor(targetH * 0.05)],
          [Math.floor(targetW * 0.95), Math.floor(targetH * 0.05)],
        ];

        let bgR = 0, bgG = 0, bgB = 0, count = 0;
        for (const [cx, cy] of sampleCorners) {
          const idx = (cy * targetW + cx) * 4;
          bgR += data[idx];
          bgG += data[idx + 1];
          bgB += data[idx + 2];
          count++;
        }
        bgR /= count;
        bgG /= count;
        bgB /= count;

        const threshold = 45;
        for (let y = 0; y < targetH; y++) {
          for (let x = 0; x < targetW; x++) {
            const i = (y * targetW + x) * 4;
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            // Distance from sampled background
            const dist = Math.sqrt((r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2);
            const isNearWhite = r > 220 && g > 220 && b > 220;

            // Soft radial / vignette feathering at outer perimeter
            const relX = (x / targetW - 0.5) * 2;
            const relY = (y / targetH - 0.5) * 2;
            const edgeDist = Math.max(Math.abs(relX), Math.abs(relY));

            if (dist < threshold || isNearWhite) {
              data[i + 3] = 0;
            } else if (edgeDist > 0.88) {
              const fade = (1 - edgeDist) / 0.12;
              data[i + 3] = Math.round(data[i + 3] * Math.max(0, Math.min(1, fade)));
            }
          }
        }

        ctx.putImageData(imgData, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        console.warn('Cutout generation failed, using original', err);
        resolve(imageSrc);
      }
    };

    img.onerror = () => {
      resolve(imageSrc);
    };

    img.src = imageSrc;
  });
}

/**
 * Keeps every wardrobe card visually consistent. The transparent asset stays
 * canonical for try-on; this composite is only the calm catalog preview.
 */
export async function createStudioGarmentImage(cutoutSrc: string): Promise<string> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 720;
      canvas.height = 900;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(cutoutSrc);
        return;
      }

      const background = ctx.createLinearGradient(0, 0, 0, canvas.height);
      background.addColorStop(0, '#fbfaf7');
      background.addColorStop(1, '#eeeae2');
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.filter = 'blur(18px)';
      ctx.fillStyle = '#4b443b';
      ctx.beginPath();
      ctx.ellipse(canvas.width / 2, canvas.height * 0.82, canvas.width * 0.25, canvas.height * 0.035, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      const padding = 72;
      const scale = Math.min((canvas.width - padding * 2) / image.width, (canvas.height - padding * 2) / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2 - 18, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    image.onerror = () => resolve(cutoutSrc);
    image.src = cutoutSrc;
  });
}

export async function validateTransparentGarment(imageSrc: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const canvas = document.createElement('canvas');
      const width = Math.min(320, image.naturalWidth || image.width);
      const height = Math.max(1, Math.round(width * ((image.naturalHeight || image.height) / (image.naturalWidth || image.width))));
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(false);
        return;
      }
      ctx.drawImage(image, 0, 0, width, height);
      const pixels = ctx.getImageData(0, 0, width, height).data;
      let visible = 0;
      let minX = width;
      let minY = height;
      let maxX = 0;
      let maxY = 0;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const alpha = pixels[(y * width + x) * 4 + 3];
          if (alpha > 24) {
            visible += 1;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
        }
      }
      const ratio = visible / (width * height);
      const boxRatio = visible > 0 ? ((maxX - minX) * (maxY - minY)) / (width * height) : 0;
      resolve(ratio > 0.02 && ratio < 0.94 && boxRatio > 0.04 && boxRatio < 0.9);
    };
    image.onerror = () => resolve(false);
    image.src = imageSrc;
  });
}
