// ScrapCasion's one page renderer: a saved page design -> HTML/CSS in points. The Studio's editor canvas shows
// exactly this HTML (scaled, with its editing handles drawn in a separate layer above it), and the book worker prints
// exactly this HTML to PDF with Chromium; the website preview and the app's approval proof are images made FROM that
// PDF. There is no second renderer. Pure functions: no DOM, no Node APIs.
//
// Page data: { bg: { color, pattern, pc (pattern colour), ps (scale), po (opacity), texture },
//              els: [ { id, t: 'photo'|'text'|'sticker'|'shape', x, y, w, h (pt, from the trim's top-left corner;
//                       may reach into the bleed), r (degrees), o (opacity 0-1), ... } ] }  (array order = layer order)
//   photo:   src {k: 'm'|'u', id}, crop {s >= 1 zoom, cx, cy focal point 0-1}, bw (border pt), bc (border colour),
//            radius (pt), shadow (bool), frame (catalog key), fc (frame colour)
//   text:    text, font, size (pt), color, align, valign, weight, italic, lh (line height), ls (letter spacing, em),
//            bg (box colour), pad (pt), radius (pt)
//   sticker: s (sticker key), flip (bool)
//   shape:   s (shape key), fill, stroke, sw (stroke width pt), flip (bool)
import { pageBox, fontOf, color, patternSvg, PATTERN_KEYS, TEXTURES, TEXTURE_KEYS, FRAME_KEYS, SHAPE_KEYS, seeded, fontFiles } from './catalog.js?v=b8eddd3961';

export const RENDER_VERSION = 'scrap-1';
const num = (v, d = 0, lo = -10000, hi = 10000) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
const f3 = (v) => +(+v).toFixed(3);
const pt = (v) => `${f3(v)}pt`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PX = 96 / 72; // CSS px per pt
const KEY = /^[a-z0-9-]{1,40}$/;

/** Base CSS for rendered pages (fonts from `asset(path)`). */
export function baseCss(asset) {
  const faces = fontFiles().map((f) => `@font-face{font-family:"${f.family}";font-weight:${f.weight};font-style:${f.style};font-display:block;src:url("${asset(f.file)}") format("woff2")}`).join('\n');
  return `${faces}
.sc-page{position:relative;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact;font-kerning:normal;text-rendering:geometricPrecision}
.sc-bg,.sc-bgp{position:absolute;left:0;top:0;width:100%;height:100%}
.sc-el{position:absolute;box-sizing:border-box;transform-origin:50% 50%}
.sc-ph{position:absolute;overflow:hidden;box-sizing:border-box}
.sc-ph img,.sc-st img{position:absolute;display:block;max-width:none;user-select:none;-webkit-user-drag:none}
.sc-tx{position:absolute;left:0;top:0;width:100%;height:100%;box-sizing:border-box;display:flex;flex-direction:column;overflow:visible}
.sc-tx>div{white-space:pre-wrap;overflow-wrap:break-word;margin:0}
.sc-svg{position:absolute;overflow:visible}
.sc-empty{position:absolute;left:0;top:0;width:100%;height:100%;box-sizing:border-box;border:1.5pt dashed #9A8F80;background:rgba(246,239,228,.85);display:flex;align-items:center;justify-content:center;font:500 10pt "DM Sans",sans-serif;color:#6B6257;text-align:center}`;
}

/** Where the photo sits inside its box (pt, relative to the box): scaled to cover the box at zoom `s`, the focal
 *  point (cx, cy) centred as far as the edges allow. Shared by the renderer and the editor's crop tool. */
export function photoGeometry(boxW, boxH, aspect, crop = {}) {
  const a = aspect > 0 ? aspect : 1, s = num(crop.s, 1, 1, 8);
  let w, h;
  if (a > boxW / boxH) { h = boxH; w = boxH * a; } else { w = boxW; h = boxW / a; }
  w *= s; h *= s;
  const cx = num(crop.cx, 0.5, 0, 1), cy = num(crop.cy, 0.5, 0, 1);
  const left = Math.min(0, Math.max(boxW - w, boxW / 2 - cx * w)), top = Math.min(0, Math.max(boxH - h, boxH / 2 - cy * h));
  return { left, top, width: w, height: h };
}

