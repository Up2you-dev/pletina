import { $, $$, coverHtml, esc, gradientFor, popover } from './dom.js';
import { ICO } from './icons.js';
import { formatTime, formatTotal, formatWhen, plural } from '../../shared/format.js';
import { SORT_KEYS } from '../../shared/sorting.js';
import {
  actionTargets,
  albumByKey,
  albums,
  artistByKey,
  artists,
  canReorder,
  clearSelection,
  getTrack,
  selectOnly,
  selectRange,
  state,
  toggleSelection,
  viewTitle,
  visibleTracks,
} from '../state.js';

const CHUNK = 150;
let actions = {};
let pending = [];
let rendered = 0;
let observer = null;

/* ------------------------------------------------------------------ plantillas */

/**
 * La cuarta columna se adapta a lo que se está mirando: dentro de un álbum, el
 * álbum sobra —ahí interesa quién toca—; en «escuchado hace poco», cuándo fue.
 */
function secondaryOf(track) {
  if (state.view.type === 'album') return track.artist;
  if (state.view.type === 'recent') return formatWhen(track.lastPlayedAt);
  return track.album;
}

function secondaryLabel() {
  if (state.view.type === 'album') return 'Artista';
  if (state.view.type === 'recent') return 'Escuchada';
  return 'Álbum';
}

function rowHtml(track, index, draggable) {
  const selected = state.selection.has(track.id) ? ' selected' : '';
  const missing = track.missing ? ' missing' : '';
  return `<li class="row cols${selected}${missing}" data-id="${esc(track.id)}" draggable="${draggable}" tabindex="0">
    <span class="grip" aria-hidden="true">${ICO.grip}</span>
    <button class="idx" data-act="play" aria-label="Reproducir ${esc(track.title)}">
      <span class="num">${index + 1}</span>
      <span class="play-ico">${ICO.play}</span>
      <span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>
    </button>
    <span class="t-main">
      ${coverHtml(track)}
      <span class="t-lines">
        <span class="t-title">${esc(track.title)}${track.missing ? '<span class="badge">no encontrada</span>' : ''}</span>
        <span class="t-artist">${esc(track.artist)}</span>
      </span>
    </span>
    <span class="t-album">${esc(secondaryOf(track) || '—')}</span>
    <button class="icon-btn heart${track.favorite ? ' on' : ''}" data-act="fav"
      aria-label="${track.favorite ? 'Quitar de favoritos' : 'Marcar como favorita'}" aria-pressed="${Boolean(track.favorite)}">${ICO.heart}</button>
    <span class="dur">${formatTime(track.duration)}</span>
    <button class="icon-btn" data-act="menu" aria-label="Opciones de ${esc(track.title)}">${ICO.dots}</button>
  </li>`;
}

function headRow() {
  const sortable = ['library', 'favorites', 'missing'].includes(state.view.type);
  const mark = (key, label, extra = '') => {
    if (!sortable) return `<span${extra ? ` class="${extra}"` : ''}>${label}</span>`;
    const on = state.sort.key === key ? ' class="on"' : '';
    const arrow = state.sort.key === key ? (state.sort.dir === 'asc' ? ' ↑' : ' ↓') : '';
    return `<span${extra ? ` class="${extra}"` : ''}><button data-sort="${key}"${on}>${label}${arrow}</button></span>`;
  };
  return `<div class="head-row cols"><span></span><span>#</span>${mark('title', 'Título')}${mark('album', secondaryLabel())}<span></span>${mark('duration', 'Dur.', 'dur')}<span></span></div>`;
}

function cardHtml({ key, title, meta, coverId, kind, round = false }) {
  const art = coverId
    ? `<img src="${esc(window.pletina.media.cover(coverId))}" alt="" loading="lazy">`
    : `<span class="ph" style="background:${gradientFor(title + meta)}">${esc(title.trim().charAt(0).toUpperCase() || '?')}</span>`;
  return `<button class="card${round ? ' round' : ''}" data-card="${esc(kind)}" data-key="${esc(key)}">
    <span class="thumb">${art}<span class="play-fab" data-act="play-card" role="button" aria-label="Reproducir ${esc(title)}">${ICO.play}</span></span>
    <span class="c-title">${esc(title)}</span>
    <span class="c-meta">${esc(meta)}</span>
  </button>`;
}

