// Sync between devices through a Google Sheet in the user's own Drive.
//
// Each device sends the records it has changed since its last sync and gets
// back what changed elsewhere. When two devices changed the same record, the
// one changed later wins. The other half of this lives in sync-script.js.

import { getState, subscribe, mergeRemote, COLLECTIONS, categoryById } from './store.js';
import { getPhoto, putPhoto } from './photos.js';

const KEY = 'ledger.sync';

const blank = () => ({ url: '', code: '', on: false, lastServer: 0, lastPush: 0, lastOk: '', error: '', photos: {} });

export function getSync() {
  try {
    return { ...blank(), ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return blank();
  }
}

function save(patch) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...getSync(), ...patch }));
  } catch {
    /* storage unavailable */
  }
}

export const syncOn = () => {
  const s = getSync();
  return !!(s.on && s.url && s.code);
};

// A sync code is made once per Sheet and shared by every device that uses it.
export function syncCode() {
  let { code } = getSync();
  if (!code) {
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    code = [...bytes].map((b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('').replace(/(.{6})(?=.)/g, '$1-');
    save({ code });
  }
  return code;
}

export const setSyncCode = (code) => save({ code: code.trim() });

// ---- Status, for the Settings screen ----

let busy = false;
const watchers = new Set();
export const onSyncChange = (fn) => (watchers.add(fn), () => watchers.delete(fn));
export const syncBusy = () => busy;
const announce = () => watchers.forEach((fn) => fn());

// ---- Talking to the Sheet ----

export class SyncError extends Error {}

async function call(payload, { url, code } = getSync(), seconds = 60) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), seconds * 1000);
  let res;
  try {
    // Sent as plain text so the browser makes one simple request, which is
    // what a Google Apps Script web app accepts from another site.
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ code, ...payload }),
      redirect: 'follow',
      signal: ctl.signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw new SyncError('The Sheet took too long to answer.');
    if (navigator.onLine === false) throw new SyncError("You're offline. Sync will run when the connection is back.");
    // Online but refused: Google answered with a sign-in or error page.
    throw new SyncError(
      'Google refused the request. In Apps Script open Deploy, then Manage deployments, and check that "Who has access" is set to Anyone and that you allowed access when asked.',
    );
  } finally {
    clearTimeout(timer);
  }
  let data;
  try {
    data = JSON.parse(await res.text());
  } catch {
    throw new SyncError("That address didn't answer like a Ledger sync script. Check the Web app URL, and that access is set to Anyone.");
  }
  if (!data.ok) {
    if (data.error === 'wrong-code') throw new SyncError("The sync code doesn't match the one in the script.");
    throw new SyncError(`The Sheet reported a problem: ${data.error}`);
  }
  return data;
}

// ---- What each record looks like in the Sheet's readable columns ----

const HEADERS = {
  entries: ['Date', 'Type', 'Category', 'Amount', 'Note', 'Photo'],
  categories: ['Name', 'Type', 'Needs or wants', 'Monthly limit', 'Remark', 'Order', 'Status'],
  holdings: ['Name', 'Kind'],
  moves: ['Date', 'Holding', 'Amount', 'Note'],
  valuations: ['Date', 'Holding', 'Value'],
  goals: ['Name', 'Target', 'Target date'],
  settings: ['What'],
};

function readable(name, r, photos) {
  const holding = (id) => getState().holdings.find((h) => h.id === id)?.name ?? '';
  switch (name) {
    case 'entries':
      return [r.date, r.type === 'income' ? 'Income' : 'Spending', categoryById(r.categoryId)?.name ?? '', r.amount, r.note || '', photos[r.photoId] || ''];
    case 'categories':
      return [r.name, r.type === 'income' ? 'Income' : 'Spending', r.group || '', r.limit || '', r.remark || '', r.order ?? '', r.archived ? 'Removed' : ''];
    case 'holdings':
      return [r.name, r.kind];
    case 'moves':
      return [r.date, holding(r.holdingId), r.amount, r.note || ''];
    case 'valuations':
      return [r.date, holding(r.holdingId), r.value];
    case 'goals':
      return [r.name, r.target, r.date || ''];
    default:
      return [];
  }
}

const toRow = (name, r, photos) => ({
  id: r.id,
  updatedAt: r.updatedAt || 1,
  deleted: !!(r.deleted || r.archived),
  json: JSON.stringify(r),
  cols: readable(name, r, photos),
});

// ---- One round of sync ----

