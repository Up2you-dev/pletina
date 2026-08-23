import { $, esc } from './dom.js';
import { ICO } from './icons.js';
import { BANDAS, NOMBRES_PRESET, PRESETS } from '../audio.js';
import { state } from '../state.js';

/**
 * Panel de sonido: ecualizador de diez bandas, fundido entre canciones y mezcla
 * automática. Todo junto porque son la misma decisión —cómo suena— y separarlo
 * en tres menús obligaría a ir y volver.
 */

let acciones = {};
let panel = null;

const etiquetaBanda = (hz) => (hz >= 1000 ? `${hz / 1000}k` : String(hz));

export function bindSonido(handlers) {
  acciones = handlers;
}

export const sonidoAbierto = () => Boolean(panel);

export function cerrarSonido() {
  if (!panel) return;
  panel.remove();
  panel = null;
  document.removeEventListener('mousedown', fuera, true);
  document.removeEventListener('keydown', escape, true);
}

function fuera(evento) {
  if (panel && !panel.contains(evento.target) && !evento.target.closest('#btn-sonido')) cerrarSonido();
}

function escape(evento) {
  if (evento.key === 'Escape') {
    evento.stopPropagation();
    cerrarSonido();
  }
}

export function abrirSonido(ancla) {
  if (panel) {
    cerrarSonido();
    return;
  }
  panel = document.createElement('div');
  panel.className = 'sonido';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Ecualizador y mezcla');
  pintar();
  document.body.appendChild(panel);

  const rect = (ancla ?? $('#btn-sonido')).getBoundingClientRect();
  const ancho = panel.offsetWidth;
  panel.style.left = `${Math.min(Math.max(8, rect.right - ancho), window.innerWidth - ancho - 8)}px`;
  panel.style.bottom = `${Math.max(8, window.innerHeight - rect.top + 8)}px`;

  panel.addEventListener('input', alCambiar);
  panel.addEventListener('click', alPulsar);
  setTimeout(() => {
    document.addEventListener('mousedown', fuera, true);
    document.addEventListener('keydown', escape, true);
  }, 0);
}

function pintar() {
  if (!panel) return;
  const { eq } = state;
  const bandas = BANDAS.map((hz, i) => `<label class="banda">
    <input type="range" min="-12" max="12" step="1" value="${eq.bandas[i] ?? 0}" data-banda="${i}"
      orient="vertical" aria-label="${etiquetaBanda(hz)} hercios">
    <span class="hz">${etiquetaBanda(hz)}</span>
  </label>`).join('');

  const presets = Object.keys(PRESETS).map((clave) => `<button class="chip${eq.preset === clave ? ' on' : ''}"
    data-preset="${clave}">${esc(NOMBRES_PRESET[clave])}</button>`).join('');

  panel.innerHTML = `
    <div class="sonido-cabecera">
      <h3>Ecualizador</h3>
      <label class="interruptor">
        <input type="checkbox" data-eq-activado${eq.activado ? ' checked' : ''}>
        <span>${eq.activado ? 'Activado' : 'Apagado'}</span>
      </label>
    </div>
    <div class="chips">${presets}</div>
    <div class="bandas${eq.activado ? '' : ' apagado'}">${bandas}</div>
    <div class="preamp">
      <span>Preamplificación</span>
      <input type="range" min="-12" max="12" step="1" value="${eq.preamp ?? 0}" data-preamp>
      <span class="db">${eq.preamp > 0 ? '+' : ''}${eq.preamp} dB</span>
    </div>

    <div class="sonido-cabecera con-linea">
      <h3>Mezcla</h3>
    </div>
    <div class="preamp">
      <span>Fundido entre canciones</span>
      <input type="range" min="0" max="12" step="1" value="${state.crossfade}" data-fundido>
      <span class="db">${state.crossfade ? `${state.crossfade} s` : 'sin fundido'}</span>
    </div>
    <label class="interruptor ancho">
      <input type="checkbox" data-automezcla${state.automix ? ' checked' : ''}>
      <span>Mezcla automática: ajusta el tempo de la que entra al de la que sale</span>
    </label>
    <label class="interruptor ancho">
      <input type="checkbox" data-normalizar${state.normalize ? ' checked' : ''}>
      <span>Volumen constante (ReplayGain)</span>
    </label>
    <p class="nota">${state.crossfade
      ? 'Con fundido, la siguiente empieza antes de que acabe la anterior.'
      : 'Sube el fundido para encadenar canciones sin silencio entre ellas.'}</p>`;
}

function alCambiar(evento) {
  const objetivo = evento.target;
  if (objetivo.dataset.banda !== undefined) {
    const indice = Number(objetivo.dataset.banda);
    const bandas = state.eq.bandas.slice();
    bandas[indice] = Number(objetivo.value);
    acciones.cambiarEq({ bandas, preset: 'propio' });
    return;
  }
  if (objetivo.dataset.preamp !== undefined) {
    acciones.cambiarEq({ preamp: Number(objetivo.value) });
    panel.querySelector('.preamp .db').textContent = `${objetivo.value > 0 ? '+' : ''}${objetivo.value} dB`;
    return;
  }
  if (objetivo.dataset.fundido !== undefined) {
    acciones.cambiarFundido(Number(objetivo.value));
    pintar();
    return;
  }
  if (objetivo.dataset.eqActivado !== undefined) {
    acciones.cambiarEq({ activado: objetivo.checked });
    pintar();
    return;
  }
  if (objetivo.dataset.automezcla !== undefined) acciones.cambiarAutomezcla(objetivo.checked);
  if (objetivo.dataset.normalizar !== undefined) acciones.cambiarNormalizar(objetivo.checked);
}

function alPulsar(evento) {
  const chip = evento.target.closest('[data-preset]');
  if (!chip) return;
  const clave = chip.dataset.preset;
  acciones.cambiarEq({ preset: clave, bandas: PRESETS[clave].slice(), activado: true });
  pintar();
}

export const iconoSonido = ICO.sliders;
