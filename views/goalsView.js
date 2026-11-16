// views/goalsView.js – Tagesziel: Energie- und Nährwertziele (alle Werte als Schätzung gekennzeichnet).
import { h, field, toast, withBusy, icon, showFieldErrors, emptyState } from './dom.js';
import { pageHeader, section } from './components.js';
import { state, refreshProfile } from './state.js';
import { routeHref } from './router.js';
import { getTargets, saveProfile } from '../profile.js';
import { formatNumber } from '../units.js';
import { ACTIVITY_LEVELS } from '../core/models.js';

function row(label, value, note = null) {
  return h('div', { class: 'kv' }, h('dt', {}, label), h('dd', {}, value, note ? h('span', { class: 'kv-note' }, ` ${note}`) : null));
}

export async function render(container) {
  container.append(pageHeader('Tagesziel', 'Geschätzter Energiebedarf und Nährwertziele auf Basis deines Profils.'));
  const p = state.profile;
  if (!p) {
    container.append(emptyState('Noch kein Profil', 'Lege zuerst ein Profil an, damit VorratsFit deine Ziele schätzen kann.', h('a', { class: 'btn btn-primary', href: routeHref('einrichtung') }, 'Profil anlegen')));
    return;
  }
  const t = getTargets(p);
  if (!t) {
    container.append(emptyState('Ziele nicht berechenbar', 'Für die Berechnung werden Alter, Größe, Gewicht und Aktivitätsniveau benötigt. Bitte ergänze dein Profil.', h('a', { class: 'btn btn-primary', href: routeHref('profil') }, 'Profil bearbeiten')));
    return;
  }
  const est = '(Schätzung)';
  const sign = t.expectedWeeklyChangeKg > 0 ? '+' : '';
  const dl = h('dl', { class: 'kv-list' },
    row('Geschätzter Grundumsatz', `${formatNumber(t.bmr, 0)} kcal`, t.bmrRough ? '(gröbere Schätzung, Mittelwert ohne Geschlechtsangabe)' : est),
    row('Aktivitätsfaktor', `${formatNumber(t.activityFactor, 3)} – ${ACTIVITY_LEVELS.find((a) => a.id === p.activityLevel)?.label ?? ''}`),
    row('Geschätzter Gesamtverbrauch', `${formatNumber(t.tdee, 0)} kcal`, est),
    row('Kalorienziel', `${formatNumber(t.kcalTarget, 0)} kcal`, t.manual ? '(Manuell festgelegt)' : '(empfohlen, Schätzung)'),
    row('Tägliches Defizit', `${formatNumber(t.deficit, 0)} kcal`, t.deficitCapped ? '(auf 25 % begrenzt)' : est),
    t.surplus > 0 ? row('Täglicher Überschuss', `${formatNumber(t.surplus, 0)} kcal`, est) : null,
    row('Erwartete Veränderung pro Woche', `${sign}${formatNumber(t.expectedWeeklyChangeKg, 2)} kg`, '(rechnerischer Richtwert, keine Prognose)'),
    row('Protein-Zielbereich', `${t.proteinMin}–${t.proteinMax} g`, est),
    row('Fett-Mindestmenge', `mind. ${t.fatMin} g`, est),
    row('Verbleibende Kohlenhydrate', `ca. ${t.carbs} g`, est),
    row('Ballaststoffziel', `mind. ${t.fiber} g`, est));

  container.append(section('Deine Werte', dl,
    ...t.notes.map((n) => h('p', { class: 'notice notice-warn' }, icon('alert', { size: 16 }), h('span', {}, n))),
    h('p', { class: 'disclaimer' }, icon('info', { size: 14 }), 'Alle Werte sind Schätzungen nach der Mifflin-St.-Jeor-Formel. Sie ersetzen keine ärztliche oder ernährungsmedizinische Beratung. VorratsFit stellt keine Diagnosen und gibt keine Gewichtsprognosen.')));

  const meals = Math.max(1, p.mealsPerDay || 3);
  container.append(section('Pro Mahlzeit',
    h('p', {}, `Bei ${meals} Mahlzeiten pro Tag entspricht das ungefähr ${formatNumber(t.kcalTarget / meals, 0)} kcal und ${formatNumber(((t.proteinMin + t.proteinMax) / 2) / meals, 0)} g Protein je Mahlzeit. Diese Werte nutzt VorratsFit für die Rezeptbewertung.`)));

  const input = h('input', { type: 'number', name: 'manualCalorieTarget', min: '800', max: '6000', step: '10', inputmode: 'numeric', value: p.manualCalorieTarget ?? '' });
  const saveBtn = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Speichern');
  const resetBtn = h('button', { type: 'button', class: 'btn', hidden: !t.manual }, 'Automatisches Ziel verwenden');
  const form = h('form', { class: 'form inline-form', novalidate: true }, field({ label: 'Kalorienziel manuell festlegen (kcal)', input, hint: 'Leer lassen für das automatisch geschätzte Ziel. Erlaubt: 800–6000 kcal.' }), h('div', { class: 'form-actions' }, saveBtn, resetBtn));
  const persist = async (value) => {
    const res = await saveProfile({ ...p, manualCalorieTarget: value }, p);
    if (!res.ok) { showFieldErrors(form, res.errors); return; }
    await refreshProfile();
    toast(value === null || value === '' ? 'Automatisches Kalorienziel aktiv.' : 'Kalorienziel als „Manuell festgelegt“ gespeichert.', 'success');
    container.replaceChildren();
    await render(container);
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); withBusy(saveBtn, () => persist(input.value.trim() === '' ? null : input.value)); });
  resetBtn.addEventListener('click', () => withBusy(resetBtn, () => persist(null)));
  container.append(section('Manuelles Ziel', form));
}
