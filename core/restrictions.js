// core/restrictions.js – Allergien, Unverträglichkeiten und harte Ernährungsregeln.
// Allergien sind harte Ausschlusskriterien. Fehlende Allergendaten gelten NIE als "allergenfrei".
import { allergenLabel } from './models.js';
import { normalizeText, unique } from './utils.js';
import { catalogEntryFor, EMPTY_CATALOG } from './catalog.js';

export const ALLERGY_DISCLAIMER = 'Bei schweren Allergien müssen Zutatenlisten und Produktkennzeichnungen immer selbst überprüft werden. VorratsFit ersetzt keine medizinische oder ernährungsmedizinische Beratung.';

/** Allergen-Tags einer Zutat (Rezeptangabe ∪ Stammdaten). known=false, wenn keine Daten vorliegen. */
export function ingredientAllergenInfo(ing, catalog = EMPTY_CATALOG) {
  const entry = catalogEntryFor(ing, catalog);
  const tags = unique([...(ing.allergenTags ?? []), ...(entry?.allergenTags ?? [])]);
  const known = !!entry || ing.allergenDataKnown === true;
  return { tags, known, entry };
}

function allIngredients(recipe) {
  return [...(recipe?.ingredients ?? []).map((i) => ({ ...i, isSpice: false })), ...(recipe?.spices ?? []).map((i) => ({ ...i, isSpice: true }))];
}

/** Ermittelt alle bekannten Allergene eines Rezepts und ob die Datenlage vollständig ist. */
export function recipeAllergens(recipe, catalog = EMPTY_CATALOG) {
  let complete = recipe?.origin === 'external' ? false : recipe?.allergenDataComplete !== false;
  const tags = new Set(recipe?.allergens ?? []);
  for (const ing of allIngredients(recipe)) {
    const info = ingredientAllergenInfo(ing, catalog);
    info.tags.forEach((t) => tags.add(t));
    if (!info.known) complete = false;
  }
  return { tags: Array.from(tags), complete };
}

function textMatches(term, ing, entry) {
  const t = normalizeText(term);
  if (!t || t.length < 3) return false;
  const names = [ing.name, ing.normalizedName, entry?.name, ...(entry?.aliases ?? [])].map(normalizeText).filter(Boolean);
  return names.some((n) => n.includes(t) || t.includes(n));
}

const ANIMAL_RULES = {
  vegan: (e) => !!e?.animal,
  vegetarisch: (e) => e?.animal === 'meat' || e?.animal === 'fish',
  pescetarisch: (e) => e?.animal === 'meat',
  halal: (e) => e?.pork === true || e?.alcohol === true,
};

/**
 * Prüft ein Rezept gegen das Profil.
 * status: 'ok' | 'excluded' (bekannter Konflikt) | 'unknown' (Datenlage unvollständig, nicht normal vorschlagen)
 * Liefert ein "effektives" Rezept mit hinterlegten Alternativen bzw. ohne weggelassene optionale Zutaten.
 */
