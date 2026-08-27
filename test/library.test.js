import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LIBRARY_DEFAULTS, createLibrary, trackIdFor, walkAudio } from '../src/main/library.js';
import { createStore } from '../src/main/store.js';

let root;
let musica;
let library;
let store;

/** La caché de carátulas necesita Electron; aquí basta con un doble que recuerde. */
let caratulas;
const coversDouble = {
  store: async (buffer) => {
    if (!buffer?.length) return null;
    const id = `c${caratulas.size}.jpg`;
    caratulas.set(id, Buffer.from(buffer));
    return id;
  },
  fromFolder: async () => null,
  resetFolderCache: () => {},
  pathFor: (id) => path.join(root, 'caratulas', id),
};

const song = (relative, bytes = 'ID3 falso') => {
  const full = path.join(musica, relative);
  return mkdir(path.dirname(full), { recursive: true })
    .then(() => writeFile(full, bytes))
    .then(() => full);
};

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'pletina-lib-'));
  caratulas = new Map();
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

describe('escribir en los archivos', () => {
  /** WAV mínimo de verdad: se va a leer con el mismo lector que usa la aplicación. */
  const wavReal = () => {
    const datos = Buffer.alloc(8000 * 2);
    const fmt = Buffer.alloc(24);
    fmt.write('fmt ', 0, 4, 'ascii');
    fmt.writeUInt32LE(16, 4);
    fmt.writeUInt16LE(1, 8);
    fmt.writeUInt16LE(1, 10);
    fmt.writeUInt32LE(8000, 12);
    fmt.writeUInt32LE(16000, 16);
    fmt.writeUInt16LE(2, 20);
    fmt.writeUInt16LE(16, 22);
    const cabecera = Buffer.alloc(8);
    cabecera.write('data', 0, 4, 'ascii');
    cabecera.writeUInt32LE(datos.length, 4);
    const cuerpo = Buffer.concat([Buffer.from('WAVE', 'ascii'), fmt, cabecera, datos]);
    const riff = Buffer.alloc(8);
    riff.write('RIFF', 0, 4, 'ascii');
    riff.writeUInt32LE(cuerpo.length, 4);
    return Buffer.concat([riff, cuerpo]);
  };

  it('lleva la corrección al archivo y deja de necesitar el apaño', async () => {
    const archivo = path.join(musica, 'sin-etiquetas.wav');
    await mkdir(musica, { recursive: true });
    await writeFile(archivo, wavReal());
    await library.addFolders([musica]);
    const track = library.listTracks()[0];
    library.editTracks([track.id], { title: 'Nombre bueno', artist: 'Quien sea' });
    expect(library.getTrack(track.id).edits).not.toBeNull();

    const resultado = await library.escribirEnArchivos([track.id]);

    expect(resultado.hechos).toHaveLength(1);
    expect(resultado.fallidos).toHaveLength(0);
    // El archivo ya lo dice por sí mismo, así que la corrección sobra.
    expect(library.getTrack(track.id).edits).toBeNull();
    const leido = await parseFile(archivo);
    expect(leido.common.title).toBe('Nombre bueno');
    expect(leido.common.artist).toBe('Quien sea');
  });

  it('un reanálisis posterior conserva lo escrito', async () => {
    const archivo = path.join(musica, 'sin-etiquetas.wav');
    await mkdir(musica, { recursive: true });
    await writeFile(archivo, wavReal());
    await library.addFolders([musica]);
    const track = library.listTracks()[0];
    library.editTracks([track.id], { title: 'Definitivo' });
    await library.escribirEnArchivos([track.id]);

    await library.rescan({ full: true });

    expect(library.listTracks()[0].title).toBe('Definitivo');
  });

  it('dice qué formatos no sabe escribir en vez de fallar en silencio', async () => {
    await song('a.flac');
    await library.addFolders([musica]);
    const track = library.listTracks()[0];

    const resultado = await library.escribirEnArchivos([track.id]);

    expect(resultado.hechos).toHaveLength(0);
    expect(resultado.noSoportados[0].motivo).toContain('FLAC');
  });
});

