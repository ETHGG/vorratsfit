// core/models.js – Konstanten, Datenmodelle und Normalisierer mit sicheren Standardwerten.
// Normalisierer werden bei DB-Migrationen, beim Speichern und beim Backup-Import verwendet.
import { uuid, nowIso, sanitizeText, sanitizeMultiline, normalizeText, parseNumber, isValidDateString, isPlainObject, isSafeHttpUrl, ageFromBirthDate, roundTo } from './utils.js';
import { normalizeUnit, roundQuantity } from '../units.js';

export const APP_VERSION = '0.7.1';

export const CATEGORIES = Object.freeze([
  'Fleisch und Fisch', 'vegetarische Proteinquellen', 'Milchprodukte', 'Ersatzprodukte', 'Gemüse', 'Obst',
  'Getreide', 'Reis und Nudeln', 'Konserven', 'Tiefkühlprodukte', 'Soßen', 'Öle und Fette', 'Gewürze',
  'Backzutaten', 'Getränke', 'Sonstiges',
]);

/** 0.5: Symbol je Kategorie (nur Dekoration, Text bleibt immer sichtbar). */
export const CATEGORY_EMOJI = Object.freeze({
  'Fleisch und Fisch': '🍗', 'vegetarische Proteinquellen': '🫘', Milchprodukte: '🥛', Ersatzprodukte: '🌱', Gemüse: '🥕', Obst: '🍎',
  Getreide: '🌾', 'Reis und Nudeln': '🍝', Konserven: '🥫', Tiefkühlprodukte: '🧊', Soßen: '🫙', 'Öle und Fette': '🫒', Gewürze: '🧂',
  Backzutaten: '🧁', Getränke: '🧃', Sonstiges: '🛒',
  'Obst und Gemüse': '🥦', 'Milchprodukte und Ersatzprodukte': '🧀', 'Getreide, Reis und Nudeln': '🍝', 'Brot und Backwaren': '🥖',
});

export const SHOPPING_GROUPS = Object.freeze([
  'Obst und Gemüse', 'Fleisch und Fisch', 'Milchprodukte und Ersatzprodukte', 'Getreide, Reis und Nudeln',
  'Konserven', 'Tiefkühlprodukte', 'Brot und Backwaren', 'Gewürze', 'Getränke', 'Sonstiges',
]);

const CATEGORY_TO_GROUP = Object.freeze({
  'Gemüse': 'Obst und Gemüse',
  Obst: 'Obst und Gemüse',
  'Fleisch und Fisch': 'Fleisch und Fisch',
  Milchprodukte: 'Milchprodukte und Ersatzprodukte',
  Ersatzprodukte: 'Milchprodukte und Ersatzprodukte',
  'vegetarische Proteinquellen': 'Milchprodukte und Ersatzprodukte',
  Getreide: 'Getreide, Reis und Nudeln',
  'Reis und Nudeln': 'Getreide, Reis und Nudeln',
  Backzutaten: 'Getreide, Reis und Nudeln',
  Konserven: 'Konserven',
  'Tiefkühlprodukte': 'Tiefkühlprodukte',
  'Gewürze': 'Gewürze',
  'Getränke': 'Getränke',
  'Soßen': 'Sonstiges',
  'Öle und Fette': 'Sonstiges',
  Sonstiges: 'Sonstiges',
});

export function shoppingGroupFor(category, override = null) {
  if (override && SHOPPING_GROUPS.includes(override)) return override;
  return CATEGORY_TO_GROUP[category] ?? 'Sonstiges';
}

export const ALLERGENS = Object.freeze([
  { id: 'milch', label: 'Milch' },
  { id: 'laktose', label: 'Laktose' },
  { id: 'gluten', label: 'Gluten' },
  { id: 'eier', label: 'Eier' },
  { id: 'nuesse', label: 'Nüsse' },
  { id: 'erdnuesse', label: 'Erdnüsse' },
  { id: 'fisch', label: 'Fisch' },
  { id: 'schalentiere', label: 'Schalentiere' },
  { id: 'soja', label: 'Soja' },
  { id: 'sellerie', label: 'Sellerie' },
  { id: 'senf', label: 'Senf' },
  { id: 'sesam', label: 'Sesam' },
  { id: 'lupinen', label: 'Lupinen' },
  { id: 'sulfite', label: 'Sulfite' },
]);
export const ALLERGEN_IDS = Object.freeze(ALLERGENS.map((a) => a.id));
export function allergenLabel(id) {
  return ALLERGENS.find((a) => a.id === id)?.label ?? id;
}