export function checkRecipe(recipe, profile, catalog = EMPTY_CATALOG) {
  const allergies = new Set(profile?.allergies ?? []);
  const customAllergies = profile?.customAllergies ?? [];
  const intolerances = new Set(profile?.intolerances ?? []);
  const customIntolerances = profile?.customIntolerances ?? [];
  const diets = new Set(profile?.diets ?? []);
  if (diets.has('glutenfrei')) intolerances.add('gluten');
  if (diets.has('laktosefrei')) intolerances.add('laktose');

  const reasons = [];
  const notes = [];
  const substitutions = [];
  const omitted = [];
  let unknown = false;
  const hasRestrictions = allergies.size || customAllergies.length || intolerances.size || customIntolerances.length
    || ['vegan', 'vegetarisch', 'pescetarisch', 'halal'].some((d) => diets.has(d));

  for (const a of recipe?.allergens ?? []) {
    if (allergies.has(a)) reasons.push(`Enthält ${allergenLabel(a)} (Allergie)`);
  }

  const mapList = (list, isSpice) => (list ?? []).map((ing) => {
    const info = ingredientAllergenInfo(ing, catalog);
    const entry = info.entry;
    for (const tag of info.tags) {
      if (allergies.has(tag)) reasons.push(`Enthält ${allergenLabel(tag)} (${ing.name}) – Allergie`);
    }
    for (const term of customAllergies) {
      if (textMatches(term, ing, entry)) reasons.push(`Enthält „${term}“ (${ing.name}) – Allergie`);
    }
    if (!info.known && (allergies.size || customAllergies.length)) unknown = true;

    for (const [diet, violates] of Object.entries(ANIMAL_RULES)) {
      if (!diets.has(diet)) continue;
      if (!entry) { unknown = true; continue; }
      if (violates(entry)) {
        if (ing.optional) { omitted.push(ing.name); return null; }
        reasons.push(`${ing.name} passt nicht zu „${diet}“`);
      }
    }
    if (diets.has('halal') && entry?.animal === 'meat' && !entry.pork) {
      notes.push(`Halal: Bitte halal-zertifiziertes Fleisch verwenden (${ing.name}).`);
    }

    let current = ing;
    let currentEntry = entry;
    let currentTags = info.tags;
    for (const tag of intolerances) {
      if (!currentTags.includes(tag)) continue;
      if (ing.optional) { omitted.push(ing.name); return null; }
      const altId = currentEntry?.alternatives?.[tag];
      const alt = altId ? catalog.get(altId) : null;
      const altOk = alt && !(alt.allergenTags ?? []).includes(tag) && !(alt.allergenTags ?? []).some((t) => allergies.has(t));
      if (altOk) {
        substitutions.push({ from: current.name, to: alt.name, reason: allergenLabel(tag) });
        current = { ...current, ingredientId: alt.id, name: alt.name, normalizedName: normalizeText(alt.name), allergenTags: alt.allergenTags ?? [], substitutedFrom: ing.name };
        currentEntry = alt;
        currentTags = alt.allergenTags ?? [];
      } else {
        reasons.push(`Enthält ${allergenLabel(tag)} (${ing.name}) – keine hinterlegte Alternative`);
      }
    }
    if (!info.known && (intolerances.size || customIntolerances.length)) unknown = true;
    for (const term of customIntolerances) {
      if (textMatches(term, ing, entry)) {
        if (ing.optional) { omitted.push(ing.name); return null; }
        reasons.push(`Enthält „${term}“ (${ing.name}) – Unverträglichkeit`);
      }
    }
    return { ...current, isSpice };
  }).filter(Boolean);

  const ingredients = mapList(recipe?.ingredients, false);
  const spices = mapList(recipe?.spices, true);
  if (recipe?.origin === 'external' && hasRestrictions) unknown = true;

  const uniqueReasons = unique(reasons);
  const status = uniqueReasons.length ? 'excluded' : unknown ? 'unknown' : 'ok';
  return {
    status,
    allowed: status === 'ok',
    reasons: uniqueReasons,
    notes: unique(notes),
    substitutions,
    omitted: unique(omitted),
    effectiveRecipe: { ...recipe, ingredients, spices },
  };
}

/** Abneigungen (keine harte Regel, nur Bewertung und Hinweis). */
export function dislikedIngredients(recipe, profile, catalog = EMPTY_CATALOG) {
  const terms = profile?.dislikes ?? [];
  if (!terms.length) return [];
  const hits = [];
  for (const ing of allIngredients(recipe)) {
    const entry = catalogEntryFor(ing, catalog);
    if (terms.some((t) => textMatches(t, ing, entry))) hits.push(ing.name);
  }
  return unique(hits);
}

export function likedMatches(recipe, profile, catalog = EMPTY_CATALOG) {
  const terms = profile?.likes ?? [];
  if (!terms.length) return [];
  const hits = [];
  const title = normalizeText(recipe?.title);
  for (const term of terms) {
    const t = normalizeText(term);
    if (t.length >= 3 && title.includes(t)) { hits.push(term); continue; }
    if ((recipe?.dietaryTags ?? []).some((tag) => normalizeText(tag) === t)) { hits.push(term); continue; }
    for (const ing of allIngredients(recipe)) {
      if (textMatches(term, ing, catalogEntryFor(ing, catalog))) { hits.push(term); break; }
    }
  }
  return unique(hits);
}
