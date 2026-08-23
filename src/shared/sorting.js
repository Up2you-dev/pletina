/** Búsqueda y ordenación de la biblioteca. Determinista: el desempate final es siempre la ruta. */

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

/** Minúsculas sin acentos: «canción» y «cancion» son la misma búsqueda. */
export function normalize(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Texto indexable de una canción, calculado una vez al cargarla. */
export function searchHaystack(track) {
  return normalize(
    [track.title, track.artist, track.albumArtist, track.album, track.genre, track.path]
      .filter(Boolean)
      .join(' '),
  );
}

/** Divide la consulta en términos; todos deben aparecer (AND), en cualquier orden. */
export function queryTerms(query) {
  return normalize(query).split(/\s+/).filter(Boolean);
}

export function matchesTerms(track, terms) {
  if (!terms.length) return true;
  const hay = track._hay ?? searchHaystack(track);
  return terms.every((term) => hay.includes(term));
}

export const SORT_KEYS = [
  ['added', 'Fecha de alta'],
  ['title', 'Título'],
  ['artist', 'Artista'],
  ['album', 'Álbum'],
  ['duration', 'Duración'],
  ['year', 'Año'],
  ['plays', 'Reproducciones'],
  ['lastPlayed', 'Última escucha'],
];

const text = (a, b, field) => collator.compare(String(a[field] ?? ''), String(b[field] ?? ''));
const num = (a, b, field) => (Number(a[field]) || 0) - (Number(b[field]) || 0);

/** Orden de disco: nº de disco, nº de pista y, si el archivo no los trae, título. */
export function compareByDisc(a, b) {
  return num(a, b, 'discNo') || num(a, b, 'trackNo') || text(a, b, 'title');
}

const COMPARATORS = {
  title: (a, b) => text(a, b, 'title') || text(a, b, 'artist'),
  artist: (a, b) => text(a, b, 'artist') || text(a, b, 'album') || compareByDisc(a, b),
  album: (a, b) => text(a, b, 'album') || compareByDisc(a, b),
  duration: (a, b) => num(a, b, 'duration'),
  year: (a, b) => num(a, b, 'year') || text(a, b, 'album') || compareByDisc(a, b),
  plays: (a, b) => num(a, b, 'playCount'),
  lastPlayed: (a, b) => num(a, b, 'lastPlayedAt'),
  added: (a, b) => num(a, b, 'addedAt'),
};

export function comparatorFor(key) {
  return COMPARATORS[key] || COMPARATORS.added;
}

/**
 * Devuelve una copia ordenada. La ruta cierra siempre el desempate para que dos
 * canciones idénticas en etiquetas no bailen entre repintados.
 */
export function sortTracks(tracks, key, dir = 'asc') {
  const cmp = comparatorFor(key);
  const sign = dir === 'desc' ? -1 : 1;
  return tracks.slice().sort((a, b) => {
    const r = cmp(a, b);
    if (r !== 0) return r * sign;
    return collator.compare(String(a.path ?? ''), String(b.path ?? ''));
  });
}

/** Agrupa por álbum (clave: artista del álbum + título) y ordena cada disco. */
export function groupByAlbum(tracks) {
  const groups = new Map();
  for (const track of tracks) {
    const artist = track.albumArtist || track.artist || 'Sin artista';
    const album = track.album || 'Sin álbum';
    const key = `${normalize(artist)} ${normalize(album)}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, album, artist, year: track.year || 0, coverId: null, tracks: [] };
      groups.set(key, group);
    }
    group.tracks.push(track);
    if (!group.coverId && track.coverId) group.coverId = track.coverId;
    if (track.year && (!group.year || track.year < group.year)) group.year = track.year;
  }
  const out = [...groups.values()];
  for (const group of out) {
    group.tracks.sort(compareByDisc);
    group.duration = group.tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
  }
  out.sort((a, b) => collator.compare(a.artist, b.artist) || (a.year - b.year) || collator.compare(a.album, b.album));
  return out;
}

/** Agrupa por artista del álbum, con recuento de discos y canciones. */
export function groupByArtist(tracks) {
  const groups = new Map();
  for (const track of tracks) {
    const artist = track.albumArtist || track.artist || 'Sin artista';
    const key = normalize(artist);
    let group = groups.get(key);
    if (!group) {
      group = { key, artist, albums: new Set(), coverId: null, tracks: [] };
      groups.set(key, group);
    }
    group.tracks.push(track);
    if (track.album) group.albums.add(normalize(track.album));
    if (!group.coverId && track.coverId) group.coverId = track.coverId;
  }
  const out = [...groups.values()].map((g) => ({
    key: g.key,
    artist: g.artist,
    albumCount: g.albums.size,
    coverId: g.coverId,
    tracks: g.tracks.sort(
      (a, b) => collator.compare(String(a.album ?? ''), String(b.album ?? '')) || compareByDisc(a, b),
    ),
    duration: g.tracks.reduce((sum, t) => sum + (t.duration || 0), 0),
  }));
  out.sort((a, b) => collator.compare(a.artist, b.artist));
  return out;
}
