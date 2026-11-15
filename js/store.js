// App data: entries, categories, settings. Saved on the device (localStorage).
// Every record carries updatedAt, and deletes are soft, so the Google Sheet
// sync added later can merge changes made on two devices.

import { uid } from './util.js';

const KEY = 'ledger.v1';

const cat = (name, icon, color, type, group) => ({
  id: uid(),
  name,
  icon,
  color,
  type, // 'expense' | 'income'
  group, // 'needs' | 'wants' | 'savings' (used by the budget screen)
  archived: false,
  updatedAt: Date.now(),
});

const defaults = () => ({
  v: 1,
  settings: { currency: 'USD', font: 'coming-soon', salary: 0, split: { needs: 50, wants: 30, savings: 20 } },
  categories: [
    cat('Food', 'bowl', '#B17457', 'expense', 'needs'),
    cat('Transport', 'bus', '#7D8FA3', 'expense', 'needs'),
    cat('Housing', 'home', '#9B7E8E', 'expense', 'needs'),
    cat('Bills', 'bolt', '#C2A36B', 'expense', 'needs'),
    cat('Shopping', 'bag', '#C58B74', 'expense', 'wants'),
    cat('Entertainment', 'play', '#6F8F8B', 'expense', 'wants'),
    cat('Health', 'heart', '#8A9A7B', 'expense', 'needs'),
    cat('Other', 'dots', '#8C8577', 'expense', 'wants'),
    cat('Bonus', 'gift', '#8A9A7B', 'income', null),
    cat('Side income', 'case', '#7D8FA3', 'income', null),
    cat('Gift', 'star', '#C58B74', 'income', null),
    cat('Other income', 'plus', '#8C8577', 'income', null),
  ],
  entries: [],
  // Savings and investments (step 5).
  holdings: [], // { id, name, kind, deleted }
  moves: [], // money put in (+) or taken out (−) of a holding
  valuations: [], // market values the user has logged, newest last
  goals: [], // { id, name, target, date, holdingIds }
});

// Older saves used emoji and brighter colours for categories. Map them onto the
// line icons and the muted palette so existing data keeps working.
const OLD_ICON = {
  '🍜': 'bowl', '☕': 'cup', '🛒': 'basket', '🚌': 'bus', '🚗': 'car', '⛽': 'drop', '🏠': 'home',
  '💡': 'bolt', '📱': 'phone', '🛍️': 'bag', '👕': 'tag', '🎬': 'play', '🎮': 'game', '✈️': 'plane',
  '💊': 'heart', '🏋️': 'dumbbell', '📚': 'book', '🐾': 'leaf', '👶': 'star', '💇': 'star',
  '🎁': 'gift', '💼': 'case', '📈': 'trend', '📦': 'dots', '💌': 'star', '➕': 'plus',
};
const OLD_COLOR = {
  '#d9773c': '#B17457', '#c79a26': '#C2A36B', '#2d9d78': '#8A9A7B', '#2f9fb3': '#6F8F8B',
  '#3f7fd9': '#7D8FA3', '#7a62cf': '#9B7E8E', '#a455cf': '#6F8F8B', '#d4558c': '#C58B74',
  '#d24f4f': '#A8483A', '#7b8490': '#8C8577',
};

function migrate(s) {
  s.categories.forEach((c, i) => {
    if (!c.icon) {
      c.icon = OLD_ICON[c.emoji] || 'dots';
      c.color = OLD_COLOR[c.color] || c.color;
      delete c.emoji;
    }
    // Each category carries its own position, so the order can be synced.
    if (typeof c.order !== 'number') c.order = i;
  });
  return s;
}

// The kinds of record that sync between devices. Each record has an id and an
// updatedAt time; when two devices disagree, the newer one wins.
export const COLLECTIONS = ['entries', 'categories', 'holdings', 'moves', 'valuations', 'goals'];

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && Array.isArray(s.entries) && Array.isArray(s.categories)) {
        return migrate({ ...defaults(), ...s, settings: { ...defaults().settings, ...s.settings } });
      }
    }
  } catch {
    /* fall through to defaults */
  }
  return defaults();
}

// meta.remote is true when the change came from another device via sync.
function commit(meta = {}) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable (private mode); keep working in memory */
  }
  listeners.forEach((fn) => fn(state, meta));
}

// Fold in records that arrived from sync. For each record the newer copy wins.
// replace: true takes the incoming data wholesale (a new device joining).
export function mergeRemote(remote, { replace = false } = {}) {
  for (const name of COLLECTIONS) {
    const incoming = remote[name] || [];
    if (replace) {
      state[name] = incoming;
      continue;
    }
    const byId = new Map(state[name].map((r) => [r.id, r]));
    for (const r of incoming) {
      const mine = byId.get(r.id);
      if (!mine || (r.updatedAt || 0) > (mine.updatedAt || 0)) byId.set(r.id, r);
    }
    state[name] = [...byId.values()];
  }
  if (remote.settings && (replace || (remote.settings.updatedAt || 0) > (state.settings.updatedAt || 0))) {
    state.settings = { ...defaults().settings, ...remote.settings };
  }
  state.categories.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  commit({ remote: true });
}

export const getState = () => state;

