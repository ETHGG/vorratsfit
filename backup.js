// backup.js – Backup-Format, Prüfsumme (SHA-256), Base64URL-Code, Validierung, Migration und Import.
import { canonicalStringify, isPlainObject } from './core/utils.js';
import { APP_VERSION } from './core/models.js';
import { exportAllData, importAllData, BACKUP_STORES, STORE_NORMALIZERS, getMeta, setMeta } from './db.js';

export const BACKUP_FORMAT = 'vorratsfit-backup';
export const BACKUP_VERSION = 3;
export const MAX_INPUT_CHARS = 8_000_000; // ca. 8 MB Text
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const LONG_CODE_THRESHOLD = 60_000; // darüber besser als JSON-Datei übertragen
const MAX_RECORDS_PER_STORE = 20_000;

export async function sha256Hex(text) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Web Crypto API (SHA-256) ist in diesem Kontext nicht verfügbar. Bitte die App über HTTPS oder localhost öffnen.');
  const bytes = new TextEncoder().encode(text);
  const hash = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createBackupObject(data, appVersion = APP_VERSION) {
  const clean = {};
  for (const name of BACKUP_STORES) if (Array.isArray(data?.[name])) clean[name] = data[name];
  return {
    format: BACKUP_FORMAT,
    backupVersion: BACKUP_VERSION,
    appVersion,
    createdAt: new Date().toISOString(),
    data: clean,
    checksum: await sha256Hex(canonicalStringify(clean)),
  };
}

function bytesToBase64Url(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(code) {
  const clean = code.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9_-]+$/.test(clean)) throw new Error('Der Backup-Code enthält ungültige Zeichen.');
  const b64 = clean.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((clean.length + 3) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** JSON → UTF-8 → Base64URL */
export function encodeBackupCode(backup) {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(backup)));
}

export function decodeBackupCode(code) {
  const bytes = base64UrlToBytes(code);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return JSON.parse(text);
}

/**
 * Migrationen alter Backup-Versionen auf die aktuelle Struktur.
 * Version 0 = Vorabformat (Einkaufsliste hieß "shopping", Auswahl "selected").
 */
const BACKUP_MIGRATIONS = {
  0: (data) => {
    const out = { ...data };
    if (Array.isArray(data.shopping) && !data.shoppingList) out.shoppingList = data.shopping;
    if (Array.isArray(data.selected) && !data.selectedRecipes) out.selectedRecipes = data.selected;
    delete out.shopping;
    delete out.selected;
    return out;
  },
  // 1 → 2 (0.2): neue Bereiche ergänzen. Bestehende Daten bleiben unverändert.
  1: (data) => ({ ...data, mealPlan: data.mealPlan ?? [], foodLog: data.foodLog ?? [], quickFoods: data.quickFoods ?? [] }),
  // 2 → 3 (0.3): Gewichtsverlauf ergänzen.
  2: (data) => ({ ...data, weightLog: data.weightLog ?? [] }),
};

