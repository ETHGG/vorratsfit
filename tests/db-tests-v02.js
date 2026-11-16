// tests/db-tests-v02.js – IndexedDB-Tests für Version 0.2 (nur Browser, eigene Test-Datenbank).
import {
  configureDatabase, closeDatabase, openDatabase, putItem, getItem, getAllItems, importAllData,
  BACKUP_STORES, DB_VERSION, onBlocked, deleteItem, runTransaction,
} from '../db.js';
import { normalizePantryItem, normalizeShoppingItem, normalizeMealPlanEntry, normalizeFoodLogEntry, normalizeQuickFood } from '../core/models.js';
import { createBackupObject, encodeBackupCode, parseBackupInput, LONG_CODE_THRESHOLD } from '../backup.js';
import { wipeAllPersonalData } from '../settings.js';
import { assert, eq } from './test-cases.js';
import { createCatalog } from '../core/catalog.js';
import { addDays, todayString } from '../core/utils.js';
import {
  setPurchasedAmount, recomputeShoppingList, getShoppingState, addManualItem, checkShoppingItem, addRecipeToShopping,
  previewShoppingRange, applyShoppingRange, clearShoppingRange, getShoppingRange, checkAllOpen, previewCheckAll,
} from '../shopping.js';
import { addPlanEntry, updatePlanEntry, deletePlanEntry, listPlan, clearPlanRange, cookPlanEntry, uncookPlanEntry, addMealPrep, deleteMealPrepBox } from '../planner.js';
import { markPlanEaten, logQuickFood, listFoodLog, deleteFoodLog, saveQuickFood } from '../foodlog.js';
import { addBulkToPantry, addFrequentItem, frequentItems } from '../pantry.js';
import { parseBulkLines } from '../core/quick-entry.js';
import { planEntryStatus } from '../core/plan-logic.js';
import { TEST_DB, resetTestDb } from './db-tests.js';

const V1_STORES = ['profile', 'pantry', 'favorites', 'customRecipes', 'cachedRecipes', 'shoppingList', 'selectedRecipes', 'settings', 'metadata'];

function deleteDb(name) {
  return new Promise((resolve) => { const r = indexedDB.deleteDatabase(name); r.onsuccess = r.onerror = r.onblocked = () => resolve(); });
}

