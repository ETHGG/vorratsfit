// units.js – zentrale Mengen- und Einheitenlogik. Keine Umrechnung außerhalb dieses Moduls.
import { parseNumber } from './core/utils.js';

/**
 * Einheitendefinitionen. Nur Einheiten derselben Dimension sind vergleichbar.
 * EL, TL, Prise usw. haben eigene Dimensionen und werden niemals spekulativ in g/ml umgerechnet.
 */
const UNIT_DEFS = Object.freeze({
  mg: { dimension: 'mass', factor: 0.001 },
  g: { dimension: 'mass', factor: 1 },
  kg: { dimension: 'mass', factor: 1000 },
  ml: { dimension: 'volume', factor: 1 },
  l: { dimension: 'volume', factor: 1000 },
  'Stück': { dimension: 'count', factor: 1 },
  EL: { dimension: 'tbsp', factor: 1 },
  TL: { dimension: 'tsp', factor: 1 },
  Prise: { dimension: 'pinch', factor: 1 },
  Bund: { dimension: 'bunch', factor: 1 },
  Packung: { dimension: 'pack', factor: 1 },
  Dose: { dimension: 'can', factor: 1 },
});

const BASE_UNIT = Object.freeze({
  mass: 'g', volume: 'ml', count: 'Stück', tbsp: 'EL', tsp: 'TL', pinch: 'Prise', bunch: 'Bund', pack: 'Packung', can: 'Dose',
});

const ALIASES = Object.freeze({
  mg: 'mg', milligramm: 'mg',
  g: 'g', gr: 'g', gramm: 'g', gram: 'g', grams: 'g',
  kg: 'kg', kilo: 'kg', kilogramm: 'kg',
  ml: 'ml', milliliter: 'ml', millilitre: 'ml',
  l: 'l', liter: 'l', litre: 'l', ltr: 'l',
  'stück': 'Stück', stueck: 'Stück', stk: 'Stück', st: 'Stück', x: 'Stück', pcs: 'Stück', piece: 'Stück', pieces: 'Stück', 'stücke': 'Stück',
  el: 'EL', 'esslöffel': 'EL', essloeffel: 'EL', tbsp: 'EL',
  tl: 'TL', 'teelöffel': 'TL', teeloeffel: 'TL', tsp: 'TL',
  prise: 'Prise', prisen: 'Prise', pinch: 'Prise',
  bund: 'Bund',
  packung: 'Packung', pck: 'Packung', pkg: 'Packung', packungen: 'Packung',
  dose: 'Dose', dosen: 'Dose', can: 'Dose',
});

export const SELECTABLE_UNITS = Object.freeze(['g', 'kg', 'mg', 'ml', 'l', 'Stück', 'EL', 'TL', 'Prise', 'Bund', 'Packung', 'Dose']);
const UNCERTAIN_UNIT_WORDS = new Set(['cup', 'cups', 'tasse', 'tassen', 'becher', 'oz', 'ounce', 'ounces', 'lb', 'lbs', 'pound', 'pounds', 'handvoll', 'schuss', 'spritzer', 'glas', 'gläser', 'msp', 'messerspitze', 'tablespoon', 'tablespoons', 'teaspoon', 'teaspoons', 'clove', 'cloves', 'slice', 'slices', 'scheibe', 'scheiben', 'zehe', 'zehen', 'stange', 'stangen', 'knolle', 'dash', 'handful', 'can', 'tin', 'tins']);
export const CHECK_QUANTITY_TEXT = 'Menge bitte prüfen';
const EPS = 1e-9;

/** Gibt die kanonische Einheit zurück oder null, wenn unbekannt. */
export function normalizeUnit(unit) {
  if (typeof unit !== 'string') return null;
  if (UNIT_DEFS[unit]) return unit;
  const key = unit.trim().toLowerCase().replace(/\.$/, '');
  return ALIASES[key] ?? null;
}

export function isKnownUnit(unit) {
  return normalizeUnit(unit) !== null;
}

