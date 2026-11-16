// app-update.js – Service-Worker-Registrierung und kontrollierte Update-Aktivierung.
// Updates tauschen nur Programmdateien aus. IndexedDB und localStorage bleiben unangetastet.
export const UPDATE_TEXT = 'Eine neue Version von VorratsFit ist verfügbar. Deine persönlichen Daten, Vorräte und Einkaufslisten bleiben erhalten.';

let registration = null;
let onUpdateAvailable = () => {};
let reloading = false;
let updateRequested = false;

export function initServiceWorker(showBanner) {
  onUpdateAvailable = showBanner;
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  return navigator.serviceWorker.register('./service-worker.js', { scope: './' }).then((reg) => {
    registration = reg;
    if (reg.waiting && navigator.serviceWorker.controller) onUpdateAvailable(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) onUpdateAvailable(sw);
      });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // Nur nach ausdrücklich angefordertem Update neu laden (nicht bei der Erstinstallation).
      if (reloading || !updateRequested) return;
      reloading = true;
      location.reload();
    });
    return reg;
  }).catch((err) => {
    console.warn('Service Worker konnte nicht registriert werden:', err);
    return null;
  });
}

/** Nutzer hat „Jetzt aktualisieren“ gewählt: wartenden Worker aktivieren. */
export function activateUpdate(worker) {
  const w = worker ?? registration?.waiting;
  if (!w) return;
  updateRequested = true;
  w.postMessage({ type: 'SKIP_WAITING' });
}

export async function checkForUpdate() {
  if (!registration) return 'unsupported';
  try {
    await registration.update();
  } catch {
    return 'error';
  }
  if (registration.waiting || registration.installing) return 'available';
  return 'current';
}
