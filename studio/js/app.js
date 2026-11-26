// ScrapCasion Studio (books.daycasion.com/studio/): sign in with the DayCasion account, your scrapbooks, a new one
// (blank or from a template), the editor and the preview. Desktop and laptop only: on a phone-sized or touch-only
// screen the editor isn't offered (scrapbooks are listed, and the app is where proofs are approved).
// Routes: #/ (scrapbooks) · #/p/<id> (editor) · #/p/<id>/preview (preview).
import { h, btn, icon, toast, dialog, confirmDialog, htmlNode, uuid, money, fmtDate } from './ui.js?v=b8eddd3961';
import { loadSession, signIn, signOut, onSignOut, rpc, currentEmail, signed } from './api.js?v=b8eddd3961';
import { renderPage, baseCss } from './scrap/scene.js?v=b8eddd3961';
import { pageBox } from './scrap/catalog.js?v=b8eddd3961';

export const ASSET = (p) => `assets/${p}`;
const $app = document.getElementById('app');
let home = null, templates = null;
export const state = { home: null };

document.documentElement.classList.remove('dc-guard');
if (window.top !== window.self) throw new Error('framed'); // never inside a frame
const fontCss = document.createElement('style'); fontCss.textContent = baseCss(ASSET); document.head.append(fontCss);

export function isDesktop() {
  const fine = window.matchMedia('(pointer: fine)').matches;
  return fine && window.innerWidth >= 1024; // a mouse or trackpad and a wide window (phones and tablets held in the hand don't qualify)
}
export async function loadTemplates() { templates ||= fetch(ASSET('templates.json')).then((r) => r.json()); return templates; }

function shell(...main) {
  return h('div', { class: 'sc-shell' },
    h('header', { class: 'sc-top' }, h('a', { class: 'sc-brand', href: '#/' }, h('img', { src: '../images/mark.png', alt: '', width: 28, height: 28 }),
      h('span', {}, 'ScrapCasion ', h('em', {}, 'Studio'))),
      h('div', { class: 'sc-top-right' }, h('span', { class: 'sc-muted' }, currentEmail()), btn('Sign out', () => signOut('You’ve signed out.'), { kind: 'ghost' }))),
    h('main', { class: 'sc-main' }, ...main));
}

function signInView(message) {
  const email = h('input', { type: 'email', id: 'email', autocomplete: 'username', required: true, autofocus: true });
  const pass = h('input', { type: 'password', id: 'password', autocomplete: 'current-password', required: true });
  const keep = h('input', { type: 'checkbox', id: 'keep', checked: true });
  const err = h('p', { class: 'sc-error', role: 'alert' }, message || '');
  const go = btn('Sign in', null, { kind: 'primary wide' }); go.type = 'submit';
  const form = h('form', { class: 'sc-card sc-signin', onsubmit: async (e) => {
    e.preventDefault(); go.disabled = true; err.textContent = '';
    const r = await signIn(email.value.trim(), pass.value, keep.checked);
    go.disabled = false;
    if (r.ok) route(); else err.textContent = r.message;
  } },
  h('img', { src: '../images/mark.png', alt: '', width: 48, height: 48 }), h('h1', {}, 'ScrapCasion Studio'),
  h('p', { class: 'sc-muted' }, 'Design scrapbooks with your DayCasion memories. Sign in with your DayCasion email and password.'),
  h('label', { for: 'email' }, 'Email'), email, h('label', { for: 'password' }, 'Password'), pass,
  h('label', { class: 'sc-check' }, keep, ' Keep me signed in on this computer'), err, go,
  h('p', { class: 'sc-small sc-muted' }, 'Forgot your password? Reset it in the DayCasion app.'));
  $app.replaceChildren(h('div', { class: 'sc-center sc-signin-wrap' }, form));
}
onSignOut((m) => signInView(m));

