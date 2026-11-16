// views/dom.js – sichere DOM-Helfer (createElement + textContent, kein innerHTML mit Daten).
import { formatNumber } from '../units.js';

/**
 * h('button', { class: 'btn', onclick: fn, 'aria-label': 'x' }, 'Text', child)
 * Strings werden immer als Textknoten eingefügt.
 */
export function h(tag, attrs = {}, ...children) {
  // 0.7: Dezimalfelder als Textfeld mit Zahlentastatur – auf deutschen iPhones lässt sich so „94,6“ mit Komma eingeben
  // (type="number" verwirft das Komma je nach Browser). Geprüft wird ohnehin mit parseNumber().
  if (tag === 'input' && attrs?.type === 'number' && attrs.inputmode === 'decimal') attrs = { ...attrs, type: 'text', autocomplete: 'off', 'data-decimal': 'true', ...(typeof attrs.value === 'number' ? { value: String(attrs.value).replace('.', ',') } : {}) };
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'value') el.value = value;
    else if (key === 'checked') el.checked = !!value;
    else if (key === 'disabled') el.disabled = !!value;
    else if (key === 'selected') el.selected = !!value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'href') el.setAttribute('href', safeHref(value));
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  append(el, children);
  return el;
}

function safeHref(value) {
  const v = String(value);
  if (v.startsWith('#') || v.startsWith('./') || v.startsWith('mailto:')) return v;
  try {
    const u = new URL(v, location.href);
    return u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'blob:' ? u.href : '#';
  } catch {
    return '#';
  }
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  pantry: 'M4 4h16v6H4zM4 14h16v6H4zM9 7h6M9 17h6',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4',
  cart: 'M3 4h2l2 11h11l2-8H7M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM17 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  menu: 'M4 6h16M4 12h16M4 18h16',
  pot: 'M4 10h16v7a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3zM2 10h20M9 6c0-1 1-2 3-2s3 1 3 2',
  heart: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z',
  target: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  backup: 'M12 3v12M7 10l5 5 5-5M4 19h16',
  settings: 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
  check: 'M5 12l5 5L20 7',
  x: 'M6 6l12 12M18 6L6 18',
  minus: 'M5 12h14',
  plus: 'M12 5v14M5 12h14',
  alert: 'M12 3l10 18H2zM12 10v5M12 18v.5',
  clock: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 7v5l3 2',
  info: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 11v6M12 7.5v.5',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  offline: 'M2 8a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01M3 3l18 18',
  scale: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8 9a5 5 0 0 1 8 0M12 9l1.5-2',
  food: 'M7 3v8a2 2 0 0 0 2 2v8M11 3v8M15 3c-1.5 2-1.5 6 0 8v10',
  chevronLeft: 'M15 5l-7 7 7 7',
  chevronRight: 'M9 5l7 7-7 7',
};

/** SVG-Element sicher erzeugen (nur Attribute, kein Markup-Text). */
export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, String(v));
  for (const c of children) if (c !== null && c !== undefined) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

export function icon(name, { size = 20, label = null } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', 'icon');
  if (label) { svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label); } else svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICONS[name] ?? ICONS.info);
  svg.append(path);
  return svg;
}