function heroHtml({ kicker, title, meta, coverId, seed }) {
  const art = coverId
    ? `<img src="${esc(window.pletina.media.cover(coverId))}" alt="">`
    : `<span class="ph" style="background:${gradientFor(seed)}">${esc(title.trim().charAt(0).toUpperCase() || '?')}</span>`;
  return `<div class="hero">
    <div class="art-lg">${art}</div>
    <div class="hero-text">
      <div class="hero-kicker">${esc(kicker)}</div>
      <h2>${esc(title)}</h2>
      <div class="stage-meta">${esc(meta)}</div>
    </div>
  </div>`;
}

function emptyHtml() {
  if (state.query) {
    return `<div class="empty"><h3>Sin resultados</h3>
      <p>Nada coincide con «${esc(state.query)}» en esta vista.</p>
      <div class="row-actions"><button class="btn" data-tool="clear-q">Borrar la búsqueda</button></div></div>`;
  }
  if (state.view.type === 'playlist') {
    return `<div class="empty"><h3>«${esc(viewTitle())}» está vacía</h3>
      <p>Arrastra canciones desde la biblioteca hasta el nombre de la lista, o usa el menú <strong>⋯</strong> de cada canción.</p>
      <div class="row-actions"><button class="btn" data-tool="go-library">Ir a la biblioteca</button></div></div>`;
  }
  if (state.view.type === 'favorites') {
    return `<div class="empty"><h3>Todavía no hay favoritos</h3>
      <p>Pulsa el corazón de una canción y aparecerá aquí.</p>
      <div class="row-actions"><button class="btn" data-tool="go-library">Ir a la biblioteca</button></div></div>`;
  }
  if (state.view.type === 'recent') {
    return `<div class="empty"><h3>Nada escuchado aún</h3>
      <p>En cuanto reproduzcas algo, esta vista guardará el rastro.</p></div>`;
  }
  if (!state.tracks.length) {
    return `<div class="empty"><h3>Tu biblioteca está vacía</h3>
      <p>Añade la carpeta donde tengas la música. Pletina lee las etiquetas y las carátulas, pero no mueve ni copia un solo archivo: se quedan donde están.</p>
      <div class="row-actions">
        <button class="btn btn-primary" data-tool="add-folder">Añadir una carpeta</button>
        <button class="btn" data-tool="add-files">Añadir archivos sueltos</button>
      </div></div>`;
  }
  return `<div class="empty"><h3>Aquí no hay nada</h3>
    <p>Esta vista está vacía.</p>
    <div class="row-actions"><button class="btn" data-tool="go-library">Ir a la biblioteca</button></div></div>`;
}

/* --------------------------------------------------------------- cabecera */

function toolbarHtml(tracks) {
  const parts = [];
  const { view } = state;
  const listy = !['albums', 'artists'].includes(view.type);

  if (listy && tracks.length) {
    parts.push(`<button class="btn btn-primary" data-tool="play-all">${ICO.play}Reproducir</button>`);
    parts.push(`<button class="btn" data-tool="shuffle-all">${ICO.shuffle}Aleatorio</button>`);
  }
  if (state.selection.size > 1) {
    parts.push(`<span class="label">${plural(state.selection.size, 'seleccionada', 'seleccionadas')}</span>`);
    parts.push(`<button class="btn" data-tool="sel-next">${ICO.queue}A continuación</button>`);
    parts.push(`<button class="btn" data-tool="sel-playlist">${ICO.list}Añadir a lista…</button>`);
    parts.push(`<button class="btn btn-ghost" data-tool="sel-clear">Quitar selección</button>`);
  }
  if (['library', 'favorites', 'missing'].includes(view.type) && tracks.length) {
    parts.push(`<span class="label">Ordenar por</span><select class="sort" id="sort-key">${
      SORT_KEYS.map(([key, label]) => `<option value="${key}"${state.sort.key === key ? ' selected' : ''}>${label}</option>`).join('')
    }</select>`);
    parts.push(`<button class="btn" data-tool="dir">${state.sort.dir === 'asc' ? '↑ Ascendente' : '↓ Descendente'}</button>`);
  }
  if (view.type === 'playlist') {
    parts.push('<div class="spacer"></div>');
    parts.push(`<button class="btn" data-tool="pl-rename">${ICO.pencil}Renombrar</button>`);
    parts.push(`<button class="btn" data-tool="pl-export">${ICO.export}Exportar</button>`);
    parts.push(`<button class="btn btn-danger" data-tool="pl-delete">${ICO.trash}Eliminar</button>`);
  }
  if (view.type === 'missing' && tracks.length) {
    parts.push('<div class="spacer"></div>');
    parts.push(`<button class="btn" data-tool="rescan">${ICO.refresh}Volver a analizar</button>`);
    parts.push(`<button class="btn btn-danger" data-tool="drop-missing">${ICO.trash}Quitar de la biblioteca</button>`);
  }
  return parts.join('');
}

