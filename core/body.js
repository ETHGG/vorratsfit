// core/body.js – Geburtsdatum, Gewichtsverlauf, Wochenauswertung und Diagrammmodell (rein, ohne DOM und Datenbank).
// Alles sind Rückblicke auf erfasste Werte – keine Prognosen, keine Diagnosen.
import { ageFromBirthDate, isValidDateString, todayString, addDays, daysUntil, parseNumber, roundTo } from './utils.js';
import { formatNumber } from '../units.js';

export const MIN_AGE = 10;
export const MAX_AGE = 110;
export const WEIGHT_MIN = 30;
export const WEIGHT_MAX = 350;
export const REMINDER_DAYS = 7;
export const TARGET_TOLERANCE = 0.1; // ±10 % des Kalorienziels gelten als „im Ziel“

/** Prüft ein Geburtsdatum. Gibt eine Fehlermeldung oder null zurück. */
export function validateBirthDate(value, today = todayString()) {
  if (!value) return 'Bitte gib dein Geburtsdatum an.';
  if (!isValidDateString(value)) return 'Bitte gib ein gültiges Datum ein.';
  if (value > today) return 'Das Geburtsdatum darf nicht in der Zukunft liegen.';
  const age = ageFromBirthDate(value, today);
  if (age < MIN_AGE || age > MAX_AGE) return `Das Alter muss zwischen ${MIN_AGE} und ${MAX_AGE} Jahren liegen.`;
  return null;
}

/** Validiert einen Gewichtseintrag. */
export function validateWeightInput({ date, weightKg }, today = todayString()) {
  const errors = {};
  if (!isValidDateString(date)) errors.date = 'Bitte wähle ein gültiges Datum.';
  else if (date > today) errors.date = 'Das Datum darf nicht in der Zukunft liegen.';
  const w = parseNumber(typeof weightKg === 'number' ? weightKg : String(weightKg ?? ''));
  if (w === null) errors.weightKg = 'Bitte gib dein Gewicht als Zahl ein.';
  else if (w < WEIGHT_MIN || w > WEIGHT_MAX) errors.weightKg = `Das Gewicht muss zwischen ${WEIGHT_MIN} und ${WEIGHT_MAX} kg liegen.`;
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, errors: {}, values: { date, weightKg: roundTo(w, 1) } };
}

const byDate = (a, b) => a.date.localeCompare(b.date);

/** Erinnerung, wenn noch nie oder seit mindestens 7 Tagen kein Gewicht eingetragen wurde. */
export function weightReminder(weights, today = todayString()) {
  const sorted = [...(weights ?? [])].filter((w) => isValidDateString(w.date)).sort(byDate);
  if (!sorted.length) return { due: true, days: null, text: 'Du hast noch kein Gewicht eingetragen. Ein Eintrag pro Woche reicht für eine aussagekräftige Auswertung.' };
  const last = sorted[sorted.length - 1];
  const days = -daysUntil(last.date, today);
  if (days >= REMINDER_DAYS) return { due: true, days, text: `Dein letzter Gewichtseintrag ist ${days} Tage her. Trag dein aktuelles Gewicht ein, damit Auswertung und Tagesziel aktuell bleiben.` };
  return { due: false, days, text: null };
}

/** Gleitender Durchschnitt: Mittel aller Einträge der letzten 7 Kalendertage bis einschließlich zum jeweiligen Tag. */
export function movingAverage(weights, windowDays = 7) {
  const sorted = [...weights].sort(byDate);
  return sorted.map((w) => {
    const from = addDays(w.date, -(windowDays - 1));
    const win = sorted.filter((x) => x.date >= from && x.date <= w.date);
    return { date: w.date, value: roundTo(win.reduce((s, x) => s + x.weightKg, 0) / win.length, 2) };
  });
}

function mondayOf(date) {
  const [y, m, d] = date.split('-').map(Number);
  const wd = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return addDays(date, -wd);
}

/**
 * Wochenauswertung (Mo–So), neueste Woche zuerst.
 * @param {object} o
 * @param {Array} o.weights   Gewichtseinträge
 * @param {Object<string,{kcal:number, protein:number, complete:boolean}>} o.days  Tagessummen aus dem Tagebuch
 * @param {number|null} o.kcalTarget
 */
