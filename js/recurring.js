// Monthly items: subscriptions, repayments and other bills that come round
// every month. Nothing is ever logged automatically. Each month an item shows
// up as due and waits for one tap, Log or Skip, so a service you have stopped
// paying for never slips into your records.
//
// They are kept in settings (settings.recurring), which already syncs.

import { getState, setSetting, addEntry, liveEntries } from './store.js';
import { uid, todayStr, monthKey, daysInMonth } from './util.js';

export const monthlyItems = () => getState().settings.recurring || [];
export const monthlyItem = (id) => monthlyItems().find((r) => r.id === id);

const write = (items) => setSetting('recurring', items);

export function saveMonthly(item) {
  const items = [...monthlyItems()];
  const at = items.findIndex((r) => r.id === item.id);
  if (at >= 0) items[at] = { ...items[at], ...item };
  else items.push({ id: uid(), type: 'expense', active: true, from: monthKey(todayStr()), skipped: [], ...item });
  write(items);
  return at >= 0 ? items[at] : items[items.length - 1];
}

export const removeMonthly = (id) => write(monthlyItems().filter((r) => r.id !== id));

// The date an item falls on in a month ("the 31st" becomes the last day of a shorter month).
export const dueDate = (item, month) =>
  `${month}-${String(Math.min(item.day || 1, daysInMonth(month))).padStart(2, '0')}`;

const loggedIds = (month) =>
  new Set(liveEntries().filter((e) => e.recurringId && monthKey(e.date) === month).map((e) => e.recurringId));

// How each active item stands for a month: 'logged', 'skipped', 'due' or 'upcoming'.
export function monthlyStatus(month) {
  const today = todayStr();
  const logged = loggedIds(month);
  return monthlyItems()
    .filter((r) => r.active && (r.from || '') <= month)
    .map((r) => ({
      item: r,
      date: dueDate(r, month),
      state: logged.has(r.id)
        ? 'logged'
        : (r.skipped || []).includes(month)
          ? 'skipped'
          : dueDate(r, month) <= today
            ? 'due'
            : 'upcoming',
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Record this month's payment as an ordinary entry, linked back to the item.
export function logMonthly(id, month) {
  const item = monthlyItem(id);
  if (!item) return null;
  return addEntry({
    type: item.type || 'expense',
    amount: item.amount,
    categoryId: item.categoryId,
    date: dueDate(item, month),
    note: item.name,
    recurringId: item.id,
  });
}

export function skipMonthly(id, month, skip = true) {
  const item = monthlyItem(id);
  if (!item) return;
  const skipped = (item.skipped || []).filter((m) => m !== month);
  if (skip) skipped.push(month);
  saveMonthly({ id, skipped });
}
