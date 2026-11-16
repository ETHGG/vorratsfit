// views/startView.js – Startseite mit Überblick und Schnellzugriff.
import { h, icon, fmtKcal } from './dom.js';
import { pageHeader, section, recipeCard } from './components.js';
import { state, analysisContext } from './state.js';
import { routeHref } from './router.js';
import { analyzeAll, sortAnalyses } from '../recipes.js';
import { expiringSoon, expiryStatus } from '../pantry.js';
import { getShoppingState } from '../shopping.js';
import { getTargets } from '../profile.js';
import { formatAmount } from '../units.js';
import { getLastBackupDate } from '../backup.js';
import { loadDayBalance, balanceCard } from './todayView.js';
import { todayString } from '../core/utils.js';

export async function render(container) {
  const p = state.profile;
  const ctx = await analysisContext(state.settings?.defaultServings ?? 2);
  const warnDays = state.settings?.expiryWarningDays ?? 3;
  const { items } = await getShoppingState();
  const open = items.filter((i) => !i.checked).length;
  const targets = getTargets(p);
  const lastBackup = await getLastBackupDate();

  const tiles = h('div', { class: 'tiles' },
    h('a', { class: 'tile', href: routeHref('vorrat-rezepte') }, icon('pot', { size: 28 }), h('span', { class: 'tile-title' }, 'Aus meinem Vorrat'), h('span', { class: 'tile-sub' }, 'Was kann ich kochen?')),
    h('a', { class: 'tile', href: routeHref('entdecken') }, icon('search', { size: 28 }), h('span', { class: 'tile-title' }, 'Rezepte entdecken'), h('span', { class: 'tile-sub' }, 'Was möchte ich kochen?')),
    h('a', { class: 'tile', href: routeHref('einkauf') }, icon('cart', { size: 28 }), h('span', { class: 'tile-title' }, 'Einkaufsliste'), h('span', { class: 'tile-sub' }, open ? `${open} offene ${open === 1 ? 'Position' : 'Positionen'}` : 'Was muss ich kaufen?')),
    h('a', { class: 'tile', href: routeHref('vorrat') }, icon('pantry', { size: 28 }), h('span', { class: 'tile-title' }, 'Vorrat'), h('span', { class: 'tile-sub' }, `${ctx.pantry.length} Einträge`)));

  container.append(pageHeader(p?.nickname ? `Hallo ${p.nickname}!` : 'VorratsFit', 'Rezepte, Vorräte, Einkaufslisten und Ernährungsziele – alles lokal auf deinem Gerät.'), tiles);

  const today = await loadDayBalance(todayString());
  container.append(section('Heute', balanceCard(today.balance, { compact: true }), h('a', { class: 'btn', href: routeHref('heute') }, 'Tagesbilanz öffnen')));

  if (targets) {
    container.append(section('Dein Tagesziel', h('p', {}, h('strong', {}, fmtKcal(targets.kcalTarget)), targets.manual ? ' (Manuell festgelegt)' : ' (Schätzung)', ` · Protein ${targets.proteinMin}–${targets.proteinMax} g`), h('a', { href: routeHref('tagesziel') }, 'Details ansehen')));
  } else if (!p) {
    container.append(section('Profil', h('p', {}, 'Lege ein Profil an, um persönliche Empfehlungen zu erhalten.'), h('a', { class: 'btn btn-primary', href: routeHref('einrichtung') }, 'Profil anlegen')));
  }

  const soon = expiringSoon(ctx.pantry, warnDays);
  if (soon.length) {
    container.append(section('Bald ablaufend', h('ul', { class: 'plain-list' }, ...soon.slice(0, 6).map((i) => {
      const st = expiryStatus(i, warnDays);
      return h('li', { class: 'exp-row' }, icon('alert', { size: 16 }), h('span', {}, h('strong', {}, i.name), ` (${formatAmount(i.amount, i.unit, { humanize: false })}) – ${st.label}`));
    }))));
  }

  if (ctx.pantry.some((x) => x.amount > 0)) {
    const top = sortAnalyses(analyzeAll(state.recipes, ctx).filter((a) => a.check.status === 'ok' && a.evaluation.counts.available > 0), 'recommended').slice(0, 3);
    if (top.length) container.append(section('Empfehlungen aus deinem Vorrat', h('div', { class: 'card-list' }, ...top.map((a) => recipeCard(a, { mode: 'pantry', servings: ctx.servings }))), h('a', { href: routeHref('vorrat-rezepte') }, 'Alle passenden Rezepte')));
  }

  const backupText = lastBackup ? `Letztes Backup: ${new Date(lastBackup).toLocaleDateString('de-DE')}.` : 'Du hast noch kein Backup erstellt.';
  container.append(h('p', { class: 'notice notice-info' }, icon('backup', { size: 16 }), h('span', {}, `${backupText} Deine Daten liegen nur auf diesem Gerät. `, h('a', { href: routeHref('backup') }, 'Backup erstellen'))));
}
