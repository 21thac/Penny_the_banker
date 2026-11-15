// Budget: salary, the needs / wants / savings split, and a limit per category.

import { getState, categoryById, updateCategory, setSetting } from '../store.js';
import { on, openSheet, closeSheet, toast } from '../ui.js';
import { getMonth, monthNav } from '../month.js';
import {
  monthSummary,
  suggestLimits,
  groupOf,
  GROUPS,
  DEFAULT_SPLIT,
  setSalary,
  salaryFor,
  salaryRecords,
  removeSalaryRecord,
  START,
} from '../budget.js';
import { bubble, mascot } from '../art.js';
import { esc, money, monthLabel, round2, currencySymbol } from '../util.js';

const num = (v) => round2(parseFloat(String(v).replace(/,/g, '').trim())) || 0;
const pct = (part, whole) => (whole > 0 ? Math.min(100, (part / whole) * 100) : part > 0 ? 100 : 0);

// A progress bar. "warn" from 85% of the limit, "over" past it.
function bar(used, limit, extra = '') {
  const state = limit > 0 && used > limit ? 'over' : limit > 0 && used >= limit * 0.85 ? 'warn' : '';
  return `<div class="bar ${state} ${extra}"><span style="width:${pct(used, limit)}%"></span></div>`;
}

on('plan-edit', () => openPlanSheet());
on('limit-edit', (el) => openLimitSheet(categoryById(el.dataset.id)));
on('limits-suggest', () => {
  const suggestions = suggestLimits(getMonth());
  const before = [];
  suggestions.forEach((amount, id) => {
    const c = categoryById(id);
    if (c && !(c.limit > 0) && amount > 0) {
      before.push(id);
      updateCategory(id, { limit: amount });
    }
  });
  if (!before.length) return toast('Every category already has a limit');
  toast(`Limits added for ${before.length} ${before.length === 1 ? 'category' : 'categories'}`, {
    action: 'Undo',
    onAction: () => before.forEach((id) => updateCategory(id, { limit: null })),
  });
});

// Short, plain observations about the month. At most three.
function notes(s, cats, m) {
  const out = [];
  if (!s.isCurrent) return out;
  if (s.left < 0) out.push(['over', `You've spent ${m(-s.left)} more than this month's budget.`]);

  cats
    .filter((c) => c.limit > 0 && (s.byCat.get(c.id) || 0) > c.limit)
    .sort((a, b) => s.byCat.get(b.id) - b.limit - (s.byCat.get(a.id) - a.limit))
    .slice(0, 2)
    .forEach((c) => out.push(['over', `${c.name} is ${m(s.byCat.get(c.id) - c.limit)} over its limit.`]));

  for (const g of GROUPS) {
    if (s.spentBy[g.id] > s.guide[g.id] && s.guide[g.id] > 0) {
      out.push(['warn', `${g.name} are ${m(s.spentBy[g.id] - s.guide[g.id])} over the ${s.split[g.id]}% guide.`]);
    }
  }

  const used = s.budget > 0 ? s.spent / s.budget : 0;
  if (s.left >= 0 && used > s.elapsed + 0.1) {
    out.push([
      'warn',
      `Spending is ahead of the calendar: ${Math.round(used * 100)}% of the budget is used with ${s.daysLeft} ${s.daysLeft === 1 ? 'day' : 'days'} left.`,
    ]);
  }

  cats
    .filter((c) => c.limit > 0)
    .map((c) => ({ c, spent: s.byCat.get(c.id) || 0 }))
    .filter(({ c, spent }) => spent >= c.limit * 0.85 && spent <= c.limit)
    .slice(0, 1)
    .forEach(({ c, spent }) => out.push(['warn', `${c.name} has ${m(c.limit - spent)} left for the month.`]));

  for (const g of GROUPS) {
    const allocated = cats.filter((c) => groupOf(c) === g.id && c.limit > 0).reduce((t, c) => t + c.limit, 0);
    if (allocated > s.guide[g.id] + 0.5) {
      out.push(['warn', `Your ${g.name.toLowerCase()} limits add up to ${m(allocated - s.guide[g.id])} more than the guide.`]);
    }
  }

  if (!out.length && s.spent > 0) {
    out.push(['good', `On track. About ${m(s.perDay)} a day keeps you inside the budget.`]);
  }
  return out.slice(0, 3);
}

