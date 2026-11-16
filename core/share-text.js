// core/share-text.js – Text zum Teilen der Einkaufsliste (rein).
// Enthält NUR offene Artikel mit Menge – niemals Profil-, Plan-, Tagebuch- oder Gesundheitsdaten (CLAUDE.md 2.5).
import { SHOPPING_GROUPS } from './models.js';
import { sortShoppingItems } from './shopping-logic.js';
import { formatAmount, CHECK_QUANTITY_TEXT } from '../units.js';

/** @param {Array} items Einkaufsliste; weitere Argumente werden bewusst ignoriert. */
export function buildShareText(items) {
  const open = sortShoppingItems((items ?? []).filter((i) => !i.checked), SHOPPING_GROUPS);
  if (!open.length) return '';
  const lines = ['🛒 Einkaufsliste'];
  for (const group of SHOPPING_GROUPS) {
    const list = open.filter((i) => i.shoppingGroup === group);
    if (!list.length) continue;
    lines.push('', `— ${group} —`);
    for (const i of list) {
      lines.push(typeof i.amountToBuy === 'number' && i.amountToBuy > 0 && !i.quantityCheck
        ? `• ${formatAmount(i.amountToBuy, i.unit)} ${i.name}`
        : `• ${i.name} (${CHECK_QUANTITY_TEXT})`);
    }
  }
  lines.push('', 'Erstellt mit VorratsFit');
  return lines.join('\n');
}