export const DIETS = Object.freeze([
  { id: 'omnivor', label: 'omnivor', hard: false },
  { id: 'vegetarisch', label: 'vegetarisch', hard: true },
  { id: 'vegan', label: 'vegan', hard: true },
  { id: 'pescetarisch', label: 'pescetarisch', hard: true },
  { id: 'halal', label: 'halal', hard: true },
  { id: 'glutenfrei', label: 'glutenfrei', hard: true },
  { id: 'laktosefrei', label: 'laktosefrei', hard: true },
  { id: 'lowcarb', label: 'Low Carb', hard: false },
  { id: 'proteinreich', label: 'proteinreich', hard: false },
]);
export const DIET_IDS = Object.freeze(DIETS.map((d) => d.id));

export const GOALS = Object.freeze([
  { id: 'lose', label: 'Gewicht reduzieren' },
  { id: 'maintain', label: 'Gewicht halten' },
  { id: 'muscle', label: 'Muskelaufbau' },
  { id: 'healthy', label: 'allgemein gesündere Ernährung' },
]);

export const ACTIVITY_LEVELS = Object.freeze([
  { id: 'sedentary', label: 'überwiegend sitzend', factor: 1.2 },
  { id: 'light', label: 'leicht aktiv', factor: 1.375 },
  { id: 'moderate', label: 'mittel aktiv', factor: 1.55 },
  { id: 'active', label: 'sehr aktiv', factor: 1.725 },
  { id: 'veryActive', label: 'körperlich sehr aktiv', factor: 1.9 },
]);

export const SEXES = Object.freeze([
  { id: 'male', label: 'männlich' },
  { id: 'female', label: 'weiblich' },
  { id: 'unspecified', label: 'keine Angabe' },
]);

export const DEVICES = Object.freeze([
  { id: 'herd', label: 'Herd' },
  { id: 'backofen', label: 'Backofen' },
  { id: 'mikrowelle', label: 'Mikrowelle' },
  { id: 'airfryer', label: 'Airfryer' },
  { id: 'reiskocher', label: 'Reiskocher' },
]);
export function deviceLabel(id) {
  return DEVICES.find((d) => d.id === id)?.label ?? id;
}

export const MEAL_TYPES = Object.freeze([
  { id: 'fruehstueck', label: 'Frühstück' },
  { id: 'mittagessen', label: 'Mittagessen' },
  { id: 'abendessen', label: 'Abendessen' },
  { id: 'snack', label: 'Snack' },
]);
export function mealTypeLabel(id) {
  return MEAL_TYPES.find((m) => m.id === id)?.label ?? id;
}

export const NUTRIENT_KEYS = Object.freeze(['kcal', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'salt']);
export const NUTRITION_STATUS = Object.freeze(['provided', 'calculated', 'estimated']);
export const NUTRITION_CONFIDENCE = Object.freeze(['high', 'medium', 'low']);

const MAX_AMOUNT = 1_000_000;

function bool(v, fallback = false) {
  return typeof v === 'boolean' ? v : fallback;
}
function str(v, max = 200) {
  return sanitizeText(v ?? '', max);
}
function iso(v, fallback) {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : fallback;
}
function amountOrNull(v) {
  const n = parseNumber(v);
  if (n === null || n < 0) return null;
  return roundQuantity(Math.min(n, MAX_AMOUNT));
}
function amountOrZero(v) {
  return amountOrNull(v) ?? 0;
}
function stringList(v, max = 50, maxLen = 80) {
  if (!Array.isArray(v)) return [];
  return Array.from(new Set(v.map((x) => str(x, maxLen)).filter(Boolean))).slice(0, max);
}
function idOrNew(v) {
  const s = str(v, 100);
  return s || uuid();
}
function unitOrRaw(v) {
  return normalizeUnit(v) ?? (str(v, 20) || 'Stück');
}

