// App shell: tab navigation and rendering the active screen.

import { subscribe } from './store.js';
import { on, setRenderer, closeSheet } from './ui.js';
import { renderHome, renderEntries } from './views/home.js';
import { renderSettings } from './views/settings.js';
import { renderBudget } from './views/budget.js';
import { renderInsights } from './views/insights.js';
import { renderGoals } from './views/goals.js';
import { renderSummary } from './views/summary.js';
import { openEntrySheet } from './views/add.js';
import { openAssistant } from './views/assistant.js';
import { mascot } from './art.js';
import { getState } from './store.js';
import { applyFont } from './fonts.js';
import { liveEntries } from './store.js';
import { nudge, cheer, greet, hush } from './buddy.js';
import { sweepPhotos } from './photos.js';
import { startSync } from './sync.js';

const screens = {
  home: { title: '', render: renderHome },
  budget: { title: 'Budget', render: renderBudget },
  insights: { title: 'Insights', render: renderInsights },
  goals: { title: 'Goals', render: renderGoals },
  settings: { title: 'Settings', render: renderSettings },
  entries: { title: 'All entries', render: renderEntries },
  summary: { title: 'Summary', render: renderSummary },
};

let tab = 'home';

function render() {
  applyFont(getState().settings.font);
  const screen = screens[tab];
  document.getElementById('title').textContent = screen.title;
  document.getElementById('view').innerHTML = screen.render();
  // Settings and All entries are opened from another screen, so they get a back arrow.
  document.getElementById('back').hidden = !['settings', 'entries', 'summary'].includes(tab);
  document.getElementById('doc').hidden = tab === 'summary' || tab === 'settings';
  document.getElementById('gear').hidden = tab === 'settings';
  document.querySelectorAll('.tabs [data-tab]').forEach((b) => {
    b.classList.toggle('on', b.dataset.tab === tab);
  });
}

on('tab', (el) => {
  if (!screens[el.dataset.tab]) return;
  tab = el.dataset.tab;
  closeSheet();
  render();
  window.scrollTo(0, 0);
  playEnter();
  hush();
  nudge(tab);
});

// Replay the entrance motion: content rises in, bars and rings draw themselves.
function playEnter() {
  const view = document.getElementById('view');
  view.classList.remove('enter');
  void view.offsetWidth;
  view.classList.add('enter');
  clearTimeout(playEnter.timer);
  playEnter.timer = setTimeout(() => view.classList.remove('enter'), 1500);
}

// One tap on + opens the keypad. A quick second tap opens Penny, already listening.
let addTimer = null;
on('add', () => {
  if (addTimer) {
    clearTimeout(addTimer);
    addTimer = null;
    openAssistant({ voice: true });
    return;
  }
  addTimer = setTimeout(() => {
    addTimer = null;
    openEntrySheet();
  }, 260);
});

document.getElementById('helper').innerHTML = mascot();
setRenderer(render);
subscribe(render);
render();
playEnter();
greet();

// Tidy up photos whose entry was deleted in an earlier session. (Done at
// start-up, so Undo still works right after a delete.)
sweepPhotos(new Set(liveEntries().map((e) => e.photoId).filter(Boolean)));

startSync();

// A quick cheer from Penny whenever a new entry lands.
let entryCount = liveEntries().length;
subscribe(() => {
  const now = liveEntries().length;
  if (now > entryCount) setTimeout(cheer, 500);
  entryCount = now;
});

// Offline support. Skipped where service workers are not available.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