function headHtml(tracks) {
  const { view } = state;
  const total = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
  const back = ['album', 'artist'].includes(view.type)
    ? `<button class="back" data-tool="back">${ICO.back}${view.type === 'album' ? 'Álbumes' : 'Artistas'}</button>`
    : '';

  if (view.type === 'album') {
    const album = albumByKey(view.key);
    if (album) {
      const meta = `${album.artist}${album.year ? ` · ${album.year}` : ''} · ${plural(album.tracks.length, 'canción', 'canciones')} · ${formatTotal(album.duration)}`;
      return `${back}${heroHtml({ kicker: 'Álbum', title: album.album, meta, coverId: album.coverId, seed: album.key })}
        <div class="toolbar">${toolbarHtml(tracks)}</div>`;
    }
  }
  if (view.type === 'artist') {
    const artist = artistByKey(view.key);
    if (artist) {
      const meta = `${plural(artist.albumCount, 'álbum', 'álbumes')} · ${plural(artist.tracks.length, 'canción', 'canciones')} · ${formatTotal(artist.duration)}`;
      return `${back}${heroHtml({ kicker: 'Artista', title: artist.artist, meta, coverId: artist.coverId, seed: artist.key })}
        <div class="toolbar">${toolbarHtml(tracks)}</div>`;
    }
  }

  const counters = {
    albums: () => plural(albums().length, 'álbum', 'álbumes'),
    artists: () => plural(artists().length, 'artista', 'artistas'),
  };
  const meta = counters[view.type]
    ? counters[view.type]()
    : tracks.length
      ? `${plural(tracks.length, 'canción', 'canciones')} · ${formatTotal(total)}`
      : '';

  return `<div class="stage-title"><h2>${esc(viewTitle())}</h2><span class="stage-meta">${esc(meta)}</span></div>
    <div class="toolbar">${toolbarHtml(tracks)}</div>`;
}

/* ---------------------------------------------------------------- pintado */

/** Añade el siguiente tramo de filas. Una biblioteca de 20.000 canciones no se pinta entera. */
function appendChunk() {
  const list = $('#list');
  if (!list || rendered >= pending.length) return;
  const slice = pending.slice(rendered, rendered + CHUNK);
  const draggable = String(canReorder());
  list.insertAdjacentHTML(
    'beforeend',
    slice.map((track, i) => rowHtml(track, rendered + i, draggable)).join(''),
  );
  rendered += slice.length;
  refreshRows();
  if (rendered >= pending.length) $('#sentinel')?.remove();
}

/**
 * Repinta solo la cabecera. La selección cambia la barra de herramientas, y
 * rehacer la lista entera a cada clic perdería el desplazamiento y los tramos
 * ya pintados.
 */
export function renderStageHead(tracks = visibleTracks()) {
  $('#stage-head').innerHTML = headHtml(tracks);
}

export function renderStage() {
  const tracks = visibleTracks();
  const { view } = state;
  renderStageHead(tracks);

  const body = $('#stage-body');
  observer?.disconnect();

  if (view.type === 'albums' || view.type === 'artists') {
    // Con búsqueda activa se cruza contra un conjunto: `includes` sobre miles de
    // canciones, por cada álbum, es cuadrático.
    const visibles = state.terms.length ? new Set(tracks.map((t) => t.id)) : null;
    const encaja = (group) => !visibles || group.tracks.some((t) => visibles.has(t.id));
    const items = view.type === 'albums'
      ? albums()
        .filter(encaja)
        .map((album) => cardHtml({
          key: album.key,
          title: album.album,
          meta: `${album.artist}${album.year ? ` · ${album.year}` : ''}`,
          coverId: album.coverId,
          kind: 'album',
        }))
      : artists()
        .filter(encaja)
        .map((artist) => cardHtml({
          key: artist.key,
          title: artist.artist,
          // Sin etiqueta de álbum, contar «0 álbumes» no dice nada útil.
          meta: artist.albumCount
            ? plural(artist.albumCount, 'álbum', 'álbumes')
            : plural(artist.tracks.length, 'canción', 'canciones'),
          coverId: artist.coverId,
          kind: 'artist',
          round: true,
        }));
    body.innerHTML = items.length ? `<div class="cards">${items.join('')}</div>` : emptyHtml();
    return;
  }

  if (!tracks.length) {
    body.innerHTML = emptyHtml();
    return;
  }

  pending = tracks;
  rendered = 0;
  body.innerHTML = `${headRow()}<ul class="list" id="list" role="list"></ul><div class="sentinel" id="sentinel"></div>`;
  appendChunk();

  const sentinel = $('#sentinel');
  if (sentinel) {
    observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) appendChunk();
    }, { root: $('#stage'), rootMargin: '600px' });
    observer.observe(sentinel);
  }
}

