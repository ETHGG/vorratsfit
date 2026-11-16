// tests/run-all.mjs – führt ALLE Testarten aus und bricht bei keinem Fehler ab (CLAUDE.md, Abschnitt 8.2).
// Am Ende: Zusammenfassung je Testart und Liste aller Fehlschläge. Exit-Code 1, sobald etwas fehlschlägt
// oder ein Teil nicht ausgeführt werden konnte.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const arg = process.argv.find((a) => a.startsWith('--parts='));
const wanted = arg ? arg.slice(8).split(',') : ['node', 'static', 'browser', 'e2e', 'meta'];

function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  for (const base of ['/opt/pw-browsers', join(process.env.HOME ?? '', '.cache/ms-playwright')]) {
    if (!existsSync(base)) continue;
    for (const d of readdirSync(base).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
      for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
        const p = join(base, d, sub);
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
}

function python() {
  for (const cmd of ['python3', 'python']) {
    const r = spawnSync(cmd, ['-c', 'import playwright'], { encoding: 'utf8' });
    if (r.status === 0) return cmd;
  }
  return null;
}

function run(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60 * 1000 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  return { status: r.status, out, timedOut: r.signal === 'SIGTERM' };
}

function failuresFrom(out) {
  return out.split('\n').filter((l) => l.startsWith('✘')).map((l) => l.slice(2).trim());
}
function countFrom(out, re) {
  const m = out.match(re);
  return m ? `${m[1]}/${m[2]}` : null;
}

const parts = [];
const py = python();
const chrome = findChrome();
const chromeArgs = chrome ? ['--chrome', chrome] : [];

if (wanted.includes('node')) {
  const r = run('node', ['tests/run-node.mjs']);
  parts.push({ name: 'Logik (Node)', ok: r.status === 0, count: countFrom(r.out, /(\d+)\/(\d+) Tests bestanden/), failures: failuresFrom(r.out), out: r.out });
}
if (wanted.includes('static')) {
  const r = run('node', ['tests/check-static.mjs']);
  parts.push({ name: 'Statik', ok: r.status === 0, count: r.status === 0 ? 'bestanden' : 'Fehler', failures: failuresFrom(r.out), out: r.out });
}
for (const [key, label, script, re] of [
  ['browser', 'Browser/DB', 'tests/run-browser.py', /(\d+)\/(\d+) Browser-Tests bestanden/],
  ['e2e', 'E2E', 'tests/e2e.py', /(\d+)\/(\d+) E2E-Prüfungen bestanden/],
]) {
  if (!wanted.includes(key)) continue;
  if (!py) { parts.push({ name: label, ok: false, blocked: 'nicht ausgeführt – Blockade: Python mit Playwright nicht verfügbar (siehe CLAUDE.md 8.1)', failures: [], count: null, out: '' }); continue; }
  const r = run(py, [script, ...chromeArgs]);
  const failures = failuresFrom(r.out);
  if (r.timedOut) failures.push(`${label}: Zeitlimit überschritten`);
  if (r.status !== 0 && !failures.length) failures.push(`${label}: abgebrochen (Exit ${r.status}) – ${r.out.trim().split('\n').slice(-3).join(' | ')}`);
  parts.push({ name: label, ok: r.status === 0, count: countFrom(r.out, re), failures, out: r.out });
}
if (wanted.includes('meta') && process.env.VF_META !== '0') {
  // T0-01: Ein absichtlich fehlschlagender Test darf die übrigen Teile nicht stoppen.
  const r = run('node', ['tests/run-all.mjs', '--parts=node,static'], { VF_INJECT_FAILURE: '1', VF_META: '0' });
  const ok = r.status === 1 && r.out.includes('T0-INJECT') && r.out.includes('Statik') && /Statik:\s+bestanden/.test(r.out);
  parts.push({ name: 'Meta (T0-01)', ok, count: ok ? '1/1' : '0/1', failures: ok ? [] : ['T0-01 npm test läuft nach einem Fehlschlag nicht vollständig weiter'], out: r.out });
}

console.log('\n================ Zusammenfassung ================');
for (const p of parts) {
  console.log(`${p.ok ? '✔' : '✘'} ${p.name}: ${p.blocked ?? p.count ?? (p.ok ? 'bestanden' : 'Fehler')}`);
}
const all = parts.flatMap((p) => p.failures.map((f) => `[${p.name}] ${f}`));
const blocked = parts.filter((p) => p.blocked);
if (all.length || blocked.length) {
  console.log('\nFehlgeschlagene Tests:');
  all.forEach((f) => console.log(`  ✘ ${f}`));
  blocked.forEach((p) => console.log(`  ✘ [${p.name}] ${p.blocked}`));
}
console.log(all.length || blocked.length || parts.some((p) => !p.ok) ? '\nERGEBNIS: FEHLER – jeder Fehlschlag muss behoben werden (CLAUDE.md 8.3).' : '\nERGEBNIS: alle Tests bestanden.');
process.exit(all.length || blocked.length || parts.some((p) => !p.ok) ? 1 : 0);
