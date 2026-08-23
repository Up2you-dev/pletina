import { getTrack, state } from './state.js';
import { toast } from './ui/dom.js';
import { createEngine } from './audio.js';

/**
 * El reproductor: dos platos apuntando al esquema `pletina-media://`, que sirve
 * el archivo del disco con soporte de `Range`. Sin copias, sin blobs en memoria
 * y con la barra de posición funcionando también en archivos de 200 MB.
 *
 * Son dos y no uno porque encadenar con fundido exige que la siguiente canción
 * ya esté sonando antes de que termine la anterior. Sin fundido, el segundo
 * plato no se usa y el comportamiento es el de siempre.
 */

let motor = null;
try {
  motor = createEngine();
} catch {
  // Sin Web Audio se pierden ecualizador, visualizador y fundido, pero la
  // música tiene que sonar igual: eso no se negocia.
  motor = null;
}

function crearPlato() {
  const el = new Audio();
  el.preload = 'auto';
  // Imprescindible para que Web Audio no reciba silencio: el audio vive en otro
  // esquema y sin esto el grafo queda «contaminado» y enmudece sin avisar.
  if (motor) el.crossOrigin = 'anonymous';
  const nodos = motor ? motor.conectar(el) : null;
  return { el, nodos, id: null };
}

const platos = [crearPlato(), crearPlato()];
let activo = 0;
const plato = () => platos[activo];
const otro = () => platos[1 - activo];

let encadenando = false;
let avisadoFinal = false;
let fallos = 0;
let guardado = 0;
let warmup = null;

const hooks = {
  onEnded: () => {},
  onError: () => {},
  onTrack: () => {},
  onTick: () => {},
  onPlayState: () => {},
  onPositionSave: () => {},
  onCercaDelFinal: () => {},
  /** Segundos de fundido, o 0 para encadenar sin cruce. Lo decide la interfaz. */
  margenDeFundido: () => 0,
};

export function onPlayer(handlers) {
  Object.assign(hooks, handlers);
}

export const engine = () => motor;
export const hayMotor = () => Boolean(motor);

/* ------------------------------------------------------------------ volumen */

/** Volumen percibido: la curva cuadrática se parece a cómo oye una persona. */
function volumenEfectivo() {
  const base = state.muted ? 0 : state.volume ** 2;
  if (!state.normalize) return base;
  const track = getTrack(state.currentId);
  const gainDb = track?.gainDb;
  if (!Number.isFinite(gainDb)) return base;
  // ReplayGain solo se usa para bajar: subir por encima de 1 distorsiona.
  return Math.max(0, Math.min(1, base * Math.min(1, 10 ** (gainDb / 20))));
}

export function applyVolume() {
  const valor = volumenEfectivo();
  if (motor) {
    motor.volumen(valor);
    for (const p of platos) p.el.volume = 1;
    return;
  }
  for (const p of platos) p.el.volume = valor;
}

/** Ecualizador: bandas en decibelios más una preamplificación. */
export function aplicarEcualizador({ activado, bandas = [], preamp = 0 } = {}) {
  if (!motor) return;
  if (!activado) {
    motor.plano();
    return;
  }
  motor.aplicarBandas(bandas);
  motor.preamplificar(preamp);
}

/* -------------------------------------------------------------- reproducción */

function ganancia(p) {
  return p.nodos?.ganancia?.gain ?? null;
}

function fijarGanancia(p, valor) {
  const parametro = ganancia(p);
  if (!parametro) return;
  parametro.cancelScheduledValues(motor.tiempo);
  parametro.setValueAtTime(valor, motor.tiempo);
}

export function load(id, { play = true, position = 0 } = {}) {
  const track = getTrack(id);
  if (!track) return false;
  cancelarFundido();
  const actual = plato();
  actual.id = id;
  state.currentId = id;
  avisadoFinal = false;
  actual.el.playbackRate = 1;
  fijarGanancia(actual, 1);
  actual.el.src = window.pletina.media.track(id);
  if (position > 0) {
    const buscar = () => {
      try {
        actual.el.currentTime = position;
      } catch {
        /* el archivo no admite búsqueda antes de tener metadatos */
      }
      actual.el.removeEventListener('loadedmetadata', buscar);
    };
    actual.el.addEventListener('loadedmetadata', buscar);
  }
  applyVolume();
  hooks.onTrack(track);
  setMediaSession(track);
  if (play) start();
  return true;
}

