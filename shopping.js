// shopping.js – Einkaufsliste: Rezepte hinzufügen, neu berechnen, manuelle Artikel,
// transaktionssicheres Abhaken mit Vorratsübernahme und kontrolliertes Rückgängigmachen.
import { runTransaction, getAllItems } from './db.js';
import { normalizeShoppingItem, normalizeSelectedRecipe, normalizePantryItem, normalizeMealPlanEntry, CATEGORIES, shoppingGroupFor } from './core/models.js';
import { aggregateNeeds, computePlan, mergePlanIntoList, previewForRecipe, undoAnalysis } from './core/shopping-logic.js';
import { buildDemand } from './core/demand.js';
import { ingredientKey, catalogEntryFor } from './core/catalog.js';
import { normalizeUnit, convertWithIngredient, roundQuantity } from './units.js';
import { parseNumber, nowIso, uuid, normalizeText, sanitizeText, todayString } from './core/utils.js';

const inFlight = new Set();

/** Baut die effektiven Rezepte (inkl. hinterlegter Alternativen) aus Einzelrezepten – Kompatibilität zu 0.1. */
export function buildSelections(selected, recipesById, profile, catalog) {
  return buildDemand({ selected, planEntries: [], recipesById, profile, catalog });
}

/** Stores, die eine Neuberechnung liest bzw. schreibt (gemeinsame Bedarfsquelle, CLAUDE.md 4.1). */
export const RECOMPUTE_STORES = Object.freeze(['selectedRecipes', 'mealPlan', 'pantry', 'shoppingList', 'metadata']);

const RANGE_KEY = 'shoppingRange';
function validRange(v) {
  return v && typeof v.from === 'string' && typeof v.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.from) && /^\d{4}-\d{2}-\d{2}$/.test(v.to) && v.from <= v.to ? { from: v.from, to: v.to } : null;
}

export async function getShoppingState() {
  const [items, selected] = await Promise.all([getAllItems('shoppingList'), getAllItems('selectedRecipes')]);
  return { items: items.map((i) => normalizeShoppingItem(i)), selected: selected.map((s) => normalizeSelectedRecipe(s)) };
}

/** Vorschau vor dem Hinzufügen: berücksichtigt bereits ausgewählte Rezepte und den aktuellen Vorrat. */
export async function previewAddRecipe(recipe, servings, { recipesById, profile, catalog }) {
  const [pantry, selected, planRaw] = await Promise.all([getAllItems('pantry'), getAllItems('selectedRecipes'), getAllItems('mealPlan')]);
  const others = selected.map((s) => normalizeSelectedRecipe(s)).filter((s) => s.recipeId !== recipe.id);
  const all = [...others, normalizeSelectedRecipe({ recipeId: recipe.id, title: recipe.title, servings })];
  const map = new Map(recipesById);
  map.set(recipe.id, recipe);
  const { selections } = buildDemand({ selected: all, planEntries: planRaw.map((e) => normalizeMealPlanEntry(e)), recipesById: map, profile, catalog, today: todayString() });
  const plan = computePlan(aggregateNeeds(selections, catalog), pantry, catalog);
  return { servings, ...previewForRecipe(recipe.id, plan), alreadySelected: selected.some((s) => s.recipeId === recipe.id) };
}

/** Neuberechnung innerhalb EINER Transaktion über Auswahl, Vorrat und Einkaufsliste. */
export async function recomputeInTx(t, { recipesById, profile, catalog, today = todayString() }) {
  const [selectedRaw, planRaw, pantry, itemsRaw] = [await t.getAll('selectedRecipes'), await t.getAll('mealPlan'), await t.getAll('pantry'), await t.getAll('shoppingList')];
  const selected = selectedRaw.map((s) => normalizeSelectedRecipe(s));
  const planEntries = planRaw.map((e) => normalizeMealPlanEntry(e));
  const items = itemsRaw.map((i) => normalizeShoppingItem(i));
  const range = validRange((await t.get('metadata', RANGE_KEY))?.value);
  const { selections, skipped } = buildDemand({ selected, planEntries, recipesById, profile, catalog, today, range });
  const plan = computePlan(aggregateNeeds(selections, catalog), pantry, catalog);
  const merged = mergePlanIntoList(items, plan);
  for (const r of merged.removed) await t.delete('shoppingList', r.id);
  for (const i of [...merged.added, ...merged.updated]) await t.put('shoppingList', i);
  return { added: merged.added.length, updated: merged.updated.length, removed: merged.removed.length, skipped };
}

