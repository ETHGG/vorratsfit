// views/weightView.js – Gewicht eintragen, Verlauf als Diagramm, Wochenauswertung, Erinnerung.
import { h, clear, icon, field, toast, withBusy, showFieldErrors, confirmDialog, chip, svg, emptyState } from './dom.js';
import { pageHeader, section } from './components.js';
import { planTabs } from './components.js';
import { state, refreshProfile } from './state.js';
import { routeHref } from './router.js';
import { listWeights, saveWeight, deleteWeight } from '../weight.js';
import { listFoodLogRange } from '../foodlog.js';
import { getTargets } from '../profile.js';
import { chartModel, weeklyStats, weightReminder, formatChange, CHART_RANGES } from '../core/body.js';
import { sumNutrition } from '../core/day-balance.js';
import { formatNumber } from '../units.js';
import { todayString, addDays } from '../core/utils.js';

const WEEKS = 6;

/** SVG-Diagramm aus dem reinen Diagrammmodell. Text-Alternative über aria-label und die Wochentabelle. */
export function weightChart(model) {
  const { width, height, pad } = model;
  const s = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart', role: 'img', 'aria-label': model.summary, preserveAspectRatio: 'none' });
  for (const tk of model.yTicks) {
    s.append(svg('line', { x1: pad.l, x2: width - pad.r, y1: tk.y, y2: tk.y, class: 'chart-grid' }));
    s.append(svg('text', { x: pad.l - 6, y: tk.y + 4, 'text-anchor': 'end', class: 'chart-label' }, tk.label));
  }
  for (const xl of model.xLabels) s.append(svg('text', { x: xl.x, y: height - 6, 'text-anchor': xl.anchor, class: 'chart-label' }, xl.label));
  if (model.targetY !== null) {
    s.append(svg('line', { x1: pad.l, x2: width - pad.r, y1: model.targetY, y2: model.targetY, class: 'chart-target' }));
    s.append(svg('text', { x: width - pad.r, y: model.targetY - 4, 'text-anchor': 'end', class: 'chart-label' }, 'Wunschgewicht'));
  }
  if (model.avgPath) s.append(svg('path', { d: model.avgPath, class: 'chart-avg' }));
  for (const p of model.points) s.append(svg('circle', { cx: p.x, cy: p.y, r: 3.5, class: 'chart-point' }, svg('title', {}, `${p.date.split('-').reverse().join('.')}: ${formatNumber(p.weightKg, 1)} kg`)));
  return s;
}

