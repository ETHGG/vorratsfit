// core/food.js – freies Ess-Tracking: Nährwerte einer Lebensmittelmenge aus den Stammdaten (rein).
// Unbekannte Werte bleiben null – niemals 0.
import { nutritionForIngredient } from '../nutrition.js';
import { normalizeUnit, getDimension, formatAmount } from '../units.js';
import { parseNumber, roundTo, sanitizeText } from './utils.js';

/** Lebensmittel, die frei erfasst werden können (Stammdaten mit Nährwerten, ohne Gewürze). */
export function trackableFoods(catalog) {
  return (catalog?.list ?? []).filter((e) => e.nutrition && !e.isSpice).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/** Einheiten, die für ein Lebensmittel sinnvoll umrechenbar sind. */
export function unitsFor(entry) {
  if (!entry) return ['g'];
  const base = entry.nutritionBasis === '100ml' ? ['ml', 'l'] : ['g', 'kg'];
  if (entry.gramsPerPiece || entry.mlPerPiece) base.push('Stück');
  return base;
}

/**
 * Nährwerte für eine Menge eines Stammdaten-Lebensmittels.
 * @returns {{ok:true, values:object, amountLabel:string}|{ok:false, error:string}}
 */
export function foodPortion(entry, amount, unit) {
  if (!entry) return { ok: false, error: 'Bitte wähle ein Lebensmittel aus der Liste oder trage eigene Werte ein.' };
  const n = parseNumber(typeof amount === 'number' ? amount : String(amount ?? ''));
  if (n === null || n <= 0 || n > 10000) return { ok: false, error: 'Bitte gib eine Menge größer als 0 ein.' };
  const u = normalizeUnit(unit);
  const dim = getDimension(u);
  if (!u || !['mass', 'volume', 'count'].includes(dim)) return { ok: false, error: 'Bitte wähle eine Einheit.' };
  const raw = nutritionForIngredient(n, u, entry);
  if (!raw) return { ok: false, error: 'Diese Einheit lässt sich für dieses Lebensmittel nicht sicher umrechnen. Bitte g oder ml wählen.' };
  const r = (v, d = 1) => (v === null ? null : roundTo(v, d));
  return {
    ok: true,
    amountLabel: formatAmount(n, u, { humanize: false }),
    values: { kcal: raw.kcal === null ? null : Math.round(raw.kcal), protein: r(raw.protein), carbs: r(raw.carbs), fat: r(raw.fat), fiber: r(raw.fiber) },
  };
}

/** Eigene Werte (kcal Pflicht, Makros optional) prüfen. */
export function validateCustomFood(input) {
  const errors = {};
  const name = sanitizeText(input.name, 80);
  if (!name) errors.name = 'Bitte gib einen Namen ein.';
  const values = {};
  for (const [k, label, required] of [['kcal', 'Kalorien', true], ['protein', 'Protein', false], ['carbs', 'Kohlenhydrate', false], ['fat', 'Fett', false]]) {
    const raw = input[k];
    if (raw === '' || raw === null || raw === undefined) { if (required) errors[k] = `Bitte gib die ${label} an.`; values[k] = null; continue; }
    const v = parseNumber(typeof raw === 'number' ? raw : String(raw));
    if (v === null || v < 0 || v > 5000) errors[k] = `${label}: Zahl zwischen 0 und 5000.`;
    else values[k] = v;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, errors: {}, values: { name, ...values } };
}

/** „Zuletzt gegessen“: verschiedene Einträge (nach Name), neueste zuerst. */
export function recentFoods(logs, limit = 8) {
  const seen = new Set();
  const out = [];
  for (const l of [...logs].sort((a, b) => `${b.date}${b.time ?? ''}${b.createdAt}`.localeCompare(`${a.date}${a.time ?? ''}${a.createdAt}`))) {
    const key = `${l.name}|${l.amountLabel ?? ''}`.toLowerCase();
    if (seen.has(key) || l.source === 'plan') continue;
    seen.add(key);
    out.push(l);
    if (out.length >= limit) break;
  }
  return out;
}
