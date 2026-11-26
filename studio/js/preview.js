// ScrapCasion Studio: the preview. The pages shown are images made from the book's print files (the same files the
// DayCasion app shows for the final approval and RPI prints), so what you see here is what will be printed.
// Anything that needs attention (a photo that may print soft, text that doesn't fit its box, an item near the edge
// that may be trimmed, blank pages added) is listed with its page. Approval and ordering happen in the app.
import { h, btn, icon, toast, money, fmtDate } from './ui.js?v=b8eddd3961';
import { rpc, signed } from './api.js?v=b8eddd3961';
import { isDesktop, state } from './app.js?v=b8eddd3961';

const WARN = {
  photo_soft: (w) => `A photo may print slightly soft (about ${w.ppi} pixels per inch). A larger version of the photo, or a smaller photo box, prints sharper.`,
  photo_blurry: (w) => `A photo will print blurry (about ${w.ppi} pixels per inch). Make its box smaller or use a larger photo.`,
  text_overflow: () => 'Some text doesn’t fit its box and is cut off. Make the box bigger or the text smaller.',
  near_edge: () => 'Text or a sticker is close to the edge of the page and may be trimmed. Move it inside the dotted safe line.',
  blank_pages_added: (w) => `${w.count} blank page${w.count === 1 ? ' was' : 's were'} added at the end: printed books have at least 20 pages and an even number of pages.`,
};
const pageName = (p) => (p == null ? '' : p === 0 ? 'Cover' : `Page ${p}`);

