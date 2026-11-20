/* books.daycasion.com/s/#<link> : a shared Keepsakes book for a guest (no DayCasion app or account).
 * The link's secret stays in the address fragment (never sent to the web host or in a Referer); this page posts it
 * to the keepsake-share function, which answers with the book (titles, chapters, page text, 15-minute private page
 * links) or a plain "unavailable"/"expired". The reading position is kept in this browser only. */
(function () {
  'use strict';
  if (window.DC_FRAMED) return;
  const { CFG, call, download, el } = window.DcBooks;
  const FN = `${CFG.supabaseUrl}/functions/v1/keepsake-share`;
  const $app = document.getElementById('app');
  const token = decodeURIComponent((location.hash || '').replace(/^#/, '')).trim();
  let reader = null;

  function message(title, text, retry) {
    if (reader) { reader.destroy(); reader = null; }
    document.body.classList.remove('reading');
    $app.replaceChildren(el('div', { class: 'center' }, el('div', { class: 'card msg' },
      el('img', { class: 'mark', src: '../images/mark.png', alt: 'DayCasion', width: 44, height: 44 }),
      el('h1', { class: 'page', style: 'margin-top:12px', text: title }), el('p', { class: 'muted', text }),
      retry ? el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn', text: 'Try again', onclick: retry })) : null,
      el('p', { class: 'small muted', style: 'margin-top:22px' }, 'DayCasion keeps family memories private. ',
        el('a', { href: 'https://daycasion.com', rel: 'noopener noreferrer', target: '_blank', text: 'About DayCasion' })))));
  }
  const fetchBook = (first) => call(FN, { method: 'POST', body: { token, first } });

  async function start() {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      return message('This link isn\'t complete', 'Check that the whole link was copied, or ask the person who shared the book to send it again.');
    }
    $app.replaceChildren(el('div', { class: 'center' }, el('div', {}, el('div', { class: 'spinner', role: 'status', 'aria-label': 'Opening the book' }))));
    const r = await fetchBook(true);
    if (!r.ok) {
      if (r.status === 410) return message('This link has ended', 'The person who shared this book set an end date for the link. Ask them for a new one.');
      if (r.status === 404) return message('This book isn\'t available', 'The link may have been stopped by the person who shared it, or it was copied incorrectly.');
      return message('We couldn\'t open the book', 'Check your connection and try again.', start);
    }
    const b = r.data;
    let key = '';
    try { const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))); key = 'dcshared.' + Array.from(d.slice(0, 8), (x) => x.toString(16).padStart(2, '0')).join(''); } catch (e) { /* no storage key */ }
    let saved = 0; try { saved = key ? +(localStorage.getItem(key) || 0) : 0; } catch (e) { /* storage off */ }
    const title = [b.kicker, b.title].filter(Boolean).join(' · ');
    document.title = `${title || 'Keepsake book'} · DayCasion`;
    $app.replaceChildren(); document.body.classList.add('reading');
    const root = el('div', { id: 'reader' }); document.body.append(root);
    reader = window.DcFlipbook.open(root, {
      title, subtitle: b.shared_by ? `Shared by ${b.shared_by} · Made with DayCasion` : 'Made with DayCasion',
      aspect: b.page_aspect, chapters: b.chapters || [], linkSeconds: b.link_seconds || 900,
      pages: b.pages, startPage: saved || 1, resumed: saved > 1,
      brand: { href: 'https://daycasion.com', logo: '../images/mark.png', label: 'DayCasion (opens in a new tab)' },
      renew: async () => {
        const n = await fetchBook(false);
        if (!n.ok) {
          if (n.status === 404 || n.status === 410) setTimeout(() => (n.status === 410
            ? message('This link has ended', 'The person who shared this book set an end date for the link. Ask them for a new one.')
            : message('This book isn\'t available any more', 'The person who shared it stopped this link.')), 0);
          throw new Error('renew');
        }
        const o = {}; for (const p of n.data.pages) if (p.url) o[p.n] = p.url; return o;
      },
      onPage: (p) => { try { if (key) localStorage.setItem(key, String(p)); } catch (e) { /* storage off */ } },
      pdf: b.allow_pdf ? async () => {
        const x = await call(FN, { method: 'POST', body: { token, pdf: true } });
        if (!x.ok || !x.data || !x.data.pdf_url) throw new Error('pdf');
        download(x.data.pdf_url);
      } : null,
    });
  }
  window.addEventListener('hashchange', () => location.reload());
  start();
})();
