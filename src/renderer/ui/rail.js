import { $, esc, popover } from './dom.js';
import { ICO } from './icons.js';
import { favorites, missingTracks, state } from '../state.js';

let actions = {};
export function bindRail(handlers) {
  actions = handlers;
  const rail = $('#rail');

  rail.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove-folder]');
    if (remove) {
      event.stopPropagation();
      actions.removeFolder(remove.dataset.removeFolder);
      return;
    }
    const action = event.target.closest('[data-rail-action]');
    if (action) {
      actions[action.dataset.railAction]?.();
      return;
    }
    const item = event.target.closest('[data-view]');
    if (item) actions.navigate(JSON.parse(item.dataset.view));
  });

  rail.addEventListener('contextmenu', (event) => {
    const item = event.target.closest('[data-playlist]');
    if (!item) return;
    event.preventDefault();
    actions.playlistMenu(item, item.dataset.playlist);
  });

  /* --- reordenar listas y soltar canciones encima de una lista --- */
  let dragging = null;

  rail.addEventListener('dragstart', (event) => {
    const item = event.target.closest('[data-playlist]');
    if (!item) {
      event.preventDefault();
      return;
    }
    dragging = item.dataset.playlist;
    item.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    try {
      event.dataTransfer.setData('text/plain', dragging);
    } catch {
      /* algunos sistemas no dejan escribir en el portapapeles de arrastre */
    }
  });

  rail.addEventListener('dragover', (event) => {
    const item = event.target.closest('[data-playlist]');
    if (!item) return;
    const carryingTracks = !dragging && event.dataTransfer.types.includes('application/x-pletina-tracks');
    if (!dragging && !carryingTracks) return;
    event.preventDefault();
    clearMarks();
    if (carryingTracks) {
      item.classList.add('drop-into');
      event.dataTransfer.dropEffect = 'copy';
      return;
    }
    const rect = item.getBoundingClientRect();
    item.classList.add(event.clientY > rect.top + rect.height / 2 ? 'drop-after' : 'drop-before');
  });

  rail.addEventListener('drop', (event) => {
    const item = event.target.closest('[data-playlist]');
    if (!item) return;
    event.preventDefault();
    const target = item.dataset.playlist;
    if (dragging) {
      const rect = item.getBoundingClientRect();
      const after = event.clientY > rect.top + rect.height / 2;
      const order = state.playlists.map((p) => p.id).filter((id) => id !== dragging);
      const at = order.indexOf(target);
      order.splice(after ? at + 1 : at, 0, dragging);
      actions.reorderPlaylists(order);
    } else {
      const raw = event.dataTransfer.getData('application/x-pletina-tracks');
      if (raw) actions.addToPlaylist(target, JSON.parse(raw));
    }
    dragging = null;
    clearMarks();
  });

  rail.addEventListener('dragend', () => {
    dragging = null;
    clearMarks();
  });

  function clearMarks() {
    for (const el of rail.querySelectorAll('.drop-before,.drop-after,.drop-into,.dragging')) {
      el.classList.remove('drop-before', 'drop-after', 'drop-into', 'dragging');
    }
  }
}

const navItem = ({ view, icon, label, count, extraClass = '' }) => {
  const active = isActive(view) ? ' active' : '';
  return `<button class="nav-item${active} ${extraClass}" data-view='${esc(JSON.stringify(view))}'>
    ${icon}<span class="nm">${esc(label)}</span>${count == null ? '' : `<span class="n">${count}</span>`}
  </button>`;
};

function isActive(view) {
  const current = state.view;
  if (view.type !== current.type) return false;
  if (view.id != null) return view.id === current.id;
  return true;
}

