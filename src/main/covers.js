import { createHash } from 'node:crypto';
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { nativeImage } from 'electron';
import { COVER_FILENAMES } from '../shared/audio-files.js';

const MAX_EDGE = 640;

/**
 * Caché de carátulas en disco.
 *
 * Se guardan por hash del contenido, así que un álbum de veinte canciones con la
 * misma portada incrustada ocupa una sola imagen. Y se reescalan: una portada de
 * 3.000 px repetida por toda la biblioteca son cientos de megas para nada.
 */
export function createCoverCache(coversDir) {
  const known = new Set();
  const folderCache = new Map();

  async function ensureDir() {
    await mkdir(coversDir, { recursive: true });
  }

  async function store(buffer) {
    if (!buffer || !buffer.length) return null;
    const hash = createHash('sha1').update(buffer).digest('hex').slice(0, 20);
    const id = `${hash}.jpg`;
    const target = path.join(coversDir, id);
    if (known.has(id)) return id;
    try {
      await access(target);
      known.add(id);
      return id;
    } catch {
      /* aún no está en caché */
    }
    await ensureDir();
    let output = Buffer.from(buffer);
    try {
      let image = nativeImage.createFromBuffer(output);
      if (image.isEmpty()) return null;
      const { width, height } = image.getSize();
      if (Math.max(width, height) > MAX_EDGE) {
        image = image.resize(
          width >= height ? { width: MAX_EDGE, quality: 'good' } : { height: MAX_EDGE, quality: 'good' },
        );
      }
      output = image.toJPEG(86);
    } catch {
      // Un formato que Chromium no sabe decodificar se guarda tal cual.
    }
    await writeFile(target, output);
    known.add(id);
    return id;
  }

  /** Portada suelta junto al disco (`cover.jpg`, `folder.jpg`…), memorizada por carpeta. */
  async function fromFolder(dir) {
    if (folderCache.has(dir)) return folderCache.get(dir);
    let result = null;
    try {
      const entries = await readdir(dir);
      const lower = new Map(entries.map((e) => [e.toLowerCase(), e]));
      for (const candidate of COVER_FILENAMES) {
        const real = lower.get(candidate);
        if (!real) continue;
        const buffer = await readFile(path.join(dir, real));
        result = await store(buffer);
        break;
      }
    } catch {
      result = null;
    }
    folderCache.set(dir, result);
    return result;
  }

  return {
    dir: coversDir,
    store,
    fromFolder,
    pathFor: (id) => path.join(coversDir, path.basename(String(id))),
    resetFolderCache: () => folderCache.clear(),
  };
}