export async function previewView(projectId, $app) {
  let stopped = false;
  window.__scLeave = async () => { stopped = true; window.__scLeave = null; return true; };
  const wrap = h('div', { class: 'sc-preview' });
  const topBar = h('header', { class: 'sc-ed-top' }, btn('', () => { location.hash = isDesktop() ? `#/p/${projectId}` : '#/'; }, { ico: 'back', title: isDesktop() ? 'Back to the editor' : 'Back', testid: 'back' }),
    h('strong', { class: 'sc-title-btn' }, 'Preview'), h('div', { class: 'sc-spacer' }));
  $app.replaceChildren(h('div', { class: 'sc-editor' }, topBar, wrap));
  const busy = (text) => wrap.replaceChildren(h('div', { class: 'sc-center sc-col' }, h('div', { class: 'sc-spinner' }), h('p', { dataset: { testid: 'preview-status' } }, text)));
  busy('Opening…');
  let home;
  try { home = state.home = await rpc('dc_scrap_home'); } catch (e) { wrap.replaceChildren(h('p', { class: 'sc-error' }, e.message)); return; }
  const project = home.projects.find((p) => p.id === projectId);
  if (!project) { wrap.replaceChildren(h('div', { class: 'sc-card sc-narrow' }, h('p', {}, 'This scrapbook isn’t available.'))); return; }
  topBar.querySelector('.sc-title-btn').textContent = `Preview · ${project.title}`;

  async function makeNew() {
    busy('Saving your latest changes…');
    try {
      const p = await rpc('dc_scrap_project_get', { p_project_id: projectId });
      const r = await rpc('dc_scrap_proof_request', { p_project_id: projectId, p_revision: p.revision });
      return r.order_id;
    } catch (e) {
      wrap.replaceChildren(h('div', { class: 'sc-card sc-narrow' }, h('h2', {}, 'The preview couldn’t be made'), h('p', { class: 'sc-error', dataset: { testid: 'preview-error' } }, e.message),
        btn('Back to the editor', () => { location.hash = `#/p/${projectId}`; }, { kind: 'primary' })));
      return null;
    }
  }
  // the current preview (being made, ready or approved); else a new one (an unchanged design reuses its preview);
  // where nothing can be made (phone, no plan) the latest one, marked out of date
  const pr = project.proof;
  let orderId = null;
  if (pr && pr.current && pr.status !== 'failed') orderId = pr.order_id;
  else if (isDesktop() && home.can_edit) orderId = await makeNew();
  else if (pr) orderId = pr.order_id;
  else { wrap.replaceChildren(h('div', { class: 'sc-card sc-narrow' }, h('p', {}, 'There\u2019s no preview of this scrapbook yet. Make one in ScrapCasion Studio on a computer.'))); return; }
  if (!orderId) return;
  // wait for the render (a few minutes: the worker runs on a schedule)
  let proof, t0 = Date.now();
  for (;;) {
    if (stopped) return;
    try { proof = await rpc('dc_scrap_proof', { p_order_id: orderId }); } catch (e) { wrap.replaceChildren(h('p', { class: 'sc-error' }, e.message)); return; }
    if (['proof_ready', 'approved'].includes(proof.status) || proof.stage !== 'preview' || ['failed', 'expired', 'cancelled'].includes(proof.status)) break;
    busy(`Making your preview with the print files… ${Math.round((Date.now() - t0) / 1000)} s (this usually takes a few minutes; you can keep this page open or come back later)`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (proof.status === 'failed') {
    wrap.replaceChildren(h('div', { class: 'sc-card sc-narrow' }, h('h2', {}, 'The preview couldn’t be made'),
      h('p', { dataset: { testid: 'preview-failed' } }, (() => { const m = /^photo_(missing|unreadable):page:(\d+)/.exec(proof.last_error || '');
        return m ? `A photo on ${pageName(Number(m[2]))} couldn\u2019t be ${m[1] === 'missing' ? 'found' : 'read'} (it may have been deleted from its memory). Replace it in the editor, then make a new preview.`
          : 'Something went wrong while making the print files. Please try again; if it keeps happening, contact us at info@daycasion.com.'; })()),
      btn('Try again', async () => { const id = await makeNew(); if (id) previewView(projectId, $app); }, { kind: 'primary' })));
    return;
  }
  // the pages, from the proof's manifest
  let manifest;
  try {
    const u = await signed('keepsakes', [proof.manifest_path]);
    manifest = await (await fetch(u[proof.manifest_path], { cache: 'no-store', referrerPolicy: 'no-referrer' })).json();
  } catch (e) { wrap.replaceChildren(h('p', { class: 'sc-error' }, 'The preview pages couldn’t be opened. Please try again.')); return; }
  const folder = proof.manifest_path.replace(/\/reader\/manifest\.json$/, '');
  const paths = manifest.pages.map((p) => `${folder}/${p.file}`);
  const urls = await signed('keepsakes', paths, 3600);
  let at = 0, spread = true;
  const viewer = h('div', { class: 'sc-viewer', dataset: { testid: 'viewer' } });
  const counter = h('span', { class: 'sc-muted' });
  const show = () => {
    const pages = manifest.pages.length;
    // cover alone; then facing pages 1|2? Books open with page 1 on the right: spreads are (1), (2,3), (4,5)...
    let idx = [at];
    if (spread && at > 0) { const left = at % 2 === 0 ? at : at - 1; idx = left === 0 ? [1] : [left, left + 1].filter((i) => i < pages); }
    viewer.replaceChildren(...idx.map((i) => h('figure', { class: 'sc-proof-page' }, h('img', { src: urls[paths[i]], alt: manifest.pages[i].text ? `${pageName(i)}: ${manifest.pages[i].text.slice(0, 120)}` : pageName(i), dataset: { testid: `proof-${i}` } }),
      h('figcaption', {}, pageName(i)))));
    counter.textContent = idx.map(pageName).join(' and ') + ` of ${pages - 1} pages`;
  };
  const step = (d) => { const pages = manifest.pages.length; if (spread) { at = at === 0 ? (d > 0 ? 1 : 0) : at === 1 && d < 0 ? 0 : Math.max(0, Math.min(pages - 1, (at % 2 ? at - 1 : at) + 2 * d)); if (at < 0) at = 0; } else at = Math.max(0, Math.min(pages - 1, at + d)); show(); };
  const warnings = (proof.warnings || []);
  const total = proof.price_cents != null ? proof.price_cents + (proof.shipping_cents || 0) : null;
  const side = h('aside', { class: 'sc-proof-side' },
    !proof.current ? h('div', { class: 'sc-note warn', dataset: { testid: 'outdated' } }, h('div', {}, h('strong', {}, 'This preview is out of date.'),
      h('p', {}, 'The scrapbook was changed after this preview was made. Make a new preview before approving.'),
      isDesktop() && home.can_edit ? btn('Make a new preview', async () => { const id = await makeNew(); if (id) previewView(projectId, $app); }, { kind: 'primary', testid: 'remake' }) : null)) : null,
    h('h2', {}, 'Printed hardcover'), h('p', { dataset: { testid: 'price' } }, `8 × 10 in hardcover, ${proof.page_count} pages: ${money(proof.price_cents)}`, h('br'), `Standard shipping ${money(proof.shipping_cents)} (contiguous US and Washington, DC)`),
    total ? h('p', {}, h('strong', {}, `Total ${money(total)}`)) : null,
    h('p', { class: 'sc-small sc-muted' }, `Preview made ${fmtDate(proof.created_at)}. The price is guaranteed until ${fmtDate(proof.quote_expires_at)}.`),
    h('h3', {}, warnings.length ? 'Please check' : 'Ready to print'),
    warnings.length ? h('ul', { class: 'sc-warnings', dataset: { testid: 'warnings' } }, warnings.map((w) => h('li', {}, w.page != null ? h('button', { type: 'button', class: 'sc-link', onclick: () => { at = w.page; show(); } }, pageName(w.page)) : null, ' ', (WARN[w.code] || (() => w.code))(w))))
      : h('p', { class: 'sc-muted' }, 'Nothing needs attention.'),
    h('div', { class: 'sc-note', role: 'note' }, icon('book'), h('div', {}, h('strong', {}, 'Approve and order in the DayCasion app'),
      h('p', {}, 'Open the DayCasion app, go to ScrapCasion and choose this scrapbook to review the final proof, approve it and order your eBook or printed hardcover.'),
      h('p', { class: 'sc-small sc-muted' }, 'Want to change something? Edit the scrapbook here, then make a new preview. A changed scrapbook always needs a new preview and approval.'))),
    proof.approved && proof.current ? h('p', { class: 'sc-badge ok' }, 'You approved this preview in the app.') : null);
  wrap.replaceChildren(h('div', { class: 'sc-preview-body' }, h('div', { class: 'sc-preview-main' },
    h('div', { class: 'sc-row center' }, btn('', () => step(-1), { ico: 'left', title: 'Previous', testid: 'prev' }), counter, btn('', () => step(1), { ico: 'right', title: 'Next', testid: 'next' }),
      h('span', { class: 'sc-sep' }), btn(spread ? 'Single pages' : 'Two-page spreads', (e) => { spread = !spread; e.currentTarget.querySelector('span').textContent = spread ? 'Single pages' : 'Two-page spreads'; show(); }, { kind: 'ghost' })),
    viewer), side));
  document.onkeydown = (e) => { if (!document.body.contains(viewer)) { document.onkeydown = null; return; } if (e.key === 'ArrowRight') step(1); if (e.key === 'ArrowLeft') step(-1); };
  show();
  if (!project.proof?.current && proof.current) toast('Your preview is ready.');
}