describe('carátulas', () => {
  beforeEach(async () => {
    await song('a.mp3');
    await song('b.mp3');
    await library.addFolders([musica]);
  });

  it('pone la misma imagen a varias canciones', async () => {
    const imagen = path.join(root, 'portada.jpg');
    await writeFile(imagen, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
    const ids = library.listTracks().map((t) => t.id);

    const resultado = await library.setCover(ids, imagen);

    expect(resultado.changed).toBe(2);
    expect(library.listTracks().every((t) => t.coverId === resultado.coverId)).toBe(true);
  });

  it('se puede quitar', async () => {
    const imagen = path.join(root, 'portada.jpg');
    await writeFile(imagen, Buffer.from([1, 2, 3, 4]));
    const ids = library.listTracks().map((t) => t.id);
    await library.setCover(ids, imagen);

    expect(library.clearCover(ids).changed).toBe(2);
    expect(library.listTracks().every((t) => t.coverId === null)).toBe(true);
  });

  it('una imagen que no existe se queja, no revienta la biblioteca', async () => {
    const ids = library.listTracks().map((t) => t.id);
    await expect(library.setCover(ids, path.join(root, 'fantasma.jpg'))).rejects.toThrow();
    expect(library.listTracks()).toHaveLength(2);
  });
});

describe('análisis y rejilla', () => {
  beforeEach(async () => {
    await song('a.mp3');
    await library.addFolders([musica]);
  });

  const rejilla = {
    bpm: 127.312,
    offset: 0.437,
    tiempoFuerte: 2,
    fuerza: 0.62,
    fuerzaCompas: 0.31,
    compasFuerte: 1,
    fuerzaFrase: 0.28,
    compasesPorFrase: 4,
    tiemposPorCompas: 4,
    porBombo: true,
    entrada: 3.9,
  };

  it('guarda la rejilla entera, no solo el tempo', () => {
    const id = library.listTracks()[0].id;
    library.setAnalysis(id, { bpm: 127.312, key: 'Am', tonalidad: 'La menor', rejilla });
    expect(library.listTracks()[0].rejilla).toMatchObject(rejilla);
  });

  it('el tempo no se redondea a décimas', () => {
    // Una décima de más son cuarenta milisegundos de desfase al final de una
    // canción: es la diferencia entre cuadrar y no cuadrar.
    const id = library.listTracks()[0].id;
    library.setAnalysis(id, { bpm: 127.312, rejilla });
    const track = library.listTracks()[0];
    expect(track.bpm).toBeCloseTo(127.312, 3);
    expect(track.rejilla.bpm).toBeCloseTo(127.312, 3);
  });

  it('marca la versión de la rejilla, para saber cuáles hay que rehacer', () => {
    const id = library.listTracks()[0].id;
    library.setAnalysis(id, { bpm: 128, rejilla: { ...rejilla, version: 3 } });
    expect(library.listTracks()[0].rejilla.version).toBe(3);
    // Las de antes no traían versión: cuentan como la 1.
    library.setAnalysis(id, { bpm: 128, rejilla });
    expect(library.listTracks()[0].rejilla.version).toBe(1);
  });

  it('el uno se puede mover a mano sin tocar el resto del análisis', () => {
    const id = library.listTracks()[0].id;
    library.setAnalysis(id, { bpm: 127.312, key: 'Am', tonalidad: 'La menor', rejilla });

    library.ajustarRejilla(id, { offset: 0.12, tiempoFuerte: 0, compasFuerte: 2 });

    const track = library.listTracks()[0];
    expect(track.rejilla).toMatchObject({
      offset: 0.12, tiempoFuerte: 0, compasFuerte: 2, aMano: true, bpm: 127.312,
    });
    // Y el resto del análisis sigue donde estaba.
    expect(track.key).toBe('Am');
    expect(track.bpm).toBeCloseTo(127.312, 3);
  });

  it('el tempo se puede contar al doble sin mover un solo golpe de sitio', () => {
    // Un drum & bass son 174 o son 87 según a quién le preguntes, y ninguna
    // máquina acierta siempre. Lo que no puede pasar es que al llevarle la
    // contraria se descoloquen los golpes: los de antes siguen siendo golpes.
    const id = library.listTracks()[0].id;
    library.setAnalysis(id, { bpm: 87, rejilla: { ...rejilla, bpm: 87, offset: 0.4, tiempoFuerte: 0 } });

    library.ajustarRejilla(id, { factor: 2 });

    const track = library.listTracks()[0];
    expect(track.rejilla.bpm).toBeCloseTo(174, 3);
    // El «uno» de antes —el segundo 0,4— sigue siendo un golpe de la rejilla.
    const periodo = 60 / track.rejilla.bpm;
    const resto = ((0.4 - track.rejilla.offset) % periodo + periodo) % periodo;
    expect(Math.min(resto, periodo - resto)).toBeLessThan(0.001);
    expect(track.rejilla.aMano).toBe(true);
    // Y la ficha dice el tempo nuevo: si no, el plato iría al doble que el número.
    expect(track.bpm).toBeCloseTo(174, 3);
  });

  it('y a la mitad, anclando en el uno que ya estaba puesto', () => {
    const id = library.listTracks()[0].id;
    library.setAnalysis(id, {
      bpm: 130, rejilla: { ...rejilla, bpm: 130, offset: 0.2, tiempoFuerte: 1 },
    });

    library.ajustarRejilla(id, { factor: 0.5 });

    const track = library.listTracks()[0];
    expect(track.rejilla.bpm).toBeCloseTo(65, 3);
    // El uno estaba en el segundo 0,2 + un tiempo: ahí sigue, y ahora es el
    // primer tiempo del compás.
    expect(track.rejilla.offset).toBeCloseTo(0.2 + 60 / 130, 3);
    expect(track.rejilla.tiempoFuerte).toBe(0);
  });

  it('un factor absurdo no deja la canción sin tempo', () => {
    const id = library.listTracks()[0].id;
    library.setAnalysis(id, { bpm: 127.312, rejilla });
    for (const factor of [0, -2, 100, Number.NaN, 'dos']) {
      library.ajustarRejilla(id, { factor });
      expect(library.listTracks()[0].rejilla.bpm).toBeCloseTo(127.312, 3);
    }
  });

  it('una rejilla corregida a mano queda al día y no se pisa sola', () => {
    // Quien corrige una rejilla a mano no quiere que la siguiente versión del
    // análisis la dé por vieja y la sustituya por su propia opinión.
    const id = library.listTracks()[0].id;
    library.setAnalysis(id, { bpm: 130, rejilla: { ...rejilla, bpm: 130, version: 1 } });
    library.ajustarRejilla(id, { offset: 0.25 });
    expect(library.listTracks()[0].rejilla.version).toBeGreaterThanOrEqual(3);
  });

  it('mover el uno de una canción sin rejilla no hace nada', () => {
    const id = library.listTracks()[0].id;
    library.setAnalysis(id, { bpm: 120 });
    library.ajustarRejilla(id, { offset: 1 });
    expect(library.listTracks()[0].rejilla).toBe(null);
  });

  it('sin rejilla no inventa una', () => {
    const id = library.listTracks()[0].id;
    library.setAnalysis(id, { bpm: 120 });
    expect(library.listTracks()[0].rejilla).toBe(null);
  });

  it('con datos absurdos no guarda basura', () => {
    const id = library.listTracks()[0].id;
    library.setAnalysis(id, {
      bpm: -4,
      key: 12,
      rejilla: { ...rejilla, offset: -3, compasesPorFrase: 999, tiemposPorCompas: 99, entrada: -1 },
    });
    const track = library.listTracks()[0];
    expect(track.bpm).toBe(0);
    expect(track.key).toBe('');
    expect(track.rejilla).toMatchObject({ offset: 0, compasesPorFrase: 16, tiemposPorCompas: 8, entrada: 0 });
  });
});
