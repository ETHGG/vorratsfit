// photos.js – eigene Rezeptfotos (0.7). Ein Foto je Rezept, nur lokal in IndexedDB, im Backup enthalten.
import { runTransaction } from './db.js';
import { normalizeRecipePhoto, isValidPhoto } from './core/models.js';
import { nowIso } from './core/utils.js';

export async function listPhotos() {
  const rows = await runTransaction(['recipePhotos'], 'readonly', (t) => t.getAll('recipePhotos'));
  return rows.map((r) => normalizeRecipePhoto(r)).filter((r) => r.photo);
}

export async function setPhoto(recipeId, photo) {
  if (!recipeId || !isValidPhoto(photo)) throw new Error('Das Foto konnte nicht gespeichert werden.');
  return runTransaction(['recipePhotos'], 'readwrite', async (t) => {
    const existing = await t.get('recipePhotos', recipeId);
    const entry = normalizeRecipePhoto({ id: recipeId, photo, createdAt: existing?.createdAt, updatedAt: nowIso() });
    await t.put('recipePhotos', entry);
    return entry;
  });
}

export async function removePhoto(recipeId) {
  await runTransaction(['recipePhotos'], 'readwrite', (t) => t.delete('recipePhotos', recipeId));
}
