// Figures behind the charts and the on-device notes. No UI in here.

import { getState, liveEntries, categoryById } from './store.js';
import { monthSummary, groupOf, GROUPS } from './budget.js';
import { todayStr, monthKey, daysInMonth, shiftMonth, parseDate, round2 } from './util.js';

const expensesIn = (month) =>
  liveEntries().filter((e) => e.type === 'expense' && monthKey(e.date) === month);

// Spending for each day of the month: index 0 is the 1st.
export function dailyTotals(month) {
  const days = Array(daysInMonth(month)).fill(0);
  for (const e of expensesIn(month)) days[Number(e.date.slice(8)) - 1] += e.amount;
  return days.map(round2);
}

// Spending per category, largest first, with each one's share of the total.
export function categoryTotals(month) {
  const totals = new Map();
  for (const e of expensesIn(month)) totals.set(e.categoryId, (totals.get(e.categoryId) || 0) + e.amount);
  const total = [...totals.values()].reduce((a, b) => a + b, 0);
  return [...totals.entries()]
    .map(([id, amount]) => ({ cat: categoryById(id), id, amount: round2(amount), share: total ? amount / total : 0 }))
    .sort((a, b) => b.amount - a.amount);
}

// The n months ending at endMonth, oldest first.
export function monthlyTotals(endMonth, n = 6) {
  return Array.from({ length: n }, (_, i) => shiftMonth(endMonth, i - (n - 1))).map((month) => {
    const s = monthSummary(month);
    return { month, spent: s.spent, budget: s.salary ? s.budget : 0, income: s.income };
  });
}

