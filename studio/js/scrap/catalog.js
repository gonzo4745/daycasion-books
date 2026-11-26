// ScrapCasion design catalog: page geometry, fonts, colours, background patterns, frames and shapes. Shared,
// unchanged, by ScrapCasion Studio (the editor, in the browser) and the book worker (print rendering), so a design
// means the same thing everywhere. Pure data and pure functions (no DOM, no Node APIs).

// Geometry in points (72 per inch). Interior pages: 8 x 10 in trim + 0.125 in bleed (RPI 8 x 10 ImageWrap hardcover,
// as Keepsakes). The cover is the front panel of RPI's cover template: 8.25 x 10.25 in board area, 0.75 in wrap
// around the board's top, bottom and outer edge, 0.5 in hinge at the spine.
export const INTERIOR = { trimW: 576, trimH: 720, bleed: 9, safe: 27, gutter: 45 };
export const COVER = { trimW: 594, trimH: 738, wrap: 54, hinge: 36, safe: 36 };

/** The page box: trim size, bleed on each side, safe margins on each side (pt). `index`: interior page number
 *  (1 = the first page after the cover, a right-hand page; odd pages have the binding on the left). */
export function pageBox(kind, index = 1) {
  if (kind === 'cover') {
    const { trimW, trimH, wrap, hinge, safe } = COVER;
    return { kind, trimW, trimH, bleed: { t: wrap, r: wrap, b: wrap, l: 0 }, safe: { t: safe, r: safe, b: safe, l: hinge },
      outW: trimW + wrap, outH: trimH + 2 * wrap };
  }
  const { trimW, trimH, bleed, safe, gutter } = INTERIOR;
  const right = index % 2 === 1; // recto: the binding is on its left
  return { kind, trimW, trimH, bleed: { t: bleed, r: bleed, b: bleed, l: bleed },
    safe: { t: safe, b: safe, l: right ? gutter : safe, r: right ? safe : gutter }, outW: trimW + 2 * bleed, outH: trimH + 2 * bleed };
}

// Fonts: SIL Open Font License (OFL 1.1) families from Google Fonts / Fontsource; files in assets/scrap/fonts.
export const FONTS = [
  { key: 'dmsans', family: 'DM Sans', label: 'DM Sans', group: 'Clean', weights: [400, 700], italic: true },
  { key: 'nunito', family: 'Nunito', label: 'Nunito', group: 'Clean', weights: [400, 700], italic: true },
  { key: 'montserrat', family: 'Montserrat', label: 'Montserrat', group: 'Clean', weights: [400, 700], italic: false },
  { key: 'lora', family: 'Lora', label: 'Lora', group: 'Classic', weights: [400, 700], italic: true },
  { key: 'playfair', family: 'Playfair Display', label: 'Playfair Display', group: 'Classic', weights: [400, 700], italic: true },
  { key: 'baskerville', family: 'Libre Baskerville', label: 'Libre Baskerville', group: 'Classic', weights: [400, 700], italic: true },
  { key: 'caveat', family: 'Caveat', label: 'Caveat', group: 'Handwritten', weights: [400, 700], italic: false },
  { key: 'patrick', family: 'Patrick Hand', label: 'Patrick Hand', group: 'Handwritten', weights: [400], italic: false },
  { key: 'shadows', family: 'Shadows Into Light', label: 'Shadows Into Light', group: 'Handwritten', weights: [400], italic: false },
  { key: 'amatic', family: 'Amatic SC', label: 'Amatic SC', group: 'Handwritten', weights: [400, 700], italic: false },
  { key: 'dancing', family: 'Dancing Script', label: 'Dancing Script', group: 'Script', weights: [400, 700], italic: false },
  { key: 'vibes', family: 'Great Vibes', label: 'Great Vibes', group: 'Script', weights: [400], italic: false },
  { key: 'pacifico', family: 'Pacifico', label: 'Pacifico', group: 'Fun', weights: [400], italic: false },
  { key: 'fredoka', family: 'Fredoka', label: 'Fredoka', group: 'Fun', weights: [400, 700], italic: false },
  { key: 'abril', family: 'Abril Fatface', label: 'Abril Fatface', group: 'Fun', weights: [400], italic: false },
];
export const FONT_KEYS = new Set(FONTS.map((f) => f.key));
export const fontOf = (key) => FONTS.find((f) => f.key === key) || FONTS[0];
/** The font files to load (one per weight/style), relative to the assets folder. */
export function fontFiles() {
  const out = [];
  for (const f of FONTS) for (const w of f.weights) for (const it of f.italic ? [false, true] : [false]) {
    out.push({ family: f.family, weight: w, style: it ? 'italic' : 'normal', file: `fonts/${f.key}-${w}${it ? 'i' : ''}.woff2` });
  }
  return out;
}

