// recipes.js – Rezepte laden, analysieren, filtern, sortieren; Favoriten und eigene Rezepte.
import { getAllItems, putItem, deleteItem, getItem } from './db.js';
import { normalizeRecipe, normalizeFavorite } from './core/models.js';
import { createCatalog } from './core/catalog.js';
import { checkRecipe, recipeAllergens } from './core/restrictions.js';
import { scaleRecipe, evaluateAgainstPantry, scoreRecipe, indexPantry, recommendationText } from './core/scoring.js';
import { computeRecipeNutrition } from './nutrition.js';
import { deriveDietaryTags } from './core/recipe-tags.js';
import { normalizeText, sanitizeText, parseNumber, todayString, nowIso, uuid } from './core/utils.js';
import { parseIngredientLine, normalizeUnit } from './units.js';

let catalogPromise = null;
let localPromise = null;

async function fetchJson(relPath) {
  const url = new URL(relPath, import.meta.url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Daten konnten nicht geladen werden (${res.status}).`);
  return res.json();
}

export function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = fetchJson('./data/ingredients.json').then((list) => createCatalog(Array.isArray(list) ? list : []))
      .catch((err) => { catalogPromise = null; throw err; });
  }
  return catalogPromise;
}

export function loadLocalRecipes() {
  if (!localPromise) {
    localPromise = fetchJson('./data/recipes.json')
      .then((json) => (Array.isArray(json?.recipes) ? json.recipes : []).map((r) => normalizeRecipe({ ...r, origin: 'local' })))
      .catch((err) => { localPromise = null; throw err; });
  }
  return localPromise;
}

export async function getAllRecipes() {
  const [local, custom, cached] = await Promise.all([loadLocalRecipes(), getAllItems('customRecipes'), getAllItems('cachedRecipes')]);
  return [
    ...local,
    ...custom.map((r) => normalizeRecipe({ ...r, origin: 'custom' })),
    ...cached.map((r) => normalizeRecipe({ ...r, origin: 'external' })),
  ];
}

export async function getRecipe(id) {
  const all = await getAllRecipes();
  return all.find((r) => r.id === id) ?? null;
}

// ---------- Favoriten ----------
export async function listFavorites() {
  return (await getAllItems('favorites')).map((f) => normalizeFavorite(f));
}

export async function toggleFavorite(recipe) {
  const existing = await getItem('favorites', recipe.id);
  if (existing) { await deleteItem('favorites', recipe.id); return false; }
  await putItem('favorites', normalizeFavorite({ id: recipe.id, title: recipe.title }));
  return true;
}

// ---------- Eigene Rezepte ----------
/** Erstellt ein eigenes Rezept aus Formularfeldern. Zutatenzeilen: "400 g Hähnchenbrust". */
export function buildCustomRecipe(form, catalog) {
  const errors = {};
  const title = sanitizeText(form.title, 120);
  if (!title) errors.title = 'Bitte gib einen Titel ein.';
  const servings = parseNumber(form.servings);
  if (servings === null || servings < 1 || servings > 50) errors.servings = 'Portionen: 1 bis 50.';
  const minutes = parseNumber(form.totalMinutes);
  if (minutes === null || minutes < 0 || minutes > 1440) errors.totalMinutes = 'Zeit: 0 bis 1440 Minuten.';
  const lines = String(form.ingredients ?? '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 60);
  if (!lines.length) errors.ingredients = 'Bitte mindestens eine Zutat angeben (eine pro Zeile).';
  const toIngredient = (line) => {
    const p = parseIngredientLine(line);
    const entry = catalog.resolve(p.name);
    return {
      ingredientId: entry?.id ?? null,
      name: sanitizeText(p.name || line, 80),
      normalizedName: normalizeText(p.name || line),
      amount: typeof p.amount === 'number' && p.amount > 0 && p.amount < 1e6 ? p.amount : null,
      unit: normalizeUnit(p.unit) ?? null,
      category: entry?.category ?? 'Sonstiges',
      optional: false,
      substitutes: [],
      allergenTags: entry?.allergenTags ?? [],
      allergenDataKnown: !!entry,
    };
  };
  const all = lines.map(toIngredient);
  const ingredients = all.filter((i) => catalog.get(i.ingredientId)?.isSpice !== true);
  const spices = all.filter((i) => catalog.get(i.ingredientId)?.isSpice === true);
  if (Object.keys(errors).length) return { ok: false, errors };
  const recipe = normalizeRecipe({
    id: form.id || `custom-${uuid()}`,
    title,
    description: form.description,
    mealType: form.mealType,
    defaultServings: servings,
    ingredients,
    spices,
    instructions: String(form.instructions ?? '').split('\n').map((s) => s.trim()).filter(Boolean),
    preparationMinutes: 0,
    cookingMinutes: minutes,
    totalMinutes: minutes,
    devices: Array.isArray(form.devices) ? form.devices : [],
    estimatedCostLevel: form.estimatedCostLevel ?? 2,
    mealPrep: !!form.mealPrep,
    source: 'Eigenes Rezept',
    license: 'Eigenes Rezept (privat)',
    origin: 'custom',
    emoji: '📝',
  });
  const nut = computeRecipeNutrition(recipe, catalog);
  const al = recipeAllergens(recipe, catalog);
  recipe.nutritionPerServing = nut.perServing;
  recipe.nutritionStatus = nut.status;
  recipe.nutritionConfidence = nut.confidence;
  recipe.nutritionCoverage = nut.coverage;
  recipe.allergens = al.tags;
  recipe.allergenDataComplete = al.complete;
  recipe.dietaryTags = deriveDietaryTags(recipe, catalog, nut.perServing);
  recipe.updatedAt = nowIso();
  return { ok: true, recipe };
}

export async function saveCustomRecipe(recipe) {
  await putItem('customRecipes', recipe);
  return recipe;
}

export async function deleteCustomRecipe(id) {
  await deleteItem('customRecipes', id);
}

export async function deleteCachedRecipe(id) {
  await deleteItem('cachedRecipes', id);
}

// ---------- Analyse ----------
/**
 * Prüft Allergien/Regeln (zuerst!), skaliert, vergleicht mit dem Vorrat und bewertet.
 */
export function analyzeRecipe(recipe, { profile, pantry, pantryIndex, catalog, mealTargets, servings, warnDays = 3, today = todayString() }) {
  const check = checkRecipe(recipe, profile, catalog);
  const effective = check.effectiveRecipe;
  const scaled = scaleRecipe(effective, servings ?? recipe.defaultServings);
  const evaluation = evaluateAgainstPantry(scaled, pantry, catalog, { today, warnDays, pantryIndex });
  const score = check.status === 'ok' ? scoreRecipe(effective, { profile, mealTargets, evaluation, catalog }) : null;
  return { recipe, check, effective, scaled, evaluation, score, text: recommendationText(evaluation, score) };
}

export function analyzeAll(recipes, ctx) {
  const pantryIndex = indexPantry(ctx.pantry, ctx.catalog);
  return recipes.map((r) => analyzeRecipe(r, { ...ctx, pantryIndex }));
}

const hasTag = (r, ...tags) => tags.some((t) => (r.dietaryTags ?? []).includes(t));
const kcal = (r) => r.nutritionPerServing?.kcal;
const protein = (r) => r.nutritionPerServing?.protein;
const minutes = (r) => (typeof r.totalMinutes === 'number' && Number.isFinite(r.totalMinutes) ? r.totalMinutes : null);
const timeBelow = (r, limit, inclusive = false) => minutes(r) !== null && (inclusive ? minutes(r) <= limit : minutes(r) < limit);

export const RECIPE_FILTERS = Object.freeze({
  fullyCookable: { label: 'vollständig kochbar', test: (a) => a.evaluation.fullyCookable },
  max1Missing: { label: 'höchstens 1 fehlende Zutat', test: (a) => a.evaluation.missingCount <= 1 },
  max3Missing: { label: 'höchstens 3 fehlende Zutaten', test: (a) => a.evaluation.missingCount <= 3 },
  fruehstueck: { label: 'Frühstück', test: (a) => a.recipe.mealType === 'fruehstueck' },
  mittagessen: { label: 'Mittagessen', test: (a) => a.recipe.mealType === 'mittagessen' },
  abendessen: { label: 'Abendessen', test: (a) => a.recipe.mealType === 'abendessen' },
  snack: { label: 'Snack', test: (a) => a.recipe.mealType === 'snack' },
  proteinreich: { label: 'proteinreich', test: (a) => hasTag(a.recipe, 'proteinreich') },
  kalorienarm: { label: 'kalorienarm', test: (a) => hasTag(a.recipe, 'kalorienarm') },
  under500: { label: 'unter 500 kcal', test: (a) => typeof kcal(a.recipe) === 'number' && kcal(a.recipe) < 500 },
  under700: { label: 'unter 700 kcal', test: (a) => typeof kcal(a.recipe) === 'number' && kcal(a.recipe) < 700 },
  schnell: { label: 'schnell (≤ 20 Min.)', test: (a) => timeBelow(a.recipe, 20, true) },
  under15: { label: 'unter 15 Minuten', test: (a) => timeBelow(a.recipe, 15) },
  under30: { label: 'unter 30 Minuten', test: (a) => timeBelow(a.recipe, 30) },
  under45: { label: 'unter 45 Minuten', test: (a) => timeBelow(a.recipe, 45) },
  guenstig: { label: 'günstig', test: (a) => hasTag(a.recipe, 'günstig') },
  vegetarisch: { label: 'vegetarisch', test: (a) => hasTag(a.recipe, 'vegetarisch') },
  vegan: { label: 'vegan', test: (a) => hasTag(a.recipe, 'vegan') },
  laktosefrei: { label: 'laktosefrei', test: (a) => hasTag(a.recipe, 'laktosefrei', 'laktosefrei möglich') },
  glutenfrei: { label: 'glutenfrei', test: (a) => hasTag(a.recipe, 'glutenfrei', 'glutenfrei möglich') },
  mealprep: { label: 'Meal Prep', test: (a) => hasTag(a.recipe, 'Meal Prep') },
  airfryer: { label: 'Airfryer', test: (a) => (a.recipe.devices ?? []).includes('airfryer') },
  mikrowelle: { label: 'Mikrowelle', test: (a) => (a.recipe.devices ?? []).includes('mikrowelle') },
});

export const PANTRY_PAGE_FILTERS = ['fullyCookable', 'max1Missing', 'max3Missing', 'proteinreich', 'kalorienarm', 'schnell', 'guenstig', 'vegetarisch', 'vegan', 'laktosefrei', 'glutenfrei', 'mealprep', 'airfryer', 'mikrowelle'];
export const DISCOVER_FILTERS = ['fruehstueck', 'mittagessen', 'abendessen', 'snack', 'proteinreich', 'kalorienarm', 'under500', 'under700', 'vegetarisch', 'vegan', 'laktosefrei', 'glutenfrei', 'guenstig', 'mealprep', 'airfryer', 'mikrowelle', 'under15', 'under30', 'under45'];

export function applyFilters(analyses, activeFilters = [], query = '') {
  const q = normalizeText(query);
  return analyses.filter((a) => {
    if (q) {
      const hay = normalizeText(`${a.recipe.title} ${a.recipe.description} ${(a.recipe.dietaryTags ?? []).join(' ')} ${a.recipe.ingredients.map((i) => i.name).join(' ')}`);
      if (!q.split(' ').every((part) => hay.includes(part))) return false;
    }
    return activeFilters.every((f) => RECIPE_FILTERS[f]?.test(a) ?? true);
  });
}

const nullsLast = (v, dir) => (typeof v === 'number' && Number.isFinite(v) ? v * dir : Number.MAX_SAFE_INTEGER);

export const SORT_OPTIONS = Object.freeze({
  recommended: { label: 'persönlich empfohlen', cmp: (a, b) => (b.score?.total ?? -1) - (a.score?.total ?? -1) },
  protein: { label: 'Protein absteigend', cmp: (a, b) => nullsLast(protein(a.recipe), -1) - nullsLast(protein(b.recipe), -1) },
  kcal: { label: 'Kalorien aufsteigend', cmp: (a, b) => nullsLast(kcal(a.recipe), 1) - nullsLast(kcal(b.recipe), 1) },
  time: { label: 'Zeit aufsteigend', cmp: (a, b) => nullsLast(minutes(a.recipe), 1) - nullsLast(minutes(b.recipe), 1) },
  pantry: { label: 'Vorratsübereinstimmung', cmp: (a, b) => b.evaluation.matchPercent - a.evaluation.matchPercent },
  missing: { label: 'wenigste fehlende Zutaten', cmp: (a, b) => a.evaluation.missingCount - b.evaluation.missingCount || b.evaluation.matchPercent - a.evaluation.matchPercent },
});

export function sortAnalyses(analyses, key = 'recommended') {
  const opt = SORT_OPTIONS[key] ?? SORT_OPTIONS.recommended;
  return [...analyses].sort((a, b) => opt.cmp(a, b) || a.recipe.title.localeCompare(b.recipe.title, 'de'));
}
