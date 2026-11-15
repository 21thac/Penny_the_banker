// Backup: everything in one file you can keep anywhere, and restore from.
// Includes entries, categories, budget, holdings, goals, saved reviews and
// photos. The Claude API key is deliberately left out.

import { getState, replaceState } from './store.js';
import { allPhotos, putPhoto } from './photos.js';
import { todayStr } from './util.js';

const REVIEWS = 'ledger.reviews';

// The whole backup as text.
export async function buildBackup() {
  const backup = {
    app: 'ledger',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: getState(),
    reviews: JSON.parse(localStorage.getItem(REVIEWS) || '{}'),
    photos: Object.fromEntries(await allPhotos()),
  };
  return {
    text: JSON.stringify(backup),
    entries: backup.data.entries.filter((e) => !e.deleted).length,
    photos: Object.keys(backup.photos).length,
  };
}

// Save the backup as a file. On a phone this opens the share sheet (Save to
// Files, AirDrop, email…); elsewhere it downloads. Returns how it was saved.
export async function exportBackup() {
  const { text, entries, photos } = await buildBackup();
  const name = `ledger-backup-${todayStr()}.json`;
  const file = new File([text], name, { type: 'application/json' });
  let how = 'downloaded';
  if (navigator.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ files: [file], title: 'Ledger backup' });
      how = 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return { cancelled: true };
      how = 'downloaded'; // sharing failed: fall through to a download
    }
  }
  if (how === 'downloaded') {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  return { how, name, entries, photos };
}

// Check that text is a backup and return it, without changing anything yet.
export function parseBackup(text) {
  let backup;
  try {
    backup = JSON.parse(text);
  } catch {
    throw new Error('Not a backup file');
  }
  if (backup?.app !== 'ledger' || !backup.data || !Array.isArray(backup.data.entries) || !Array.isArray(backup.data.categories)) {
    throw new Error('Not a backup file');
  }
  return backup;
}

export const readBackup = async (file) => parseBackup(await file.text());

export async function restoreBackup(backup) {
  replaceState(backup.data);
  if (backup.reviews) localStorage.setItem(REVIEWS, JSON.stringify(backup.reviews));
  await Promise.all(Object.entries(backup.photos || {}).map(([id, data]) => putPhoto(id, data)));
}
