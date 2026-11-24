/* books.daycasion.com: corrections to a hardcover proof (owner only). "Report a problem" on a page of the proof, the
 * list of corrections (up to 10, kept in this browser until they are sent), sending them as the book's one revision
 * (dc_keepsake_request_corrections), and what happened to each one (dc_keepsake_revision_status).
 * Automatic corrections are made by DayCasion from the saved book (nothing else changes); "Page layout looks wrong"
 * and "Something else" go to the DayCasion team, who answer personally. Every check is repeated on the server. */
(function () {
  'use strict';
  if (window.DC_FRAMED) return;
  const { el, icon } = window.DcBooks;
  const MAX = 10, MAX_ADDED = 5, MAX_PHOTOS = 9;
  const kindOf = (type) => (type === 'layout' || type === 'other' ? 'assist' : 'auto');
  const LABEL = { photo_uncrop: 'Show the whole photo', photo_rotate: 'Turn the photo', photo_remove: 'Remove the photo',
    photo_replace: 'Use a different photo', photo_add: 'Add a photo', memory_update: 'Use my updated memory', memory_remove: 'Remove the memory',
    memory_add: 'Add a missing memory', refresh_all: 'Use all my latest memory changes', story_update: 'Update the title page and chapter names',
    collages: 'Photo Collages', layout: 'Page layout looks wrong', other: 'Something else' };
  const TURN = { 90: 'a quarter turn clockwise', 270: 'a quarter turn counterclockwise', 180: 'upside down' };
  const STATUS = { new: 'Sent to our team', in_review: 'Our team is looking at it', awaiting_customer: 'Waiting for your reply', resolved: 'Resolved' };
  const fmtDay = (iso) => (iso ? new Date(String(iso).slice(0, 10) + 'T12:00:00Z').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '');

  function create({ rpc, authed, API, plainErr }) {
    // ------------------------------------------------------------ the list (this browser only until it is sent)
    const mem = new Map();
    const key = (id) => `dc-corrections:${id}`;
    function list(orderId) {
      try { const v = JSON.parse(localStorage.getItem(key(orderId)) || 'null'); if (Array.isArray(v)) return v.slice(0, MAX); } catch (e) { /* storage off */ }
      return mem.get(orderId) || [];
    }
    function store(orderId, items) {
      mem.set(orderId, items);
      try { if (items.length) localStorage.setItem(key(orderId), JSON.stringify(items)); else localStorage.removeItem(key(orderId)); } catch (e) { /* this tab only */ }
    }
    const same = (a, b) => a.type === b.type && (a.memory_id || null) === (b.memory_id || null) && (a.media_id || null) === (b.media_id || null)
      && JSON.stringify(a.value || {}) === JSON.stringify(b.value || {}) && kindOf(a.type) === 'auto';
    /** Adds a correction; returns an error text or null. */
    function add(orderId, item) {
      const items = list(orderId);
      if (items.some((x) => same(x, item))) return 'That correction is already in your list.';
      // one turn per photo, one choice per book-wide option: the newer one replaces the older
      const next = items.filter((x) => !((x.type === item.type && ['photo_rotate', 'collages', 'refresh_all', 'story_update'].includes(x.type)
        && (x.media_id || null) === (item.media_id || null))));
      if (next.length >= MAX) return `A revision can include up to ${MAX} corrections. Remove one to add another.`;
      if (item.type === 'memory_add' && next.filter((x) => x.type === 'memory_add').length >= MAX_ADDED) return `You can add up to ${MAX_ADDED} missing memories.`;
      next.push({ ...item, kind: kindOf(item.type), at: Date.now() });
      store(orderId, next);
      return null;
    }
    const remove = (orderId, at) => store(orderId, list(orderId).filter((x) => x.at !== at));

    // ------------------------------------------------------------ what can be corrected
    const optionsCache = new Map();
    async function options(orderId) {
      if (optionsCache.has(orderId)) return optionsCache.get(orderId);
      const r = await rpc('dc_keepsake_revision_options', { p_order_id: orderId });
      if (!r.ok) throw Object.assign(new Error('options'), { r });
      optionsCache.set(orderId, r.data);
      return r.data;
    }
    /** What the proof shows (its page index): memory -> pages; photo -> { memory_id, pages, cropped }. Older proofs have none. */
    function indexOf(manifest) {
      const memories = new Map(), photos = new Map();
      for (const p of manifest.pages || []) {
        if (!p.shows) continue;
        for (const m of p.shows.memories || []) { if (!memories.has(m)) memories.set(m, []); memories.get(m).push(p.n); }
        for (const ph of p.shows.photos || []) {
          const x = photos.get(ph.id) || { memory_id: ph.memory_id, pages: [], cropped: false };
          x.pages.push(p.n); x.cropped = x.cropped || !!ph.cropped; photos.set(ph.id, x);
        }
      }
      return { memories, photos, available: (manifest.pages || []).some((p) => p.shows) };
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

    // ------------------------------------------------------------ Report a problem on this page
    // pages: printed page numbers on screen; pageUrl(n): that page's image; onAdded(count) after a correction is added
    async function report({ orderId, manifest, pages, pageUrl, onAdded, onCover }) {
      const dlg = el('dialog', { class: 'dlg wide report', 'aria-labelledby': 'report-h' });
      const title = el('h2', { id: 'report-h', text: 'Report a problem' });
      const body = el('div', { class: 'inner' }, el('p', { class: 'muted', text: 'Loading…' }));
      dlg.append(el('div', { class: 'dhead' }, title, el('button', { type: 'button', class: 'fb-icon', 'aria-label': 'Close', onclick: () => dlg.close() }, icon('close'))), body);
      dlg.addEventListener('close', () => dlg.remove());
      document.body.append(dlg); dlg.showModal();
      if (!pages.length) { // only the cover is on screen
        title.textContent = 'The cover';
        body.replaceChildren(el('p', { text: 'To use another photo on the front cover, choose Change cover photo on the review page. It\'s free and doesn\'t use your revision.' }),
          el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn', text: 'Change cover photo', onclick: () => { dlg.close(); onCover(); } }),
            el('button', { type: 'button', class: 'btn secondary', text: 'Close', onclick: () => dlg.close() })));
        return;
      }
      let opts;
      try { opts = await options(orderId); } catch (e) {
        if (e.message === 'signed-out') return dlg.close();
        return body.replaceChildren(el('p', { class: 'err', text: plainErr(e.r, 'We couldn\'t load your book. Please try again.') }));
      }
      if (!opts.can_revise) return body.replaceChildren(el('p', { text: 'This proof can\'t be corrected any more. If something is wrong, email info@daycasion.com.' }));
      const ix = indexOf(manifest);
      const memById = new Map((opts.memories || []).map((m) => [m.id, m]));
      const inBookPhoto = (id) => ix.photos.has(id);
      const spareOf = (memId) => ((memById.get(memId) || {}).photos || []).filter((p) => !inBookPhoto(p.id));
      const pageShows = (n) => (manifest.pages.find((p) => p.n === n) || {}).shows || { memories: [], photos: [] };
      const titleOf = (memId) => (memById.get(memId) || {}).title || 'Untitled memory';
      const msg = el('p', { class: 'err small', role: 'alert' });
      const S = { page: pages[pages.length - 1] };

      const done = (item) => {
        const err = add(orderId, item);
        if (err) { msg.textContent = err; return; }
        dlg.close(); onAdded(list(orderId).length);
      };
      const choice = (label, sub, onclick, extra = {}) => el('button', { type: 'button', class: 'choice', onclick, ...extra },
        el('span', { class: 'ctitle', text: label }), sub ? el('span', { class: 'csub', text: sub }) : null);
      const back = (to) => el('button', { type: 'button', class: 'textlink', text: '‹ Back', onclick: to });
      const crop = (ph, n) => { // the photo as it appears on the page (a crop of the page image)
        const box = el('span', { class: 'pcrop' });
        const url = pageUrl(n); const a = manifest.page_aspect || 0.8;
        box.style.aspectRatio = String(Math.max(0.3, Math.min(3, (ph.w * a) / ph.h)));
        if (url) {
          box.style.backgroundImage = `url("${url}")`;
          box.style.backgroundSize = `${100 / ph.w}% ${100 / ph.h}%`;
          box.style.backgroundPosition = `${ph.w < 1 ? (ph.x / (1 - ph.w)) * 100 : 0}% ${ph.h < 1 ? (ph.y / (1 - ph.h)) * 100 : 0}%`;
        }
        return box;
      };
      const kindNote = (auto) => el('p', { class: `kindnote ${auto ? 'auto' : 'assist'}` }, el('strong', { text: auto ? 'Automatic: ' : 'Personal help: ' }),
        el('span', { text: auto ? 'we make this change for you in your new proof, and nothing else in your book changes.'
          : `our team looks at it personally and emails you at ${opts.email || 'your account email'}. You can approve your book once we've answered.` }));

      function pagePicker() {
        if (pages.length < 2) return null;
        return el('div', { class: 'seg', role: 'group', 'aria-label': 'Page' }, pages.map((n) => el('button', { type: 'button', class: n === S.page ? 'on' : '',
          'aria-pressed': n === S.page ? 'true' : 'false', text: `Page ${n}`, onclick: () => { S.page = n; stepPage(); } })));
      }
      function stepPage() {
        const n = S.page, shows = pageShows(n);
        title.textContent = `Report a problem on page ${n}`;
        const photos = shows.photos || [], mems = (shows.memories || []).filter((m) => memById.has(m));
        const kids = [pagePicker(), msg];
        if (ix.available && photos.length) {
          kids.push(el('h3', { class: 'sub', text: 'A photo on this page' }), el('div', { class: 'crop-grid' }, photos.map((ph, k) =>
            el('button', { type: 'button', class: 'crop-tile', 'aria-label': `Photo ${k + 1} on page ${n}, from "${titleOf(ph.memory_id)}"`, onclick: () => stepPhoto(ph) },
              crop(ph, n), el('span', { class: 'tiny muted', text: titleOf(ph.memory_id) })))));
        }
        if (ix.available && mems.length) {
          kids.push(el('h3', { class: 'sub', text: 'A memory on this page' }), el('div', { class: 'choices' }, mems.map((m) =>
            choice(titleOf(m), [fmtDay(memById.get(m).date), memById.get(m).chapter].filter(Boolean).join(' · '), () => stepMemory(m)))));
        }
        kids.push(el('h3', { class: 'sub', text: 'Something else' }), el('div', { class: 'choices' },
          choice('Page layout looks wrong', 'Tell our team what looks wrong; they\'ll help personally.', () => stepNote('layout', {})),
          choice('A memory is missing from my book', opts.family === 'yir' ? 'Add a memory from this book\'s time period.' : 'Add a memory from your Life Story.', () => stepMissing()),
          choice('Something else', 'Anything we haven\'t listed: tell us in your own words.', () => stepNote('other', {}))));
        if (!ix.available) kids.splice(2, 0, el('p', { class: 'note', text: 'This proof was made before photos and memories could be picked on a page. Tell us what\'s wrong in your own words, or ask for a missing memory.' }));
        body.replaceChildren(...kids.filter(Boolean));
      }
      function stepPhoto(ph) {
        const info = ix.photos.get(ph.id) || {}, spare = spareOf(ph.memory_id);
        title.textContent = 'This photo';
        body.replaceChildren(back(stepPage), msg, el('div', { class: 'photo-head' }, crop(ph, S.page), el('p', { class: 'muted small', text: `From "${titleOf(ph.memory_id)}", page ${S.page}` })),
          el('div', { class: 'choices' },
            info.cropped ? choice('Show the whole photo', 'It\'s cut off here. We\'ll show all of it, with nothing trimmed.', () => done({ type: 'photo_uncrop', page: S.page, media_id: ph.id,
              summary: `Page ${S.page} · Show the whole photo · ${titleOf(ph.memory_id)}` })) : null,
            choice('Turn it', 'It\'s sideways or upside down.', () => stepTurn(ph)),
            choice('Remove this photo from the book', null, () => done({ type: 'photo_remove', page: S.page, media_id: ph.id, summary: `Page ${S.page} · Remove the photo · ${titleOf(ph.memory_id)}` })),
            choice('Use a different photo of this memory', spare.length ? `${spare.length} other photo${spare.length === 1 ? '' : 's'} of this memory can be used.` : 'This memory has no other photos. Add one in the DayCasion app first.',
              () => stepPick(ph.memory_id, ph), { disabled: !spare.length }),
            choice('Something else about this photo', 'For example a face is cut off, or it\'s the wrong photo. Our team will help personally.', () => stepNote('other', { media_id: ph.id, memory_id: ph.memory_id }))),
          el('p', { class: 'muted small', text: 'The first four are made automatically in your new proof; nothing else in your book changes.' }));
      }
      function stepTurn(ph) {
        title.textContent = 'Turn the photo';
        const opt = (deg, label) => el('button', { type: 'button', class: 'crop-tile turn', onclick: () => done({ type: 'photo_rotate', page: S.page, media_id: ph.id, value: { degrees: deg },
          summary: `Page ${S.page} · Turn the photo ${TURN[deg]} · ${titleOf(ph.memory_id)}` }) }, (() => { const c = crop(ph, S.page); c.style.transform = `rotate(${deg}deg)`; return el('span', { class: 'turnbox' }, c); })(),
          el('span', { class: 'small', text: label }));
        body.replaceChildren(back(() => stepPhoto(ph)), msg, el('p', { text: 'How should it be turned? Choose the one that looks right.' }),
          el('div', { class: 'crop-grid' }, opt(90, 'Clockwise'), opt(270, 'Counterclockwise'), opt(180, 'Upside down')), kindNote(true));
      }
      async function stepPick(memId, replacing) {
        const spare = spareOf(memId);
        title.textContent = replacing ? 'Choose the photo to use instead' : 'Choose a photo to add';
        const tiles = spare.map((p) => el('button', { type: 'button', class: 'photo-tile', 'aria-label': 'Use this photo', onclick: () => done(replacing
          ? { type: 'photo_replace', page: S.page, media_id: replacing.id, value: { with: p.id }, summary: `Page ${S.page} · Use a different photo · ${titleOf(memId)}` }
          : { type: 'photo_add', page: S.page, memory_id: memId, value: { with: p.id }, summary: `Page ${S.page} · Add a photo · ${titleOf(memId)}` }) },
          el('span', { class: 'ph' }, el('img', { alt: '', 'data-photo': p.thumb_path || '', hidden: true }))));
        body.replaceChildren(back(replacing ? () => stepPhoto(replacing) : () => stepMemory(memId)), msg,
          el('p', { class: 'muted small', text: `Photos of "${titleOf(memId)}" that aren't in your book yet.` }), el('div', { class: 'photo-grid' }, tiles), kindNote(true));
        const urls = await signMedia([...new Set(spare.map((p) => p.thumb_path).filter(Boolean))]);
        for (const img of body.querySelectorAll('img[data-photo]')) if (urls[img.dataset.photo]) { img.referrerPolicy = 'no-referrer'; img.src = urls[img.dataset.photo]; img.hidden = false; }
      }
      function stepMemory(memId) {
        const m = memById.get(memId) || {}, spare = spareOf(memId);
        const shown = (m.photos || []).filter((p) => inBookPhoto(p.id)).length;
        title.textContent = m.title || 'This memory';
        body.replaceChildren(back(stepPage), msg, el('div', { class: 'choices' },
          choice('Add another photo of this memory', shown >= MAX_PHOTOS ? `A memory can show up to ${MAX_PHOTOS} photos.` : spare.length ? `${spare.length} photo${spare.length === 1 ? '' : 's'} of this memory aren't in your book.`
            : 'All of this memory\'s photos are in your book. Add a photo in the DayCasion app first.', () => stepPick(memId, null), { disabled: !spare.length || shown >= MAX_PHOTOS }),
          choice('The words, date or chapter are wrong', 'Fix them in the DayCasion app, then we\'ll use your updated memory.', () => stepUpdate(memId)),
          choice('Remove this memory from the book', null, () => done({ type: 'memory_remove', page: S.page, memory_id: memId, summary: `Remove the memory · ${titleOf(memId)}` })),
          choice('Something else about this memory', 'Tell us in your own words. Our team will help personally.', () => stepNote('other', { memory_id: memId }))),
          el('p', { class: 'muted small', text: 'The first three are made automatically in your new proof; nothing else in your book changes.' }));
      }
      function stepUpdate(memId) {
        title.textContent = 'Use your updated memory';
        body.replaceChildren(back(() => stepMemory(memId)), msg,
          el('p', { text: 'Your book prints each memory exactly as you wrote it. To fix the words, the date or the chapter, open the memory in the DayCasion app and edit it there first.' }),
          el('p', { text: `Then add this correction, and your new proof will use "${titleOf(memId)}" as it is in the app. Other memories won't change.` }),
          el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn', text: 'I\'ve updated it: use my updated memory',
            onclick: () => done({ type: 'memory_update', page: S.page, memory_id: memId, summary: `Use my updated memory · ${titleOf(memId)}` }) })), kindNote(true));
      }
      function stepMissing() {
        title.textContent = 'Add a missing memory';
        const missing = (opts.memories || []).filter((m) => !ix.memories.has(m.id));
        const q = el('input', { type: 'text', placeholder: 'Search by title', 'aria-label': 'Search your memories' });
        const results = el('div', { class: 'choices scroll' });
        const show = () => {
          const t = q.value.trim().toLowerCase();
          const rows = missing.filter((m) => !t || (m.title || '').toLowerCase().includes(t)).slice(0, 60);
          results.replaceChildren(...(rows.length ? rows.map((m) => choice(m.title || 'Untitled memory', [fmtDay(m.date), m.chapter, `${m.photos.length} photo${m.photos.length === 1 ? '' : 's'}`].filter(Boolean).join(' · '),
            () => done({ type: 'memory_add', page: S.page, memory_id: m.id, summary: `Add a missing memory · ${m.title || 'Untitled memory'}` })))
            : [el('p', { class: 'muted', text: missing.length ? 'No memory matches.' : (ix.available ? 'Every memory is already in your book.' : 'Search for the memory to add.') })]));
        };
        q.addEventListener('input', show);
        body.replaceChildren(back(stepPage), msg, el('p', { class: 'muted small', text: opts.family === 'yir'
          ? 'Memories dated in this book\'s time period that aren\'t in it. A memory you add keeps its own photos (chosen for you; you can change them later in the proof).'
          : 'Memories in your Life Story that aren\'t in the book. To add another memory, place it in a chapter of your Life Story in the app first.' }), q, results, kindNote(true));
        show(); q.focus();
      }
      function stepNote(type, target) {
        const what = target.media_id ? 'this photo' : target.memory_id ? `"${titleOf(target.memory_id)}"` : `page ${S.page}`;
        title.textContent = type === 'layout' ? `What looks wrong on page ${S.page}?` : 'What\'s wrong?';
        const ta = el('textarea', { rows: 5, maxlength: 1000, id: 'report-note', placeholder: type === 'layout' ? 'For example: a big empty space at the bottom of the page.' : 'For example: a face is cut off, or a name is spelled wrong.' });
        const count = el('span', { class: 'tiny muted', text: '0 / 1,000' });
        ta.addEventListener('input', () => { count.textContent = `${ta.value.length.toLocaleString()} / 1,000`; });
        body.replaceChildren(back(target.media_id ? () => stepPhoto(pageShows(S.page).photos.find((p) => p.id === target.media_id) || {}) : target.memory_id ? () => stepMemory(target.memory_id) : stepPage), msg,
          el('label', { for: 'report-note', text: `Tell us about ${what}, in your own words` }), ta, el('div', { class: 'counter' }, count),
          el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn', text: 'Add to my corrections', onclick: () => {
            const note = ta.value.trim();
            if (note.length < 5) { msg.textContent = 'Please tell us a little more (at least 5 characters).'; ta.focus(); return; }
            done({ type, page: S.page, memory_id: target.memory_id || null, media_id: target.media_id || null, note,
              summary: `Page ${S.page} · ${LABEL[type]}${target.memory_id ? ` · ${titleOf(target.memory_id)}` : ''}` });
          } })), kindNote(false));
        ta.focus();
      }
      stepPage();
    }

    // ------------------------------------------------------------ the review page: the list, and sending it
    function card({ book, onChange, onSent, openProof, email }) {
      const orderId = book.id, items = list(orderId);
      const wrap = el('section', { class: 'card corrections', 'aria-labelledby': 'corr-h' });
      const auto = items.filter((x) => x.kind === 'auto'), assist = items.filter((x) => x.kind === 'assist');
      const row = (x) => el('li', {}, el('span', { class: `chip ${x.kind}`, text: x.kind === 'auto' ? 'Automatic' : 'Personal help' }),
        el('span', { class: 'what' }, el('span', { text: x.summary || LABEL[x.type] }), x.note ? el('span', { class: 'muted small quote', text: `"${x.note}"` }) : null),
        el('button', { type: 'button', class: 'fb-icon', 'aria-label': `Remove: ${x.summary || LABEL[x.type]}`, title: 'Remove', onclick: () => { remove(orderId, x.at); onChange(); } }, icon('close')));
      const whole = (type, label, value) => el('button', { type: 'button', class: 'btn small secondary', text: label, onclick: () => {
        const err = add(orderId, { type, value: value || {}, summary: value && 'on' in value ? `Photo Collages ${value.on ? 'on' : 'off'}` : LABEL[type] });
        if (err) alert(err); onChange();
      } });
      wrap.append(el('h2', { id: 'corr-h', text: 'Want a change?' }),
        el('p', { class: 'muted', text: 'Look through the proof and use Report a problem on any page: choose a photo or a memory and what\'s wrong. Many corrections are made automatically; for anything else, our team helps you personally.' }),
        items.length ? el('ul', { class: 'corr-list' }, items.map(row)) : el('p', { class: 'muted small', text: 'No corrections yet.' }),
        el('details', { class: 'wholebook' }, el('summary', { text: 'Changes to the whole book' }),
          el('div', { class: 'actions' },
            whole('refresh_all', 'Use all my latest memory changes'),
            whole('story_update', book.family === 'yir' ? 'Update the title' : 'Update the title page and chapter names'),
            whole('collages', book.use_collages === false ? 'Turn Photo Collages on' : 'Turn Photo Collages off', { on: book.use_collages === false })),
          el('p', { class: 'muted small', text: 'Made a change in the DayCasion app? These use your memories as they are now, without choosing them again.' })),
        el('div', { class: 'actions' },
          el('button', { type: 'button', class: 'btn', text: items.length ? `Send my corrections (${items.length})` : 'Send my corrections', disabled: !items.length,
            onclick: () => confirmSend() }),
          el('a', { class: 'btn secondary', href: openProof, text: 'Open the proof to report a problem' })),
        el('p', { class: 'muted small', text: `Your hardcover can be revised once: everything in this list is sent together (up to ${MAX}). It stays in this browser until you send it.` }));
      return wrap;

      function confirmSend() {
        const dlg = el('dialog', { class: 'dlg', 'aria-labelledby': 'send-h' });
        const msg = el('p', { class: 'err small', role: 'alert' });
        const go = el('button', { type: 'button', class: 'btn', text: 'Send my corrections', onclick: async () => {
          go.disabled = true; msg.textContent = '';
          const r = await rpc('dc_keepsake_request_corrections', { p_order_id: orderId, p_items: list(orderId).map((x) => ({ type: x.type, page: x.page ?? null,
            memory_id: x.memory_id ?? null, media_id: x.media_id ?? null, value: x.value || {}, note: x.note ?? null })) });
          if (!r.ok) { go.disabled = false; msg.textContent = plainErr(r, 'Please try again.'); return; }
          store(orderId, []); dlg.close(); onSent(r.data.order_id);
        } });
        dlg.append(el('div', { class: 'dhead' }, el('h2', { id: 'send-h', text: 'Send your corrections?' }),
          el('button', { type: 'button', class: 'fb-icon', 'aria-label': 'Close', onclick: () => dlg.close() }, icon('close'))),
        el('div', { class: 'inner' },
          auto.length ? el('p', {}, el('strong', { text: `${auto.length} automatic correction${auto.length === 1 ? '' : 's'}: ` }),
            el('span', { text: 'we make your new proof from your book as it is now, with only these changes. It usually takes a few minutes.' })) : null,
          assist.length ? el('p', {}, el('strong', { text: `${assist.length} request${assist.length === 1 ? '' : 's'} for our team: ` }),
            el('span', { text: `we'll look at ${assist.length === 1 ? 'it' : 'them'} personally and email you at ${email || 'your account email'}. You can approve your book once we've answered.` })) : null,
          el('p', { class: 'muted small', text: 'This is your book\'s one revision. Changing the cover photo stays free and separate.' }),
          msg, el('div', { class: 'actions' }, go, el('button', { type: 'button', class: 'btn secondary', text: 'Keep reviewing', onclick: () => dlg.close() }))));
        dlg.addEventListener('close', () => dlg.remove());
        document.body.append(dlg); dlg.showModal();
      }
    }

    // ------------------------------------------------------------ a revised proof: what happened to each correction
    function results({ book, readHref }) {
      const wrap = el('section', { class: 'card corrections done', 'aria-labelledby': 'changed-h' }, el('h2', { id: 'changed-h', text: 'Your corrections' }),
        el('p', { class: 'muted', text: 'Loading…' }));
      (async () => {
        const r = await rpc('dc_keepsake_revision_status', { p_order_id: book.id });
        if (!r.ok) { wrap.lastChild.textContent = plainErr(r, 'We couldn\'t load your corrections.'); return; }
        const s = r.data, items = s.items || [];
        const making = book.status === 'queued' || book.status === 'generating';
        const pagesLink = (ps) => (ps && ps.length ? el('span', { class: 'pages' }, ' ', ...[...new Set(ps)].slice(0, 3).flatMap((n, k) => [k ? ', ' : '',
          el('a', { href: readHref(n), text: `page ${n}` })])) : null);
        const autoRows = items.filter((i) => i.kind === 'auto').map((i) => el('li', { class: making ? 'wait' : i.status },
          el('span', { class: 'mark', 'aria-hidden': 'true', text: making ? '…' : i.status === 'applied' ? '✓' : '!' }),
          el('span', { class: 'what' }, el('span', {}, el('strong', { text: i.label + (i.type === 'collages' ? ` ${i.value && i.value.on ? 'on' : 'off'}` : '') }),
            i.memory_title ? el('span', { class: 'muted', text: ` · ${i.memory_title}` }) : null),
            el('span', { class: 'small block', text: making ? 'Being made now.' : i.message || '' }, i.status === 'applied' && !making ? pagesLink(i.pages) : null))));
        const assistRows = items.filter((i) => i.kind === 'assist').map((i) => el('li', { class: `assist ${i.status}` },
          el('span', { class: `chip ${i.status === 'resolved' ? 'off' : ''}`, text: STATUS[i.status] || i.status }),
          el('span', { class: 'what' }, el('strong', { text: `${i.label}${i.page ? `, page ${i.page}` : ''}` }),
            el('span', { class: 'small block quote', text: i.note || '' }),
            i.staff_reply ? el('span', { class: 'small block reply' }, el('strong', { text: 'DayCasion: ' }), el('span', { text: i.staff_reply })) : null)));
        const notes = (s.notes || []).map((n) => n.kind === 'memory_gone' ? `"${n.title}" was left out: it's no longer in your memories.`
          : n.kind === 'photos_gone' ? `${n.count} photo${n.count === 1 ? '' : 's'} of "${n.title}" ${n.count === 1 ? 'was' : 'were'} left out: deleted in the app.`
          : n.kind === 'foreword_removed' ? 'The foreword was left out because it mentioned a memory that is no longer in your book.'
          : n.kind === 'intro_removed' ? 'A chapter introduction was left out because it mentioned a memory that is no longer in your book.' : null).filter(Boolean);
        const open = s.open_personal || 0;
        wrap.replaceChildren(...[wrap.firstChild,
          !making && s.previous && s.previous.page_count && book.page_count ? el('p', { class: 'muted small', text: book.page_count === s.previous.page_count
            ? `Still ${book.page_count} pages.` : `Your book is now ${book.page_count} pages (it was ${s.previous.page_count}).` }) : null,
          autoRows.length ? el('ul', { class: 'result-list' }, autoRows) : null,
          notes.length ? el('div', { class: 'note' }, el('strong', { text: 'Also changed' }), el('ul', {}, notes.map((t) => el('li', { text: t })))) : null,
          assistRows.length ? el('h3', { class: 'sub', text: 'Requests for our team' }) : null,
          assistRows.length ? el('ul', { class: 'result-list' }, assistRows) : null,
          open ? el('p', { class: 'small', text: `We're looking into ${open === 1 ? 'your request' : `${open} requests`} and will email you. You can approve your book once we've answered.` }) : null].filter(Boolean));
      })();
      return wrap;
    }

    return { list, report, card, results, indexOf };
  }
  window.DcCorrections = { create };
})();
