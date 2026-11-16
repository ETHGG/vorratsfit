// views/todayView.js – Tagesbilanz und „Heute gegessen“: geplante Mahlzeiten kochen/essen, Schnellerfassen, Tagebuch.
import { h, clear, icon, toast, withBusy, confirmDialog, field, showFieldErrors, emptyState, stepper } from './dom.js';
import { pageHeader, section } from './components.js';
import { state, shoppingContext } from './state.js';
import { routeHref } from './router.js';
import { listPlan, listAllPlan, cookPlanEntry, uncookPlanEntry } from '../planner.js';
import { listFoodLog, markPlanEaten, logQuickFood, deleteFoodLog, setFoodLogPortions, listQuickFoods, saveQuickFood, deleteQuickFood } from '../foodlog.js';
import { dayBalance, recipeNutritionFor, DEFAULT_QUICK_FOODS } from '../core/day-balance.js';
import { formatDayLabel, planEntryStatus } from '../core/plan-logic.js';
import { planConsumption } from '../core/cooking.js';
import { checkRecipe } from '../core/restrictions.js';
import { getTargets } from '../profile.js';
import { listPantry } from '../pantry.js';
import { mealTypeLabel } from '../core/models.js';
import { formatAmount, formatNumber } from '../units.js';
import { addDays, todayString, isValidDateString } from '../core/utils.js';
import { ESTIMATE_NOTICE } from '../nutrition.js';

const kcalText = (v) => (typeof v === 'number' && Number.isFinite(v) ? `${formatNumber(v, 0)} kcal` : 'unbekannt');
const gText = (v) => (typeof v === 'number' && Number.isFinite(v) ? `${formatNumber(v, 0)} g` : 'unbekannt');

function meter(label, value, max) {
  const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0;
  const bar = h('span', {});
  bar.style.width = `${pct}%`;
  return h('div', { class: 'meter', role: 'img', 'aria-label': `${label}: ${pct} Prozent des Ziels` }, bar);
}

/** Bilanzdaten eines Tages (für „Heute“, Startseite und Wochenplaner). */
export async function loadDayBalance(date) {
  const [entries, logs] = await Promise.all([listPlan(date, date), listFoodLog(date)]);
  const planned = entries.map((e) => {
    const n = recipeNutritionFor(state.recipesById.get(e.recipeId), state.profile, state.catalog).perServing;
    return { kcal: n?.kcal ?? null, protein: n?.protein ?? null, carbs: n?.carbs ?? null, fat: n?.fat ?? null, portions: 1 };
  });
  return { entries, logs, balance: dayBalance({ targets: getTargets(state.profile), logs, planned }) };
}

/** Kompakte Bilanzkarte. */
export function balanceCard(b, { compact = false } = {}) {
  const rows = [];
  if (b.status === 'noTarget') {
    rows.push(h('p', { class: 'notice notice-info' }, icon('info', { size: 16 }), h('span', {}, b.text)));
    rows.push(h('p', {}, `Gegessen: ${kcalText(b.eaten.kcal)} · Geplant: ${kcalText(b.planned.kcal)}`));
    return h('div', { class: 'balance' }, ...rows);
  }
  rows.push(h('p', { class: 'balance-main' }, h('strong', {}, b.text)));
  rows.push(meter('Kalorien', b.eaten.kcal, b.target));
  rows.push(h('dl', { class: 'kv-list small' },
    h('div', { class: 'kv' }, h('dt', {}, b.minor ? 'Orientierungswert' : 'Ziel'), h('dd', {}, kcalText(b.target))),
    h('div', { class: 'kv' }, h('dt', {}, 'Geplant (je 1 Portion)'), h('dd', {}, `${kcalText(b.planned.kcal)}${b.planned.complete ? '' : ' (unvollständig)'}`)),
    h('div', { class: 'kv' }, h('dt', {}, 'Gegessen'), h('dd', {}, kcalText(b.eaten.kcal))),
    h('div', { class: 'kv' }, h('dt', {}, 'Protein gegessen'), h('dd', {}, `${gText(b.eaten.protein)}${b.proteinMin ? ` von ${b.proteinMin}–${b.proteinMax} g` : ''}`))));
  if (!compact && b.proteinMax) rows.push(meter('Protein', b.eaten.protein, b.proteinMin));
  if (!compact) rows.push(h('p', { class: 'note-estimate' }, icon('info', { size: 14 }), ESTIMATE_NOTICE));
  return h('div', { class: 'balance' }, ...rows);
}

