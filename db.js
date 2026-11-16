// db.js – zentrale IndexedDB-Schnittstelle. Nur dieses Modul greift direkt auf IndexedDB zu.
// Grundsatz: Schemaänderungen nur über versionierte Migrationen; niemals Stores oder die Datenbank löschen.
import {
  normalizePantryItem, normalizeShoppingItem, normalizeSelectedRecipe, normalizeFavorite,
  normalizeSettings, normalizeProfile, normalizeRecipe,
} from './core/models.js';

export const DEFAULT_DB_NAME = 'vorratsfit-db';
export const DB_VERSION = 1;

export const STORE_NAMES = Object.freeze([
  'profile', 'pantry', 'favorites', 'customRecipes', 'cachedRecipes',
  'shoppingList', 'selectedRecipes', 'settings', 'metadata',
]);

/** Stores, die in Backups enthalten sind (metadata ist intern). */
export const BACKUP_STORES = Object.freeze([
  'profile', 'pantry', 'favorites', 'customRecipes', 'cachedRecipes', 'shoppingList', 'selectedRecipes', 'settings',
]);

export const STORE_NORMALIZERS = Object.freeze({
  profile: normalizeProfile,
  pantry: normalizePantryItem,
  favorites: normalizeFavorite,
  customRecipes: (r) => normalizeRecipe({ ...r, origin: 'custom' }),
  cachedRecipes: (r) => normalizeRecipe({ ...r, origin: 'external' }),
  shoppingList: normalizeShoppingItem,
  selectedRecipes: normalizeSelectedRecipe,
  settings: normalizeSettings,
});

const STORE_INDEXES = Object.freeze({
  pantry: [['normalizedName', 'normalizedName'], ['category', 'category']],
  shoppingList: [['normalizedName', 'normalizedName']],
});

/**
 * Versionierte Migrationen. Jede Migration darf nur ergänzen und Standardwerte setzen.
 * Beispiel für eine spätere Version 2:
 *   2: (db, tx) => migrateRecords(tx, 'shoppingList', normalizeShoppingItem)
 */
const MIGRATIONS = Object.freeze({
  1: (db) => {
    for (const name of STORE_NAMES) {
      if (!db.objectStoreNames.contains(name)) {
        const store = db.createObjectStore(name, { keyPath: 'id' });
        for (const [indexName, keyPath] of STORE_INDEXES[name] ?? []) {
          store.createIndex(indexName, keyPath, { unique: false });
        }
      }
    }
  },
});

/** Hilfsfunktion für künftige Migrationen: Datensätze mit sicheren Standardwerten ergänzen. */
export function migrateRecords(tx, storeName, normalizer) {
  const store = tx.objectStore(storeName);
  const req = store.openCursor();
  req.onsuccess = () => {
    const cursor = req.result;
    if (!cursor) return;
    cursor.update(normalizer(cursor.value));
    cursor.continue();
  };
}

let dbName = DEFAULT_DB_NAME;
let dbPromise = null;
const versionChangeListeners = new Set();

/** Nur für Tests: eigene Datenbank verwenden. */
export function configureDatabase(name) {
  if (dbPromise) closeDatabase();
  dbName = name || DEFAULT_DB_NAME;
}

export function getDatabaseName() {
  return dbName;
}

export function onVersionChange(listener) {
  versionChangeListeners.add(listener);
  return () => versionChangeListeners.delete(listener);
}

/** Schließt die Verbindung (Daten bleiben erhalten). */
export async function closeDatabase() {
  if (!dbPromise) return;
  const p = dbPromise;
  dbPromise = null;
  try { (await p).close(); } catch { /* war nicht geöffnet */ }
}

export function openDatabase() {
  if (dbPromise) return dbPromise;
  const thisPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB wird von diesem Browser nicht unterstützt.'));
      return;
    }
    let request;
    try {
      request = indexedDB.open(dbName, DB_VERSION);
    } catch (err) {
      reject(new Error(`Lokaler Speicher nicht verfügbar: ${err.message}`));
      return;
    }
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;
      const oldVersion = event.oldVersion || 0;
      for (let v = oldVersion + 1; v <= DB_VERSION; v += 1) {
        const migration = MIGRATIONS[v];
        if (migration) migration(db, tx);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Eine neuere App-Version in einem anderen Tab möchte migrieren: Verbindung schließen (Daten bleiben erhalten).
      db.onversionchange = () => {
        db.close();
        if (dbPromise === thisPromise) dbPromise = null;
        versionChangeListeners.forEach((fn) => { try { fn(); } catch { /* ignorieren */ } });
      };
      resolve(db);
    };
    request.onerror = () => {
      if (dbPromise === thisPromise) dbPromise = null;
      reject(new Error(`Datenbank konnte nicht geöffnet werden: ${request.error?.message ?? 'unbekannter Fehler'}`));
    };
    request.onblocked = () => {
      // Kein Löschen, nur Hinweis: anderer Tab blockiert das Upgrade.
      console.warn('VorratsFit: Datenbank-Upgrade wartet, bis andere Tabs geschlossen sind.');
    };
  });
  dbPromise = thisPromise;
  return dbPromise;
}

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function assertStore(name) {
  if (!STORE_NAMES.includes(name)) throw new Error(`Unbekannter Datenspeicher: ${name}`);
}

