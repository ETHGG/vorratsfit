// planner.js – Wochenplan in IndexedDB. Jede Änderung berechnet die Einkaufsliste in DERSELBEN
// Transaktion neu (gemeinsame Bedarfsquelle, CLAUDE.md 4.1).
import { runTransaction } from './db.js';
import { normalizeMealPlanEntry, normalizePantryItem } from './core/models.js';
import { validatePlanInput, canPlanRecipe, validateMealPrepInput, buildMealPrepEntries } from './core/plan-logic.js';
import { recomputeInTx, RECOMPUTE_STORES } from './shopping.js';
import { checkRecipe } from './core/restrictions.js';
import { planConsumption } from './core/cooking.js';
import { roundQuantity } from './units.js';
import { nowIso, uuid } from './core/utils.js';

const inFlight = new Set();

/** Plan-Einträge in einem Datumsbereich (über den Datums-Index). */
export async function listPlan(from, to) {
  const rows = await runTransaction(['mealPlan'], 'readonly', (t) => t.getAllInRange('mealPlan', 'date', from, to));
  return rows.map((r) => normalizeMealPlanEntry(r)).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
}

export async function listAllPlan() {
  const rows = await runTransaction(['mealPlan'], 'readonly', (t) => t.getAll('mealPlan'));
  return rows.map((r) => normalizeMealPlanEntry(r));
}

export async function addPlanEntry(input, ctx) {
  const v = validatePlanInput(input);
  if (!v.ok) return v;
  const recipe = ctx.recipesById.get(v.values.recipeId);
  const can = canPlanRecipe(recipe, ctx.profile, ctx.catalog);
  if (!can.allowed) return { ok: false, errors: { recipeId: `Nicht einplanbar: ${can.reason}` } };
  const entry = normalizeMealPlanEntry({ id: uuid(), ...v.values, recipeTitle: recipe.title, mealPrepGroupId: input.mealPrepGroupId, mealPrepIndex: input.mealPrepIndex, mealPrepCount: input.mealPrepCount });
  const recompute = await runTransaction(RECOMPUTE_STORES, 'readwrite', async (t) => {
    await t.put('mealPlan', entry);
    return recomputeInTx(t, ctx);
  });
  return { ok: true, entry, warning: can.warning, recompute };
}

/** Verschieben (Datum/Mahlzeit) und Portionen ändern. */
export async function updatePlanEntry(id, patch, ctx) {
  return runTransaction(RECOMPUTE_STORES, 'readwrite', async (t) => {
    const raw = await t.get('mealPlan', id);
    if (!raw) return { ok: false, errors: { id: 'Eintrag nicht gefunden.' } };
    const current = normalizeMealPlanEntry(raw);
    const v = validatePlanInput({ ...current, ...patch });
    if (!v.ok) return v;
    const entry = { ...current, date: v.values.date, mealType: v.values.mealType, servings: v.values.servings, updatedAt: nowIso() };
    await t.put('mealPlan', entry);
    const recompute = await recomputeInTx(t, ctx);
    return { ok: true, entry, recompute };
  });
}

export async function deletePlanEntry(id, ctx) {
  return runTransaction(RECOMPUTE_STORES, 'readwrite', async (t) => {
    await t.delete('mealPlan', id);
    return recomputeInTx(t, ctx);
  });
}

/** „Woche leeren“: entfernt nur Plan-Einträge. Vorrat, Einkäufe und Tagebuch bleiben unverändert. */
export async function clearPlanRange(from, to, ctx) {
  return runTransaction(RECOMPUTE_STORES, 'readwrite', async (t) => {
    const rows = await t.getAllInRange('mealPlan', 'date', from, to);
    for (const r of rows) await t.delete('mealPlan', r.id);
    await recomputeInTx(t, ctx);
    return rows.length;
  });
}

// ---------- Kochen (CLAUDE.md 4.2) ----------
async function groupOf(t, entry) {
  if (!entry.mealPrepGroupId) return [entry];
  const rows = await t.getAllInRange('mealPlan', 'mealPrepGroupId', entry.mealPrepGroupId, entry.mealPrepGroupId);
  return rows.map((r) => normalizeMealPlanEntry(r));
}

/** Zieht Mengen ab (nie negativ). Gibt die tatsächlich abgezogenen Mengen zurück. */
async function applyConsumptions(t, consumptions) {
  const applied = [];
  for (const c of consumptions) {
    const p = await t.get('pantry', c.pantryId);
    if (!p) continue;
    const take = roundQuantity(Math.min(c.amount, Math.max(0, p.amount ?? 0)));
    if (!(take > 0)) continue;
    await t.put('pantry', { ...p, amount: roundQuantity((p.amount ?? 0) - take), updatedAt: nowIso() });
    applied.push({ ...c, amount: take });
  }
  return applied;
}

/**
 * „Gekocht“ für einen Plan-Eintrag bzw. dessen Meal-Prep-Gruppe: Vorrat EINMAL abziehen und Status setzen –
 * in einer Transaktion. Der Status wird innerhalb der Transaktion geprüft, daher auch über Tabs hinweg idempotent.
 */
