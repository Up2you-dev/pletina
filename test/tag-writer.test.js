import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  escribirEtiquetas,
  etiquetasId3,
  leerTrozos,
  motivoNoEscribible,
  puedeEscribir,
  wavConEtiquetas,
} from '../src/main/tag-writer.js';

let dir;

/** WAV PCM mínimo, con audio de verdad para comprobar que no se toca. */
function wav({ segundos = 1, conInfo = false } = {}) {
  const rate = 8000;
  const datos = Buffer.alloc(rate * segundos * 2);
  for (let i = 0; i < datos.length / 2; i += 1) datos.writeInt16LE((i % 200) - 100, i * 2);

  const fmt = Buffer.alloc(24);
  fmt.write('fmt ', 0, 4, 'ascii');
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8);
  fmt.writeUInt16LE(1, 10);
  fmt.writeUInt32LE(rate, 12);
  fmt.writeUInt32LE(rate * 2, 16);
  fmt.writeUInt16LE(2, 20);
  fmt.writeUInt16LE(16, 22);

  const partes = [fmt];
  if (conInfo) {
    const campo = Buffer.concat([
      Buffer.from('INAM', 'ascii'),
      (() => {
        const b = Buffer.alloc(4);
        b.writeUInt32LE(8);
        return b;
      })(),
      Buffer.from('Antiguo\0', 'utf8'),
    ]);
    const cuerpo = Buffer.concat([Buffer.from('INFO', 'ascii'), campo]);
    const cabecera = Buffer.alloc(8);
    cabecera.write('LIST', 0, 4, 'ascii');
    cabecera.writeUInt32LE(cuerpo.length, 4);
    partes.push(cabecera, cuerpo);
  }

  const cabeceraDatos = Buffer.alloc(8);
  cabeceraDatos.write('data', 0, 4, 'ascii');
  cabeceraDatos.writeUInt32LE(datos.length, 4);
  partes.push(cabeceraDatos, datos);

  const cuerpo = Buffer.concat([Buffer.from('WAVE', 'ascii'), ...partes]);
  const riff = Buffer.alloc(8);
  riff.write('RIFF', 0, 4, 'ascii');
  riff.writeUInt32LE(cuerpo.length, 4);
  return Buffer.concat([riff, cuerpo]);
}

/** MP3 con una trama MPEG-1 Layer III de verdad, para que se pueda analizar. */
function mp3() {
  const trama = Buffer.alloc(418);
  trama[0] = 0xff;
  trama[1] = 0xfb; // MPEG-1 Layer III, sin CRC
  trama[2] = 0x90; // 128 kbps, 44,1 kHz
  trama[3] = 0xc0;
  return Buffer.concat([trama, trama, trama]);
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'pletina-tags-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('qué se puede escribir', () => {
  it('acepta MP3 y WAV', () => {
    expect(puedeEscribir('/m/a.mp3')).toBe(true);
    expect(puedeEscribir('/m/a.WAV')).toBe(true);
  });

  it('rechaza el resto y lo dice por su nombre', () => {
    expect(puedeEscribir('/m/a.flac')).toBe(false);
    expect(motivoNoEscribible('/m/a.flac')).toContain('FLAC');
    expect(motivoNoEscribible('/m/a.m4a')).toContain('M4A');
  });
});

