// core/utils.js – reine Hilfsfunktionen ohne DOM- oder Datenbankzugriff.

/** Erzeugt eine UUID. Nutzt crypto.randomUUID, sonst eine robuste v4-Ersatzfunktion. */
export function uuid() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    // Letzter Ausweg: Zeit + Math.random. Nur für IDs, nicht für Sicherheit.
    let seed = Date.now() ^ Math.floor(performanceNow() * 1000);
    for (let i = 0; i < 16; i += 1) {
      seed = (seed * 1664525 + 1013904223 + Math.floor(Math.random() * 0xffffffff)) >>> 0;
      bytes[i] = seed & 0xff;
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function performanceNow() {
  return globalThis.performance && typeof globalThis.performance.now === 'function'
    ? globalThis.performance.now()
    : 0;
}

export function nowIso() {
  return new Date().toISOString();
}

/** Parst Zahlen inkl. deutschem Dezimalkomma. Gibt null bei ungültigen Werten zurück. */
export function parseNumber(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (typeof input !== 'string') return null;
  let s = input.trim().replace(/\s/g, '');
  if (!s) return null;
  // "1.250,5" -> "1250.5"; "1,5" -> "1.5"
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  if (!/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Begrenzt eine Zahl auf [min, max]. Ungültige Eingaben ergeben null. */
export function clampNumber(value, min, max) {
  const n = parseNumber(value);
  if (n === null) return null;
  return Math.min(max, Math.max(min, n));
}

/** Prüft, ob eine Zahl in einem Bereich liegt (ohne Begrenzung). */
export function inRange(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

export function roundTo(value, decimals = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const f = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/** Normalisiert Text für Vergleiche (Kleinschreibung, Leerzeichen, Satzzeichen). */
export function normalizeText(value) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[()[\]{}.,;:!?"'„“”‚‘’`´/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Entfernt Steuerzeichen, kürzt und trimmt Freitext. */
export function sanitizeText(value, maxLength = 200) {
  if (value === null || value === undefined) return '';
  const s = String(value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
    .trim();
  return s.length > maxLength ? s.slice(0, maxLength).trim() : s;
}

/** Mehrzeiliger Text (Zeilenumbrüche bleiben erhalten). */
export function sanitizeMultiline(value, maxLength = 5000) {
  const s = sanitizeText(String(value ?? '').replace(/\r\n?/g, '\n'), maxLength);
  return s.replace(/\n{3,}/g, '\n\n');
}

/** Erlaubt nur http(s)-URLs, optional nur bestimmte Hosts. */
export function isSafeHttpUrl(url, allowedHosts = null) {
  if (typeof url !== 'string' || url.length > 2000) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    if (u.username || u.password) return false;
    if (Array.isArray(allowedHosts) && allowedHosts.length) {
      return allowedHosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
    }
    return true;
  } catch {
    return false;
  }
}

/** Prüft ein Datum im Format JJJJ-MM-TT. */
export function isValidDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (y < 1900 || y > 2200) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function todayString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Tage bis zu einem Datum (negativ = abgelaufen). */
export function daysUntil(dateString, today = todayString()) {
  if (!isValidDateString(dateString) || !isValidDateString(today)) return null;
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${dateString}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

/**
 * Kanonische JSON-Serialisierung: Objektschlüssel sortiert, undefined entfällt,
 * nicht-endliche Zahlen werden zu null. Grundlage für Prüfsummen.
 */
export function canonicalStringify(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? 'null' : canonicalStringify(v))).join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(',')}}`;
  }
  return 'null';
}

export function deepClone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function unique(array) {
  return Array.from(new Set(array));
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
