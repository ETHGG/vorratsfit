// Führt die reinen Logiktests in Node aus: node tests/run-node.mjs
import { readFileSync } from 'node:fs';
import { buildTests, runTests } from './test-cases.js';
import { buildTestsV02 } from './test-cases-v02.js';
import { buildTestsV03 } from './test-cases-v03.js';
import { buildTestsV06, buildTestsV07 } from './test-cases-v06.js';

const ingredients = JSON.parse(readFileSync(new URL('../data/ingredients.json', import.meta.url), 'utf8'));
const tests = [...buildTests(ingredients), ...buildTestsV02(ingredients), ...buildTestsV03(ingredients), ...buildTestsV06(), ...buildTestsV07()];
// T0-01: absichtlich fehlschlagender Test, nur wenn ausdrücklich angefordert (prüft, dass die Suite weiterläuft)
if (process.env.VF_INJECT_FAILURE === '1') tests.splice(1, 0, { name: 'T0-INJECT absichtlicher Fehlschlag', fn: () => { throw new Error('absichtlich'); } });
const results = await runTests(tests, (line) => console.log(line));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} Tests bestanden`);
process.exit(failed.length ? 1 : 0);