export function renderRail() {
  const missing = missingTracks().length;
  const albumCount = new Set(state.tracks.map((t) => `${t.albumArtist || t.artist}|${t.album}`)).size;
  const artistCount = new Set(state.tracks.map((t) => t.albumArtist || t.artist)).size;

  const collection = [
    navItem({ view: { type: 'library' }, icon: ICO.disc, label: 'Biblioteca', count: state.tracks.length }),
    navItem({ view: { type: 'albums' }, icon: ICO.album, label: 'Álbumes', count: albumCount }),
    navItem({ view: { type: 'artists' }, icon: ICO.artist, label: 'Artistas', count: artistCount }),
    navItem({ view: { type: 'favorites' }, icon: ICO.heart, label: 'Favoritos', count: favorites().length }),
    navItem({ view: { type: 'recent' }, icon: ICO.clock, label: 'Escuchado hace poco' }),
    missing
      ? navItem({ view: { type: 'missing' }, icon: ICO.warn, label: 'Ya no están', count: missing, extraClass: 'warn' })
      : '',
  ].join('');

  const playlists = state.playlists
    .map((playlist) => {
      const active = state.view.type === 'playlist' && state.view.id === playlist.id ? ' active' : '';
      return `<button class="nav-item${active}" draggable="true" data-playlist="${esc(playlist.id)}"
        data-view='${esc(JSON.stringify({ type: 'playlist', id: playlist.id }))}'>
        <span class="grip" aria-hidden="true">${ICO.grip}</span>
        <span class="nm">${esc(playlist.name)}</span>
        <span class="n">${playlist.trackIds.length}</span>
      </button>`;
    })
    .join('');

  const folders = state.folders
    .map((folder) => {
      // Se enseña el nombre de la carpeta; la ruta entera va en el título emergente.
      const parts = folder.path.split(/[\\/]/).filter(Boolean);
      const name = parts[parts.length - 1] || folder.path;
      return `<button class="nav-item folder-item" title="${esc(folder.path)}">
        ${ICO.folder}<span class="nm">${esc(name)}</span>
        <span class="icon-btn x" data-remove-folder="${esc(folder.path)}" role="button" aria-label="Quitar la carpeta ${esc(name)}">${ICO.x}</span>
      </button>`;
    })
    .join('');

  $('#rail').innerHTML = `
    <div class="rail-label">Colección</div>
    <div class="rail-group">${collection}</div>

    <div class="rail-label">Mezcla</div>
    <div class="rail-group">${navItem({
    view: { type: 'mezclador' },
    icon: ICO.sliders,
    label: 'Mezclador',
    extraClass: state.mezclador?.auto ? 'warn' : '',
  })}</div>

    <div class="rail-label">Listas
      <button data-rail-action="newPlaylist" aria-label="Nueva lista">${ICO.plus}</button>
    </div>
    <div class="rail-group" id="pl-list">${playlists}</div>
    <button class="nav-item" data-rail-action="newPlaylist">${ICO.plus}<span class="nm">Nueva lista</span></button>

    <div class="rail-section-folders">
      <div class="rail-label">Carpetas
        <button data-rail-action="addFolder" aria-label="Añadir carpeta">${ICO.plus}</button>
      </div>
      <div class="rail-group">${folders || '<p class="rail-note" style="border:0;margin:0;padding:2px 10px 0">Aún no has añadido ninguna carpeta.</p>'}</div>
      <p class="rail-note">Pletina no copia tu música: guarda dónde está y qué contiene. Los archivos siguen en tu disco, con tus carpetas tal cual.</p>
    </div>`;
}

/** Menú contextual de una lista (botón derecho en el raíl). */
export function playlistMenu(anchor, id, handlers) {
  const playlist = state.playlists.find((p) => p.id === id);
  if (!playlist) return;
  popover(anchor, [
    { key: 'play', label: 'Reproducir', icon: ICO.play, run: () => handlers.play(playlist) },
    { key: 'shuffle', label: 'Reproducir en aleatorio', icon: ICO.shuffle, run: () => handlers.shuffle(playlist) },
    { type: 'sep' },
    { key: 'rename', label: 'Renombrar…', icon: ICO.pencil, run: () => handlers.rename(playlist) },
    { key: 'export', label: 'Exportar como M3U…', icon: ICO.export, run: () => handlers.exportFile(playlist) },
    { type: 'sep' },
    { key: 'delete', label: 'Eliminar lista', icon: ICO.trash, danger: true, run: () => handlers.remove(playlist) },
  ]);
}