export function weeklyStats({ weights = [], days = {}, kcalTarget = null, weeks = 4, today = todayString() }) {
  const out = [];
  const currentMonday = mondayOf(today);
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const start = addDays(currentMonday, -7 * i);
    const end = addDays(start, 6);
    const ws = weights.filter((w) => w.date >= start && w.date <= end);
    const dayEntries = Object.entries(days).filter(([d, s]) => d >= start && d <= end && s && s.count > 0);
    const kcalDays = dayEntries.filter(([, s]) => s.complete);
    const avg = (list, key) => (list.length ? roundTo(list.reduce((sum, [, s]) => sum + s[key], 0) / list.length, 0) : null);
    out.push({
      start, end,
      avgWeight: ws.length ? roundTo(ws.reduce((s, w) => s + w.weightKg, 0) / ws.length, 1) : null,
      weighIns: ws.length,
      daysLogged: dayEntries.length,
      kcalAvg: avg(kcalDays, 'kcal'),
      proteinAvg: avg(kcalDays, 'protein'),
      daysInTarget: typeof kcalTarget === 'number' ? kcalDays.filter(([, s]) => Math.abs(s.kcal - kcalTarget) <= kcalTarget * TARGET_TOLERANCE).length : null,
    });
  }
  for (let i = 0; i < out.length; i += 1) {
    const prev = out[i - 1];
    out[i].change = prev && prev.avgWeight !== null && out[i].avgWeight !== null ? roundTo(out[i].avgWeight - prev.avgWeight, 1) : null;
  }
  return out.reverse();
}

/** Text für eine Veränderung, z. B. „−0,4 kg“; ohne Vergleichswert „–“. */
export function formatChange(change) {
  if (typeof change !== 'number') return '–';
  if (change === 0) return '±0 kg';
  return `${change > 0 ? '+' : '−'}${formatNumber(Math.abs(change), 1)} kg`;
}

export const CHART_RANGES = Object.freeze([
  { id: '4w', label: '4 Wochen', days: 28 },
  { id: '3m', label: '3 Monate', days: 91 },
  { id: 'all', label: 'Alles', days: null },
]);

/**
 * Diagrammmodell für ein SVG (viewBox 0 0 W H). Liefert nur endliche Koordinaten.
 * null, wenn im Zeitraum keine Einträge liegen.
 */
export function chartModel(weights, { rangeId = '4w', today = todayString(), targetWeightKg = null, width = 320, height = 180 } = {}) {
  const range = CHART_RANGES.find((r) => r.id === rangeId) ?? CHART_RANGES[0];
  const all = [...weights].filter((w) => isValidDateString(w.date) && Number.isFinite(w.weightKg)).sort(byDate);
  const from = range.days ? addDays(today, -(range.days - 1)) : all[0]?.date;
  const list = all.filter((w) => w.date >= from && w.date <= today);
  if (!list.length) return null;
  const pad = { l: 38, r: 10, t: 10, b: 24 };
  const firstDay = range.days ? from : list[0].date;
  const spanDays = Math.max(1, daysUntil(today, firstDay));
  const values = list.map((w) => w.weightKg);
  const target = typeof targetWeightKg === 'number' && Number.isFinite(targetWeightKg) ? targetWeightKg : null;
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (target !== null && target >= min - 5 && target <= max + 5) { min = Math.min(min, target); max = Math.max(max, target); }
  min = Math.floor(min - 1);
  max = Math.ceil(max + 1);
  const x = (date) => roundTo(pad.l + (Math.max(0, daysUntil(date, firstDay)) / spanDays) * (width - pad.l - pad.r), 1);
  const y = (v) => roundTo(pad.t + ((max - v) / (max - min)) * (height - pad.t - pad.b), 1);
  const points = list.map((w) => ({ x: x(w.date), y: y(w.weightKg), date: w.date, weightKg: w.weightKg }));
  const avg = movingAverage(all).filter((a) => a.date >= firstDay && a.date <= today).map((a) => ({ x: x(a.date), y: y(a.value) }));
  const mid = roundTo((min + max) / 2, 1);
  const fmtDate = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}.`;
  return {
    width, height, pad, min, max,
    points,
    avgPath: avg.length > 1 ? avg.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ') : null,
    yTicks: [max, mid, min].map((v) => ({ y: y(v), label: formatNumber(v, 1) })),
    xLabels: [{ x: pad.l, label: fmtDate(firstDay), anchor: 'start' }, { x: width - pad.r, label: fmtDate(today), anchor: 'end' }],
    targetY: target !== null && target >= min && target <= max ? y(target) : null,
    summary: `Gewichtsverlauf ${range.label}: ${points.length} ${points.length === 1 ? 'Eintrag' : 'Einträge'}, von ${formatNumber(list[0].weightKg, 1)} kg am ${fmtDate(list[0].date)} bis ${formatNumber(list[list.length - 1].weightKg, 1)} kg am ${fmtDate(list[list.length - 1].date)}`,
  };
}
