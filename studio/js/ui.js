// ScrapCasion Studio: small DOM helpers (elements, icons, dialogs, toasts) and a DOM morph that keeps unchanged nodes
// (so a photo's <img> isn't reloaded while it is moved or resized).

/** h('div', { class: 'x', onclick }, child, 'text', [more]) - text is always text (never HTML). */
export function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k in e && typeof v !== 'string') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}
const PATHS = {
  back: 'M15 18l-6-6 6-6', undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3', redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3',
  plus: 'M12 5v14M5 12h14', copy: 'M8 8h11v11H8zM5 16V5h11', trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  up: 'M12 19V5M5 12l7-7 7 7', down: 'M12 5v14M5 12l7 7 7-7', front: 'M4 4h10v10H4zM10 10h10v10H10z', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  photo: 'M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4M15 9h.01', text: 'M5 6h14M12 6v13M9 19h6', sticker: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  shape: 'M4 4h7v7H4zM17.5 3.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM4 20l3.5-6 3.5 6zM14 14h6v6h-6z', bg: 'M3 3h18v18H3zM3 15l6-6 12 12M14 8h.01',
  layout: 'M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z', crop: 'M6 2v16h16M2 6h16v16', flip: 'M12 3v18M8 7l-5 5 5 5V7zM16 7l5 5-5 5V7z',
  check: 'M5 12l5 5 9-9', x: 'M6 6l12 12M18 6L6 18', upload: 'M12 16V4M7 9l5-5 5 5M4 20h16', book: 'M2 5h6a4 4 0 0 1 4 4v11a3 3 0 0 0-3-3H2zM22 5h-6a4 4 0 0 0-4 4v11a3 3 0 0 1 3-3h7z',
  left: 'M15 18l-6-6 6-6', right: 'M9 18l6-6-6-6', grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z', search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5',
  print: 'M6 9V3h12v6M6 18H4v-7h16v7h-2M6 14h12v7H6z', more: 'M5 12h.01M12 12h.01M19 12h.01', guide: 'M3 3h18v18H3zM7 7h10v10H7z', zoomin: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5M8 11h6M11 8v6',
  zoomout: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5M8 11h6', lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
};
export function icon(name, size = 18) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('aria-hidden', 'true');
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', PATHS[name] || ''); s.append(p);
  return s;
}
export const btn = (label, onclick, { kind = '', ico, title, disabled, testid } = {}) =>
  h('button', { type: 'button', class: `sc-btn ${kind}`, onclick, title: title || null, 'aria-label': title || null, disabled: !!disabled, dataset: testid ? { testid } : null },
    ico ? icon(ico) : null, label ? h('span', {}, label) : null);

let toastTimer;
export function toast(text, kind = '') {
  let t = document.getElementById('sc-toast');
  if (!t) { t = h('div', { id: 'sc-toast', role: 'status' }); document.body.append(t); }
  t.className = `sc-toast show ${kind}`; t.textContent = text;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), kind === 'error' ? 6000 : 2800);
}

/** A modal dialog; resolves with the value given to close(). */
export function dialog(build, { label = 'Dialog', wide = false } = {}) {
  return new Promise((resolve) => {
    const d = h('dialog', { class: `sc-dialog${wide ? ' wide' : ''}`, 'aria-label': label });
    const close = (v) => { d.close(); d.remove(); resolve(v); };
    d.append(build(close));
    d.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    document.body.append(d); d.showModal();
    const f = d.querySelector('[autofocus]'); if (f) f.focus();
  });
}
export function confirmDialog(title, message, ok = 'OK', { danger = false } = {}) {
  return dialog((close) => h('div', { class: 'sc-dlg' }, h('h2', {}, title), h('p', {}, message),
    h('div', { class: 'sc-dlg-actions' }, btn('Cancel', () => close(false)), btn(ok, () => close(true), { kind: danger ? 'danger' : 'primary' }))), { label: title });
}

/** Morphs `from` into `to` in place: same tag -> attributes synced and children morphed; else replaced. */
export function morph(from, to) {
  if (from.nodeType !== to.nodeType || from.nodeName !== to.nodeName) { from.replaceWith(to); return; }
  if (from.nodeType === 3) { if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue; return; }
  if (from.nodeType !== 1) return;
  for (const a of [...from.attributes]) if (!to.hasAttribute(a.name)) from.removeAttribute(a.name);
  for (const a of [...to.attributes]) if (from.getAttribute(a.name) !== a.value) from.setAttribute(a.name, a.value);
  const fk = [...from.childNodes], tk = [...to.childNodes];
  for (let i = 0; i < tk.length; i++) { if (i < fk.length) morph(fk[i], tk[i]); else from.append(tk[i]); }
  for (let i = tk.length; i < fk.length; i++) fk[i].remove();
}
export function htmlNode(html) { const t = document.createElement('template'); t.innerHTML = html; return t.content.firstElementChild; }
export const uuid = () => crypto.randomUUID();
export const shortId = () => Math.random().toString(36).slice(2, 10);
export const money = (c) => (c == null ? '' : `$${(c / 100).toFixed(2)}`);
export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');