/** Nährwerte: unbekannte Werte bleiben null (niemals automatisch 0). */
export function normalizeNutrition(raw) {
  if (!isPlainObject(raw)) return null;
  const out = {};
  let any = false;
  for (const key of NUTRIENT_KEYS) {
    const n = parseNumber(raw[key]);
    out[key] = n !== null && n >= 0 && n < 100000 ? n : null;
    if (out[key] !== null) any = true;
  }
  return any ? out : null;
}

export function normalizePantryItem(raw = {}, now = nowIso()) {
  const name = str(raw.name, 80) || 'Unbenannt';
  const category = CATEGORIES.includes(raw.category) ? raw.category : 'Sonstiges';
  const barcode = typeof raw.barcode === 'string' && /^\d{8,14}$/.test(raw.barcode.trim()) ? raw.barcode.trim() : null;
  return {
    id: idOrNew(raw.id),
    name,
    normalizedName: normalizeText(raw.normalizedName || name) || normalizeText(name),
    ingredientId: str(raw.ingredientId, 60) || null,
    category,
    amount: amountOrZero(raw.amount),
    unit: unitOrRaw(raw.unit),
    expiryDate: isValidDateString(raw.expiryDate) ? raw.expiryDate : null,
    barcode,
    nutritionPer100g: normalizeNutrition(raw.nutritionPer100g),
    nutritionSource: ['none', 'catalog', 'openfoodfacts', 'manual'].includes(raw.nutritionSource) ? raw.nutritionSource : 'none',
    allergenHints: stringList(raw.allergenHints, 30, 40),
    createdByTransaction: str(raw.createdByTransaction, 100) || null,
    createdAt: iso(raw.createdAt, now),
    updatedAt: iso(raw.updatedAt, now),
  };
}

export const SOURCE_TYPES = Object.freeze(['single', 'plan', 'mealprep']);

export function normalizeRecipeSource(raw = {}) {
  return {
    recipeId: str(raw.recipeId, 100),
    title: str(raw.title, 120),
    servings: Math.round(Math.min(50, Math.max(1, parseNumber(raw.servings) ?? 1))),
    amount: amountOrNull(raw.amount),
    unit: unitOrRaw(raw.unit),
    // 0.2: Herkunft der Anforderung (Einzelrezept, Plan-Eintrag, Meal-Prep-Gruppe). Alte Daten = Einzelrezept.
    sourceType: SOURCE_TYPES.includes(raw.sourceType) ? raw.sourceType : 'single',
    sourceId: str(raw.sourceId, 100) || null,
    label: str(raw.label, 60) || null,
  };
}

/**
 * Einkaufseintrag. Alte Backups ohne neue Felder bekommen sichere Standardwerte.
 * Wichtig: Ein abgehakter Eintrag ohne addedToPantry-Information gilt als bereits übernommen,
 * damit niemals versehentlich doppelt in den Vorrat gebucht wird.
 */
export function normalizeShoppingItem(raw = {}, now = nowIso()) {
  const name = str(raw.name, 80) || 'Unbenannt';
  const recipeSources = Array.isArray(raw.recipeSources) ? raw.recipeSources.slice(0, 50).map(normalizeRecipeSource) : [];
  const checked = bool(raw.checked, false);
  const amountToBuy = amountOrNull(raw.amountToBuy) ?? amountOrNull(raw.amount);
  const category = CATEGORIES.includes(raw.category) ? raw.category : 'Sonstiges';
  return {
    id: idOrNew(raw.id),
    key: str(raw.key, 120) || null,
    ingredientId: str(raw.ingredientId, 60) || null,
    name,
    normalizedName: normalizeText(raw.normalizedName || name) || normalizeText(name),
    amountNeeded: amountOrNull(raw.amountNeeded) ?? amountToBuy,
    amountAvailable: amountOrZero(raw.amountAvailable),
    amountToBuy,
    amountPurchased: amountOrNull(raw.amountPurchased),
    unit: unitOrRaw(raw.unit),
    category,
    shoppingGroup: shoppingGroupFor(category, raw.shoppingGroup),
    recipeSources,
    manuallyAdded: typeof raw.manuallyAdded === 'boolean' ? raw.manuallyAdded : recipeSources.length === 0,
    quantityCheck: bool(raw.quantityCheck, false),
    checked,
    addedToPantry: typeof raw.addedToPantry === 'boolean' ? raw.addedToPantry : checked,
    pantryTransactionId: str(raw.pantryTransactionId, 100) || null,
    pantryItemId: str(raw.pantryItemId, 100) || null,
    pantryAmountAdded: amountOrNull(raw.pantryAmountAdded),
    pantryUnit: raw.pantryUnit ? unitOrRaw(raw.pantryUnit) : null,
    pantryAmountAfter: amountOrNull(raw.pantryAmountAfter),
    createdAt: iso(raw.createdAt, now),
    updatedAt: iso(raw.updatedAt, now),
  };
}

