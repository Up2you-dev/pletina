import { getTrack, state } from './state.js';
import { toast } from './ui/dom.js';

/**
 * El reproductor: un solo elemento `<audio>` apuntando al esquema `pletina-media://`,
 * que sirve el archivo del disco con soporte de `Range`. Sin copias, sin blobs en
 * memoria y con la barra de posición funcionando también en archivos de 200 MB.
 */
const audio = new Audio();
audio.preload = 'auto';

/** Precarga discreta de lo siguiente: el salto entre canciones se nota mucho menos. */
let warmup = null;
let failures = 0;
let saveTimer = 0;

const hooks = {
  onEnded: () => {},
  onError: () => {},
  onTrack: () => {},
  onTick: () => {},
  onPlayState: () => {},
  onPositionSave: () => {},
};

export function onPlayer(handlers) {
  Object.assign(hooks, handlers);
}

/** Volumen percibido: la curva cuadrática se parece a cómo oye una persona. */
function effectiveVolume() {
  const base = state.muted ? 0 : state.volume ** 2;
  if (!state.normalize) return base;
  const track = getTrack(state.currentId);
  const gainDb = track?.gainDb;
  if (!Number.isFinite(gainDb)) return base;
  // ReplayGain solo se usa para bajar: subir por encima de 1 distorsiona.
  return Math.max(0, Math.min(1, base * Math.min(1, 10 ** (gainDb / 20))));
}

export function applyVolume() {
  audio.volume = effectiveVolume();
}

export function load(id, { play = true, position = 0 } = {}) {
  const track = getTrack(id);
  if (!track) return false;
  state.currentId = id;
  audio.src = window.pletina.media.track(id);
  if (position > 0) {
    const seekOnce = () => {
      try {
        audio.currentTime = position;
      } catch {
        /* el archivo no admite búsqueda antes de tener metadatos */
      }
      audio.removeEventListener('loadedmetadata', seekOnce);
    };
    audio.addEventListener('loadedmetadata', seekOnce);
  }
  applyVolume();
  hooks.onTrack(track);
  setMediaSession(track);
  if (play) start();
  return true;
}

export function start() {
  const promise = audio.play();
  if (promise?.catch) {
    promise.catch(() => {
      hooks.onPlayState(false);
    });
  }
}

export const pause = () => audio.pause();

export function toggle() {
  if (audio.paused) start();
  else audio.pause();
}

export function seekTo(seconds) {
  if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
  audio.currentTime = Math.max(0, Math.min(audio.duration, seconds));
}

export function seekBy(delta) {
  seekTo((audio.currentTime || 0) + delta);
}

export const currentTime = () => audio.currentTime || 0;
export const duration = () => (Number.isFinite(audio.duration) ? audio.duration : 0);

export function restart() {
  audio.currentTime = 0;
  start();
}

export function stop() {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
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

audio.addEventListener('play', () => {
  state.playing = true;
  failures = 0;
  hooks.onPlayState(true);
});
audio.addEventListener('pause', () => {
  state.playing = false;
  hooks.onPlayState(false);
  hooks.onPositionSave(state.currentId, audio.currentTime);
});
audio.addEventListener('ended', () => hooks.onEnded());
audio.addEventListener('timeupdate', () => {
  hooks.onTick(audio.currentTime, audio.duration);
  const now = Date.now();
  if (now - saveTimer > 5000) {
    saveTimer = now;
    hooks.onPositionSave(state.currentId, audio.currentTime);
  }
});
audio.addEventListener('loadedmetadata', () => {
  hooks.onTick(audio.currentTime, audio.duration);
  const track = getTrack(state.currentId);
  // La duración medida gana a la etiqueta: los MP3 de tasa variable mienten.
  if (track && Number.isFinite(audio.duration) && Math.abs((track.duration || 0) - audio.duration) > 1) {
    track.duration = audio.duration;
    window.pletina.track.patch(track.id, { duration: audio.duration });
  }
});
audio.addEventListener('error', () => {
  if (!state.currentId) return;
  failures += 1;
  const track = getTrack(state.currentId);
  if (failures > 4) {
    toast('Varias canciones seguidas han fallado. Revisa si el disco sigue conectado.');
    failures = 0;
    return;
  }
  toast(`No he podido reproducir «${track?.title ?? 'esa canción'}». Paso a la siguiente.`);
  hooks.onError(state.currentId);
});
