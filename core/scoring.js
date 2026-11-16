// core/scoring.js – Vorratsabgleich und Rezeptbewertung (max. 100 Punkte). Reine Funktionen.
import { scaleAmount, computeToBuy, normalizeUnit } from '../units.js';
import { ingredientKey, catalogEntryFor, EMPTY_CATALOG } from './catalog.js';
import { daysUntil, todayString, roundTo } from './utils.js';
import { dislikedIngredients, likedMatches } from './restrictions.js';

export const SCORE_WEIGHTS = Object.freeze({ pantry: 40, calories: 15, protein: 15, time: 10, devices: 5, preferences: 5, expiring: 10 });
const SPICE_WEIGHT = 0.25;

/** Skaliert alle Zutaten eines Rezepts auf die gewünschte Portionszahl (immer VOR dem Vorratsvergleich). */
export function scaleRecipe(recipe, servings) {
  const base = recipe.defaultServings;
  const target = servings > 0 ? servings : base;
  const scale = (list, isSpice) => (list ?? []).map((ing) => ({
    ...ing,
    isSpice,
    originalAmount: ing.amount,
    amount: typeof ing.amount === 'number' ? scaleAmount(ing.amount, base, target) : null,
  }));
  return { ...recipe, servings: target, ingredients: scale(recipe.ingredients, false), spices: scale(recipe.spices, true) };
}

