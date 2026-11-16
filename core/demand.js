// core/demand.js – gemeinsame Bedarfsquelle (CLAUDE.md 4.1): Einzelrezepte UND noch nicht gekochte
// Plan-Einträge werden immer gemeinsam berechnet. Reine Funktion, ohne DOM und Datenbank.
import { checkRecipe } from './restrictions.js';
import { weekdayIndex, todayString } from './utils.js';

export const WEEKDAY_SHORT = Object.freeze(['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']);
const MEAL_SHORT = Object.freeze({ fruehstueck: 'Frühstück', mittagessen: 'Mittag', abendessen: 'Abend', snack: 'Snack' });

/** „Plan Mo Mittag“ */
export function planLabel(date, mealType) {
  const wd = weekdayIndex(date);
  return `Plan ${wd === null ? '?' : WEEKDAY_SHORT[wd]} ${MEAL_SHORT[mealType] ?? ''}`.trim();
}

/** Zählt ein Plan-Eintrag (noch) für den Einkauf? Gekochte, gegessene und vergangene Einträge nicht. */
export function planEntryNeedsShopping(entry, today) {
  return !!entry.date && !entry.cooked && !entry.eaten && entry.date >= today;
}

/**
 * Baut die Auswahl für aggregateNeeds aus allen Bedarfsquellen.
 * @param {object} o
 * @param {Array} o.selected      Einzelrezepte (selectedRecipes)
 * @param {Array} o.planEntries   Wochenplan-Einträge (mealPlan)
 * @param {{from?:string,to?:string}} [o.range] optionaler Zeitraum für Plan-Einträge (Kochtag zählt)
 * @returns {{selections:Array, skipped:Array}}
 */
export function buildDemand({ selected = [], planEntries = [], recipesById, profile, catalog, today = todayString(), range = null }) {
  const selections = [];
  const skipped = [];
  const effective = (recipeId) => {
    const recipe = recipesById.get(recipeId);
    if (!recipe) return { error: 'Rezept nicht mehr verfügbar' };
    const check = checkRecipe(recipe, profile, catalog);
    if (check.status === 'excluded') return { error: check.reasons[0] };
    return { recipe, effective: check.effectiveRecipe };
  };

  for (const s of selected) {
    const r = effective(s.recipeId);
    if (r.error) { skipped.push({ ...s, sourceType: 'single', sourceId: s.recipeId, reason: r.error }); continue; }
    selections.push({ recipeId: s.recipeId, title: r.recipe.title, servings: s.servings, recipe: r.effective, sourceType: 'single', sourceId: s.recipeId, label: 'Einzelrezept' });
  }

  // Meal-Prep-Gruppen zählen als EIN Kochvorgang; Kochtag = frühestes Datum der Gruppe.
  const groups = new Map();
  const singles = [];
  for (const e of planEntries) {
    if (e.mealPrepGroupId) {
      if (!groups.has(e.mealPrepGroupId)) groups.set(e.mealPrepGroupId, []);
      groups.get(e.mealPrepGroupId).push(e);
    } else singles.push(e);
  }
  const inRange = (date) => (!range?.from || date >= range.from) && (!range?.to || date <= range.to);
  const candidates = [];
  for (const e of singles) {
    if (!planEntryNeedsShopping(e, today) || !inRange(e.date)) continue;
    candidates.push({ date: e.date, mealType: e.mealType, recipeId: e.recipeId, servings: e.servings, sourceType: 'plan', sourceId: e.id, label: planLabel(e.date, e.mealType) });
  }
  for (const [groupId, boxes] of groups) {
    if (boxes.some((b) => b.cooked)) continue; // Gruppe gilt als gekocht, sobald gekocht wurde
    const sorted = [...boxes].filter((b) => b.date).sort((a, b) => a.date.localeCompare(b.date));
    if (!sorted.length) continue;
    const cookDay = sorted[0].date;
    if (cookDay < today || !inRange(cookDay)) continue;
    const servings = sorted.reduce((sum, b) => sum + (b.servings || 1), 0);
    candidates.push({ date: cookDay, mealType: sorted[0].mealType, recipeId: sorted[0].recipeId, servings, sourceType: 'mealprep', sourceId: groupId, label: `Meal Prep ${planLabel(cookDay, sorted[0].mealType).replace('Plan ', '')} (${sorted.length} Boxen)` });
  }
  candidates.sort((a, b) => a.date.localeCompare(b.date) || a.sourceId.localeCompare(b.sourceId));
  for (const c of candidates) {
    const r = effective(c.recipeId);
    if (r.error) { skipped.push({ ...c, reason: r.error }); continue; }
    selections.push({ recipeId: c.recipeId, title: r.recipe.title, servings: c.servings, recipe: r.effective, sourceType: c.sourceType, sourceId: c.sourceId, label: c.label });
  }
  return { selections, skipped };
}