// Colour swatches offered in the editor (any #RRGGBB colour can be chosen too).
export const PALETTE = ['#FFFFFF', '#FBF7F0', '#F6EFE4', '#EFE3CF', '#E8D9C0', '#D9C3A0', '#C9A47A', '#8C6A48',
  '#FDE2E4', '#F9C6CF', '#F4898D', '#E05A63', '#B83A4B', '#7A2336', '#FFE8D6', '#FFC9A3', '#F7A55B', '#E07A2F',
  '#FFF4C7', '#FFE38A', '#F5C842', '#C99A1E', '#E6F4D9', '#BFE2A8', '#7FBF6A', '#4A8F4A', '#2E5E3A', '#DDF1F4',
  '#A9DCE3', '#5BB6C9', '#2C7DA0', '#1D4E6E', '#0A1640', '#E7E4F7', '#C7BEEB', '#9183D4', '#5E4FA2', '#3B2F6B',
  '#F1F1F1', '#D6D6D6', '#A3A3A3', '#6B6B6B', '#3A3A3A', '#1B1B1B'];

const HEX = /^#[0-9A-Fa-f]{6}$/;
export const color = (c, fallback = '#000000') => (typeof c === 'string' && HEX.test(c) ? c.toUpperCase() : fallback);

// Background patterns: drawn as SVG tiles (vector), coloured with the page's pattern colour on the page colour.
export const PATTERNS = [
  { key: 'dots', label: 'Polka dots', tile: 36 },
  { key: 'minidots', label: 'Tiny dots', tile: 14 },
  { key: 'stripes', label: 'Stripes', tile: 32 },
  { key: 'pinstripe', label: 'Pinstripes', tile: 16 },
  { key: 'gingham', label: 'Gingham', tile: 36 },
  { key: 'grid', label: 'Graph paper', tile: 18 },
  { key: 'lined', label: 'Lined paper', tile: 24 },
  { key: 'chevron', label: 'Chevron', tile: 40 },
  { key: 'hearts', label: 'Hearts', tile: 48 },
  { key: 'stars', label: 'Stars', tile: 54 },
  { key: 'confetti', label: 'Confetti', tile: 96 },
  { key: 'diamonds', label: 'Diamonds', tile: 36 },
  { key: 'waves', label: 'Waves', tile: 48 },
  { key: 'plaid', label: 'Plaid', tile: 72 },
  { key: 'floral', label: 'Little flowers', tile: 72 },
  { key: 'paws', label: 'Paw prints', tile: 84 },
  { key: 'snow', label: 'Snowflakes', tile: 80 },
  { key: 'balloons', label: 'Balloons', tile: 96 },
];
export const PATTERN_KEYS = new Set(PATTERNS.map((p) => p.key));
// Paper textures (photographic tiles, 300 ppi): assets/scrap/textures/<key>.jpg
export const TEXTURES = [
  { key: 'kraft', label: 'Kraft paper', tileIn: 4 },
  { key: 'linen', label: 'Linen', tileIn: 4 },
  { key: 'cardstock', label: 'Cardstock', tileIn: 4 },
  { key: 'watercolor-blue', label: 'Blue watercolour', tileIn: 0 },
  { key: 'watercolor-pink', label: 'Pink watercolour', tileIn: 0 },
  { key: 'watercolor-green', label: 'Green watercolour', tileIn: 0 },
  { key: 'chalkboard', label: 'Chalkboard', tileIn: 0 },
  { key: 'cork', label: 'Cork board', tileIn: 4 },
];
export const TEXTURE_KEYS = new Set(TEXTURES.map((t) => t.key));