/** The photo area inside an element (pt): frames leave a border around it. */
export function photoArea(el) {
  const w = num(el.w, 1, 1), h = num(el.h, 1, 1), s = Math.min(w, h);
  switch (el.frame) {
    case 'polaroid': { const p = s * 0.06; return { x: p, y: p, w: w - 2 * p, h: Math.max(1, h - p - s * 0.24) }; }
    case 'mat': { const p = s * 0.085; return { x: p, y: p, w: w - 2 * p, h: h - 2 * p }; }
    case 'scallop': { const p = s * 0.075; return { x: p, y: p, w: w - 2 * p, h: h - 2 * p }; }
    case 'torn': { const p = s * 0.055; return { x: p, y: p, w: w - 2 * p, h: h - 2 * p }; }
    case 'stamp': { const p = s * 0.1; return { x: p, y: p, w: w - 2 * p, h: h - 2 * p }; }
    case 'film': { const v = Math.max(10, h * 0.13), p = Math.max(4, s * 0.025); return { x: p, y: v, w: w - 2 * p, h: Math.max(1, h - 2 * v) }; }
    default: return { x: 0, y: 0, w, h };
  }
}

/** Which part of the source image the element shows (fractions 0-1), and the printed size of that part (in). */
export function visibleRegion(el, aspect) {
  const a = photoArea(el), bw = num(el.bw, 0, 0, 60);
  const iw = Math.max(1, a.w - 2 * bw), ih = Math.max(1, a.h - 2 * bw);
  const g = photoGeometry(iw, ih, aspect, el.crop);
  const x0 = -g.left / g.width, y0 = -g.top / g.height;
  return { x0, y0, x1: x0 + iw / g.width, y1: y0 + ih / g.height, printW: iw / 72, printH: ih / 72, fullW: g.width / 72, fullH: g.height / 72 };
}

function frameBacking(el, w, h) {
  const fc = color(el.fc, el.frame === 'film' ? '#1B1B1B' : el.frame === 'mat' ? '#FBF7F0' : '#FFFFFF'), s = Math.min(w, h);
  const svg = (body, extra = '') => `<svg class="sc-svg" style="left:0;top:0;width:${pt(w)};height:${pt(h)}${extra}" viewBox="0 0 ${f3(w)} ${f3(h)}" preserveAspectRatio="none">${body}</svg>`;
  const shadow = el.shadow ? ';filter:drop-shadow(0 1.5pt 3pt rgba(0,0,0,.3))' : '';
  switch (el.frame) {
    case 'polaroid': case 'mat': case 'film':
      return svg(`<rect x="0" y="0" width="${f3(w)}" height="${f3(h)}" fill="${fc}"/>`, shadow);
    case 'scallop': {
      const r = s * 0.04, nx = Math.max(3, Math.round(w / (2.2 * r))), ny = Math.max(3, Math.round(h / (2.2 * r)));
      const dx = w / nx, dy = h / ny, rr = r * 1.05;
      let c = `<rect x="${f3(r)}" y="${f3(r)}" width="${f3(w - 2 * r)}" height="${f3(h - 2 * r)}" fill="${fc}"/>`;
      for (let i = 0; i <= nx; i++) c += `<circle cx="${f3(i * dx)}" cy="${f3(r)}" r="${f3(rr)}" fill="${fc}"/><circle cx="${f3(i * dx)}" cy="${f3(h - r)}" r="${f3(rr)}" fill="${fc}"/>`;
      for (let j = 0; j <= ny; j++) c += `<circle cx="${f3(r)}" cy="${f3(j * dy)}" r="${f3(rr)}" fill="${fc}"/><circle cx="${f3(w - r)}" cy="${f3(j * dy)}" r="${f3(rr)}" fill="${fc}"/>`;
      return svg(c, shadow);
    }
    case 'torn': {
      const rnd = seeded(el.id), j = s * 0.022, pts = [], step = Math.max(6, s * 0.03);
      for (let x = 0; x < w; x += step) pts.push([x, rnd() * j]);
      for (let y = 0; y < h; y += step) pts.push([w - rnd() * j, y]);
      for (let x = w; x > 0; x -= step) pts.push([x, h - rnd() * j]);
      for (let y = h; y > 0; y -= step) pts.push([rnd() * j, y]);
      return svg(`<path d="M${pts.map(([x, y]) => `${f3(x)} ${f3(y)}`).join('L')}Z" fill="${fc}"/>`, shadow);
    }
    case 'stamp': {
      const r = s * 0.028, nx = Math.max(4, Math.round(w / (3.2 * r))), ny = Math.max(4, Math.round(h / (3.2 * r)));
      let d = `M0 0H${f3(w)}V${f3(h)}H0Z`;
      const hole = (cx, cy) => { d += `M${f3(cx - r)} ${f3(cy)}a${f3(r)} ${f3(r)} 0 1 0 ${f3(2 * r)} 0a${f3(r)} ${f3(r)} 0 1 0 ${f3(-2 * r)} 0Z`; };
      for (let i = 0; i <= nx; i++) { hole((i * w) / nx, 0); hole((i * w) / nx, h); }
      for (let k = 1; k < ny; k++) { hole(0, (k * h) / ny); hole(w, (k * h) / ny); }
      return svg(`<path d="${d}" fill="${fc}" fill-rule="evenodd"/>`, shadow);
    }
    default: return '';
  }
}

