// views/profileView.js – Einrichtungsassistent (erster Start) und Profilbearbeitung.
import { h, field, select, showFieldErrors, toast, withBusy, icon } from './dom.js';
import { pageHeader, allergyDisclaimer } from './components.js';
import { state, refreshProfile } from './state.js';
import { navigate } from './router.js';
import { saveProfile, PROFILE_LIMITS, validateProfileInput } from '../profile.js';
import { ACTIVITY_LEVELS, GOALS, SEXES, DEVICES, DIETS, ALLERGENS } from '../core/models.js';
import { sanitizeText } from '../core/utils.js';

const STEPS = [
  { id: 'basis', title: 'Über dich' },
  { id: 'aktiv', title: 'Aktivität und Ziel' },
  { id: 'kueche', title: 'Küche und Vorlieben' },
  { id: 'allergien', title: 'Allergien und Unverträglichkeiten' },
];

function numInput(name, value, { step = 'any', inputmode = 'decimal' } = {}) {
  const lim = PROFILE_LIMITS[name];
  return h('input', { type: 'number', name, value: value ?? '', min: lim?.min, max: lim?.max, step, inputmode, required: lim?.required || null });
}

function checkboxGroup(legend, name, options, selected = [], hint = null) {
  const set = new Set(selected);
  return h('fieldset', { class: 'checkgroup' },
    h('legend', {}, legend),
    hint ? h('p', { class: 'hint' }, hint) : null,
    h('div', { class: 'checkgrid' }, ...options.map((o) => h('label', { class: 'check' }, h('input', { type: 'checkbox', name, value: o.id, checked: set.has(o.id) }), h('span', {}, o.label)))));
}

function listText(arr) {
  return (arr ?? []).join(', ');
}
function parseList(text) {
  return String(text ?? '').split(/[,;\n]/).map((s) => sanitizeText(s, 60)).filter(Boolean).slice(0, 50);
}

