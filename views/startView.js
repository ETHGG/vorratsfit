// views/startView.js – Startseite (0.7, gestrafft): nur, was gerade zählt.
// Begrüßung · Heute (Ring, Wasser, Geplantes) · passend zur Tageszeit · kurze Hinweise · neue Erfolge.
import { h, icon, fmtKcal } from './dom.js';
import { pageHeader, section, recipeArt, waterWidget } from './components.js';
import { state, analysisContext } from './state.js';
import { routeHref } from './router.js';
import { analyzeAll, sortAnalyses } from '../recipes.js';
import { expiringSoon } from '../pantry.js';
import { getShoppingState } from '../shopping.js';
import { getTargets } from '../profile.js';
import { getLastBackupDate } from '../backup.js';
import { loadDayBalance, balanceCard } from './todayView.js';
import { todayString, addDays } from '../core/utils.js';
import { listWeights } from '../weight.js';
import { weightReminder } from '../core/body.js';
import { mealTypeLabel } from '../core/models.js';
import { getWater, addWater, listWaterRange } from '../water.js';
import { listFoodLogRange } from '../foodlog.js';
import { listAllPlan } from '../planner.js';
import { computeAchievements } from '../core/achievements.js';

/** Begrüßung nach Tageszeit. */
export function greeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 5) return 'Gute Nacht';
  if (hour < 11) return 'Guten Morgen';
  if (hour < 14) return 'Mahlzeit';
  if (hour < 18) return 'Schönen Nachmittag';
  return 'Guten Abend';
}

/** Welche Mahlzeit passt gerade? */
export function mealForTime(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 4 && hour < 11) return 'fruehstueck';
  if (hour >= 11 && hour < 15) return 'mittagessen';
  if (hour >= 15 && hour < 17) return 'snack';
  return 'abendessen';
}

const MEAL_HEADLINE = { fruehstueck: 'Ideen fürs Frühstück', mittagessen: 'Was gibt’s zu Mittag?', snack: 'Kleiner Snack gefällig?', abendessen: 'Was koche ich heute Abend?' };

