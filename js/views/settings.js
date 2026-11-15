// Settings: currency and category management (add, rename, recolour, reorder, remove).

import {
  getState,
  categoriesOf,
  categoryById,
  addCategory,
  updateCategory,
  archiveCategory,
  restoreCategory,
  moveCategory,
  setSetting,
} from '../store.js';
import { on, refresh, openSheet, closeSheet, toast } from '../ui.js';
import { esc } from '../util.js';
import { PROVIDERS, currentAI, setProvider, setKey, setModel, loadModels } from '../ai.js';
import { ICONS, icon, bubble } from '../art.js';
import { FONTS } from '../fonts.js';
import { exportBackup, buildBackup, readBackup, parseBackup, restoreBackup } from '../backup.js';
import { getSync, syncOn, syncBusy, syncCode, setSyncCode, connect, disconnect, syncNow, onSyncChange } from '../sync.js';
import { syncScript } from '../sync-script.js';

const CURRENCIES = [
  'USD', 'EUR', 'GBP', 'HKD', 'SGD', 'MYR', 'TWD', 'CNY', 'JPY', 'KRW',
  'AUD', 'NZD', 'CAD', 'CHF', 'THB', 'IDR', 'PHP', 'VND', 'INR', 'AED',
];

// A muted, earthy set that sits quietly beside the app's own palette.
const COLORS = [
  '#B17457', '#C58B74', '#C2A36B', '#8A9A7B', '#6F8F8B',
  '#7D8FA3', '#9B7E8E', '#A8483A', '#8C8577', '#4A4947',
];

const ICON_KEYS = Object.keys(ICONS);

let catType = 'expense';

on('cat-type', (el) => ((catType = el.dataset.type), refresh()));
on('cat-up', (el) => moveCategory(el.dataset.id, -1));
on('cat-down', (el) => moveCategory(el.dataset.id, 1));
on('cat-edit', (el) => openCategorySheet(categoryById(el.dataset.id)));
on('cat-new', () => openCategorySheet(null));
on('font-pick', (el) => setSetting('font', el.dataset.font));

// ---- Sync ----

// Redraw Settings when a sync starts or finishes, if Settings is on screen.
onSyncChange(() => document.getElementById('sync-card') && refresh());

on('sync-copy-script', async () => {
  const code = (document.getElementById('sync-code')?.value || syncCode()).trim();
  setSyncCode(code);
  const script = syncScript(code);
  try {
    await navigator.clipboard.writeText(script);
    toast('Script copied. Paste it into Apps Script.');
  } catch {
    // Clipboard blocked: show the script so it can be copied by hand.
    openSheet(`
      <div class="es-head">
        <button class="icon-btn" data-action="sheet-close" aria-label="Close">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
        <strong>The script</strong>
        <span class="icon-btn" aria-hidden="true"></span>
      </div>
      <div class="cs-body">
        <p class="hint">Select all of this and copy it.</p>
        <textarea class="field area" rows="12" readonly style="margin-top:10px">${esc(script)}</textarea>
      </div>`);
  }
});

on('sync-connect', async (el) => {
  const url = document.getElementById('sync-url').value;
  const code = document.getElementById('sync-code').value;
  el.disabled = true;
  el.textContent = 'Connecting…';
  try {
    const how = await connect(url, code);
    toast(
      how === 'joined'
        ? 'Connected. This device now has your synced data.'
        : how === 'merged'
          ? 'Connected. This device and the Sheet have been combined.'
          : 'Connected. Your data is now in the Sheet.',
    );
  } catch (err) {
    toast(err.message || "Couldn't connect");
  }
  refresh();
});

on('sync-now', async () => {
  await syncNow();
  const { error } = getSync();
  toast(error || 'Synced');
});