export function normalizeSelectedRecipe(raw = {}, now = nowIso()) {
  const recipeId = str(raw.recipeId ?? raw.id, 100);
  return {
    id: recipeId || uuid(),
    recipeId: recipeId || '',
    title: str(raw.title, 120),
    servings: Math.round(Math.min(50, Math.max(1, parseNumber(raw.servings) ?? 2))),
    addedAt: iso(raw.addedAt, now),
    updatedAt: iso(raw.updatedAt, now),
  };
}

export function normalizeFavorite(raw = {}, now = nowIso()) {
  const id = str(raw.id ?? raw.recipeId, 100);
  return { id: id || uuid(), recipeId: id, title: str(raw.title, 120), addedAt: iso(raw.addedAt, now), updatedAt: iso(raw.updatedAt, now) };
}

export const DEFAULT_SETTINGS = Object.freeze({
  id: 'app',
  externalRecipes: false,
  externalProducts: false,
  externalImages: false,
  expiryWarningDays: 3,
  defaultServings: 2,
});

export function normalizeSettings(raw = {}, now = nowIso()) {
  const days = parseNumber(raw.expiryWarningDays);
  const servings = parseNumber(raw.defaultServings);
  return {
    id: 'app',
    externalRecipes: bool(raw.externalRecipes, false),
    externalProducts: bool(raw.externalProducts, false),
    externalImages: bool(raw.externalImages, false),
    expiryWarningDays: days !== null ? Math.round(Math.min(30, Math.max(0, days))) : 3,
    defaultServings: servings !== null ? Math.round(Math.min(20, Math.max(1, servings))) : 2,
    // 0.6: Wasserziel und eigene Reihenfolge der Supermarkt-Gänge
    waterGoalMl: (() => { const w = parseNumber(raw.waterGoalMl); return w !== null ? Math.round(Math.min(6000, Math.max(500, w))) : 2000; })(),
    shoppingGroupOrder: Array.isArray(raw.shoppingGroupOrder) ? raw.shoppingGroupOrder.filter((g) => SHOPPING_GROUPS.includes(g)).filter((g, i, a) => a.indexOf(g) === i) : [],
    updatedAt: iso(raw.updatedAt, now),
  };
}

