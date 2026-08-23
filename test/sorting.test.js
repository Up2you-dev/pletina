import { describe, expect, it } from 'vitest';
import {
  compareByDisc,
  groupByAlbum,
  groupByArtist,
  matchesTerms,
  normalize,
  queryTerms,
  searchHaystack,
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
