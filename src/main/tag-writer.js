import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import NodeID3 from 'node-id3';
import { extname } from '../shared/audio-files.js';

/**
 * Escribir etiquetas DENTRO del archivo.
 *
 * Pletina nació prometiendo no tocar la música de nadie, y esa sigue siendo la
 * opción por defecto. Pero una corrección que solo vive aquí no sirve de nada en
 * el coche o en el móvil, así que se puede pedir que baje al archivo.
 *
 * Cuando se pide, se hace con red debajo:
 *  - se escribe en un temporal al lado y se renombra encima, para que un corte
 *    a mitad no deje el original a medio escribir;
 *  - antes de renombrar se guarda una copia `.pletina-bak` del original;
 *  - solo se tocan los formatos que se saben escribir bien.
 */

export const FORMATOS_ESCRIBIBLES = ['.mp3', '.wav', '.wave'];

export const puedeEscribir = (filePath) => FORMATOS_ESCRIBIBLES.includes(extname(filePath));

/** Los formatos que no se saben escribir se dicen por su nombre, no como «otros». */
export function motivoNoEscribible(filePath) {
  const ext = extname(filePath).replace('.', '').toUpperCase();
  return `Pletina solo escribe etiquetas en MP3 y WAV; este archivo es ${ext || 'de un formato desconocido'}.`;
}

/* ------------------------------------------------------------------- RIFF */

/** Recorre los trozos de un RIFF y devuelve dónde empieza y acaba cada uno. */
export function leerTrozos(buffer) {
  const trozos = [];
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF') return trozos;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const tamano = buffer.readUInt32LE(offset + 4);
    const fin = Math.min(offset + 8 + tamano, buffer.length);
    trozos.push({ id, offset, tamano, cuerpo: buffer.subarray(offset + 8, fin) });
    // Los trozos van alineados a par: sin esto, el recorrido se descuadra.
    offset = offset + 8 + tamano + (tamano % 2);
  }
  return trozos;
}

const CAMPOS_RIFF = {
  title: 'INAM',
  artist: 'IART',
  album: 'IPRD',
  year: 'ICRD',
  genre: 'IGNR',
  trackNo: 'IPRT',
  comment: 'ICMT',
};

function campoRiff(id, valor) {
  const texto = Buffer.from(`${valor}\0`, 'utf8');
  const relleno = texto.length % 2 ? Buffer.concat([texto, Buffer.alloc(1)]) : texto;
  const cabecera = Buffer.alloc(8);
  cabecera.write(id, 0, 4, 'ascii');
  cabecera.writeUInt32LE(relleno.length, 4);
  return Buffer.concat([cabecera, relleno]);
}

/**
 * Devuelve un WAV nuevo con su bloque LIST INFO puesto al día. Se conservan
 * todos los demás trozos tal cual: el audio no se recodifica ni se toca.
 */
export function wavConEtiquetas(buffer, meta) {
  const trozos = leerTrozos(buffer);
  if (!trozos.length) throw new Error('no parece un WAV');

  const campos = Object.entries(CAMPOS_RIFF)
    .filter(([clave]) => meta[clave] !== undefined && meta[clave] !== null && meta[clave] !== '')
    .map(([clave, id]) => campoRiff(id, meta[clave]));

  const partes = [];
  for (const trozo of trozos) {
    // El LIST INFO viejo se descarta; cualquier otro LIST (adtl…) se respeta.
    if (trozo.id === 'LIST' && trozo.cuerpo.toString('ascii', 0, 4) === 'INFO') continue;
    const cabecera = Buffer.alloc(8);
    cabecera.write(trozo.id, 0, 4, 'ascii');
    cabecera.writeUInt32LE(trozo.cuerpo.length, 4);
    partes.push(cabecera, trozo.cuerpo);
    if (trozo.cuerpo.length % 2) partes.push(Buffer.alloc(1));
  }

  if (campos.length) {
    const cuerpo = Buffer.concat([Buffer.from('INFO', 'ascii'), ...campos]);
    const cabecera = Buffer.alloc(8);
    cabecera.write('LIST', 0, 4, 'ascii');
    cabecera.writeUInt32LE(cuerpo.length, 4);
    partes.push(cabecera, cuerpo);
  }

  const cuerpo = Buffer.concat([Buffer.from('WAVE', 'ascii'), ...partes]);
  const riff = Buffer.alloc(8);
  riff.write('RIFF', 0, 4, 'ascii');
  riff.writeUInt32LE(cuerpo.length, 4);
  return Buffer.concat([riff, cuerpo]);
}

/* -------------------------------------------------------------------- MP3 */

/** Las claves de Pletina traducidas a las de ID3. */
export function etiquetasId3(meta, caratula) {
  const tags = {};
  if (meta.title) tags.title = meta.title;
  if (meta.artist) tags.artist = meta.artist;
  if (meta.albumArtist) tags.performerInfo = meta.albumArtist;
  if (meta.album !== undefined) tags.album = meta.album;
  if (meta.genre !== undefined) tags.genre = meta.genre;
  if (meta.year) tags.year = String(meta.year);
  if (meta.trackNo) tags.trackNumber = String(meta.trackNo);
  if (meta.discNo) tags.partOfSet = String(meta.discNo);
  if (meta.bpm) tags.bpm = String(Math.round(meta.bpm));
  if (meta.key) tags.initialKey = meta.key;
  if (caratula?.buffer?.length) {
    tags.image = {
      mime: caratula.mime || 'image/jpeg',
      type: { id: 3, name: 'front cover' },
      description: 'Portada',
      imageBuffer: caratula.buffer,
    };
  }
  return tags;
}

/* ---------------------------------------------------------------- escritura */

/**
 * Escribe las etiquetas en el archivo. Devuelve `{ok}` o `{ok:false, error}`;
 * nunca lanza, porque quien llama está a mitad de una edición del usuario.
 */
export async function escribirEtiquetas(filePath, meta, { caratula = null } = {}) {
  if (!puedeEscribir(filePath)) return { ok: false, error: motivoNoEscribible(filePath) };

  const temporal = path.join(path.dirname(filePath), `.pletina-${path.basename(filePath)}.tmp`);
  const copia = `${filePath}.pletina-bak`;
  try {
    const original = await readFile(filePath);
    const extension = extname(filePath);

    let salida;
    if (extension === '.mp3') {
      const resultado = NodeID3.update(etiquetasId3(meta, caratula), original);
      if (!Buffer.isBuffer(resultado)) throw new Error('no se han podido componer las etiquetas');
      salida = resultado;
    } else {
      salida = wavConEtiquetas(original, meta);
      if (caratula) {
        // El WAV no tiene un sitio estándar para la portada; se queda en Pletina.
        return await terminar(temporal, copia, filePath, original, salida, {
          ok: true,
          aviso: 'La carátula se guarda en Pletina: el formato WAV no tiene dónde llevarla.',
        });
      }
    }
    return await terminar(temporal, copia, filePath, original, salida, { ok: true });
  } catch (error) {
    await unlink(temporal).catch(() => {});
    return { ok: false, error: error.message };
  }
}

/** Copia de seguridad, escritura en temporal y renombrado encima. */
async function terminar(temporal, copia, filePath, original, salida, resultado) {
  await writeFile(copia, original);
  await writeFile(temporal, salida);
  await rename(temporal, filePath);
  return { ...resultado, copia };
}
