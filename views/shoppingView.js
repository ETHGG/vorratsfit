// views/shoppingView.js – „Einkaufsliste“: Was muss ich dafür kaufen?
import { h, clear, field, select, stepper, toast, withBusy, icon, dialog, emptyState, showFieldErrors, confirmDialog, announce } from './dom.js';
import { pageHeader, section } from './components.js';
import { state, shoppingContext, refreshSettings } from './state.js';
import { routeHref } from './router.js';
import {
  getShoppingState, recomputeShoppingList, getShoppingRange, clearShoppingRange, updateSelectedServings, removeSelectedRecipe, addManualItem,
  setPurchasedAmount, checkShoppingItem, previewCheckAll, checkAllOpen, getUndoInfo, undoCheck, startNewPurchase, deleteShoppingItem, clearCompleted,
} from '../shopping.js';
import { sortShoppingItems } from '../core/shopping-logic.js';
import { SHOPPING_GROUPS, CATEGORIES, CATEGORY_EMOJI } from '../core/models.js';
import { saveSettings } from '../settings.js';
import { formatAmount, formatNumber, SELECTABLE_UNITS, CHECK_QUANTITY_TEXT } from '../units.js';
import { buildShareText } from '../core/share-text.js';

/** Gänge in der vom Nutzer gewählten Reihenfolge, fehlende hinten angehängt. */
function groupOrder() {
  const own = state.settings?.shoppingGroupOrder ?? [];
  return [...own.filter((g) => SHOPPING_GROUPS.includes(g)), ...SHOPPING_GROUPS.filter((g) => !own.includes(g))];
}

