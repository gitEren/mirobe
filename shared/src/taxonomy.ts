// Controlled vocabulary for AI tagging. The vision model must pick from these
// lists so that Jev and the heuristic matcher compare like with like. The model
// may still propose extra free-form style tags; those are kept but namespaced.

export const GARMENT_CATEGORIES = ['top', 'bottom', 'outerwear', 'dress', 'shoes', 'accessory'] as const;
export type GarmentCategory = (typeof GARMENT_CATEGORIES)[number];

export const OCCASIONS = [
  'casual',
  'work',
  'formal',
  'date',
  'night_out',
  'party',
  'sport',
  'travel',
  'lounge',
  'beach',
  'wedding',
] as const;
export type Occasion = (typeof OCCASIONS)[number];

export const STYLE_TAGS = [
  'minimalist',
  'classic',
  'streetwear',
  'sporty',
  'bohemian',
  'edgy',
  'preppy',
  'romantic',
  'tailored',
  'oversized',
  'vintage',
  'workwear',
  'smart_casual',
  'athleisure',
  'elegant',
  'y2k',
] as const;
export type StyleTag = (typeof STYLE_TAGS)[number];

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type Season = (typeof SEASONS)[number];

export const PATTERNS = [
  'solid',
  'striped',
  'checked',
  'floral',
  'graphic',
  'logo',
  'animal',
  'polka_dot',
  'camouflage',
  'abstract',
  'textured',
] as const;
export type Pattern = (typeof PATTERNS)[number];

export const TAXONOMY_LABELS: Record<'tr' | 'en', Record<string, string>> = {
  tr: {
    top: 'Üst Giyim',
    bottom: 'Alt Giyim',
    outerwear: 'Dış Giyim',
    dress: 'Elbise',
    shoes: 'Ayakkabı',
    accessory: 'Aksesuar',
    casual: 'Günlük',
    work: 'İş / Ofis',
    formal: 'Resmi',
    date: 'Randevu',
    night_out: 'Gece / Pub',
    party: 'Parti',
    sport: 'Spor',
    travel: 'Seyahat',
    lounge: 'Ev',
    beach: 'Plaj',
    wedding: 'Düğün',
    minimalist: 'Minimalist',
    classic: 'Klasik',
    streetwear: 'Sokak',
    sporty: 'Sportif',
    bohemian: 'Bohem',
    edgy: 'Asi',
    preppy: 'Preppy',
    romantic: 'Romantik',
    tailored: 'Terzi İşi',
    oversized: 'Oversize',
    vintage: 'Vintage',
    workwear: 'Workwear',
    smart_casual: 'Smart Casual',
    athleisure: 'Athleisure',
    elegant: 'Zarif',
    y2k: 'Y2K',
    spring: 'İlkbahar',
    summer: 'Yaz',
    autumn: 'Sonbahar',
    winter: 'Kış',
    solid: 'Düz',
    striped: 'Çizgili',
    checked: 'Kareli',
    floral: 'Çiçekli',
    graphic: 'Baskılı',
    logo: 'Logolu',
    animal: 'Hayvan Deseni',
    polka_dot: 'Puantiyeli',
    camouflage: 'Kamuflaj',
    abstract: 'Soyut',
    textured: 'Dokulu',
  },
  en: {
    top: 'Tops',
    bottom: 'Bottoms',
    outerwear: 'Outerwear',
    dress: 'Dresses',
    shoes: 'Shoes',
    accessory: 'Accessories',
    casual: 'Casual',
    work: 'Work',
    formal: 'Formal',
    date: 'Date',
    night_out: 'Night out',
    party: 'Party',
    sport: 'Sport',
    travel: 'Travel',
    lounge: 'Lounge',
    beach: 'Beach',
    wedding: 'Wedding',
    minimalist: 'Minimalist',
    classic: 'Classic',
    streetwear: 'Streetwear',
    sporty: 'Sporty',
    bohemian: 'Bohemian',
    edgy: 'Edgy',
    preppy: 'Preppy',
    romantic: 'Romantic',
    tailored: 'Tailored',
    oversized: 'Oversized',
    vintage: 'Vintage',
    workwear: 'Workwear',
    smart_casual: 'Smart casual',
    athleisure: 'Athleisure',
    elegant: 'Elegant',
    y2k: 'Y2K',
    spring: 'Spring',
    summer: 'Summer',
    autumn: 'Autumn',
    winter: 'Winter',
    solid: 'Solid',
    striped: 'Striped',
    checked: 'Checked',
    floral: 'Floral',
    graphic: 'Graphic',
    logo: 'Logo',
    animal: 'Animal print',
    polka_dot: 'Polka dot',
    camouflage: 'Camouflage',
    abstract: 'Abstract',
    textured: 'Textured',
  },
};

export function labelFor(key: string, lang: 'tr' | 'en'): string {
  return TAXONOMY_LABELS[lang][key] ?? key.replace(/_/g, ' ');
}

/** Outfit slots Jev fills. A dress replaces top + bottom. */
export const OUTFIT_SLOTS = ['top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory'] as const;
export type OutfitSlot = (typeof OUTFIT_SLOTS)[number];
