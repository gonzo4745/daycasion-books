/* DayCasion web flipbook: the in-app Keepsakes reader (app/dc_keepsake_reader.dart) for browsers.
 * Same book: the page images and manifest the book engine already made (reader/pNNNN.webp + manifest.json).
 * Same reading: one page at a time in portrait; two facing pages in landscape and on large screens (the cover on its
 * own); the leaf turns around the spine with the app's geometry (perspective 0.0011 single / 0.0008 spread, the same
 * shading, gutter and lift shadow) and timings (520 ms ease-in-out; a drag follows the finger and completes past a
 * third of the way or on a flick over 350 px/s); tap the page edges, swipe, keys, the page slider and Contents;
 * pinch or double-tap to zoom and pan; landscape phones float the bars over the pages and hide them.
 * Private page links are renewed before they run out and when a page fails to load. Only the pages around the
 * current one are kept in memory. No dependencies; every piece of book text goes through textContent.
 *   const book = DcFlipbook.open(rootElement, options)   (see defaults below) */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const ICONS = { // Material Symbols (Apache 2.0) outlines, 24px grid
    back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
    prev: 'M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z',
    next: 'M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z',
    toc: 'M3 9h14V7H3v2zm0 4h14v-2H3v2zm0 4h14v-2H3v2zm16 0h2v-2h-2v2zm0-10v2h2V7h-2zm0 6h2v-2h-2v2z',
    two: 'M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm0 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z',
    one: 'M17 3H7c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H7V5h10v14z',
    share: 'M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z',
    pdf: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
    full: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
    unfull: 'M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z',
    close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  };
  const DEFAULTS = {
    title: '', subtitle: '', pages: [], chapters: [], aspect: 0.8, linkSeconds: 3600,
    startPage: 1, resumed: false, // a resumed position shows "Picked up where you left off"
    renew: null, // async () => ({ n: url }) fresh private links
    onPage: null, // (page) => void, debounced 1.5 s (save the reading position)
    pdf: null, share: null, back: null, // async () => void; back: { label, onClick }
    brand: null, // { href, logo, label } small DayCasion mark (shared books)
  };
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'text') e.textContent = v;
      else if (k === 'class') e.className = v;
      else if (k === 'style') e.style.cssText = v; // CSSOM: allowed by the page's CSP (style attributes are not)
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null) e.append(c);
    return e;
  }
  function icon(name) {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false');
    const p = document.createElementNS(NS, 'path'); p.setAttribute('d', ICONS[name]); s.append(p);
    return s;
  }
  const iconButton = (name, label, onclick, extra = {}) =>
    el('button', { type: 'button', class: 'fb-icon', 'aria-label': label, title: label, onclick, ...extra }, icon(name));

  function open(root, options) {
    const o = { ...DEFAULTS, ...options };
    const pages = o.pages.slice().sort((a, b) => a.n - b.n);
    const count = pages.length;
    const textOf = new Map(pages.map((p) => [p.n, p.text || '']));
    let urls = new Map(pages.filter((p) => p.url).map((p) => [p.n, p.url]));
    const aspect = clamp(+o.aspect || 0.8, 0.5, 1.5);
    const reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    const S = {
      page: clamp(o.startPage | 0 || 1, 1, Math.max(1, count)), spread: false, spreadChoice: null,
      dir: 0, t: 0, dragging: false, anim: null,
      zoom: { s: 1, x: 0, y: 0 }, chrome: true, compact: false, pw: 300, ph: 375,
      signedAt: Date.now(), renewing: null, autoRenewals: 0, gen: 0, destroyed: false,
    };
    const imgs = new Map(); // page -> { img, gen, failed }

    // ------------------------------------------------------------------ DOM
    root.classList.add('fb');
    root.replaceChildren();
    const titleEl = el('div', { class: 'fb-titles' }, el('h1', { class: 'fb-title', text: o.title || 'Keepsake book' }),
      o.subtitle ? el('p', { class: 'fb-sub', text: o.subtitle }) : null);
    const spreadBtn = iconButton('two', 'Show two pages', () => { S.spreadChoice = !S.spread; resetZoom(); layout(true); });
    const tocBtn = iconButton('toc', 'Contents', () => showContents());
    const shareBtn = o.share ? el('button', { type: 'button', class: 'fb-pill', onclick: () => o.share() }, icon('share'), el('span', { text: 'Share' })) : null;
    const pdfBtn = o.pdf ? iconButton('pdf', 'Download PDF', () => runPdf()) : null;
    // Full screen where the browser allows it (Android Chrome, desktop, iPad Safari; not iPhone Safari)
    const canFull = !!(document.fullscreenEnabled && root.requestFullscreen);
    const fullBtn = canFull ? iconButton('full', 'Full screen', () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else root.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    }) : null;
    const onFull = () => { if (!fullBtn) return; const f = !!document.fullscreenElement; fullBtn.replaceChildren(icon(f ? 'unfull' : 'full'));
      fullBtn.setAttribute('aria-label', f ? 'Exit full screen' : 'Full screen'); fullBtn.title = f ? 'Exit full screen' : 'Full screen'; };
    document.addEventListener('fullscreenchange', onFull);
    const brand = o.brand ? el('a', { class: 'fb-brand', href: o.brand.href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': o.brand.label || 'DayCasion' },
      el('img', { src: o.brand.logo, alt: '', width: 28, height: 28 })) : null;
    const top = el('header', { class: 'fb-bar fb-top' },
      o.back ? iconButton('back', o.back.label || 'Back', o.back.onClick) : brand, titleEl, spreadBtn, tocBtn, fullBtn, shareBtn, pdfBtn);
    const book = el('div', { class: 'fb-book' });
    const zoomLayer = el('div', { class: 'fb-zoom' }, book);
    const stage = el('div', { class: 'fb-stage', tabindex: '0', role: 'region', 'aria-roledescription': 'book',
      'aria-label': o.title || 'Keepsake book', 'aria-describedby': 'fb-help' }, zoomLayer);
    const help = el('p', { id: 'fb-help', class: 'fb-sr', text: 'Use the left and right arrow keys, or the Previous and Next page buttons, to turn pages.' });
    const label = el('div', { class: 'fb-label', 'aria-hidden': 'true' });
    const slider = el('input', { type: 'range', class: 'fb-slider', min: '0', step: '1', 'aria-label': 'Page' });
    const prevBtn = iconButton('prev', 'Previous page', () => flip(-1));
    const nextBtn = iconButton('next', 'Next page', () => flip(1));
    const bottom = el('footer', { class: 'fb-bar fb-bottom' }, prevBtn, el('div', { class: 'fb-mid' }, label, slider), nextBtn);
    const live = el('div', { class: 'fb-sr', 'aria-live': 'polite' });
    const toast = el('div', { class: 'fb-toast', role: 'status' });
    root.append(top, stage, help, bottom, live, toast);

    // ------------------------------------------------------------------ views (as the app)
    const viewOf = (p) => (S.spread ? (p <= 1 ? 0 : Math.floor(p / 2)) : p - 1);
    const viewCount = () => (S.spread ? Math.floor(count / 2) + 1 : count);
    const firstPageOf = (v) => (S.spread ? (v === 0 ? 1 : v * 2) : v + 1);
    const slots = (v) => { if (v === 0) return [null, 1]; const l = v * 2, r = v * 2 + 1; return [l <= count ? l : null, r <= count ? r : null]; };
    const view = () => viewOf(S.page);
    const canNext = () => view() < viewCount() - 1;
    const canPrev = () => view() > 0;
    function pageLabel() {
      if (!S.spread || view() === 0) return `Page ${S.page} of ${count}`;
      const [l, r] = slots(view());
      return r == null ? `Page ${l} of ${count}` : `Pages ${l}–${r} of ${count}`;
    }
    const visiblePages = () => (S.spread ? slots(view()).filter((n) => n != null) : [S.page]);

    // ------------------------------------------------------------------ page images (private links, renewed)
    function imgFor(n) {
      let e = imgs.get(n);
      if (e && !(e.failed && e.gen !== S.gen)) return e;
      if (e) e.img.remove();
      const img = new Image();
      img.decoding = 'async'; img.alt = ''; img.draggable = false; img.referrerPolicy = 'no-referrer';
      e = { img, gen: S.gen, failed: false, loaded: false };
      img.onload = () => { e.loaded = true; const holder = img.parentElement; if (holder) holder.classList.remove('fb-loading'); };
      img.onerror = () => { e.failed = true; pageFailed(n, e); };
      imgs.set(n, e);
      const u = urls.get(n);
      if (u) img.src = u; else { e.failed = true; }
      return e;
    }
    function keepAround() { // only the pages near the reader stay decoded (long books on phones)
      const span = S.spread ? 2 : 1;
      for (const [n, e] of imgs) if (n < S.page - 4 * span || n > S.page + 6 * span) { e.img.removeAttribute('src'); imgs.delete(n); }
      for (let p = S.page - span; p <= S.page + 3 * span; p++) if (p >= 1 && p <= count) imgFor(p);
    }
    async function renewLinks() {
      if (!o.renew) throw new Error('no renew');
      if (!S.renewing) {
        S.renewing = (async () => {
          const fresh = await o.renew();
          if (!fresh || !Object.keys(fresh).length) throw new Error('no links');
          urls = new Map(Object.entries(fresh).map(([k, v]) => [Number(k), v]));
          S.signedAt = Date.now(); S.gen++;
        })().finally(() => { S.renewing = null; });
      }
      return S.renewing;
    }
    function renewIfDue() {
      if (Date.now() - S.signedAt < o.linkSeconds * 800 || S.renewing || !o.renew) return;
      renewLinks().catch(() => {});
    }
    function pageFailed(n, e) {
      paintPageProblem(n);
      if (e.gen !== S.gen || S.autoRenewals >= 4 || S.renewing || !o.renew) return;
      S.autoRenewals++;
      setTimeout(() => renewLinks().then(() => { if (visiblePages().includes(n)) render(); }).catch(() => paintPageProblem(n, true)), 400);
    }
    function paintPageProblem(n, final) {
      for (const holder of book.querySelectorAll(`[data-page="${n}"] .fb-img`)) {
        holder.classList.remove('fb-loading');
        if (holder.querySelector('.fb-problem')) continue;
        const retry = el('button', { type: 'button', class: 'fb-link', text: 'Try again', onclick: async (ev) => {
          ev.stopPropagation(); S.autoRenewals = 0;
          try { await renewLinks(); } catch (_) { showToast('Still offline. Check your connection and try again.'); }
          render();
        } });
        holder.append(el('div', { class: 'fb-problem' }, el('p', { text: final || !o.renew ? `Page ${n} didn't load` : 'Loading…' }), final || !o.renew ? retry : null));
      }
    }

    // ------------------------------------------------------------------ paper pages and the turning leaf
    // side: -1 left page of a spread, 1 right page, 0 single page (spine on the left)
    function paper(n, side) {
      const radius = side === -1 ? 'fb-l' : side === 1 ? 'fb-r' : 'fb-s';
      const p = el('div', { class: `fb-page ${radius}`, 'data-page': n == null ? '' : String(n) });
      p.style.width = S.pw + 'px'; p.style.height = S.ph + 'px';
      if (n == null || n < 1 || n > count) { p.classList.add('fb-blank'); return p; }
      const holder = el('div', { class: 'fb-img' });
      const e = imgFor(n);
      if (!e.loaded) holder.classList.add('fb-loading');
      holder.append(e.img);
      p.append(holder, el('div', { class: `fb-gutter ${side >= 0 ? 'fb-gl' : 'fb-gr'}${side === 0 ? ' fb-soft' : ''}` }),
        el('div', { class: 'fb-shade' }), el('div', { class: 'fb-leafshade' }));
      if (e.failed) setTimeout(() => paintPageProblem(n, e.gen !== S.gen || S.autoRenewals >= 4), 0);
      return p;
    }
    const setShade = (p, a) => { const s = p && p.querySelector('.fb-shade'); if (s) s.style.opacity = String(a); }; // blank pages have none
    function setLift(p, lift, leafShade, fromRight) {
      p.style.boxShadow = `0 ${3 + 6 * lift}px ${10 + 18 * lift}px rgba(0,0,0,${0.18 + 0.12 * lift})`;
      const ls = p.querySelector('.fb-leafshade');
      if (!ls) return; // a blank leaf (the back of the cover)
      ls.style.opacity = '1';
      ls.style.background = `linear-gradient(${fromRight ? 'to right' : 'to left'}, rgba(0,0,0,${leafShade * 0.4}), rgba(0,0,0,${leafShade}))`;
    }
    let T = null; // the turning structure (built once per turn, updated every frame)
    function render() {
      if (S.destroyed) return;
      book.style.width = (S.spread ? S.pw * 2 : S.pw) + 'px';
      book.style.height = S.ph + 'px';
      const v = view();
      T = null;
      if (S.dir === 0) {
        if (S.spread) { const [l, r] = slots(v); book.replaceChildren(el('div', { class: 'fb-row' }, paper(l, -1), paper(r, 1))); }
        else book.replaceChildren(paper(v + 1, 0));
      } else if (!S.spread) {
        const from = S.dir > 0 ? v : v - 1;
        const under = paper(from + 2, 0), leaf = paper(from + 1, 0);
        leaf.classList.add('fb-leaf'); leaf.style.transformOrigin = 'left center';
        book.replaceChildren(under, leaf);
        T = { kind: 'single', under, leaf };
      } else {
        const from = S.dir > 0 ? v : v - 1;
        const [l0, r0] = slots(from), [l1, r1] = slots(from + 1);
        const left = paper(l0, -1), right = paper(r1, 1);
        const front = paper(r0, 1), back = paper(l1, -1);
        front.classList.add('fb-leaf'); front.style.left = S.pw + 'px'; front.style.transformOrigin = 'left center';
        back.classList.add('fb-leaf'); back.style.left = '0px'; back.style.transformOrigin = 'right center';
        book.replaceChildren(el('div', { class: 'fb-row' }, left, right), front, back);
        T = { kind: 'spread', left, right, front, back };
      }
      frame();
      updateBars();
    }
    function frame() {
      if (!T) return;
      const t = S.t;
      if (T.kind === 'single') {
        const a = (S.dir > 0 ? t : 1 - t) * Math.PI / 2, lift = Math.sin(a);
        setShade(T.under, 0.28 * (1 - a / (Math.PI / 2)));
        T.leaf.style.transform = `perspective(${(1 / 0.0011).toFixed(0)}px) rotateY(${a}rad)`;
        setLift(T.leaf, lift, 0.32 * lift, true);
      } else {
        const a = (S.dir > 0 ? t : 1 - t) * Math.PI, half = Math.PI / 2, frontHalf = a < half, lift = Math.sin(a);
        setShade(T.left, frontHalf ? 0 : 0.25 * ((a - half) / half));
        setShade(T.right, frontHalf ? 0.25 * (1 - a / half) : 0);
        T.front.style.visibility = frontHalf ? 'visible' : 'hidden';
        T.back.style.visibility = frontHalf ? 'hidden' : 'visible';
        if (frontHalf) { T.front.style.transform = `perspective(1250px) rotateY(${a}rad)`; setLift(T.front, lift, 0.30 * lift, true); }
        else { T.back.style.transform = `perspective(1250px) rotateY(${a - Math.PI}rad)`; setLift(T.back, lift, 0.30 * lift, false); }
      }
    }

    // ------------------------------------------------------------------ turning
    function animateTo(to, ms, ease) {
      return new Promise((resolve) => {
        const from = S.t, start = performance.now();
        const step = (now) => {
          if (S.destroyed) return resolve();
          const k = Math.min(1, (now - start) / ms);
          S.t = from + (to - from) * ease(k); frame();
          if (k < 1) S.anim = requestAnimationFrame(step); else { S.anim = null; resolve(); }
        };
        S.anim = requestAnimationFrame(step);
      });
    }
    async function flip(dir) {
      if (S.dir !== 0 || S.dragging) return;
      if (dir > 0 ? !canNext() : !canPrev()) return;
      if (reduceMotion.matches) return setPage(firstPageOf(view() + dir));
      resetZoom();
      S.dir = dir; S.t = 0; render();
      await animateTo(1, 520, easeInOut);
      commitTurn();
    }
    function commitTurn() {
      if (S.dir === 0) return;
      const target = firstPageOf(view() + S.dir);
      S.dir = 0; S.t = 0;
      setPage(target, true);
    }
    function goTo(p, animate = true) {
      const target = clamp(p, 1, count), v = viewOf(target);
      if (animate && !reduceMotion.matches && Math.abs(v - view()) === 1) flip(v - view());
      else setPage(firstPageOf(v));
    }
    let saveTimer = null;
    function setPage(p, force) {
      p = clamp(p, 1, Math.max(1, count));
      const changed = p !== S.page;
      S.page = p;
      if (!changed && !force) return;
      resetZoom(); keepAround(); render(); renewIfDue(); announce();
      if (o.onPage) { clearTimeout(saveTimer); saveTimer = setTimeout(() => o.onPage(S.page), 1500); }
    }
    function announce() {
      const text = visiblePages().map((n) => textOf.get(n)).filter(Boolean).join(' ');
      live.textContent = `${pageLabel()}. ${text || 'Page with photos.'}`;
    }

    // ------------------------------------------------------------------ zoom (pinch, double tap, ctrl/trackpad wheel)
    const zoomed = () => S.zoom.s > 1.02;
    function applyZoom() {
      const W = stage.clientWidth, H = stage.clientHeight, z = S.zoom;
      z.s = clamp(z.s, 1, 4); z.x = clamp(z.x, W - W * z.s, 0); z.y = clamp(z.y, H - H * z.s, 0);
      zoomLayer.style.transform = z.s === 1 ? '' : `translate(${z.x}px, ${z.y}px) scale(${z.s})`;
      root.classList.toggle('fb-zoomed', zoomed());
    }
    function resetZoom() { S.zoom = { s: 1, x: 0, y: 0 }; applyZoom(); }
    function zoomAround(px, py, s) {
      const z = S.zoom, k = s / z.s;
      z.x = px - (px - z.x) * k; z.y = py - (py - z.y) * k; z.s = s; applyZoom();
      if (!zoomed()) resetZoom();
    }
    function toggleZoom(px, py) {
      if (zoomed()) return resetZoom();
      const s = 2.5; S.zoom = { s, x: -px * (s - 1), y: -py * (s - 1) }; applyZoom(); // as the app: scale around the tap
    }

    // ------------------------------------------------------------------ gestures
    const pointers = new Map();
    let G = null; // current gesture
    let lastTap = null, tapTimer = null;
    const local = (e) => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const dragSpan = () => (S.spread ? S.pw * 1.6 : S.pw * 0.9);
    stage.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      stage.setPointerCapture?.(e.pointerId);
      pointers.set(e.pointerId, local(e));
      if (pointers.size === 2) { // a pinch: give the page back to zooming
        if (G && G.kind === 'drag' && S.dragging) { S.dragging = false; S.t = 0; S.dir = 0; render(); }
        const [a, b] = [...pointers.values()];
        G = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: S.zoom.s, m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
        return;
      }
      if (pointers.size > 2) return;
      const p = local(e);
      G = { kind: zoomed() ? 'pan' : 'drag', x0: p.x, y0: p.y, last: p, t0: performance.now(), moved: 0, samples: [{ x: p.x, t: performance.now() }],
        zx: S.zoom.x, zy: S.zoom.y, type: e.pointerType };
    });
    stage.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId) || !G) return;
      const p = local(e); pointers.set(e.pointerId, p);
      if (G.kind === 'pinch' && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        zoomAround(G.m.x, G.m.y, clamp(G.s0 * d / G.d0, 1, 4));
        S.zoom.x += m.x - G.m.x; S.zoom.y += m.y - G.m.y; G.m = m; G.s0 = S.zoom.s; G.d0 = d || 1; applyZoom();
        return;
      }
      G.moved = Math.max(G.moved, Math.hypot(p.x - G.x0, p.y - G.y0));
      if (G.kind === 'pan') { S.zoom.x = G.zx + (p.x - G.x0); S.zoom.y = G.zy + (p.y - G.y0); applyZoom(); return; }
      if (G.kind !== 'drag' || S.anim) return;
      const dx = p.x - G.x0;
      G.samples.push({ x: p.x, t: performance.now() }); if (G.samples.length > 6) G.samples.shift();
      if (S.dir === 0) {
        if (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(p.y - G.y0)) return;
        const dir = dx < 0 ? 1 : -1;
        if (dir > 0 ? !canNext() : !canPrev()) return;
        S.dir = dir; S.t = 0; S.dragging = true; render();
      }
      if (!S.dragging) return;
      S.t = clamp(-dx * S.dir / dragSpan(), 0, 1); frame(); // the leaf follows the finger
    });
    const endPointer = async (e, cancelled) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (!G) return;
      if (G.kind === 'pinch') { if (pointers.size === 0) G = null; else { const [p] = [...pointers.values()]; G = { kind: zoomed() ? 'pan' : 'none', x0: p.x, y0: p.y, zx: S.zoom.x, zy: S.zoom.y, moved: 99 }; } return; }
      const g = G; G = null;
      if (S.dragging) {
        S.dragging = false;
        const s = g.samples, first = s[0], last = s[s.length - 1];
        const vx = last.t > first.t ? (last.x - first.x) / ((last.t - first.t) / 1000) : 0;
        const v = vx * -S.dir; // positive = in the turning direction
        if (v > 350 || (S.t > 0.33 && v > -350)) { await animateTo(1, 380 * (1 - S.t) + 120, easeOut); commitTurn(); }
        else { await animateTo(0, 300 * S.t + 80, easeOut); S.dir = 0; render(); }
        return;
      }
      if (cancelled || g.moved > 10 || performance.now() - g.t0 > 600) return;
      tap(local(e), g.type);
    };
    stage.addEventListener('pointerup', (e) => endPointer(e, false));
    stage.addEventListener('pointercancel', (e) => endPointer(e, true));
    stage.addEventListener('lostpointercapture', (e) => endPointer(e, true));
    function tap(p, type) {
      const now = performance.now();
      if (lastTap && now - lastTap.t < 300 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 40) { // double tap: zoom
        clearTimeout(tapTimer); lastTap = null; toggleZoom(p.x, p.y); return;
      }
      lastTap = { t: now, ...p };
      const W = stage.clientWidth, middle = p.x >= W * 0.32 && p.x <= W * 0.68;
      const act = () => {
        if (middle || zoomed()) { if (S.compact) S.chrome ? hideChrome() : showChrome(); return; }
        flip(p.x > W * 0.68 ? 1 : -1);
      };
      if (type === 'mouse' && !middle) { act(); return; } // a mouse click on the edge turns at once
      tapTimer = setTimeout(act, 280); // as the app: wait to see whether it is a double tap
    }
    // iOS Safari: keep its own page zoom out of the book (the book zooms itself)
    for (const ev of ['gesturestart', 'gesturechange']) stage.addEventListener(ev, (e) => e.preventDefault());
    let wheelAcc = 0, wheelAt = 0, wheelLock = 0;
    stage.addEventListener('wheel', (e) => {
      if (e.ctrlKey) { e.preventDefault(); const p = local(e); zoomAround(p.x, p.y, clamp(S.zoom.s * Math.exp(-e.deltaY / 100), 1, 4)); return; }
      if (zoomed()) { e.preventDefault(); S.zoom.x -= e.deltaX; S.zoom.y -= e.deltaY; applyZoom(); return; }
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      const now = performance.now();
      if (now < wheelLock) return;
      if (now - wheelAt > 300) wheelAcc = 0;
      wheelAt = now; wheelAcc += e.deltaX;
      if (Math.abs(wheelAcc) > 80) { flip(wheelAcc > 0 ? 1 : -1); wheelAcc = 0; wheelLock = now + 650; }
    }, { passive: false });
    function onKey(e) {
      if (e.defaultPrevented || e.altKey || e.metaKey || (e.ctrlKey && e.key !== '0')) return;
      if (document.querySelector('dialog[open]') || /^(input|textarea|select)$/i.test(e.target.tagName || '')) return;
      const k = e.key;
      if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') flip(1);
      else if (k === 'ArrowLeft' || k === 'PageUp') flip(-1);
      else if (k === 'Home') goTo(1, false);
      else if (k === 'End') goTo(count, false);
      else if (k === '+' || k === '=') zoomAround(stage.clientWidth / 2, stage.clientHeight / 2, clamp(S.zoom.s * 1.5, 1, 4));
      else if (k === '-' || k === '0' || k === 'Escape') { if (!zoomed()) return; resetZoom(); }
      else return;
      e.preventDefault();
    }
    document.addEventListener('keydown', onKey);

    // ------------------------------------------------------------------ bars, contents, toasts
    let chromeTimer = null;
    function showChrome(autoHide = true) {
      clearTimeout(chromeTimer); S.chrome = true; root.classList.remove('fb-hidden');
      if (autoHide && S.compact) chromeTimer = setTimeout(hideChrome, 4000);
    }
    function hideChrome() { clearTimeout(chromeTimer); if (!S.compact) return; S.chrome = false; root.classList.add('fb-hidden'); }
    root.addEventListener('focusin', (e) => { if (S.compact && (top.contains(e.target) || bottom.contains(e.target))) showChrome(); });
    function updateBars() {
      const views = viewCount();
      label.textContent = pageLabel();
      slider.max = String(Math.max(0, views - 1)); slider.value = String(view());
      slider.hidden = views <= 1;
      slider.setAttribute('aria-valuetext', pageLabel());
      prevBtn.disabled = !canPrev(); nextBtn.disabled = !canNext();
      const can = largeScreen() || window.innerWidth > window.innerHeight;
      spreadBtn.hidden = !can;
      spreadBtn.replaceChildren(icon(S.spread ? 'one' : 'two'));
      spreadBtn.setAttribute('aria-label', S.spread ? 'Show one page' : 'Show two pages');
      spreadBtn.title = S.spread ? 'Show one page' : 'Show two pages';
    }
    slider.addEventListener('input', () => { if (S.dir !== 0) return; setPage(firstPageOf(+slider.value)); });
    function showContents() {
      const entries = [{ title: 'Cover', page: 1 }, ...o.chapters.filter((c) => c.page >= 1 && c.page <= count)];
      let current = 0; entries.forEach((c, i) => { if (c.page <= S.page) current = i; });
      const dlg = el('dialog', { class: 'fb-sheet', 'aria-labelledby': 'fb-toc-h' });
      const list = el('ol', { class: 'fb-toc' }, entries.map((c, i) => el('li', {},
        el('button', { type: 'button', class: i === current ? 'fb-here' : '', 'aria-current': i === current ? 'true' : null,
          onclick: () => { dlg.close(); goTo(c.page, false); } }, el('span', { text: c.title }), el('span', { class: 'fb-num', text: String(c.page) })))));
      dlg.append(el('div', { class: 'fb-sheet-head' }, el('h2', { id: 'fb-toc-h', text: 'Contents' }), iconButton('close', 'Close', () => dlg.close())), list);
      dlg.addEventListener('close', () => { dlg.remove(); stage.focus({ preventScroll: true }); });
      dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
      root.append(dlg); dlg.showModal();
      (list.querySelector('.fb-here') || list.querySelector('button')).focus();
    }
    let toastTimer = null;
    function showToast(text, action) {
      clearTimeout(toastTimer);
      toast.replaceChildren(el('span', { text }), action ? el('button', { type: 'button', class: 'fb-link', text: action.label, onclick: () => { toast.classList.remove('fb-show'); action.onClick(); } }) : null);
      toast.classList.add('fb-show');
      toastTimer = setTimeout(() => toast.classList.remove('fb-show'), 5000);
    }
    async function runPdf() {
      if (!o.pdf || pdfBtn.disabled) return;
      pdfBtn.disabled = true; pdfBtn.classList.add('fb-busy');
      try { await o.pdf(); } catch (_) { showToast('We couldn\'t open the PDF. Please try again.'); }
      pdfBtn.disabled = false; pdfBtn.classList.remove('fb-busy');
    }

    // ------------------------------------------------------------------ layout (rotation, resize, one or two pages)
    const largeScreen = () => Math.min(window.innerWidth, window.innerHeight) >= 600;
    function layout(force) {
      const W = window.innerWidth, H = window.innerHeight, landscape = W > H;
      const wasSpread = S.spread, wasCompact = S.compact;
      S.spread = landscape || largeScreen() ? (S.spreadChoice ?? landscape) : false;
      S.compact = landscape && H < 500;
      root.classList.toggle('fb-compact-mode', S.compact);
      if (S.compact !== wasCompact) { if (S.compact) showChrome(); else { clearTimeout(chromeTimer); S.chrome = true; root.classList.remove('fb-hidden'); } }
      if (wasSpread !== S.spread && S.dir !== 0) { cancelAnimationFrame(S.anim); S.anim = null; S.dir = 0; S.t = 0; S.dragging = false; }
      const pad = S.compact ? 4 : 14;
      const maxW = stage.clientWidth - pad * 2, maxH = stage.clientHeight - pad * 2;
      const pw = Math.max(60, S.spread ? Math.min(maxW / 2, maxH * aspect) : Math.min(maxW, maxH * aspect));
      const changed = force || wasSpread !== S.spread || Math.abs(pw - S.pw) > 0.5;
      S.pw = pw; S.ph = pw / aspect;
      if (changed) { resetZoom(); keepAround(); render(); if (wasSpread !== S.spread) announce(); }
      else updateBars();
    }
    const ro = new ResizeObserver(() => layout(false));
    ro.observe(root);
    const onVisible = () => { if (document.visibilityState === 'visible') renewIfDue(); };
    document.addEventListener('visibilitychange', onVisible);

    // ------------------------------------------------------------------ start
    keepAround();
    layout(true);
    announce();
    if (o.resumed && S.page > 1) showToast(`Picked up where you left off: page ${S.page}`, { label: 'Start over', onClick: () => goTo(1, false) });

    return {
      get page() { return S.page; }, goTo, flip, toast: showToast,
      destroy() {
        S.destroyed = true; cancelAnimationFrame(S.anim); clearTimeout(saveTimer); clearTimeout(chromeTimer); clearTimeout(tapTimer);
        if (o.onPage && saveTimer) o.onPage(S.page);
        ro.disconnect(); document.removeEventListener('keydown', onKey); document.removeEventListener('visibilitychange', onVisible); document.removeEventListener('fullscreenchange', onFull);
        if (document.fullscreenElement === root) document.exitFullscreen().catch(() => {});
        for (const e of imgs.values()) e.img.removeAttribute('src');
        imgs.clear(); root.replaceChildren(); root.className = '';
      },
    };
  }
  window.DcFlipbook = { open, el, icon };
})();
