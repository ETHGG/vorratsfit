// tests/test-cases-v03.js – Logiktests für Version 0.3 (Node + Browser).
// G = Geburtsdatum/Alter, W = Gewicht/Auswertung, F = freies Ess-Tracking, M = Makros, D = Datenformat.
import * as models from '../core/models.js';
import { ageFromBirthDate, canonicalStringify } from '../core/utils.js';
import { validateBirthDate, validateWeightInput, weightReminder, movingAverage, weeklyStats, chartModel, formatChange } from '../core/body.js';
import { foodPortion, unitsFor, validateCustomFood, recentFoods, trackableFoods } from '../core/food.js';
import { dayBalance, sumNutrition } from '../core/day-balance.js';
import { calcTargets } from '../nutrition.js';
import { validateProfileInput } from '../profile.js';
import { createBackupObject, parseBackupInput, sha256Hex, BACKUP_VERSION } from '../backup.js';
import { createCatalog } from '../core/catalog.js';
import { assert, eq } from './test-cases.js';

const TODAY = '2026-11-16'; // Montag
const baseProfile = { heightCm: 180, weightKg: 95, sex: 'male', activityLevel: 'moderate', goal: 'lose', weeklyChangeKg: 0.5, mealsPerDay: 3, maxCookingMinutes: 30 };