/** Marca qué fila suena sin volver a pintar la lista entera. */
export function refreshRows() {
  for (const row of $$('.row')) {
    const isCurrent = row.dataset.id === state.currentId;
    row.classList.toggle('is-current', isCurrent);
    row.classList.toggle('playing', isCurrent && state.playing);
    row.classList.toggle('selected', state.selection.has(row.dataset.id));
  }
}

/** Lleva la vista hasta la canción que suena. */
export function scrollToCurrent() {
  const row = $(`.row[data-id="${CSS.escape(state.currentId ?? '')}"]`);
  row?.scrollIntoView({ block: 'nearest' });
}

/* ------------------------------------------------------------ interacción */

export function trackMenu(anchor, id) {
  const track = getTrack(id);
  if (!track) return;
  const ids = actionTargets(id);
  const many = ids.length > 1;
  const label = many ? `${ids.length} canciones` : `«${track.title}»`;

  const items = [
    { key: 'play', label: 'Reproducir ahora', icon: ICO.play, run: () => actions.play(id) },
    { key: 'next', label: 'Reproducir a continuación', icon: ICO.queue, run: () => actions.enqueueNext(ids) },
    { key: 'last', label: 'Añadir al final de la cola', icon: ICO.down, run: () => actions.enqueueLast(ids) },
    { type: 'sep' },
  ];

  if (!many) {
    if (track.album) {
      items.push({ key: 'goalbum', label: `Ir al álbum «${track.album}»`, icon: ICO.album, run: () => actions.goToAlbum(track) });
    }
    items.push({ key: 'goartist', label: `Ir a ${track.albumArtist || track.artist}`, icon: ICO.artist, run: () => actions.goToArtist(track) });
    items.push({ type: 'sep' });
  }

  items.push({ type: 'cap', label: 'Añadir a una lista' });
  for (const playlist of state.playlists) {
    items.push({
      key: `pl-${playlist.id}`,
      label: playlist.name,
      icon: ICO.list,
      run: () => actions.addToPlaylist(playlist.id, ids),
    });
  }
  items.push({ key: 'new-pl', label: 'Nueva lista…', icon: ICO.plus, run: () => actions.newPlaylistWith(ids) });
  items.push({ type: 'sep' });

  items.push({
    key: 'fav',
    label: track.favorite && !many ? 'Quitar de favoritos' : 'Marcar como favorita',
    icon: ICO.heart,
    run: () => actions.setFavorite(ids, many ? true : !track.favorite),
  });
  if (!many) {
    items.push({ key: 'reveal', label: 'Mostrar en el explorador', icon: ICO.reveal, run: () => actions.reveal(id) });
  }
  if (state.view.type === 'playlist') {
    items.push({ type: 'sep' });
    items.push({ key: 'unpl', label: 'Quitar de esta lista', icon: ICO.minus, run: () => actions.removeFromPlaylist(ids) });
  }
  items.push({ type: 'sep' });
  items.push({
    key: 'forget',
    label: `Quitar ${label} de la biblioteca`,
    icon: ICO.minus,
    danger: true,
    run: () => actions.forget(ids),
  });
  if (!many) {
    items.push({ key: 'trash', label: 'Mover el archivo a la papelera…', icon: ICO.trash, danger: true, run: () => actions.trash(id) });
  }
  popover(anchor, items);
}

