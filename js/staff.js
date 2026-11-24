/* books.daycasion.com: the staff workspace for hardcover corrections (DayCasion staff only). Routes #/staff (the
 * outstanding personal requests), #/staff/<revised proof> (one book: the customer, their requests and corrections, the
 * draft, the comparison, publishing, the history), #/staff/<id>/read[/n] (the customer's proof, with Correct This Page)
 * and #/staff/<id>/draft[/n] (the private draft proof). Every call goes to the dc_keepsake_staff_* server functions,
 * which refuse anyone without the hardcover_corrections scope; files are read through the same private storage rules.
 * Corrections are made for this hardcover only (never the customer's memories); conflicts with earlier corrections are
 * shown and must be knowingly replaced; a draft is published only after review. */
(function () {
  'use strict';
  if (window.DC_FRAMED) return;
  const LABEL = { photo_uncrop: 'Show the whole photo', photo_rotate: 'Rotate the photo', photo_remove: 'Remove the photo',
    photo_replace: 'Use a different photo', photo_add: 'Add a photo', memory_update: 'Use the updated story', memory_remove: 'Remove the story',
    memory_add: 'Add a missing story', refresh_all: 'Use the latest memory changes', story_update: 'Update title page and chapter names',
    collages: 'Photo Collages', text_edit: 'Correct story text', layout: 'Page layout needs attention', other: 'Something else',
    photo_focus: 'Adjust the photo\'s crop', photo_size: 'Resize the photo', photo_primary: 'Make it the main photo', photo_caption: 'Photo caption',
    page_break: 'Start the story on a new page', keep_together: 'How the story breaks across pages', memory_move: 'Move the story',
    date_edit: 'Correct the date', intro_edit: 'Correct the introduction', section_title: 'Correct the chapter title',
    book_details: 'Correct the book\'s title', cover_focus: 'Adjust the cover photo\'s crop' };
  const REQ = { new: 'New', in_review: 'In review', awaiting_customer: 'Awaiting customer', resolved: 'Resolved' };
  const OUTCOME = { applied: 'Completed', not_applied: 'Not made', superseded: 'Replaced by a later correction', queued: 'Waiting' };
  const DRAFT = { editing: 'Corrections being added', queued: 'Waiting to be made', building: 'Being made', ready: 'Ready to review',
    failed: 'Couldn\'t be made', published: 'Published', superseded: 'Published (replaced later)', discarded: 'Discarded' };
  const CHANGE = { story_changed: 'Story changed', story_removed: 'Story removed', story_added: 'Story added', photos_removed: 'Photos removed',
    order_changed: 'Order of stories changed', chapter_title: 'Chapter title', chapter_added: 'Chapter added', chapter_removed: 'Chapter removed',
    introductions: 'Introductions', title_page: 'Title page', cover: 'Cover', photo_collages: 'Photo Collages' };
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
  let X = null; // the page's context (owner.js): rpc, authed, signUrls, show, page, el, icon, ...
  let state = null; // the book being worked on
  let viewSeq = 0; // the current view: a view still loading when another opens never draws over it
  const liveView = () => { const my = viewSeq; return () => my === viewSeq; };

  function route(ctx, { orderId, view, page }) {
    X = ctx;
    document.querySelectorAll('dialog[open]').forEach((d) => d.close()); // a new view never keeps an earlier dialog
    viewSeq++;
    if (!orderId) return listView();
    if (view === 'read' || view === 'draft') return readerView(orderId, page, view);
    return bookView(orderId);
  }

  // ------------------------------------------------------------ helpers
  const el = (...a) => X.el(...a);
  // (replaceChildren / append would show a skipped part as the text "null")
  const fill = (host, ...nodes) => host.replaceChildren(...nodes.flat().filter(Boolean));
  const add = (host, ...nodes) => host.append(...nodes.flat().filter(Boolean));
  const denied = (r) => r && (r.status === 403 || r.status === 401 || /DayCasion staff/.test((r.data && r.data.message) || ''));
  const frame = (...kids) => X.page(el('p', { class: 'backline' }, el('a', { class: 'backlink', href: '#/staff', text: 'Book Revision Requests' })), ...kids);
  function problem(title, text) {
    X.show(X.page(el('section', { class: 'card' }, el('h1', { text: title }), el('p', { class: 'muted', text }),
      el('div', { class: 'actions' }, el('a', { class: 'btn', href: '#/', text: 'My Keepsakes' })))));
  }
  const notStaff = () => problem('This area is for DayCasion staff', 'Sign in with a DayCasion staff account to correct customers\' hardcovers.');
  async function json(path) {
    const r = await X.authed(`/storage/v1/object/authenticated/keepsakes/${path.split('/').map(encodeURIComponent).join('/')}`);
    if (!r.ok || !r.data) throw Object.assign(new Error('file'), { r });
    return r.data;
  }
  async function signMedia(paths) {
    const out = {};
    for (let i = 0; i < paths.length; i += 100) {
      const r = await X.authed('/storage/v1/object/sign/memory-media', { method: 'POST', body: { expiresIn: 900, paths: paths.slice(i, i + 100) } }).catch(() => null);
      if (!r || !r.ok || !Array.isArray(r.data)) continue;
      for (const x of r.data) if (x.signedURL) out[x.path] = `${X.API}/storage/v1${x.signedURL.startsWith('/') ? '' : '/'}${x.signedURL}`;
    }
    return out;
  }
  function dialog(titleText, cls = 'wide') {
    const dlg = el('dialog', { class: `dlg ${cls} staff`, 'aria-labelledby': 'st-h' });
    const title = el('h2', { id: 'st-h', text: titleText });
    const body = el('div', { class: 'inner' });
    dlg.append(el('div', { class: 'dhead' }, title, el('button', { type: 'button', class: 'fb-icon', 'aria-label': 'Close', onclick: () => dlg.close() }, X.icon('close'))), body);
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg); dlg.showModal();
    return { dlg, title, body };
  }
  const choice = (label, sub, onclick, extra = {}) => el('button', { type: 'button', class: 'choice', onclick, ...extra },
    el('span', { class: 'ctop' }, el('span', { class: 'ctitle', text: label })), sub ? el('span', { class: 'csub', text: sub }) : null);
  const back = (to) => el('button', { type: 'button', class: 'textlink', text: '‹ Back', onclick: to });
  const field = (label, input, help) => el('label', { class: 'field' }, el('span', { class: 'flabel', text: label }), input, help ? el('span', { class: 'small muted', text: help }) : null);
  const tag = (text, cls) => el('span', { class: `stag ${cls || ''}`, text });
  const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

  // ------------------------------------------------------------ the list of requests
  async function listView() {
    document.title = 'Book Revision Requests · DayCasion staff';
    X.show(X.page(el('div', { class: 'center' }, el('div', { class: 'spinner', role: 'status', 'aria-label': 'Loading' }))));
    const live = liveView();
    const r = await X.rpc('dc_keepsake_staff_requests');
    if (!live()) return;
    if (denied(r)) return notStaff();
    if (!r.ok) return problem('We couldn\'t load the requests', X.plainErr(r, 'Please try again.'));
    const books = new Map();
    for (const q of r.data.requests || []) {
      const b = books.get(q.revision_order_id) || { id: q.revision_order_id, q, open: 0, all: 0, oldest: q.created_at };
      b.all++; if (q.open) b.open++; if (q.created_at < b.oldest) b.oldest = q.created_at;
      books.set(q.revision_order_id, b);
    }
    const drafts = r.data.drafts || {};
    const row = (b) => el('li', {}, el('a', { href: `#/staff/${b.id}`, class: 'reqbook' },
      el('span', { class: 'rtitle', text: `${b.q.profile_name || 'Book'} · ${b.q.book} hardcover` }),
      el('span', { class: 'small muted', text: `${b.q.customer_name || 'Customer'} · ${b.q.current_email || b.q.contact_email || ''}` }),
      el('span', { class: 'small', text: `${plural(b.open, 'open request')} of ${b.all} · since ${X.fmtDate(b.oldest)}${drafts[b.id] ? ` · draft: ${DRAFT[drafts[b.id].status] || drafts[b.id].status}` : ''}` })));
    const list = [...books.values()].sort((a, b) => (b.open - a.open) || String(a.oldest).localeCompare(String(b.oldest)));
    X.show(X.page(el('section', { class: 'card' }, el('h1', { text: 'Book Revision Requests' }),
      el('p', { class: 'muted', text: 'Hardcover proofs whose customers asked our team for help. Open a book to see its requests, correct it in a private draft and publish the corrected proof.' }),
      list.length ? el('ul', { class: 'reqbooks' }, list.map(row)) : el('p', { text: 'No requests.' }),
      (r.data.failed_revisions || []).length ? el('p', { class: 'err small', text: `${plural(r.data.failed_revisions.length, 'revised proof')} didn't finish (see the app's administrator list).` }) : null)));
  }

  // ------------------------------------------------------------ one book
  async function load(orderId) {
    const r = await X.rpc('dc_keepsake_staff_book', { p_order_id: orderId });
    if (denied(r)) return { denied: true };
    if (!r.ok) return { error: X.plainErr(r, 'Please try again.') };
    const B = r.data;
    const out = { B, orderId, spec: null, manifest: null, draftSpec: null, draftManifest: null };
    try {
      if (B.files && B.files.layout_spec) out.spec = await json(B.files.layout_spec);
      if (B.files && B.files.reader_manifest) out.manifest = await json(B.files.reader_manifest);
      const df = B.draft && B.draft.status === 'ready' ? Object.fromEntries((B.draft.files || []).map((f) => [f.kind, f.path])) : null;
      if (df) { out.draftFiles = df; out.draftSpec = await json(df.layout_spec); out.draftManifest = await json(df.reader_manifest); }
    } catch (e) { if (e.message === 'signed-out') throw e; out.fileError = true; }
    return out;
  }
  const items = (spec) => (spec ? spec.manifest.sections.flatMap((s) => s.items.map((it) => ({ ...it, section: s.id, sectionTitle: s.title }))) : []);
  const staged = () => (state.B.items || []).filter((i) => i.source === 'staff' && !i.published_at);
  const openRequests = () => (state.B.items || []).filter((i) => i.kind === 'assist' && i.status !== 'resolved');

  async function bookView(orderId, quiet) {
    if (!quiet) X.show(X.page(el('div', { class: 'center' }, el('div', { class: 'spinner', role: 'status', 'aria-label': 'Loading' }))));
    let s; const live = liveView();
    try { s = await load(orderId); } catch (e) { if (e.message === 'signed-out' || !live()) return; return problem('We couldn\'t open this book', 'Please try again.'); }
    if (!live()) return;
    if (s.denied) return notStaff();
    if (s.error) return problem('We couldn\'t open this book', s.error);
    state = s;
    const { B } = s, o = B.order, d = B.draft;
    document.title = `${B.profile_name} · ${B.book} · DayCasion staff`;
    const email = B.customer && B.customer.email;
    const head = el('section', { class: 'card' },
      el('h1', { text: `${B.profile_name} · ${B.book} hardcover` }),
      el('p', { class: 'muted', text: `${(B.customer && B.customer.name) || 'Customer'} · ${email || ''}` }),
      el('p', { text: `Proof version ${o.proof_version} · ${plural(o.page_count || 0, 'page')} · ${X.money(o.price_cents)} · ${o.status === 'proof_ready' ? 'Waiting for the customer\'s approval' : o.status.replace(/_/g, ' ')}` }),
      !o.editable ? el('p', { class: 'err small', text: 'This proof can no longer be corrected (the customer approved it, or it is being made again).' }) : null,
      el('div', { class: 'actions' }, el('a', { class: 'btn', href: `#/staff/${orderId}/read`, text: 'Open the customer\'s proof' }),
        email ? el('a', { class: 'btn secondary', href: `mailto:${email}?subject=${encodeURIComponent(`Your DayCasion ${B.book} hardcover proof`)}`, text: 'Email the customer' }) : null),
      s.fileError ? el('p', { class: 'err small', text: 'Some of the book\'s files couldn\'t be read.' }) : null);
    X.show(frame(head, requestsCard(), correctionsCard(), draftCard(), historyCard()));
    if (d && (d.status === 'queued' || d.status === 'building')) X.poll(() => bookView(orderId, true), 3000);
  }

  function requestsCard() {
    const { B, orderId } = state;
    const reqs = (B.items || []).filter((i) => i.kind === 'assist');
    const row = (q) => el('li', { class: 'req' },
      el('div', { class: 'rhead' }, tag(REQ[q.status] || q.status, q.status), el('strong', { text: `${q.label}${q.page ? ` · page ${q.page}` : ''}` }),
        q.escalated ? tag('An automatic correction that couldn\'t be made', 'note') : null),
      el('p', { class: 'quote', text: `"${q.note}"` }),
      q.staff_reply ? el('p', { class: 'small', text: `Reply shown to the customer: ${q.staff_reply}` }) : null,
      q.resolution ? el('p', { class: 'small muted', text: `Resolution: ${q.resolution}` }) : null,
      el('p', { class: 'small muted', text: `Sent ${when(q.created_at)}${q.contact_email ? ` · ${q.contact_email}` : ''}` }),
      el('div', { class: 'rowact' },
        q.page ? el('a', { class: 'textlink', href: `#/staff/${orderId}/read/${q.page}`, text: `View page ${q.page}` }) : null,
        el('button', { type: 'button', class: 'textlink', text: 'Update status or reply', onclick: () => updateRequest(q) })));
    return el('section', { class: 'card' }, el('h2', { text: 'Customer requests' }),
      reqs.length ? el('ul', { class: 'req-list' }, reqs.map(row)) : el('p', { class: 'muted', text: 'None.' }));
  }
  function updateRequest(q) {
    const { dlg, body } = dialog('Update the request', '');
    const status = el('select', { id: 'st-status' }, Object.entries(REQ).map(([k, v]) => el('option', { value: k, text: v, selected: k === q.status })));
    const reply = el('textarea', { id: 'st-reply', rows: 4, maxlength: 2000 }); reply.value = q.staff_reply || '';
    const res = el('textarea', { id: 'st-res', rows: 2, maxlength: 2000 }); res.value = q.resolution || '';
    const mail = el('input', { type: 'checkbox', id: 'st-mail' });
    const msg = el('p', { class: 'err small', role: 'alert' });
    add(body, el('p', { class: 'quote', text: `"${q.note}"` }), field('Status', status), field('Reply shown to the customer', reply),
      el('label', { class: 'check' }, mail, el('span', { text: ' Also email this reply to the customer (Reply-To info@daycasion.com)' })),
      field('How it was resolved (for our records)', res), msg,
      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn', text: 'Save', onclick: async (e) => {
        e.target.disabled = true; msg.textContent = '';
        const r = await X.rpc('dc_keepsake_staff_request_update', { p_item_id: q.id, p_status: status.value, p_reply: reply.value || null,
          p_resolution: res.value || null, p_email_customer: mail.checked });
        if (!r.ok) { e.target.disabled = false; msg.textContent = X.plainErr(r, 'Please try again.'); return; }
        dlg.close(); bookView(state.orderId, true); } })));
  }

  function correctionsCard() {
    const { B } = state;
    const list = (B.items || []).filter((i) => i.kind === 'auto' && (i.source === 'customer' || i.published_at));
    const row = (i) => el('li', {}, el('div', { class: 'what' },
      el('span', { class: 'where', text: [i.page ? `Page ${i.page}` : null, i.memory_title].filter(Boolean).join(' · ') || 'Book' }),
      el('span', { class: 'req', text: i.label }),
      el('span', { class: 'small muted', text: (i.result && i.result.message) || '' })),
      el('div', { class: 'tags' }, tag(i.source === 'staff' ? 'Our team' : 'Customer', i.source), tag(OUTCOME[i.status] || i.status, i.status)));
    return el('section', { class: 'card' }, el('h2', { text: 'Corrections in the customer\'s proof' }),
      el('p', { class: 'small muted', text: 'Every one of these is kept and checked again whenever the proof is made again. A new correction that would replace one of them asks you first.' }),
      list.length ? el('ul', { class: 'req-list' }, list.map(row)) : el('p', { class: 'muted', text: 'None.' }));
  }

  function draftCard() {
    const { B, orderId } = state, d = B.draft, o = B.order;
    const card = el('section', { class: 'card draft' }, el('h2', { text: 'Corrections by our team' }));
    if (!o.editable) { add(card, el('p', { class: 'muted', text: 'This proof can no longer be corrected.' })); return card; }
    if (!d) {
      add(card, el('p', { class: 'muted', text: 'Open the customer\'s proof and select Correct This Page on the page to correct. Corrections collect in a private draft that the customer can\'t see until you publish it.' }),
        el('div', { class: 'actions' }, el('a', { class: 'btn small', href: `#/staff/${orderId}/read`, text: 'Open the proof to correct it' }),
          el('button', { type: 'button', class: 'btn small secondary', text: 'Book details and cover', onclick: () => bookDialog() })));
      return card;
    }
    const st = staged();
    const req = (id) => (B.items || []).find((i) => i.id === id);
    const stale = d.base_proof_version !== o.proof_version;
    add(card, el('p', {}, tag(DRAFT[d.status] || d.status, `d-${d.status}`), ` Started ${when(d.created_at)} by ${d.created_by_email || 'staff'}`),
      stale ? el('p', { class: 'err small', text: 'The customer\'s proof changed since this draft was started (it was made again). Discard this draft and start again.' }) : null,
      d.status === 'failed' ? el('p', { class: 'err small', text: `The draft proof couldn't be made: ${d.error || 'please try again.'}` }) : null,
      st.length ? el('ul', { class: 'req-list' }, st.map((i) => el('li', {}, el('div', { class: 'what' },
        el('span', { class: 'where', text: [i.page ? `Page ${i.page}` : null, i.memory_title].filter(Boolean).join(' · ') || 'Book' }),
        el('span', { class: 'req', text: describe(i) }),
        el('span', { class: 'small muted', text: `For: "${((req(i.addresses) || {}).note || '').slice(0, 80)}" · ${i.created_by || ''}` }),
        i.value && i.value.supersedes ? el('span', { class: 'small', text: `Replaces ${plural(i.value.supersedes.length, 'earlier correction')}` }) : null),
        ['editing', 'ready', 'failed'].includes(d.status) ? el('div', { class: 'rowact' }, el('button', { type: 'button', class: 'textlink danger', text: 'Take back',
          'aria-label': `Take back: ${describe(i)}`, onclick: async () => { const r = await X.rpc('dc_keepsake_staff_remove', { p_item_id: i.id }); if (!r.ok) alert(X.plainErr(r, 'Please try again.')); bookView(orderId, true); } })) : null)))
        : el('p', { class: 'muted', text: 'No corrections yet. Open the customer\'s proof and select Correct This Page.' }));
    const acts = el('div', { class: 'actions' });
    if (['editing', 'ready', 'failed'].includes(d.status)) {
      add(acts, el('a', { class: 'btn small secondary', href: `#/staff/${orderId}/read`, text: 'Correct more pages' }),
        el('button', { type: 'button', class: 'btn small secondary', text: 'Book details and cover', onclick: () => bookDialog() }));
      if (st.length && !stale && d.status !== 'ready') add(acts, el('button', { type: 'button', class: 'btn small', text: 'Make the draft proof', onclick: async (e) => {
        e.target.disabled = true; const r = await X.rpc('dc_keepsake_staff_build', { p_draft_id: d.id });
        if (!r.ok) { e.target.disabled = false; alert(X.plainErr(r, 'Please try again.')); return; } bookView(orderId, true); } }));
      add(acts, el('button', { type: 'button', class: 'btn small secondary', text: 'Discard the draft', onclick: async () => {
        if (!confirm('Discard this draft? Its corrections are removed; the customer\'s proof stays as it is.')) return;
        const r = await X.rpc('dc_keepsake_staff_discard', { p_draft_id: d.id, p_note: 'Discarded in the staff workspace' });
        if (!r.ok) alert(X.plainErr(r, 'Please try again.')); bookView(orderId, true); } }));
    }
    if (d.status === 'queued' || d.status === 'building') add(card, el('p', { class: 'muted' }, el('span', { class: 'spinner small', role: 'status', 'aria-label': 'Making the draft proof' }), ' Making the draft proof (a few minutes). This page updates by itself.'));
    add(card, acts);
    if (d.status === 'ready') add(card, review());
    return card;
  }
  function describe(i) {
    const v = i.value || {};
    const extra = { photo_rotate: v.degrees ? ` (${v.degrees}°)` : '', photo_size: v.scale ? ` (${Math.round(v.scale * 100)}%)` : '',
      photo_caption: v.text ? `: "${v.text}"` : ' (removed)', date_edit: `: "${v.date || 'no date line'}"`,
      keep_together: v.mode ? ` (${{ together: 'keep on one page', split: 'may continue on the next page', auto: 'as laid out' }[v.mode]})` : '',
      page_break: v.before === false ? ' (flow on as laid out)' : '', section_title: v.title ? `: "${v.title}"` : '', book_details: v.title ? `: "${v.title}"` : '',
      text_edit: v.changed != null ? ` (${plural(v.changed, 'character')} changed)` : '', photo_replace: v.carry ? ' (keeping its turn, crop and caption)' : '' };
    return (LABEL[i.type] || i.type) + (extra[i.type] || '');
  }

  // the draft compared with the customer's proof, and publishing
  function review() {
    const { B, orderId } = state, d = B.draft, o = B.order, sum = d.summary || {}, diff = d.diff || {};
    const byId = new Map((d.results || []).map((r) => [r.id, r]));
    const earlier = (B.items || []).filter((i) => i.kind === 'auto' && (i.source === 'customer' || i.published_at));
    const failed = (sum.failed || []).length, regress = (sum.regressions || []).length, unexpected = Number(sum.unexpected || 0), deleted = Number(sum.deleted || 0);
    const ok = !failed && !regress && !unexpected;
    const box = el('div', { class: 'review' },
      el('h3', { text: 'The draft compared with the customer\'s proof' }),
      el('p', { text: `Pages: ${o.page_count} → ${d.page_count}${d.page_count !== o.page_count ? ' (changed)' : ''} · Price: ${X.money(o.price_cents)} → ${X.money(d.price_cents)}${d.price_cents !== o.price_cents ? ' (changed)' : ''}` }),
      el('ul', { class: 'checks' },
        el('li', { class: failed ? 'bad' : 'good', text: failed ? `${plural(failed, 'staff correction')} couldn't be made` : 'Every staff correction was made and checked on the pages' }),
        el('li', { class: regress ? 'bad' : 'good', text: regress ? `${plural(regress, 'earlier correction')} no longer holds` : `All ${plural(earlier.length, 'earlier correction')} still hold (or were knowingly replaced)` }),
        el('li', { class: unexpected ? 'bad' : 'good', text: unexpected ? `${plural(unexpected, 'change')} that wasn't asked for` : 'Nothing else changed' }),
        deleted ? el('li', { class: 'warn', text: `${plural(deleted, 'item')} the customer deleted in the app since (left out; confirm with the customer before publishing)` }) : null));
    const rows = [];
    for (const i of [...earlier, ...staged()]) {
      const r = byId.get(i.id); if (!r) continue;
      const isNew = i.source === 'staff' && !i.published_at;
      const good = r.status === 'applied' || r.status === 'superseded';
      rows.push(el('li', { class: good ? 'good' : 'bad' }, el('span', { text: `${isNew ? 'New' : i.source === 'staff' ? 'Our team' : 'Customer'}: ${describe(i)}${i.page ? ` (page ${i.page})` : ''}` }),
        el('span', { class: 'small muted', text: ` ${OUTCOME[r.status] || r.status}${r.pages && r.pages.length ? ` · pages ${r.pages.join(', ')}` : ''}${r.check ? ` · ${r.check}` : ''}` })));
    }
    add(box, el('h3', { text: 'Every correction in the draft' }), el('ul', { class: 'checks' }, rows));
    const changes = diff.changes || [];
    add(box, el('h3', { text: 'What changed' }), changes.length ? el('ul', { class: 'checks' }, changes.map((c) => el('li', { class: c.status === 'unexpected' ? 'bad' : c.status === 'deleted' ? 'warn' : 'good' },
      el('span', { text: `${CHANGE[c.kind] || c.kind}${c.title ? `: ${c.title}` : ''}${c.what ? ` (${c.what.join(', ')})` : ''}` }),
      el('span', { class: 'small muted', text: c.status === 'unexpected' ? ' · not asked for' : c.status === 'deleted' ? ' · deleted by the customer in the app' : ' · asked for' })))) : el('p', { class: 'muted', text: 'No differences.' }));
    add(box, el('div', { class: 'actions' }, el('a', { class: 'btn small secondary', href: `#/staff/${orderId}/draft`, text: 'Review the whole draft' }),
      el('button', { type: 'button', class: 'btn small secondary', text: 'Compare pages', onclick: () => comparePages() }),
      el('button', { type: 'button', class: 'btn', text: 'Publish to the customer', disabled: !ok, onclick: () => publish() })),
      !ok ? el('p', { class: 'small err', text: 'Publishing is held until every check passes: take back or fix the correction, then make the draft again.' }) : null);
    return box;
  }

  async function comparePages() {
    const { dlg, body } = dialog('Compare pages: the customer\'s proof and the draft', 'wide compare');
    const a = state.manifest, b = state.draftManifest;
    if (!a || !b) { add(body, el('p', { class: 'err', text: 'The pages couldn\'t be read.' })); return; }
    const key = (p) => (p ? JSON.stringify([norm(p.text), (p.shows && p.shows.photos || []).map((x) => [x.id, x.w, x.h, x.cropped])]) : '');
    const n = Math.max(a.pages.length, b.pages.length), changed = [];
    for (let i = 0; i < n; i++) if (key(a.pages[i]) !== key(b.pages[i])) changed.push(i + 1);
    const fa = state.B.files.reader_manifest.slice(0, -'proof/manifest.json'.length), fb = state.draftFiles.reader_manifest.slice(0, -'proof/manifest.json'.length);
    const show = changed.slice(0, 24);
    let urls = {};
    try { urls = await X.signUrls([...show.flatMap((k) => [a.pages[k - 1] && fa + a.pages[k - 1].file, b.pages[k - 1] && fb + b.pages[k - 1].file])].filter(Boolean), 900); } catch (e) { /* shown below */ }
    add(body, el('p', { class: 'muted', text: changed.length ? `${plural(changed.length, 'page')} differ${changed.length === 1 ? 's' : ''} (${changed.join(', ')}). Pages ${a.pages.length} → ${b.pages.length}.` : 'No page differs.' }),
      ...show.map((k) => el('div', { class: 'cmp' }, el('h3', { text: `Page ${k}` }),
        el('div', { class: 'cmp-pair' },
          el('figure', {}, el('figcaption', { text: 'Customer\'s proof' }), a.pages[k - 1] && urls[fa + a.pages[k - 1].file] ? el('img', { src: urls[fa + a.pages[k - 1].file], alt: `Page ${k} of the customer's proof` }) : el('p', { class: 'muted', text: 'No page' })),
          el('figure', {}, el('figcaption', { text: 'Draft' }), b.pages[k - 1] && urls[fb + b.pages[k - 1].file] ? el('img', { src: urls[fb + b.pages[k - 1].file], alt: `Page ${k} of the draft` }) : el('p', { class: 'muted', text: 'No page' }))))));
    if (changed.length > show.length) add(body, el('p', { class: 'muted', text: `Showing the first ${show.length}. Review the whole draft for the rest.` }));
    dlg.querySelectorAll('img').forEach((i) => { i.referrerPolicy = 'no-referrer'; });
  }

  function publish() {
    const { B } = state, d = B.draft, sum = d.summary || {};
    const { dlg, body } = dialog('Publish the corrected proof to the customer');
    const made = staged().filter((i) => (d.results || []).some((r) => r.id === i.id && r.status === 'applied'));
    const addressed = new Set(made.map((i) => i.addresses));
    const message = el('textarea', { id: 'st-msg', rows: 5, maxlength: 1500 });
    message.value = 'Thank you for telling us about your proof. We\'ve made the corrections you asked for in your updated proof.';
    const reqs = openRequests().map((q) => ({ q, box: el('input', { type: 'checkbox', checked: addressed.has(q.id) }) }));
    const resolution = el('textarea', { id: 'st-resolution', rows: 3, maxlength: 2000 });
    resolution.value = made.map((i) => `${describe(i)}${i.page ? ` (page ${i.page})` : ''}`).join('; ');
    const conf = Number(sum.deleted || 0) ? el('textarea', { id: 'st-deleted', rows: 2, maxlength: 1000 }) : null;
    const mail = el('input', { type: 'checkbox', checked: true, id: 'st-email' });
    const msg = el('p', { class: 'err small', role: 'alert' });
    add(body, 
      el('p', { text: `The customer's proof becomes this draft: proof version ${B.order.proof_version} → ${B.order.proof_version + 1}, ${d.page_count} pages, ${X.money(d.price_cents)}. They review it and approve it in the DayCasion app; an approval of the earlier version no longer counts.` }),
      field('Message to the customer (shown with their request and in the email; the list of corrections is added)', message),
      reqs.length ? el('fieldset', { class: 'reqpick' }, el('legend', { text: 'Requests this resolves' }), reqs.map(({ q, box }) => el('label', { class: 'check' }, box, el('span', { text: ` ${q.label}${q.page ? ` · page ${q.page}` : ''}: "${q.note.slice(0, 90)}"` })))) : null,
      field('How it was resolved (for our records)', resolution),
      conf ? field('The customer deleted content that was in their proof. How did they confirm the updated book? (who, when, how)', conf) : null,
      el('label', { class: 'check' }, mail, el('span', { text: ' Email the customer (Reply-To info@daycasion.com)' })), msg,
      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn', text: 'Publish', onclick: async (e) => {
        e.target.disabled = true; msg.textContent = '';
        const r = await X.rpc('dc_keepsake_staff_publish', { p_draft_id: d.id, p_message: message.value, p_resolve: reqs.filter((x) => x.box.checked).map((x) => x.q.id),
          p_resolution: resolution.value || null, p_deletions_confirmation: conf ? conf.value : null, p_email: mail.checked });
        if (!r.ok) { e.target.disabled = false; msg.textContent = X.plainErr(r, 'Please try again.'); return; }
        dlg.close(); bookView(state.orderId); } }),
        el('button', { type: 'button', class: 'btn secondary', text: 'Not yet', onclick: () => dlg.close() })));
  }

  function historyCard() {
    const ev = state.B.events || [];
    const ACT = { staff_draft_started: 'Draft started', staff_correction_added: 'Correction added', staff_correction_removed: 'Correction taken back',
      staff_draft_queued: 'Draft proof requested', staff_draft_ready: 'Draft proof ready', staff_draft_failed: 'Draft proof failed',
      staff_draft_discarded: 'Draft discarded', staff_draft_published: 'Published to the customer', personal_request_updated: 'Request updated',
      revision_requested: 'Revision requested', preview_requested: 'Proof requested', proof_ready: 'Proof ready', corrections_checked: 'Corrections checked',
      approved: 'Approved by the customer', revision_rebuild: 'Proof made again' };
    const line = (e) => {
      const x = e.details || {};
      const what = e.action === 'staff_correction_added' ? `${LABEL[x.type] || x.type}${x.page ? ` (page ${x.page})` : ''}`
        : e.action === 'staff_draft_published' ? `version ${x.proof_version} · ${x.pages} pages${x.emailed ? ' · customer emailed' : ''}`
        : e.action === 'personal_request_updated' ? `${REQ[x.to] || x.to || ''}${x.emailed ? ' · emailed' : ''}` : '';
      return el('li', {}, el('span', { class: 'small muted', text: when(e.at) }), ' ', el('strong', { text: ACT[e.action] || e.action }),
        what ? ` · ${what}` : '', el('span', { class: 'small muted', text: e.admin_email ? ` · ${e.admin_email}` : e.actor === 'customer' ? ' · customer' : '' }));
    };
    return el('section', { class: 'card' }, el('details', {}, el('summary', { text: `History (${ev.length})` }), el('ul', { class: 'history' }, ev.map(line))));
  }

  // ------------------------------------------------------------ the proof (the customer's, or the draft)
  async function readerView(orderId, startAt, which) {
    X.show(X.page(el('div', { class: 'center' }, el('div', { class: 'spinner', role: 'status', 'aria-label': 'Opening the proof' }))));
    let s; const live = liveView();
    try { s = await load(orderId); } catch (e) { if (e.message === 'signed-out' || !live()) return; return problem('We couldn\'t open this proof', 'Please try again.'); }
    if (!live()) return;
    if (s.denied) return notStaff();
    if (s.error || !s.manifest) return problem('We couldn\'t open this proof', s.error || 'Its pages couldn\'t be read.');
    state = s;
    const draft = which === 'draft';
    if (draft && !s.draftManifest) return problem('There is no draft proof to review', 'Make the draft proof first.');
    const manifest = draft ? s.draftManifest : s.manifest;
    const files = draft ? s.draftFiles : s.B.files;
    const folder = files.reader_manifest.slice(0, -'proof/manifest.json'.length);
    const interior = manifest.pages.map((p) => ({ n: p.n + 2, text: p.text || '', path: folder + p.file }));
    const all = [files.cover_preview ? { n: 1, text: 'Front cover', path: files.cover_preview } : { n: 1, text: 'Front cover', blank: true },
      { n: 2, text: 'Inside of the front cover', blank: true }, ...interior];
    let urls = {};
    const sign = async () => { const u = await X.signUrls(all.filter((p) => p.path).map((p) => p.path), 3600); const o = {}; for (const p of all) if (p.path && u[p.path]) o[p.n] = u[p.path]; urls = o; return o; };
    try { await sign(); } catch (e) { if (e.message === 'signed-out' || !live()) return; return problem('We couldn\'t load the pages', 'Please try again.'); }
    if (!live()) return;
    const total = manifest.pages.length;
    const name = (n) => (n === 1 ? 'Front cover' : n === 2 ? 'Inside cover' : `Page ${n - 2}`);
    const label = (ns) => { const pg = ns.filter((n) => n >= 3).map((n) => n - 2);
      if (!pg.length) return ns.map(name).join(' · ');
      const t = pg.length === 2 ? `Pages ${pg[0]}–${pg[1]} of ${total}` : `Page ${pg[0]} of ${total}`; return ns.includes(2) ? `Inside cover · ${t}` : t; };
    const d = s.B.draft;
    const canCorrect = !draft && s.B.order.editable && (!d || ['editing', 'ready', 'failed'].includes(d.status)) && !(d && d.base_proof_version !== s.B.order.proof_version);
    const reader = X.openReader({
      title: `${draft ? 'Draft (not visible to the customer)' : 'Customer\'s proof'} · ${s.B.profile_name} · ${s.B.book}`,
      subtitle: `Staff workspace · ${draft ? `${d.page_count} pages · ${X.money(d.price_cents)}` : `proof version ${s.B.order.proof_version} · ${total} pages`}`,
      aspect: manifest.page_aspect || 0.8, chapters: (manifest.chapters || []).map((ch) => ({ ...ch, page: ch.page + 2 })), linkSeconds: 3600,
      pages: all.map((p) => ({ n: p.n, text: p.text, blank: !p.path, url: urls[p.n] })), startPage: startAt > 0 && startAt <= total ? startAt + 2 : 1, resumed: false,
      change: canCorrect ? { label: 'Correct This Page', short: 'Correct', count: staged().length, onClick: (onScreen) => pageDialog(onScreen, (n) => urls[n], (c) => reader.setChangeCount(c)) } : null,
      renew: sign, label, tocNum: (n) => (n <= 2 ? '' : String(n - 2)),
      back: { label: 'Back to the workspace', onClick: () => { location.hash = `#/staff/${orderId}`; } },
    });
  }

  // ------------------------------------------------------------ correcting a page
  // the story as the customer's proof prints it, with this draft's own corrections so far
  function current(memoryId) {
    const it = items(state.spec).find((i) => i.id === memoryId);
    if (!it) return null;
    const out = { ...it, photos: it.photos.map((p) => ({ ...p })) };
    for (const i of staged().filter((x) => x.memory_id === memoryId)) {
      if (i.type === 'text_edit') Object.assign(out, { title: i.value.title, body: i.value.body });
      if (i.type === 'date_edit') out.date = i.value.date;
    }
    return out;
  }
  const photoOf = (mediaId) => { for (const it of items(state.spec)) { const p = it.photos.find((x) => x.id === mediaId); if (p) return { it, p }; } return null; };

  function pageDialog(onScreen, pageUrl, setCount) {
    const m = state.manifest;
    const nums = onScreen.filter((n) => n >= 3).map((n) => n - 2);
    const { dlg, title, body } = dialog(onScreen.includes(1) && !nums.length ? 'Correct the cover' : `Correct page ${nums[0]}`);
    const reqs = openRequests();
    if (!reqs.length) { add(body, el('p', { class: 'muted', text: 'Every request of this book is resolved. Corrections are tied to a customer request: reopen the request first (Update status or reply).' })); return; }
    let pageN = nums.find((n) => reqs.some((q) => q.page === n)) || nums[0];
    const added = () => { setCount(staged().length); };
    const done = async (txt) => { const r = await reloadState(); if (!r) return; added(); fill(body, el('p', { class: 'ok', text: txt }),
      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn', text: 'Correct something else here', onclick: () => home() }),
        el('button', { type: 'button', class: 'btn secondary', text: 'Back to the book', onclick: () => dlg.close() }))); };
    // the request a correction is for (each correction is tied to one)
    const reqSel = () => { const s = el('select', { id: 'st-req' }, reqs.map((q) => el('option', { value: q.id, text: `${q.label}${q.page ? ` · page ${q.page}` : ''}: "${q.note.slice(0, 70)}"`, selected: q.page === pageN })));
      return field('For the customer\'s request', s); };
    // add a correction: check conflicts with earlier ones first; replace them only when staff say so
    async function submit(host, item, original, reqField) {
      const msg = el('p', { class: 'err small', role: 'alert' }); host.append(msg);
      const req = reqField.querySelector('select').value;
      const d = await ensureDraft(); if (!d) { msg.textContent = 'The draft couldn\'t be started.'; return; }
      const c = await X.rpc('dc_keepsake_staff_conflicts', { p_draft_id: d, p_item: item });
      if (!c.ok) { msg.textContent = X.plainErr(c, 'Please try again.'); return; }
      const conflicts = c.data.conflicts || [];
      const go = async (supersede) => {
        const r = await X.rpc('dc_keepsake_staff_add', { p_draft_id: d, p_request_id: req, p_item: { ...item, original }, p_supersede: supersede });
        if (!r.ok) { msg.textContent = X.plainErr(r, 'Please try again.'); return; }
        done(`Added to the draft: ${LABEL[item.type]}. The customer sees nothing until you publish.`);
      };
      if (!conflicts.length) return go([]);
      fill(body, el('p', { class: 'warnbox', text: `This correction affects ${plural(conflicts.length, 'earlier correction')}:` }),
        el('ul', { class: 'checks' }, conflicts.map((x) => el('li', { class: 'warn' }, el('strong', { text: `${x.staged ? 'Waiting in this draft' : x.source === 'staff' ? 'Our team' : 'Customer'}: ${LABEL[x.type] || x.type}${x.page ? ` (page ${x.page})` : ''}` }),
          el('span', { class: 'small', text: ` ${x.reason}` })))),
        el('p', { class: 'small muted', text: 'The customer\'s own corrections are never replaced silently: if you continue, they are shown to the customer as replaced by a further correction from our team.' }),
        el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn', text: 'Replace them with my correction', onclick: () => go(conflicts.map((x) => x.id)) }),
          el('button', { type: 'button', class: 'btn secondary', text: 'Cancel', onclick: () => home() })), msg);
    }
    function form(heading, kids, make, original) {
      const rf = reqSel(), host = el('div', { class: 'stform' });
      fill(body, back(() => home()), el('h3', { text: heading }), ...kids, rf, host,
        el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn', text: 'Add to the draft', onclick: (e) => {
          const item = make(); if (!item) return; e.target.disabled = true; submit(host, item, original, rf).finally(() => { e.target.disabled = false; }); } })));
    }
    // ---- the page
    function home() {
      title.textContent = onScreen.includes(1) && !nums.length ? 'Correct the cover' : `Correct page ${pageN}`;
      if (onScreen.includes(1) && !nums.length) {
        const cover = state.spec.manifest.coverPhoto;
        fill(body, cover ? choice('Adjust the cover photo\'s crop', 'Choose the part of the photo the cover shows', () => coverCrop(cover))
          : el('p', { class: 'muted', text: 'This cover has no photo.' }), choice('Correct the book\'s title', 'Title page and cover', () => bookTitle()));
        return;
      }
      const pg = m.pages.find((p) => p.n === pageN) || {};
      const shows = pg.shows || { memories: [], photos: [] };
      const mems = shows.memories.length ? shows.memories : items(state.spec).filter((i) => i.title && norm(pg.text).includes(norm(i.title))).map((i) => i.id);
      const chapter = (m.chapters || []).find((ch) => ch.page === pageN);
      const sec = chapter && state.spec.manifest.sections.find((s) => s.title === chapter.title);
      fill(body, 
        nums.length > 1 ? el('div', { class: 'seg', role: 'group', 'aria-label': 'Page' }, nums.map((n) => el('button', { type: 'button', text: `Page ${n}`, 'aria-pressed': String(n === pageN), onclick: () => { pageN = n; home(); } }))) : null,
        shows.photos.length ? el('h3', { text: 'Photos on this page' }) : null,
        ...shows.photos.map((ph) => { const x = photoOf(ph.id); return choice(`Photo of "${x ? x.it.title : 'a story'}"`, ph.cropped ? 'Cropped on this page' : 'Shown whole', () => photoMenu(ph)); }),
        mems.length ? el('h3', { text: 'Stories on this page' }) : null,
        ...mems.map((id) => { const it = current(id); return it ? choice(it.title || 'Untitled story', it.date || '', () => storyMenu(id)) : null; }),
        el('h3', { text: 'This page and the book' }),
        sec ? choice(`Chapter: ${sec.title}`, 'Its title or introduction', () => chapterMenu(sec)) : null,
        pageN === 1 ? choice('Correct the book\'s title', 'Title page and cover', () => bookTitle()) : null,
        choice('Add a missing story', 'A story of this book that isn\'t in it', () => addStory()));
    }
    function storyMenu(id) {
      const it = current(id);
      fill(body, back(() => home()), el('h3', { text: it.title || 'Untitled story' }),
        choice('Correct the title and text', 'For this book only (the memory in the app never changes); no length limit', () => textForm(it)),
        choice('Correct the date line', it.date || 'No date line', () => dateForm(it)),
        choice('Start on a new page', it.break_before ? 'Starts on a new page now' : 'Flows on after the previous story', () => breakForm(it)),
        choice('How it breaks across pages', 'Keep it on one page, or let it continue', () => keepForm(it)),
        choice('Move the story', `In "${it.sectionTitle}"`, () => moveForm(it)),
        choice('Add a photo', 'Another photo of this story', () => photoPick(it, null)),
        it.photos[0] ? choice('Caption for the main photo', it.photos[0].caption || 'No caption', () => captionForm(it, it.photos[0])) : null,
        choice('Remove the story', 'Leave it out of this book', () => form('Remove the story', [el('p', { text: `"${it.title}" is left out of this hardcover (the memory stays in the app).` })],
          () => ({ type: 'memory_remove', page: pageN, memory_id: id }), { title: it.title })));
    }
    function textForm(it) {
      const t = el('input', { type: 'text', id: 'st-title', maxlength: 300 }); t.value = it.title || '';
      const b = el('textarea', { id: 'st-body', rows: 14, maxlength: 20000 }); b.value = it.body || '';
      const count = el('p', { class: 'small muted' });
      const upd = () => { const n = window.DcCorrections.changedChars(it.title, t.value) + window.DcCorrections.changedChars(it.body, b.value); count.textContent = `${plural(n, 'character')} changed`; };
      t.oninput = upd; b.oninput = upd; upd();
      form('Correct the title and text', [field('Title', t), field('Story', b), count,
        el('details', { class: 'original' }, el('summary', { text: 'Show the text as printed' }), el('p', { class: 'small', text: it.title }), el('p', { class: 'small pre', text: it.body }))],
        () => ({ type: 'text_edit', page: pageN, memory_id: it.id, value: { title: t.value, body: b.value, original_title: it.title || '', original_body: it.body || '' } }),
        { title: it.title, body: it.body });
    }
    function dateForm(it) {
      const i = el('input', { type: 'text', id: 'st-date', maxlength: 80 }); i.value = it.date || '';
      form('Correct the date line', [field('Date line (leave empty for none)', i, 'Printed exactly as written, for this book only.')],
        () => ({ type: 'date_edit', page: pageN, memory_id: it.id, value: { date: i.value } }), { date: it.date || '' });
    }
    const radios = (name, opts, cur) => el('div', { class: 'radios' }, opts.map(([v, t]) => el('label', { class: 'check' }, el('input', { type: 'radio', name, value: v, checked: v === cur }), el('span', { text: ` ${t}` }))));
    const radioVal = (name) => (body.querySelector(`input[name="${name}"]:checked`) || {}).value;
    function breakForm(it) {
      form('Start on a new page', [radios('st-brk', [['yes', 'Start this story on a new page'], ['no', 'Flow on after the previous story (as laid out)']], it.break_before ? 'yes' : 'no')],
        () => ({ type: 'page_break', page: pageN, memory_id: it.id, value: { before: radioVal('st-brk') === 'yes' } }), { before: !!it.break_before });
    }
    function keepForm(it) {
      form('How the story breaks across pages', [radios('st-keep', [['together', 'Keep it on one page'], ['split', 'Let it continue on the next page'], ['auto', 'As laid out']],
        it.keep === true ? 'together' : it.keep === false ? 'split' : 'auto')],
        () => ({ type: 'keep_together', page: pageN, memory_id: it.id, value: { mode: radioVal('st-keep') } }), { keep: it.keep ?? 'auto' });
    }
    function moveForm(it) {
      const secs = state.spec.manifest.sections;
      const sec = el('select', { id: 'st-sec' }, secs.map((s) => el('option', { value: s.id, text: s.title, selected: s.id === it.section })));
      const after = el('select', { id: 'st-after' });
      const chapterPlaces = () => { const s = secs.find((x) => x.id === sec.value); fill(after, el('option', { value: '', text: 'First in the chapter' }),
        ...s.items.filter((x) => x.id !== it.id).map((x) => el('option', { value: x.id, text: `After "${x.title}"` }))); };
      sec.onchange = chapterPlaces; chapterPlaces();
      form('Move the story', [field('Chapter', sec), field('Place', after)],
        () => ({ type: 'memory_move', page: pageN, memory_id: it.id, value: { section: sec.value, after: after.value || null } }), { section: it.section });
    }
    function captionForm(it, p) {
      const i = el('input', { type: 'text', id: 'st-caption', maxlength: 200 }); i.value = p.caption || '';
      form('Photo caption', [field('Caption (leave empty for none)', i, 'Printed under the photo, for this book only.')],
        () => ({ type: 'photo_caption', page: pageN, media_id: p.id, value: { text: i.value } }), { caption: p.caption || '' });
    }
    function photoMenu(ph) {
      const x = photoOf(ph.id); const p = x ? x.p : { id: ph.id };
      const first = x && x.it.photos[0] && x.it.photos[0].id === ph.id;
      fill(body, back(() => home()), el('h3', { text: `Photo of "${x ? x.it.title : ''}"` }),
        choice('Rotate the photo', p.rot ? `Turned ${p.rot}° now` : '', () => form('Rotate the photo', [radios('st-rot', [['90', 'A quarter turn clockwise'], ['270', 'A quarter turn counterclockwise'], ['180', 'Upside down']], '90')],
          () => ({ type: 'photo_rotate', page: pageN, media_id: ph.id, value: { degrees: Number(radioVal('st-rot')) } }), { rot: p.rot || 0 })),
        ph.cropped ? choice('Show the whole photo', 'Never cropped', () => form('Show the whole photo', [], () => ({ type: 'photo_uncrop', page: pageN, media_id: ph.id }), { whole: false })) : null,
        ph.cropped ? choice('Adjust the crop', 'Choose the part of the photo that shows', () => focusForm(ph, p)) : null,
        choice('Resize the photo', p.size ? `${Math.round(p.size * 100)}% now` : 'Its usual size', () => form('Resize the photo', [radios('st-size', [['0.8', 'Smaller (80%)'], ['1', 'Usual size'], ['1.25', 'Larger (125%)'], ['1.5', 'Much larger (150%)']], String(p.size || 1))],
          () => ({ type: 'photo_size', page: pageN, media_id: ph.id, value: { scale: Number(radioVal('st-size')) } }), { size: p.size || 1 })),
        x && !first ? choice('Make it the main photo', 'Shown first and largest', () => form('Make it the main photo', [], () => ({ type: 'photo_primary', page: pageN, media_id: ph.id }), {})) : null,
        choice('Use a different photo', 'Another photo of the same story', () => photoPick(x && x.it, p)),
        choice('Caption', p.caption || 'No caption', () => captionForm(x && x.it, p)),
        choice('Remove the photo', 'Leave it out of this book', () => form('Remove the photo', [], () => ({ type: 'photo_remove', page: pageN, media_id: ph.id }), {})));
    }
    async function focusForm(ph, p) {
      const urls = await mediaUrls([ph.id]);
      const dot = el('span', { class: 'fdot' });
      let fx = (p.focus && p.focus.x) ?? 0.5, fy = (p.focus && p.focus.y) ?? 0.5;
      const img = el('img', { alt: 'The photo: select the part to show', class: 'fimg' }); img.referrerPolicy = 'no-referrer';
      if (urls[ph.id]) img.src = urls[ph.id];
      const pick = el('div', { class: 'focus-pick', onclick: (e) => { const r = img.getBoundingClientRect(); fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); fy = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)); place(); } }, img, dot);
      const place = () => { dot.style.left = `${fx * 100}%`; dot.style.top = `${fy * 100}%`; };
      place();
      form('Adjust the crop', [el('p', { class: 'small muted', text: 'Select the part of the photo that should stay in view where the page crops it.' }), pick],
        () => ({ type: 'photo_focus', page: pageN, media_id: ph.id, value: { x: Math.round(fx * 100) / 100, y: Math.round(fy * 100) / 100 } }), { focus: p.focus || null });
    }
    async function photoPick(it, replacing) {
      const mem = it && (state.B.memories || []).find((x) => x.id === it.id);
      const inBook = new Set(items(state.spec).flatMap((i) => i.photos.map((p) => p.id)));
      const free = mem ? mem.photos.filter((p) => !inBook.has(p.id)) : [];
      if (!free.length) { fill(body, back(() => home()), el('p', { class: 'muted', text: 'This story has no other photo to use.' })); return; }
      const urls = await signMedia(free.map((p) => p.thumb_path));
      let chosen = null;
      const tiles = free.map((p) => el('button', { type: 'button', class: 'photo-tile', 'aria-label': 'Choose this photo', onclick: (e) => {
        chosen = p.id; for (const b of body.querySelectorAll('.photo-tile')) b.classList.toggle('current', b === e.currentTarget); } },
        el('span', { class: 'ph' }, Object.assign(el('img', { alt: '' }), { src: urls[p.thumb_path] || '', referrerPolicy: 'no-referrer' }))));
      const own = replacing && (replacing.rot || replacing.focus || replacing.caption);
      const kids = [el('div', { class: 'photo-grid' }, tiles)];
      if (own) kids.push(el('p', { class: 'small', text: `The current photo has ${[replacing.rot && `a ${replacing.rot}° turn`, replacing.focus && 'a crop position', replacing.caption && 'a caption'].filter(Boolean).join(', ')}.` }),
        radios('st-carry', [['no', 'Start fresh with the new photo'], ['yes', 'Give the new photo the same turn, crop position and caption']], 'no'));
      form(replacing ? 'Use a different photo' : 'Add a photo', kids, () => {
        if (!chosen) { alert('Choose a photo.'); return null; }
        return replacing ? { type: 'photo_replace', page: pageN, media_id: replacing.id, value: { with: chosen, carry: radioVal('st-carry') === 'yes' } }
          : { type: 'photo_add', page: pageN, memory_id: it.id, value: { with: chosen } };
      }, replacing ? { photo: replacing.id, settings: { rot: replacing.rot, focus: replacing.focus, caption: replacing.caption } } : {});
    }
    function addStory() {
      const inBook = new Set(items(state.spec).map((i) => i.id));
      const free = (state.B.memories || []).filter((x) => !inBook.has(x.id));
      if (!free.length) { fill(body, back(() => home()), el('p', { class: 'muted', text: 'Every story of this book is already in it.' })); return; }
      const sel = el('select', { id: 'st-add' }, free.map((x) => el('option', { value: x.id, text: `${x.title || 'Untitled'}${x.chapter ? ` (${x.chapter})` : ''}` })));
      form('Add a missing story', [field('Story', sel)], () => ({ type: 'memory_add', page: pageN, memory_id: sel.value }), {});
    }
    function chapterMenu(sec) {
      const intro = state.spec.intros && state.spec.intros.sections && state.spec.intros.sections[sec.id];
      fill(body, back(() => home()), el('h3', { text: sec.title }),
        choice('Correct the chapter title', sec.title, () => { const i = el('input', { type: 'text', id: 'st-sectitle', maxlength: 120 }); i.value = sec.title;
          form('Correct the chapter title', [field('Title', i)], () => ({ type: 'section_title', page: pageN, value: { section: sec.id, title: i.value } }), { title: sec.title }); }),
        intro ? choice('Correct the introduction', intro.slice(0, 90), () => introForm(sec.id, intro)) : null,
        state.spec.intros && state.spec.intros.foreword ? choice('Correct the foreword', state.spec.intros.foreword.slice(0, 90), () => introForm('foreword', state.spec.intros.foreword)) : null);
    }
    function introForm(target, text) {
      const t = el('textarea', { id: 'st-intro', rows: 8, maxlength: 4000 }); t.value = text;
      form(target === 'foreword' ? 'Correct the foreword' : 'Correct the introduction', [field('Text (leave empty to leave it out)', t)],
        () => ({ type: 'intro_edit', page: pageN, value: { target, text: t.value } }), { text });
    }
    function bookTitle() {
      const t = el('input', { type: 'text', id: 'st-btitle', maxlength: 120 }); t.value = (state.manifest && state.manifest.title) || '';
      const s2 = el('input', { type: 'text', id: 'st-bsub', maxlength: 160 }); s2.value = (state.manifest && state.manifest.subtitle) || '';
      form('Correct the book\'s title', [field('Title', t), field('Subtitle (leave empty for none)', s2)],
        () => ({ type: 'book_details', page: pageN || null, value: { title: t.value, subtitle: s2.value } }), { title: state.manifest && state.manifest.title, subtitle: state.manifest && state.manifest.subtitle });
    }
    async function coverCrop(cover) {
      const urls = await mediaUrls([cover.id]);
      const dot = el('span', { class: 'fdot' });
      let fx = (cover.focus && cover.focus.x) ?? 0.5, fy = (cover.focus && cover.focus.y) ?? 0.5;
      const img = el('img', { alt: 'The cover photo: select the part to show', class: 'fimg' }); img.referrerPolicy = 'no-referrer';
      if (urls[cover.id]) img.src = urls[cover.id];
      const place = () => { dot.style.left = `${fx * 100}%`; dot.style.top = `${fy * 100}%`; };
      const pick = el('div', { class: 'focus-pick', onclick: (e) => { const r = img.getBoundingClientRect(); fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); fy = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)); place(); } }, img, dot);
      place();
      form('Adjust the cover photo\'s crop', [el('p', { class: 'small muted', text: 'Select the part of the photo the cover keeps in view.' }), pick],
        () => ({ type: 'cover_focus', media_id: cover.id, value: { x: Math.round(fx * 100) / 100, y: Math.round(fy * 100) / 100 } }), { focus: cover.focus || null });
    }
    home();
  }
  // book-level corrections from the workspace (not tied to a page on screen)
  function bookDialog() { pageDialog([1], () => null, () => {}); }

  async function mediaUrls(ids) {
    const byId = new Map();
    for (const m of state.B.memories || []) for (const p of m.photos) byId.set(p.id, p.thumb_path);
    const paths = ids.map((id) => byId.get(id)).filter(Boolean);
    const u = await signMedia(paths);
    return Object.fromEntries(ids.map((id) => [id, u[byId.get(id)]]));
  }
  async function ensureDraft() {
    if (state.B.draft && ['editing', 'ready', 'failed'].includes(state.B.draft.status)) return state.B.draft.id;
    const r = await X.rpc('dc_keepsake_staff_draft', { p_order_id: state.orderId });
    if (!r.ok) return null;
    await reloadState();
    return r.data.id;
  }
  async function reloadState() {
    const s = await load(state.orderId).catch(() => null);
    if (!s || s.denied || s.error) return null;
    state = s; return s;
  }

  window.DcStaff = { route };
})();