/** Entfernt gefährliche Schlüssel (Prototyp-Verschmutzung) rekursiv. */
function stripDangerousKeys(value, depth = 0) {
  if (depth > 20) throw new Error('Die Datenstruktur ist zu tief verschachtelt.');
  if (Array.isArray(value)) return value.map((v) => stripDangerousKeys(v, depth + 1));
  if (isPlainObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      out[k] = stripDangerousKeys(v, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Validiert, prüft die Prüfsumme, migriert und normalisiert ein Backup.
 * Gibt {ok, errors, data, meta} zurück – importiert NICHTS.
 */
export async function parseBackupInput(input) {
  const errors = [];
  if (typeof input !== 'string' || !input.trim()) return { ok: false, errors: ['Es wurde kein Backup eingegeben.'] };
  if (input.length > MAX_INPUT_CHARS) return { ok: false, errors: ['Das Backup ist zu groß.'] };
  const text = input.trim();
  let obj;
  try {
    obj = text.startsWith('{') ? JSON.parse(text) : decodeBackupCode(text);
  } catch {
    return { ok: false, errors: ['Das Backup konnte nicht gelesen werden. Bitte prüfe, ob der Code vollständig kopiert wurde.'] };
  }
  if (!isPlainObject(obj)) return { ok: false, errors: ['Ungültiges Backup-Format.'] };
  if (obj.format !== BACKUP_FORMAT) return { ok: false, errors: ['Dies ist kein VorratsFit-Backup.'] };
  const version = obj.backupVersion;
  if (!Number.isInteger(version) || version < 0) return { ok: false, errors: ['Die Backup-Version ist ungültig.'] };
  if (version > BACKUP_VERSION) return { ok: false, errors: [`Das Backup stammt aus einer neueren App-Version (Backup-Version ${version}). Bitte aktualisiere VorratsFit zuerst.`] };
  if (!isPlainObject(obj.data)) return { ok: false, errors: ['Das Backup enthält keine Daten.'] };
  if (typeof obj.checksum !== 'string' || !/^[0-9a-f]{64}$/.test(obj.checksum)) return { ok: false, errors: ['Die Prüfsumme fehlt oder ist ungültig.'] };

  const actual = await sha256Hex(canonicalStringify(obj.data));
  if (actual !== obj.checksum) {
    return { ok: false, errors: ['Die Prüfsumme stimmt nicht. Das Backup ist beschädigt oder wurde verändert und wird nicht importiert.'] };
  }

  let data = stripDangerousKeys(obj.data);
  for (let v = version; v < BACKUP_VERSION; v += 1) {
    if (BACKUP_MIGRATIONS[v]) data = BACKUP_MIGRATIONS[v](data);
  }

  const normalized = {};
  for (const name of BACKUP_STORES) {
    const records = data[name];
    if (records === undefined) { normalized[name] = []; continue; }
    if (!Array.isArray(records)) { errors.push(`Bereich „${name}“ hat ein ungültiges Format.`); continue; }
    if (records.length > MAX_RECORDS_PER_STORE) { errors.push(`Bereich „${name}“ enthält zu viele Einträge.`); continue; }
    const out = [];
    for (const r of records) {
      if (!isPlainObject(r)) { errors.push(`Bereich „${name}“ enthält einen ungültigen Eintrag.`); break; }
      try { out.push(STORE_NORMALIZERS[name](r)); } catch { errors.push(`Ein Eintrag in „${name}“ konnte nicht gelesen werden.`); break; }
    }
    normalized[name] = out;
  }
  if (errors.length) return { ok: false, errors };
  normalized.profile = normalized.profile.slice(-1);
  normalized.settings = normalized.settings.slice(-1);
  return {
    ok: true,
    errors: [],
    data: normalized,
    meta: { backupVersion: version, appVersion: typeof obj.appVersion === 'string' ? obj.appVersion.slice(0, 20) : 'unbekannt', createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : null, migrated: version < BACKUP_VERSION },
  };
}

/** Importvorschau: Anzahl je Bereich, neu vs. vorhanden. */
export function buildImportPreview(incoming, current) {
  const rows = [];
  for (const name of BACKUP_STORES) {
    const inc = incoming[name] ?? [];
    const cur = current[name] ?? [];
    const curIds = new Set(cur.map((r) => r.id));
    rows.push({ store: name, incoming: inc.length, current: cur.length, newRecords: inc.filter((r) => !curIds.has(r.id)).length, overlapping: inc.filter((r) => curIds.has(r.id)).length });
  }
  return rows;
}

export const STORE_LABELS = Object.freeze({
  profile: 'Profil', pantry: 'Vorrat (inkl. Gewürze)', favorites: 'Favoriten', customRecipes: 'Eigene Rezepte',
  cachedRecipes: 'Gespeicherte Online-Rezepte', shoppingList: 'Einkaufsliste', selectedRecipes: 'Ausgewählte Rezepte und Portionen', settings: 'Einstellungen',
  mealPlan: 'Wochenplan', foodLog: 'Ernährungstagebuch', quickFoods: 'Schnell-Lebensmittel', weightLog: 'Gewichtsverlauf',
});

export async function createBackupFromDatabase() {
  const data = await exportAllData();
  return createBackupObject(data);
}

export async function readCurrentData() {
  return exportAllData();
}

/** Transaktionssicherer Import (alles oder nichts). */
export async function applyImport(normalizedData, mode) {
  return importAllData(normalizedData, mode);
}

export function backupFileName(date = new Date()) {
  const d = date.toISOString().slice(0, 10);
  return `vorratsfit-backup-${d}.json`;
}

export async function markBackupCreated(createdAt) {
  await setMeta('lastBackupAt', createdAt);
}

export async function getLastBackupDate() {
  return getMeta('lastBackupAt');
}
