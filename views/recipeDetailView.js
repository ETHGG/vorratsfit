// views/recipeDetailView.js – Rezeptdetail mit Portionsskalierung, Vorratsabgleich, Einkaufsvorschau.
import { h, clear, stepper, icon, dialog, toast, withBusy, emptyState, fmtMinutes, confirmDialog, errorBox } from './dom.js';
import { pageHeader, section, statusBadge, tagList, estimateNote, allergyDisclaimer, favoriteButton } from './components.js';
import { state, analysisContext, refreshFavorites, shoppingContext, refreshRecipes } from './state.js';
import { routeHref, navigate } from './router.js';
import { analyzeRecipe, toggleFavorite, deleteCustomRecipe, deleteCachedRecipe } from '../recipes.js';
import { previewAddRecipe, addRecipeToShopping } from '../shopping.js';
import { consumeFromPantry } from '../pantry.js';
import { formatAmount, convertWithIngredient, roundQuantity } from '../units.js';
import { nutritionStatusLabel, confidenceLabel } from '../nutrition.js';
import { allergenLabel, deviceLabel, mealTypeLabel } from '../core/models.js';
import { recipeAllergens } from '../core/restrictions.js';
import { ingredientKey, catalogEntryFor } from '../core/catalog.js';

function nutritionTable(r) {
  const n = r.nutritionPerServing;
  if (!n) {
    return h('p', { class: 'notice notice-warn' }, icon('info', { size: 16 }), 'Für dieses Rezept liegen nicht genug Nährwertdaten vor. Fehlende Werte werden nicht als 0 angezeigt.');
  }
  const fmt = (v, unit, d = 1) => (typeof v === 'number' && Number.isFinite(v) ? `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: d }).format(v)} ${unit}` : 'unbekannt');
  const rows = [['Energie', fmt(n.kcal, 'kcal', 0)], ['Protein', fmt(n.protein, 'g')], ['Kohlenhydrate', fmt(n.carbs, 'g')], ['Fett', fmt(n.fat, 'g')], ['Ballaststoffe', fmt(n.fiber, 'g')], ['Zucker', fmt(n.sugar, 'g')], ['Salz', fmt(n.salt, 'g', 2)]];
  return h('div', {},
    h('table', { class: 'nutri' }, h('caption', { class: 'sr-only' }, 'Nährwerte pro Portion'),
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Nährwert'), h('th', { scope: 'col' }, 'pro Portion'))),
      h('tbody', {}, ...rows.map(([k, v]) => h('tr', {}, h('th', { scope: 'row' }, k), h('td', {}, v))))),
    h('p', { class: 'small' }, `Herkunft: ${nutritionStatusLabel(r.nutritionStatus)} · Sicherheit: ${confidenceLabel(r.nutritionConfidence)}${typeof r.nutritionCoverage === 'number' ? ` · Datenabdeckung: ${Math.round(r.nutritionCoverage * 100)} %` : ''}. Gewürze sind nicht enthalten.`),
    estimateNote(r));
}

function backLink() {
  const b = h('button', { type: 'button', class: 'btn btn-link' }, '← Zurück');
  b.addEventListener('click', () => { if (history.length > 1) history.back(); else navigate('entdecken'); });
  return h('p', {}, b);
}

