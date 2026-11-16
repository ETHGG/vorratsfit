// views/router.js – Hash-Routing (funktioniert unter jedem GitHub-Pages-Unterpfad).
// 0.4: Untere Leiste = die fünf meistgenutzten Bereiche. „Rezepte“ bündelt „Aus meinem Vorrat“ und „Entdecken“.
export const NAV_ITEMS = Object.freeze([
  { route: 'start', label: 'Start', icon: 'home', primary: true },
  { route: 'vorrat-rezepte', label: 'Aus meinem Vorrat', short: 'Rezepte', icon: 'pot', primary: true, area: 'rezepte' },
  { route: 'woche', label: 'Woche', icon: 'calendar', primary: true, area: 'woche' },
  { route: 'einkauf', label: 'Einkaufsliste', short: 'Einkauf', icon: 'cart', primary: true, area: 'einkauf' },
  { route: 'heute', label: 'Heute gegessen', short: 'Heute', icon: 'check', primary: true, area: 'heute' },
  { route: 'entdecken', label: 'Rezepte entdecken', icon: 'search', area: 'rezepte' },
  { route: 'vorrat', label: 'Vorrat', icon: 'pantry', area: 'vorrat' },
  { route: 'gewicht', label: 'Gewicht', icon: 'scale', area: 'gewicht' },
  { route: 'favoriten', label: 'Favoriten', icon: 'heart', area: 'rezepte' },
  { route: 'tagesziel', label: 'Tagesziel', icon: 'target', area: 'heute' },
  { route: 'profil', label: 'Profil', icon: 'user' },
  { route: 'backup', label: 'Backup', icon: 'backup' },
  { route: 'einstellungen', label: 'Einstellungen', icon: 'settings' },
]);

/** Welcher Eintrag der unteren Leiste gehört zu einer Seite? */
export const PRIMARY_FOR = Object.freeze({ entdecken: 'vorrat-rezepte', favoriten: 'vorrat-rezepte', rezept: 'vorrat-rezepte', 'eigenes-rezept': 'vorrat-rezepte', tagesziel: 'heute' });

export function parseHash(hash = location.hash) {
  const raw = hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map((p) => {
    try { return decodeURIComponent(p); } catch { return ''; }
  });
  const params = new URLSearchParams(query);
  return { name: parts[0] || 'start', id: parts[1] ?? null, params };
}

export function navigate(route) {
  const target = `#/${route}`;
  if (location.hash === target) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = target;
}

export function routeHref(route) {
  return `#/${route}`;
}
