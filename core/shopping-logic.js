// core/shopping-logic.js – reine Einkaufsberechnung (Differenz, Zusammenführung, Neuberechnung).
// Formel: zu kaufen = max(0, skalierter Gesamtbedarf − vorhandener Vorrat). Vorrat wird je Zutat nur EINMAL abgezogen.
import { normalizeUnit, toBase, convertWithIngredient, computeToBuy, roundQuantity } from '../units.js';
import { ingredientKey, catalogEntryFor, EMPTY_CATALOG } from './catalog.js';
import { scaleRecipe, indexPantry } from './scoring.js';
import { shoppingGroupFor, normalizeShoppingItem, CATEGORIES } from './models.js';
import { normalizeText, uuid, nowIso } from './utils.js';

/**
 * Aggregiert den Bedarf mehrerer Rezepte.
 * @param {{recipeId:string,title:string,servings:number,recipe:object}[]} selections – recipe = effektives Rezept (nach Allergie-Alternativen)
 */
export function aggregateNeeds(selections, catalog = EMPTY_CATALOG) {
  const needs = new Map();
  for (const sel of selections) {
    if (!sel?.recipe) continue;
    const scaled = scaleRecipe(sel.recipe, sel.servings);
    const all = [...scaled.ingredients, ...scaled.spices].filter((i) => !i.optional);
    for (const ing of all) {
      const entry = catalogEntryFor(ing, catalog);
      const baseKey = ingredientKey(ing, catalog);
      const unit = normalizeUnit(ing.unit);
      const base = unit && typeof ing.amount === 'number' ? toBase(ing.amount, unit) : null;
      const source = { recipeId: sel.recipeId, title: sel.title ?? sel.recipe.title, servings: scaled.servings, amount: ing.amount, unit: unit ?? ing.unit ?? null, sourceType: sel.sourceType ?? 'single', sourceId: sel.sourceId ?? sel.recipeId, label: sel.label ?? null };
      let key = baseKey;
      let group = needs.get(key);
      let add = null;
      if (group) {
        if (base && group.unit) {
          add = convertWithIngredient(base.value, base.unit, group.unit, entry);
          if (add === null) key = `${baseKey}|${base.dimension}`;
        } else if (base && !group.unit) {
          key = `${baseKey}|${base.dimension}`;
        } else if (!base && group.unit) {
          key = `${baseKey}|unknown`;
        }
        if (key !== baseKey) {
          group = needs.get(key);
          add = group && base ? base.value : null;
        }
      }
      if (!group) {
        const category = entry?.category ?? (CATEGORIES.includes(ing.category) ? ing.category : 'Sonstiges');
        group = {
          key,
          baseKey,
          ingredientId: entry?.id ?? ing.ingredientId ?? null,
          name: entry?.name ?? ing.name,
          normalizedName: normalizeText(entry?.name ?? ing.name),
          category,
          shoppingGroup: shoppingGroupFor(category, entry?.shoppingGroup),
          unit: base ? base.unit : null,
          amount: base ? 0 : null,
          isSpice: !!ing.isSpice || category === 'Gewürze',
          quantityCheck: !base,
          sources: [],
        };
        needs.set(key, group);
        add = base ? base.value : null;
      }
      if (base && add !== null && group.amount !== null) group.amount = roundQuantity(group.amount + add);
      else group.quantityCheck = true;
      group.sources.push(source);
    }
  }
  return Array.from(needs.values());
}

/** Zieht den aktuellen Vorrat (je Zutat nur einmal) vom Gesamtbedarf ab. */
export function computePlan(needs, pantry, catalog = EMPTY_CATALOG) {
  const index = indexPantry(pantry, catalog);
  const used = new Set();
  const plan = [];
  const sorted = [...needs].sort((a, b) => (a.key.includes('|') ? 1 : 0) - (b.key.includes('|') ? 1 : 0));
  for (const need of sorted) {
    const entry = need.ingredientId ? catalog.get(need.ingredientId) : catalogEntryFor({ name: need.name }, catalog);
    const allEntries = (index.get(need.baseKey) ?? []).filter((e) => e.amount > 0);
    const entries = allEntries.filter((e) => !used.has(e.id));
    let result;
    if (need.amount === null || !need.unit) {
      const spiceAvailable = need.isSpice && allEntries.length > 0;
      result = { amountNeeded: null, amountAvailable: null, amountToBuy: spiceAvailable ? 0 : null, quantityCheck: !spiceAvailable };
    } else {
      const usable = entries.filter((e) => convertWithIngredient(e.amount, e.unit, need.unit, entry) !== null);
      const calc = computeToBuy(need.amount, need.unit, usable, entry);
      usable.forEach((e) => used.add(e.id));
      const otherDims = entries.filter((e) => !usable.includes(e));
      let quantityCheck = need.quantityCheck;
      let toBuy = calc.toBuy;
      if (otherDims.length && toBuy > 0) {
        if (need.isSpice) toBuy = 0; else quantityCheck = true;
      }
      result = { amountNeeded: need.amount, amountAvailable: calc.available, amountToBuy: toBuy, quantityCheck };
    }
    plan.push({
      key: need.key,
      ingredientId: need.ingredientId,
      name: need.name,
      normalizedName: need.normalizedName,
      category: need.category,
      shoppingGroup: need.shoppingGroup,
      unit: need.unit ?? (need.sources[0]?.unit || 'Stück'),
      isSpice: need.isSpice,
      recipeSources: need.sources,
      ...result,
    });
  }
  return plan;
}