export async function render(container) {
  let rangeId = '4w';
  let weights = [];
  const today = todayString();
  const reminderBox = h('div', { 'aria-live': 'polite' });
  const chartBox = h('div', { class: 'chart-box' });
  const weeksBox = h('div', {});
  const listBox = h('div', {});
  const chipsBox = h('div', { class: 'chips', role: 'group', 'aria-label': 'Zeitraum' });

  async function reload() {
    weights = await listWeights();
    drawReminder();
    drawChart();
    await drawWeeks();
    drawList();
  }

  function drawReminder() {
    clear(reminderBox);
    const r = weightReminder(weights, today);
    if (r.due) reminderBox.append(h('p', { class: 'notice notice-info' }, icon('scale', { size: 16 }), h('span', {}, r.text)));
  }

  function drawChart() {
    clear(chipsBox);
    for (const r of CHART_RANGES) chipsBox.append(chip(r.label, r.id === rangeId, () => { rangeId = r.id; drawChart(); }));
    clear(chartBox);
    const model = chartModel(weights, { rangeId, today, targetWeightKg: state.profile?.targetWeightKg ?? null });
    if (!model) { chartBox.append(emptyState('Noch kein Verlauf', 'Sobald du dein Gewicht einträgst, erscheint hier der Verlauf.', null, 'gewicht')); return; }
    chartBox.append(weightChart(model),
      h('p', { class: 'small muted chart-legend' }, h('span', { class: 'legend-point', 'aria-hidden': 'true' }), ' Messwert  ', h('span', { class: 'legend-avg', 'aria-hidden': 'true' }), ' 7-Tage-Durchschnitt', model.targetY !== null ? '  · gestrichelt: Wunschgewicht' : ''));
  }

  async function drawWeeks() {
    clear(weeksBox);
    const from = addDays(today, -7 * WEEKS - 7);
    const logs = await listFoodLogRange(from, today);
    const byDay = {};
    for (const l of logs) (byDay[l.date] ??= []).push(l);
    const days = Object.fromEntries(Object.entries(byDay).map(([d, list]) => [d, sumNutrition(list)]));
    const targets = getTargets(state.profile);
    const stats = weeklyStats({ weights, days, kcalTarget: targets?.kcalTarget ?? null, weeks: WEEKS, today });
    const fmt = (v, unit, d = 0) => (typeof v === 'number' ? `${formatNumber(v, d)}${unit}` : '–');
    const dmy = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}.`;
    weeksBox.append(h('div', { class: 'table-wrap' }, h('table', { class: 'nutri weeks' },
      h('caption', { class: 'sr-only' }, 'Wochenauswertung'),
      h('thead', {}, h('tr', {}, ...['Woche', 'Ø Gewicht', 'Veränderung', 'Ø kcal', 'Ø Protein', 'Tage im Ziel'].map((c) => h('th', { scope: 'col' }, c)))),
      h('tbody', {}, ...stats.map((w) => h('tr', {},
        h('th', { scope: 'row' }, `${dmy(w.start)}–${dmy(w.end)}`),
        h('td', {}, fmt(w.avgWeight, ' kg', 1)),
        h('td', {}, formatChange(w.change)),
        h('td', {}, fmt(w.kcalAvg, '')),
        h('td', {}, fmt(w.proteinAvg, ' g')),
        h('td', {}, w.daysInTarget === null || w.daysLogged === 0 ? '–' : `${w.daysInTarget} von ${w.daysLogged}`)))))),
    h('p', { class: 'small muted' }, 'Ø kcal und Ø Protein: nur Tage mit vollständigen Tagebucheinträgen. „Im Ziel“: höchstens 10 % über oder unter deinem Tagesziel. Rückblick auf deine Einträge – keine Prognose.'));
  }

  function drawList() {
    clear(listBox);
    if (!weights.length) return;
    listBox.append(h('ul', { class: 'plain-list' }, ...[...weights].reverse().slice(0, 30).map((w) => {
      const del = h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': `Eintrag vom ${w.date.split('-').reverse().join('.')} löschen` }, icon('trash'));
      del.addEventListener('click', () => withBusy(del, async () => {
        if (!(await confirmDialog('Eintrag löschen?', `${formatNumber(w.weightKg, 1)} kg vom ${w.date.split('-').reverse().join('.')} wird gelöscht.`, { confirmLabel: 'Löschen', danger: true }))) return;
        await deleteWeight(w.id);
        await refreshProfile();
        toast('Eintrag gelöscht.');
        await reload();
      }));
      return h('li', { class: 'log-item weight-item' }, h('span', { class: 'plan-main' }, h('strong', {}, `${formatNumber(w.weightKg, 1)} kg`), h('span', { class: 'small muted' }, ` · ${w.date.split('-').reverse().join('.')}`)), del);
    })));
  }

  const dateIn = h('input', { type: 'date', name: 'date', value: today, max: today });
  const weightIn = h('input', { type: 'number', name: 'weightKg', min: '30', max: '350', step: '0.1', inputmode: 'decimal', placeholder: state.profile?.weightKg ? String(state.profile.weightKg).replace('.', ',') : '' });
  const saveBtn = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Speichern');
  const form = h('form', { class: 'form grid-form', novalidate: true },
    h('div', { class: 'row-2' }, field({ label: 'Gewicht (kg)', input: weightIn }), field({ label: 'Datum', input: dateIn })),
    h('p', { class: 'hint' }, 'Am besten morgens nüchtern und immer unter gleichen Bedingungen. Ein Eintrag pro Tag – ein zweiter Eintrag am selben Tag ersetzt den ersten.'),
    h('div', { class: 'form-actions' }, saveBtn));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    withBusy(saveBtn, async () => {
      const res = await saveWeight({ date: dateIn.value, weightKg: weightIn.value });
      if (!res.ok) { showFieldErrors(form, res.errors); return; }
      showFieldErrors(form, {});
      await refreshProfile();
      weightIn.value = '';
      toast(res.replaced ? 'Eintrag aktualisiert.' : `${formatNumber(res.entry.weightKg, 1)} kg gespeichert.`, 'success');
      await reload();
    });
  });

  container.append(
    pageHeader('Gewicht', 'Dein Verlauf – der neueste Eintrag passt dein Tagesziel automatisch an.'),
    planTabs('gewicht'),
    reminderBox,
    section('Gewicht eintragen', form),
    section('Verlauf', chipsBox, chartBox),
    section('Wochenauswertung', weeksBox),
    section('Einträge', listBox, h('p', { class: 'small' }, h('a', { href: routeHref('tagesziel') }, 'Zum Tagesziel'))),
  );
  await reload();
}