on('sync-share', () => {
  const s = getSync();
  const sheet = openSheet(`
    <div class="es-head">
      <button class="icon-btn" data-action="sheet-close" aria-label="Close">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
      <strong>Add another device</strong>
      <span class="icon-btn" aria-hidden="true"></span>
    </div>
    <div class="cs-body">
      <p class="hint">On the other device, open Ledger, go to Settings, then Sync, and enter these two. There is no need to repeat the Google steps.</p>
      <span class="label">Web app URL</span>
      <textarea class="field area" rows="3" readonly>${esc(s.url)}</textarea>
      <span class="label">Sync code</span>
      <input class="field" readonly value="${esc(s.code)}">
      <button class="btn primary share-copy" style="margin-top:18px">Copy both</button>
      <p class="hint" style="margin-top:10px">Anyone with both of these can read and change your data, so share them only with yourself.</p>
    </div>`);
  sheet.querySelector('.share-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(`Web app URL: ${s.url}\nSync code: ${s.code}`);
      toast('Copied');
    } catch {
      toast("Couldn't copy here. Select and copy each one.");
    }
  });
});

on('sync-off', () => {
  disconnect();
  toast('Sync turned off on this device. Your data stays here and in the Sheet.');
});

const markBackedUp = () => {
  try {
    localStorage.setItem('ledger.lastBackup', new Date().toISOString());
  } catch {
    /* storage unavailable */
  }
  refresh();
};

on('backup-export', async () => {
  const r = await exportBackup();
  if (r.cancelled) return;
  markBackedUp();
  toast(
    r.how === 'shared'
      ? `Backup shared: ${r.entries} entries`
      : `Saved ${r.name} to your downloads: ${r.entries} entries${r.photos ? `, ${r.photos} photos` : ''}`,
  );
});

// A second way that works even where downloads are blocked: copy the backup
// as text and keep it in a note or an email to yourself.
on('backup-copy', async () => {
  const { text, entries } = await buildBackup();
  try {
    await navigator.clipboard.writeText(text);
    markBackedUp();
    toast(`Backup copied: ${entries} entries. Paste it somewhere safe.`);
  } catch {
    toast("Couldn't copy here. Use Save a backup file instead.");
  }
});

on('backup-paste', () => {
  const sheet = openSheet(`
    <div class="es-head">
      <button class="icon-btn" data-action="sheet-close" aria-label="Close">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
      <strong>Paste a backup</strong>
      <span class="icon-btn" aria-hidden="true"></span>
    </div>
    <div class="cs-body">
      <textarea class="field area paste-text" rows="6" placeholder="Paste the backup text here"></textarea>
      <button class="btn primary paste-go" style="margin-top:14px">Check this backup</button>
    </div>`);
  sheet.querySelector('.paste-go').addEventListener('click', () => {
    try {
      confirmRestore(parseBackup(sheet.querySelector('.paste-text').value.trim()));
    } catch {
      toast("That text isn't a Ledger backup");
    }
  });
});

// Restoring replaces everything, so it asks first and says what is in the file.
async function pickedBackup(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  try {
    confirmRestore(await readBackup(file));
  } catch {
    toast("That file isn't a Ledger backup");
  }
}

function confirmRestore(backup) {
  const entries = backup.data.entries.filter((e) => !e.deleted).length;
  const when = new Date(backup.exportedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const sheet = openSheet(`
    <div class="es-head">
      <button class="icon-btn" data-action="sheet-close" aria-label="Close">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
      <strong>Restore backup</strong>
      <span class="icon-btn" aria-hidden="true"></span>
    </div>
    <div class="cs-body">
      <p>This backup is from ${esc(when)} and holds ${entries} ${entries === 1 ? 'entry' : 'entries'}.</p>
      <p class="hint">Restoring replaces everything currently in the app on this device with the backup. This cannot be undone, so save a backup of the current data first if you might want it.</p>
      <button class="btn primary restore-go" style="margin-top:18px">Replace my data with this backup</button>
      <button class="btn ghost" data-action="sheet-close">Cancel</button>
    </div>`);
  sheet.querySelector('.restore-go').addEventListener('click', async () => {
    try {
      await restoreBackup(backup);
      closeSheet();
      toast(`Backup restored: ${entries} entries`);
    } catch {
      toast("The backup couldn't be restored. Nothing was changed.");
    }
  });
}
document.addEventListener('change', (e) => {
  if (e.target.id === 'backup-file') pickedBackup(e.target);
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'set-currency') setSetting('currency', e.target.value);
  if (e.target.id === 'ai-model') setModel(currentAI().provider, e.target.value);
  if (e.target.id === 'ai-key') {
    setKey(currentAI().provider, e.target.value.trim());
    refreshModels();
  }
});