/** Profil-Normalisierung (Werte werden zusätzlich in profile.js validiert). */
export function normalizeProfile(raw = {}, now = nowIso()) {
  const num = (v) => parseNumber(v);
  return {
    id: 'main',
    nickname: str(raw.nickname, 40),
    // 0.3: Geburtsdatum. Ist es vorhanden, wird das Alter bei jedem Laden neu berechnet (läuft automatisch weiter).
    birthDate: isValidDateString(raw.birthDate) ? raw.birthDate : null,
    age: isValidDateString(raw.birthDate) ? ageFromBirthDate(raw.birthDate) : num(raw.age),
    heightCm: num(raw.heightCm),
    weightKg: num(raw.weightKg),
    targetWeightKg: num(raw.targetWeightKg),
    sex: SEXES.some((s) => s.id === raw.sex) ? raw.sex : 'unspecified',
    activityLevel: ACTIVITY_LEVELS.some((a) => a.id === raw.activityLevel) ? raw.activityLevel : 'light',
    trainingSessionsPerWeek: num(raw.trainingSessionsPerWeek) ?? 0,
    trainingDurationMinutes: num(raw.trainingDurationMinutes) ?? 0,
    goal: GOALS.some((g) => g.id === raw.goal) ? raw.goal : 'healthy',
    weeklyChangeKg: num(raw.weeklyChangeKg) ?? 0,
    mealsPerDay: num(raw.mealsPerDay) ?? 3,
    maxCookingMinutes: num(raw.maxCookingMinutes) ?? 30,
    devices: stringList(raw.devices, 20, 40),
    diets: stringList(raw.diets, 20, 40).filter((d) => DIET_IDS.includes(d)),
    likes: stringList(raw.likes, 50, 60),
    dislikes: stringList(raw.dislikes, 50, 60),
    allergies: stringList(raw.allergies, 30, 40).filter((a) => ALLERGEN_IDS.includes(a)),
    customAllergies: stringList(raw.customAllergies, 20, 60),
    intolerances: stringList(raw.intolerances, 30, 40).filter((a) => ALLERGEN_IDS.includes(a)),
    customIntolerances: stringList(raw.customIntolerances, 20, 60),
    manualCalorieTarget: num(raw.manualCalorieTarget),
    createdAt: iso(raw.createdAt, now),
    updatedAt: iso(raw.updatedAt, now),
  };
}

function normalizeIngredient(raw = {}) {
  const name = str(raw.name, 80) || 'Zutat';
  const amount = amountOrNull(raw.amount);
  const unit = normalizeUnit(raw.unit);
  return {
    ingredientId: str(raw.ingredientId, 60) || null,
    name,
    normalizedName: normalizeText(raw.normalizedName || name),
    amount,
    unit: unit ?? (raw.unit ? str(raw.unit, 20) : null),
    category: CATEGORIES.includes(raw.category) ? raw.category : 'Sonstiges',
    optional: bool(raw.optional, false),
    substitutes: stringList(raw.substitutes, 10, 60),
    allergenTags: stringList(raw.allergenTags, 20, 40).filter((a) => ALLERGEN_IDS.includes(a)),
    allergenDataKnown: typeof raw.allergenDataKnown === 'boolean' ? raw.allergenDataKnown : !!raw.ingredientId,
    rawMeasure: raw.rawMeasure ? str(raw.rawMeasure, 60) : null,
  };
}

/** Normalisiert eigene oder zwischengespeicherte Rezepte (externe Daten defensiv). */
export function normalizeRecipe(raw = {}, now = nowIso()) {
  const ingredients = Array.isArray(raw.ingredients) ? raw.ingredients.slice(0, 60).map(normalizeIngredient) : [];
  const spices = Array.isArray(raw.spices) ? raw.spices.slice(0, 30).map(normalizeIngredient) : [];
  const instructions = Array.isArray(raw.instructions)
    ? raw.instructions.slice(0, 40).map((s) => sanitizeMultiline(s, 1500)).filter(Boolean)
    : [];
  const prep = Math.max(0, Math.min(1440, parseNumber(raw.preparationMinutes) ?? 0));
  const cook = Math.max(0, Math.min(1440, parseNumber(raw.cookingMinutes) ?? 0));
  const total = parseNumber(raw.totalMinutes);
  const sourceUrl = isSafeHttpUrl(raw.sourceUrl) ? raw.sourceUrl : null;
  const imageUrl = isSafeHttpUrl(raw.imageUrl) && String(raw.imageUrl).startsWith('https://') ? raw.imageUrl : null;
  // 0.6: eigenes Foto (nur lokal, als verkleinertes JPEG/WebP-Daten-URL, max. ca. 1,5 MB)
  const photo = typeof raw.photo === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(raw.photo) && raw.photo.length <= 2_000_000 ? raw.photo : null;
  return {
    id: idOrNew(raw.id),
    title: str(raw.title, 120) || 'Rezept ohne Titel',
    description: sanitizeMultiline(raw.description, 600),
    mealType: MEAL_TYPES.some((m) => m.id === raw.mealType) ? raw.mealType : 'mittagessen',
    defaultServings: Math.round(Math.min(50, Math.max(1, parseNumber(raw.defaultServings) ?? 2))),
    ingredients,
    spices,
    instructions,
    preparationMinutes: prep,
    cookingMinutes: cook,
    totalMinutes: total !== null && total >= 0 && total <= 2880 ? total : (raw.totalMinutes === null && prep + cook === 0 ? null : prep + cook),
    difficulty: ['leicht', 'mittel', 'anspruchsvoll'].includes(raw.difficulty) ? raw.difficulty : 'leicht',
    devices: stringList(raw.devices, 10, 40),
    dietaryTags: stringList(raw.dietaryTags, 30, 40),
    mealPrep: bool(raw.mealPrep, false),
    allergens: stringList(raw.allergens, 20, 40).filter((a) => ALLERGEN_IDS.includes(a)),
    allergenDataComplete: typeof raw.allergenDataComplete === 'boolean' ? raw.allergenDataComplete : false,
    estimatedCostLevel: Math.round(Math.min(3, Math.max(1, parseNumber(raw.estimatedCostLevel) ?? 2))),
    nutritionPerServing: normalizeNutrition(raw.nutritionPerServing),
    nutritionStatus: NUTRITION_STATUS.includes(raw.nutritionStatus) ? raw.nutritionStatus : 'estimated',
    nutritionConfidence: NUTRITION_CONFIDENCE.includes(raw.nutritionConfidence) ? raw.nutritionConfidence : 'low',
    nutritionCoverage: parseNumber(raw.nutritionCoverage),
    source: str(raw.source, 80) || 'Eigenes Rezept',
    sourceUrl,
    imageUrl,
    photo,
    emoji: str(raw.emoji, 8) || '🍽️',
    license: str(raw.license, 200) || 'Eigenes Rezept (privat)',
    origin: ['local', 'custom', 'external'].includes(raw.origin) ? raw.origin : 'custom',
    createdAt: iso(raw.createdAt, now),
    updatedAt: iso(raw.updatedAt, now),
  };
}

