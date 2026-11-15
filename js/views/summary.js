// Summary: one clean page of the whole picture, laid out to save as a PDF.

import { getState } from '../store.js';
import { on } from '../ui.js';
import { getMonth, monthNav } from '../month.js';
import { monthSummary, GROUPS } from '../budget.js';
import { categoryTotals, glance } from '../insights.js';
import { overview, yearProgress, goalProgress } from '../wealth.js';
import { healthScore, yearToDate } from '../health.js';
import { esc, money, monthLabel } from '../util.js';

on('summary-print', () => window.print());

const pct = (p) => `${p >= 0 ? '+' : '−'}${Math.abs(p * 100).toFixed(1)}%`;

export function renderSummary() {
  const { settings, goals } = getState();
  const m = (n) => money(n, settings.currency);
  const month = getMonth();
  const s = monthSummary(month);
  const h = healthScore(month);
  const ytd = yearToDate(month);
  const o = overview();
  const y = yearProgress();
  const cats = categoryTotals(month).slice(0, 5);
  const liveGoals = goals.filter((g) => !g.deleted);
  const notes = glance(month, m);
  const kv = (k, v, cls = '') => `<div class="kv ${cls}"><span>${k}</span><span>${v}</span></div>`;
  const made = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

  return `
    <div class="no-print">
      ${monthNav()}
      <button class="btn primary" data-action="summary-print">Save as PDF</button>
      <p class="hint center" style="margin:10px 0 18px">Opens your device's print screen. Choose "Save as PDF" (on iPhone: Share, then Save to Files).</p>
    </div>

    <article class="doc">
      <header class="doc-head">
        <h2>Financial summary</h2>
        <p>${esc(monthLabel(month))} · prepared ${esc(made)}</p>
      </header>

      <section class="doc-sec score">
        <div class="score-num">${h.score ?? '–'}<small>${h.score === null ? '' : '/100'}</small></div>
        <div class="score-side">
          <strong>Financial health: ${h.label}</strong>
          ${h.parts
            .map(
              (p) => `
            <div class="score-row">
              <span>${p.name}<small>${esc(p.detail)}</small></span>
              <span class="bar ${p.score >= 0.8 ? 'good' : p.score >= 0.5 ? 'warn' : 'over'}"><span style="width:${p.score * 100}%"></span></span>
            </div>`,
            )
            .join('')}
          ${h.parts.length ? '' : '<p class="hint">Set a salary on the Budget tab and add some entries to get a score.</p>'}
        </div>
      </section>

      <section class="doc-sec">
        <h3>${esc(monthLabel(month))}</h3>
        ${kv(s.isCurrent ? 'Income earned so far' : 'Income', m(s.earned))}
        ${kv('Spent', m(s.spent))}
        ${s.salary ? kv(s.left >= 0 ? 'Left of budget' : 'Over budget', m(Math.abs(s.left))) : ''}
        ${kv('Income not spent', `${m(s.unspent)}${s.earned > 0 ? ` · ${Math.round((s.unspent / s.earned) * 100)}%` : ''}`, 'strong')}
        ${
          s.salary
            ? GROUPS.map((g) => kv(`${g.name} (${s.split[g.id]}% plan)`, `${m(s.spentBy[g.id])} of ${m(s.guide[g.id])}`, 'sub')).join('')
            : ''
        }
      </section>

      ${
        cats.length
          ? `<section class="doc-sec">
               <h3>Top spending</h3>
               ${cats.map((c) => kv(esc(c.cat?.name ?? 'Uncategorised'), `${m(c.amount)} · ${Math.round(c.share * 100)}%`)).join('')}
             </section>`
          : ''
      }

      ${
        ytd.months
          ? `<section class="doc-sec">
               <h3>${ytd.year} so far <small>${ytd.months} ${ytd.months === 1 ? 'month' : 'months'} recorded</small></h3>
               ${kv('Income', m(ytd.income))}
               ${kv('Spent', m(ytd.spent))}
               ${kv('Income not spent', m(ytd.kept), 'strong')}
               ${y.target ? kv('Put into savings and investments', `${m(y.done)} of ${m(y.target)} target`) : ''}
             </section>`
          : ''
      }

      ${
        o.rows.length
          ? `<section class="doc-sec">
               <h3>Net worth</h3>
               ${kv('Savings', m(o.savings))}
               ${kv('Investments', `${m(o.invValue)}${o.invPct === null ? '' : ` · ${pct(o.invPct)}`}`)}
               ${o.debts ? kv('Debts', `−${m(o.debts)}`) : ''}
               ${kv('Net worth', m(o.net), 'strong')}
             </section>`
          : ''
      }

      ${
        liveGoals.length
          ? `<section class="doc-sec">
               <h3>Goals</h3>
               ${liveGoals
                 .map((g) => {
                   const p = goalProgress(g);
                   return kv(esc(g.name), `${m(p.value)} of ${m(g.target)} · ${Math.round(p.share * 100)}%`);
                 })
                 .join('')}
             </section>`
          : ''
      }

      ${
        notes.length
          ? `<section class="doc-sec">
               <h3>Notes</h3>
               <ul>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
             </section>`
          : ''
      }
    </article>
  `;
}
