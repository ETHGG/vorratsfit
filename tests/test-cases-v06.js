// tests/test-cases-v06.js – Logiktests für 0.4–0.6 (Node + Browser).
// K = Kochmodus-Timer, E = Erfolge, S = Einstellungen/Wasser, R = Rezepte, B = Backup-Format 4.
import * as models from '../core/models.js';
import { detectTimerSeconds, formatTimer } from '../core/cook-steps.js';
import { computeAchievements, loggingStreak } from '../core/achievements.js';
import { createBackupObject, parseBackupInput, sha256Hex, BACKUP_VERSION } from '../backup.js';
import { canonicalStringify, nowIso, addDays } from '../core/utils.js';
import { sortShoppingItems } from '../core/shopping-logic.js';
import { assert, eq } from './test-cases.js';

const TODAY = '2026-11-16';

export function buildTestsV06() {
  const T = [];
  const t = (name, fn) => T.push({ name, fn });

  t('K-01 Timer erkennt Minuten, Spannen (kleinerer Wert), Stunden und Sekunden', () => {
    eq(detectTimerSeconds('im Airfryer bei 190 °C etwa 12 Minuten garen'), 720);
    eq(detectTimerSeconds('10–15 Min. köcheln'), 600);
    eq(detectTimerSeconds('1 Stunde ziehen lassen'), 3600);
    eq(detectTimerSeconds('30 Sekunden mixen'), 30);
    eq(detectTimerSeconds('1,5 Std. schmoren'), 5400);
  });
  t('K-02 Kein Timer ohne Zeitangabe; Temperaturen werden nicht als Zeit gelesen', () => {
    eq(detectTimerSeconds('Reis nach Packungsangabe garen.'), null);
    eq(detectTimerSeconds('Ofen auf 200 °C vorheizen.'), null);
    eq(detectTimerSeconds(null), null);
  });
  t('K-03 Timer-Anzeige mm:ss bzw. h:mm:ss', () => {
    eq(formatTimer(720), '12:00'); eq(formatTimer(65), '01:05'); eq(formatTimer(3725), '1:02:05'); eq(formatTimer(-3), '00:00');
  });

  t('E-01 Serie: zählt bis heute, oder bis gestern wenn heute noch leer', () => {
    eq(loggingStreak([TODAY, addDays(TODAY, -1), addDays(TODAY, -2)], TODAY), 3);
    eq(loggingStreak([addDays(TODAY, -1), addDays(TODAY, -2)], TODAY), 2);
    eq(loggingStreak([addDays(TODAY, -3)], TODAY), 0);
  });
  t('E-02 Erfolge: Tage im Ziel (±10 %), Kochen, Wasser', () => {
    const foodLog = [0, 1, 2, 3, 4].map((i) => ({ date: addDays(TODAY, -i), kcal: 2000, portions: 1 }));
    const a = computeAchievements({ today: TODAY, foodLog, kcalTarget: 2100, cookedCount: 6, water: [{ date: TODAY, ml: 2500 }], waterGoalMl: 2000 });
    const by = Object.fromEntries(a.map((x) => [x.id, x]));
    eq(by.streak.achieved, true); eq(by.streak.title, '5 Tage in Folge');
    eq(by.target.title, '5 von 7 Tagen im Ziel'); eq(by.target.achieved, true);
    eq(by.cooked.title, '6× selbst gekocht'); assert(by.cooked.text.includes('10'), by.cooked.text);
    eq(by.water.title, '1 von 7 Tagen genug getrunken'); eq(by.water.achieved, false);
  });
  t('E-03 Erfolge: Gewichtsabnahme nur bei Ziel „abnehmen“ und nie für Minderjährige', () => {
    const weights = [{ date: addDays(TODAY, -30), weightKg: 95 }, { date: TODAY, weightKg: 93.6 }];
    const adult = computeAchievements({ today: TODAY, weights, goal: 'lose' });
    const w = adult.find((x) => x.id === 'weight');
    assert(w && w.title === '−1,4 kg seit Beginn' && w.achieved, JSON.stringify(w));
    eq(computeAchievements({ today: TODAY, weights, goal: 'lose', minor: true }).some((x) => x.id === 'weight'), false);
    eq(computeAchievements({ today: TODAY, weights, goal: 'maintain' }).some((x) => x.id === 'weight'), false);
  });
  t('E-04 Unvollständige Tage zählen nicht als „im Ziel“', () => {
    const a = computeAchievements({ today: TODAY, foodLog: [{ date: TODAY, kcal: 2000, portions: 1 }, { date: TODAY, kcal: null, portions: 1 }], kcalTarget: 2000 });
    eq(a.find((x) => x.id === 'target').title, '0 von 7 Tagen im Ziel');
  });

  t('S-01 Einstellungen: Wasserziel 500–6000 ml (Standard 2000), Gänge-Reihenfolge nur gültige, ohne Doppelte', () => {
    eq(models.normalizeSettings({}).waterGoalMl, 2000);
    eq(models.normalizeSettings({ waterGoalMl: 99999 }).waterGoalMl, 6000);
    eq(models.normalizeSettings({ waterGoalMl: '100' }).waterGoalMl, 500);
    eq(models.normalizeSettings({ shoppingGroupOrder: ['Getränke', 'Quatsch', 'Getränke', 'Obst und Gemüse'] }).shoppingGroupOrder, ['Getränke', 'Obst und Gemüse']);
  });
  t('S-02 Wasser-Eintrag: ein Datensatz je Tag, 0–10 000 ml', () => {
    const w = models.normalizeWaterEntry({ date: TODAY, ml: 12000 });
    eq(w.id, `water-${TODAY}`); eq(w.ml, 10000);
    eq(models.normalizeWaterEntry({ date: TODAY, ml: -5 }).ml, 0);
  });
  t('S-03 Einkaufsliste folgt der eigenen Gänge-Reihenfolge', () => {
    const items = [{ name: 'Milch', shoppingGroup: 'Milchprodukte und Ersatzprodukte' }, { name: 'Apfel', shoppingGroup: 'Obst und Gemüse' }, { name: 'Wasser', shoppingGroup: 'Getränke' }];
    eq(sortShoppingItems(items, ['Getränke', 'Milchprodukte und Ersatzprodukte', 'Obst und Gemüse']).map((i) => i.name), ['Wasser', 'Milch', 'Apfel']);
  });
  t('S-04 Zeitstempel sind streng monoton (stabile Reihenfolge)', () => {
    const list = Array.from({ length: 50 }, () => nowIso());
    for (let i = 1; i < list.length; i += 1) assert(list[i] > list[i - 1], `${list[i - 1]} !< ${list[i]}`);
  });

  t('R-01 Eigenes Rezeptfoto: nur Bild-Daten-URLs werden übernommen', () => {
    const ok = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
    eq(models.normalizeRecipe({ title: 'x', photo: ok }).photo, ok);
    eq(models.normalizeRecipe({ title: 'x', photo: 'javascript:alert(1)' }).photo, null);
    eq(models.normalizeRecipe({ title: 'x', photo: 'https://example.com/a.jpg' }).photo, null);
    eq(models.normalizeRecipe({ title: 'x', photo: 'data:image/svg+xml;base64,PHN2Zz4=' }).photo, null);
  });

  t('B-01 Backup-Format (ab 4) enthält den Wasserverlauf; Backups Version 3 werden ergänzt', async () => {
    assert(BACKUP_VERSION >= 4, 'ab Version 4');
    const water = [models.normalizeWaterEntry({ date: TODAY, ml: 750 })];
    const b = await createBackupObject({ waterLog: water });
    const r = await parseBackupInput(JSON.stringify(b));
    assert(r.ok, r.errors?.join(' ')); eq(r.data.waterLog[0].ml, 750);
    const data3 = { weightLog: [] };
    const old = { format: 'vorratsfit-backup', backupVersion: 3, appVersion: '0.3.0', data: data3, checksum: await sha256Hex(canonicalStringify(data3)) };
    const r3 = await parseBackupInput(JSON.stringify(old));
    assert(r3.ok && r3.meta.migrated, r3.errors?.join(' ')); eq(r3.data.waterLog, []);
  });
  return T;
}