/** A page drawn with the one renderer, scaled to `width` px (thumbnails). Photos fill in once their links are signed. */
export function miniPage(page, width, media, index = 1) {
  const box = pageBox(page.kind, index), k = width / (box.trimW * 96 / 72);
  const { html } = renderPage(page, { index, asset: ASSET, media, editing: false });
  const node = htmlNode(html);
  node.style.transform = `translate(${-box.bleed.l * 96 / 72 * k}px, ${-box.bleed.t * 96 / 72 * k}px) scale(${k})`; node.style.transformOrigin = '0 0';
  return h('div', { class: 'sc-mini', style: { width: `${width}px`, height: `${box.trimH / box.trimW * width}px` } }, node);
}
/** A media resolver for thumbnails from dc_scrap_media rows (signed lazily). */
export async function mediaResolver(rows) {
  const by = new Map(rows.filter((m) => m.ok).map((m) => [`${m.k}:${m.id}`, m]));
  const groups = {}; for (const m of by.values()) (groups[m.bucket] ||= []).push(m.thumb || m.path);
  const urls = {}; for (const [b, paths] of Object.entries(groups)) Object.assign(urls, Object.fromEntries(Object.entries(await signed(b, paths)).map(([p, u]) => [`${b}/${p}`, u])));
  return (src) => { const m = by.get(`${src.k}:${src.id}`); if (!m) return null; return { url: urls[`${m.bucket}/${m.thumb || m.path}`], aspect: m.ar || (m.width && m.height ? m.width / m.height : null) || 1.5 }; };
}

async function homeView() {
  $app.replaceChildren(shell(h('div', { class: 'sc-center' }, h('div', { class: 'sc-spinner' }))));
  try { home = state.home = await rpc('dc_scrap_home'); } catch (e) { if (e.message !== 'signed-out') $app.replaceChildren(shell(errorBox(e.message, homeView))); return; }
  if (!home.visible) {
    $app.replaceChildren(shell(h('section', { class: 'sc-card sc-narrow' }, h('h1', {}, 'ScrapCasion is coming soon'),
      h('p', {}, 'ScrapCasion Studio isn’t available for your account yet. We’ll let you know when it’s ready.'))));
    return;
  }
  const desk = isDesktop();
  const grid = h('div', { class: 'sc-projects' });
  if (desk) grid.append(h('button', { type: 'button', class: 'sc-new', onclick: newProject, disabled: !home.can_edit, dataset: { testid: 'new-project' } }, icon('plus', 28), h('span', {}, 'New scrapbook')));
  for (const p of home.projects) grid.append(projectCard(p, desk));
  const media = home.projects.length ? await mediaResolver(await rpc('dc_scrap_media', { p_refs: home.projects.flatMap((p) => (p.cover?.els || []).filter((e) => e.t === 'photo' && e.src).map((e) => e.src)) })).catch(() => () => null) : () => null;
  for (const card of grid.querySelectorAll('[data-cover]')) {
    const p = home.projects.find((x) => x.id === card.dataset.cover);
    card.prepend(miniPage({ kind: 'cover', data: p.cover || {} }, 168, media));
  }
  const orders = home.orders.length ? h('section', { class: 'sc-section' }, h('h2', {}, 'Your books'), h('div', { class: 'sc-orders' }, home.orders.map(orderRow))) : null;
  $app.replaceChildren(shell(
    !desk ? h('div', { class: 'sc-note', role: 'note' }, icon('lock'), h('div', {}, h('strong', {}, 'ScrapCasion Studio is designed for a computer.'),
      h('p', {}, 'Open books.daycasion.com/studio on a desktop or laptop to create and edit scrapbooks. To review a finished proof and order your book, use ScrapCasion in the DayCasion app.'))) : null,
    !home.can_edit ? h('div', { class: 'sc-note' }, h('div', {}, h('strong', {}, 'A DayCasion Photo or Video plan is needed to create and edit scrapbooks.'), h('p', {}, 'You can still view your scrapbooks and books.'))) : null,
    home.uat ? h('div', { class: 'sc-note test' }, h('div', {}, h('strong', {}, 'Test account.'), h('p', {}, 'Payments use Stripe test mode and books go to the RPI sandbox: nothing is charged or printed.'))) : null,
    h('section', { class: 'sc-section' }, h('div', { class: 'sc-section-head' }, h('h1', {}, 'Your scrapbooks'),
      h('p', { class: 'sc-muted' }, 'Combine photos and stories from all your Memory Profiles. Your memories are never changed.')), grid,
      !home.projects.length ? h('p', { class: 'sc-muted' }, desk ? 'Start your first scrapbook: a blank book or one of our templates.' : 'You haven’t made a scrapbook yet.') : null),
    orders));
}
function errorBox(message, retry) { return h('div', { class: 'sc-card sc-narrow' }, h('p', { class: 'sc-error' }, message), btn('Try again', retry, { kind: 'primary' })); }
const proofLabel = (pr) => !pr ? 'No preview yet' : !pr.current && pr.status !== 'failed' ? 'Preview out of date' : ({ queued: 'Preview being made', generating: 'Preview being made',
  proof_ready: 'Preview ready', approved: 'Approved', failed: 'Preview failed', expired: 'Preview out of date' }[pr.status] || pr.status);
