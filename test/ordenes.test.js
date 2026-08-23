import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * El menú nativo y las teclas de medios viven en el proceso principal; quien las
 * atiende vive en el renderizador, y entre los dos solo hay una cadena de texto.
 * Una errata ahí no rompe nada visible: el menú se abre, se pulsa y no pasa
 * absolutamente nada. Esta prueba cierra esa costura.
 */
const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const leer = (relativo) => readFile(path.join(raiz, relativo), 'utf8');

const emitidas = (fuente) => [
  ...fuente.matchAll(/\bcommand\('([^']+)'/g),
  ...fuente.matchAll(/sendCommand\('([^']+)'/g),
  ...fuente.matchAll(/globalShortcut\.register\([^,]+,\s*\(\)\s*=>\s*sendCommand\('([^']+)'/g),
].map((m) => m[1]);

const atendidas = (fuente) => [...fuente.matchAll(/case '([a-z]+:[a-zA-Z]+)':/g)].map((m) => m[1]);

describe('órdenes entre el menú y la interfaz', () => {
  it('todas las que emite el proceso principal tienen quien las atienda', async () => {
    const [menu, principal, interfaz] = await Promise.all([
      leer('src/main/menu.js'),
      leer('src/main/main.js'),
      leer('src/renderer/app.js'),
    ]);

    const enviadas = new Set([...emitidas(menu), ...emitidas(principal)]);
    const manejadas = new Set(atendidas(interfaz));
    const huerfanas = [...enviadas].filter((orden) => !manejadas.has(orden));

    expect(huerfanas).toEqual([]);
    // Y que la prueba esté mirando algo: si el patrón deja de encontrar órdenes,
    // esto avisa en vez de pasar en verde por vacío.
    expect(enviadas.size).toBeGreaterThan(15);
  });

  it('el temporizador de apagado llega desde el menú con sus minutos', async () => {
    const menu = await leer('src/main/menu.js');
    const interfaz = await leer('src/renderer/app.js');

    expect(menu).toMatch(/command\('sleep:set', \{ minutos: 'cancion' \}\)/);
    expect(menu).toMatch(/command\('sleep:set', \{ minutos: 30 \}\)/);
    expect(interfaz).toMatch(/case 'sleep:set': programarTemporizador\(payload\?\.minutos/);
  });

  it('cada canal que expone el preload existe en el proceso principal', async () => {
    const [preload, principal] = await Promise.all([
      leer('src/preload/preload.mjs'),
      leer('src/main/main.js'),
    ]);

    const pedidos = [...preload.matchAll(/invoke\('([^']+)'/g)].map((m) => m[1]);
    const registrados = new Set([...principal.matchAll(/handle\('([^']+)'/g)].map((m) => m[1]));
    const sinRespuesta = pedidos.filter((canal) => !registrados.has(canal));

    expect(sinRespuesta).toEqual([]);
    expect(pedidos.length).toBeGreaterThan(20);
  });

  it('cada evento que el principal envía tiene una suscripción en el preload', async () => {
    const [preload, principal] = await Promise.all([
      leer('src/preload/preload.mjs'),
      leer('src/main/main.js'),
    ]);

    const enviados = new Set([...principal.matchAll(/send\('([a-z]+:[a-zA-Z]+)'/g)].map((m) => m[1]));
    const suscritos = new Set([...preload.matchAll(/subscribe\('([^']+)'/g)].map((m) => m[1]));
    const sordos = [...enviados].filter((evento) => !suscritos.has(evento));

    expect(sordos).toEqual([]);
  });
});