export function getDimension(unit) {
  const u = normalizeUnit(unit);
  return u ? UNIT_DEFS[u].dimension : null;
}

export function baseUnitOf(unit) {
  const d = getDimension(unit);
  return d ? BASE_UNIT[d] : null;
}

export function isCountUnit(unit) {
  return getDimension(unit) === 'count';
}

/** Beseitigt Gleitkommaartefakte (0.30000000004 -> 0.3). */
export function roundQuantity(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value * 1e6) / 1e6;
}

/** Wandelt eine Menge in die Basiseinheit ihrer Dimension um. */
export function toBase(amount, unit) {
  const u = normalizeUnit(unit);
  if (!u || typeof amount !== 'number' || !Number.isFinite(amount)) return null;
  const def = UNIT_DEFS[u];
  return { value: roundQuantity(amount * def.factor), unit: BASE_UNIT[def.dimension], dimension: def.dimension };
}

export function areCompatible(unitA, unitB) {
  const a = getDimension(unitA);
  return a !== null && a === getDimension(unitB);
}

/** Rechnet nur zwischen kompatiblen Einheiten um. Sonst null (keine Spekulation). */
export function convert(amount, fromUnit, toUnit) {
  if (!areCompatible(fromUnit, toUnit)) return null;
  const base = toBase(amount, fromUnit);
  if (!base) return null;
  return roundQuantity(base.value / UNIT_DEFS[normalizeUnit(toUnit)].factor);
}

/**
 * Umrechnung mit expliziten Stammdaten (gramsPerPiece / mlPerPiece) einer Zutat.
 * Nur Stück <-> g bzw. Stück <-> ml, wenn die Stammdaten den Wert ausdrücklich hinterlegen.
 */
export function convertWithIngredient(amount, fromUnit, toUnit, ingredient) {
  const direct = convert(amount, fromUnit, toUnit);
  if (direct !== null) return direct;
  if (!ingredient) return null;
  const fromDim = getDimension(fromUnit);
  const toDim = getDimension(toUnit);
  const perPiece = (dim) => (dim === 'mass' ? ingredient.gramsPerPiece : dim === 'volume' ? ingredient.mlPerPiece : null);
  if (fromDim === 'count' && (toDim === 'mass' || toDim === 'volume')) {
    const pp = perPiece(toDim);
    if (!(pp > 0)) return null;
    return convert(amount * pp, BASE_UNIT[toDim], toUnit);
  }
  if (toDim === 'count' && (fromDim === 'mass' || fromDim === 'volume')) {
    const pp = perPiece(fromDim);
    if (!(pp > 0)) return null;
    const base = toBase(amount, fromUnit);
    return roundQuantity(base.value / pp);
  }
  return null;
}

/** Skaliert eine Rezeptmenge: Originalmenge × gewünschte Portionen / Originalportionen. */
export function scaleAmount(amount, originalServings, targetServings) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null;
  if (!(originalServings > 0) || !(targetServings > 0)) return null;
  return roundQuantity((amount * targetServings) / originalServings);
}

/** Rundet eine Einkaufsmenge sinnvoll. Stückzahlen werden aufgerundet. */
export function roundPurchaseAmount(amount, unit) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null;
  if (amount <= EPS) return 0;
  const dim = getDimension(unit);
  if (dim === 'count' || dim === 'can' || dim === 'pack' || dim === 'bunch') return Math.ceil(amount - EPS);
  return roundQuantity(amount);
}

/**
 * Berechnet die Kaufmenge: max(0, Bedarf - Vorrat). Vorratsmengen in inkompatiblen
 * Einheiten werden nicht verrechnet, sondern als "Menge bitte prüfen" markiert.
 */
