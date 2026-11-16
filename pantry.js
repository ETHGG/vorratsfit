// pantry.js – Vorratsverwaltung (CRUD, Suche, Filter, Ablaufdaten).
import { getAllItems, deleteItem, getItem, runTransaction, getMeta } from './db.js';
import { normalizePantryItem, CATEGORIES } from './core/models.js';
import { normalizeText, parseNumber, isValidDateString, daysUntil, todayString, nowIso, uuid } from './core/utils.js';
import { normalizeUnit, roundQuantity, convertWithIngredient } from './units.js';
import { catalogEntryFor, ingredientKey } from './core/catalog.js';

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
  await runTransaction(['pantry', 'metadata'], 'readwrite', async (t) => {
    await t.put('pantry', item);
    if (!existing && item.amount > 0) await bumpFrequency(t, item);
  });
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

// ---------- Schnellerfassen (0.2, Phase 5) ----------
// Häufigkeitsdaten liegen im Store „metadata“ und sind bewusst NICHT im Backup (CLAUDE.md 4.4).
const FREQ_KEY = 'pantryFrequency';
const MAX_FREQUENT = 12;

async function bumpFrequency(t, item) {
  const rec = await t.get('metadata', FREQ_KEY);
  const list = Array.isArray(rec?.value) ? rec.value.filter((x) => x && typeof x.name === 'string') : [];
  const key = item.ingredientId ? `id:${item.ingredientId}` : `n:${normalizeText(item.name)}`;
  const found = list.find((x) => x.key === key);
  if (found) { found.count += 1; found.amount = item.amount; found.unit = item.unit; found.lastUsed = nowIso(); }
  else list.push({ key, name: item.name, ingredientId: item.ingredientId ?? null, category: item.category, amount: item.amount, unit: item.unit, count: 1, lastUsed: nowIso() });
  list.sort((a, b) => b.count - a.count || b.lastUsed.localeCompare(a.lastUsed));
  await t.put('metadata', { id: FREQ_KEY, value: list.slice(0, 40), updatedAt: nowIso() });
}

/** Die häufigsten erfassten Lebensmittel (für Ein-Tipp-Knöpfe). */
export async function frequentItems() {
  const v = await getMeta(FREQ_KEY);
  return Array.isArray(v) ? v.slice(0, MAX_FREQUENT) : [];
}

/** Ein Vorratseintrag in einer laufenden Transaktion: passende Einheit erhöhen, sonst neu anlegen. */
async function addOrIncrease(t, input, catalog) {
  const entry = catalogEntryFor(input, catalog);
  const unit = normalizeUnit(input.unit);
  const key = ingredientKey({ ingredientId: input.ingredientId ?? entry?.id, name: input.name }, catalog);
  const pantry = (await t.getAll('pantry')).map((p) => normalizePantryItem(p));
  const target = pantry.find((p) => ingredientKey(p, catalog) === key && convertWithIngredient(1, unit, p.unit, entry) !== null && !p.expiryDate)
    ?? pantry.find((p) => ingredientKey(p, catalog) === key && convertWithIngredient(1, unit, p.unit, entry) !== null);
  if (target) {
    const add = convertWithIngredient(input.amount, unit, target.unit, entry);
    await t.put('pantry', { ...target, amount: roundQuantity(Math.min(MAX_PANTRY_AMOUNT, target.amount + add)), updatedAt: nowIso() });
    return 'increased';
  }
  await t.put('pantry', normalizePantryItem({
    name: entry?.name ?? input.name, ingredientId: input.ingredientId ?? entry?.id ?? null, category: input.category || entry?.category || 'Sonstiges',
    amount: input.amount, unit, nutritionPer100g: entry?.nutrition && entry.nutritionBasis === '100g' ? entry.nutrition : null, nutritionSource: entry?.nutrition ? 'catalog' : 'none',
  }));
  return 'created';
}

/** Häufig-genutzt-Knopf: Standardmenge hinzufügen bzw. vorhandene Menge erhöhen. */
export async function addFrequentItem(item, catalog) {
  if (!(item.amount > 0) || !normalizeUnit(item.unit)) return { status: 'invalid' };
  return runTransaction(['pantry', 'metadata'], 'readwrite', async (t) => {
    const status = await addOrIncrease(t, item, catalog);
    await bumpFrequency(t, item);
    return { status };
  });
}

/** Mehrere Zeilen speichern (nur Zeilen mit Status „ok“), in einer Transaktion. */
export async function addBulkToPantry(items, catalog) {
  const ok = items.filter((i) => i.status === 'ok');
  return runTransaction(['pantry', 'metadata'], 'readwrite', async (t) => {
    for (const i of ok) { await addOrIncrease(t, i, catalog); await bumpFrequency(t, i); }
    return { saved: ok.length, skipped: items.length - ok.length };
  });
}
