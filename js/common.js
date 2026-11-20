/* DayCasion Keepsakes on the web: shared helpers (config, HTTP, labels as the app's DcKeepsakes). No dependencies. */
(function () {
  'use strict';
  window.DC_FRAMED = window.top !== window.self; // the pages stay hidden inside frames (no clickjacking)
  if (!window.DC_FRAMED) document.documentElement.classList.remove('dc-guard');
  const CFG = window.DC_BOOKS_CONFIG;

  /** fetch with JSON in/out; never throws (offline -> { ok: false, offline: true }). */
  async function call(url, { method = 'GET', headers = {}, body, token } = {}) {
    const h = { apikey: CFG.publishableKey, ...headers };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (token) h.Authorization = 'Bearer ' + token;
    let res;
    try {
      res = await fetch(url, { method, headers: h, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
        body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) { return { ok: false, status: 0, data: null, offline: true }; }
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    return { ok: res.ok, status: res.status, data };
  }
  const familyTitle = (f) => (f === 'biography' ? 'Life Story Biography' : 'Year in Review');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function periodLabel(type, start, end) {
    if (type === 'life_story') return 'Whole Life Story';
    if (!start || !end) return '';
    if (type === 'calendar') return start.slice(0, 4);
    const m = (iso) => `${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
    return `${m(start)} – ${m(end)}`;
  }
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');
  const errText = (r, fallback) => (r && r.data && (r.data.message || r.data.msg || r.data.error_description)) || fallback;
  const plainErr = (r, fallback) => (!r || r.offline || r.status >= 500 ? 'The connection was interrupted. Please try again.' : errText(r, fallback));
  function download(url) { // a signed link with ?download=: the browser saves (or, on iPhone, shows) the PDF
    const a = document.createElement('a'); a.href = url; a.rel = 'noopener noreferrer'; a.referrerPolicy = 'no-referrer';
    document.body.append(a); a.click(); a.remove();
  }
  window.DcBooks = { CFG, call, familyTitle, periodLabel, fmtDate, errText, plainErr, download, el: window.DcFlipbook.el, icon: window.DcFlipbook.icon };
})();
