import { describe, expect, it } from 'vitest';
import {
  compareByDisc,
  groupByAlbum,
  groupByArtist,
  matchesTerms,
  normalize,
  ordenarAlbumes,
  ordenarArtistas,
  queryTerms,
  searchHaystack,
  sinArticulo,
  sortTracks,
} from '../src/shared/sorting.js';

const track = (over = {}) => ({
  id: over.title ?? 'x',
  title: 'Título',
  artist: 'Artista',
  albumArtist: '',
  album: 'Álbum',
  genre: '',
  path: `/musica/${over.title ?? 'x'}.mp3`,
  duration: 200,
  addedAt: 1,
  ...over,
});

describe('normalize', () => {
  it('quita acentos y mayúsculas', () => {
    expect(normalize('Canción Ñoña')).toBe('cancion nona');
    expect(normalize('  ÉPICA  ')).toBe('epica');
  });

  it('sobrevive a valores vacíos', () => {
    expect(normalize(null)).toBe('');
    expect(normalize(undefined)).toBe('');
  });
});

describe('búsqueda', () => {
  it('parte la consulta en términos', () => {
    expect(queryTerms('  Los   Planetas ')).toEqual(['los', 'planetas']);
    expect(queryTerms('')).toEqual([]);
  });

  it('exige todos los términos, en cualquier orden', () => {
    const t = track({ title: 'Segundo premio', artist: 'Los Planetas' });
    t._hay = searchHaystack(t);
    expect(matchesTerms(t, queryTerms('planetas premio'))).toBe(true);
    expect(matchesTerms(t, queryTerms('premio zzz'))).toBe(false);
  });

  it('encuentra sin escribir los acentos', () => {
    const t = track({ title: 'Corazón', artist: 'Mecano' });
    t._hay = searchHaystack(t);
    expect(matchesTerms(t, queryTerms('corazon'))).toBe(true);
  });

  it('una consulta vacía no filtra nada', () => {
    expect(matchesTerms(track(), [])).toBe(true);
  });
});

describe('sortTracks', () => {
  it('ordena por título respetando el castellano', () => {
    const list = [track({ title: 'Zorro' }), track({ title: 'ábaco' }), track({ title: 'Mesa' })];
    expect(sortTracks(list, 'title', 'asc').map((t) => t.title)).toEqual(['ábaco', 'Mesa', 'Zorro']);
  });

  it('invierte el orden al pedir descendente', () => {
    const list = [track({ title: 'A', duration: 100 }), track({ title: 'B', duration: 300 })];
    expect(sortTracks(list, 'duration', 'desc').map((t) => t.title)).toEqual(['B', 'A']);
  });

  it('desempata siempre por ruta: dos repintados dan la misma lista', () => {
    const a = track({ title: 'Igual', path: '/musica/b.mp3', addedAt: 5 });
    const b = track({ title: 'Igual', path: '/musica/a.mp3', addedAt: 5 });
    const first = sortTracks([a, b], 'title', 'asc').map((t) => t.path);
    const second = sortTracks([b, a], 'title', 'asc').map((t) => t.path);
    expect(first).toEqual(['/musica/a.mp3', '/musica/b.mp3']);
    expect(second).toEqual(first);
  });

  it('no toca la lista original', () => {
    const list = [track({ title: 'B' }), track({ title: 'A' })];
    const copy = [...list];
    sortTracks(list, 'title');
    expect(list).toEqual(copy);
  });

  it('ordena los números como números', () => {
    const list = [track({ title: 'Pista 10' }), track({ title: 'Pista 2' })];
    expect(sortTracks(list, 'title', 'asc').map((t) => t.title)).toEqual(['Pista 2', 'Pista 10']);
  });
});

describe('compareByDisc', () => {
  it('ordena por disco y pista, no por título', () => {
    const list = [
      track({ title: 'Zeta', discNo: 1, trackNo: 1 }),
      track({ title: 'Alfa', discNo: 2, trackNo: 1 }),
      track({ title: 'Beta', discNo: 1, trackNo: 2 }),
    ];
    expect(list.sort(compareByDisc).map((t) => t.title)).toEqual(['Zeta', 'Beta', 'Alfa']);
  });
});

describe('agrupaciones', () => {
  const catalogo = [
    track({ title: 'Uno', album: 'Antártida', artist: 'Rocío', albumArtist: 'Rocío', year: 1998, trackNo: 1, coverId: 'c1.jpg' }),
    track({ title: 'Dos', album: 'Antártida', artist: 'Rocío', albumArtist: 'Rocío', year: 1998, trackNo: 2 }),
    track({ title: 'Tres', album: 'Otro', artist: 'Rocío', albumArtist: 'Rocío', year: 2001, trackNo: 1 }),
    track({ title: 'Cuatro', album: 'Solo', artist: 'Bruno', albumArtist: 'Bruno', year: 2010, trackNo: 1 }),
  ];

  it('junta las canciones de cada álbum y suma su duración', () => {
    const groups = groupByAlbum(catalogo);
    const antartida = groups.find((g) => g.album === 'Antártida');
    expect(antartida.tracks).toHaveLength(2);
    expect(antartida.duration).toBe(400);
    expect(antartida.coverId).toBe('c1.jpg');
    expect(antartida.tracks.map((t) => t.title)).toEqual(['Uno', 'Dos']);
  });

  it('ordena los álbumes por artista y año', () => {
    expect(groupByAlbum(catalogo).map((g) => g.album)).toEqual(['Solo', 'Antártida', 'Otro']);
  });

  it('cuenta los discos de cada artista', () => {
    const artistas = groupByArtist(catalogo);
    expect(artistas.map((a) => a.artist)).toEqual(['Bruno', 'Rocío']);
    expect(artistas.find((a) => a.artist === 'Rocío').albumCount).toBe(2);
  });

  it('los archivos sin etiquetas caen en cajones con nombre', () => {
    const groups = groupByAlbum([track({ album: '', artist: '', albumArtist: '' })]);
    expect(groups[0].album).toBe('Sin álbum');
    expect(groups[0].artist).toBe('Sin artista');
  });
});

