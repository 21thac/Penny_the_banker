// Shared UI plumbing: click actions, sheets (modals), toasts, re-render hook.

// ---- Click actions: <button data-action="name"> ----

const actions = new Map();
export const on = (name, fn) => actions.set(name, fn);

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = actions.get(el.dataset.action);
  if (fn) fn(el, e);
});

// ---- Re-render hook (set by app.js) ----

let renderer = () => {};
export const setRenderer = (fn) => (renderer = fn);
export const refresh = () => renderer();

// ---- Sheets ----

let current = null;

export function openSheet(html, { onClose, className = '' } = {}) {
  closeSheet();
  const wrap = document.createElement('div');
  wrap.className = 'sheet-backdrop';
  wrap.innerHTML = `<div class="sheet ${className}" role="dialog" aria-modal="true">${html}</div>`;
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) closeSheet();
  });
  document.getElementById('sheet-root').appendChild(wrap);
  document.body.classList.add('sheet-open');
  current = { wrap, onClose };
  return wrap.firstElementChild;
}

export function closeSheet() {
  if (!current) return;
  const c = current;
  current = null;
  c.wrap.remove();
  document.body.classList.remove('sheet-open');
  c.onClose?.();
}

export const sheetOpen = () => !!current;

on('sheet-close', closeSheet);

// ---- Toasts ----

let toastTimer = null;

export function toast(message, { action, onAction } = {}) {
  const root = document.getElementById('toast-root');
  root.innerHTML = '';
  clearTimeout(toastTimer);
  const el = document.createElement('div');
  el.className = 'toast';
  const text = document.createElement('span');
  text.textContent = message;
  el.appendChild(text);
  if (action) {
    const btn = document.createElement('button');
    btn.textContent = action;
    btn.addEventListener('click', () => {
      root.innerHTML = '';
      onAction?.();
    });
    el.appendChild(btn);
  }
  root.appendChild(el);
  toastTimer = setTimeout(() => (root.innerHTML = ''), action ? 5000 : 2200);
}
