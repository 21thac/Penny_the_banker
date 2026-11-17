// Budget maths: what the month's income allows, what has been spent against
// it, and suggested limits per category. No UI in here.

import { getState, liveEntries, categoryById, setSetting } from './store.js';
import { todayStr, monthKey, daysInMonth, shiftMonth, round2 } from './util.js';

export const GROUPS = [
  { id: 'needs', name: 'Needs', hint: 'Essentials you have to pay for' },
  { id: 'wants', name: 'Wants', hint: 'Nice-to-haves you choose' },
];

// Where a category stands against its monthly limit.
// extra: an amount being typed that is not saved yet. minus: an amount already
// counted that should be left out (the entry being edited).
export function categoryUsage(categoryId, month, extra = 0, minus = 0) {
  const limit = Number(categoryById(categoryId)?.limit) || 0;
  const spent = round2((monthSummary(month).byCat.get(categoryId) || 0) - minus);
  const used = round2(spent + extra);
  return { limit, spent, used, share: limit > 0 ? used / limit : 0 };
}

// The colour step for the ring around a category in the entry sheet.
// share is how much of the limit is used: 0.49 means 49%, 1.2 means 120%.
// Return one of: 'good' (green), 'caution' (yellow), 'warn' (orange), 'over' (red).
export function limitTone(share) {
  // Checked from the top down: red from 90%, orange from 70%, yellow from 50%.
  if (share >= 0.9) return 'over';
  if (share >= 0.7) return 'warn';
  if (share >= 0.5) return 'caution';
  return 'good';
}

export const DEFAULT_SPLIT = { needs: 50, wants: 30, savings: 20 };

// Salary is remembered from the month it was set, so a pay change does not
// rewrite earlier months. settings.salaryHistory is [{ from: 'YYYY-MM', amount }].
// A record that repeats the amount before it adds nothing, so it is dropped.
function tidy(history) {
  const out = [];
  for (const h of [...history].sort((a, b) => (a.from < b.from ? -1 : 1))) {
    if (!out.length || out[out.length - 1].amount !== h.amount) out.push(h);
  }
  return out;
}

function salaryHistory() {
  const { settings } = getState();
  if (Array.isArray(settings.salaryHistory) && settings.salaryHistory.length) return tidy(settings.salaryHistory);
  // Saves from before this existed had one salary for every month.
  return Number(settings.salary) > 0 ? [{ from: '0000-00', amount: Number(settings.salary) }] : [];
}

export function salaryFor(month) {
  const history = [...salaryHistory()].sort((a, b) => (a.from < b.from ? -1 : 1));
  if (!history.length) return 0;
  // Months before the first record use that first amount.
  return (history.filter((h) => h.from <= month).pop() || history[0]).amount;
}

export const START = '0000-00'; // a salary record that applies from the very beginning

// The saved salary records, oldest first: [{ from, amount }].
export const salaryRecords = () => [...salaryHistory()].sort((a, b) => (a.from < b.from ? -1 : 1));

// Set the salary. scope 'from': from the given month onward, leaving earlier
// months (and any later change) as they were. scope 'all': every month.
export function setSalary(amount, month, scope = 'from') {
  let history;
  if (scope === 'all' || !salaryHistory().length) {
    history = [{ from: START, amount }];
  } else {
    history = salaryHistory().filter((h) => h.from !== month);
    history.push({ from: month, amount });
  }
  saveSalary(history);
}

export function removeSalaryRecord(from) {
  const history = salaryHistory().filter((h) => h.from !== from);
  if (history.length) saveSalary(history);
}

function saveSalary(history) {
  setSetting('salaryHistory', tidy(history));
  // settings.salary mirrors the current month's figure.
  setSetting('salary', salaryFor(monthKey(todayStr())));
}

// Anything not marked as a need counts as a want.
export const groupOf = (cat) => (cat?.group === 'needs' ? 'needs' : 'wants');

export function monthSummary(month) {
  const { settings } = getState();
  const split = { ...DEFAULT_SPLIT, ...settings.split };
  const salary = salaryFor(month);

  const entries = liveEntries().filter((e) => monthKey(e.date) === month);
  let extras = 0;
  let spent = 0;
  const byCat = new Map();
  const spentBy = { needs: 0, wants: 0 };
  for (const e of entries) {
    if (e.type === 'income') {
      extras += e.amount;
      continue;
    }
    spent += e.amount;
    byCat.set(e.categoryId, (byCat.get(e.categoryId) || 0) + e.amount);
    spentBy[groupOf(categoryById(e.categoryId))] += e.amount;
  }

  // Extra income (bonus, side income) raises that month's budget in the same proportions.
  const income = salary + extras;
  const guide = {
    needs: round2((income * split.needs) / 100),
    wants: round2((income * split.wants) / 100),
    savings: round2((income * split.savings) / 100),
  };
  const budget = round2(guide.needs + guide.wants);
  const left = round2(budget - spent);

  const today = todayStr();
  const thisMonth = monthKey(today);
  const isCurrent = month === thisMonth;
  const isPast = month < thisMonth;
  const days = daysInMonth(month);
  const day = isCurrent ? Number(today.slice(8)) : isPast ? days : 0;
  const daysLeft = isCurrent ? days - day + 1 : isPast ? 0 : days; // today counts as a day left
  const perDay = daysLeft > 0 ? Math.max(0, left) / daysLeft : 0;
  // Salary counts as it is earned through the month, not all on the 1st, so
  // savings figures are not flattered early on.
  const earned = round2((days ? (salary * day) / days : 0) + extras);

  return {
    month,
    salary,
    extras: round2(extras),
    income: round2(income),
    split,
    guide,
    budget,
    spent: round2(spent),
    spentBy: { needs: round2(spentBy.needs), wants: round2(spentBy.wants) },
    byCat,
    left,
    earned,
    unspent: round2(earned - spent),
    isCurrent,
    isPast,
    days,
    day,
    daysLeft,
    perDay,
    elapsed: days ? day / days : 0,
  };
}

const nice = (x) => (x >= 200 ? Math.round(x / 10) * 10 : x >= 20 ? Math.round(x / 5) * 5 : Math.round(x));

// Suggest a limit for every active spending category. Each group's guide
// amount is shared out in proportion to what each category usually costs: the
// monthly average over the previous three months, or this month's spending so
// far if that is higher. With nothing to go on it is shared equally.
export function suggestLimits(month) {
  const s = monthSummary(month);
  const cats = getState().categories.filter((c) => c.type === 'expense' && !c.archived);
  const months = [1, 2, 3].map((n) => shiftMonth(month, -n));
  const past = new Map();
  const active = new Set();
  for (const e of liveEntries()) {
    const mk = monthKey(e.date);
    if (e.type === 'expense' && months.includes(mk)) {
      active.add(mk);
      past.set(e.categoryId, (past.get(e.categoryId) || 0) + e.amount);
    }
  }
  const usual = (c) => Math.max((past.get(c.id) || 0) / (active.size || 1), s.byCat.get(c.id) || 0);

  const out = new Map();
  for (const { id } of GROUPS) {
    const members = cats.filter((c) => groupOf(c) === id);
    if (!members.length || !s.guide[id]) continue;
    const total = members.reduce((t, c) => t + usual(c), 0);
    // A small floor so categories with no spending yet still get a share.
    const floor = total > 0 ? (total / members.length) * 0.15 : 1;
    const weights = members.map((c) => usual(c) + floor);
    const sumW = weights.reduce((a, b) => a + b, 0);
    members.forEach((c, i) => out.set(c.id, nice((s.guide[id] * weights[i]) / sumW)));
  }
  return out;
}
