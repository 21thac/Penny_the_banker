// Insights: on-device notes, three charts, and Penny's written review.

import { getState, categoryById, updateCategory } from '../store.js';
import { on, refresh, toast } from '../ui.js';
import { getMonth, monthNav } from '../month.js';
import { monthSummary } from '../budget.js';
import {
  dailyTotals,
  categoryTotals,
  monthlyTotals,
  glance,
  reviewData,
  dayName,
  monthShort,
  chartColors,
  dailyByCategory,
  monthByCategory,
} from '../insights.js';
import { ring, ringMid, runningLine, stackedBars, legend } from '../charts.js';
import { askReview, savedReview, saveReview, hasKey, AIError } from '../ai.js';
import { bubble, mascot } from '../art.js';
import { esc, money, monthLabel, round2, currencySymbol } from '../util.js';

let dayMode = 'daily'; // 'daily' | 'running'
let busy = false;
let error = '';

on('day-mode', (el) => ((dayMode = el.dataset.mode), refresh()));

// Tapping a bar shows its figure in the caption under the chart.
on('chart-pick', (el) => {
  const chart = el.closest('.chart');
  chart.querySelectorAll('.bar-col.on, .sbar.on').forEach((b) => b.classList.remove('on'));
  el.classList.add('on');
  chart.querySelector('.chart-cap').textContent = el.dataset.cap;
});

on('review-ask', async () => {
  if (busy) return;
  const month = getMonth();
  busy = true;
  error = '';
  refresh();
  try {
    saveReview(month, await askReview(reviewData(month)));
  } catch (err) {
    error = err instanceof AIError ? err.message : 'Something went wrong. Please try again.';
  } finally {
    busy = false;
    refresh();
  }
});

on('review-apply', () => {
  const saved = savedReview(getMonth());
  if (!saved) return;
  const before = saved.review.limits
    .map((l) => ({ id: l.categoryId, was: categoryById(l.categoryId)?.limit ?? null, limit: l.limit }))
    .filter((x) => categoryById(x.id));
  before.forEach((x) => updateCategory(x.id, { limit: x.limit }));
  toast(`Limits set for ${before.length} ${before.length === 1 ? 'category' : 'categories'}`, {
    action: 'Undo',
    onAction: () => before.forEach((x) => updateCategory(x.id, { limit: x.was })),
  });
});

