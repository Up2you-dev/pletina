import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { writeFileSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Persistencia en JSON del estado del usuario (biblioteca, listas, ajustes).
 *
 * Tres decisiones que no son negociables:
 *  - Escritura atómica: se escribe un `.tmp` y se renombra. Un corte de luz a
 *    mitad no puede dejar la biblioteca en un JSON truncado.
 *  - Escritura diferida: mil canciones importadas no son mil escrituras.
 *  - Un JSON ilegible no borra nada: se aparta como `.corrupto` y se avisa.
 */
export function createStore({ dir, name, defaults, debounceMs = 500 }) {
  const file = path.join(dir, `${name}.json`);
  const tmp = `${file}.tmp`;
  let data = structuredClone(defaults);
  let timer = null;
  let writing = null;
  let pending = false;
  let loaded = false;

  async function load() {
    try {
      const raw = await readFile(file, 'utf8');
      const parsed = JSON.parse(raw);
      data = { ...structuredClone(defaults), ...parsed };
      loaded = true;
      return { ok: true };
    } catch (err) {
      loaded = true;
      if (err.code === 'ENOENT') return { ok: true, fresh: true };
      // JSON roto: se conserva por si el usuario quiere rescatarlo a mano.
      const backup = `${file}.corrupto`;
      await rename(file, backup).catch(() => {});
      return { ok: false, error: err.message, backup };
    }
  }

  async function writeNow() {
    await mkdir(dir, { recursive: true });
    await writeFile(tmp, JSON.stringify(data), 'utf8');
    await rename(tmp, file);
  }

  async function drain() {
    while (pending) {
      pending = false;
      await writeNow();
    }
    writing = null;
  }

  function save() {
    pending = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (!writing) writing = drain();
    }, debounceMs);
  }

  /** Vuelca lo pendiente antes de cerrar. Se llama al salir de la aplicación. */
  async function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!pending && !writing) return;
    if (!writing) writing = drain();
    await writing;
  }

  /**
   * Último recurso: `before-quit` no siempre concede tiempo a una promesa, así
   * que el cierre duro escribe de forma síncrona.
   */
  function flushSync() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!pending) return;
    pending = false;
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(tmp, JSON.stringify(data), 'utf8');
      renameSync(tmp, file);
    } catch {
      /* si el disco no deja escribir al cerrar, no hay nada mejor que hacer */
    }
  }

  return {
    file,
    get isLoaded() {
      return loaded;
    },
    load,
    get data() {
      return data;
    },
    /** Muta el estado y programa el guardado. */
    update(fn) {
      const result = fn(data);
      save();
      return result;
    },
    save,
    flush,
    flushSync,
    async destroy() {
      await rm(file, { force: true });
    },
  };
}

/** Utilidad de depuración: exporta el estado a un archivo elegido por el usuario. */
export async function exportJson(targetPath, value) {
  await new Promise((resolve, reject) => {
    const stream = createWriteStream(targetPath, 'utf8');
    stream.on('error', reject);
    stream.on('finish', resolve);
    stream.end(JSON.stringify(value, null, 2));
  });
}
