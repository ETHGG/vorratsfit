// Führt die reinen Logiktests in Node aus: node tests/run-node.mjs
import { readFileSync } from 'node:fs';
import { buildTests, runTests } from './test-cases.js';

const ingredients = JSON.parse(readFileSync(new URL('../data/ingredients.json', import.meta.url), 'utf8'));
const results = await runTests(buildTests(ingredients), (line) => console.log(line));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} Tests bestanden`);
process.exit(failed.length ? 1 : 0);