function projectCard(p, desk) {
  const menu = async (e) => {
    e.stopPropagation();
    const a = await dialog((close) => h('div', { class: 'sc-dlg' }, h('h2', {}, p.title),
      h('div', { class: 'sc-menu' }, btn('Rename', () => close('rename')), btn('Make a copy', () => close('copy')), btn('Delete…', () => close('delete'), { kind: 'danger-text' }), btn('Cancel', () => close(null)))), { label: 'Scrapbook options' });
    if (a === 'rename') {
      const t = await promptText('Rename scrapbook', 'Name', p.title); if (!t) return;
      try { await rpc('dc_scrap_project_rename', { p_project_id: p.id, p_title: t }); homeView(); } catch (er) { toast(er.message, 'error'); }
    } else if (a === 'copy') {
      try { await rpc('dc_scrap_project_duplicate', { p_project_id: p.id }); toast('Copy made'); homeView(); } catch (er) { toast(er.message, 'error'); }
    } else if (a === 'delete') {
      if (!(await confirmDialog('Delete this scrapbook?', `“${p.title}” and its pages will be deleted. Your memories and photos aren’t affected, and books you’ve already bought stay in Your books.`, 'Delete scrapbook', { danger: true }))) return;
      try { await rpc('dc_scrap_project_delete', { p_project_id: p.id }); toast('Scrapbook deleted'); homeView(); } catch (er) { toast(er.message, 'error'); }
    }
  };
  return h('article', { class: 'sc-project', dataset: { cover: p.id, testid: 'project' } },
    h('div', { class: 'sc-project-body' }, h('h3', {}, p.title), h('p', { class: 'sc-muted' }, `${p.page_count} page${p.page_count === 1 ? '' : 's'} · edited ${fmtDate(p.updated_at)}`),
      h('p', { class: `sc-badge ${p.proof?.current ? 'ok' : ''}` }, proofLabel(p.proof)),
      h('div', { class: 'sc-row' }, desk ? btn('Open', () => { location.hash = `#/p/${p.id}`; }, { kind: 'primary', testid: 'open' }) : null,
        p.proof ? btn('Preview', () => { location.hash = `#/p/${p.id}/preview`; }) : null, desk && home.can_edit ? btn('', menu, { ico: 'more', title: 'More options' }) : null)));
}
function orderRow(o) {
  const st = o.format === 'ebook' ? ({ queued: 'Being prepared', generating: 'Being prepared', ready: 'Ready to read', failed: 'Couldn’t be made' }[o.status] || o.status)
    : ({ queued: 'Paid: preparing print files', generating: 'Paid: preparing print files', print_ready: 'Sent to the printer', submitted: 'At the printer', in_production: 'Being printed',
      shipped: 'Shipped', refunded: 'Refunded', cancelled: 'Cancelled by the printer: we’ll contact you', failed: 'Print files couldn’t be made: we’ll contact you' }[o.status] || o.status);
  return h('div', { class: 'sc-order' }, icon(o.format === 'ebook' ? 'book' : 'print'), h('div', {}, h('strong', {}, `${o.title || 'Scrapbook'} · ${o.format === 'ebook' ? 'eBook' : 'Printed hardcover'}`),
    h('p', { class: 'sc-muted' }, `${st}${o.shipment?.tracking?.number ? ` · tracking ${o.shipment.tracking.number}` : ''} · ${fmtDate(o.created_at)}`)));
}
export function promptText(title, label, value = '') {
  return dialog((close) => { const i = h('input', { type: 'text', value, maxlength: 80, autofocus: true, 'aria-label': label });
    return h('form', { class: 'sc-dlg', onsubmit: (e) => { e.preventDefault(); const v = i.value.trim(); if (v) close(v); } }, h('h2', {}, title), h('label', {}, label), i,
      h('div', { class: 'sc-dlg-actions' }, btn('Cancel', () => close(null)), Object.assign(btn('Save', null, { kind: 'primary' }), { type: 'submit' }))); }, { label: title });
}

