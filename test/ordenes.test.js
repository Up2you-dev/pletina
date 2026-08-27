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

  it('los atajos del menú y los de la ventana dicen lo mismo y no suenan dos veces', async () => {
    // En Windows el menú va oculto: si sus atajos fueran los únicos, Ctrl+P no
    // haría nada. Por eso los escucha también la ventana. Y por eso el menú
    // tiene que soltarlos: registrados en los dos sitios, una pulsación llega
    // dos veces y la canción se para y arranca en el mismo golpe.
    const [menu, interfaz] = await Promise.all([
      leer('src/main/menu.js'),
      leer('src/renderer/app.js'),
    ]);

    // Del menú: qué orden manda cada atajo y cuáles están sueltos.
    const delMenu = new Map([...menu.matchAll(
      /accelerator: '([^']+)'[^\n]*?command\('([a-z]+:[a-zA-Z]+)'/g,
    )].map((m) => [m[1], m[2]]));
    const lista = menu.match(/ATAJOS_DEL_RENDERIZADOR = new Set\(\[([\s\S]*?)\]\);/)?.[1] ?? '';
    const sueltos = new Set([...lista.matchAll(/'([^']+)'/g)].map((m) => m[1]));

    // De la ventana: la tabla de atajos, traducida a como los escribe Electron.
    const comoElectron = (tecla) => {
      const alt = tecla.startsWith('alt+');
      const suelta = alt ? tecla.slice(4) : tecla;
      const nombre = suelta.replace(/^Arrow/, '');
      return `${alt ? 'Alt' : 'CmdOrCtrl'}+${nombre.length === 1 ? nombre.toUpperCase() : nombre}`;
    };
    const deLaVentana = new Map([...interfaz.matchAll(
      /\['([^']+)', '([a-z]+:[a-zA-Z]+)'\]/g,
    )].map((m) => [comoElectron(m[1]), m[2]]));

    expect(deLaVentana.size).toBeGreaterThan(15);
    for (const [atajo, orden] of deLaVentana) {
      if (!delMenu.has(atajo)) continue;
      expect([atajo, delMenu.get(atajo)]).toEqual([atajo, orden]);
      expect([atajo, sueltos.has(atajo)]).toEqual([atajo, true]);
    }
    // Y que el menú no suelte atajos que nadie más escucha: quedarían muertos.
    for (const atajo of sueltos) expect([atajo, deLaVentana.has(atajo)]).toEqual([atajo, true]);
  });

  it('todas las órdenes de la tabla de atajos tienen quien las atienda', async () => {
    const interfaz = await leer('src/renderer/app.js');
    const tabla = [...interfaz.matchAll(/\['[^']+', '([a-z]+:[a-zA-Z]+)'\]/g)].map((m) => m[1]);
    const manejadas = new Set(atendidas(interfaz));
    expect(tabla.filter((orden) => !manejadas.has(orden))).toEqual([]);
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