export async function render(container, { id, params }) {
  const recipe = state.recipesById.get(id);
  if (!recipe) {
    container.append(emptyState('Rezept nicht gefunden', 'Das Rezept existiert nicht (mehr).', h('a', { class: 'btn btn-primary', href: routeHref('entdecken') }, 'Zu den Rezepten')));
    return;
  }
  const requested = Number.parseInt(params.get('portionen') ?? '', 10);
  let servings = Number.isInteger(requested) && requested >= 1 && requested <= 50 ? requested : (state.settings?.defaultServings ?? recipe.defaultServings);
  let ctx = await analysisContext(servings);
  const ingBox = h('div', { 'aria-live': 'polite' });
  const actionsBox = h('div', { class: 'form-actions' });

  function ingredientsList(a) {
    const list = (items) => h('ul', { class: 'ing-list' }, ...items.map((i) => h('li', { class: 'ing-item' },
      h('span', { class: 'ing-amount' }, typeof i.amount === 'number' ? formatAmount(i.amount, i.unit) : (i.rawMeasure ? `${i.rawMeasure} (Menge bitte prüfen)` : 'Menge bitte prüfen')),
      h('span', { class: 'ing-name' }, i.name, i.substitutedFrom ? h('span', { class: 'small muted' }, ` (statt ${i.substitutedFrom})`) : null, i.optional ? h('span', { class: 'small muted' }, ' (optional)') : null),
      statusBadge(i.status),
      i.status === 'insufficient' ? h('span', { class: 'small' }, ` vorhanden: ${formatAmount(i.available, i.unit)}`) : null,
      i.substitute ? h('span', { class: 'small' }, ` Ersatz: ${i.substitute}`) : null)));
    const main = a.evaluation.items.filter((i) => !i.isSpice);
    const spices = a.evaluation.items.filter((i) => i.isSpice);
    return h('div', {},
      h('h3', {}, `Zutaten für ${servings} ${servings === 1 ? 'Person' : 'Personen'}`), list(main),
      spices.length ? h('h3', {}, 'Gewürze') : null, spices.length ? list(spices) : null,
      a.check.omitted.length ? h('p', { class: 'small' }, `Weggelassen (optional, passt nicht zu deinem Profil): ${a.check.omitted.join(', ')}`) : null,
      a.check.substitutions.length ? h('p', { class: 'notice notice-info' }, icon('info', { size: 16 }), h('span', {}, `Hinterlegte Alternativen für dein Profil: ${a.check.substitutions.map((s) => `${s.to} statt ${s.from} (${s.reason})`).join('; ')}.`)) : null);
  }

  function draw() {
    const a = analyzeRecipe(recipe, { ...ctx, servings });
    clear(ingBox);
    ingBox.append(ingredientsList(a));
    clear(actionsBox);
    if (a.check.status === 'excluded') {
      actionsBox.append(h('p', { class: 'notice notice-error' }, icon('x', { size: 16 }), h('span', {}, h('strong', {}, 'Ausgeschlossen: '), a.check.reasons.join(' · '), '. Dieses Rezept wird nicht zur Einkaufsliste hinzugefügt.')));
      return;
    }
    if (a.check.status === 'unknown') {
      actionsBox.append(h('p', { class: 'notice notice-warn' }, icon('alert', { size: 16 }), 'Allergen- oder Zutatendaten sind unvollständig. Bitte prüfe alle Zutaten selbst, bevor du kochst.'));
    }
    const shopBtn = h('button', { type: 'button', class: 'btn btn-primary' }, icon('cart', { size: 18 }), ' Fehlende Zutaten prüfen');
    shopBtn.addEventListener('click', () => withBusy(shopBtn, () => openShoppingPreview()));
    const cookBtn = h('button', { type: 'button', class: 'btn' }, icon('pot', { size: 18 }), ' Gekocht – aus Vorrat abziehen');
    cookBtn.addEventListener('click', () => withBusy(cookBtn, () => cooked(a)));
    actionsBox.append(shopBtn, cookBtn);
  }

  async function openShoppingPreview() {
    const pv = await previewAddRecipe(recipe, servings, shoppingContext());
    const amountTxt = (p) => (typeof p.amountToBuy === 'number' ? formatAmount(p.amountToBuy, p.unit) : 'Menge bitte prüfen');
    const body = [
      h('p', {}, h('strong', {}, `Für ${servings} ${servings === 1 ? 'Person' : 'Personen'}`)),
      pv.alreadySelected ? h('p', { class: 'small' }, 'Dieses Rezept ist bereits ausgewählt; die Portionszahl wird aktualisiert.') : null,
      h('h3', {}, 'Bereits ausreichend vorhanden'),
      pv.sufficient.length ? h('ul', {}, ...pv.sufficient.map((p) => h('li', {}, icon('check', { size: 14 }), ` ${p.name}`))) : h('p', { class: 'small' }, '–'),
      h('h3', {}, 'Noch benötigt'),
      pv.needed.length ? h('ul', {}, ...pv.needed.map((p) => h('li', {}, `${amountTxt(p)} ${p.name}`, p.recipeSources.length > 1 ? h('span', { class: 'small muted' }, ` (gesamt für ${p.recipeSources.length} Rezepte)`) : null))) : h('p', { class: 'small' }, 'Nichts – du hast alles im Vorrat.'),
      pv.check.length ? h('h3', {}, 'Menge bitte prüfen') : null,
      pv.check.length ? h('ul', {}, ...pv.check.map((p) => h('li', {}, `${p.name} – Menge bitte prüfen`))) : null,
    ];
    const choice = await dialog({ title: 'Einkaufsliste – Vorschau', body, buttons: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Fehlende Zutaten hinzufügen', value: 'add', variant: 'primary' }], dismissValue: 'cancel' });
    if (choice !== 'add') return;
    try {
      const res = await addRecipeToShopping(recipe, servings, shoppingContext());
      toast(`Einkaufsliste aktualisiert: ${res.added} neu, ${res.updated} angepasst.`, 'success');
    } catch (err) {
      toast(`Fehler: ${err.message}`, 'error');
    }
  }

  async function cooked(a) {
    const index = new Map();
    for (const p of ctx.pantry) {
      const k = ingredientKey(p, state.catalog);
      if (!index.has(k)) index.set(k, []);
      index.get(k).push(p);
    }
    const plan = [];
    for (const it of a.evaluation.items) {
      if (it.isSpice || typeof it.amount !== 'number') continue;
      let rest = it.amount;
      const entry = catalogEntryFor(it, state.catalog);
      for (const p of (index.get(it.key) ?? []).filter((x) => x.amount > 0)) {
        if (rest <= 0) break;
        const availInRecipeUnit = convertWithIngredient(p.amount, p.unit, it.unit, entry);
        if (availInRecipeUnit === null) continue;
        const take = Math.min(rest, availInRecipeUnit);
        const takeInPantryUnit = convertWithIngredient(take, it.unit, p.unit, entry);
        if (takeInPantryUnit === null) continue;
        plan.push({ pantryId: p.id, amount: roundQuantity(takeInPantryUnit), name: p.name, unit: p.unit });
        rest -= take;
      }
    }
    if (!plan.length) { toast('Keine passenden Vorratsmengen zum Abziehen gefunden.'); return; }
    const ok = await confirmDialog('Aus Vorrat abziehen?', `Folgende Mengen werden abgezogen: ${plan.map((p) => `${formatAmount(p.amount, p.unit)} ${p.name}`).join(', ')}. Gewürze bleiben unverändert.`, { confirmLabel: 'Abziehen' });
    if (!ok) return;
    await consumeFromPantry(plan);
    toast('Vorrat aktualisiert. Guten Appetit!', 'success');
    ctx = await analysisContext(servings);
    draw();
  }

  const r = recipe;
  const al = recipeAllergens(r, state.catalog);
  const favHolder = h('span', {});
  const drawFav = () => { clear(favHolder); favHolder.append(favoriteButton(r, async () => { await toggleFavorite(r); await refreshFavorites(); drawFav(); })); };
  drawFav();
  const visual = r.imageUrl && state.settings?.externalImages && state.online
    ? h('img', { class: 'detail-img', src: r.imageUrl, alt: `Foto: ${r.title}`, referrerpolicy: 'no-referrer', loading: 'lazy' })
    : h('div', { class: 'detail-emoji', 'aria-hidden': 'true' }, r.emoji || '🍽️');

  const sourceInfo = h('p', { class: 'small' }, `Datenquelle: ${r.source}. Lizenz: ${r.license}.`, r.sourceUrl ? h('span', {}, ' ', h('a', { href: r.sourceUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Originalrezept öffnen')) : null);

  container.append(
    backLink(),
    pageHeader(r.title, r.description || null, favHolder),
    visual,
    h('dl', { class: 'facts' },
      h('div', {}, h('dt', {}, 'Mahlzeit'), h('dd', {}, mealTypeLabel(r.mealType))),
      h('div', {}, h('dt', {}, 'Vorbereitung'), h('dd', {}, fmtMinutes(r.preparationMinutes))),
      h('div', {}, h('dt', {}, 'Kochzeit'), h('dd', {}, fmtMinutes(r.cookingMinutes))),
      h('div', {}, h('dt', {}, 'Gesamtzeit'), h('dd', {}, fmtMinutes(r.totalMinutes))),
      h('div', {}, h('dt', {}, 'Schwierigkeit'), h('dd', {}, r.difficulty)),
      h('div', {}, h('dt', {}, 'Geräte'), h('dd', {}, r.devices.length ? r.devices.map(deviceLabel).join(', ') : 'keine besonderen'))),
    tagList(r.dietaryTags, 20),
    section('Portionen', stepper({ value: servings, onChange: (v) => { servings = v; history.replaceState(null, '', routeHref(`rezept/${encodeURIComponent(r.id)}?portionen=${v}`)); draw(); } }), h('p', { class: 'small muted' }, `Originalrezept für ${r.defaultServings} ${r.defaultServings === 1 ? 'Person' : 'Personen'}. Mengen werden vor dem Vorratsvergleich skaliert.`)),
    section('Zutaten und Vorrat', ingBox, actionsBox),
    section('Allergene',
      al.tags.length ? h('p', {}, `Laut Zutatenstammdaten enthalten: ${al.tags.map(allergenLabel).join(', ')}.`) : h('p', {}, al.complete ? 'In den hinterlegten Zutatenstammdaten sind keine der 14 Hauptallergene vermerkt.' : 'Keine Allergenangaben vorhanden.'),
      !al.complete ? h('p', { class: 'notice notice-warn' }, icon('alert', { size: 16 }), 'Die Allergendaten sind unvollständig. Fehlende Angaben bedeuten nicht, dass das Rezept allergenfrei ist.') : null,
      allergyDisclaimer()),
    section('Zubereitung', r.instructions.length ? h('ol', { class: 'steps' }, ...r.instructions.map((s) => h('li', {}, s))) : h('p', {}, 'Keine Zubereitungsschritte hinterlegt.')),
    section('Nährwerte pro Portion', nutritionTable(r)),
    section('Quelle', sourceInfo),
  );
  if (r.origin === 'custom' || r.origin === 'external') {
    const del = h('button', { type: 'button', class: 'btn btn-danger' }, icon('trash', { size: 16 }), r.origin === 'custom' ? ' Eigenes Rezept löschen' : ' Gespeichertes Rezept entfernen');
    del.addEventListener('click', async () => {
      if (!(await confirmDialog('Rezept entfernen?', `„${r.title}“ wird von diesem Gerät entfernt.`, { confirmLabel: 'Entfernen', danger: true }))) return;
      try {
        if (r.origin === 'custom') await deleteCustomRecipe(r.id);
        else await deleteCachedRecipe(r.id);
        await refreshRecipes();
        toast('Rezept entfernt.');
        navigate('entdecken');
      } catch (err) { container.append(errorBox(err.message)); }
    });
    container.append(h('div', { class: 'form-actions' }, del));
  }
  draw();
}