const n = (v) => +(+v).toFixed(2);
/** An SVG tile (markup) for a pattern, `fg` on transparent (the page colour shows through). */
export function patternSvg(key, fg) {
  const p = PATTERNS.find((x) => x.key === key); if (!p) return null;
  const t = p.tile, c = color(fg, '#E05A63');
  const heart = (x, y, s) => `<path d="M${n(x)} ${n(y + s * 0.3)}c0-${n(s * 0.35)} ${n(-s * 0.5)}-${n(s * 0.35)} ${n(-s * 0.5)} 0c0 ${n(s * 0.3)} ${n(s * 0.5)} ${n(s * 0.5)} ${n(s * 0.5)} ${n(s * 0.7)}c0-${n(s * 0.2)} ${n(s * 0.5)}-${n(s * 0.4)} ${n(s * 0.5)}-${n(s * 0.7)}c0-${n(s * 0.35)}-${n(s * 0.5)}-${n(s * 0.35)}-${n(s * 0.5)} 0z" fill="${c}"/>`;
  const star = (cx, cy, r) => { let d = ''; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
    d += `${i ? 'L' : 'M'}${n(cx + rr * Math.cos(a))} ${n(cy + rr * Math.sin(a))}`; } return `<path d="${d}Z" fill="${c}"/>`; };
  const flower = (cx, cy, r) => [0, 72, 144, 216, 288].map((a) => `<circle cx="${n(cx + r * Math.cos((a * Math.PI) / 180))}" cy="${n(cy + r * Math.sin((a * Math.PI) / 180))}" r="${n(r * 0.75)}" fill="${c}" opacity=".85"/>`).join('') + `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 0.6)}" fill="#FFFFFF" opacity=".9"/>`;
  const paw = (cx, cy, s, rot) => `<g transform="translate(${n(cx)} ${n(cy)}) rotate(${rot})" fill="${c}"><ellipse cx="0" cy="${n(s * 0.35)}" rx="${n(s * 0.42)}" ry="${n(s * 0.34)}"/>` +
    [[-0.45, -0.15], [-0.17, -0.42], [0.17, -0.42], [0.45, -0.15]].map(([x, y]) => `<ellipse cx="${n(x * s)}" cy="${n(y * s)}" rx="${n(s * 0.15)}" ry="${n(s * 0.19)}"/>`).join('') + '</g>';
  const flake = (cx, cy, r) => `<g stroke="${c}" stroke-width="${n(r * 0.14)}" stroke-linecap="round">` + [0, 60, 120].map((a) => {
    const dx = r * Math.cos((a * Math.PI) / 180), dy = r * Math.sin((a * Math.PI) / 180);
    return `<line x1="${n(cx - dx)}" y1="${n(cy - dy)}" x2="${n(cx + dx)}" y2="${n(cy + dy)}"/>`; }).join('') + '</g>';
  const balloon = (cx, cy, s) => `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(s * 0.36)}" ry="${n(s * 0.45)}" fill="${c}"/><path d="M${n(cx)} ${n(cy + s * 0.45)}q${n(-s * 0.1)} ${n(s * 0.3)} 0 ${n(s * 0.6)}" stroke="${c}" stroke-width="1" fill="none"/>`;
  let body;
  switch (key) {
    case 'dots': body = `<circle cx="9" cy="9" r="5" fill="${c}"/><circle cx="27" cy="27" r="5" fill="${c}"/>`; break;
    case 'minidots': body = `<circle cx="7" cy="7" r="1.6" fill="${c}"/>`; break;
    case 'stripes': body = `<rect x="0" y="0" width="14" height="32" fill="${c}"/>`; break;
    case 'pinstripe': body = `<rect x="0" y="0" width="2" height="16" fill="${c}"/>`; break;
    case 'gingham': body = `<rect x="0" y="0" width="18" height="36" fill="${c}" opacity=".45"/><rect x="0" y="0" width="36" height="18" fill="${c}" opacity=".45"/>`; break;
    case 'grid': body = `<path d="M0 0H18M0 0V18" stroke="${c}" stroke-width=".7" fill="none"/>`; break;
    case 'lined': body = `<path d="M0 23.5H24" stroke="${c}" stroke-width=".8" fill="none"/>`; break;
    case 'chevron': body = `<path d="M0 30L20 10L40 30" stroke="${c}" stroke-width="7" fill="none"/>`; break;
    case 'hearts': body = heart(12, 10, 14) + heart(36, 34, 14); break;
    case 'stars': body = star(14, 14, 7) + star(41, 41, 5); break;
    case 'confetti': body = [[10, 12, 15, 'r'], [40, 30, -30, 'c'], [70, 14, 50, 'r'], [22, 60, 10, 'c'], [58, 70, -20, 'r'], [86, 50, 0, 'c'], [36, 86, 35, 'r'], [80, 88, 0, 'c']]
      .map(([x, y, r, s]) => (s === 'c' ? `<circle cx="${x}" cy="${y}" r="3" fill="${c}"/>` : `<rect x="${x - 5}" y="${y - 1.5}" width="10" height="3" rx="1.5" fill="${c}" transform="rotate(${r} ${x} ${y})"/>`)).join(''); break;
    case 'diamonds': body = `<path d="M18 4L32 18L18 32L4 18Z" fill="${c}" opacity=".55"/>`; break;
    case 'waves': body = `<path d="M0 24c12-12 12 12 24 0s12 12 24 0" stroke="${c}" stroke-width="3" fill="none"/>`; break;
    case 'plaid': body = `<rect x="0" y="0" width="24" height="72" fill="${c}" opacity=".35"/><rect x="0" y="0" width="72" height="24" fill="${c}" opacity=".35"/><rect x="46" y="0" width="3" height="72" fill="${c}" opacity=".6"/><rect x="0" y="46" width="72" height="3" fill="${c}" opacity=".6"/>`; break;
    case 'floral': body = flower(18, 18, 6) + flower(54, 54, 6); break;
    case 'paws': body = paw(20, 22, 16, -20) + paw(62, 62, 16, 20); break;
    case 'snow': body = flake(20, 20, 9) + flake(60, 60, 6); break;
    case 'balloons': body = balloon(24, 24, 24) + balloon(72, 66, 20); break;
    default: return null;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${t}" height="${t}" viewBox="0 0 ${t} ${t}">${body}</svg>`;
}

