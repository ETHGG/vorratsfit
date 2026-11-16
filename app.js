// app.js – Einstiegspunkt: Initialisierung, Navigation, Datenschutzhinweis, Offline- und Update-Hinweise.
import { h, clear, icon, dialog, errorBox, loading, toast } from './views/dom.js';
import { NAV_ITEMS, parseHash, routeHref } from './views/router.js';
import { state, loadBase, refreshProfile } from './views/state.js';
import { allergyDisclaimer } from './views/components.js';
import { applyTheme, isPrivacyAcknowledged, acknowledgePrivacy } from './settings.js';
import { initServiceWorker, activateUpdate, UPDATE_TEXT } from './app-update.js';
import { onVersionChange, onBlocked, NEWER_VERSION_TEXT, getMeta, setMeta } from './db.js';
import { saveProfile } from './profile.js';
import { validateBirthDate } from './core/body.js';
import { todayString } from './core/utils.js';

export const PRIVACY_TEXT = 'Deine persönlichen Daten werden ausschließlich auf diesem Gerät gespeichert. Rezept- und Produktabfragen an externe Anbieter enthalten keine Angaben zu Alter, Gewicht, Kalorienziel oder persönlichen Gesundheitsdaten.';
export const OFFLINE_TEXT = 'Du bist offline. Lokale und bereits gespeicherte Rezepte stehen weiterhin zur Verfügung.';

const VIEWS = {
  start: () => import('./views/startView.js'),
  'vorrat-rezepte': () => import('./views/pantryMatchView.js'),
  entdecken: () => import('./views/discoverView.js'),
  favoriten: () => import('./views/discoverView.js'),
  einkauf: () => import('./views/shoppingView.js'),
  woche: () => import('./views/plannerView.js'),
  heute: () => import('./views/todayView.js'),
  gewicht: () => import('./views/weightView.js'),
  vorrat: () => import('./views/pantryView.js'),
  tagesziel: () => import('./views/goalsView.js'),
  profil: () => import('./views/profileView.js'),
  einrichtung: () => import('./views/profileView.js'),
  backup: () => import('./views/backupView.js'),
  einstellungen: () => import('./views/settingsView.js'),
  rezept: () => import('./views/recipeDetailView.js'),
  'eigenes-rezept': () => import('./views/customRecipeView.js'),
};

const main = document.getElementById('main');
let renderToken = 0;

function buildNavigation() {
  const side = document.getElementById('side-nav');
  const bottom = document.getElementById('bottom-nav');
  const more = document.getElementById('more-menu');
  clear(side); clear(bottom); clear(more);
  for (const item of NAV_ITEMS) {
    side.append(h('li', {}, h('a', { href: routeHref(item.route), 'data-route': item.route }, icon(item.icon), h('span', {}, item.label))));
    if (item.primary) bottom.append(h('li', {}, h('a', { href: routeHref(item.route), 'data-route': item.route }, icon(item.icon), h('span', {}, item.short ?? item.label))));
    else more.append(h('li', {}, h('a', { href: routeHref(item.route), 'data-route': item.route }, icon(item.icon), h('span', {}, item.label))));
  }
  const moreBtn = h('button', { type: 'button', class: 'more-btn', 'aria-expanded': 'false', 'aria-controls': 'more-panel' }, icon('menu'), h('span', {}, 'Mehr'));
  const panel = document.getElementById('more-panel');
  const setOpen = (open) => { panel.hidden = !open; moreBtn.setAttribute('aria-expanded', String(open)); if (open) panel.querySelector('a')?.focus(); };
  moreBtn.addEventListener('click', () => setOpen(panel.hidden));
  panel.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { setOpen(false); moreBtn.focus(); } });
  document.addEventListener('click', (e) => { if (!panel.hidden && !panel.contains(e.target) && !moreBtn.contains(e.target)) setOpen(false); });
  bottom.append(h('li', {}, moreBtn));
}

