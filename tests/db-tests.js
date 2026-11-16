// tests/db-tests.js – Tests mit echter IndexedDB (nur im Browser). Nutzt eine eigene Test-Datenbank.
import { configureDatabase, closeDatabase, putItem, getItem, getAllItems, importAllData, BACKUP_STORES, runTransaction, openDatabase } from '../db.js';
import { normalizePantryItem, normalizeShoppingItem } from '../core/models.js';
import { createCatalog } from '../core/catalog.js';
import { checkShoppingItem, undoCheck, startNewPurchase, addRecipeToShopping, removeSelectedRecipe, getShoppingState, setPurchasedAmount } from '../shopping.js';
import { createBackupObject, parseBackupInput, encodeBackupCode } from '../backup.js';
import { assert, eq } from './test-cases.js';

const TEST_DB = 'vorratsfit-test-db';

async function resetTestDb() {
  await closeDatabase();
  await new Promise((resolve) => {
    // Nur die TEST-Datenbank wird gelöscht – niemals die App-Datenbank.
    const req = indexedDB.deleteDatabase(TEST_DB);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  configureDatabase(TEST_DB);
  await openDatabase();
}

async function pantryAmount(name) {
  const all = await getAllItems('pantry');
  return all.filter((p) => p.normalizedName === name.toLowerCase()).reduce((a, p) => a + p.amount, 0);
}

export function buildDbTests(ingredientsData, recipesData) {
  const catalog = createCatalog(ingredientsData);
  const recipes = recipesData.recipes;
  const recipesById = new Map(recipes.map((r) => [r.id, { ...r, origin: 'local' }]));
  const ctx = { recipesById, profile: null, catalog };
  const T = [];
  const t = (name, fn) => T.push({ name, fn: async () => { await resetTestDb(); await fn(); } });

  const chickenItem = (extra = {}) => normalizeShoppingItem({ id: 'shop-chicken', key: 'id:haehnchenbrust', ingredientId: 'haehnchenbrust', name: 'Hähnchenbrustfilet', amountNeeded: 800, amountAvailable: 300, amountToBuy: 500, unit: 'g', category: 'Fleisch und Fisch', recipeSources: [{ recipeId: 'x', title: 'X', servings: 4, amount: 800, unit: 'g' }], manuallyAdded: false, ...extra });

  t('11 DB: 500 g benötigt, 600 g gekauft, 300 g vorhanden → 900 g', async () => {
    await putItem('pantry', normalizePantryItem({ id: 'p1', name: 'Hähnchenbrustfilet', ingredientId: 'haehnchenbrust', amount: 300, unit: 'g', category: 'Fleisch und Fisch' }));
    await putItem('shoppingList', chickenItem());
    eq((await setPurchasedAmount('shop-chicken', '600')).ok, true);
    eq((await checkShoppingItem('shop-chicken', catalog)).status, 'added');
    eq((await getItem('pantry', 'p1')).amount, 900);
    const item = await getItem('shoppingList', 'shop-chicken');
    eq([item.checked, item.addedToPantry, item.pantryAmountAdded, item.pantryAmountAfter], [true, true, 600, 900]);
    assert(item.pantryTransactionId, 'Transaktionskennung gespeichert');
  });

  t('12 DB: erneutes Abhaken/Rendern fügt die Menge nicht erneut hinzu', async () => {
    await putItem('pantry', normalizePantryItem({ id: 'p1', name: 'Hähnchenbrustfilet', ingredientId: 'haehnchenbrust', amount: 300, unit: 'g' }));
    await putItem('shoppingList', chickenItem());
    await checkShoppingItem('shop-chicken', catalog);
    eq((await checkShoppingItem('shop-chicken', catalog)).status, 'already');
    await closeDatabase(); // "Neu laden"
    configureDatabase(TEST_DB);
    eq((await checkShoppingItem('shop-chicken', catalog)).status, 'already');
    eq((await getItem('pantry', 'p1')).amount, 800);
  });

  t('13 DB: Doppelklick führt nur eine Transaktion aus', async () => {
    await putItem('pantry', normalizePantryItem({ id: 'p1', name: 'Paprika', ingredientId: 'paprika', amount: 1, unit: 'Stück' }));
    await putItem('shoppingList', normalizeShoppingItem({ id: 's-pap', key: 'id:paprika', ingredientId: 'paprika', name: 'Paprika', amountToBuy: 3, unit: 'Stück', category: 'Gemüse', recipeSources: [{ recipeId: 'x', title: 'X', servings: 4, amount: 4, unit: 'Stück' }] }));
    const results = await Promise.all([checkShoppingItem('s-pap', catalog), checkShoppingItem('s-pap', catalog), checkShoppingItem('s-pap', catalog)]);
    eq(results.filter((r) => r.status === 'added').length, 1, JSON.stringify(results));
    eq((await getItem('pantry', 'p1')).amount, 4);
  });

  t('14 DB: Rückgängigmachen erzeugt keine negative Vorratsmenge', async () => {
    await putItem('pantry', normalizePantryItem({ id: 'p1', name: 'Hähnchenbrustfilet', ingredientId: 'haehnchenbrust', amount: 300, unit: 'g' }));
    await putItem('shoppingList', chickenItem({ amountPurchased: 600 }));
    await checkShoppingItem('shop-chicken', catalog);
    const p = await getItem('pantry', 'p1');
    await putItem('pantry', { ...p, amount: 200 });
    const res = await undoCheck('shop-chicken', 'removeFromPantry');
    eq(res.removed, 200);
    eq((await getItem('pantry', 'p1')).amount, 0);
    const item = await getItem('shoppingList', 'shop-chicken');
    eq([item.checked, item.addedToPantry], [false, false]);
  });

  t('14b DB: „Nur zurücksetzen“ verhindert erneute automatische Addition', async () => {
    await putItem('pantry', normalizePantryItem({ id: 'p1', name: 'Hähnchenbrustfilet', ingredientId: 'haehnchenbrust', amount: 300, unit: 'g' }));
    await putItem('shoppingList', chickenItem());
    await checkShoppingItem('shop-chicken', catalog);
    await undoCheck('shop-chicken', 'resetOnly');
    eq((await getItem('pantry', 'p1')).amount, 800, 'Vorrat unverändert');
    eq((await checkShoppingItem('shop-chicken', catalog)).status, 'checkedWithoutAdding');
    eq((await getItem('pantry', 'p1')).amount, 800, 'keine erneute Addition');
    await undoCheck('shop-chicken', 'resetOnly');
    await startNewPurchase('shop-chicken');
    eq((await checkShoppingItem('shop-chicken', catalog)).status, 'added');
    eq((await getItem('pantry', 'p1')).amount, 1300);
  });

  t('14c DB: Rückgängig entfernt neu angelegten Vorratseintrag vollständig', async () => {
    await putItem('shoppingList', normalizeShoppingItem({ id: 's-z', key: 'id:zwiebel', ingredientId: 'zwiebel', name: 'Zwiebel', amountToBuy: 2, unit: 'Stück', category: 'Gemüse', recipeSources: [{ recipeId: 'x', title: 'X', servings: 2, amount: 2, unit: 'Stück' }] }));
    await checkShoppingItem('s-z', catalog);
    eq(await pantryAmount('zwiebel'), 2);
    await undoCheck('s-z', 'removeFromPantry');
    eq((await getAllItems('pantry')).length, 0);
  });

  t('10 DB: Rezept hinzufügen, zweites Rezept zusammenführen, Rezept entfernen', async () => {
    await putItem('pantry', normalizePantryItem({ name: 'Zwiebel', ingredientId: 'zwiebel', amount: 1, unit: 'Stück' }));
    const a = recipesById.get('airfryer-haehnchen-paprika-reis');
    const b = recipesById.get('chili-sin-carne');
    await addRecipeToShopping(a, 4, ctx);
    let st = await getShoppingState();
    eq(st.items.find((i) => i.ingredientId === 'zwiebel').amountToBuy, 1);
    await addRecipeToShopping(b, 4, ctx);
    st = await getShoppingState();
    const z = st.items.find((i) => i.ingredientId === 'zwiebel');
    eq([z.amountNeeded, z.amountAvailable, z.amountToBuy, z.recipeSources.length], [4, 1, 3, 2]);
    await removeSelectedRecipe(b.id, ctx);
    st = await getShoppingState();
    eq(st.items.find((i) => i.ingredientId === 'zwiebel').amountToBuy, 1);
    assert(!st.items.some((i) => i.ingredientId === 'kidneybohnen'), 'nicht mehr benötigte Artikel entfernt');
  });

  t('15 DB: Neustart erhält Profil, Vorrat und Einkaufsliste', async () => {
    await putItem('profile', { id: 'main', nickname: 'Test', age: 30 });
    await putItem('pantry', normalizePantryItem({ id: 'p1', name: 'Reis', amount: 500, unit: 'g' }));
    await putItem('shoppingList', chickenItem());
    await closeDatabase();
    configureDatabase(TEST_DB);
    eq((await getItem('profile', 'main')).nickname, 'Test');
    eq((await getItem('pantry', 'p1')).amount, 500);
    eq((await getAllItems('shoppingList')).length, 1);
  });

  t('17/18 DB: fehlerhafter Import hinterlässt keine halbfertigen Daten', async () => {
    await putItem('pantry', normalizePantryItem({ id: 'keep', name: 'Reis', amount: 500, unit: 'g' }));
    const bad = { pantry: [normalizePantryItem({ id: 'new1', name: 'Nudeln', amount: 1, unit: 'kg' })], shoppingList: [{ name: 'ohne id – verletzt keyPath' }] };
    let failed = false;
    try { await importAllData(bad, 'replace'); } catch { failed = true; }
    eq(failed, true, 'Import muss fehlschlagen');
    eq((await getAllItems('pantry')).map((p) => p.id), ['keep'], 'alter Stand vollständig erhalten');
  });

  t('B2 DB: Backup erstellen → in leeres Gerät importieren (Ersetzen und Zusammenführen)', async () => {
    await putItem('profile', { id: 'main', nickname: 'Jörg', age: 30, updatedAt: '2025-01-01T00:00:00.000Z' });
    await putItem('pantry', normalizePantryItem({ id: 'p1', name: 'Reis', amount: 500, unit: 'g' }));
    const data = {};
    for (const s of BACKUP_STORES) data[s] = await getAllItems(s);
    const code = encodeBackupCode(await createBackupObject(data));
    await resetTestDb();
    await putItem('pantry', normalizePantryItem({ id: 'p2', name: 'Nudeln', amount: 1, unit: 'kg' }));
    const parsed = await parseBackupInput(code);
    eq(parsed.ok, true);
    await importAllData(parsed.data, 'merge');
    eq((await getAllItems('pantry')).length, 2, 'Zusammenführen');
    await importAllData(parsed.data, 'replace');
    eq((await getAllItems('pantry')).map((p) => p.id), ['p1'], 'Ersetzen');
    eq((await getItem('profile', 'main')).nickname, 'Jörg');
  });

  t('T1 DB: Transaktion wird bei Fehler vollständig zurückgerollt', async () => {
    await putItem('pantry', normalizePantryItem({ id: 'p1', name: 'Reis', amount: 500, unit: 'g' }));
    let threw = false;
    try {
      await runTransaction(['pantry'], 'readwrite', async (tx) => {
        await tx.put('pantry', normalizePantryItem({ id: 'p1', name: 'Reis', amount: 1, unit: 'g' }));
        throw new Error('Absichtlicher Fehler');
      });
    } catch { threw = true; }
    eq(threw, true);
    eq((await getItem('pantry', 'p1')).amount, 500);
  });

  return T;
}

export async function cleanupTestDb() {
  await closeDatabase();
  await new Promise((resolve) => { const r = indexedDB.deleteDatabase(TEST_DB); r.onsuccess = r.onerror = r.onblocked = () => resolve(); });
  configureDatabase('vorratsfit-db');
}
