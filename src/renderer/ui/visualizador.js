import { $ } from './dom.js';
import { state } from '../state.js';

/**
 * Visualizador: barras de espectro con la onda por encima, dibujadas desde el
 * analizador del grafo. Se apaga solo cuando no hay nada sonando —un bucle de
 * dibujo permanente calienta el portátil para nada— y respeta a quien ha pedido
 * menos movimiento en su sistema.
 */

let lienzo = null;
let contexto = null;
let animacion = 0;
let motor = null;

const menosMovimiento = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function montarVisualizador(engine) {
  motor = engine;
}

export function alternarVisualizador(activado) {
  state.visualizador = activado;
  if (activado) encender();
  else apagar();
  return state.visualizador;
}

function encender() {
  if (!motor) {
    state.visualizador = false;
    return;
  }
  if (!lienzo) {
    lienzo = $('#visualizador');
    if (!lienzo) return;
    contexto = lienzo.getContext('2d');
  }
  lienzo.hidden = false;
  $('#app').classList.add('con-visualizador');
  redimensionar();
  window.addEventListener('resize', redimensionar);
  if (!animacion) animacion = requestAnimationFrame(dibujar);
}

function apagar() {
  if (animacion) {
    cancelAnimationFrame(animacion);
    animacion = 0;
  }
  window.removeEventListener('resize', redimensionar);
  if (lienzo) lienzo.hidden = true;
  $('#app').classList.remove('con-visualizador');
}

function redimensionar() {
  if (!lienzo) return;
  const escala = window.devicePixelRatio || 1;
  const caja = lienzo.getBoundingClientRect();
  lienzo.width = Math.max(1, Math.floor(caja.width * escala));
  lienzo.height = Math.max(1, Math.floor(caja.height * escala));
  contexto.setTransform(escala, 0, 0, escala, 0, 0);
}

function color(nombre) {
  return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
}

function dibujar() {
  animacion = requestAnimationFrame(dibujar);
  if (!contexto || !motor || lienzo.hidden) return;

  const ancho = lienzo.width / (window.devicePixelRatio || 1);
  const alto = lienzo.height / (window.devicePixelRatio || 1);
  contexto.clearRect(0, 0, ancho, alto);
  if (!state.playing) return;

  const analizador = motor.analizador;
  const espectro = new Uint8Array(analizador.frequencyBinCount);
  analizador.getByteFrequencyData(espectro);

  const acento = color('--accent') || '#3A3FD4';
  const suave = color('--accent-soft') || '#E4E4FA';
  const barras = menosMovimiento() ? 24 : 56;
  const hueco = 3;
  const anchoBarra = Math.max(2, (ancho - hueco * (barras - 1)) / barras);

  for (let i = 0; i < barras; i += 1) {
    // Reparto logarítmico: si no, los graves se comen toda la pantalla.
    const desde = Math.floor((espectro.length * (i / barras) ** 1.7) + 1);
    const hasta = Math.max(desde + 1, Math.floor(espectro.length * ((i + 1) / barras) ** 1.7));
    let suma = 0;
    for (let j = desde; j < hasta && j < espectro.length; j += 1) suma += espectro[j];
    const media = suma / Math.max(1, hasta - desde);
    const altura = Math.max(2, (media / 255) * alto * 0.78);
    const x = i * (anchoBarra + hueco);
    contexto.fillStyle = i % 2 ? suave : acento;
    contexto.globalAlpha = 0.35 + (media / 255) * 0.45;
    contexto.beginPath();
    contexto.roundRect(x, alto - altura, anchoBarra, altura, 3);
    contexto.fill();
  }

  if (menosMovimiento()) return;
  const onda = new Uint8Array(analizador.fftSize);
  analizador.getByteTimeDomainData(onda);
  contexto.globalAlpha = 0.7;
  contexto.strokeStyle = acento;
  contexto.lineWidth = 1.6;
  contexto.beginPath();
  for (let i = 0; i < onda.length; i += 1) {
    const x = (i / (onda.length - 1)) * ancho;
    const y = alto * 0.24 + ((onda[i] - 128) / 128) * (alto * 0.18);
    if (i === 0) contexto.moveTo(x, y);
    else contexto.lineTo(x, y);
  }
  contexto.stroke();
  contexto.globalAlpha = 1;
}
