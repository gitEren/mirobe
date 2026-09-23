// Nearest-name lookup so a bare hex from the vision model still gets a
// human colour name, and colour words in stylist requests can be matched.
const PALETTE: { hex: string; tr: string; en: string }[] = [
  { hex: '#000000', tr: 'Siyah', en: 'Black' },
  { hex: '#FFFFFF', tr: 'Beyaz', en: 'White' },
  { hex: '#F5F0E6', tr: 'Krem', en: 'Cream' },
  { hex: '#D8C8A8', tr: 'Bej', en: 'Beige' },
  { hex: '#C2B280', tr: 'Kum', en: 'Sand' },
  { hex: '#8B8680', tr: 'Gri', en: 'Grey' },
  { hex: '#4A4A4A', tr: 'Antrasit', en: 'Charcoal' },
  { hex: '#1F2A44', tr: 'Lacivert', en: 'Navy' },
  { hex: '#2F5DA8', tr: 'Mavi', en: 'Blue' },
  { hex: '#8DB3D9', tr: 'Açık Mavi', en: 'Light blue' },
  { hex: '#3C5A78', tr: 'Denim Mavi', en: 'Denim blue' },
  { hex: '#2E6B4F', tr: 'Yeşil', en: 'Green' },
  { hex: '#6B7A3A', tr: 'Haki', en: 'Khaki' },
  { hex: '#8A9A5B', tr: 'Zeytin Yeşili', en: 'Olive' },
  { hex: '#C0392B', tr: 'Kırmızı', en: 'Red' },
  { hex: '#7B1E2B', tr: 'Bordo', en: 'Burgundy' },
  { hex: '#E8A0B0', tr: 'Pembe', en: 'Pink' },
  { hex: '#8E5BA8', tr: 'Mor', en: 'Purple' },
  { hex: '#E67E22', tr: 'Turuncu', en: 'Orange' },
  { hex: '#C4704F', tr: 'Kiremit', en: 'Terracotta' },
  { hex: '#F1C40F', tr: 'Sarı', en: 'Yellow' },
  { hex: '#C9A227', tr: 'Hardal', en: 'Mustard' },
  { hex: '#6F4E37', tr: 'Kahverengi', en: 'Brown' },
  { hex: '#A0785A', tr: 'Taba', en: 'Tan' },
  { hex: '#B8B8B8', tr: 'Gümüş', en: 'Silver' },
  { hex: '#D4AF37', tr: 'Altın', en: 'Gold' },
];

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

export function normalizeHex(value: string): string | null {
  const match = value.match(/#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/);
  if (!match) return null;
  const digits = match[1].length === 3 ? [...match[1]].map((d) => d + d).join('') : match[1];
  return `#${digits.toUpperCase()}`;
}

export function nearestColorName(hex: string, lang: 'tr' | 'en'): string {
  const [r, g, b] = rgb(hex);
  let best = PALETTE[0];
  let bestDistance = Infinity;
  for (const entry of PALETTE) {
    const [pr, pg, pb] = rgb(entry.hex);
    // Weighted RGB distance, close enough to perceptual for naming.
    const distance = 2 * (r - pr) ** 2 + 4 * (g - pg) ** 2 + 3 * (b - pb) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = entry;
    }
  }
  return best[lang];
}
