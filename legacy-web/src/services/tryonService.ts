import { TryOnRequest, TryOnResult } from '../types';
import { TRYON_RENDERS } from './mockData';

export interface VTONProvider {
  name: string;
  version: string;
  render(req: TryOnRequest): Promise<TryOnResult>;
}

export interface LiveReference {
  garmentIds: string[];
  referenceImageUrl: string;
  prompt: string;
}

/**
 * Generates deterministic cache keys following the formula:
 * mirror_profile_version + sorted garment IDs + pose + renderer_version
 */
export function generateTryOnCacheKey(
  mirrorProfileVersion: string,
  garmentIds: string[],
  pose = 'neutral_standing',
  rendererVersion = 'vton_gemini_2.5'
): string {
  const sortedGarmentStr = [...garmentIds].sort().join(':');
  return `key_${mirrorProfileVersion}__${sortedGarmentStr}__${pose}__${rendererVersion}`;
}

/**
 * Local in-memory render cache to guarantee instant switching
 */
const renderCache = new Map<string, TryOnResult>();

// Prepopulate cache with initial mock renders so app feels instant right out of the box
Object.entries(TRYON_RENDERS).forEach(([garmentId, renderData]) => {
  const key = generateTryOnCacheKey('v2.4', [garmentId]);
  renderCache.set(key, {
    id: `render_${garmentId}`,
    status: 'ready',
    previewUrl: renderData.previewUrl,
    finalUrl: renderData.fullUrl,
    cached: true,
    garmentIds: [garmentId],
    wearingDescription: renderData.title,
  });
});

/**
 * Provider-independent Try-On client
 */
class TryOnService {
  private activeProvider: VTONProvider;

  constructor() {
    // The realtime Fal adapter lives in falRealtimeService. This provider remains
    // intentionally cheap and deterministic for offline/demo mode only.
    this.activeProvider = {
      name: 'Mirobe Local Overlay Fallback',
      version: 'local-overlay-v1',
      render: async (req: TryOnRequest): Promise<TryOnResult> => {
        const cacheKey = generateTryOnCacheKey('v2.4', req.garmentIds);

        // Check cache first
        if (renderCache.has(cacheKey)) {
          return {
            ...renderCache.get(cacheKey)!,
            cached: true,
          };
        }

        // For non-cached looks, fallback to matching or first available render
        const primaryGarmentId = req.garmentIds[0];
        const match = TRYON_RENDERS[primaryGarmentId] || TRYON_RENDERS['g_black_blazer'];

        const simulatedResult: TryOnResult = {
          id: `render_${Date.now()}`,
          status: 'ready',
          previewUrl: match.previewUrl,
          finalUrl: match.fullUrl,
          cached: false,
          garmentIds: req.garmentIds,
          wearingDescription: match.title,
        };

        // Cache it for subsequent instant taps
        renderCache.set(cacheKey, simulatedResult);
        return simulatedResult;
      },
    };
  }

  /**
   * Synchronously inspect if a look is already cached in memory for sub-10ms UI display
   */
  public getCachedRender(garmentIds: string[], mirrorVersion = 'v2.4'): TryOnResult | null {
    const key = generateTryOnCacheKey(mirrorVersion, garmentIds);
    return renderCache.get(key) || null;
  }

  /**
   * Request the offline fallback render. Live sessions use Fal Lucy through
   * connectFalRealtime and never call a photo-based renderer on garment taps.
   */
  public async executeTryOn(req: TryOnRequest): Promise<TryOnResult> {
    const cached = this.getCachedRender(req.garmentIds);
    if (cached) {
      return cached;
    }
    return await this.activeProvider.render(req);
  }

  public createLiveReference(garmentIds: string[], referenceImageUrl: string): LiveReference {
    return {
      garmentIds,
      referenceImageUrl,
      prompt:
        'Substitute the current top with the outfit from the reference image, matching its color, material, and fit. Preserve the person, face, motion, lighting and background.',
    };
  }

  /**
   * Prefetch adjacent garments into cache and browser image cache
   */
  public prefetchGarments(garmentIdsList: string[][], mirrorVersion = 'v2.4'): void {
    garmentIdsList.forEach((garmentIds) => {
      const key = generateTryOnCacheKey(mirrorVersion, garmentIds);
      if (!renderCache.has(key)) {
        const primaryId = garmentIds[0];
        const match = TRYON_RENDERS[primaryId] || TRYON_RENDERS['g_black_blazer'];
        renderCache.set(key, {
          id: `prefetch_${primaryId}`,
          status: 'ready',
          previewUrl: match.previewUrl,
          finalUrl: match.fullUrl,
          cached: true,
          garmentIds,
          wearingDescription: match.title,
        });

        // Preload image in browser memory
        if (typeof window !== 'undefined') {
          const img = new Image();
          img.src = match.fullUrl;
        }
      }
    });
  }
}

export const tryonService = new TryOnService();
