// views/customRecipeView.js – eigenes Rezept anlegen (lokal gespeichert).
import { h, field, select, showFieldErrors, toast, withBusy } from './dom.js';
import { pageHeader } from './components.js';
import { shrinkPhoto } from './photo-input.js';
import { setPhoto } from '../photos.js';
import { state, refreshRecipes, refreshPhotos } from './state.js';
import { navigate } from './router.js';
import { buildCustomRecipe, saveCustomRecipe } from '../recipes.js';
import { MEAL_TYPES, DEVICES } from '../core/models.js';

export { shrinkPhoto } from './photo-input.js';

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
    h('div', { class: 'field' }, h('label', { for: 'photo-input', class: 'btn btn-secondary photo-btn' }, '📷 Foto aufnehmen oder auswählen (optional)'), photoIn, preview, h('p', { class: 'hint' }, 'Das Foto bleibt auf diesem Gerät und ist im Backup enthalten.')),
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
      await saveCustomRecipe(res.recipe);
      if (photo) await setPhoto(res.recipe.id, photo);
      await Promise.all([refreshRecipes(), refreshPhotos()]);
      toast('Eigenes Rezept gespeichert.', 'success');
      navigate(`rezept/${encodeURIComponent(res.recipe.id)}`);
    });
  });
  container.append(pageHeader('Eigenes Rezept', 'Eigene Rezepte bleiben auf diesem Gerät und sind im Backup enthalten.'), form);
}
