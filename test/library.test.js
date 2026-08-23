import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
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

describe('corregir etiquetas', () => {
  const primera = () => library.listTracks()[0];

  beforeEach(async () => {
    await song('01 - Los Planetas - Segundo premio.wav');
    await library.addFolders([musica]);
  });

  it('cambia el título y el álbum sin tocar el archivo', async () => {
    const antes = primera();
    const tamanoEnDisco = (await stat(antes.path)).size;

    library.editTracks([antes.id], { title: 'Segundo premio', album: 'Una semana en el motor de un autobús' });

    const despues = primera();
    expect(despues.title).toBe('Segundo premio');
    expect(despues.album).toBe('Una semana en el motor de un autobús');
    expect((await stat(despues.path)).size).toBe(tamanoEnDisco);
  });

  it('la corrección sobrevive a un reanálisis que vuelve a leer el archivo', async () => {
    const track = primera();
    library.editTracks([track.id], { artist: 'Los Planetas', album: 'Una semana' });

    // Se fuerza la relectura cambiando el archivo.
    await writeFile(track.path, 'contenido distinto para forzar la relectura');
    await library.rescan();

    const despues = primera();
    expect(despues.artist).toBe('Los Planetas');
    expect(despues.album).toBe('Una semana');
    expect(despues.edits).toEqual({ artist: 'Los Planetas', album: 'Una semana' });
  });

  it('corrige varias canciones de una vez', async () => {
    await song('02 - otra.wav');
    await library.rescan();
    const ids = library.listTracks().map((t) => t.id);

    const resultado = library.editTracks(ids, { album: 'Recopilatorio' });

    expect(resultado.edited).toBe(2);
    expect(library.listTracks().every((t) => t.album === 'Recopilatorio')).toBe(true);
  });

  it('ignora un título o un artista en blanco, que dejarían la fila muda', () => {
    const track = primera();
    const titulo = track.title;
    library.editTracks([track.id], { title: '   ', artist: '', album: '' });

    const despues = primera();
    expect(despues.title).toBe(titulo);
    expect(despues.artist).not.toBe('');
    // El álbum sí se puede vaciar: es una respuesta legítima.
    expect(despues.album).toBe('');
  });

  it('normaliza los campos numéricos', () => {
    const track = primera();
    library.editTracks([track.id], { year: '1998', trackNo: 'x', discNo: -3 });

    const despues = primera();
    expect(despues.year).toBe(1998);
    expect(despues.trackNo).toBe(0);
    expect(despues.discNo).toBe(0);
  });

  it('descarta campos que no son editables', () => {
    const track = primera();
    library.editTracks([track.id], { duration: 9999, path: '/otro/sitio.mp3' });

    const despues = primera();
    expect(despues.path).toBe(track.path);
    expect(despues.duration).not.toBe(9999);
  });

  it('restaurar vuelve a las etiquetas del archivo', async () => {
    const track = primera();
    const original = track.title;
    library.editTracks([track.id], { title: 'Inventado' });
    expect(primera().title).toBe('Inventado');

    const resultado = await library.restoreTags([track.id]);

    expect(resultado.restored).toBe(1);
    expect(primera().title).toBe(original);
    expect(primera().edits).toBeNull();
  });

  it('restaurar no se inventa trabajo si no había correcciones', async () => {
    expect((await library.restoreTags([primera().id])).restored).toBe(0);
  });

  it('si el archivo no se puede leer, la corrección se conserva', async () => {
    const track = primera();
    library.editTracks([track.id], { title: 'Nombre corregido' });
    await rm(track.path);

    const resultado = await library.restoreTags([track.id]);

    expect(resultado.restored).toBe(0);
    expect(resultado.unavailable).toBe(1);
    // Ni se pierde la corrección ni se queda el archivo sin nombre.
    expect(primera().title).toBe('Nombre corregido');
    expect(primera().edits).toEqual({ title: 'Nombre corregido' });
  });
});
