import { Garment, JevDecision, Look, MirrorProfile, PhotoTryOnResult, StylistMessage, TryOnRequest, TryOnResult, UsageSnapshot } from '../types';
import { INITIAL_GARMENTS, INITIAL_LOOKS, INITIAL_MIRROR_PROFILE, INITIAL_STYLIST_MESSAGES } from './mockData';
import { tryonService } from './tryonService';

/**
 * Mirobe API Client - Abstraction layer ready for FastAPI & Supabase backend.
 * Provides resilient local storage fallback for standalone execution.
 */

const STORAGE_KEY_GARMENTS = 'mirobe_garments_v1';
const STORAGE_KEY_LOOKS = 'mirobe_looks_v1';
const STORAGE_KEY_PROFILE = 'mirobe_profile_v1';
const STORAGE_KEY_MESSAGES = 'mirobe_stylist_v1';

export class MirobeApiClient {
  private baseUrl: string;

  constructor(baseUrl = '/api') {
    this.baseUrl = baseUrl;
  }

  // Helper for localStorage
  private getLocal<T>(key: string, fallback: T): T {
    if (typeof window === 'undefined') return fallback;
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : fallback;
    } catch {
      return fallback;
    }
  }

  private setLocal<T>(key: string, data: T): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch {
      // ignore
    }
  }

  // --- Mirror Profile ---
  async getMirrorProfile(): Promise<MirrorProfile> {
    return this.getLocal<MirrorProfile>(STORAGE_KEY_PROFILE, INITIAL_MIRROR_PROFILE);
  }

  async createMirrorProfile(photoUrl: string, name = 'My Mirror'): Promise<MirrorProfile> {
    const newProfile: MirrorProfile = {
      id: `mirror_${Date.now()}`,
      userId: 'usr_deniz_01',
      name,
      photoUrl,
      aspectRatio: '9:16',
      height: '172 cm',
      bodyType: 'Neutral / Tailored',
      version: `v${(Math.random() * 0.5 + 2.0).toFixed(1)}`,
      createdAt: new Date().toISOString(),
    };
    this.setLocal(STORAGE_KEY_PROFILE, newProfile);
    return newProfile;
  }

  // --- Wardrobe Items ---
  async getWardrobeItems(): Promise<Garment[]> {
    return this.getLocal<Garment[]>(STORAGE_KEY_GARMENTS, INITIAL_GARMENTS);
  }

  async addWardrobeItem(item: Omit<Garment, 'id' | 'userId' | 'createdAt'>): Promise<Garment> {
    const items = await this.getWardrobeItems();
    const newItem: Garment = {
      ...item,
      id: `g_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      userId: 'usr_deniz_01',
      createdAt: new Date().toISOString(),
      wornCount: 0,
      lastWorn: 'Never',
    };
    const updated = [newItem, ...items];
    this.setLocal(STORAGE_KEY_GARMENTS, updated);
    return newItem;
  }

  async addMultipleWardrobeItems(newItems: Omit<Garment, 'id' | 'userId' | 'createdAt'>[]): Promise<Garment[]> {
    const items = await this.getWardrobeItems();
    const created: Garment[] = newItems.map((item, idx) => ({
      ...item,
      id: `g_${Date.now()}_${idx}`,
      userId: 'usr_deniz_01',
      createdAt: new Date().toISOString(),
      wornCount: 0,
      lastWorn: 'Just added',
    }));
    const updated = [...created, ...items];
    this.setLocal(STORAGE_KEY_GARMENTS, updated);
    return created;
  }

  async deleteWardrobeItem(id: string): Promise<boolean> {
    const items = await this.getWardrobeItems();
    const filtered = items.filter((g) => g.id !== id);
    this.setLocal(STORAGE_KEY_GARMENTS, filtered);
    return true;
  }

  async toggleGarmentFavorite(id: string): Promise<Garment | null> {
    const items = await this.getWardrobeItems();
    const updated = items.map((item) => {
      if (item.id === id) {
        return { ...item, favorite: !item.favorite };
      }
      return item;
    });
    this.setLocal(STORAGE_KEY_GARMENTS, updated);
    return updated.find((i) => i.id === id) || null;
  }

  // --- Try-On ---
  async requestTryOn(req: TryOnRequest): Promise<TryOnResult> {
    return await tryonService.executeTryOn(req);
  }

  async requestPhotoTryOn(personImageBase64: string, garments: Garment[], userId = 'local-demo'): Promise<PhotoTryOnResult | null> {
    try {
      const response = await fetch(`${this.baseUrl}/photo-try-on`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personImageBase64,
          garmentImages: garments.map((garment) => garment.cutoutUrl || garment.studioUrl || garment.imageUrl),
          garmentIds: garments.map((garment) => garment.id),
          userId,
        }),
      });
      const json = await response.json();
      if (!response.ok) {
        const error = new Error(json?.error || 'Photo renderer unavailable') as Error & { code?: string };
        error.code = json?.code;
        throw error;
      }
      return json.success && json.data ? json.data : null;
    } catch {
      return null;
    }
  }

  async getUsage(userId = 'local-demo'): Promise<Partial<UsageSnapshot> | null> {
    try {
      const response = await fetch(`${this.baseUrl}/usage?userId=${encodeURIComponent(userId)}`);
      const json = await response.json();
      return json.success ? json.data : null;
    } catch {
      return null;
    }
  }

  // --- Looks ---
  async getLooks(): Promise<Look[]> {
    return this.getLocal<Look[]>(STORAGE_KEY_LOOKS, INITIAL_LOOKS);
  }

  async saveLook(look: Omit<Look, 'id' | 'userId' | 'createdAt'>): Promise<Look> {
    const looks = await this.getLooks();
    const newLook: Look = {
      ...look,
      id: `look_${Date.now()}`,
      userId: 'usr_deniz_01',
      createdAt: new Date().toISOString(),
      saved: true,
    };
    const updated = [newLook, ...looks];
    this.setLocal(STORAGE_KEY_LOOKS, updated);
    return newLook;
  }

  async toggleSaveLook(id: string): Promise<boolean> {
    const looks = await this.getLooks();
    const updated = looks.map((l) => (l.id === id ? { ...l, saved: !l.saved } : l));
    this.setLocal(STORAGE_KEY_LOOKS, updated);
    return true;
  }

  // --- Stylist ---
  async getStylistMessages(): Promise<StylistMessage[]> {
    return this.getLocal<StylistMessage[]>(STORAGE_KEY_MESSAGES, INITIAL_STYLIST_MESSAGES);
  }

  async requestJevDecision(
    query: string,
    wardrobe: Garment[],
    lang: 'tr' | 'en' = 'tr'
  ): Promise<{ decision: JevDecision; text: string; lookTitle: string } | null> {
    try {
      const response = await fetch(`${this.baseUrl}/jev/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, wardrobe, lang }),
      });
      if (!response.ok) return null;
      const json = await response.json();
      return json.success && json.data ? json.data : null;
    } catch {
      return null;
    }
  }

  async sendStylistMessage(text: string, lang: 'tr' | 'en' = 'tr'): Promise<StylistMessage> {
    const messages = await this.getStylistMessages();
    const userMsg: StylistMessage = {
      id: `msg_${Date.now()}`,
      sender: 'user',
      text,
      createdAt: new Date().toISOString(),
    };

    const wardrobe = await this.getWardrobeItems();

    const jev = await this.requestJevDecision(text, wardrobe, lang);
    if (jev) {
      const garmentIds = [
        jev.decision.topGarmentId,
        jev.decision.outerwearGarmentId,
        jev.decision.bottomGarmentId,
        jev.decision.shoesGarmentId,
        jev.decision.accessoryGarmentId,
      ].filter(Boolean) as string[];
      const aiMsg: StylistMessage = {
        id: `msg_${Date.now() + 1}`,
        sender: 'mirobe',
        text: jev.text,
        garmentIds,
        lookTitle: jev.lookTitle,
        createdAt: new Date(Date.now() + 100).toISOString(),
      };
      this.setLocal(STORAGE_KEY_MESSAGES, [...messages, userMsg, aiMsg]);
      return aiMsg;
    }

    let replyText =
      lang === 'tr'
        ? 'Gardrobundaki parçaları inceledim ve senin için dengeli bir silüet oluşturdum.'
        : 'Here is a balanced silhouette created from your wardrobe.';
    let previewUrl = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=900&q=90';
    let garmentIds = ['g_black_blazer', 'g_white_tee', 'g_beige_pants'];
    let lookTitle = lang === 'tr' ? 'Kişisel Stil Seçkisi' : 'Effortless Tailoring';

    // Try backend API first (Gemini 2.5 Flash)
    let apiSucceeded = false;
    try {
      const response = await fetch('/api/stylist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text, wardrobe, lang }),
      });
      if (response.ok) {
        const json = await response.json();
        if (json.success && json.data) {
          replyText = json.data.text;
          lookTitle = json.data.lookTitle;
          if (Array.isArray(json.data.garmentIds) && json.data.garmentIds.length > 0) {
            garmentIds = json.data.garmentIds;
          }
          apiSucceeded = true;
        }
      }
    } catch (e) {
      console.warn('API stylist fallback to intelligent matching', e);
    }

    if (!apiSucceeded) {
      const lower = text.toLowerCase();

      // Check Pub / Bar / Night out
      if (
        lower.includes('pub') ||
        lower.includes('bar') ||
        lower.includes('gece') ||
        lower.includes('bira') ||
        lower.includes('içki') ||
        lower.includes('night') ||
        lower.includes('konser')
      ) {
        const leatherPiece =
          wardrobe.find(
            (g) =>
              (g.occasions && g.occasions.includes('pub')) ||
              g.id === 'g_leather_jacket' ||
              (g.styleTags && g.styleTags.includes('Biker'))
          ) || wardrobe.find((g) => g.category === 'outerwear');

        const denimPiece =
          wardrobe.find((g) => g.id === 'g_blue_jeans' || g.category === 'bottom') || wardrobe[1];
        const teePiece =
          wardrobe.find((g) => g.id === 'g_white_tee' || g.category === 'top') || wardrobe[2];
        const shoesPiece = wardrobe.find((g) => g.category === 'shoes');

        garmentIds = [leatherPiece?.id, denimPiece?.id, teePiece?.id, shoesPiece?.id].filter(
          Boolean
        ) as string[];

        previewUrl =
          'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?auto=format&fit=crop&w=1000&q=90';
        lookTitle = lang === 'tr' ? 'Akşam Pub & Biker Stili' : 'Pub & Night Out Biker';
        replyText =
          lang === 'tr'
            ? `Akşam pub için harika bir seçim! ${leatherPiece?.name || 'Deri biker ceketi'}, ${denimPiece?.name || 'düz kesim denim'} ve ${teePiece?.name || 'beyaz tişört'} ile eşleştirdim. Bu kombin pub ortamının rahat ve salaş havasına tam uyum sağlarken çok karizmatik duruyor.`
            : `Ideal for a pub evening! I paired your ${leatherPiece?.name || 'Leather Biker Jacket'} with ${denimPiece?.name || 'straight denim'} and ${teePiece?.name || 'classic tee'}. Effortlessly cool and perfectly calibrated for the pub atmosphere.`;
      } else if (
        lower.includes('coffee') ||
        lower.includes('kahve') ||
        lower.includes('casual') ||
        lower.includes('günlük') ||
        lower.includes('weekend') ||
        lower.includes('hafta sonu')
      ) {
        replyText =
          lang === 'tr'
            ? 'Rahat ve zahmetsiz bir stil. Çizgili trikonu düz paça denim ve spor ayakkabılarla birleştirdim.'
            : 'Keep it relaxed. Your Breton knit with straight-leg denim and low sneakers gives effortless ease.';
        previewUrl =
          'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=900&q=90';
        garmentIds = ['g_striped_sweater', 'g_blue_jeans', 'g_white_sneakers'];
        lookTitle = lang === 'tr' ? 'Hafta Sonu Kahve Şıklığı' : 'Sunday Coffee Edit';
      } else if (
        lower.includes('dinner') ||
        lower.includes('akşam yemeği') ||
        lower.includes('date') ||
        lower.includes('randevu') ||
        lower.includes('romantik')
      ) {
        replyText =
          lang === 'tr'
            ? 'Zarif ve sade bir lüks. İpek slip elbiseni siyah blazer ve deri çantanla tamamladım.'
            : 'Understated elegance. Layer your oversized black blazer over the silk slip dress with the trapeze tote.';
        previewUrl =
          'https://images.unsplash.com/photo-1502823403499-6ccfcf4fb453?auto=format&fit=crop&w=900&q=90';
        garmentIds = ['g_slip_dress', 'g_black_blazer', 'g_leather_tote'];
        lookTitle = lang === 'tr' ? 'Akşam Randevusu & İpek Elbise' : 'Noir Evening Slip';
      } else if (
        lower.includes('work') ||
        lower.includes('ofis') ||
        lower.includes('iş') ||
        lower.includes('office') ||
        lower.includes('toplantı')
      ) {
        replyText =
          lang === 'tr'
            ? 'Keskin ve net bir duruş. Pileli bej pantolonu yapılandırılmış blazer ceket ve minimal gözlüklerle birleştirdim.'
            : 'Sharp and intentional. Pleated sand trousers paired with the structured blazer and minimal eyewear.';
        previewUrl =
          'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=900&q=90';
        garmentIds = ['g_black_blazer', 'g_beige_pants', 'g_sunglasses'];
        lookTitle = lang === 'tr' ? 'Ofis & Mimari Terzilik' : 'Architectural Tailoring';
      }
    }

    const aiMsg: StylistMessage = {
      id: `msg_${Date.now() + 1}`,
      sender: 'mirobe',
      text: replyText,
      outfitPreviewUrl: previewUrl,
      garmentIds,
      lookTitle,
      createdAt: new Date(Date.now() + 100).toISOString(),
    };

    const updated = [...messages, userMsg, aiMsg];
    this.setLocal(STORAGE_KEY_MESSAGES, updated);
    return aiMsg;
  }
}

export const api = new MirobeApiClient();