async function round({ replace = false } = {}) {
  const cfg = getSync();
  const state = getState();
  const started = Date.now();

  // Photos go up first, so an entry's row can carry the link to its photo.
  if (!replace) {
    for (const e of state.entries) {
      if (!e.photoId || e.deleted || cfg.photos[e.photoId]) continue;
      const dataUrl = await getPhoto(e.photoId);
      if (!dataUrl) continue;
      const res = await call({ action: 'putPhoto', id: e.photoId, dataUrl }, cfg, 90);
      cfg.photos[e.photoId] = res.url;
      save({ photos: cfg.photos });
    }
  }

  const changes = {};
  for (const name of COLLECTIONS) {
    const rows = replace ? [] : state[name].filter((r) => (r.updatedAt || 1) > cfg.lastPush).map((r) => toRow(name, r, cfg.photos));
    changes[name] = { headers: HEADERS[name], rows };
  }
  const settingsChanged = !replace && (state.settings.updatedAt || 1) > cfg.lastPush;
  changes.settings = {
    headers: HEADERS.settings,
    rows: settingsChanged
      ? [{ id: 'settings', updatedAt: state.settings.updatedAt || 1, deleted: false, json: JSON.stringify(state.settings), cols: ['App settings'] }]
      : [],
  };

  const res = await call({ action: 'sync', since: replace ? 0 : cfg.lastServer, changes }, cfg);

  const remote = {};
  let any = false;
  for (const name of COLLECTIONS) {
    remote[name] = (res.records[name] || []).map((j) => JSON.parse(j));
    any = any || remote[name].length > 0;
  }
  const settingsRow = (res.records.settings || [])[0];
  if (settingsRow) remote.settings = JSON.parse(settingsRow);
  if (any || remote.settings) mergeRemote(remote, { replace });

  save({ lastServer: res.serverTime, lastPush: started, lastOk: new Date().toISOString(), error: '' });
}

let running = null;
let again = false;

// Sync now. If a sync is already under way, one more runs straight after it.
export function syncNow(opts) {
  if (!syncOn()) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  busy = true;
  announce();
  running = round(opts)
    .catch((err) => save({ error: err instanceof SyncError ? err.message : 'Sync hit an unexpected problem.' }))
    .finally(() => {
      running = null;
      busy = false;
      announce();
      if (again) {
        again = false;
        syncNow();
      }
    });
  return running;
}

// ---- Connecting and disconnecting ----

const hasOwnData = () => {
  const s = getState();
  return s.entries.length > 0 || s.holdings.length > 0 || s.goals.length > 0 || Number(s.settings.salary) > 0;
};

// Returns 'joined' when this device took its data from the Sheet, 'merged'
// when both sides had data, or 'started' when the Sheet was empty.
export async function connect(url, code) {
  url = url.trim();
  code = code.trim();
  if (!/^https:\/\//.test(url)) throw new SyncError('Paste the Web app URL. It starts with https://');
  if (!code) throw new SyncError('Enter the sync code.');
  // Remember what was typed, so a failed attempt doesn't have to be retyped.
  save({ url, code, on: false });
  if (!/^https:\/\/script\.google\.com\/(a\/macros\/[^/]+|macros)\/s\/[^/]+\/exec$/.test(url)) {
    throw new SyncError(
      /docs\.google\.com/.test(url)
        ? "That is the Sheet's own address. Paste the Web app URL from Deploy, which starts with https://script.google.com/macros/s/ and ends with /exec."
        : /\/dev$/.test(url)
          ? 'That is the test address (it ends with /dev). Use the Web app URL from Deploy, which ends with /exec.'
          : 'That does not look like a Web app URL. It should start with https://script.google.com/macros/s/ and end with /exec.',
    );
  }
  const ping = await call({ action: 'ping' }, { url, code }, 30);
  const sheetHasData = ping.records > 0;
  const replace = sheetHasData && !hasOwnData();
  save({ url, code, on: true, lastServer: 0, lastPush: 0, error: '', photos: {} });
  await syncNow({ replace });
  const { error } = getSync();
  if (error) throw new SyncError(error);
  return replace ? 'joined' : sheetHasData ? 'merged' : 'started';
}

export function disconnect() {
  save({ on: false, url: '', lastServer: 0, lastPush: 0, lastOk: '', error: '', photos: {} });
  announce();
}

// ---- Photos on a device that doesn't have them yet ----

// The photo for an entry: from this device if it is here, otherwise fetched
// from Drive through the Sheet and kept for next time.
export async function loadPhoto(id) {
  const local = await getPhoto(id);
  if (local || !syncOn()) return local;
  try {
    const res = await call({ action: 'getPhoto', id });
    await putPhoto(id, res.dataUrl);
    return res.dataUrl;
  } catch {
    return null;
  }
}

// ---- Automatic sync ----

export function startSync() {
  let timer = null;
  const soon = (ms) => {
    clearTimeout(timer);
    timer = setTimeout(() => navigator.onLine !== false && syncNow(), ms);
  };
  // A few seconds after any change made on this device...
  subscribe((_, meta) => {
    if (!meta?.remote && syncOn()) soon(3000);
  });
  // ...when the app is opened or brought back to the front, and when the
  // connection returns.
  window.addEventListener('online', () => syncOn() && soon(500));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && syncOn()) soon(500);
  });
  if (syncOn()) soon(800);
}