describe('WAV', () => {
  it('escribe las etiquetas y las devuelve al leerlas', async () => {
    const archivo = path.join(dir, 'cancion.wav');
    await writeFile(archivo, wav());

    const resultado = await escribirEtiquetas(archivo, {
      title: 'Segundo premio',
      artist: 'Los Planetas',
      album: 'Una semana en el motor de un autobús',
      year: 1998,
      genre: 'Indie',
    });

    expect(resultado.ok).toBe(true);
    const leido = await parseFile(archivo);
    expect(leido.common.title).toBe('Segundo premio');
    expect(leido.common.artist).toBe('Los Planetas');
    expect(leido.common.album).toBe('Una semana en el motor de un autobús');
  });

  it('no toca el audio', async () => {
    const archivo = path.join(dir, 'cancion.wav');
    await writeFile(archivo, wav({ segundos: 2 }));
    const antes = await parseFile(archivo);

    await escribirEtiquetas(archivo, { title: 'Otro nombre' });

    const despues = await parseFile(archivo);
    expect(despues.format.duration).toBeCloseTo(antes.format.duration, 3);
    expect(despues.format.sampleRate).toBe(antes.format.sampleRate);
    // Y el bloque de datos sigue byte a byte donde estaba.
    const trozos = leerTrozos(await readFile(archivo));
    expect(trozos.find((t) => t.id === 'data').cuerpo.length).toBe(8000 * 2 * 2);
  });

  it('reemplaza las etiquetas viejas en vez de duplicarlas', async () => {
    const archivo = path.join(dir, 'cancion.wav');
    await writeFile(archivo, wav({ conInfo: true }));

    await escribirEtiquetas(archivo, { title: 'Nuevo' });

    const trozos = leerTrozos(await readFile(archivo));
    const listas = trozos.filter((t) => t.id === 'LIST');
    expect(listas).toHaveLength(1);
    expect((await parseFile(archivo)).common.title).toBe('Nuevo');
  });

  it('deja una copia de seguridad del original', async () => {
    const archivo = path.join(dir, 'cancion.wav');
    const original = wav();
    await writeFile(archivo, original);

    const resultado = await escribirEtiquetas(archivo, { title: 'X' });

    expect(resultado.copia).toBe(`${archivo}.pletina-bak`);
    expect(await readFile(resultado.copia)).toEqual(original);
  });

  it('avisa de que la carátula no cabe en un WAV', async () => {
    const archivo = path.join(dir, 'cancion.wav');
    await writeFile(archivo, wav());

    const resultado = await escribirEtiquetas(archivo, { title: 'X' }, {
      caratula: { buffer: Buffer.from([1, 2, 3]), mime: 'image/jpeg' },
    });

    expect(resultado.ok).toBe(true);
    expect(resultado.aviso).toContain('WAV');
  });

  it('no deja restos del temporal', async () => {
    const archivo = path.join(dir, 'cancion.wav');
    await writeFile(archivo, wav());
    await escribirEtiquetas(archivo, { title: 'X' });
    await expect(stat(path.join(dir, '.pletina-cancion.wav.tmp'))).rejects.toThrow();
  });
});

describe('MP3', () => {
  it('escribe las etiquetas y las devuelve al leerlas', async () => {
    const archivo = path.join(dir, 'cancion.mp3');
    await writeFile(archivo, mp3());

    const resultado = await escribirEtiquetas(archivo, {
      title: 'Ciudad sin sueño',
      artist: 'Lagartija Nick',
      album: 'Omega',
      albumArtist: 'Lagartija Nick',
      year: 1996,
      trackNo: 3,
    });

    expect(resultado.ok).toBe(true);
    const leido = await parseFile(archivo);
    expect(leido.common.title).toBe('Ciudad sin sueño');
    expect(leido.common.artist).toBe('Lagartija Nick');
    expect(leido.common.album).toBe('Omega');
    expect(leido.common.track.no).toBe(3);
  });

  it('mete la carátula dentro del archivo', async () => {
    const archivo = path.join(dir, 'cancion.mp3');
    await writeFile(archivo, mp3());
    // PNG de un píxel, suficiente para comprobar que viaja entera.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );

    await escribirEtiquetas(archivo, { title: 'Con portada' }, {
      caratula: { buffer: png, mime: 'image/png' },
    });

    const leido = await parseFile(archivo);
    expect(leido.common.picture?.[0]?.data?.length).toBe(png.length);
  });

  it('conserva las etiquetas que no se tocan', async () => {
    const archivo = path.join(dir, 'cancion.mp3');
    await writeFile(archivo, mp3());
    await escribirEtiquetas(archivo, { title: 'Primero', artist: 'Alguien' });

    await escribirEtiquetas(archivo, { title: 'Segundo' });

    const leido = await parseFile(archivo);
    expect(leido.common.title).toBe('Segundo');
    expect(leido.common.artist).toBe('Alguien');
  });
});

describe('etiquetasId3', () => {
  it('traduce las claves de Pletina a las de ID3', () => {
    const tags = etiquetasId3({ title: 'T', albumArtist: 'AA', year: 1998, bpm: 128.4, key: 'Am' });
    expect(tags.title).toBe('T');
    expect(tags.performerInfo).toBe('AA');
    expect(tags.year).toBe('1998');
    expect(tags.bpm).toBe('128');
    expect(tags.initialKey).toBe('Am');
  });

  it('omite lo que no se ha rellenado', () => {
    expect(Object.keys(etiquetasId3({}))).toEqual([]);
  });
});

describe('wavConEtiquetas', () => {
  it('se niega con algo que no es un RIFF', () => {
    expect(() => wavConEtiquetas(Buffer.from('no soy un wav'), {})).toThrow(/WAV/);
  });
});
