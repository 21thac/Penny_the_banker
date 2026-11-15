// Home: month totals and the list of entries grouped by day.
// The full set of charts is on the Insights tab.

import { getState, liveEntries, categoryById } from '../store.js';
import { on } from '../ui.js';
import { getMonth, monthNav } from '../month.js';
import { monthSummary } from '../budget.js';
import { dailyTotals } from '../insights.js';
import { bars } from '../charts.js';
import { openEntrySheet } from './add.js';
import { bubble } from '../art.js';
import {
  esc,
  todayStr,
  monthKey,
  monthLabel,
  daysInMonth,
  startOfWeek,
  dayLabel,
  money,
  sum,
} from '../util.js';

on('entry-edit', (el) => {
  const entry = getState().entries.find((e) => e.id === el.dataset.id);
  if (entry) openEntrySheet(entry);
});

const stat = (label, value) =>
  `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value">${value}</span></div>`;

function entryRow(e, currency) {
  const c = categoryById(e.categoryId);
  const name = c ? c.name : 'Uncategorised';
  const income = e.type === 'income';
  return `
    <button class="entry" data-action="entry-edit" data-id="${e.id}">
      ${bubble(c)}
      <span class="entry-text">
        <span class="entry-name">${esc(name)}</span>
        ${e.note ? `<span class="entry-note">${esc(e.note)}</span>` : ''}
      </span>
      ${
        e.photoId
          ? '<svg class="entry-clip" viewBox="0 0 24 24" aria-label="Has a photo"><rect x="4" y="6" width="16" height="13" rx="3"/><circle cx="12" cy="12.5" r="3"/><path d="M9 6l1.5-2h3L15 6"/></svg>'
          : ''
      }
      <span class="entry-amt ${income ? 'income' : ''}">${income ? '+' : ''}${money(e.amount, currency)}</span>
    </button>`;
}

export function renderHome() {
  const currency = getState().settings.currency;
  const m = (n) => money(n, currency);
  const month = getMonth();
  const today = todayStr();
  const thisMonth = monthKey(today);
  const isCurrent = month === thisMonth;

  const all = liveEntries();
  const inMonth = all.filter((e) => monthKey(e.date) === month);
  const expenses = inMonth.filter((e) => e.type === 'expense');
  const spent = sum(expenses);
  const extraIncome = sum(inMonth.filter((e) => e.type === 'income'));

  // Daily average over the days that have actually passed.
  const daysSoFar = isCurrent
    ? Number(today.slice(8))
    : month < thisMonth
      ? daysInMonth(month)
      : 0;
  const perDay = daysSoFar ? spent / daysSoFar : 0;

  let stats;
  if (isCurrent) {
    const weekStart = startOfWeek(today);
    const allExpenses = all.filter((e) => e.type === 'expense');
    stats =
      stat('Today', m(sum(allExpenses.filter((e) => e.date === today)))) +
      stat('This week', m(sum(allExpenses.filter((e) => e.date >= weekStart && e.date <= today)))) +
      stat('Daily avg', m(perDay));
  } else {
    stats =
      stat('Entries', inMonth.length) +
      stat('Daily avg', m(perDay)) +
      stat('Extra income', m(extraIncome));
  }

  // Home lists only today: the five most recent entries. Everything else is
  // on the All entries screen.
  const SHOW = 5;
  const todays = all.filter((e) => e.date === today).sort((a, b) => b.createdAt - a.createdAt);
  const todaySpent = sum(todays.filter((e) => e.type === 'expense'));
  const seeAll = (label) => `<button class="link see-all" data-action="tab" data-tab="entries">${label}</button>`;

  let list;
  if (!isCurrent) {
    list = `<div class="empty">
         <p class="hint">${inMonth.length} ${inMonth.length === 1 ? 'entry' : 'entries'} in ${esc(monthLabel(month))}.</p>
         ${inMonth.length ? seeAll('See them all') : ''}
       </div>`;
  } else if (!todays.length) {
    list = `<section class="card remind">
         <div>
           <p class="remind-title">Nothing recorded today yet</p>
           <p class="hint">Spent anything? Add it now while you remember.</p>
           <button class="btn primary" data-action="add">Add an entry</button>
         </div>
       </section>
       ${all.length ? seeAll('See earlier entries') : ''}`;
  } else {
    list = `<section class="day">
         <header class="day-head">
           <span>Today</span>
           <span>${todaySpent ? m(todaySpent) : ''}</span>
         </header>
         <div class="card list">${todays.slice(0, SHOW).map((e) => entryRow(e, currency)).join('')}</div>
       </section>
       ${seeAll(todays.length > SHOW ? `See all ${todays.length} from today and earlier` : 'See all entries')}`;
  }

  // Budget progress, once a salary has been set on the Budget screen.
  const b = monthSummary(month);
  const budgetLine = b.salary
    ? `<div class="bar on-dark ${b.left < 0 ? 'over' : ''}" role="img"
            aria-label="${Math.round((b.spent / (b.budget || 1)) * 100)}% of budget used">
         <span style="width:${Math.min(100, (b.spent / (b.budget || 1)) * 100)}%"></span>
       </div>
       <span class="hero-sub">${
         b.left >= 0 ? `${m(b.left)} left of ${m(b.budget)}` : `${m(-b.left)} over the ${m(b.budget)} budget`
       }</span>`
    : '';

  // Compact day-by-day chart.
  const daily = dailyTotals(month);
  const dayNow = isCurrent ? Number(today.slice(8)) : 0;
  const miniChart = spent
    ? `<button class="card mini-chart" data-action="tab" data-tab="insights" aria-label="Day by day spending. Open Insights.">
         <span class="mini-head"><span>Day by day</span><span>${m(perDay)} a day</span></span>
         ${bars(
           daily.map((v, i) => ({
             value: v,
             cls: i + 1 === dayNow ? 'today' : isCurrent && i + 1 > dayNow ? 'future' : '',
           })),
         )}
       </button>`
    : '';

  return `
    ${monthNav()}

    <section class="card hero">
      <span class="hero-label">${isCurrent ? 'Spent this month' : 'Spent'}</span>
      <span class="hero-value">${m(spent)}</span>
      ${isCurrent && extraIncome ? `<span class="hero-sub">+${m(extraIncome)} extra income</span>` : ''}
      ${budgetLine}
      <div class="stats">${stats}</div>
    </section>

    ${miniChart}

    ${list}
  `;
}

// All entries for the month being viewed, grouped by day, newest first.
export function renderEntries() {
  const currency = getState().settings.currency;
  const m = (n) => money(n, currency);
  const month = getMonth();
  const inMonth = liveEntries().filter((e) => monthKey(e.date) === month);

  const byDay = new Map();
  [...inMonth]
    .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1))
    .forEach((e) => {
      if (!byDay.has(e.date)) byDay.set(e.date, []);
      byDay.get(e.date).push(e);
    });

  const list = byDay.size
    ? [...byDay.entries()]
        .map(([date, items]) => {
          const dayTotal = sum(items.filter((e) => e.type === 'expense'));
          return `
          <section class="day">
            <header class="day-head">
              <span>${esc(dayLabel(date))}</span>
              <span>${dayTotal ? m(dayTotal) : ''}</span>
            </header>
            <div class="card list">${items.map((e) => entryRow(e, currency)).join('')}</div>
          </section>`;
        })
        .join('')
    : `<div class="empty">
         <p class="empty-title">Nothing in ${esc(monthLabel(month))}</p>
         <p class="hint">Use the arrows to look at another month.</p>
       </div>`;

  return `${monthNav()}${list}`;
}
