/* books.daycasion.com for owners: sign in with the DayCasion account (the app's email and password), My Keepsakes
 * (ready books), read in the web flipbook, Download PDF, and Share Interactive Book (private guest links: create,
 * copy, end date, PDF permission, stop). Everything goes through the same server functions and private storage
 * rules as the app (dc_keepsake_my_keepsakes, dc_keepsake_reader, dc_keepsake_save_position, dc_keepsake_file,
 * dc_keepsake_share_*); the page holds no secrets. Routes: #/ (library) and #/book/<order id>. */
(function () {
  'use strict';
  if (window.DC_FRAMED) return;
  const { CFG, call, familyTitle, periodLabel, fmtDate, plainErr, errText, download, el, icon } = window.DcBooks;
  const API = CFG.supabaseUrl;
  const KEEP = 'dc-books-session'; // localStorage when "Keep me signed in" (default), else sessionStorage
  const $app = document.getElementById('app');
  let session = null, reader = null, library = null;

  // ------------------------------------------------------------------ session
  function loadSession() {
    for (const store of [localStorage, sessionStorage]) {
      try { const s = JSON.parse(store.getItem(KEEP) || 'null'); if (s && s.refresh_token) return { ...s, keep: store === localStorage }; } catch (e) { /* storage off */ }
    }
    return null;
  }
  function saveSession() {
    try { localStorage.removeItem(KEEP); sessionStorage.removeItem(KEEP); } catch (e) { /* storage off */ }
    if (!session) return;
    const { keep, ...s } = session;
    try { (keep ? localStorage : sessionStorage).setItem(KEEP, JSON.stringify(s)); } catch (e) { /* private mode: this tab only */ }
  }
  function storeSession(d, keep) {
    session = { access_token: d.access_token, refresh_token: d.refresh_token, keep: keep ?? (session ? session.keep : true),
      expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
      email: (d.user && d.user.email) || (session && session.email) || '' };
    saveSession();
  }
  let refreshing = null;
  function refresh() {
    if (!session) return Promise.resolve(false);
    refreshing ||= call(`${API}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', body: { refresh_token: session.refresh_token } })
      .then((r) => { refreshing = null; if (r.ok && r.data && r.data.access_token) { storeSession(r.data); return true; } return r.offline ? null : false; });
    return refreshing;
  }
  async function authed(path, opts = {}) {
    if (!session) throw new Error('signed-out');
    if (session.expires_at - Date.now() / 1000 < 90) await refresh();
    let r = await call(API + path, { ...opts, token: session.access_token });
    if (r.status === 401 && (await refresh())) r = await call(API + path, { ...opts, token: session.access_token });
    if (r.status === 401) { signOut('Please sign in again.'); throw new Error('signed-out'); }
    return r;
  }
  const rpc = (fn, args) => authed(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args || {} });
  async function signUrls(paths, seconds) {
    const r = await authed('/storage/v1/object/sign/keepsakes', { method: 'POST', body: { expiresIn: seconds, paths } });
    if (!r.ok || !Array.isArray(r.data)) throw new Error('sign');
    const out = {};
    r.data.forEach((x) => { if (x.signedURL) out[x.path] = `${API}/storage/v1${x.signedURL.startsWith('/') ? '' : '/'}${x.signedURL}`; });
    return out;
  }
  function signOut(message) {
    if (session) call(`${API}/auth/v1/logout`, { method: 'POST', token: session.access_token });
    session = null; saveSession(); library = null; closeReader();
    if (location.hash !== '#/') history.replaceState(null, '', '#/');
    viewSignIn(message);
  }

  // ------------------------------------------------------------------ layout helpers
  // one page refresh at a time (a preview or a new cover being made); any new view cancels it
  let pollTimer = null;
  const stopPoll = () => { clearTimeout(pollTimer); pollTimer = null; };
  const poll = (fn, ms) => { stopPoll(); pollTimer = setTimeout(() => { pollTimer = null; if (!session) return;
    if (document.querySelector('dialog[open]')) poll(fn, ms); else fn(true); }, ms); }; // not while a dialog is open
  const show = (...nodes) => { stopPoll(); closeReader(); document.body.classList.remove('reading'); $app.replaceChildren(...nodes); window.scrollTo(0, 0); };
  // a refresh of the same view keeps the reader where they were on the page
  const refreshShow = (...nodes) => { const y = window.scrollY; show(...nodes); window.scrollTo(0, y); };
  const header = () => el('div', { class: 'head' },
    el('a', { class: 'brandlogo', href: '#/', 'aria-label': 'DayCasion Keepsakes' }, el('picture', {},
      el('source', { srcset: 'images/logo-dark.png', media: '(prefers-color-scheme: dark)' }), el('img', { src: 'images/logo.png', alt: 'DayCasion', width: 720, height: 178 }))),
    session ? el('div', { class: 'who' }, el('span', { text: session.email }), el('button', { type: 'button', class: 'textlink', text: 'Sign out', onclick: () => signOut() })) : null);
  const page = (...kids) => el('div', { class: 'wrap' }, header(), ...kids,
    el('footer', { class: 'site' }, el('p', {}, 'Your books are private to your DayCasion account. Need help? Email ', el('a', { href: 'mailto:info@daycasion.com', text: 'info@daycasion.com' }),
      ' · ', el('a', { href: 'https://legal.daycasion.com/privacy.html', rel: 'noopener', text: 'Privacy Policy' }))));

  // ------------------------------------------------------------------ sign in
  function viewSignIn(message) {
    const email = el('input', { type: 'email', autocomplete: 'username', id: 'email', required: true });
    const pw = el('input', { type: 'password', autocomplete: 'current-password', id: 'password', required: true });
    const keep = el('input', { type: 'checkbox', id: 'keep', checked: true });
    const msg = el('p', { class: 'err small', role: 'alert', text: message || '' });
    const btn = el('button', { type: 'submit', class: 'btn', text: 'Sign in' });
    const form = el('form', { onsubmit: async (e) => {
      e.preventDefault(); msg.textContent = ''; btn.disabled = true;
      const r = await call(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', body: { email: email.value.trim(), password: pw.value } });
      btn.disabled = false;
      if (r.ok && r.data && r.data.access_token) { pw.value = ''; storeSession(r.data, keep.checked); return route(); }
      msg.textContent = r.offline ? "Can't reach DayCasion. Check your connection and try again." : "That email and password didn't match. Use the same sign-in as the DayCasion app.";
    } }, el('label', { for: 'email', text: 'Email' }), email, el('label', { for: 'password', text: 'Password' }), pw,
    el('label', { class: 'check', for: 'keep' }, keep, el('span', { text: 'Keep me signed in on this device' })), msg, el('div', { class: 'actions' }, btn));
    show(page(el('h1', { class: 'page', text: 'Your Keepsakes, in any browser' }),
      el('p', { class: 'lede', text: 'Read your DayCasion books as a flipbook on your computer, tablet or phone, and share them privately with family. Ordering a hardcover? Review its proof here on a bigger screen before you order.' }),
      el('div', { class: 'card narrow' }, el('h2', { text: 'Sign in to DayCasion' }),
        el('p', { class: 'muted small', text: 'Use the account you use in the DayCasion app. Forgot your password? Reset it in the app.' }), form)));
    email.focus();
  }

  // ------------------------------------------------------------------ library
  async function loadLibrary() {
    const [mine, cat] = await Promise.all([rpc('dc_keepsake_my_keepsakes'), rpc('dc_keepsake_catalog')]);
    if (!mine.ok) throw Object.assign(new Error('load'), { r: mine });
    const books = (mine.data || []).filter((i) => i.kind === 'book' && i.status !== 'cancelled');
    return { books, visible: !!(cat.ok && cat.data && cat.data.visible) };
  }
  async function viewLibrary(quiet) {
    if (quiet !== true) show(page(el('h1', { class: 'page', text: 'My Keepsakes' }), el('div', { class: 'card' }, el('p', { class: 'muted', text: 'Loading your books…' }))));
    try { library = await loadLibrary(); } catch (e) {
      if (e.message === 'signed-out') return;
      if (quiet === true) return poll(viewLibrary, 30000);
      return show(page(el('h1', { class: 'page', text: 'My Keepsakes' }), el('div', { class: 'card' }, el('p', { class: 'err', text: plainErr(e.r, "We couldn't load your books.") }),
        el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn', text: 'Try again', onclick: viewLibrary })))));
    }
    const ready = library.books.filter((b) => b.status === 'ready');
    const proofs = library.books.filter(isHardcoverProof);
    const grid = el('div', { class: 'books' }, library.books.map((b) => (b.stage ? printedCard(b) : bookCard(b))));
    const intro = el('p', { class: 'lede', text: [ready.length ? 'Open a book to read it as a flipbook, or share it privately with family and friends.' : '',
      proofs.length ? 'Review your hardcover proofs here on a computer or tablet before you order them in the DayCasion app.' : ''].filter(Boolean).join(' ') });
    const empty = !library.books.length ? el('div', { class: 'card' }, el('h2', { text: library.visible ? 'No books yet' : 'Keepsakes aren\'t available for this account yet' }),
      el('p', { class: 'muted', text: library.visible ? 'Order a Year in Review or Life Story Biography eBook in the DayCasion app. It appears here when it\'s ready.' : 'Your finished DayCasion books will appear here.' })) : null;
    (quiet === true ? refreshShow : show)(page(el('h1', { class: 'page', text: 'My Keepsakes' }), intro, empty, grid));
    covers(ready);
    proofCovers(proofs);
    if (library.books.some((b) => isHardcoverProof(b) && (b.status === 'queued' || b.status === 'generating' || coverBusy(b)))) {
      poll(viewLibrary, 15000); // a preview or a new cover being made: the library updates by itself
    }
  }
  // Printed books (hardcover and softcover). Only a hardcover preview can be reviewed here; everything else about
  // printed books (softcover previews, approval, payment, printing) stays in the DayCasion app.
  function printedCard(b) {
    const hard = b.format === 'hardcover';
    const title = `${b.profile_name || ''} · ${familyTitle(b.family)}`;
    const meta = [hard ? 'Hardcover 8 x 10 in' : 'Softcover 6 x 9 in', periodLabel(b.period_type, b.period_start, b.period_end),
      b.page_count ? `${b.page_count} pages` : '', b.price_cents && b.stage === 'preview' ? money(b.price_cents) : ''].filter(Boolean).join(' · ');
    const reviewable = isHardcoverProof(b) && ['proof_ready', 'approved', 'expired'].includes(b.status);
    const coverImg = el('img', { alt: '', 'data-proof-cover': b.id, hidden: true });
    return el('article', { class: 'bookcard' },
      el('button', { type: 'button', class: 'cover', 'aria-label': `Review the ${title} hardcover proof`, disabled: !reviewable,
        onclick: () => (location.hash = `#/proof/${b.id}`) }, coverImg),
      el('div', { class: 'body' }, el('h2', { text: title }), el('p', { class: 'meta', text: meta }),
        el('p', { class: `status ${b.status === 'proof_ready' ? 'ok' : b.status === 'failed' ? 'err' : 'muted'}`, text: printedStatus(b) }),
        reviewable ? el('div', { class: 'actions' }, el('a', { class: 'btn small', href: `#/proof/${b.id}`, text: 'Review proof' }))
          : el('p', { class: 'muted small', text: hard && b.stage === 'preview' && !['failed'].includes(b.status)
            ? 'Your proof appears here when it\'s ready.' : 'See this book in the DayCasion app.' })));
  }
  async function proofCovers(books) { // each hardcover preview's current front cover (owner-only private links)
    const list = books.filter((b) => b.cover && b.cover.preview_path);
    if (!list.length) return;
    try {
      const urls = await signUrls(list.map((b) => b.cover.preview_path), 600);
      for (const b of list) {
        const img = document.querySelector(`img[data-proof-cover="${b.id}"]`);
        if (img && urls[b.cover.preview_path]) { img.referrerPolicy = 'no-referrer'; img.src = urls[b.cover.preview_path]; img.hidden = false; }
      }
    } catch (e) { /* covers are decoration */ }
  }
  function bookCard(b) {
    const title = `${b.profile_name || ''} · ${familyTitle(b.family)}`;
    const meta = [b.format === 'video' ? 'Video' : 'eBook', periodLabel(b.period_type, b.period_start, b.period_end), b.file ? `${b.file.pages} pages` : '', b.reader_page > 1 ? `read to page ${b.reader_page}` : '']
      .filter(Boolean).join(' · ');
    const ready = b.status === 'ready', readable = ready && b.has_reader;
    const status = { ready: 'Ready', queued: 'Waiting to start', generating: 'Being made', failed: 'Didn\'t finish', awaiting_payment: 'Waiting for payment', refunded: 'Refunded' }[b.status] || b.status;
    const coverImg = el('img', { alt: '', 'data-cover': b.id, hidden: true });
    return el('article', { class: 'bookcard' },
      el('button', { type: 'button', class: 'cover', 'aria-label': `Read ${title}`, disabled: !readable, onclick: () => (location.hash = `#/book/${b.id}`) }, coverImg),
      el('div', { class: 'body' }, el('h2', { text: title }), el('p', { class: 'meta', text: meta }),
        el('p', { class: `status ${ready ? 'ok' : b.status === 'failed' ? 'err' : 'muted'}`, text: status }),
        readable ? el('div', { class: 'actions' },
          el('a', { class: 'btn small', href: `#/book/${b.id}`, text: 'Read' }),
          el('button', { type: 'button', class: 'btn small secondary', onclick: () => shareDialog(b.id, title) }, icon('share'), el('span', { text: 'Share' })),
          el('button', { type: 'button', class: 'textlink', text: 'Download PDF', onclick: (e) => pdf(b.id, e.currentTarget) })) : null));
  }
  async function covers(books) { // the first page as the cover (the reader's own image, a private link)
    const paths = books.filter((b) => b.has_reader && b.file).map((b) => ({ id: b.id, path: b.file.path.replace(/book\.pdf$/, 'reader/p0001.webp') }));
    if (!paths.length) return;
    try {
      const urls = await signUrls(paths.map((p) => p.path), 600);
      for (const p of paths) {
        const img = document.querySelector(`img[data-cover="${p.id}"]`);
        if (img && urls[p.path]) { img.referrerPolicy = 'no-referrer'; img.src = urls[p.path]; img.hidden = false; }
      }
    } catch (e) { /* covers are decoration */ }
  }
  async function pdf(orderId, btn) {
    if (btn) btn.disabled = true;
    try {
      const f = await rpc('dc_keepsake_file', { p_order_id: orderId });
      if (!f.ok) throw new Error('file');
      const r = await authed(`/storage/v1/object/sign/keepsakes/${f.data.path.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', body: { expiresIn: 300 } });
      if (!r.ok || !r.data || !r.data.signedURL) throw new Error('sign');
      download(`${API}/storage/v1${r.data.signedURL.startsWith('/') ? '' : '/'}${r.data.signedURL}&download=DayCasion-Keepsake.pdf`);
    } catch (e) {
      if (e.message !== 'signed-out') alert('We couldn\'t get the PDF. Please try again.');
    } finally { if (btn) btn.disabled = false; }
  }

  // ------------------------------------------------------------------ reader
  function closeReader() { if (reader) { reader.destroy(); reader = null; } const r = document.getElementById('reader'); if (r) r.remove(); }
  async function viewBook(orderId) {
    show(el('div', { class: 'center' }, el('div', { class: 'msg' }, el('div', { class: 'spinner', role: 'status', 'aria-label': 'Opening your book' }))));
    let info, manifest;
    try {
      const r = await rpc('dc_keepsake_reader', { p_order_id: orderId });
      if (!r.ok) throw Object.assign(new Error('reader'), { r });
      info = r.data;
      const m = await authed(`/storage/v1/object/authenticated/keepsakes/${info.manifest_path.split('/').map(encodeURIComponent).join('/')}`);
      if (!m.ok || !m.data || !Array.isArray(m.data.pages)) throw new Error('manifest');
      manifest = m.data;
    } catch (e) {
      if (e.message === 'signed-out') return;
      return show(page(el('div', { class: 'card narrow' }, el('h2', { text: e.r && e.r.status < 500 ? 'This book can\'t be opened in the reader.' : 'We couldn\'t open this book.' }),
        el('p', { class: 'muted', text: 'Check your connection and try again, or download the PDF.' }),
        el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn', text: 'Try again', onclick: () => viewBook(orderId) }),
          el('a', { class: 'btn secondary', href: '#/', text: 'My Keepsakes' })))));
    }
    const folder = info.manifest_path.slice(0, -'reader/manifest.json'.length);
    const pages = manifest.pages.map((p) => ({ n: p.n, text: p.text || '', path: folder + p.file }));
    const sign = async () => { const u = await signUrls(pages.map((p) => p.path), 3600); const o = {}; for (const p of pages) if (u[p.path]) o[p.n] = u[p.path]; return o; };
    let urls;
    try { urls = await sign(); } catch (e) {
      if (e.message === 'signed-out') return;
      return show(page(el('div', { class: 'card narrow' }, el('h2', { text: 'We couldn\'t load the pages of this book.' }),
        el('p', { class: 'muted', text: 'Check your connection and try again, or download the PDF.' }),
        el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn', text: 'Try again', onclick: () => viewBook(orderId) }),
          el('button', { type: 'button', class: 'btn secondary', text: 'Download PDF', onclick: (ev) => pdf(orderId, ev.currentTarget) })))));
    }
    let local = 0; try { local = +(localStorage.getItem('dcbook.' + orderId) || 0); } catch (e) { /* storage off */ }
    const start = info.reader_page || local || 1;
    const title = [manifest.kicker, manifest.title].filter(Boolean).join(' · ');
    document.title = `${title || 'Keepsake book'} · DayCasion`;
    $app.replaceChildren(); document.body.classList.add('reading');
    const root = el('div', { id: 'reader' }); document.body.append(root);
    reader = window.DcFlipbook.open(root, {
      title, subtitle: manifest.subtitle || '', aspect: manifest.page_aspect, chapters: manifest.chapters || [], linkSeconds: 3600,
      pages: pages.map((p) => ({ n: p.n, text: p.text, url: urls[p.n] })), startPage: start, resumed: start > 1,
      renew: sign,
      onPage: (p) => { try { localStorage.setItem('dcbook.' + orderId, String(p)); } catch (e) { /* storage off */ } rpc('dc_keepsake_save_position', { p_order_id: orderId, p_page: p }).catch(() => {}); },
      back: { label: 'My Keepsakes', onClick: () => { location.hash = '#/'; } },
      share: () => shareDialog(orderId, title),
      pdf: () => pdf(orderId),
    });
  }

  // ------------------------------------------------------------------ Share Interactive Book
  const ENDS = [['never', 'No end date'], ['7', 'In 7 days'], ['30', 'In 30 days'], ['365', 'In 1 year'], ['date', 'On a date…']];
  function endDate(choice, dateValue) {
    if (choice === 'never') return null;
    if (choice === 'date') { if (!dateValue) return undefined; const d = new Date(dateValue + 'T23:59:59'); return isNaN(d) ? undefined : d.toISOString(); }
    return new Date(Date.now() + (+choice) * 86400000).toISOString();
  }
  function endsSelect(id) {
    const sel = el('select', { id }, ENDS.map(([v, t]) => el('option', { value: v, text: t })));
    const min = new Date(Date.now() + 86400000).toISOString().slice(0, 10), max = new Date(Date.now() + 5 * 365 * 86400000).toISOString().slice(0, 10);
    const date = el('input', { type: 'date', min, max, hidden: true, 'aria-label': 'End date' });
    sel.addEventListener('change', () => { date.hidden = sel.value !== 'date'; if (!date.hidden) date.focus(); });
    return { sel, date, value: () => endDate(sel.value, date.value) };
  }
  function linkStatus(l) {
    if (l.status === 'revoked') return el('span', { class: 'chip off', text: 'Stopped' });
    if (l.status === 'expired') return el('span', { class: 'chip off', text: 'Ended' });
    return el('span', { class: 'chip', text: l.expires_at ? `Ends ${fmtDate(l.expires_at)}` : 'Active' });
  }
  async function shareDialog(orderId, title) {
    const dlg = el('dialog', { class: 'dlg', 'aria-labelledby': 'share-h' });
    const body = el('div', { class: 'inner' }, el('p', { class: 'muted', text: 'Loading…' }));
    dlg.append(el('div', { class: 'dhead' }, el('h2', { id: 'share-h', text: 'Share Interactive Book' }),
      el('button', { type: 'button', class: 'fb-icon', 'aria-label': 'Close', onclick: () => dlg.close() }, icon('close'))), body);
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg); dlg.showModal();
    let state;
    const load = async () => {
      const r = await rpc('dc_keepsake_share_list', { p_order_id: orderId });
      if (!r.ok) throw Object.assign(new Error('list'), { r });
      state = r.data; paint();
    };
    let created = null; // the link just made (its token is only known now)
    function paint() {
      if (!state.available) {
        body.replaceChildren(el('p', { text: 'Sharing isn\'t available for your account yet.' }));
        if (!state.links.length) return;
      }
      const label = el('input', { type: 'text', id: 'share-label', maxlength: 60, placeholder: 'For example: Grandma Ruth', autocomplete: 'off' });
      const ends = endsSelect('share-ends');
      const allowPdf = el('input', { type: 'checkbox', id: 'share-pdf' });
      const msg = el('p', { class: 'err small', role: 'alert' });
      const make = el('button', { type: 'submit', class: 'btn', text: 'Create private link' });
      const form = el('form', { onsubmit: async (e) => {
        e.preventDefault(); msg.textContent = '';
        const exp = ends.value(); if (exp === undefined) { msg.textContent = 'Choose the date the link should end.'; return; }
        make.disabled = true;
        const r = await rpc('dc_keepsake_share_create', { p_order_id: orderId, p_label: label.value.trim() || null, p_expires_at: exp, p_allow_pdf: allowPdf.checked });
        make.disabled = false;
        if (!r.ok) { msg.textContent = plainErr(r, 'We couldn\'t create the link.'); return; }
        created = r.data; await load().catch(() => paint());
      } }, el('label', { for: 'share-label', text: 'Who is it for? (optional, only you see this)' }), label,
      el('div', { class: 'row2' }, el('div', {}, el('label', { for: 'share-ends', text: 'Link ends' }), ends.sel, ends.date),
        el('div', {}, el('label', { class: 'check', for: 'share-pdf', style: 'margin-top:38px' }, allowPdf, el('span', { text: 'Allow PDF download' })))),
      msg, el('div', { class: 'actions' }, make));
      const fresh = created ? newLinkBox(created) : null;
      const list = state.links.length ? el('ul', { class: 'links' }, state.links.map(linkRow)) : el('p', { class: 'muted small', text: 'No links yet.' });
      const active = state.links.filter((l) => l.status === 'active').length;
      body.replaceChildren(...[ // empty slots left out (replaceChildren would print them as "null")
        el('p', { class: 'muted', text: `${title}. Anyone with a link can read this book in their browser — no app or account needed. Links are private and never listed or searchable. You can stop a link at any time.` }),
        fresh, state.available ? form : null,
        el('h3', { text: 'Your links' }), list,
        active > 1 ? el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn small danger', text: 'Stop sharing this book', onclick: async () => {
          if (!confirm(`Stop all ${active} links? Anyone using them will no longer be able to open the book.`)) return;
          const r = await rpc('dc_keepsake_share_revoke_all', { p_order_id: orderId }); if (!r.ok) alert(plainErr(r, 'Please try again.'));
          created = null; await load().catch(() => {});
        } })) : null].filter(Boolean));
      if (fresh) fresh.querySelector('input').select();
    }
    function newLinkBox(l) {
      const input = el('input', { type: 'text', readonly: true, value: l.url, 'aria-label': 'Private link', onfocus: (e) => e.target.select() });
      const copied = el('span', { class: 'ok small', role: 'status' });
      const copy = el('button', { type: 'button', class: 'btn small', text: 'Copy', onclick: async () => {
        try { await navigator.clipboard.writeText(l.url); copied.textContent = 'Copied'; } catch (e) { input.select(); document.execCommand && document.execCommand('copy'); copied.textContent = 'Copied'; }
      } });
      const send = navigator.share ? el('button', { type: 'button', class: 'btn small secondary', onclick: () => navigator.share({ title, text: `Here's ${title} from DayCasion. Open it to read it like a book:`, url: l.url }).catch(() => {}) }, icon('share'), el('span', { text: 'Send…' })) : null;
      return el('div', { class: 'note' }, el('strong', { text: 'Your new link is ready' }),
        el('div', { class: 'linkbox' }, input, copy), el('div', { class: 'actions', style: 'margin-top:8px' }, send, copied),
        el('p', { class: 'small', style: 'margin:8px 0 0', text: 'Copy it now. For privacy, DayCasion keeps only a fingerprint of the link and can\'t show it again. You can always create another.' }));
    }
    function linkRow(l) {
      const name = l.label || `Link created ${fmtDate(l.created_at)}`;
      const meta = [`Created ${fmtDate(l.created_at)}`, l.open_count ? `opened ${l.open_count} time${l.open_count === 1 ? '' : 's'}` : 'not opened yet',
        l.last_opened_at ? `last ${fmtDate(l.last_opened_at)}` : '', l.allow_pdf ? 'PDF download on' : 'PDF download off'].filter(Boolean).join(' · ');
      const acts = [];
      if (l.status !== 'revoked' && state.available) {
        // "Change end date…": applies as soon as a choice is made (a date: once it is picked)
        const ends = endsSelect('ends-' + l.id); ends.sel.setAttribute('aria-label', `Change when "${name}" ends`);
        ends.sel.prepend(el('option', { value: '', text: 'Change end date…', disabled: true, selected: true }));
        ends.sel.value = '';
        const apply = async () => {
          const exp = ends.value(); if (exp === undefined || ends.sel.value === '') return;
          const r = await rpc('dc_keepsake_share_update', { p_link_id: l.id, p_expires_at: exp, p_no_expiry: exp === null });
          if (!r.ok) { alert(plainErr(r, 'Please try again.')); ends.sel.value = ''; return; } await load();
        };
        ends.sel.addEventListener('change', () => { if (ends.sel.value !== 'date') apply(); });
        ends.date.addEventListener('change', apply);
        acts.push(el('span', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' }, ends.sel, ends.date));
        acts.push(el('button', { type: 'button', class: 'btn small secondary', text: l.allow_pdf ? 'Turn PDF off' : 'Allow PDF', onclick: async () => {
          const r = await rpc('dc_keepsake_share_update', { p_link_id: l.id, p_allow_pdf: !l.allow_pdf }); if (!r.ok) return alert(plainErr(r, 'Please try again.')); await load();
        } }));
        for (const s of acts[0].querySelectorAll('select')) s.style.width = 'auto';
      }
      if (l.status !== 'revoked') acts.push(el('button', { type: 'button', class: 'btn small danger', text: 'Stop link', onclick: async () => {
        if (!confirm(`Stop "${name}"? Anyone using this link will no longer be able to open the book.`)) return;
        const r = await rpc('dc_keepsake_share_revoke', { p_link_id: l.id }); if (!r.ok) return alert(plainErr(r, 'Please try again.'));
        if (created && created.id === l.id) created = null; await load();
      } }));
      return el('li', {}, el('span', { class: 'lname', text: name }), linkStatus(l), el('span', { class: 'lmeta', text: meta }),
        acts.length ? el('div', { class: 'lact' }, acts) : null);
    }
    try { await load(); } catch (e) {
      if (e.message === 'signed-out') return dlg.close();
      body.replaceChildren(el('p', { class: 'err', text: plainErr(e.r, errText(e.r, 'We couldn\'t load the links.')) }));
    }
  }

  // ------------------------------------------------------------------ hardcover proof review (before ordering)
  // Owner only, hardcover previews only (Life Story and Year in Review). Everything goes through the app's own server
  // functions: dc_keepsake_my_keepsakes (status, price, cover), dc_keepsake_proof (the watermarked proof),
  // dc_keepsake_cover_options / dc_keepsake_set_cover (Change Cover Photo, made by the book worker as in the app) and
  // dc_keepsake_physical_revise (the one revision). Approval and payment stay in the DayCasion app. Proofs are never
  // shareable (share links work only for finished books).
  const money = (c) => (c == null ? '' : '$' + (c / 100).toFixed(2));
  const isHardcoverProof = (b) => b.format === 'hardcover' && b.stage === 'preview';
  const coverBusy = (b) => !!(b.cover && b.cover.status !== 'ready');
  function printedStatus(b) {
    if (b.stage === 'preview') {
      return { queued: 'Free preview being made', generating: 'Free preview being made', proof_ready: b.format === 'hardcover' ? 'Proof ready to review' : 'Ready: see the price in the app',
        approved: 'Approved: finish payment in the app', expired: 'Price expired', failed: 'Didn\'t finish' }[b.status] || 'In the DayCasion app';
    }
    return { queued: 'Paid: preparing print files', generating: 'Paid: preparing print files', print_ready: 'With the printer', submitted: 'With the printer',
      in_production: 'Being printed', shipped: 'Shipped', cancelled: 'Cancelled by the printer', refunded: 'Refunded', failed: 'Being looked into' }[b.status] || 'In the DayCasion app';
  }
  const APP_LINK = 'daycasion://daycasion.com/myKeepsakes'; // opens My Keepsakes in the app (phones and tablets)
  const touchDevice = () => !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  async function findBook(orderId) {
    const r = await rpc('dc_keepsake_my_keepsakes');
    if (!r.ok) throw Object.assign(new Error('load'), { r });
    return (r.data || []).find((x) => x.kind === 'book' && x.id === orderId) || null;
  }
  function proofProblem(heading, text) {
    show(page(el('div', { class: 'card narrow' }, el('h2', { text: heading }), el('p', { class: 'muted', text }),
      el('div', { class: 'actions' }, el('a', { class: 'btn', href: '#/', text: 'My Keepsakes' })))));
  }

  async function viewProof(orderId, quiet) {
    if (!quiet) show(page(el('div', { class: 'card' }, el('p', { class: 'muted', text: 'Loading your proof…' }))));
    let b;
    try { b = await findBook(orderId); } catch (e) {
      if (e.message === 'signed-out') return;
      if (quiet) return poll(() => viewProof(orderId, true), 30000); // a passing connection problem while waiting
      return proofProblem('We couldn\'t load this proof.', plainErr(e.r, 'Check your connection and try again.'));
    }
    if (!b) return proofProblem('This proof isn\'t available', 'It may have been replaced by its revision. Open My Keepsakes to see your current proof.');
    if (!isHardcoverProof(b)) return proofProblem('Only hardcover proofs can be reviewed here', 'See this book in the DayCasion app.');
    const title = `${b.profile_name || ''} · ${familyTitle(b.family)}`;
    document.title = `${title} hardcover proof · DayCasion`;
    const head = [el('a', { class: 'backlink', href: '#/' }, icon('back'), el('span', { text: 'My Keepsakes' })),
      el('h1', { class: 'page', text: `${title} · Hardcover` }),
      el('p', { class: 'lede', text: [periodLabel(b.period_type, b.period_start, b.period_end), b.page_count ? `${b.page_count} pages` : '',
        b.price_cents ? money(b.price_cents) : ''].filter(Boolean).join(' · ') })];
    if (b.status === 'queued' || b.status === 'generating') {
      show(page(...head, el('div', { class: 'card' }, el('h2', { text: 'Your free preview is being made' }),
        el('p', { class: 'muted', text: 'It usually takes a few minutes. This page updates by itself, or come back later.' }))));
      return poll(() => viewProof(orderId, true), 15000);
    }
    if (b.status === 'failed') return proofProblem('This preview didn\'t finish', 'Open the DayCasion app to try again.');
    const c = b.cover || null, busy = coverBusy(b), reviewing = b.status === 'proof_ready';
    // the front cover as it will be printed
    const coverImg = el('img', { class: 'proof-cover', alt: 'Front cover preview', hidden: true });
    const figure = el('figure', { class: 'proof-figure' }, coverImg,
      busy ? el('div', { class: 'proof-busy', role: 'status' }, el('div', { class: 'spinner' }), el('p', { text: 'Making your new cover…' })) : null);
    const coverNotes = [];
    if (c && !busy && (c.grade === 'soft' || c.grade === 'blurry')) {
      coverNotes.push(el('p', { class: `quality ${c.grade}` }, el('strong', { text: 'Cover photo: ' }), el('span', { text: c.label || '' })));
    }
    if (c && !busy && c.grade === 'blurry') {
      coverNotes.push(el('p', { class: 'muted small', text: c.warning || '' }));
      if (c.ack_needed && reviewing) coverNotes.push(el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn small secondary', text: 'I understand, use this photo',
        onclick: async (e) => { e.currentTarget.disabled = true; const r = await rpc('dc_keepsake_set_cover', { p_order_id: orderId, p_media_id: c.media_id, p_acknowledge: true });
          if (!r.ok) { e.currentTarget.disabled = false; return alert(plainErr(r, 'Please try again.')); } viewProof(orderId, true); } })));
      else if (c.acknowledged) coverNotes.push(el('p', { class: 'muted small', text: 'You confirmed this photo for the cover.' }));
    }
    if (c && !busy && c.error === 'cover_change_failed') coverNotes.push(el('p', { class: 'err small', text: 'We couldn\'t change the cover photo, so your previous cover is kept. Please try again or choose another photo.' }));
    else if (c && !busy && c.choice_dropped) coverNotes.push(el('p', { class: 'muted small', text: 'The photo you chose is no longer in this book, so we picked a cover photo for you.' }));
    const coverCard = el('section', { class: 'card proof-cover-card', 'aria-labelledby': 'cover-h' },
      el('h2', { id: 'cover-h', text: 'Front cover' }), figure, ...coverNotes,
      c && c.can_change && reviewing && c.options > 0 ? el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn secondary', text: 'Change cover photo', disabled: busy,
        onclick: () => coverPicker(orderId) })) : null);
    // the proof, the one revision, and what to do next
    const read = el('section', { class: 'card' }, el('h2', { text: 'Review every page' }),
      el('p', { class: 'muted', text: 'Turn every page of your book exactly as it will be printed, starting with the front cover. Pages show a PROOF watermark that isn\'t printed.' }),
      el('div', { class: 'actions' }, el('a', { class: 'btn', href: `#/proof/${orderId}/read`, text: 'Open the proof' })));
    const revise = b.can_revise && !busy ? el('section', { class: 'card' }, el('h2', { text: 'Want a change?' }),
      el('p', { class: 'muted', text: 'Your hardcover can be revised once. We\'ll make a new proof with any memory changes you\'ve made since, and the option you choose. After that, approve the proof you like.' }),
      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn secondary', text: 'Request a revision (once)', onclick: () => reviseDialog(b) }))) : null;
    const order = el('section', { class: 'card ready-to-order', 'aria-labelledby': 'order-h' }, el('h2', { id: 'order-h', text: 'Ready to order?' }), ...orderText(b, busy));
    (quiet ? refreshShow : show)(page(...head, el('p', { class: 'status-line' }, el('span', { class: 'chip', text: printedStatus(b) }),
      b.quote_expires_at && reviewing ? el('span', { class: 'muted small', text: ` Price guaranteed until ${fmtDate(b.quote_expires_at)}.` }) : null),
    el('div', { class: 'proof-grid' }, coverCard, el('div', {}, read, revise, order))));
    if (c && c.preview_path) {
      signUrls([c.preview_path], 600).then((u) => { if (u[c.preview_path]) { coverImg.referrerPolicy = 'no-referrer'; coverImg.src = u[c.preview_path]; coverImg.hidden = false; } }).catch(() => {});
    }
    if (busy) poll(() => viewProof(orderId, true), 12000); // the new cover appears by itself
  }
  function orderText(b, busy) {
    if (b.status === 'approved') return [el('p', { text: 'You\'ve approved this proof. Finish your order in the DayCasion app: open My Keepsakes and choose this hardcover.' }), appButton()];
    if (b.status === 'expired') return [el('p', { text: 'This price has expired. Make a new free preview in the DayCasion app.' })];
    const c = b.cover || {};
    return [
      el('p', { text: 'When you\'re happy with your proof, approve it and pay in the DayCasion app: open My Keepsakes, choose this hardcover, then tap Approve for printing.' }),
      el('p', { class: 'muted small', text: `${b.page_count} pages · ${money(b.price_cents)} plus shipping (US only), paid securely in the app. Your cover and any revision you choose here are saved to your account, so the app shows the same proof.` }),
      busy ? el('p', { class: 'small err', text: 'Wait for your new cover before you approve.' }) : null,
      c.ack_needed ? el('p', { class: 'small err', text: 'Confirm the cover photo note before you approve, or choose another photo.' }) : null,
      appButton()].filter(Boolean);
  }
  function appButton() {
    return touchDevice()
      ? el('div', { class: 'actions' }, el('a', { class: 'btn', href: APP_LINK, text: 'Open the DayCasion app' }))
      : el('p', { class: 'note', text: 'On your phone or tablet, open the DayCasion app and go to My Keepsakes.' });
  }

  async function viewProofReader(orderId) {
    show(el('div', { class: 'center' }, el('div', { class: 'msg' }, el('div', { class: 'spinner', role: 'status', 'aria-label': 'Opening your proof' }))));
    let info, manifest, b;
    try { b = await findBook(orderId); } catch (e) {
      if (e.message === 'signed-out') return;
      return proofProblem('We couldn\'t open this proof.', plainErr(e.r, 'Check your connection and try again.'));
    }
    if (!b) return proofProblem('This proof isn\'t available', 'It may have been replaced by its revision. Open My Keepsakes to see your current proof.');
    if (!isHardcoverProof(b)) return proofProblem('Only hardcover proofs can be reviewed here', 'See this book in the DayCasion app.');
    try {
      const r = await rpc('dc_keepsake_proof', { p_order_id: orderId });
      if (!r.ok) throw Object.assign(new Error('proof'), { r });
      info = r.data;
      const m = await authed(`/storage/v1/object/authenticated/keepsakes/${info.manifest_path.split('/').map(encodeURIComponent).join('/')}`);
      if (!m.ok || !m.data || !Array.isArray(m.data.pages)) throw new Error('manifest');
      manifest = m.data;
    } catch (e) {
      if (e.message === 'signed-out') return;
      return e.r && e.r.status < 500
        ? proofProblem('This proof can\'t be opened yet', 'It appears here when your free preview is ready.')
        : proofProblem('We couldn\'t open this proof.', 'Check your connection and try again.');
    }
    // The book as printed: the front cover on its own, then the inside of the cover with page 1 on the right
    // (so every spread faces exactly as in the printed book), then the watermarked interior pages.
    const folder = info.manifest_path.slice(0, -'proof/manifest.json'.length);
    const coverPath = b.cover && b.cover.preview_path;
    const interior = manifest.pages.map((p) => ({ n: p.n + 2, text: p.text || '', path: folder + p.file }));
    const all = [coverPath ? { n: 1, text: 'Front cover', path: coverPath } : { n: 1, text: 'Front cover', blank: true },
      { n: 2, text: 'Inside of the front cover', blank: true }, ...interior];
    const signed = all.filter((p) => p.path);
    const sign = async () => { const u = await signUrls(signed.map((p) => p.path), 3600); const o = {}; for (const p of signed) if (u[p.path]) o[p.n] = u[p.path]; return o; };
    let urls;
    try { urls = await sign(); } catch (e) {
      if (e.message === 'signed-out') return;
      return proofProblem('We couldn\'t load the pages of this proof.', 'Check your connection and try again.');
    }
    const total = manifest.pages.length;
    const name = (n) => (n === 1 ? 'Front cover' : n === 2 ? 'Inside cover' : `Page ${n - 2}`);
    const label = (ns) => {
      const pages = ns.filter((n) => n >= 3).map((n) => n - 2);
      if (!pages.length) return ns.map(name).join(' · ');
      const pg = pages.length === 2 ? `Pages ${pages[0]}–${pages[1]} of ${total}` : `Page ${pages[0]} of ${total}`;
      return ns.includes(2) ? `Inside cover · ${pg}` : pg;
    };
    const title = [manifest.kicker, manifest.title].filter(Boolean).join(' · ');
    document.title = `${title || 'Hardcover proof'} (proof) · DayCasion`;
    $app.replaceChildren(); document.body.classList.add('reading');
    const root = el('div', { id: 'reader' }); document.body.append(root);
    reader = window.DcFlipbook.open(root, {
      title: `Proof · ${title}`, subtitle: `Hardcover · ${total} pages · ${money(b.price_cents)} · approve and pay in the DayCasion app`,
      aspect: manifest.page_aspect || 0.8, chapters: (manifest.chapters || []).map((ch) => ({ ...ch, page: ch.page + 2 })), linkSeconds: 3600,
      pages: all.map((p) => ({ n: p.n, text: p.text, blank: !p.path, url: urls[p.n] })), startPage: 1, resumed: false,
      renew: sign, label, tocNum: (n) => (n <= 2 ? '' : String(n - 2)),
      back: { label: 'Back to the proof review', onClick: () => { location.hash = `#/proof/${orderId}`; } },
    });
  }

  async function coverPicker(orderId) {
    const dlg = el('dialog', { class: 'dlg wide', 'aria-labelledby': 'cover-pick-h' });
    const body = el('div', { class: 'inner' }, el('p', { class: 'muted', text: 'Loading your photos…' }));
    dlg.append(el('div', { class: 'dhead' }, el('h2', { id: 'cover-pick-h', text: 'Change cover photo' }),
      el('button', { type: 'button', class: 'fb-icon', 'aria-label': 'Close', onclick: () => dlg.close() }, icon('close'))), body);
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg); dlg.showModal();
    let data;
    try {
      const r = await rpc('dc_keepsake_cover_options', { p_order_id: orderId });
      if (!r.ok) throw Object.assign(new Error('opts'), { r });
      data = r.data;
    } catch (e) {
      if (e.message === 'signed-out') return dlg.close();
      return body.replaceChildren(el('p', { class: 'err', text: plainErr(e.r, 'We couldn\'t load your photos.') }));
    }
    const options = data.options || [];
    const cur = data.cover || {};
    const msg = el('p', { class: 'err small', role: 'alert' });
    const choose = async (o) => {
      let ack = false;
      if (o && o.grade === 'blurry') { if (!(await blurryConfirm(data.warning))) return; ack = true; }
      for (const b of body.querySelectorAll('button')) b.disabled = true;
      const r = await rpc('dc_keepsake_set_cover', { p_order_id: orderId, p_media_id: o ? o.id : null, p_acknowledge: ack });
      if (!r.ok) { for (const b of body.querySelectorAll('button')) b.disabled = false; msg.textContent = plainErr(r, 'Please try again.'); return; }
      dlg.close(); viewProof(orderId, true);
    };
    const tiles = options.map((o) => {
      const current = o.id === cur.media_id;
      const img = el('img', { alt: '', 'data-photo': o.thumb_path || o.storage_path || '', hidden: true });
      return el('button', { type: 'button', class: `photo-tile${current ? ' current' : ''}`, disabled: current,
        'aria-label': `${o.memory_title || 'Photo'}, ${o.label}${current ? ', current cover' : ''}`, onclick: () => choose(o) },
        el('span', { class: 'ph' }, img), el('span', { class: `quality ${o.grade}`, text: o.label }),
        el('span', { class: 'muted tiny', text: o.memory_title || '' }));
    });
    const auto = options.some((o) => o.auto);
    body.replaceChildren(...[
      el('p', { class: 'muted', text: 'Choose a photo from this book for the hardcover. Only the cover is made again: your pages, price and revision stay the same. Your new cover appears here in a few minutes.' }),
      msg, cur.auto === false ? el('div', { class: 'actions', style: 'margin:0 0 12px' }, el('button', { type: 'button', class: 'btn small secondary',
        text: auto ? 'Let DayCasion choose' : 'Use a cover without a photo', onclick: () => choose(null) })) : null,
      options.length ? el('div', { class: 'photo-grid' }, tiles) : el('p', { class: 'muted', text: 'None of this book\'s photos is large enough for the cover.' })].filter(Boolean));
    // thumbnails: the member's own photos through private links (memory-media, owner folder only)
    const paths = [...new Set(options.map((o) => o.thumb_path || o.storage_path).filter(Boolean))];
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      const r = await authed('/storage/v1/object/sign/memory-media', { method: 'POST', body: { expiresIn: 600, paths: chunk } }).catch(() => null);
      if (!r || !r.ok || !Array.isArray(r.data)) continue;
      for (const x of r.data) {
        if (!x.signedURL) continue;
        for (const img of body.querySelectorAll('img[data-photo]')) if (img.dataset.photo === x.path) {
          img.referrerPolicy = 'no-referrer'; img.src = `${API}/storage/v1${x.signedURL.startsWith('/') ? '' : '/'}${x.signedURL}`; img.hidden = false;
        }
      }
    }
  }
  function blurryConfirm(warning) {
    return new Promise((resolve) => {
      const dlg = el('dialog', { class: 'dlg', 'aria-labelledby': 'blurry-h' });
      let answer = false;
      dlg.append(el('div', { class: 'dhead' }, el('h2', { id: 'blurry-h', text: 'This photo may look blurry' })),
        el('div', { class: 'inner' }, el('p', { text: warning || '' }),
          el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn', text: 'Use this photo', onclick: () => { answer = true; dlg.close(); } }),
            el('button', { type: 'button', class: 'btn secondary', text: 'Choose another', onclick: () => dlg.close() }))));
      dlg.addEventListener('close', () => { dlg.remove(); resolve(answer); });
      document.body.append(dlg); dlg.showModal();
    });
  }
  function reviseDialog(b) {
    const dlg = el('dialog', { class: 'dlg', 'aria-labelledby': 'revise-h' });
    const collages = el('input', { type: 'checkbox', id: 'revise-collages', checked: b.use_collages !== false });
    const msg = el('p', { class: 'err small', role: 'alert' });
    const go = el('button', { type: 'button', class: 'btn', text: 'Make new proof', onclick: async () => {
      go.disabled = true; msg.textContent = '';
      const r = await rpc('dc_keepsake_physical_revise', { p_order_id: b.id, p_use_collages: collages.checked });
      if (!r.ok) { go.disabled = false; msg.textContent = plainErr(r, 'Please try again.'); return; }
      dlg.close(); location.hash = `#/proof/${r.data.order_id}`;
    } });
    dlg.append(el('div', { class: 'dhead' }, el('h2', { id: 'revise-h', text: 'Request your one revision' }),
      el('button', { type: 'button', class: 'fb-icon', 'aria-label': 'Close', onclick: () => dlg.close() }, icon('close'))),
    el('div', { class: 'inner' },
      el('p', { text: 'We\'ll make a new proof with any memory changes you\'ve made since, and the option below. Your book can be revised once; after that, approve the proof you like.' }),
      el('label', { class: 'check', for: 'revise-collages' }, collages, el('span', {}, el('strong', { text: 'Use Photo Collages' }), el('br'),
        el('span', { class: 'muted small', text: 'Combine several photos of a memory into one layout.' }))),
      msg, el('div', { class: 'actions' }, go, el('button', { type: 'button', class: 'btn secondary', text: 'Cancel', onclick: () => dlg.close() }))));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg); dlg.showModal();
  }

  // ------------------------------------------------------------------ routing
  async function route() {
    if (!session) return viewSignIn();
    const m = location.hash.match(/^#\/book\/([0-9a-f-]{36})$/i);
    if (m) return viewBook(m[1]);
    const pr = location.hash.match(/^#\/proof\/([0-9a-f-]{36})(\/read)?$/i);
    if (pr) return pr[2] ? viewProofReader(pr[1]) : viewProof(pr[1]);
    document.title = 'My Keepsakes · DayCasion';
    return viewLibrary();
  }
  window.addEventListener('hashchange', () => { route(); });
  session = loadSession();
  (async () => {
    if (session && session.expires_at - Date.now() / 1000 < 90) { const ok = await refresh(); if (ok === false) { session = null; saveSession(); } }
    route();
  })();
})();
