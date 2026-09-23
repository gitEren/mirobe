/**
 * The Mirobe mark: a full-length arched mirror hanging from a hanger hook
 * (mirror + robe), with Jev's sparkle caught in the glass.
 *
 * Pure geometry so the app (react-native-svg) and `scripts/brand-assets.mjs`
 * (icon and splash PNGs) draw exactly the same shape.
 */

/** Four-point sparkle with concave sides, the same motif as the app's AI icons. */
function sparkle(cx: number, cy: number, r: number) {
  const k = r * 0.16;
  return [
    `M${cx} ${cy - r}`,
    `Q${cx + k} ${cy - k} ${cx + r} ${cy}`,
    `Q${cx + k} ${cy + k} ${cx} ${cy + r}`,
    `Q${cx - k} ${cy + k} ${cx - r} ${cy}`,
    `Q${cx - k} ${cy - k} ${cx} ${cy - r}Z`,
  ].join('');
}

const OUTER = { left: 40, right: 160, archY: 130, bottom: 288 };
const INNER = { left: 53, right: 147, archY: 130, bottom: 275 };
const arch = (a: typeof OUTER) => `M${a.left} ${a.bottom}V${a.archY}A${(a.right - a.left) / 2} ${(a.right - a.left) / 2} 0 0 1 ${a.right} ${a.archY}V${a.bottom}Z`;

export const MARK = {
  /** Tight box around the drawing (strokes included). */
  viewBox: { x: 30, y: 20, width: 140, height: 278 },
  stroke: 9,
  innerStroke: 3.25,
  frame: arch(OUTER),
  glassEdge: arch(INNER),
  hook: 'M100 70V50C100 38 108 30 118 30C128 30 134 37 134 45C134 51 131 55 126 57',
  sparkles: {
    large: { cx: 117, cy: 118, r: 18 },
    small: { cx: 99, cy: 145, r: 7 },
  },
  /** Inside of the glass edge, for clipping the splash shine. */
  glass: {
    left: INNER.left + 1.6,
    top: INNER.archY - (INNER.right - INNER.left) / 2 + 1.6,
    width: INNER.right - INNER.left - 3.2,
    bottom: INNER.bottom - 1.6,
  },
} as const;

export const sparklePath = (which: 'large' | 'small' | 'both') => {
  const { large, small } = MARK.sparkles;
  if (which === 'large') return sparkle(large.cx, large.cy, large.r);
  if (which === 'small') return sparkle(small.cx, small.cy, small.r);
  return sparkle(large.cx, large.cy, large.r) + sparkle(small.cx, small.cy, small.r);
};

/** Icon-size variant (tab bar): single frame, heavier stroke, one larger sparkle, so it holds up at ~24 pt. */
export const GLYPH = {
  stroke: 16,
  sparkle: sparkle(111, 129, 27),
} as const;

/** Width / height of the mark. */
export const MARK_RATIO = MARK.viewBox.width / MARK.viewBox.height;

export const BRAND = {
  ink: '#1A1918',
  ivory: '#FBF9F5',
  /** Antique gold that reads on ivory. */
  gold: '#B98E3E',
  /** Brighter gold for dark backgrounds (theme `gold`). */
  goldBright: '#FFD76A',
} as const;

/** The mark's SVG elements (no <svg> wrapper), in viewBox units. */
export function markElements(options: { ink: string; accent: string; sparkles?: boolean }) {
  return `<g fill="none" stroke="${options.ink}" stroke-linecap="round" stroke-linejoin="round">
    <path d="${MARK.frame}" stroke-width="${MARK.stroke}"/>
    <path d="${MARK.glassEdge}" stroke-width="${MARK.innerStroke}"/>
    <path d="${MARK.hook}" stroke-width="${MARK.stroke}"/>
  </g>${options.sparkles === false ? '' : `\n  <path d="${sparklePath('both')}" fill="${options.accent}"/>`}`;
}
