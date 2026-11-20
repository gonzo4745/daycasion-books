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
  const show = (...nodes) => { closeReader(); document.body.classList.remove('reading'); $app.replaceChildren(...nodes); window.scrollTo(0, 0); };
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
      el('p', { class: 'lede', text: 'Read your DayCasion books as a flipbook on your computer, tablet or phone, and share them privately with family.' }),
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
  async function viewLibrary() {
    show(page(el('h1', { class: 'page', text: 'My Keepsakes' }), el('div', { class: 'card' }, el('p', { class: 'muted', text: 'Loading your books…' }))));
    try { library = await loadLibrary(); } catch (e) {
      if (e.message === 'signed-out') return;
      return show(page(el('h1', { class: 'page', text: 'My Keepsakes' }), el('div', { class: 'card' }, el('p', { class: 'err', text: plainErr(e.r, "We couldn't load your books.") }),
        el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn', text: 'Try again', onclick: viewLibrary })))));
    }
    const ready = library.books.filter((b) => b.status === 'ready');
    const grid = el('div', { class: 'books' }, library.books.map(bookCard));
    const intro = el('p', { class: 'lede', text: ready.length ? 'Open a book to read it as a flipbook, or share it privately with family and friends.' : '' });
    const empty = !library.books.length ? el('div', { class: 'card' }, el('h2', { text: library.visible ? 'No books yet' : 'Keepsakes aren\'t available for this account yet' }),
      el('p', { class: 'muted', text: library.visible ? 'Order a Year in Review or Life Story Biography eBook in the DayCasion app. It appears here when it\'s ready.' : 'Your finished DayCasion books will appear here.' })) : null;
    show(page(el('h1', { class: 'page', text: 'My Keepsakes' }), intro, empty, grid));
    covers(ready);
  }
  function bookCard(b) {
    const title = `${b.profile_name || ''} · ${familyTitle(b.family)}`;
    const meta = ['eBook', periodLabel(b.period_type, b.period_start, b.period_end), b.file ? `${b.file.pages} pages` : '', b.reader_page > 1 ? `read to page ${b.reader_page}` : '']
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
      body.replaceChildren(
        el('p', { class: 'muted', text: `${title}. Anyone with a link can read this book in their browser — no app or account needed. Links are private and never listed or searchable. You can stop a link at any time.` }),
        fresh, state.available ? form : null,
        el('h3', { text: 'Your links' }), list,
        active > 1 ? el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn small danger', text: 'Stop sharing this book', onclick: async () => {
          if (!confirm(`Stop all ${active} links? Anyone using them will no longer be able to open the book.`)) return;
          const r = await rpc('dc_keepsake_share_revoke_all', { p_order_id: orderId }); if (!r.ok) alert(plainErr(r, 'Please try again.'));
          created = null; await load().catch(() => {});
        } })) : null);
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

  // ------------------------------------------------------------------ routing
  async function route() {
    if (!session) return viewSignIn();
    const m = location.hash.match(/^#\/book\/([0-9a-f-]{36})$/i);
    if (m) return viewBook(m[1]);
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
