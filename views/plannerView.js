// views/plannerView.js – Wochenplaner: Mahlzeiten pro Tag einplanen, verschieben, Portionen ändern, löschen.
import { h, clear, icon, dialog, toast, withBusy, confirmDialog, field, select, stepper, emptyState } from './dom.js';
import { pageHeader, section } from './components.js';
import { state, shoppingContext } from './state.js';
import { routeHref, navigate } from './router.js';
import { listPlan, listAllPlan, addPlanEntry, updatePlanEntry, deletePlanEntry, clearPlanRange, deleteMealPrepBox, addMealPrep } from '../planner.js';
import { previewShoppingRange, applyShoppingRange } from '../shopping.js';
import { formatAmount, formatNumber } from '../units.js';
import { weekStart, weekDays, formatDayLabel, formatWeekRange, canPlanRecipe, planEntryStatus, mealPrepShelfWarning, MIN_BOXES, MAX_BOXES } from '../core/plan-logic.js';
import { MEAL_TYPES } from '../core/models.js';
import { addDays, todayString, isValidDateString } from '../core/utils.js';
import { recipeNutritionFor } from '../core/day-balance.js';

/** Dialog zum Einplanen eines Rezepts. Gibt die Eingaben zurück oder null. */
export async function planDialog({ title, date, mealType, recipeId = null, servings = null, fixedRecipe = null }) {
  const recipes = [...state.recipes].sort((a, b) => a.title.localeCompare(b.title, 'de'));
  const recipeSel = fixedRecipe ? null : h('select', { name: 'recipeId' },
    h('option', { value: '' }, 'Bitte Rezept wählen'),
    ...recipes.map((r) => {
      const can = canPlanRecipe(r, state.profile, state.catalog);
      return h('option', { value: r.id, disabled: !can.allowed, selected: r.id === recipeId }, can.allowed ? r.title : `${r.title} – ausgeschlossen: ${can.reason}`);
    }));
  const dateIn = h('input', { type: 'date', name: 'date', value: date ?? todayString(), required: true });
  const mealSel = select('mealType', MEAL_TYPES, mealType ?? fixedRecipe?.mealType ?? 'mittagessen');
  const servIn = h('input', { type: 'number', name: 'servings', min: '1', max: '50', step: '1', inputmode: 'numeric', value: servings ?? fixedRecipe?.defaultServings ?? state.settings?.defaultServings ?? 2 });
  const warn = h('p', { class: 'small', 'aria-live': 'polite' });
  const showWarn = () => {
    const r = fixedRecipe ?? state.recipesById.get(recipeSel?.value);
    const can = r ? canPlanRecipe(r, state.profile, state.catalog) : null;
    warn.textContent = can?.warning ?? '';
  };
  recipeSel?.addEventListener('change', showWarn);
  showWarn();
  const choice = await dialog({
    title,
    body: [
      fixedRecipe ? h('p', {}, h('strong', {}, fixedRecipe.title)) : field({ label: 'Rezept', input: recipeSel }),
      field({ label: 'Tag', input: dateIn }),
      field({ label: 'Mahlzeit', input: mealSel }),
      field({ label: 'Portionen', input: servIn }),
      warn,
    ],
    buttons: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Einplanen', value: 'ok', variant: 'primary' }],
    dismissValue: 'cancel',
  });
  if (choice !== 'ok') return null;
  return { recipeId: fixedRecipe?.id ?? recipeSel.value, date: dateIn.value, mealType: mealSel.value, servings: servIn.value };
}

