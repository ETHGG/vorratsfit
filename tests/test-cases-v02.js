// tests/test-cases-v02.js – Logiktests für Version 0.2 (Node + Browser).
// Jeder Test trägt die Nummer aus dem Testkatalog in CLAUDE.md, Abschnitt 7.
import * as models from '../core/models.js';
import { normalizeShoppingItem } from '../core/models.js';
import { canonicalStringify, todayString } from '../core/utils.js';
import { createBackupObject, parseBackupInput, sha256Hex, BACKUP_VERSION } from '../backup.js';
import { assert, eq } from './test-cases.js';
import { createCatalog } from '../core/catalog.js';
import { buildDemand, planLabel } from '../core/demand.js';
import { weekStart, weekDays, validatePlanInput, canPlanRecipe, planEntryStatus, formatDayLabel, buildMealPrepEntries, mealPrepShelfWarning, validateMealPrepInput } from '../core/plan-logic.js';
import { dayBalance, sumNutrition, recipeNutritionFor, logDateTime } from '../core/day-balance.js';
import { planConsumption } from '../core/cooking.js';
import { parseBulkLines, MAX_BULK_LINES } from '../core/quick-entry.js';
import { buildShareText } from '../core/share-text.js';
import { normalizeShoppingItem as nsi } from '../core/models.js';
import { calcTargets } from '../nutrition.js';
import { aggregateNeeds, computePlan, mergePlanIntoList, previewForRecipe } from '../core/shopping-logic.js';
import { normalizePantryItem, normalizeMealPlanEntry, normalizeSelectedRecipe } from '../core/models.js';

const ING = (id, name, amount, unit, extra = {}) => ({ ingredientId: id, name, normalizedName: name.toLowerCase(), amount, unit, category: 'Sonstiges', optional: false, substitutes: [], allergenTags: [], ...extra });
const P = (name, amount, unit, extra = {}) => normalizePantryItem({ name, amount, unit, ...extra });
const TODAY = '2026-03-02'; // Montag