describe('artículos al ordenar', () => {
  it('los quita del principio, en castellano y en inglés', () => {
    expect(sinArticulo('Los Planetas')).toBe('Planetas');
    expect(sinArticulo('El Último de la Fila')).toBe('Último de la Fila');
    expect(sinArticulo('The Beatles')).toBe('Beatles');
    expect(sinArticulo('La Habitación Roja')).toBe('Habitación Roja');
  });

  it('no toca los que forman parte del nombre', () => {
    expect(sinArticulo('Lagartija Nick')).toBe('Lagartija Nick');
    expect(sinArticulo('Elefantes')).toBe('Elefantes');
    expect(sinArticulo('Amaral')).toBe('Amaral');
  });

  it('coloca a cada artista donde lo buscaría una persona', () => {
    const t = (artist) => ({ title: 'x', artist, album: '', path: `/${artist}` });
    const lista = [t('The Beatles'), t('Los Planetas'), t('Amaral'), t('El Último de la Fila')];
    expect(sortTracks(lista, 'artist', 'asc').map((x) => x.artist))
      .toEqual(['Amaral', 'The Beatles', 'Los Planetas', 'El Último de la Fila']);
  });

  it('se puede pedir el orden literal', () => {
    const t = (artist) => ({ title: 'x', artist, album: '', path: `/${artist}` });
    const lista = [t('The Beatles'), t('Amaral')];
    expect(sortTracks(lista, 'artist', 'asc', { ignorarArticulos: false }).map((x) => x.artist))
      .toEqual(['Amaral', 'The Beatles']);
  });
});

describe('orden de las rejillas', () => {
  const albumes = () => [
    { key: 'a', album: 'Omega', artist: 'Lagartija Nick', year: 1996, tracks: [1, 2] },
    { key: 'b', album: 'Una semana', artist: 'Los Planetas', year: 1998, tracks: [1, 2, 3] },
    { key: 'c', album: 'Antártida', artist: 'Amaral', year: 2005, tracks: [1] },
  ];

  it('por artista, ignorando el artículo', () => {
    expect(ordenarAlbumes(albumes(), 'artista', 'asc').map((a) => a.artist))
      .toEqual(['Amaral', 'Lagartija Nick', 'Los Planetas']);
  });

  it('por año, y del revés', () => {
    expect(ordenarAlbumes(albumes(), 'year', 'asc').map((a) => a.year)).toEqual([1996, 1998, 2005]);
    expect(ordenarAlbumes(albumes(), 'year', 'desc').map((a) => a.year)).toEqual([2005, 1998, 1996]);
  });

  it('por número de canciones', () => {
    expect(ordenarAlbumes(albumes(), 'canciones', 'desc').map((a) => a.tracks.length)).toEqual([3, 2, 1]);
  });

  it('un criterio desconocido no rompe nada: cae al de siempre', () => {
    expect(ordenarAlbumes(albumes(), 'inventado', 'asc').map((a) => a.artist))
      .toEqual(['Amaral', 'Lagartija Nick', 'Los Planetas']);
  });

  it('los artistas se ordenan por nombre o por cuántos discos tienen', () => {
    const lista = [
      { key: 'a', artist: 'The Beatles', albumCount: 12, tracks: [1] },
      { key: 'b', artist: 'Amaral', albumCount: 3, tracks: [1, 2] },
    ];
    expect(ordenarArtistas([...lista], 'nombre', 'asc').map((a) => a.artist)).toEqual(['Amaral', 'The Beatles']);
    expect(ordenarArtistas([...lista], 'albumes', 'desc').map((a) => a.artist)).toEqual(['The Beatles', 'Amaral']);
  });
});

describe('ordenar por tempo y tonalidad', () => {
  const t = (bpm, key) => ({ title: `${bpm}`, artist: '', album: '', bpm, key, path: `/${bpm}` });

  it('ordena por pulsaciones', () => {
    expect(sortTracks([t(140, 'C'), t(90, 'G'), t(120, 'Am')], 'bpm', 'asc').map((x) => x.bpm))
      .toEqual([90, 120, 140]);
  });

  it('las canciones sin analizar quedan al final, se ordene como se ordene', () => {
    const lista = [t(0, ''), t(120, 'Am'), t(90, 'C')];
    expect(sortTracks(lista, 'key', 'asc').map((x) => x.key)).toEqual(['Am', 'C', '']);
    expect(sortTracks(lista, 'key', 'desc').map((x) => x.key)).toEqual(['C', 'Am', '']);
    expect(sortTracks(lista, 'bpm', 'asc').map((x) => x.bpm)).toEqual([90, 120, 0]);
    expect(sortTracks(lista, 'bpm', 'desc').map((x) => x.bpm)).toEqual([120, 90, 0]);
  });

  it('un año en blanco no es el año cero', () => {
    const disco = (year, title) => ({ title, artist: '', album: title, year, path: `/${title}` });
    const lista = [disco(0, 'sin año'), disco(1996, 'Omega'), disco(2005, 'Antártida')];
    expect(sortTracks(lista, 'year', 'asc').map((x) => x.title)).toEqual(['Omega', 'Antártida', 'sin año']);
  });
});
