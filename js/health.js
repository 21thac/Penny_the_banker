// A simple financial health score (0–100) built from what the app knows.
// Parts with no data yet are left out and the rest are re-weighted, so the
// score never punishes something that has not been set up.

import { getState, liveEntries } from './store.js';
import { monthSummary } from './budget.js';
import { overview, yearProgress } from './wealth.js';
import { monthKey, shiftMonth, round2 } from './util.js';

const clamp = (n) => Math.max(0, Math.min(1, n));

export function healthScore(month) {
  const s = monthSummary(month);
  const o = overview();
  const y = yearProgress();
  const parts = [];

  if (s.salary) {
    // Spending against the budget, judged against how far through the month it is.
    const allowed = s.budget * (s.isCurrent ? Math.max(s.elapsed, 0.1) : 1);
    parts.push({
      name: 'Spending within budget',
      weight: 30,
      score: s.spent <= allowed ? 1 : clamp(1 - (s.spent - allowed) / (allowed || 1)),
      detail: s.left >= 0 ? 'Inside the budget' : 'Over the budget',
    });
    const rate = s.earned > 0 ? s.unspent / s.earned : 0;
    parts.push({
      name: 'Savings rate',
      weight: 30,
      score: clamp(rate / ((s.split.savings || 20) / 100)),
      detail: `${Math.round(Math.max(0, rate) * 100)}% of income earned so far unspent, aim ${s.split.savings}%`,
    });
  }

  const limited = getState().categories.filter((c) => c.type === 'expense' && !c.archived && c.limit > 0);
  if (limited.length) {
    const kept = limited.filter((c) => (s.byCat.get(c.id) || 0) <= c.limit).length;
    parts.push({
      name: 'Category limits kept',
      weight: 15,
      score: kept / limited.length,
      detail: `${kept} of ${limited.length} within limit`,
    });
  }

  if (y.target) {
    parts.push({
      name: 'Yearly saving target',
      weight: 15,
      score: y.expected > 0 ? clamp(y.done / y.expected) : 1,
      detail: y.status === 'done' ? 'Reached' : y.status === 'behind' ? 'Behind pace' : 'On pace',
    });
  }

  const assets = o.savings + o.invValue;
  if (assets > 0 || o.debts > 0) {
    parts.push({
      name: 'Debt against assets',
      weight: 10,
      score: o.debts === 0 ? 1 : clamp(1 - o.debts / (assets || 1) / 2),
      detail: o.debts === 0 ? 'No debts' : `Debts are ${Math.round((o.debts / (assets || o.debts)) * 100)}% of assets`,
    });
  }

  const weight = parts.reduce((t, p) => t + p.weight, 0);
  const score = weight ? Math.round((parts.reduce((t, p) => t + p.score * p.weight, 0) / weight) * 100) : null;
  const label =
    score === null ? 'Not enough data yet' : score >= 80 ? 'Strong' : score >= 60 ? 'Steady' : score >= 40 ? 'Needs attention' : 'Under strain';
  return { score, label, parts };
}

// Totals from the first month with entries this year up to the given month.
export function yearToDate(month) {
  const year = month.slice(0, 4);
  const first = liveEntries()
    .map((e) => monthKey(e.date))
    .filter((mk) => mk.startsWith(year) && mk <= month)
    .sort()[0];
  let income = 0;
  let spent = 0;
  let months = 0;
  for (let mk = first; mk && mk <= month; mk = shiftMonth(mk, 1)) {
    const s = monthSummary(mk);
    income += s.earned;
    spent += s.spent;
    months++;
  }
  return { year, months, income: round2(income), spent: round2(spent), kept: round2(income - spent) };
}
