// tests/browser-runner.js – führt alle Tests im Browser aus und zeigt das Ergebnis an.
import { buildTests, runTests } from './test-cases.js';
import { buildDbTests, cleanupTestDb } from './db-tests.js';
import { buildTestsV02 } from './test-cases-v02.js';
import { buildDbTestsV02 } from './db-tests-v02.js';
import { buildTestsV03 } from './test-cases-v03.js';
import { buildDbTestsV03 } from './db-tests-v03.js';
import { buildTestsV06 } from './test-cases-v06.js';
import { buildDbTestsV06 } from './db-tests-v06.js';

const list = document.getElementById('results');
const summary = document.getElementById('summary');

async function load(path) {
  const res = await fetch(new URL(path, import.meta.url));
  return res.json();
}

(async () => {
  const [ingredients, recipes] = await Promise.all([load('../data/ingredients.json'), load('../data/recipes.json')]);
  const tests = [...buildTests(ingredients), ...buildTestsV02(ingredients), ...buildDbTests(ingredients, recipes), ...buildDbTestsV02(ingredients, recipes), ...buildTestsV03(ingredients), ...buildDbTestsV03(), ...buildTestsV06(), ...buildDbTestsV06()];
  const results = await runTests(tests);
  await cleanupTestDb();
  for (const r of results) {
    const li = document.createElement('li');
    li.textContent = `${r.ok ? '✔ bestanden' : '✘ FEHLER'} – ${r.name}${r.ok ? '' : `: ${r.error}`}`;
    li.className = r.ok ? 'ok' : 'fail';
    list.append(li);
  }
  const failed = results.filter((r) => !r.ok).length;
  summary.textContent = `${results.length - failed}/${results.length} Tests bestanden`;
  document.body.dataset.done = failed ? 'failed' : 'passed';
  window.__testResults = results;
})().catch((err) => {
  summary.textContent = `Testlauf abgebrochen: ${err.message}`;
  document.body.dataset.done = 'error';
});
