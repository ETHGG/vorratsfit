// views/startView.js – Startseite (0.5): persönliche Begrüßung, Tagesring, farbige Bereichskacheln,
// heute geplante Mahlzeiten, bald Ablaufendes und Rezeptideen als Bildkarten.
import { h, icon, fmtKcal } from './dom.js';
import { pageHeader, section, recipeArt, illustration } from './components.js';
import { state, analysisContext } from './state.js';
import { routeHref } from './router.js';
import { analyzeAll, sortAnalyses } from '../recipes.js';
import { expiringSoon, expiryStatus } from '../pantry.js';
import { getShoppingState } from '../shopping.js';
import { getTargets } from '../profile.js';
import { formatAmount, formatNumber } from '../units.js';
import { getLastBackupDate } from '../backup.js';
import { loadDayBalance, balanceCard } from './todayView.js';
import { todayString } from '../core/utils.js';
import { listWeights } from '../weight.js';
import { weightReminder } from '../core/body.js';
import { mealTypeLabel } from '../core/models.js';

/** Begrüßung nach Tageszeit. */
export function greeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 5) return 'Gute Nacht';
  if (hour < 11) return 'Guten Morgen';
  if (hour < 14) return 'Mahlzeit';
  if (hour < 18) return 'Schönen Nachmittag';
  return 'Guten Abend';
}

function tile({ route, area, art, title, sub, badge = null }) {
  return h('a', { class: 'tile', href: routeHref(route), 'data-area': area },
    illustration(art, 'tile-art'),
    h('span', { class: 'tile-title' }, title),
    h('span', { class: 'tile-sub' }, sub),
    badge ? h('span', { class: 'tile-badge', 'aria-label': `${badge} offen` }, String(badge)) : null);
}

function areaSection(area, title, ...children) {
  const s = section(title, ...children);
  s.dataset.area = area;
  return s;
}