/** Legt eine Datenbank exakt im Schema von 0.1 (Version 1) an und füllt sie. */
export function createV1Database(name, records) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of V1_STORES) {
        const store = db.createObjectStore(s, { keyPath: 'id' });
        if (s === 'pantry') { store.createIndex('normalizedName', 'normalizedName'); store.createIndex('category', 'category'); }
        if (s === 'shoppingList') store.createIndex('normalizedName', 'normalizedName');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(Object.keys(records), 'readwrite');
      for (const [s, list] of Object.entries(records)) for (const r of list) tx.objectStore(s).put(r);
      tx.oncomplete = () => resolve(db);
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function freshName() {
  await closeDatabase();
  await deleteDb(TEST_DB);
  configureDatabase(TEST_DB);
}

export function buildDbTestsV02(ingredientsData = [], recipesData = { recipes: [] }) {
  const catalog = createCatalog(ingredientsData);
  const recipesById = new Map(recipesData.recipes.map((r) => [r.id, { ...r, origin: 'local' }]));
  const ctx = { recipesById, profile: null, catalog };
  const day = (n) => addDays(todayString(), n);
  const plan = (id, n, recipeId = 'chili-sin-carne', extra = {}) => normalizeMealPlanEntry({ id, date: day(n), mealType: 'abendessen', recipeId, servings: 4, ...extra });
  const T = [];
  const t = (name, fn) => T.push({ name, fn });

  t('P1-01 DB: Datenbank aus 0.1 (Version 1) öffnet vollständig, neue Bereiche leer', async () => {
    await freshName();
    const v1 = await createV1Database(TEST_DB, {
      profile: [{ id: 'main', nickname: 'Erik', age: 30 }],
      pantry: [normalizePantryItem({ id: 'p1', name: 'Reis', amount: 500, unit: 'g' })],
      shoppingList: [{ id: 's1', name: 'Zwiebel', amountToBuy: 2, unit: 'Stück', recipeSources: [{ recipeId: 'a', title: 'A', servings: 2, amount: 2, unit: 'Stück' }] }],
      favorites: [{ id: 'chili-sin-carne', recipeId: 'chili-sin-carne', title: 'Chili' }],
      customRecipes: [{ id: 'custom-1', title: 'Mein Rezept', ingredients: [] }],
    });
    v1.close();
    const db = await openDatabase();
    eq(db.version, DB_VERSION);
    for (const s of ['mealPlan', 'foodLog', 'quickFoods']) assert(db.objectStoreNames.contains(s), `${s} fehlt`);
    eq((await getItem('profile', 'main')).nickname, 'Erik');
    eq((await getItem('pantry', 'p1')).amount, 500);
    eq((await getItem('favorites', 'chili-sin-carne')).title, 'Chili');
    eq((await getItem('customRecipes', 'custom-1')).title, 'Mein Rezept');
    const s1 = await getItem('shoppingList', 's1');
    eq([s1.name, s1.recipeSources[0].sourceType], ['Zwiebel', 'single'], 'Altdaten ergänzt, nicht verändert');
    eq([(await getAllItems('mealPlan')).length, (await getAllItems('foodLog')).length, (await getAllItems('quickFoods')).length], [0, 0, 0]);
  });

  t('N0-01 DB: Neuinstallation legt alle Bereiche mit Datums-Index an', async () => {
    await freshName();
    const db = await openDatabase();
    eq(db.version, DB_VERSION);
    for (const s of [...V1_STORES, 'mealPlan', 'foodLog', 'quickFoods']) assert(db.objectStoreNames.contains(s), `${s} fehlt`);
    const tx = db.transaction(['mealPlan', 'foodLog'], 'readonly');
    assert(tx.objectStore('mealPlan').indexNames.contains('date'), 'Index mealPlan.date');
    assert(tx.objectStore('foodLog').indexNames.contains('date'), 'Index foodLog.date');
  });

  t('P1-02 DB: Backup aus 0.1 wird importiert', async () => {
    await resetTestDb();
    const legacy = await createBackupObject({ pantry: [normalizePantryItem({ id: 'p1', name: 'Reis', amount: 500, unit: 'g' })] });
    legacy.backupVersion = 1;
    const parsed = await parseBackupInput(JSON.stringify(legacy));
    eq(parsed.ok, true, parsed.errors?.join(' '));
    await importAllData(parsed.data, 'replace');
    eq((await getItem('pantry', 'p1')).amount, 500);
    eq((await getAllItems('mealPlan')).length, 0);
  });

  t('P1-11 DB: neue Felder überstehen Speichern, Backup-Export und Backup-Import', async () => {
    await resetTestDb();
    await putItem('shoppingList', normalizeShoppingItem({ id: 's1', name: 'Zwiebel', amountToBuy: 2, unit: 'Stück', recipeSources: [{ recipeId: 'r', title: 'R', servings: 2, amount: 2, unit: 'Stück', sourceType: 'mealprep', sourceId: 'g1' }] }));
    await putItem('mealPlan', normalizeMealPlanEntry({ id: 'm1', date: '2026-03-02', mealType: 'abendessen', recipeId: 'r', servings: 1, mealPrepGroupId: 'g1', mealPrepIndex: 2, mealPrepCount: 4 }));
    await putItem('foodLog', normalizeFoodLogEntry({ id: 'f1', date: '2026-03-02', time: '12:30', source: 'quick', name: 'Banane', kcal: 105 }));
    await putItem('quickFoods', normalizeQuickFood({ id: 'q1', name: 'Proteinriegel', kcal: 200, protein: 20 }));
    const data = {};
    for (const s of BACKUP_STORES) data[s] = await getAllItems(s);
    const code = encodeBackupCode(await createBackupObject(data));
    await resetTestDb();
    const parsed = await parseBackupInput(code);
    eq(parsed.ok, true);
    await importAllData(parsed.data, 'replace');
    const s1 = await getItem('shoppingList', 's1');
    eq([s1.recipeSources[0].sourceType, s1.recipeSources[0].sourceId], ['mealprep', 'g1']);
    const m1 = await getItem('mealPlan', 'm1');
    eq([m1.mealPrepGroupId, m1.mealPrepIndex, m1.mealPrepCount], ['g1', 2, 4]);
    eq((await getItem('foodLog', 'f1')).kcal, 105);
    eq((await getItem('quickFoods', 'q1')).protein, 20);
  });

  t('N0-02 DB: „Alle Daten löschen“ leert auch Wochenplan, Tagebuch und Schnell-Lebensmittel', async () => {
    await resetTestDb();
    await putItem('pantry', normalizePantryItem({ id: 'p1', name: 'Reis', amount: 500, unit: 'g' }));
    await putItem('mealPlan', normalizeMealPlanEntry({ id: 'm1', date: '2026-03-02', recipeId: 'r' }));
    await putItem('foodLog', normalizeFoodLogEntry({ id: 'f1', date: '2026-03-02', name: 'Banane', kcal: 105 }));
    await putItem('quickFoods', normalizeQuickFood({ id: 'q1', name: 'Riegel', kcal: 200 }));
    await putItem('metadata', { id: 'pantryFrequency', value: [{ key: 'id:reis', name: 'Reis', count: 3 }] });
    await putItem('metadata', { id: 'shoppingRange', value: { from: '2026-03-02', to: '2026-03-08' } });
    await putItem('metadata', { id: 'privacyAcknowledged', value: '2026-03-01' });
    await wipeAllPersonalData();
    for (const s of ['pantry', 'mealPlan', 'foodLog', 'quickFoods']) eq((await getAllItems(s)).length, 0, s);
    eq([await getItem('metadata', 'pantryFrequency'), await getItem('metadata', 'shoppingRange')], [undefined, undefined], 'Häufigkeiten und Zeitraum gelöscht');
    assert(await getItem('metadata', 'privacyAcknowledged'), 'Datenschutz-Bestätigung bleibt (kein persönlicher Inhalt)');
  });

  t('N0-03 DB: Import „Ersetzen“ und „Zusammenführen“ mit neuen Bereichen', async () => {
    await resetTestDb();
    await putItem('mealPlan', normalizeMealPlanEntry({ id: 'm1', date: '2026-03-02', recipeId: 'alt', updatedAt: '2026-03-05T00:00:00.000Z' }));
    await putItem('mealPlan', normalizeMealPlanEntry({ id: 'local', date: '2026-03-03', recipeId: 'lokal' }));
    const incoming = {
      mealPlan: [
        normalizeMealPlanEntry({ id: 'm1', date: '2026-03-02', recipeId: 'aelter', updatedAt: '2026-03-01T00:00:00.000Z' }),
        normalizeMealPlanEntry({ id: 'neu', date: '2026-03-04', recipeId: 'neu' }),
      ],
    };
    await importAllData(incoming, 'merge');
    eq((await getItem('mealPlan', 'm1')).recipeId, 'alt', 'Zusammenführen: neuerer lokaler Stand bleibt');
    eq((await getAllItems('mealPlan')).length, 3);
    await importAllData(incoming, 'replace');
    eq((await getAllItems('mealPlan')).map((m) => m.id).sort(), ['m1', 'neu'], 'Ersetzen');
  });

  t('N0-06 DB: offene alte Verbindung blockiert das Upgrade – App wartet, löscht nichts, migriert danach', async () => {
    await freshName();
    const v1 = await createV1Database(TEST_DB, { pantry: [normalizePantryItem({ id: 'p1', name: 'Reis', amount: 500, unit: 'g' })] });
    let blocked = 0;
    const off = onBlocked(() => { blocked += 1; });
    const opening = openDatabase();
    await new Promise((r) => setTimeout(r, 300));
    eq(blocked, 1, 'Hinweis „blockiert“ ausgelöst');
    v1.close();
    const db = await opening;
    off();
    eq(db.version, DB_VERSION);
    eq((await getItem('pantry', 'p1')).amount, 500, 'keine Daten verloren');
  });

  t('P2-12 DB: Datenbank einer neueren Version → verständliche Meldung statt VersionError', async () => {
    await freshName();
    const future = await new Promise((res, rej) => { const r = indexedDB.open(TEST_DB, DB_VERSION + 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    future.close();
    let message = '';
    try { await openDatabase(); } catch (err) { message = err.message; }
    assert(message.includes('neueren Version') && !message.includes('VersionError'), message);
    await freshName();
  });

  t('P1-03 DB: Woche planen, Einkaufsliste neu berechnen – Plan-Artikel bleiben', async () => {
    await resetTestDb();
    await putItem('mealPlan', plan('m1', 1));
    await recomputeShoppingList(ctx);
    const st1 = await getShoppingState();
    assert(st1.items.some((i) => i.ingredientId === 'kidneybohnen'), 'Plan-Artikel angelegt');
    await recomputeShoppingList(ctx);
    await recomputeShoppingList(ctx);
    const st2 = await getShoppingState();
    eq(st2.items.filter((i) => i.ingredientId === 'kidneybohnen').length, 1, 'bleibt genau einmal');
    eq(st2.items.find((i) => i.ingredientId === 'kidneybohnen').recipeSources[0].sourceType, 'plan');
  });

  t('N1b-02 DB: manuelle, abgehakte und übernommene Artikel bleiben bei Planänderung unverändert', async () => {
    await resetTestDb();
    await putItem('mealPlan', plan('m1', 1));
    await recomputeShoppingList(ctx);
    const manual = (await addManualItem({ name: 'Spülmittel', amount: 1, unit: 'Stück', category: 'Sonstiges' }, catalog)).item;
    const bohnen = (await getShoppingState()).items.find((i) => i.ingredientId === 'kidneybohnen');
    await checkShoppingItem(bohnen.id, catalog);
    const before = await getItem('shoppingList', bohnen.id);
    await deleteItem('mealPlan', 'm1');
    await recomputeShoppingList(ctx);
    eq(await getItem('shoppingList', bohnen.id), before, 'abgehakter Artikel unverändert');
    eq((await getItem('shoppingList', manual.id)).name, 'Spülmittel', 'manueller Artikel bleibt');
    assert(!(await getShoppingState()).items.some((i) => i.ingredientId === 'mais' && !i.checked), 'offene Plan-Artikel entfernt');
  });

  t('N1b-03 DB: Plan-Eintrag löschen bzw. Portionen ändern – offene Artikel angepasst, ID stabil', async () => {
    await resetTestDb();
    await putItem('mealPlan', plan('m1', 1));
    await putItem('mealPlan', plan('m2', 2, 'linsen-dal'));
    await recomputeShoppingList(ctx);
    const z1 = (await getShoppingState()).items.find((i) => i.ingredientId === 'zwiebel');
    eq(z1.amountToBuy, 3, 'Chili 2 + Dal 1 Zwiebel');
    await putItem('mealPlan', { ...plan('m1', 1), servings: 8 });
    await recomputeShoppingList(ctx);
    const z2 = (await getShoppingState()).items.find((i) => i.ingredientId === 'zwiebel');
    eq([z2.amountToBuy, z2.id], [5, z1.id], 'Portionen 4 → 8: 4 + 1, gleiche ID');
    await deleteItem('mealPlan', 'm2');
    await recomputeShoppingList(ctx);
    const st = await getShoppingState();
    assert(!st.items.some((i) => i.ingredientId === 'linsen_rot'), 'Linsen entfernt');
    eq(st.items.find((i) => i.ingredientId === 'zwiebel').amountToBuy, 4);
  });

  t('1b DB: Einzelrezept hinzufügen bei bestehendem Plan führt Quellen zusammen', async () => {
    await resetTestDb();
    await putItem('mealPlan', plan('m1', 1));
    await addRecipeToShopping(recipesById.get('chili-sin-carne'), 4, ctx);
    const z = (await getShoppingState()).items.find((i) => i.ingredientId === 'zwiebel');
    eq([z.amountToBuy, z.recipeSources.map((s) => s.sourceType).sort().join()], [4, 'plan,single']);
  });

  t('N1-03 DB: Eintrag verschieben ändert den Bedarf nicht, Portionen ändern aktualisieren die Liste', async () => {
    await resetTestDb();
    const res = await addPlanEntry({ date: day(1), mealType: 'abendessen', recipeId: 'chili-sin-carne', servings: 4 }, ctx);
    eq(res.ok, true);
    const z1 = (await getShoppingState()).items.find((i) => i.ingredientId === 'zwiebel');
    eq(z1.amountToBuy, 2, 'Plan sofort in der Einkaufsliste');
    await updatePlanEntry(res.entry.id, { date: day(3), mealType: 'mittagessen' }, ctx);
    const z2 = (await getShoppingState()).items.find((i) => i.ingredientId === 'zwiebel');
    eq([z2.amountToBuy, z2.id], [2, z1.id], 'Verschieben ändert Bedarf nicht');
    assert(z2.recipeSources[0].label.endsWith('Mittag'), z2.recipeSources[0].label);
    await updatePlanEntry(res.entry.id, { servings: 8 }, ctx);
    eq((await getShoppingState()).items.find((i) => i.ingredientId === 'zwiebel').amountToBuy, 4);
    const bad = await updatePlanEntry(res.entry.id, { servings: 0 }, ctx);
    eq(bad.ok, false, 'ungültige Portionen abgelehnt');
    eq((await listPlan(day(0), day(6)))[0].servings, 8);
  });

  t('N1-01 DB: ausgeschlossenes Rezept wird nicht gespeichert', async () => {
    await resetTestDb();
    const res = await addPlanEntry({ date: day(1), mealType: 'mittagessen', recipeId: 'erdnuss-haehnchen-bowl', servings: 2 }, { ...ctx, profile: { allergies: ['erdnuesse'] } });
    eq(res.ok, false);
    assert(res.errors.recipeId.includes('Erdnüsse'), res.errors.recipeId);
    eq((await getAllItems('mealPlan')).length, 0);
  });

  t('P2-06 DB: eigenes Rezept im Plan löschen – „nicht mehr verfügbar“, kein Absturz', async () => {
    await resetTestDb();
    const custom = { id: 'custom-x', title: 'Mein Reis', defaultServings: 2, ingredients: [{ ingredientId: 'reis', name: 'Reis', amount: 200, unit: 'g' }], spices: [], origin: 'custom' };
    const map = new Map(recipesById);
    map.set(custom.id, custom);
    const res = await addPlanEntry({ date: day(1), mealType: 'mittagessen', recipeId: 'custom-x', servings: 2 }, { ...ctx, recipesById: map });
    eq(res.ok, true);
    const rc = await recomputeShoppingList({ ...ctx, recipesById });
    eq(rc.skipped.length, 1);
    eq(rc.skipped[0].reason, 'Rezept nicht mehr verfügbar');
    const entry = (await listPlan(day(0), day(6)))[0];
    eq(planEntryStatus(entry, recipesById, null, catalog).status, 'unavailable');
    eq(entry.recipeTitle, 'Mein Reis', 'Titel bleibt als Kopie erhalten');
  });

  t('N1-04 DB: Woche leeren – Vorrat, abgehakte Artikel und Tagebuch bleiben unverändert', async () => {
    await resetTestDb();
    await putItem('pantry', normalizePantryItem({ id: 'p1', name: 'Reis', amount: 500, unit: 'g' }));
    await putItem('foodLog', normalizeFoodLogEntry({ id: 'f1', date: day(1), name: 'Banane', kcal: 105 }));
    await addPlanEntry({ date: day(1), mealType: 'abendessen', recipeId: 'chili-sin-carne', servings: 4 }, ctx);
    await addPlanEntry({ date: day(2), mealType: 'mittagessen', recipeId: 'linsen-dal', servings: 4 }, ctx);
    const bohnen = (await getShoppingState()).items.find((i) => i.ingredientId === 'kidneybohnen');
    await checkShoppingItem(bohnen.id, catalog);
    const pantryBefore = await getAllItems('pantry');
    const removed = await clearPlanRange(day(0), day(6), ctx);
    eq(removed, 2);
    eq((await listPlan(day(0), day(6))).length, 0);
    eq(await getAllItems('pantry'), pantryBefore, 'Vorrat unverändert');
    eq((await getItem('shoppingList', bohnen.id)).checked, true, 'abgehakter Artikel bleibt');
    eq((await getAllItems('foodLog')).length, 1, 'Tagebuch unverändert');
    assert(!(await getShoppingState()).items.some((i) => !i.checked && i.recipeSources.some((s) => s.sourceType === 'plan')), 'offene Plan-Artikel entfernt');
  });

  t('Phase 1 DB: deletePlanEntry entfernt Bedarf, listPlan nutzt den Datumsbereich', async () => {
    await resetTestDb();
    const a = await addPlanEntry({ date: day(1), mealType: 'abendessen', recipeId: 'chili-sin-carne', servings: 4 }, ctx);
    await addPlanEntry({ date: day(10), mealType: 'abendessen', recipeId: 'linsen-dal', servings: 4 }, ctx);
    eq((await listPlan(day(0), day(6))).map((e) => e.recipeId), ['chili-sin-carne']);
    await deletePlanEntry(a.entry.id, ctx);
    assert(!(await getShoppingState()).items.some((i) => i.ingredientId === 'kidneybohnen'), 'Bohnen entfernt');
  });

  const stock = async () => {
    await putItem('pantry', normalizePantryItem({ id: 'reis', name: 'Reis (trocken)', ingredientId: 'reis', amount: 500, unit: 'g' }));
    await putItem('pantry', normalizePantryItem({ id: 'zw', name: 'Zwiebel', ingredientId: 'zwiebel', amount: 5, unit: 'Stück' }));
  };
  const planChili = async (n = 0, servings = 4) => (await addPlanEntry({ date: day(n), mealType: 'abendessen', recipeId: 'chili-sin-carne', servings }, ctx)).entry;

  t('P1-07 DB: geplantes Rezept gekocht – Eintrag gekocht, Zutaten kommen nicht erneut auf die Liste', async () => {
    await resetTestDb(); await stock();
    const e = await planChili(1);
    assert((await getShoppingState()).items.some((i) => i.ingredientId === 'kidneybohnen'), 'vorher auf der Liste');
    const res = await cookPlanEntry(e.id, ctx);
    eq(res.status, 'cooked');
    eq((await getItem('pantry', 'reis')).amount, 300, '200 g Reis abgezogen');
    eq((await getItem('pantry', 'zw')).amount, 3);
    const after = await getItem('mealPlan', e.id);
    eq([after.cooked, !!after.cookTransactionId], [true, true]);
    await recomputeShoppingList(ctx);
    assert(!(await getShoppingState()).items.some((i) => i.ingredientId === 'kidneybohnen' && !i.checked), 'nicht erneut eingekauft');
  });

  t('P1-08 DB: Doppelklick auf „Gekocht“ zieht nur einmal ab', async () => {
    await resetTestDb(); await stock();
    const e = await planChili(1);
    const results = await Promise.all([cookPlanEntry(e.id, ctx), cookPlanEntry(e.id, ctx), cookPlanEntry(e.id, ctx)]);
    eq(results.filter((r) => r.status === 'cooked').length, 1, JSON.stringify(results.map((r) => r.status)));
    eq((await cookPlanEntry(e.id, ctx)).status, 'already');
    eq((await getItem('pantry', 'reis')).amount, 300);
  });

  t('P1-09 DB: Doppelklick auf „Gegessen“ ergibt genau einen Tagebucheintrag', async () => {
    await resetTestDb();
    const e = await planChili(0);
    const results = await Promise.all([markPlanEaten(e.id, ctx), markPlanEaten(e.id, ctx)]);
    eq(results.filter((r) => r.status === 'logged').length, 1);
    eq((await listFoodLog(day(0))).length, 1);
    eq((await markPlanEaten(e.id, ctx)).status, 'already');
  });

  t('P1-10 DB: „Gegessen“ verändert den Vorrat nicht', async () => {
    await resetTestDb(); await stock();
    const e = await planChili(0);
    const before = await getAllItems('pantry');
    const res = await markPlanEaten(e.id, ctx);
    eq(res.status, 'logged');
    eq(await getAllItems('pantry'), before);
    const entry = (await listFoodLog(day(0)))[0];
    eq([entry.source, entry.refId, entry.portions], ['plan', e.id, 1]);
    assert(entry.kcal > 0, 'Nährwerte als Kopie gespeichert');
  });

  t('P1-12 DB: Fehler mitten in „Gekocht“ rollt alles zurück', async () => {
    await resetTestDb(); await stock();
    const e = await planChili(1);
    // Zweiter, ungekochter Eintrag: Die Neuberechnung NACH dem Vorratsabzug liest das Profil erneut – dort schlägt es fehl.
    await addPlanEntry({ date: day(2), mealType: 'mittagessen', recipeId: 'linsen-dal', servings: 2 }, ctx);
    let calls = 0;
    const flaky = { get allergies() { calls += 1; if (calls > 1) throw new Error('Absichtlicher Fehler nach dem Vorratsabzug'); return []; } };
    let failed = false;
    try { await cookPlanEntry(e.id, { ...ctx, profile: flaky }); } catch { failed = true; }
    eq(failed, true, 'Fehler wird gemeldet');
    eq((await getItem('pantry', 'reis')).amount, 500, 'Vorrat unverändert');
    eq((await getItem('mealPlan', e.id)).cooked, false, 'nicht als gekocht markiert');
  });

  t('N2-02 DB: „Gekocht“ mit zu wenig Vorrat – nie negativ, fehlende Zutaten genannt', async () => {
    await resetTestDb();
    await putItem('pantry', normalizePantryItem({ id: 'reis', name: 'Reis (trocken)', ingredientId: 'reis', amount: 50, unit: 'g' }));
    const e = await planChili(1);
    const res = await cookPlanEntry(e.id, ctx);
    eq((await getItem('pantry', 'reis')).amount, 0);
    assert(res.missing.some((m) => m.name.startsWith('Reis') && m.amount === 150), JSON.stringify(res.missing));
    assert(res.missing.some((m) => m.name.startsWith('Kidneybohnen')), 'fehlende Bohnen genannt');
  });

  t('N2-03 DB: Status „gekocht“ bleibt nach Neuladen erhalten, Einkaufsliste korrekt', async () => {
    await resetTestDb(); await stock();
    const e = await planChili(1);
    await cookPlanEntry(e.id, ctx);
    await closeDatabase(); configureDatabase(TEST_DB);
    eq((await getItem('mealPlan', e.id)).cooked, true);
    await recomputeShoppingList(ctx);
    assert(!(await getShoppingState()).items.some((i) => !i.checked && i.ingredientId === 'mais'), 'kein Bedarf mehr');
  });

  t('N2-10 DB: „Gekocht“ rückgängig – höchstens abgezogene Menge zurück, zweites Rückgängig ohne Wirkung', async () => {
    await resetTestDb(); await stock();
    const e = await planChili(1);
    await cookPlanEntry(e.id, ctx);
    eq((await getItem('pantry', 'reis')).amount, 300);
    const u = await uncookPlanEntry(e.id, ctx);
    eq(u.status, 'uncooked');
    eq((await getItem('pantry', 'reis')).amount, 500);
    eq((await getItem('pantry', 'zw')).amount, 5);
    eq((await getItem('mealPlan', e.id)).cooked, false);
    eq((await uncookPlanEntry(e.id, ctx)).status, 'notCooked');
    eq((await getItem('pantry', 'reis')).amount, 500, 'kein doppeltes Zurückbuchen');
    assert((await getShoppingState()).items.some((i) => i.ingredientId === 'kidneybohnen'), 'wieder auf der Einkaufsliste');
  });

  t('N2-04 DB: Tagebucheintrag löschen – Bilanz sinkt, Vorrat unverändert, Plan wieder „nicht gegessen“', async () => {
    await resetTestDb(); await stock();
    const e = await planChili(0);
    await markPlanEaten(e.id, ctx);
    await logQuickFood({ name: 'Banane', kcal: 105, protein: 1.3 }, { date: day(0) });
    const before = await getAllItems('pantry');
    const logs = await listFoodLog(day(0));
    eq(logs.length, 2);
    await deleteFoodLog(logs.find((l) => l.source === 'plan').id);
    eq((await listFoodLog(day(0))).map((l) => l.name), ['Banane']);
    eq(await getAllItems('pantry'), before);
    eq((await getItem('mealPlan', e.id)).eaten, false);
  });

  t('N2-07 DB: Schnell-Lebensmittel nachträglich ändern – alte Tagebucheinträge unverändert', async () => {
    await resetTestDb();
    const q = (await saveQuickFood({ name: 'Mein Proteinriegel', kcal: 200, protein: 20 })).item;
    await logQuickFood(q, { date: day(0) });
    await saveQuickFood({ ...q, kcal: 250, protein: 25 });
    const entry = (await listFoodLog(day(0)))[0];
    eq([entry.kcal, entry.protein], [200, 20]);
    eq((await getItem('quickFoods', q.id)).kcal, 250);
    eq((await saveQuickFood({ name: '', kcal: 'x' })).ok, false, 'Validierung');
  });

  t('P2-06 DB (Tagebuch-Teil): gelöschtes Rezept – Tagebucheinträge behalten ihre Nährwerte', async () => {
    await resetTestDb();
    const e = await planChili(0);
    await markPlanEaten(e.id, ctx);
    const kcal = (await listFoodLog(day(0)))[0].kcal;
    await recomputeShoppingList({ ...ctx, recipesById: new Map() });
    eq((await listFoodLog(day(0)))[0].kcal, kcal);
  });

  t('P3-09 DB: 1.000 Tagebucheinträge – Tagesansicht über den Datums-Index unter 500 ms', async () => {
    await resetTestDb();
    await runTransaction(['foodLog'], 'readwrite', async (tx) => {
      for (let i = 0; i < 1000; i += 1) await tx.put('foodLog', normalizeFoodLogEntry({ id: `f${i}`, date: day(-(i % 100)), name: 'X', kcal: 100, protein: 5 }));
    });
    const t0 = performance.now();
    const list = await listFoodLog(day(-3));
    const ms = performance.now() - t0;
    eq(list.length, 10);
    assert(ms < 500, `${ms.toFixed(0)} ms`);
  });

  t('N4-03 DB: Wochenliste zweimal erzeugen ergibt keine doppelten Artikel', async () => {
    await resetTestDb();
    await addPlanEntry({ date: day(1), mealType: 'abendessen', recipeId: 'chili-sin-carne', servings: 4 }, ctx);
    await addPlanEntry({ date: day(2), mealType: 'abendessen', recipeId: 'linsen-dal', servings: 4 }, ctx);
    const r1 = await applyShoppingRange(day(0), day(6), ctx);
    const r2 = await applyShoppingRange(day(0), day(6), ctx);
    eq([r1.status, r2.status], ['applied', 'applied']);
    const items = (await getShoppingState()).items;
    const keys = items.map((i) => `${i.key}::${i.unit}`);
    eq(new Set(keys).size, keys.length, 'keine doppelten Positionen');
    eq(items.filter((i) => i.ingredientId === 'zwiebel').length, 1);
    eq(await getShoppingRange(), { from: day(0), to: day(6) });
  });

  t('N4-02 DB: leerer Zeitraum – Hinweis, nichts übernommen, Liste unverändert', async () => {
    await resetTestDb();
    await addPlanEntry({ date: day(1), mealType: 'abendessen', recipeId: 'chili-sin-carne', servings: 4 }, ctx);
    const before = await getAllItems('shoppingList');
    const res = await applyShoppingRange(day(20), day(26), ctx);
    eq(res.status, 'empty');
    eq(await getAllItems('shoppingList'), before);
    eq(await getShoppingRange(), null, 'Zeitraum nicht geändert');
  });

  t('Phase 4 DB: Zeitraum begrenzt den Plan-Bedarf; Vorschau ändert nichts; „Alle“ hebt die Grenze auf', async () => {
    await resetTestDb();
    await addPlanEntry({ date: day(1), mealType: 'abendessen', recipeId: 'chili-sin-carne', servings: 4 }, ctx);
    await addPlanEntry({ date: day(9), mealType: 'abendessen', recipeId: 'linsen-dal', servings: 4 }, ctx);
    const before = await getAllItems('shoppingList');
    const pv = await previewShoppingRange(day(0), day(6), ctx);
    assert(pv.needed.some((p) => p.ingredientId === 'kidneybohnen') && !pv.needed.some((p) => p.ingredientId === 'linsen_rot'), 'Vorschau nur für den Zeitraum');
    eq(await getAllItems('shoppingList'), before, 'Vorschau schreibt nichts');
    await applyShoppingRange(day(0), day(6), ctx);
    assert(!(await getShoppingState()).items.some((i) => i.ingredientId === 'linsen_rot'), 'außerhalb des Zeitraums nicht eingekauft');
    await clearShoppingRange(ctx);
    assert((await getShoppingState()).items.some((i) => i.ingredientId === 'linsen_rot'), 'nach „Alle“ wieder enthalten');
  });

  const prep = async (n = 4, start = 1) => (await addMealPrep({ recipeId: 'haehnchen-meal-prep-boxen', boxes: n, startDate: day(start), mealType: 'mittagessen' }, ctx)).entries;
  const chickenStock = () => putItem('pantry', normalizePantryItem({ id: 'h', name: 'Hähnchenbrustfilet', ingredientId: 'haehnchenbrust', amount: 1000, unit: 'g' }));

  t('P1-06 DB: Meal Prep mit 4 Boxen kochen und alle essen – Vorrat genau einmal für 4 Portionen', async () => {
    await resetTestDb(); await chickenStock();
    const boxesList = await prep(4);
    eq(boxesList.length, 4);
    const r1 = await cookPlanEntry(boxesList[2].id, ctx);
    eq([r1.status, r1.servings], ['cooked', 4]);
    eq((await getItem('pantry', 'h')).amount, 200, '800 g für 4 Portionen');
    for (const b of boxesList) eq((await cookPlanEntry(b.id, ctx)).status, 'already');
    for (const b of boxesList) eq((await markPlanEaten(b.id, ctx)).status, 'logged');
    eq((await getItem('pantry', 'h')).amount, 200, 'Essen zieht nichts ab');
    eq((await getAllItems('foodLog')).length, 4);
  });

  t('N3-03 DB: Box vor dem Kochen löschen senkt den Bedarf; nach dem Kochen keine Rückbuchung', async () => {
    await resetTestDb();
    const bs = await prep(4);
    const need = async () => (await getShoppingState()).items.find((i) => i.ingredientId === 'haehnchenbrust')?.amountToBuy;
    eq(await need(), 800);
    await deleteMealPrepBox(bs[3].id, 'one', ctx);
    eq(await need(), 600, '3 Portionen');
    await chickenStock();
    await cookPlanEntry(bs[0].id, ctx);
    const after = (await getItem('pantry', 'h')).amount;
    await deleteMealPrepBox(bs[1].id, 'one', ctx);
    eq((await getItem('pantry', 'h')).amount, after, 'keine Rückbuchung');
    eq((await listPlan(day(0), day(10))).length, 2);
    await deleteMealPrepBox(bs[0].id, 'all', ctx);
    eq((await listPlan(day(0), day(10))).length, 0, 'alle Boxen gelöscht');
    eq((await getItem('pantry', 'h')).amount, after);
  });

  t('N3-04 DB: Box essen, bevor die Gruppe gekocht ist – Hinweis, kein Vorratsabzug', async () => {
    await resetTestDb(); await chickenStock();
    const bs = await prep(3);
    const r = await markPlanEaten(bs[0].id, ctx);
    eq([r.status, r.notCookedYet], ['logged', true]);
    eq((await getItem('pantry', 'h')).amount, 1000);
  });

  const shopItems = async () => {
    await putItem('pantry', normalizePantryItem({ id: 'zw', name: 'Zwiebel', ingredientId: 'zwiebel', amount: 1, unit: 'Stück' }));
    await addPlanEntry({ date: day(1), mealType: 'abendessen', recipeId: 'chili-sin-carne', servings: 4 }, ctx);
    const manual = (await addManualItem({ name: 'Spülmittel', amount: 1, unit: 'Stück', category: 'Sonstiges' }, catalog)).item;
    await putItem('shoppingList', normalizeShoppingItem({ id: 'chk', name: 'Gewürzmischung', amountToBuy: null, unit: 'Stück', quantityCheck: true, category: 'Gewürze', recipeSources: [{ recipeId: 'x', title: 'X', servings: 2, amount: null, unit: 'Stück' }] }));
    return manual;
  };

  t('P2-03 DB: „Einkauf komplett übernehmen“ überspringt Artikel ohne Menge und bucht den Rest', async () => {
    await resetTestDb(); await shopItems();
    const pv = await previewCheckAll();
    eq(pv.skipped.map((i) => i.id), ['chk']);
    assert(pv.items.length >= 5, 'Vorschau enthält buchbare Artikel');
    const res = await checkAllOpen(catalog);
    eq([res.status, res.skipped.length], ['done', 1]);
    eq(res.added, pv.items.length);
    eq((await getItem('pantry', 'zw')).amount, 2, '1 + 1 Zwiebel');
    eq((await getItem('shoppingList', 'chk')).checked, false, 'ohne Menge offen');
  });

  t('P2-04 DB: „Einkauf komplett übernehmen“ zweimal – beim zweiten Mal nichts', async () => {
    await resetTestDb(); await shopItems();
    await checkAllOpen(catalog);
    const pantry = await getAllItems('pantry');
    const r2 = await checkAllOpen(catalog);
    eq([r2.status, r2.added], ['nothing', 0]);
    eq(await getAllItems('pantry'), pantry);
  });

  t('N5-02 DB: abweichende eingetragene Kaufmengen werden berücksichtigt', async () => {
    await resetTestDb(); await shopItems();
    const z = (await getShoppingState()).items.find((i) => i.ingredientId === 'zwiebel');
    await setPurchasedAmount(z.id, '3');
    await checkAllOpen(catalog);
    eq((await getItem('pantry', 'zw')).amount, 4, '1 + 3 gekauft');
  });

  t('P1-12 (Teil 2) DB: Fehler mitten in der Gesamtübernahme rollt alles zurück', async () => {
    await resetTestDb(); await shopItems();
    const pantry = await getAllItems('pantry');
    const list = await getAllItems('shoppingList');
    let failed = false;
    try { await checkAllOpen(catalog, { failAfter: 2 }); } catch { failed = true; }
    eq(failed, true);
    eq(await getAllItems('pantry'), pantry, 'Vorrat unverändert');
    eq(await getAllItems('shoppingList'), list, 'Einkaufsliste unverändert');
  });

  t('N5-03 DB: Häufig-genutzt-Knopf – passende Einheit erhöhen, sonst neuer Eintrag', async () => {
    await resetTestDb();
    await putItem('pantry', normalizePantryItem({ id: 'r', name: 'Reis (trocken)', ingredientId: 'reis', amount: 500, unit: 'g' }));
    await putItem('pantry', normalizePantryItem({ id: 'm', name: 'Milch (1,5 % Fett)', ingredientId: 'milch', amount: 2, unit: 'EL' }));
    const a = await addFrequentItem({ name: 'Reis (trocken)', ingredientId: 'reis', amount: 1, unit: 'kg', category: 'Reis und Nudeln' }, catalog);
    eq([a.status, (await getItem('pantry', 'r')).amount], ['increased', 1500]);
    const b = await addFrequentItem({ name: 'Milch (1,5 % Fett)', ingredientId: 'milch', amount: 1, unit: 'l', category: 'Milchprodukte' }, catalog);
    eq(b.status, 'created');
    eq((await getItem('pantry', 'm')).amount, 2, 'EL-Eintrag unverändert');
    eq((await getAllItems('pantry')).length, 3);
    let freq = await frequentItems();
    eq(freq[0].ingredientId, 'milch', 'bei gleicher Häufigkeit zuletzt genutzt zuerst');
    await addFrequentItem({ name: 'Reis (trocken)', ingredientId: 'reis', amount: 1, unit: 'kg', category: 'Reis und Nudeln' }, catalog);
    freq = await frequentItems();
    eq([freq[0].ingredientId, freq[0].count], ['reis', 2], 'häufiger genutzt zuerst');
  });

  t('P3-02 DB: Mehrere Zeilen speichern – nur gültige Zeilen werden übernommen', async () => {
    await resetTestDb();
    const parsed = parseBulkLines('500 g Hähnchen\nHähnchen 500 g\n6 Eier', catalog);
    const res = await addBulkToPantry(parsed.items, catalog);
    eq([res.saved, res.skipped], [2, 1]);
    eq((await getAllItems('pantry')).length, 2);
  });

  t('N5-05 DB: Häufigkeitsdaten sind nicht im Backup; App funktioniert nach Import', async () => {
    await resetTestDb();
    await addFrequentItem({ name: 'Reis (trocken)', ingredientId: 'reis', amount: 500, unit: 'g', category: 'Reis und Nudeln' }, catalog);
    const data = {};
    for (const s of BACKUP_STORES) data[s] = await getAllItems(s);
    const backup = await createBackupObject(data);
    assert(!JSON.stringify(backup.data).includes('pantryFrequency'), 'nicht im Backup');
    await resetTestDb();
    const parsed = await parseBackupInput(JSON.stringify(backup));
    await importAllData(parsed.data, 'replace');
    eq(await frequentItems(), []);
    eq((await addFrequentItem({ name: 'Reis (trocken)', ingredientId: 'reis', amount: 500, unit: 'g', category: 'Reis und Nudeln' }, catalog)).status, 'increased');
  });

  t('N7-04 DB: großes Tagebuch – Backup-Code sehr lang (Hinweis), JSON-Export und Import funktionieren', async () => {
    await resetTestDb();
    await runTransaction(['foodLog'], 'readwrite', async (tx) => {
      for (let i = 0; i < 1500; i += 1) await tx.put('foodLog', normalizeFoodLogEntry({ id: `f${i}`, date: day(-(i % 365)), name: `Eintrag ${i}`, kcal: 100 + (i % 50), protein: 5 }));
    });
    const data = {};
    for (const s of BACKUP_STORES) data[s] = await getAllItems(s);
    const backup = await createBackupObject(data);
    const code = encodeBackupCode(backup);
    assert(code.length > LONG_CODE_THRESHOLD, `Code ${code.length} Zeichen → Hinweis „JSON-Datei zuverlässiger“`);
    const json = JSON.stringify(backup, null, 2);
    await resetTestDb();
    const parsed = await parseBackupInput(json);
    eq(parsed.ok, true, parsed.errors?.join(' '));
    await importAllData(parsed.data, 'replace');
    eq((await getAllItems('foodLog')).length, 1500);
  });

  return T;
}
