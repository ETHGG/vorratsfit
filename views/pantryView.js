// views/pantryView.js – Vorrat: hinzufügen, bearbeiten, löschen, suchen, filtern, Gewürze, Ablaufdaten.
import { h, field, select, showFieldErrors, toast, withBusy, icon, confirmDialog, dialog, emptyState, clear, errorBox } from './dom.js';
import { pageHeader, section } from './components.js';
import { state } from './state.js';
import { listPantry, savePantryItem, deletePantryItem, changePantryAmount, filterPantry, expiryStatus, isSpiceItem, frequentItems, addFrequentItem, addBulkToPantry } from '../pantry.js';
import { parseBulkLines, MAX_BULK_LINES } from '../core/quick-entry.js';
import { CATEGORIES } from '../core/models.js';
import { SELECTABLE_UNITS, formatAmount, isCountUnit, getDimension } from '../units.js';
import { lookupBarcode, COMMUNITY_DATA_NOTICE, barcodeScanSupported } from '../api.js';

function stepFor(unit) {
  if (isCountUnit(unit)) return 1;
  const d = getDimension(unit);
  if (unit === 'kg' || unit === 'l') return 0.1;
  if (d === 'mass' || d === 'volume') return 50;
  return 1;
}

/** Formular für einen Vorratseintrag (Neu und Bearbeiten). */
function pantryForm(item, { onSaved, submitLabel = 'Hinzufügen', spiceDefault = false }) {
  const catalogNames = state.catalog.list.map((i) => i.name);
  const listId = `cat-${Math.random().toString(36).slice(2, 8)}`;
  const name = h('input', { type: 'text', name: 'name', value: item?.name ?? '', maxlength: '80', list: listId, autocomplete: 'off', required: true });
  const amount = h('input', { type: 'number', name: 'amount', value: item?.amount ?? '', min: '0', max: '1000000', step: 'any', inputmode: 'decimal', required: true });
  const unit = select('unit', SELECTABLE_UNITS.map((u) => ({ id: u, label: u })), item?.unit ?? 'g');
  const category = select('category', [{ id: '', label: 'Automatisch erkennen' }, ...CATEGORIES.map((c) => ({ id: c, label: c }))], item?.category ?? (spiceDefault ? 'Gewürze' : ''));
  const expiry = h('input', { type: 'date', name: 'expiryDate', value: item?.expiryDate ?? '' });
  const barcode = h('input', { type: 'text', name: 'barcode', value: item?.barcode ?? '', inputmode: 'numeric', pattern: '[0-9]{8,14}', maxlength: '14', autocomplete: 'off' });
  const productInfo = h('div', { class: 'product-info', 'aria-live': 'polite' });
  let fetched = null;

  name.addEventListener('change', () => {
    const entry = state.catalog.resolve(name.value);
    if (!entry) return;
    if (!item && entry.defaultUnit && !amount.value) unit.value = entry.defaultUnit;
    if (!category.value) category.value = entry.category;
  });

  const lookupBtn = h('button', { type: 'button', class: 'btn' }, 'Produkt abfragen');
  lookupBtn.addEventListener('click', () => withBusy(lookupBtn, async () => {
    clear(productInfo);
    if (!state.settings.externalProducts) {
      productInfo.append(h('p', { class: 'notice notice-info' }, 'Die Produktabfrage ist deaktiviert. Du kannst sie in den Einstellungen aktivieren.'));
      return;
    }
    try {
      const prod = await lookupBarcode(barcode.value);
      if (!prod) { productInfo.append(h('p', { class: 'notice notice-warn' }, 'Zu diesem Barcode wurde kein Produkt gefunden.')); return; }
      fetched = prod;
      if (prod.name && !name.value) name.value = prod.name;
      const n = prod.nutritionPer100g;
      productInfo.append(h('div', { class: 'notice notice-info' },
        h('p', {}, h('strong', {}, prod.name || 'Unbenanntes Produkt'), prod.brand ? ` (${prod.brand})` : '', prod.quantity ? ` · ${prod.quantity}` : ''),
        n ? h('p', {}, `Pro 100 g: ${n.kcal ?? '–'} kcal · ${n.protein ?? '–'} g Protein · ${n.carbs ?? '–'} g Kohlenhydrate · ${n.fat ?? '–'} g Fett`) : h('p', {}, 'Keine Nährwerte hinterlegt.'),
        prod.allergenHints.length ? h('p', {}, `Angegebene Allergene: ${prod.allergenHints.join(', ')} (nicht garantiert vollständig)`) : h('p', {}, 'Keine Allergenangaben – das bedeutet nicht, dass das Produkt allergenfrei ist.'),
        h('p', { class: 'small' }, COMMUNITY_DATA_NOTICE),
        h('p', { class: 'small' }, 'Quelle: ', h('a', { href: prod.sourceUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Open Food Facts'), ' (Lizenz ODbL)')));
    } catch (err) {
      productInfo.append(errorBox(err.message));
    }
  }));

  let scanBtn = null;
  if (barcodeScanSupported()) {
    scanBtn = h('button', { type: 'button', class: 'btn' }, 'Mit Kamera scannen');
    scanBtn.addEventListener('click', async () => {
      const code = await scanBarcode();
      if (code) { barcode.value = code; lookupBtn.click(); }
    });
  }

  const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, submitLabel);
  const form = h('form', { class: 'form grid-form', novalidate: true },
    h('datalist', { id: listId }, ...catalogNames.map((n) => h('option', { value: n }))),
    field({ label: 'Lebensmittel oder Gewürz', input: name }),
    h('div', { class: 'row-2' }, field({ label: 'Menge', input: amount }), field({ label: 'Einheit', input: unit })),
    field({ label: 'Kategorie', input: category }),
    field({ label: 'Ablaufdatum (optional)', input: expiry }),
    h('details', { class: 'more' }, h('summary', {}, 'Barcode (optional)'),
      field({ label: 'Barcode', input: barcode, hint: state.settings.externalProducts ? 'Nur der Barcode wird an Open Food Facts übertragen.' : 'Online-Produktabfrage ist in den Einstellungen deaktiviert.' }),
      h('div', { class: 'form-actions' }, lookupBtn, scanBtn, !barcodeScanSupported() ? h('span', { class: 'hint' }, 'Kamera-Scan wird von diesem Browser nicht unterstützt – bitte Barcode eintippen.') : null),
      productInfo),
    h('div', { class: 'form-actions' }, submit));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    withBusy(submit, async () => {
      const fd = new FormData(form);
      const input = {
        ...(item ?? {}),
        name: fd.get('name'), amount: fd.get('amount'), unit: fd.get('unit'), category: fd.get('category') || '',
        expiryDate: fd.get('expiryDate') || null, barcode: fd.get('barcode') || null,
      };
      if (fetched?.nutritionPer100g) { input.nutritionPer100g = fetched.nutritionPer100g; input.nutritionSource = 'openfoodfacts'; input.allergenHints = fetched.allergenHints; }
      const res = await savePantryItem(input, state.catalog);
      if (!res.ok) { showFieldErrors(form, res.errors); return; }
      toast(`${res.item.name} gespeichert.`, 'success');
      onSaved(res.item, form);
    });
  });
  return form;
}

/** Kamera-Scan über die BarcodeDetector-API (nur wo vom Browser unterstützt). */
async function scanBarcode() {
  let stream;
  let stop = false;
  const video = h('video', { class: 'scan-video', playsinline: true, muted: true, 'aria-label': 'Kamerabild' });
  const status = h('p', { 'aria-live': 'polite' }, 'Halte den Barcode vor die Kamera …');
  let found = null;
  await dialog({
    title: 'Barcode scannen', body: [video, status], buttons: [{ label: 'Abbrechen', value: 'cancel' }], dismissValue: 'cancel',
    onMount: async (dlg) => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.srcObject = stream;
        await video.play();
        // eslint-disable-next-line no-undef
        const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
        while (!stop && !found) {
          const codes = await detector.detect(video).catch(() => []);
          if (codes.length && /^\d{8,14}$/.test(codes[0].rawValue)) { found = codes[0].rawValue; dlg.close(); break; }
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch {
        status.textContent = 'Kamera nicht verfügbar oder Zugriff verweigert. Bitte Barcode eintippen.';
      }
    },
  });
  stop = true;
  stream?.getTracks().forEach((t) => t.stop());
  return found;
}

export async function render(container) {
  const filters = { query: '', category: '', tab: 'food', expiringOnly: false };
  const warnDays = state.settings?.expiryWarningDays ?? 3;
  const listEl = h('div', { class: 'pantry-list', 'aria-live': 'polite' });
  let items = [];

  async function reload() {
    items = await listPantry();
    draw();
  }

  function itemRow(it) {
    const exp = expiryStatus(it, warnDays);
    const minusBtn = h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': `${it.name}: Menge verringern` }, icon('minus'));
    const plusBtn = h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': `${it.name}: Menge erhöhen` }, icon('plus'));
    const step = stepFor(it.unit);
    minusBtn.addEventListener('click', () => withBusy(minusBtn, async () => { await changePantryAmount(it.id, -step); await reload(); }));
    plusBtn.addEventListener('click', () => withBusy(plusBtn, async () => { await changePantryAmount(it.id, step); await reload(); }));
    const editBtn = h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': `${it.name} bearbeiten` }, icon('edit'));
    editBtn.addEventListener('click', () => editItem(it));
    const delBtn = h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': `${it.name} löschen` }, icon('trash'));
    delBtn.addEventListener('click', async () => {
      if (await confirmDialog('Eintrag löschen?', `„${it.name}“ wird aus deinem Vorrat entfernt.`, { confirmLabel: 'Löschen', danger: true })) {
        await deletePantryItem(it.id);
        toast(`${it.name} gelöscht.`);
        await reload();
      }
    });
    return h('li', { class: `pantry-item ${exp && exp.level !== 'ok' ? `exp-${exp.level}` : ''}` },
      h('div', { class: 'pi-main' },
        h('p', { class: 'pi-name' }, it.name),
        h('p', { class: 'pi-meta' }, h('strong', {}, formatAmount(it.amount, it.unit, { humanize: false })), ` · ${it.category}`),
        exp ? h('p', { class: `pi-exp exp-text-${exp.level}` }, icon(exp.level === 'ok' ? 'clock' : 'alert', { size: 14 }), ` ${exp.label}`) : null,
        it.amount === 0 ? h('p', { class: 'pi-exp exp-text-soon' }, 'Aufgebraucht') : null),
      h('div', { class: 'pi-actions' }, minusBtn, plusBtn, editBtn, delBtn));
  }

  async function editItem(it) {
    const holder = h('div', {});
    let closeFn = null;
    holder.append(pantryForm(it, { submitLabel: 'Änderungen speichern', onSaved: async () => { closeFn?.(); await reload(); } }));
    await dialog({ title: `${it.name} bearbeiten`, body: [holder], buttons: [{ label: 'Schließen', value: 'close' }], dismissValue: 'close', onMount: (dlg) => { closeFn = () => dlg.close(); } });
  }

  function draw() {
    clear(listEl);
    const spiceMode = filters.tab === 'spices' ? 'only' : 'exclude';
    const visible = filterPantry(items, { query: filters.query, category: filters.category, spices: spiceMode, expiringOnly: filters.expiringOnly, warnDays });
    const totalFood = items.filter((i) => !isSpiceItem(i)).length;
    const totalSpices = items.filter(isSpiceItem).length;
    tabFood.textContent = `Lebensmittel (${totalFood})`;
    tabSpice.textContent = `Gewürze (${totalSpices})`;
    if (!visible.length) {
      listEl.append(emptyState(items.length ? 'Keine Treffer' : 'Dein Vorrat ist noch leer', items.length ? 'Ändere die Suche oder die Filter.' : 'Füge oben deine ersten Lebensmittel hinzu. Gewürze kannst du im Reiter „Gewürze“ getrennt verwalten.'));
      return;
    }
    listEl.append(h('p', { class: 'small muted' }, `${visible.length} ${visible.length === 1 ? 'Eintrag' : 'Einträge'}`), h('ul', { class: 'plain-list' }, ...visible.map(itemRow)));
  }

  const addHolder = h('div', {});
  const renderAddForm = () => {
    clear(addHolder);
    addHolder.append(pantryForm(null, {
      spiceDefault: filters.tab === 'spices',
      onSaved: async () => { renderAddForm(); await reload(); await drawFrequent(); addHolder.querySelector('input[name="name"]')?.focus(); },
    }));
  };

  // ---------- Schnellerfassen ----------
  const freqBox = h('div', { class: 'quick-grid' });
  async function drawFrequent() {
    clear(freqBox);
    const list = await frequentItems();
    if (!list.length) { freqBox.append(h('p', { class: 'small muted' }, 'Hier erscheinen deine häufig erfassten Lebensmittel als Ein-Tipp-Knöpfe.')); return; }
    for (const f of list) {
      const b = h('button', { type: 'button', class: 'btn quick-btn', 'aria-label': `${f.name}: ${formatAmount(f.amount, f.unit)} zum Vorrat hinzufügen` }, h('span', { class: 'quick-name' }, f.name), h('span', { class: 'small muted' }, `+ ${formatAmount(f.amount, f.unit)}`));
      b.addEventListener('click', () => withBusy(b, async () => {
        const r = await addFrequentItem(f, state.catalog);
        toast(r.status === 'increased' ? `${f.name}: Menge erhöht.` : `${f.name} hinzugefügt.`, 'success');
        await reload(); await drawFrequent();
      }));
      freqBox.append(b);
    }
  }
  const bulkArea = h('textarea', { name: 'bulk', rows: '5', maxlength: '4000', placeholder: '500 g Hähnchen\n1 kg Reis\n6 Eier' });
  const bulkPreview = h('div', { 'aria-live': 'polite' });
  const bulkCheck = h('button', { type: 'button', class: 'btn' }, 'Vorschau');
  const bulkSave = h('button', { type: 'button', class: 'btn btn-primary', disabled: true }, 'Gültige Zeilen speichern');
  let bulkItems = [];
  bulkCheck.addEventListener('click', () => {
    const r = parseBulkLines(bulkArea.value, state.catalog);
    bulkItems = r.items;
    clear(bulkPreview);
    if (!r.items.length) { bulkPreview.append(h('p', { class: 'small' }, 'Keine Zeilen erkannt.')); bulkSave.disabled = true; return; }
    bulkPreview.append(h('ul', { class: 'plain-list bulk-list' }, ...r.items.map((i) => h('li', { class: 'ing-item' },
      i.status === 'ok' ? h('span', { class: 'badge badge-ok' }, icon('check', { size: 12 }), 'OK') : h('span', { class: 'badge badge-warn' }, icon('info', { size: 12 }), 'Menge bitte prüfen'),
      h('span', {}, i.status === 'ok' ? `${formatAmount(i.amount, i.unit, { humanize: false })} ${i.name}` : `„${i.line}“ – ${i.reason}`)))));
    if (r.duplicates.length) bulkPreview.append(h('p', { class: 'small' }, `Doppelte Zeilen (werden addiert): ${r.duplicates.join(', ')}`));
    if (r.truncated) bulkPreview.append(h('p', { class: 'notice notice-warn small' }, `Nur die ersten ${MAX_BULK_LINES} Zeilen werden berücksichtigt (${r.truncated} weitere ignoriert).`));
    bulkSave.disabled = !r.items.some((i) => i.status === 'ok');
  });
  bulkSave.addEventListener('click', () => withBusy(bulkSave, async () => {
    const res = await addBulkToPantry(bulkItems, state.catalog);
    toast(`${res.saved} gespeichert${res.skipped ? `, ${res.skipped} zum Prüfen übersprungen` : ''}.`, res.skipped ? 'warn' : 'success');
    bulkArea.value = ''; bulkItems = []; clear(bulkPreview);
    await reload(); await drawFrequent();
  }));
  bulkSave.addEventListener('click', () => { bulkSave.disabled = true; });

  const search = h('input', { type: 'search', name: 'q', placeholder: 'Vorrat durchsuchen', autocomplete: 'off' });
  search.addEventListener('input', () => { filters.query = search.value; draw(); });
  const cat = select('cat', [{ id: '', label: 'Alle Kategorien' }, ...CATEGORIES.map((c) => ({ id: c, label: c }))], '');
  cat.addEventListener('change', () => { filters.category = cat.value; draw(); });
  const exp = h('input', { type: 'checkbox', name: 'exp' });
  exp.addEventListener('change', () => { filters.expiringOnly = exp.checked; draw(); });

  const tabFood = h('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': 'true', id: 'tab-food', 'aria-controls': 'pantry-panel' }, 'Lebensmittel');
  const tabSpice = h('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': 'false', id: 'tab-spice', 'aria-controls': 'pantry-panel', tabindex: '-1' }, 'Gewürze');
  const selectTab = (tab) => {
    filters.tab = tab;
    tabFood.setAttribute('aria-selected', String(tab === 'food'));
    tabSpice.setAttribute('aria-selected', String(tab === 'spices'));
    tabFood.tabIndex = tab === 'food' ? 0 : -1;
    tabSpice.tabIndex = tab === 'spices' ? 0 : -1;
    renderAddForm();
    draw();
  };
  tabFood.addEventListener('click', () => selectTab('food'));
  tabSpice.addEventListener('click', () => selectTab('spices'));
  const tablist = h('div', { role: 'tablist', class: 'tabs', 'aria-label': 'Vorratsbereiche' }, tabFood, tabSpice);
  tablist.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const t = filters.tab === 'food' ? 'spices' : 'food'; selectTab(t); (t === 'food' ? tabFood : tabSpice).focus(); }
  });

  container.append(
    pageHeader('Vorrat', 'Erfasse Lebensmittel und Gewürze mit Menge und optionalem Ablaufdatum.'),
    tablist,
    h('div', { id: 'pantry-panel', role: 'tabpanel', 'aria-labelledby': 'tab-food' },
      section('Schnell hinzufügen', freqBox, h('details', { class: 'more' }, h('summary', {}, 'Mehrere auf einmal eintragen'),
        field({ label: `Ein Lebensmittel pro Zeile (max. ${MAX_BULK_LINES})`, input: bulkArea, hint: 'Format: Menge Einheit Name, z. B. „500 g Hähnchen“. Unklare Zeilen werden nicht geraten, sondern markiert.' }),
        h('div', { class: 'form-actions' }, bulkCheck, bulkSave), bulkPreview)),
      section('Hinzufügen', addHolder),
      section('Bestand',
        h('div', { class: 'toolbar' },
          field({ label: 'Suche', input: search }),
          field({ label: 'Kategorie', input: cat }),
          h('label', { class: 'check' }, exp, h('span', {}, `Nur bald ablaufende (≤ ${warnDays} Tage) und abgelaufene`))),
        listEl)),
  );
  renderAddForm();
  await reload();
  await drawFrequent();
}
