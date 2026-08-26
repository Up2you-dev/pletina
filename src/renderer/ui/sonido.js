import { $, esc } from './dom.js';
import { ICO } from './icons.js';
import { formatPorcentaje } from '../../shared/format.js';
import { BANDAS, NOMBRES_PRESET, PRESETS } from '../audio.js';
import { tempoActual } from '../player.js';
import { state } from '../state.js';

/**
 * Panel de sonido: ecualizador de diez bandas, tempo con estirado de tiempo y
 * fundido entre canciones. Todo junto porque son la misma decisión —cómo
 * suena— y separarlo en tres menús obligaría a ir y volver.
 *
 * La mezcla de verdad no está aquí: tiene su propia pantalla. Aquí solo queda
 * el interruptor de encadenar sola, que es lo que se busca a mitad de fiesta.
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

  // El tempo se lee del reproductor, no de un ajuste guardado: durante una
  // mezcla lo manda el mezclador y el panel tiene que enseñar lo que suena.
  const tempo = tempoActual();
  // El mando va de uno en uno; la etiqueta dice la verdad, que después de una
  // mezcla puede ser un 1,6 % y no un 2 %.
  const porcentaje = Math.round((tempo.velocidad - 1) * 100);
  const ajuste = Math.round((tempo.velocidad - 1) * 1000) / 10;

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
      <h3>Tempo</h3>
      ${ajuste === 0 ? '' : '<button class="chip" data-tempo-cero>Volver a ×1</button>'}
    </div>
    <div class="preamp">
      <span>Velocidad</span>
      <input type="range" min="-20" max="20" step="1" value="${porcentaje}" data-tempo
        aria-label="Ajuste de tempo en por ciento">
      <span class="db">${ajuste === 0 ? '0 %' : formatPorcentaje(ajuste)}</span>
    </div>
    <label class="interruptor ancho">
      <input type="checkbox" data-estirar${tempo.preservarTono ? ' checked' : ''}>
      <span>Mantener el tono al cambiar el tempo (estirado de tiempo)</span>
    </label>
    <p class="nota">${tempo.preservarTono
      ? 'La canción cambia de velocidad sin cambiar de tonalidad.'
      : 'Sin estirado de tiempo, acelerar sube el tono: el efecto de un vinilo.'}</p>

    <div class="sonido-cabecera con-linea">
      <h3>Enlazar canciones</h3>
    </div>
    <div class="preamp">
      <span>Fundido entre canciones</span>
      <input type="range" min="0" max="12" step="1" value="${state.crossfade}" data-fundido>
      <span class="db">${state.crossfade ? `${state.crossfade} s` : 'sin fundido'}</span>
    </div>
    <label class="interruptor ancho">
      <input type="checkbox" data-automezcla${state.mezclador.auto ? ' checked' : ''}>
      <span>Mezclador automático: encadena en el compás y cambia los graves</span>
    </label>
    <label class="interruptor ancho">
      <input type="checkbox" data-normalizar${state.normalize ? ' checked' : ''}>
      <span>Volumen constante (ReplayGain)</span>
    </label>
    <p class="nota">${state.mezclador.auto
      ? 'Manda el mezclador: el fundido solo entra si no puede mezclar.'
      : state.crossfade
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
  if (objetivo.dataset.tempo !== undefined) {
    acciones.cambiarTempo({ velocidad: 1 + Number(objetivo.value) / 100 });
    objetivo.nextElementSibling.textContent = formatPorcentaje(Number(objetivo.value));
    return;
  }
  if (objetivo.dataset.estirar !== undefined) {
    acciones.cambiarTempo({ preservarTono: objetivo.checked });
    pintar();
    return;
  }
  if (objetivo.dataset.automezcla !== undefined) {
    acciones.cambiarAutomezcla(objetivo.checked);
    pintar();
    return;
  }
  if (objetivo.dataset.normalizar !== undefined) acciones.cambiarNormalizar(objetivo.checked);
}

function alPulsar(evento) {
  if (evento.target.closest('[data-tempo-cero]')) {
    acciones.cambiarTempo({ velocidad: 1 });
    pintar();
    return;
  }
  const chip = evento.target.closest('[data-preset]');
  if (!chip) return;
  const clave = chip.dataset.preset;
  acciones.cambiarEq({ preset: clave, bandas: PRESETS[clave].slice(), activado: true });
  pintar();
}

export const iconoSonido = ICO.sliders;
