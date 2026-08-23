import { $, esc, gradientFor } from './dom.js';
import { ICO } from './icons.js';
import { formatQuality, formatTime } from '../../shared/format.js';
import { getTrack, state } from '../state.js';

let seeking = false;
let actions = {};

export function bindTransport(handlers) {
  actions = handlers;
  $('#btn-play').addEventListener('click', () => actions.toggle());
  $('#btn-next').addEventListener('click', () => actions.next());
  $('#btn-prev').addEventListener('click', () => actions.prev());
  $('#btn-shuffle').addEventListener('click', () => actions.toggleShuffle());
  $('#btn-repeat').addEventListener('click', () => actions.cycleRepeat());
  $('#btn-mute').addEventListener('click', () => actions.toggleMute());
  $('#btn-fav').addEventListener('click', () => actions.toggleFavorite());
  $('#btn-help').addEventListener('click', (event) => actions.help(event.currentTarget));
  $('#btn-queue').addEventListener('click', () => actions.toggleQueue());
  $('#btn-sonido').addEventListener('click', (event) => actions.abrirSonido(event.currentTarget));
  $('#btn-theme').addEventListener('click', () => actions.toggleTheme());

  const volume = $('#vol');
  volume.addEventListener('input', (event) => {
    actions.setVolume(Number(event.target.value) / 100);
  });

  const seek = $('#seek');
  for (const type of ['pointerdown', 'touchstart']) {
    seek.addEventListener(type, () => {
      seeking = true;
    });
  }
  for (const type of ['pointerup', 'touchend', 'blur']) {
    seek.addEventListener(type, () => {
      seeking = false;
    });
  }
  seek.addEventListener('input', (event) => {
    const pct = Number(event.target.value) / 10;
    event.target.style.setProperty('--p', `${pct}%`);
    $('#t-cur').textContent = formatTime((actions.duration() * pct) / 100);
  });
  seek.addEventListener('change', (event) => {
    actions.seekTo((Number(event.target.value) / 1000) * actions.duration());
    seeking = false;
  });
}

/** Reloj y barra de posición. Se llama muchas veces por segundo: nada de repintados. */
export function tick(current, total) {
  if (seeking) return;
  const duration = Number.isFinite(total) ? total : 0;
  $('#t-cur').textContent = formatTime(current);
  $('#t-dur').textContent = formatTime(duration);
  const pct = duration ? (current / duration) * 100 : 0;
  const seek = $('#seek');
  seek.value = String(Math.round(pct * 10));
  seek.style.setProperty('--p', `${pct.toFixed(2)}%`);
}

export function renderNowPlaying() {
  const track = state.currentId ? getTrack(state.currentId) : null;
  const art = $('#art');
  const placeholder = $('#art-ph');
  art.querySelector('img')?.remove();

  if (track) {
    $('#now-title').textContent = track.title;
    $('#now-artist').textContent = track.artist + (track.album ? ` · ${track.album}` : '');
    $('#quality').textContent = formatQuality(track);
    if (track.coverId) {
      const img = document.createElement('img');
      img.src = window.pletina.media.cover(track.coverId);
      img.alt = '';
      art.appendChild(img);
      placeholder.style.display = 'none';
    } else {
      placeholder.style.display = 'grid';
      placeholder.textContent = (track.title[0] || '♪').toUpperCase();
      placeholder.style.color = '#fff';
      art.style.background = gradientFor(`${track.album || ''}${track.artist}${track.title}`);
    }
    const fav = $('#btn-fav');
    fav.hidden = false;
    fav.classList.toggle('on', Boolean(track.favorite));
    fav.setAttribute('aria-pressed', String(Boolean(track.favorite)));
    fav.setAttribute('aria-label', track.favorite ? 'Quitar de favoritos' : 'Marcar como favorita');
    document.title = `${track.title} · ${track.artist} — Pletina`;
  } else {
    $('#now-title').textContent = 'Nada sonando';
    $('#now-artist').textContent = state.tracks.length
      ? 'Elige una canción de la lista'
      : 'Añade música para empezar';
    $('#quality').textContent = '';
    placeholder.style.display = 'grid';
    placeholder.textContent = '♪';
    placeholder.style.color = 'var(--muted-2)';
    art.style.background = 'var(--panel-2)';
    $('#btn-fav').hidden = true;
    tick(0, 0);
    document.title = 'Pletina';
  }
}

