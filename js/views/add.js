// The Add / Edit entry sheet: amount keypad, category grid, date, note.

import {
  getState,
  liveEntries,
  categoriesOf,
  categoryById,
  addEntry,
  updateEntry,
  deleteEntry,
  restoreEntry,
  reorderCategories,
} from '../store.js';
import { openSheet, closeSheet, toast } from '../ui.js';
import { mascot, icon, bubble } from '../art.js';
import { openCategorySheet } from './settings.js';
import { prepareImage } from '../ai.js';
import { putPhoto, deletePhoto } from '../photos.js';
import { loadPhoto } from '../sync.js';
import { uid, monthKey } from '../util.js';
import { categoryUsage, limitTone, monthSummary } from '../budget.js';
import { saveMonthly } from '../recurring.js';
import { setSetting } from '../store.js';
import {
  esc,
  todayStr,
  addDays,
  dayLabel,
  money,
  currencyDecimals,
  currencySymbol,
  round2,
} from '../util.js';

// Most recently used category of a type, so repeat entries are one tap fewer.
function lastUsed(type) {
  const recent = liveEntries()
    .filter((e) => e.type === type)
    .sort((a, b) => b.createdAt - a.createdAt)
    .find((e) => {
      const c = categoryById(e.categoryId);
      return c && !c.archived;
    });
  return recent?.categoryId ?? categoriesOf(type)[0]?.id ?? null;
}

