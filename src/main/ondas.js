import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Las ondas, en disco.
 *
 * Una onda de tres bandas de una canción de cinco minutos son unos ciento
 * treinta kilobytes: demasiado para meterlo en `biblioteca.json`, que se lee
 * entero en cada arranque, y muy poco para volver a decodificar el audio cada
 * vez que se mira un plato. Así que van en su propia carpeta, un archivo por
 * canción, igual que las carátulas.
 *
 * Lo que se guarda aquí es regenerable: si se borra la carpeta, basta con
 * volver a analizar.
 */
export function createOndaStore(dir) {
  const nombre = (id) => `${String(id).replace(/[^a-zA-Z0-9_-]/g, '')}.pond`;

  async function guardar(id, datos) {
    const limpio = nombre(id);
    if (!datos || limpio === '.pond') return false;
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, limpio), Buffer.from(datos));
      return true;
    } catch {
      // Sin onda se puede vivir: el mezclador sigue funcionando, solo que a ciegas.
      return false;
    }
  }

  async function leer(id) {
    try {
      const datos = await readFile(path.join(dir, nombre(id)));
      // Una copia exacta del trozo que ocupa: el búfer de Node puede ser mayor.
      return datos.buffer.slice(datos.byteOffset, datos.byteOffset + datos.byteLength);
    } catch {
      return null;
    }
  }

  async function borrar(ids = []) {
    await Promise.all(ids.map((id) => rm(path.join(dir, nombre(id)), { force: true }).catch(() => {})));
  }

  /** Tira las ondas de canciones que ya no están en la biblioteca. */
  async function limpiar(idsVivos = []) {
    const vivos = new Set(idsVivos.map((id) => nombre(id)));
    let borradas = 0;
    try {
      for (const archivo of await readdir(dir)) {
        if (!archivo.endsWith('.pond') || vivos.has(archivo)) continue;
        await rm(path.join(dir, archivo), { force: true }).catch(() => {});
        borradas += 1;
      }
    } catch {
      /* la carpeta aún no existe */
    }
    return borradas;
  }

  return { guardar, leer, borrar, limpiar };
}