export async function render(container, { wizard = false } = {}) {
  const p = state.profile ?? {};
  let step = 0;
  const knownDeviceIds = DEVICES.map((d) => d.id);
  const customDevices = (p.devices ?? []).filter((d) => !knownDeviceIds.includes(d));

  const form = h('form', { class: 'form wizard', novalidate: true });
  const stepEls = [
    h('fieldset', { class: 'step', 'data-step': '0' },
      h('legend', { class: 'step-legend' }, STEPS[0].title),
      field({ label: 'Spitzname (optional)', input: h('input', { type: 'text', name: 'nickname', value: p.nickname ?? '', maxlength: '40', autocomplete: 'nickname' }) }),
      field({ label: 'Alter (Jahre)', input: numInput('age', p.age, { step: '1', inputmode: 'numeric' }) }),
      field({ label: 'Körpergröße (cm)', input: numInput('heightCm', p.heightCm) }),
      field({ label: 'Gewicht (kg)', input: numInput('weightKg', p.weightKg) }),
      field({ label: 'Wunschgewicht (kg, optional)', input: numInput('targetWeightKg', p.targetWeightKg) }),
      field({ label: 'Geschlecht', input: select('sex', SEXES, p.sex ?? 'unspecified'), hint: 'Wird nur für die Schätzung des Grundumsatzes verwendet. Bei „keine Angabe“ wird ein Mittelwert genutzt.' })),
    h('fieldset', { class: 'step', 'data-step': '1' },
      h('legend', { class: 'step-legend' }, STEPS[1].title),
      field({ label: 'Aktivitätsniveau im Alltag', input: select('activityLevel', ACTIVITY_LEVELS.map((a) => ({ id: a.id, label: `${a.label} (Faktor ${String(a.factor).replace('.', ',')})` })), p.activityLevel ?? 'light') }),
      field({ label: 'Trainingseinheiten pro Woche', input: numInput('trainingSessionsPerWeek', p.trainingSessionsPerWeek ?? 0, { step: '1', inputmode: 'numeric' }) }),
      field({ label: 'Durchschnittliche Trainingsdauer (Minuten)', input: numInput('trainingDurationMinutes', p.trainingDurationMinutes ?? 0, { step: '1', inputmode: 'numeric' }) }),
      field({ label: 'Persönliches Ziel', input: select('goal', GOALS, p.goal ?? 'healthy') }),
      field({ label: 'Gewünschte Gewichtsveränderung pro Woche (kg)', input: numInput('weeklyChangeKg', p.weeklyChangeKg ?? 0.5, { step: '0.05' }), hint: 'Nur beim Ziel „Gewicht reduzieren“. Empfohlen sind vorsichtige 0,25–0,5 kg pro Woche; das Defizit wird automatisch auf höchstens 25 % begrenzt.' }),
      field({ label: 'Bevorzugte Anzahl Mahlzeiten pro Tag', input: numInput('mealsPerDay', p.mealsPerDay ?? 3, { step: '1', inputmode: 'numeric' }) })),
    h('fieldset', { class: 'step', 'data-step': '2' },
      h('legend', { class: 'step-legend' }, STEPS[2].title),
      field({ label: 'Maximale Kochzeit (Minuten)', input: numInput('maxCookingMinutes', p.maxCookingMinutes ?? 30, { step: '5', inputmode: 'numeric' }) }),
      checkboxGroup('Vorhandene Küchengeräte', 'devices', DEVICES, p.devices ?? ['herd']),
      field({ label: 'Weitere Geräte (kommagetrennt, optional)', input: h('input', { type: 'text', name: 'customDevices', value: listText(customDevices), maxlength: '200' }) }),
      checkboxGroup('Ernährungsweisen', 'diets', DIETS, p.diets ?? ['omnivor'], 'Vegetarisch, vegan, pescetarisch, halal, glutenfrei und laktosefrei werden als feste Regeln behandelt.'),
      field({ label: 'Vorlieben (kommagetrennt)', input: h('textarea', { name: 'likes', rows: '2', maxlength: '600' }, listText(p.likes)), hint: 'z. B. Hähnchen, Curry, scharf' }),
      field({ label: 'Abneigungen (kommagetrennt)', input: h('textarea', { name: 'dislikes', rows: '2', maxlength: '600' }, listText(p.dislikes)), hint: 'Rezepte damit werden niedriger bewertet.' })),
    h('fieldset', { class: 'step', 'data-step': '3' },
      h('legend', { class: 'step-legend' }, STEPS[3].title),
      checkboxGroup('Allergien (harte Ausschlusskriterien)', 'allergies', ALLERGENS, p.allergies ?? []),
      field({ label: 'Weitere Allergien (Freitext, kommagetrennt)', input: h('input', { type: 'text', name: 'customAllergies', value: listText(p.customAllergies), maxlength: '300' }) }),
      checkboxGroup('Unverträglichkeiten', 'intolerances', ALLERGENS, p.intolerances ?? [], 'Bei Unverträglichkeiten schlägt VorratsFit nur ausdrücklich hinterlegte Alternativen vor (z. B. laktosefreie Milch).'),
      field({ label: 'Weitere Unverträglichkeiten (Freitext, kommagetrennt)', input: h('input', { type: 'text', name: 'customIntolerances', value: listText(p.customIntolerances), maxlength: '300' }) }),
      allergyDisclaimer()),
  ];

  const progress = h('ol', { class: 'progress', 'aria-label': 'Fortschritt' }, ...STEPS.map((s, i) => h('li', { 'data-i': String(i) }, h('span', { class: 'sr-only' }, `Schritt ${i + 1}: `), s.title)));
  const back = h('button', { type: 'button', class: 'btn' }, 'Zurück');
  const next = h('button', { type: 'button', class: 'btn btn-primary' }, 'Weiter');
  const save = h('button', { type: 'submit', class: 'btn btn-primary' }, wizard ? 'Profil speichern und starten' : 'Profil speichern');
  const formError = h('div', { class: 'form-error', role: 'alert' });

  function collect() {
    const fd = new FormData(form);
    const extra = parseList(fd.get('customDevices'));
    return {
      nickname: fd.get('nickname'),
      age: fd.get('age'), heightCm: fd.get('heightCm'), weightKg: fd.get('weightKg'), targetWeightKg: fd.get('targetWeightKg'),
      sex: fd.get('sex'), activityLevel: fd.get('activityLevel'), trainingSessionsPerWeek: fd.get('trainingSessionsPerWeek'),
      trainingDurationMinutes: fd.get('trainingDurationMinutes'), goal: fd.get('goal'), weeklyChangeKg: fd.get('weeklyChangeKg'),
      mealsPerDay: fd.get('mealsPerDay'), maxCookingMinutes: fd.get('maxCookingMinutes'),
      devices: [...fd.getAll('devices'), ...extra], diets: fd.getAll('diets'),
      likes: parseList(fd.get('likes')), dislikes: parseList(fd.get('dislikes')),
      allergies: fd.getAll('allergies'), customAllergies: parseList(fd.get('customAllergies')),
      intolerances: fd.getAll('intolerances'), customIntolerances: parseList(fd.get('customIntolerances')),
      manualCalorieTarget: p.manualCalorieTarget ?? null,
    };
  }

  function show(i) {
    step = i;
    stepEls.forEach((el, idx) => { el.hidden = idx !== i; });
    progress.querySelectorAll('li').forEach((li, idx) => {
      li.classList.toggle('current', idx === i);
      li.classList.toggle('done', idx < i);
      if (idx === i) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    back.hidden = i === 0;
    next.hidden = i === STEPS.length - 1;
    save.hidden = wizard && i !== STEPS.length - 1;
    const first = stepEls[i].querySelector('input, select, textarea');
    if (first && document.activeElement !== document.body) first.focus();
  }

  back.addEventListener('click', () => show(Math.max(0, step - 1)));
  next.addEventListener('click', () => {
    // Pflichtfelder des aktuellen Schritts vorab prüfen
    const res = validateProfileInput(collect());
    const stepFields = Array.from(stepEls[step].querySelectorAll('[name]')).map((e) => e.name);
    const relevant = Object.fromEntries(Object.entries(res.errors).filter(([k]) => stepFields.includes(k)));
    if (Object.keys(relevant).length) { showFieldErrors(form, relevant); return; }
    showFieldErrors(form, {});
    show(Math.min(STEPS.length - 1, step + 1));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await withBusy(save, async () => {
      formError.textContent = '';
      const res = await saveProfile(collect(), state.profile);
      if (!res.ok) {
        const firstField = Object.keys(res.errors)[0];
        const stepIdx = stepEls.findIndex((el) => el.querySelector(`[name="${firstField}"]`));
        if (stepIdx >= 0) show(stepIdx);
        showFieldErrors(form, res.errors);
        formError.textContent = 'Bitte korrigiere die markierten Angaben.';
        return;
      }
      await refreshProfile();
      toast('Profil gespeichert. Die Daten bleiben auf diesem Gerät.', 'success');
      navigate(wizard ? 'vorrat' : 'tagesziel');
    });
  });

  form.append(progress, ...stepEls, formError, h('div', { class: 'form-actions' }, back, next, save));
  container.append(
    pageHeader(wizard ? 'Willkommen bei VorratsFit' : 'Profil', wizard ? 'Richte dein Profil in vier kurzen Schritten ein. Alle Angaben bleiben ausschließlich auf diesem Gerät.' : 'Deine Angaben werden nur lokal gespeichert und nie an externe Dienste übertragen.'),
    h('p', { class: 'notice notice-info' }, icon('info', { size: 16 }), h('span', {}, 'Pflichtfelder: Alter, Größe, Gewicht, Mahlzeiten pro Tag und maximale Kochzeit.')),
    form,
  );
  show(0);
}
