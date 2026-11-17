// Monthly items on screen: the "due" card on Home, and the sheets for managing
// and editing them. The rules live in ../recurring.js.

import { getState, categoriesOf, categoryById, deleteEntry } from '../store.js';
import { on, openSheet, closeSheet, toast } from '../ui.js';
import { getMonth } from '../month.js';
import {
  monthlyItems,
  monthlyItem,
  monthlyStatus,
  saveMonthly,
  removeMonthly,
  logMonthly,
  skipMonthly,
} from '../recurring.js';
import { bubble } from '../art.js';
import { esc, money, todayStr, monthKey, round2, currencySymbol, parseDate } from '../util.js';

const m = (n) => money(n, getState().settings.currency);
const dayText = (date) => parseDate(date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const num = (v) => round2(parseFloat(String(v).replace(/,/g, '').trim())) || 0;

const closeBtn = `
  <button class="icon-btn" data-action="sheet-close" aria-label="Close">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
  </button>`;

on('monthly-log', (el) => {
  const entry = logMonthly(el.dataset.id, el.dataset.month);
  if (entry) toast(`Logged ${m(entry.amount)} · ${entry.note}`, { action: 'Undo', onAction: () => deleteEntry(entry.id) });
});

on('monthly-skip', (el) => {
  const { id, month } = el.dataset;
  skipMonthly(id, month);
  toast('Skipped for this month', { action: 'Undo', onAction: () => skipMonthly(id, month, false) });
});

on('monthly-manage', () => openManage());

// The card on Home. Only items that have reached their day and are still
// waiting are listed, so Home stays short.
export function monthlyCard() {
  const month = getMonth();
  if (month > monthKey(todayStr())) return '';
  const all = monthlyStatus(month);
  const due = all.filter((s) => s.state === 'due');
  const upcoming = all.filter((s) => s.state === 'upcoming').length;
  if (!due.length) return '';
  return `
    <div class="sec-row">
      <h2 class="sec">Due this month</h2>
      <button class="link" data-action="monthly-manage">Manage</button>
    </div>
    <section class="card list">
      ${due
        .map(({ item, date }) => {
          const c = categoryById(item.categoryId);
          return `
        <div class="due-row">
          ${bubble(c)}
          <span class="entry-text">
            <span class="entry-name">${esc(item.name)}</span>
            <span class="entry-note">${esc(dayText(date))} · ${m(item.amount)}</span>
          </span>
          <button class="chip" data-action="monthly-skip" data-id="${item.id}" data-month="${month}">Skip</button>
          <button class="chip on" data-action="monthly-log" data-id="${item.id}" data-month="${month}">Log</button>
        </div>`;
        })
        .join('')}
    </section>
    ${upcoming ? `<p class="hint center" style="margin-top:8px">${upcoming} more later this month.</p>` : ''}`;
}

// How many items are waiting, for Penny and for the link on Home.
export const monthlyDueCount = () => monthlyStatus(monthKey(todayStr())).filter((s) => s.state === 'due').length;

function openManage() {
  const month = monthKey(todayStr());
  const status = new Map(monthlyStatus(month).map((s) => [s.item.id, s]));
  const items = monthlyItems();
  const label = { logged: 'Logged this month', skipped: 'Skipped this month', due: 'Due now', upcoming: 'Coming up' };

  const sheet = openSheet(`
    <div class="es-head">${closeBtn}<span>Monthly items</span><span class="icon-btn" aria-hidden="true"></span></div>
    <div class="cs-body">
      <p class="hint">Subscriptions, repayments and other bills that come round every month. Nothing is logged by itself: each one waits for you to tap Log, and you can stop one any time.</p>
      <div class="mi-list">
        ${
          items.length
            ? items
                .map((r) => {
                  const s = status.get(r.id);
                  return `
              <button class="fav-row mi-row" data-mi="${r.id}">
                <span class="fav-use">
                  ${bubble(categoryById(r.categoryId))}
                  <span class="entry-text">
                    <span class="entry-name">${esc(r.name)}</span>
                    <span class="entry-note">${r.active ? `Day ${r.day} · ${s ? label[s.state] : 'Starts later'}` : 'Stopped'}</span>
                  </span>
                  <span class="fav-amt">${m(r.amount)}</span>
                </span>
              </button>`;
                })
                .join('')
            : '<p class="hint center" style="margin:18px 0">No monthly items yet.</p>'
        }
      </div>
      <button class="btn primary mi-new" style="margin-top:14px">Add a monthly item</button>
    </div>`);

  sheet.addEventListener('click', (e) => {
    const row = e.target.closest('[data-mi]');
    if (row) return openItem(monthlyItem(row.dataset.mi));
    if (e.target.closest('.mi-new')) openItem(null);
  });
}

function openItem(item) {
  const sym = esc(currencySymbol(getState().settings.currency));
  const cats = categoriesOf('expense');
  let active = item ? item.active : true;
  let done = false;

  const sheet = openSheet(
    `
    <div class="es-head">${closeBtn}<span>${item ? 'Monthly item' : 'New monthly item'}</span><span class="icon-btn" aria-hidden="true"></span></div>
    <div class="cs-body">
      <label class="label" for="mi-name">Name</label>
      <input id="mi-name" class="field" type="text" maxlength="40" autocomplete="off" placeholder="e.g. Netflix, Car loan" value="${esc(item?.name || '')}">
      <label class="label" for="mi-amt">Amount each month (${sym})</label>
      <input id="mi-amt" class="field" type="text" inputmode="decimal" autocomplete="off" placeholder="0" value="${item?.amount || ''}">
      <label class="label" for="mi-cat">Category</label>
      <select id="mi-cat" class="select" style="width:100%;height:48px">
        ${cats.map((c) => `<option value="${c.id}" ${c.id === item?.categoryId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select>
      <label class="label" for="mi-day">Day of the month it is paid</label>
      <input id="mi-day" class="field" type="text" inputmode="numeric" maxlength="2" autocomplete="off" value="${item?.day || Number(todayStr().slice(8))}">
      ${
        item
          ? `<span class="label">Status</span>
             <div class="seg wide">
               <button data-active="1">Active</button>
               <button data-active="0">Stopped</button>
             </div>
             <p class="hint mi-hint"></p>`
          : ''
      }
      <button class="btn primary mi-save" style="margin-top:18px">${item ? 'Save' : 'Add'}</button>
      ${item ? '<button class="btn ghost danger mi-remove">Delete this item</button>' : ''}
    </div>`,
    // After saving or deleting, go back to the list.
    { onClose: () => setTimeout(() => !done || openManage(), 0) },
  );

  const $ = (s) => sheet.querySelector(s);
  const paint = () => {
    sheet.querySelectorAll('[data-active]').forEach((b) => b.classList.toggle('on', (b.dataset.active === '1') === active));
    const hint = $('.mi-hint');
    if (hint) hint.textContent = active ? 'It will come up each month for you to confirm.' : 'It will stop coming up. Entries already logged stay as they are.';
  };

  sheet.addEventListener('click', (e) => {
    const a = e.target.closest('[data-active]');
    if (a) return (active = a.dataset.active === '1'), paint();
    if (e.target.closest('.mi-save')) {
      const name = $('#mi-name').value.trim();
      const amount = num($('#mi-amt').value);
      const day = Math.max(1, Math.min(31, parseInt($('#mi-day').value, 10) || 1));
      if (!name) return $('#mi-name').classList.add('invalid'), $('#mi-name').focus();
      if (!(amount > 0)) return $('#mi-amt').classList.add('invalid'), $('#mi-amt').focus();
      saveMonthly({ ...(item ? { id: item.id } : {}), name, amount, categoryId: $('#mi-cat').value, day, active });
      done = true;
      closeSheet();
      return toast(item ? 'Monthly item updated' : `${name} added`);
    }
    if (e.target.closest('.mi-remove')) {
      const copy = { ...item };
      removeMonthly(item.id);
      done = true;
      closeSheet();
      toast(`${item.name} deleted`, { action: 'Undo', onAction: () => saveMonthly(copy) });
    }
  });
  paint();
  if (!item) $('#mi-name').focus();
}
