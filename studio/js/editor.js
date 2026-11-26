// ScrapCasion Studio editor. The page on the canvas is the renderer's HTML (scene.mjs, the same code the book worker
// prints), scaled; selection handles, guides and the crop view are drawn in a separate layer above it and never print.
import { h, btn, icon, toast, dialog, confirmDialog, morph, htmlNode, uuid, shortId, money } from './ui.js?v=b8eddd3961';
import { rpc, signed, linkOf, upload, removeFiles } from './api.js?v=b8eddd3961';
import { Doc } from './doc.js?v=b8eddd3961';
import { ASSET, loadTemplates, miniPage, promptText, state } from './app.js?v=b8eddd3961';
import { renderPage, photoGeometry, photoArea, shapeSvg, elementHtml } from './scrap/scene.js?v=b8eddd3961';
import { pageBox, FONTS, PALETTE, PATTERNS, TEXTURES, FRAMES, SHAPES, DEFAULTS, patternSvg, fontOf, color as hex } from './scrap/catalog.js?v=b8eddd3961';
import { libraryPanel } from './library.js?v=b8eddd3961';

const PX = 96 / 72;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r2 = (v) => Math.round(v * 100) / 100;

export async function editorView(projectId, $app) {
  $app.replaceChildren(h('div', { class: 'sc-center' }, h('div', { class: 'sc-spinner' })));
  let project, templates, stickers;
  try {
    [project, templates, stickers] = await Promise.all([rpc('dc_scrap_project_get', { p_project_id: projectId }), loadTemplates(), fetch(ASSET('stickers.json')).then((r) => r.json())]);
  } catch (e) {
    $app.replaceChildren(h('div', { class: 'sc-center' }, h('div', { class: 'sc-card sc-narrow' }, h('p', { class: 'sc-error' }, e.message), btn('Back to my scrapbooks', () => { location.hash = '#/'; }, { kind: 'primary' }))));
    return;
  }
  const canEdit = state.home ? state.home.can_edit !== false : true;
  const E = { cur: project.pages[1]?.id || project.pages[0].id, sel: null, zoom: 'fit', crop: false, guides: true, editingText: null, clip: null, mode: null };
  // ---- photos: where each one is and its shape
  const media = new Map(project.media.filter((m) => m.ok).map((m) => [`${m.k}:${m.id}`, { bucket: m.bucket, path: m.path, thumb: m.thumb, ar: m.width && m.height ? m.width / m.height : null }]));
  const aspects = new Map(); const pending = new Set();
  const keyOf = (src) => `${src.k}:${src.id}`;
  function ensureMedia(keys) {
    const need = keys.filter((k) => media.has(k) && (!linkOf(media.get(k).bucket, media.get(k).path) || !aspects.has(k)) && !pending.has(k));
    if (!need.length) return;
    need.forEach((k) => pending.add(k));
    const groups = {}; for (const k of need) { const m = media.get(k); (groups[m.bucket] ||= []).push(m.path); }
    Promise.all(Object.entries(groups).map(([b, p]) => signed(b, p))).then(() => Promise.all(need.map((k) => new Promise((ok) => {
      const m = media.get(k), url = linkOf(m.bucket, m.path); if (!url) { ok(); return; }
      const img = new Image(); img.onload = () => { aspects.set(k, img.naturalWidth / img.naturalHeight); ok(); }; img.onerror = ok; img.src = url;
    })))).then(() => { need.forEach((k) => pending.delete(k)); renderStage(); renderStrip(); renderProps(); });
  }
  const resolver = (src, el) => {
    const k = keyOf(src), m = media.get(k); if (!m) return null;
    const url = linkOf(m.bucket, m.path); if (!url) { ensureMedia([k]); return { url: null, aspect: 1 }; }
    return { url, aspect: aspects.get(k) || m.ar || el?.ar || 1.5 };
  };
  const thumbResolver = (src, el) => { const m = media.get(keyOf(src)); if (!m) return null;
    const url = linkOf(m.bucket, m.thumb || m.path) || linkOf(m.bucket, m.path); return url ? { url, aspect: aspects.get(keyOf(src)) || m.ar || el?.ar || 1.5 } : null; };
  const registerMedia = (k, info) => { if (!media.has(k)) media.set(k, info); };

  // ---- the document
  const doc = new Doc(project, {
    onChange: (info) => { if (info?.proofsExpired) toast('Your earlier preview is out of date now. Make a new preview when you’re ready.'); refresh(); },
    onStatus: (s, msg) => { renderStatus(); if (s === 'error') toast(msg || 'This change couldn’t be saved.', 'error'); },
    onConflict: async () => {
      await dialog((close) => h('div', { class: 'sc-dlg' }, h('h2', {}, 'This scrapbook changed in another window'),
        h('p', {}, 'It was saved from another window or tab, so this window stopped saving to avoid overwriting it. Reload to continue with the latest version. Changes made here are kept on this computer and offered back after reloading.'),
        h('div', { class: 'sc-dlg-actions' }, btn('Reload', () => close(true), { kind: 'primary' }))), { label: 'Scrapbook changed elsewhere' });
      location.reload();
    },
  });
  const page = () => doc.page(E.cur) || doc.pages[0];
  const pageIndex = () => doc.pages.indexOf(page());
  const els = () => page().data.els || (page().data.els = []);
  const selected = () => (E.sel ? els().find((e) => e.id === E.sel) : null);
  const box = () => pageBox(page().kind, pageIndex());

  // ---- layout
  const status = h('span', { class: 'sc-status', role: 'status', dataset: { testid: 'save-status' } });
  const undoB = btn('', () => { if (doc.undo()) toast('Undone'); }, { ico: 'undo', title: 'Undo (Ctrl+Z)', testid: 'undo' });
  const redoB = btn('', () => { if (doc.redo()) toast('Redone'); }, { ico: 'redo', title: 'Redo (Ctrl+Shift+Z)', testid: 'redo' });
  const titleB = h('button', { type: 'button', class: 'sc-title-btn', title: 'Rename', dataset: { testid: 'title' }, onclick: async () => {
    const t = await promptText('Rename scrapbook', 'Name (also printed on the spine)', doc.title); if (!t || t === doc.title) return;
    doc.change([], () => { doc.title = t; if (doc.settings.spine) doc.settings.spine.text = t; }); } });
  const zoomL = h('span', { class: 'sc-zoom' });
  const top = h('header', { class: 'sc-ed-top' },
    btn('', async () => { location.hash = '#/'; }, { ico: 'back', title: 'Back to my scrapbooks', testid: 'back' }), titleB, status,
    h('div', { class: 'sc-spacer' }), undoB, redoB, h('span', { class: 'sc-sep' }),
    btn('', () => setZoom(zoomVal() / 1.2), { ico: 'zoomout', title: 'Zoom out' }), zoomL, btn('', () => setZoom(zoomVal() * 1.2), { ico: 'zoomin', title: 'Zoom in' }),
    btn('Fit', () => setZoom('fit'), { kind: 'ghost' }),
    btn('', () => { E.guides = !E.guides; drawOverlay(); }, { ico: 'guide', title: 'Show or hide the print guides (trim, bleed, safe area)', testid: 'guides' }), h('span', { class: 'sc-sep' }),
    btn('Preview book', async () => { location.hash = `#/p/${projectId}/preview`; }, { kind: 'primary', ico: 'eye', testid: 'preview' }));
  const stageWrap = h('div', { class: 'sc-stage-wrap', tabindex: '0', 'aria-label': 'Page canvas' });
  const stage = h('div', { class: 'sc-stage' });
  const pageHolder = h('div', { class: 'sc-page-holder' });
  const overlay = h('div', { class: 'sc-overlay' });
  stage.append(pageHolder, overlay); stageWrap.append(stage);
  const left = h('aside', { class: 'sc-left' }), right = h('aside', { class: 'sc-right', 'aria-label': 'Selected item' });
  const strip = h('div', { class: 'sc-strip', 'aria-label': 'Pages' });
  const stripBar = h('div', { class: 'sc-strip-bar' });
  const root = h('div', { class: 'sc-editor' + (canEdit ? '' : ' readonly') }, top, h('div', { class: 'sc-ed-body' }, left, h('div', { class: 'sc-center-col' }, stageWrap, h('div', { class: 'sc-strip-wrap' }, stripBar, strip)), right));
  $app.replaceChildren(root);
  if (!canEdit) toast('A DayCasion plan is needed to edit. You can look through this scrapbook.', 'error');

  // ---- zoom and drawing
  const zoomVal = () => (E.zoom === 'fit' ? fitZoom() : E.zoom);
  function fitZoom() { const b = box(), r = stageWrap.getBoundingClientRect(); return clamp(Math.min((r.width - 60) / (b.outW * PX), (r.height - 50) / (b.outH * PX)), 0.15, 3); }
  function setZoom(z) { E.zoom = z === 'fit' ? 'fit' : clamp(z, 0.2, 4); renderStage(); }
  const k = () => zoomVal() * PX; // screen px per pt
  function renderStage() {
    const b = box(), z = zoomVal();
    zoomL.textContent = `${Math.round(z * 100)}%`;
    stage.style.width = `${b.outW * PX * z}px`; stage.style.height = `${b.outH * PX * z}px`;
    if (E.editingText) { drawOverlay(); return; } // typing: the page isn't redrawn under the cursor
    const { html } = renderPage(page(), { index: pageIndex(), asset: ASSET, media: resolver, editing: true });
    const node = htmlNode(html);
    node.style.transform = `scale(${z})`; node.style.transformOrigin = '0 0';
    const old = pageHolder.firstElementChild;
    if (old && old.dataset.pid === page().id) morph(old, node); else pageHolder.replaceChildren(node);
    pageHolder.firstElementChild.dataset.pid = page().id;
    ensureMedia((page().data.els || []).filter((e) => e.t === 'photo' && e.src).map((e) => keyOf(e.src)));
    drawOverlay();
  }
  function rotPt(x, y, deg) { const a = (deg * Math.PI) / 180; return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]; }
  function drawOverlay() {
    const b = box(), K = k(), parts = [];
    if (E.guides) {
      const g = (x, y, w, hh, cls, label) => parts.push(h('div', { class: `sc-guide ${cls}`, style: { left: `${x * K}px`, top: `${y * K}px`, width: `${w * K}px`, height: `${hh * K}px` } }, label ? h('span', {}, label) : null));
      g(b.bleed.l, b.bleed.t, b.trimW, b.trimH, 'trim', page().kind === 'cover' ? 'Front cover: the area past the dashed line wraps around the board' : 'Trim: the area outside is cut off');
      g(b.bleed.l + b.safe.l, b.bleed.t + b.safe.t, b.trimW - b.safe.l - b.safe.r, b.trimH - b.safe.t - b.safe.b, 'safe', null);
      if (page().kind === 'page') g(pageIndex() % 2 ? b.bleed.l : b.bleed.l + b.trimW - 18, b.bleed.t, 18, b.trimH, 'gutter', null);
      if (page().kind === 'cover') g(0, b.bleed.t, b.safe.l, b.trimH, 'gutter', null);
    }
    for (const sg of E.snapLines || []) parts.push(h('div', { class: 'sc-snap', style: sg.v ? { left: `${(sg.v + b.bleed.l) * K}px`, top: 0, height: '100%' } : { top: `${(sg.h + b.bleed.t) * K}px`, left: 0, width: '100%' } }));
    const el = selected();
    if (el) {
      const cx = (el.x + el.w / 2 + b.bleed.l) * K, cy = (el.y + el.h / 2 + b.bleed.t) * K;
      if (E.crop && el.t === 'photo' && el.src) {
        const m = resolver(el.src, el), a = photoArea(el), bw = el.bw || 0;
        if (m?.url) {
          const g = photoGeometry(a.w - 2 * bw, a.h - 2 * bw, m.aspect, el.crop || {});
          const ghost = h('div', { class: 'sc-crop-ghost', style: { left: `${cx - (el.w / 2) * K}px`, top: `${cy - (el.h / 2) * K}px`, width: `${el.w * K}px`, height: `${el.h * K}px`, transform: `rotate(${el.r || 0}deg)` } },
            h('img', { src: m.url, alt: '', style: { left: `${(a.x + bw + g.left) * K}px`, top: `${(a.y + bw + g.top) * K}px`, width: `${g.width * K}px`, height: `${g.height * K}px` } }));
          parts.push(ghost);
        }
      }
      const sel = h('div', { class: `sc-sel${E.crop ? ' crop' : ''}`, dataset: { testid: 'selection' }, style: { left: `${cx - (el.w / 2) * K}px`, top: `${cy - (el.h / 2) * K}px`, width: `${el.w * K}px`, height: `${el.h * K}px`, transform: `rotate(${el.r || 0}deg)` } });
      if (canEdit && !E.crop && !E.editingText) {
        for (const [hx, hy] of [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]]) {
          sel.append(h('div', { class: 'sc-handle', dataset: { hx, hy, testid: `handle-${hx}${hy}` }, style: { left: `${(hx + 1) * 50}%`, top: `${(hy + 1) * 50}%` } }));
        }
        sel.append(h('div', { class: 'sc-rot', dataset: { rot: '1', testid: 'rotate' }, title: 'Rotate (Shift: 15° steps)' }));
      }
      parts.push(sel);
    }
    overlay.replaceChildren(...parts);
  }
  function renderStatus() {
    const s = doc.status;
    status.textContent = { saved: 'All changes saved', unsaved: 'Saving…', saving: 'Saving…', offline: 'Not saved yet: reconnecting…', conflict: 'Changed in another window', error: 'Not saved' }[s] || s;
    status.className = `sc-status ${s}`;
    undoB.disabled = !doc.undoStack.length || !canEdit; redoB.disabled = !doc.redoStack.length || !canEdit;
    titleB.textContent = doc.title; titleB.disabled = !canEdit;
  }

  // ---- page strip
  let stripTimer;
  function renderStrip() {
    const items = doc.pages.map((p, i) => {
      const t = h('div', { class: `sc-thumb${p.id === E.cur ? ' on' : ''}`, draggable: canEdit && i > 0 ? 'true' : 'false', tabindex: '0', role: 'button',
        'aria-label': i ? `Page ${i}` : 'Cover', dataset: { pid: p.id, testid: `thumb-${i}` },
        onclick: () => go(p.id), onkeydown: (e) => { if (e.key === 'Enter') go(p.id); },
        ondragstart: (e) => { e.dataTransfer.setData('text/x-scrap-page', p.id); e.dataTransfer.effectAllowed = 'move'; },
        ondragover: (e) => { if (i > 0 && [...e.dataTransfer.types].includes('text/x-scrap-page')) { e.preventDefault(); t.classList.add('drop'); } },
        ondragleave: () => t.classList.remove('drop'),
        ondrop: (e) => { e.preventDefault(); t.classList.remove('drop'); const id = e.dataTransfer.getData('text/x-scrap-page'); if (id && id !== p.id) movePageTo(id, i); } },
        miniPage(p, 74, thumbResolver, i), h('span', {}, i ? String(i) : 'Cover'));
      return t;
    });
    strip.replaceChildren(...items);
    const n = doc.pages.length - 1, printed = Math.max(20, n + (n % 2));
    stripBar.replaceChildren(h('span', { class: 'sc-muted' }, `${n} page${n === 1 ? '' : 's'}${printed !== n ? ` · prints as ${printed} (blank pages added at the end)` : ''}`),
      h('div', { class: 'sc-spacer' }),
      btn('Add page', () => addPage(), { ico: 'plus', disabled: !canEdit, testid: 'add-page' }),
      btn('Duplicate page', () => dupPage(), { ico: 'copy', disabled: !canEdit || page().kind === 'cover', testid: 'dup-page' }),
      btn('', () => movePage(-1), { ico: 'left', title: 'Move page earlier', disabled: !canEdit || pageIndex() <= 1, testid: 'page-left' }),
      btn('', () => movePage(1), { ico: 'right', title: 'Move page later', disabled: !canEdit || pageIndex() < 1 || pageIndex() >= doc.pages.length - 1, testid: 'page-right' }),
      btn('', () => delPage(), { ico: 'trash', title: 'Delete page', disabled: !canEdit || page().kind === 'cover' || doc.pages.length <= 2, testid: 'del-page' }));
  }
  function refreshThumb() {
    clearTimeout(stripTimer);
    stripTimer = setTimeout(() => { const t = strip.querySelector(`[data-pid="${E.cur}"]`); if (t) t.firstElementChild.replaceWith(miniPage(page(), 74, thumbResolver, pageIndex())); }, 350);
  }
  function go(id) { if (E.editingText) endText(); E.cur = id; E.sel = null; E.crop = false; renderAll(); }
  function addPage(data = { bg: { color: '#FFFFFF' }, els: [] }) {
    const np = { id: uuid(), kind: 'page', data: structuredClone(data) };
    const at = Math.max(1, pageIndex() + 1);
    if (doc.pages.length - 1 >= (state.home?.hardcover?.pricing?.max_pages || 300)) { toast('A scrapbook can have up to 300 pages.', 'error'); return; }
    doc.change([np.id], () => { doc.pages.splice(at, 0, np); });
    E.cur = np.id; E.sel = null; renderAll();
  }
  function dupPage() { const p = page(); if (p.kind === 'cover') return; const data = structuredClone(p.data); for (const e of data.els || []) e.id = shortId(); addPage(data); }
  async function delPage() {
    const p = page(); if (p.kind === 'cover' || doc.pages.length <= 2) return;
    if ((p.data.els || []).length && !(await confirmDialog('Delete this page?', 'The page and everything on it will be removed from the scrapbook. You can undo this.', 'Delete page', { danger: true }))) return;
    const i = pageIndex();
    doc.change([p.id], () => { doc.pages.splice(i, 1); });
    E.cur = doc.pages[Math.min(i, doc.pages.length - 1)].id; E.sel = null; renderAll();
  }
  function movePage(d) { const i = pageIndex(); const j2 = i + d; if (i < 1 || j2 < 1 || j2 >= doc.pages.length) return; movePageTo(page().id, j2); }
  function movePageTo(id, to) {
    const from = doc.pages.findIndex((p) => p.id === id); if (from < 1 || to < 1) return;
    doc.change([], () => { const [p] = doc.pages.splice(from, 1); doc.pages.splice(to, 0, p); });
    E.cur = id; renderAll();
  }

  // ---- element changes
  function edit(fn, key = null) { if (!canEdit) return; const id = page().id; doc.change([id], fn, { key }); }
  function addEl(el, at = null) {
    if (!canEdit) return;
    if ((page().data.els || []).length >= 150) { toast('A page can hold up to 150 items. Add another page.', 'error'); return; }
    const b = box(), c = at || { x: b.trimW / 2, y: b.trimH / 2 };
    el.id = shortId(); el.x = r2(clamp(c.x - el.w / 2, -b.bleed.l, b.trimW - el.w / 2)); el.y = r2(clamp(c.y - el.h / 2, -b.bleed.t, b.trimH - el.h / 2)); el.r = el.r || 0;
    edit(() => els().push(el));
    E.sel = el.id; E.crop = false; renderAll();
  }
  function setProp(p, v, key) { const el = selected(); if (!el) return; edit(() => { const e = els().find((x) => x.id === el.id); if (v === undefined) delete e[p]; else e[p] = v; }, key || `${el.id}:${p}`); }
  function layer(op) {
    const el = selected(); if (!el) return;
    edit(() => { const a = els(), i = a.findIndex((e) => e.id === el.id); a.splice(i, 1);
      const j2 = op === 'front' ? a.length : op === 'back' ? 0 : op === 'up' ? Math.min(a.length, i + 1) : Math.max(0, i - 1); a.splice(j2, 0, el); });
  }
  function removeSel() { const el = selected(); if (!el) return; edit(() => { const a = els(); a.splice(a.findIndex((e) => e.id === el.id), 1); }); E.sel = null; E.crop = false; renderAll(); }
  function dupSel() { const el = selected(); if (!el) return; const c = structuredClone(el); c.id = shortId(); c.x += 14; c.y += 14; edit(() => els().push(c)); E.sel = c.id; renderAll(); }

  // ---- pointer: select, move, resize, rotate, crop
  const toPage = (ev) => { const r = stage.getBoundingClientRect(), b = box(); return { x: (ev.clientX - r.left) / k() - b.bleed.l, y: (ev.clientY - r.top) / k() - b.bleed.t }; };
  function hit(ev) {
    for (const n of document.elementsFromPoint(ev.clientX, ev.clientY)) {
      if (!pageHolder.contains(n)) continue;
      const d = n.closest('[data-id]'); if (d) return d.dataset.id;
    }
    return null;
  }
  function snapMove(el, nx, ny) {
    const b = box(), t = 6 / k(), lines = [];
    const xs = [0, b.trimW / 2, b.trimW, b.safe.l, b.trimW - b.safe.r], ys = [0, b.trimH / 2, b.trimH, b.safe.t, b.trimH - b.safe.b];
    for (const o of els()) if (o.id !== el.id && !o.r) { xs.push(o.x, o.x + o.w / 2, o.x + o.w); ys.push(o.y, o.y + o.h / 2, o.y + o.h); }
    let bx = null, by = null;
    for (const [off] of [[0], [el.w / 2], [el.w]]) for (const x of xs) if (Math.abs(nx + off - x) < t && (bx == null || Math.abs(nx + off - x) < Math.abs(bx.d))) bx = { d: nx + off - x, x };
    for (const [off] of [[0], [el.h / 2], [el.h]]) for (const y of ys) if (Math.abs(ny + off - y) < t && (by == null || Math.abs(ny + off - y) < Math.abs(by.d))) by = { d: ny + off - y, y };
    if (bx) { nx -= bx.d; lines.push({ v: bx.x }); } if (by) { ny -= by.d; lines.push({ h: by.y }); }
    E.snapLines = lines;
    return [nx, ny];
  }
  stage.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    stageWrap.focus({ preventScroll: true });
    const handle = ev.target.closest('.sc-handle'), rot = ev.target.closest('[data-rot]');
    if (E.editingText) { if (ev.target.closest('[contenteditable]')) return; endText(); }
    let el = selected();
    if (!handle && !rot) {
      const id = hit(ev);
      if (!(E.crop && el && id === el.id)) { E.crop = false; E.sel = id; renderProps(); drawOverlay(); renderLeftContext(); }
      el = selected(); if (!el) return;
    }
    if (!canEdit) return;
    ev.preventDefault();
    const start = toPage(ev), s0 = structuredClone(el), before = doc.snap([page().id]);
    const mode = E.crop && el.t === 'photo' ? 'crop' : rot ? 'rotate' : handle ? 'resize' : 'move';
    const hx = handle ? Number(handle.dataset.hx) : 0, hy = handle ? Number(handle.dataset.hy) : 0;
    let moved = false;
    stage.setPointerCapture(ev.pointerId);
    const onMove = (e2) => {
      const p = toPage(e2), dx = p.x - start.x, dy = p.y - start.y;
      if (!moved && Math.hypot(dx, dy) * k() < 3) return; moved = true;
      const live = els().find((x) => x.id === s0.id);
      if (mode === 'move') { const [nx, ny] = e2.altKey ? [s0.x + dx, s0.y + dy] : snapMove(s0, s0.x + dx, s0.y + dy); live.x = r2(nx); live.y = r2(ny); }
      else if (mode === 'rotate') {
        const c = { x: s0.x + s0.w / 2, y: s0.y + s0.h / 2 }; let a = (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI + 90;
        if (e2.shiftKey) a = Math.round(a / 15) * 15; else for (const q of [0, 90, 180, 270, 360, -90]) if (Math.abs(a - q) < 4) a = q;
        a = ((a + 540) % 360) - 180; live.r = r2(a);
      } else if (mode === 'resize') {
        const c0 = { x: s0.x + s0.w / 2, y: s0.y + s0.h / 2 }, [vx, vy] = rotPt(p.x - c0.x, p.y - c0.y, -(s0.r || 0));
        const ax = (-hx * s0.w) / 2, ay = (-hy * s0.h) / 2;
        let w = hx ? Math.max(12, Math.abs(vx - ax)) : s0.w, hh = hy ? Math.max(12, Math.abs(vy - ay)) : s0.h;
        const keep = (hx && hy) && (s0.t === 'photo' || s0.t === 'sticker') !== e2.shiftKey;
        if (keep) { const sc = Math.max(w / s0.w, hh / s0.h); w = s0.w * sc; hh = s0.h * sc; }
        const [ox, oy] = rotPt(hx ? ax + (hx * w) / 2 : 0, hy ? ay + (hy * hh) / 2 : 0, s0.r || 0);
        live.w = r2(w); live.h = r2(hh); live.x = r2(c0.x + ox - w / 2); live.y = r2(c0.y + oy - hh / 2);
      } else if (mode === 'crop') {
        const m = resolver(live.src, live), a = photoArea(live), bw = live.bw || 0; if (!m) return;
        const g = photoGeometry(a.w - 2 * bw, a.h - 2 * bw, m.aspect, s0.crop || {});
        const [ldx, ldy] = rotPt(dx, dy, -(live.r || 0));
        const r3 = (v) => Math.round(clamp(v, 0, 1) * 1000) / 1000;
        live.crop = { s: s0.crop?.s || 1, cx: r3((s0.crop?.cx ?? 0.5) - ldx / g.width), cy: r3((s0.crop?.cy ?? 0.5) - ldy / g.height) };
      }
      renderStage(); renderPropsGeometry();
    };
    const onUp = () => {
      stage.removeEventListener('pointermove', onMove); stage.removeEventListener('pointerup', onUp); stage.removeEventListener('pointercancel', onUp);
      E.snapLines = [];
      if (moved) { doc.undoStack.push({ before, after: doc.snap([page().id]) }); doc.redoStack = []; doc.last = null; doc.changed(); }
      else drawOverlay();
    };
    stage.addEventListener('pointermove', onMove); stage.addEventListener('pointerup', onUp); stage.addEventListener('pointercancel', onUp);
  });
  stage.addEventListener('dblclick', (ev) => {
    const el = selected(); if (!el || !canEdit) return;
    if (el.t === 'text') startText(el); else if (el.t === 'photo' && el.src) { E.crop = !E.crop; drawOverlay(); renderProps(); }
  });
  stageWrap.addEventListener('wheel', (ev) => {
    const el = selected();
    if (E.crop && el?.t === 'photo') { ev.preventDefault(); const s = clamp((el.crop?.s || 1) * (ev.deltaY < 0 ? 1.06 : 1 / 1.06), 1, 8); setProp('crop', { ...(el.crop || {}), s: r2(s) }, `${el.id}:zoom`); renderProps(); }
    else if (ev.ctrlKey || ev.metaKey) { ev.preventDefault(); setZoom(zoomVal() * (ev.deltaY < 0 ? 1.1 : 1 / 1.1)); }
  }, { passive: false });
  // drop photos, stickers, text from the panels onto the page (or onto a photo spot to fill it)
  stageWrap.addEventListener('dragover', (ev) => { if ([...ev.dataTransfer.types].includes('text/x-scrap')) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; } });
  stageWrap.addEventListener('drop', (ev) => {
    const raw = ev.dataTransfer.getData('text/x-scrap'); if (!raw) return; ev.preventDefault();
    const item = JSON.parse(raw), at = toPage(ev), target = hit(ev), tEl = target && els().find((e) => e.id === target);
    if (item.kind === 'photo' && tEl?.t === 'photo') { fillPhoto(tEl.id, item); return; }
    placeItem(item, at);
  });

  // ---- text editing on the page
  function startText(el) {
    const node = pageHolder.querySelector(`[data-id="${el.id}"] .sc-tx > div`); if (!node) return;
    E.editingText = el.id; E.crop = false; drawOverlay();
    try { node.contentEditable = 'plaintext-only'; } catch (e) { node.contentEditable = 'true'; }
    if (node.contentEditable !== 'plaintext-only') node.contentEditable = 'true';
    node.focus();
    const r = document.createRange(); r.selectNodeContents(node); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    node.oninput = () => { const t = node.innerText.replace(/\n$/, ''); edit(() => { const e = els().find((x) => x.id === el.id); if (e) e.text = t.slice(0, 4000); }, `${el.id}:text`); syncTextArea(); };
    node.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); endText(); stageWrap.focus({ preventScroll: true }); } }; // keys are text here
    node.onblur = () => setTimeout(() => { if (E.editingText === el.id) endText(); }, 0);
  }
  function endText() { const id = E.editingText; if (!id) return; E.editingText = null; const n = pageHolder.querySelector(`[data-id="${id}"] .sc-tx > div`); if (n) { n.contentEditable = 'false'; n.oninput = n.onkeydown = n.onblur = null; } renderStage(); renderProps(); }

  // ---- adding things
  function placeItem(item, at = null) {
    const b = box();
    if (item.kind === 'photo') {
      const k2 = `${item.src.k}:${item.src.id}`; registerMedia(k2, item.media);
      const ar = item.ar || media.get(k2)?.ar || aspects.get(k2) || 1.5, w = ar >= 1 ? 260 : 200;
      const empty = !at && els().find((e) => e.t === 'photo' && !e.src);
      if (empty) { fillPhoto(empty.id, item); return; }
      addEl({ t: 'photo', w, h: r2(w / ar), src: item.src, ar: r2(ar), crop: { s: 1, cx: 0.5, cy: 0.5 }, bw: 6, bc: '#FFFFFF', radius: 0, shadow: true, frame: 'none' }, at);
      ensureMedia([k2]);
    } else if (item.kind === 'sticker') {
      const s = stickers.find((x) => x.key === item.s), w = 110, hh = s ? r2((w * s.h) / s.w) : 110;
      addEl({ t: 'sticker', s: item.s, w, h: hh, flip: false }, at);
    } else if (item.kind === 'shape') {
      const dims = { banner: [260, 56], ribbon: [280, 60], label: [200, 44], tag: [180, 70], line: [220, 6], dashes: [220, 6], washi: [200, 34], arrow: [140, 60], bubble: [180, 130] }[item.s] || [140, 140];
      addEl({ t: 'shape', s: item.s, w: dims[0], h: dims[1], fill: item.fill || '#F4898D', stroke: '#FFFFFF', sw: 0 }, at);
    } else if (item.kind === 'text') {
      addEl({ t: 'text', ...DEFAULTS.text, ...item.style, text: item.text, w: item.w || 300, h: item.h || 60 }, at);
    }
  }
  function fillPhoto(id, item) {
    const k2 = `${item.src.k}:${item.src.id}`; registerMedia(k2, item.media);
    edit(() => { const e = els().find((x) => x.id === id); e.src = item.src; e.ar = r2(item.ar || media.get(k2)?.ar || 1.5); e.crop = { s: 1, cx: 0.5, cy: 0.5 }; });
    E.sel = id; ensureMedia([k2]); renderAll();
  }

  // ---- left panel
  const TABS = [['photos', 'Photos', 'photo'], ['text', 'Text', 'text'], ['stickers', 'Stickers', 'sticker'], ['shapes', 'Shapes', 'shape'], ['bg', 'Background', 'bg'], ['layouts', 'Layouts', 'layout']];
  let tab = 'photos';
  const tabBar = h('nav', { class: 'sc-tabs', role: 'tablist' }), panel = h('div', { class: 'sc-panel' });
  left.append(tabBar, panel);
  const lib = libraryPanel({ canEdit, onPick: (item) => placeItem(item), registerMedia, onUploadsChanged: () => {} });
  function renderLeft() {
    tabBar.replaceChildren(...TABS.map(([id, label, ic]) => h('button', { type: 'button', role: 'tab', class: `sc-tab${tab === id ? ' on' : ''}`, 'aria-selected': tab === id ? 'true' : 'false',
      dataset: { testid: `tab-${id}` }, onclick: () => { tab = id; renderLeft(); } }, icon(ic, 20), h('span', {}, label))));
    panel.replaceChildren(({ photos: () => lib.node, text: textPanel, stickers: stickerPanel, shapes: shapePanel, bg: bgPanel, layouts: layoutPanel })[tab]());
  }
  function renderLeftContext() { if (tab === 'bg') renderLeft(); }
  const drag = (item) => ({ draggable: 'true', ondragstart: (e) => { e.dataTransfer.setData('text/x-scrap', JSON.stringify(item)); e.dataTransfer.effectAllowed = 'copy'; } });
  function textPanel() {
    const P = [
      ['Title', 'Our summer', { font: 'playfair', size: 40, weight: 700, align: 'center' }, 420, 64],
      ['Heading', 'A day to remember', { font: 'dmsans', size: 22, weight: 700 }, 340, 36],
      ['Handwritten caption', 'The best day ever!', { font: 'caveat', size: 24, align: 'center' }, 260, 40],
      ['Date', 'JUNE 2025', { font: 'dmsans', size: 12, weight: 700, ls: 0.14, color: '#8C6A48', align: 'center' }, 160, 24],
      ['Story', 'Write the story behind these photos: who was there, what happened and why it matters.', { font: 'lora', size: 13, lh: 1.5 }, 300, 110],
      ['Label', 'Summer 2025', { font: 'fredoka', size: 16, weight: 700, color: '#FFFFFF', bg: '#E05A63', pad: 8, radius: 14, align: 'center', valign: 'middle' }, 170, 38],
      ['Script', 'Love always', { font: 'vibes', size: 40, align: 'center', color: '#5A4636' }, 320, 64],
    ];
    return h('div', { class: 'sc-pane' }, h('p', { class: 'sc-muted sc-small' }, 'Click to add, or drag onto the page. Double-click text on the page to type.'),
      P.map(([label, text, style, w, hh]) => h('button', { type: 'button', class: 'sc-text-preset', dataset: { testid: `text-${label.split(' ')[0].toLowerCase()}` }, ...drag({ kind: 'text', text, style, w, h: hh }),
        onclick: () => placeItem({ kind: 'text', text, style, w, h: hh }) }, h('span', { style: { fontFamily: `'${fontOf(style.font).family}'`, fontWeight: style.weight || 400, fontSize: `${Math.min(26, style.size)}px`, color: style.bg ? style.color : '#1B1B1B', background: style.bg || 'none', padding: style.bg ? '2px 10px' : 0, borderRadius: '10px' } }, label))));
  }
  let stickerCat = 'All';
  function stickerPanel() {
    const cats = ['All', ...new Set(stickers.map((s) => s.cat))];
    const list = h('div', { class: 'sc-sticker-grid' }, stickers.filter((s) => stickerCat === 'All' || s.cat === stickerCat).map((s) =>
      h('button', { type: 'button', class: 'sc-stk-btn', title: s.label, 'aria-label': s.label, dataset: { testid: `sticker-${s.key}` }, ...drag({ kind: 'sticker', s: s.key }), onclick: () => placeItem({ kind: 'sticker', s: s.key }) },
        h('img', { src: ASSET(`stickers/${s.key}.svg`), alt: '', loading: 'lazy', draggable: 'false' }))));
    return h('div', { class: 'sc-pane' }, h('div', { class: 'sc-chips' }, cats.map((c) => h('button', { type: 'button', class: `sc-chip${c === stickerCat ? ' on' : ''}`, onclick: () => { stickerCat = c; renderLeft(); } }, c))), list);
  }
  function shapePanel() {
    return h('div', { class: 'sc-pane' }, h('p', { class: 'sc-muted sc-small' }, 'Shapes, banners, labels and ribbons. Change their colours on the right.'),
      h('div', { class: 'sc-shape-grid' }, SHAPES.map((s) => { const b = h('button', { type: 'button', class: 'sc-shape-btn', title: s.label, 'aria-label': s.label, dataset: { testid: `shape-${s.key}` }, ...drag({ kind: 'shape', s: s.key }), onclick: () => placeItem({ kind: 'shape', s: s.key }) });
        const w = ['line', 'dashes', 'washi', 'banner', 'ribbon', 'label'].includes(s.key) ? 64 : 44, hh = ['line', 'dashes'].includes(s.key) ? 6 : ['washi', 'banner', 'ribbon', 'label'].includes(s.key) ? 22 : 44;
        b.innerHTML = `<svg viewBox="0 0 ${w} ${hh}" width="${w}" height="${hh}" preserveAspectRatio="none">${shapeSvg(s.key, w, hh, { fill: '#F4898D', stroke: '#FFFFFF', sw: 0 })}</svg>`;
        b.append(h('span', {}, s.label)); return b; })));
  }
  function swatches(cur, onpick, { none = false, testid = '' } = {}) {
    const custom = h('input', { type: 'color', value: cur && /^#[0-9A-F]{6}$/i.test(cur) ? cur : '#FFFFFF', title: 'Any colour', 'aria-label': 'Choose any colour', oninput: (e) => onpick(e.target.value.toUpperCase()) });
    return h('div', { class: 'sc-swatches', dataset: { testid } }, none ? h('button', { type: 'button', class: `sc-sw none${!cur ? ' on' : ''}`, title: 'None', 'aria-label': 'None', onclick: () => onpick(null) }) : null,
      PALETTE.map((c) => h('button', { type: 'button', class: `sc-sw${cur && cur.toUpperCase() === c ? ' on' : ''}`, title: c, 'aria-label': c, style: { background: c }, onclick: () => onpick(c) })), custom);
  }
  function bgPanel() {
    const bg = page().data.bg || {};
    const setBg = (patch, key) => { edit(() => { const p = page(); p.data.bg = { ...(p.data.bg || {}), ...patch }; for (const [kk, v] of Object.entries(patch)) if (v == null) delete p.data.bg[kk]; }, key); renderLeft(); };
    const pat = (p) => { const svg = patternSvg(p.key, bg.pc || '#E05A63');
      return h('button', { type: 'button', class: `sc-pat${bg.pattern === p.key ? ' on' : ''}`, title: p.label, 'aria-label': p.label, dataset: { testid: `pattern-${p.key}` }, onclick: () => setBg({ pattern: p.key, texture: null, po: bg.po ?? 0.6 }),
        style: { backgroundColor: bg.color || '#FFFFFF', backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`, backgroundSize: '24px 24px' } }); };
    return h('div', { class: 'sc-pane' },
      h('h3', {}, page().kind === 'cover' ? 'Cover background' : `Page ${pageIndex()} background`), h('p', { class: 'sc-label' }, 'Colour'), swatches(bg.color || '#FFFFFF', (c) => setBg({ color: c }, 'bgcolor'), { testid: 'bg-colors' }),
      h('p', { class: 'sc-label' }, 'Pattern'), h('div', { class: 'sc-pat-grid' }, h('button', { type: 'button', class: `sc-pat none${!bg.pattern ? ' on' : ''}`, onclick: () => setBg({ pattern: null }) }, 'None'), PATTERNS.map(pat)),
      bg.pattern ? h('div', {}, h('p', { class: 'sc-label' }, 'Pattern colour'), swatches(bg.pc || '#E05A63', (c) => setBg({ pc: c }, 'bgpc')),
        slider('Pattern size', bg.ps ?? 1, 0.5, 3, 0.05, (v) => setBg({ ps: v }, 'bgps')), slider('Pattern strength', bg.po ?? 0.6, 0.1, 1, 0.05, (v) => setBg({ po: v }, 'bgpo'))) : null,
      h('p', { class: 'sc-label' }, 'Paper texture'), h('div', { class: 'sc-pat-grid' }, h('button', { type: 'button', class: `sc-pat none${!bg.texture ? ' on' : ''}`, onclick: () => setBg({ texture: null }) }, 'None'),
        TEXTURES.map((t) => h('button', { type: 'button', class: `sc-pat${bg.texture === t.key ? ' on' : ''}`, title: t.label, 'aria-label': t.label, dataset: { testid: `texture-${t.key}` }, onclick: () => setBg({ texture: t.key, pattern: null, po: 1 }),
          style: { backgroundImage: `url('${ASSET(`textures/${t.key}.jpg`)}')`, backgroundSize: 'cover' } }))),
      bg.texture ? slider('Texture strength', bg.po ?? 1, 0.1, 1, 0.05, (v) => setBg({ po: v }, 'bgpo')) : null,
      page().kind === 'page' ? btn('Use this background on every page', async () => {
        if (!(await confirmDialog('Use this background on every page?', 'The background colour, pattern and texture of every page (not the cover) will change to this one. You can undo this.', 'Apply to all pages'))) return;
        const ids = doc.pages.filter((p) => p.kind === 'page').map((p) => p.id); doc.change(ids, () => { for (const p of doc.pages) if (p.kind === 'page') p.data.bg = structuredClone(bg); }); renderAll();
      }, { kind: 'wide' }) : null,
      page().kind === 'cover' ? coverSettings() : null);
  }
  function coverSettings() {
    const sp = doc.settings.spine || {};
    const set = (patch, key) => { doc.change([], () => { doc.settings = { ...doc.settings, spine: { ...(doc.settings.spine || {}), ...patch } }; }, { key }); renderLeft(); };
    const backC = doc.settings.back?.color;
    return h('div', { class: 'sc-cover-settings' }, h('h3', {}, 'Spine and back cover'),
      h('label', { class: 'sc-label', for: 'spine-text' }, 'Spine text'), h('input', { id: 'spine-text', type: 'text', maxlength: 60, value: sp.text ?? doc.title, oninput: (e) => set({ text: e.target.value }, 'spine-text') }),
      h('p', { class: 'sc-label' }, 'Spine colour'), swatches(sp.color || '#0A1640', (c) => set({ color: c }, 'spine-color')),
      h('p', { class: 'sc-label' }, 'Back cover colour'), swatches(backC || null, (c) => { doc.change([], () => { doc.settings = { ...doc.settings, back: c ? { color: c } : undefined }; }); renderLeft(); }, { none: true }),
      h('p', { class: 'sc-small sc-muted' }, 'The back cover uses the front cover’s background colour unless you choose another. Its spine width depends on the number of pages.'));
  }
  function layoutPanel() {
    const cover = page().kind === 'cover';
    return h('div', { class: 'sc-pane' }, h('p', { class: 'sc-muted sc-small' }, cover ? 'Pick a cover design to replace this cover’s design.' : 'Pick a page design to add it after this page. Everything on it can be changed.'),
      templates.map((t) => h('div', {}, h('h3', {}, t.label), h('div', { class: 'sc-layouts' }, t.pages.filter((p) => (p.kind === 'cover') === cover).map((p, i) =>
        h('button', { type: 'button', class: 'sc-layout', title: `${t.label} ${cover ? 'cover' : `layout ${i + 1}`}`, dataset: { testid: `layout-${t.key}-${i}` }, onclick: async () => {
          const data = structuredClone(p.data); for (const e of data.els) e.id = shortId();
          if (cover) { if ((page().data.els || []).length && !(await confirmDialog('Replace the cover design?', 'The cover’s current design will be replaced. You can undo this.', 'Replace cover'))) return;
            edit(() => { page().data = data; }); renderAll(); } else addPage(data);
        } }, miniPage(p, 92, () => null, 1)))))));
  }
  function slider(label, v, min, max, step, on) {
    const out = h('output', {}, String(r2(v)));
    return h('label', { class: 'sc-slider' }, h('span', {}, label), h('input', { type: 'range', min, max, step, value: v, 'aria-label': label, oninput: (e) => { out.textContent = String(r2(+e.target.value)); on(+e.target.value); } }), out);
  }

  // ---- right panel: the selected item
  let geo = null;
  function num(label, value, on, { unit = 'in', step = 0.05, testid } = {}) {
    const i = h('input', { type: 'number', step, value: unit === 'in' ? r2(value / 72) : r2(value), 'aria-label': label, dataset: { testid }, disabled: !canEdit,
      onchange: (e) => { const v = +e.target.value; if (Number.isFinite(v)) on(unit === 'in' ? v * 72 : v); } });
    return h('label', { class: 'sc-num' }, h('span', {}, label), i, h('em', {}, unit === 'in' ? 'in' : '°'));
  }
  function renderPropsGeometry() { if (!geo) return; const el = selected(); if (!el) return; const ins = geo.querySelectorAll('input');
    [el.x, el.y, el.w, el.h].forEach((v, i) => { if (document.activeElement !== ins[i]) ins[i].value = r2(v / 72); }); if (document.activeElement !== ins[4]) ins[4].value = r2(el.r || 0); }
  function renderProps() {
    const el = selected();
    if (!el) {
      geo = null;
      right.replaceChildren(h('div', { class: 'sc-pane' }, h('h3', {}, page().kind === 'cover' ? 'Front cover' : `Page ${pageIndex()}`),
        h('p', { class: 'sc-muted sc-small' }, 'Click an item on the page to change it. Add photos, text, stickers and shapes from the left; change the background under Background.'),
        h('ul', { class: 'sc-tips' }, h('li', {}, 'Drag to move; corners resize; the round handle rotates.'), h('li', {}, 'Double-click a photo to crop or zoom it; double-click text to type.'),
          h('li', {}, 'Ctrl+Z undo, Ctrl+Shift+Z redo, Ctrl+D duplicate, Delete removes, arrow keys nudge (Shift: more).'),
          h('li', {}, 'Keep words and faces inside the dotted line: the edges are trimmed when the book is printed.'))));
      return;
    }
    const kind = { photo: 'Photo', text: 'Text', sticker: 'Sticker', shape: 'Shape' }[el.t];
    geo = h('div', { class: 'sc-geo' }, num('X', el.x, (v) => setProp('x', r2(v)), { testid: 'prop-x' }), num('Y', el.y, (v) => setProp('y', r2(v)), { testid: 'prop-y' }),
      num('Width', el.w, (v) => setProp('w', r2(Math.max(12, v))), { testid: 'prop-w' }), num('Height', el.h, (v) => setProp('h', r2(Math.max(12, v))), { testid: 'prop-h' }),
      num('Rotate', el.r || 0, (v) => setProp('r', r2(clamp(v, -180, 180))), { unit: 'deg', step: 1, testid: 'prop-r' }));
    const common = h('div', { class: 'sc-group' }, h('p', { class: 'sc-label' }, 'Layer'), h('div', { class: 'sc-row' },
      btn('', () => layer('front'), { ico: 'front', title: 'Bring to front', testid: 'layer-front', disabled: !canEdit }), btn('', () => layer('up'), { ico: 'up', title: 'Bring forward', testid: 'layer-up', disabled: !canEdit }),
      btn('', () => layer('down'), { ico: 'down', title: 'Send backward', testid: 'layer-down', disabled: !canEdit }), btn('Back', () => layer('back'), { title: 'Send to back', testid: 'layer-back', disabled: !canEdit })),
      slider('Opacity', el.o ?? 1, 0.1, 1, 0.05, (v) => setProp('o', v === 1 ? undefined : v)),
      h('div', { class: 'sc-row' }, btn('Duplicate', dupSel, { ico: 'copy', disabled: !canEdit, testid: 'dup' }), btn('Delete', removeSel, { ico: 'trash', kind: 'danger-text', disabled: !canEdit, testid: 'delete' })));
    let specific = null;
    if (el.t === 'photo') {
      specific = h('div', { class: 'sc-group' },
        el.src ? h('div', { class: 'sc-row' }, btn(E.crop ? 'Done cropping' : 'Crop and zoom', () => { E.crop = !E.crop; drawOverlay(); renderProps(); }, { ico: 'crop', kind: E.crop ? 'primary' : '', testid: 'crop', disabled: !canEdit }),
          btn('Reset', () => setProp('crop', { s: 1, cx: 0.5, cy: 0.5 }), { disabled: !canEdit })) : h('p', { class: 'sc-muted sc-small' }, 'Empty photo spot: drag a photo from Photos onto it, or click a photo there.'),
        el.src ? slider('Zoom', el.crop?.s || 1, 1, 5, 0.05, (v) => setProp('crop', { ...(el.crop || { cx: 0.5, cy: 0.5 }), s: v }, `${el.id}:zoom`)) : null,
        h('p', { class: 'sc-label' }, 'Frame'), h('div', { class: 'sc-frames' }, FRAMES.map((f) => h('button', { type: 'button', class: `sc-chip${(el.frame || 'none') === f.key ? ' on' : ''}`, dataset: { testid: `frame-${f.key}` }, disabled: !canEdit, onclick: () => { setProp('frame', f.key); renderProps(); } }, f.label))),
        !['none', 'circle', 'heart'].includes(el.frame || 'none') ? h('div', {}, h('p', { class: 'sc-label' }, 'Frame colour'), swatches(el.fc || null, (c) => { setProp('fc', c || undefined, `${el.id}:fc`); renderProps(); })) : null,
        slider('Border', el.bw || 0, 0, 30, 1, (v) => setProp('bw', v, `${el.id}:bw`)), h('p', { class: 'sc-label' }, 'Border colour'), swatches(el.bc || '#FFFFFF', (c) => { setProp('bc', c, `${el.id}:bc`); renderProps(); }, { testid: 'border-colors' }),
        slider('Rounded corners', el.radius || 0, 0, 80, 1, (v) => setProp('radius', v, `${el.id}:radius`)),
        h('label', { class: 'sc-check' }, h('input', { type: 'checkbox', checked: !!el.shadow, disabled: !canEdit, onchange: (e) => setProp('shadow', e.target.checked) }), ' Soft shadow'));
    } else if (el.t === 'text') {
      const ta = h('textarea', { rows: 4, maxlength: 4000, 'aria-label': 'Text', dataset: { testid: 'prop-text' }, disabled: !canEdit, oninput: (e) => setProp('text', e.target.value, `${el.id}:text`) }); ta.value = el.text || '';
      const f = fontOf(el.font);
      specific = h('div', { class: 'sc-group' }, ta,
        h('label', { class: 'sc-field' }, h('span', {}, 'Font'), h('select', { 'aria-label': 'Font', dataset: { testid: 'prop-font' }, disabled: !canEdit, onchange: (e) => { setProp('font', e.target.value); renderProps(); } },
          [...new Set(FONTS.map((x) => x.group))].map((g) => h('optgroup', { label: g }, FONTS.filter((x) => x.group === g).map((x) => h('option', { value: x.key, selected: x.key === f.key }, x.label)))))),
        h('div', { class: 'sc-row' }, num('Size', el.size || 18, (v) => setProp('size', clamp(Math.round(v), 4, 400)), { unit: 'pt', step: 1, testid: 'prop-size' }),
          btn('B', () => setProp('weight', (el.weight || 400) >= 700 ? 400 : 700), { kind: `toggle${(el.weight || 400) >= 700 ? ' on' : ''}`, title: 'Bold', testid: 'prop-bold', disabled: !canEdit || !f.weights.includes(700) }),
          btn('I', () => setProp('italic', !el.italic), { kind: `toggle italic${el.italic ? ' on' : ''}`, title: 'Italic', testid: 'prop-italic', disabled: !canEdit || !f.italic })),
        h('p', { class: 'sc-label' }, 'Alignment'), h('div', { class: 'sc-row' }, ['left', 'center', 'right', 'justify'].map((a) => btn(a[0].toUpperCase() + a.slice(1), () => { setProp('align', a); renderProps(); }, { kind: `toggle${(el.align || 'left') === a ? ' on' : ''}`, testid: `align-${a}`, disabled: !canEdit }))),
        h('div', { class: 'sc-row' }, ['top', 'middle', 'bottom'].map((a) => btn(a[0].toUpperCase() + a.slice(1), () => { setProp('valign', a); renderProps(); }, { kind: `toggle${(el.valign || 'top') === a ? ' on' : ''}`, disabled: !canEdit }))),
        h('p', { class: 'sc-label' }, 'Colour'), swatches(el.color || '#1B1B1B', (c) => { setProp('color', c, `${el.id}:color`); renderProps(); }, { testid: 'text-colors' }),
        slider('Line spacing', el.lh || 1.25, 0.8, 2.5, 0.05, (v) => setProp('lh', v, `${el.id}:lh`)), slider('Letter spacing', el.ls || 0, -0.05, 0.4, 0.01, (v) => setProp('ls', v, `${el.id}:ls`)),
        h('p', { class: 'sc-label' }, 'Box colour'), swatches(el.bg || null, (c) => { setProp('bg', c || undefined, `${el.id}:bg`); if (c && el.pad == null) setProp('pad', 8); renderProps(); }, { none: true }),
        el.bg ? slider('Box padding', el.pad ?? 8, 0, 40, 1, (v) => setProp('pad', v, `${el.id}:pad`)) : null, el.bg ? slider('Box corners', el.radius || 0, 0, 40, 1, (v) => setProp('radius', v, `${el.id}:radius`)) : null);
    } else if (el.t === 'sticker') {
      specific = h('div', { class: 'sc-group' }, btn('Flip', () => setProp('flip', !el.flip), { ico: 'flip', disabled: !canEdit, testid: 'flip' }));
    } else if (el.t === 'shape') {
      specific = h('div', { class: 'sc-group' }, h('label', { class: 'sc-field' }, h('span', {}, 'Shape'), h('select', { disabled: !canEdit, onchange: (e) => setProp('s', e.target.value) }, SHAPES.map((s) => h('option', { value: s.key, selected: s.key === el.s }, s.label)))),
        h('p', { class: 'sc-label' }, 'Fill'), swatches(el.fill || '#F4898D', (c) => { setProp('fill', c, `${el.id}:fill`); renderProps(); }, { testid: 'shape-fill' }),
        slider('Outline', el.sw || 0, 0, 20, 0.5, (v) => setProp('sw', v, `${el.id}:sw`)), h('p', { class: 'sc-label' }, 'Outline colour'), swatches(el.stroke || '#FFFFFF', (c) => { setProp('stroke', c, `${el.id}:stroke`); renderProps(); }),
        btn('Flip', () => setProp('flip', !el.flip), { ico: 'flip', disabled: !canEdit }));
    }
    right.replaceChildren(h('div', { class: 'sc-pane' }, h('h3', {}, kind), geo, specific, common));
  }
  function syncTextArea() { const ta = right.querySelector('[data-testid="prop-text"]'); const el = selected(); if (ta && el && document.activeElement !== ta) ta.value = el.text || ''; }

  // ---- keyboard
  // shortcuts work wherever the focus is, except while typing (fields, text on the page) or in a dialog
  const onKey = (ev) => {
    if (!document.body.contains(root)) { document.removeEventListener('keydown', onKey); return; }
    const t = ev.target;
    if (E.editingText || document.querySelector('dialog[open]') || (t && (t.closest('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]')))) return;
    const mod = ev.metaKey || ev.ctrlKey, el = selected();
    if (mod && ev.key.toLowerCase() === 'z') { ev.preventDefault(); if (ev.shiftKey) doc.redo(); else doc.undo(); return; }
    if (mod && ev.key.toLowerCase() === 'y') { ev.preventDefault(); doc.redo(); return; }
    if (mod && ev.key.toLowerCase() === 'd' && el) { ev.preventDefault(); dupSel(); return; }
    if (mod && ev.key.toLowerCase() === 'c' && el) { E.clip = structuredClone(el); toast('Copied'); return; }
    if (mod && ev.key.toLowerCase() === 'v' && E.clip) { ev.preventDefault(); const c = structuredClone(E.clip); addEl(c, { x: c.x + c.w / 2 + 14, y: c.y + c.h / 2 + 14 }); return; }
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && el) { ev.preventDefault(); removeSel(); return; }
    if (ev.key === 'Escape') { E.sel = null; E.crop = false; renderAll(); return; }
    if (ev.key === 'Enter' && el?.t === 'text') { ev.preventDefault(); startText(el); return; }
    if (ev.key === 'PageDown' || ev.key === 'PageUp') { const i = pageIndex() + (ev.key === 'PageDown' ? 1 : -1); if (doc.pages[i]) go(doc.pages[i].id); ev.preventDefault(); return; }
    if (ev.key === ']' && el) { layer(mod ? 'front' : 'up'); return; } if (ev.key === '[' && el) { layer(mod ? 'back' : 'down'); return; }
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
    if (d && el && canEdit) { ev.preventDefault(); const st = ev.shiftKey ? 10 : 1; edit(() => { const e = els().find((x) => x.id === el.id); e.x = r2(e.x + d[0] * st); e.y = r2(e.y + d[1] * st); }, `${el.id}:nudge`); }
  };
  document.addEventListener('keydown', onKey);
  new ResizeObserver(() => { if (E.zoom === 'fit' && document.body.contains(stageWrap)) renderStage(); }).observe(stageWrap); // fit follows the window and panels
  const unload = (e) => { if (doc.isDirty()) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', unload);
  window.__scLeave = async () => {
    if (!doc.isDirty()) { cleanup(); return true; }
    if (await doc.flush()) { cleanup(); return true; }
    if (await confirmDialog('Leave without saving?', 'Your latest changes haven’t reached DayCasion yet (they are kept on this computer and offered back when you open this scrapbook again).', 'Leave', { danger: true })) { cleanup(); return true; }
    return false;
  };
  function cleanup() { window.removeEventListener('beforeunload', unload); document.removeEventListener('keydown', onKey); window.__scLeave = null; }
  window.__scDoc = doc; // tests and debugging

  // ---- everything
  function renderAll() { renderStage(); renderStrip(); renderProps(); renderStatus(); renderLeftContext(); }
  function refresh() { renderStage(); refreshThumb(); renderStatus(); if (!E.editingText) { const el = selected(); if (el) renderPropsGeometry(); } if (doc.pages.map((p) => p.id).join() !== strip.dataset.order) { strip.dataset.order = doc.pages.map((p) => p.id).join(); renderStrip(); }
    if (!doc.page(E.cur)) { E.cur = doc.pages[Math.min(doc.pages.length - 1, 1)].id; renderAll(); } if (E.sel && !selected()) { E.sel = null; renderProps(); } }
  renderLeft(); renderAll(); strip.dataset.order = doc.pages.map((p) => p.id).join();
  // thumbnails need the photo links: sign every placed photo once
  ensureMedia(doc.pages.flatMap((p) => (p.data.els || []).filter((e) => e.t === 'photo' && e.src).map((e) => keyOf(e.src))));
  stageWrap.focus({ preventScroll: true });
  // changes this computer kept but couldn't save last time (closed tab, lost connection, crash)
  const j = Doc.journal(projectId);
  if (j && canEdit) {
    if (j.revision === project.revision) { doc.recover(j); toast('Changes that hadn’t been saved were restored.'); }
    else if (await confirmDialog('Restore unsaved changes?', `This computer has changes to this scrapbook from ${new Date(j.at).toLocaleString()} that weren’t saved. Restore them on top of the saved version?`, 'Restore changes')) doc.recover(j);
    else Doc.dropJournal(projectId);
    renderAll();
  }
}