function reviewCard(month, hasSpending, m) {
  if (!hasKey()) {
    return `
      <p class="hint">Penny can write a review of this month and recommend a limit for each category. Add an AI key (Claude, GPT or DeepSeek) in Settings to switch this on.</p>
      <button class="btn ghost" data-action="tab" data-tab="settings">Open Settings</button>`;
  }
  if (busy) {
    return `<div class="review-wait">${mascot('think')}<p class="hint">Reading your month…</p></div>`;
  }

  const saved = savedReview(month);
  const ask = (label) =>
    `<button class="btn ${saved ? 'ghost' : 'primary'}" data-action="review-ask" ${hasSpending ? '' : 'disabled'}>${label}</button>`;
  const problem = error ? `<p class="hint bad">${esc(error)}</p>` : '';

  if (!saved) {
    return `
      <p class="hint">${
        hasSpending
          ? 'Get a written review of this month: where you are overspending, and a recommended limit for each category.'
          : 'Add some entries for this month and Penny can review them.'
      }</p>
      ${problem}
      ${ask('Ask Penny for a review')}`;
  }

  const r = saved.review;
  const when = new Date(saved.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const over = r.overspending
    .map((o) => {
      const c = categoryById(o.categoryId);
      return c ? `<div class="rv-item">${bubble(c)}<span><strong>${esc(c.name)}</strong>${esc(o.note)}</span></div>` : '';
    })
    .join('');
  const limits = r.limits
    .map((l) => {
      const c = categoryById(l.categoryId);
      if (!c) return '';
      const same = c.limit > 0 && round2(c.limit) === l.limit;
      return `
        <div class="rv-limit">
          <span class="rv-name">${esc(c.name)}<small>${esc(l.reason)}</small></span>
          <span class="rv-amt">${c.limit > 0 && !same ? `<s>${m(c.limit)}</s>` : ''}${m(l.limit)}</span>
        </div>`;
    })
    .join('');
  const allApplied = r.limits.every((l) => round2(categoryById(l.categoryId)?.limit || 0) === l.limit);

  return `
    <p class="rv-head">${esc(r.headline)}</p>
    ${r.observations.map((o) => `<p class="note">${esc(o)}</p>`).join('')}
    ${over ? `<h3 class="rv-sub">Spending too much on</h3>${over}` : ''}
    ${
      limits
        ? `<h3 class="rv-sub">Recommended limits</h3>
           <div class="rv-limits">${limits}</div>
           <button class="btn primary" data-action="review-apply" ${allApplied ? 'disabled' : ''}>${
             allApplied ? 'Limits applied' : 'Apply these limits'
           }</button>`
        : ''
    }
    ${r.closing ? `<p class="hint rv-close">${esc(r.closing)}</p>` : ''}
    ${problem}
    <p class="hint rv-when">Written ${esc(when)}.</p>
    ${ask('Ask again')}`;
}

export function renderInsights() {
  const { settings } = getState();
  const m = (n) => money(n, settings.currency);
  const month = getMonth();
  const s = monthSummary(month);
  const daily = dailyTotals(month);
  const cats = categoryTotals(month);
  const hasSpending = s.spent > 0;

  // ---- At a glance ----
  const lines = glance(month, m);
  const glanceCard = lines.length
    ? `<section class="card notes">${lines.map((l) => `<p class="note">${esc(l)}</p>`).join('')}</section>`
    : '';

  // One clearly different colour per category, shared by every chart here.
  const colors = chartColors();
  const colorOf = (id) => colors.get(id) || '#8C8577';
  const nameOf = (id) => categoryById(id)?.name ?? 'Uncategorised';
  const unit = `${currencySymbol(settings.currency)} `;
  // Bar segments for a set of category totals, biggest at the bottom, plus a
  // caption listing the breakdown.
  const stack = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]);
  const parts = (map) => stack(map).map(([id, value]) => ({ value, color: colorOf(id) }));
  const breakdown = (map) =>
    stack(map)
      .slice(0, 3)
      .map(([id, v]) => `${nameOf(id)} ${m(v)}`)
      .join(', ') + (map.size > 3 ? ` and ${map.size - 3} more` : '');
  const keyFor = (ids) => legend([...new Set(ids)].map((id) => ({ name: nameOf(id), color: colorOf(id) })));

  // ---- Where the money went ----
  const top = cats[0]?.amount || 1;
  const catCard = hasSpending
    ? `
      <div class="ring-wrap">
        ${ring(cats.map((c) => ({ value: c.amount, color: colorOf(c.id) })))}
        ${ringMid('spent', m(s.spent))}
      </div>
      <div class="cat-list">
        ${cats
          .map(
            (c) => `
          <div class="crank">
            <span class="swatch" style="background:${colorOf(c.id)}"></span>
            ${bubble(c.cat)}
            <span class="crank-main">
              <span class="crank-top">
                <span class="crank-name">${esc(c.cat?.name ?? 'Uncategorised')}</span>
                <span>${m(c.amount)}</span>
              </span>
              <span class="bar"><span style="width:${(c.amount / top) * 100}%;background:${colorOf(c.id)}"></span></span>
            </span>
            <span class="crank-pct">${Math.round(c.share * 100)}%</span>
          </div>`,
          )
          .join('')}
      </div>`
    : `<p class="hint pad">Nothing spent in ${esc(monthLabel(month))} yet.</p>`;

  // ---- Day by day ----
  const upto = s.isCurrent ? s.day : s.isPast ? s.days : 0;
  const perDayBudget = s.salary ? s.budget / s.days : 0;
  let dayChart;
  let dayCap;
  if (dayMode === 'daily') {
    const byDay = dailyByCategory(month);
    dayChart =
      stackedBars(
        byDay.map((map, i) => ({
          parts: parts(map),
          cls: i + 1 === s.day && s.isCurrent ? 'today' : '',
          cap: `${dayName(month, i + 1)} · ${m(daily[i])}${map.size ? ` · ${breakdown(map)}` : ''}`,
        })),
        {
          guide: perDayBudget,
          unit,
          labels: daily.map((_, i) => ((i + 1) % 7 === 1 ? String(i + 1) : '')),
        },
      ) + keyFor(cats.map((c) => c.id));
    const avg = upto ? s.spent / upto : 0;
    dayCap = hasSpending
      ? `Average ${m(avg)} a day${perDayBudget ? `. The dashed line is ${m(perDayBudget)}, an even share of your budget.` : '.'} Tap a bar for its breakdown.`
      : 'No spending recorded yet.';
  } else {
    const cumulative = [];
    daily.slice(0, Math.max(upto, 1)).reduce((t, v) => (cumulative.push(round2(t + v)), t + v), 0);
    dayChart = runningLine(cumulative, s.days, s.salary ? s.budget : 0);
    const even = s.salary ? (s.budget * upto) / s.days : 0;
    dayCap = s.salary
      ? `${m(s.spent)} spent by day ${upto}. An even pace to your ${m(s.budget)} budget would be ${m(even)}.`
      : `${m(s.spent)} spent by day ${upto}. Set a salary on the Budget tab to see your pace line.`;
  }

  // ---- Month by month ----
  const months = monthlyTotals(month, 6).map((x) => ({ ...x, map: monthByCategory(x.month) }));
  const anyHistory = months.some((x) => x.spent > 0);
  const monthCap = (x) =>
    `${monthLabel(x.month)} · ${m(x.spent)}${x.budget ? ` of ${m(x.budget)} budget` : ''}${
      x.map.size ? ` · ${breakdown(x.map)}` : ''
    }`;
  const monthChart =
    stackedBars(
      months.map((x) => ({
        parts: parts(x.map),
        mark: x.spent ? x.budget : 0, // no budget marker on months with no entries
        cls: x.month === month ? 'today on' : '',
        cap: monthCap(x),
      })),
      { unit, labels: months.map((x) => monthShort(x.month)) },
    ) + keyFor(months.flatMap((x) => stack(x.map).map(([id]) => id)));
  const withData = months.filter((x) => x.spent > 0 && x.month !== month);
  const avgMonth = withData.length ? withData.reduce((t, x) => t + x.spent, 0) / withData.length : 0;

  return `
    ${monthNav()}

    ${glanceCard}

    <h2 class="sec">Where the money went</h2>
    <section class="card chart">${catCard}</section>

    <div class="sec-row">
      <h2 class="sec">Day by day</h2>
      <div class="seg small">
        <button data-action="day-mode" data-mode="daily" class="${dayMode === 'daily' ? 'on' : ''}">Daily</button>
        <button data-action="day-mode" data-mode="running" class="${dayMode === 'running' ? 'on' : ''}">Running</button>
      </div>
    </div>
    <section class="card chart pad">
      ${dayChart}
      <p class="chart-cap">${esc(dayCap)}</p>
    </section>

    <h2 class="sec">Month by month</h2>
    <section class="card chart pad">
      ${
        anyHistory
          ? `<div class="months">${monthChart}</div>
             <p class="chart-cap">${esc(monthCap(months[months.length - 1]))}</p>
             ${avgMonth ? `<p class="hint">Earlier months averaged ${m(avgMonth)}. The small line across a bar is that month's budget.</p>` : ''}`
          : '<p class="hint">Your monthly totals will build up here as you add entries.</p>'
      }
    </section>

    <h2 class="sec">Penny's review</h2>
    <section class="card review">${reviewCard(month, hasSpending, m)}</section>
  `;
}