/** New scrapbook: name, then blank or a template (every template is fully editable). */
async function newProject() {
  const list = await loadTemplates();
  const choice = await dialog((close) => {
    const name = h('input', { type: 'text', maxlength: 80, value: 'Our scrapbook', autofocus: true, id: 'new-title', 'aria-label': 'Scrapbook name' });
    let picked = null;
    const cards = [{ key: null, label: 'Blank scrapbook', description: 'A cover and one empty page. Add pages as you go.', category: 'Start from scratch' }, ...list].map((t) => {
      const c = h('button', { type: 'button', class: 'sc-tpl', dataset: { testid: `tpl-${t.key || 'blank'}` }, onclick: () => { picked = t; for (const x of grid.children) x.classList.toggle('on', x === c); } },
        t.pages ? miniPage(t.pages[0], 150, () => null) : h('div', { class: 'sc-mini sc-blank', style: { width: '150px', height: '186px' } }, icon('plus', 30)),
        h('strong', {}, t.label), h('span', { class: 'sc-muted' }, t.category));
      return c;
    });
    const grid = h('div', { class: 'sc-tpls' }, cards);
    cards[0].click();
    return h('form', { class: 'sc-dlg', onsubmit: (e) => { e.preventDefault(); if (name.value.trim()) close({ title: name.value.trim(), t: picked }); } },
      h('h2', {}, 'New scrapbook'), h('label', { for: 'new-title' }, 'Name'), name, h('p', { class: 'sc-label' }, 'Start from'), grid,
      h('p', { class: 'sc-small sc-muted' }, 'Templates are just a starting point: replace the photos, change the backgrounds and text, and move or delete anything.'),
      h('div', { class: 'sc-dlg-actions' }, btn('Cancel', () => close(null)), Object.assign(btn('Create scrapbook', null, { kind: 'primary', testid: 'create' }), { type: 'submit' })));
  }, { label: 'New scrapbook', wide: true });
  if (!choice) return;
  try {
    const pages = choice.t?.pages ? choice.t.pages.map((p) => ({ id: uuid(), kind: p.kind, data: p.data })) : null;
    const p = await rpc('dc_scrap_project_create', { p_title: choice.title, p_pages: pages, p_template_key: choice.t?.key || null });
    if (choice.t?.settings) await rpc('dc_scrap_project_save', { p_project_id: p.id, p_base_revision: p.revision, p_order: p.pages.map((x) => x.id), p_pages: [], p_settings: { ...choice.t.settings, spine: { ...choice.t.settings.spine, text: choice.title } } });
    location.hash = `#/p/${p.id}`;
  } catch (e) { toast(e.message, 'error'); }
}

export async function route() {
  if (!loadSession()) { signInView(); return; }
  const m = location.hash.match(/^#\/p\/([0-9a-f-]{36})(\/preview)?$/);
  if (m && m[2]) { const { previewView } = await import('./preview.js?v=b8eddd3961'); return previewView(m[1], $app); }
  if (m) {
    if (!isDesktop()) { location.hash = '#/'; return; }
    const { editorView } = await import('./editor.js?v=b8eddd3961'); return editorView(m[1], $app);
  }
  return homeView();
}
let current = location.hash;
window.addEventListener('hashchange', async () => {
  if (window.__scLeave && !(await window.__scLeave())) { history.replaceState(null, '', current); return; }
  current = location.hash; route();
});
route();
