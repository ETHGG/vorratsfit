// tests/db-tests-v03.js – IndexedDB-Tests für Version 0.3 (nur Browser, eigene Test-Datenbank).
import { openDatabase, putItem, getItem, getAllItems, importAllData, BACKUP_STORES, DB_VERSION, setMeta, getMeta } from '../db.js';
import { normalizePantryItem, normalizeFoodLogEntry, normalizeWeightEntry } from '../core/models.js';
import { createBackupObject, parseBackupInput } from '../backup.js';
import { wipeAllPersonalData } from '../settings.js';
import { saveProfile, getProfile } from '../profile.js';
import { saveWeight, deleteWeight, listWeights } from '../weight.js';
import { logFood, listFoodLog, listRecentFoods, logQuickFood } from '../foodlog.js';
import { addDays, todayString, ageFromBirthDate } from '../core/utils.js';
import { assert, eq } from './test-cases.js';
import { TEST_DB, resetTestDb } from './db-tests.js';
import { freshName } from './db-tests-v02.js';

const V2_SCHEMA = {
  profile: [], pantry: [['normalizedName', 'normalizedName'], ['category', 'category']], favorites: [], customRecipes: [], cachedRecipes: [],
  shoppingList: [['normalizedName', 'normalizedName']], selectedRecipes: [], settings: [], metadata: [],
  mealPlan: [['date', 'date'], ['mealPrepGroupId', 'mealPrepGroupId']], foodLog: [['date', 'date']], quickFoods: [],
};

