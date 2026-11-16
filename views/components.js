// views/components.js – wiederverwendbare UI-Bausteine (Rezeptkarte, Statusanzeigen, Hinweise).
import { h, icon, fmtKcal, fmtGram, fmtMinutes, chip } from './dom.js';
import { routeHref } from './router.js';
import { formatAmount } from '../units.js';
import { ESTIMATE_NOTICE } from '../nutrition.js';
import { ALLERGY_DISCLAIMER } from '../core/restrictions.js';
import { state } from './state.js';

export const STATUS_TEXT = Object.freeze({
  available: { label: 'Vorhanden', icon: 'check', cls: 'ok' },
  substitute: { label: 'Ersatz vorhanden', icon: 'check', cls: 'ok' },
  insufficient: { label: 'Zu wenig', icon: 'alert', cls: 'warn' },
  missing: { label: 'Fehlt', icon: 'x', cls: 'bad' },
  check: { label: 'Menge bitte prüfen', icon: 'info', cls: 'warn' },
});

/** Status immer als Symbol UND Text – nie nur über Farbe. */
export function statusBadge(status) {
  const s = STATUS_TEXT[status] ?? STATUS_TEXT.check;
  return h('span', { class: `badge badge-${s.cls}` }, icon(s.icon, { size: 14 }), s.label);
}

export function tagList(tags = [], max = 6) {
  if (!tags.length) return null;
  return h('ul', { class: 'tags', 'aria-label': 'Ernährungs-Tags' }, ...tags.slice(0, max).map((t) => h('li', { class: 'tag' }, t)));
}

export function estimateNote(recipe) {
  if (recipe.nutritionStatus === 'provided') return null;
  return h('p', { class: 'note-estimate' }, icon('info', { size: 14 }), ESTIMATE_NOTICE);
}

export function allergyDisclaimer() {
  return h('p', { class: 'disclaimer' }, icon('alert', { size: 14 }), ALLERGY_DISCLAIMER);
}

