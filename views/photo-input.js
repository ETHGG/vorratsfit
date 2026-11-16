// views/photo-input.js – Fotos verkleinern (0.7, gemeinsam für eigene und mitgelieferte Rezepte).
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
