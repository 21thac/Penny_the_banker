// The month being viewed, shared by Home and Budget so they stay in step.

import { on, refresh } from './ui.js';
import { esc, todayStr, monthKey, monthLabel, shiftMonth } from './util.js';

let month = monthKey(todayStr());

export const getMonth = () => month;

on('month-prev', () => ((month = shiftMonth(month, -1)), refresh()));
on('month-next', () => ((month = shiftMonth(month, 1)), refresh()));
on('month-now', () => ((month = monthKey(todayStr())), refresh()));

export function monthNav() {
  const isCurrent = month === monthKey(todayStr());
  return `
    <div class="month-nav">
      <button class="icon-btn" data-action="month-prev" aria-label="Previous month">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
      </button>
      <button class="month-label" data-action="month-now" ${isCurrent ? 'disabled' : ''}>
        ${esc(monthLabel(month))}${isCurrent ? '' : '<small>Back to this month</small>'}
      </button>
      <button class="icon-btn" data-action="month-next" aria-label="Next month">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>
      </button>
    </div>`;
}