export function start() {
  motor?.despertar();
  const promesa = plato().el.play();
  if (promesa?.catch) promesa.catch(() => hooks.onPlayState(false));
}

export const pause = () => {
  for (const p of platos) p.el.pause();
};

export function toggle() {
  if (plato().el.paused) start();
  else pause();
}

export function seekTo(seconds) {
  const el = plato().el;
  if (!Number.isFinite(el.duration) || el.duration <= 0) return;
  cancelarFundido();
  el.currentTime = Math.max(0, Math.min(el.duration, seconds));
  avisadoFinal = false;
}

export function seekBy(delta) {
  seekTo((plato().el.currentTime || 0) + delta);
}

export const currentTime = () => plato().el.currentTime || 0;
export const duration = () => (Number.isFinite(plato().el.duration) ? plato().el.duration : 0);

export function restart() {
  plato().el.currentTime = 0;
  start();
}

export function stop() {
  cancelarFundido();
  for (const p of platos) {
    p.el.pause();
    p.el.removeAttribute('src');
    p.el.load();
    p.id = null;
  }
  state.currentId = null;
  hooks.onTrack(null);
}

/** Calienta el siguiente archivo sin reproducirlo. */
export function warmNext(id) {
  if (!id || warmup?.dataset?.id === id) return;
  warmup = new Audio();
  warmup.dataset.id = id;
  warmup.preload = 'auto';
  warmup.muted = true;
  warmup.src = window.pletina.media.track(id);
}

/* ------------------------------------------------------------------ fundido */

function cancelarFundido() {
  if (!encadenando) return;
  encadenando = false;
  const entrante = otro();
  entrante.el.pause();
  entrante.el.removeAttribute('src');
  entrante.id = null;
  fijarGanancia(plato(), 1);
}

/**
 * Encadena con la siguiente: arranca el otro plato, cruza las ganancias y pasa
 * a ser el principal. Si hay mezcla automática y las dos canciones traen tempo
 * conocido y parecido, la entrante se ajusta al tempo de la saliente.
 */
export function encadenar(id, { segundos = 6, automezcla = false } = {}) {
  if (!motor || encadenando) return false;
  const entrante = otro();
  const saliente = plato();
  const track = getTrack(id);
  if (!track) return false;

  encadenando = true;
  entrante.id = id;
  entrante.el.playbackRate = 1;
  entrante.el.src = window.pletina.media.track(id);

  if (automezcla) {
    const saleBpm = getTrack(saliente.id)?.bpm;
    const entraBpm = track.bpm;
    // Solo se toca el tempo si el ajuste es discreto: por encima de un 8 % la
    // canción entrante empieza a sonar rara.
    if (saleBpm && entraBpm) {
      const razon = saleBpm / entraBpm;
      if (razon > 0.92 && razon < 1.08) entrante.el.playbackRate = razon;
    }
  }

  fijarGanancia(entrante, 0);
  const promesa = entrante.el.play();
  if (promesa?.catch) promesa.catch(() => cancelarFundido());

  const ahora = motor.tiempo;
  const fin = ahora + segundos;
  const sale = ganancia(saliente);
  const entra = ganancia(entrante);
  if (sale && entra) {
    // Curvas de igual potencia: un cruce lineal hunde el volumen a la mitad.
    sale.setValueCurveAtTime(curva(true), ahora, segundos);
    entra.setValueCurveAtTime(curva(false), ahora, segundos);
  }

  activo = 1 - activo;
  state.currentId = id;
  avisadoFinal = false;
  hooks.onTrack(track);
  setMediaSession(track);

  setTimeout(() => {
    if (!encadenando) return;
    encadenando = false;
    saliente.el.pause();
    saliente.el.removeAttribute('src');
    saliente.id = null;
    fijarGanancia(plato(), 1);
  }, Math.max(0, (fin - motor.tiempo) * 1000) + 120);
  return true;
}