export function bindStage(handlers) {
  actions = handlers;
  const head = $('#stage-head');
  const body = $('#stage-body');

  head.addEventListener('click', (event) => {
    const tool = event.target.closest('[data-tool]');
    if (tool) actions.tool(tool.dataset.tool, tool);
  });
  head.addEventListener('change', (event) => {
    if (event.target.id === 'sort-key') actions.sortBy(event.target.value);
  });

  body.addEventListener('click', (event) => {
    const sortButton = event.target.closest('[data-sort]');
    if (sortButton) return actions.sortBy(sortButton.dataset.sort, true);

    const card = event.target.closest('[data-card]');
    if (card) {
      if (event.target.closest('[data-act="play-card"]')) return actions.playCard(card.dataset.card, card.dataset.key);
      return actions.openCard(card.dataset.card, card.dataset.key);
    }

    const tool = event.target.closest('[data-tool]');
    if (tool) return actions.tool(tool.dataset.tool, tool);

    const row = event.target.closest('.row');
    if (!row) return undefined;
    const id = row.dataset.id;
    const act = event.target.closest('[data-act]')?.dataset.act;
    if (act === 'play') return actions.playOrPause(id);
    if (act === 'fav') return actions.setFavorite([id], !getTrack(id)?.favorite);
    if (act === 'menu') return trackMenu(event.target.closest('[data-act="menu"]'), id);

    // Selección al estilo del explorador de archivos.
    if (event.shiftKey) selectRange(id, visibleTracks());
    else if (event.metaKey || event.ctrlKey) toggleSelection(id);
    else selectOnly(id);
    actions.selectionChanged();
    return undefined;
  });

  body.addEventListener('dblclick', (event) => {
    const row = event.target.closest('.row');
    if (row && !event.target.closest('button')) actions.play(row.dataset.id);
  });

  body.addEventListener('contextmenu', (event) => {
    const row = event.target.closest('.row');
    if (!row) return;
    event.preventDefault();
    if (!state.selection.has(row.dataset.id)) {
      selectOnly(row.dataset.id);
      actions.selectionChanged();
    }
    trackMenu(row, row.dataset.id);
  });

  body.addEventListener('keydown', (event) => {
    const row = event.target.closest('.row');
    if (!row) return;
    const id = row.dataset.id;
    if (event.key === 'Enter') {
      event.preventDefault();
      actions.playOrPause(id);
      return;
    }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && event.altKey) {
      event.preventDefault();
      actions.moveInPlaylist(id, event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const rows = $$('.row', body);
      const next = rows[rows.indexOf(row) + (event.key === 'ArrowDown' ? 1 : -1)];
      if (next) {
        next.focus();
        if (!event.shiftKey) {
          selectOnly(next.dataset.id);
        } else {
          selectRange(next.dataset.id, visibleTracks());
        }
        actions.selectionChanged();
      }
    }
  });

  /* --- arrastrar filas: reordenar dentro de la lista o soltarlas en el raíl --- */
  let dragging = null;

  body.addEventListener('dragstart', (event) => {
    const row = event.target.closest('.row');
    if (!row) {
      event.preventDefault();
      return;
    }
    const ids = actionTargets(row.dataset.id);
    dragging = canReorder() ? row.dataset.id : null;
    row.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'copyMove';
    try {
      event.dataTransfer.setData('application/x-pletina-tracks', JSON.stringify(ids));
      event.dataTransfer.setData('text/plain', ids.join(','));
    } catch {
      /* sin portapapeles de arrastre: el reordenado interno sigue funcionando */
    }
  });

  body.addEventListener('dragover', (event) => {
    if (!dragging) return;
    const row = event.target.closest('.row');
    if (!row) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    for (const el of $$('.row', body)) el.classList.remove('drop-before', 'drop-after');
    if (row.dataset.id !== dragging) {
      const rect = row.getBoundingClientRect();
      row.classList.add(event.clientY > rect.top + rect.height / 2 ? 'drop-after' : 'drop-before');
    }
  });

  body.addEventListener('drop', (event) => {
    if (!dragging) return;
    const row = event.target.closest('.row');
    if (!row) return;
    event.preventDefault();
    const rect = row.getBoundingClientRect();
    actions.reorderInPlaylist(dragging, row.dataset.id, event.clientY > rect.top + rect.height / 2);
    dragging = null;
  });

  body.addEventListener('dragend', () => {
    dragging = null;
    for (const el of $$('.row', body)) el.classList.remove('drop-before', 'drop-after', 'dragging');
  });

  $('#stage').addEventListener('click', (event) => {
    // Un clic en el fondo deshace la selección, como en cualquier lista del sistema.
    if (event.target.closest('.row, .card, button, select, .stage-head')) return;
    if (!state.selection.size) return;
    clearSelection();
    actions.selectionChanged();
  });
}
