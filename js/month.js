// The month being viewed, shared by Home, Budget, Insights and Summary so
// they stay in step. The arrows step one month; tapping the month name opens
// a picker to jump straight to any month of any year.

import { on, refresh, openSheet, closeSheet } from './ui.js';
import { liveEntries } from './store.js';
import { esc, todayStr, monthKey, monthLabel, shiftMonth } from './util.js';

let month = monthKey(todayStr());

export const getMonth = () => month;

const go = (next) => ((month = next), refresh());

on('month-prev', () => go(shiftMonth(month, -1)));
on('month-next', () => go(shiftMonth(month, 1)));
on('month-pick', () => openMonthPicker());

export function monthNav() {
  return `
    <div class="month-nav">
      <button class="icon-btn" data-action="month-prev" aria-label="Previous month">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
      </button>
      <button class="month-label" data-action="month-pick" aria-label="${esc(monthLabel(month))}. Choose another month">
        <span>${esc(monthLabel(month))}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg>
        </span>
      </button>
      <button class="icon-btn" data-action="month-next" aria-label="Next month">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>
      </button>
    </div>`;
}

function openMonthPicker() {
  const thisMonth = monthKey(todayStr());
  const used = new Set(liveEntries().map((e) => monthKey(e.date)));
  let year = Number(month.slice(0, 4));

  const sheet = openSheet(`
    <div class="es-head">
      <button class="icon-btn" data-action="sheet-close" aria-label="Close">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
      <span>Choose a month</span>
      <span class="icon-btn" aria-hidden="true"></span>
    </div>
    <div class="cs-body">
      <div class="mp-year">
        <button class="icon-btn" data-year="-1" aria-label="Previous year">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
        </button>
        <span class="mp-year-label"></span>
        <button class="icon-btn" data-year="1" aria-label="Next year">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>
        </button>
      </div>
      <div class="mp-grid"></div>
      <p class="hint center" style="margin-top:14px">A dot marks months that have entries.</p>
      <button class="btn ghost mp-now">Back to this month</button>
    </div>`);

  const grid = sheet.querySelector('.mp-grid');
  function paint() {
    sheet.querySelector('.mp-year-label').textContent = year;
    grid.innerHTML = Array.from({ length: 12 }, (_, i) => {
      const key = `${year}-${String(i + 1).padStart(2, '0')}`;
      const name = new Date(year, i, 1).toLocaleDateString(undefined, { month: 'short' });
      const cls = [key === month ? 'on' : '', key === thisMonth ? 'now' : '', used.has(key) ? 'has' : ''].join(' ');
      return `<button class="mp-month ${cls}" data-month="${key}">${esc(name)}</button>`;
    }).join('');
  }

  sheet.addEventListener('click', (e) => {
    const step = e.target.closest('[data-year]');
    if (step) {
      year += Number(step.dataset.year);
      return paint();
    }
    const pick = e.target.closest('[data-month]');
    if (pick || e.target.closest('.mp-now')) {
      closeSheet();
      go(pick ? pick.dataset.month : thisMonth);
    }
  });
  paint();
}
