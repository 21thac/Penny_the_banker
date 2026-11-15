// Savings, investments, debts and goals: the sums behind the Goals screen.

import { getState } from './store.js';
import { todayStr, monthKey, shiftMonth, daysInMonth, parseDate, round2 } from './util.js';

export const KINDS = [
  { id: 'savings', name: 'Savings', one: 'Savings' },
  { id: 'stock', name: 'Stocks', one: 'Stock' },
  { id: 'etf', name: 'ETFs', one: 'ETF' },
  { id: 'other', name: 'Other', one: 'Other' },
  { id: 'debt', name: 'Debts', one: 'Debt' },
];

export const isInvestment = (h) => h.kind === 'stock' || h.kind === 'etf' || h.kind === 'other';
export const liveHoldings = () => getState().holdings.filter((h) => !h.deleted);
export const holdingById = (id) => getState().holdings.find((h) => h.id === id);
export const movesOf = (id) =>
  getState()
    .moves.filter((m) => m.holdingId === id && !m.deleted)
    .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));

// What a holding has had put into it, what it is worth, and the difference.
// asOf (YYYY-MM-DD) gives the position on an earlier date.
export function holdingStats(h, asOf = null) {
  const { moves, valuations } = getState();
  const mine = moves.filter((m) => m.holdingId === h.id && !m.deleted && (!asOf || m.date <= asOf));
  const put = mine.reduce((t, m) => t + m.amount, 0);
  const last = valuations
    .filter((v) => v.holdingId === h.id && (!asOf || v.date <= asOf))
    .sort((a, b) => (a.date === b.date ? a.at - b.at : a.date < b.date ? -1 : 1))
    .pop();

  let value = put;
  if (last) {
    // The logged value, plus anything added or withdrawn since it was logged.
    const since = mine.filter((m) => m.date > last.date || (m.date === last.date && m.createdAt > last.at));
    value = last.value + since.reduce((t, m) => t + m.amount, 0);
  }
  if (h.kind === 'debt') value = last ? last.value : 0;

  const pnl = value - put;
  return {
    put: round2(put),
    value: round2(value),
    pnl: round2(pnl),
    pct: put > 0 ? pnl / put : null,
    valuedOn: last?.date ?? null,
  };
}

export function overview(asOf = null) {
  const rows = liveHoldings().map((h) => ({ h, ...holdingStats(h, asOf) }));
  const of = (test) => rows.filter((r) => test(r.h));
  const total = (list, key) => round2(list.reduce((t, r) => t + r[key], 0));
  const inv = of(isInvestment);
  const invPut = total(inv, 'put');
  const invValue = total(inv, 'value');
  const savings = total(of((h) => h.kind === 'savings'), 'value');
  const debts = total(of((h) => h.kind === 'debt'), 'value');
  return {
    rows,
    savings,
    invValue,
    invPut,
    invPnl: round2(invValue - invPut),
    invPct: invPut > 0 ? (invValue - invPut) / invPut : null,
    debts,
    net: round2(savings + invValue - debts),
  };
}

// Contributions this calendar year against the yearly target.
export function yearProgress() {
  const { moves, settings } = getState();
  const today = todayStr();
  const year = today.slice(0, 4);
  const kindOf = new Map(getState().holdings.map((h) => [h.id, h.kind]));
  const monthly = Array(12).fill(0);
  for (const m of moves) {
    if (m.deleted || m.opening || !m.date.startsWith(year) || kindOf.get(m.holdingId) === 'debt') continue;
    monthly[Number(m.date.slice(5, 7)) - 1] += m.amount;
  }
  const done = round2(monthly.reduce((a, b) => a + b, 0));
  const target = Number(settings.yearTarget) || 0;

  const start = parseDate(`${year}-01-01`);
  const dayOfYear = Math.round((parseDate(today) - start) / 86400000) + 1;
  const daysInYear = Number(year) % 4 === 0 && (Number(year) % 100 !== 0 || Number(year) % 400 === 0) ? 366 : 365;
  const elapsed = dayOfYear / daysInYear;
  const expected = round2(target * elapsed);
  const monthNow = Number(today.slice(5, 7));
  const monthsLeft = 12 - monthNow + 1; // this month still counts
  const gap = round2(done - expected);
  return {
    year,
    target,
    done,
    monthly: monthly.map(round2),
    monthNow,
    elapsed,
    expected,
    gap,
    status: !target ? 'none' : done >= target ? 'done' : gap >= -target * 0.03 ? (gap > target * 0.03 ? 'ahead' : 'on track') : 'behind',
    perMonth: target > done ? round2((target - done) / monthsLeft) : 0,
    monthsLeft,
  };
}

// Net worth at the end of each of the last n months (today for this month).
export function netWorthSeries(n = 12) {
  const today = todayStr();
  const thisMonth = monthKey(today);
  const { moves, valuations } = getState();
  const firstDate = [...moves.filter((m) => !m.deleted).map((m) => m.date), ...valuations.map((v) => v.date)].sort()[0];
  if (!firstDate) return [];
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const month = shiftMonth(thisMonth, -i);
    if (month < monthKey(firstDate)) continue;
    const asOf = month === thisMonth ? today : `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
    out.push({ month, value: overview(asOf).net });
  }
  return out;
}

export function goalProgress(goal) {
  const value = round2(
    (goal.holdingIds || [])
      .map(holdingById)
      .filter((h) => h && !h.deleted)
      .reduce((t, h) => t + holdingStats(h).value, 0),
  );
  const left = Math.max(0, round2(goal.target - value));
  let monthsLeft = null;
  if (goal.date) {
    const now = todayStr();
    monthsLeft =
      (Number(goal.date.slice(0, 4)) - Number(now.slice(0, 4))) * 12 +
      (Number(goal.date.slice(5, 7)) - Number(now.slice(5, 7))) +
      1;
  }
  return {
    value,
    left,
    share: goal.target > 0 ? Math.min(1, value / goal.target) : 0,
    monthsLeft,
    perMonth: monthsLeft && monthsLeft > 0 && left > 0 ? round2(left / monthsLeft) : 0,
    overdue: monthsLeft !== null && monthsLeft <= 0 && left > 0,
  };
}
