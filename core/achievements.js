// core/achievements.js – kleine Erfolge (0.6). Reine Berechnung aus vorhandenen Daten, ohne Speicherung.
// Motivierend gemeint: nie Vorwürfe, nur Fortschritt. Für Minderjährige gibt es keine Gewichtsabnahme-Erfolge.
import { addDays } from './utils.js';
import { formatNumber } from '../units.js';

/** Aufeinanderfolgende Tage mit Einträgen bis heute (oder bis gestern, wenn heute noch nichts erfasst ist). */
export function loggingStreak(daysWithLogs, today) {
  const set = new Set(daysWithLogs);
  let d = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(d)) { n += 1; d = addDays(d, -1); }
  return n;
}

/**
 * @param {object} p
 * @param {string} p.today
 * @param {Array<{date:string,kcal:number|null,portions:number}>} p.foodLog  Einträge der letzten 30 Tage
 * @param {number|null} p.kcalTarget
 * @param {Array<{date:string,weightKg:number}>} p.weights
 * @param {number} p.cookedCount  als gekocht markierte Mahlzeiten
 * @param {Array<{date:string,ml:number}>} p.water  letzte 7 Tage
 * @param {number} p.waterGoalMl
 * @param {string|null} p.goal  'lose' | 'gain' | 'maintain'
 * @param {boolean} p.minor
 */
export function computeAchievements({ today, foodLog = [], kcalTarget = null, weights = [], cookedCount = 0, water = [], waterGoalMl = 2000, goal = null, minor = false }) {
  const out = [];
  const byDay = new Map();
  for (const e of foodLog) {
    if (!e.date) continue;
    const cur = byDay.get(e.date) ?? { kcal: 0, complete: true };
    if (typeof e.kcal === 'number') cur.kcal += e.kcal * (e.portions ?? 1); else cur.complete = false;
    byDay.set(e.date, cur);
  }
  const streak = loggingStreak([...byDay.keys()], today);
  out.push({ id: 'streak', emoji: '🔥', title: streak >= 2 ? `${streak} Tage in Folge` : 'Serie starten', text: streak >= 2 ? 'Du erfasst jeden Tag, was du isst. Stark!' : 'Erfasse heute und morgen dein Essen – dann beginnt deine Serie.', achieved: streak >= 3, progress: Math.min(1, streak / 3) });

  if (kcalTarget) {
    let inTarget = 0;
    for (let i = 0; i < 7; i += 1) {
      const d = byDay.get(addDays(today, -i));
      if (d && d.complete && Math.abs(d.kcal - kcalTarget) <= kcalTarget * 0.1) inTarget += 1;
    }
    out.push({ id: 'target', emoji: '🎯', title: `${inTarget} von 7 Tagen im Ziel`, text: 'Tage der letzten Woche mit ±10 % um dein Kalorienziel.', achieved: inTarget >= 5, progress: inTarget / 5 });
  }

  const cookMilestones = [1, 5, 10, 25, 50, 100];
  const next = cookMilestones.find((m) => m > cookedCount) ?? null;
  const reached = [...cookMilestones].reverse().find((m) => m <= cookedCount) ?? 0;
  out.push({ id: 'cooked', emoji: '👩‍🍳', title: cookedCount ? `${cookedCount}× selbst gekocht` : 'Erstes Gericht kochen', text: next ? `Nächstes Ziel: ${next}× gekocht.` : 'Du bist ein echter Profi!', achieved: reached > 0, progress: next ? cookedCount / next : 1 });

  const waterDays = water.filter((w) => w.date > addDays(today, -7) && w.ml >= waterGoalMl).length;
  out.push({ id: 'water', emoji: '💧', title: `${waterDays} von 7 Tagen genug getrunken`, text: `Ziel: ${formatNumber(waterGoalMl / 1000, 1)} l pro Tag.`, achieved: waterDays >= 5, progress: waterDays / 5 });

  const sorted = [...weights].filter((w) => w.date && typeof w.weightKg === 'number').sort((a, b) => a.date.localeCompare(b.date));
  if (!minor && sorted.length >= 2 && (goal === 'lose' || goal === 'gain')) {
    const diff = sorted[sorted.length - 1].weightKg - sorted[0].weightKg;
    const good = goal === 'lose' ? -diff : diff;
    if (good > 0) out.push({ id: 'weight', emoji: '🌱', title: `${goal === 'lose' ? '−' : '+'}${formatNumber(good, 1)} kg seit Beginn`, text: 'Dein Weg in Richtung Ziel – weiter so!', achieved: good >= 1, progress: Math.min(1, good / 1) });
  }
  return out;
}
