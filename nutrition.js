// nutrition.js – Energie- und Nährwertberechnung (reine Funktionen).
// Alle Ergebnisse sind Schätzungen; unbekannte Werte bleiben null.
import { ACTIVITY_LEVELS, NUTRIENT_KEYS } from './core/models.js';
import { roundTo } from './core/utils.js';
import { convertWithIngredient, getDimension } from './units.js';
import { catalogEntryFor, EMPTY_CATALOG } from './core/catalog.js';

export const ESTIMATE_NOTICE = 'Die Nährwerte wurden anhand typischer Zutatenwerte geschätzt. Tatsächliche Werte können je nach Produkt, Menge und Zubereitung abweichen.';
export const KCAL_PER_KG = 7700;
export const MAX_DEFICIT_SHARE = 0.25;

/** Mifflin-St.-Jeor. Bei "keine Angabe" Mittelwert beider Formeln (gröbere Schätzung). */
export function calcBmr({ weightKg, heightCm, age, sex }) {
  if (![weightKg, heightCm, age].every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0)) return null;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  const male = base + 5;
  const female = base - 161;
  if (sex === 'male') return { value: male, rough: false };
  if (sex === 'female') return { value: female, rough: false };
  return { value: (male + female) / 2, rough: true };
}

export function activityFactor(level) {
  return ACTIVITY_LEVELS.find((a) => a.id === level)?.factor ?? null;
}

/**
 * Berechnet vorsichtige Tagesziele.
 * @returns {object|null} null, wenn die Profildaten nicht ausreichen.
 */
export function calcTargets(profile) {
  if (!profile) return null;
  const bmr = calcBmr(profile);
  const factor = activityFactor(profile.activityLevel);
  if (!bmr || !factor) return null;
  const tdee = bmr.value * factor;
  const minor = profile.age < 18;
  const notes = [];
  let deficit = 0;
  let deficitCapped = false;
  let surplus = 0;

  if (minor) {
    notes.push('Für Personen unter 18 Jahren berechnet VorratsFit keine kalorienreduzierte Abnehmstrategie. Bitte lass dich ärztlich oder ernährungsmedizinisch begleiten.');
  } else if (profile.goal === 'lose') {
    const weekly = typeof profile.weeklyChangeKg === 'number' && profile.weeklyChangeKg > 0 ? profile.weeklyChangeKg : 0;
    const desired = (weekly * KCAL_PER_KG) / 7;
    const cap = tdee * MAX_DEFICIT_SHARE;
    deficit = Math.min(desired, cap);
    deficitCapped = desired > cap;
    if (deficitCapped) notes.push('Das gewünschte Defizit wurde auf höchstens 25 % des geschätzten Gesamtverbrauchs begrenzt.');
  } else if (profile.goal === 'muscle') {
    surplus = 200;
    notes.push('Für Muskelaufbau wird ein moderater Überschuss von etwa 200 kcal angesetzt.');
  }

  const automaticTarget = tdee - deficit + surplus;
  const manual = typeof profile.manualCalorieTarget === 'number' && Number.isFinite(profile.manualCalorieTarget) && profile.manualCalorieTarget >= 800 && profile.manualCalorieTarget <= 6000
    ? profile.manualCalorieTarget : null;
  const kcalTarget = manual ?? automaticTarget;
  const effectiveDelta = kcalTarget - tdee; // negativ = Defizit
  const expectedWeeklyChangeKg = (effectiveDelta * 7) / KCAL_PER_KG;
  if (kcalTarget < bmr.value) notes.push('Das Kalorienziel liegt unter dem geschätzten Grundumsatz. Bitte besonders vorsichtig vorgehen und ggf. fachlich beraten lassen.');

  // Referenzgewicht für Protein/Fett: beim Abnehmen das Wunschgewicht (wenn plausibel), sonst aktuelles Gewicht
  const ref = profile.goal === 'lose' && profile.targetWeightKg > 30 && profile.targetWeightKg < profile.weightKg
    ? profile.targetWeightKg : profile.weightKg;
  const proteinPerKg = profile.goal === 'lose' || profile.goal === 'muscle' ? [1.6, 2.2] : [1.0, 1.6];
  const proteinMin = ref * proteinPerKg[0];
  const proteinMax = ref * proteinPerKg[1];
  const fatMin = Math.max(ref * 0.8, (kcalTarget * 0.2) / 9);
  const proteinMid = (proteinMin + proteinMax) / 2;
  const carbs = Math.max(0, (kcalTarget - proteinMid * 4 - fatMin * 9) / 4);
  const fiber = Math.max(30, (kcalTarget / 1000) * 14);

  return {
    bmr: Math.round(bmr.value),
    bmrRough: bmr.rough,
    activityFactor: factor,
    tdee: Math.round(tdee),
    kcalTarget: Math.round(kcalTarget),
    automaticKcalTarget: Math.round(automaticTarget),
    manual: manual !== null,
    deficit: Math.round(Math.max(0, -effectiveDelta)),
    surplus: Math.round(Math.max(0, effectiveDelta)),
    deficitCapped,
    expectedWeeklyChangeKg: roundTo(expectedWeeklyChangeKg, 2),
    proteinMin: Math.round(proteinMin),
    proteinMax: Math.round(proteinMax),
    fatMin: Math.round(fatMin),
    carbs: Math.round(carbs),
    fiber: Math.round(fiber),
    minor,
    notes,
    referenceWeightKg: ref,
  };
}

