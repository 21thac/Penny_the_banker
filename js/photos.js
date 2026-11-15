// Photos attached to entries (a receipt, the thing you bought). They are kept
// in the browser's IndexedDB, which has room for images, and referenced from
// an entry by id. The sync step uploads them to the user's Google Drive.

const DB = 'ledger-photos';
const STORE = 'photos';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

// dataUrl: a compressed JPEG as a data: URL.
export const putPhoto = (id, dataUrl) => run('readwrite', (s) => s.put(dataUrl, id));
export const deletePhoto = (id) => run('readwrite', (s) => s.delete(id)).catch(() => {});
// Remove stored photos that no entry points to any more.
export async function sweepPhotos(keepIds) {
  try {
    const keys = await run('readonly', (s) => s.getAllKeys());
    await Promise.all((keys || []).filter((k) => !keepIds.has(k)).map(deletePhoto));
  } catch {
    /* nothing to clean */
  }
}

// Every stored photo as [id, dataUrl], for backups.
export async function allPhotos() {
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const out = [];
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve(out);
        out.push([cur.key, cur.value]);
        cur.continue();
      };
      req.onerror = () => resolve(out);
    });
  } catch {
    return [];
  }
}

export const getPhoto = (id) => run('readonly', (s) => s.get(id)).catch(() => null);