/** Dialog „Meal Prep planen“ für ein Rezept. Gibt die Eingaben zurück oder null. */
export async function mealPrepDialog(recipe) {
  const boxesIn = h('input', { type: 'number', name: 'boxes', min: String(MIN_BOXES), max: String(MAX_BOXES), step: '1', inputmode: 'numeric', value: '4' });
  const dateIn = h('input', { type: 'date', name: 'startDate', value: todayString() });
  const mealSel = select('mealType', MEAL_TYPES, recipe.mealType ?? 'mittagessen');
  const c = await dialog({
    title: `Meal Prep: ${recipe.title}`,
    body: [
      h('p', { class: 'small' }, 'Du kochst einmal und verteilst auf Boxen – eine Box (1 Portion) pro Tag ab dem Starttag. Eingekauft und gekocht wird alles auf einmal am Kochtag.'),
      field({ label: 'Anzahl Boxen', input: boxesIn, hint: `${MIN_BOXES} bis ${MAX_BOXES}. Vorgekochtes hält im Kühlschrank meist etwa 3 Tage.` }),
      field({ label: 'Kochtag / erste Box', input: dateIn }),
      field({ label: 'Mahlzeit', input: mealSel }),
    ],
    buttons: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Meal Prep planen', value: 'ok', variant: 'primary' }],
    dismissValue: 'cancel',
  });
  if (c !== 'ok') return null;
  return { recipeId: recipe.id, boxes: boxesIn.value, startDate: dateIn.value, mealType: mealSel.value };
}

export async function planMealPrep(recipe) {
  const input = await mealPrepDialog(recipe);
  if (!input) return null;
  const res = await addMealPrep(input, shoppingContext());
  if (!res.ok) { toast(Object.values(res.errors).join(' '), 'error'); return null; }
  toast(`Meal Prep geplant: ${res.entries.length} Boxen.`, 'success');
  return res;
}

function showErrors(errors) {
  toast(Object.values(errors).join(' '), 'error');
}

