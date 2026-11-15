// Penny's little moments: a waddle and a speech bubble with something useful
// or friendly to say. Lines are picked for the screen you are on and, where
// possible, from your own numbers.

import { getState, liveEntries } from './store.js';
import { monthSummary } from './budget.js';
import { overview, yearProgress } from './wealth.js';
import { todayStr, monthKey, money } from './util.js';

const m = (n) => money(n, getState().settings.currency);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// Each entry is a string, or a function returning a string (or null to skip).
const LINES = {
  home: [
    () => {
      const n = liveEntries().filter((e) => e.date === todayStr()).length;
      return n ? `${n} ${n === 1 ? 'entry' : 'entries'} today. Tidy!` : 'Nothing logged today yet. Spent anything?';
    },
    () => {
      const s = monthSummary(monthKey(todayStr()));
      return s.salary && s.left > 0 ? `${m(s.perDay)} a day keeps you on budget.` : null;
    },
    'Small spends add up. Log the little ones too!',
    'Double-tap + and just tell me what you spent.',
  ],
  budget: [
    () => {
      const s = monthSummary(monthKey(todayStr()));
      if (!s.salary) return 'Tell me your salary and I’ll plan the month.';
      return s.left >= 0 ? `${m(s.left)} left this month. You’ve got this.` : `Over by ${m(-s.left)}. Easy does it for a bit.`;
    },
    'A budget is just telling your money where to go.',
    'Needs first, wants second, savings always.',
    'Pay yourself first: move savings on payday.',
  ],
  insights: [
    'The tallest bar usually has a story.',
    'Tap any bar to see what was in it.',
    'Spot one habit to trim, not ten.',
    () => {
      const s = monthSummary(monthKey(todayStr()));
      return s.spent ? `Wants are ${Math.round((s.spentBy.wants / s.spent) * 100)}% of spending so far.` : null;
    },
  ],
  goals: [
    () => {
      const y = yearProgress();
      if (!y.target) return 'Set a yearly target and I’ll pace it for you.';
      return y.status === 'behind' ? `${m(y.perMonth)} a month gets the target back on track.` : 'Your yearly target is on pace. Lovely.';
    },
    () => {
      const o = overview();
      return o.rows.length ? `Net worth: ${m(o.net)}. Brick by brick.` : null;
    },
    'Time in the market beats timing the market.',
    'Update a value now and then; I’ll do the sums.',
  ],
  any: [
    'Saving a little, often, beats saving a lot, rarely.',
    'Future you says thanks.',
    'An emergency fund is a calm fund.',
    'Waddle, waddle. Just checking in!',
    'Every ringgit has a job.',
    'Proud of you for keeping track.',
  ],
  saved: ['Noted!', 'Got it, thanks!', 'Written down.', 'Logged. Nice one!', 'Tracked!'],
};

let hideTimer = null;
let lastSpoke = 0;

const els = () => ({ bubble: document.getElementById('say'), helper: document.getElementById('helper') });

export function hush() {
  const { bubble } = els();
  clearTimeout(hideTimer);
  bubble.classList.remove('show');
}

// Show a line in the bubble and give Penny a little waddle.
export function say(text, ms = 4200) {
  if (!text || document.body.classList.contains('sheet-open')) return;
  const { bubble, helper } = els();
  bubble.textContent = text;
  bubble.classList.remove('show');
  helper.classList.remove('wave');
  void bubble.offsetWidth; // restart the animations
  bubble.classList.add('show');
  helper.classList.add('wave');
  lastSpoke = Date.now();
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hush, ms);
}

function lineFor(key) {
  const pool = [...(LINES[key] || []), ...(LINES[key] && key !== 'saved' ? LINES.any.slice(0, 2) : [])];
  for (let tries = 0; tries < 6; tries++) {
    const item = pick(pool.length ? pool : LINES.any);
    const text = typeof item === 'function' ? item() : item;
    if (text) return text;
  }
  return pick(LINES.any.filter((x) => typeof x === 'string'));
}

// Called on screen changes. Speaks only now and then, so it stays charming.
export function nudge(tab, { force = false } = {}) {
  if (!force && Date.now() - lastSpoke < 5000) return;
  setTimeout(() => say(lineFor(tab)), 450);
}

export const cheer = () => say(lineFor('saved'), 2200);

export function greet() {
  const h = new Date().getHours();
  const hello = h < 12 ? 'Good morning!' : h < 18 ? 'Good afternoon!' : 'Good evening!';
  setTimeout(() => say(`${hello} ${lineFor('home')}`, 5200), 900);
}
