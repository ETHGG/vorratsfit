// views/recipeDetailView.js – Rezeptdetail mit Portionsskalierung, Vorratsabgleich, Einkaufsvorschau.
import { h, clear, stepper, icon, dialog, toast, withBusy, emptyState, fmtMinutes, confirmDialog, errorBox } from './dom.js';
import { pageHeader, section, statusBadge, tagList, estimateNote, allergyDisclaimer, favoriteButton, recipeArt } from './components.js';
import { state, analysisContext, refreshFavorites, shoppingContext, refreshRecipes, refreshPhotos } from './state.js';
import { setPhoto, removePhoto } from '../photos.js';
import { shrinkPhoto } from './photo-input.js';
import { routeHref, navigate } from './router.js';
import { analyzeRecipe, toggleFavorite, deleteCustomRecipe, deleteCachedRecipe } from '../recipes.js';
import { previewAddRecipe, addRecipeToShopping } from '../shopping.js';
import { addPlanEntry, listAllPlan, cookUnplanned } from '../planner.js';
import { cookWithPreview } from './todayView.js';
import { planConsumption } from '../core/cooking.js';
import { planLabel } from '../core/demand.js';
import { checkRecipe, recipeAllergens } from '../core/restrictions.js';
import { planDialog, planMealPrep } from './plannerView.js';
import { formatAmount } from '../units.js';
import { nutritionStatusLabel, confidenceLabel } from '../nutrition.js';
import { allergenLabel, deviceLabel, mealTypeLabel } from '../core/models.js';

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
    cookBtn.addEventListener('click', () => withBusy(cookBtn, () => cooked()));
    const planBtn = h('button', { type: 'button', class: 'btn' }, icon('calendar', { size: 18 }), ' Zum Plan hinzufügen');
    planBtn.addEventListener('click', () => withBusy(planBtn, async () => {
      const input = await planDialog({ title: 'Zum Wochenplan hinzufügen', fixedRecipe: recipe, servings });
      if (!input) return;
      const res = await addPlanEntry(input, shoppingContext());
      if (!res.ok) { toast(Object.values(res.errors).join(' '), 'error'); return; }
      toast(res.warning ? `Eingeplant. Hinweis: ${res.warning}` : 'Zum Wochenplan hinzugefügt.', res.warning ? 'warn' : 'success');
    }));
    const prepBtn = h('button', { type: 'button', class: 'btn' }, '🥡 Meal Prep planen');
    prepBtn.addEventListener('click', () => withBusy(prepBtn, () => planMealPrep(recipe)));
    actionsBox.append(shopBtn, planBtn, prepBtn, cookBtn);
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

  async function cooked() {
    // Gibt es passende, noch nicht gekochte Plan-Einträge? Dann fragen, welcher gekocht wurde (CLAUDE.md 4.2).
    const planned = (await listAllPlan()).filter((e) => e.recipeId === recipe.id && !e.cooked && e.date).sort((x, y) => x.date.localeCompare(y.date));
    const seen = new Set();
    const options = planned.filter((e) => { const k = e.mealPrepGroupId ?? e.id; if (seen.has(k)) return false; seen.add(k); return true; });
    let target = null;
    if (options.length) {
      const sel = h('select', { name: 'planEntry' },
        ...options.map((e) => h('option', { value: e.id }, `${planLabel(e.date, e.mealType)} – ${e.mealPrepGroupId ? `Meal Prep, ${e.mealPrepCount} Boxen` : `${e.servings} ${e.servings === 1 ? 'Portion' : 'Portionen'}`}`)),
        h('option', { value: '' }, `Ohne Plan-Eintrag (${servings} ${servings === 1 ? 'Portion' : 'Portionen'})`));
      const c = await dialog({ title: 'Welche Mahlzeit hast du gekocht?', body: [h('p', {}, 'Dieses Rezept steht in deinem Wochenplan. Der gewählte Eintrag wird als gekocht markiert und nicht erneut eingekauft.'), sel], buttons: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Weiter', value: 'ok', variant: 'primary' }], dismissValue: 'cancel' });
      if (c !== 'ok') return;
      target = options.find((e) => e.id === sel.value) ?? null;
    }
    if (target) {
      const total = target.mealPrepGroupId ? planned.filter((e) => e.mealPrepGroupId === target.mealPrepGroupId).reduce((sum, e) => sum + e.servings, 0) : target.servings;
      if (await cookWithPreview(target, total)) { ctx = await analysisContext(servings); draw(); }
      return;
    }
    const prev = planConsumption(checkRecipe(recipe, state.profile, state.catalog).effectiveRecipe, servings, ctx.pantry, state.catalog);
    if (!prev.consumptions.length) { toast('Keine passenden Vorratsmengen zum Abziehen gefunden.'); return; }
    const msg = [`Folgende Mengen werden abgezogen: ${prev.consumptions.map((p) => `${formatAmount(p.amount, p.unit)} ${p.name}`).join(', ')}.`];
    if (prev.missing.length) msg.push(`Nicht im Vorrat: ${prev.missing.map((m) => m.name).join(', ')}.`);
    if (prev.unchecked.length) msg.push(`Menge bitte prüfen (nicht abgezogen): ${prev.unchecked.map((u) => u.name).join(', ')}.`);
    msg.push('Gewürze bleiben unverändert.');
    if (!(await confirmDialog('Aus Vorrat abziehen?', msg.join(' '), { confirmLabel: 'Abziehen' }))) return;
    try {
      await cookUnplanned(recipe, servings, shoppingContext());
      toast('Vorrat aktualisiert. Guten Appetit!', 'success');
    } catch (err) { toast(`Nicht gespeichert: ${err.message}`, 'error'); }
    ctx = await analysisContext(servings);
    draw();
  }

  const r = recipe;
  const al = recipeAllergens(r, state.catalog);
  const favHolder = h('span', {});
  const drawFav = () => { clear(favHolder); favHolder.append(favoriteButton(r, async () => { await toggleFavorite(r); await refreshFavorites(); drawFav(); })); };
  drawFav();
  // 0.7.3: Kamera-Knopf direkt auf dem Bild (statt eigener Abschnitt ganz unten)
  const hasPhoto = !!state.photos.get(r.id);
  const pin = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'photo-input', id: 'photo-change', 'aria-label': 'Foto für dieses Rezept wählen' });
  pin.addEventListener('change', async () => {
    try {
      const photo = pin.files?.[0] ? await shrinkPhoto(pin.files[0]) : null;
      if (!photo) return;
      await setPhoto(r.id, photo);
      await refreshPhotos();
      toast('Foto gespeichert. 📸', 'success');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch (err) { toast(err.message, 'error'); }
  });
  const rmPhoto = hasPhoto ? h('button', { type: 'button', class: 'photo-chip' }, 'Foto entfernen') : null;
  rmPhoto?.addEventListener('click', async () => { await removePhoto(r.id); await refreshPhotos(); toast('Foto entfernt.'); window.dispatchEvent(new HashChangeEvent('hashchange')); });
  const visual = h('div', { class: 'hero-wrap' }, recipeArt(r, 'detail-emoji'),
    h('div', { class: 'photo-actions' }, h('label', { for: 'photo-change', class: 'photo-chip photo-btn' }, hasPhoto ? '📷 Foto ändern' : '📷 Eigenes Foto'), rmPhoto), pin);
  const sourceInfo = h('p', { class: 'small' }, `Datenquelle: ${r.source}. Lizenz: ${r.license}.`, r.sourceUrl ? h('span', {}, ' ', h('a', { href: r.sourceUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Originalrezept öffnen')) : null);

  container.append(
    backLink(),
    visual,
    pageHeader(r.title, r.description || null, favHolder),
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
    section('Zubereitung',
      r.instructions.length ? h('a', { class: 'btn btn-primary cook-start', href: routeHref(`kochen/${encodeURIComponent(r.id)}?portionen=${servings}`) }, icon('pot', { size: 18 }), ' Kochmodus starten') : null,
      r.instructions.length ? h('ol', { class: 'steps' }, ...r.instructions.map((s) => h('li', {}, s))) : h('p', {}, 'Keine Zubereitungsschritte hinterlegt.')),
    section('Nährwerte pro Portion', nutritionTable(r)),
    section('Allergene',
      al.tags.length ? h('p', {}, `Laut Zutatenstammdaten enthalten: ${al.tags.map(allergenLabel).join(', ')}.`) : h('p', {}, al.complete ? 'In den hinterlegten Zutatenstammdaten sind keine der 14 Hauptallergene vermerkt.' : 'Keine Allergenangaben vorhanden.'),
      !al.complete ? h('p', { class: 'notice notice-warn' }, icon('alert', { size: 16 }), 'Die Allergendaten sind unvollständig. Fehlende Angaben bedeuten nicht, dass das Rezept allergenfrei ist.') : null,
      allergyDisclaimer()),
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