/** Legt eine Datenbank exakt im Schema von 0.2 (Version 2) an und füllt sie. */
function createV2Database(name, records) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 2);
    req.onupgradeneeded = () => {
      for (const [s, idx] of Object.entries(V2_SCHEMA)) {
        const store = req.result.createObjectStore(s, { keyPath: 'id' });
        for (const [n, k] of idx) store.createIndex(n, k);
      }
    };
    req.onsuccess = () => {
      const tx = req.result.transaction(Object.keys(records), 'readwrite');
      for (const [s, list] of Object.entries(records)) for (const r of list) tx.objectStore(s).put(r);
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

export function buildDbTestsV03() {
  const T = [];
  const t = (name, fn) => T.push({ name, fn });
  const day = (n) => addDays(todayString(), n);
  const profile = { nickname: 'Erik', birthDate: '1996-05-10', heightCm: 180, weightKg: 95, sex: 'male', activityLevel: 'moderate', goal: 'lose', weeklyChangeKg: 0.5, mealsPerDay: 3, maxCookingMinutes: 30 };

  t('D-03 DB: Datenbank aus 0.2 (Version 2) öffnet in 0.3 vollständig; Gewichtsverlauf leer, Profil ohne Geburtsdatum behält das Alter', async () => {
    await freshName();
    const v2 = await createV2Database(TEST_DB, {
      profile: [{ id: 'main', nickname: 'Alt', age: 30, weightKg: 95 }],
      pantry: [normalizePantryItem({ id: 'p1', name: 'Reis', amount: 500, unit: 'g' })],
      foodLog: [normalizeFoodLogEntry({ id: 'f1', date: '2026-11-10', name: 'Banane', kcal: 108 })],
      mealPlan: [{ id: 'm1', date: '2026-11-20', mealType: 'abendessen', recipeId: 'chili-sin-carne', servings: 2 }],
    });
    v2.close();
    const db = await openDatabase();
    eq(db.version, DB_VERSION);
    assert(db.objectStoreNames.contains('weightLog'), 'weightLog fehlt');
    assert(db.transaction('weightLog').objectStore('weightLog').indexNames.contains('date'), 'Datums-Index');
    eq((await getItem('pantry', 'p1')).amount, 500);
    eq((await getItem('foodLog', 'f1')).kcal, 108);
    eq((await getItem('mealPlan', 'm1')).recipeId, 'chili-sin-carne');
    const p = await getProfile();
    eq([p.age, p.birthDate], [30, null]);
    eq((await getAllItems('weightLog')).length, 0);
  });

  t('G-07 DB: Profil mit Geburtsdatum speichern – Alter wird berechnet und beim Laden aktualisiert', async () => {
    await resetTestDb();
    const res = await saveProfile(profile);
    eq(res.ok, true, JSON.stringify(res.errors));
    await putItem('profile', { ...(await getItem('profile', 'main')), age: 1 });
    const p = await getProfile();
    eq([p.birthDate, p.age], ['1996-05-10', ageFromBirthDate('1996-05-10')], 'gespeichertes Alter wird ignoriert');
  });

  t('W-06 DB: Gewicht speichern – gleicher Tag überschreibt, jüngster Eintrag wird Profilgewicht', async () => {
    await resetTestDb();
    await saveProfile(profile);
    eq((await saveWeight({ date: day(-14), weightKg: '96,2' })).ok, true);
    eq((await getProfile()).weightKg, 96.2);
    await saveWeight({ date: day(0), weightKg: 94.8 });
    const r = await saveWeight({ date: day(0), weightKg: 94.6 });
    eq(r.replaced, true);
    eq((await listWeights()).map((w) => w.weightKg), [96.2, 94.6]);
    eq((await getProfile()).weightKg, 94.6);
    await saveWeight({ date: day(-7), weightKg: 95.4 });
    eq((await getProfile()).weightKg, 94.6, 'älterer Nachtrag ändert das Profilgewicht nicht');
    eq((await saveWeight({ date: day(1), weightKg: 90 })).ok, false, 'Zukunft abgelehnt');
  });

  t('W-07 DB: jüngsten Eintrag löschen – Profilgewicht fällt auf den vorherigen Eintrag zurück', async () => {
    await resetTestDb();
    await saveProfile(profile);
    await saveWeight({ date: day(-7), weightKg: 95.4 });
    await saveWeight({ date: day(0), weightKg: 94.6 });
    await deleteWeight(`w-${day(0)}`);
    eq((await getProfile()).weightKg, 95.4);
    eq((await listWeights()).length, 1);
  });

  t('F-05 DB: Lebensmittel erfassen – Tagebuch ja, Vorrat nein; „Zuletzt gegessen“ zum Wiederholen', async () => {
    await resetTestDb();
    await putItem('pantry', normalizePantryItem({ id: 'q', name: 'Laktosefreier Magerquark', ingredientId: 'magerquark_lf', amount: 500, unit: 'g' }));
    const before = await getAllItems('pantry');
    await logFood({ name: 'Laktosefreier Magerquark', kcal: 168, protein: 30, carbs: 10, fat: 0.8, fiber: 0, amountLabel: '250 g' }, { date: day(0) });
    await logQuickFood({ name: 'Banane', kcal: 108, protein: 1.3 }, { date: day(0) });
    eq(await getAllItems('pantry'), before, 'Vorrat unverändert');
    const logs = await listFoodLog(day(0));
    eq(logs.map((l) => [l.source, l.name, l.amountLabel]), [['food', 'Laktosefreier Magerquark', '250 g'], ['quick', 'Banane', null]]);
    eq((await listRecentFoods(day(0))).length, 2);
  });

  t('D-04 DB: Gewichtsverlauf im Backup; „Alle Daten löschen“ entfernt ihn und die Geburtsdatum-Abfrage', async () => {
    await resetTestDb();
    await putItem('weightLog', normalizeWeightEntry({ date: day(0), weightKg: 94.8 }));
    await setMeta('birthDatePrompted', true);
    const data = {};
    for (const s of BACKUP_STORES) data[s] = await getAllItems(s);
    const backup = await createBackupObject(data);
    eq(backup.data.weightLog.length, 1);
    await wipeAllPersonalData();
    eq((await getAllItems('weightLog')).length, 0);
    eq(await getMeta('birthDatePrompted'), undefined);
    const parsed = await parseBackupInput(JSON.stringify(backup));
    await importAllData(parsed.data, 'replace');
    eq((await getItem('weightLog', `w-${day(0)}`)).weightKg, 94.8);
  });

  return T;
}