/** Gewählter Einkaufszeitraum für den Wochenplan (null = alle kommenden geplanten Mahlzeiten). */
export async function getShoppingRange() {
  const rec = await runTransaction(['metadata'], 'readonly', (t) => t.get('metadata', RANGE_KEY));
  return validRange(rec?.value);
}

/** Vorschau für einen Zeitraum – schreibt nichts. */
export async function previewShoppingRange(from, to, { recipesById, profile, catalog }) {
  const [pantry, selected, planRaw] = await Promise.all([getAllItems('pantry'), getAllItems('selectedRecipes'), getAllItems('mealPlan')]);
  const planEntries = planRaw.map((e) => normalizeMealPlanEntry(e));
  const range = validRange({ from, to });
  if (!range) return { status: 'invalid', needed: [], sufficient: [], check: [], planCount: 0 };
  const onlyPlan = buildDemand({ selected: [], planEntries, recipesById, profile, catalog, today: todayString(), range });
  const { selections, skipped } = buildDemand({ selected: selected.map((s) => normalizeSelectedRecipe(s)), planEntries, recipesById, profile, catalog, today: todayString(), range });
  const plan = computePlan(aggregateNeeds(selections, catalog), pantry, catalog);
  const fromPlan = plan.filter((p) => p.recipeSources.some((src) => src.sourceType !== 'single'));
  return {
    status: onlyPlan.selections.length ? 'ok' : 'empty',
    planCount: onlyPlan.selections.length,
    skipped,
    needed: fromPlan.filter((p) => typeof p.amountToBuy === 'number' && p.amountToBuy > 0 && !p.quantityCheck),
    sufficient: fromPlan.filter((p) => p.amountToBuy === 0 && !p.quantityCheck),
    check: fromPlan.filter((p) => p.quantityCheck && p.amountToBuy !== 0),
  };
}

/** „Einkaufsliste für diese Woche“: Zeitraum setzen und neu berechnen. Leerer Zeitraum ändert nichts. */
export async function applyShoppingRange(from, to, ctx) {
  const range = validRange({ from, to });
  if (!range) return { status: 'invalid' };
  return runTransaction(RECOMPUTE_STORES, 'readwrite', async (t) => {
    const planEntries = (await t.getAll('mealPlan')).map((e) => normalizeMealPlanEntry(e));
    const probe = buildDemand({ selected: [], planEntries, recipesById: ctx.recipesById, profile: ctx.profile, catalog: ctx.catalog, today: todayString(), range });
    if (!probe.selections.length && !probe.skipped.length) return { status: 'empty' };
    await t.put('metadata', { id: RANGE_KEY, value: range, updatedAt: nowIso() });
    const res = await recomputeInTx(t, ctx);
    return { status: 'applied', ...res };
  });
}

/** Zeitraum aufheben: alle kommenden geplanten Mahlzeiten berücksichtigen. */
export async function clearShoppingRange(ctx) {
  return runTransaction(RECOMPUTE_STORES, 'readwrite', async (t) => {
    await t.delete('metadata', RANGE_KEY);
    return recomputeInTx(t, ctx);
  });
}

export async function recomputeShoppingList(ctx) {
  return runTransaction(RECOMPUTE_STORES, 'readwrite', (t) => recomputeInTx(t, ctx));
}

export async function addRecipeToShopping(recipe, servings, ctx) {
  const s = Math.round(Math.min(50, Math.max(1, parseNumber(servings) ?? recipe.defaultServings)));
  return runTransaction(RECOMPUTE_STORES, 'readwrite', async (t) => {
    const existing = await t.get('selectedRecipes', recipe.id);
    await t.put('selectedRecipes', normalizeSelectedRecipe({ ...(existing ?? {}), recipeId: recipe.id, title: recipe.title, servings: s, updatedAt: nowIso() }));
    const map = new Map(ctx.recipesById);
    map.set(recipe.id, recipe);
    return recomputeInTx(t, { ...ctx, recipesById: map });
  });
}

