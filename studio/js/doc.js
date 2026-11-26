// ScrapCasion Studio: the open scrapbook - its pages (editable design data), undo/redo, autosave and recovery.
//  - Every change is recorded as a step (the touched pages before/after, the page order, name and settings), so undo
//    and redo restore exactly; quick repeated edits of the same thing (typing, a slider) become one step.
//  - Autosave sends only the pages that changed, with the page order, against the revision this editor started
//    from; another window's save (HTTP 409) stops autosave and asks to reload (nothing is overwritten).
//  - Until a save succeeds the unsaved changes are also kept in this browser (localStorage), so closing the tab, a
//    crash or a lost connection doesn't lose them: the next opening offers them back.
import { rpc } from './api.js?v=b8eddd3961';

const JOURNAL = (id) => `scrapcasion-unsaved-${id}`;
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const DELAYS = [2000, 5000, 10000, 30000];

export class Doc {
  constructor(project, { onChange = () => {}, onStatus = () => {}, onConflict = () => {} } = {}) {
    this.id = project.id; this.revision = project.revision; this.title = project.title; this.settings = clone(project.settings || {});
    this.pages = project.pages.map((p) => ({ id: p.id, kind: p.kind, data: clone(p.data) }));
    this.onChange = onChange; this.onStatus = onStatus; this.onConflict = onConflict;
    this.undoStack = []; this.redoStack = []; this.last = null;
    this.markSaved(this.pages, this.order(), this.title, this.settings);
    this.timer = null; this.saving = null; this.fails = 0; this.stopped = false; this.status = 'saved';
  }
  order() { return this.pages.map((p) => p.id); }
  page(id) { return this.pages.find((p) => p.id === id); }
  markSaved(pages, order, title, settings) {
    this.saved = new Map(pages.map((p) => [p.id, JSON.stringify(p.data)]));
    this.savedOrder = order.join(','); this.savedTitle = title; this.savedSettings = JSON.stringify(settings);
  }
  dirtyPages() { return this.pages.filter((p) => this.saved.get(p.id) !== JSON.stringify(p.data)); }
  isDirty() {
    return this.dirtyPages().length > 0 || this.order().join(',') !== this.savedOrder || this.title !== this.savedTitle || JSON.stringify(this.settings) !== this.savedSettings;
  }

  // ---- changes and history
  snap(ids) { const m = {}; for (const id of ids) { const p = this.page(id); m[id] = p ? { kind: p.kind, data: clone(p.data) } : null; }
    return { pages: m, order: this.order(), title: this.title, settings: clone(this.settings) }; }
  /** Applies `fn` (which edits this.pages / title / settings) as one undoable step touching `ids` (page ids). */
  change(ids, fn, { key = null } = {}) {
    const before = this.snap(ids);
    fn();
    const after = this.snap([...new Set([...ids, ...this.order().filter((id) => !before.order.includes(id))])]);
    for (const id of Object.keys(after.pages)) if (!(id in before.pages)) before.pages[id] = null;
    const now = Date.now();
    if (key && this.last && this.last.key === key && now - this.last.at < 1200 && this.undoStack.length) {
      const top = this.undoStack[this.undoStack.length - 1]; top.after = after; this.last.at = now; // same edit continued
    } else { this.undoStack.push({ before, after }); if (this.undoStack.length > 200) this.undoStack.shift(); this.last = { key, at: now }; }
    this.redoStack = [];
    this.changed();
  }
  restore(s) {
    const map = new Map(this.pages.map((p) => [p.id, p]));
    for (const [id, v] of Object.entries(s.pages)) { if (v) map.set(id, { id, kind: v.kind, data: clone(v.data) }); else map.delete(id); }
    this.pages = s.order.filter((id) => map.has(id)).map((id) => map.get(id));
    this.title = s.title; this.settings = clone(s.settings);
  }
  undo() { const s = this.undoStack.pop(); if (!s) return false; this.restore(s.before); this.redoStack.push(s); this.last = null; this.changed(); return true; }
  redo() { const s = this.redoStack.pop(); if (!s) return false; this.restore(s.after); this.undoStack.push(s); this.last = null; this.changed(); return true; }
  changed() { this.writeJournal(); this.onChange(); this.schedule(); }

