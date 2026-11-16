// core/day-balance.js – Tagesbilanz (Ziel, geplant, gegessen, Rest). Rein, ohne DOM und Datenbank.
// Unbekannte Nährwerte werden nie als 0 gezählt; der Tag gilt dann als „unvollständig“ (CLAUDE.md 4.6).
import { checkRecipe } from './restrictions.js';
import { computeRecipeNutrition } from '../nutrition.js';
import { formatNumber } from '../units.js';
import { todayString } from './utils.js';

export const NO_TARGET_TEXT = 'Kein Tagesziel vorhanden. Lege dein Profil an oder ergänze Alter, Größe und Gewicht, um eine Tagesbilanz zu sehen.';

/** Schnell-Lebensmittel, die immer angeboten werden (typische Durchschnittswerte, je Portion). */
export const DEFAULT_QUICK_FOODS = Object.freeze([
  { id: 'default-banane', name: 'Banane', portionLabel: '1 Stück (ca. 120 g)', kcal: 108, protein: 1.3, carbs: 24, fat: 0.4 },
  { id: 'default-apfel', name: 'Apfel', portionLabel: '1 Stück (ca. 180 g)', kcal: 94, protein: 0.5, carbs: 22, fat: 0.4 },
  { id: 'default-proteinriegel', name: 'Proteinriegel', portionLabel: '1 Riegel (ca. 60 g)', kcal: 210, protein: 20, carbs: 18, fat: 7 },
  { id: 'default-skyr', name: 'Skyr natur', portionLabel: '150 g', kcal: 95, protein: 16.5, carbs: 6, fat: 0.3 },
  { id: 'default-nuesse', name: 'Nüsse', portionLabel: '30 g', kcal: 180, protein: 6, carbs: 3, fat: 16 },
]);

const KEYS = ['kcal', 'protein', 'carbs', 'fat'];

/** Summe (Werte je Portion × Portionen). complete = false, sobald kcal oder Protein fehlen. */
export function sumNutrition(items) {
  const out = { kcal: 0, protein: 0, carbs: 0, fat: 0, complete: true, count: 0 };
  for (const it of items ?? []) {
    const portions = typeof it.portions === 'number' && it.portions > 0 ? it.portions : 1;
    out.count += 1;
    for (const k of KEYS) {
      const v = it[k];
      if (typeof v === 'number' && Number.isFinite(v)) out[k] += v * portions;
      else if (k === 'kcal' || k === 'protein') out.complete = false;
    }
  }
  for (const k of KEYS) out[k] = Math.round(out[k] * 10) / 10;
  out.kcal = Math.round(out.kcal);
  return out;
}

/**
 * Nährwerte pro Portion für das, was der Nutzer tatsächlich kocht (inkl. hinterlegter Alternativen).
 * source: 'recipe' (unverändert) | 'variant' (neu berechnet, geschätzt) | 'unknown'
 */
export function recipeNutritionFor(recipe, profile, catalog) {
  if (!recipe) return { perServing: null, estimated: true, source: 'unknown' };
  const check = checkRecipe(recipe, profile, catalog);
  if (check.substitutions.length || check.omitted.length) {
    const n = computeRecipeNutrition(check.effectiveRecipe, catalog);
    if (n.perServing) return { perServing: n.perServing, estimated: true, source: 'variant' };
    return { perServing: recipe.nutritionPerServing ?? null, estimated: true, source: recipe.nutritionPerServing ? 'recipe' : 'unknown' };
  }
  return { perServing: recipe.nutritionPerServing ?? null, estimated: recipe.nutritionStatus !== 'provided', source: recipe.nutritionPerServing ? 'recipe' : 'unknown' };
}

/** Datum und Uhrzeit eines Tagebucheintrags in lokaler Zeit. */
export function logDateTime(now = new Date()) {
  return { date: todayString(now), time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}` };
}

/**
 * @param {{targets:object|null, logs:Array, planned:Array}} o  logs/planned: Einträge mit Nährwerten je Portion und portions
 */
export function dayBalance({ targets, logs = [], planned = [] }) {
  const eaten = sumNutrition(logs);
  const plannedSum = sumNutrition(planned);
  const valid = targets && typeof targets.kcalTarget === 'number' && Number.isFinite(targets.kcalTarget);
  if (!valid) {
    return { status: 'noTarget', target: null, proteinMin: null, proteinMax: null, eaten, planned: plannedSum, remaining: null, over: false, incomplete: !eaten.complete, text: NO_TARGET_TEXT };
  }
  const target = Math.round(targets.kcalTarget);
  const diff = target - eaten.kcal;
  const over = diff < 0;
  let text;
  if (targets.minor) text = `Heute gegessen: ${formatNumber(eaten.kcal, 0)} kcal · Orientierungswert: ${formatNumber(target, 0)} kcal`;
  else text = over ? `${formatNumber(-diff, 0)} kcal über Ziel` : `noch ${formatNumber(diff, 0)} kcal`;
  if (!eaten.complete) text += ' (unvollständig: bei einigen Einträgen fehlen Nährwerte)';
  return {
    status: 'ok', target, proteinMin: targets.proteinMin ?? null, proteinMax: targets.proteinMax ?? null,
    eaten, planned: plannedSum, remaining: over ? 0 : diff, over, minor: !!targets.minor, incomplete: !eaten.complete, text,
  };
}