export function computeToBuy(needAmount, needUnit, availableEntries = [], ingredient = null) {
  const unit = normalizeUnit(needUnit);
  if (!unit || typeof needAmount !== 'number' || !Number.isFinite(needAmount) || needAmount < 0) {
    return { status: 'check', toBuy: null, available: null, unit: needUnit, reason: CHECK_QUANTITY_TEXT };
  }
  let available = 0;
  let incompatible = 0;
  for (const entry of availableEntries) {
    if (!entry || typeof entry.amount !== 'number' || !Number.isFinite(entry.amount) || entry.amount <= 0) continue;
    const converted = convertWithIngredient(entry.amount, entry.unit, unit, ingredient);
    if (converted === null) incompatible += 1;
    else available += converted;
  }
  available = roundQuantity(available);
  const raw = roundQuantity(Math.max(0, needAmount - available));
  const toBuy = roundPurchaseAmount(raw, unit);
  return {
    status: incompatible > 0 && raw > EPS ? 'check' : 'ok',
    toBuy,
    available,
    unit,
    incompatibleEntries: incompatible,
    reason: incompatible > 0 && raw > EPS ? CHECK_QUANTITY_TEXT : null,
  };
}

/** Wählt eine gut lesbare Einheit (z. B. 1250 g -> 1,25 kg). */
export function humanizeAmount(amount, unit) {
  const u = normalizeUnit(unit);
  if (!u || typeof amount !== 'number' || !Number.isFinite(amount)) return { amount, unit };
  if (u === 'g' && amount >= 1000) return { amount: roundQuantity(amount / 1000), unit: 'kg' };
  if (u === 'ml' && amount >= 1000) return { amount: roundQuantity(amount / 1000), unit: 'l' };
  if (u === 'mg' && amount >= 1000) return { amount: roundQuantity(amount / 1000), unit: 'g' };
  return { amount, unit: u };
}

export function formatNumber(value, maxDecimals = 2) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '–';
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: maxDecimals }).format(value);
}

/** Formatiert Menge + Einheit. Ungültige Werte ergeben "Menge bitte prüfen". */
export function formatAmount(amount, unit, { humanize = true } = {}) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return CHECK_QUANTITY_TEXT;
  const known = normalizeUnit(unit);
  const h = humanize ? humanizeAmount(amount, unit) : { amount, unit: known ?? unit };
  const decimals = h.unit === 'g' || h.unit === 'ml' || h.unit === 'mg' ? (h.amount >= 10 ? 0 : 1) : 2;
  const plural = { Prise: 'Prisen', Dose: 'Dosen', Packung: 'Packungen' };
  const unitLabel = known ? (h.amount !== 1 && plural[h.unit] ? plural[h.unit] : h.unit) : String(unit ?? '').trim();
  return `${formatNumber(h.amount, decimals)}${unitLabel ? ` ${unitLabel}` : ''}`;
}

/**
 * Zerlegt eine Zutatenzeile wie "400 g Hähnchenbrust", "400g Reis" oder "2 Paprika".
 * Unbekannte Einheiten werden nicht geraten.
 */
export function parseIngredientLine(line) {
  const text = String(line ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return null;
  const m = text.match(/^(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?|½|¼|¾)\s*(.*)$/);
  if (!m) return { amount: null, unit: null, name: text };
  const rawAmount = m[1];
  let amount;
  if (rawAmount === '½') amount = 0.5;
  else if (rawAmount === '¼') amount = 0.25;
  else if (rawAmount === '¾') amount = 0.75;
  else if (rawAmount.includes('/')) {
    const [a, b] = rawAmount.split('/').map((x) => Number(x.trim()));
    amount = b > 0 ? a / b : null;
  } else amount = parseNumber(rawAmount);
  const rest = m[2].trim();
  if (!rest) return { amount, unit: null, name: '' };
  const [first, ...others] = rest.split(' ');
  const unit = normalizeUnit(first);
  if (unit && others.length) return { amount, unit, name: others.join(' ') };
  if (UNCERTAIN_UNIT_WORDS.has(first.toLowerCase().replace(/\.$/, '')) && others.length) {
    // Bekanntes, aber nicht sicher umrechenbares Maß -> keine Spekulation
    return { amount, unit: null, rawUnit: first, name: others.join(' ') };
  }
  return { amount, unit: 'Stück', name: rest };
}
