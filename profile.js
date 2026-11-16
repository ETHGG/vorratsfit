// profile.js – Profil laden, validieren und speichern. Daten bleiben ausschließlich lokal.
import { getItem, putItem } from './db.js';
import { normalizeProfile, ACTIVITY_LEVELS, GOALS, SEXES } from './core/models.js';
import { parseNumber, nowIso, ageFromBirthDate, todayString } from './core/utils.js';
import { validateBirthDate } from './core/body.js';
import { calcTargets, perMealTargets } from './nutrition.js';

export const PROFILE_LIMITS = Object.freeze({
  age: { min: 10, max: 110, label: 'Alter', unit: 'Jahre', required: true, requiredText: 'dein Alter', integer: true },
  heightCm: { min: 100, max: 250, label: 'Körpergröße', unit: 'cm', required: true, requiredText: 'deine Körpergröße' },
  weightKg: { min: 30, max: 350, label: 'Gewicht', unit: 'kg', required: true, requiredText: 'dein Gewicht' },
  targetWeightKg: { min: 30, max: 350, label: 'Wunschgewicht', unit: 'kg', required: false },
  trainingSessionsPerWeek: { min: 0, max: 21, label: 'Trainingseinheiten pro Woche', unit: '', required: false, integer: true },
  trainingDurationMinutes: { min: 0, max: 300, label: 'Trainingsdauer', unit: 'Minuten', required: false },
  weeklyChangeKg: { min: 0, max: 1, label: 'Gewichtsveränderung pro Woche', unit: 'kg', required: false },
  mealsPerDay: { min: 1, max: 8, label: 'Mahlzeiten pro Tag', unit: '', required: true, requiredText: 'die Anzahl der Mahlzeiten', integer: true },
  maxCookingMinutes: { min: 5, max: 240, label: 'Maximale Kochzeit', unit: 'Minuten', required: true, requiredText: 'die maximale Kochzeit' },
  manualCalorieTarget: { min: 800, max: 6000, label: 'Manuelles Kalorienziel', unit: 'kcal', required: false },
});

/**
 * Validiert Formulareingaben. Gibt verständliche Fehlermeldungen je Feld zurück.
 */
export function validateProfileInput(input, today = todayString()) {
  const errors = {};
  const values = {};
  // 0.3: Geburtsdatum hat Vorrang; das Alter wird daraus berechnet. Ohne Geburtsdatum gilt das bisherige Alter (ältere Profile).
  const birth = typeof input.birthDate === 'string' ? input.birthDate.trim() : '';
  const hasAge = input.age !== undefined && input.age !== null && String(input.age).trim() !== '';
  let birthDate = null;
  if (birth || !hasAge) {
    const err = validateBirthDate(birth, today);
    if (err) errors.birthDate = err;
    else { birthDate = birth; input = { ...input, age: ageFromBirthDate(birth, today) }; }
  }
  for (const [field, lim] of Object.entries(PROFILE_LIMITS)) {
    if (field === 'age' && (errors.birthDate || birthDate)) { values.age = birthDate ? input.age : null; continue; }
    const raw = input[field];
    const empty = raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');
    if (empty) {
      if (lim.required) errors[field] = `Bitte gib ${lim.requiredText ?? lim.label} an.`;
      values[field] = null;
      continue;
    }
    const n = parseNumber(raw);
    if (n === null) { errors[field] = `${lim.label}: Bitte eine gültige Zahl eingeben.`; continue; }
    if (n < lim.min || n > lim.max) { errors[field] = `${lim.label} muss zwischen ${lim.min} und ${lim.max}${lim.unit ? ` ${lim.unit}` : ''} liegen.`; continue; }
    values[field] = lim.integer ? Math.round(n) : n;
  }
  if (!SEXES.some((s) => s.id === input.sex)) errors.sex = 'Bitte wähle eine Angabe zum Geschlecht (oder „keine Angabe“).';
  if (!ACTIVITY_LEVELS.some((a) => a.id === input.activityLevel)) errors.activityLevel = 'Bitte wähle ein Aktivitätsniveau.';
  if (!GOALS.some((g) => g.id === input.goal)) errors.goal = 'Bitte wähle ein Ziel.';
  if (input.goal === 'lose' && values.targetWeightKg !== null && values.weightKg !== null && values.targetWeightKg !== undefined && values.targetWeightKg >= values.weightKg) {
    errors.targetWeightKg = 'Beim Ziel „Gewicht reduzieren“ sollte das Wunschgewicht unter dem aktuellen Gewicht liegen.';
  }
  if (Object.keys(errors).length) return { ok: false, errors, profile: null };
  const profile = normalizeProfile({ ...input, ...values, birthDate, weeklyChangeKg: values.weeklyChangeKg ?? 0, updatedAt: nowIso() });
  return { ok: true, errors: {}, profile };
}

export async function getProfile() {
  const p = await getItem('profile', 'main');
  return p ? normalizeProfile(p) : null;
}

export async function saveProfile(input, existing = null) {
  const result = validateProfileInput(input);
  if (!result.ok) return result;
  const profile = { ...result.profile, createdAt: existing?.createdAt ?? result.profile.createdAt };
  await putItem('profile', profile);
  return { ok: true, errors: {}, profile };
}

export function getTargets(profile) {
  return profile ? calcTargets(profile) : null;
}

export function getMealTargets(profile) {
  const t = getTargets(profile);
  return t ? perMealTargets(t, profile.mealsPerDay) : null;
}
