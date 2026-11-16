// core/catalog.js – Zutaten-Stammdaten (reine Funktionen, Daten werden übergeben).
import { normalizeText } from './utils.js';

/**
 * Baut einen Index über die Zutatenstammdaten.
 * @param {Array} ingredients Inhalt von data/ingredients.json
 */
export function createCatalog(ingredients = []) {
  const byId = new Map();
  const byAlias = new Map();
  for (const ing of ingredients) {
    if (!ing || typeof ing.id !== 'string') continue;
    byId.set(ing.id, ing);
    const names = [ing.name, ...(ing.aliases ?? []), ing.name.replace(/\(.*?\)/g, ' ')];
    for (const n of names) {
      const key = normalizeText(n);
      if (key && !byAlias.has(key)) byAlias.set(key, ing);
    }
  }
  return {
    list: ingredients,
    get(id) {
      return id ? byId.get(id) ?? null : null;
    },
    /** Findet eine Zutat anhand eines Namens (exakt oder Alias, dann vorsichtiger Teilabgleich). */
    resolve(name) {
      const key = normalizeText(name);
      if (!key) return null;
      if (byAlias.has(key)) return byAlias.get(key);
      // Plural/Endungen vorsichtig abgleichen ("Zwiebeln" -> "zwiebel")
      for (const suffix of ['n', 'en', 'e', 's']) {
        if (key.endsWith(suffix) && byAlias.has(key.slice(0, -suffix.length))) return byAlias.get(key.slice(0, -suffix.length));
        if (byAlias.has(key + suffix)) return byAlias.get(key + suffix);
      }
      return null;
    },
  };
}

export const EMPTY_CATALOG = createCatalog([]);

/** Schlüssel, über den Vorrat, Rezept und Einkaufsliste dieselbe Zutat erkennen. */
export function ingredientKey(item, catalog = EMPTY_CATALOG) {
  if (item?.ingredientId && catalog.get(item.ingredientId)) return `id:${item.ingredientId}`;
  const resolved = catalog.resolve(item?.name ?? item?.normalizedName ?? '');
  if (resolved) return `id:${resolved.id}`;
  if (item?.ingredientId) return `id:${item.ingredientId}`;
  return `n:${normalizeText(item?.normalizedName || item?.name || '')}`;
}

/** Liefert die Stammdaten zu einem Rezept- oder Vorratseintrag, falls vorhanden. */
export function catalogEntryFor(item, catalog = EMPTY_CATALOG) {
  return catalog.get(item?.ingredientId) ?? catalog.resolve(item?.name ?? '') ?? null;
}