export function buildTestsV03(ingredientsData = []) {
  const catalog = createCatalog(ingredientsData);
  const T = [];
  const t = (name, fn) => T.push({ name, fn });

  t('G-01 Alter aus Geburtsdatum: Geburtstag heute, morgen, gestern', () => {
    eq(ageFromBirthDate('1996-11-16', TODAY), 30, 'Geburtstag heute');
    eq(ageFromBirthDate('1996-11-17', TODAY), 29, 'Geburtstag morgen');
    eq(ageFromBirthDate('1996-11-15', TODAY), 30, 'Geburtstag gestern');
    eq(ageFromBirthDate('2027-01-01', TODAY), null, 'Zukunft');
    eq(ageFromBirthDate('kein Datum', TODAY), null);
  });

  t('G-02 Schaltjahr: Geburtstag am 29.02. zählt in Nicht-Schaltjahren ab dem 01.03.', () => {
    eq(ageFromBirthDate('2008-02-29', '2026-02-28'), 17);
    eq(ageFromBirthDate('2008-02-29', '2026-03-01'), 18);
    eq(ageFromBirthDate('2008-02-29', '2028-02-29'), 20);
  });

  t('G-03 Alter läuft automatisch weiter: Profil wird beim Laden neu berechnet', () => {
    const p = models.normalizeProfile({ birthDate: '1990-01-01', age: 5 });
    eq(p.age, ageFromBirthDate('1990-01-01'), 'gespeichertes Alter wird überschrieben');
    eq(models.normalizeProfile({ age: 30 }).age, 30, 'altes Profil ohne Geburtsdatum behält sein Alter');
    eq(models.normalizeProfile({ birthDate: '1990-02-30', age: 30 }).birthDate, null, 'ungültiges Datum verworfen');
  });

  t('G-04 Validierung Geburtsdatum: leer, Zukunft, zu jung, zu alt, gültig', () => {
    eq(validateBirthDate('', TODAY), 'Bitte gib dein Geburtsdatum an.');
    assert(validateBirthDate('2026-12-01', TODAY).includes('Zukunft'));
    assert(validateBirthDate('2020-01-01', TODAY).includes('zwischen'));
    assert(validateBirthDate('1900-01-01', TODAY).includes('zwischen'));
    eq(validateBirthDate('1996-05-10', TODAY), null);
  });

  t('G-05 Profilformular: Geburtsdatum ersetzt das Alter; ältere Profile mit Alter bleiben gültig', () => {
    const neu = validateProfileInput({ ...baseProfile, birthDate: '1996-11-17' }, TODAY);
    eq([neu.ok, neu.profile.birthDate, neu.profile.age > 0], [true, '1996-11-17', true]);
    const leer = validateProfileInput({ ...baseProfile, birthDate: '' }, TODAY);
    eq([leer.ok, leer.errors.birthDate], [false, 'Bitte gib dein Geburtsdatum an.']);
    assert(!leer.errors.age, 'keine doppelte Meldung beim Alter');
    const alt = validateProfileInput({ ...baseProfile, age: 30 }, TODAY);
    eq([alt.ok, alt.profile.age, alt.profile.birthDate], [true, 30, null]);
  });

  t('G-06 Unter 18 aus dem Geburtsdatum: Schutzregeln greifen automatisch, ab dem 18. Geburtstag nicht mehr', () => {
    const before = calcTargets({ ...baseProfile, age: ageFromBirthDate('2008-11-17', TODAY) });
    eq([before.minor, before.deficit], [true, 0]);
    const after = calcTargets({ ...baseProfile, age: ageFromBirthDate('2008-11-16', TODAY) });
    eq(after.minor, false);
    assert(after.deficit > 0, 'Defizit erst ab 18');
  });

  t('W-01 Validierung Gewicht: Grenzen, Komma, Zukunft', () => {
    eq(validateWeightInput({ date: TODAY, weightKg: '94,6' }, TODAY).values, { date: TODAY, weightKg: 94.6 });
    eq(validateWeightInput({ date: TODAY, weightKg: '29' }, TODAY).ok, false);
    eq(validateWeightInput({ date: TODAY, weightKg: '351' }, TODAY).ok, false);
    eq(validateWeightInput({ date: TODAY, weightKg: 'abc' }, TODAY).ok, false);
    assert(validateWeightInput({ date: '2026-11-17', weightKg: 90 }, TODAY).errors.date.includes('Zukunft'));
    eq(models.normalizeWeightEntry({ date: TODAY, weightKg: 94.66 }).id, `w-${TODAY}`, 'ein Eintrag je Tag');
    eq(models.normalizeWeightEntry({ date: TODAY, weightKg: 94.66 }).weightKg, 94.7);
    eq(models.normalizeWeightEntry({ date: TODAY, weightKg: 9999 }).weightKg, null);
  });

  t('W-02 Erinnerung: noch nie, 6 Tage (keine), genau 7 Tage (ja)', () => {
    eq(weightReminder([], TODAY).due, true);
    eq(weightReminder([{ date: '2026-11-10', weightKg: 95 }], TODAY).due, false);
    const r = weightReminder([{ date: '2026-11-09', weightKg: 95 }], TODAY);
    eq([r.due, r.days], [true, 7]);
    assert(r.text.includes('7 Tage'));
  });

  t('W-03 Gleitender 7-Tage-Durchschnitt', () => {
    const avg = movingAverage([{ date: '2026-11-01', weightKg: 96 }, { date: '2026-11-03', weightKg: 95 }, { date: '2026-11-10', weightKg: 94 }]);
    eq(avg.map((a) => a.value), [96, 95.5, 94], 'Einträge älter als 7 Tage fallen heraus');
    eq(movingAverage([{ date: '2026-11-03', weightKg: 95 }, { date: '2026-11-09', weightKg: 94 }]).map((a) => a.value), [95, 94.5], '6 Tage zurück zählt noch');
  });

  t('W-04 Wochenauswertung: Durchschnitt, Veränderung zur Vorwoche, kcal/Protein, Tage im Ziel', () => {
    const weights = [{ date: '2026-11-03', weightKg: 96 }, { date: '2026-11-05', weightKg: 95.6 }, { date: '2026-11-10', weightKg: 95.2 }, { date: '2026-11-16', weightKg: 94.8 }];
    const days = {
      '2026-11-10': { kcal: 2200, protein: 180, complete: true, count: 3 },
      '2026-11-11': { kcal: 2500, protein: 150, complete: true, count: 2 },
      '2026-11-12': { kcal: 1500, protein: 120, complete: false, count: 1 },
    };
    const w = weeklyStats({ weights, days, kcalTarget: 2200, weeks: 3, today: TODAY });
    eq(w.map((x) => x.start), ['2026-11-16', '2026-11-09', '2026-11-02'], 'neueste Woche zuerst');
    eq([w[2].avgWeight, w[1].avgWeight, w[1].change, w[0].change], [95.8, 95.2, -0.6, -0.4]);
    eq([w[1].daysLogged, w[1].kcalAvg, w[1].proteinAvg, w[1].daysInTarget], [3, 2350, 165, 1], 'unvollständiger Tag zählt nicht in den Schnitt');
    eq(formatChange(-0.6), '−0,6 kg');
    eq(formatChange(null), '–');
  });

  t('W-05 Diagramm: nur endliche Koordinaten, Zeitraum 4 Wochen, Wunschgewicht-Linie, leerer Zeitraum', () => {
    const weights = [{ date: '2026-08-01', weightKg: 101.7 }, { date: '2026-11-01', weightKg: 96.2 }, { date: '2026-11-08', weightKg: 95.4 }, { date: '2026-11-15', weightKg: 94.9 }];
    const m = chartModel(weights, { rangeId: '4w', today: TODAY, targetWeightKg: 93 });
    eq(m.points.length, 3, 'August liegt außerhalb von 4 Wochen');
    assert(m.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)), 'keine NaN');
    assert(m.points[0].x < m.points[1].x && m.points[1].x < m.points[2].x, 'zeitlich sortiert');
    assert(m.points[0].y < m.points[2].y, 'höheres Gewicht weiter oben');
    assert(m.targetY !== null && m.avgPath.startsWith('M'), 'Wunschgewicht und Durchschnittslinie');
    eq(chartModel(weights, { rangeId: 'all', today: TODAY }).points.length, 4);
    eq(chartModel([], { today: TODAY }), null);
    const one = chartModel([{ date: TODAY, weightKg: 90 }], { today: TODAY });
    assert(one.points.length === 1 && Number.isFinite(one.points[0].x) && one.avgPath === null, 'ein einzelner Eintrag');
    assert(!/NaN|undefined/.test(JSON.stringify(m)), 'Modell ohne NaN');
  });

  t('F-01 Lebensmittel aus den Stammdaten: 250 g Magerquark, 1 Banane, 300 ml Milch', () => {
    const q = foodPortion(catalog.get('magerquark_lf'), 250, 'g');
    eq([q.ok, q.values.kcal, q.values.protein, q.amountLabel], [true, 168, 30, '250 g']);
    const b = foodPortion(catalog.get('banane'), 1, 'Stück');
    eq([b.values.kcal, b.values.carbs], [108, 24], 'Stück über hinterlegtes Stückgewicht');
    eq(foodPortion(catalog.get('milch_lf'), 300, 'ml').values.kcal, 141);
    eq(unitsFor(catalog.get('milch_lf')), ['ml', 'l']);
    eq(unitsFor(catalog.get('banane')), ['g', 'kg', 'Stück']);
  });

  t('F-02 Keine geratenen Werte: unbekanntes Lebensmittel, Menge 0, Stück ohne Stückgewicht', () => {
    eq(foodPortion(null, 100, 'g').ok, false);
    eq(foodPortion(catalog.get('reis'), 0, 'g').ok, false);
    eq(foodPortion(catalog.get('reis'), 1, 'Stück').ok, false, 'Reis hat kein Stückgewicht');
    assert(trackableFoods(catalog).every((e) => e.nutrition && !e.isSpice), 'nur Lebensmittel mit Nährwerten, keine Gewürze');
  });

  t('F-03 Eigene Werte: kcal Pflicht, Makros optional, fehlende Makros bleiben null', () => {
    const ok = validateCustomFood({ name: 'Döner', kcal: '650', protein: '30', carbs: '', fat: '' });
    eq(ok.values, { name: 'Döner', kcal: 650, protein: 30, carbs: null, fat: null });
    eq(validateCustomFood({ name: '', kcal: '' }).ok, false);
    eq(validateCustomFood({ name: 'X', kcal: '-5' }).ok, false);
  });

  t('F-04 „Zuletzt gegessen“: verschieden, neueste zuerst, ohne Plan-Mahlzeiten', () => {
    const logs = [
      { name: 'Banane', amountLabel: '1 Stück', date: '2026-11-14', time: '10:00', createdAt: 'a', source: 'quick' },
      { name: 'Magerquark', amountLabel: '250 g', date: '2026-11-15', time: '08:00', createdAt: 'b', source: 'food' },
      { name: 'Banane', amountLabel: '1 Stück', date: '2026-11-16', time: '09:00', createdAt: 'c', source: 'quick' },
      { name: 'Chili', date: '2026-11-16', time: '19:00', createdAt: 'd', source: 'plan' },
    ];
    eq(recentFoods(logs).map((l) => `${l.name} ${l.date}`), ['Banane 2026-11-16', 'Magerquark 2026-11-15']);
  });

  t('M-01 Tagesbilanz zeigt Protein, Kohlenhydrate, Fett und Ballaststoffe mit Zielen', () => {
    const targets = calcTargets({ ...baseProfile, age: 30 });
    const b = dayBalance({ targets, logs: [{ kcal: 600, protein: 50, carbs: 60, fat: 15, fiber: 8, portions: 2 }], planned: [] });
    eq(b.macros.map((m) => m.id), ['protein', 'carbs', 'fat', 'fiber']);
    eq(b.macros.map((m) => m.eaten), [100, 120, 30, 16], 'Portionen multipliziert');
    eq(b.macros[0].target, targets.proteinMin);
    eq(b.macros[0].targetMax, targets.proteinMax);
    eq([b.macros[1].kind, b.macros[2].kind, b.macros[3].target], ['approx', 'min', targets.fiber]);
  });

  t('M-02 Fehlende Makros werden nicht als 0 gewertet, sondern als unvollständig markiert', () => {
    const s = sumNutrition([{ kcal: 650, protein: 30, carbs: null, fat: null, portions: 1 }]);
    eq([s.carbs, s.macrosComplete, s.complete], [0, false, true]);
  });

  t('D-01 Backup (ab Version 3) mit Gewichtsverlauf; Backup aus 0.2 (Version 2) wird migriert', async () => {
    assert(BACKUP_VERSION >= 3, 'mindestens Version 3 (0.6: 4)');
    const b = await createBackupObject({ weightLog: [models.normalizeWeightEntry({ date: TODAY, weightKg: 94.8 })] });
    const parsed = await parseBackupInput(JSON.stringify(b));
    eq([parsed.ok, parsed.data.weightLog[0].weightKg], [true, 94.8]);
    const data = { foodLog: [{ id: 'f1', date: TODAY, name: 'Banane', kcal: 108 }] };
    const v2 = { format: 'vorratsfit-backup', backupVersion: 2, appVersion: '0.2.0', data, checksum: await sha256Hex(canonicalStringify(data)) };
    const p2 = await parseBackupInput(JSON.stringify(v2));
    eq([p2.ok, p2.meta.migrated, p2.data.weightLog, p2.data.foodLog[0].kcal], [true, true, [], 108]);
  });

  t('D-02 Tagebucheintrag „food“ mit Mengenangabe übersteht die Normalisierung', () => {
    const f = models.normalizeFoodLogEntry({ date: TODAY, source: 'food', name: 'Magerquark', amountLabel: '250 g', kcal: 168, protein: 30, carbs: 10, fat: 0.8, fiber: 0 });
    eq([f.source, f.amountLabel, f.fiber], ['food', '250 g', 0]);
  });

  return T;
}
