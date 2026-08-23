import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { contentTypeFor } from '../shared/audio-files.js';
import { parseRange } from '../shared/range.js';

/**
 * Servir archivos del disco como respuestas HTTP. Vive fuera de `protocols.js`
 * —y sin importar Electron— para poder probarlo con archivos de verdad.
 */

export const notFound = () => new Response('', { status: 404 });

/**
 * Un elemento `<audio>` que va a pasar por Web Audio necesita permiso de origen
 * cruzado; si no, el grafo suena a silencio en vez de dar error. La interfaz y
 * el audio viven en esquemas distintos, así que hace falta decirlo.
 */
const CORS = { 'access-control-allow-origin': '*' };

/** Archivo entero, con su tipo. Para la interfaz y las carátulas. */
export async function serveFile(file, type, { cors = false } = {}) {
  try {
    const body = await readFile(file);
    return new Response(body, {
      status: 200,
      headers: { 'content-type': type, ...(cors ? CORS : {}) },
    });
  } catch {
    return notFound();
  }
}

/**
 * Archivo con soporte de `Range`. Sin esto no se puede saltar al minuto tres de
 * una canción: Chromium pide un tramo y espera un 206 con su `Content-Range`.
 */
export async function serveRanged(file, request, { cors = true } = {}) {
  let stats;
  try {
    stats = await stat(file);
    if (!stats.isFile()) return notFound();
  } catch {
    return notFound();
  }

  const range = parseRange(request.headers.get('range'), stats.size);
  if (range?.unsatisfiable) {
    return new Response('', {
      status: 416,
      headers: { 'content-range': `bytes */${stats.size}`, 'accept-ranges': 'bytes' },
    });
  }

  const start = range ? range.start : 0;
  const end = range ? range.end : Math.max(0, stats.size - 1);
  const length = stats.size === 0 ? 0 : end - start + 1;
  const headers = {
    'content-type': contentTypeFor(file),
    'accept-ranges': 'bytes',
    'content-length': String(length),
    'cache-control': 'no-store',
    ...(cors ? CORS : {}),
  };
  if (range) headers['content-range'] = `bytes ${start}-${end}/${stats.size}`;

  const status = range ? 206 : 200;
  if (request.method === 'HEAD' || length === 0) return new Response('', { status, headers });
  return new Response(Readable.toWeb(createReadStream(file, { start, end })), { status, headers });
}
