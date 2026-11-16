// views/backupView.js – Backup erstellen (Code/JSON), importieren mit Vorschau, Zusammenführen oder Ersetzen.
import { h, clear, field, toast, withBusy, icon, errorBox, confirmDialog } from './dom.js';
import { pageHeader, section } from './components.js';
import { loadBase } from './state.js';
import {
  createBackupFromDatabase, encodeBackupCode, parseBackupInput, buildImportPreview, readCurrentData, applyImport,
  backupFileName, STORE_LABELS, LONG_CODE_THRESHOLD, MAX_FILE_BYTES, markBackupCreated,
} from '../backup.js';

/** 0.7: Backup als Datei teilen (iPhone: AirDrop, Nachrichten, Mail …) – Fallback: herunterladen. */
async function shareBackupFile() {
  const backup = await createBackupFromDatabase();
  const json = JSON.stringify(backup);
  const name = backupFileName();
  const file = new File([json], name, { type: 'application/json' });
  await markBackupCreated(backup.createdAt);
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'VorratsFit-Backup' });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'aborted';
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'downloaded';
}

export async function render(container) {
  const transferBtn = h('button', { type: 'button', class: 'btn btn-primary' }, icon('backup', { size: 18 }), ' Daten an anderes Gerät senden');
  transferBtn.addEventListener('click', () => withBusy(transferBtn, async () => {
    try {
      const r = await shareBackupFile();
      if (r === 'shared') toast('Gesendet. Auf dem anderen Gerät: VorratsFit → Backup → Datei auswählen.', 'success');
      else if (r === 'downloaded') toast('Backup-Datei gespeichert. Übertrage sie auf das andere Gerät und wähle sie dort unter „Backup wiederherstellen“ aus.', 'success');
    } catch (err) { toast(`Senden fehlgeschlagen: ${err.message}`, 'error'); }
  }));
  const exportOut = h('div', { 'aria-live': 'polite' });
  const createBtn = h('button', { type: 'button', class: 'btn btn-primary' }, 'Backup erstellen');
  createBtn.addEventListener('click', () => withBusy(createBtn, async () => {
    clear(exportOut);
    try {
      const backup = await createBackupFromDatabase();
      const code = encodeBackupCode(backup);
      const json = JSON.stringify(backup, null, 2);
      await markBackupCreated(backup.createdAt);
      const area = h('textarea', { class: 'code', readonly: true, rows: '5', 'aria-label': 'Backup-Code', spellcheck: 'false' });
      area.value = code;
      const copyBtn = h('button', { type: 'button', class: 'btn' }, 'Code kopieren');
      copyBtn.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(code); toast('Backup-Code kopiert.', 'success'); } catch { area.select(); toast('Bitte den markierten Code manuell kopieren.'); }
      });
      const dlBtn = h('button', { type: 'button', class: 'btn' }, 'Als JSON-Datei speichern');
      dlBtn.addEventListener('click', () => {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = backupFileName();
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      });
      const counts = Object.entries(backup.data).map(([k, v]) => `${STORE_LABELS[k] ?? k}: ${v.length}`).join(' · ');
      exportOut.append(
        h('p', { class: 'small' }, `Erstellt am ${new Date(backup.createdAt).toLocaleString('de-DE')} · ${counts}`),
        h('p', { class: 'small' }, 'Prüfsumme (SHA-256): ', h('code', {}, `${backup.checksum.slice(0, 16)}…`)),
        code.length > LONG_CODE_THRESHOLD ? h('p', { class: 'notice notice-warn' }, icon('alert', { size: 16 }), `Der Code ist sehr lang (${code.length.toLocaleString('de-DE')} Zeichen). Für die Übertragung ist die JSON-Datei zuverlässiger.`) : null,
        field({ label: 'Backup-Code', input: area }),
        h('div', { class: 'form-actions' }, copyBtn, dlBtn),
        h('p', { class: 'small muted' }, 'Der Code enthält deine persönlichen Daten. Teile ihn nur mit dir selbst (z. B. für einen Gerätewechsel).'));
    } catch (err) {
      exportOut.append(errorBox(`Backup fehlgeschlagen: ${err.message}`));
    }
  }));

  const importArea = h('textarea', { name: 'code', rows: '5', class: 'code', spellcheck: 'false', placeholder: 'Backup-Code oder JSON hier einfügen' });
  const fileInput = h('input', { type: 'file', name: 'file', accept: 'application/json,.json,text/plain' });
  const checkBtn = h('button', { type: 'button', class: 'btn btn-primary' }, 'Backup prüfen');
  const preview = h('div', { 'aria-live': 'polite' });

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) { clear(preview); preview.append(errorBox('Die Datei ist größer als 60 MB und wird nicht gelesen.')); return; }
    importArea.value = await f.text();
    checkBtn.click();
  });

  checkBtn.addEventListener('click', () => withBusy(checkBtn, async () => {
    clear(preview);
    const parsed = await parseBackupInput(importArea.value);
    if (!parsed.ok) { preview.append(errorBox(parsed.errors.join(' '))); return; }
    const current = await readCurrentData();
    const rows = buildImportPreview(parsed.data, current);
    const table = h('table', { class: 'nutri' }, h('caption', {}, 'Importvorschau'),
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Bereich'), h('th', { scope: 'col' }, 'im Backup'), h('th', { scope: 'col' }, 'neu'), h('th', { scope: 'col' }, 'bereits vorhanden'), h('th', { scope: 'col' }, 'aktuell auf dem Gerät'))),
      h('tbody', {}, ...rows.map((r) => h('tr', {}, h('th', { scope: 'row' }, STORE_LABELS[r.store] ?? r.store), h('td', {}, String(r.incoming)), h('td', {}, String(r.newRecords)), h('td', {}, String(r.overlapping)), h('td', {}, String(r.current))))));
    const modeMerge = h('input', { type: 'radio', name: 'mode', value: 'merge', checked: true });
    const modeReplace = h('input', { type: 'radio', name: 'mode', value: 'replace' });
    const importBtn = h('button', { type: 'button', class: 'btn btn-primary' }, 'Import durchführen');
    importBtn.addEventListener('click', () => withBusy(importBtn, async () => {
      const mode = modeReplace.checked ? 'replace' : 'merge';
      if (mode === 'replace' && !(await confirmDialog('Alle Daten ersetzen?', 'Beim vollständigen Ersetzen werden Profil, Vorrat, Einkaufsliste, Favoriten, eigene Rezepte und Einstellungen auf diesem Gerät durch das Backup ersetzt. Dies kann nicht rückgängig gemacht werden. Erstelle vorher ggf. ein Backup.', { confirmLabel: 'Ja, ersetzen', danger: true }))) return;
      try {
        const stats = await applyImport(parsed.data, mode);
        await loadBase();
        clear(preview);
        preview.append(h('p', { class: 'notice notice-success', role: 'status' }, icon('check', { size: 16 }), `Import abgeschlossen (${mode === 'replace' ? 'ersetzt' : 'zusammengeführt'}): ${stats.added} hinzugefügt, ${stats.updated} aktualisiert, ${stats.kept} lokale Einträge behalten.`));
        importArea.value = '';
        toast('Backup importiert.', 'success');
      } catch (err) {
        preview.append(errorBox(`Import fehlgeschlagen – es wurden keine Daten verändert. (${err.message})`));
      }
    }));
    preview.append(
      h('p', { class: 'notice notice-success' }, icon('check', { size: 16 }), `Backup gültig. Prüfsumme bestätigt. Erstellt: ${parsed.meta.createdAt ? new Date(parsed.meta.createdAt).toLocaleString('de-DE') : 'unbekannt'} · App-Version ${parsed.meta.appVersion}${parsed.meta.migrated ? ' · aus älterer Backup-Version migriert' : ''}.`),
      table,
      h('fieldset', { class: 'checkgroup' }, h('legend', {}, 'Wie soll importiert werden?'),
        h('label', { class: 'check' }, modeMerge, h('span', {}, h('strong', {}, 'Zusammenführen'), ' – neue Einträge ergänzen; bei gleichen Einträgen gewinnt der neuere Stand.')),
        h('label', { class: 'check' }, modeReplace, h('span', {}, h('strong', {}, 'Vollständig ersetzen'), ' – aktuelle Daten werden durch das Backup ersetzt.'))),
      h('div', { class: 'form-actions' }, importBtn));
  }));

  container.append(
    pageHeader('Backup', 'Sichere deine Daten oder übertrage sie auf ein anderes Gerät.'),
    section('Auf ein anderes Gerät übertragen',
      h('ol', { class: 'transfer-steps' },
        h('li', {}, 'Hier auf „Daten an anderes Gerät senden“ tippen – auf dem iPhone z. B. per AirDrop, Nachrichten oder Mail.'),
        h('li', {}, 'Auf dem neuen Gerät VorratsFit öffnen → Menü „Mehr“ → „Backup & Übertragen“.'),
        h('li', {}, 'Unter „Backup wiederherstellen“ die empfangene Datei auswählen und importieren.')),
      h('div', { class: 'form-actions' }, transferBtn),
      h('p', { class: 'small muted' }, 'Es wird nichts über einen Server übertragen – die Datei geht direkt von Gerät zu Gerät.')),
    h('p', { class: 'notice notice-warn' }, icon('alert', { size: 16 }), h('span', {}, 'Deine Daten liegen nur im Browser dieses Geräts. Wenn du Website-Daten löschst oder den Browser zurücksetzt, gehen sie verloren. Erstelle regelmäßig ein Backup.')),
    section('Backup erstellen', h('p', { class: 'small' }, 'Enthalten: Profil, Vorrat inkl. Gewürze, Favoriten, eigene Rezepte, gespeicherte Online-Rezepte, Einkaufsliste, ausgewählte Rezepte mit Portionen, Wochenplan, Ernährungstagebuch, Gewichts- und Wasserverlauf, eigene Rezeptfotos, eigene Schnell-Lebensmittel und Einstellungen. Nicht enthalten: Häufigkeit der Schnellerfassung und gewählter Einkaufszeitraum (Geräteeinstellungen).'), createBtn, exportOut),
    section('Backup wiederherstellen',
      field({ label: 'Backup-Code oder JSON', input: importArea }),
      field({ label: 'Oder JSON-Datei auswählen', input: fileInput }),
      h('div', { class: 'form-actions' }, checkBtn),
      h('p', { class: 'small muted' }, 'Vor dem Import werden Format, Version, Struktur und Prüfsumme geprüft. Beschädigte oder veränderte Backups werden abgelehnt. Der Import erfolgt vollständig oder gar nicht.'),
      preview),
  );
}