export async function render(container) {
  const selectedBox = h('div', {});
  const listBox = h('div', { 'aria-live': 'polite' });
  const doneBox = h('div', {});
  let data = { items: [], selected: [] };

  async function reload({ recompute = false } = {}) {
    if (recompute) {
      try {
        const res = await recomputeShoppingList(shoppingContext());
        if (res.skipped.length) toast(`${res.skipped.length} Rezept(e) übersprungen: ${res.skipped.map((s) => `${s.title ?? s.label ?? 'Rezept'} (${s.reason})`).join(', ')}`, 'warn');
      } catch (err) { toast(`Neuberechnung fehlgeschlagen: ${err.message}`, 'error'); }
    }
    data = await getShoppingState();
    await drawRange();
    draw();
  }

  const rangeBox = h('div', {});
  async function drawRange() {
    clear(rangeBox);
    const range = await getShoppingRange();
    if (!range) {
      rangeBox.append(h('p', { class: 'small muted' }, 'Wochenplan: Alle kommenden, noch nicht gekochten Mahlzeiten werden berücksichtigt. ', h('a', { href: routeHref('woche') }, 'Zeitraum im Wochenplan wählen')));
      return;
    }
    const all = h('button', { type: 'button', class: 'btn btn-link' }, 'Alle geplanten Mahlzeiten berücksichtigen');
    all.addEventListener('click', () => withBusy(all, async () => { await clearShoppingRange(shoppingContext()); toast('Alle kommenden geplanten Mahlzeiten werden berücksichtigt.'); await reload(); }));
    const fmt = (d) => d.split('-').reverse().join('.');
    rangeBox.append(h('p', { class: 'notice notice-info small' }, icon('info', { size: 14 }), h('span', {}, `Wochenplan berücksichtigt: ${fmt(range.from)} bis ${fmt(range.to)}. `, all)));
  }

  function drawSelected() {
    clear(selectedBox);
    if (!data.selected.length) {
      selectedBox.append(h('p', { class: 'small muted' }, 'Keine einzelnen Rezepte ausgewählt. Öffne ein Rezept und tippe auf „Fehlende Zutaten prüfen“. Geplante Mahlzeiten aus der Woche werden automatisch berücksichtigt.'));
      return;
    }
    selectedBox.append(h('ul', { class: 'plain-list' }, ...data.selected.map((s) => {
      const title = state.recipesById.get(s.recipeId)?.title ?? s.title ?? 'Unbekanntes Rezept';
      const remove = h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': `${title} aus der Auswahl entfernen` }, icon('x'));
      remove.addEventListener('click', () => withBusy(remove, async () => {
        await removeSelectedRecipe(s.recipeId, shoppingContext());
        toast(`${title} entfernt. Gemeinsame Zutaten wurden neu berechnet; gekaufte Artikel bleiben im Vorrat.`);
        await reload();
      }));
      return h('li', { class: 'selected-recipe' },
        h('a', { href: routeHref(`rezept/${encodeURIComponent(s.recipeId)}?portionen=${s.servings}`) }, title),
        stepper({ value: s.servings, onChange: async (v) => { await updateSelectedServings(s.recipeId, v, shoppingContext()); await reload(); } }),
        remove);
    })));
  }

  function amountLine(it) {
    if (it.quantityCheck && typeof it.amountToBuy !== 'number') return h('span', { class: 'badge badge-warn' }, icon('info', { size: 14 }), CHECK_QUANTITY_TEXT);
    return h('span', {}, h('strong', {}, formatAmount(it.amountToBuy, it.unit)), it.quantityCheck ? h('span', { class: 'badge badge-warn' }, icon('info', { size: 14 }), CHECK_QUANTITY_TEXT) : null);
  }

  function sourcesDetails(it) {
    if (!it.recipeSources.length) return h('p', { class: 'small muted' }, 'Manuell hinzugefügt');
    const label = it.recipeSources.length > 1 ? `Benötigt für ${it.recipeSources.length} Rezepte` : `Für ${it.recipeSources[0].title}`;
    return h('details', { class: 'sources' }, h('summary', {}, label),
      h('dl', { class: 'kv-list small' },
        ...it.recipeSources.map((s) => h('div', { class: 'kv' }, h('dt', {}, `${s.title} – ${s.sourceType === 'single' ? 'Einzelrezept' : (s.label ?? 'Plan')} (${s.servings} P.)`), h('dd', {}, formatAmount(s.amount, s.unit)))),
        h('div', { class: 'kv' }, h('dt', {}, 'Gesamtbedarf'), h('dd', {}, formatAmount(it.amountNeeded, it.unit))),
        h('div', { class: 'kv' }, h('dt', {}, 'Vorrat'), h('dd', {}, formatAmount(it.amountAvailable ?? 0, it.unit))),
        h('div', { class: 'kv' }, h('dt', {}, 'Einkaufsmenge'), h('dd', {}, typeof it.amountToBuy === 'number' ? formatAmount(it.amountToBuy, it.unit) : CHECK_QUANTITY_TEXT))));
  }

  function openItem(it) {
    const checkBtn = h('button', { type: 'button', class: 'check-btn', 'aria-label': `${it.name} abhaken und in den Vorrat übernehmen` }, icon('check', { size: 22 }));
    const purchased = h('input', { type: 'number', name: `p-${it.id}`, min: '0', max: '1000000', step: 'any', inputmode: 'decimal', value: it.amountPurchased ?? '', placeholder: typeof it.amountToBuy === 'number' ? formatNumber(it.amountToBuy, it.amountToBuy >= 100 ? 0 : 1) : '', disabled: it.addedToPantry });
    purchased.id = `pur-${it.id}`;
    // 0.7: Feld nur bei Bedarf aufklappen – die Liste bleibt im Laden kurz und übersichtlich.
    const purchasedField = h('details', { class: 'purchased-toggle', open: it.amountPurchased !== null && it.amountPurchased !== undefined && it.amountPurchased !== '' ? true : null },
      h('summary', {}, 'Andere Menge gekauft?'),
      h('div', { class: 'purchased' }, h('label', { for: `pur-${it.id}` }, `Tatsächlich gekauft (${it.unit})`), purchased));
    const err = h('p', { class: 'field-error', role: 'alert' });
    purchased.addEventListener('change', async () => {
      const res = await setPurchasedAmount(it.id, purchased.value.trim());
      err.textContent = res.ok ? '' : res.error;
      if (res.ok) announce(`Gekaufte Menge für ${it.name} gespeichert.`);
    });
    checkBtn.addEventListener('click', () => withBusy(checkBtn, async () => {
      if (!it.addedToPantry && purchased.value.trim() !== String(it.amountPurchased ?? '')) {
        const res = await setPurchasedAmount(it.id, purchased.value.trim());
        if (!res.ok) { err.textContent = res.error; purchased.focus(); return; }
      }
      try {
        const res = await checkShoppingItem(it.id, state.catalog);
        if (res.status === 'added') toast(`${it.name}: ${formatAmount(res.amount, res.unit)} in den Vorrat übernommen (jetzt ${formatAmount(res.pantryAmountAfter, res.unit)}).`, 'success');
        else if (res.status === 'checkedWithoutAdding') toast(`${it.name} abgehakt. Die Menge war bereits im Vorrat und wurde nicht erneut addiert.`);
        await reload();
      } catch (e) {
        err.textContent = e.message;
        purchased.focus();
      }
    }));
    const actions = [];
    if (it.manuallyAdded) {
      const del = h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': `${it.name} löschen` }, icon('trash'));
      del.addEventListener('click', () => withBusy(del, async () => { await deleteShoppingItem(it.id); await reload(); }));
      actions.push(del);
    }
    let resetNote = null;
    if (it.addedToPantry) {
      const again = h('button', { type: 'button', class: 'btn btn-link' }, 'Als neuen Kauf erfassen');
      again.addEventListener('click', () => withBusy(again, async () => { await startNewPurchase(it.id); toast('Neuer Kauf: Beim Abhaken wird die Menge wieder in den Vorrat übernommen.'); await reload(); }));
      resetNote = h('p', { class: 'notice notice-info small' }, icon('info', { size: 14 }), h('span', {}, `Die gekaufte Menge (${formatAmount(it.pantryAmountAdded, it.pantryUnit ?? it.unit)}) ist bereits im Vorrat. Erneutes Abhaken addiert sie nicht noch einmal. `, again));
    }
    return h('li', { class: 'shop-item' },
      checkBtn,
      h('div', { class: 'shop-main' },
        h('p', { class: 'shop-name' }, it.name, ' – ', amountLine(it)),
        sourcesDetails(it),
        it.addedToPantry ? null : purchasedField,
        err,
        resetNote),
      h('div', { class: 'shop-actions' }, ...actions));
  }

  async function reopen(it) {
    const info = await getUndoInfo(it.id);
    const body = [h('p', {}, 'Die gekaufte Menge wurde bereits deinem Vorrat hinzugefügt. Was möchtest du tun?')];
    if (info.missingEntry) body.push(h('p', { class: 'notice notice-warn' }, icon('alert', { size: 16 }), 'Der zugehörige Vorratseintrag existiert nicht mehr. Es kann nichts entfernt werden.'));
    else if (info.changed) body.push(h('p', { class: 'notice notice-warn' }, icon('alert', { size: 16 }), `Achtung: Der Bestand wurde inzwischen verändert (aktuell ${formatAmount(info.current, info.item.pantryUnit ?? it.unit)}). Es werden höchstens ${formatAmount(info.removable, info.item.pantryUnit ?? it.unit)} entfernt – nie mehr als vorhanden.`));
    else body.push(h('p', { class: 'small' }, `Aus dem Vorrat würden ${formatAmount(info.removable, info.item.pantryUnit ?? it.unit)} entfernt.`));
    const choice = await dialog({
      title: `${it.name} wieder öffnen`, body,
      buttons: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Nur auf Einkaufsliste zurücksetzen', value: 'resetOnly' }, { label: 'Aus Vorrat entfernen', value: 'removeFromPantry', variant: 'danger' }],
      dismissValue: 'cancel',
    });
    if (choice !== 'resetOnly' && choice !== 'removeFromPantry') return;
    const res = await undoCheck(it.id, choice);
    toast(res.status === 'removed' ? `${formatAmount(res.removed, res.unit)} aus dem Vorrat entfernt.` : 'Auf die Einkaufsliste zurückgesetzt. Der Vorrat bleibt unverändert.');
    await reload();
  }

  function doneItem(it) {
    const btn = h('button', { type: 'button', class: 'check-btn is-checked', 'aria-label': `${it.name} wieder öffnen` }, icon('check', { size: 22 }));
    btn.addEventListener('click', () => withBusy(btn, () => reopen(it)));
    const del = h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': `${it.name} von der Liste entfernen` }, icon('trash'));
    del.addEventListener('click', () => withBusy(del, async () => { await deleteShoppingItem(it.id); await reload(); }));
    return h('li', { class: 'shop-item done' }, btn,
      h('div', { class: 'shop-main' },
        h('p', { class: 'shop-name' }, h('span', { class: 'sr-only' }, 'Erledigt: '), it.name),
        h('p', { class: 'small' }, it.addedToPantry ? `Gekauft: ${formatAmount(it.amountPurchased, it.unit)} · in den Vorrat übernommen` : 'Abgehakt')),
      h('div', { class: 'shop-actions' }, del));
  }

  function draw() {
    drawSelected();
    shareBtn.disabled = !data.items.some((i) => !i.checked);
    shareBtn.title = shareBtn.disabled ? 'Keine offenen Artikel' : '';
    clear(listBox);
    clear(doneBox);
    const groups = groupOrder();
    const open = sortShoppingItems(data.items.filter((i) => !i.checked), groups);
    const done = sortShoppingItems(data.items.filter((i) => i.checked), groups);
    if (!open.length) {
      listBox.append(emptyState(data.items.length ? 'Alles erledigt!' : 'Die Einkaufsliste ist leer', data.selected.length ? 'Für die ausgewählten Rezepte ist alles im Vorrat.' : 'Füge Rezepte hinzu oder trage Artikel manuell ein.', null, 'einkauf'));
    } else {
      listBox.append(h('p', { class: 'small muted' }, `Noch ${open.length} Artikel zu besorgen`));
      for (const group of groups) {
        const items = open.filter((i) => i.shoppingGroup === group);
        if (!items.length) continue;
        listBox.append(h('h3', { class: 'group-title' }, h('span', { 'aria-hidden': 'true' }, `${CATEGORY_EMOJI[group] ?? '🛒'} `), group), h('ul', { class: 'plain-list shop-list' }, ...items.map(openItem)));
      }
    }
    if (done.length) {
      const clearBtn = h('button', { type: 'button', class: 'btn' }, 'Erledigte von der Liste entfernen');
      clearBtn.addEventListener('click', () => withBusy(clearBtn, async () => {
        if (!(await confirmDialog('Erledigte entfernen?', 'Die abgehakten Artikel werden von der Liste entfernt. Dein Vorrat bleibt unverändert.', { confirmLabel: 'Entfernen' }))) return;
        const n = await clearCompleted();
        toast(`${n} erledigte Artikel entfernt.`);
        await reload();
      }));
      doneBox.append(section(`Erledigt (${done.length})`, h('ul', { class: 'plain-list shop-list' }, ...done.map(doneItem)), clearBtn));
    }
  }

  const mName = h('input', { type: 'text', name: 'name', maxlength: '80', autocomplete: 'off', required: true });
  const mAmount = h('input', { type: 'number', name: 'amount', min: '0', step: 'any', inputmode: 'decimal', value: '1', required: true });
  const mUnit = select('unit', SELECTABLE_UNITS.map((u) => ({ id: u, label: u })), 'Stück');
  const mCat = select('category', CATEGORIES.map((c) => ({ id: c, label: c })), 'Sonstiges');
  const mBtn = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Artikel hinzufügen');
  const mForm = h('form', { class: 'form grid-form', novalidate: true },
    field({ label: 'Artikel', input: mName }),
    h('div', { class: 'row-2' }, field({ label: 'Menge', input: mAmount }), field({ label: 'Einheit', input: mUnit })),
    field({ label: 'Kategorie', input: mCat }),
    h('div', { class: 'form-actions' }, mBtn));
  mName.addEventListener('change', () => {
    const e = state.catalog.resolve(mName.value);
    if (e) { mCat.value = e.category; if (e.defaultUnit) mUnit.value = e.defaultUnit; }
  });
  mForm.addEventListener('submit', (e) => {
    e.preventDefault();
    withBusy(mBtn, async () => {
      const res = await addManualItem({ name: mName.value, amount: mAmount.value, unit: mUnit.value, category: mCat.value }, state.catalog);
      if (!res.ok) { showFieldErrors(mForm, res.errors); return; }
      showFieldErrors(mForm, {});
      mName.value = '';
      mAmount.value = '1';
      toast(`${res.item.name} hinzugefügt.`, 'success');
      await reload();
      mName.focus();
    });
  });

  const allBtn = h('button', { type: 'button', class: 'btn btn-primary' }, icon('check', { size: 16 }), ' Einkauf komplett übernehmen');
  allBtn.addEventListener('click', () => withBusy(allBtn, async () => {
    const pv = await previewCheckAll();
    if (!pv.items.length) { toast(pv.skipped.length ? 'Kein offener Artikel hat eine gültige Menge. Bitte Mengen prüfen.' : 'Keine offenen Artikel.'); return; }
    const c = await dialog({
      title: 'Einkauf komplett übernehmen?',
      body: [
        h('p', {}, `${pv.items.length} ${pv.items.length === 1 ? 'Artikel wird' : 'Artikel werden'} abgehakt und in den Vorrat übernommen:`),
        h('ul', {}, ...pv.items.map((i) => h('li', {}, `${formatAmount(i.amountPurchased ?? i.amountToBuy, i.unit)} ${i.name}`))),
        pv.skipped.length ? h('p', { class: 'notice notice-warn small' }, icon('alert', { size: 14 }), h('span', {}, `Übersprungen (Menge bitte prüfen): ${pv.skipped.map((i) => i.name).join(', ')}`)) : null,
      ],
      buttons: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Übernehmen', value: 'ok', variant: 'primary' }],
      dismissValue: 'cancel',
    });
    if (c !== 'ok') return;
    try {
      const r = await checkAllOpen(state.catalog);
      toast(r.added ? `${r.added} Artikel in den Vorrat übernommen.` : 'Es wurde nichts übernommen (bereits erledigt).', r.added ? 'success' : 'info');
    } catch (err) { toast(`Nicht übernommen – nichts verändert: ${err.message}`, 'error'); }
    await reload();
  }));

  // ---------- Teilen (Phase 6): Teilen-Menü → Zwischenablage → Textfeld zum manuellen Kopieren ----------
  const shareBtn = h('button', { type: 'button', class: 'btn' }, 'Liste teilen');
  const shareOut = h('div', { 'aria-live': 'polite' });
  shareBtn.addEventListener('click', () => withBusy(shareBtn, async () => {
    clear(shareOut);
    const text = buildShareText(data.items);
    if (!text) { toast('Die Liste enthält keine offenen Artikel zum Teilen.'); return; }
    if (typeof navigator.share === 'function') {
      try { await navigator.share({ title: 'Einkaufsliste', text }); return; } catch (err) {
        if (err?.name === 'AbortError') return; // Nutzer hat abgebrochen – keine Fehlermeldung
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      toast('Einkaufsliste in die Zwischenablage kopiert.', 'success');
    } catch {
      const area = h('textarea', { class: 'code share-text', readonly: true, rows: '8', 'aria-label': 'Einkaufsliste zum Kopieren' });
      area.value = text;
      shareOut.append(h('p', { class: 'small' }, 'Kopieren war nicht möglich. Bitte markiere den Text und kopiere ihn manuell:'), area);
      area.focus(); area.select();
    }
  }));

  // 0.6: Reihenfolge der Gänge wie im eigenen Supermarkt
  const orderBtn = h('button', { type: 'button', class: 'btn btn-link' }, icon('menu', { size: 16 }), ' Gänge wie in meinem Supermarkt sortieren');
  orderBtn.addEventListener('click', async () => {
    const order = [...groupOrder()];
    const list = h('ol', { class: 'order-list' });
    const drawList = () => {
      clear(list);
      order.forEach((g, i) => {
        const up = h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': `${g} nach oben`, disabled: i === 0 }, '↑');
        const down = h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': `${g} nach unten`, disabled: i === order.length - 1 }, '↓');
        up.addEventListener('click', () => { [order[i - 1], order[i]] = [order[i], order[i - 1]]; drawList(); list.querySelectorAll('button')[Math.max(0, (i - 1) * 2)]?.focus(); });
        down.addEventListener('click', () => { [order[i + 1], order[i]] = [order[i], order[i + 1]]; drawList(); list.querySelectorAll('button')[(i + 1) * 2 + 1]?.focus(); });
        list.append(h('li', { class: 'order-item' }, h('span', {}, `${CATEGORY_EMOJI[g] ?? '🛒'} ${g}`), h('span', { class: 'order-btns' }, up, down)));
      });
    };
    drawList();
    const c = await dialog({
      title: 'Reihenfolge der Gänge',
      body: [h('p', { class: 'small' }, 'Sortiere die Bereiche so, wie du durch deinen Supermarkt läufst. Die Einkaufsliste folgt dann dieser Reihenfolge.'), list],
      buttons: [{ label: 'Standard', value: 'reset' }, { label: 'Abbrechen', value: 'cancel' }, { label: 'Speichern', value: 'ok', variant: 'primary' }],
      dismissValue: 'cancel',
    });
    if (c === 'cancel') return;
    await saveSettings({ shoppingGroupOrder: c === 'reset' ? [] : order });
    await refreshSettings();
    toast(c === 'reset' ? 'Standard-Reihenfolge wiederhergestellt.' : 'Reihenfolge gespeichert.', 'success');
    await reload();
  });

  const recomputeBtn = h('button', { type: 'button', class: 'btn' }, 'Mit aktuellem Vorrat abgleichen');
  recomputeBtn.addEventListener('click', () => withBusy(recomputeBtn, async () => { await reload({ recompute: true }); toast('Einkaufsliste mit dem Vorrat abgeglichen.'); }));

  container.append(
    pageHeader('Einkaufsliste', 'Nur, was dir wirklich noch fehlt.'),
    section('Zu kaufen', h('p', { class: 'small muted' }, 'Abhaken übernimmt den Artikel automatisch in deinen Vorrat. Bei Bedarf vorher die gekaufte Menge anpassen.'), h('div', { class: 'form-actions' }, allBtn, shareBtn), shareOut, listBox, orderBtn),
    doneBox,
    section('Ausgewählte Rezepte', rangeBox, selectedBox, h('div', { class: 'form-actions' }, recomputeBtn)),
    section('Artikel manuell hinzufügen', mForm),
  );
  // Beim Öffnen immer mit Vorrat und Wochenplan abgleichen (gemeinsame Bedarfsquelle).
  await reload({ recompute: true });
}
