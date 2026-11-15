// Small shared helpers: escaping, ids, dates, money.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---- Dates (all local time, stored as YYYY-MM-DD) ----

const pad = (n) => String(n).padStart(2, '0');

export const toDateStr = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const parseDate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const todayStr = () => toDateStr(new Date());

export const addDays = (s, n) => {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
};

// Monday as the first day of the week.
export const startOfWeek = (s) => {
  const d = parseDate(s);
  return addDays(s, -((d.getDay() + 6) % 7));
};

export const monthKey = (s) => s.slice(0, 7);

export const shiftMonth = (key, n) => {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

export const daysInMonth = (key) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m, 0).getDate();
};

export const monthLabel = (key) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
};

export const dayLabel = (s) => {
  const today = todayStr();
  if (s === today) return 'Today';
  if (s === addDays(today, -1)) return 'Yesterday';
  if (s === addDays(today, 1)) return 'Tomorrow';
  const d = parseDate(s);
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
};

// ---- Money ----

const fmtCache = new Map();
const fmt = (currency) => {
  if (!fmtCache.has(currency)) {
    let f;
    try {
      f = new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        currencyDisplay: 'narrowSymbol',
      });
    } catch {
      f = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });
    }
    fmtCache.set(currency, f);
  }
  return fmtCache.get(currency);
};

export const money = (n, currency) => fmt(currency).format(n || 0);

export const currencyDecimals = (currency) =>
  fmt(currency).resolvedOptions().maximumFractionDigits;

export const currencySymbol = (currency) =>
  fmt(currency)
    .formatToParts(0)
    .find((p) => p.type === 'currency')?.value ?? '';

export const round2 = (n) => Math.round(n * 100) / 100;

export const sum = (list) => round2(list.reduce((t, e) => t + e.amount, 0));