// ---------- Version 0.2: Wochenplan, Ernährungstagebuch, Schnell-Lebensmittel ----------
function intIn(v, min, max, fallback) {
  const n = parseNumber(v);
  if (n === null) return fallback;
  const r = Math.round(n);
  return r >= min && r <= max ? r : fallback;
}
function nutrientOrNull(v) {
  const n = parseNumber(v);
  return n !== null && n >= 0 && n < 100000 ? n : null;
}
function timeOrNull(v) {
  if (typeof v !== 'string') return null;
  const m = v.match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) < 24 && Number(m[2]) < 60 ? v : null;
}

export const MAX_PLAN_SERVINGS = 50;

/** Eintrag im Wochenplan. Ungültige Werte werden auf sichere Standardwerte gesetzt. */
export function normalizeMealPlanEntry(raw = {}, now = nowIso()) {
  const consumptions = Array.isArray(raw.cookConsumptions) ? raw.cookConsumptions.slice(0, 200)
    .filter((c) => isPlainObject(c))
    .map((c) => ({ pantryId: str(c.pantryId, 100), amount: amountOrNull(c.amount) ?? 0, unit: unitOrRaw(c.unit), name: str(c.name, 80), createdPantryItem: bool(c.createdPantryItem, false) }))
    .filter((c) => c.pantryId) : [];
  return {
    id: idOrNew(raw.id),
    date: isValidDateString(raw.date) ? raw.date : null,
    mealType: MEAL_TYPES.some((m) => m.id === raw.mealType) ? raw.mealType : 'mittagessen',
    recipeId: str(raw.recipeId, 100),
    recipeTitle: str(raw.recipeTitle, 120),
    servings: intIn(raw.servings, 1, MAX_PLAN_SERVINGS, 1),
    mealPrepGroupId: str(raw.mealPrepGroupId, 100) || null,
    mealPrepIndex: intIn(raw.mealPrepIndex, 1, 50, null),
    mealPrepCount: intIn(raw.mealPrepCount, 1, 50, null),
    cooked: bool(raw.cooked, false),
    cookTransactionId: str(raw.cookTransactionId, 100) || null,
    cookedAt: iso(raw.cookedAt, null),
    cookConsumptions: consumptions,
    eaten: bool(raw.eaten, false),
    createdAt: iso(raw.createdAt, now),
    updatedAt: iso(raw.updatedAt, now),
  };
}

