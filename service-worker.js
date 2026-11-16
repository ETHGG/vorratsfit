// service-worker.js – Offline-App-Shell mit versioniertem Programm-Cache.
// WICHTIG: Dieser Service Worker verwaltet ausschließlich Programmdateien (Cache Storage).
// Persönliche Daten liegen in IndexedDB und werden hier niemals gelesen, verändert oder gelöscht.

const CACHE_PREFIX = 'vorratsfit-app-';
const CACHE_VERSION = '0.2.0';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;

// Relative Pfade: funktionieren unter jedem Unterpfad (z. B. /vorratsfit/ auf GitHub Pages).
const APP_SHELL = [
  './',
  './index.html',
  './offline.html',
  './styles.css',
  './manifest.webmanifest',
  './app.js',
  './app-update.js',
  './db.js',
  './profile.js',
  './pantry.js',
  './recipes.js',
  './shopping.js',
  './planner.js',
  './foodlog.js',
  './nutrition.js',
  './backup.js',
  './api.js',
  './units.js',
  './settings.js',
  './core/utils.js',
  './core/models.js',
  './core/catalog.js',
  './core/restrictions.js',
  './core/scoring.js',
  './core/shopping-logic.js',
  './core/recipe-tags.js',
  './core/demand.js',
  './core/plan-logic.js',
  './core/cooking.js',
  './core/day-balance.js',
  './core/quick-entry.js',
  './core/share-text.js',
  './views/dom.js',
  './views/router.js',
  './views/state.js',
  './views/components.js',
  './views/startView.js',
  './views/pantryMatchView.js',
  './views/discoverView.js',
  './views/recipeDetailView.js',
  './views/shoppingView.js',
  './views/plannerView.js',
  './views/todayView.js',
  './views/pantryView.js',
  './views/goalsView.js',
  './views/profileView.js',
  './views/backupView.js',
  './views/settingsView.js',
  './views/customRecipeView.js',
  './data/recipes.json',
  './data/ingredients.json',
  './assets/icons/favicon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
  './assets/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  // Kein automatisches skipWaiting: Aktivierung erst nach Zustimmung („Jetzt aktualisieren“).
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL.map((p) => new Request(new URL(p, self.registration.scope), { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // Nur veraltete PROGRAMM-Caches dieser App löschen – sonst nichts.
    await Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    const scopePath = new URL(self.registration.scope).pathname;
    const isAppShell = url.pathname === scopePath || url.pathname === `${scopePath}index.html`;
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      if (isAppShell) {
        const cached = await cache.match(new URL('./index.html', self.registration.scope));
        if (cached) return cached;
      }
      try {
        return await fetch(req);
      } catch {
        return (await cache.match(req, { ignoreSearch: true }))
          || (await cache.match(new URL('./offline.html', self.registration.scope)))
          || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try {
      return await fetch(req);
    } catch {
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});
