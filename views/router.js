// views/router.js – Hash-Routing (funktioniert unter jedem GitHub-Pages-Unterpfad).
export const NAV_ITEMS = Object.freeze([
  { route: 'vorrat-rezepte', label: 'Aus meinem Vorrat', short: 'Vorrat-Rezepte', icon: 'pot', primary: true },
  { route: 'entdecken', label: 'Rezepte entdecken', short: 'Entdecken', icon: 'search', primary: true },
  { route: 'woche', label: 'Woche', icon: 'calendar', primary: true },
  { route: 'einkauf', label: 'Einkaufsliste', short: 'Einkauf', icon: 'cart', primary: true },
  { route: 'start', label: 'Start', icon: 'home' },
  { route: 'heute', label: 'Heute gegessen', icon: 'check' },
  { route: 'vorrat', label: 'Vorrat', icon: 'pantry' },
  { route: 'favoriten', label: 'Favoriten', icon: 'heart' },
  { route: 'tagesziel', label: 'Tagesziel', icon: 'target' },
  { route: 'profil', label: 'Profil', icon: 'user' },
  { route: 'backup', label: 'Backup', icon: 'backup' },
  { route: 'einstellungen', label: 'Einstellungen', icon: 'settings' },
]);

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