// Replace everything with a previously exported backup.
export function replaceState(next) {
  if (!next || !Array.isArray(next.entries) || !Array.isArray(next.categories)) {
    throw new Error('Not a backup file');
  }
  state = migrate({ ...defaults(), ...next, settings: { ...defaults().settings, ...next.settings } });
  commit();
}
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));

// ---- Queries ----

export const liveEntries = () => state.entries.filter((e) => !e.deleted);
export const categoryById = (id) => state.categories.find((c) => c.id === id);
export const categoriesOf = (type) =>
  state.categories.filter((c) => c.type === type && !c.archived);

// ---- Entries ----

export function addEntry({ type, amount, categoryId, date, note, photoId = null }) {
  const now = Date.now();
  const entry = {
    id: uid(),
    type,
    amount,
    categoryId,
    date,
    note: note || '',
    photoId, // id of an attached photo in photos.js, if any
    createdAt: now,
    updatedAt: now,
    deleted: false,
  };
  state.entries.push(entry);
  commit();
  return entry;
}

export function updateEntry(id, patch) {
  const e = state.entries.find((x) => x.id === id);
  if (!e) return;
  Object.assign(e, patch, { updatedAt: Date.now() });
  commit();
}

export const deleteEntry = (id) => updateEntry(id, { deleted: true });
export const restoreEntry = (id) => updateEntry(id, { deleted: false });

// ---- Categories ----

export function addCategory({ name, icon, color, type, group }) {
  const c = cat(name, icon, color, type, type === 'expense' ? group || 'wants' : null);
  c.order = state.categories.reduce((top, x) => Math.max(top, x.order ?? 0), -1) + 1;
  state.categories.push(c);
  commit();
  return c;
}

export function updateCategory(id, patch) {
  const c = categoryById(id);
  if (!c) return;
  Object.assign(c, patch, { updatedAt: Date.now() });
  commit();
}

// Removing hides the category from the picker; past entries keep their label.
export const archiveCategory = (id) => updateCategory(id, { archived: true });
export const restoreCategory = (id) => updateCategory(id, { archived: false });

export function moveCategory(id, dir) {
  const c = categoryById(id);
  if (!c) return;
  const peers = state.categories
    .map((x, i) => ({ x, i }))
    .filter(({ x }) => x.type === c.type && !x.archived);
  const pos = peers.findIndex(({ x }) => x.id === id);
  const other = peers[pos + dir];
  if (!other) return;
  const a = peers[pos].i;
  const b = other.i;
  [state.categories[a], state.categories[b]] = [state.categories[b], state.categories[a]];
  renumber();
  commit();
}

// After a reorder, record each category's new position. Only the ones that
// moved are marked as changed.
function renumber() {
  const now = Date.now();
  state.categories.forEach((c, i) => {
    if (c.order !== i) Object.assign(c, { order: i, updatedAt: now });
  });
}

// Put one type's visible categories into the given order (a list of ids).
export function reorderCategories(type, ids) {
  const slots = state.categories
    .map((c, i) => (c.type === type && !c.archived ? i : -1))
    .filter((i) => i >= 0);
  const next = ids.map((id) => categoryById(id)).filter(Boolean);
  if (next.length !== slots.length) return;
  slots.forEach((slot, n) => (state.categories[slot] = next[n]));
  renumber();
  commit();
}

// ---- Holdings, contributions, valuations, goals ----

const stamp = (o) => Object.assign(o, { updatedAt: Date.now() });

export function addHolding({ name, kind }) {
  const h = stamp({ id: uid(), name, kind, deleted: false });
  state.holdings.push(h);
  commit();
  return h;
}

export function updateHolding(id, patch) {
  const h = state.holdings.find((x) => x.id === id);
  if (!h) return;
  stamp(Object.assign(h, patch));
  commit();
}

// opening: true marks money that was already there when the holding was added,
// so it is not counted as a contribution made this year.
export function addMove({ holdingId, amount, date, note = '', opening = false }) {
  const m = stamp({ id: uid(), holdingId, amount, date, note, opening, createdAt: Date.now(), deleted: false });
  state.moves.push(m);
  commit();
  return m;
}

export function setMoveDeleted(id, deleted) {
  const m = state.moves.find((x) => x.id === id);
  if (!m) return;
  stamp(Object.assign(m, { deleted }));
  commit();
}

// Record what a holding is worth on a date. One value per holding per day.
export function setValue(holdingId, value, date) {
  // A second value on the same day updates the first in place (keeping its
  // id), so another device sees a change, not a deletion.
  const same = state.valuations.find((v) => v.holdingId === holdingId && v.date === date);
  if (same) stamp(Object.assign(same, { value, at: Date.now() }));
  else state.valuations.push(stamp({ id: uid(), holdingId, value, date, at: Date.now() }));
  commit();
}

export function saveGoal(goal) {
  const existing = state.goals.find((g) => g.id === goal.id);
  if (existing) stamp(Object.assign(existing, goal));
  else state.goals.push(stamp({ id: uid(), deleted: false, ...goal }));
  commit();
}

// ---- Settings ----

export function setSetting(key, value) {
  state.settings[key] = value;
  state.settings.updatedAt = Date.now();
  commit();
}
