// core/cooking.js – berechnet, was beim Kochen aus dem Vorrat abgezogen wird (rein, ohne Datenbank).
// Regeln (CLAUDE.md 4.2): nie negativ, fehlende Mengen nennen statt erfinden, unvereinbare Einheiten
// nicht abziehen sondern markieren, Gewürze nicht abziehen.
import { ingredientKey, catalogEntryFor } from './catalog.js';
import { convertWithIngredient, normalizeUnit, roundQuantity, CHECK_QUANTITY_TEXT } from '../units.js';
import { scaleRecipe } from './scoring.js';

const EPS = 1e-9;

/**
 * @param {object} effectiveRecipe Rezept nach Allergie-Alternativen (checkRecipe().effectiveRecipe)
 * @param {number} servings Portionen des Kochvorgangs
 * @param {Array} pantry aktueller Vorrat
 * @returns {{consumptions:Array, missing:Array, unchecked:Array, spicesSkipped:Array}}
 */
export function planConsumption(effectiveRecipe, servings, pantry, catalog) {
  const scaled = scaleRecipe(effectiveRecipe, servings);
  const stock = (pantry ?? []).filter((p) => p.amount > EPS).map((p) => ({ ...p }));
  const index = new Map();
  for (const p of stock) {
    const k = ingredientKey(p, catalog);
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(p);
  }
  // Ältere bzw. bald ablaufende Bestände zuerst verbrauchen.
  for (const list of index.values()) list.sort((a, b) => (a.expiryDate ?? '9999').localeCompare(b.expiryDate ?? '9999'));
  const consumed = new Map();
  const missing = [];
  const unchecked = [];
  for (const ing of scaled.ingredients ?? []) {
    if (ing.optional) continue;
    const unit = normalizeUnit(ing.unit);
    if (typeof ing.amount !== 'number' || !unit) { unchecked.push({ name: ing.name, reason: CHECK_QUANTITY_TEXT }); continue; }
    const entry = catalogEntryFor(ing, catalog);
    const candidates = index.get(ingredientKey(ing, catalog)) ?? [];
    let rest = ing.amount;
    let compatible = false;
    for (const p of candidates) {
      if (rest <= EPS) break;
      if (p.amount <= EPS) continue;
      const avail = convertWithIngredient(p.amount, p.unit, unit, entry);
      if (avail === null) continue;
      compatible = true;
      const take = Math.min(rest, avail);
      let takeInPantry = convertWithIngredient(take, unit, p.unit, entry);
      if (takeInPantry === null) continue;
      takeInPantry = roundQuantity(Math.min(takeInPantry, p.amount));
      p.amount = roundQuantity(p.amount - takeInPantry);
      const prev = consumed.get(p.id);
      consumed.set(p.id, { pantryId: p.id, amount: roundQuantity((prev?.amount ?? 0) + takeInPantry), unit: p.unit, name: p.name });
      rest = roundQuantity(rest - take);
    }
    if (rest > EPS) {
      if (candidates.length && !compatible) unchecked.push({ name: ing.name, reason: `Einheit nicht vergleichbar – ${CHECK_QUANTITY_TEXT}` });
      else missing.push({ name: ing.name, amount: rest, unit });
    }
  }
  return {
    consumptions: Array.from(consumed.values()),
    missing,
    unchecked,
    spicesSkipped: (scaled.spices ?? []).map((s) => s.name),
  };
}
