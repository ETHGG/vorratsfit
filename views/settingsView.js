// views/settingsView.js – Einstellungen: Darstellung, externe Quellen, Speicher, Update, Daten löschen.
import { h, field, select, toast, withBusy, icon, dialog, clear } from './dom.js';
import { pageHeader, section } from './components.js';
import { state, refreshSettings, loadBase } from './state.js';
import { saveSettings, getTheme, setTheme, THEMES, wipeAllPersonalData } from '../settings.js';
import { APP_VERSION } from '../core/models.js';
import { COMMUNITY_DATA_NOTICE } from '../api.js';
import { checkForUpdate } from '../app-update.js';

function toggle(label, name, checked, hint, onChange) {
  const input = h('input', { type: 'checkbox', name, checked, role: 'switch' });
  input.addEventListener('change', () => onChange(input.checked));
  return h('div', { class: 'field' }, h('label', { class: 'check' }, input, h('span', {}, label)), hint ? h('p', { class: 'hint' }, hint) : null);
}

export async function render(container) {
  const s = state.settings;
  const theme = select('theme', THEMES, getTheme());
  theme.addEventListener('change', () => { setTheme(theme.value); toast('Darstellung geändert.'); });
  const save = async (patch, msg) => { await saveSettings(patch); await refreshSettings(); toast(msg, 'success'); };

  const days = h('input', { type: 'number', name: 'expiryWarningDays', min: '0', max: '30', step: '1', value: s.expiryWarningDays, inputmode: 'numeric' });
  days.addEventListener('change', () => save({ expiryWarningDays: days.value }, 'Warnzeitraum gespeichert.'));
  const servings = h('input', { type: 'number', name: 'defaultServings', min: '1', max: '20', step: '1', value: s.defaultServings, inputmode: 'numeric' });
  servings.addEventListener('change', () => save({ defaultServings: servings.value }, 'Standard-Portionen gespeichert.'));

  const storageBox = h('div', { 'aria-live': 'polite' });
  async function drawStorage() {
    clear(storageBox);
    const persisted = navigator.storage?.persisted ? await navigator.storage.persisted().catch(() => false) : false;
    let usage = '';
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate().catch(() => null);
      if (est && Number.isFinite(est.usage)) usage = `Belegt: ca. ${(est.usage / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB.`;
    }
    storageBox.append(h('p', {}, persisted ? 'Dauerhafter Speicher ist aktiv – der Browser löscht die Daten nicht automatisch bei Speichermangel.' : 'Dauerhafter Speicher ist nicht bestätigt. Der Browser könnte Daten bei Speichermangel entfernen.', ' ', usage));
    if (!persisted && navigator.storage?.persist) {
      const btn = h('button', { type: 'button', class: 'btn' }, 'Dauerhaften Speicher anfordern');
      btn.addEventListener('click', () => withBusy(btn, async () => {
        const ok = await navigator.storage.persist().catch(() => false);
        toast(ok ? 'Dauerhafter Speicher aktiviert.' : 'Der Browser hat die Anfrage abgelehnt. Tipp: App installieren und regelmäßig Backups erstellen.');
        await drawStorage();
      }));
      storageBox.append(btn);
    }
  }

  const updBtn = h('button', { type: 'button', class: 'btn' }, 'Nach Updates suchen');
  updBtn.addEventListener('click', () => withBusy(updBtn, async () => {
    const r = await checkForUpdate();
    toast(r === 'available' ? 'Eine neue Version ist verfügbar.' : r === 'unsupported' ? 'Updates werden in dieser Umgebung nicht unterstützt.' : 'VorratsFit ist aktuell.');
  }));

  const wipeBtn = h('button', { type: 'button', class: 'btn btn-danger' }, icon('trash', { size: 16 }), ' Alle persönlichen Daten löschen');
  wipeBtn.addEventListener('click', async () => {
    const input = h('input', { type: 'text', autocomplete: 'off', 'aria-label': 'Zur Bestätigung LÖSCHEN eingeben' });
    const choice = await dialog({
      title: 'Alle Daten löschen?',
      body: [h('p', {}, 'Profil, Vorrat, Einkaufsliste, Wochenplan, Ernährungstagebuch, Gewichtsverlauf, Favoriten, eigene Rezepte und Einstellungen werden unwiderruflich von diesem Gerät gelöscht. Erstelle vorher ein Backup, wenn du die Daten behalten möchtest.'), h('p', {}, 'Gib zur Bestätigung LÖSCHEN ein:'), input],
      buttons: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Endgültig löschen', value: 'wipe', variant: 'danger' }],
      dismissValue: 'cancel',
    });
    if (choice !== 'wipe' || input.value.trim() !== 'LÖSCHEN') { if (choice === 'wipe') toast('Nicht gelöscht – Bestätigung stimmte nicht.'); return; }
    await wipeAllPersonalData();
    await loadBase();
    toast('Alle persönlichen Daten wurden gelöscht.');
    location.hash = '#/start';
  });

  container.append(
    pageHeader('Einstellungen'),
    section('Darstellung', field({ label: 'Farbschema', input: theme })),
    section('Allgemein',
      field({ label: 'Warnung vor Ablauf (Tage)', input: days }),
      field({ label: 'Standard-Personenzahl', input: servings })),
    section('Externe Datenquellen (optional)',
      h('p', { class: 'small' }, 'VorratsFit funktioniert vollständig ohne Internet. Externe Abfragen enthalten niemals Angaben zu Alter, Gewicht, Kalorienziel oder Gesundheitsdaten – nur Suchbegriffe oder Barcodes.'),
      toggle('Online-Rezeptsuche (TheMealDB)', 'externalRecipes', s.externalRecipes, 'Bitte prüfe vor der Nutzung die aktuellen Nutzungsbedingungen von TheMealDB. Die Rezepte sind englischsprachig.', (v) => save({ externalRecipes: v }, v ? 'Online-Rezeptsuche aktiviert.' : 'Online-Rezeptsuche deaktiviert.')),
      toggle('Produktabfrage per Barcode (Open Food Facts)', 'externalProducts', s.externalProducts, COMMUNITY_DATA_NOTICE, (v) => save({ externalProducts: v }, v ? 'Produktabfrage aktiviert.' : 'Produktabfrage deaktiviert.')),
      toggle('Bilder externer Rezepte anzeigen', 'externalImages', s.externalImages, 'Beim Laden von Bildern erfährt der Anbieter deine IP-Adresse. Lokale Rezepte haben keine Fotos.', (v) => save({ externalImages: v }, 'Gespeichert.'))),
    section('Speicher', storageBox),
    section('App', h('p', {}, `Version ${APP_VERSION}. Programmupdates verändern deine persönlichen Daten nicht.`), updBtn),
    section('Daten löschen', h('p', { class: 'small' }, 'Nur auf ausdrücklichen Wunsch. Updates löschen niemals Daten.'), wipeBtn),
  );
  await drawStorage();
}