// A clearly different colour for every spending category in charts. A
// category keeps its own colour unless another category already uses it (or
// one very close to it), in which case it gets the next free one from a set
// chosen to be easy to tell apart.
const DISTINCT = [
  '#B17457', '#4F7C8A', '#C9A13B', '#6F8F5E', '#8A6BA8', '#3E3D3B',
  '#D58A94', '#2F9C8F', '#8C4A2F', '#93A3B5', '#6B5A3C', '#D9793B',
];

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const near = (a, b) => {
  const [x, y] = [rgb(a), rgb(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 60;
};

export function chartColors() {
  const used = [];
  const out = new Map();
  for (const c of getState().categories.filter((x) => x.type === 'expense')) {
    const own = /^#[0-9a-f]{6}$/i.test(c.color || '') ? c.color : null;
    const pick =
      own && !used.some((u) => near(u, own))
        ? own
        : DISTINCT.find((d) => !used.some((u) => near(u, d))) || DISTINCT[out.size % DISTINCT.length];
    used.push(pick);
    out.set(c.id, pick);
  }
  return out;
}

// Spending per category for each day of the month: index 0 is the 1st.
export function dailyByCategory(month) {
  const days = Array.from({ length: daysInMonth(month) }, () => new Map());
  for (const e of expensesIn(month)) {
    const d = days[Number(e.date.slice(8)) - 1];
    d.set(e.categoryId, (d.get(e.categoryId) || 0) + e.amount);
  }
  return days;
}

// Spending per category for one month.
export function monthByCategory(month) {
  const out = new Map();
  for (const e of expensesIn(month)) out.set(e.categoryId, (out.get(e.categoryId) || 0) + e.amount);
  return out;
}

export const dayName = (month, day) =>
  parseDate(`${month}-${String(day).padStart(2, '0')}`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

export const monthShort = (month) =>
  parseDate(`${month}-01`).toLocaleDateString(undefined, { month: 'short' });

// Plain observations worked out on the device. At most four.
export function glance(month, m) {
  const s = monthSummary(month);
  const out = [];
  if (!s.spent) return out;

  const cats = categoryTotals(month);
  const daily = dailyTotals(month);
  const prev = shiftMonth(month, -1);
  const cutoff = s.isCurrent ? s.day : 31; // compare like with like: same point in the month
  const prevEntries = expensesIn(prev).filter((e) => Number(e.date.slice(8)) <= cutoff);
  const prevSpent = round2(prevEntries.reduce((t, e) => t + e.amount, 0));

  if (prevSpent > 0) {
    const diff = round2(s.spent - prevSpent);
    const pct = Math.round((Math.abs(diff) / prevSpent) * 100);
    const when = s.isCurrent ? 'at this point last month' : 'the month before';
    if (Math.abs(diff) >= prevSpent * 0.03) {
      out.push(`You've spent ${m(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than ${when} (${diff > 0 ? '+' : '−'}${pct}%).`);
    } else {
      out.push(`Spending is about the same as ${when}.`);
    }
  }

  const top = cats[0];
  if (top) {
    out.push(`${top.cat?.name ?? 'Uncategorised'} is your biggest category: ${m(top.amount)}, ${Math.round(top.share * 100)}% of the month.`);
  }

  // The category that grew the most against the same period last month.
  if (prevSpent > 0) {
    const before = new Map();
    for (const e of prevEntries) before.set(e.categoryId, (before.get(e.categoryId) || 0) + e.amount);
    const rise = cats
      .map((c) => ({ c, up: c.amount - (before.get(c.id) || 0), was: before.get(c.id) || 0 }))
      .filter((x) => x.up > 0 && x.up >= x.was * 0.25 && x.up >= s.spent * 0.03 && x.c.id !== top?.id)
      .sort((a, b) => b.up - a.up)[0];
    if (rise) out.push(`${rise.c.cat?.name ?? 'Uncategorised'} is up ${m(rise.up)} on last month.`);
  }

  for (const g of GROUPS) {
    if (s.salary && s.spentBy[g.id] > s.guide[g.id]) {
      out.push(`${g.name} are ${m(s.spentBy[g.id] - s.guide[g.id])} over your ${s.split[g.id]}% share.`);
    }
  }

  const peak = Math.max(...daily);
  if (peak > 0 && daily.filter((d) => d > 0).length > 1) {
    out.push(`Your heaviest day was ${dayName(month, daily.indexOf(peak) + 1)}: ${m(peak)}.`);
  }

  const elapsed = s.isCurrent ? s.day : s.days;
  const quiet = daily.slice(0, elapsed).filter((d) => d === 0).length;
  if (quiet > 0 && elapsed >= 5) {
    out.push(`${quiet} ${quiet === 1 ? 'day' : 'days'} with no spending${s.isCurrent ? ' so far' : ''}.`);
  }

  return out.slice(0, 4);
}

// Everything the AI review needs about one month, as plain data.
export function reviewData(month) {
  const s = monthSummary(month);
  const past = [1, 2, 3].map((n) => shiftMonth(month, -n));
  const usual = new Map();
  const active = new Set();
  for (const e of liveEntries()) {
    const mk = monthKey(e.date);
    if (e.type === 'expense' && past.includes(mk)) {
      active.add(mk);
      usual.set(e.categoryId, (usual.get(e.categoryId) || 0) + e.amount);
    }
  }
  const cats = getState().categories.filter(
    (c) => c.type === 'expense' && (!c.archived || s.byCat.get(c.id)),
  );
  const prev = monthSummary(shiftMonth(month, -1));
  return {
    currency: getState().settings.currency,
    month,
    today: todayStr(),
    day_of_month: s.isCurrent ? s.day : s.days,
    days_in_month: s.days,
    month_in_progress: s.isCurrent,
    monthly_salary: s.salary,
    extra_income_this_month: s.extras,
    plan_percent: s.split,
    plan_amounts: s.salary ? s.guide : null,
    spent_total: s.spent,
    spent_needs: s.spentBy.needs,
    spent_wants: s.spentBy.wants,
    previous_month: { spent_total: prev.spent, spent_needs: prev.spentBy.needs, spent_wants: prev.spentBy.wants },
    categories: cats.map((c) => ({
      id: c.id,
      name: c.name,
      group: groupOf(c),
      spent_this_month: round2(s.byCat.get(c.id) || 0),
      current_limit: c.limit > 0 ? c.limit : null,
      usual_per_month: active.size ? round2((usual.get(c.id) || 0) / active.size) : null,
    })),
    largest_entries: expensesIn(month)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8)
      .map((e) => ({ date: e.date, amount: e.amount, category: categoryById(e.categoryId)?.name ?? '', note: e.note })),
  };
}