export function planNeedsPurchase(p) {
  return (typeof p.amountToBuy === 'number' && p.amountToBuy > 0) || (p.quantityCheck && p.amountToBuy !== 0);
}

/** Ist ein Eintrag "eingefroren" (manuell, abgehakt oder bereits in den Vorrat übernommen)? */
export function isFrozen(item) {
  return item.manuallyAdded || item.checked || item.addedToPantry;
}

/**
 * Führt einen neu berechneten Plan mit der bestehenden Liste zusammen.
 */
export function mergePlanIntoList(existing, plan, now = nowIso()) {
  const frozen = existing.filter(isFrozen);
  const open = existing.filter((i) => !isFrozen(i));
  const openByKey = new Map(open.map((i) => [`${i.key}::${i.unit}`, i]));
  const result = [...frozen];
  const added = [];
  const updated = [];
  const keep = new Set();
  for (const p of plan) {
    if (!planNeedsPurchase(p)) continue;
    const prev = openByKey.get(`${p.key}::${p.unit}`);
    const base = prev ?? { id: uuid(), createdAt: now, amountPurchased: null };
    const item = normalizeShoppingItem({
      ...base,
      key: p.key,
      ingredientId: p.ingredientId,
      name: p.name,
      normalizedName: p.normalizedName,
      amountNeeded: p.amountNeeded,
      amountAvailable: p.amountAvailable ?? 0,
      amountToBuy: p.amountToBuy,
      amountPurchased: prev && prev.amountPurchased !== null && prev.amountPurchased !== prev.amountToBuy ? prev.amountPurchased : null,
      unit: p.unit,
      category: p.category,
      shoppingGroup: p.shoppingGroup,
      recipeSources: p.recipeSources,
      manuallyAdded: false,
      quantityCheck: !!p.quantityCheck,
      checked: false,
      addedToPantry: false,
      updatedAt: now,
    }, now);
    if (prev) { keep.add(prev.id); updated.push(item); } else added.push(item);
    result.push(item);
  }
  const removed = open.filter((i) => !keep.has(i.id));
  return { items: result, added, updated, removed };
}

/** Vorschau für "Fehlende Zutaten hinzufügen" eines Rezepts. */
export function previewForRecipe(recipeId, plan) {
  const relevant = plan.filter((p) => p.recipeSources.some((s) => s.recipeId === recipeId));
  return {
    sufficient: relevant.filter((p) => p.amountToBuy === 0 && !p.quantityCheck),
    needed: relevant.filter((p) => typeof p.amountToBuy === 'number' && p.amountToBuy > 0 && !p.quantityCheck),
    check: relevant.filter((p) => p.quantityCheck && p.amountToBuy !== 0),
  };
}

/** Sortiert nach Einkaufsgruppen-Reihenfolge, dann Name. */
export function sortShoppingItems(items, groups) {
  const order = new Map(groups.map((g, i) => [g, i]));
  return [...items].sort((a, b) => (order.get(a.shoppingGroup) ?? 99) - (order.get(b.shoppingGroup) ?? 99) || a.name.localeCompare(b.name, 'de'));
}

/** Prüft die Rückgängig-Situation: Hat sich der Vorrat seit der Übernahme verändert? */
export function undoAnalysis(item, pantryEntry) {
  if (!item?.addedToPantry) return { possible: false, reason: 'Nicht in den Vorrat übernommen.' };
  if (!pantryEntry) return { possible: true, removable: 0, changed: true, missingEntry: true };
  const added = item.pantryAmountAdded ?? 0;
  const current = pantryEntry.amount ?? 0;
  const changed = item.pantryAmountAfter !== null && Math.abs(current - item.pantryAmountAfter) > 1e-9;
  return { possible: true, removable: roundQuantity(Math.min(added, current)), changed, current, added, missingEntry: false };
}
