import { createQueue } from '../shared/queue.js';
import {
  compareByDisc,
  groupByAlbum,
  groupByArtist,
  matchesTerms,
  normalize,
  queryTerms,
  searchHaystack,
  sortTracks,
} from '../shared/sorting.js';

/**
 * Todo el estado de la interfaz en un sitio. Las vistas leen de aquí y llaman a
 * los repintados que toquen; no hay reactividad mágica ni framework.
 */
export const state = {
  tracks: [],
  byId: new Map(),
  playlists: [],
  folders: [],

  view: { type: 'library', id: null, key: null },
  sort: { key: 'added', dir: 'desc' },
  query: '',
  terms: [],

  queue: createQueue([]),
  currentId: null,
  playing: false,

  volume: 0.9,
  muted: false,
  shuffle: false,
  repeat: 'off',
  normalize: false,

  queueOpen: false,
  selection: new Set(),
  anchorId: null,
  scan: null,
  warning: null,
  ready: false,
};

const cache = { albums: null, artists: null };

/**
 * Guarda el catálogo y precalcula el texto de búsqueda de cada canción.
 * Agrupar por álbum o artista recorre la biblioteca entera, y eso se pide en
 * cada repintado: se memoriza y se tira la caché aquí, que es el único sitio
 * donde el catálogo cambia.
 */
export function setTracks(list) {
  state.tracks = list.map((track) => ({ ...track, _hay: searchHaystack(track) }));
  state.byId = new Map(state.tracks.map((track) => [track.id, track]));
  cache.albums = null;
  cache.artists = null;
}

export const getTrack = (id) => state.byId.get(id) ?? null;
export const playlistById = (id) => state.playlists.find((p) => p.id === id) ?? null;

export function setQuery(query) {
  state.query = query;
  state.terms = queryTerms(query);
}

const filtered = (list) => (state.terms.length ? list.filter((t) => matchesTerms(t, state.terms)) : list);

export const favorites = () => state.tracks.filter((t) => t.favorite);
export const missingTracks = () => state.tracks.filter((t) => t.missing);
export const albums = () => (cache.albums ??= groupByAlbum(state.tracks));
export const artists = () => (cache.artists ??= groupByArtist(state.tracks));

export function albumByKey(key) {
  return albums().find((album) => album.key === key) ?? null;
}

export function artistByKey(key) {
  return artists().find((artist) => artist.key === key) ?? null;
}

/**
 * La lista que se está mirando ahora mismo, ya filtrada y ordenada.
 * En listas y álbumes manda el orden propio; en el resto, el de la cabecera.
 */
export function visibleTracks() {
  const { view, sort } = state;
  switch (view.type) {
    case 'playlist': {
      const playlist = playlistById(view.id);
      if (!playlist) return [];
      return filtered(playlist.trackIds.map((id) => state.byId.get(id)).filter(Boolean));
    }
    case 'album': {
      const album = albumByKey(view.key);
      return album ? filtered(album.tracks.slice().sort(compareByDisc)) : [];
    }
    case 'artist': {
      const artist = artistByKey(view.key);
      return artist ? filtered(artist.tracks) : [];
    }
    case 'favorites':
      return sortTracks(filtered(favorites()), sort.key, sort.dir);
    case 'recent':
      return sortTracks(filtered(state.tracks.filter((t) => t.lastPlayedAt > 0)), 'lastPlayed', 'desc').slice(0, 200);
    case 'missing':
      return sortTracks(filtered(missingTracks()), sort.key, sort.dir);
    default:
      return sortTracks(filtered(state.tracks), sort.key, sort.dir);
  }
}

/**
 * Una vista puede quedarse huérfana entre sesiones: la lista se borró, el álbum
 * ya no existe. Se cae a la vista de al lado en vez de enseñar una pantalla vacía
 * sin explicación.
 */
export function normalizeView() {
  const { view } = state;
  if (view.type === 'playlist' && !playlistById(view.id)) state.view = { type: 'library', id: null };
  else if (view.type === 'album' && !albumByKey(view.key)) state.view = { type: 'albums', id: null };
  else if (view.type === 'artist' && !artistByKey(view.key)) state.view = { type: 'artists', id: null };
}

/** ¿Se puede reordenar arrastrando? Solo en una lista propia y sin filtro activo. */
export const canReorder = () => state.view.type === 'playlist' && !state.terms.length;

export function viewTitle() {
  const { view } = state;
  switch (view.type) {
    case 'playlist':
      return playlistById(view.id)?.name ?? 'Lista';
    case 'album':
      return albumByKey(view.key)?.album ?? 'Álbum';
    case 'artist':
      return artistByKey(view.key)?.artist ?? 'Artista';
    case 'albums':
      return 'Álbumes';
    case 'artists':
      return 'Artistas';
    case 'favorites':
      return 'Favoritos';
    case 'recent':
      return 'Escuchado hace poco';
    case 'missing':
      return 'Archivos que ya no están';
    default:
      return 'Biblioteca';
  }
}

/* --------------------------------------------------------------- selección */

export function clearSelection() {
  state.selection.clear();
  state.anchorId = null;
}

export function selectOnly(id) {
  state.selection = new Set([id]);
  state.anchorId = id;
}

export function toggleSelection(id) {
  if (state.selection.has(id)) state.selection.delete(id);
  else state.selection.add(id);
  state.anchorId = id;
}

/** Selección por rango (mayúsculas + clic), sobre la lista que se ve. */
export function selectRange(id, list) {
  const ids = list.map((t) => t.id);
  const from = ids.indexOf(state.anchorId ?? id);
  const to = ids.indexOf(id);
  if (from === -1 || to === -1) return selectOnly(id);
  const [start, end] = from <= to ? [from, to] : [to, from];
  state.selection = new Set(ids.slice(start, end + 1));
  return undefined;
}

/** Sobre qué canciones actúa una acción: la selección, o la fila señalada. */
export function actionTargets(id) {
  if (state.selection.has(id) && state.selection.size > 1) {
    const order = new Map(visibleTracks().map((t, i) => [t.id, i]));
    return [...state.selection].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  }
  return [id];
}

export { normalize };