  // ---- autosave
  setStatus(s) { if (this.status !== s) { this.status = s; this.onStatus(s); } }
  schedule(ms = 1200) {
    if (this.stopped) return;
    this.setStatus(this.isDirty() ? 'unsaved' : 'saved');
    clearTimeout(this.timer); this.timer = setTimeout(() => this.save(), ms);
  }
  async save() {
    if (this.stopped) return false;
    if (this.saving) { await this.saving; return this.isDirty() ? this.save() : true; }
    if (!this.isDirty()) { this.setStatus('saved'); this.clearJournal(); return true; }
    const pages = this.dirtyPages().map((p) => ({ id: p.id, kind: p.kind, data: clone(p.data) }));
    const order = this.order(), title = this.title, settings = clone(this.settings);
    this.setStatus('saving');
    this.saving = (async () => {
      try {
        const r = await rpc('dc_scrap_project_save', { p_project_id: this.id, p_base_revision: this.revision, p_order: order, p_pages: pages,
          p_title: title !== this.savedTitle ? title : null, p_settings: JSON.stringify(settings) !== this.savedSettings ? settings : null });
        this.revision = r.revision; this.fails = 0;
        // what was sent is now saved (later edits stay dirty)
        for (const p of pages) this.saved.set(p.id, JSON.stringify(p.data));
        for (const id of [...this.saved.keys()]) if (!order.includes(id)) this.saved.delete(id);
        this.savedOrder = order.join(','); this.savedTitle = title; this.savedSettings = JSON.stringify(settings);
        if (r.proofs_expired) this.onChange({ proofsExpired: r.proofs_expired });
        if (this.isDirty()) this.schedule(400); else { this.setStatus('saved'); this.clearJournal(); }
        return true;
      } catch (e) {
        if (e.status === 409) { this.stopped = true; this.setStatus('conflict'); this.onConflict(); return false; }
        if (e.status && e.status < 500 && !e.offline) { this.setStatus('error'); this.error = e.message; this.onStatus('error', e.message); return false; }
        this.setStatus('offline');
        clearTimeout(this.timer); this.timer = setTimeout(() => this.save(), DELAYS[Math.min(this.fails++, DELAYS.length - 1)]);
        return false;
      } finally { this.saving = null; }
    })();
    return this.saving;
  }
  /** Saves now (before a preview, or leaving). Resolves true when everything is saved. */
  async flush() { clearTimeout(this.timer); const ok = await this.save(); return ok && !this.isDirty(); }

  // ---- recovery
  writeJournal() {
    clearTimeout(this.jt);
    this.jt = setTimeout(() => {
      if (!this.isDirty()) { this.clearJournal(); return; }
      const j = { v: 1, revision: this.revision, at: new Date().toISOString(), order: this.order(), title: this.title, settings: this.settings,
        pages: Object.fromEntries(this.dirtyPages().map((p) => [p.id, { kind: p.kind, data: p.data }])) };
      try { localStorage.setItem(JOURNAL(this.id), JSON.stringify(j)); } catch (e) { /* full or off: the server copy is still there */ }
    }, 250);
  }
  clearJournal() { clearTimeout(this.jt); try { localStorage.removeItem(JOURNAL(this.id)); } catch (e) { /* off */ } }
  static journal(id) { try { return JSON.parse(localStorage.getItem(JOURNAL(id)) || 'null'); } catch (e) { return null; } }
  static dropJournal(id) { try { localStorage.removeItem(JOURNAL(id)); } catch (e) { /* off */ } }
  /** Puts unsaved changes kept in this browser back on top of the saved scrapbook (one undoable step), then saves. */
  recover(j) {
    const ids = [...new Set([...Object.keys(j.pages), ...this.order(), ...j.order])];
    this.change(ids, () => {
      const map = new Map(this.pages.map((p) => [p.id, p]));
      for (const [id, v] of Object.entries(j.pages)) map.set(id, { id, kind: v.kind, data: v.data });
      const order = j.order.filter((id) => map.has(id));
      // pages saved meanwhile (another window) that the kept changes don't know about stay, after the page before them
      const server = this.order();
      server.forEach((id, i) => { if (order.includes(id)) return; const prev = server.slice(0, i).reverse().find((x) => order.includes(x)); order.splice(prev ? order.indexOf(prev) + 1 : order.length, 0, id); });
      if (!order.length || map.get(order[0])?.kind !== 'cover') return;
      this.pages = order.map((id) => map.get(id)); this.title = j.title || this.title; this.settings = j.settings || this.settings;
    });
  }
}
