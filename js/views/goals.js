// Goals: net worth, the yearly saving target, holdings with profit or loss,
// and named goals linked to holdings.

import {
  getState,
  addHolding,
  updateHolding,
  addMove,
  setMoveDeleted,
  setValue,
  saveGoal,
  setSetting,
} from '../store.js';
import { on, refresh, openSheet, closeSheet, toast } from '../ui.js';
import {
  KINDS,
  liveHoldings,
  holdingById,
  holdingStats,
  movesOf,
  overview,
  yearProgress,
  netWorthSeries,
  goalProgress,
} from '../wealth.js';
import { bars, trendLine, ring, ringMid } from '../charts.js';
import { monthShort } from '../insights.js';
import { esc, money, todayStr, parseDate, round2, currencySymbol } from '../util.js';

const num = (v) => round2(parseFloat(String(v).replace(/,/g, '').trim())) || 0;
const cur = () => getState().settings.currency;
const m = (n) => money(n, cur());
const signed = (n) => `${n >= 0 ? '+' : '−'}${m(Math.abs(n))}`;
const pctText = (p) => (p === null ? '' : `${p >= 0 ? '+' : '−'}${Math.abs(p * 100).toFixed(1)}%`);
const tone = (n) => (n > 0.004 ? 'up' : n < -0.004 ? 'down' : '');
const shortDate = (d) => parseDate(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const monthYear = (d) => parseDate(d).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

const closeBtn = `
  <button class="icon-btn" data-action="sheet-close" aria-label="Close">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
  </button>`;
const head = (title) =>
  `<div class="es-head">${closeBtn}<span>${esc(title)}</span><span class="icon-btn" aria-hidden="true"></span></div>`;

on('holding-new', (el) => openNewHolding(el.dataset.kind));
on('holding-open', (el) => openHolding(holdingById(el.dataset.id)));
on('goal-edit', (el) => openGoal(getState().goals.find((g) => g.id === el.dataset.id) || null));
on('target-edit', () => openTarget());

// Portfolio ring: split by type or by individual holding.
let mix = 'kind';
on('mix-mode', (el) => ((mix = el.dataset.mode), refresh()));

// Colours chosen to be easy to tell apart, in the app's muted range.
const MIX_COLORS = [
  '#B17457', '#4F7C8A', '#C9A13B', '#6F8F5E', '#8A6BA8', '#3E3D3B',
  '#D58A94', '#2F9C8F', '#8C4A2F', '#93A3B5', '#6B5A3C', '#D9793B',
];

export function renderGoals() {
  const o = overview();
  const y = yearProgress();
  const goals = getState().goals.filter((g) => !g.deleted);

  if (!o.rows.length && !goals.length && !y.target) {
    return `
      <div class="empty tall setup">
        <p class="empty-title">Track what you're building</p>
        <p class="hint">Add your savings, stocks and ETFs. Log what you put in and what they're worth, and I'll show your profit or loss, your net worth and how close you are to your goals.</p>
        <button class="btn primary" data-action="holding-new">Add your first holding</button>
      </div>`;
  }

  // ---- Portfolio: what your money is in ----
  const assets = o.rows.filter((r) => r.h.kind !== 'debt' && r.value > 0);
  const assetTotal = assets.reduce((t, r) => t + r.value, 0);
  const slices =
    mix === 'kind'
      ? KINDS.filter((k) => k.id !== 'debt')
          .map((k) => {
            const rows = assets.filter((r) => r.h.kind === k.id);
            const put = rows.reduce((t, r) => t + r.put, 0);
            const value = rows.reduce((t, r) => t + r.value, 0);
            return { name: k.name, value, put, pnl: k.id === 'savings' ? null : value - put };
          })
          .filter((x) => x.value > 0)
      : assets.map((r) => ({ name: r.h.name, value: r.value, put: r.put, pnl: r.valuedOn && r.h.kind !== 'savings' ? r.pnl : null }));
  slices.sort((a, b) => b.value - a.value).forEach((x, i) => (x.color = MIX_COLORS[i % MIX_COLORS.length]));
  const portfolio =
    assetTotal > 0
      ? `
    <div class="sec-row">
      <h2 class="sec">Portfolio</h2>
      <div class="seg small">
        <button data-action="mix-mode" data-mode="kind" class="${mix === 'kind' ? 'on' : ''}">By type</button>
        <button data-action="mix-mode" data-mode="holding" class="${mix === 'holding' ? 'on' : ''}">By holding</button>
      </div>
    </div>
    <section class="card chart">
      <div class="ring-wrap">
        ${ring(slices)}
        ${ringMid('total', m(assetTotal))}
      </div>
      <div class="cat-list">
        ${slices
          .map(
            (x) => `
          <div class="crank">
            <span class="swatch" style="background:${x.color}"></span>
            <span class="crank-main">
              <span class="crank-top">
                <span class="crank-name">${esc(x.name)}</span>
                <span>${m(x.value)}</span>
              </span>
              <span class="bar"><span style="width:${(x.value / slices[0].value) * 100}%;background:${x.color}"></span></span>
              ${
                x.pnl === null || !(x.put > 0)
                  ? ''
                  : `<span class="pnl ${tone(x.pnl)}">${signed(x.pnl)} · ${pctText(x.pnl / x.put)}</span>`
              }
            </span>
            <span class="crank-pct">${Math.round((x.value / assetTotal) * 100)}%</span>
          </div>`,
          )
          .join('')}
      </div>
    </section>`
      : '';

  // ---- This year ----
  const statusText = {
    done: `Target reached, with ${m(y.done - y.target)} to spare.`,
    ahead: `Ahead of pace by ${m(y.gap)}.`,
    'on track': 'On track for the year.',
    behind: `Behind pace by ${m(-y.gap)}. ${m(y.perMonth)} a month for the ${y.monthsLeft} ${y.monthsLeft === 1 ? 'month' : 'months'} left gets you there.`,
  }[y.status];
  const yearCard = y.target
    ? `
      <div class="prow-top">
        <span>${m(y.done)} <small>of ${m(y.target)}</small></span>
        <span class="tag ${y.status === 'behind' ? 'down' : 'up'}">${y.status === 'done' ? 'reached' : y.status}</span>
      </div>
      <div class="bar ${y.status === 'behind' ? 'warn' : 'good'}">
        <span style="width:${Math.min(100, (Math.max(0, y.done) / y.target) * 100)}%"></span>
        <i style="left:${Math.min(100, y.elapsed * 100)}%" title="Today"></i>
      </div>
      <p class="chart-cap">${statusText}</p>
      <div class="year-bars">
        ${bars(
          y.monthly.map((v, i) => ({
            value: Math.max(0, v),
            cls: i + 1 === y.monthNow ? 'today' : i + 1 > y.monthNow ? 'future' : '',
          })),
          { guide: y.target / 12, labels: y.monthly.map((_, i) => monthShort(`${y.year}-${String(i + 1).padStart(2, '0')}`).slice(0, 1)) },
        )}
      </div>
      <p class="hint">Put aside each month. The dashed line is ${m(y.target / 12)}, an even monthly share.</p>`
    : `<p class="hint">Set how much you want to save and invest in ${y.year}, and I'll pace it month by month.${
        y.done ? ` So far this year: ${m(y.done)}.` : ''
      }</p>
       <button class="btn ghost" data-action="target-edit">Set a yearly target</button>`;

  // ---- Holdings ----
  const groups = KINDS.map((k) => {
    const rows = o.rows.filter((r) => r.h.kind === k.id);
    if (!rows.length) return '';
    const total = rows.reduce((t, r) => t + r.value, 0);
    const body = rows
      .map((r) => {
        const debt = k.id === 'debt';
        const showPnl = !debt && r.put > 0 && r.valuedOn;
        return `
        <button class="hrow" data-action="holding-open" data-id="${r.h.id}">
          <span class="hrow-main">
            <span class="hrow-name">${esc(r.h.name)}</span>
            <span class="hrow-sub">${
              debt
                ? r.valuedOn ? `Balance on ${shortDate(r.valuedOn)}` : 'No balance yet'
                : `Put in ${m(r.put)}${r.valuedOn || k.id === 'savings' ? '' : ' · no value logged'}`
            }</span>
          </span>
          <span class="hrow-side">
            <span class="hrow-value">${m(r.value)}</span>
            ${showPnl ? `<span class="pnl ${tone(r.pnl)}">${signed(r.pnl)} · ${pctText(r.pct)}</span>` : ''}
          </span>
        </button>`;
      })
      .join('');
    return `
      <div class="sec-row">
        <h2 class="sec">${k.name}</h2>
        <span class="sec-side">${m(total)}</span>
      </div>
      <section class="card list">${body}</section>`;
  }).join('');

  // ---- Named goals ----
  const goalCards = goals
    .map((g) => {
      const p = goalProgress(g);
      const reached = p.left <= 0;
      const when = g.date ? monthYear(g.date) : '';
      const line = reached
        ? 'Reached.'
        : p.overdue
          ? `${m(p.left)} to go. The date has passed.`
          : g.date
            ? `${m(p.left)} to go by ${when}: ${m(p.perMonth)} a month.`
            : `${m(p.left)} to go.`;
      return `
      <button class="card goal" data-action="goal-edit" data-id="${g.id}">
        <span class="prow-top">
          <span>${esc(g.name)}</span>
          <span>${Math.round(p.share * 100)}%</span>
        </span>
        <span class="bar ${reached ? 'good' : ''}"><span style="width:${p.share * 100}%"></span></span>
        <span class="goal-sub">${m(p.value)} of ${m(g.target)}</span>
        <span class="goal-sub">${line}${(g.holdingIds || []).length ? '' : ' No holdings linked yet.'}</span>
      </button>`;
    })
    .join('');

  // ---- Net worth over time ----
  const series = netWorthSeries(12);
  const trend =
    series.length >= 2
      ? `<h2 class="sec">Net worth over time</h2>
         <section class="card chart pad">
           ${trendLine(series.map((s) => s.value))}
           <div class="bars-x spread"><span>${monthShort(series[0].month)}</span><span>${monthShort(series[series.length - 1].month)}</span></div>
           <p class="chart-cap">${signed(series[series.length - 1].value - series[0].value)} since ${monthShort(series[0].month)}.</p>
         </section>`
      : '';

  return `
    <section class="card hero">
      <span class="hero-label">Net worth</span>
      <span class="hero-value">${m(o.net)}</span>
      ${
        o.invPut > 0
          ? `<span class="hero-sub">Investments ${signed(o.invPnl)} (${pctText(o.invPct)}) on ${m(o.invPut)} put in</span>`
          : ''
      }
      <div class="stats">
        <div class="stat"><span class="stat-label">Savings</span><span class="stat-value">${m(o.savings)}</span></div>
        <div class="stat"><span class="stat-label">Investments</span><span class="stat-value">${m(o.invValue)}</span></div>
        <div class="stat"><span class="stat-label">Debts</span><span class="stat-value">${m(o.debts)}</span></div>
      </div>
    </section>

    ${portfolio}

    <div class="sec-row">
      <h2 class="sec">This year</h2>
      ${y.target ? '<button class="link" data-action="target-edit">Edit</button>' : ''}
    </div>
    <section class="card chart pad">${yearCard}</section>

    ${groups}
    <button class="btn ghost" data-action="holding-new">Add a holding</button>

    <div class="sec-row">
      <h2 class="sec">Goals</h2>
    </div>
    ${goalCards || '<p class="hint">Name something you are saving for, set an amount and a date, and link the holdings that count towards it.</p>'}
    <button class="btn ghost" data-action="goal-edit">Add a goal</button>

    ${trend}
  `;
}

// ---- Sheets ----

const kindChips = (selected) =>
  `<div class="chips kind-pick">${KINDS.map(
    (k) => `<button class="chip ${k.id === selected ? 'on' : ''}" data-kind="${k.id}">${k.one}</button>`,
  ).join('')}</div>`;

function openNewHolding(kind = 'savings') {
  let picked = KINDS.some((k) => k.id === kind) ? kind : 'savings';
  const sym = esc(currencySymbol(cur()));
  const sheet = openSheet(`
    ${head('New holding')}
    <div class="cs-body">
      <label class="label" for="h-name">Name</label>
      <input id="h-name" class="field" type="text" maxlength="40" autocomplete="off" placeholder="e.g. Maybank savings, VOO, Apple">
      <span class="label">Type</span>
      ${kindChips(picked)}
      <div class="h-asset">
        <label class="label" for="h-put">Amount you've put in so far (${sym})</label>
        <input id="h-put" class="field" type="text" inputmode="decimal" autocomplete="off" placeholder="0">
        <label class="label" for="h-val">What it's worth today (${sym})</label>
        <input id="h-val" class="field" type="text" inputmode="decimal" autocomplete="off" placeholder="Leave empty if the same">
      </div>
      <div class="h-debt" hidden>
        <label class="label" for="h-owed">Amount owed today (${sym})</label>
        <input id="h-owed" class="field" type="text" inputmode="decimal" autocomplete="off" placeholder="0">
      </div>
      <button class="btn primary h-save" style="margin-top:20px">Add holding</button>
    </div>`);
  const $ = (s) => sheet.querySelector(s);
  const paint = () => {
    sheet.querySelectorAll('[data-kind]').forEach((b) => b.classList.toggle('on', b.dataset.kind === picked));
    $('.h-asset').hidden = picked === 'debt';
    $('.h-debt').hidden = picked !== 'debt';
  };
  sheet.addEventListener('click', (e) => {
    const k = e.target.closest('[data-kind]');
    if (k) {
      picked = k.dataset.kind;
      return paint();
    }
    if (!e.target.closest('.h-save')) return;
    const name = $('#h-name').value.trim();
    if (!name) {
      $('#h-name').classList.add('invalid');
      return $('#h-name').focus();
    }
    const today = todayStr();
    const h = addHolding({ name, kind: picked });
    if (picked === 'debt') {
      setValue(h.id, num($('#h-owed').value), today);
    } else {
      const put = num($('#h-put').value);
      const val = $('#h-val').value.trim();
      if (put) addMove({ holdingId: h.id, amount: put, date: today, note: 'Starting amount', opening: true });
      if (val) setValue(h.id, num(val), today);
    }
    closeSheet();
    toast(`${name} added`);
  });
  paint();
  $('#h-name').focus();
}

function openHolding(h, tab = null) {
  if (!h) return;
  const debt = h.kind === 'debt';
  const s = holdingStats(h);
  const sym = esc(currencySymbol(cur()));
  const today = todayStr();
  let mode = tab || (debt ? 'value' : 'money');
  let direction = 1;
  let kind = h.kind;
  const history = movesOf(h.id).slice(0, 8);

  const sheet = openSheet(`
    ${head(h.name)}
    <div class="cs-body">
      <div class="h-summary">
        <span class="h-big">${m(s.value)}</span>
        ${
          debt
            ? `<span class="hint">${s.valuedOn ? `Balance on ${shortDate(s.valuedOn)}` : 'No balance logged yet'}</span>`
            : `<span class="hint">Put in ${m(s.put)}${s.valuedOn ? ` · valued ${shortDate(s.valuedOn)}` : ''}</span>
               ${s.put > 0 && s.valuedOn ? `<span class="pnl big ${tone(s.pnl)}">${signed(s.pnl)} · ${pctText(s.pct)}</span>` : ''}`
        }
      </div>

      <div class="seg wide h-tabs">
        ${debt ? '' : '<button data-mode="money">Add money</button>'}
        <button data-mode="value">${debt ? 'Update balance' : 'Update value'}</button>
        <button data-mode="edit">Edit</button>
      </div>

      <div data-pane="money" hidden>
        <div class="seg wide h-dir">
          <button data-dir="1">Put in</button>
          <button data-dir="-1">Took out</button>
        </div>
        <label class="label" for="mv-amt">Amount (${sym})</label>
        <input id="mv-amt" class="field" type="text" inputmode="decimal" autocomplete="off" placeholder="0">
        <label class="label" for="mv-date">Date</label>
        <input id="mv-date" class="field" type="date" value="${today}" max="${today}">
        <button class="btn primary mv-save" style="margin-top:18px">Save</button>
      </div>

      <div data-pane="value" hidden>
        <label class="label" for="val-amt">${debt ? 'Amount owed today' : "What it's worth today"} (${sym})</label>
        <input id="val-amt" class="field" type="text" inputmode="decimal" autocomplete="off" value="${s.value || ''}" placeholder="0">
        <p class="hint" style="margin-top:8px">${
          debt
            ? 'Type the balance from your latest statement.'
            : "Type the current market value. I'll work out your profit or loss against what you've put in."
        }</p>
        <button class="btn primary val-save" style="margin-top:18px">Update</button>
      </div>

      <div data-pane="edit" hidden>
        <label class="label" for="ed-name">Name</label>
        <input id="ed-name" class="field" type="text" maxlength="40" autocomplete="off" value="${esc(h.name)}">
        <span class="label">Type</span>
        ${kindChips(kind)}
        <button class="btn primary ed-save" style="margin-top:18px">Save</button>
        <button class="btn ghost danger ed-remove">Remove holding</button>
      </div>

      ${
        history.length
          ? `<span class="label">Recent</span>
             <div class="h-history">
               ${history
                 .map(
                   (mv) => `
                 <div class="h-move">
                   <span>${shortDate(mv.date)}${mv.note ? ` · ${esc(mv.note)}` : ''}</span>
                   <span class="pnl ${tone(mv.amount)}">${signed(mv.amount)}</span>
                   <button class="icon-btn sm" data-move="${mv.id}" aria-label="Delete this entry">
                     <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
                   </button>
                 </div>`,
                 )
                 .join('')}
             </div>`
          : ''
      }
    </div>`);

  const $ = (sel) => sheet.querySelector(sel);
  const paint = () => {
    sheet.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    sheet.querySelectorAll('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== mode));
    sheet.querySelectorAll('[data-dir]').forEach((b) => b.classList.toggle('on', Number(b.dataset.dir) === direction));
    sheet.querySelectorAll('[data-kind]').forEach((b) => b.classList.toggle('on', b.dataset.kind === kind));
  };

  sheet.addEventListener('click', (e) => {
    const t = (sel) => e.target.closest(sel);
    if (t('[data-mode]')) return (mode = t('[data-mode]').dataset.mode), paint();
    if (t('[data-dir]')) return (direction = Number(t('[data-dir]').dataset.dir)), paint();
    if (t('[data-kind]')) return (kind = t('[data-kind]').dataset.kind), paint();

    if (t('.mv-save')) {
      const amount = num($('#mv-amt').value);
      if (!(amount > 0)) return $('#mv-amt').classList.add('invalid'), $('#mv-amt').focus();
      addMove({ holdingId: h.id, amount: amount * direction, date: $('#mv-date').value || today });
      closeSheet();
      return toast(`${direction > 0 ? 'Added' : 'Took out'} ${m(amount)} · ${h.name}`);
    }
    if (t('.val-save')) {
      const raw = $('#val-amt').value.trim();
      if (!raw) return $('#val-amt').classList.add('invalid'), $('#val-amt').focus();
      setValue(h.id, num(raw), today);
      closeSheet();
      const now = holdingStats(h);
      return toast(debt || !(now.put > 0) ? `${h.name} updated` : `${h.name}: ${signed(now.pnl)} (${pctText(now.pct)})`);
    }
    if (t('.ed-save')) {
      const name = $('#ed-name').value.trim();
      if (!name) return $('#ed-name').classList.add('invalid'), $('#ed-name').focus();
      updateHolding(h.id, { name, kind });
      closeSheet();
      return toast('Holding updated');
    }
    if (t('.ed-remove')) {
      updateHolding(h.id, { deleted: true });
      closeSheet();
      return toast(`${h.name} removed`, { action: 'Undo', onAction: () => updateHolding(h.id, { deleted: false }) });
    }
    if (t('[data-move]')) {
      const id = t('[data-move]').dataset.move;
      setMoveDeleted(id, true);
      closeSheet();
      toast('Entry deleted', { action: 'Undo', onAction: () => setMoveDeleted(id, false) });
    }
  });
  paint();
}

function openGoal(goal) {
  const assets = liveHoldings().filter((h) => h.kind !== 'debt');
  const linked = new Set(goal?.holdingIds || []);
  const sym = esc(currencySymbol(cur()));
  const sheet = openSheet(`
    ${head(goal ? 'Edit goal' : 'New goal')}
    <div class="cs-body">
      <label class="label" for="g-name">Name</label>
      <input id="g-name" class="field" type="text" maxlength="40" autocomplete="off"
             placeholder="e.g. Emergency fund, House deposit" value="${esc(goal?.name || '')}">
      <label class="label" for="g-target">Target amount (${sym})</label>
      <input id="g-target" class="field" type="text" inputmode="decimal" autocomplete="off" placeholder="0" value="${goal?.target || ''}">
      <label class="label" for="g-date">Target date (optional)</label>
      <input id="g-date" class="field" type="date" value="${goal?.date || ''}">
      <span class="label">Holdings that count towards it</span>
      ${
        assets.length
          ? `<div class="checks">${assets
              .map(
                (h) => `
              <label class="check">
                <input type="checkbox" value="${h.id}" ${linked.has(h.id) ? 'checked' : ''}>
                <span>${esc(h.name)}</span>
                <small>${m(holdingStats(h).value)}</small>
              </label>`,
              )
              .join('')}</div>`
          : '<p class="hint">Add a holding first, then link it here.</p>'
      }
      <button class="btn primary g-save" style="margin-top:20px">${goal ? 'Save' : 'Add goal'}</button>
      ${goal ? '<button class="btn ghost danger g-remove">Remove goal</button>' : ''}
    </div>`);
  const $ = (s) => sheet.querySelector(s);
  sheet.addEventListener('click', (e) => {
    if (e.target.closest('.g-save')) {
      const name = $('#g-name').value.trim();
      const target = num($('#g-target').value);
      if (!name) return $('#g-name').classList.add('invalid'), $('#g-name').focus();
      if (!(target > 0)) return $('#g-target').classList.add('invalid'), $('#g-target').focus();
      saveGoal({
        ...(goal ? { id: goal.id } : {}),
        name,
        target,
        date: $('#g-date').value || '',
        holdingIds: [...sheet.querySelectorAll('.check input:checked')].map((i) => i.value),
      });
      closeSheet();
      return toast(goal ? 'Goal updated' : 'Goal added');
    }
    if (e.target.closest('.g-remove')) {
      saveGoal({ id: goal.id, deleted: true });
      closeSheet();
      toast(`${goal.name} removed`, { action: 'Undo', onAction: () => saveGoal({ id: goal.id, deleted: false }) });
    }
  });
  if (!goal) $('#g-name').focus();
}

function openTarget() {
  const y = yearProgress();
  const sheet = openSheet(`
    ${head(`${y.year} target`)}
    <div class="cs-body">
      <label class="label" for="t-amt">Save and invest this year (${esc(currencySymbol(cur()))})</label>
      <input id="t-amt" class="field" type="text" inputmode="decimal" autocomplete="off" placeholder="0" value="${y.target || ''}">
      <p class="hint t-hint" style="margin-top:8px"></p>
      <button class="btn primary t-save" style="margin-top:18px">Save target</button>
      ${y.target ? '<button class="btn ghost danger t-clear">Remove target</button>' : ''}
    </div>`);
  const $ = (s) => sheet.querySelector(s);
  const input = $('#t-amt');
  const paint = () => {
    const v = num(input.value);
    $('.t-hint').textContent = v ? `That's ${m(v / 12)} a month. You've put aside ${m(y.done)} so far this year.` : 'Counts money you put into savings and investments from now on, minus anything you take out. Starting amounts are not counted.';
  };
  input.addEventListener('input', paint);
  sheet.addEventListener('click', (e) => {
    if (e.target.closest('.t-save')) {
      const v = num(input.value);
      if (!(v > 0)) return input.classList.add('invalid'), input.focus();
      setSetting('yearTarget', v);
      closeSheet();
      return toast('Target saved');
    }
    if (e.target.closest('.t-clear')) {
      setSetting('yearTarget', 0);
      closeSheet();
      toast('Target removed');
    }
  });
  paint();
  if (!y.target) input.focus();
}