export function buildTestsV07() {
  const T = [];
  const t = (name, fn) => T.push({ name, fn });
  t('P-01 Rezeptfoto: nur Bild-Daten-URLs, Rezept-ID Pflicht', () => {
    const ok = 'data:image/jpeg;base64,/9j/4AAQ';
    eq(models.normalizeRecipePhoto({ id: 'chili-sin-carne', photo: ok }).photo, ok);
    eq(models.normalizeRecipePhoto({ id: 'x', photo: 'data:text/html;base64,PGI+' }).photo, null);
    let threw = false; try { models.normalizeRecipePhoto({ photo: ok }); } catch { threw = true; }
    eq(threw, true);
  });
  t('P-02 Backup-Format 5 enthält Rezeptfotos; Version 4 wird ergänzt', async () => {
    eq(BACKUP_VERSION, 5);
    const photo = models.normalizeRecipePhoto({ id: 'chili-sin-carne', photo: 'data:image/jpeg;base64,/9j/4AAQ' });
    const r = await parseBackupInput(JSON.stringify(await createBackupObject({ recipePhotos: [photo] })));
    assert(r.ok, r.errors?.join(' ')); eq(r.data.recipePhotos[0].id, 'chili-sin-carne');
    const d4 = { waterLog: [] };
    const r4 = await parseBackupInput(JSON.stringify({ format: 'vorratsfit-backup', backupVersion: 4, data: d4, checksum: await sha256Hex(canonicalStringify(d4)) }));
    assert(r4.ok && r4.meta.migrated); eq(r4.data.recipePhotos, []);
  });
  return T;
}