export async function updateSelectedServings(recipeId, servings, ctx) {
  const s = Math.round(Math.min(50, Math.max(1, parseNumber(servings) ?? 1)));
  return runTransaction(RECOMPUTE_STORES, 'readwrite', async (t) => {
    const existing = await t.get('selectedRecipes', recipeId);
    if (!existing) throw new Error('Rezept ist nicht ausgewählt.');
    await t.put('selectedRecipes', { ...existing, servings: s, updatedAt: nowIso() });
    return recomputeInTx(t, ctx);
  });
}

/** Entfernt nur den Bedarf dieses Rezepts; gekaufte Artikel bleiben im Vorrat. */
export async function removeSelectedRecipe(recipeId, ctx) {
  return runTransaction(RECOMPUTE_STORES, 'readwrite', async (t) => {
    await t.delete('selectedRecipes', recipeId);
    return recomputeInTx(t, ctx);
  });
}

export function validateManualItem(input) {
  const errors = {};
  const name = sanitizeText(input.name, 80);
  if (!name) errors.name = 'Bitte gib einen Artikelnamen ein.';
  const amount = parseNumber(input.amount);
  if (amount === null || amount <= 0 || amount > 1_000_000) errors.amount = 'Bitte gib eine Menge größer als 0 ein.';
  const unit = normalizeUnit(input.unit);
  if (!unit) errors.unit = 'Bitte wähle eine Einheit.';
  const category = CATEGORIES.includes(input.category) ? input.category : null;
  if (!category) errors.category = 'Bitte wähle eine Kategorie.';
  return { ok: !Object.keys(errors).length, errors, values: { name, amount, unit, category } };
}

export async function addManualItem(input, catalog) {
  const v = validateManualItem(input);
  if (!v.ok) return v;
  const entry = catalog ? catalogEntryFor({ name: v.values.name }, catalog) : null;
  const item = normalizeShoppingItem({
    id: uuid(), name: v.values.name, ingredientId: entry?.id ?? null, amountNeeded: v.values.amount, amountAvailable: 0,
    amountToBuy: v.values.amount, unit: v.values.unit, category: v.values.category, shoppingGroup: shoppingGroupFor(v.values.category, entry?.shoppingGroup),
    manuallyAdded: true, recipeSources: [],
  });
  item.key = entry ? `id:${entry.id}` : `n:${normalizeText(item.name)}`;
  await runTransaction(['shoppingList'], 'readwrite', (t) => t.put('shoppingList', item));
  return { ok: true, item };
}

export async function setPurchasedAmount(id, value) {
  const n = value === '' || value === null || value === undefined ? null : parseNumber(value);
  if (n !== null && (n < 0 || n > 1_000_000)) return { ok: false, error: 'Die gekaufte Menge muss zwischen 0 und 1.000.000 liegen.' };
  if (value !== '' && value !== null && value !== undefined && n === null) return { ok: false, error: 'Bitte gib eine gültige Zahl ein.' };
  return runTransaction(['shoppingList'], 'readwrite', async (t) => {
    const item = await t.get('shoppingList', id);
    if (!item) throw new Error('Eintrag nicht gefunden.');
    if (item.addedToPantry) return { ok: false, error: 'Diese Menge wurde bereits in den Vorrat übernommen.' };
    await t.put('shoppingList', { ...item, amountPurchased: n === null ? null : roundQuantity(n), updatedAt: nowIso() });
    return { ok: true };
  });
}

function findPantryTarget(pantry, item, catalog, entry) {
  const key = item.key && !item.key.includes('|') ? item.key : ingredientKey(item, catalog);
  const candidates = pantry.filter((p) => ingredientKey(p, catalog) === key && convertWithIngredient(1, item.unit, p.unit, entry) !== null);
  candidates.sort((a, b) => (normalizeUnit(a.unit) === normalizeUnit(item.unit) ? -1 : 0) - (normalizeUnit(b.unit) === normalizeUnit(item.unit) ? -1 : 0)
    || (a.expiryDate ? 1 : 0) - (b.expiryDate ? 1 : 0));
  return candidates[0] ?? null;
}