/** Vorschau und Durchführung von „Gekocht“ für einen Plan-Eintrag. */
export async function cookWithPreview(entry, servingsTotal) {
  const recipe = state.recipesById.get(entry.recipeId);
  if (!recipe) { toast('Rezept nicht mehr verfügbar.', 'error'); return null; }
  const check = checkRecipe(recipe, state.profile, state.catalog);
  const prev = planConsumption(check.effectiveRecipe, servingsTotal, await listPantry(), state.catalog);
  const parts = [];
  parts.push(prev.consumptions.length ? `Abgezogen werden: ${prev.consumptions.map((c) => `${formatAmount(c.amount, c.unit)} ${c.name}`).join(', ')}.` : 'Es gibt keine passenden Vorratsmengen zum Abziehen.');
  if (prev.missing.length) parts.push(`Nicht im Vorrat: ${prev.missing.map((m) => `${formatAmount(m.amount, m.unit)} ${m.name}`).join(', ')}.`);
  if (prev.unchecked.length) parts.push(`Menge bitte prüfen (nicht abgezogen): ${prev.unchecked.map((u) => u.name).join(', ')}.`);
  parts.push('Gewürze bleiben unverändert.');
  if (!(await confirmDialog(`${recipe.title} gekocht (${servingsTotal} ${servingsTotal === 1 ? 'Portion' : 'Portionen'})?`, parts.join(' '), { confirmLabel: 'Gekocht – abziehen' }))) return null;
  try {
    const res = await cookPlanEntry(entry.id, shoppingContext());
    if (res.status === 'already') toast('Wurde bereits als gekocht erfasst. Der Vorrat wurde nicht erneut abgezogen.');
    else if (res.status === 'cooked') toast(res.missing.length ? `Gekocht. Fehlende Zutaten: ${res.missing.map((m) => m.name).join(', ')}.` : 'Gekocht – Vorrat aktualisiert.', res.missing.length ? 'warn' : 'success');
    return res;
  } catch (err) {
    toast(`Nicht gespeichert: ${err.message}`, 'error');
    return null;
  }
}