export function renderBudget() {
  const { settings, categories } = getState();
  const m = (n) => money(n, settings.currency);
  const month = getMonth();
  const s = monthSummary(month);

  if (!s.salary) {
    return `
      <div class="empty tall setup">
        ${mascot()}
        <p class="empty-title">Let's plan your month</p>
        <p class="hint">Tell me your monthly salary and I'll split it into needs, wants and savings, then track your spending against it.</p>
        <button class="btn primary" data-action="plan-edit">Set up budget</button>
      </div>`;
  }

  const cats = categories.filter(
    (c) => c.type === 'expense' && (!c.archived || (s.byCat.get(c.id) || 0) > 0),
  );

  // ---- Summary card ----
  const over = s.left < 0;
  const heroLabel = over ? 'Over budget by' : s.isCurrent ? 'Left to spend' : s.isPast ? 'Left over' : 'Budget';
  const third = s.isCurrent
    ? `<div class="stat"><span class="stat-label">Per day</span><span class="stat-value">${m(s.perDay)}</span></div>`
    : `<div class="stat"><span class="stat-label">Income</span><span class="stat-value">${m(s.income)}</span></div>`;

  const noteList = notes(s, cats, m);

  // ---- The split ----
  const saveLabel = s.isPast ? 'Income you did not spend that month.' : `Of the ${m(s.earned)} earned so far this month, what is not spent.`;
  const planRows = [
    ...GROUPS.map(
      (g) => `
      <div class="prow">
        <div class="prow-top">
          <span>${g.name} <small>${s.split[g.id]}%</small></span>
          <span>${m(s.spentBy[g.id])} <small>of ${m(s.guide[g.id])}</small></span>
        </div>
        ${bar(s.spentBy[g.id], s.guide[g.id])}
      </div>`,
    ),
    `<div class="prow">
       <div class="prow-top">
         <span>Savings <small>${s.split.savings}%</small></span>
         <span>${m(Math.max(0, s.unspent))} <small>of ${m(s.guide.savings)}</small></span>
       </div>
       <div class="bar good"><span style="width:${pct(Math.max(0, s.unspent), s.guide.savings)}%"></span></div>
       <p class="prow-note">${saveLabel}</p>
     </div>`,
  ].join('');

  // ---- Category limits ----
  const groups = GROUPS.map((g) => {
    const members = cats.filter((c) => groupOf(c) === g.id);
    if (!members.length) return '';
    const rows = members
      .map((c) => {
        const spent = s.byCat.get(c.id) || 0;
        const has = c.limit > 0;
        const diff = has ? round2(c.limit - spent) : 0;
        return `
        <button class="brow" data-action="limit-edit" data-id="${c.id}">
          ${bubble(c)}
          <span class="brow-main">
            <span class="brow-top">
              <span class="brow-name">${esc(c.name)}</span>
              <span class="brow-amt ${has && diff < 0 ? 'over' : ''}">${
                has ? (diff >= 0 ? `${m(diff)} left` : `${m(-diff)} over`) : 'Set limit'
              }</span>
            </span>
            ${has ? bar(spent, c.limit) : ''}
            <span class="brow-sub">${has ? `${m(spent)} of ${m(c.limit)}` : `${m(spent)} spent`}</span>
            ${c.remark ? `<span class="brow-remark">${esc(c.remark)}</span>` : ''}
          </span>
        </button>`;
      })
      .join('');
    return `
      <div class="sec-row">
        <h2 class="sec">${g.name}</h2>
        <span class="sec-side">${m(s.spentBy[g.id])} of ${m(s.guide[g.id])}</span>
      </div>
      <section class="card list">${rows}</section>`;
  }).join('');

  const missing = cats.some((c) => !c.archived && !(c.limit > 0));

  return `
    ${monthNav()}

    <section class="card hero">
      <span class="hero-label">${heroLabel}</span>
      <span class="hero-value">${m(Math.abs(s.left))}</span>
      <div class="bar on-dark ${over ? 'over' : ''}">
        <span style="width:${pct(s.spent, s.budget)}%"></span>
        ${s.isCurrent ? `<i style="left:${Math.min(100, s.elapsed * 100)}%" title="Today"></i>` : ''}
      </div>
      <div class="bar-caption">
        <span>${Math.round(s.budget > 0 ? (s.spent / s.budget) * 100 : 0)}% used</span>
        ${s.isCurrent ? `<span>${s.daysLeft} ${s.daysLeft === 1 ? 'day' : 'days'} left</span>` : ''}
      </div>
      <div class="stats">
        <div class="stat"><span class="stat-label">Budget</span><span class="stat-value">${m(s.budget)}</span></div>
        <div class="stat"><span class="stat-label">Spent</span><span class="stat-value">${m(s.spent)}</span></div>
        ${third}
      </div>
    </section>

    ${
      noteList.length
        ? `<section class="card notes">${noteList.map(([kind, text]) => `<p class="note ${kind}">${esc(text)}</p>`).join('')}</section>`
        : ''
    }

    <div class="sec-row">
      <h2 class="sec">The plan</h2>
      <button class="link" data-action="plan-edit">Edit</button>
    </div>
    <section class="card plan">
      <div class="prow-top income">
        <span>Income</span>
        <span>${m(s.income)}${s.extras ? ` <small>incl. ${m(s.extras)} extra</small>` : ''}</span>
      </div>
      ${planRows}
    </section>

    ${groups}

    ${missing ? '<button class="btn ghost" data-action="limits-suggest">Suggest limits for me</button>' : ''}
    <p class="hint center">Tap a category to set its limit, add a remark, or move it between needs and wants.</p>
  `;
}

