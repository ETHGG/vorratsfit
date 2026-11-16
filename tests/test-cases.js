// tests/test-cases.js – Tests der reinen Geschäftslogik. Läuft in Node (tests/run-node.mjs)
// UND im Browser (tests/index.html). Keine Abhängigkeiten, kein Build-Schritt.
import { computeToBuy, scaleAmount, convert, formatAmount, normalizeUnit, parseIngredientLine, convertWithIngredient } from '../units.js';
import { createCatalog } from '../core/catalog.js';
import { aggregateNeeds, computePlan, mergePlanIntoList, previewForRecipe, undoAnalysis } from '../core/shopping-logic.js';
import { scaleRecipe, evaluateAgainstPantry, scoreRecipe } from '../core/scoring.js';
import { checkRecipe, recipeAllergens } from '../core/restrictions.js';
import { calcBmr, calcTargets, computeRecipeNutrition } from '../nutrition.js';
import { normalizeShoppingItem, normalizePantryItem } from '../core/models.js';
import { canonicalStringify, parseNumber, uuid } from '../core/utils.js';
import { createBackupObject, encodeBackupCode, decodeBackupCode, parseBackupInput, sha256Hex, BACKUP_VERSION } from '../backup.js';
import { mapMealDbMeal, parseMeasure } from '../api.js';
import { buildCustomRecipe } from '../recipes.js';