function frameOverlay(el, w, h, area) {
  const s = Math.min(w, h), fc = color(el.fc, el.frame === 'gold' ? '#C99A1E' : el.frame === 'tape' ? '#F4898D' : '#FFFFFF');
  const svg = (body, x = 0, y = 0, sw = w, sh = h) => `<svg class="sc-svg" style="left:${pt(x)};top:${pt(y)};width:${pt(sw)};height:${pt(sh)}" viewBox="0 0 ${f3(sw)} ${f3(sh)}">${body}</svg>`;
  switch (el.frame) {
    case 'stitched': { const i = Math.max(4, s * 0.035);
      return svg(`<rect x="${f3(i)}" y="${f3(i)}" width="${f3(w - 2 * i)}" height="${f3(h - 2 * i)}" rx="${f3(i * 0.6)}" fill="none" stroke="${fc}" stroke-width="${f3(Math.max(1, s * 0.008))}" stroke-dasharray="${f3(s * 0.03)} ${f3(s * 0.02)}" stroke-linecap="round"/>`); }
    case 'gold': { const c = Math.min(80, s * 0.2), i = Math.max(4, s * 0.03), lw = Math.max(0.8, s * 0.005);
      const corner = (tx, ty, sx, sy) => `<g transform="translate(${f3(tx)} ${f3(ty)}) scale(${sx} ${sy})" fill="none" stroke="${fc}" stroke-width="${f3(lw * 1.6)}" stroke-linecap="round">
<path d="M0 ${f3(c)}V0H${f3(c)}"/><path d="M${f3(c * 0.12)} ${f3(c * 0.7)}C${f3(c * 0.12)} ${f3(c * 0.3)} ${f3(c * 0.3)} ${f3(c * 0.12)} ${f3(c * 0.7)} ${f3(c * 0.12)}"/>
<circle cx="${f3(c * 0.22)}" cy="${f3(c * 0.22)}" r="${f3(c * 0.06)}" fill="${fc}" stroke="none"/></g>`;
      return svg(`<rect x="${f3(i)}" y="${f3(i)}" width="${f3(w - 2 * i)}" height="${f3(h - 2 * i)}" fill="none" stroke="${fc}" stroke-width="${f3(lw)}"/>`
        + corner(i, i, 1, 1) + corner(w - i, i, -1, 1) + corner(i, h - i, 1, -1) + corner(w - i, h - i, -1, -1)); }
    case 'tape': { const tw = Math.min(110, Math.max(36, w * 0.34)), th = Math.max(14, Math.min(30, s * 0.075));
      const strip = (cx, cy, rot) => `<g transform="translate(${f3(cx)} ${f3(cy)}) rotate(${rot})"><rect x="${f3(-tw / 2)}" y="${f3(-th / 2)}" width="${f3(tw)}" height="${f3(th)}" fill="${fc}" opacity=".78"/>`
        + `<path d="M${f3(-tw / 2)} ${f3(-th / 2)}v${f3(th)}M${f3(tw / 2)} ${f3(-th / 2)}v${f3(th)}" stroke="#FFFFFF" stroke-opacity=".5" stroke-width="1" stroke-dasharray="2 2"/>`
        + `<rect x="${f3(-tw / 2)}" y="${f3(-th * 0.12)}" width="${f3(tw)}" height="${f3(th * 0.24)}" fill="#FFFFFF" opacity=".25"/></g>`;
      return svg(strip(tw * 0.3, th * 0.2, -38) + strip(w - tw * 0.3, th * 0.2, 38)); }
    case 'film': { const v = area.y, hw = Math.max(3, v * 0.32), hh = Math.max(2.5, v * 0.36), gap = hw * 1.9; let c = '';
      for (let x = gap / 2; x < w - hw; x += gap) c += `<rect x="${f3(x)}" y="${f3((v - hh) / 2)}" width="${f3(hw)}" height="${f3(hh)}" rx="1" fill="#F6EFE4"/><rect x="${f3(x)}" y="${f3(h - v + (v - hh) / 2)}" width="${f3(hw)}" height="${f3(hh)}" rx="1" fill="#F6EFE4"/>`;
      return svg(c); }
    default: return '';
  }
}

