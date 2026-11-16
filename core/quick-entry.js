// core/quick-entry.js – Schnellerfassen mehrerer Vorratszeilen (rein). Unklare Zeilen werden markiert, nie geraten.
import { parseIngredientLine, normalizeUnit, CHECK_QUANTITY_TEXT } from '../units.js';
import { sanitizeText, normalizeText } from './utils.js';

export const MAX_BULK_LINES = 50;

/**
 * Zerlegt einen Mehrzeilen-Text („500 g Hähnchen“ je Zeile).
 * @returns {{items:Array, duplicates:string[], truncated:number}}
 */
export function parseBulkLines(text, catalog) {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const truncated = Math.max(0, lines.length - MAX_BULK_LINES);
  const seen = new Set();
  const duplicates = [];
  const items = lines.slice(0, MAX_BULK_LINES).map((line) => {
    const key = normalizeText(line);
    if (seen.has(key)) duplicates.push(line); else seen.add(key);
    const p = parseIngredientLine(line);
    const name = sanitizeText(p?.name || line, 80);
    const entry = catalog?.resolve(name) ?? null;
    const unit = normalizeUnit(p?.unit);
    const ok = typeof p?.amount === 'number' && p.amount > 0 && p.amount <= 1_000_000 && !!unit && !!name;
    return {
      line, name: entry?.name ?? name, ingredientId: entry?.id ?? null, category: entry?.category ?? 'Sonstiges',
      amount: ok ? p.amount : (typeof p?.amount === 'number' && p.amount > 0 ? p.amount : null),
      unit: ok ? unit : null,
      status: ok ? 'ok' : 'check',
      reason: ok ? null : `${CHECK_QUANTITY_TEXT} – erkannt wird „Menge Einheit Name“, z. B. „500 g Hähnchen“.`,
    };
  });
  return { items, duplicates, truncated };
}
