import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LIBRARY_DEFAULTS, createLibrary, trackIdFor, walkAudio } from '../src/main/library.js';
import { createStore } from '../src/main/store.js';

let root;
let musica;
let library;
let store;

/** La caché de carátulas necesita Electron; aquí basta con un doble. */
const coversDouble = {
  store: async () => null,
  fromFolder: async () => null,
  resetFolderCache: () => {},
  pathFor: (id) => id,
};

const song = (relative, bytes = 'ID3 falso') => {
  const full = path.join(musica, relative);
  return mkdir(path.dirname(full), { recursive: true })
    .then(() => writeFile(full, bytes))
    .then(() => full);
};

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'pletina-lib-'));
  musica = path.join(root, 'musica');
  await mkdir(musica, { recursive: true });
  store = createStore({ dir: root, name: 'biblioteca', defaults: LIBRARY_DEFAULTS, debounceMs: 5 });
  await store.load();
  library = createLibrary({ store, covers: coversDouble });
});

afterEach(async () => {
  // El almacén escribe en diferido: sin vaciarlo, el borrado corre contra él.
  await store.flush();
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

describe('walkAudio', () => {
  it('recorre subcarpetas y se queda solo con el audio', async () => {
    await song('rock/01 - Uno.mp3');
    await song('rock/en vivo/02 - Dos.flac');
    await song('rock/portada.jpg');
    await song('rock/notas.txt');

    const found = [];
    for await (const file of walkAudio(musica)) found.push(path.basename(file));
    expect(found.sort()).toEqual(['01 - Uno.mp3', '02 - Dos.flac']);
  });

  it('ignora las carpetas ocultas', async () => {
    await song('.oculta/secreta.mp3');
    await song('visible.mp3');
    const found = [];
    for await (const file of walkAudio(musica)) found.push(path.basename(file));
    expect(found).toEqual(['visible.mp3']);
  });

  it('no falla si la carpeta no existe', async () => {
    const found = [];
    for await (const file of walkAudio(path.join(root, 'fantasma'))) found.push(file);
    expect(found).toEqual([]);
  });
});

describe('trackIdFor', () => {
  it('da el mismo identificador para la misma ruta', () => {
    expect(trackIdFor('/musica/a.mp3')).toBe(trackIdFor('/musica/a.mp3'));
    expect(trackIdFor('/musica/a.mp3')).not.toBe(trackIdFor('/musica/b.mp3'));
  });
});

describe('análisis de carpetas', () => {
  it('da de alta lo que encuentra y deduce título y artista del nombre', async () => {
    await song('01 - Los Planetas - Segundo premio.mp3');
    const summary = await library.addFolders([musica]);

    expect(summary.added).toBe(1);
    const [track] = library.listTracks();
    expect(track.title).toBe('Segundo premio');
    expect(track.artist).toBe('Los Planetas');
    expect(track.folder).toBe(musica);
    expect(track.missing).toBe(false);
    expect(track.playCount).toBe(0);
  });

  it('la segunda pasada no vuelve a leer lo que no ha cambiado', async () => {
    await song('a.mp3');
    await song('b.mp3');
    await library.addFolders([musica]);

    const second = await library.rescan();
    expect(second.unchanged).toBe(2);
    expect(second.added).toBe(0);
  });

  it('vuelve a leer un archivo que se ha modificado', async () => {
    const file = await song('a.mp3');
    await library.addFolders([musica]);
    await writeFile(file, 'contenido distinto y más largo');

    const second = await library.rescan();
    expect(second.updated).toBe(1);
  });

  it('conserva favoritos y escuchas al reanalizar', async () => {
    const file = await song('a.mp3');
    await library.addFolders([musica]);
    const [track] = library.listTracks();
    library.patchTrack(track.id, { favorite: true });
    library.registerPlay(track.id);

    const past = new Date(Date.now() - 60000);
    await writeFile(file, 'otro contenido');
    await utimes(file, past, past);
    await library.rescan();

    const [again] = library.listTracks();
    expect(again.id).toBe(track.id);
    expect(again.favorite).toBe(true);
    expect(again.playCount).toBe(1);
  });

  it('marca como ausente lo que ya no está, sin borrarlo', async () => {
    const file = await song('a.mp3');
    await song('b.mp3');
    await library.addFolders([musica]);
    await rm(file);

    const summary = await library.rescan();
    expect(summary.missing).toBe(1);
    expect(library.listTracks()).toHaveLength(2);
    expect(library.listTracks().filter((t) => t.missing)).toHaveLength(1);
  });

  it('un disco desconectado no marca ausente media biblioteca', async () => {
    await song('a.mp3');
    await song('b.mp3');
    await library.addFolders([musica]);
    await rm(musica, { recursive: true, force: true });

    const summary = await library.rescan();
    expect(summary.unavailable).toEqual([musica]);
    expect(summary.missing).toBe(0);
    expect(library.listTracks().every((t) => !t.missing)).toBe(true);
  });

  it('recupera lo ausente cuando el archivo vuelve', async () => {
    const file = await song('a.mp3');
    await library.addFolders([musica]);
    await rm(file);
    await library.rescan();
    await song('a.mp3');

    await library.rescan();
    expect(library.listTracks()[0].missing).toBe(false);
  });

  it('limpia de una vez todo lo ausente', async () => {
    const file = await song('a.mp3');
    await song('b.mp3');
    await library.addFolders([musica]);
    await rm(file);
    await library.rescan();

    expect(library.removeMissing()).toHaveLength(1);
    expect(library.listTracks()).toHaveLength(1);
  });
});

describe('archivos sueltos', () => {
  it('entran sin carpeta y sobreviven a un reanálisis', async () => {
    await song('dentro.mp3');
    await library.addFolders([musica]);

    const fuera = path.join(root, 'suelta.mp3');
    await writeFile(fuera, 'audio');
    await library.addFiles([fuera]);

    await library.rescan();
    const suelta = library.listTracks().find((t) => t.path === fuera);
    expect(suelta).toBeDefined();
    expect(suelta.folder).toBeNull();
    expect(suelta.missing).toBe(false);
  });

  it('descarta lo que no es audio', async () => {
    const texto = path.join(root, 'notas.txt');
    await writeFile(texto, 'nada');
    const result = await library.addFiles([texto]);
    expect(result.added).toBe(0);
    expect(library.listTracks()).toHaveLength(0);
  });
});

describe('carpetas', () => {
  it('al quitar una carpeta se llevan sus canciones y se limpian las listas', async () => {
    await song('a.mp3');
    await library.addFolders([musica]);
    const ids = library.listTracks().map((t) => t.id);
    const playlist = library.createPlaylist('Mía', ids);

    library.removeFolder(musica);
    expect(library.listTracks()).toHaveLength(0);
    expect(library.playlistById(playlist.id).trackIds).toEqual([]);
    expect(library.snapshot().folders).toHaveLength(0);
  });
});

describe('listas', () => {
  beforeEach(async () => {
    await song('a.mp3');
    await song('b.mp3');
    await song('c.mp3');
    await library.addFolders([musica]);
  });

  it('crea sin duplicados', () => {
    const ids = library.listTracks().map((t) => t.id);
    const playlist = library.createPlaylist('Cena', [ids[0], ids[0], ids[1]]);
    expect(playlist.trackIds).toHaveLength(2);
  });

  it('no añade dos veces la misma canción', () => {
    const ids = library.listTracks().map((t) => t.id);
    const playlist = library.createPlaylist('Cena', [ids[0]]);
    const result = library.addToPlaylist(playlist.id, [ids[0], ids[1]]);
    expect(result.added).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('ignora identificadores que no existen', () => {
    const playlist = library.createPlaylist('Cena', []);
    const result = library.addToPlaylist(playlist.id, ['fantasma']);
    expect(result.added).toBe(0);
  });

  it('quita las canciones borradas de todas las listas', () => {
    const ids = library.listTracks().map((t) => t.id);
    const playlist = library.createPlaylist('Cena', ids);
    library.removeTracks([ids[1]]);
    expect(library.playlistById(playlist.id).trackIds).not.toContain(ids[1]);
  });

  it('se reordenan', () => {
    const a = library.createPlaylist('A', []);
    const b = library.createPlaylist('B', []);
    library.reorderPlaylists([b.id, a.id]);
    expect(library.snapshot().playlists.map((p) => p.name)).toEqual(['B', 'A']);
  });
});

describe('M3U', () => {
  it('exporta con rutas relativas al destino', async () => {
    await song('rock/a.mp3');
    await library.addFolders([musica]);
    const ids = library.listTracks().map((t) => t.id);
    const playlist = library.createPlaylist('Rodando', ids);

    const target = path.join(musica, 'lista.m3u8');
    await library.exportPlaylist(playlist.id, target);
    const content = await readFile(target, 'utf8');
    expect(content.startsWith('#EXTM3U')).toBe(true);
    expect(content).toContain('rock/a.mp3');
    expect(content).not.toContain(musica);
  });

  it('importa y da de alta lo que aún no estaba', async () => {
    await song('rock/a.mp3');
    await song('rock/b.mp3');
    const target = path.join(musica, 'externa.m3u');
    await writeFile(target, '#EXTM3U\n#EXTINF:200,Uno\nrock/a.mp3\nrock/b.mp3\n', 'utf8');

    const result = await library.importPlaylist(target);
    expect(result.imported).toBe(2);
    expect(result.discovered).toBe(2);
    expect(library.listTracks()).toHaveLength(2);
    expect(result.playlist.name).toBe('externa');
  });

  it('descarta las líneas que apuntan a internet', async () => {
    await song('a.mp3');
    const target = path.join(musica, 'mixta.m3u');
    await writeFile(target, 'http://radio.example/stream\na.mp3\n', 'utf8');

    const result = await library.importPlaylist(target);
    expect(result.imported).toBe(1);
  });

  it('vuelve a la biblioteca lo que exporta', async () => {
    await song('rock/a.mp3');
    await library.addFolders([musica]);
    const ids = library.listTracks().map((t) => t.id);
    const playlist = library.createPlaylist('Ida', ids);
    const target = path.join(musica, 'ida.m3u8');
    await library.exportPlaylist(playlist.id, target);

    const result = await library.importPlaylist(target);
    expect(result.playlist.trackIds).toEqual(ids);
    expect(result.discovered).toBe(0);
  });
});