function heartPath(w, h) {
  // a heart filling the box, in CSS px (clip-path path() uses the element's own px)
  const W = w * PX, H = h * PX;
  return `M${f3(W / 2)} ${f3(H * 0.98)}C${f3(W * 0.12)} ${f3(H * 0.7)} 0 ${f3(H * 0.45)} 0 ${f3(H * 0.28)}C0 ${f3(H * 0.1)} ${f3(W * 0.16)} 0 ${f3(W * 0.3)} 0C${f3(W * 0.41)} 0 ${f3(W * 0.48)} ${f3(H * 0.07)} ${f3(W / 2)} ${f3(H * 0.15)}C${f3(W * 0.52)} ${f3(H * 0.07)} ${f3(W * 0.59)} 0 ${f3(W * 0.7)} 0C${f3(W * 0.84)} 0 ${f3(W)} ${f3(H * 0.1)} ${f3(W)} ${f3(H * 0.28)}C${f3(W)} ${f3(H * 0.45)} ${f3(W * 0.88)} ${f3(H * 0.7)} ${f3(W / 2)} ${f3(H * 0.98)}Z`;
}

function photoHtml(el, w, h, ctx) {
  const area = photoArea(el), bw = num(el.bw, 0, 0, 60), bc = color(el.bc, '#FFFFFF');
  const round = el.frame === 'circle' ? '50%' : pt(num(el.radius, 0, 0, 400));
  const clip = el.frame === 'heart' ? `;clip-path:path('${heartPath(area.w, area.h)}')` : '';
  const framed = ['polaroid', 'mat', 'scallop', 'torn', 'stamp', 'film'].includes(el.frame);
  const shadow = el.shadow && !framed && el.frame !== 'heart' ? ';box-shadow:0 1.5pt 4pt rgba(0,0,0,.32)' : '';
  let inner;
  const m = el.src && ctx.media ? ctx.media(el.src, el) : null;
  if (!el.src) inner = ctx.editing ? '<div class="sc-empty">Drop a photo here</div>' : '';
  else if (!m || !m.url) inner = ctx.editing ? '<div class="sc-empty">This photo isn’t available</div>' : '';
  else {
    const iw = Math.max(1, area.w - 2 * bw), ih = Math.max(1, area.h - 2 * bw);
    const g = photoGeometry(iw, ih, m.aspect, el.crop);
    const rg = m.region || { x0: 0, y0: 0, x1: 1, y1: 1 };
    inner = `<img src="${esc(m.url)}" alt="" style="left:${pt(g.left + rg.x0 * g.width)};top:${pt(g.top + rg.y0 * g.height)};width:${pt((rg.x1 - rg.x0) * g.width)};height:${pt((rg.y1 - rg.y0) * g.height)}">`;
  }
  return frameBacking(el, w, h)
    + `<div class="sc-ph" style="left:${pt(area.x)};top:${pt(area.y)};width:${pt(area.w)};height:${pt(area.h)};border-radius:${round}${bw > 0 ? `;border:${pt(bw)} solid ${bc}` : ''}${shadow}${clip}">${inner}</div>`
    + frameOverlay(el, w, h, area);
}

function textHtml(el) {
  const f = fontOf(el.font), size = num(el.size, 18, 4, 400), weight = f.weights.includes(Number(el.weight)) ? Number(el.weight) : f.weights[0];
  const italic = el.italic && f.italic, align = ['left', 'center', 'right', 'justify'].includes(el.align) ? el.align : 'left';
  const va = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[el.valign] || 'flex-start';
  const bg = el.bg ? color(el.bg, '') : '', pad = num(el.pad, bg ? 6 : 0, 0, 100);
  return `<div class="sc-tx" data-tx="1" style="justify-content:${va};padding:${pt(pad)};${bg ? `background:${bg};` : ''}border-radius:${pt(num(el.radius, 0, 0, 200))};font-family:'${f.family}';font-size:${pt(size)};font-weight:${weight};font-style:${italic ? 'italic' : 'normal'};color:${color(el.color, '#1B1B1B')};text-align:${align};line-height:${f3(num(el.lh, 1.25, 0.6, 4))};letter-spacing:${f3(num(el.ls, 0, -0.2, 1))}em"><div>${esc(el.text ?? '')}</div></div>`;
}

