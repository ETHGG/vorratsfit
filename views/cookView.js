// views/cookView.js – Kochmodus (0.6): ein Schritt pro Bildschirm, große Schrift, Timer, Bildschirm bleibt an.
import { h, clear, icon, toast } from './dom.js';
import { recipeArt } from './components.js';
import { state } from './state.js';
import { routeHref } from './router.js';
import { formatAmount } from '../units.js';
import { detectTimerSeconds, formatTimer } from '../core/cook-steps.js';

let wakeLock = null;
async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { wakeLock = null; }
}
function releaseAwake() {
  try { wakeLock?.release(); } catch { /* bereits freigegeben */ }
  wakeLock = null;
}

function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [0, 0.35, 0.7].forEach((t) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.25);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.3);
    });
  } catch { /* Ton ist optional */ }
  navigator.vibrate?.([300, 150, 300]);
}

export async function render(container, { id, params }) {
  const r = state.recipesById.get(id);
  if (!r) {
    container.append(h('h1', { tabindex: '-1' }, 'Rezept nicht gefunden'), h('a', { class: 'btn', href: routeHref('entdecken') }, 'Zu den Rezepten'));
    return;
  }
  const servings = Math.min(50, Math.max(1, Number.parseInt(params?.get('portionen') ?? '', 10) || r.defaultServings));
  const factor = servings / r.defaultServings;
  const steps = r.instructions.length ? r.instructions : ['Für dieses Rezept sind keine Schritte hinterlegt.'];
  let index = 0;
  let timer = null; // { total, left, handle, running }

  const backHref = routeHref(`rezept/${encodeURIComponent(r.id)}?portionen=${servings}`);
  const stage = h('div', { class: 'cook-stage', 'aria-live': 'polite' });
  const dots = h('div', { class: 'cook-dots', 'aria-hidden': 'true' });
  const prev = h('button', { type: 'button', class: 'btn cook-nav', 'aria-label': 'Vorheriger Schritt' }, icon('chevronLeft', { size: 26 }), h('span', {}, 'Zurück'));
  const next = h('button', { type: 'button', class: 'btn btn-primary cook-nav', 'aria-label': 'Nächster Schritt' }, h('span', {}, 'Weiter'), icon('chevronRight', { size: 26 }));
  const timerBox = h('div', { class: 'cook-timer-box' });

  function stopTimer() { if (timer?.handle) clearInterval(timer.handle); timer = null; }

  function drawTimer(seconds) {
    clear(timerBox);
    if (!seconds) return;
    if (!timer) {
      const start = h('button', { type: 'button', class: 'btn btn-secondary cook-timer-start' }, icon('clock', { size: 20 }), ` Timer ${formatTimer(seconds)} starten`);
      start.addEventListener('click', () => { timer = { total: seconds, left: seconds, running: true, step: index }; tick(); timer.handle = setInterval(tick, 1000); drawTimer(seconds); });
      timerBox.append(start);
      return;
    }
    const display = h('p', { class: `cook-timer ${timer.left === 0 ? 'done' : ''}`, role: 'timer', 'aria-live': 'off' }, formatTimer(timer.left));
    const pause = h('button', { type: 'button', class: 'btn' }, timer.running ? 'Pause' : 'Fortsetzen');
    pause.addEventListener('click', () => {
      timer.running = !timer.running;
      if (timer.running) timer.handle = setInterval(tick, 1000); else clearInterval(timer.handle);
      drawTimer(seconds);
    });
    const reset = h('button', { type: 'button', class: 'btn btn-link' }, 'Zurücksetzen');
    reset.addEventListener('click', () => { stopTimer(); drawTimer(seconds); });
    timerBox.append(display, h('div', { class: 'form-actions cook-timer-actions' }, timer.left > 0 ? pause : null, reset));
    timer.display = display;
  }

  function tick() {
    if (!timer || !timer.running) return;
    timer.left = Math.max(0, timer.left - (timer.handle ? 1 : 0));
    if (timer.display) { timer.display.textContent = formatTimer(timer.left); }
    if (timer.left === 0 && timer.handle) {
      clearInterval(timer.handle); timer.handle = null; timer.running = false;
      beep();
      toast(`⏰ Zeit ist um – Schritt ${timer.step + 1}`, 'warn');
      drawTimer(timer.total);
    }
  }

  function draw() {
    clear(stage); clear(dots);
    const last = index === steps.length - 1;
    stage.append(
      h('p', { class: 'cook-count' }, `Schritt ${index + 1} von ${steps.length}`),
      h('p', { class: 'cook-step' }, steps[index]));
    steps.forEach((_, i) => dots.append(h('span', { class: `cook-dot ${i < index ? 'done' : ''} ${i === index ? 'current' : ''}` })));
    prev.disabled = index === 0;
    clear(next);
    if (last) next.append(icon('check', { size: 24 }), h('span', {}, 'Fertig!'));
    else next.append(h('span', {}, 'Weiter'), icon('chevronRight', { size: 26 }));
    if (!timer || timer.step !== index) { if (timer && !timer.running) stopTimer(); }
    drawTimer(timer && timer.step === index ? timer.total : detectTimerSeconds(steps[index]));
  }

  prev.addEventListener('click', () => { if (index > 0) { index -= 1; draw(); } });
  next.addEventListener('click', () => {
    if (index < steps.length - 1) { index += 1; draw(); return; }
    stopTimer(); releaseAwake();
    toast('Guten Appetit! 🍽️ Tipp: Markiere das Gericht als gekocht, dann wird dein Vorrat aktualisiert.', 'success');
    location.hash = backHref;
  });
  const onKey = (e) => {
    if (!document.body.contains(stage)) { document.removeEventListener('keydown', onKey); return; }
    if (e.target.closest?.('input, select, textarea, dialog')) return;
    if (e.key === 'ArrowRight') next.click();
    if (e.key === 'ArrowLeft') prev.click();
  };
  document.addEventListener('keydown', onKey);
  const onLeave = () => { stopTimer(); releaseAwake(); window.removeEventListener('hashchange', onLeave); document.removeEventListener('keydown', onKey); };
  window.addEventListener('hashchange', onLeave);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && document.body.contains(stage)) keepAwake(); });

  const ingList = h('ul', { class: 'cook-ings' }, ...[...r.ingredients, ...r.spices].map((i) => h('li', {},
    h('span', { class: 'cook-ing-amount' }, typeof i.amount === 'number' ? formatAmount(i.amount * factor, i.unit) : (i.unit || '')),
    h('span', {}, i.name, i.optional ? ' (optional)' : ''))));

  container.append(
    h('div', { class: 'cook-top' },
      h('a', { class: 'btn btn-icon', href: backHref, 'aria-label': 'Kochmodus beenden' }, icon('x', { size: 22 })),
      h('div', { class: 'cook-title' }, h('h1', { tabindex: '-1' }, r.title), h('p', { class: 'small muted' }, `${servings} ${servings === 1 ? 'Portion' : 'Portionen'} · Bildschirm bleibt an`))),
    h('div', { class: 'cook-card' }, recipeArt(r, 'cook-art'), dots, stage, timerBox),
    h('div', { class: 'cook-controls' }, prev, next),
    h('details', { class: 'section cook-more' }, h('summary', {}, `Zutaten für ${servings} ${servings === 1 ? 'Portion' : 'Portionen'}`), ingList),
  );
  draw();
  keepAwake();
}
