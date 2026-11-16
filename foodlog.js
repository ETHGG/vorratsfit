// foodlog.js – Ernährungstagebuch und Schnell-Lebensmittel in IndexedDB.
// „Gegessen“ schreibt NUR ins Tagebuch und verändert nie den Vorrat (CLAUDE.md 4.2).
import { runTransaction } from './db.js';
import { normalizeFoodLogEntry, normalizeQuickFood, normalizeMealPlanEntry } from './core/models.js';
import { recipeNutritionFor, logDateTime } from './core/day-balance.js';
import { nowIso, uuid, sanitizeText, parseNumber, isValidDateString } from './core/utils.js';
import { recentFoods as pickRecent } from './core/food.js';

const inFlight = new Set();

export async function listFoodLog(date) {
  const rows = await runTransaction(['foodLog'], 'readonly', (t) => t.getAllInRange('foodLog', 'date', date, date));
  return rows.map((r) => normalizeFoodLogEntry(r)).sort((a, b) => (a.time ?? '').localeCompare(b.time ?? '') || a.createdAt.localeCompare(b.createdAt));
}

/** Plan-Eintrag als gegessen markieren (1 Portion als Kopie ins Tagebuch). Idempotent. */
export async function markPlanEaten(id, ctx, { portions = 1, now = new Date() } = {}) {
  const key = `eat:${id}`;
  if (inFlight.has(key)) return { status: 'busy' };
  inFlight.add(key);
  try {
    return await runTransaction(['mealPlan', 'foodLog'], 'readwrite', async (t) => {
      const raw = await t.get('mealPlan', id);
      if (!raw) throw new Error('Eintrag nicht gefunden.');
      const entry = normalizeMealPlanEntry(raw);
      if (entry.eaten) return { status: 'already' };
      let groupCooked = entry.cooked;
      if (entry.mealPrepGroupId && !groupCooked) {
        const boxes = await t.getAllInRange('mealPlan', 'mealPrepGroupId', entry.mealPrepGroupId, entry.mealPrepGroupId);
        groupCooked = boxes.some((b) => b.cooked);
      }
      const recipe = ctx.recipesById.get(entry.recipeId);
      const n = recipeNutritionFor(recipe, ctx.profile, ctx.catalog).perServing;
      const { time } = logDateTime(now);
      const log = normalizeFoodLogEntry({
        id: uuid(), date: entry.date ?? logDateTime(now).date, time, source: 'plan', refId: entry.id,
        name: recipe?.title ?? entry.recipeTitle, kcal: n?.kcal, protein: n?.protein, carbs: n?.carbs, fat: n?.fat, fiber: n?.fiber,
        portions: parseNumber(portions) ?? 1,
      });
      await t.put('foodLog', log);
      await t.put('mealPlan', { ...entry, eaten: true, updatedAt: nowIso() });
      return { status: 'logged', log, notCookedYet: !!entry.mealPrepGroupId && !groupCooked };
    });
  } finally {
    inFlight.delete(key);
  }
}

/** Schnell erfassen (Standard- oder eigenes Schnell-Lebensmittel). Werte werden kopiert. */
export async function logQuickFood(food, { date = null, portions = 1, now = new Date() } = {}) {
  const dt = logDateTime(now);
  const log = normalizeFoodLogEntry({
    id: uuid(), date: isValidDateString(date) ? date : dt.date, time: dt.time, source: 'quick', refId: food.id ?? null,
    name: food.name, kcal: food.kcal, protein: food.protein, carbs: food.carbs, fat: food.fat, portions,
  });
  await runTransaction(['foodLog'], 'readwrite', (t) => t.put('foodLog', log));
  return log;
}

export async function setFoodLogPortions(id, portions) {
  const n = parseNumber(portions);
  if (n === null || n <= 0 || n > 50) return { ok: false, error: 'Portionen: mehr als 0 und höchstens 50.' };
  return runTransaction(['foodLog'], 'readwrite', async (t) => {
    const raw = await t.get('foodLog', id);
    if (!raw) return { ok: false, error: 'Eintrag nicht gefunden.' };
    await t.put('foodLog', { ...raw, portions: n, updatedAt: nowIso() });
    return { ok: true };
  });
}

/** Tagebucheintrag löschen. Stammt er aus dem Plan, gilt die Mahlzeit wieder als „nicht gegessen“. */
export async function deleteFoodLog(id) {
  return runTransaction(['foodLog', 'mealPlan'], 'readwrite', async (t) => {
    const raw = await t.get('foodLog', id);
    if (!raw) return { ok: false };
    await t.delete('foodLog', id);
    if (raw.source === 'plan' && raw.refId) {
      const e = await t.get('mealPlan', raw.refId);
      if (e) await t.put('mealPlan', { ...e, eaten: false, updatedAt: nowIso() });
    }
    return { ok: true };
  });
}

// ---------- Eigene Schnell-Lebensmittel ----------
export async function listQuickFoods() {
  const rows = await runTransaction(['quickFoods'], 'readonly', (t) => t.getAll('quickFoods'));
  return rows.map((r) => normalizeQuickFood(r)).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

export async function saveQuickFood(input) {
  const errors = {};
  const name = sanitizeText(input.name, 80);
  if (!name) errors.name = 'Bitte gib einen Namen ein.';
  for (const k of ['kcal', 'protein']) {
    const raw = input[k];
    if (raw === '' || raw === null || raw === undefined) continue;
    const n = parseNumber(typeof raw === 'number' ? raw : String(raw));
    if (n === null || n < 0 || n > 5000) errors[k] = `${k === 'kcal' ? 'Kalorien' : 'Protein'}: Zahl zwischen 0 und 5000.`;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return runTransaction(['quickFoods'], 'readwrite', async (t) => {
    const existing = input.id ? await t.get('quickFoods', input.id) : null;
    const item = normalizeQuickFood({ ...input, id: input.id || uuid(), name, createdAt: existing?.createdAt, updatedAt: nowIso() });
    await t.put('quickFoods', item);
    return { ok: true, item };
  });
}

export async function deleteQuickFood(id) {
  await runTransaction(['quickFoods'], 'readwrite', (t) => t.delete('quickFoods', id));
}

// ---------- Freies Ess-Tracking (0.3) ----------
/** Beliebiges Lebensmittel erfassen (Werte für die erfasste Menge, als Kopie). Verändert nie den Vorrat. */
export async function logFood({ name, kcal, protein = null, carbs = null, fat = null, fiber = null, amountLabel = null }, { date = null, now = new Date() } = {}) {
  const dt = logDateTime(now);
  const log = normalizeFoodLogEntry({
    id: uuid(), date: isValidDateString(date) ? date : dt.date, time: dt.time, source: 'food',
    name, kcal, protein, carbs, fat, fiber, amountLabel, portions: 1,
  });
  await runTransaction(['foodLog'], 'readwrite', (t) => t.put('foodLog', log));
  return log;
}

/** Einträge eines Zeitraums (über den Datums-Index). */
export async function listFoodLogRange(from, to) {
  const rows = await runTransaction(['foodLog'], 'readonly', (t) => t.getAllInRange('foodLog', 'date', from, to));
  return rows.map((r) => normalizeFoodLogEntry(r));
}

/** „Zuletzt gegessen“ aus den letzten 30 Tagen (ohne Plan-Mahlzeiten). */
export async function listRecentFoods(today, limit = 8) {
  const [y, m, d] = today.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1, d - 30)).toISOString().slice(0, 10);
  return pickRecent(await listFoodLogRange(from, today), limit);
}
