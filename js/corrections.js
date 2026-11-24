/* books.daycasion.com: requesting changes to a hardcover proof (owner only).
 * While reviewing their book, the member selects Request a Change on a page and chooses a photo, a story or the page:
 * automatic changes (made for them in the updated proof) or personal assistance (our team replies). Changes collect in
 * "Your Requested Changes" (up to 10, kept in this browser until submitted) and are submitted together as the book's
 * one revision (dc_keepsake_request_corrections). Correct Story Text edits the story for this book only (never the
 * memory in the app). On the updated proof, each change shows whether it was completed or needs attention, and our
 * team's replies (dc_keepsake_revision_status). Every limit is checked again on the server. */
(function () {
  'use strict';
  if (window.DC_FRAMED) return;
  const { el, icon } = window.DcBooks;
  const MAX = 10, MAX_ADDED = 5, MAX_PHOTOS = 9, MAX_TEXTS = 5, MAX_TEXT_CHANGES = 500;
  const ASSIST = new Set(['layout', 'other']);
  const kindOf = (type) => (ASSIST.has(type) ? 'assist' : 'auto');
  // the changes offered to members (earlier whole-book options are no longer offered; a stored list drops them)
  const OFFERED = new Set(['photo_uncrop', 'photo_rotate', 'photo_remove', 'photo_replace', 'photo_add', 'memory_remove', 'memory_add',
    'story_update', 'text_edit', 'layout', 'other']);
  const LABEL = { photo_uncrop: 'Show the whole photo', photo_rotate: 'Rotate the photo', photo_remove: 'Remove the photo',
    photo_replace: 'Use a different photo', photo_add: 'Add a photo', memory_update: 'Use my updated story', memory_remove: 'Remove the story',
    memory_add: 'Add a missing story', refresh_all: 'Use my latest memory changes', story_update: 'Update title page and chapter names',
    collages: 'Photo Collages', text_edit: 'Correct story text', layout: 'Page layout needs attention', other: 'Something else' };
  const KIND = { auto: 'Automatic Change', assist: 'Personal Assistance' };
  const TURN = { 90: 'clockwise', 270: 'counterclockwise', 180: 'upside down' };
  const STATUS = { new: 'Sent to our team', in_review: 'Our team is looking at it', awaiting_customer: 'Waiting for your reply', resolved: 'Resolved' };
  const fmtDay = (iso) => (iso ? new Date(String(iso).slice(0, 10) + 'T12:00:00Z').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '');
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
  const kindTag = (k) => el('span', { class: `kindtag ${k}`, text: KIND[k] });

  /** Characters changed (added + removed), as the server counts them (book-engine/src/textdiff.mjs). */
  function changedChars(a, b, cap = Infinity) {
    a = Array.from(String(a ?? '')); b = Array.from(String(b ?? ''));
    let s = 0;
    while (s < a.length && s < b.length && a[s] === b[s]) s++;
    let ea = a.length, eb = b.length;
    while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
    const A = a.slice(s, ea), B = b.slice(s, eb), N = A.length, M = B.length;
    if (!N || !M) return Math.min(N + M, cap + 1);
    const max = Math.min(N + M, cap + 1), off = max + 1, V = new Int32Array(2 * max + 3);
    for (let d = 0; d <= max; d++) {
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || (k !== d && V[off + k - 1] < V[off + k + 1]) ? V[off + k + 1] : V[off + k - 1] + 1;
        let y = x - k;
        while (x < N && y < M && A[x] === B[y]) { x++; y++; }
        V[off + k] = x;
        if (x >= N && y >= M) return d;
      }
    }
    return max;
  }

  function create({ rpc, authed, API, plainErr }) {
    // ------------------------------------------------------------ Your Requested Changes (this browser until submitted)
    const mem = new Map();
    const key = (id) => `dc-corrections:${id}`;
    function list(orderId) {
      let v = null;
      try { v = JSON.parse(localStorage.getItem(key(orderId)) || 'null'); } catch (e) { /* storage off */ }
      return (Array.isArray(v) ? v : mem.get(orderId) || []).filter((x) => OFFERED.has(x.type)).slice(0, MAX);
    }
    function store(orderId, items) {
      mem.set(orderId, items);
      try { if (items.length) localStorage.setItem(key(orderId), JSON.stringify(items)); else localStorage.removeItem(key(orderId)); } catch (e) { /* this tab only */ }
    }
    const same = (a, b) => a.type === b.type && (a.memory_id || null) === (b.memory_id || null) && (a.media_id || null) === (b.media_id || null)
      && (a.type === 'text_edit' || JSON.stringify(a.value || {}) === JSON.stringify(b.value || {}));
    /** Adds (or, with `replace`, updates) a change; returns an error text or null. */
    function add(orderId, item, replace = null) {
      let items = list(orderId);
      if (replace != null) items = items.filter((x) => x.at !== replace);
      const dupe = items.find((x) => kindOf(x.type) === 'auto' && same(x, item));
      if (dupe && item.type !== 'text_edit') return 'That change is already in your list.';
      if (dupe) items = items.filter((x) => x !== dupe); // a story's newer correction replaces the earlier one
      if (item.type === 'photo_rotate') items = items.filter((x) => !(x.type === 'photo_rotate' && x.media_id === item.media_id));
      if (items.length >= MAX) return `You can include up to ${MAX} changes in one revision request. Remove one to add another.`;
      if (item.type === 'memory_add' && items.filter((x) => x.type === 'memory_add').length >= MAX_ADDED) return `You can add up to ${MAX_ADDED} missing stories.`;
      if (item.type === 'text_edit' && items.filter((x) => x.type === 'text_edit').length >= MAX_TEXTS) return `You can correct up to ${MAX_TEXTS} stories in one revision request.`;
      items.push({ ...item, kind: kindOf(item.type), at: replace ?? Date.now() });
      items.sort((a, b) => (a.page ?? 1e9) - (b.page ?? 1e9) || a.at - b.at);
      store(orderId, items);
      return null;
    }
    const remove = (orderId, at) => store(orderId, list(orderId).filter((x) => x.at !== at));

    // ------------------------------------------------------------ the book (memories and photos, the saved book's text)
    const cache = new Map();
    async function book(orderId) {
      if (cache.has(orderId)) return cache.get(orderId);
      const r = await rpc('dc_keepsake_revision_options', { p_order_id: orderId });
      if (!r.ok) throw Object.assign(new Error('options'), { r });
      const opts = r.data;
      let spec = null;
      if (opts.layout_path) { // the member's own saved book: each story exactly as printed
        const s = await authed(`/storage/v1/object/authenticated/keepsakes/${opts.layout_path.split('/').map(encodeURIComponent).join('/')}`).catch(() => null);
        if (s && s.ok && s.data && s.data.manifest) spec = s.data;
      }
      const stories = new Map((spec ? spec.manifest.sections.flatMap((x) => x.items) : []).map((i) => [i.id, i]));
      const b = { opts, spec, stories, memById: new Map((opts.memories || []).map((m) => [m.id, m])) };
      cache.set(orderId, b);
      return b;
    }
    /** What the proof shows: memory -> pages; photo -> { memory_id, pages, cropped }. A proof made before pages listed
     *  their contents finds a page's stories by their titles. */
    function indexOf(manifest, stories) {
      const memories = new Map(), photos = new Map();
      const pagesOf = (m, n) => { if (!memories.has(m)) memories.set(m, []); memories.get(m).push(n); };
      for (const p of manifest.pages || []) {
        if (p.shows) {
          for (const m of p.shows.memories || []) pagesOf(m, p.n);
          for (const ph of p.shows.photos || []) {
            const x = photos.get(ph.id) || { memory_id: ph.memory_id, pages: [], cropped: false };
            x.pages.push(p.n); x.cropped = x.cropped || !!ph.cropped; photos.set(ph.id, x);
          }
        } else {
          const t = norm(p.text);
          for (const s of stories.values()) if (s.title && norm(s.title).length >= 3 && t.includes(norm(s.title))) pagesOf(s.id, p.n);
        }
      }
      const detailed = (manifest.pages || []).some((p) => p.shows);
      return { memories, photos, detailed,
        storiesOn: (n) => [...memories].filter(([, ps]) => ps.includes(n)).map(([m]) => m),
        photosOn: (n) => ((manifest.pages.find((p) => p.n === n) || {}).shows || { photos: [] }).photos };
    }
    async function signMedia(paths) {
      const out = {};
      for (let i = 0; i < paths.length; i += 100) {
        const r = await authed('/storage/v1/object/sign/memory-media', { method: 'POST', body: { expiresIn: 900, paths: paths.slice(i, i + 100) } }).catch(() => null);
        if (!r || !r.ok || !Array.isArray(r.data)) continue;
        for (const x of r.data) if (x.signedURL) out[x.path] = `${API}/storage/v1${x.signedURL.startsWith('/') ? '' : '/'}${x.signedURL}`;
      }
      return out;
    }
    function dialog(cls, titleText) {
      const dlg = el('dialog', { class: `dlg ${cls}`, 'aria-labelledby': 'chg-h' });
      const title = el('h2', { id: 'chg-h', text: titleText });
      const body = el('div', { class: 'inner' });
      dlg.append(el('div', { class: 'dhead' }, title, el('button', { type: 'button', class: 'fb-icon', 'aria-label': 'Close', onclick: () => dlg.close() }, icon('close'))), body);
      dlg.addEventListener('close', () => dlg.remove());
      document.body.append(dlg); dlg.showModal();
      return { dlg, title, body };
    }

    // ------------------------------------------------------------ Correct Story Text (used by the page dialog and the summary)
    function textEditor({ host, story, saved, onSave, onBack }) {
      const orig = { title: story.title || '', body: story.body || '' };
      const start = saved ? saved.value : orig;
      const ti = el('input', { type: 'text', id: 'story-title', value: start.title, maxlength: 300 });
      const ta = el('textarea', { id: 'story-text', rows: Math.max(6, Math.min(16, Math.ceil((story.body || '').length / 70) + 2)), maxlength: 20000 });
      ta.value = start.body;
      const meter = el('div', { class: 'meter', role: 'progressbar', 'aria-label': 'Characters changed', 'aria-valuemin': '0', 'aria-valuemax': String(MAX_TEXT_CHANGES) }, el('span'));
      const count = el('p', { class: 'small count', 'aria-live': 'polite' });
      const msg = el('p', { class: 'err small', role: 'alert' });
      const save = el('button', { type: 'button', class: 'btn', text: 'Save Change' });
      const measure = () => changedChars(orig.title, ti.value.trim(), MAX_TEXT_CHANGES) + changedChars(orig.body, ta.value.replace(/\r\n/g, '\n').trim(), MAX_TEXT_CHANGES);
      const update = () => {
        const n = measure(), over = n > MAX_TEXT_CHANGES;
        meter.firstChild.style.width = `${Math.min(100, (n / MAX_TEXT_CHANGES) * 100)}%`;
        meter.classList.toggle('over', over); meter.setAttribute('aria-valuenow', String(Math.min(n, MAX_TEXT_CHANGES)));
        count.textContent = over ? `More than ${MAX_TEXT_CHANGES} characters changed. Keep corrections small, or ask our team for help with Something Else.`
          : n === 0 ? `No changes yet. You can change up to ${MAX_TEXT_CHANGES} characters in this story.` : `${n} of ${MAX_TEXT_CHANGES} characters changed`;
        count.classList.toggle('err', over);
        save.disabled = over || n === 0;
        msg.textContent = '';
      };
      ti.addEventListener('input', update); ta.addEventListener('input', update);
      save.addEventListener('click', () => {
        const next = { title: ti.value.trim(), body: ta.value.replace(/\r\n/g, '\n').trim() };
        if (!next.body && orig.body) { msg.textContent = 'The story can\'t be left empty.'; ta.focus(); return; }
        onSave({ title: next.title, body: next.body, original_title: orig.title, original_body: orig.body, changed: measure() });
      });
      host.replaceChildren(...[onBack ? el('button', { type: 'button', class: 'textlink', text: '‹ Back', onclick: onBack }) : null,
        el('p', { class: 'lead-in', text: 'Make your corrections below. This changes the story in this book only: your memory in DayCasion stays as it is.' }),
        el('label', { for: 'story-title', text: 'Title' }), ti,
        el('label', { for: 'story-text', text: 'Story' }), ta,
        meter, count,
        el('details', { class: 'original' }, el('summary', { text: 'Show the original text' }),
          el('p', { class: 'orig-title', text: orig.title || '(no title)' }), el('div', { class: 'orig-body', text: orig.body })),
        msg, el('div', { class: 'actions' }, save), kindTag('auto')].filter(Boolean));
      update(); ta.focus();
    }
    function noteEditor({ host, heading, about, saved, onSave, onBack }) {
      const ta = el('textarea', { rows: 5, maxlength: 1000, id: 'chg-note', placeholder: 'For example: a face is cut off at the top, or a name is spelled wrong.' });
      ta.value = saved || '';
      const count = el('span', { class: 'tiny muted' });
      const msg = el('p', { class: 'err small', role: 'alert' });
      const upd = () => { count.textContent = `${ta.value.length.toLocaleString()} / 1,000`; };
      ta.addEventListener('input', upd);
      host.replaceChildren(...[onBack ? el('button', { type: 'button', class: 'textlink', text: '‹ Back', onclick: onBack }) : null,
        heading ? el('p', { class: 'lead-in', text: heading }) : null,
        el('label', { for: 'chg-note', text: `Tell us in your own words${about ? ` (${about})` : ''}` }), ta, el('div', { class: 'counter' }, count),
        msg, el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn', text: 'Save Change', onclick: () => {
          const note = ta.value.trim();
          if (note.length < 5) { msg.textContent = 'Please tell us a little more (at least 5 characters).'; ta.focus(); return; }
          onSave(note);
        } })),
        el('p', { class: 'small muted' }, kindTag('assist'), el('span', { text: ' Our DayCasion team reads every request personally and replies by email.' }))].filter(Boolean));
      upd(); ta.focus();
    }

    // ------------------------------------------------------------ Make a Change to This Page (the proof viewer)
    // pages: printed page numbers on screen; pageUrl(n): that page's image; onAdded(count) after a change is saved
    async function changePage({ orderId, manifest, pages, pageUrl, onAdded, onCover }) {
      const { dlg, title, body } = dialog('wide change', 'Request a Change');
      if (!pages.length) { // only the cover is on screen
        title.textContent = 'The front cover';
        body.replaceChildren(el('p', { text: 'To use a different photo on the front cover, choose Change Cover Photo on your book\'s page. It\'s free and separate from your requested changes.' }),
          el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn', text: 'Change Cover Photo', onclick: () => { dlg.close(); onCover(); } }),
            el('button', { type: 'button', class: 'btn secondary', text: 'Keep reviewing', onclick: () => dlg.close() })));
        return;
      }
      body.replaceChildren(el('p', { class: 'muted', text: 'One moment…' }));
      let B;
      try { B = await book(orderId); } catch (e) {
        if (e.message === 'signed-out') return dlg.close();
        return body.replaceChildren(el('p', { class: 'err', text: plainErr(e.r, 'We couldn\'t open your book\'s details. Please try again.') }));
      }
      if (!B.opts.can_revise) return body.replaceChildren(el('p', { text: 'This book can\'t take more changes. If something isn\'t right, email info@daycasion.com and we\'ll help.' }));
      const ix = indexOf(manifest, B.stories);
      const S = { page: pages[pages.length - 1] };
      const msg = el('p', { class: 'err small', role: 'alert' });
      const titleOf = (m) => (B.stories.get(m) || B.memById.get(m) || {}).title || 'Untitled story';
      const spareOf = (m) => ((B.memById.get(m) || {}).photos || []).filter((p) => !ix.photos.has(p.id));
      const textsUsed = () => list(orderId).filter((x) => x.type === 'text_edit').length;
      const done = (item) => {
        const err = add(orderId, item);
        if (err) { msg.textContent = err; return; }
        dlg.close(); onAdded(list(orderId).length);
      };
      const choice = (label, sub, kind, onclick, extra = {}) => el('button', { type: 'button', class: 'choice', onclick, ...extra },
        el('span', { class: 'ctop' }, el('span', { class: 'ctitle', text: label }), kind ? kindTag(kind) : null),
        sub ? el('span', { class: 'csub', text: sub }) : null);
      const back = (to) => el('button', { type: 'button', class: 'textlink', text: '‹ Back', onclick: to });
      const crop = (ph, n) => { // the photo as it appears on the page (a crop of the page image)
        const box = el('span', { class: 'pcrop' });
        const url = pageUrl(n), a = manifest.page_aspect || 0.8;
        box.style.aspectRatio = String(Math.max(0.3, Math.min(3, (ph.w * a) / ph.h)));
        if (url) {
          box.style.backgroundImage = `url("${url}")`;
          box.style.backgroundSize = `${100 / ph.w}% ${100 / ph.h}%`;
          box.style.backgroundPosition = `${ph.w < 1 ? (ph.x / (1 - ph.w)) * 100 : 0}% ${ph.h < 1 ? (ph.y / (1 - ph.h)) * 100 : 0}%`;
        }
        return box;
      };
      const pagePicker = () => (pages.length < 2 ? null : el('div', { class: 'seg', role: 'group', 'aria-label': 'Which page?' }, pages.map((n) => el('button', {
        type: 'button', class: n === S.page ? 'on' : '', 'aria-pressed': n === S.page ? 'true' : 'false', text: `Page ${n}`, onclick: () => { S.page = n; stepPage(); } }))));

      function stepPage() {
        const n = S.page;
        title.textContent = `What would you like to change on page ${n}?`;
        const photos = ix.photosOn(n), stories = ix.storiesOn(n).filter((m) => B.stories.has(m) || B.memById.has(m));
        body.replaceChildren(...[pagePicker(),
          el('p', { class: 'lead-in', text: 'Choose a photo, a story or the whole page.' }),
          el('div', { class: 'legend' }, el('span', {}, kindTag('auto'), el('span', { text: ' made for you in your updated proof' })),
            el('span', {}, kindTag('assist'), el('span', { text: ' reviewed by our team, who reply by email' }))),
          msg,
          photos.length ? el('h3', { class: 'sub', text: 'Photos on this page' }) : null,
          photos.length ? el('div', { class: 'crop-grid' }, photos.map((ph, k) => el('button', { type: 'button', class: 'crop-tile',
            'aria-label': `Photo ${k + 1} on page ${n}, from "${titleOf(ph.memory_id)}"`, onclick: () => stepPhoto(ph) }, crop(ph, n),
            el('span', { class: 'tiny muted', text: titleOf(ph.memory_id) })))) : null,
          stories.length ? el('h3', { class: 'sub', text: stories.length === 1 ? 'The story on this page' : 'Stories on this page' }) : null,
          stories.length ? el('div', { class: 'choices' }, stories.map((m) => {
            const mm = B.memById.get(m) || {};
            return choice(titleOf(m), [fmtDay(mm.date), mm.chapter].filter(Boolean).join(' · ') || 'Correct its text, add or remove photos, and more', null, () => stepStory(m));
          })) : null,
          el('h3', { class: 'sub', text: 'This page' }),
          el('div', { class: 'choices' },
            choice('Page layout needs attention', 'Something about how this page looks. Tell us and we\'ll take care of it.', 'assist', () => stepNote('layout', {})),
            choice('A story is missing', B.opts.family === 'yir' ? 'Add a story from this book\'s year.' : 'Add a story from your Life Story.', 'auto', () => stepMissing()),
            choice('Something else', 'Anything else you\'d like changed, in your own words.', 'assist', () => stepNote('other', {})))].filter(Boolean));
      }
      function stepPhoto(ph) {
        const info = ix.photos.get(ph.id) || {}, spare = spareOf(ph.memory_id);
        title.textContent = 'This photo';
        body.replaceChildren(back(stepPage), msg, el('div', { class: 'photo-head' }, crop(ph, S.page),
          el('p', { class: 'muted small', text: `From "${titleOf(ph.memory_id)}" on page ${S.page}` })),
        el('div', { class: 'choices' }, ...[
          info.cropped ? choice('Show the whole photo', 'Part of it is cut off here. We\'ll show all of it.', 'auto', () => done({ type: 'photo_uncrop', page: S.page, media_id: ph.id,
            summary: 'Show the whole photo', story: titleOf(ph.memory_id) })) : null,
          choice('Rotate the photo', 'It\'s sideways or upside down.', 'auto', () => stepTurn(ph)),
          choice('Use a different photo', spare.length ? `Choose from ${plural(spare.length, 'other photo')} of this story.` : 'This story has no other photos. You can add one in the DayCasion app.',
            'auto', () => stepPick(ph.memory_id, ph), { disabled: !spare.length }),
          choice('Remove this photo', 'Leave it out of the book.', 'auto', () => done({ type: 'photo_remove', page: S.page, media_id: ph.id, summary: 'Remove the photo', story: titleOf(ph.memory_id) })),
          choice('Something else about this photo', 'For example a face is cut off, or it\'s the wrong photo.', 'assist', () => stepNote('other', { media_id: ph.id, memory_id: ph.memory_id }, ph))].filter(Boolean)));
      }
      function stepTurn(ph) {
        title.textContent = 'Rotate the photo';
        const opt = (deg, label) => el('button', { type: 'button', class: 'crop-tile turn', onclick: () => done({ type: 'photo_rotate', page: S.page, media_id: ph.id, value: { degrees: deg },
          summary: `Rotate the photo ${TURN[deg]}`, story: titleOf(ph.memory_id) }) }, (() => { const c = crop(ph, S.page); c.style.transform = `rotate(${deg}deg)`; return el('span', { class: 'turnbox' }, c); })(),
          el('span', { class: 'small', text: label }));
        body.replaceChildren(back(() => stepPhoto(ph)), msg, el('p', { class: 'lead-in', text: 'Which one looks right?' }),
          el('div', { class: 'crop-grid' }, opt(90, 'Clockwise'), opt(270, 'Counterclockwise'), opt(180, 'Upside down')));
      }
      async function stepPick(memId, replacing) {
        const spare = spareOf(memId);
        title.textContent = replacing ? 'Choose a different photo' : 'Choose a photo to add';
        const tiles = spare.map((p) => el('button', { type: 'button', class: 'photo-tile', 'aria-label': 'Use this photo', onclick: () => done(replacing
          ? { type: 'photo_replace', page: S.page, media_id: replacing.id, value: { with: p.id }, summary: 'Use a different photo', story: titleOf(memId) }
          : { type: 'photo_add', page: S.page, memory_id: memId, value: { with: p.id }, summary: 'Add a photo', story: titleOf(memId) }) },
          el('span', { class: 'ph' }, el('img', { alt: '', 'data-photo': p.thumb_path || '', hidden: true }))));
        body.replaceChildren(back(replacing ? () => stepPhoto(replacing) : () => stepStory(memId)), msg,
          el('p', { class: 'lead-in', text: `Photos of "${titleOf(memId)}" that aren't in your book yet.` }), el('div', { class: 'photo-grid' }, tiles));
        const urls = await signMedia([...new Set(spare.map((p) => p.thumb_path).filter(Boolean))]);
        for (const img of body.querySelectorAll('img[data-photo]')) if (urls[img.dataset.photo]) { img.referrerPolicy = 'no-referrer'; img.src = urls[img.dataset.photo]; img.hidden = false; }
      }
      function stepStory(memId) {
        const mm = B.memById.get(memId) || {}, spare = spareOf(memId), story = B.stories.get(memId);
        const shown = (mm.photos || []).filter((p) => ix.photos.has(p.id)).length, full = textsUsed() >= MAX_TEXTS;
        title.textContent = titleOf(memId);
        body.replaceChildren(back(stepPage), msg, el('div', { class: 'choices' }, ...[
          story ? choice('Correct story text', full ? `You've corrected ${MAX_TEXTS} stories, the most for one revision request.` : 'Fix a typo, a name or a date in this book.', 'auto',
            () => stepText(memId), { disabled: full }) : null,
          ix.detailed ? choice('Add a photo', shown >= MAX_PHOTOS ? `A story can show up to ${MAX_PHOTOS} photos.` : spare.length ? `Choose from ${plural(spare.length, 'photo')} of this story not in your book.`
            : 'All of this story\'s photos are in your book. You can add one in the DayCasion app.', 'auto', () => stepPick(memId, null), { disabled: !spare.length || shown >= MAX_PHOTOS }) : null,
          choice('Remove this story', 'Leave it out of the book.', 'auto', () => done({ type: 'memory_remove', page: S.page, memory_id: memId, summary: 'Remove the story', story: titleOf(memId) })),
          choice('Something else about this story', 'Tell us in your own words.', 'assist', () => stepNote('other', { memory_id: memId }))].filter(Boolean)));
      }
      function stepText(memId) {
        title.textContent = 'Correct Story Text';
        const host = el('div');
        body.replaceChildren(msg, host);
        textEditor({ host, story: B.stories.get(memId), onBack: () => stepStory(memId),
          onSave: (value) => done({ type: 'text_edit', page: S.page, memory_id: memId, value, summary: 'Correct story text', story: titleOf(memId) }) });
      }
      function stepMissing() {
        title.textContent = 'Add a Missing Story';
        const missing = (B.opts.memories || []).filter((m) => !ix.memories.has(m.id) && !B.stories.has(m.id));
        const q = el('input', { type: 'text', placeholder: 'Search by title', 'aria-label': 'Search your stories' });
        const results = el('div', { class: 'choices scroll' });
        const show = () => {
          const t = q.value.trim().toLowerCase();
          const rows = missing.filter((m) => !t || (m.title || '').toLowerCase().includes(t)).slice(0, 60);
          results.replaceChildren(...(rows.length ? rows.map((m) => choice(m.title || 'Untitled story', [fmtDay(m.date), m.chapter, plural(m.photos.length, 'photo')].filter(Boolean).join(' · '), null,
            () => done({ type: 'memory_add', page: S.page, memory_id: m.id, summary: 'Add a missing story', story: m.title || 'Untitled story' })))
            : [el('p', { class: 'muted', text: missing.length ? 'No story matches.' : 'Every story is already in your book.' })]));
        };
        q.addEventListener('input', show);
        body.replaceChildren(back(stepPage), msg, el('p', { class: 'lead-in', text: B.opts.family === 'yir'
          ? 'Stories from this book\'s year that aren\'t in it. The story is added with its own photos.'
          : 'Stories in your Life Story that aren\'t in the book. To add a different memory, place it in a chapter of your Life Story in the app first.' }), q, results,
          el('p', { class: 'small muted' }, kindTag('auto'), el('span', { text: ' The story is placed where it belongs; later pages move to make room.' })));
        show(); q.focus();
      }
      function stepNote(type, target, ph) {
        const about = target.media_id ? 'this photo' : target.memory_id ? `"${titleOf(target.memory_id)}"` : `page ${S.page}`;
        title.textContent = type === 'layout' ? 'Page layout needs attention' : 'What would you like to change?';
        const host = el('div');
        body.replaceChildren(msg, host);
        noteEditor({ host, about, heading: type === 'layout' ? `What would you like changed about how page ${S.page} looks?` : null,
          onBack: ph ? () => stepPhoto(ph) : target.memory_id ? () => stepStory(target.memory_id) : stepPage,
          onSave: (note) => done({ type, page: S.page, memory_id: target.memory_id || null, media_id: target.media_id || null, note,
            summary: LABEL[type], story: target.memory_id ? titleOf(target.memory_id) : null }) });
      }
      stepPage();
    }

    // ------------------------------------------------------------ the book's page: Let's make your book just right
    // One action: changes are requested on the page itself, in the viewer (Request a Change)
    function welcome({ openBook }) {
      return el('section', { class: 'card welcome', 'aria-labelledby': 'welcome-h' },
        el('h2', { id: 'welcome-h', text: 'Let\'s make your book just right.' }),
        el('p', { text: 'As you review your book, you can request changes to individual stories, photos or pages. Many changes can be made automatically. If you need something more personal, our DayCasion team is here to help.' }),
        el('p', { text: `You can include up to ${MAX} changes in one revision request. Once submitted, we'll prepare an updated proof for you to review before printing.` }),
        el('ol', { class: 'steps' },
          el('li', {}, el('strong', { text: 'Review your book' }), el('span', { text: 'Turn every page, just as it will be printed. The light PROOF mark isn\'t printed.' })),
          el('li', {}, el('strong', { text: 'Request a change' }), el('span', { text: 'On any page, choose a story, a photo or the page.' })),
          el('li', {}, el('strong', { text: 'Submit your changes' }), el('span', { text: 'All together, as one revision request.' })),
          el('li', {}, el('strong', { text: 'Review your updated proof' }), el('span', { text: 'Then approve it for printing in the DayCasion app.' }))),
        el('div', { class: 'kinds' },
          el('div', { class: 'kind auto' }, el('h3', { text: 'Automatic Changes' }),
            el('p', { text: 'Adjustments DayCasion makes for you: correct a story\'s text, rotate, replace, add or remove a photo, add or remove a story.' })),
          el('div', { class: 'kind assist' }, el('h3', { text: 'Personal Assistance' }),
            el('p', { text: 'For anything else, like a page layout that needs attention. Our team reviews your request and replies by email.' }))),
        el('div', { class: 'actions' }, el('a', { class: 'btn', href: openBook, text: 'Review My Book' })));
    }

    /** Your Requested Changes: the list, the counter, Book Details and Submit My Changes. */
    function summary({ book: b, email, onChange, onSubmitted }) {
      const orderId = b.id, items = list(orderId);
      const wrap = el('section', { class: 'card requested', 'aria-labelledby': 'req-h' });
      const auto = items.filter((x) => x.kind === 'auto'), assist = items.filter((x) => x.kind === 'assist');
      const meter = el('div', { class: 'meter', role: 'progressbar', 'aria-label': 'Changes in this request', 'aria-valuemin': '0', 'aria-valuemax': String(MAX), 'aria-valuenow': String(items.length) }, el('span'));
      meter.firstChild.style.width = `${(items.length / MAX) * 100}%`;
      const row = (x) => el('li', {},
        el('div', { class: 'what' },
          el('span', { class: 'where', text: [x.page ? `Page ${x.page}` : 'Book details', x.story].filter(Boolean).join(' · ') }),
          el('span', { class: 'req', text: x.summary || LABEL[x.type] }),
          x.type === 'text_edit' ? el('span', { class: 'small muted', text: `${plural(x.value.changed || 0, 'character')} changed` }) : null,
          x.note ? el('span', { class: 'small muted quote', text: `"${x.note}"` }) : null,
          kindTag(x.kind)),
        el('div', { class: 'rowact' },
          x.type === 'text_edit' || x.note ? el('button', { type: 'button', class: 'textlink', text: 'Edit', 'aria-label': `Edit: ${x.summary || LABEL[x.type]}`, onclick: () => edit(x) }) : null,
          el('button', { type: 'button', class: 'textlink danger', text: 'Remove', 'aria-label': `Remove: ${x.summary || LABEL[x.type]}`, onclick: () => { remove(orderId, x.at); onChange(); } })));
      const detailsAdded = items.some((x) => x.type === 'story_update');
      wrap.append(el('div', { class: 'reqhead' }, el('h2', { id: 'req-h', text: 'Your Requested Changes' }),
        el('span', { class: 'counter-big', text: `${items.length} of ${MAX} changes` })), meter,
      items.length ? el('ul', { class: 'req-list' }, items.map(row))
        : el('p', { class: 'muted', text: 'No changes yet. Open your book and select Request a Change on any page you\'d like changed.' }),
      el('div', { class: 'bookdetails' }, el('h3', { text: 'Book Details' }),
        el('p', { class: 'small muted', text: b.family === 'yir' ? 'Changed a name in the DayCasion app? We can use it on the title page.' : 'Changed a name or chapter title in the DayCasion app? We can use them on the title page and chapter headings.' }),
        el('button', { type: 'button', class: 'btn small secondary', disabled: detailsAdded,
          text: detailsAdded ? 'Added to your changes' : (b.family === 'yir' ? 'Update Title Page' : 'Update Title Page and Chapter Names'),
          onclick: () => { const err = add(orderId, { type: 'story_update', summary: LABEL.story_update }); if (err) alert(err); onChange(); } })),
      el('div', { class: 'submitbox' },
        el('p', { class: 'small', text: 'All of your changes are submitted together as one revision request. Your book can be revised once, so add everything you\'d like first.' }),
        el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn', text: 'Submit My Changes', disabled: !items.length, onclick: () => confirmSubmit() }))));
      return wrap;

      async function edit(x) {
        const { dlg, title, body } = dialog('wide change', x.type === 'text_edit' ? 'Correct Story Text' : 'What would you like to change?');
        if (x.type === 'text_edit') {
          body.replaceChildren(el('p', { class: 'muted', text: 'One moment…' }));
          let B; try { B = await book(orderId); } catch (e) { return body.replaceChildren(el('p', { class: 'err', text: plainErr(e.r, 'Please try again.') })); }
          const story = B.stories.get(x.memory_id);
          if (!story) return body.replaceChildren(el('p', { class: 'err', text: 'This story is no longer in your book.' }));
          textEditor({ host: body, story, saved: x, onSave: (value) => { const err = add(orderId, { ...x, value }, x.at); if (err) return alert(err); dlg.close(); onChange(); } });
        } else {
          title.textContent = LABEL[x.type];
          noteEditor({ host: body, saved: x.note, about: x.story ? `"${x.story}"` : x.page ? `page ${x.page}` : null,
            onSave: (note) => { add(orderId, { ...x, note }, x.at); dlg.close(); onChange(); } });
        }
      }
      function confirmSubmit() {
        const n = items.length;
        const { dlg, body } = dialog('', n === 1 ? 'Ready to Submit Your Change?' : 'Ready to Submit Your Changes?');
        const msg = el('p', { class: 'err small', role: 'alert' });
        const go = el('button', { type: 'button', class: 'btn', text: 'Submit My Changes', onclick: async () => {
          go.disabled = true; msg.textContent = '';
          const r = await rpc('dc_keepsake_request_corrections', { p_order_id: orderId, p_items: list(orderId).map((x) => ({ type: x.type, page: x.page ?? null,
            memory_id: x.memory_id ?? null, media_id: x.media_id ?? null, value: x.value ? (x.type === 'text_edit'
              ? { title: x.value.title, body: x.value.body, original_title: x.value.original_title, original_body: x.value.original_body } : x.value) : {}, note: x.note ?? null })) });
          if (!r.ok) { go.disabled = false; msg.textContent = plainErr(r, 'Please try again.'); return; }
          store(orderId, []); dlg.close(); onSubmitted(r.data.order_id, { auto: auto.length, assist: assist.length });
        } });
        body.append(
          el('p', {}, 'Your book includes ', el('strong', { text: 'ONE revision request' }), `, with up to ${MAX} individual changes.`),
          el('p', {}, 'You\'re about to submit ', el('strong', { text: plural(n, 'change') }), '.'),
          el('p', {}, el('strong', { text: 'Important:' }),
            ' Once submitted, you cannot submit another revision request for this book. Please make sure you\'ve included everything you\'d like changed.'),
          el('p', { text: 'We\'ll prepare an updated proof for your review before printing. Cover photo changes remain separate and do not use your revision.' }),
          msg, el('div', { class: 'actions' }, go, el('button', { type: 'button', class: 'btn secondary', text: 'Keep Reviewing', onclick: () => dlg.close() })));
      }
    }

    /** After submitting: what happens next. */
    function submitted({ auto, assist, email }) {
      const { dlg, body } = dialog('', 'Thank you! Your changes have been submitted.');
      body.append(el('ol', { class: 'next' },
        auto ? el('li', { text: `We're making your ${plural(auto, 'automatic change')} and preparing your updated proof. It usually takes a few minutes, and this page updates by itself.` }) : null,
        assist ? el('li', { text: `Our team will review your ${assist === 1 ? 'request' : `${assist} requests`} personally and reply to ${email || 'your account email'}.` }) : null,
        el('li', { text: 'Review your updated proof. When you\'re happy with it, approve it for printing in the DayCasion app.' })),
      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn', text: 'OK', onclick: () => dlg.close() })));
    }

    // ------------------------------------------------------------ the updated proof: what happened to each change
    function results({ book: b, readHref }) {
      const wrap = el('section', { class: 'card requested done', 'aria-labelledby': 'res-h' }, el('h2', { id: 'res-h', text: 'Your Requested Changes' }),
        el('p', { class: 'muted', text: 'One moment…' }));
      (async () => {
        const r = await rpc('dc_keepsake_revision_status', { p_order_id: b.id });
        if (!r.ok) { wrap.lastChild.textContent = plainErr(r, 'We couldn\'t load your requested changes.'); return; }
        const s = r.data, items = s.items || [];
        const making = b.status === 'queued' || b.status === 'generating';
        const pagesLink = (ps) => (ps && ps.length ? el('span', {}, ' See ', ...[...new Set(ps)].slice(0, 3).flatMap((n, k) => [k ? ', ' : '',
          el('a', { href: readHref(n), text: `page ${n}` })]), '.') : null);
        const autoItems = items.filter((i) => i.kind === 'auto'), assist = items.filter((i) => i.kind === 'assist');
        const doneItems = autoItems.filter((i) => i.status === 'applied'), attention = autoItems.filter((i) => !making && i.status !== 'applied');
        const what = (i) => `${i.label}${i.type === 'collages' ? ` ${i.value && i.value.on ? 'on' : 'off'}` : ''}`;
        const line = (i, mark, cls, text, extra) => el('li', { class: cls }, el('span', { class: 'mark', 'aria-hidden': 'true', text: mark }),
          el('span', { class: 'what' }, el('span', { class: 'where', text: [i.page ? `Page ${i.page}` : null, i.memory_title].filter(Boolean).join(' · ') || 'Your book' }),
            el('span', { class: 'req', text: what(i) }), text ? el('span', { class: 'small', text }, extra || null) : extra || null));
        const notes = (s.notes || []).map((n) => n.kind === 'memory_gone' ? `"${n.title}" isn't in your book any more, because it was deleted in the DayCasion app.`
          : n.kind === 'photos_gone' ? `${plural(n.count, 'photo')} of "${n.title}" ${n.count === 1 ? 'was' : 'were'} deleted in the DayCasion app, so ${n.count === 1 ? 'it isn\'t' : 'they aren\'t'} in your book any more.`
          : n.kind === 'foreword_removed' ? 'The foreword mentioned a story that is no longer in your book, so it was left out.'
          : n.kind === 'intro_removed' ? 'A chapter introduction mentioned a story that is no longer in your book, so it was left out.' : null).filter(Boolean);
        const open = s.open_personal || 0;
        const blocks = [wrap.firstChild,
          making ? el('p', { class: 'lead-in', text: 'We\'re making your changes now. Your updated proof usually takes a few minutes; this page updates by itself.' })
            : el('p', { class: 'lead-in', text: open ? `Your updated proof is ready to review. Our team is still looking at ${open === 1 ? 'your request' : `${open} of your requests`}; we'll email you.`
              : attention.length ? 'Your updated proof is ready to review. A change needs attention: see below.' : 'Your updated proof is ready to review, with your changes.' }),
          !making && s.previous && s.previous.page_count && b.page_count && b.page_count !== s.previous.page_count
            ? el('p', { class: 'small muted', text: `Your book is now ${b.page_count} pages (it was ${s.previous.page_count}).` }) : null,
          making && autoItems.length ? el('h3', { class: 'sub', text: 'Being made' }) : null,
          making && autoItems.length ? el('ul', { class: 'result-list' }, autoItems.map((i) => line(i, '…', 'wait', 'Being made now.'))) : null,
          doneItems.length && !making ? el('h3', { class: 'sub', text: 'Completed' }) : null,
          doneItems.length && !making ? el('ul', { class: 'result-list' }, doneItems.map((i) => line(i, '✓', 'applied', null, pagesLink(i.pages)))) : null,
          attention.length ? el('h3', { class: 'sub', text: 'Needs attention' }) : null,
          attention.length ? el('ul', { class: 'result-list' }, attention.map((i) => line(i, '!', 'not_applied', i.message || ''))) : null,
          notes.length ? el('div', { class: 'note' }, el('strong', { text: 'Also good to know' }), el('ul', {}, notes.map((t) => el('li', { text: t })))) : null,
          assist.length ? el('h3', { class: 'sub', text: 'With our team' }) : null,
          assist.length ? el('ul', { class: 'result-list' }, assist.map((i) => el('li', { class: `assist ${i.status}` },
            el('span', { class: `chip ${i.status === 'resolved' ? 'off' : ''}`, text: STATUS[i.status] || i.status }),
            el('span', { class: 'what' }, el('span', { class: 'where', text: [i.page ? `Page ${i.page}` : null, i.memory_title].filter(Boolean).join(' · ') }),
              el('span', { class: 'req', text: i.escalated ? 'A change we\'re handling for you' : i.label }),
              i.note && !i.escalated ? el('span', { class: 'small quote', text: `"${i.note}"` }) : null,
              i.staff_reply ? el('span', { class: 'small reply' }, el('strong', { text: 'From the DayCasion team: ' }), el('span', { text: i.staff_reply })) : null)))) : null,
          open ? el('p', { class: 'small', text: `You can approve your book once we've answered ${open === 1 ? 'your request' : `all ${open} requests`}.` }) : null];
        wrap.replaceChildren(...blocks.filter(Boolean));
      })();
      return wrap;
    }

    return { list, changePage, welcome, summary, submitted, results, changedChars };
  }
  window.DcCorrections = { create, changedChars };
})();