/** Kern des Abhakens innerhalb einer Transaktion (wird von Einzel- und Gesamtübernahme genutzt). */
async function checkInTx(t, id, catalog) {
  const raw = await t.get('shoppingList', id);
  if (!raw) throw new Error('Eintrag nicht gefunden.');
  const item = normalizeShoppingItem(raw);
  if (item.checked && item.addedToPantry) return { status: 'already' };
  if (item.addedToPantry) {
    await t.put('shoppingList', { ...item, checked: true, updatedAt: nowIso() });
    return { status: 'checkedWithoutAdding' };
  }
  const amount = item.amountPurchased ?? item.amountToBuy;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw new Error('Bitte trage zuerst die tatsächlich gekaufte Menge ein.');
  }
  if (!normalizeUnit(item.unit)) throw new Error('Die Einheit ist unbekannt. Bitte Menge prüfen.');
  const entry = catalogEntryFor(item, catalog);
  const pantry = await t.getAll('pantry');
  const target = findPantryTarget(pantry, item, catalog, entry);
  const txId = uuid();
  const now = nowIso();
  let pantryItem;
  let added;
  if (target) {
    added = convertWithIngredient(amount, item.unit, target.unit, entry);
    pantryItem = { ...target, amount: roundQuantity((target.amount ?? 0) + added), updatedAt: now };
  } else {
    added = amount;
    pantryItem = normalizePantryItem({
      name: entry?.name ?? item.name, ingredientId: item.ingredientId ?? entry?.id ?? null, category: item.category,
      amount, unit: item.unit, createdByTransaction: txId, nutritionSource: entry?.nutrition ? 'catalog' : 'none', createdAt: now, updatedAt: now,
    });
  }
  await t.put('pantry', pantryItem);
  await t.put('shoppingList', {
    ...item, amountPurchased: amount, checked: true, addedToPantry: true, pantryTransactionId: txId, pantryItemId: pantryItem.id,
    pantryAmountAdded: added, pantryUnit: pantryItem.unit, pantryAmountAfter: pantryItem.amount, updatedAt: now,
  });
  return { status: 'added', amount: added, unit: pantryItem.unit, pantryItemId: pantryItem.id, pantryAmountAfter: pantryItem.amount };
}

/**
 * Abhaken mit automatischer Vorratsübernahme – transaktionssicher und idempotent.
 */
export async function checkShoppingItem(id, catalog) {
  if (inFlight.has(id)) return { status: 'busy' };
  inFlight.add(id);
  try {
    return await runTransaction(['shoppingList', 'pantry'], 'readwrite', (t) => checkInTx(t, id, catalog));
  } finally {
    inFlight.delete(id);
  }
}

function bookable(i) {
  const amount = i.amountPurchased ?? i.amountToBuy;
  return typeof amount === 'number' && Number.isFinite(amount) && amount > 0 && !!normalizeUnit(i.unit);
}

/** Vorschau für „Einkauf komplett übernehmen“. */
export async function previewCheckAll() {
  const items = (await getAllItems('shoppingList')).map((i) => normalizeShoppingItem(i)).filter((i) => !i.checked);
  return { items: items.filter(bookable), skipped: items.filter((i) => !bookable(i)) };
}

/**
 * Alle offenen Artikel mit gültiger Menge in EINER Transaktion abhaken und in den Vorrat übernehmen.
 * Artikel ohne Menge werden übersprungen. Idempotent: Der Status wird innerhalb der Transaktion geprüft,
 * daher bucht ein zweiter Aufruf (auch aus einem anderen Tab) nichts doppelt.
 * failAfter: nur für Tests – erzwingt einen Fehler nach n Buchungen (Rollback-Prüfung).
 */
export async function checkAllOpen(catalog, { failAfter = null } = {}) {
  const key = 'check-all';
  if (inFlight.has(key)) return { status: 'busy', added: 0, skipped: [] };
  inFlight.add(key);
  try {
    return await runTransaction(['shoppingList', 'pantry'], 'readwrite', async (t) => {
      const open = (await t.getAll('shoppingList')).map((i) => normalizeShoppingItem(i)).filter((i) => !i.checked);
      const skipped = open.filter((i) => !bookable(i) && !i.addedToPantry);
      let added = 0;
      for (const i of open) {
        if (skipped.includes(i)) continue;
        const r = await checkInTx(t, i.id, catalog);
        if (r.status === 'added') added += 1;
        if (failAfter !== null && added >= failAfter) throw new Error('Absichtlicher Testfehler');
      }
      return { status: added || open.length > skipped.length ? 'done' : 'nothing', added, skipped };
    });
  } finally {
    inFlight.delete(key);
  }
}

