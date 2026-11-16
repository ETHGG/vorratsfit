// views/customRecipeView.js – eigenes Rezept anlegen (lokal gespeichert).
import { h, field, select, showFieldErrors, toast, withBusy } from './dom.js';
import { pageHeader } from './components.js';
import { state, refreshRecipes } from './state.js';
import { navigate } from './router.js';
import { buildCustomRecipe, saveCustomRecipe } from '../recipes.js';
import { MEAL_TYPES, DEVICES } from '../core/models.js';

/** Foto verkleinern (max. 900 px, JPEG 80 %) – bleibt nur auf dem Gerät. */
export async function shrinkPhoto(file, max = 900) {
  if (!file || !/^image\//.test(file.type)) throw new Error('Bitte ein Bild auswählen.');
  if (file.size > 25 * 1024 * 1024) throw new Error('Das Bild ist zu groß (max. 25 MB).');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Das Bild konnte nicht gelesen werden.')); i.src = url; });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.8);
  } finally { URL.revokeObjectURL(url); }
}

export async function render(container) {
  const form = h('form', { class: 'form', novalidate: true });
  let photo = null;
  const preview = h('div', { class: 'photo-preview' });
  const photoIn = h('input', { type: 'file', name: 'photo', accept: 'image/*', capture: 'environment', class: 'photo-input', id: 'photo-input' });
  photoIn.addEventListener('change', async () => {
    preview.replaceChildren();
    try {
      photo = photoIn.files?.[0] ? await shrinkPhoto(photoIn.files[0]) : null;
      if (photo) preview.append(h('img', { src: photo, alt: 'Vorschau deines Fotos' }));
    } catch (err) { photo = null; toast(err.message, 'error'); }
  });
  const save = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Rezept speichern');
  form.append(
    field({ label: 'Titel', input: h('input', { type: 'text', name: 'title', maxlength: '120', required: true }) }),
    h('div', { class: 'field' }, h('label', { for: 'photo-input', class: 'photo-label' }, '📷 Foto aufnehmen oder auswählen (optional)'), photoIn, preview, h('p', { class: 'hint' }, 'Das Foto bleibt auf diesem Gerät und ist im Backup enthalten.')),
    field({ label: 'Kurzbeschreibung (optional)', input: h('textarea', { name: 'description', rows: '2', maxlength: '600' }) }),
    h('div', { class: 'row-2' },
      field({ label: 'Mahlzeit', input: select('mealType', MEAL_TYPES, 'mittagessen') }),
      field({ label: 'Portionen', input: h('input', { type: 'number', name: 'servings', min: '1', max: '50', step: '1', value: '2', inputmode: 'numeric' }) })),
    field({ label: 'Gesamtzeit (Minuten)', input: h('input', { type: 'number', name: 'totalMinutes', min: '0', max: '1440', step: '1', value: '20', inputmode: 'numeric' }) }),
    h('fieldset', { class: 'checkgroup' }, h('legend', {}, 'Benötigte Geräte'), h('div', { class: 'checkgrid' }, ...DEVICES.map((d) => h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'devices', value: d.id }), h('span', {}, d.label))))),
    field({ label: 'Zutaten (eine pro Zeile)', input: h('textarea', { name: 'ingredients', rows: '6', maxlength: '4000', placeholder: '400 g Hähnchenbrust\n2 Paprika\n150 g Reis\n1 TL Paprikapulver' }), hint: 'Format: Menge Einheit Name. Unbekannte Mengen werden mit „Menge bitte prüfen“ markiert. Zutaten ohne Stammdaten gelten als „Allergendaten unvollständig“.' }),
    field({ label: 'Zubereitung (ein Schritt pro Zeile)', input: h('textarea', { name: 'instructions', rows: '5', maxlength: '6000' }) }),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'mealPrep' }), h('span', {}, 'Für Meal Prep geeignet')),
    h('div', { class: 'form-actions' }, save));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    withBusy(save, async () => {
      const fd = new FormData(form);
      const res = buildCustomRecipe({
        title: fd.get('title'), description: fd.get('description'), mealType: fd.get('mealType'), servings: fd.get('servings'),
        totalMinutes: fd.get('totalMinutes'), devices: fd.getAll('devices'), ingredients: fd.get('ingredients'), instructions: fd.get('instructions'), mealPrep: fd.get('mealPrep') === 'on',
      }, state.catalog);
      if (!res.ok) { showFieldErrors(form, res.errors); return; }
      await saveCustomRecipe(photo ? { ...res.recipe, photo } : res.recipe);
      await refreshRecipes();
      toast('Eigenes Rezept gespeichert.', 'success');
      navigate(`rezept/${encodeURIComponent(res.recipe.id)}`);
    });
  });
  container.append(pageHeader('Eigenes Rezept', 'Eigene Rezepte bleiben auf diesem Gerät und sind im Backup enthalten.'), form);
}