export async function cookPlanEntry(id, ctx) {
  const key = `cook:${id}`;
  if (inFlight.has(key)) return { status: 'busy' };
  inFlight.add(key);
  try {
    return await runTransaction(RECOMPUTE_STORES, 'readwrite', async (t) => {
      const raw = await t.get('mealPlan', id);
      if (!raw) throw new Error('Eintrag nicht gefunden.');
      const entry = normalizeMealPlanEntry(raw);
      const group = await groupOf(t, entry);
      if (group.some((b) => b.cooked)) return { status: 'already' };
      const recipe = ctx.recipesById.get(entry.recipeId);
      if (!recipe) throw new Error('Rezept nicht mehr verfügbar.');
      const check = checkRecipe(recipe, ctx.profile, ctx.catalog);
      if (check.status === 'excluded') throw new Error(`Passt nicht zu deinem Profil: ${check.reasons[0]}`);
      const servings = group.reduce((sum, b) => sum + (b.servings || 1), 0);
      const pantry = (await t.getAll('pantry')).map((p) => normalizePantryItem(p));
      const plan = planConsumption(check.effectiveRecipe, servings, pantry, ctx.catalog);
      const applied = await applyConsumptions(t, plan.consumptions);
      const txId = uuid();
      const now = nowIso();
      for (const b of group) {
        await t.put('mealPlan', { ...b, cooked: true, cookTransactionId: txId, cookedAt: now, cookConsumptions: applied, updatedAt: now });
      }
      const recompute = await recomputeInTx(t, ctx);
      return { status: 'cooked', servings, consumptions: applied, missing: plan.missing, unchecked: plan.unchecked, spicesSkipped: plan.spicesSkipped, recompute };
    });
  } finally {
    inFlight.delete(key);
  }
}

/** „Gekocht“ rückgängig: gibt höchstens die abgezogene Menge zurück. Ein zweites Rückgängig wirkt nicht. */
export async function uncookPlanEntry(id, ctx) {
  const key = `cook:${id}`;
  if (inFlight.has(key)) return { status: 'busy' };
  inFlight.add(key);
  try {
    return await runTransaction(RECOMPUTE_STORES, 'readwrite', async (t) => {
      const raw = await t.get('mealPlan', id);
      if (!raw) throw new Error('Eintrag nicht gefunden.');
      const group = await groupOf(t, normalizeMealPlanEntry(raw));
      const cookedBox = group.find((b) => b.cooked);
      if (!cookedBox) return { status: 'notCooked' };
      const restored = [];
      const lost = [];
      for (const c of cookedBox.cookConsumptions) {
        const p = await t.get('pantry', c.pantryId);
        if (!p) { lost.push(c); continue; }
        await t.put('pantry', { ...p, amount: roundQuantity((p.amount ?? 0) + c.amount), updatedAt: nowIso() });
        restored.push(c);
      }
      const now = nowIso();
      for (const b of group) await t.put('mealPlan', { ...b, cooked: false, cookTransactionId: null, cookedAt: null, cookConsumptions: [], updatedAt: now });
      await recomputeInTx(t, ctx);
      return { status: 'uncooked', restored, lost };
    });
  } finally {
    inFlight.delete(key);
  }
}

/** „Gekocht“ ohne Plan-Eintrag (Rezeptdetail): Vorrat in einer Transaktion abziehen. */
export async function cookUnplanned(recipe, servings, ctx) {
  const key = `cook-recipe:${recipe.id}`;
  if (inFlight.has(key)) return { status: 'busy' };
  inFlight.add(key);
  try {
    return await runTransaction(['pantry'], 'readwrite', async (t) => {
      const check = checkRecipe(recipe, ctx.profile, ctx.catalog);
      if (check.status === 'excluded') throw new Error(`Passt nicht zu deinem Profil: ${check.reasons[0]}`);
      const pantry = (await t.getAll('pantry')).map((p) => normalizePantryItem(p));
      const plan = planConsumption(check.effectiveRecipe, servings, pantry, ctx.catalog);
      const applied = await applyConsumptions(t, plan.consumptions);
      return { status: 'cooked', servings, consumptions: applied, missing: plan.missing, unchecked: plan.unchecked, spicesSkipped: plan.spicesSkipped };
    });
  } finally {
    inFlight.delete(key);
  }
}

// ---------- Meal Prep (CLAUDE.md 4.3) ----------
/** Legt n Boxen (je 1 Portion) als EINEN Kochvorgang an. */
export async function addMealPrep(input, ctx) {
  const v = validateMealPrepInput(input);
  if (!v.ok) return v;
  const recipe = ctx.recipesById.get(v.values.recipeId);
  const can = canPlanRecipe(recipe, ctx.profile, ctx.catalog);
  if (!can.allowed) return { ok: false, errors: { recipeId: `Nicht einplanbar: ${can.reason}` } };
  const groupId = uuid();
  const entries = buildMealPrepEntries({ recipe, boxes: v.values.boxes, startDate: v.values.startDate, mealType: v.values.mealType, groupId })
    .map((e) => normalizeMealPlanEntry({ id: uuid(), ...e }));
  const recompute = await runTransaction(RECOMPUTE_STORES, 'readwrite', async (t) => {
    for (const e of entries) await t.put('mealPlan', e);
    return recomputeInTx(t, ctx);
  });
  return { ok: true, entries, groupId, warning: can.warning, recompute };
}

/**
 * Meal-Prep-Box löschen: scope 'one' = nur diese Box, 'all' = ganze Gruppe.
 * Vor dem Kochen sinkt der Bedarf; nach dem Kochen wird NICHTS in den Vorrat zurückgebucht.
 */
export async function deleteMealPrepBox(id, scope, ctx) {
  if (scope !== 'one' && scope !== 'all') throw new Error('Ungültige Auswahl');
  return runTransaction(RECOMPUTE_STORES, 'readwrite', async (t) => {
    const raw = await t.get('mealPlan', id);
    if (!raw) return { ok: false };
    const entry = normalizeMealPlanEntry(raw);
    const targets = scope === 'all' && entry.mealPrepGroupId ? await groupOf(t, entry) : [entry];
    for (const b of targets) await t.delete('mealPlan', b.id);
    await recomputeInTx(t, ctx);
    return { ok: true, removed: targets.length };
  });
}