// carry: a draft to continue with (used when coming back from the category
// editor). editCats: reopen with the category grid still in edit mode.
export function openEntrySheet(existing = null, carry = null, editCats = false) {
  const currency = getState().settings.currency;
  const decimals = currencyDecimals(currency);
  const today = todayStr();

  let editing = editCats;
  let showFav = false; // the favourites list takes the place of the category grid
  const draft = carry
    ? { ...carry }
    : existing
    ? {
        type: existing.type,
        amountStr: String(existing.amount),
        categoryId: existing.categoryId,
        date: existing.date,
        note: existing.note,
        photoId: existing.photoId || null,
      }
    : {
        type: 'expense',
        amountStr: '',
        categoryId: lastUsed('expense'),
        date: today,
        note: '',
      };

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', decimals ? '.' : '', '0', 'back'];

  const sheet = openSheet(
    `
    <div class="es-head">
      <button class="icon-btn" data-action="sheet-close" aria-label="Close">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
      <div class="seg" role="tablist">
        <button data-type="expense" role="tab">Spending</button>
        <button data-type="income" role="tab">Income</button>
      </div>
      ${
        existing
          ? `<button class="icon-btn danger" data-es="delete" aria-label="Delete entry">
               <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>
             </button>`
          : `<button class="mini es-penny" aria-label="Ask Penny how this category is doing">${mascot()}</button>`
      }
      <div class="es-say" aria-live="polite"></div>
    </div>

    <div class="es-body">
      <div class="es-amount" aria-live="polite">
        <span class="es-cur">${esc(currencySymbol(currency))}</span><span class="es-num">0</span>
      </div>

      <div class="cat-grid"></div>
      <div class="cat-foot"></div>
      <p class="hint cat-hint" hidden>Drag to rearrange. Tap one to rename it, change its icon or remove it.</p>

      <div class="es-meta">
        <div class="chips">
          <button class="chip" data-date="${today}">Today</button>
          <button class="chip" data-date="${addDays(today, -1)}">Yesterday</button>
          <label class="chip date-chip">
            <span class="date-label"></span>
            <input type="date" class="es-date" aria-label="Date">
          </label>
          <label class="chip photo-add" title="Add a photo">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="6" width="16" height="13" rx="3"/><circle cx="12" cy="12.5" r="3"/><path d="M9 6l1.5-2h3L15 6"/></svg>
            <input type="file" accept="image/*" class="es-photo" aria-label="Add a photo">
          </label>
          <button class="chip photo-thumb" hidden aria-label="Show or hide the photo"><img alt=""></button>
        </div>
        <input class="field es-note" type="text" maxlength="80" placeholder="Note (optional)"
               value="${esc(draft.note)}" autocomplete="off" enterkeyhint="done">
        <div class="photo-view" hidden>
          <img alt="Attached photo">
          <div class="photo-actions">
            <label class="chip photo-change">Change<input type="file" accept="image/*" class="es-photo2" aria-label="Change the photo"></label>
            <button class="chip photo-remove">Remove</button>
          </div>
        </div>
      </div>
    </div>

    <div class="keypad">
      ${keys
        .map((k) =>
          k === ''
            ? '<span></span>'
            : k === 'back'
              ? `<button data-k="back" aria-label="Backspace">
                   <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5-6z"/><path d="M12 10l4 4M16 10l-4 4"/></svg>
                 </button>`
              : `<button data-k="${k}">${k}</button>`,
        )
        .join('')}
    </div>
    <div class="es-foot">
      <button class="btn primary es-save">${existing ? 'Save changes' : 'Save'}</button>
    </div>
  `,
    { className: 'entry-sheet', onClose: () => document.removeEventListener('keydown', onKey) },
  );

  const $ = (sel) => sheet.querySelector(sel);
  const numEl = $('.es-num');
  const amountEl = $('.es-amount');
  const grid = $('.cat-grid');
  const catHint = $('.cat-hint');
  const catFoot = $('.cat-foot');
  const dateInput = $('.es-date');
  const noteInput = $('.es-note');

  // ---- Painting ----

  function paintAmount() {
    const s = draft.amountStr;
    if (!s) {
      numEl.textContent = '0';
      amountEl.classList.add('empty');
      return;
    }
    const [whole, frac] = s.split('.');
    const grouped = Number(whole || 0).toLocaleString();
    numEl.textContent = frac !== undefined ? `${grouped}.${frac}` : grouped;
    amountEl.classList.remove('empty');
  }

  function paintType() {
    sheet.querySelectorAll('.seg button').forEach((b) => {
      const active = b.dataset.type === draft.type;
      b.classList.toggle('on', active);
      b.setAttribute('aria-selected', active);
    });
    amountEl.classList.toggle('income', draft.type === 'income');
  }

  function paintCats() {
    const cats = categoriesOf(draft.type);
    // When editing an entry whose category was removed, still show it.
    const current = categoryById(draft.categoryId);
    if (current && current.archived && current.type === draft.type) cats.push(current);
    grid.classList.toggle('editing', editing);
    grid.classList.toggle('paged', !editing && !showFav);
    grid.classList.toggle('favs', showFav);
    if (showFav) return paintFavs();
    const tile = (c) => `
        <button class="cat ${c.id === draft.categoryId && !editing ? 'on' : ''}" data-cat="${c.id}" style="--c:${esc(c.color)}"
                ${editing ? `aria-label="Edit ${esc(c.name)}"` : ''}>
          <span class="bubble">${icon(c.icon)}</span>
          <span class="cat-name">${esc(c.name)}</span>
        </button>`;

    if (editing) {
      // Edit mode shows every category at once so they can be dragged around.
      grid.innerHTML =
        cats.map(tile).join('') +
        `<button class="cat cat-tool" data-cat-tool="add">
           <span class="bubble">${icon('plus')}</span>
           <span class="cat-name">Add</span>
         </button>
         <button class="cat cat-tool on" data-cat-tool="edit">
           <span class="bubble"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
           <span class="cat-name">Done</span>
         </button>`;
      catFoot.innerHTML = '';
    } else {
      // Normal mode: two rows at a time (eight categories), swipe sideways for more.
      const PER_PAGE = 8;
      const pages = [];
      for (let i = 0; i < cats.length; i += PER_PAGE) pages.push(cats.slice(i, i + PER_PAGE));
      grid.innerHTML = pages.length
        ? pages.map((p) => `<div class="cat-page">${p.map(tile).join('')}</div>`).join('')
        : '<p class="hint">No categories yet. Tap Add to make one.</p>';
      catFoot.innerHTML = `
        <span class="cat-dots">${
          pages.length > 1
            ? `<button class="icon-btn sm" data-cat-page="-1" aria-label="Previous categories">
                 <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
               </button>
               ${pages.map((_, i) => `<i data-cat-goto="${i}"></i>`).join('')}
               <button class="icon-btn sm" data-cat-page="1" aria-label="More categories">
                 <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>
               </button>`
            : ''
        }</span>
        <button class="link fav-link" data-fav="toggle">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/></svg>Favourites
        </button>
        <button class="link" data-cat-tool="add">Add</button>
        <button class="link" data-cat-tool="edit">Edit</button>`;
      // Start on the page that holds the selected category.
      const at = Math.max(0, pages.findIndex((p) => p.some((c) => c.id === draft.categoryId)));
      grid.scrollLeft = at * grid.clientWidth;
      paintDots();
    }
    catHint.hidden = !editing;
    paintRing();
  }

  // ---- Limit ring ----
  // A ring around the chosen category shows how much of its monthly limit is
  // used, counting the amount being typed. Its colour comes from limitTone().

  // Usage of the chosen category in the month of the entry's date. When
  // editing, the entry's own saved amount is left out so it is not counted twice.
  function usage(includeTyped = true) {
    const month = monthKey(draft.date);
    const typed = includeTyped ? round2(parseFloat(draft.amountStr)) || 0 : 0;
    const own =
      existing && existing.type === 'expense' && existing.categoryId === draft.categoryId && monthKey(existing.date) === month
        ? existing.amount
        : 0;
    return categoryUsage(draft.categoryId, month, typed, own);
  }

  function paintRing() {
    grid.querySelectorAll('.limit-ring').forEach((r) => r.remove());
    if (editing || showFav || draft.type !== 'expense') return;
    const bubbleEl = grid.querySelector('.cat.on .bubble');
    const u = usage();
    if (!bubbleEl || !(u.limit > 0)) return;
    const around = 2 * Math.PI * 22;
    const filled = Math.max(0, Math.min(1, u.share)) * around;
    bubbleEl.insertAdjacentHTML(
      'beforeend',
      `<svg class="limit-ring tone-${limitTone(u.share)}" viewBox="0 0 48 48" role="img"
            aria-label="${Math.round(u.share * 100)}% of limit used">
         <circle class="lr-track" cx="24" cy="24" r="22"/>
         <circle class="lr-fill" cx="24" cy="24" r="22" transform="rotate(-90 24 24)"
                 stroke-dasharray="${filled.toFixed(1)} ${around.toFixed(1)}"/>
       </svg>`,
    );
  }

  // ---- Penny's note ----
  // Tapping Penny pops a short note about the chosen category.

  function pennyLine() {
    const m = (n) => money(n, currency);
    const c = categoryById(draft.categoryId);
    if (!c) return 'Pick a category and I can tell you how it is doing.';
    if (draft.type === 'income') {
      return `Extra income this month so far: ${m(monthSummary(monthKey(draft.date)).extras)}.`;
    }
    const before = usage(false);
    const after = usage(true);
    if (!(before.limit > 0)) {
      return `${m(before.spent)} spent on ${c.name} this month. No limit is set for it yet.`;
    }
    const pct = (u) => `${Math.round(u.share * 100)}%`;
    const base =
      before.used > before.limit
        ? `${c.name} is ${m(before.used - before.limit)} over its ${m(before.limit)} limit.`
        : `${pct(before)} of your ${c.name} limit is used so far, with ${m(before.limit - before.used)} left.`;
    return after.used > before.used ? `${base} This entry takes it to ${pct(after)}.` : base;
  }

  let sayTimer = null;
  function pennySays(text) {
    const bubbleEl = $('.es-say');
    const penny = $('.es-penny');
    bubbleEl.textContent = text;
    bubbleEl.classList.remove('show');
    penny?.classList.remove('wave');
    void bubbleEl.offsetWidth; // restart the animations
    bubbleEl.classList.add('show');
    penny?.classList.add('wave');
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => bubbleEl.classList.remove('show'), 5000);
  }

  // ---- Favourites ----
  // Routine entries saved for reuse. Kept in settings, so they sync.

  const favourites = () => getState().settings.favourites || [];

  function paintFavs() {
    const favs = favourites();
    grid.innerHTML = `
      <div class="fav-actions">
        <button class="chip" data-fav="save">Save as favourite</button>
        <button class="chip" data-fav="monthly">Repeat monthly</button>
      </div>
      ${
        favs.length
          ? favs
              .map((f) => {
                const c = categoryById(f.categoryId);
                return `
          <div class="fav-row">
            <button class="fav-use" data-fav-use="${f.id}">
              ${bubble(c)}
              <span class="fav-name">${esc(f.note || c?.name || 'Entry')}</span>
              <span class="fav-amt">${f.type === 'income' ? '+' : ''}${money(f.amount, currency)}</span>
            </button>
            <button class="icon-btn sm" data-fav-del="${f.id}" aria-label="Remove this favourite">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
            </button>
          </div>`;
              })
              .join('')
          : '<p class="hint center">No favourites yet. Fill in an entry, then tap Save as favourite.</p>'
      }`;
    catFoot.innerHTML = '<span class="cat-dots"></span><button class="link" data-fav="toggle">Back to categories</button>';
    catHint.hidden = true;
  }

  // The entry as typed so far, or null (with a shake) if it is not ready.
  function typedEntry() {
    const amount = round2(parseFloat(draft.amountStr));
    if (!(amount > 0)) return shake(amountEl), null;
    if (!draft.categoryId) return shake(grid), null;
    return { type: draft.type, amount, categoryId: draft.categoryId, note: noteInput.value.trim() };
  }

  function favAction(e) {
    const use = e.target.closest('[data-fav-use]');
    if (use) {
      const f = favourites().find((x) => x.id === use.dataset.favUse);
      if (!f) return true;
      const c = categoryById(f.categoryId);
      draft.type = f.type;
      draft.amountStr = String(f.amount);
      if (c && !c.archived) draft.categoryId = f.categoryId;
      noteInput.value = f.note || '';
      showFav = false;
      paintType();
      paintAmount();
      paintCats();
      return true;
    }
    const del = e.target.closest('[data-fav-del]');
    if (del) {
      const before = favourites();
      setSetting('favourites', before.filter((x) => x.id !== del.dataset.favDel));
      paintFavs();
      toast('Favourite removed', { action: 'Undo', onAction: () => setSetting('favourites', before) });
      return true;
    }
    const act = e.target.closest('[data-fav]')?.dataset.fav;
    if (!act) return false;
    if (act === 'toggle') {
      showFav = !showFav;
      paintCats();
    } else if (act === 'save') {
      const entry = typedEntry();
      if (!entry) return true;
      const same = (f) => f.type === entry.type && f.categoryId === entry.categoryId && f.amount === entry.amount && (f.note || '') === entry.note;
      if (favourites().some(same)) return toast('That is already a favourite'), true;
      setSetting('favourites', [...favourites(), { id: uid(), ...entry }]);
      paintFavs();
      toast('Saved to favourites');
    } else if (act === 'monthly') {
      const entry = typedEntry();
      if (!entry) return true;
      const c = categoryById(entry.categoryId);
      const item = saveMonthly({
        name: entry.note || c?.name || 'Monthly item',
        type: entry.type,
        amount: entry.amount,
        categoryId: entry.categoryId,
        day: Number(draft.date.slice(8)),
        from: monthKey(draft.date),
      });
      // Saving this entry counts as this month's payment for the new item.
      draft.recurringId = item.id;
      showFav = false;
      paintCats();
      toast(`${item.name} will come up on day ${item.day} each month for you to confirm`);
    }
    return true;
  }

  function paintDots() {
    const page = Math.round(grid.scrollLeft / (grid.clientWidth || 1));
    const dots = catFoot.querySelectorAll('.cat-dots i');
    dots.forEach((d, i) => d.classList.toggle('on', i === page));
    const prev = catFoot.querySelector('[data-cat-page="-1"]');
    const next = catFoot.querySelector('[data-cat-page="1"]');
    if (prev) prev.disabled = page <= 0;
    if (next) next.disabled = page >= dots.length - 1;
  }

  const currentPage = () => Math.round(grid.scrollLeft / (grid.clientWidth || 1));
  const goToPage = (n) => grid.scrollTo({ left: Math.max(0, n) * grid.clientWidth, behavior: 'smooth' });

  // On a desktop there is no swipe: the arrows, the dots and the mouse wheel
  // all move between pages.
  catFoot.addEventListener('click', (e) => {
    const step = e.target.closest('[data-cat-page]');
    if (step) return goToPage(currentPage() + Number(step.dataset.catPage));
    const dot = e.target.closest('[data-cat-goto]');
    if (dot) goToPage(Number(dot.dataset.catGoto));
  });
  let wheelLock = 0;
  grid.addEventListener(
    'wheel',
    (e) => {
      if (editing || grid.scrollWidth <= grid.clientWidth) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // sideways scrolling already works
      e.preventDefault();
      if (Date.now() < wheelLock) return;
      wheelLock = Date.now() + 350;
      goToPage(currentPage() + (e.deltaY > 0 ? 1 : -1));
    },
    { passive: false },
  );

  // Open the category editor, then come back to this entry exactly as it was.
  function editCategory(cat) {
    const keep = { ...draft, note: noteInput.value };
    openCategorySheet(cat, {
      type: draft.type,
      onDone: (result) => {
        if (result?.saved && !cat) keep.categoryId = result.saved; // a new one: select it
        if (result?.removed === keep.categoryId) keep.categoryId = lastUsed(keep.type);
        openEntrySheet(existing, keep, !!cat);
      },
    });
  }

  function paintDate() {
    sheet.querySelectorAll('.chip[data-date]').forEach((b) => {
      b.classList.toggle('on', b.dataset.date === draft.date);
    });
    const quick = draft.date === today || draft.date === addDays(today, -1);
    $('.date-chip').classList.toggle('on', !quick);
    $('.date-label').textContent = quick ? 'Other date' : dayLabel(draft.date);
    dateInput.value = draft.date;
  }

  // ---- Input ----

  function press(k) {
    let s = draft.amountStr;
    if (k === 'back') {
      s = s.slice(0, -1);
    } else if (k === '.') {
      if (!decimals || s.includes('.')) return;
      s = (s || '0') + '.';
    } else {
      const [whole, frac] = s.split('.');
      if (frac !== undefined) {
        if (frac.length >= decimals) return;
      } else if (whole.length >= 9) {
        return;
      }
      s = s === '0' ? k : s + k;
    }
    draft.amountStr = s;
    paintAmount();
    paintRing();
  }

  // ---- Photo ----
  // draft.photoData holds a newly chosen image; draft.photoId an already saved one.
  const photoAdd = $('.photo-add');
  const thumb = $('.photo-thumb');
  const photoView = $('.photo-view');

  // With no photo the camera chip is shown; with one, a small thumbnail takes
  // its place. Tapping the thumbnail opens the photo with Change and Remove.
  function paintPhoto(src) {
    photoAdd.hidden = !!src;
    thumb.hidden = !src;
    photoView.hidden = true;
    if (src) {
      thumb.querySelector('img').src = src;
      photoView.querySelector('img').src = src;
    }
  }

  if (draft.photoData) paintPhoto(draft.photoData);
  else if (draft.photoId) loadPhoto(draft.photoId).then((src) => src && !draft.photoRemoved && paintPhoto(src));

  async function choosePhoto(input) {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    try {
      draft.photoData = (await prepareImage(file, 1280)).preview;
      draft.photoRemoved = false;
      paintPhoto(draft.photoData);
    } catch {
      toast("That image couldn't be opened");
    }
  }
  $('.es-photo').addEventListener('change', (e) => choosePhoto(e.target));
  $('.es-photo2').addEventListener('change', (e) => choosePhoto(e.target));
  $('.photo-remove').addEventListener('click', () => {
    draft.photoData = null;
    draft.photoRemoved = true;
    paintPhoto(null);
  });
  thumb.addEventListener('click', () => {
    photoView.hidden = !photoView.hidden;
    if (!photoView.hidden) photoView.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  function shake(el) {
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
  }

  function save() {
    const amount = round2(parseFloat(draft.amountStr));
    if (!(amount > 0)) return shake(amountEl);
    if (!draft.categoryId) return shake(grid);
    const data = {
      type: draft.type,
      amount,
      categoryId: draft.categoryId,
      date: draft.date,
      note: noteInput.value.trim(),
    };
    // Save, replace or drop the photo.
    const oldPhoto = existing?.photoId || null;
    data.photoId = oldPhoto;
    if (draft.photoData) {
      data.photoId = uid();
      putPhoto(data.photoId, draft.photoData);
      if (oldPhoto) deletePhoto(oldPhoto);
    } else if (draft.photoRemoved && oldPhoto) {
      data.photoId = null;
      deletePhoto(oldPhoto);
    }
    if (draft.recurringId) data.recurringId = draft.recurringId;
    if (existing) updateEntry(existing.id, data);
    else addEntry(data);
    closeSheet();
    const c = categoryById(data.categoryId);
    toast(`${existing ? 'Updated' : 'Saved'} · ${money(amount, currency)} ${c ? c.name : ''}`);
  }

  function onKey(e) {
    if (e.key === 'Escape') return closeSheet();
    if (e.target === noteInput || e.target === dateInput) {
      if (e.key === 'Enter') e.target.blur();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === '.' || e.key === ',') press('.');
    else if (e.key === 'Backspace') press('back');
    else if (e.key === 'Enter') save();
    else return;
    e.preventDefault();
  }
  document.addEventListener('keydown', onKey);

  grid.addEventListener('scroll', paintDots, { passive: true });

  // ---- Drag to rearrange (edit mode only) ----
  // A press that moves more than a few pixels becomes a drag; otherwise it is
  // a tap and opens the editor as usual.
  let drag = null;
  let justDragged = false;

  grid.addEventListener('pointerdown', (e) => {
    const el = editing && e.target.closest('.cat[data-cat]');
    if (el) drag = { el, x: e.clientX, y: e.clientY, id: e.pointerId, moved: false };
  });

  grid.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return;
      drag.moved = true;
      drag.el.classList.add('dragging');
      grid.setPointerCapture(e.pointerId);
    }
    // Slot the tile in before or after whichever category the finger is over.
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.cat[data-cat]');
    if (over && over !== drag.el && grid.contains(over)) {
      const before = drag.el.getBoundingClientRect();
      const tiles = [...grid.querySelectorAll('.cat[data-cat]')];
      const forward = tiles.indexOf(drag.el) < tiles.indexOf(over);
      grid.insertBefore(drag.el, forward ? over.nextSibling : over);
      const after = drag.el.getBoundingClientRect();
      drag.x += after.left - before.left;
      drag.y += after.top - before.top;
    }
    drag.el.style.transform = `translate(${e.clientX - drag.x}px, ${e.clientY - drag.y}px) scale(1.08)`;
  });

  const endDrag = () => {
    if (!drag) return;
    if (drag.moved) {
      drag.el.classList.remove('dragging');
      drag.el.style.transform = '';
      justDragged = true;
      setTimeout(() => (justDragged = false), 80);
      // Removed categories shown for an old entry are not part of the saved order.
      const ids = [...grid.querySelectorAll('.cat[data-cat]')]
        .map((b) => b.dataset.cat)
        .filter((id) => !categoryById(id)?.archived);
      reorderCategories(draft.type, ids);
    }
    drag = null;
  };
  grid.addEventListener('pointerup', endDrag);
  grid.addEventListener('pointercancel', endDrag);

  sheet.addEventListener('click', (e) => {
    if (justDragged) return;
    const key = e.target.closest('[data-k]');
    if (key) return press(key.dataset.k);

    if (e.target.closest('.es-penny')) return pennySays(pennyLine());
    if (favAction(e)) return;

    const typeBtn = e.target.closest('.seg [data-type]');
    if (typeBtn && typeBtn.dataset.type !== draft.type) {
      draft.type = typeBtn.dataset.type;
      draft.categoryId =
        existing && existing.type === draft.type ? existing.categoryId : lastUsed(draft.type);
      paintType();
      paintCats();
      return;
    }

    const tool = e.target.closest('[data-cat-tool]');
    if (tool) {
      if (tool.dataset.catTool === 'add') return editCategory(null);
      editing = !editing;
      paintCats();
      return;
    }

    const catBtn = e.target.closest('[data-cat]');
    if (catBtn) {
      if (editing) return editCategory(categoryById(catBtn.dataset.cat));
      draft.categoryId = catBtn.dataset.cat;
      grid.querySelectorAll('.cat[data-cat]').forEach((b) => b.classList.toggle('on', b === catBtn));
      paintRing();
      return;
    }

    const dateBtn = e.target.closest('.chip[data-date]');
    if (dateBtn) {
      draft.date = dateBtn.dataset.date;
      paintDate();
      paintRing();
      return;
    }

    if (e.target.closest('.es-save')) return save();

    if (e.target.closest('[data-es="delete"]')) {
      const id = existing.id;
      deleteEntry(id);
      closeSheet();
      toast('Entry deleted', { action: 'Undo', onAction: () => restoreEntry(id) });
    }
  });

  dateInput.addEventListener('change', () => {
    if (dateInput.value) draft.date = dateInput.value;
    paintDate();
    paintRing();
  });

  paintAmount();
  paintType();
  paintCats();
  paintDate();
}