function recipeVisual(recipe) {
  if (recipe.imageUrl && state.settings?.externalImages && state.online) {
    return h('img', { class: 'card-img', src: recipe.imageUrl, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', width: '96', height: '96' });
  }
  return h('div', { class: 'card-emoji', 'aria-hidden': 'true' }, recipe.emoji || '🍽️');
}

export function favoriteButton(recipe, onToggle) {
  const fav = state.favorites.has(recipe.id);
  return h('button', {
    type: 'button', class: `btn btn-icon fav ${fav ? 'is-fav' : ''}`, 'aria-pressed': fav ? 'true' : 'false',
    'aria-label': fav ? `${recipe.title} aus Favoriten entfernen` : `${recipe.title} als Favorit merken`, onclick: onToggle,
  }, icon('heart'), h('span', { class: 'sr-only' }, fav ? 'Favorit' : 'Kein Favorit'));
}

function ingredientSummary(evaluation) {
  const main = evaluation.items.filter((i) => !i.isSpice && !i.optional);
  const have = main.filter((i) => i.status === 'available' || i.status === 'substitute').map((i) => i.name);
  const low = main.filter((i) => i.status === 'insufficient').map((i) => `${i.name} (fehlt: ${formatAmount(i.toBuy, i.unit)})`);
  const miss = main.filter((i) => i.status === 'missing').map((i) => i.name);
  const check = main.filter((i) => i.status === 'check').map((i) => i.name);
  const row = (label, list, cls, ic) => (list.length ? h('p', { class: `ing-row ing-${cls}` }, icon(ic, { size: 14 }), h('strong', {}, `${label}: `), list.join(', ')) : null);
  return h('div', { class: 'ing-summary' },
    row('Vorhanden', have, 'ok', 'check'),
    row('Zu wenig', low, 'warn', 'alert'),
    row('Fehlt', miss, 'bad', 'x'),
    row('Menge bitte prüfen', check, 'warn', 'info'));
}

/**
 * Rezeptkarte.
 * @param {object} a Analyse aus recipes.analyzeRecipe
 */
export function recipeCard(a, { mode = 'discover', servings = null, onFavorite = null } = {}) {
  const r = a.recipe;
  const n = r.nutritionPerServing;
  const s = servings ?? r.defaultServings;
  const detailHref = routeHref(`rezept/${encodeURIComponent(r.id)}${s ? `?portionen=${s}` : ''}`);
  const ev = a.evaluation;
  const card = h('article', { class: 'card recipe-card', 'aria-labelledby': `t-${r.id}` });
  const head = h('div', { class: 'card-head' },
    recipeVisual(r),
    h('div', { class: 'card-head-text' },
      h('h3', { class: 'card-title', id: `t-${r.id}` }, h('a', { href: detailHref }, r.title)),
      h('p', { class: 'meta' },
        h('span', {}, icon('clock', { size: 14 }), ` ${fmtMinutes(r.totalMinutes)}`),
        h('span', {}, ` · ${s} ${s === 1 ? 'Portion' : 'Portionen'}`),
        h('span', {}, ` · ${fmtKcal(n?.kcal)}/Portion`),
        h('span', {}, ` · ${fmtGram(n?.protein, 'Protein')}`))),
    onFavorite ? favoriteButton(r, onFavorite) : null);
  card.append(head);

  if (a.check.status === 'excluded') {
    card.classList.add('is-excluded');
    card.append(h('p', { class: 'notice notice-error' }, icon('x', { size: 16 }), h('span', {}, h('strong', {}, 'Ausgeschlossen: '), a.check.reasons.join(' · '))));
    return card;
  }
  if (a.check.status === 'unknown') {
    card.append(h('p', { class: 'notice notice-warn' }, icon('alert', { size: 16 }), h('span', {}, h('strong', {}, 'Allergendaten unvollständig: '), 'Dieses Rezept wird nicht als passend für deine Allergien oder Ernährungsweise eingestuft. Bitte Zutaten selbst prüfen.')));
  }

  const matchLabel = mode === 'pantry'
    ? h('p', { class: 'match' }, h('strong', {}, `${ev.matchPercent} % Übereinstimmung`), ev.fullyCookable ? ' – vollständig kochbar' : ` – ${ev.missingCount} ${ev.missingCount === 1 ? 'Zutat fehlt' : 'Zutaten fehlen'}`)
    : h('p', { class: 'match' }, `Du hast bereits ${ev.counts.available} von ${ev.counts.total} benötigten Zutaten.`);
  card.append(h('div', { class: 'match-row' }, matchLabel, a.score ? h('span', { class: 'score', title: 'Persönliche Bewertung (max. 100 Punkte)' }, `${a.score.total}/100 Punkte`) : null));
  const bar = h('span', {});
  bar.style.width = `${Math.max(0, Math.min(100, ev.matchPercent))}%`;
  const meter = h('div', { class: 'meter', role: 'img', 'aria-label': `${ev.matchPercent} Prozent der Zutaten vorhanden` }, bar);
  card.append(meter);
  card.append(tagList(r.dietaryTags));
  if (a.check.substitutions.length) {
    card.append(h('p', { class: 'small' }, icon('info', { size: 14 }), ` Mit Alternative: ${a.check.substitutions.map((x) => `${x.to} statt ${x.from}`).join(', ')}`));
  }
  if (mode === 'pantry') card.append(ingredientSummary(ev));
  if (a.text && mode === 'pantry') card.append(h('p', { class: 'small muted' }, a.text));
  if (r.nutritionStatus !== 'provided') card.append(h('p', { class: 'small muted' }, icon('info', { size: 14 }), ' Nährwerte geschätzt'));
  card.append(h('div', { class: 'card-actions' }, h('a', { class: 'btn btn-secondary', href: detailHref }, 'Rezept ansehen')));
  return card;
}

export function filterChips(filterIds, filters, active, onChange) {
  return h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter' }, ...filterIds.map((id) => chip(filters[id].label, active.has(id), () => {
    if (active.has(id)) active.delete(id); else active.add(id);
    onChange();
  })));
}

export function pageHeader(title, lead = null, ...extra) {
  return h('header', { class: 'page-header' }, h('h1', { tabindex: '-1', id: 'page-title' }, title), lead ? h('p', { class: 'lead' }, lead) : null, ...extra);
}

export function section(title, ...children) {
  const id = `s-${Math.random().toString(36).slice(2, 8)}`;
  return h('section', { class: 'section', 'aria-labelledby': id }, h('h2', { id }, title), ...children);
}
