// views/router.js – Hash-Routing (funktioniert unter jedem GitHub-Pages-Unterpfad).
// 0.4: Untere Leiste = die fünf meistgenutzten Bereiche. „Rezepte“ bündelt „Aus meinem Vorrat“ und „Entdecken“.
// 0.7: Untere Leiste = Start · Rezepte · Vorrat · Einkauf · Plan („Heute“ und „Woche“ in einem Tab).
export const NAV_ITEMS = Object.freeze([
  { route: 'start', label: 'Start', icon: 'home', primary: true },
  { route: 'vorrat-rezepte', label: 'Was koche ich?', short: 'Rezepte', icon: 'pot', primary: true, area: 'rezepte' },
  { route: 'vorrat', label: 'Vorrat', icon: 'pantry', primary: true, area: 'vorrat' },
  { route: 'einkauf', label: 'Einkaufsliste', short: 'Einkauf', icon: 'cart', primary: true, area: 'einkauf' },
  { route: 'heute', label: 'Heute gegessen', short: 'Plan', icon: 'calendar', primary: true, area: 'heute' },
  { route: 'woche', label: 'Woche', icon: 'calendar', area: 'woche' },
  { route: 'entdecken', label: 'Rezepte entdecken', icon: 'search', area: 'rezepte' },
  { route: 'gewicht', label: 'Gewicht', icon: 'scale', area: 'gewicht' },
  { route: 'favoriten', label: 'Favoriten', icon: 'heart', area: 'rezepte' },
  { route: 'tagesziel', label: 'Tagesziel', icon: 'target', area: 'heute' },
  { route: 'profil', label: 'Profil', icon: 'user' },
  { route: 'backup', label: 'Backup & Übertragen', icon: 'backup' },
  { route: 'einstellungen', label: 'Einstellungen', icon: 'settings' },
]);

/** Welcher Eintrag der unteren Leiste gehört zu einer Seite? */
export const PRIMARY_FOR = Object.freeze({ entdecken: 'vorrat-rezepte', favoriten: 'vorrat-rezepte', rezept: 'vorrat-rezepte', 'eigenes-rezept': 'vorrat-rezepte', kochen: 'vorrat-rezepte', tagesziel: 'heute', woche: 'heute', gewicht: 'heute' });

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