// Decorative photo frames (drawn around / over the photo, sized to it; never stretched images).
export const FRAMES = [
  { key: 'none', label: 'None' },
  { key: 'polaroid', label: 'Instant photo' },
  { key: 'mat', label: 'Mat' },
  { key: 'tape', label: 'Washi tape' },
  { key: 'stitched', label: 'Stitched' },
  { key: 'scallop', label: 'Scalloped' },
  { key: 'torn', label: 'Torn paper' },
  { key: 'film', label: 'Film strip' },
  { key: 'gold', label: 'Gold corners' },
  { key: 'circle', label: 'Circle' },
  { key: 'heart', label: 'Heart' },
  { key: 'stamp', label: 'Postage stamp' },
];
export const FRAME_KEYS = new Set(FRAMES.map((f) => f.key));

// Shapes and decorations (drawn to the element's size).
export const SHAPES = [
  { key: 'rect', label: 'Rectangle' }, { key: 'rounded', label: 'Rounded box' }, { key: 'ellipse', label: 'Circle' },
  { key: 'banner', label: 'Banner' }, { key: 'ribbon', label: 'Ribbon' }, { key: 'label', label: 'Label' },
  { key: 'tag', label: 'Gift tag' }, { key: 'badge', label: 'Scalloped badge' }, { key: 'star', label: 'Star' },
  { key: 'heart', label: 'Heart' }, { key: 'bubble', label: 'Speech bubble' }, { key: 'arrow', label: 'Arrow' },
  { key: 'line', label: 'Line' }, { key: 'dashes', label: 'Dashed line' }, { key: 'washi', label: 'Washi tape strip' },
];
export const SHAPE_KEYS = new Set(SHAPES.map((s) => s.key));

// Element defaults (what the editor adds).
export const DEFAULTS = {
  text: { font: 'dmsans', size: 18, color: '#1B1B1B', align: 'left', weight: 400, italic: false, lh: 1.25, ls: 0, valign: 'top' },
  shape: { fill: '#F4898D', stroke: '#FFFFFF', sw: 0 },
};

/** Deterministic pseudo-random numbers from a string (frame decorations look the same in the editor and in print). */
export function seeded(s) {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
}
