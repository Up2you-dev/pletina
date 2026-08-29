import { $, $$, coverHtml, esc, gradientFor, popover } from './dom.js';
import { ICO } from './icons.js';
import { analizada } from '../../shared/beats.js';
import { camelot } from '../../shared/camelot.js';
import {
  formatTempo, formatTime, formatTotal, formatWhen, plural,
} from '../../shared/format.js';
import { esReproducible } from '../../shared/audio-files.js';
import { ORDEN_ALBUMES, ORDEN_ARTISTAS, SORT_KEYS } from '../../shared/sorting.js';
import { montarCabina, pintarMezclador } from './vista-mezclador.js';
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

/**
 * El tempo y la tonalidad de una canción, para las listas.
 *
 * Van juntos porque juntos se leen: son los dos números con los que se decide
 * qué va después de qué. Sin analizar sale una raya y no un cero, que un cero
 * parecería un dato.
 */
function musicaDe(track) {
  const bpm = formatTempo(track.bpm);
  // La casilla de la rueda cuando se puede sacar: «7A» dice con qué pega y
  // «Re menor» no, y en una lista de mil canciones eso es toda la diferencia.
  const tono = camelot(track.key) || track.key || '';
  if (!bpm && !tono) return '<i class="sin">—</i>';
  return `${bpm ? `<b>${esc(bpm)}</b>` : ''}${bpm && tono ? '<i class="sep">·</i>' : ''}${tono ? esc(tono) : ''}`;
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
    <span class="t-musica">${musicaDe(track)}</span>
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
  return `<div class="head-row cols"><span></span><span>#</span>${mark('title', 'Título')}${mark('album', secondaryLabel())}${mark('bpm', 'Tempo · Tono', 'musica')}<span></span>${mark('duration', 'Dur.', 'dur')}<span></span></div>`;
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
    // Analizar en lote: sin esto, sacarle el tempo a una biblioteca entera era
    // ir canción por canción desde el menú de cada fila.
    const objetivo = state.selection.size > 1
      ? tracks.filter((track) => state.selection.has(track.id))
      : tracks;
    // Sin las que este equipo no puede decodificar: contarlas dejaba el botón
    // pidiendo analizar unas canciones que nunca iban a poder analizarse.
    const faltan = objetivo.filter((track) => esReproducible(track) && !analizada(track)).length;
    parts.push(`<button class="btn" data-tool="analizar" title="Tempo, tonalidad y rejilla de compases">
      ${ICO.waves}${faltan ? `Analizar ${faltan}` : 'Volver a analizar'}</button>`);
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
  if (view.type === 'albums' || view.type === 'artists') {
    const opciones = view.type === 'albums' ? ORDEN_ALBUMES : ORDEN_ARTISTAS;
    const actual = view.type === 'albums' ? state.ordenAlbumes : state.ordenArtistas;
    parts.push(`<span class="label">Ordenar por</span><select class="sort" id="grid-sort">${
      opciones.map(([key, label]) => `<option value="${key}"${actual.key === key ? ' selected' : ''}>${label}</option>`).join('')
    }</select>`);
    parts.push(`<button class="btn" data-tool="grid-dir">${actual.dir === 'asc' ? '↑ Ascendente' : '↓ Descendente'}</button>`);
  }
  if (view.type === 'playlist') {
    if (tracks.length > 1) {
      // Estaba en la maqueta original y se perdió por el camino: reordenar la
      // lista entera por un criterio, de forma permanente.
      parts.push(`<span class="label">Reordenar por</span><select class="sort" id="playlist-sort">
        <option value="">Mi orden</option>
        ${SORT_KEYS.map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}
      </select>`);
    }
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
  if (view.type === 'mezclador') {
    return `<div class="stage-title"><h2>Mezclador</h2>
      <span class="stage-meta">encadena dos canciones como lo haría un pinchadiscos</span></div>`;
  }
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

  if (view.type === 'mezclador') {
    body.innerHTML = pintarMezclador();
    // La cabina no es HTML y ya está: hay cuatro lienzos que pintar sesenta
    // veces por segundo y un arrastre que enganchar.
    montarCabina(body);
    return;
  }

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
    key: 'edit',
    label: many ? `Corregir la información de ${ids.length} canciones…` : 'Corregir la información…',
    icon: ICO.pencil,
    run: () => actions.editTags(ids),
  });
  items.push({
    key: 'cover',
    label: many ? `Poner una carátula a ${ids.length} canciones…` : 'Poner una carátula…',
    icon: ICO.image,
    run: () => actions.setCover(ids),
  });
  if (ids.some((each) => getTrack(each)?.coverId)) {
    items.push({ key: 'nocover', label: 'Quitar la carátula', icon: ICO.x, run: () => actions.clearCover(ids) });
  }
  if (!many) {
    items.push({
      key: 'platoB',
      label: 'Preparar en el plato B',
      icon: ICO.waves,
      run: () => actions.cargarEnPlatoB(id),
    });
  }
  items.push({
    key: 'analizar',
    label: many ? `Analizar tempo y tonalidad de ${ids.length}…` : 'Analizar tempo y tonalidad',
    icon: ICO.waves,
    run: () => actions.analizar(ids),
  });
  items.push({
    key: 'write',
    label: 'Escribir las etiquetas en el archivo…',
    icon: ICO.down,
    run: () => actions.writeToFiles(ids),
  });
  if (ids.some((each) => getTrack(each)?.edits)) {
    items.push({
      key: 'restore',
      label: 'Volver a las etiquetas del archivo',
      icon: ICO.refresh,
      run: () => actions.restoreTags(ids),
    });
  }
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
    if (event.target.id === 'grid-sort') actions.sortGrid(event.target.value);
    if (event.target.id === 'playlist-sort' && event.target.value) {
      actions.reorderPlaylistBy(event.target.value);
    }
  });

  body.addEventListener('click', (event) => {
    const cargar = event.target.closest('[data-cargar]');
    if (cargar) return actions.cargarEnPlatoB(cargar.dataset.cargar);

    const nivel = event.target.closest('[data-zoom]');
    if (nivel) return actions.mezclador('zoom', nivel.dataset.zoom);

    // Los mandos de la cabina que llevan plato: cada uno dice sobre cuál actúa,
    // que es lo que permite que las mismas herramientas valgan para los dos.
    const pad = event.target.closest('[data-cue][data-n]');
    // Con Mayúsculas se borra: es la mitad de las veces y sin ello haría falta
    // un menú contextual para algo que se hace con el dedo puesto.
    if (pad) return actions.cue(pad.dataset.cue, Number(pad.dataset.n), event.shiftKey);

    const bucle = event.target.closest('[data-bucle]');
    if (bucle) return actions.bucle(bucle.dataset.bucle, Number(bucle.dataset.valor));

    const tamano = event.target.closest('[data-tamano-salto]');
    if (tamano) return actions.mezclador('tamano-salto', tamano.dataset.tamanoSalto);

    const salto = event.target.closest('[data-salto]');
    if (salto) return actions.salto(salto.dataset.salto, Number(salto.dataset.valor));

    const empujon = event.target.closest('[data-empujon]');
    if (empujon) return actions.empujonRejilla(empujon.dataset.empujon, Number(empujon.dataset.valor));

    const afinar = event.target.closest('[data-afinar]');
    if (afinar) return actions.afinarTempo(afinar.dataset.afinar, Number(afinar.dataset.valor));

    const octava = event.target.closest('[data-octava]');
    if (octava) return actions.octava(octava.dataset.octava, Number(octava.dataset.valor));

    const marcar = event.target.closest('[data-marcar]');
    if (marcar) return actions.marcarTempo(marcar.dataset.marcar);

    const cascos = event.target.closest('button[data-cascos]');
    if (cascos) return actions.cascos(cascos.dataset.cascos, cascos.dataset.valor);

    const mezcla = event.target.closest('[data-mezcla]');
    if (mezcla) {
      // Una casilla se atiende abajo, en `change`, que es quien sabe si ha
      // quedado marcada. Aquí su valor sería `undefined` —o sea, apagar— y
      // encima el repintado se llevaba por delante el `change` que venía
      // detrás: las tres casillas de la cabina se podían apagar y no encender.
      if (event.target.type === 'checkbox') return undefined;
      return actions.mezclador(mezcla.dataset.mezcla, mezcla.dataset.valor ?? mezcla.dataset.id);
    }

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

  body.addEventListener('change', (event) => {
    const mezcla = event.target.closest('[data-mezcla]');
    if (mezcla && event.target.type === 'checkbox') {
      actions.mezclador(mezcla.dataset.mezcla, event.target.checked);
    }
  });

  // Los mandos de la tira de canal se atienden en `input`, que llega mientras se
  // arrastra: un ecualizador que solo responde al soltar no sirve para pinchar.
  body.addEventListener('input', (event) => {
    const mando = event.target.closest('[data-tira][data-mando]');
    if (mando) actions.tira(mando.dataset.tira, mando.dataset.mando, Number(mando.value));
    const fader = event.target.closest('input[data-fader]');
    if (fader) actions.fader(fader.dataset.fader, Number(fader.value));
    const cascos = event.target.closest('input[data-cascos]');
    if (cascos) actions.cascos(cascos.dataset.cascos, Number(cascos.value));
  });

  body.addEventListener('change', (event) => {
    const salida = event.target.closest('select[data-cascos="salida"]');
    if (salida) actions.cascos('salida', salida.value);
  });

  // Doble clic: la banda se mata y se devuelve, como en cualquier mesa.
  body.addEventListener('dblclick', (event) => {
    // Y el fader de tempo vuelve al centro, que es el gesto de siempre.
    const fader = event.target.closest('input[data-fader]');
    if (fader) {
      fader.value = '0';
      actions.fader(fader.dataset.fader, 0);
      return;
    }
    const mando = event.target.closest('[data-tira][data-mando]');
    if (!mando) return;
    const clave = mando.dataset.mando;
    const neutro = clave === 'volumen' ? 1 : 0;
    const matado = clave === 'volumen' ? 0 : -26;
    const valor = Number(mando.value) === neutro ? matado : neutro;
    mando.value = String(clave === 'filtro' ? 0 : valor);
    actions.tira(mando.dataset.tira, clave, Number(mando.value));
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
    // Un candidato de la cabina también se arrastra: es la única fuente a la
    // vista estando en el mezclador, y se anunciaba arrastrable con el arrastre
    // cancelado, que es peor que no ofrecerlo.
    const candidato = event.target.closest('[data-cargar][data-id]');
    if (candidato) {
      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setData('application/x-pletina-tracks', JSON.stringify([candidato.dataset.id]));
      event.dataTransfer.setData('text/plain', candidato.dataset.id);
      return;
    }
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

  /* --- soltar una canción en el plato B de la cabina --- */
  const zonaDeSuelta = (event) => event.target.closest('[data-suelta="b"]');
  const idSoltado = (dataTransfer) => {
    try {
      const crudo = dataTransfer.getData('application/x-pletina-tracks');
      const ids = crudo ? JSON.parse(crudo) : [];
      return Array.isArray(ids) ? ids[0] : null;
    } catch {
      return null;
    }
  };

  body.addEventListener('dragover', (event) => {
    const zona = zonaDeSuelta(event);
    if (zona && event.dataTransfer.types.includes('application/x-pletina-tracks')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      zona.classList.add('encima');
      return;
    }
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

  body.addEventListener('dragleave', (event) => {
    const zona = zonaDeSuelta(event);
    if (zona && !zona.contains(event.relatedTarget)) zona.classList.remove('encima');
  });

  body.addEventListener('drop', (event) => {
    const zona = zonaDeSuelta(event);
    if (zona) {
      const id = idSoltado(event.dataTransfer);
      zona.classList.remove('encima');
      if (id) {
        event.preventDefault();
        dragging = null;
        return actions.cargarEnPlatoB(id);
      }
    }
    if (!dragging) return undefined;
    const row = event.target.closest('.row');
    if (!row) return undefined;
    event.preventDefault();
    const rect = row.getBoundingClientRect();
    actions.reorderInPlaylist(dragging, row.dataset.id, event.clientY > rect.top + rect.height / 2);
    dragging = null;
    return undefined;
  });

  body.addEventListener('dragend', () => {
    dragging = null;
    for (const el of $$('.row', body)) el.classList.remove('drop-before', 'drop-after', 'dragging');
    for (const el of $$('[data-suelta]', body)) el.classList.remove('encima');
  });

  // El buscador del plato B: escribir manda sobre las sugerencias.
  body.addEventListener('input', (event) => {
    const buscador = event.target.closest('[data-buscar-candidato]');
    if (buscador) actions.buscarCandidato(buscador.value, buscador);
  });

  $('#stage').addEventListener('click', (event) => {
    // Un clic en el fondo deshace la selección, como en cualquier lista del sistema.
    if (event.target.closest('.row, .card, button, select, .stage-head')) return;
    if (!state.selection.size) return;
    clearSelection();
    actions.selectionChanged();
  });
}