// ---- Salary and split ----

function openPlanSheet() {
  const { settings } = getState();
  // The salary shown and changed is the one for the month being looked at.
  const month = getMonth();
  const current = salaryFor(month);
  const records = salaryRecords();
  let scope = 'from';
  // Short month names keep the buttons and the history on one line each.
  const shortMonth = (mk) => {
    const [y, mo] = mk.split('-').map(Number);
    return new Date(y, mo - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  };
  const fromLabel = (from) => (from === START ? 'From the start' : `From ${shortMonth(from)}`);
  const draft = { ...DEFAULT_SPLIT, ...settings.split };
  const sym = esc(currencySymbol(settings.currency));

  const sheet = openSheet(`
    <div class="es-head">
      <button class="icon-btn" data-action="sheet-close" aria-label="Close">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
      <span>Your plan</span>
      <span class="icon-btn" aria-hidden="true"></span>
    </div>
    <div class="cs-body">
      <label class="label" for="plan-salary">Monthly salary, take-home (${sym})</label>
      <input id="plan-salary" class="field" type="text" inputmode="decimal" autocomplete="off"
             placeholder="0" value="${current || ''}">
      ${
        current
          ? `<span class="label">Apply a change to</span>
             <div class="seg wide plan-scope">
               <button data-scope="from">From ${esc(shortMonth(month))}</button>
               <button data-scope="all">Every month</button>
             </div>
             <p class="hint scope-hint"></p>`
          : ''
      }
      ${
        records.length > 1
          ? `<span class="label">Salary history</span>
             <div class="h-history">
               ${records
                 .map(
                   (r) => `
                 <div class="h-move">
                   <span>${esc(fromLabel(r.from))}</span>
                   <span>${money(r.amount, settings.currency)}</span>
                   <button class="icon-btn sm" data-salary-del="${r.from}" aria-label="Remove this salary record">
                     <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
                   </button>
                 </div>`,
                 )
                 .join('')}
             </div>`
          : ''
      }

      <div class="sec-row tight">
        <span class="label">How to split it</span>
        <button class="link plan-reset">Use 50 / 30 / 20</button>
      </div>
      ${[
        ['needs', 'Needs', 'Rent, bills, food, transport'],
        ['wants', 'Wants', 'Shopping, fun, eating out'],
        ['savings', 'Savings', 'Kept aside or invested'],
      ]
        .map(
          ([key, name, hint]) => `
        <div class="split-row">
          <span class="split-name">${name}<small>${hint}</small></span>
          <span class="split-amt" data-amt="${key}"></span>
          <span class="split-pct">
            <input class="field" type="text" inputmode="numeric" maxlength="3" data-split="${key}"
                   value="${draft[key]}" aria-label="${name} percent"><span>%</span>
          </span>
        </div>`,
        )
        .join('')}
      <p class="hint plan-total"></p>

      <button class="btn primary plan-save">Save plan</button>
    </div>
  `);

  const $ = (sel) => sheet.querySelector(sel);
  const salaryInput = $('#plan-salary');
  const totalEl = $('.plan-total');
  const m = (n) => money(n, settings.currency);

  function paint() {
    const salary = num(salaryInput.value);
    const total = draft.needs + draft.wants + draft.savings;
    ['needs', 'wants', 'savings'].forEach((k) => {
      $(`[data-amt="${k}"]`).textContent = salary ? m((salary * draft[k]) / 100) : '';
    });
    const ok = total === 100;
    totalEl.textContent = ok ? 'Adds up to 100%.' : `Adds up to ${total}%. It needs to total 100%.`;
    totalEl.classList.toggle('bad', !ok);
    sheet.querySelectorAll('[data-scope]').forEach((b) => b.classList.toggle('on', b.dataset.scope === scope));
    const hint = $('.scope-hint');
    if (hint) {
      hint.textContent =
        scope === 'from'
          ? `Earlier months keep the salary they had.`
          : 'Sets this salary for every month and clears the history below.';
    }
    return ok;
  }

  sheet.addEventListener('click', (e) => {
    const s = e.target.closest('[data-scope]');
    if (s) {
      scope = s.dataset.scope;
      return paint();
    }
    const del = e.target.closest('[data-salary-del]');
    if (del) {
      removeSalaryRecord(del.dataset.salaryDel);
      closeSheet();
      toast('Salary record removed');
      openPlanSheet();
    }
  });

  sheet.addEventListener('input', (e) => {
    const key = e.target.dataset.split;
    if (key) draft[key] = Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0));
    paint();
  });

  $('.plan-reset').addEventListener('click', () => {
    Object.assign(draft, DEFAULT_SPLIT);
    sheet.querySelectorAll('[data-split]').forEach((i) => (i.value = draft[i.dataset.split]));
    paint();
  });

  $('.plan-save').addEventListener('click', () => {
    const salary = num(salaryInput.value);
    if (!(salary > 0)) {
      salaryInput.classList.add('invalid');
      salaryInput.focus();
      return;
    }
    if (!paint()) return;
    setSetting('split', { needs: draft.needs, wants: draft.wants, savings: draft.savings });
    if (salary !== current || (scope === 'all' && records.length > 1)) setSalary(salary, month, scope);
    closeSheet();
    toast('Plan saved');
  });

  salaryInput.addEventListener('input', () => salaryInput.classList.remove('invalid'));
  paint();
  if (!current) salaryInput.focus();
}

