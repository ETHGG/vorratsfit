// views/state.js – gemeinsamer, im Speicher gehaltener Anwendungszustand für die Views.
// Persistente Daten liegen ausschließlich in IndexedDB; hier nur Zwischenspeicher.
import { loadCatalog, getAllRecipes, listFavorites } from '../recipes.js';
import { getProfile, getMealTargets } from '../profile.js';
import { getSettings } from '../settings.js';
import { listPantry } from '../pantry.js';

export const state = {
  catalog: null,
  profile: null,
  settings: null,
  recipes: [],
  recipesById: new Map(),
  favorites: new Set(),
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  pantryServings: null,
};

export async function loadBase() {
  const [catalog, profile, settings] = await Promise.all([loadCatalog(), getProfile(), getSettings()]);
  state.catalog = catalog;
  state.profile = profile;
  state.settings = settings;
  await Promise.all([refreshRecipes(), refreshFavorites()]);
}

export async function refreshRecipes() {
  state.recipes = await getAllRecipes();
  state.recipesById = new Map(state.recipes.map((r) => [r.id, r]));
}

export async function refreshFavorites() {
  state.favorites = new Set((await listFavorites()).map((f) => f.id));
}

export async function refreshProfile() {
  state.profile = await getProfile();
}

export async function refreshSettings() {
  state.settings = await getSettings();
}

export async function analysisContext(servings = null) {
  const pantry = await listPantry();
  return {
    profile: state.profile,
    pantry,
    catalog: state.catalog,
    mealTargets: getMealTargets(state.profile),
    servings,
    warnDays: state.settings?.expiryWarningDays ?? 3,
  };
}

export function shoppingContext() {
  return { recipesById: state.recipesById, profile: state.profile, catalog: state.catalog };
}