/** Estado visual de los conmutadores: aleatorio, repetición, silencio, cola, tema. */
export function syncToggles({ dark } = {}) {
  const shuffle = $('#btn-shuffle');
  shuffle.innerHTML = ICO.shuffle;
  shuffle.classList.toggle('on', state.shuffle);
  shuffle.setAttribute('aria-pressed', String(state.shuffle));

  const repeat = $('#btn-repeat');
  repeat.innerHTML = state.repeat === 'one' ? ICO.repeatOne : ICO.repeat;
  repeat.classList.toggle('on', state.repeat !== 'off');
  repeat.setAttribute(
    'aria-label',
    state.repeat === 'off' ? 'Repetir: desactivado' : state.repeat === 'all' ? 'Repetir: toda la lista' : 'Repetir: esta canción',
  );

  const mute = $('#btn-mute');
  mute.innerHTML = state.muted || state.volume === 0 ? ICO.mute : ICO.vol;
  mute.classList.toggle('on', state.muted);
  mute.setAttribute('aria-label', state.muted ? 'Quitar el silencio' : 'Silenciar');

  const volume = $('#vol');
  const level = Math.round((state.muted ? 0 : state.volume) * 100);
  volume.value = String(level);
  volume.style.setProperty('--p', `${level}%`);

  const queue = $('#btn-queue');
  queue.innerHTML = ICO.queue;
  queue.classList.toggle('on', state.queueOpen);
  queue.setAttribute('aria-pressed', String(state.queueOpen));

  const theme = $('#btn-theme');
  theme.innerHTML = dark ? ICO.sun : ICO.moon;

  const sonido = $('#btn-sonido');
  sonido.innerHTML = ICO.sliders;
  sonido.classList.toggle('on', state.eq.activado || state.crossfade > 0);
  $('#btn-menu').innerHTML = ICO.menu;
  $('#btn-prev').innerHTML = ICO.prev;
  $('#btn-next').innerHTML = ICO.next;
  $('#btn-help').innerHTML = ICO.help;
  $('#btn-fav').innerHTML = ICO.heart;
}

export function renderPlayState() {
  const button = $('#btn-play');
  button.innerHTML = state.playing ? ICO.pause : ICO.play;
  button.setAttribute('aria-label', state.playing ? 'Pausa' : 'Reproducir');
  $('#brand').classList.toggle('is-playing', state.playing);
}

/** Ficha de atajos y del propio programa. */
export function helpPopover(anchor, info, popover) {
  const rows = [
    ['Reproducir / pausa', 'Espacio'],
    ['Siguiente / anterior', 'N · P'],
    ['Adelantar / retroceder 5 s', '→ ←'],
    ['Volumen', '↑ ↓'],
    ['Buscar', '/'],
    ['Aleatorio · Repetir', 'S · R'],
    ['Cola de reproducción', 'Q'],
    ['Favorita', 'F'],
    ['Ir a lo que suena', 'G'],
    ['Mover dentro de una lista', 'Alt + ↑ ↓'],
    ['Seleccionar varias', 'Mayús · Ctrl/Cmd + clic'],
  ];
  popover(anchor, [
    { type: 'cap', label: 'Atajos de teclado' },
    {
      type: 'html',
      html: `<div class="shortcuts">${rows
        .map(([label, key]) => `<div><span>${esc(label)}</span><span class="kbd">${esc(key)}</span></div>`)
        .join('')}</div>`,
    },
    { type: 'sep' },
    { type: 'cap', label: 'Pletina' },
    {
      type: 'html',
      html: `<div class="info">
        <div>Versión ${esc(info.version)} · Electron ${esc(info.electron)}</div>
        <div>Datos en <code>${esc(info.dataDir)}</code></div>
      </div>`,
    },
    { key: 'data', label: 'Abrir la carpeta de datos', icon: ICO.folder, run: () => window.pletina.app.openDataDir() },
  ]);
}