export async function render(container, { params }) {
  const requested = params?.get('start');
  let monday = weekStart(isValidDateString(requested) ? requested : todayString());
  const daysBox = h('div', { class: 'week', 'aria-live': 'polite' });
  const rangeLabel = h('p', { class: 'week-range' });
  let groups = new Map();

  async function reload() {
    const days = weekDays(monday);
    const entries = await listPlan(days[0], days[6]);
    groups = new Map();
    for (const e of (await listAllPlan()).filter((x) => x.mealPrepGroupId)) {
      if (!groups.has(e.mealPrepGroupId)) groups.set(e.mealPrepGroupId, []);
      groups.get(e.mealPrepGroupId).push(e);
    }
    clear(daysBox);
    rangeLabel.textContent = formatWeekRange(monday);
    if (!entries.length) daysBox.append(h('p', { class: 'notice notice-info' }, icon('info', { size: 16 }), h('span', {}, 'Noch nichts geplant. Tippe bei einem Tag auf „+“ – oder öffne ein Rezept und wähle „Zum Plan hinzufügen“.')));
    for (const d of days) daysBox.append(dayCard(d, entries.filter((e) => e.date === d)));
  }

  function entryRow(e) {
    const recipe = state.recipesById.get(e.recipeId);
    const st = planEntryStatus(e, state.recipesById, state.profile, state.catalog);
    const titleEl = recipe ? h('a', { href: routeHref(`rezept/${encodeURIComponent(e.recipeId)}?portionen=${e.servings}`) }, recipe.title) : h('span', {}, e.recipeTitle || 'Unbekanntes Rezept');
    const isBox = !!e.mealPrepGroupId;
    const shelf = isBox ? mealPrepShelfWarning(e, groups.get(e.mealPrepGroupId) ?? [e]) : null;
    const del = h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': `${e.recipeTitle || 'Eintrag'} am ${formatDayLabel(e.date)} entfernen` }, icon('trash'));
    del.addEventListener('click', () => withBusy(del, async () => {
      if (isBox) {
        const c = await dialog({
          title: 'Meal-Prep-Box entfernen',
          body: [h('p', {}, `Box ${e.mealPrepIndex}/${e.mealPrepCount}: Nur diese Box oder alle Boxen dieser Meal-Prep-Gruppe entfernen?`), e.cooked ? h('p', { class: 'small' }, 'Die Gruppe ist bereits gekocht – der Vorrat wird nicht zurückgebucht.') : h('p', { class: 'small' }, 'Der Einkaufsbedarf wird entsprechend verringert.')],
          buttons: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Nur diese Box', value: 'one' }, { label: 'Alle Boxen', value: 'all', variant: 'danger' }],
          dismissValue: 'cancel',
        });
        if (c !== 'one' && c !== 'all') return;
        const r = await deleteMealPrepBox(e.id, c, shoppingContext());
        toast(`${r.removed} ${r.removed === 1 ? 'Box' : 'Boxen'} entfernt.`);
      } else {
        await deletePlanEntry(e.id, shoppingContext());
        toast('Aus dem Plan entfernt.');
      }
      await reload();
    }));
    const move = h('button', { type: 'button', class: 'btn' }, 'Verschieben');
    move.addEventListener('click', async () => {
      const dateIn = h('input', { type: 'date', name: 'date', value: e.date });
      const mealSel = select('mealType', MEAL_TYPES, e.mealType);
      const c = await dialog({ title: 'Mahlzeit verschieben', body: [field({ label: 'Tag', input: dateIn }), field({ label: 'Mahlzeit', input: mealSel })], buttons: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Verschieben', value: 'ok', variant: 'primary' }], dismissValue: 'cancel' });
      if (c !== 'ok') return;
      const res = await updatePlanEntry(e.id, { date: dateIn.value, mealType: mealSel.value }, shoppingContext());
      if (!res.ok) { showErrors(res.errors); return; }
      toast('Verschoben.');
      if (weekStart(res.entry.date) !== monday) { monday = weekStart(res.entry.date); history.replaceState(null, '', routeHref(`woche?start=${monday}`)); }
      await reload();
    });
    const actions = [];
    if (st.status === 'excluded' || st.status === 'unavailable') {
      const replace = h('button', { type: 'button', class: 'btn' }, 'Ersetzen');
      replace.addEventListener('click', async () => {
        const input = await planDialog({ title: 'Mahlzeit ersetzen', date: e.date, mealType: e.mealType, servings: e.servings });
        if (!input) return;
        const res = await addPlanEntry(input, shoppingContext());
        if (!res.ok) { showErrors(res.errors); return; }
        await deletePlanEntry(e.id, shoppingContext());
        toast('Ersetzt.', 'success');
        await reload();
      });
      actions.push(replace);
    }
    return h('li', { class: `plan-entry plan-${st.status}` },
      h('div', { class: 'plan-main' },
        h('p', { class: 'plan-title' }, isBox ? h('span', { class: 'box-tag', 'aria-label': `Meal-Prep-Box ${e.mealPrepIndex} von ${e.mealPrepCount}` }, `🥡 Box ${e.mealPrepIndex}/${e.mealPrepCount} `) : null, titleEl, e.cooked ? h('span', { class: 'badge badge-ok' }, icon('check', { size: 12 }), 'Gekocht') : null),
        shelf ? h('p', { class: 'notice notice-warn small' }, icon('alert', { size: 14 }), h('span', {}, shelf)) : null,
        isBox ? h('p', { class: 'small muted' }, '1 Portion') : st.status === 'ok' || st.status === 'unknown' ? stepper({ value: e.servings, label: 'Portionen', singular: 'Portion', onChange: async (v) => { const r = await updatePlanEntry(e.id, { servings: v }, shoppingContext()); if (!r.ok) showErrors(r.errors); } }) : h('p', { class: 'small' }, `${e.servings} ${e.servings === 1 ? 'Portion' : 'Portionen'}`),
        st.message ? h('p', { class: `notice ${st.status === 'unknown' ? 'notice-warn' : 'notice-error'} small` }, icon('alert', { size: 14 }), h('span', {}, st.message)) : null),
      h('div', { class: 'plan-actions' }, ...actions, move, del));
  }

  function dayCard(date, entries) {
    const isToday = date === todayString();
    const id = `day-${date}`;
    // 0.4: kompakt – nur belegte Mahlzeiten werden gezeigt, ein „+“-Knopf je Tag.
    const slots = MEAL_TYPES.map((m) => {
      const list = entries.filter((e) => e.mealType === m.id);
      if (!list.length) return null;
      return h('div', { class: 'plan-slot' }, h('h3', { class: 'slot-title' }, m.label), h('ul', { class: 'plain-list' }, ...list.map(entryRow)));
    });
    const nextFree = MEAL_TYPES.find((m) => !entries.some((e) => e.mealType === m.id)) ?? MEAL_TYPES[1];
    const add = h('button', { type: 'button', class: 'btn btn-icon btn-add plan-add', 'aria-label': `Mahlzeit am ${formatDayLabel(date)} einplanen` }, icon('plus', { size: 20 }));
    add.addEventListener('click', async () => {
      const input = await planDialog({ title: `Mahlzeit am ${formatDayLabel(date)}`, date, mealType: nextFree.id });
      if (!input) return;
      const res = await addPlanEntry(input, shoppingContext());
      if (!res.ok) { showErrors(res.errors); return; }
      toast(res.warning ? `Eingeplant. Hinweis: ${res.warning}` : 'Eingeplant.', res.warning ? 'warn' : 'success');
      await reload();
    });
    let kcal = 0;
    let complete = true;
    for (const e of entries) {
      const n = recipeNutritionFor(state.recipesById.get(e.recipeId), state.profile, state.catalog).perServing;
      if (typeof n?.kcal === 'number') kcal += n.kcal; else complete = false;
    }
    return h('section', { class: `section day-card ${isToday ? 'is-today' : ''} ${entries.length ? '' : 'is-empty'}`, 'aria-labelledby': id, 'data-date': date },
      h('div', { class: 'day-head' }, h('h2', { id }, formatDayLabel(date), isToday ? h('span', { class: 'badge badge-ok today-badge' }, 'Heute') : null), add),
      entries.length ? h('p', { class: 'small muted day-sum' }, `Geplant: ca. ${formatNumber(kcal, 0)} kcal (je 1 Portion)${complete ? '' : ', unvollständig'} · `, h('a', { href: routeHref(`heute?datum=${date}`) }, 'Tagesbilanz')) : null,
      ...slots);
  }

  const prev = h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': 'Vorherige Woche' }, icon('chevronLeft'));
  const next = h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': 'Nächste Woche' }, icon('chevronRight'));
  const today = h('button', { type: 'button', class: 'btn' }, 'Heute');
  const go = (m) => { monday = m; history.replaceState(null, '', routeHref(`woche?start=${monday}`)); reload(); };
  prev.addEventListener('click', () => go(addDays(monday, -7)));
  next.addEventListener('click', () => go(addDays(monday, 7)));
  today.addEventListener('click', () => go(weekStart(todayString())));
  const clearBtn = h('button', { type: 'button', class: 'btn btn-danger' }, icon('trash', { size: 16 }), ' Woche leeren');
  clearBtn.addEventListener('click', async () => {
    if (!(await confirmDialog('Woche leeren?', `Alle geplanten Mahlzeiten vom ${formatWeekRange(monday)} werden entfernt. Vorrat, bereits gekaufte Artikel und dein Ernährungstagebuch bleiben unverändert.`, { confirmLabel: 'Woche leeren', danger: true }))) return;
    const n = await clearPlanRange(monday, addDays(monday, 6), shoppingContext());
    toast(`${n} ${n === 1 ? 'Mahlzeit' : 'Mahlzeiten'} entfernt.`);
    await reload();
  });
  const shopLink = h('a', { class: 'btn', href: routeHref('einkauf') }, icon('cart', { size: 16 }), ' Zur Einkaufsliste');
  const rangeNote = h('div', { 'aria-live': 'polite' });

  async function shopForRange(from, to, label) {
    clear(rangeNote);
    const pv = await previewShoppingRange(from, to, shoppingContext());
    if (pv.status !== 'ok') {
      rangeNote.append(h('p', { class: 'notice notice-info' }, icon('info', { size: 16 }), h('span', {}, `Im Zeitraum ${label} ist nichts geplant, das noch eingekauft werden muss. Es wurde nichts übernommen.`)));
      return;
    }
    const amount = (p) => (typeof p.amountToBuy === 'number' ? formatAmount(p.amountToBuy, p.unit) : 'Menge bitte prüfen');
    const c = await dialog({
      title: `Einkaufsliste für ${label}`,
      body: [
        h('p', {}, `${pv.planCount} geplante ${pv.planCount === 1 ? 'Mahlzeit' : 'Mahlzeiten'}. Dein Vorrat wird über den ganzen Zeitraum nur einmal abgezogen.`),
        h('h3', {}, 'Noch benötigt'),
        pv.needed.length ? h('ul', {}, ...pv.needed.map((p) => h('li', {}, `${amount(p)} ${p.name}`, h('span', { class: 'small muted' }, ` – ${p.recipeSources.filter((x) => x.sourceType !== 'single').map((x) => x.label).join(', ')}`)))) : h('p', { class: 'small' }, 'Nichts – alles im Vorrat.'),
        pv.sufficient.length ? h('h3', {}, 'Bereits ausreichend vorhanden') : null,
        pv.sufficient.length ? h('p', { class: 'small' }, pv.sufficient.map((p) => p.name).join(', ')) : null,
        pv.check.length ? h('h3', {}, 'Menge bitte prüfen') : null,
        pv.check.length ? h('p', { class: 'small' }, pv.check.map((p) => p.name).join(', ')) : null,
        pv.skipped.length ? h('p', { class: 'notice notice-warn small' }, `Nicht berücksichtigt: ${pv.skipped.map((x) => `${x.label ?? x.title ?? 'Rezept'} (${x.reason})`).join(', ')}`) : null,
      ],
      buttons: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Übernehmen', value: 'ok', variant: 'primary' }],
      dismissValue: 'cancel',
    });
    if (c !== 'ok') return;
    const res = await applyShoppingRange(from, to, shoppingContext());
    if (res.status !== 'applied') { toast('Es wurde nichts übernommen.'); return; }
    toast(`Einkaufsliste für ${label} übernommen.`, 'success');
    navigate('einkauf');
  }

  const weekShop = h('button', { type: 'button', class: 'btn btn-primary' }, icon('cart', { size: 16 }), ' Einkaufsliste für diese Woche');
  weekShop.addEventListener('click', () => withBusy(weekShop, () => shopForRange(monday, addDays(monday, 6), `diese Woche (${formatWeekRange(monday)})`)));
  const customShop = h('button', { type: 'button', class: 'btn' }, 'Anderer Zeitraum …');
  customShop.addEventListener('click', async () => {
    const fromIn = h('input', { type: 'date', name: 'from', value: monday });
    const toIn = h('input', { type: 'date', name: 'to', value: addDays(monday, 6) });
    const c = await dialog({ title: 'Einkaufszeitraum wählen', body: [field({ label: 'Von', input: fromIn }), field({ label: 'Bis', input: toIn })], buttons: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Weiter', value: 'ok', variant: 'primary' }], dismissValue: 'cancel' });
    if (c !== 'ok') return;
    if (!isValidDateString(fromIn.value) || !isValidDateString(toIn.value) || fromIn.value > toIn.value) { toast('Bitte einen gültigen Zeitraum wählen („Von“ vor „Bis“).', 'error'); return; }
    await shopForRange(fromIn.value, toIn.value, `${formatDayLabel(fromIn.value)} bis ${formatDayLabel(toIn.value)}`);
  });

  container.append(
    pageHeader('Woche', 'Plane entspannt – Geplantes landet automatisch auf der Einkaufsliste.'),
    h('div', { class: 'day-nav' }, prev, rangeLabel, next),
    h('p', { class: 'week-today' }, today),
    daysBox,
    section('Einkaufen und Aufräumen', h('div', { class: 'form-actions' }, weekShop, customShop, shopLink), rangeNote, h('div', { class: 'form-actions' }, clearBtn)),
  );
  await reload();
}