/** Ziel je Mahlzeit für die Rezeptbewertung. */
export function perMealTargets(targets, mealsPerDay = 3) {
  if (!targets) return null;
  const meals = Math.min(8, Math.max(1, Math.round(mealsPerDay || 3)));
  return {
    kcal: targets.kcalTarget / meals,
    protein: ((targets.proteinMin + targets.proteinMax) / 2) / meals,
  };
}

/** Nährwerte einer einzelnen Zutatenmenge anhand der Stammdaten (null, wenn nicht sicher möglich). */
export function nutritionForIngredient(amount, unit, catalogEntry) {
  if (!catalogEntry || !catalogEntry.nutrition || typeof amount !== 'number' || !Number.isFinite(amount)) return null;
  const basisUnit = catalogEntry.nutritionBasis === '100ml' ? 'ml' : 'g';
  const inBasis = convertWithIngredient(amount, unit, basisUnit, catalogEntry);
  if (inBasis === null) return null;
  const factor = inBasis / 100;
  const out = {};
  for (const key of NUTRIENT_KEYS) {
    const v = catalogEntry.nutrition[key];
    out[key] = typeof v === 'number' && Number.isFinite(v) ? v * factor : null;
  }
  return out;
}

function roundNutrition(n) {
  if (!n) return null;
  return {
    kcal: n.kcal === null ? null : Math.round(n.kcal),
    protein: roundTo(n.protein, 1),
    carbs: roundTo(n.carbs, 1),
    fat: roundTo(n.fat, 1),
    fiber: roundTo(n.fiber, 1),
    sugar: roundTo(n.sugar, 1),
    salt: roundTo(n.salt, 2),
  };
}

/**
 * Berechnet Nährwerte pro Portion aus den Hauptzutaten (Gewürze sind nicht enthalten).
 * Fehlende Daten werden NICHT als 0 gewertet: Liegt die Abdeckung unter 60 %, bleiben die Werte null.
 */
export function computeRecipeNutrition(recipe, catalog = EMPTY_CATALOG) {
  const ingredients = (recipe?.ingredients ?? []).filter((i) => !i.optional);
  const servings = recipe?.defaultServings;
  if (!ingredients.length || !(servings > 0)) {
    return { perServing: null, status: 'estimated', confidence: 'low', coverage: 0 };
  }
  const totals = Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, 0]));
  const missingKey = Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, false]));
  let covered = 0;
  for (const ing of ingredients) {
    const entry = catalogEntryFor(ing, catalog);
    const n = nutritionForIngredient(ing.amount, ing.unit, entry);
    if (!n) continue;
    covered += 1;
    for (const k of NUTRIENT_KEYS) {
      if (n[k] === null) missingKey[k] = true; else totals[k] += n[k];
    }
  }
  const coverage = covered / ingredients.length;
  if (coverage < 0.6) {
    return { perServing: null, status: 'estimated', confidence: 'low', coverage: roundTo(coverage, 2) };
  }
  const per = {};
  for (const k of NUTRIENT_KEYS) per[k] = missingKey[k] ? null : totals[k] / servings;
  const complete = coverage === 1;
  // Stammdaten sind typische Durchschnittswerte -> höchstens "mittlere" Sicherheit.
  return {
    perServing: roundNutrition(per),
    status: complete ? 'calculated' : 'estimated',
    confidence: complete ? 'medium' : 'low',
    coverage: roundTo(coverage, 2),
  };
}

export function nutritionStatusLabel(status) {
  return { provided: 'vom Anbieter angegeben', calculated: 'aus Zutaten berechnet', estimated: 'geschätzt' }[status] ?? 'unbekannt';
}

export function confidenceLabel(c) {
  return { high: 'hoch', medium: 'mittel', low: 'niedrig' }[c] ?? 'unbekannt';
}

/** Ist ein Wert eine anzeigbare Zahl? (Schutz gegen NaN/Infinity/undefined in der UI) */
export function isDisplayableNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

export function isMassOrVolume(unit) {
  const d = getDimension(unit);
  return d === 'mass' || d === 'volume';
}