/** Gruppiert den Vorrat nach Zutatenschlüssel. */
export function indexPantry(pantry, catalog = EMPTY_CATALOG) {
  const map = new Map();
  for (const item of pantry ?? []) {
    const key = ingredientKey(item, catalog);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function expiringInfo(entries, today, warnDays) {
  let min = null;
  for (const e of entries) {
    if (!e.expiryDate || !(e.amount > 0)) continue;
    const d = daysUntil(e.expiryDate, today);
    if (d !== null && (min === null || d < min)) min = d;
  }
  return min !== null && min <= warnDays ? min : null;
}

/**
 * Vergleicht ein (bereits skaliertes) Rezept mit dem Vorrat.
 * Status je Zutat: available | insufficient | missing | check | substitute
 */
export function evaluateAgainstPantry(scaledRecipe, pantry, catalog = EMPTY_CATALOG, { today = todayString(), warnDays = 3, pantryIndex = null } = {}) {
  const index = pantryIndex ?? indexPantry(pantry, catalog);
  const items = [];
  const all = [...(scaledRecipe.ingredients ?? []), ...(scaledRecipe.spices ?? [])];
  for (const ing of all) {
    const key = ingredientKey(ing, catalog);
    const entry = catalogEntryFor(ing, catalog);
    const entries = (index.get(key) ?? []).filter((e) => e.amount > 0);
    const unit = normalizeUnit(ing.unit);
    let status;
    let calc = null;
    if (!entries.length) {
      status = 'missing';
    } else if (!unit || typeof ing.amount !== 'number') {
      status = ing.isSpice ? 'available' : 'check';
    } else {
      calc = computeToBuy(ing.amount, unit, entries, entry);
      // Gewürze in kleinen Löffelmaßen: Ist das Gewürz vorrätig, gilt es als vorhanden.
      if (calc.status === 'check' && ing.isSpice) status = 'available';
      else if (calc.status === 'check') status = 'check';
      else if (calc.toBuy === 0) status = 'available';
      else if (calc.available > 0) status = 'insufficient';
      else status = 'missing';
    }
    let substitute = null;
    if ((status === 'missing' || status === 'insufficient') && ing.substitutes?.length) {
      for (const name of ing.substitutes) {
        const subKey = ingredientKey({ name }, catalog);
        const subEntries = (index.get(subKey) ?? []).filter((e) => e.amount > 0);
        if (!subEntries.length) continue;
        const subEntry = catalogEntryFor({ name }, catalog);
        const subCalc = unit && typeof ing.amount === 'number' ? computeToBuy(ing.amount, unit, subEntries, subEntry) : null;
        if (subCalc && subCalc.status === 'ok' && subCalc.toBuy === 0) { substitute = subEntries[0].name; status = 'substitute'; break; }
      }
    }
    items.push({
      ...ing,
      key,
      status,
      available: calc?.available ?? (entries.length ? null : 0),
      toBuy: calc?.toBuy ?? (status === 'missing' ? ing.amount : null),
      substitute,
      expiringInDays: entries.length ? expiringInfo(entries, today, warnDays) : null,
    });
  }

  let weightSum = 0;
  let credit = 0;
  for (const it of items) {
    if (it.optional) continue;
    const w = it.isSpice ? SPICE_WEIGHT : 1;
    weightSum += w;
    if (it.status === 'available' || it.status === 'substitute') credit += w;
    else if (it.status === 'insufficient' && typeof it.available === 'number' && it.amount > 0) credit += w * Math.min(0.9, it.available / it.amount);
    else if (it.status === 'check') credit += w * 0.5;
  }
  const main = items.filter((i) => !i.isSpice && !i.optional);
  const spices = items.filter((i) => i.isSpice && !i.optional);
  const isShort = (i) => i.status === 'missing' || i.status === 'insufficient';
  const counts = {
    total: main.length,
    available: main.filter((i) => i.status === 'available' || i.status === 'substitute').length,
    insufficient: main.filter((i) => i.status === 'insufficient').length,
    missing: main.filter((i) => i.status === 'missing').length,
    check: main.filter((i) => i.status === 'check').length,
    spicesMissing: spices.filter(isShort).length,
  };
  return {
    items,
    counts,
    matchRatio: weightSum ? credit / weightSum : 0,
    matchPercent: weightSum ? Math.round((credit / weightSum) * 100) : 0,
    missingCount: counts.missing + counts.insufficient,
    fullyCookable: main.every((i) => !isShort(i) && i.status !== 'check'),
  };
}

/**
 * Bewertet ein Rezept (0–100). Allergien/harte Regeln müssen VORHER geprüft sein.
 */
export function scoreRecipe(recipe, { profile = null, mealTargets = null, evaluation, catalog = EMPTY_CATALOG } = {}) {
  const parts = {};
  parts.pantry = SCORE_WEIGHTS.pantry * (evaluation?.matchRatio ?? 0);

  const n = recipe.nutritionPerServing;
  if (mealTargets && n && typeof n.kcal === 'number') {
    const diff = Math.abs(n.kcal - mealTargets.kcal) / Math.max(1, mealTargets.kcal);
    parts.calories = SCORE_WEIGHTS.calories * Math.max(0, 1 - diff / 0.5);
  } else parts.calories = SCORE_WEIGHTS.calories / 2;

  if (mealTargets && n && typeof n.protein === 'number') {
    parts.protein = SCORE_WEIGHTS.protein * Math.min(1, n.protein / Math.max(1, mealTargets.protein));
  } else parts.protein = SCORE_WEIGHTS.protein / 2;

  const maxMin = profile?.maxCookingMinutes > 0 ? profile.maxCookingMinutes : 30;
  const total = recipe.totalMinutes;
  if (typeof total === 'number' && total >= 0) {
    parts.time = total <= maxMin ? SCORE_WEIGHTS.time * (1 - 0.4 * (total / maxMin)) : Math.max(0, SCORE_WEIGHTS.time * 0.5 - (total - maxMin) / 5);
  } else parts.time = 0;

  const devices = profile?.devices ?? null;
  const needed = recipe.devices ?? [];
  const missingDevices = devices ? needed.filter((d) => !devices.includes(d)) : [];
  parts.devices = !devices ? SCORE_WEIGHTS.devices / 2 : missingDevices.length === 0 ? SCORE_WEIGHTS.devices : 0;

  const likes = likedMatches(recipe, profile, catalog);
  const dislikes = dislikedIngredients(recipe, profile, catalog);
  const dietPrefs = profile?.diets ?? [];
  let pref = 0;
  pref += Math.min(2, likes.length) * 2.5;
  if (dietPrefs.includes('proteinreich') && recipe.dietaryTags?.includes('proteinreich')) pref += 2.5;
  if (dietPrefs.includes('lowcarb') && recipe.dietaryTags?.includes('Low Carb')) pref += 2.5;
  pref -= dislikes.length * 5;
  parts.preferences = Math.max(0, Math.min(SCORE_WEIGHTS.preferences, pref));

  let exp = 0;
  for (const it of evaluation?.items ?? []) {
    if (it.expiringInDays === null || it.expiringInDays === undefined || it.isSpice) continue;
    exp += it.expiringInDays <= 1 ? 6 : 4;
  }
  parts.expiring = Math.min(SCORE_WEIGHTS.expiring, exp);

  const totalScore = Object.values(parts).reduce((a, b) => a + b, 0);
  return {
    total: Math.round(Math.max(0, Math.min(100, totalScore))),
    parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, roundTo(v, 1)])),
    missingDevices,
    likes,
    dislikes,
  };
}

/** Kurzer, verständlicher Empfehlungstext. */
export function recommendationText(evaluation, score) {
  if (!evaluation) return '';
  const parts = [];
  if (evaluation.fullyCookable) parts.push('Alle Hauptzutaten sind vorrätig.');
  else if (evaluation.missingCount === 1) parts.push('Es fehlt nur eine Zutat.');
  else parts.push(`Es fehlen ${evaluation.missingCount} Zutaten.`);
  if (evaluation.items.some((i) => i.expiringInDays !== null && !i.isSpice)) parts.push('Verwendet bald ablaufende Lebensmittel.');
  if (score?.missingDevices?.length) parts.push('Benötigt ein Gerät, das nicht in deinem Profil steht.');
  if (score?.dislikes?.length) parts.push(`Enthält Abneigung: ${score.dislikes.join(', ')}.`);
  return parts.join(' ');
}