function stickerHtml(el, ctx) {
  if (!KEY.test(String(el.s || ''))) return '';
  return `<div class="sc-st" style="position:absolute;left:0;top:0;width:100%;height:100%"><img src="${esc(ctx.asset(`stickers/${el.s}.svg`))}" alt="" style="left:0;top:0;width:100%;height:100%;object-fit:contain${el.flip ? ';transform:scaleX(-1)' : ''}"></div>`;
}

/** Shape paths drawn to w x h (pt). */
export function shapeSvg(key, w, h, { fill, stroke, sw }) {
  const F = color(fill, '#F4898D'), S = color(stroke, '#FFFFFF'), SW = num(sw, 0, 0, 40), hs = SW / 2;
  const paint = `fill="${F}"${SW > 0 ? ` stroke="${S}" stroke-width="${f3(SW)}" stroke-linejoin="round"` : ''}`;
  let body;
  switch (key) {
    case 'rect': body = `<rect x="${f3(hs)}" y="${f3(hs)}" width="${f3(w - SW)}" height="${f3(h - SW)}" ${paint}/>`; break;
    case 'rounded': body = `<rect x="${f3(hs)}" y="${f3(hs)}" width="${f3(w - SW)}" height="${f3(h - SW)}" rx="${f3(Math.min(w, h) * 0.18)}" ${paint}/>`; break;
    case 'ellipse': body = `<ellipse cx="${f3(w / 2)}" cy="${f3(h / 2)}" rx="${f3(w / 2 - hs)}" ry="${f3(h / 2 - hs)}" ${paint}/>`; break;
    case 'banner': { const n = Math.min(h * 0.45, w * 0.12);
      body = `<path d="M${f3(hs)} ${f3(hs)}H${f3(w - hs)}L${f3(w - n)} ${f3(h / 2)}L${f3(w - hs)} ${f3(h - hs)}H${f3(hs)}L${f3(n)} ${f3(h / 2)}Z" ${paint}/>`; break; }
    case 'ribbon': { const n = Math.min(h * 0.5, w * 0.1), t = h * 0.22;
      body = `<path d="M${f3(n * 0.6)} ${f3(t)}H0L${f3(n * 0.7)} ${f3((h + t) / 2)}L0 ${f3(h)}H${f3(n * 1.6)}V${f3(t)}Z" fill="${F}" opacity=".75"/>`
        + `<path d="M${f3(w - n * 0.6)} ${f3(t)}H${f3(w)}L${f3(w - n * 0.7)} ${f3((h + t) / 2)}L${f3(w)} ${f3(h)}H${f3(w - n * 1.6)}V${f3(t)}Z" fill="${F}" opacity=".75"/>`
        + `<rect x="${f3(n)}" y="0" width="${f3(w - 2 * n)}" height="${f3(h - t)}" ${paint}/>`; break; }
    case 'label': { const n = Math.min(h / 2, w * 0.2);
      body = `<path d="M${f3(n)} ${f3(hs)}H${f3(w - n)}A${f3(n)} ${f3(h / 2 - hs)} 0 0 1 ${f3(w - n)} ${f3(h - hs)}H${f3(n)}A${f3(n)} ${f3(h / 2 - hs)} 0 0 1 ${f3(n)} ${f3(hs)}Z" ${paint}/>`; break; }
    case 'tag': { const n = Math.min(h * 0.5, w * 0.25), r = Math.min(h, w) * 0.07;
      body = `<path d="M${f3(n)} ${f3(hs)}H${f3(w - hs)}V${f3(h - hs)}H${f3(n)}L${f3(hs)} ${f3(h / 2)}Z" ${paint}/><circle cx="${f3(n * 0.75)}" cy="${f3(h / 2)}" r="${f3(r)}" fill="#FFFFFF"/>`; break; }
    case 'badge': { const k = 16, R = Math.min(w, h) / 2, cx = w / 2, cy = h / 2; let d = '';
      for (let i = 0; i < k; i++) { const a0 = (i / k) * 2 * Math.PI, a1 = ((i + 1) / k) * 2 * Math.PI, am = (a0 + a1) / 2;
        const p0 = [cx + R * 0.88 * Math.cos(a0) * (w / (2 * R)), cy + R * 0.88 * Math.sin(a0) * (h / (2 * R))];
        const p1 = [cx + R * 0.88 * Math.cos(a1) * (w / (2 * R)), cy + R * 0.88 * Math.sin(a1) * (h / (2 * R))];
        const pm = [cx + R * 1.06 * Math.cos(am) * (w / (2 * R)), cy + R * 1.06 * Math.sin(am) * (h / (2 * R))];
        d += `${i ? '' : `M${f3(p0[0])} ${f3(p0[1])}`}Q${f3(pm[0])} ${f3(pm[1])} ${f3(p1[0])} ${f3(p1[1])}`; }
      body = `<path d="${d}Z" ${paint}/>`; break; }
    case 'star': { let d = ''; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? 0.42 : 1;
        d += `${i ? 'L' : 'M'}${f3(w / 2 + (w / 2 - hs) * rr * Math.cos(a))} ${f3(h * 0.53 + (h / 2 - hs) * rr * Math.sin(a))}`; }
      body = `<path d="${d}Z" ${paint}/>`; break; }
    case 'heart': body = `<path d="${heartPath(w, h).replace(/-?[\d.]+/g, (v) => f3(Number(v) / PX))}" ${paint}/>`; break;
    case 'bubble': { const r = Math.min(w, h) * 0.2, bh = h * 0.78;
      body = `<path d="M${f3(r)} ${f3(hs)}H${f3(w - r)}Q${f3(w - hs)} ${f3(hs)} ${f3(w - hs)} ${f3(r)}V${f3(bh - r)}Q${f3(w - hs)} ${f3(bh)} ${f3(w - r)} ${f3(bh)}H${f3(w * 0.42)}L${f3(w * 0.24)} ${f3(h - hs)}L${f3(w * 0.28)} ${f3(bh)}H${f3(r)}Q${f3(hs)} ${f3(bh)} ${f3(hs)} ${f3(bh - r)}V${f3(r)}Q${f3(hs)} ${f3(hs)} ${f3(r)} ${f3(hs)}Z" ${paint}/>`; break; }
    case 'arrow': { const t = h * 0.32, head = Math.min(w * 0.4, h);
      body = `<path d="M${f3(hs)} ${f3(h / 2 - t / 2)}H${f3(w - head)}V${f3(hs)}L${f3(w - hs)} ${f3(h / 2)}L${f3(w - head)} ${f3(h - hs)}V${f3(h / 2 + t / 2)}H${f3(hs)}Z" ${paint}/>`; break; }
    case 'line': body = `<line x1="0" y1="${f3(h / 2)}" x2="${f3(w)}" y2="${f3(h / 2)}" stroke="${F}" stroke-width="${f3(Math.max(0.5, Math.min(h, 12)))}" stroke-linecap="round"/>`; break;
    case 'dashes': body = `<line x1="0" y1="${f3(h / 2)}" x2="${f3(w)}" y2="${f3(h / 2)}" stroke="${F}" stroke-width="${f3(Math.max(0.5, Math.min(h, 8)))}" stroke-dasharray="${f3(Math.max(2, h * 2.2))} ${f3(Math.max(2, h * 1.6))}" stroke-linecap="round"/>`; break;
    case 'washi': { const z = Math.min(6, h * 0.25); let d = `M0 0`;
      for (let y = 0; y < h; y += z) d += `L${f3(y / z % 2 ? z * 0.6 : 0)} ${f3(Math.min(h, y + z))}`;
      d += `H${f3(w)}`; for (let y = h; y > 0; y -= z) d += `L${f3(w - ((h - y) / z % 2 ? z * 0.6 : 0))} ${f3(Math.max(0, y - z))}`;
      body = `<path d="${d}Z" fill="${F}" opacity=".8"/><path d="M0 ${f3(h * 0.5)}H${f3(w)}" stroke="#FFFFFF" stroke-opacity=".35" stroke-width="${f3(h * 0.18)}" stroke-dasharray="${f3(h * 0.5)} ${f3(h * 0.4)}"/>`; break; }
    default: return '';
  }
  return body;
}

