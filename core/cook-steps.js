// core/cook-steps.js – Hilfen für den Kochmodus (0.6): Zeitangaben in Schritten erkennen.

/**
 * Findet die erste Zeitangabe in einem Schritt, z. B. „etwa 12 Minuten“, „10–15 Min.“, „1 Stunde“, „30 Sekunden“.
 * Bei Spannen wird der kleinere Wert genommen (lieber früher nachsehen). Gibt Sekunden oder null zurück.
 */
export function detectTimerSeconds(text) {
  if (typeof text !== 'string') return null;
  const t = text.replace(/ /g, ' ');
  const m = t.match(/(\d+(?:[.,]\d+)?)(?:\s*(?:–|-|bis)\s*(\d+(?:[.,]\d+)?))?\s*(Stunden?|Std\.?|Minuten|Minute|Min\.?|Sekunden|Sek\.?)(?![a-zäöü])/i);
  if (!m) return null;
  const value = Number.parseFloat(m[1].replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = m[3].toLowerCase();
  const factor = unit.startsWith('st') ? 3600 : unit.startsWith('sek') ? 1 : 60;
  const seconds = Math.round(value * factor);
  return seconds > 0 && seconds <= 6 * 3600 ? seconds : null;
}

export function formatTimer(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const two = (n) => String(n).padStart(2, '0');
  return hh ? `${hh}:${two(mm)}:${two(ss)}` : `${two(mm)}:${two(ss)}`;
}