// For GPT and DeepSeek, fetch the models this key can use, then redraw.
async function refreshModels() {
  const { provider, info, key } = currentAI();
  refresh();
  if (!info.base || !key) return;
  try {
    const ids = await loadModels(provider);
    toast(ids.length ? `${ids.length} ${info.name} models found` : 'No models found for this key');
  } catch (err) {
    toast(err.message || "Couldn't load the model list");
  }
  refresh();
}

on('ai-provider', (el) => (setProvider(el.dataset.p), refresh()));
on('ai-models', refreshModels);

export function renderSettings() {
  const { settings } = getState();
  const ai = currentAI();
  const sync = getSync();
  const cats = categoriesOf(catType);
  let lastBackup = '';
  try {
    const at = localStorage.getItem('ledger.lastBackup');
    if (at) lastBackup = new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    /* storage unavailable */
  }

  const rows = cats
    .map(
      (c, i) => `
      <div class="crow">
        <button class="crow-main" data-action="cat-edit" data-id="${c.id}">
          ${bubble(c)}
          <span class="crow-name">${esc(c.name)}</span>
        </button>
        <button class="icon-btn sm" data-action="cat-up" data-id="${c.id}" aria-label="Move ${esc(c.name)} up" ${i === 0 ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 14l6-6 6 6"/></svg>
        </button>
        <button class="icon-btn sm" data-action="cat-down" data-id="${c.id}" aria-label="Move ${esc(c.name)} down" ${i === cats.length - 1 ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 10l6 6 6-6"/></svg>
        </button>
      </div>`,
    )
    .join('');

  return `
    <h2 class="sec">General</h2>
    <section class="card">
      <label class="row">
        <span>Currency</span>
        <select id="set-currency" class="select">
          ${CURRENCIES.map((c) => `<option ${c === settings.currency ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </label>
    </section>

    <h2 class="sec">Font</h2>
    <div class="font-pick">
      ${FONTS.map(
        (f) => `
        <button class="card font-opt ${f.id === settings.font ? 'on' : ''}" data-action="font-pick" data-font="${f.id}"
                style="font-family:${f.family}, sans-serif" aria-pressed="${f.id === settings.font}">
          <span class="font-aa">Aa 123</span>
          <span>${f.name}</span>
        </button>`,
      ).join('')}
    </div>

    <h2 class="sec">Penny, your AI helper</h2>
    <section class="card stack">
      <div class="seg wide" style="margin:0">
        ${Object.entries(PROVIDERS)
          .map(([id, p]) => `<button data-action="ai-provider" data-p="${id}" class="${id === ai.provider ? 'on' : ''}">${p.name}</button>`)
          .join('')}
      </div>
      <label class="label" for="ai-key" style="margin:0">${ai.info.name} API key</label>
      <input id="ai-key" class="field" type="password" placeholder="${ai.info.keyHint}" value="${esc(ai.key)}"
             autocomplete="off" autocapitalize="off" spellcheck="false">
      <p class="hint" id="ai-status">${
        ai.key
          ? '<span class="ok">Saved on this device ✓</span>'
          : `Paste your ${ai.info.name} key here. You get one at ${ai.info.site}.`
      }</p>
      <label class="row">
        <span>Model</span>
        <select id="ai-model" class="select">
          ${(ai.list.some((m) => m.id === ai.model) ? ai.list : [{ id: ai.model, label: ai.model }, ...ai.list])
            .map((m) => `<option value="${esc(m.id)}" ${m.id === ai.model ? 'selected' : ''}>${esc(m.label)}</option>`)
            .join('')}
        </select>
      </label>
      ${
        ai.info.base
          ? `<p class="hint">${
              ai.list.length
                ? `${ai.list.length} models available to your key.`
                : 'After you add a key, the list of models it can use is loaded here.'
            } ${ai.key ? '<button class="link" data-action="ai-models">Reload list</button>' : ''}</p>`
          : ''
      }
      ${ai.info.vision ? '' : `<p class="hint">${ai.info.name} reads text only, so it can't read screenshots. Typed and spoken entries and the monthly review work.</p>`}
      <p class="hint">Keys are kept only on this device and are never synced or put in backups. What you type or snap is sent to ${ai.info.company} to be read. Usage is billed to your key.</p>
    </section>

    <h2 class="sec">Categories</h2>
    <div class="seg wide">
      <button data-action="cat-type" data-type="expense" class="${catType === 'expense' ? 'on' : ''}">Spending</button>
      <button data-action="cat-type" data-type="income" class="${catType === 'income' ? 'on' : ''}">Income</button>
    </div>
    <section class="card list">
      ${rows || '<p class="hint pad">No categories yet.</p>'}
    </section>
    <button class="btn ghost" data-action="cat-new">+ Add category</button>

    <p class="hint center">Tap a category to rename it or change its icon and colour.</p>

    <h2 class="sec">Sync</h2>
    <section class="card stack" id="sync-card">
      ${
        syncOn()
          ? `<p>${
              syncBusy()
                ? 'Syncing…'
                : sync.error
                  ? `<span class="bad-text">Last sync failed: ${esc(sync.error)}</span>`
                  : `<span class="ok">Connected to your Google Sheet ✓</span>`
            }</p>
             <p class="hint">${
               sync.lastOk
                 ? `Last synced ${esc(new Date(sync.lastOk).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }))}. `
                 : ''
             }Changes sync by themselves a few seconds after you make them, and whenever you open the app.</p>
             <button class="btn primary" data-action="sync-now" ${syncBusy() ? 'disabled' : ''}>Sync now</button>
             <button class="btn ghost" data-action="sync-share" style="margin-top:0">Add another device</button>
             <button class="btn ghost danger" data-action="sync-off" style="margin-top:0">Turn off sync on this device</button>`
          : `<p class="hint">Keep your phone and computer in step through a Google Sheet in your own Google Drive. It is free, and the Sheet doubles as a spreadsheet copy of every entry.</p>
             <ol class="steps">
               <li>Open <strong>sheets.new</strong> in a browser to make a blank Google Sheet, and name it Ledger.</li>
               <li>In the Sheet choose <strong>Extensions → Apps Script</strong>. Delete the sample code, paste this script and press Save.
                 <button class="btn ghost" data-action="sync-copy-script">Copy the script</button></li>
               <li>Press <strong>Deploy → New deployment</strong>. Pick type <strong>Web app</strong>, set Execute as to <strong>Me</strong> and Who has access to <strong>Anyone</strong>, press Deploy, and allow access when Google asks.</li>
               <li>Copy the <strong>Web app URL</strong> it gives you and paste it below.</li>
             </ol>
             <label class="label" for="sync-url" style="margin:0">Web app URL</label>
             <input id="sync-url" class="field" type="url" placeholder="https://script.google.com/macros/s/…/exec"
                    autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(sync.url)}">
             <label class="label" for="sync-code" style="margin:0">Sync code</label>
             <input id="sync-code" class="field" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(syncCode())}">
             <p class="hint">The sync code is already written into the script you copy. Already set up on another device? Skip the steps and enter that device's URL and sync code here.</p>
             <button class="btn primary" data-action="sync-connect">Connect</button>`
      }
    </section>

    <h2 class="sec">Backup</h2>
    <section class="card stack">
      <p class="hint">Your data is saved on this device only. A backup file holds everything (entries, budget, holdings, goals and photos) so you can restore it here or on another device. Your API key is not included.</p>
      <button class="btn primary" data-action="backup-export">Save a backup file</button>
      <label class="btn ghost file-btn">Restore from a backup file<input type="file" id="backup-file" accept="application/json,.json"></label>
      <p class="hint">No file? <button class="link" data-action="backup-copy">Copy the backup as text</button> or <button class="link" data-action="backup-paste">paste one to restore</button>.</p>
      <p class="hint">${lastBackup ? `Last backup: ${esc(lastBackup)}.` : 'No backup saved from this device yet.'}</p>
    </section>
  `;
}

// Also used from the entry sheet, which passes the type and an onDone callback
// so it can pick up where the user left off.
export function openCategorySheet(existing, opts = {}) {
  const type = opts.type ?? existing?.type ?? catType;
  let result = null;
  const draft = existing
    ? { name: existing.name, icon: existing.icon, color: existing.color, group: existing.group === 'needs' ? 'needs' : 'wants' }
    : { name: '', icon: 'dots', group: 'wants', color: COLORS[categoriesOf(type).length % COLORS.length] };

  const sheet = openSheet(`
    <div class="es-head">
      <button class="icon-btn" data-action="sheet-close" aria-label="Close">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
      <strong>${existing ? 'Edit category' : `New ${type === 'expense' ? 'spending' : 'income'} category`}</strong>
      <span class="icon-btn" aria-hidden="true"></span>
    </div>
    <div class="cs-body">
      <div class="cs-preview">
        <span class="bubble lg"></span>
        <input class="field cs-name" type="text" maxlength="24" placeholder="Category name"
               value="${esc(draft.name)}" autocomplete="off" enterkeyhint="done">
      </div>

      <span class="label">Icon</span>
      <div class="pick icon-pick">
        ${ICON_KEYS.map((k) => `<button data-icon="${k}" aria-label="${k} icon">${icon(k)}</button>`).join('')}
      </div>

      <span class="label">Colour</span>
      <div class="pick color-pick">
        ${COLORS.map((c) => `<button data-color="${c}" style="--c:${c}" aria-label="Colour ${c}"></button>`).join('')}
      </div>

      ${
        type === 'expense'
          ? `<span class="label">Counts as</span>
             <div class="seg wide cs-group">
               <button data-group="needs">Need</button>
               <button data-group="wants">Want</button>
             </div>`
          : ''
      }

      <button class="btn primary cs-save">${existing ? 'Save changes' : 'Add category'}</button>
      ${existing ? '<button class="btn ghost danger cs-remove">Remove category</button>' : ''}
    </div>
  `,
    { onClose: () => opts.onDone?.(result) },
  );

  const $ = (sel) => sheet.querySelector(sel);
  const nameInput = $('.cs-name');

  function paint() {
    const badge = $('.cs-preview .bubble');
    badge.innerHTML = icon(draft.icon);
    badge.style.setProperty('--c', draft.color);
    sheet.querySelectorAll('[data-icon]').forEach((b) =>
      b.classList.toggle('on', b.dataset.icon === draft.icon),
    );
    sheet.querySelectorAll('[data-color]').forEach((b) =>
      b.classList.toggle('on', b.dataset.color === draft.color),
    );
    sheet.querySelectorAll('[data-group]').forEach((b) =>
      b.classList.toggle('on', b.dataset.group === draft.group),
    );
  }

  sheet.addEventListener('click', (e) => {
    const ic = e.target.closest('[data-icon]');
    if (ic) {
      draft.icon = ic.dataset.icon;
      return paint();
    }
    const grp = e.target.closest('[data-group]');
    if (grp) {
      draft.group = grp.dataset.group;
      return paint();
    }
    const col = e.target.closest('[data-color]');
    if (col) {
      draft.color = col.dataset.color;
      return paint();
    }
    if (e.target.closest('.cs-save')) {
      const name = nameInput.value.trim();
      if (!name) {
        nameInput.focus();
        nameInput.classList.add('invalid');
        return;
      }
      const data = { name, icon: draft.icon, color: draft.color };
      if (type === 'expense') data.group = draft.group;
      if (existing) updateCategory(existing.id, data);
      result = { saved: existing ? existing.id : addCategory({ ...data, type }).id };
      closeSheet();
      toast(existing ? 'Category updated' : 'Category added');
      return;
    }
    if (e.target.closest('.cs-remove')) {
      const id = existing.id;
      archiveCategory(id);
      result = { removed: id };
      closeSheet();
      toast(`${existing.name} removed`, { action: 'Undo', onAction: () => restoreCategory(id) });
    }
  });

  nameInput.addEventListener('input', () => nameInput.classList.remove('invalid'));
  paint();
  if (!existing) nameInput.focus();
}
