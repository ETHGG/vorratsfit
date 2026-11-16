// core/plan-logic.js – reine Logik des Wochenplaners (Datum, Validierung, Status). Ohne DOM und Datenbank.
import { addDays, weekdayIndex, isValidDateString, parseNumber } from './utils.js';
import { MEAL_TYPES, MAX_PLAN_SERVINGS } from './models.js';
import { checkRecipe } from './restrictions.js';
import { WEEKDAY_SHORT } from './demand.js';

/** Montag der Woche, in der das Datum liegt (kalendarisch, robust gegen Zeitumstellung). */
export function weekStart(date) {
  const wd = weekdayIndex(date);
  return wd === null ? null : addDays(date, -wd);
}

/** Die sieben Tage Mo–So ab einem Montag. */
export function weekDays(monday) {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** „Mo, 23.03.“ */
export function formatDayLabel(date) {
  if (!isValidDateString(date)) return '';
  const [, m, d] = date.split('-');
  return `${WEEKDAY_SHORT[weekdayIndex(date)]}, ${d}.${m}.`;
}

/** „23.03.–29.03.2026“ */
export function formatWeekRange(monday) {
  const end = addDays(monday, 6);
  const [, m1, d1] = monday.split('-');
  const [y2, m2, d2] = end.split('-');
  return `${d1}.${m1}.–${d2}.${m2}.${y2}`;
}

/** Validiert Eingaben für einen Plan-Eintrag. Portionen: ganze Zahl 1–50. */
export function validatePlanInput(input) {
  const errors = {};
  if (!isValidDateString(input.date)) errors.date = 'Bitte wähle ein gültiges Datum.';
  if (!MEAL_TYPES.some((m) => m.id === input.mealType)) errors.mealType = 'Bitte wähle eine Mahlzeit.';
  if (!input.recipeId || typeof input.recipeId !== 'string') errors.recipeId = 'Bitte wähle ein Rezept.';
  const n = parseNumber(typeof input.servings === 'number' ? input.servings : String(input.servings ?? ''));
  if (n === null || !Number.isInteger(n) || n < 1 || n > MAX_PLAN_SERVINGS) errors.servings = `Portionen: ganze Zahl von 1 bis ${MAX_PLAN_SERVINGS}.`;
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, errors: {}, values: { date: input.date, mealType: input.mealType, recipeId: input.recipeId, servings: n } };
}

const UNKNOWN_WARNING = 'Die Allergen- oder Zutatendaten dieses Rezepts sind unvollständig. Bitte prüfe die Zutaten selbst.';

/** Darf ein Rezept eingeplant werden? Ausgeschlossen = nein; unvollständige Daten = ja, mit Warnung. */
export function canPlanRecipe(recipe, profile, catalog) {
  if (!recipe) return { allowed: false, reason: 'Rezept nicht verfügbar', warning: null };
  const check = checkRecipe(recipe, profile, catalog);
  if (check.status === 'excluded') return { allowed: false, reason: check.reasons.join(' · '), warning: null };
  return { allowed: true, reason: null, warning: check.status === 'unknown' ? UNKNOWN_WARNING : null };
}

/** Status eines Plan-Eintrags für die Anzeige: ok | unknown | excluded | unavailable. */
export function planEntryStatus(entry, recipesById, profile, catalog) {
  const recipe = recipesById.get(entry.recipeId);
  if (!recipe) return { status: 'unavailable', message: 'Rezept nicht mehr verfügbar.' };
  const check = checkRecipe(recipe, profile, catalog);
  if (check.status === 'excluded') return { status: 'excluded', message: `Passt nicht mehr zu deinem Profil: ${check.reasons.join(' · ')}. Wird nicht eingekauft.` };
  if (check.status === 'unknown') return { status: 'unknown', message: UNKNOWN_WARNING };
  return { status: 'ok', message: null };
}

// ---------- Meal Prep (CLAUDE.md 4.3) ----------
export const MIN_BOXES = 2;
export const MAX_BOXES = 14;
export const SHELF_LIFE_DAYS = 3;

export function validateMealPrepInput(input) {
  const errors = {};
  if (!isValidDateString(input.startDate)) errors.startDate = 'Bitte wähle einen gültigen Starttag.';
  if (!MEAL_TYPES.some((m) => m.id === input.mealType)) errors.mealType = 'Bitte wähle eine Mahlzeit.';
  if (!input.recipeId) errors.recipeId = 'Bitte wähle ein Rezept.';
  const n = parseNumber(typeof input.boxes === 'number' ? input.boxes : String(input.boxes ?? ''));
  if (n === null || !Number.isInteger(n) || n < MIN_BOXES || n > MAX_BOXES) errors.boxes = `Boxen: ganze Zahl von ${MIN_BOXES} bis ${MAX_BOXES}.`;
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, errors: {}, values: { startDate: input.startDate, mealType: input.mealType, recipeId: input.recipeId, boxes: n } };
}

/** n Plan-Einträge (je 1 Portion) an aufeinanderfolgenden Tagen mit gemeinsamer Gruppen-ID. */
export function buildMealPrepEntries({ recipe, boxes, startDate, mealType, groupId }) {
  return Array.from({ length: boxes }, (_, i) => ({
    date: addDays(startDate, i), mealType, recipeId: recipe.id, recipeTitle: recipe.title, servings: 1,
    mealPrepGroupId: groupId, mealPrepIndex: i + 1, mealPrepCount: boxes,
  }));
}

/** Kochtag einer Gruppe: tatsächlicher Kochtag oder früheste Box. */
export function mealPrepCookDay(groupBoxes) {
  const cooked = groupBoxes.find((b) => b.cooked && b.cookedAt);
  if (cooked) {
    const d = new Date(cooked.cookedAt);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return groupBoxes.map((b) => b.date).filter(Boolean).sort()[0] ?? null;
}

/** Haltbarkeitshinweis: mehr als 3 Tage nach dem Kochtag. Genau 3 Tage: kein Hinweis. */
export function mealPrepShelfWarning(box, groupBoxes) {
  const cookDay = mealPrepCookDay(groupBoxes);
  if (!cookDay || !box.date) return null;
  const days = Math.round((Date.parse(`${box.date}T00:00:00Z`) - Date.parse(`${cookDay}T00:00:00Z`)) / 86400000);
  return days > SHELF_LIFE_DAYS ? `Diese Box ist ${days} Tage nach dem Kochtag geplant. Vorgekochtes hält im Kühlschrank meist nur etwa ${SHELF_LIFE_DAYS} Tage – bitte einfrieren oder früher essen.` : null;
}