function shapeHtml(el, w, h) {
  if (!SHAPE_KEYS.has(el.s)) return '';
  return `<svg class="sc-svg" style="left:0;top:0;width:${pt(w)};height:${pt(h)}${el.flip ? ';transform:scaleX(-1)' : ''}" viewBox="0 0 ${f3(w)} ${f3(h)}" preserveAspectRatio="none">${shapeSvg(el.s, w, h, el)}</svg>`;
}

/** One element's HTML (absolutely placed; `ox`, `oy`: the trim corner's offset in the page = the left/top bleed). */
export function elementHtml(el, ctx, ox, oy) {
  if (!el || typeof el !== 'object') return '';
  const w = num(el.w, 10, 1, 3000), h = num(el.h, 10, 1, 3000), x = num(el.x, 0, -3000, 3000), y = num(el.y, 0, -3000, 3000);
  const r = num(el.r, 0, -360, 360), o = num(el.o, 1, 0, 1);
  let inner;
  switch (el.t) {
    case 'photo': inner = photoHtml(el, w, h, ctx); break;
    case 'text': inner = textHtml(el); break;
    case 'sticker': inner = stickerHtml(el, ctx); break;
    case 'shape': inner = shapeHtml(el, w, h); break;
    default: return '';
  }
  const id = /^[A-Za-z0-9_-]{1,40}$/.test(String(el.id || '')) ? ` data-id="${el.id}"` : '';
  return `<div class="sc-el sc-${el.t}"${id} style="left:${pt(x + ox)};top:${pt(y + oy)};width:${pt(w)};height:${pt(h)}${r ? `;transform:rotate(${f3(r)}deg)` : ''}${o < 1 ? `;opacity:${f3(o)}` : ''}">${inner}</div>`;
}