export async function render(container, { params }) {
  const requested = params?.get('datum');
  let date = isValidDateString(requested) ? requested : todayString();
  const balanceBox = h('div', { 'aria-live': 'polite' });
  const mealsBox = h('div', {});
  const logBox = h('div', { 'aria-live': 'polite' });
  const quickBox = h('div', { class: 'quick-grid' });
  const ownBox = h('div', {});
  const title = h('p', { class: 'week-range' });

  async function reload() {
    const { entries, logs, balance } = await loadDayBalance(date);
    title.textContent = `${formatDayLabel(date)}${date === todayString() ? ' (heute)' : ''}`;
    clear(balanceBox).append(balanceCard(balance));
    drawMeals(entries);
    drawLog(logs);
    await drawQuick();
  }

  function drawMeals(entries) {
    clear(mealsBox);
    if (!entries.length) {
      mealsBox.append(emptyState('Keine Mahlzeiten geplant', 'Plane Mahlzeiten in der Wochenansicht oder erfasse unten direkt, was du gegessen hast.', h('a', { class: 'btn', href: routeHref('woche') }, 'Zur Woche')));
      return;
    }
    mealsBox.append(h('ul', { class: 'plain-list' }, ...entries.map((e) => {
      const st = planEntryStatus(e, state.recipesById, state.profile, state.catalog);
      const box = e.mealPrepGroupId ? ` · Box ${e.mealPrepIndex}/${e.mealPrepCount}` : '';
      const status = [e.cooked ? 'Gekocht' : null, e.eaten ? 'Gegessen' : null].filter(Boolean);
      const actions = [];
      if (!e.cooked && st.status !== 'excluded' && st.status !== 'unavailable') {
        const b = h('button', { type: 'button', class: 'btn' }, icon('pot', { size: 16 }), ' Gekocht');
        b.addEventListener('click', () => withBusy(b, async () => {
          let servings = e.servings;
          if (e.mealPrepGroupId) servings = (await listAllPlan()).filter((x) => x.mealPrepGroupId === e.mealPrepGroupId).reduce((s, x) => s + x.servings, 0);
          if (await cookWithPreview(e, servings)) await reload();
        }));
        actions.push(b);
      } else if (e.cooked) {
        const b = h('button', { type: 'button', class: 'btn btn-link' }, 'Gekocht rückgängig');
        b.addEventListener('click', () => withBusy(b, async () => {
          if (!(await confirmDialog('„Gekocht“ rückgängig machen?', 'Die beim Kochen abgezogenen Mengen werden dem Vorrat wieder gutgeschrieben – höchstens so viel, wie abgezogen wurde.', { confirmLabel: 'Rückgängig' }))) return;
          const r = await uncookPlanEntry(e.id, shoppingContext());
          toast(r.status === 'uncooked' ? 'Rückgängig gemacht – Vorrat wieder ergänzt.' : 'War nicht als gekocht erfasst.');
          await reload();
        }));
        actions.push(b);
      }
      if (!e.eaten && st.status !== 'unavailable') {
        const b = h('button', { type: 'button', class: 'btn btn-primary' }, icon('check', { size: 16 }), ' Gegessen');
        b.addEventListener('click', () => withBusy(b, async () => {
          const r = await markPlanEaten(e.id, shoppingContext());
          if (r.status === 'logged') toast(r.notCookedYet ? 'Als gegessen erfasst. Hinweis: Diese Meal-Prep-Gruppe ist noch nicht als gekocht markiert – der Vorrat wurde nicht verändert.' : 'Als gegessen erfasst (1 Portion).', r.notCookedYet ? 'warn' : 'success');
          await reload();
        }));
        actions.push(b);
      }
      const recipe = state.recipesById.get(e.recipeId);
      return h('li', { class: 'plan-entry today-entry' },
        h('div', { class: 'plan-main' },
          h('p', { class: 'plan-title' }, recipe ? h('a', { href: routeHref(`rezept/${encodeURIComponent(e.recipeId)}?portionen=${e.servings}`) }, recipe.title) : (e.recipeTitle || 'Unbekanntes Rezept')),
          h('p', { class: 'small muted' }, `${mealTypeLabel(e.mealType)} · ${e.servings} ${e.servings === 1 ? 'Portion' : 'Portionen'}${box}`),
          status.length ? h('p', { class: 'small' }, ...status.map((s) => h('span', { class: 'badge badge-ok' }, icon('check', { size: 12 }), s))) : null,
          st.message ? h('p', { class: `notice ${st.status === 'unknown' ? 'notice-warn' : 'notice-error'} small` }, icon('alert', { size: 14 }), h('span', {}, st.message)) : null),
        h('div', { class: 'plan-actions' }, ...actions));
    })));
  }

  function drawLog(logs) {
    clear(logBox);
    if (!logs.length) { logBox.append(h('p', { class: 'small muted' }, 'Noch keine Einträge an diesem Tag.')); return; }
    logBox.append(h('ul', { class: 'plain-list' }, ...logs.map((l) => {
      const del = h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': `${l.name} aus dem Tagebuch löschen` }, icon('trash'));
      del.addEventListener('click', () => withBusy(del, async () => { await deleteFoodLog(l.id); toast('Eintrag gelöscht. Der Vorrat bleibt unverändert.'); await reload(); }));
      const total = (v) => (typeof v === 'number' ? v * l.portions : null);
      return h('li', { class: 'log-item' },
        h('div', { class: 'plan-main' },
          h('p', { class: 'plan-title' }, `${l.time ? `${l.time} · ` : ''}${l.name}`),
          h('p', { class: 'small muted' }, `${kcalText(total(l.kcal))} · ${gText(total(l.protein))} Protein${l.nutritionComplete ? '' : ' · Nährwerte unvollständig'}`),
          stepper({ value: l.portions, min: 1, max: 20, label: 'Portionen', singular: 'Portion', onChange: async (v) => { await setFoodLogPortions(l.id, v); await reload(); } })),
        h('div', { class: 'plan-actions' }, del));
    })));
  }

  async function drawQuick() {
    const own = await listQuickFoods();
    clear(quickBox);
    for (const f of [...DEFAULT_QUICK_FOODS, ...own]) {
      const b = h('button', { type: 'button', class: 'btn quick-btn', 'aria-label': `${f.name} (${f.portionLabel}) als gegessen erfassen` }, h('span', { class: 'quick-name' }, f.name), h('span', { class: 'small muted' }, `${f.portionLabel} · ${kcalText(f.kcal)}`));
      b.addEventListener('click', () => withBusy(b, async () => {
        await logQuickFood(f, { date });
        toast(`${f.name} erfasst.`, 'success');
        await reload();
      }));
      quickBox.append(b);
    }
    clear(ownBox);
    if (own.length) {
      ownBox.append(h('ul', { class: 'plain-list' }, ...own.map((f) => {
        const del = h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': `${f.name} als Schnell-Lebensmittel entfernen` }, icon('trash'));
        del.addEventListener('click', () => withBusy(del, async () => { await deleteQuickFood(f.id); await reload(); }));
        return h('li', { class: 'online-item' }, h('span', {}, `${f.name} – ${f.portionLabel}, ${kcalText(f.kcal)}, ${gText(f.protein)} Protein`), del);
      })));
    }
  }

  // Eigenes Schnell-Lebensmittel anlegen
  const qName = h('input', { type: 'text', name: 'name', maxlength: '80', autocomplete: 'off' });
  const qKcal = h('input', { type: 'number', name: 'kcal', min: '0', max: '5000', step: 'any', inputmode: 'decimal' });
  const qProt = h('input', { type: 'number', name: 'protein', min: '0', max: '5000', step: 'any', inputmode: 'decimal' });
  const qPortion = h('input', { type: 'text', name: 'portionLabel', maxlength: '40', placeholder: 'z. B. 1 Riegel' });
  const qBtn = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Speichern');
  const qForm = h('form', { class: 'form grid-form', novalidate: true },
    field({ label: 'Name', input: qName }),
    h('div', { class: 'row-2' }, field({ label: 'Kalorien je Portion', input: qKcal }), field({ label: 'Protein je Portion (g)', input: qProt })),
    field({ label: 'Portion', input: qPortion }),
    h('div', { class: 'form-actions' }, qBtn));
  qForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    withBusy(qBtn, async () => {
      const res = await saveQuickFood({ name: qName.value, kcal: qKcal.value, protein: qProt.value, portionLabel: qPortion.value });
      if (!res.ok) { showFieldErrors(qForm, res.errors); return; }
      showFieldErrors(qForm, {});
      qForm.reset();
      toast(`${res.item.name} gespeichert.`, 'success');
      await reload();
    });
  });

  const prev = h('button', { type: 'button', class: 'btn', 'aria-label': 'Vorheriger Tag' }, '← Vortag');
  const next = h('button', { type: 'button', class: 'btn', 'aria-label': 'Nächster Tag' }, 'Nächster →');
  const go = (d) => { date = d; history.replaceState(null, '', routeHref(`heute?datum=${date}`)); reload(); };
  prev.addEventListener('click', () => go(addDays(date, -1)));
  next.addEventListener('click', () => go(addDays(date, 1)));

  container.append(
    pageHeader('Heute', 'Tagesbilanz, geplante Mahlzeiten und was du gegessen hast. „Gegessen“ verändert deinen Vorrat nicht – nur „Gekocht“ zieht ab.'),
    h('div', { class: 'week-nav' }, prev, title, next),
    section('Tagesbilanz', balanceBox),
    section('Geplante Mahlzeiten', mealsBox),
    section('Schnell erfassen', quickBox, h('details', { class: 'more' }, h('summary', {}, 'Eigenes Schnell-Lebensmittel anlegen'), qForm, ownBox)),
    section('Tagebuch', logBox),
  );
  await reload();
}
