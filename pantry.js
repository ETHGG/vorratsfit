// pantry.js – Vorratsverwaltung (CRUD, Suche, Filter, Ablaufdaten).
import { getAllItems, putItem, deleteItem, getItem, runTransaction } from './db.js';
import { normalizePantryItem, CATEGORIES } from './core/models.js';
import { normalizeText, parseNumber, isValidDateString, daysUntil, todayString, nowIso, uuid } from './core/utils.js';
import { normalizeUnit, roundQuantity } from './units.js';
import { catalogEntryFor } from './core/catalog.js';

export const MAX_PANTRY_AMOUNT = 1_000_000;

/** Validiert ein Vorratsformular. */
export function validatePantryInput(input, catalog) {
  const errors = {};
  const name = String(input.name ?? '').trim();
  if (!name) errors.name = 'Bitte gib einen Namen ein.';
  else if (name.length > 80) errors.name = 'Der Name darf höchstens 80 Zeichen lang sein.';
  const amount = parseNumber(input.amount);
  if (amount === null) errors.amount = 'Bitte gib eine gültige Menge ein.';
  else if (amount < 0 || amount > MAX_PANTRY_AMOUNT) errors.amount = 'Die Menge muss zwischen 0 und 1.000.000 liegen.';
  const unit = normalizeUnit(input.unit);
  if (!unit) errors.unit = 'Bitte wähle eine gültige Einheit.';
  if (input.category && !CATEGORIES.includes(input.category)) errors.category = 'Bitte wähle eine Kategorie.';
  if (input.expiryDate && !isValidDateString(input.expiryDate)) errors.expiryDate = 'Bitte gib ein gültiges Datum ein.';
  if (input.barcode && !/^\d{8,14}$/.test(String(input.barcode).trim())) errors.barcode = 'Ein Barcode besteht aus 8 bis 14 Ziffern.';
  if (Object.keys(errors).length) return { ok: false, errors };
  const entry = catalog ? catalogEntryFor({ name }, catalog) : null;
  const item = normalizePantryItem({
    ...input,
    name,
    amount,
    unit,
    ingredientId: input.ingredientId || entry?.id || null,
    category: input.category || entry?.category || 'Sonstiges',
    nutritionPer100g: input.nutritionPer100g ?? (entry?.nutrition && entry.nutritionBasis === '100g' ? entry.nutrition : null),
    nutritionSource: input.nutritionSource ?? (entry?.nutrition ? 'catalog' : 'none'),
    updatedAt: nowIso(),
  });
  return { ok: true, errors: {}, item };
}

export async function listPantry() {
  return (await getAllItems('pantry')).map((r) => normalizePantryItem(r));
}

export async function savePantryItem(input, catalog) {
  const res = validatePantryInput(input, catalog);
  if (!res.ok) return res;
  const existing = input.id ? await getItem('pantry', input.id) : null;
  const item = { ...res.item, createdAt: existing?.createdAt ?? res.item.createdAt };
  await putItem('pantry', item);
  return { ok: true, item };
}

export async function deletePantryItem(id) {
  await deleteItem('pantry', id);
}

/** Ändert die Menge transaktionssicher um delta (nie negativ). */
export async function changePantryAmount(id, delta) {
  return runTransaction(['pantry'], 'readwrite', async (t) => {
    const item = await t.get('pantry', id);
    if (!item) throw new Error('Eintrag nicht gefunden.');
    const amount = roundQuantity(Math.min(MAX_PANTRY_AMOUNT, Math.max(0, (item.amount ?? 0) + delta)));
    const updated = { ...item, amount, updatedAt: nowIso() };
    await t.put('pantry', updated);
    return updated;
  });
}

export function expiryStatus(item, warnDays = 3, today = todayString()) {
  if (!item.expiryDate) return null;
  const d = daysUntil(item.expiryDate, today);
  if (d === null) return null;
  if (d < 0) return { level: 'expired', days: d, label: `Abgelaufen seit ${-d} ${-d === 1 ? 'Tag' : 'Tagen'}` };
  if (d === 0) return { level: 'soon', days: d, label: 'Läuft heute ab' };
  if (d <= warnDays) return { level: 'soon', days: d, label: `Läuft in ${d} ${d === 1 ? 'Tag' : 'Tagen'} ab` };
  return { level: 'ok', days: d, label: `Haltbar bis ${item.expiryDate.split('-').reverse().join('.')}` };
}

export function isSpiceItem(item) {
  return item.category === 'Gewürze';
}

/** Filtert den Vorrat nach Suchtext, Kategorie, Gewürzen und Ablauf. */
export function filterPantry(items, { query = '', category = '', spices = 'exclude', expiringOnly = false, warnDays = 3, today = todayString() } = {}) {
  const q = normalizeText(query);
  return items
    .filter((i) => (spices === 'only' ? isSpiceItem(i) : spices === 'exclude' ? !isSpiceItem(i) : true))
    .filter((i) => !category || i.category === category)
    .filter((i) => !q || i.normalizedName.includes(q) || normalizeText(i.category).includes(q))
    .filter((i) => {
      if (!expiringOnly) return true;
      const s = expiryStatus(i, warnDays, today);
      return s && s.level !== 'ok';
    })
    .sort((a, b) => {
      const da = a.expiryDate ? daysUntil(a.expiryDate, today) : 9999;
      const db = b.expiryDate ? daysUntil(b.expiryDate, today) : 9999;
      if (expiringOnly && da !== db) return da - db;
      return a.name.localeCompare(b.name, 'de');
    });
}

export function expiringSoon(items, warnDays = 3, today = todayString()) {
  return filterPantry(items, { spices: 'all', expiringOnly: true, warnDays, today }).filter((i) => i.amount > 0);
}

/** Gekochtes Rezept: Mengen transaktionssicher abziehen (nie negativ). */
export async function consumeFromPantry(consumptions) {
  return runTransaction(['pantry'], 'readwrite', async (t) => {
    const changed = [];
    for (const c of consumptions) {
      const item = await t.get('pantry', c.pantryId);
      if (!item) continue;
      const amount = roundQuantity(Math.max(0, (item.amount ?? 0) - c.amount));
      await t.put('pantry', { ...item, amount, updatedAt: nowIso() });
      changed.push({ id: item.id, name: item.name, before: item.amount, after: amount, unit: item.unit });
    }
    return changed;
  });
}

export function newPantryId() {
  return uuid();
}
