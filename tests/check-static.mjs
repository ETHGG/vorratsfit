// Statische Projektprüfung: node tests/check-static.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const problems = [];
const ok = [];
const read = (p) => readFileSync(join(root, p), 'utf8');

function walk(dir, out = []) {
  for (const name of readdirSync(join(root, dir))) {
    if (['.git', 'node_modules', 'tests', 'tools'].includes(name)) continue;
    const rel = dir ? `${dir}/${name}` : name;
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out); else out.push(rel);
  }
  return out;
}

const files = walk('');
const appJs = files.filter((f) => f.endsWith('.js'));

// 1. Verbotene Muster im App-Code
const forbidden = [
  [/\beval\s*\(/, 'eval()'],
  [/new\s+Function\s*\(/, 'Function()'],
  [/\.innerHTML\s*=/, 'innerHTML-Zuweisung'],
  [/insertAdjacentHTML/, 'insertAdjacentHTML'],
  [/document\.write/, 'document.write'],
  [/indexedDB\.deleteDatabase/, 'indexedDB.deleteDatabase'],
  [/localStorage\.clear/, 'localStorage.clear'],
];
for (const f of appJs) {
  const src = read(f).replace(/\/\/.*$/gm, '');
  for (const [re, label] of forbidden) if (re.test(src)) problems.push(`${f}: verbotenes Muster ${label}`);
}
ok.push(`${appJs.length} JS-Dateien auf verbotene Muster geprüft`);

// 2. Service Worker cached alle Programmdateien
const sw = read('service-worker.js');
const shell = Array.from(sw.matchAll(/'\.\/([^']*)'/g)).map((m) => m[1]);
const mustCache = files.filter((f) => /\.(js|css|html|json|webmanifest|png|svg)$/.test(f) && f !== 'service-worker.js' && f !== 'package.json' && !f.startsWith('README'));
for (const f of mustCache) if (!shell.includes(f)) problems.push(`service-worker.js: ${f} fehlt im App-Shell-Cache`);
for (const f of shell) if (f && !files.includes(f)) problems.push(`service-worker.js: ${f} existiert nicht`);
if (/indexedDB|localStorage/.test(sw.replace(/\/\/.*$/gm, ''))) problems.push('service-worker.js greift auf IndexedDB/localStorage zu');
ok.push(`Service Worker: ${shell.length} Einträge geprüft`);

// 3. Nur relative Pfade (GitHub-Pages-Unterpfad)
const html = read('index.html');
for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
  const v = m[1];
  if (v.startsWith('/') && !v.startsWith('//')) problems.push(`index.html: absoluter Pfad ${v}`);
}
for (const f of appJs) {
  const src = read(f);
  for (const m of src.matchAll(/(?:fetch|register|import)\(\s*['"`](\/[^'"`]*)/g)) problems.push(`${f}: absoluter Pfad ${m[1]}`);
}
const manifest = JSON.parse(read('manifest.webmanifest'));
for (const k of ['start_url', 'scope']) if (manifest[k].startsWith('/')) problems.push(`manifest: ${k} absolut`);
if (!manifest.icons.some((i) => i.sizes === '512x512') || !manifest.icons.some((i) => i.sizes === '192x192')) problems.push('manifest: Icons 192/512 fehlen');
if (manifest.display !== 'standalone') problems.push('manifest: display != standalone');
for (const f of ['.nojekyll', 'LICENSE', 'README.md']) { try { read(f); } catch { problems.push(`${f} fehlt`); } }
ok.push('Relative Pfade, Manifest und Pflichtdateien geprüft');

// 4. Rezeptdaten
const { recipes } = JSON.parse(read('data/recipes.json'));
const ingredients = JSON.parse(read('data/ingredients.json'));
const ingIds = new Set(ingredients.map((i) => i.id));
const required = ['id', 'title', 'description', 'mealType', 'defaultServings', 'ingredients', 'spices', 'instructions', 'preparationMinutes', 'cookingMinutes', 'totalMinutes', 'difficulty', 'devices', 'dietaryTags', 'allergens', 'estimatedCostLevel', 'nutritionPerServing', 'nutritionStatus', 'nutritionConfidence', 'source', 'license'];
const ingRequired = ['ingredientId', 'name', 'normalizedName', 'amount', 'unit', 'category', 'optional', 'substitutes', 'allergenTags'];
if (recipes.length < 30) problems.push(`nur ${recipes.length} Rezepte`);
for (const r of recipes) {
  for (const k of required) if (!(k in r)) problems.push(`Rezept ${r.id}: Feld ${k} fehlt`);
  for (const i of [...r.ingredients, ...r.spices]) {
    for (const k of ingRequired) if (!(k in i)) problems.push(`Rezept ${r.id}: Zutatfeld ${k} fehlt`);
    if (!ingIds.has(i.ingredientId)) problems.push(`Rezept ${r.id}: unbekannte Zutat ${i.ingredientId}`);
  }
  if (r.totalMinutes !== r.preparationMinutes + r.cookingMinutes) problems.push(`Rezept ${r.id}: Zeiten inkonsistent`);
}
ok.push(`${recipes.length} Rezepte und ${ingredients.length} Zutaten geprüft`);

ok.forEach((l) => console.log(`✔ ${l}`));
problems.forEach((l) => console.log(`✘ ${l}`));
console.log(problems.length ? `\n${problems.length} Probleme gefunden` : '\nStatische Prüfung bestanden');
process.exit(problems.length ? 1 : 0);