/**
 * Führt eine Funktion innerhalb einer IndexedDB-Transaktion aus.
 * In fn dürfen nur IndexedDB-Anfragen über das Hilfsobjekt abgewartet werden.
 * Wirft fn einen Fehler, wird die Transaktion vollständig zurückgerollt.
 */
export async function runTransaction(storeNames, mode, fn) {
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];
  names.forEach(assertStore);
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(names, mode);
    } catch (err) {
      reject(err);
      return;
    }
    let result;
    let failed = false;
    const helper = {
      get: (store, key) => promisify(tx.objectStore(store).get(key)),
      getAll: (store) => promisify(tx.objectStore(store).getAll()),
      put: (store, value) => promisify(tx.objectStore(store).put(value)),
      delete: (store, key) => promisify(tx.objectStore(store).delete(key)),
      clear: (store) => promisify(tx.objectStore(store).clear()),
      abort: () => { failed = true; tx.abort(); },
    };
    tx.oncomplete = () => (failed ? reject(new Error('Transaktion abgebrochen')) : resolve(result));
    tx.onabort = () => reject(tx.error ?? new Error('Transaktion abgebrochen'));
    tx.onerror = () => { /* onabort folgt */ };
    Promise.resolve()
      .then(() => fn(helper, tx))
      .then((value) => { result = value; })
      .catch((err) => {
        failed = true;
        try { tx.abort(); } catch { /* bereits beendet */ }
        reject(err);
      });
  });
}

export async function getItem(storeName, key) {
  return runTransaction([storeName], 'readonly', (t) => t.get(storeName, key));
}

export async function getAllItems(storeName) {
  return runTransaction([storeName], 'readonly', (t) => t.getAll(storeName));
}

export async function putItem(storeName, value) {
  await runTransaction([storeName], 'readwrite', (t) => t.put(storeName, value));
  return value;
}

export async function putItems(storeName, values) {
  await runTransaction([storeName], 'readwrite', async (t) => {
    for (const v of values) await t.put(storeName, v);
  });
  return values;
}

export async function deleteItem(storeName, key) {
  await runTransaction([storeName], 'readwrite', (t) => t.delete(storeName, key));
}

/** Leert einen Store. Nur für ausdrückliche Nutzeraktionen (z. B. "Ersetzen"-Import). */
export async function clearStore(storeName) {
  await runTransaction([storeName], 'readwrite', (t) => t.clear(storeName));
}

export async function exportAllData() {
  return runTransaction(BACKUP_STORES, 'readonly', async (t) => {
    const data = {};
    for (const name of BACKUP_STORES) data[name] = await t.getAll(name);
    return data;
  });
}

function newerOrEqual(a, b) {
  const ta = Date.parse(a?.updatedAt ?? '') || 0;
  const tb = Date.parse(b?.updatedAt ?? '') || 0;
  return ta >= tb;
}

/**
 * Importiert bereits validierte und normalisierte Daten in EINER Transaktion über alle Stores.
 * mode 'replace': betroffene Stores werden geleert und neu befüllt.
 * mode 'merge': neue Datensätze werden ergänzt; bei gleicher ID gewinnt der neuere Stand.
 * Schlägt etwas fehl, wird nichts verändert.
 */
export async function importAllData(data, mode = 'merge') {
  if (mode !== 'merge' && mode !== 'replace') throw new Error('Ungültiger Importmodus');
  const stats = { added: 0, updated: 0, kept: 0 };
  await runTransaction([...BACKUP_STORES, 'metadata'], 'readwrite', async (t) => {
    for (const name of BACKUP_STORES) {
      const records = Array.isArray(data[name]) ? data[name] : [];
      if (mode === 'replace') {
        await t.clear(name);
        for (const r of records) { await t.put(name, r); stats.added += 1; }
      } else {
        for (const r of records) {
          const existing = await t.get(name, r.id);
          if (!existing) { await t.put(name, r); stats.added += 1; } else if (newerOrEqual(r, existing)) { await t.put(name, r); stats.updated += 1; } else stats.kept += 1;
        }
      }
    }
    await t.put('metadata', { id: 'lastImport', mode, at: new Date().toISOString(), stats: { ...stats } });
  });
  return stats;
}

export async function getMeta(key) {
  const rec = await getItem('metadata', key);
  return rec ? rec.value : undefined;
}

export async function setMeta(key, value) {
  await putItem('metadata', { id: key, value, updatedAt: new Date().toISOString() });
}
