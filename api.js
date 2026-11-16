// api.js – optionale externe Datenquellen. Standardmäßig AUS, nur nach ausdrücklicher Aktivierung.
// Es werden ausschließlich sachliche Begriffe (Rezeptname, Barcode) übertragen – niemals Profildaten.
import { sanitizeText, sanitizeMultiline, isSafeHttpUrl, normalizeText, nowIso, parseNumber, isPlainObject } from './core/utils.js';
import { normalizeRecipe, normalizeNutrition, ALLERGEN_IDS } from './core/models.js';
import { normalizeUnit, parseIngredientLine } from './units.js';
import { putItem } from './db.js';
import { recipeAllergens } from './core/restrictions.js';
import { computeRecipeNutrition } from './nutrition.js';
import { deriveDietaryTags } from './core/recipe-tags.js';

export const COMMUNITY_DATA_NOTICE = 'Die Produktdaten stammen aus einer gemeinschaftlich gepflegten Datenbank und können unvollständig oder fehlerhaft sein.';
export const EXTERNAL_RECIPE_NOTICE = 'Externe Rezepte: Mengenangaben, Nährwerte und Allergene sind unvollständig und werden nicht als gesichert behandelt.';

const MEALDB_BASE = 'https://www.themealdb.com/api/json/v1/1/';
const OFF_BASE = 'https://world.openfoodfacts.org/api/v2/product/';
const TIMEOUT_MS = 10000;
const MAX_RESPONSE_CHARS = 2_000_000;

async function fetchJsonSafe(url) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('Du bist offline. Externe Daten sind gerade nicht verfügbar.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
    if (!res.ok) throw new Error(`Der Dienst antwortet nicht wie erwartet (HTTP ${res.status}).`);
    const text = await res.text();
    if (text.length > MAX_RESPONSE_CHARS) throw new Error('Die Antwort des Dienstes ist zu groß.');
    return JSON.parse(text);
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Der Dienst hat nicht rechtzeitig geantwortet.');
    if (err instanceof SyntaxError) throw new Error('Die Antwort des Dienstes war ungültig.');
    throw err instanceof TypeError ? new Error('Der Dienst ist nicht erreichbar.') : err;
  } finally {
    clearTimeout(timer);
  }
}

/** Zerlegt TheMealDB-Mengenangaben ("200g", "1 cup") – unbekannte Maße bleiben "Menge bitte prüfen". */
export function parseMeasure(measure) {
  const s = sanitizeText(measure, 60);
  if (!s) return { amount: null, unit: null };
  const p = parseIngredientLine(`${s} x`);
  if (p && typeof p.amount === 'number' && p.unit && p.unit !== 'Stück') {
    const unit = normalizeUnit(p.unit);
    if (unit) return { amount: p.amount, unit };
  }
  const m = s.match(/^(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l)$/i);
  if (m) return { amount: parseNumber(m[1]), unit: normalizeUnit(m[2]) };
  if (/^\d+(?:[.,]\d+)?$/.test(s)) return { amount: parseNumber(s), unit: 'Stück' };
  return { amount: null, unit: null, raw: s };
}