export async function getUndoInfo(id) {
  return runTransaction(['shoppingList', 'pantry'], 'readonly', async (t) => {
    const item = await t.get('shoppingList', id);
    if (!item) return { possible: false };
    const p = item.pantryItemId ? await t.get('pantry', item.pantryItemId) : null;
    return { ...undoAnalysis(normalizeShoppingItem(item), p), item: normalizeShoppingItem(item), pantryItem: p };
  });
}

/**
 * Rückgängig machen.
 * mode 'removeFromPantry': höchstens die hinzugefügte Menge entfernen, nie negativ.
 * mode 'resetOnly': Vorrat unverändert; erneutes Abhaken addiert NICHT erneut.
 */
export async function undoCheck(id, mode) {
  if (mode !== 'removeFromPantry' && mode !== 'resetOnly') throw new Error('Ungültige Aktion');
  if (inFlight.has(id)) return { status: 'busy' };
  inFlight.add(id);
  try {
    return await runTransaction(['shoppingList', 'pantry'], 'readwrite', async (t) => {
      const raw = await t.get('shoppingList', id);
      if (!raw) throw new Error('Eintrag nicht gefunden.');
      const item = normalizeShoppingItem(raw);
      const now = nowIso();
      if (mode === 'resetOnly' || !item.addedToPantry) {
        await t.put('shoppingList', { ...item, checked: false, updatedAt: now });
        return { status: 'reset', removed: 0 };
      }
      let removed = 0;
      const p = item.pantryItemId ? await t.get('pantry', item.pantryItemId) : null;
      if (p) {
        removed = roundQuantity(Math.min(item.pantryAmountAdded ?? 0, Math.max(0, p.amount ?? 0)));
        const newAmount = roundQuantity(Math.max(0, (p.amount ?? 0) - removed));
        if (newAmount === 0 && p.createdByTransaction && p.createdByTransaction === item.pantryTransactionId) await t.delete('pantry', p.id);
        else await t.put('pantry', { ...p, amount: newAmount, updatedAt: now });
      }
      await t.put('shoppingList', {
        ...item, checked: false, addedToPantry: false, pantryTransactionId: null, pantryItemId: null,
        pantryAmountAdded: null, pantryUnit: null, pantryAmountAfter: null, updatedAt: now,
      });
      return { status: 'removed', removed, unit: p?.unit ?? item.unit };
    });
  } finally {
    inFlight.delete(id);
  }
}

/** Bewusste neue Kaufaktion für einen zurückgesetzten Artikel (danach addiert Abhaken wieder). */
export async function startNewPurchase(id) {
  return runTransaction(['shoppingList'], 'readwrite', async (t) => {
    const item = await t.get('shoppingList', id);
    if (!item || item.checked) return { ok: false };
    await t.put('shoppingList', { ...item, addedToPantry: false, pantryTransactionId: null, pantryItemId: null, pantryAmountAdded: null, pantryUnit: null, pantryAmountAfter: null, amountPurchased: null, updatedAt: nowIso() });
    return { ok: true };
  });
}

export async function deleteShoppingItem(id) {
  return runTransaction(['shoppingList'], 'readwrite', async (t) => {
    const item = await t.get('shoppingList', id);
    if (!item) return { ok: false };
    if (!item.manuallyAdded && !item.checked && !item.addedToPantry) return { ok: false, error: 'Automatisch berechnete Artikel ändern sich über die ausgewählten Rezepte.' };
    await t.delete('shoppingList', id);
    return { ok: true };
  });
}

/** Entfernt erledigte (abgehakte) Artikel. Der Vorrat bleibt unverändert. */
export async function clearCompleted() {
  return runTransaction(['shoppingList'], 'readwrite', async (t) => {
    const items = await t.getAll('shoppingList');
    let n = 0;
    for (const i of items) if (i.checked) { await t.delete('shoppingList', i.id); n += 1; }
    return n;
  });
}
