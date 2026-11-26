// ScrapCasion Studio: the photo library. Memories from ALL of the member's Memory Profiles (filter by profile, year,
// words), their photos, titles, stories and dates; and photos uploaded just for scrapbooks (no memory is made).
// Memories are only read: a scrapbook points at their photos and copies their words.
import { h, btn, icon, toast, confirmDialog } from './ui.js?v=b8eddd3961';
import { rpc, signed, linkOf, upload, removeFiles } from './api.js?v=b8eddd3961';

const fmtMemDate = (d, p) => {
  if (!d) return '';
  const dt = new Date(`${d}T12:00:00`);
  if (p === 'year' || p === 'approximate') return `${p === 'approximate' ? 'About ' : ''}${dt.getFullYear()}`;
  if (p === 'month' || p === 'approximate_month') return dt.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return dt.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
};

export function libraryPanel({ canEdit, onPick, registerMedia }) {
  const S = { sub: 'memories', profiles: null, years: [], selProfiles: new Set(), year: '', q: '', items: [], total: 0, loading: false, uploads: null };
  const node = h('div', { class: 'sc-pane sc-library' });
  const drag = (item) => ({ draggable: 'true', ondragstart: (e) => { e.dataTransfer.setData('text/x-scrap', JSON.stringify(item)); e.dataTransfer.effectAllowed = 'copy'; } });
  const photoItem = (k, id, info, ar) => ({ kind: 'photo', src: { k, id }, media: info, ar });

  async function loadProfiles() {
    if (S.profiles) return;
    try { const r = await rpc('dc_scrap_profiles'); S.profiles = r.profiles; S.years = r.years; } catch (e) { S.profiles = []; toast(e.message, 'error'); }
  }
  async function search(more = false) {
    S.loading = true; render();
    try {
      const r = await rpc('dc_scrap_library', { p_profile_ids: S.selProfiles.size ? [...S.selProfiles] : null, p_year: S.year ? Number(S.year) : null,
        p_query: S.q || null, p_photos_only: true, p_offset: more ? S.items.length : 0, p_limit: 30 });
      S.items = more ? [...S.items, ...r.items] : r.items; S.total = r.total;
      await signed('memory-media', r.items.flatMap((m) => m.photos.map((p) => p.thumb)));
      for (const m of r.items) for (const p of m.photos) registerMedia(`m:${p.id}`, { bucket: 'memory-media', path: p.path, thumb: p.thumb });
    } catch (e) { toast(e.message, 'error'); }
    S.loading = false; render();
  }
  async function loadUploads() {
    try { S.uploads = await rpc('dc_scrap_uploads'); await signed('scrapcasion', S.uploads.map((u) => u.thumb));
      for (const u of S.uploads) registerMedia(`u:${u.id}`, { bucket: 'scrapcasion', path: u.path, thumb: u.thumb, ar: u.width / u.height }); }
    catch (e) { S.uploads = []; toast(e.message, 'error'); }
    render();
  }
  async function addFiles(files) {
    for (const f of files) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) { toast(`${f.name}: use a JPEG, PNG or WebP photo.`, 'error'); continue; }
      try {
        const bmp = await createImageBitmap(f); const w = bmp.width, hgt = bmp.height;
        const k = Math.min(1, 480 / Math.max(w, hgt)), c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(hgt * k);
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close();
        const thumb = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.82));
        const b = await rpc('dc_scrap_upload_begin', { p_mime: f.type, p_bytes: f.size, p_file_name: f.name });
        await upload('scrapcasion', b.path, f, f.type);
        await upload('scrapcasion', b.thumb_path, thumb, 'image/jpeg');
        await rpc('dc_scrap_upload_complete', { p_upload_id: b.id, p_width: w, p_height: hgt });
        toast(`${f.name} uploaded`);
      } catch (e) { toast(`${f.name}: ${e.message}`, 'error'); }
    }
    loadUploads();
  }
  async function delUpload(u) {
    if (!(await confirmDialog('Delete this photo?', 'It will be removed from your scrapbook photos. Photos in your DayCasion memories aren’t affected.', 'Delete photo', { danger: true }))) return;
    try { const r = await rpc('dc_scrap_upload_delete', { p_upload_id: u.id }); await removeFiles(r.bucket, r.paths); toast('Photo deleted'); loadUploads(); }
    catch (e) { toast(e.message, 'error'); }
  }

  function memoryCard(m) {
    const date = fmtMemDate(m.occurred_on, m.date_precision);
    const textBtn = (label, text, style, w, hh) => btn(label, () => onPick({ kind: 'text', text, style, w, h: hh }), { kind: 'mini', disabled: !canEdit });
    return h('article', { class: 'sc-mem', dataset: { testid: 'memory' } },
      h('div', { class: 'sc-mem-head' }, h('strong', {}, m.title), h('span', { class: 'sc-muted sc-small' }, [date, m.profiles.map((p) => p.name).join(', ')].filter(Boolean).join(' · '))),
      h('div', { class: 'sc-mem-photos' }, m.photos.map((p) => {
        const item = photoItem('m', p.id, { bucket: 'memory-media', path: p.path, thumb: p.thumb });
        const img = h('img', { src: linkOf('memory-media', p.thumb) || '', alt: `Photo from “${m.title}”`, loading: 'lazy', draggable: 'false' });
        img.onload = () => { item.ar = img.naturalWidth / img.naturalHeight; };
        return h('button', { type: 'button', class: 'sc-lib-photo', title: 'Click to add, or drag onto the page', dataset: { testid: 'lib-photo' }, disabled: !canEdit, ...drag(item),
          ondragstart: (e) => { item.ar = img.naturalWidth ? img.naturalWidth / img.naturalHeight : item.ar; e.dataTransfer.setData('text/x-scrap', JSON.stringify(item)); }, onclick: () => onPick(item) }, img);
      })),
      h('div', { class: 'sc-row wrap' }, textBtn('+ Title', m.title, { font: 'playfair', size: 26, weight: 700 }, 360, 44),
        m.body ? textBtn('+ Story', m.body.slice(0, 1200), { font: 'lora', size: 12, lh: 1.45 }, 320, Math.min(400, 40 + Math.ceil(m.body.length / 55) * 16)) : null,
        date ? textBtn('+ Date', date, { font: 'dmsans', size: 12, weight: 700, ls: 0.1, color: '#8C6A48' }, 200, 24) : null));
  }
  function render() {
    const sub = h('div', { class: 'sc-subtabs', role: 'tablist' }, [['memories', 'From my memories'], ['uploads', 'Uploaded photos']].map(([id, label]) =>
      h('button', { type: 'button', role: 'tab', 'aria-selected': S.sub === id ? 'true' : 'false', class: `sc-subtab${S.sub === id ? ' on' : ''}`, dataset: { testid: `lib-${id}` },
        onclick: () => { S.sub = id; if (id === 'uploads' && !S.uploads) loadUploads(); render(); } }, label)));
    let body;
    if (S.sub === 'memories') {
      const q = h('input', { type: 'search', placeholder: 'Search memories', value: S.q, 'aria-label': 'Search memories', dataset: { testid: 'lib-search' },
        onkeydown: (e) => { if (e.key === 'Enter') { S.q = e.target.value.trim(); search(); } } });
      body = h('div', {},
        h('div', { class: 'sc-chips', role: 'group', 'aria-label': 'Memory Profiles' }, h('button', { type: 'button', class: `sc-chip${!S.selProfiles.size ? ' on' : ''}`, dataset: { testid: 'lib-all' }, onclick: () => { S.selProfiles.clear(); search(); } }, 'All profiles'),
          (S.profiles || []).map((p) => h('button', { type: 'button', class: `sc-chip${S.selProfiles.has(p.id) ? ' on' : ''}`, 'aria-pressed': S.selProfiles.has(p.id) ? 'true' : 'false', dataset: { testid: 'lib-profile' },
            onclick: () => { if (S.selProfiles.has(p.id)) S.selProfiles.delete(p.id); else S.selProfiles.add(p.id); search(); } }, `${p.name} (${p.photos})`))),
        h('select', { class: 'sc-year', 'aria-label': 'Year', dataset: { testid: 'lib-year' }, onchange: (e) => { S.year = e.target.value; search(); } },
          h('option', { value: '' }, 'All years'), S.years.map((y) => h('option', { value: y, selected: String(y) === S.year }, String(y)))),
        h('div', { class: 'sc-row' }, q, btn('', () => { S.q = q.value.trim(); search(); }, { ico: 'search', title: 'Search' })),
        h('p', { class: 'sc-muted sc-small', dataset: { testid: 'lib-count' } }, S.loading ? 'Loading…' : `${S.total} memor${S.total === 1 ? 'y' : 'ies'} with photos`),
        h('div', { class: 'sc-mem-list' }, S.items.map(memoryCard)),
        S.items.length < S.total ? btn('Show more', () => search(true), { kind: 'wide', disabled: S.loading }) : null);
    } else {
      const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: true, hidden: true, dataset: { testid: 'upload-input' }, onchange: (e) => { addFiles([...e.target.files]); e.target.value = ''; } });
      body = h('div', {}, h('p', { class: 'sc-muted sc-small' }, 'Photos you upload here are only for your scrapbooks: no DayCasion memory is made. JPEG, PNG or WebP, up to 30 MB each.'),
        file, btn('Upload photos', () => file.click(), { kind: 'primary wide', ico: 'upload', disabled: !canEdit, testid: 'upload' }),
        S.uploads == null ? h('p', { class: 'sc-muted' }, 'Loading…') : !S.uploads.length ? h('p', { class: 'sc-muted' }, 'No uploaded photos yet.') :
          h('div', { class: 'sc-upload-grid' }, S.uploads.map((u) => {
            const item = photoItem('u', u.id, { bucket: 'scrapcasion', path: u.path, thumb: u.thumb, ar: u.width / u.height }, u.width / u.height);
            return h('div', { class: 'sc-upload' }, h('button', { type: 'button', class: 'sc-lib-photo', title: u.file_name || 'Uploaded photo', dataset: { testid: 'upload-photo' }, disabled: !canEdit, ...drag(item), onclick: () => onPick(item) },
              h('img', { src: linkOf('scrapcasion', u.thumb) || '', alt: u.file_name || 'Uploaded photo', loading: 'lazy', draggable: 'false' })),
              canEdit ? h('button', { type: 'button', class: 'sc-x', title: 'Delete photo', 'aria-label': 'Delete photo', onclick: () => delUpload(u) }, icon('x', 14)) : null);
          })));
    }
    node.replaceChildren(sub, body);
  }
  loadProfiles().then(() => search());
  render();
  return { node };
}
