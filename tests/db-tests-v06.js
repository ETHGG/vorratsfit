// tests/db-tests-v06.js – IndexedDB-Tests für 0.6 (nur Browser, eigene Test-Datenbank).
import { openDatabase, getAllItems, DB_VERSION, STORE_NAMES } from '../db.js';
import { getWater, addWater, listWaterRange } from '../water.js';
import { saveSettings, getSettings } from '../settings.js';
import { addDays, todayString } from '../core/utils.js';
import { eq, assert } from './test-cases.js';
import { resetTestDb } from './db-tests.js';

export function buildDbTestsV06() {
  const T = [];
  const t = (name, fn) => T.push({ name, fn });
  const day = (n) => addDays(todayString(), n);

  t('S-DB-01 Datenbank Version 4 mit Store „waterLog“ (Index „date“)', async () => {
    await resetTestDb();
    const db = await openDatabase();
    eq(db.version, DB_VERSION); eq(DB_VERSION, 4);
    assert(STORE_NAMES.includes('waterLog') && db.objectStoreNames.contains('waterLog'));
    eq(Array.from(db.transaction('waterLog').objectStore('waterLog').indexNames), ['date']);
  });
  t('S-DB-02 Wasser: addieren, korrigieren, nie unter 0, ein Eintrag je Tag', async () => {
    await resetTestDb();
    eq(await getWater(day(0)), 0);
    eq((await addWater(day(0), 250)).ml, 250);
    eq((await addWater(day(0), 500)).ml, 750);
    eq((await addWater(day(0), -2000)).ml, 0);
    await addWater(day(-1), 1500);
    eq((await getAllItems('waterLog')).length, 2);
    eq((await listWaterRange(day(-6), day(0))).map((w) => w.ml), [1500, 0]);
  });
  t('S-DB-03 Einstellungen behalten Wasserziel und Gänge-Reihenfolge', async () => {
    await resetTestDb();
    await saveSettings({ waterGoalMl: 2500, shoppingGroupOrder: ['Getränke'] });
    await saveSettings({ defaultServings: 3 });
    const s = await getSettings();
    eq([s.waterGoalMl, s.shoppingGroupOrder, s.defaultServings], [2500, ['Getränke'], 3]);
  });
  return T;
}