/** The page background layers. */
export function backgroundHtml(bg = {}, ctx, box) {
  const c = color(bg.color, '#FFFFFF');
  let html = `<div class="sc-bg" style="background:${c}"></div>`;
  if (bg.texture && TEXTURE_KEYS.has(bg.texture)) {
    const t = TEXTURES.find((x) => x.key === bg.texture);
    const size = t.tileIn ? `${pt(t.tileIn * 72 * num(bg.ps, 1, 0.25, 4))} ${pt(t.tileIn * 72 * num(bg.ps, 1, 0.25, 4))}` : 'cover';
    html += `<div class="sc-bgp" style="background-image:url('${esc(ctx.asset(`textures/${bg.texture}.jpg`))}');background-size:${size};background-position:center;background-repeat:${t.tileIn ? 'repeat' : 'no-repeat'}${bg.po != null ? `;opacity:${f3(num(bg.po, 1, 0, 1))}` : ''}"></div>`;
  }
  if (bg.pattern && PATTERN_KEYS.has(bg.pattern)) {
    const svg = patternSvg(bg.pattern, bg.pc);
    const tile = Number(svg.match(/width="(\d+)"/)[1]) * num(bg.ps, 1, 0.25, 4);
    // patterns line up with the trim corner, so facing pages and the cover read the same
    html += `<div class="sc-bgp" style="background-image:url(&quot;data:image/svg+xml;utf8,${encodeURIComponent(svg)}&quot;);background-size:${pt(tile)} ${pt(tile)};background-position:${pt(box.bleed.l)} ${pt(box.bleed.t)};opacity:${f3(num(bg.po, 0.6, 0, 1))}"></div>`;
  }
  return html;
}

/** A whole page: { kind: 'cover'|'page', data }, page number (interior), resolvers. Returns { html, box }. */
export function renderPage(page, { index = 1, media, asset, editing = false } = {}) {
  const kind = page?.kind === 'cover' ? 'cover' : 'page';
  const box = pageBox(kind, index), data = page?.data || {}, ctx = { media, asset, editing };
  const els = Array.isArray(data.els) ? data.els : [];
  const html = `<div class="sc-page" data-kind="${kind}" style="width:${pt(box.outW)};height:${pt(box.outH)}">${backgroundHtml(data.bg, ctx, box)}${els.map((e) => elementHtml(e, ctx, box.bleed.l, box.bleed.t)).join('')}</div>`;
  return { html, box };
}

/** Photo elements of a page, with where they print (for print preparation and resolution checks). */
export function photosOf(page) {
  return (page?.data?.els || []).filter((e) => e && e.t === 'photo' && e.src && typeof e.src === 'object');
}
export const refKey = (src) => `${src.k}:${src.id}`;
export { FRAME_KEYS };
