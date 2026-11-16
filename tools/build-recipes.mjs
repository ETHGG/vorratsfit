// Optionales Hilfsskript (kein Pflicht-Build): erzeugt data/recipes.json aus tools/recipes-source.mjs.
// Aufruf: node tools/build-recipes.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { RECIPES } from './recipes-source.mjs';
import { createCatalog } from '../core/catalog.js';
import { computeRecipeNutrition } from '../nutrition.js';
import { recipeAllergens } from '../core/restrictions.js';
import { deriveDietaryTags } from '../core/recipe-tags.js';
import { normalizeText } from '../core/utils.js';

const ingredients = JSON.parse(readFileSync(new URL('../data/ingredients.json', import.meta.url), 'utf8'));
const catalog = createCatalog(ingredients);
const ids = new Set();
const toIng = ([id, amount, unit, opts = {}]) => {
  const e = catalog.get(id);
  if (!e) throw new Error(`Unbekannte Zutat ${id}`);
  return {
    ingredientId: id, name: e.name, normalizedName: normalizeText(e.name), amount, unit, category: e.category,
    optional: !!opts.optional, substitutes: opts.substitutes ?? [], allergenTags: e.allergenTags,
  };
};
const out = RECIPES.map((r) => {
  if (ids.has(r.id)) throw new Error(`Doppelte ID ${r.id}`);
  ids.add(r.id);
  const recipe = {
    id: r.id, title: r.title, description: r.description, emoji: r.emoji, mealType: r.mealType, defaultServings: r.servings,
    ingredients: r.ingredients.map(toIng), spices: r.spices.map(toIng), instructions: r.steps,
    preparationMinutes: r.prep, cookingMinutes: r.cook, totalMinutes: r.prep + r.cook, difficulty: r.difficulty,
    devices: r.devices, mealPrep: !!r.mealPrep, estimatedCostLevel: r.cost,
    source: 'VorratsFit (eigene Rezepte)', sourceUrl: null, license: 'MIT – selbst formuliert für VorratsFit', origin: 'local',
  };
  const nut = computeRecipeNutrition(recipe, catalog);
  recipe.nutritionPerServing = nut.perServing;
  recipe.nutritionStatus = nut.status;
  recipe.nutritionConfidence = nut.confidence;
  recipe.nutritionCoverage = nut.coverage;
  const al = recipeAllergens(recipe, catalog);
  recipe.allergens = al.tags.sort();
  recipe.allergenDataComplete = al.complete;
  recipe.dietaryTags = deriveDietaryTags(recipe, catalog, nut.perServing);
  return recipe;
});
writeFileSync(new URL('../data/recipes.json', import.meta.url), `${JSON.stringify({ version: 1, recipes: out }, null, 1)}\n`);
console.log(`${out.length} Rezepte geschrieben`);
