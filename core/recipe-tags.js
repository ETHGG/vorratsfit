// core/recipe-tags.js – leitet Ernährungs-Tags aus Zutaten, Nährwerten und Geräten ab (rein).
import { catalogEntryFor, EMPTY_CATALOG } from './catalog.js';
import { ingredientAllergenInfo } from './restrictions.js';

function tagStatus(recipe, tag, catalog) {
  // 'free' | 'possible' | 'contains' | 'unknown'
  let status = 'free';
  for (const ing of [...(recipe.ingredients ?? []), ...(recipe.spices ?? [])]) {
    const info = ingredientAllergenInfo(ing, catalog);
    if (!info.known) { if (status === 'free') status = 'unknown'; continue; }
    if (!info.tags.includes(tag)) continue;
    if (ing.optional) { if (status === 'free') status = 'possible'; continue; }
    const altId = info.entry?.alternatives?.[tag];
    if (altId && catalog.get(altId)) { if (status !== 'contains') status = 'possible'; } else return 'contains';
  }
  return status;
}

export function deriveDietaryTags(recipe, catalog = EMPTY_CATALOG, nutrition = recipe.nutritionPerServing) {
  const tags = [];
  const entries = (recipe.ingredients ?? []).filter((i) => !i.optional).map((i) => catalogEntryFor(i, catalog));
  const allKnown = entries.every(Boolean);
  if (allKnown) {
    if (entries.every((e) => !e.animal)) tags.push('vegan');
    if (entries.every((e) => e.animal !== 'meat' && e.animal !== 'fish')) tags.push('vegetarisch');
  }
  const gluten = tagStatus(recipe, 'gluten', catalog);
  if (gluten === 'free') tags.push('glutenfrei'); else if (gluten === 'possible') tags.push('glutenfrei möglich');
  const lactose = tagStatus(recipe, 'laktose', catalog);
  if (lactose === 'free') tags.push('laktosefrei'); else if (lactose === 'possible') tags.push('laktosefrei möglich');
  const n = nutrition;
  if (n && typeof n.protein === 'number' && (n.protein >= 25 || (typeof n.kcal === 'number' && n.kcal > 0 && n.protein >= 15 && (n.protein * 4) / n.kcal >= 0.3))) tags.push('proteinreich');
  if (n && typeof n.kcal === 'number' && n.kcal <= 450) tags.push('kalorienarm');
  if (n && typeof n.carbs === 'number' && n.carbs <= 20) tags.push('Low Carb');
  if (recipe.estimatedCostLevel === 1) tags.push('günstig');
  if (recipe.mealPrep) tags.push('Meal Prep');
  if ((recipe.devices ?? []).includes('airfryer')) tags.push('Airfryer');
  if ((recipe.devices ?? []).includes('mikrowelle')) tags.push('Mikrowelle');
  if (typeof recipe.totalMinutes === 'number' && recipe.totalMinutes <= 20) tags.push('schnell');
  return tags;
}
