import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { serveFile, serveRanged } from '../src/main/file-response.js';

let dir;
let song;
const CONTENT = Buffer.from('0123456789'.repeat(100)); // 1.000 bytes exactos

const request = (headers = {}, method = 'GET') => new Request('https://x/', { method, headers });

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'pletina-http-'));
  song = path.join(dir, 'cancion.mp3');
  await writeFile(song, CONTENT);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('serveRanged', () => {
  it('sirve el archivo entero cuando no piden tramo', async () => {
    const response = await serveRanged(song, request());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/mpeg');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('content-length')).toBe('1000');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(CONTENT);
  });

  it('responde 206 con el tramo exacto que se le pide', async () => {
    const response = await serveRanged(song, request({ Range: 'bytes=10-19' }));
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 10-19/1000');
    expect(response.headers.get('content-length')).toBe('10');
    expect(await response.text()).toBe('0123456789');
  });

  it('completa hasta el final del archivo un tramo abierto', async () => {
    const response = await serveRanged(song, request({ Range: 'bytes=990-' }));
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 990-999/1000');
    expect((await response.arrayBuffer()).byteLength).toBe(10);
  });

  it('rechaza con 416 lo que no cabe en el archivo', async () => {
    const response = await serveRanged(song, request({ Range: 'bytes=5000-6000' }));
    expect(response.status).toBe(416);
    expect(response.headers.get('content-range')).toBe('bytes */1000');
  });

  it('un HEAD contesta cabeceras sin cuerpo', async () => {
    const response = await serveRanged(song, request({ Range: 'bytes=0-9' }, 'HEAD'));
    expect(response.status).toBe(206);
    expect(response.headers.get('content-length')).toBe('10');
    expect(await response.text()).toBe('');
  });

  it('un archivo que no existe es un 404, no una excepción', async () => {
    const response = await serveRanged(path.join(dir, 'fantasma.mp3'), request());
    expect(response.status).toBe(404);
  });

  it('una carpeta tampoco se sirve', async () => {
    const response = await serveRanged(dir, request());
    expect(response.status).toBe(404);
  });

  it('un archivo vacío no rompe el cálculo del tramo', async () => {
    const empty = path.join(dir, 'vacio.mp3');
    await writeFile(empty, '');
    const response = await serveRanged(empty, request());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe('0');
  });
});

describe('serveFile', () => {
  it('devuelve el contenido con el tipo indicado', async () => {
    const response = await serveFile(song, 'audio/mpeg');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/mpeg');
    expect((await response.arrayBuffer()).byteLength).toBe(1000);
  });

  it('lo que no existe es un 404', async () => {
    expect((await serveFile(path.join(dir, 'no.png'), 'image/png')).status).toBe(404);
  });
});
