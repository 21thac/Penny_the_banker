// Small hand-drawn charts as HTML / SVG strings. Everything is computed from
// the values passed in, so a chart always shows the real data.

import { esc } from './util.js';

const pct = (v, max) => (max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0);

// A ring split into coloured arcs. parts: [{ value, color }]
export function ring(parts) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const total = parts.reduce((t, p) => t + p.value, 0);
  const gap = parts.length > 1 ? 1.6 : 0;
  let offset = 0;
  const arcs = total
    ? parts
        .map((p) => {
          const len = (p.value / total) * c;
          const arc = `<circle cx="60" cy="60" r="${r}" stroke="${esc(p.color)}" stroke-linecap="butt"
            stroke-dasharray="${Math.max(0.5, len - gap).toFixed(2)} ${c.toFixed(2)}"
            stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 60 60)"/>`;
          offset += len;
          return arc;
        })
        .join('')
    : `<circle cx="60" cy="60" r="${r}" stroke="var(--fill)"/>`;
  return `<svg class="ring" viewBox="0 0 120 120" aria-hidden="true">${arcs}</svg>`;
}

// Vertical bars. cols: [{ value, cls, cap }]. With pick: true each bar is a
// button that shows its caption when tapped.
export function bars(cols, { guide = 0, pick = false, labels = null } = {}) {
  const max = Math.max(guide, ...cols.map((c) => c.value), 0) || 1;
  const tag = pick ? 'button' : 'span';
  const body = cols
    .map(
      (c) => `<${tag} class="bar-col ${c.cls || ''} ${c.value ? '' : 'zero'}" style="--h:${pct(c.value, max).toFixed(1)}%"
        ${pick ? `data-action="chart-pick" data-cap="${esc(c.cap)}" aria-label="${esc(c.cap)}"` : ''}>${
          c.mark ? `<b style="bottom:${pct(c.mark, max).toFixed(1)}%"></b>` : ''
        }<i></i></${tag}>`,
    )
    .join('');
  return `
    <div class="bars">
      ${guide ? `<span class="bars-guide" style="bottom:${pct(guide, max).toFixed(1)}%"></span>` : ''}
      ${body}
    </div>
    ${labels ? `<div class="bars-x">${labels.map((l) => `<span>${esc(l)}</span>`).join('')}</div>` : ''}`;
}

// Running total against an even pace to the budget. cumulative: one value per
// day up to the last day with data; days: length of the month.
export function runningLine(cumulative, days, budget) {
  const top = Math.max(budget, cumulative[cumulative.length - 1] || 0, 1) * 1.06;
  const x = (d) => ((d / days) * 100).toFixed(2);
  const y = (v) => (100 - (v / top) * 100).toFixed(2);
  const pts = [[0, 0], ...cumulative.map((v, i) => [i + 1, v])];
  const line = pts.map(([d, v], i) => `${i ? 'L' : 'M'}${x(d)} ${y(v)}`).join('');
  const area = `${line}L${x(pts[pts.length - 1][0])} 100L0 100z`;
  return `
    <div class="line-chart">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path class="lc-area" d="${area}"/>
        ${budget ? `<path class="lc-pace" d="M0 100L100 ${y(budget)}"/>` : ''}
        <path class="lc-line" d="${line}"/>
      </svg>
    </div>`;
}

// A simple trend line through the given values, scaled to their own range.
export function trendLine(values) {
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const span = max - min || 1;
  const x = (i) => (values.length > 1 ? (i / (values.length - 1)) * 100 : 50).toFixed(2);
  const y = (v) => (96 - ((v - min) / span) * 92).toFixed(2);
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i)} ${y(v)}`).join('');
  return `
    <div class="line-chart">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path class="lc-area" d="${line}L100 100L0 100z"/>
        <path class="lc-line" d="${line}"/>
      </svg>
    </div>`;
}

// A round number at or above v, for the top of a chart's scale.
function niceMax(v) {
  if (!(v > 0)) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((s) => s * pow).find((s) => s >= v);
}

const axisLabel = (n) =>
  n >= 1000 ? `${parseFloat((n / 1000).toFixed(2))}k` : String(Math.round(n * 10) / 10);

// Stacked bars with an amount scale down the left side.
// cols: [{ parts: [{ value, color }], cap, cls, mark }]
export function stackedBars(cols, { guide = 0, labels = null, unit = '' } = {}) {
  const totals = cols.map((c) => c.parts.reduce((t, p) => t + p.value, 0));
  const top = niceMax(Math.max(guide, ...totals, ...cols.map((c) => c.mark || 0)));
  const ticks = [top, top / 2, 0];
  const body = cols
    .map((c, i) => {
      const segs = c.parts
        .filter((p) => p.value > 0)
        .map((p) => `<i style="height:${pct(p.value, top).toFixed(2)}%;background:${esc(p.color)}"></i>`)
        .join('');
      return `<button class="sbar ${c.cls || ''} ${totals[i] ? '' : 'zero'}" data-action="chart-pick"
                data-cap="${esc(c.cap)}" aria-label="${esc(c.cap)}">${
                  c.mark ? `<b style="bottom:${pct(c.mark, top).toFixed(1)}%"></b>` : ''
                }<span class="sbar-stack">${segs}</span></button>`;
    })
    .join('');
  return `
    <div class="sbars">
      <div class="sbars-axis">${ticks.map((t) => `<span>${t ? unit : ''}${axisLabel(t)}</span>`).join('')}</div>
      <div class="sbars-plot">
        <span class="sbars-grid" style="bottom:100%"></span>
        <span class="sbars-grid" style="bottom:50%"></span>
        ${guide ? `<span class="bars-guide" style="bottom:${pct(guide, top).toFixed(1)}%"></span>` : ''}
        ${body}
      </div>
    </div>
    ${labels ? `<div class="bars-x sbars-x">${labels.map((l) => `<span>${esc(l)}</span>`).join('')}</div>` : ''}`;
}

// The key for a stacked chart. items: [{ name, color }]
export const legend = (items) =>
  `<div class="legend">${items
    .map((i) => `<span><i style="background:${esc(i.color)}"></i>${esc(i.name)}</span>`)
    .join('')}</div>`;

// The label in the middle of a ring. The amount shrinks to fit the hole, so
// long figures never touch the ring.
export const ringMid = (label, amount) =>
  `<div class="ring-mid" style="--len:${String(amount).length}"><small>${esc(label)}</small><span>${esc(amount)}</span></div>`;