// ---- One category's limit ----

function openLimitSheet(cat) {
  if (!cat) return;
  const { settings } = getState();
  const m = (n) => money(n, settings.currency);
  const month = getMonth();
  const spent = monthSummary(month).byCat.get(cat.id) || 0;
  const suggestion = suggestLimits(month).get(cat.id) || 0;
  let group = groupOf(cat);

  const sheet = openSheet(`
    <div class="es-head">
      <button class="icon-btn" data-action="sheet-close" aria-label="Close">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
      <span>${esc(cat.name)}</span>
      <span class="icon-btn" aria-hidden="true"></span>
    </div>
    <div class="cs-body">
      <div class="cs-preview">
        ${bubble(cat, 'lg')}
        <span class="hint">${m(spent)} spent in ${esc(monthLabel(month))}</span>
      </div>

      <label class="label" for="limit-amt">Monthly limit (${esc(currencySymbol(settings.currency))})</label>
      <input id="limit-amt" class="field" type="text" inputmode="decimal" autocomplete="off"
             placeholder="No limit" value="${cat.limit > 0 ? cat.limit : ''}">
      ${suggestion ? `<div class="chips" style="margin-top:10px"><button class="chip limit-use">Use suggestion: ${m(suggestion)}</button></div>` : ''}

      <label class="label" for="limit-remark">Remark</label>
      <textarea id="limit-remark" class="field area" rows="3" maxlength="400"
                placeholder="What this covers each month, e.g. Rent 1,200 · Internet 120 · Phone 58">${esc(cat.remark || '')}</textarea>

      <span class="label">Counts as</span>
      <div class="seg wide">
        ${GROUPS.map((g) => `<button data-group="${g.id}">${g.name.replace(/s$/, '')}</button>`).join('')}
      </div>
      <p class="hint limit-hint"></p>

      <button class="btn primary limit-save" style="margin-top:18px">Save</button>
      ${cat.limit > 0 ? '<button class="btn ghost danger limit-clear">Remove limit</button>' : ''}
    </div>
  `);

  const $ = (sel) => sheet.querySelector(sel);
  const input = $('#limit-amt');
  const remark = () => $('#limit-remark').value.trim();

  function paint() {
    sheet.querySelectorAll('[data-group]').forEach((b) => b.classList.toggle('on', b.dataset.group === group));
    $('.limit-hint').textContent = GROUPS.find((g) => g.id === group).hint + '.';
  }

  sheet.addEventListener('click', (e) => {
    const g = e.target.closest('[data-group]');
    if (g) {
      group = g.dataset.group;
      return paint();
    }
    if (e.target.closest('.limit-use')) {
      input.value = suggestion;
      return;
    }
    if (e.target.closest('.limit-save')) {
      const limit = num(input.value);
      updateCategory(cat.id, { limit: limit > 0 ? limit : null, group, remark: remark() });
      closeSheet();
      toast(limit > 0 ? `${cat.name} limit set to ${m(limit)}` : `${cat.name} updated`);
      return;
    }
    if (e.target.closest('.limit-clear')) {
      updateCategory(cat.id, { limit: null, group, remark: remark() });
      closeSheet();
      toast(`${cat.name} limit removed`);
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('.limit-save').click();
  });
  paint();
}