/** Wandelt eine TheMealDB-Antwort defensiv in ein VorratsFit-Rezept um. */
export function mapMealDbMeal(meal, catalog) {
  if (!isPlainObject(meal) || typeof meal.idMeal !== 'string' || !/^\d{1,10}$/.test(meal.idMeal)) return null;
  const ingredients = [];
  for (let i = 1; i <= 20; i += 1) {
    const name = sanitizeText(meal[`strIngredient${i}`], 80);
    if (!name) continue;
    const { amount, unit, raw } = parseMeasure(meal[`strMeasure${i}`]);
    const entry = catalog?.resolve(name) ?? null;
    ingredients.push({
      ingredientId: entry?.id ?? null, name, normalizedName: normalizeText(name), amount, unit,
      category: entry?.category ?? 'Sonstiges', optional: false, substitutes: [],
      allergenTags: entry?.allergenTags ?? [], allergenDataKnown: false, rawMeasure: raw ?? null,
    });
  }
  const instructions = sanitizeMultiline(meal.strInstructions, 6000).split(/\n+/).map((s) => s.trim()).filter((s) => s.length > 1).slice(0, 30);
  const sourcePage = `https://www.themealdb.com/meal/${meal.idMeal}`;
  const recipe = normalizeRecipe({
    id: `mealdb-${meal.idMeal}`,
    title: sanitizeText(meal.strMeal, 120),
    description: [sanitizeText(meal.strCategory, 40), sanitizeText(meal.strArea, 40)].filter(Boolean).join(' · '),
    mealType: 'abendessen',
    defaultServings: 4,
    ingredients,
    spices: [],
    instructions,
    preparationMinutes: 0,
    cookingMinutes: 0,
    totalMinutes: null,
    devices: [],
    allergens: [],
    allergenDataComplete: false,
    estimatedCostLevel: 2,
    nutritionStatus: 'estimated',
    nutritionConfidence: 'low',
    source: 'TheMealDB',
    sourceUrl: isSafeHttpUrl(meal.strSource) ? meal.strSource : sourcePage,
    imageUrl: isSafeHttpUrl(meal.strMealThumb, ['themealdb.com']) ? meal.strMealThumb : null,
    license: 'Daten von TheMealDB (themealdb.com) – Nutzungsbedingungen des Anbieters beachten',
    origin: 'external',
    emoji: '🌍',
  });
  recipe.sourcePage = sourcePage;
  if (catalog) {
    const nut = computeRecipeNutrition(recipe, catalog);
    recipe.nutritionPerServing = nut.perServing;
    recipe.nutritionCoverage = nut.coverage;
    recipe.nutritionStatus = 'estimated';
    recipe.nutritionConfidence = 'low';
    recipe.allergens = recipeAllergens(recipe, catalog).tags;
    recipe.dietaryTags = deriveDietaryTags(recipe, catalog, nut.perServing).filter((t) => !['glutenfrei', 'laktosefrei', 'vegan', 'vegetarisch'].includes(t));
  }
  recipe.allergenDataComplete = false;
  recipe.cachedAt = nowIso();
  return recipe;
}

/** Sucht Rezepte bei TheMealDB (nur der Suchbegriff wird übertragen). */
export async function searchMealDb(query, catalog) {
  const q = sanitizeText(query, 60);
  if (q.length < 2) throw new Error('Bitte mindestens zwei Zeichen eingeben.');
  const json = await fetchJsonSafe(`${MEALDB_BASE}search.php?s=${encodeURIComponent(q)}`);
  const meals = Array.isArray(json?.meals) ? json.meals.slice(0, 25) : [];
  return meals.map((m) => mapMealDbMeal(m, catalog)).filter(Boolean);
}

/** Speichert ein externes Rezept lokal (offline verfügbar). */
export async function cacheExternalRecipe(recipe) {
  await putItem('cachedRecipes', { ...recipe, updatedAt: nowIso() });
  return recipe;
}

/** Open Food Facts: Produktdaten zu einem Barcode (nur der Barcode wird übertragen). */
export async function lookupBarcode(barcode) {
  const code = String(barcode ?? '').trim();
  if (!/^\d{8,14}$/.test(code)) throw new Error('Ein Barcode besteht aus 8 bis 14 Ziffern.');
  const fields = 'product_name,product_name_de,brands,quantity,nutriments,allergens_tags,traces_tags';
  const json = await fetchJsonSafe(`${OFF_BASE}${code}.json?fields=${fields}`);
  if (!isPlainObject(json) || json.status !== 1 || !isPlainObject(json.product)) return null;
  const p = json.product;
  const n = isPlainObject(p.nutriments) ? p.nutriments : {};
  const offMap = { milk: 'milch', gluten: 'gluten', eggs: 'eier', nuts: 'nuesse', peanuts: 'erdnuesse', fish: 'fisch', crustaceans: 'schalentiere', molluscs: 'schalentiere', soybeans: 'soja', celery: 'sellerie', mustard: 'senf', 'sesame-seeds': 'sesam', lupin: 'lupinen', 'sulphur-dioxide-and-sulphites': 'sulfite' };
  const tags = (list) => (Array.isArray(list) ? list : []).map((t) => String(t).replace(/^[a-z]{2}:/, '')).map((t) => offMap[t]).filter((t) => t && ALLERGEN_IDS.includes(t));
  return {
    barcode: code,
    name: sanitizeText(p.product_name_de || p.product_name, 80),
    brand: sanitizeText(p.brands, 80),
    quantity: sanitizeText(p.quantity, 40),
    nutritionPer100g: normalizeNutrition({
      kcal: n['energy-kcal_100g'], protein: n.proteins_100g, carbs: n.carbohydrates_100g, fat: n.fat_100g,
      fiber: n.fiber_100g, sugar: n.sugars_100g, salt: n.salt_100g,
    }),
    allergenHints: Array.from(new Set(tags(p.allergens_tags))),
    traceHints: Array.from(new Set(tags(p.traces_tags))),
    source: 'Open Food Facts (ODbL)',
    sourceUrl: `https://world.openfoodfacts.org/product/${code}`,
  };
}

export function barcodeScanSupported() {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;
}
