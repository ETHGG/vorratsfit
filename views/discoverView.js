// views/discoverView.js – „Rezepte entdecken“: Was möchte ich kochen? (unabhängig vom Vorrat)
import { h, clear, select, field, emptyState, withBusy, errorBox, toast, icon } from './dom.js';
import { pageHeader, recipeCard, filterChips, section, allergyDisclaimer, recipeTabs } from './components.js';
import { state, analysisContext, refreshFavorites, refreshRecipes } from './state.js';
import { routeHref } from './router.js';
import { analyzeAll, applyFilters, sortAnalyses, RECIPE_FILTERS, DISCOVER_FILTERS, SORT_OPTIONS, toggleFavorite } from '../recipes.js';
import { searchMealDb, cacheExternalRecipe, EXTERNAL_RECIPE_NOTICE } from '../api.js';

export async function render(container, { favoritesOnly = false } = {}) {
  const active = new Set();
  let query = '';
  let sortKey = 'recommended';
  let showExcluded = false;
  const ctx = await analysisContext(null);
  const results = h('div', { class: 'card-list', 'aria-live': 'polite' });

  const search = h('input', { type: 'search', name: 'q', placeholder: favoritesOnly ? 'Favoriten durchsuchen' : 'z. B. Hähnchen, Curry, Linsen', autocomplete: 'off' });
  let t = null;
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { query = search.value; draw(); }, 150); });
  const sortSel = select('sort', Object.entries(SORT_OPTIONS).map(([id, o]) => ({ id, label: o.label })), sortKey);
  sortSel.addEventListener('change', () => { sortKey = sortSel.value; draw(); });

  function draw() {
    clear(results);
    let recipes = state.recipes;
    if (favoritesOnly) recipes = recipes.filter((r) => state.favorites.has(r.id));
    if (favoritesOnly && !recipes.length) {
      results.append(emptyState('Noch keine Favoriten', 'Markiere Rezepte mit dem Herz-Symbol, um sie hier offline wiederzufinden.', h('a', { class: 'btn btn-primary', href: routeHref('entdecken') }, 'Rezepte entdecken'), 'rezepte'));
      return;
    }
    const all = analyzeAll(recipes, ctx);
    const filtered = sortAnalyses(applyFilters(all, Array.from(active), query), sortKey);
    const allowed = filtered.filter((a) => a.check.status !== 'excluded');
    const excluded = filtered.filter((a) => a.check.status === 'excluded');
    results.append(h('p', { class: 'small muted' }, `${allowed.length} ${allowed.length === 1 ? 'Rezept' : 'Rezepte'}`));
    if (!allowed.length) results.append(emptyState('Keine Rezepte gefunden', 'Passe Suche oder Filter an.'));
    const onFav = (a) => async () => { await toggleFavorite(a.recipe); await refreshFavorites(); draw(); };
    allowed.forEach((a) => results.append(recipeCard(a, { mode: 'discover', onFavorite: onFav(a) })));
    if (excluded.length) {
      const toggle = h('button', { type: 'button', class: 'btn btn-link', 'aria-expanded': String(showExcluded) }, showExcluded ? 'Ausgeschlossene Rezepte ausblenden' : `${excluded.length} wegen Allergien oder Ernährungsweise ausgeschlossene Rezepte anzeigen`);
      toggle.addEventListener('click', () => { showExcluded = !showExcluded; draw(); });
      results.append(h('div', { class: 'excluded' }, toggle));
      if (showExcluded) excluded.forEach((a) => results.append(recipeCard(a, { mode: 'discover' })));
    }
  }

  container.append(
    favoritesOnly
      ? pageHeader('Favoriten', 'Deine gemerkten Rezepte – lokal gespeichert und offline verfügbar.')
      : pageHeader('Rezepte entdecken', 'Was möchte ich kochen?'),
    recipeTabs(favoritesOnly ? 'favoriten' : 'entdecken'),
    h('div', { class: 'toolbar' }, field({ label: 'Suche', input: search }), field({ label: 'Sortierung', input: sortSel })),
    filterChips(DISCOVER_FILTERS, RECIPE_FILTERS, active, draw),
    results,
  );
  if (!favoritesOnly) {
    container.append(h('p', {}, h('a', { class: 'btn', href: routeHref('eigenes-rezept') }, icon('plus', { size: 16 }), ' Eigenes Rezept anlegen')));
    container.append(onlineSection(draw));
  }
  container.append(allergyDisclaimer());
  draw();
}

function onlineSection(redraw) {
  const box = h('div', {});
  if (!state.settings?.externalRecipes) {
    box.append(h('p', { class: 'small muted' }, 'Die Online-Suche bei TheMealDB ist ausgeschaltet. Du kannst sie in den Einstellungen aktivieren. Dabei wird nur der Suchbegriff übertragen.'));
    return section('Weitere Rezepte online', box);
  }
  const input = h('input', { type: 'search', name: 'online', placeholder: 'englischer Begriff, z. B. chicken', autocomplete: 'off', maxlength: '60' });
  const btn = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Online suchen');
  const out = h('div', { 'aria-live': 'polite' });
  const form = h('form', { class: 'toolbar', novalidate: true }, field({ label: 'Suchbegriff (TheMealDB)', input }), btn);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    withBusy(btn, async () => {
      clear(out);
      try {
        const list = await searchMealDb(input.value, state.catalog);
        if (!list.length) { out.append(h('p', {}, 'Keine Treffer.')); return; }
        out.append(h('ul', { class: 'plain-list' }, ...list.map((r) => {
          const save = h('button', { type: 'button', class: 'btn' }, state.recipesById.has(r.id) ? 'Aktualisieren' : 'Lokal speichern');
          save.addEventListener('click', () => withBusy(save, async () => {
            await cacheExternalRecipe(r);
            await refreshRecipes();
            toast(`„${r.title}“ gespeichert – jetzt auch offline verfügbar.`, 'success');
            redraw();
          }));
          return h('li', { class: 'online-item' }, h('span', {}, r.title, r.description ? h('span', { class: 'small muted' }, ` · ${r.description}`) : null), save);
        })));
      } catch (err) {
        out.append(errorBox(err.message));
      }
    });
  });
  box.append(h('p', { class: 'small' }, EXTERNAL_RECIPE_NOTICE), form, out, h('p', { class: 'small muted' }, 'Quelle: TheMealDB (themealdb.com). Gespeicherte Rezepte verlinken auf die Originalseite.'));
  return section('Weitere Rezepte online', box);
}
