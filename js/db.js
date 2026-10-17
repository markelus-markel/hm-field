// Локальное хранилище (IndexedDB). Всё пишется сразу, без сервера.
const DB_NAME = 'hm-field';
const DB_VER = 1;
let dbp = null;

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('kv');
        d.createObjectStore('photos', { keyPath: 'photo_id' });
        d.createObjectStore('log', { autoIncrement: true });
        d.createObjectStore('revisions', { keyPath: 'rev' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

function run(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let req;
    try { req = fn(s); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const kvGet = k => run('kv', 'readonly', s => s.get(k));
export const kvSet = (k, v) => run('kv', 'readwrite', s => s.put(v, k));
export const kvDelete = k => run('kv', 'readwrite', s => s.delete(k));
export const photoPut = rec => run('photos', 'readwrite', s => s.put(rec));
export const photoGet = id => run('photos', 'readonly', s => s.get(id));
export const photoAll = () => run('photos', 'readonly', s => s.getAll());
export const logAdd = e => run('log', 'readwrite', s => s.add(e));
export const logAll = () => run('log', 'readonly', s => s.getAll());
export const revPut = r => run('revisions', 'readwrite', s => s.put(r));
export const revAll = () => run('revisions', 'readonly', s => s.getAll());

export async function wipeAll() {
  const db = await open();
  await new Promise((resolve, reject) => {
    const t = db.transaction(['kv', 'photos', 'log', 'revisions'], 'readwrite');
    ['kv', 'photos', 'log', 'revisions'].forEach(n => t.objectStore(n).clear());
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}

// Замена всего содержимого (восстановление из резервной копии).
export async function replaceAll({ survey, photos, log, revisions }) {
  const db = await open();
  await new Promise((resolve, reject) => {
    const t = db.transaction(['kv', 'photos', 'log', 'revisions'], 'readwrite');
    ['kv', 'photos', 'log', 'revisions'].forEach(n => t.objectStore(n).clear());
    t.objectStore('kv').put(survey, 'survey');
    photos.forEach(p => t.objectStore('photos').put(p));
    log.forEach(e => t.objectStore('log').add(e));
    revisions.forEach(r => t.objectStore('revisions').put(r));
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