export function toast(message, type = 'info') {
  const region = document.getElementById('toast-region');
  if (!region) return;
  const el = h('div', { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status' }, message);
  // 0.4: immer nur ein Hinweis gleichzeitig – ein neuer ersetzt den alten, damit nichts den Inhalt verdeckt.
  while (region.children.length >= 1) region.firstElementChild.remove();
  region.append(el);
  const ms = type === 'error' ? 6000 : 2500;
  setTimeout(() => el.classList.add('toast-hide'), ms);
  setTimeout(() => el.remove(), ms + 500);
}

export function announce(message) {
  const live = document.getElementById('sr-live');
  if (live) { live.textContent = ''; setTimeout(() => { live.textContent = message; }, 30); }
}

/** Modaler Dialog mit Schaltflächen. Gibt die gewählte value zurück (oder dismissValue bei Abbruch). */
export function dialog({ title, body = [], buttons = [{ label: 'OK', value: 'ok', variant: 'primary' }], dismissValue = null, onMount = null }) {
  return new Promise((resolve) => {
    const titleId = `dlg-${Math.random().toString(36).slice(2, 8)}`;
    const dlg = h('dialog', { class: 'dialog', 'aria-labelledby': titleId });
    const inner = h('div', { class: 'dialog-inner' });
    inner.append(h('h2', { id: titleId, class: 'dialog-title' }, title));
    append(inner, [h('div', { class: 'dialog-body' }, ...body)]);
    const form = h('form', { method: 'dialog', class: 'dialog-actions' });
    for (const b of buttons) {
      form.append(h('button', { type: 'submit', value: b.value, class: `btn ${b.variant ? `btn-${b.variant}` : ''}` }, b.label));
    }
    inner.append(form);
    dlg.append(inner);
    document.body.append(dlg);
    const previouslyFocused = document.activeElement;
    let result = dismissValue;
    form.addEventListener('submit', (e) => {
      const submitter = e.submitter;
      result = submitter ? submitter.value : dismissValue;
    });
    dlg.addEventListener('cancel', () => { result = dismissValue; });
    dlg.addEventListener('close', () => {
      dlg.remove();
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') previouslyFocused.focus();
      resolve(result === '' ? dismissValue : result);
    });
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    if (onMount) onMount(dlg);
  });
}

export async function confirmDialog(title, message, { confirmLabel = 'Bestätigen', cancelLabel = 'Abbrechen', danger = false } = {}) {
  const v = await dialog({ title, body: [h('p', {}, message)], buttons: [{ label: cancelLabel, value: 'cancel' }, { label: confirmLabel, value: 'ok', variant: danger ? 'danger' : 'primary' }], dismissValue: 'cancel' });
  return v === 'ok';
}

let fieldCounter = 0;
export function field({ label, input, hint = null, error = null, id = null }) {
  const fid = id || input.id || `f${(fieldCounter += 1)}`;
  input.id = fid;
  const hintId = `${fid}-hint`;
  const errId = `${fid}-err`;
  const describedBy = [hint ? hintId : null, errId].filter(Boolean).join(' ');
  input.setAttribute('aria-describedby', describedBy);
  return h('div', { class: 'field' },
    h('label', { for: fid }, label),
    input,
    hint ? h('p', { class: 'hint', id: hintId }, hint) : null,
    h('p', { class: 'field-error', id: errId, role: 'alert' }, error ?? ''));
}

export function showFieldErrors(form, errors) {
  form.querySelectorAll('.field-error').forEach((e) => { e.textContent = ''; });
  form.querySelectorAll('[aria-invalid]').forEach((e) => e.removeAttribute('aria-invalid'));
  let first = null;
  for (const [name, msg] of Object.entries(errors ?? {})) {
    const input = form.querySelector(`[name="${CSS.escape(name)}"]`);
    if (!input) continue;
    input.setAttribute('aria-invalid', 'true');
    const err = form.querySelector(`#${CSS.escape(input.id)}-err`);
    if (err) err.textContent = msg;
    if (!first) first = input;
  }
  if (first) first.focus();
}

export function select(name, options, value, attrs = {}) {
  return h('select', { name, ...attrs }, ...options.map((o) => h('option', { value: o.id ?? o.value ?? o, selected: (o.id ?? o.value ?? o) === value }, o.label ?? o)));
}

export function chip(label, pressed, onToggle, extra = {}) {
  return h('button', { type: 'button', class: 'chip', 'aria-pressed': pressed ? 'true' : 'false', onclick: onToggle, ...extra }, label);
}

/** Stepper wie [-] 4 Personen [+] */
export function stepper({ value, min = 1, max = 50, label = 'Personen', onChange, singular = 'Person' }) {
  const out = h('output', { class: 'stepper-value', 'aria-live': 'polite' }, `${value} ${value === 1 ? singular : label}`);
  const set = (v) => {
    const nv = Math.min(max, Math.max(min, v));
    if (nv === value) return;
    value = nv;
    out.textContent = `${value} ${value === 1 ? singular : label}`;
    minus.disabled = value <= min;
    plus.disabled = value >= max;
    onChange(value);
  };
  const minus = h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': `${singular} weniger`, onclick: () => set(value - 1), disabled: value <= min }, icon('minus'));
  const plus = h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': `${singular} mehr`, onclick: () => set(value + 1), disabled: value >= max }, icon('plus'));
  return h('div', { class: 'stepper', role: 'group', 'aria-label': `Anzahl ${label}` }, minus, out, plus);
}

export function fmtKcal(v) {
  return typeof v === 'number' && Number.isFinite(v) ? `${formatNumber(v, 0)} kcal` : 'kcal unbekannt';
}
export function fmtGram(v, label = '') {
  return typeof v === 'number' && Number.isFinite(v) ? `${formatNumber(v, 1)} g${label ? ` ${label}` : ''}` : `${label ? `${label} ` : ''}unbekannt`;
}
export function fmtMinutes(v) {
  return typeof v === 'number' && Number.isFinite(v) ? `${formatNumber(v, 0)} Min.` : 'Zeit unbekannt';
}

export function loading(text = 'Wird geladen …') {
  return h('div', { class: 'loading', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), text);
}

export function emptyState(title, text, action = null, art = 'leer') {
  const img = art ? h('img', { class: 'empty-art', src: `./assets/illustrations/${art}.svg`, alt: '', width: '160', height: '120' }) : null;
  return h('div', { class: 'empty' }, img, h('p', { class: 'empty-title' }, title), h('p', {}, text), action);
}

export function errorBox(message) {
  return h('div', { class: 'notice notice-error', role: 'alert' }, icon('alert'), h('span', {}, message));
}

/** Wrapper für asynchrone Button-Aktionen: deaktiviert den Button und zeigt einen Ladeindikator. */
export async function withBusy(button, fn) {
  if (button.disabled) return undefined;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.classList.add('is-busy');
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.classList.remove('is-busy');
  }
}
