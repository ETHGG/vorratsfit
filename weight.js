// weight.js – Gewichtsverlauf in IndexedDB. Der jüngste Eintrag aktualisiert das Profilgewicht
// in DERSELBEN Transaktion, damit Tagesziel und Verlauf nie auseinanderlaufen.
import { runTransaction } from './db.js';
import { normalizeWeightEntry, normalizeProfile } from './core/models.js';
import { validateWeightInput } from './core/body.js';
import { nowIso, todayString } from './core/utils.js';

export async function listWeights() {
  const rows = await runTransaction(['weightLog'], 'readonly', (t) => t.getAll('weightLog'));
  return rows.map((r) => normalizeWeightEntry(r)).filter((w) => w.date && w.weightKg !== null).sort((a, b) => a.date.localeCompare(b.date));
}

async function syncProfileWeight(t) {
  const all = (await t.getAll('weightLog')).map((r) => normalizeWeightEntry(r)).filter((w) => w.date && w.weightKg !== null);
  if (!all.length) return null;
  const latest = all.sort((a, b) => b.date.localeCompare(a.date))[0];
  const raw = await t.get('profile', 'main');
  if (!raw) return null;
  if (raw.weightKg !== latest.weightKg) await t.put('profile', { ...raw, weightKg: latest.weightKg, updatedAt: nowIso() });
  return normalizeProfile({ ...raw, weightKg: latest.weightKg });
}

/** Gewicht speichern (ein Eintrag je Tag – gleicher Tag überschreibt). */
export async function saveWeight(input, today = todayString()) {
  const v = validateWeightInput(input, today);
  if (!v.ok) return v;
  return runTransaction(['weightLog', 'profile'], 'readwrite', async (t) => {
    const existing = await t.get('weightLog', `w-${v.values.date}`);
    const entry = normalizeWeightEntry({ ...v.values, note: input.note, createdAt: existing?.createdAt, updatedAt: nowIso() });
    await t.put('weightLog', entry);
    const profile = await syncProfileWeight(t);
    return { ok: true, entry, replaced: !!existing, profileWeightKg: profile?.weightKg ?? null };
  });
}

/** Eintrag löschen. War er der jüngste, gilt danach der neue jüngste Eintrag als Profilgewicht. */
export async function deleteWeight(id) {
  return runTransaction(['weightLog', 'profile'], 'readwrite', async (t) => {
    await t.delete('weightLog', id);
    const profile = await syncProfileWeight(t);
    return { ok: true, profileWeightKg: profile?.weightKg ?? null };
  });
}