export const FOOD_LOG_SOURCES = Object.freeze(['plan', 'recipe', 'quick', 'food']);

/** Eintrag im Ernährungstagebuch. Nährwerte werden als Kopie gespeichert; unbekannt = null (nie 0). */
export function normalizeFoodLogEntry(raw = {}, now = nowIso()) {
  const kcal = nutrientOrNull(raw.kcal);
  const protein = nutrientOrNull(raw.protein);
  return {
    id: idOrNew(raw.id),
    date: isValidDateString(raw.date) ? raw.date : null,
    time: timeOrNull(raw.time),
    source: FOOD_LOG_SOURCES.includes(raw.source) ? raw.source : 'quick',
    refId: str(raw.refId, 100) || null,
    name: str(raw.name, 80) || 'Eintrag',
    kcal,
    protein,
    carbs: nutrientOrNull(raw.carbs),
    fat: nutrientOrNull(raw.fat),
    fiber: nutrientOrNull(raw.fiber),
    portions: Math.min(50, Math.max(0.1, parseNumber(raw.portions) ?? 1)),
    amountLabel: str(raw.amountLabel, 40) || null,
    nutritionComplete: typeof raw.nutritionComplete === 'boolean' ? raw.nutritionComplete : (kcal !== null && protein !== null),
    createdAt: iso(raw.createdAt, now),
    updatedAt: iso(raw.updatedAt, now),
  };
}

/** Eigenes Schnell-Lebensmittel (z. B. „Mein Proteinriegel“). */
export function normalizeQuickFood(raw = {}, now = nowIso()) {
  return {
    id: idOrNew(raw.id),
    name: str(raw.name, 80) || 'Lebensmittel',
    kcal: nutrientOrNull(raw.kcal),
    protein: nutrientOrNull(raw.protein),
    carbs: nutrientOrNull(raw.carbs),
    fat: nutrientOrNull(raw.fat),
    portionLabel: str(raw.portionLabel, 40) || '1 Portion',
    createdAt: iso(raw.createdAt, now),
    updatedAt: iso(raw.updatedAt, now),
  };
}

// ---------- Version 0.3: Gewichtsverlauf ----------
/** Gewichtseintrag. Je Tag genau ein Eintrag (ID = „w-JJJJ-MM-TT“). Ungültige Werte bleiben null. */
export function normalizeWeightEntry(raw = {}, now = nowIso()) {
  const date = isValidDateString(raw.date) ? raw.date : null;
  const w = parseNumber(raw.weightKg);
  return {
    id: date ? `w-${date}` : idOrNew(raw.id),
    date,
    weightKg: w !== null && w >= 30 && w <= 350 ? roundTo(w, 1) : null,
    note: str(raw.note, 120),
    createdAt: iso(raw.createdAt, now),
    updatedAt: iso(raw.updatedAt, now),
  };
}

/** 0.6: Wasser – ein Eintrag je Tag (Summe in ml). */
export const WATER_MAX_ML = 10000;
export function normalizeWaterEntry(raw = {}, now = nowIso()) {
  const date = isValidDateString(raw.date) ? raw.date : null;
  const ml = parseNumber(raw.ml);
  return {
    id: date ? `water-${date}` : idOrNew(raw.id),
    date,
    ml: ml !== null ? Math.round(Math.min(WATER_MAX_ML, Math.max(0, ml))) : 0,
    createdAt: iso(raw.createdAt, now),
    updatedAt: iso(raw.updatedAt, now),
  };
}

/** 0.7: Eigenes Foto zu einem beliebigen Rezept (auch mitgelieferte). Nur lokal; Bild-Daten-URL, max. ca. 1,5 MB. */
export const PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
export function isValidPhoto(v) {
  return typeof v === 'string' && v.length <= 2_000_000 && PHOTO_RE.test(v);
}
export function normalizeRecipePhoto(raw = {}, now = nowIso()) {
  const id = str(raw.id, 100);
  if (!id) throw new Error('Rezeptfoto ohne Rezept-ID');
  return { id, photo: isValidPhoto(raw.photo) ? raw.photo : null, createdAt: iso(raw.createdAt, now), updatedAt: iso(raw.updatedAt, now) };
}
