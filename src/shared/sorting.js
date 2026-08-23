/** Búsqueda y ordenación de la biblioteca. Determinista: el desempate final es siempre la ruta. */

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

/**
 * Artículos que estorban al ordenar. «Los Planetas» pertenece a la P y «The
 * Beatles» a la B: cualquier estantería de discos del mundo lo hace así, y una
 * lista que los amontona en la L y la T es una lista que no se puede recorrer.
 */
const ARTICULOS = /^(?:el|la|los|las|lo|un|una|unos|unas|the|a|an)\s+/i;

export function sinArticulo(texto) {
  return String(texto ?? '').trim().replace(ARTICULOS, '');
}

/** Opciones de ordenación por defecto; cada vista puede pasar las suyas. */
export const ORDEN_POR_DEFECTO = { ignorarArticulos: true };

const clave = (valor, opciones) => (
  opciones?.ignorarArticulos === false ? String(valor ?? '') : sinArticulo(valor)
);

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
  ['bpm', 'Tempo'],
  ['key', 'Tonalidad'],
];

/** Cómo se ordenan las rejillas de álbumes y artistas. */
export const ORDEN_ALBUMES = [
  ['artista', 'Artista'],
  ['titulo', 'Título'],
  ['year', 'Año'],
  ['canciones', 'Nº de canciones'],
];

export const ORDEN_ARTISTAS = [
  ['nombre', 'Nombre'],
  ['albumes', 'Nº de álbumes'],
  ['canciones', 'Nº de canciones'],
];

/** Los campos de nombre propio se comparan sin su artículo; el resto, tal cual. */
const CON_ARTICULO = new Set(['artist', 'albumArtist', 'album', 'title']);
const text = (a, b, field, opciones) => (CON_ARTICULO.has(field)
  ? collator.compare(clave(a[field], opciones), clave(b[field], opciones))
  : collator.compare(String(a[field] ?? ''), String(b[field] ?? '')));
const num = (a, b, field) => (Number(a[field]) || 0) - (Number(b[field]) || 0);

/** Orden de disco: nº de disco, nº de pista y, si el archivo no los trae, título. */
export function compareByDisc(a, b) {
  return num(a, b, 'discNo') || num(a, b, 'trackNo') || text(a, b, 'title');
}

const COMPARATORS = {
  title: (a, b, o) => text(a, b, 'title', o) || text(a, b, 'artist', o),
  artist: (a, b, o) => text(a, b, 'artist', o) || text(a, b, 'album', o) || compareByDisc(a, b),
  album: (a, b, o) => text(a, b, 'album', o) || compareByDisc(a, b),
  duration: (a, b) => num(a, b, 'duration'),
  year: (a, b, o) => num(a, b, 'year') || text(a, b, 'album', o) || compareByDisc(a, b),
  plays: (a, b) => num(a, b, 'playCount'),
  lastPlayed: (a, b) => num(a, b, 'lastPlayedAt'),
  added: (a, b) => num(a, b, 'addedAt'),
  bpm: (a, b) => num(a, b, 'bpm'),
  key: (a, b) => collator.compare(String(a.key || ''), String(b.key || '')),
};

/**
 * Campos donde el valor vacío significa «no lo sé», no «cero». Un disco sin año
 * no es de antes de Cristo y una canción sin analizar no va a cero pulsaciones:
 * esas van al final, se ordene como se ordene.
 */
const DESCONOCIDO = {
  bpm: (t) => !t.bpm,
  key: (t) => !t.key,
  year: (t) => !t.year,
  lastPlayed: (t) => !t.lastPlayedAt,
};

export function comparatorFor(key) {
  return COMPARATORS[key] || COMPARATORS.added;
}

/**
 * Devuelve una copia ordenada. La ruta cierra siempre el desempate para que dos
 * canciones idénticas en etiquetas no bailen entre repintados.
 */
export function sortTracks(tracks, key, dir = 'asc', opciones = ORDEN_POR_DEFECTO) {
  const cmp = comparatorFor(key);
  const sign = dir === 'desc' ? -1 : 1;
  const sinValor = DESCONOCIDO[key];
  return tracks.slice().sort((a, b) => {
    if (sinValor) {
      const faltaA = sinValor(a);
      const faltaB = sinValor(b);
      if (faltaA !== faltaB) return faltaA ? 1 : -1;
    }
    const r = cmp(a, b, opciones);
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
  ordenarAlbumes(out, 'artista', 'asc');
  return out;
}

/** Ordena una rejilla de álbumes ya agrupada. Cambia el array recibido. */
export function ordenarAlbumes(albumes, criterio = 'artista', dir = 'asc') {
  const signo = dir === 'desc' ? -1 : 1;
  const porArtista = (a, b) => collator.compare(sinArticulo(a.artist), sinArticulo(b.artist))
    || (a.year - b.year)
    || collator.compare(sinArticulo(a.album), sinArticulo(b.album));
  const criterios = {
    artista: porArtista,
    titulo: (a, b) => collator.compare(sinArticulo(a.album), sinArticulo(b.album)) || porArtista(a, b),
    year: (a, b) => (a.year - b.year) || porArtista(a, b),
    canciones: (a, b) => (a.tracks.length - b.tracks.length) || porArtista(a, b),
  };
  const cmp = criterios[criterio] ?? porArtista;
  albumes.sort((a, b) => cmp(a, b) * signo || collator.compare(a.key, b.key));
  return albumes;
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
  ordenarArtistas(out, 'nombre', 'asc');
  return out;
}

/** Ordena una rejilla de artistas ya agrupada. Cambia el array recibido. */
export function ordenarArtistas(artistas, criterio = 'nombre', dir = 'asc') {
  const signo = dir === 'desc' ? -1 : 1;
  const porNombre = (a, b) => collator.compare(sinArticulo(a.artist), sinArticulo(b.artist));
  const criterios = {
    nombre: porNombre,
    albumes: (a, b) => (a.albumCount - b.albumCount) || porNombre(a, b),
    canciones: (a, b) => (a.tracks.length - b.tracks.length) || porNombre(a, b),
  };
  const cmp = criterios[criterio] ?? porNombre;
  artistas.sort((a, b) => cmp(a, b) * signo || collator.compare(a.key, b.key));
  return artistas;
}