export function buildTestsV02(ingredientsData = []) {
  const catalog = createCatalog(ingredientsData);
  const curry = { id: 'curry', title: 'Curry', defaultServings: 2, ingredients: [ING('zwiebel', 'Zwiebel', 1, 'Stück'), ING('reis', 'Reis', 150, 'g')], spices: [] };
  const nuts = { id: 'nuts', title: 'Erdnuss-Bowl', defaultServings: 2, ingredients: [ING('erdnussmus', 'Erdnussmus', 30, 'g'), ING('reis', 'Reis', 100, 'g')], spices: [] };
  const recipesById = new Map([[curry.id, curry], [nuts.id, nuts]]);
  const planEntry = (id, date, extra = {}) => normalizeMealPlanEntry({ id, date, mealType: 'mittagessen', recipeId: 'curry', servings: 2, ...extra });
  const demandPlan = ({ selected = [], plan = [], pantry = [], profile = null }) => {
    const { selections, skipped } = buildDemand({ selected, planEntries: plan, recipesById, profile, catalog, today: TODAY });
    return { plan: computePlan(aggregateNeeds(selections, catalog), pantry, catalog), skipped };
  };
  const T = [];
  const t = (name, fn) => T.push({ name, fn });

  // ---------- Phase 0 ----------
  t('P1-02 Logik: Backup aus 0.1 (Version 1) wird in 0.2 gelesen, neue Bereiche leer', async () => {
    const data = { pantry: [{ id: 'p1', name: 'Reis', amount: 500, unit: 'g' }], shoppingList: [{ id: 's1', name: 'Zwiebel', amountToBuy: 2, unit: 'Stück', recipeSources: [{ recipeId: 'a', title: 'A', servings: 2, amount: 2, unit: 'Stück' }] }] };
    const backup = { format: 'vorratsfit-backup', backupVersion: 1, appVersion: '0.1.0', createdAt: '2026-01-01T00:00:00.000Z', data, checksum: await sha256Hex(canonicalStringify(data)) };
    const parsed = await parseBackupInput(JSON.stringify(backup));
    eq(parsed.ok, true, parsed.errors?.join(' '));
    eq(parsed.meta.migrated, true, 'als migriert gekennzeichnet');
    eq([parsed.data.mealPlan, parsed.data.foodLog, parsed.data.quickFoods], [[], [], []]);
    eq(parsed.data.shoppingList[0].recipeSources[0].sourceType, 'single', 'alte Herkunft gilt als Einzelrezept');
  });

  t('P1-11 Logik: neues Feld sourceType/sourceId übersteht Normalisierung und Backup-Roundtrip', async () => {
    const item = normalizeShoppingItem({ id: 's1', name: 'Zwiebel', amountToBuy: 2, unit: 'Stück', recipeSources: [{ recipeId: 'r', title: 'R', servings: 2, amount: 2, unit: 'Stück', sourceType: 'plan', sourceId: 'plan-1' }] });
    eq([item.recipeSources[0].sourceType, item.recipeSources[0].sourceId], ['plan', 'plan-1']);
    const entry = models.normalizeMealPlanEntry({ id: 'm1', date: '2026-03-02', mealType: 'mittagessen', recipeId: 'r', servings: 2, mealPrepGroupId: 'g1', mealPrepIndex: 1, mealPrepCount: 4 });
    const backup = await createBackupObject({ shoppingList: [item], mealPlan: [entry] });
    eq(backup.backupVersion, BACKUP_VERSION);
    const parsed = await parseBackupInput(JSON.stringify(backup));
    eq(parsed.ok, true, parsed.errors?.join(' '));
    eq(parsed.data.shoppingList[0].recipeSources[0].sourceType, 'plan');
    eq(parsed.data.shoppingList[0].recipeSources[0].sourceId, 'plan-1');
    eq(parsed.data.mealPlan[0].mealPrepGroupId, 'g1');
  });

  t('N0-04 Backup aus neuerer Version (v3) wird abgelehnt; 0.2-Backups tragen Version 2', async () => {
    eq(BACKUP_VERSION, 2);
    const data = { pantry: [] };
    const future = { format: 'vorratsfit-backup', backupVersion: 3, data, checksum: await sha256Hex(canonicalStringify(data)) };
    const parsed = await parseBackupInput(JSON.stringify(future));
    eq(parsed.ok, false);
    assert(parsed.errors[0].includes('neueren App-Version'), parsed.errors[0]);
  });

  t('N0-05 Normalisierer der neuen Bereiche liefern sichere Standardwerte', () => {
    const evil = JSON.parse('{"__proto__":{"polluted":true},"id":"x","date":"2026-02-30","mealType":"mitternacht","servings":"abc","kcal":-50,"protein":"12,5","name":"<b>Riegel</b>"}');
    const m = models.normalizeMealPlanEntry(evil);
    eq(m.date, null, 'ungültiges Datum');
    eq(m.mealType, 'mittagessen', 'unbekannte Mahlzeit');
    eq(m.servings, 1, 'ungültige Portionen');
    eq(m.cooked, false);
    eq(Object.getPrototypeOf(m), Object.prototype);
    eq({}.polluted, undefined, 'keine Prototyp-Verschmutzung');
    const f = models.normalizeFoodLogEntry(evil);
    eq(f.kcal, null, 'negative kcal werden verworfen, nicht 0');
    eq(f.protein, 12.5);
    eq(f.date, null);
    eq(f.source, 'quick');
    const q = models.normalizeQuickFood(evil);
    eq(q.kcal, null);
    eq(q.name, '<b>Riegel</b>', 'Text bleibt Text (Ausgabe erfolgt nur über textContent)');
    eq(models.normalizeFoodLogEntry({ date: '2026-03-02', time: '25:99' }).time, null);
  });

  // ---------- Phase 1b: gemeinsame Bedarfsquelle ----------
  t('P1-04 Einzelrezept + Plan werden gemeinsam berechnet und zusammengeführt', () => {
    const { plan } = demandPlan({ selected: [normalizeSelectedRecipe({ recipeId: 'curry', servings: 2 })], plan: [planEntry('m1', '2026-03-03')], pantry: [P('Zwiebel', 1, 'Stück')] });
    const z = plan.find((p) => p.ingredientId === 'zwiebel');
    eq([z.amountNeeded, z.amountAvailable, z.amountToBuy], [2, 1, 1]);
    eq(z.recipeSources.map((s) => s.sourceType).sort(), ['plan', 'single']);
    const merged = mergePlanIntoList([], plan).items;
    eq(merged.filter((i) => i.ingredientId === 'zwiebel').length, 1, 'eine Position');
  });

  t('P1-05 Gleiches Rezept an zwei Tagen à 2 Portionen: Bedarf 4 Portionen − Vorrat, nichts überschrieben', () => {
    const { plan } = demandPlan({ plan: [planEntry('m1', '2026-03-03'), planEntry('m2', '2026-03-05')], pantry: [P('Reis', 100, 'g')] });
    const r = plan.find((p) => p.ingredientId === 'reis');
    eq([r.amountNeeded, r.amountToBuy], [300, 200]);
    eq(r.recipeSources.map((s) => s.sourceId), ['m1', 'm2']);
    eq(r.recipeSources.map((s) => s.label), ['Plan Di Mittag', 'Plan Do Mittag']);
  });

  t('N1b-01 Einzelrezept entfernen, gleiches Rezept noch im Plan: nur Einzelbedarf fällt weg', () => {
    const both = demandPlan({ selected: [normalizeSelectedRecipe({ recipeId: 'curry', servings: 2 })], plan: [planEntry('m1', '2026-03-03')] }).plan;
    const list = mergePlanIntoList([], both).items;
    const onlyPlan = demandPlan({ plan: [planEntry('m1', '2026-03-03')] }).plan;
    const merged = mergePlanIntoList(list, onlyPlan);
    const z = merged.items.find((i) => i.ingredientId === 'zwiebel');
    eq([z.amountToBuy, z.recipeSources.length, z.recipeSources[0].sourceType], [1, 1, 'plan']);
    eq(z.id, list.find((i) => i.ingredientId === 'zwiebel').id, 'Artikel-ID bleibt stabil');
  });

  t('N1b-04 Vorschau „Fehlende Zutaten prüfen“ berücksichtigt geplanten Bedarf', () => {
    // Vorrat 1 Zwiebel deckt den Plan; das zusätzliche Einzelrezept braucht 1 weitere.
    const { plan } = demandPlan({ selected: [normalizeSelectedRecipe({ recipeId: 'curry', servings: 2 })], plan: [planEntry('m1', '2026-03-03')], pantry: [P('Zwiebel', 1, 'Stück')] });
    const pv = previewForRecipe('curry', plan);
    eq(pv.needed.find((p) => p.ingredientId === 'zwiebel').amountToBuy, 1);
  });

  t('N1b-05 Ausgeschlossenes Rezept im Plan wird übersprungen und gemeldet, Rest korrekt', () => {
    const { plan, skipped } = demandPlan({ plan: [planEntry('m1', '2026-03-03'), planEntry('m2', '2026-03-04', { recipeId: 'nuts' })], profile: { allergies: ['erdnuesse'] } });
    eq(skipped.length, 1);
    eq([skipped[0].sourceType, skipped[0].sourceId], ['plan', 'm2']);
    assert(skipped[0].reason.includes('Erdnüsse'), skipped[0].reason);
    assert(!plan.some((p) => p.ingredientId === 'erdnussmus'), 'nicht eingekauft');
    eq(plan.find((p) => p.ingredientId === 'reis').amountNeeded, 150);
  });

  t('1b Plan-Einträge: vergangene, gekochte und gegessene zählen nicht; Bezeichnung „Plan Mo Mittag“', () => {
    const { plan } = demandPlan({ plan: [planEntry('alt', '2026-03-01'), planEntry('gek', '2026-03-03', { cooked: true }), planEntry('geg', '2026-03-04', { eaten: true }), planEntry('ok', '2026-03-02')] });
    eq(plan.find((p) => p.ingredientId === 'reis').recipeSources.map((s) => s.sourceId), ['ok']);
    eq(planLabel('2026-03-02', 'abendessen'), 'Plan Mo Abend');
    eq(planLabel('2026-03-08', 'fruehstueck'), 'Plan So Frühstück');
  });

  // ---------- Phase 1: Wochenplaner ----------
  t('N1-01 Logik: ausgeschlossenes Rezept kann nicht eingeplant werden, Begründung vorhanden', () => {
    const r = canPlanRecipe(nuts, { allergies: ['erdnuesse'] }, catalog);
    eq(r.allowed, false);
    assert(r.reason.includes('Erdnüsse'), r.reason);
    eq(canPlanRecipe(curry, { allergies: ['erdnuesse'] }, catalog).allowed, true);
  });

  t('N1-05 Rezept mit unvollständigen Allergendaten nur mit Warnung einplanbar', () => {
    const unknown = { id: 'u', title: 'Eigenes', defaultServings: 1, ingredients: [{ name: 'Geheimsoße XY', amount: 50, unit: 'g' }], spices: [] };
    const r = canPlanRecipe(unknown, { allergies: ['soja'] }, catalog);
    eq(r.allowed, true);
    assert(r.warning && r.warning.includes('unvollständig'), r.warning);
    eq(canPlanRecipe(unknown, {}, catalog).warning, null, 'ohne Allergien keine Warnung');
  });

  t('P2-05 Logik: nachträgliche Allergie markiert Plan-Eintrag und schließt ihn vom Einkauf aus', () => {
    const e = planEntry('m1', '2026-03-03', { recipeId: 'nuts' });
    eq(planEntryStatus(e, recipesById, {}, catalog).status, 'ok');
    const st = planEntryStatus(e, recipesById, { allergies: ['erdnuesse'] }, catalog);
    eq(st.status, 'excluded');
    assert(st.message.includes('Passt nicht mehr zu deinem Profil'), st.message);
    const { plan } = demandPlan({ plan: [e], profile: { allergies: ['erdnuesse'] } });
    eq(plan.length, 0, 'nichts eingekauft');
    eq(planEntryStatus(planEntry('x', '2026-03-03', { recipeId: 'geloescht' }), recipesById, {}, catalog).status, 'unavailable');
  });

  t('P3-01 Woche über Zeitumstellung: Mo–So korrekt, kein Tag doppelt oder fehlend', () => {
    for (const d of ['2026-03-29', '2026-03-25', '2026-10-25', '2026-10-26']) {
      const days = weekDays(weekStart(d));
      eq(days.length, 7);
      eq(new Set(days).size, 7, 'keine Doppelten');
      eq(formatDayLabel(days[0]).slice(0, 2), 'Mo');
      eq(formatDayLabel(days[6]).slice(0, 2), 'So');
      assert(days.includes(d), `${d} liegt in seiner Woche`);
    }
    eq(weekDays(weekStart('2026-03-29')), ['2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27', '2026-03-28', '2026-03-29']);
    // Lokales Datum zur Uhrzeit kurz vor/nach Mitternacht am Umstellungstag
    eq(todayString(new Date(2026, 2, 29, 0, 30)), '2026-03-29');
    eq(todayString(new Date(2026, 9, 25, 23, 59)), '2026-10-25');
  });

  t('N1-06 Woche über den Jahreswechsel; ungültige Portionen werden abgelehnt', () => {
    eq(weekDays(weekStart('2026-01-01')), ['2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']);
    eq(formatDayLabel('2025-12-31'), 'Mi, 31.12.');
    for (const bad of [0, 51, 'abc', -2, 2.5]) {
      const v = validatePlanInput({ date: '2026-03-03', mealType: 'mittagessen', recipeId: 'curry', servings: bad });
      eq(v.ok, false, `Portionen ${bad}`);
      assert(v.errors.servings, `Fehlermeldung für ${bad}`);
    }
    eq(validatePlanInput({ date: '2026-02-30', mealType: 'mittagessen', recipeId: 'curry', servings: 2 }).errors.date !== undefined, true);
    eq(validatePlanInput({ date: '2026-03-03', mealType: 'brunch', recipeId: 'curry', servings: 2 }).errors.mealType !== undefined, true);
    const ok = validatePlanInput({ date: '2026-03-03', mealType: 'abendessen', recipeId: 'curry', servings: '4' });
    eq([ok.ok, ok.values.servings], [true, 4]);
  });

  // ---------- Phase 2: Tagesbilanz, Kochen, Essen ----------
  const adult = { weightKg: 80, heightCm: 180, age: 30, sex: 'male', activityLevel: 'moderate', goal: 'maintain', mealsPerDay: 3 };
  const log = (kcal, protein = 10, portions = 1) => ({ kcal, protein, carbs: 10, fat: 5, portions });

  t('P2-01 Tagesbilanz: Ziel 2.200, gegessen 1.450 → „noch 750 kcal“', () => {
    const b = dayBalance({ targets: { kcalTarget: 2200, proteinMin: 130, proteinMax: 170 }, logs: [log(1000), log(450)], planned: [] });
    eq([b.target, b.eaten.kcal, b.remaining, b.over], [2200, 1450, 750, false]);
    eq(b.text, 'noch 750 kcal');
  });

  t('P2-02 Fehlende Nährwerte werden nicht als 0 gezählt, Tag „unvollständig“', () => {
    const s1 = sumNutrition([log(500), { kcal: null, protein: null, portions: 1 }]);
    eq([s1.kcal, s1.complete], [500, false]);
    const b = dayBalance({ targets: { kcalTarget: 2000, proteinMin: 100, proteinMax: 150 }, logs: [log(500), { kcal: null, protein: 5, portions: 1 }], planned: [] });
    eq(b.incomplete, true);
    assert(b.text.includes('unvollständig'), b.text);
    eq(sumNutrition([]).kcal, 0);
    eq(sumNutrition([log(200, 20, 2)]).protein, 40, 'Portionen werden multipliziert');
  });

  t('P2-07 Nährwerte einer laktosefreien Variante werden berechnet oder als geschätzt markiert', () => {
    const oats = { id: 'o', title: 'Oats', defaultServings: 1, ingredients: [ING('milch', 'Milch', 200, 'ml'), ING('haferflocken', 'Haferflocken', 60, 'g')], spices: [], nutritionPerServing: { kcal: 999, protein: 1 } };
    const n = recipeNutritionFor(oats, { intolerances: ['laktose'] }, catalog);
    eq(n.source, 'variant');
    eq(n.estimated, true);
    assert(n.perServing.kcal > 300 && n.perServing.kcal < 400, `berechnet, nicht 999: ${n.perServing.kcal}`);
    const plain = recipeNutritionFor(oats, {}, catalog);
    eq([plain.source, plain.perServing.kcal], ['recipe', 999]);
  });

  t('N2-05 Ziel überschritten: „200 kcal über Ziel“ statt negativer Restmenge', () => {
    const b = dayBalance({ targets: { kcalTarget: 2000, proteinMin: 100, proteinMax: 150 }, logs: [log(2200)], planned: [] });
    eq([b.remaining, b.over, b.text], [0, true, '200 kcal über Ziel']);
  });

  t('N2-06 Ohne Profil oder ohne berechenbares Ziel: Hinweis statt NaN oder 0', () => {
    for (const targets of [null, calcTargets(null), calcTargets({ weightKg: null })]) {
      const b = dayBalance({ targets, logs: [log(500)], planned: [] });
      eq([b.status, b.target, b.remaining], ['noTarget', null, null]);
      assert(b.text.includes('Profil') && !/NaN|undefined/.test(b.text), b.text);
    }
  });

  t('N2-08 Kochen: unvereinbare Einheiten und Gewürze werden nicht abgezogen, sondern markiert', () => {
    const r = { id: 'r', title: 'R', defaultServings: 1, ingredients: [ING('reis', 'Reis', 100, 'g'), ING('tomatenmark', 'Tomatenmark', 30, 'g'), ING('zwiebel', 'Zwiebel', 1, 'Stück')], spices: [ING('salz', 'Salz', 1, 'TL')] };
    const pantry = [P('Reis', 1, 'kg', { id: 'reis' }), P('Tomatenmark', 2, 'EL', { id: 'tm' }), P('Salz', 500, 'g', { id: 'salz' })];
    const c = planConsumption(r, 1, pantry, catalog);
    eq(c.consumptions, [{ pantryId: 'reis', amount: 0.1, unit: 'kg', name: 'Reis' }]);
    eq(c.unchecked.map((u) => u.name), ['Tomatenmark']);
    eq(c.missing.map((m) => [m.name, m.amount]), [['Zwiebel', 1]]);
    eq(c.spicesSkipped, ['Salz']);
  });

  t('N2-02 Logik: Kochen mit zu wenig Vorrat zieht höchstens den Bestand ab und nennt den Rest', () => {
    const r = { id: 'r', title: 'R', defaultServings: 2, ingredients: [ING('reis', 'Reis', 200, 'g')], spices: [] };
    const c = planConsumption(r, 4, [P('Reis', 150, 'g', { id: 'a' }), P('Reis', 100, 'g', { id: 'b' })], catalog);
    eq(c.consumptions.map((x) => [x.pantryId, x.amount]), [['a', 150], ['b', 100]]);
    eq(c.missing, [{ name: 'Reis', amount: 150, unit: 'g' }]);
  });

  t('P3-06 Unter 18: neutrale Formulierung ohne Abnehm- oder Defizitsprache', () => {
    const b = dayBalance({ targets: { kcalTarget: 2400, proteinMin: 70, proteinMax: 110, minor: true }, logs: [log(1500)], planned: [] });
    assert(!/noch|über Ziel|Defizit|abnehm/i.test(b.text), b.text);
    assert(b.text.includes('Orientierungswert'), b.text);
  });

  t('P3-07 Profil mit 2 Mahlzeiten, Planer mit 4 Plätzen: Bilanz nutzt das Tagesziel', () => {
    const targets = calcTargets({ ...adult, mealsPerDay: 2 });
    const planned = [{ kcal: 500, protein: 30, portions: 1 }, { kcal: 500, protein: 30, portions: 1 }, { kcal: 300, protein: 10, portions: 1 }, { kcal: 200, protein: 5, portions: 1 }];
    const b = dayBalance({ targets, logs: [], planned });
    eq(b.target, targets.kcalTarget);
    eq(b.planned.kcal, 1500);
  });

  t('N2-09 Eintrag um 23:59 bzw. 00:01 am richtigen lokalen Tag; manuelles Kalorienziel wird genutzt', () => {
    eq(logDateTime(new Date(2026, 2, 2, 23, 59)), { date: '2026-03-02', time: '23:59' });
    eq(logDateTime(new Date(2026, 2, 3, 0, 1)), { date: '2026-03-03', time: '00:01' });
    const b = dayBalance({ targets: calcTargets({ ...adult, manualCalorieTarget: 2000 }), logs: [log(1200)], planned: [] });
    eq([b.target, b.text], [2000, 'noch 800 kcal']);
  });

  // ---------- Phase 4: Wochen-Einkaufsliste ----------
  const rangeDemand = (plan, range, pantry = []) => {
    const { selections } = buildDemand({ selected: [], planEntries: plan, recipesById, profile: null, catalog, today: TODAY, range });
    return computePlan(aggregateNeeds(selections, catalog), pantry, catalog);
  };

  t('N4-01 Vorrat wird über die ganze Woche nur einmal abgezogen, nicht pro Tag', () => {
    const plan = [planEntry('mo', '2026-03-02'), planEntry('mi', '2026-03-04'), planEntry('fr', '2026-03-06')];
    const r = rangeDemand(plan, { from: '2026-03-02', to: '2026-03-08' }, [P('Reis', 200, 'g')]).find((p) => p.ingredientId === 'reis');
    eq([r.amountNeeded, r.amountAvailable, r.amountToBuy], [450, 200, 250]);
    eq(r.recipeSources.length, 3);
  });

  t('P2-10 Gegessene Mahlzeiten werden in der Wochenliste nicht mehr eingerechnet', () => {
    const plan = [planEntry('a', '2026-03-03', { eaten: true }), planEntry('b', '2026-03-04')];
    const r = rangeDemand(plan, { from: '2026-03-02', to: '2026-03-08' }).find((p) => p.ingredientId === 'reis');
    eq([r.amountNeeded, r.recipeSources.map((x) => x.sourceId)], [150, ['b']]);
  });

  t('P2-11 Herkunft wird getrennt beschriftet: „Einzelrezept“ und „Plan Mo Mittag“', () => {
    const { selections } = buildDemand({ selected: [normalizeSelectedRecipe({ recipeId: 'curry', servings: 2 })], planEntries: [planEntry('mo', '2026-03-02')], recipesById, profile: null, catalog, today: TODAY });
    const r = computePlan(aggregateNeeds(selections, catalog), [], catalog).find((p) => p.ingredientId === 'reis');
    eq(r.recipeSources.map((x) => x.label), ['Einzelrezept', 'Plan Mo Mittag']);
  });

  t('N4-04 Frei gewählter Zeitraum über eine Monatsgrenze', () => {
    const plan = ['2026-03-27', '2026-03-30', '2026-04-02', '2026-04-04'].map((d) => planEntry(d, d));
    const r = rangeDemand(plan, { from: '2026-03-28', to: '2026-04-03' }).find((p) => p.ingredientId === 'reis');
    eq(r.recipeSources.map((x) => x.sourceId), ['2026-03-30', '2026-04-02']);
    eq(rangeDemand(plan, { from: '2026-05-01', to: '2026-05-07' }).length, 0, 'leerer Zeitraum');
  });

  // ---------- Phase 3: Meal Prep ----------
  const boxes = (start, n, recipeId = 'curry') => buildMealPrepEntries({ recipe: recipesById.get(recipeId), boxes: n, startDate: start, mealType: 'mittagessen', groupId: 'g1' }).map((e) => normalizeMealPlanEntry(e));

  t('N3-01 Gruppe Start Freitag, 4 Boxen: gesamter Bedarf in der Woche des Kochtags', () => {
    const g = boxes('2026-03-06', 4);
    eq(g.map((b) => b.date), ['2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09']);
    const thisWeek = rangeDemand(g, { from: '2026-03-02', to: '2026-03-08' }).find((p) => p.ingredientId === 'reis');
    eq([thisWeek.amountNeeded, thisWeek.recipeSources.length, thisWeek.recipeSources[0].sourceType], [300, 1, 'mealprep'], '4 Portionen = 2 × Rezept');
    eq(rangeDemand(g, { from: '2026-03-09', to: '2026-03-15' }).length, 0, 'Folgewoche ohne Bedarf');
  });

  t('N3-02 Einzelne Box verschieben erzeugt keinen zweiten Kochbedarf', () => {
    const g = boxes('2026-03-03', 4);
    g[2] = { ...g[2], date: '2026-03-12' };
    const plan = rangeDemand(g, null);
    const reis = plan.find((p) => p.ingredientId === 'reis');
    eq([reis.amountNeeded, reis.recipeSources.length], [300, 1]);
  });

  t('N3-05 Rezept für 2 Personen, 4 Boxen: alle Mengen verdoppelt', () => {
    const z = rangeDemand(boxes('2026-03-03', 4), null).find((p) => p.ingredientId === 'zwiebel');
    eq(z.amountNeeded, 2);
    eq(boxes('2026-03-03', 4).every((b) => b.servings === 1 && b.mealPrepCount === 4), true);
  });

  t('P2-09 Box mehr als 3 Tage nach dem Kochtag: Warnung zur Haltbarkeit', () => {
    const g = boxes('2026-03-02', 6);
    assert(mealPrepShelfWarning(g[5], g)?.includes('5 Tage'), mealPrepShelfWarning(g[5], g));
    eq(mealPrepShelfWarning(g[1], g), null);
  });

  t('N3-06 Haltbarkeit: genau 3 Tage keine Warnung, 4 Tage Warnung', () => {
    const g = boxes('2026-03-02', 5);
    eq(mealPrepShelfWarning(g[3], g), null, '3 Tage');
    assert(mealPrepShelfWarning(g[4], g), '4 Tage');
    const v = validateMealPrepInput({ boxes: 1, startDate: '2026-03-02', mealType: 'mittagessen', recipeId: 'curry' });
    eq(v.ok, false, 'mindestens 2 Boxen');
    eq(validateMealPrepInput({ boxes: '15', startDate: '2026-03-02', mealType: 'mittagessen', recipeId: 'curry' }).ok, false, 'höchstens 14');
  });

  // ---------- Phase 5: Schnellerfassen ----------
  t('P3-02 Schnellerfassen: 5 Zeilen ergeben 5 Einträge', () => {
    const r = parseBulkLines('500 g Hähnchen\n1 kg Reis\n6 Eier\n2 Paprika\n1 l Milch', catalog);
    eq(r.items.length, 5);
    eq(r.items.map((i) => [i.ingredientId, i.amount, i.unit]), [['haehnchenbrust', 500, 'g'], ['reis', 1, 'kg'], ['eier', 6, 'Stück'], ['paprika', 2, 'Stück'], ['milch', 1, 'l']]);
    eq(r.items.every((i) => i.status === 'ok'), true);
  });

  t('P3-03 Schnellerfassen: umgedrehte Zeile „Hähnchen 500 g“ → „Menge bitte prüfen“, nicht geraten', () => {
    const r = parseBulkLines('Hähnchen 500 g', catalog);
    eq(r.items.length, 1);
    eq([r.items[0].status, r.items[0].amount], ['check', null]);
    assert(r.items[0].reason.includes('Menge bitte prüfen'), r.items[0].reason);
  });

  t('N5-04 Schnellerfassen: Leerzeilen, „1,5 kg“, doppelte Zeilen und Zeilenlimit', () => {
    const r = parseBulkLines('\n  \n1,5 kg Reis\n1,5 kg Reis\n\n3 Handvoll Spinat\n', catalog);
    eq(r.items.map((i) => [i.amount, i.unit, i.status]), [[1.5, 'kg', 'ok'], [1.5, 'kg', 'ok'], [3, null, 'check']]);
    eq(r.duplicates, ['1,5 kg Reis']);
    const many = Array.from({ length: MAX_BULK_LINES + 5 }, (_, i) => `${i + 1} g Reis`).join('\n');
    const m = parseBulkLines(many, catalog);
    eq([m.items.length, m.truncated], [MAX_BULK_LINES, 5]);
    eq(parseBulkLines('0 g Reis', catalog).items[0].status, 'check', 'Menge 0 nicht übernehmen');
  });

  // ---------- Phase 6: Teilen ----------
  const items = [
    nsi({ id: 'a', name: 'Paprika', amountToBuy: 3, unit: 'Stück', category: 'Gemüse', recipeSources: [{ recipeId: 'r', title: 'Rezept', servings: 2, amount: 3, unit: 'Stück' }] }),
    nsi({ id: 'b', name: 'Hähnchenbrustfilet', amountToBuy: 500, amountPurchased: 600, unit: 'g', category: 'Fleisch und Fisch', recipeSources: [{ recipeId: 'r', title: 'Rezept', servings: 2, amount: 500, unit: 'g' }] }),
    nsi({ id: 'c', name: 'Zwiebel', amountToBuy: 2, unit: 'Stück', category: 'Gemüse', recipeSources: [{ recipeId: 'r', title: 'Rezept', servings: 2, amount: 2, unit: 'Stück' }] }),
    nsi({ id: 'd', name: 'Milch', amountToBuy: 1, unit: 'l', category: 'Milchprodukte', checked: true, addedToPantry: true }),
    nsi({ id: 'e', name: 'Gewürzmischung „Ras el-Hanout“ 🌶️', amountToBuy: null, unit: 'Stück', quantityCheck: true, category: 'Gewürze', recipeSources: [{ recipeId: 'r', title: 'Rezept', servings: 2, amount: null, unit: 'Stück' }] }),
    nsi({ id: 'f', name: 'Spülmittel', amountToBuy: 1, unit: 'Stück', category: 'Sonstiges', manuallyAdded: true }),
  ];

  t('P3-04 Geteilter Text: nach Gruppen sortiert, nur offene Artikel, keine Profil- oder Gesundheitsdaten', () => {
    const text = buildShareText(items, { profile: { nickname: 'Erik', weightKg: 95, allergies: ['erdnuesse'] } });
    eq(text.split('\n'), ['🛒 Einkaufsliste', '', '— Obst und Gemüse —', '• 3 Stück Paprika', '• 2 Stück Zwiebel', '', '— Fleisch und Fisch —', '• 500 g Hähnchenbrustfilet', '', '— Gewürze —', '• Gewürzmischung „Ras el-Hanout“ 🌶️ (Menge bitte prüfen)', '', '— Sonstiges —', '• 1 Stück Spülmittel', '', 'Erstellt mit VorratsFit']);
    assert(!/Milch|Erik|95|kcal|Erdnü|Rezept/.test(text), 'keine erledigten Artikel, keine persönlichen Daten');
  });

  t('N6-04 Umlaute, Emoji, „Menge bitte prüfen“ und manuelle Artikel erscheinen korrekt', () => {
    const text = buildShareText(items);
    assert(text.includes('Hähnchenbrustfilet') && text.includes('🌶️') && text.includes('(Menge bitte prüfen)') && text.includes('Spülmittel'), text);
    eq(buildShareText([items[3]]), '', 'nur erledigte Artikel → leer');
    eq(buildShareText([]), '');
  });

  // ---------- Phase 7: Release ----------
  t('N7-02 Logik: <script> in Plan-Namen und Schnell-Lebensmitteln bleibt reiner Text', () => {
    const evil = '<img src=x onerror=alert(1)><script>alert(1)</script>';
    const q = models.normalizeQuickFood({ name: evil, kcal: 100 });
    const m = models.normalizeMealPlanEntry({ recipeTitle: evil, date: '2026-03-02', recipeId: 'x' });
    eq(typeof q.name, 'string'); eq(typeof m.recipeTitle, 'string');
    assert(q.name.length <= 80 && m.recipeTitle.length <= 120, 'gekürzt');
    const text = buildShareText([nsi({ name: evil, amountToBuy: 1, unit: 'Stück', category: 'Sonstiges', manuallyAdded: true })]);
    assert(text.includes('<script>'), 'Text bleibt Text; Ausgabe erfolgt nur über textContent (statische Prüfung)');
  });

  t('Release: App-Version 0.2.0', () => {
    eq(models.APP_VERSION, '0.2.0');
  });

  return T;
}