export function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Bedingung nicht erfüllt');
}
export function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg ? `${msg}: ` : ''}erwartet ${e}, erhalten ${a}`);
}

const ING = (id, name, amount, unit, extra = {}) => ({ ingredientId: id, name, normalizedName: name.toLowerCase(), amount, unit, category: 'Sonstiges', optional: false, substitutes: [], allergenTags: [], ...extra });
const P = (name, amount, unit, extra = {}) => normalizePantryItem({ name, amount, unit, ...extra });

export function buildTests(ingredientsData) {
  const catalog = createCatalog(ingredientsData);
  const recipeA = { id: 'A', title: 'Rezept A', defaultServings: 2, ingredients: [ING('zwiebel', 'Zwiebel', 3, 'Stück'), ING('reis', 'Reis', 200, 'g')], spices: [] };
  const recipeB = { id: 'B', title: 'Rezept B', defaultServings: 2, ingredients: [ING('zwiebel', 'Zwiebel', 4, 'Stück')], spices: [] };
  const chicken4 = {
    id: 'C', title: 'Hähnchen-Reis', defaultServings: 2,
    ingredients: [ING('haehnchenbrust', 'Hähnchenbrustfilet', 400, 'g'), ING('reis', 'Reis', 200, 'g'), ING('paprika', 'Paprika', 2, 'Stück'), ING('zwiebel', 'Zwiebel', 1, 'Stück'), ING('olivenoel', 'Olivenöl', 10, 'ml')],
    spices: [],
  };
  const T = [];
  const t = (name, fn) => T.push({ name, fn });

  t('01 Mengen: 800 g benötigt, 300 g vorhanden → 500 g kaufen', () => {
    const r = computeToBuy(800, 'g', [{ amount: 300, unit: 'g' }]);
    eq(r.toBuy, 500); eq(r.status, 'ok');
  });
  t('02 Mengen: 400 g benötigt, 500 g vorhanden → nichts kaufen', () => eq(computeToBuy(400, 'g', [{ amount: 500, unit: 'g' }]).toBuy, 0));
  t('03 Mengen: 4 Paprika benötigt, 1 vorhanden → 3 kaufen', () => eq(computeToBuy(4, 'Stück', [{ amount: 1, unit: 'Stück' }]).toBuy, 3));
  t('04 Mengen: 1 kg vorhanden, 800 g benötigt → nichts kaufen', () => eq(computeToBuy(800, 'g', [{ amount: 1, unit: 'kg' }]).toBuy, 0));
  t('05 Mengen: 1 l vorhanden, 1.250 ml benötigt → 250 ml kaufen', () => {
    const r = computeToBuy(1250, 'ml', [{ amount: 1, unit: 'l' }]);
    eq(r.toBuy, 250); eq(r.unit, 'ml');
  });

  t('06 Portionen: 2 Personen 400 g → 4 Personen 800 g', () => {
    eq(scaleAmount(400, 2, 4), 800);
    const s = scaleRecipe(chicken4, 4);
    eq(s.ingredients[0].amount, 800);
  });
  t('07 Portionen: 1, 2, 4 und 8 Portionen skalieren korrekt', () => {
    eq([1, 2, 4, 8].map((n) => scaleAmount(400, 2, n)), [200, 400, 800, 1600]);
    eq([1, 2, 4, 8].map((n) => scaleAmount(3, 2, n)), [1.5, 3, 6, 12]);
    eq(scaleAmount(10, 3, 1), 3.333333, 'Rundung ohne Gleitkommaartefakte');
  });
  t('07b Spezifikationsbeispiel: Einkaufsliste für 4 Personen', () => {
    const pantry = [P('Hähnchenbrust', 300, 'g'), P('Reis', 500, 'g'), P('Paprika', 1, 'Stück'), P('Olivenöl', 100, 'ml')];
    const plan = computePlan(aggregateNeeds([{ recipeId: 'C', title: 'X', servings: 4, recipe: chicken4 }], catalog), pantry, catalog);
    const buy = Object.fromEntries(plan.filter((p) => p.amountToBuy > 0).map((p) => [p.ingredientId, p.amountToBuy]));
    eq(buy, { haehnchenbrust: 500, paprika: 3, zwiebel: 2 });
    const pv = previewForRecipe('C', plan);
    eq(pv.sufficient.map((p) => p.ingredientId).sort(), ['olivenoel', 'reis']);
  });

  t('08 Mehrere Rezepte: 3 + 4 Zwiebeln, Vorrat 2 → 5 kaufen', () => {
    const needs = aggregateNeeds([{ recipeId: 'A', servings: 2, recipe: recipeA }, { recipeId: 'B', servings: 2, recipe: recipeB }], catalog);
    const plan = computePlan(needs, [P('Zwiebel', 2, 'Stück')], catalog);
    const z = plan.find((p) => p.ingredientId === 'zwiebel');
    eq(z.amountNeeded, 7); eq(z.amountAvailable, 2); eq(z.amountToBuy, 5);
    eq(z.recipeSources.length, 2, 'Benötigt für 2 Rezepte');
  });
  t('09 Vorrat wird beim Zusammenführen nur einmal abgezogen', () => {
    const needs = aggregateNeeds([{ recipeId: 'A', servings: 2, recipe: recipeA }, { recipeId: 'B', servings: 2, recipe: recipeB }], catalog);
    const plan = computePlan(needs, [P('Zwiebeln', 2, 'Stück'), P('Reis', 100, 'g')], catalog);
    const sum = plan.filter((p) => p.ingredientId === 'zwiebel').reduce((a, p) => a + p.amountToBuy, 0);
    eq(sum, 5, 'nicht 1 + 2');
    eq(plan.filter((p) => p.ingredientId === 'zwiebel').length, 1, 'eine zusammengeführte Position');
    eq(plan.find((p) => p.ingredientId === 'reis').amountToBuy, 100);
  });
  t('10 Entfernen eines Rezeptes berechnet gemeinsame Zutaten neu', () => {
    const pantry = [P('Zwiebel', 2, 'Stück')];
    const both = computePlan(aggregateNeeds([{ recipeId: 'A', servings: 2, recipe: recipeA }, { recipeId: 'B', servings: 2, recipe: recipeB }], catalog), pantry, catalog);
    const list1 = mergePlanIntoList([], both).items;
    eq(list1.find((i) => i.ingredientId === 'zwiebel').amountToBuy, 5);
    const reis = list1.find((i) => i.ingredientId === 'reis');
    const list2 = list1.map((i) => (i.id === reis.id ? { ...i, checked: true, addedToPantry: true } : i));
    const onlyB = computePlan(aggregateNeeds([{ recipeId: 'B', servings: 2, recipe: recipeB }], catalog), pantry, catalog);
    const merged = mergePlanIntoList(list2, onlyB);
    const z = merged.items.find((i) => i.ingredientId === 'zwiebel');
    eq(z.amountToBuy, 2, '4 benötigt − 2 Vorrat');
    eq(z.recipeSources.length, 1);
    eq(z.id, list1.find((i) => i.ingredientId === 'zwiebel').id, 'ID bleibt stabil');
    assert(merged.items.some((i) => i.id === reis.id), 'gekaufter Reis bleibt erhalten');
    const merged2 = mergePlanIntoList(list1, onlyB);
    assert(!merged2.items.some((i) => i.ingredientId === 'reis'), 'offener Reis wird entfernt');
    eq(merged2.removed.length, 1);
  });

  t('14a Rückgängig-Analyse verhindert negative Mengen', () => {
    const item = normalizeShoppingItem({ name: 'Hähnchen', checked: true, addedToPantry: true, pantryAmountAdded: 600, pantryAmountAfter: 900, unit: 'g' });
    const u = undoAnalysis(item, { amount: 200 });
    eq(u.removable, 200, 'höchstens vorhandene Menge');
    eq(u.changed, true, 'Bestand verändert -> Warnung');
  });

  t('17a Altes Einkaufslisten-Objekt bekommt Standardwerte', () => {
    const old = normalizeShoppingItem({ id: 'x', name: 'Milch', amount: 2, unit: 'l', checked: true });
    eq(old.amountToBuy, 2); eq(old.amountPurchased, null); eq(old.addedToPantry, true, 'abgehakt ohne Info -> als übernommen werten (keine Doppelbuchung)');
    eq(old.manuallyAdded, true); eq(Array.isArray(old.recipeSources), true);
    const old2 = normalizeShoppingItem({ id: 'y', name: 'Eier', amount: 6, unit: 'Stk' });
    eq(old2.addedToPantry, false); eq(old2.unit, 'Stück'); eq(old2.checked, false);
  });

  t('20 Unbekannte Einheiten werden nicht spekulativ umgerechnet', () => {
    eq(convert(1, 'Stück', 'g'), null, 'Stück -> g ohne Stammdaten');
    eq(convert(1, 'EL', 'g'), null, 'EL -> g');
    eq(convert(1, 'TL', 'ml'), null, 'TL -> ml');
    eq(normalizeUnit('Tasse'), null);
    const r = computeToBuy(200, 'g', [{ amount: 2, unit: 'EL' }]);
    eq(r.status, 'check'); eq(r.reason, 'Menge bitte prüfen'); eq(r.toBuy, 200, 'keine Verrechnung');
    eq(computeToBuy(2, 'Tasse', []).status, 'check');
    eq(formatAmount(null, 'g'), 'Menge bitte prüfen');
    eq(parseIngredientLine('3 cups flour').unit, null);
    eq(convertWithIngredient(2, 'Stück', 'g', { gramsPerPiece: 80 }), 160, 'nur mit expliziten Stammdaten');
  });
  t('20b Formatierung zeigt niemals NaN/Infinity/undefined', () => {
    for (const v of [NaN, Infinity, undefined, null, 'abc']) {
      const s = formatAmount(v, 'g');
      assert(!/NaN|Infinity|undefined/.test(s), s);
    }
    eq(formatAmount(1250, 'ml'), '1,25 l');
    eq(formatAmount(2, 'Prise'), '2 Prisen');
    eq(parseNumber('1,5'), 1.5); eq(parseNumber('1e999'), null);
  });

  t('21 Rezept mit hinterlegtem Allergen wird ausgeschlossen', () => {
    const r = { id: 'nut', title: 'Erdnuss-Bowl', defaultServings: 1, ingredients: [ING('erdnussmus', 'Erdnussmus', 30, 'g'), ING('reis', 'Reis', 80, 'g')], spices: [], allergenDataComplete: true };
    const res = checkRecipe(r, { allergies: ['erdnuesse'] }, catalog);
    eq(res.status, 'excluded'); assert(res.reasons[0].includes('Erdnüsse'));
    const opt = { ...r, ingredients: [ING('reis', 'Reis', 80, 'g'), ING('erdnussmus', 'Erdnussmus', 15, 'g', { optional: true })] };
    eq(checkRecipe(opt, { allergies: ['erdnuesse'] }, catalog).status, 'excluded');
    const milk = { id: 'm', title: 'Milchreis', defaultServings: 1, ingredients: [ING('milch_lf', 'Laktosefreie Milch', 200, 'ml')], spices: [] };
    eq(checkRecipe(milk, { allergies: ['milch'] }, catalog).status, 'excluded');
    eq(checkRecipe(chicken4, { customAllergies: ['Paprika'] }, catalog).status, 'excluded');
  });
  t('21b Unverträglichkeit: nur hinterlegte Alternativen', () => {
    const r = { id: 'o', title: 'Oats', defaultServings: 1, ingredients: [ING('milch', 'Milch', 100, 'ml'), ING('skyr', 'Skyr', 150, 'g')], spices: [] };
    const res = checkRecipe(r, { intolerances: ['laktose'] }, catalog);
    eq(res.status, 'ok');
    eq(res.substitutions.map((s) => s.to), ['Laktosefreie Milch (1,5 % Fett)', 'Laktosefreier Skyr']);
    eq(res.effectiveRecipe.ingredients[0].ingredientId, 'milch_lf');
    const feta = { id: 'f', title: 'Salat', defaultServings: 1, ingredients: [ING('feta', 'Feta', 100, 'g')], spices: [] };
    eq(checkRecipe(feta, { intolerances: ['laktose'] }, catalog).status, 'excluded', 'Feta hat keine hinterlegte Alternative');
    eq(checkRecipe(chicken4, { diets: ['vegan'] }, catalog).status, 'excluded');
    const ham = { id: 'h', title: 'Pfanne', defaultServings: 1, ingredients: [ING('kochschinken', 'Kochschinken', 50, 'g')], spices: [] };
    eq(checkRecipe(ham, { diets: ['halal'] }, catalog).status, 'excluded');
  });
  t('22 Fehlende Allergiedaten werden nicht als „allergenfrei“ interpretiert', () => {
    const ext = { id: 'ext', title: 'Fremdes Rezept', origin: 'external', defaultServings: 2, ingredients: [{ name: 'Mystery Sauce', amount: 1, unit: null, allergenTags: [] }], spices: [] };
    const res = checkRecipe(ext, { allergies: ['sesam'] }, catalog);
    eq(res.status, 'unknown'); eq(res.allowed, false);
    eq(recipeAllergens(ext, catalog).complete, false);
    const unknownLocal = { id: 'u', title: 'Eigenes', defaultServings: 1, ingredients: [{ name: 'Unbekanntes Produkt XY', amount: 100, unit: 'g' }], spices: [] };
    eq(checkRecipe(unknownLocal, { allergies: ['soja'] }, catalog).status, 'unknown');
    eq(checkRecipe(unknownLocal, {}, catalog).status, 'ok', 'ohne Allergien kein Ausschluss');
  });

  t('N1 Mifflin-St.-Jeor und Zielbegrenzung', () => {
    eq(calcBmr({ weightKg: 80, heightCm: 180, age: 30, sex: 'male' }).value, 1780);
    eq(calcBmr({ weightKg: 80, heightCm: 180, age: 30, sex: 'female' }).value, 1614);
    const u = calcBmr({ weightKg: 80, heightCm: 180, age: 30, sex: 'unspecified' });
    eq(u.value, 1697); eq(u.rough, true);
    const tg = calcTargets({ weightKg: 80, heightCm: 180, age: 30, sex: 'male', activityLevel: 'moderate', goal: 'lose', weeklyChangeKg: 0.5 });
    eq(tg.tdee, 2759); eq(tg.deficit, 550); eq(tg.kcalTarget, 2209); eq(tg.expectedWeeklyChangeKg, -0.5);
    const capped = calcTargets({ weightKg: 60, heightCm: 165, age: 30, sex: 'female', activityLevel: 'sedentary', goal: 'lose', weeklyChangeKg: 1 });
    assert(capped.deficitCapped, 'Defizit begrenzt');
    eq(capped.deficit, Math.round(capped.tdee * 0.25));
    const minor = calcTargets({ weightKg: 70, heightCm: 170, age: 16, sex: 'male', activityLevel: 'light', goal: 'lose', weeklyChangeKg: 0.5 });
    eq(minor.deficit, 0); assert(minor.minor && minor.notes[0].includes('unter 18'));
    const manual = calcTargets({ weightKg: 80, heightCm: 180, age: 30, sex: 'male', activityLevel: 'light', goal: 'maintain', manualCalorieTarget: 2000 });
    eq(manual.manual, true); eq(manual.kcalTarget, 2000);
    eq(calcTargets({ weightKg: null, heightCm: 180, age: 30 }), null);
  });
  t('N2 Fehlende Nährwertdaten werden nicht als 0 gewertet', () => {
    const r = { defaultServings: 1, ingredients: [ING('reis', 'Reis', 100, 'g'), { name: 'Unbekannt A', amount: 100, unit: 'g' }, { name: 'Unbekannt B', amount: 1, unit: 'Tasse' }] };
    const n = computeRecipeNutrition(r, catalog);
    eq(n.perServing, null, 'zu geringe Abdeckung -> keine Werte'); eq(n.confidence, 'low');
    const full = computeRecipeNutrition({ defaultServings: 2, ingredients: [ING('reis', 'Reis', 200, 'g')] }, catalog);
    eq(full.perServing.kcal, 350); eq(full.status, 'calculated');
  });

  t('S1 Bewertung: maximal 100 Punkte, Gewürze geringer gewichtet', () => {
    const recipe = { ...chicken4, totalMinutes: 20, devices: ['herd'], nutritionPerServing: { kcal: 600, protein: 50 }, spices: [ING('salz', 'Salz', 1, 'Prise')] };
    const scaled = scaleRecipe(recipe, 2);
    const pantry = [P('Hähnchen', 400, 'g'), P('Reis', 1, 'kg'), P('Paprika', 2, 'Stück'), P('Zwiebel', 1, 'Stück'), P('Olivenöl', 500, 'ml')];
    const ev = evaluateAgainstPantry(scaled, pantry, catalog);
    eq(ev.fullyCookable, true);
    assert(ev.matchPercent < 100 && ev.matchPercent > 90, `Salz fehlt nur gering gewichtet: ${ev.matchPercent}`);
    const sc = scoreRecipe(recipe, { profile: { devices: ['herd'], maxCookingMinutes: 30 }, mealTargets: { kcal: 600, protein: 50 }, evaluation: ev, catalog });
    assert(sc.total <= 100 && sc.total >= 70, `Score ${sc.total}`);
    const ev2 = evaluateAgainstPantry(scaled, [...pantry, P('Salz', 500, 'g')], catalog);
    eq(ev2.matchPercent, 100);
  });

  t('B1 Backup: Code-Roundtrip mit Umlauten und Prüfsumme', async () => {
    const data = { profile: [{ id: 'main', nickname: 'Jörg 🍗' }], pantry: [P('Hähnchen', 300, 'g')] };
    const backup = await createBackupObject(data);
    eq(backup.format, 'vorratsfit-backup'); eq(backup.backupVersion, BACKUP_VERSION); // 0.2: Version 2 laut CLAUDE.md Abschnitt 5
    eq(backup.checksum, await sha256Hex(canonicalStringify(backup.data)));
    const code = encodeBackupCode(backup);
    assert(/^[A-Za-z0-9_-]+$/.test(code), 'Base64URL');
    eq(decodeBackupCode(code).data.profile[0].nickname, 'Jörg 🍗');
    const parsed = await parseBackupInput(code);
    eq(parsed.ok, true, parsed.errors?.join(' '));
  });
  t('18 Manipulierte Prüfsumme verhindert Import', async () => {
    const backup = await createBackupObject({ pantry: [P('Reis', 500, 'g')] });
    backup.data.pantry[0].amount = 99999;
    const parsed = await parseBackupInput(JSON.stringify(backup));
    eq(parsed.ok, false); assert(parsed.errors.join(' ').includes('Prüfsumme'));
    eq((await parseBackupInput('kein gültiger code !!!')).ok, false);
    eq((await parseBackupInput(JSON.stringify({ format: 'anderes', backupVersion: 1, data: {} }))).ok, false);
  });
  t('17 Altes Backup ohne Einkaufslistenfelder wird mit Standardwerten importiert', async () => {
    const legacyData = { shoppingList: [{ id: 's1', name: 'Zwiebeln', amount: 3, unit: 'Stk' }, { id: 's2', name: 'Milch', amount: 1, unit: 'l', checked: true }], pantry: [{ id: 'p1', name: 'Reis', amount: '500', unit: 'g' }] };
    const backup = { format: 'vorratsfit-backup', backupVersion: 1, appVersion: '0.0.9', createdAt: '2025-01-01T00:00:00.000Z', data: legacyData, checksum: await sha256Hex(canonicalStringify(legacyData)) };
    const parsed = await parseBackupInput(JSON.stringify(backup));
    eq(parsed.ok, true, parsed.errors?.join(' '));
    const s1 = parsed.data.shoppingList.find((s) => s.id === 's1');
    eq([s1.amountToBuy, s1.unit, s1.checked, s1.addedToPantry, s1.amountPurchased], [3, 'Stück', false, false, null]);
    eq(parsed.data.shoppingList.find((s) => s.id === 's2').addedToPantry, true);
    eq(parsed.data.pantry[0].amount, 500);
    const v0data = { shopping: [{ id: 'z', name: 'Eier', amount: 6, unit: 'Stück' }], pantry: [] };
    const v0 = { format: 'vorratsfit-backup', backupVersion: 0, data: v0data, checksum: await sha256Hex(canonicalStringify(v0data)) };
    const p0 = await parseBackupInput(JSON.stringify(v0));
    eq(p0.ok, true, p0.errors?.join(' ')); eq(p0.data.shoppingList[0].name, 'Eier');
    eq((await parseBackupInput(JSON.stringify({ ...backup, backupVersion: 99 }))).ok, false);
  });
  t('A1 Externe Rezepte: defensiv abgebildet, Mengen nicht geraten, Allergene unvollständig', () => {
    const meal = { idMeal: '52772', strMeal: 'Teriyaki Chicken <script>alert(1)</script>', strCategory: 'Chicken', strArea: 'Japanese', strInstructions: 'Step 1\r\nStep 2\u0000', strMealThumb: 'https://www.themealdb.com/images/x.jpg', strSource: 'javascript:alert(1)', strIngredient1: 'chicken breast', strMeasure1: '400g', strIngredient2: 'soy sauce', strMeasure2: '3/4 cup', strIngredient3: '', strMeasure3: '' };
    const r = mapMealDbMeal(meal, catalog);
    eq(r.id, 'mealdb-52772'); eq(r.origin, 'external'); eq(r.allergenDataComplete, false);
    eq(r.ingredients.length, 2);
    eq([r.ingredients[0].amount, r.ingredients[0].unit, r.ingredients[0].ingredientId], [400, 'g', 'haehnchenbrust']);
    eq([r.ingredients[1].amount, r.ingredients[1].unit], [null, null], '3/4 cup nicht umrechnen');
    eq(r.sourceUrl, 'https://www.themealdb.com/meal/52772', 'javascript:-URL verworfen');
    assert(!/\u0000/.test(r.instructions.join('')), 'Steuerzeichen entfernt');
    eq(r.totalMinutes, null, 'unbekannte Zeit nicht als 0');
    eq(checkRecipe(r, { allergies: ['soja'] }, catalog).status, 'excluded', 'Soja über Stammdaten erkannt');
    eq(checkRecipe(r, { allergies: ['sesam'] }, catalog).status, 'unknown', 'sonst nie als sicher');
    eq(mapMealDbMeal({ idMeal: '../x' }, catalog), null, 'ungültige ID abgelehnt');
    eq(parseMeasure('1 kg').unit, 'kg'); eq(parseMeasure('pinch').amount, null);
  });
  t('C1 Eigene Rezepte: Zutatenzeilen, Nährwerte, Allergene', () => {
    const res = buildCustomRecipe({ title: 'Mein Bowl', servings: '2', totalMinutes: '15', mealType: 'mittagessen', ingredients: '200 g Reis\n2 Eier\n1 TL Salz\n1 Handvoll Zauberkraut', instructions: 'Kochen\nEssen' }, catalog);
    eq(res.ok, true);
    const r = res.recipe;
    eq(r.ingredients.map((i) => i.ingredientId), ['reis', 'eier', null]);
    eq(r.spices.map((i) => i.ingredientId), ['salz']);
    eq(r.ingredients[2].amount === null || r.ingredients[2].unit === null, true, 'unbekanntes Maß -> Menge bitte prüfen');
    eq(r.allergenDataComplete, false, 'unbekannte Zutat -> unvollständig');
    assert(r.allergens.includes('eier'));
    eq(buildCustomRecipe({ title: '', servings: '0', totalMinutes: 'x', ingredients: '' }, catalog).ok, false);
  });
  t('U1 UUID-Ersatz liefert gültige v4-IDs', () => {
    assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuid()));
  });
  return T;
}

export async function runTests(tests, log = () => {}) {
  const results = [];
  for (const test of tests) {
    try {
      await test.fn();
      results.push({ name: test.name, ok: true });
      log(`✔ ${test.name}`);
    } catch (err) {
      results.push({ name: test.name, ok: false, error: err.message });
      log(`✘ ${test.name}\n    ${err.message}`);
    }
  }
  return results;
}