export async function render(container) {
  const p = state.profile;
  const day = todayString();
  const ctx = await analysisContext(state.settings?.defaultServings ?? 2);
  const warnDays = state.settings?.expiryWarningDays ?? 3;
  const targets = getTargets(p);
  const dateText = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });

  container.append(pageHeader(p?.nickname ? `Hallo ${p.nickname}!` : 'Hallo!', `${greeting()} · ${dateText}`));
  if (!p) {
    container.append(section('Profil', h('p', {}, 'Lege ein Profil an, um persönliche Empfehlungen zu erhalten.'), h('a', { class: 'btn btn-primary', href: routeHref('einrichtung') }, 'Profil anlegen')));
  }

  // Heute
  const today = await loadDayBalance(day);
  const planned = today.entries.map((e) => {
    const r = state.recipesById.get(e.recipeId);
    return h('li', {},
      h('span', { class: 'emoji', 'aria-hidden': 'true' }, r?.emoji || '🍽️'),
      h('span', {}, h('span', { class: 'meal' }, mealTypeLabel(e.mealType)),
        r ? h('a', { href: routeHref(`rezept/${encodeURIComponent(r.id)}?portionen=${e.servings}`) }, r.title) : h('span', {}, e.recipeTitle || 'Rezept')),
      e.eaten ? h('span', { class: 'badge badge-ok' }, icon('check', { size: 12 }), 'Gegessen') : e.cooked ? h('span', { class: 'badge badge-ok' }, 'Gekocht') : null);
  });
  const todaySec = section('Heute',
    balanceCard(today.balance, { compact: true }),
    waterWidget({ ml: await getWater(day), goal: state.settings?.waterGoalMl ?? 2000, onChange: async (d) => (await addWater(day, d)).ml, compact: true }),
    planned.length ? h('ul', { class: 'today-list' }, ...planned) : null,
    h('div', { class: 'form-actions' },
      h('a', { class: 'btn btn-primary', href: routeHref('heute') }, 'Tagesbilanz öffnen'),
      planned.length ? null : h('a', { class: 'btn btn-secondary', href: routeHref('woche') }, icon('plus', { size: 16 }), ' Mahlzeit planen')));
  todaySec.dataset.area = 'heute';
  container.append(todaySec);

  // Kurze Hinweise – nur, wenn es etwas zu tun gibt
  const [{ items }, weights, lastBackup] = await Promise.all([getShoppingState(), p ? listWeights() : [], getLastBackupDate()]);
  const open = items.filter((i) => !i.checked).length;
  const soon = expiringSoon(ctx.pantry, warnDays);
  const due = p ? weightReminder(weights, day).due : false;
  const backupOld = !lastBackup || (Date.now() - new Date(lastBackup).getTime()) > 14 * 864e5;
  const hints = [
    soon.length ? h('a', { class: 'hint-chip', 'data-area': 'vorrat', href: routeHref('vorrat-rezepte?resteverwertung=1') }, `⏳ ${soon.length} ${soon.length === 1 ? 'Lebensmittel läuft' : 'Lebensmittel laufen'} bald ab – Rezepte dazu`) : null,
    open ? h('a', { class: 'hint-chip', 'data-area': 'einkauf', href: routeHref('einkauf') }, `🛒 ${open} ${open === 1 ? 'Artikel' : 'Artikel'} auf der Einkaufsliste`) : null,
    due ? h('a', { class: 'hint-chip', 'data-area': 'gewicht', href: routeHref('gewicht') }, '⚖️ Zeit für einen Gewichtseintrag') : null,
    backupOld ? h('a', { class: 'hint-chip', 'data-area': 'start', href: routeHref('backup') }, lastBackup ? '💾 Letztes Backup ist über 2 Wochen alt' : '💾 Noch kein Backup – jetzt sichern') : null,
  ].filter(Boolean);
  if (hints.length) container.append(h('div', { class: 'hint-chips', role: 'list' }, ...hints.map((x) => { x.setAttribute('role', 'listitem'); return x; })));

  // Passend zur Tageszeit
  const meal = mealForTime();
  const all = analyzeAll(state.recipes, ctx).filter((a) => a.check.status === 'ok');
  const hasPantry = ctx.pantry.some((x) => x.amount > 0);
  let ideas = all.filter((a) => a.recipe.mealType === meal);
  ideas = sortAnalyses(hasPantry ? ideas.filter((a) => a.evaluation.counts.available > 0) : ideas, 'recommended');
  if (ideas.length < 3) ideas = [...ideas, ...sortAnalyses(all.filter((a) => !ideas.includes(a) && (!hasPantry || a.evaluation.counts.available > 0)), 'recommended')];
  ideas = ideas.slice(0, 6);
  if (ideas.length) {
    const s = section(MEAL_HEADLINE[meal],
      h('div', { class: 'scroller', role: 'list' }, ...ideas.map((a) => h('a', { class: 'mini-recipe', role: 'listitem', href: routeHref(`rezept/${encodeURIComponent(a.recipe.id)}?portionen=${ctx.servings}`) },
        recipeArt(a.recipe),
        h('div', { class: 'mini-recipe-body' },
          h('p', { class: 'mini-recipe-title' }, a.recipe.title),
          h('p', { class: 'small muted' }, hasPantry ? (a.evaluation.fullyCookable ? 'Alles da ✓' : `${a.evaluation.matchPercent} % vorhanden`) : `${a.recipe.totalMinutes} Min.`, ` · ${fmtKcal(a.recipe.nutritionPerServing?.kcal)}`))))),
      h('a', { href: routeHref('vorrat-rezepte') }, 'Alle Rezepte zu deinem Vorrat'));
    s.dataset.area = 'rezepte';
    container.append(s);
  }

  // Erfolge: nur erreichte zeigen (die ganze Liste steht unter „Plan → Heute“)
  if (p) {
    const [foodLog, plans, water] = await Promise.all([listFoodLogRange(addDays(day, -30), day), listAllPlan(), listWaterRange(addDays(day, -6), day)]);
    const won = computeAchievements({
      today: day, foodLog, kcalTarget: targets?.kcalTarget ?? null, weights, cookedCount: new Set(plans.filter((e) => e.cooked).map((e) => e.mealPrepGroupId || e.id)).size,
      water, waterGoalMl: state.settings?.waterGoalMl ?? 2000, goal: p.goal ?? null, minor: (p.age ?? 99) < 18,
    }).filter((a) => a.achieved).slice(0, 2);
    if (won.length) container.append(h('div', { class: 'celebrate', role: 'status' }, ...won.map((a) => h('p', {}, h('span', { 'aria-hidden': 'true' }, `${a.emoji} `), h('strong', {}, a.title), ` – ${a.text}`)), h('a', { href: routeHref('heute') }, 'Alle Erfolge')));
  }
}