/** Curva de igual potencia con 64 puntos: sube o baja según se le pida. */
function curva(bajando) {
  const puntos = new Float32Array(64);
  for (let i = 0; i < puntos.length; i += 1) {
    const t = i / (puntos.length - 1);
    puntos[i] = Math.cos((bajando ? t : 1 - t) * 0.5 * Math.PI);
  }
  return puntos;
}

/* ------------------------------------------------------- control del sistema */

function setMediaSession(track) {
  if (!('mediaSession' in navigator) || !track) return;
  try {
    const artwork = track.coverId
      ? [{ src: window.pletina.media.cover(track.coverId), sizes: '512x512', type: 'image/jpeg' }]
      : [];
    navigator.mediaSession.metadata = new window.MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album || '',
      artwork,
    });
  } catch {
    /* algunos sistemas no exponen la sesión de medios */
  }
}

export function bindMediaSession({ next, prev }) {
  if (!('mediaSession' in navigator)) return;
  const set = (action, handler) => {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      /* acción no soportada */
    }
  };
  set('play', start);
  set('pause', pause);
  set('nexttrack', next);
  set('previoustrack', prev);
  set('seekbackward', () => seekBy(-10));
  set('seekforward', () => seekBy(10));
  set('seekto', (details) => {
    if (details.seekTime != null) seekTo(details.seekTime);
  });
  set('stop', stop);
}

/* ------------------------------------------------------------------ eventos */

const esActivo = (evento) => evento.target === plato().el;

for (const p of platos) {
  const { el } = p;

  el.addEventListener('play', (evento) => {
    if (!esActivo(evento)) return;
    state.playing = true;
    fallos = 0;
    hooks.onPlayState(true);
  });

  el.addEventListener('pause', (evento) => {
    if (!esActivo(evento) || encadenando) return;
    state.playing = false;
    hooks.onPlayState(false);
    hooks.onPositionSave(state.currentId, el.currentTime);
  });

  el.addEventListener('ended', (evento) => {
    // El plato que se apaga durante un cruce no debe adelantar la cola.
    if (!esActivo(evento) || encadenando) return;
    hooks.onEnded();
  });

  el.addEventListener('timeupdate', (evento) => {
    if (!esActivo(evento)) return;
    hooks.onTick(el.currentTime, el.duration);

    const restante = (el.duration || 0) - el.currentTime;
    if (!avisadoFinal && !encadenando && Number.isFinite(restante) && restante > 0) {
      const margen = hooks.margenDeFundido?.() ?? 0;
      if (margen > 0 && restante <= margen) {
        avisadoFinal = true;
        hooks.onCercaDelFinal();
      }
    }

    const ahora = Date.now();
    if (ahora - guardado > 5000) {
      guardado = ahora;
      hooks.onPositionSave(state.currentId, el.currentTime);
    }
  });

  el.addEventListener('loadedmetadata', (evento) => {
    if (!esActivo(evento)) return;
    hooks.onTick(el.currentTime, el.duration);
    const track = getTrack(state.currentId);
    // La duración medida gana a la etiqueta: los MP3 de tasa variable mienten.
    if (track && Number.isFinite(el.duration) && Math.abs((track.duration || 0) - el.duration) > 1) {
      track.duration = el.duration;
      window.pletina.track.patch(track.id, { duration: el.duration });
    }
  });

  el.addEventListener('error', (evento) => {
    if (!esActivo(evento) || !state.currentId) return;
    fallos += 1;
    const track = getTrack(state.currentId);
    if (fallos > 4) {
      toast('Varias canciones seguidas han fallado. Revisa si el disco sigue conectado.');
      fallos = 0;
      return;
    }
    toast(`No he podido reproducir «${track?.title ?? 'esa canción'}». Paso a la siguiente.`);
    hooks.onError(state.currentId);
  });
}
