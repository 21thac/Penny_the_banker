// Penny, the AI helper: type, speak or send a screenshot, review the drafts, save.

import { getState, categoriesOf, categoryById, addEntry } from '../store.js';
import { on, openSheet, closeSheet, toast } from '../ui.js';
import { askPenny, prepareImage, hasKey, AIError } from '../ai.js';
import { mascot, bubble } from '../art.js';
import { esc, currencySymbol, round2 } from '../util.js';

const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

const EXAMPLES = ['lunch 12', 'taxi 8.50 yesterday', 'coffee 4 and groceries 36'];

on('assistant', () => openAssistant());

export function openAssistant({ voice = false } = {}) {
  const ready = hasKey();
  let busy = false;
  let image = null;
  let results = [];
  let rec = null;

  const sheet = openSheet(
    `
    <div class="es-head">
      <button class="icon-btn" data-action="sheet-close" aria-label="Close">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
      <span>Penny</span>
      <span class="icon-btn" aria-hidden="true"></span>
    </div>

    <div class="ai-body">
      <div class="ai-hello">
        ${mascot('bob')}
        <div class="speech" aria-live="polite"><span class="ai-say"></span></div>
      </div>
      <img class="ai-shot" alt="Your screenshot" hidden>
      ${
        ready
          ? `<div class="ai-examples">
               ${EXAMPLES.map((x) => `<button class="chip" data-example="${esc(x)}">${esc(x)}</button>`).join('')}
             </div>`
          : `<button class="btn primary" style="margin-top:18px" data-action="tab" data-tab="settings">Open Settings</button>`
      }
      <div class="ai-results"></div>
    </div>

    <div class="ai-foot">
      <button class="btn primary ai-save" hidden></button>
      <div class="ai-input">
        <input class="field ai-text" type="text" maxlength="400" autocomplete="off" enterkeyhint="send"
               placeholder="Tell me what you spent…" ${ready ? '' : 'disabled'}>
        <button class="sq go ai-send" aria-label="Send" ${ready ? '' : 'disabled'}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </button>
      </div>
      <div class="ai-tools">
        <label class="tool">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="3"/><circle cx="9.5" cy="10.5" r="1.5"/><path d="M5 17l5-4 3 2 3-3 4 4"/></svg>
          Screenshot
          <input class="ai-file" type="file" accept="image/*" aria-label="Choose a screenshot" ${ready ? '' : 'disabled'}>
        </label>
        <button class="tool ai-mic" ${ready ? '' : 'disabled'}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4"/></svg>
          <span>Speak</span>
        </button>
      </div>
    </div>
  `,
    {
      className: 'ai-sheet',
      onClose: () => {
        try {
          rec?.abort();
        } catch {
          /* already stopped */
        }
      },
    },
  );

  const $ = (sel) => sheet.querySelector(sel);
  const sayEl = $('.ai-say');
  const textInput = $('.ai-text');
  const sendBtn = $('.ai-send');
  const micBtn = $('.ai-mic');
  const fileInput = $('.ai-file');
  const shot = $('.ai-shot');
  const resultsEl = $('.ai-results');
  const saveBtn = $('.ai-save');
  const face = $('.mascot');
  const examples = $('.ai-examples');

  const say = (text) => (sayEl.textContent = text);

  function setBusy(v) {
    busy = v;
    face.classList.toggle('think', v);
    face.classList.toggle('bob', !v);
    [textInput, sendBtn, micBtn, fileInput].forEach((el) => (el.disabled = v));
  }

  // ---- Drafts to review ----

  function paintResults() {
    const currency = getState().settings.currency;
    const options = (selected) =>
      ['expense', 'income']
        .map((type) => {
          const cats = categoriesOf(type);
          if (!cats.length) return '';
          return `<optgroup label="${type === 'expense' ? 'Spending' : 'Income'}">
            ${cats.map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </optgroup>`;
        })
        .join('');

    resultsEl.innerHTML = results
      .map((r, i) => {
        const c = categoryById(r.categoryId);
        return `
        <div class="card prop" data-i="${i}">
          ${bubble(c)}
          <select class="select p-cat" aria-label="Category">${options(r.categoryId)}</select>
          <input class="field p-amt" type="text" inputmode="decimal" value="${r.amount}"
                 aria-label="Amount in ${esc(currencySymbol(currency))}">
          <div class="p-row2">
            <input class="field p-date" type="date" value="${r.date}" aria-label="Date">
            <input class="field p-note" type="text" maxlength="80" value="${esc(r.note)}" placeholder="Note" aria-label="Note">
            <button class="icon-btn sm danger p-del" aria-label="Remove this entry">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
            </button>
          </div>
        </div>`;
      })
      .join('');

    saveBtn.hidden = !results.length;
    saveBtn.textContent = results.length === 1 ? 'Save entry' : `Save all ${results.length} entries`;
    if (examples) examples.hidden = results.length > 0;
  }

  resultsEl.addEventListener('input', (e) => {
    const card = e.target.closest('.prop');
    if (!card) return;
    const r = results[Number(card.dataset.i)];
    if (e.target.matches('.p-amt')) r.amount = round2(parseFloat(e.target.value.replace(',', '.'))) || 0;
    if (e.target.matches('.p-date') && e.target.value) r.date = e.target.value;
    if (e.target.matches('.p-note')) r.note = e.target.value;
  });

  resultsEl.addEventListener('change', (e) => {
    if (!e.target.matches('.p-cat')) return;
    const r = results[Number(e.target.closest('.prop').dataset.i)];
    r.categoryId = e.target.value;
    r.type = categoryById(r.categoryId)?.type ?? r.type;
    paintResults();
  });

  resultsEl.addEventListener('click', (e) => {
    const del = e.target.closest('.p-del');
    if (!del) return;
    results.splice(Number(del.closest('.prop').dataset.i), 1);
    paintResults();
  });

  saveBtn.addEventListener('click', () => {
    const bad = results.findIndex((r) => !(r.amount > 0));
    if (bad >= 0) {
      const el = resultsEl.querySelector(`[data-i="${bad}"] .p-amt`);
      el.classList.add('invalid');
      el.focus();
      return;
    }
    results.forEach((r) =>
      addEntry({ type: r.type, amount: r.amount, categoryId: r.categoryId, date: r.date, note: r.note.trim() }),
    );
    const n = results.length;
    closeSheet();
    toast(n === 1 ? 'Saved 1 entry' : `Saved ${n} entries`);
  });

  // ---- Asking ----

  async function send() {
    if (busy || !ready) return;
    const text = textInput.value.trim();
    if (!text && !image) {
      textInput.focus();
      return;
    }
    setBusy(true);
    say(image ? 'Reading your screenshot…' : 'Let me jot that down…');
    try {
      const { reply, entries } = await askPenny({ text, image });
      // Add to any drafts already on screen, so several messages can be saved together.
      results = results.concat(entries);
      say(reply || (entries.length ? 'Here is what I found. Check it over!' : "I couldn't find an amount in that."));
      textInput.value = '';
      paintResults();
    } catch (err) {
      say(err instanceof AIError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      image = null;
      setBusy(false);
    }
  }

  async function takeImage(file) {
    if (!file || busy || !ready) return;
    try {
      image = await prepareImage(file);
      shot.src = image.preview;
      shot.hidden = false;
      send();
    } catch (err) {
      say(err.message);
    }
  }

  // ---- Voice ----

  function toggleMic() {
    if (rec) return rec.stop();
    if (!SpeechRec) {
      say("I can't listen in this browser. Tap the mic on your keyboard to dictate instead.");
      textInput.focus();
      return;
    }
    let heard = '';
    rec = new SpeechRec();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = true;
    rec.onresult = (e) => {
      heard = [...e.results].map((r) => r[0].transcript).join('');
      textInput.value = heard;
    };
    rec.onerror = (e) => {
      say(
        e.error === 'not-allowed' || e.error === 'service-not-allowed'
          ? 'I need permission to use the microphone before I can listen.'
          : "I didn't catch that. Tap Speak to try again.",
      );
    };
    rec.onend = () => {
      rec = null;
      micBtn.classList.remove('live');
      micBtn.querySelector('span').textContent = 'Speak';
      if (heard.trim()) send();
    };
    try {
      rec.start();
      micBtn.classList.add('live');
      micBtn.querySelector('span').textContent = 'Listening…';
      say("I'm listening. Tell me what you spent!");
    } catch {
      rec = null;
    }
  }

  // ---- Wiring ----

  sendBtn.addEventListener('click', send);
  micBtn.addEventListener('click', toggleMic);
  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') send();
    if (e.key === 'Escape') closeSheet();
  });
  fileInput.addEventListener('change', () => {
    takeImage(fileInput.files[0]);
    fileInput.value = '';
  });
  sheet.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (item) {
      e.preventDefault();
      takeImage(item.getAsFile());
    }
  });
  sheet.addEventListener('click', (e) => {
    const ex = e.target.closest('[data-example]');
    if (ex) {
      textInput.value = ex.dataset.example;
      textInput.focus();
    }
  });

  say(
    ready
      ? 'Hi! Tell me what you spent, say it out loud, or send me a screenshot.'
      : 'I need an AI key (Claude, GPT or DeepSeek) before I can help. Add one in Settings. It stays on this device.',
  );
  if (voice && ready) toggleMic();
}
