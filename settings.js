// settings.js – App-Einstellungen (IndexedDB) und kleine UI-Einstellungen (localStorage).
import { getItem, putItem, runTransaction, BACKUP_STORES, getMeta, setMeta } from './db.js';
import { normalizeSettings } from './core/models.js';
import { nowIso } from './core/utils.js';

const THEME_KEY = 'vorratsfit-theme';
export const THEMES = Object.freeze([{ id: 'system', label: 'Systemeinstellung' }, { id: 'light', label: 'Hell' }, { id: 'dark', label: 'Dunkel' }]);

export async function getSettings() {
  return normalizeSettings((await getItem('settings', 'app')) ?? {});
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const next = normalizeSettings({ ...current, ...patch, updatedAt: nowIso() });
  await putItem('settings', next);
  return next;
}

/** Theme liegt als kleine UI-Einstellung im localStorage (wird nie automatisch geleert). */
export function getTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return THEMES.some((t) => t.id === v) ? v : 'system';
  } catch {
    return 'system';
  }
}

export function setTheme(theme) {
  const t = THEMES.some((x) => x.id === theme) ? theme : 'system';
  try { localStorage.setItem(THEME_KEY, t); } catch { /* privater Modus: nur für diese Sitzung */ }
  applyTheme(t);
}

export function applyTheme(theme = getTheme()) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#14201b' : '#2f7d5b');
}

/** Löscht alle persönlichen Daten – NUR nach ausdrücklicher Bestätigung durch den Nutzer (eine Transaktion). */
export async function wipeAllPersonalData() {
  await runTransaction([...BACKUP_STORES, 'metadata'], 'readwrite', async (t) => {
    for (const name of BACKUP_STORES) await t.clear(name);
    // Geräteeinstellungen mit persönlichem Bezug (0.2): Häufigkeiten und Einkaufszeitraum.
    for (const key of ['pantryFrequency', 'shoppingRange', 'lastBackupAt']) await t.delete('metadata', key);
  });
}

export async function isPrivacyAcknowledged() {
  return !!(await getMeta('privacyAcknowledged'));
}

export async function acknowledgePrivacy() {
  await setMeta('privacyAcknowledged', new Date().toISOString());
}