export async function render(container) {
  const p = state.profile;
  const ctx = await analysisContext(state.settings?.defaultServings ?? 2);
  const warnDays = state.settings?.expiryWarningDays ?? 3;
  const { items } = await getShoppingState();
  const open = items.filter((i) => !i.checked).length;
  const targets = getTargets(p);
  const lastBackup = await getLastBackupDate();
  const dateText = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });

  container.append(pageHeader(p?.nickname ? `Hallo ${p.nickname}!` : 'Hallo!', `${greeting()} · ${dateText}`));

  // Heute: Ring + geplante Mahlzeiten
  const today = await loadDayBalance(todayString());
  const planned = today.entries.map((e) => {
    const r = state.recipesById.get(e.recipeId);
    return h('li', {},
      h('span', { class: 'emoji', 'aria-hidden': 'true' }, r?.emoji || '🍽️'),
      h('span', {}, h('span', { class: 'meal' }, mealTypeLabel(e.mealType)),
        r ? h('a', { href: routeHref(`rezept/${encodeURIComponent(r.id)}?portionen=${e.servings}`) }, r.title) : h('span', {}, e.recipeTitle || 'Rezept')),
      e.eaten ? h('span', { class: 'badge badge-ok' }, icon('check', { size: 12 }), 'Gegessen') : e.cooked ? h('span', { class: 'badge badge-ok' }, 'Gekocht') : null);
  });
  container.append(areaSection('heute', 'Heute',
    balanceCard(today.balance, { compact: true }),
    planned.length ? h('ul', { class: 'today-list' }, ...planned) : h('p', { class: 'small muted' }, 'Für heute ist noch nichts geplant.'),
    h('div', { class: 'form-actions' },
      h('a', { class: 'btn btn-primary', href: routeHref('heute') }, 'Tagesbilanz öffnen'),
      planned.length ? null : h('a', { class: 'btn btn-secondary', href: routeHref('woche') }, icon('plus', { size: 16 }), ' Mahlzeit planen'))));

  container.append(h('div', { class: 'tiles' },
    tile({ route: 'vorrat-rezepte', area: 'rezepte', art: 'rezepte', title: 'Was koche ich?', sub: 'Rezepte aus deinem Vorrat' }),
    tile({ route: 'einkauf', area: 'einkauf', art: 'einkauf', title: 'Einkaufsliste', sub: open ? `${open} ${open === 1 ? 'Artikel' : 'Artikel'} offen` : 'Alles erledigt', badge: open || null }),
    tile({ route: 'woche', area: 'woche', art: 'woche', title: 'Woche', sub: 'Mahlzeiten planen' }),
    tile({ route: 'vorrat', area: 'vorrat', art: 'vorrat', title: 'Vorrat', sub: `${ctx.pantry.length} ${ctx.pantry.length === 1 ? 'Eintrag' : 'Einträge'}` })));

  const soon = expiringSoon(ctx.pantry, warnDays);
  if (soon.length) {
    container.append(areaSection('vorrat', 'Bald aufbrauchen', h('ul', { class: 'plain-list' }, ...soon.slice(0, 6).map((i) => {
      const st = expiryStatus(i, warnDays);
      return h('li', { class: 'exp-row' }, icon('alert', { size: 16 }), h('span', {}, h('strong', {}, i.name), ` (${formatAmount(i.amount, i.unit, { humanize: false })}) – ${st.label}`));
    })), h('a', { href: routeHref('vorrat-rezepte?resteverwertung=1') }, 'Rezepte zum Aufbrauchen')));
  }

  if (ctx.pantry.some((x) => x.amount > 0)) {
    const top = sortAnalyses(analyzeAll(state.recipes, ctx).filter((a) => a.check.status === 'ok' && a.evaluation.counts.available > 0), 'recommended').slice(0, 6);
    if (top.length) {
      container.append(areaSection('rezepte', 'Ideen aus deinem Vorrat',
        h('div', { class: 'scroller', role: 'list' }, ...top.map((a) => h('a', { class: 'mini-recipe', role: 'listitem', href: routeHref(`rezept/${encodeURIComponent(a.recipe.id)}?portionen=${ctx.servings}`) },
          recipeArt(a.recipe),
          h('div', { class: 'mini-recipe-body' },
            h('p', { class: 'mini-recipe-title' }, a.recipe.title),
            h('p', { class: 'small muted' }, a.evaluation.fullyCookable ? 'Alles da ✓' : `${a.evaluation.matchPercent} % vorhanden`, ` · ${fmtKcal(a.recipe.nutritionPerServing?.kcal)}`))))),
        h('a', { href: routeHref('vorrat-rezepte') }, 'Alle passenden Rezepte')));
    }
  }

  if (p) {
    const weights = await listWeights();
    const r = weightReminder(weights, todayString());
    const last = weights[weights.length - 1];
    container.append(areaSection('gewicht', 'Gewicht',
      r.due || !last ? h('p', { class: 'notice notice-info' }, icon('scale', { size: 16 }), h('span', {}, r.text)) : h('p', {}, 'Zuletzt: ', h('strong', {}, `${formatNumber(last.weightKg, 1)} kg`), ` am ${last.date.split('-').reverse().join('.')}`),
      targets ? h('p', { class: 'small muted' }, `Tagesziel: ${fmtKcal(targets.kcalTarget)}${targets.manual ? ' (manuell)' : ' (Schätzung)'} · Protein ${targets.proteinMin}–${targets.proteinMax} g`) : null,
      h('a', { class: 'btn btn-secondary', href: routeHref('gewicht') }, r.due ? 'Gewicht eintragen' : 'Verlauf ansehen')));
  } else {
    container.append(section('Profil', h('p', {}, 'Lege ein Profil an, um persönliche Empfehlungen zu erhalten.'), h('a', { class: 'btn btn-primary', href: routeHref('einrichtung') }, 'Profil anlegen')));
  }

  const backupText = lastBackup ? `Letztes Backup: ${new Date(lastBackup).toLocaleDateString('de-DE')}.` : 'Du hast noch kein Backup erstellt.';
  container.append(h('p', { class: 'notice notice-info' }, icon('backup', { size: 16 }), h('span', {}, `${backupText} Deine Daten liegen nur auf diesem Gerät. `, h('a', { href: routeHref('backup') }, 'Backup erstellen'))));
}
