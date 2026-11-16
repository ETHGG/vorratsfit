// water.js – Wasser-Tracker (0.6). Ein Eintrag je Tag mit der Tagessumme in ml. Nur lokal in IndexedDB.
import { runTransaction } from './db.js';
import { normalizeWaterEntry, WATER_MAX_ML } from './core/models.js';
import { nowIso, isValidDateString } from './core/utils.js';

export const WATER_STEP_ML = 250;

export async function getWater(date) {
  if (!isValidDateString(date)) return 0;
  const row = await runTransaction(['waterLog'], 'readonly', (t) => t.get('waterLog', `water-${date}`));
  return row ? normalizeWaterEntry(row).ml : 0;
}

/** Menge ändern (positiv = getrunken, negativ = korrigieren). Ergebnis bleibt zwischen 0 und 10 l. */
export async function addWater(date, deltaMl) {
  if (!isValidDateString(date)) return { ok: false, ml: 0 };
  return runTransaction(['waterLog'], 'readwrite', async (t) => {
    const existing = await t.get('waterLog', `water-${date}`);
    const current = existing ? normalizeWaterEntry(existing).ml : 0;
    const ml = Math.min(WATER_MAX_ML, Math.max(0, current + Math.round(Number(deltaMl) || 0)));
    const entry = normalizeWaterEntry({ date, ml, createdAt: existing?.createdAt, updatedAt: nowIso() });
    await t.put('waterLog', entry);
    return { ok: true, ml };
  });
}

export async function listWaterRange(from, to) {
  const rows = await runTransaction(['waterLog'], 'readonly', (t) => t.getAllInRange('waterLog', 'date', from, to));
  return rows.map((r) => normalizeWaterEntry(r)).sort((a, b) => a.date.localeCompare(b.date));
}
