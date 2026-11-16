// views/pantryMatchView.js – „Aus meinem Vorrat“: Was kann ich mit meinen vorhandenen Lebensmitteln kochen?
import { h, clear, stepper, emptyState, select, field } from './dom.js';
import { pageHeader, recipeCard, filterChips, allergyDisclaimer } from './components.js';
import { state, analysisContext, refreshFavorites } from './state.js';
import { routeHref } from './router.js';
import { analyzeAll, applyFilters, sortAnalyses, RECIPE_FILTERS, PANTRY_PAGE_FILTERS, toggleFavorite } from '../recipes.js';

export async function render(container) {
  const active = new Set();
  let servings = state.pantryServings ?? state.settings?.defaultServings ?? 2;
  let sortKey = 'recommended';
  const results = h('div', { class: 'card-list', 'aria-live': 'polite' });
  const excludedBox = h('div', {});
  const ctx = await analysisContext(servings);

  const sortSel = select('sort', [{ id: 'recommended', label: 'persönlich empfohlen' }, { id: 'pantry', label: 'Vorratsübereinstimmung' }, { id: 'missing', label: 'wenigste fehlende Zutaten' }, { id: 'protein', label: 'Protein absteigend' }, { id: 'kcal', label: 'Kalorien aufsteigend' }, { id: 'time', label: 'Zeit aufsteigend' }], sortKey);
  sortSel.addEventListener('change', () => { sortKey = sortSel.value; draw(); });

  function draw() {
    clear(results);
    clear(excludedBox);
    if (!ctx.pantry.some((p) => p.amount > 0)) {
      results.append(emptyState('Noch keine Vorräte erfasst', 'Trage zuerst ein, was du zu Hause hast. Danach zeigt dir VorratsFit passende Rezepte.', h('a', { class: 'btn btn-primary', href: routeHref('vorrat') }, 'Vorrat erfassen')));
      return;
    }
    const all = analyzeAll(state.recipes, { ...ctx, servings });
    const allowed = all.filter((a) => a.check.status === 'ok');
    const blocked = all.filter((a) => a.check.status !== 'ok');
    // Nur Rezepte mit mindestens einer vorhandenen Hauptzutat sind „aus dem Vorrat“ relevant
    const relevant = allowed.filter((a) => a.evaluation.counts.available + a.evaluation.counts.insufficient > 0);
    const shown = sortAnalyses(applyFilters(relevant, Array.from(active)), sortKey);
    results.append(h('p', { class: 'small muted' }, `${shown.length} passende ${shown.length === 1 ? 'Rezept' : 'Rezepte'} für ${servings} ${servings === 1 ? 'Person' : 'Personen'}`));
    if (!shown.length) results.append(emptyState('Keine passenden Rezepte', active.size ? 'Entferne einzelne Filter oder ergänze deinen Vorrat.' : 'Mit deinem aktuellen Vorrat passt noch kein Rezept. Ergänze weitere Lebensmittel.'));
    shown.forEach((a) => results.append(recipeCard(a, {
      mode: 'pantry', servings,
      onFavorite: async () => { await toggleFavorite(a.recipe); await refreshFavorites(); draw(); },
    })));
    if (blocked.length) {
      const list = h('ul', { class: 'plain-list excluded-list' }, ...blocked.map((a) => h('li', {}, h('strong', {}, a.recipe.title), ': ', a.check.status === 'unknown' ? 'Allergen- oder Zutatendaten unvollständig' : a.check.reasons[0])));
      excludedBox.append(h('details', { class: 'excluded' }, h('summary', {}, `${blocked.length} ${blocked.length === 1 ? 'Rezept wurde' : 'Rezepte wurden'} wegen Allergien, Unverträglichkeiten oder Ernährungsweise ausgeschlossen`), list));
    }
  }

  container.append(
    pageHeader('Aus meinem Vorrat', 'Was kann ich mit meinen vorhandenen Lebensmitteln kochen?'),
    h('div', { class: 'toolbar' },
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Für wie viele Personen?'), stepper({ value: servings, onChange: (v) => { servings = v; state.pantryServings = v; draw(); } })),
      field({ label: 'Sortierung', input: sortSel })),
    filterChips(PANTRY_PAGE_FILTERS, RECIPE_FILTERS, active, draw),
    results,
    excludedBox,
    allergyDisclaimer(),
  );
  draw();
}
