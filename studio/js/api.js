// ScrapCasion Studio: the DayCasion account session (shared with books.daycasion.com: same storage key), server
// functions (dc_scrap_*), private photo links (signed with the member's own sign-in) and uploads. No secrets here:
// only the public project URL and publishable key; access is decided by sign-in, the server functions and storage rules.
const CFG = window.DC_BOOKS_CONFIG;
export const API = CFG.supabaseUrl;
const KEEP = 'dc-books-session';
let session = null, refreshing = null;
const listeners = new Set();
export const onSignOut = (f) => listeners.add(f);

export async function call(url, { method = 'GET', headers = {}, body, token, raw } = {}) {
  const h = { apikey: CFG.publishableKey, ...headers };
  if (body !== undefined && !raw) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = 'Bearer ' + token;
  let res;
  try {
    res = await fetch(url, { method, headers: h, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
  } catch (e) { return { ok: false, status: 0, data: null, offline: true }; }
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  return { ok: res.ok, status: res.status, data };
}

function store() {
  try { localStorage.removeItem(KEEP); sessionStorage.removeItem(KEEP); } catch (e) { /* storage off */ }
  if (!session) return;
  const { keep, ...s } = session;
  try { (keep ? localStorage : sessionStorage).setItem(KEEP, JSON.stringify(s)); } catch (e) { /* private mode */ }
}
export function loadSession() {
  for (const st of [localStorage, sessionStorage]) {
    try { const s = JSON.parse(st.getItem(KEEP) || 'null'); if (s && s.refresh_token) { session = { ...s, keep: st === localStorage }; return session; } } catch (e) { /* off */ }
  }
  return null;
}
function keepSession(d, keep) {
  session = { access_token: d.access_token, refresh_token: d.refresh_token, keep: keep ?? (session ? session.keep : true),
    expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600), email: (d.user && d.user.email) || (session && session.email) || '' };
  store();
}
export const currentEmail = () => session?.email || '';
export async function signIn(email, password, keep) {
  const r = await call(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', body: { email, password } });
  if (r.ok && r.data?.access_token) { keepSession(r.data, keep); return { ok: true }; }
  return { ok: false, message: r.offline ? 'The connection was interrupted. Please try again.'
    : r.status === 400 ? 'That email and password don’t match a DayCasion account.' : 'Signing in didn’t work. Please try again.' };
}
export function signOut(message) {
  if (session) call(`${API}/auth/v1/logout`, { method: 'POST', token: session.access_token });
  session = null; store();
  for (const f of listeners) f(message);
}
function refresh() {
  if (!session) return Promise.resolve(false);
  refreshing ||= call(`${API}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', body: { refresh_token: session.refresh_token } })
    .then((r) => { refreshing = null; if (r.ok && r.data?.access_token) { keepSession(r.data); return true; } return r.offline ? null : false; });
  return refreshing;
}
export async function authed(path, opts = {}) {
  if (!session) throw new Error('signed-out');
  if (session.expires_at - Date.now() / 1000 < 90) await refresh();
  let r = await call(API + path, { ...opts, token: session.access_token });
  if (r.status === 401 && (await refresh())) r = await call(API + path, { ...opts, token: session.access_token });
  if (r.status === 401) { signOut('Please sign in again.'); throw new Error('signed-out'); }
  return r;
}
export class ApiError extends Error { constructor(r, fallback) { super(errorText(r, fallback)); this.status = r.status; this.offline = !!r.offline; this.data = r.data; } }
export const errorText = (r, fallback = 'Something went wrong. Please try again.') =>
  (!r || r.offline || r.status >= 500 ? 'The connection was interrupted. Please try again.' : (r.data && (r.data.message || r.data.msg)) || fallback);
/** A server function; throws ApiError (with .status, e.g. 409) on failure. */
export async function rpc(fn, args = {}) {
  const r = await authed(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args });
  if (!r.ok) throw new ApiError(r);
  return r.data;
}

// Private photo links (memory photos, scrapbook uploads, proof pages): signed in batches, cached until near expiry.
const links = new Map();
export async function signed(bucket, paths, seconds = 3600) {
  const now = Date.now(), want = [...new Set(paths.filter(Boolean))].filter((p) => { const c = links.get(`${bucket}/${p}`); return !c || c.exp < now + 120000; });
  for (let i = 0; i < want.length; i += 200) {
    const r = await authed(`/storage/v1/object/sign/${bucket}`, { method: 'POST', body: { expiresIn: seconds, paths: want.slice(i, i + 200) } });
    if (r.ok && Array.isArray(r.data)) for (const x of r.data) if (x.signedURL) {
      links.set(`${bucket}/${x.path}`, { url: `${API}/storage/v1${x.signedURL.startsWith('/') ? '' : '/'}${x.signedURL}`, exp: now + seconds * 1000 });
    }
  }
  const out = {}; for (const p of paths) { const c = links.get(`${bucket}/${p}`); if (c) out[p] = c.url; }
  return out;
}
export const linkOf = (bucket, path) => links.get(`${bucket}/${path}`)?.url || null;

/** Upload a file the server has registered (dc_scrap_upload_begin). */
export async function upload(bucket, path, blob, contentType) {
  const r = await authed(`/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', raw: true, body: blob,
    headers: { 'Content-Type': contentType, 'x-upsert': 'false', 'cache-control': '3600' } });
  if (!r.ok) throw new ApiError(r, 'The photo couldn’t be uploaded. Please try again.');
}
export async function removeFiles(bucket, paths) {
  await authed(`/storage/v1/object/${bucket}`, { method: 'DELETE', body: { prefixes: paths } });
}