function markActive(name) {
  const routeName = name === 'rezept' || name === 'eigenes-rezept' ? 'entdecken' : name === 'einrichtung' ? 'profil' : name;
  document.querySelectorAll('[data-route]').forEach((a) => {
    if (a.dataset.route === routeName) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const moreActive = !NAV_ITEMS.find((n) => n.route === routeName)?.primary;
  document.querySelector('.more-btn')?.classList.toggle('active', moreActive);
}

async function renderRoute() {
  const token = (renderToken += 1);
  const route = parseHash();
  if (!state.profile && route.name !== 'einrichtung' && !['backup', 'einstellungen'].includes(route.name)) {
    location.replace(routeHref('einrichtung'));
    return;
  }
  const loader = VIEWS[route.name] ?? VIEWS.start;
  markActive(route.name);
  clear(main);
  main.append(loading());
  try {
    const mod = await loader();
    if (token !== renderToken) return;
    const view = h('div', { class: 'view' });
    const opts = { id: route.id, params: route.params, wizard: route.name === 'einrichtung', favoritesOnly: route.name === 'favoriten' };
    await mod.render(view, opts);
    if (token !== renderToken) return;
    clear(main);
    main.append(view);
    const title = view.querySelector('h1');
    document.title = title ? `${title.textContent} – VorratsFit` : 'VorratsFit';
    if (document.body.dataset.navigated) title?.focus({ preventScroll: false });
    document.body.dataset.navigated = '1';
    window.scrollTo(0, 0);
  } catch (err) {
    console.error(err);
    if (token !== renderToken) return;
    clear(main);
    main.append(errorBox(`Diese Seite konnte nicht geladen werden: ${err.message}`));
  }
}

function setupOfflineBanner() {
  const banner = document.getElementById('offline-banner');
  banner.textContent = OFFLINE_TEXT;
  const update = () => {
    state.online = navigator.onLine;
    banner.hidden = navigator.onLine;
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

function showUpdateBanner(worker) {
  const banner = document.getElementById('update-banner');
  clear(banner);
  const later = h('button', { type: 'button', class: 'btn' }, 'Später');
  const now = h('button', { type: 'button', class: 'btn btn-primary' }, 'Jetzt aktualisieren');
  later.addEventListener('click', () => { banner.hidden = true; });
  now.addEventListener('click', () => { now.disabled = true; activateUpdate(worker); });
  banner.append(h('p', {}, UPDATE_TEXT), h('div', { class: 'form-actions' }, later, now));
  banner.hidden = false;
}

async function showPrivacyNoticeIfNeeded() {
  if (await isPrivacyAcknowledged()) return;
  await dialog({
    title: 'Datenschutz',
    body: [h('p', {}, PRIVACY_TEXT), h('p', { class: 'small' }, 'Es gibt keine Benutzerkonten, keine Werbung, keine Tracker und keine Cloud-Datenbank.'), allergyDisclaimer()],
    buttons: [{ label: 'Verstanden', value: 'ok', variant: 'primary' }],
    dismissValue: 'ok',
  });
  await acknowledgePrivacy();
}

/**
 * 0.3: Einmalige Abfrage des Geburtsdatums für Profile aus älteren Versionen.
 * „Später“ ist möglich – dann bleibt das bisherige Alter, und die Abfrage erscheint nicht erneut
 * (das Geburtsdatum kann jederzeit im Profil ergänzt werden).
 */
async function askBirthDateOnce() {
  const p = state.profile;
  if (!p || p.birthDate || (await getMeta('birthDatePrompted'))) return;
  const input = h('input', { type: 'date', name: 'birthDate', max: todayString(), 'aria-label': 'Geburtsdatum' });
  const choice = await dialog({
    title: 'Neu: Geburtsdatum statt Alter',
    body: [
      h('p', {}, `Bisher ist dein Alter fest gespeichert (${p.age ?? '–'} Jahre). Mit deinem Geburtsdatum rechnet VorratsFit dein Alter automatisch aus und führt es weiter – dein Tagesziel bleibt so immer aktuell.`),
      h('label', { class: 'label', for: 'birth-prompt' }, 'Geburtsdatum'), input,
      h('p', { class: 'small muted' }, 'Das Datum bleibt ausschließlich auf diesem Gerät.'),
    ],
    buttons: [{ label: 'Später im Profil', value: 'later' }, { label: 'Speichern', value: 'ok', variant: 'primary' }],
    dismissValue: 'later',
    onMount: () => { input.id = 'birth-prompt'; input.focus(); },
  });
  if (choice === 'ok') {
    const msg = validateBirthDate(input.value, todayString());
    if (msg) { toast(`Nicht gespeichert: ${msg} Du kannst es im Profil nachtragen.`, 'error'); }
    else {
      const res = await saveProfile({ ...p, birthDate: input.value }, p);
      if (res.ok) { await refreshProfile(); toast(`Gespeichert. Dein Alter: ${state.profile.age} Jahre.`, 'success'); await renderRoute(); }
    }
  }
  await setMeta('birthDatePrompted', true);
}

async function init() {
  applyTheme();
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme());
  buildNavigation();
  document.getElementById('footer-disclaimer').append(allergyDisclaimer());
  setupOfflineBanner();
  initServiceWorker(showUpdateBanner);
  onVersionChange(() => {
    const b = document.getElementById('update-banner');
    clear(b);
    b.append(h('p', {}, 'VorratsFit wurde in einem anderen Tab aktualisiert. Bitte lade diese Seite neu. Deine Daten bleiben erhalten.'), h('button', { type: 'button', class: 'btn btn-primary', onclick: () => location.reload() }, 'Neu laden'));
    b.hidden = false;
  });
  let blockedShown = false;
  onBlocked(() => {
    blockedShown = true;
    const b = document.getElementById('update-banner');
    clear(b);
    b.append(h('p', {}, 'VorratsFit wird aktualisiert, aber ein anderer geöffneter VorratsFit-Tab hält noch die alte Version offen. Bitte schließe die anderen Tabs. Deine Daten bleiben erhalten.'));
    b.hidden = false;
  });
  try {
    await loadBase();
  } catch (err) {
    clear(main);
    main.append(errorBox(err.message === NEWER_VERSION_TEXT ? err.message : `VorratsFit kann den lokalen Speicher nicht öffnen: ${err.message}. Im privaten Modus mancher Browser ist IndexedDB deaktiviert.`));
    return;
  }
  if (blockedShown) document.getElementById('update-banner').hidden = true;
  await showPrivacyNoticeIfNeeded();
  window.addEventListener('hashchange', renderRoute);
  await renderRoute();
  document.documentElement.dataset.ready = 'true';
  await askBirthDateOnce();
}

init();
