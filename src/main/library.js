import { createHash } from 'node:crypto';
import { readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isAudioPath, isIgnoredEntry } from '../shared/audio-files.js';
import { readTags } from './metadata.js';
import * as escritorPorDefecto from './tag-writer.js';

export const LIBRARY_DEFAULTS = { version: 1, folders: [], tracks: {}, playlists: [] };

/** El identificador es la ruta: reanalizar la carpeta no rompe las listas. */
export function trackIdFor(filePath) {
  return createHash('sha1').update(path.resolve(filePath)).digest('hex').slice(0, 16);
}

function newId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Recorre una carpeta entera sin recursión ciega: sin enlaces circulares y con tope de profundidad. */
export async function* walkAudio(root, { maxDepth = 24, shouldStop = () => false } = {}) {
  const seen = new Set();
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length) {
    if (shouldStop()) return;
    const { dir, depth } = stack.pop();
    let real;
    try {
      real = await realpath(dir);
    } catch {
      continue;
    }
    if (seen.has(real)) continue;
    seen.add(real);

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (isIgnoredEntry(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < maxDepth) stack.push({ dir: full, depth: depth + 1 });
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        if (isAudioPath(full)) yield full;
      }
    }
  }
}

/** Ejecuta `worker` sobre la lista con un tope de tareas a la vez. */
async function pool(items, limit, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

/**
 * La biblioteca: qué canciones hay, dónde viven y en qué listas están.
 *
 * A diferencia de la versión web, aquí los archivos NO se copian a ningún sitio.
 * La aplicación guarda rutas y etiquetas; la música sigue siendo del disco del
 * usuario, con su estructura de carpetas intacta.
 */
export function createLibrary({ store, covers, escritor = escritorPorDefecto, onProgress = () => {} }) {
  let scanning = false;
  let stopRequested = false;

  const data = () => store.data;
  const tracks = () => store.data.tracks;

  function listTracks() {
    return Object.values(tracks());
  }

  function report(phase, payload) {
    onProgress({ phase, ...payload });
  }

  async function buildTrack(filePath, stats, folder, previous) {
    const { meta, picture, ok } = await readTags(filePath);
    let coverId = null;
    if (picture?.data?.length) coverId = await covers.store(Buffer.from(picture.data));
    if (!coverId) coverId = await covers.fromFolder(path.dirname(filePath));
    return {
      ...meta,
      // Un análisis ya hecho no se tira al releer el archivo: cuesta segundos.
      bpm: meta.bpm || previous?.bpm || 0,
      key: meta.key || previous?.key || '',
      tonalidad: previous?.tonalidad || '',
      rejilla: previous?.rejilla ?? null,
      analisis: previous?.analisis ?? null,
      // Lo que el usuario corrigió a mano gana a lo que diga la etiqueta, y
      // sigue ganando después de volver a leer el archivo.
      ...(previous?.edits ?? {}),
      edits: previous?.edits ?? null,
      // Lo que el usuario ha construido con el tiempo sobrevive a un reanálisis.
      id: trackIdFor(filePath),
      path: filePath,
      folder,
      size: stats.size,
      mtimeMs: Math.round(stats.mtimeMs),
      coverId,
      unreadable: !ok,
      missing: false,
      addedAt: previous?.addedAt ?? Date.now(),
      playCount: previous?.playCount ?? 0,
      lastPlayedAt: previous?.lastPlayedAt ?? 0,
      favorite: previous?.favorite ?? false,
      // Una duración medida por el reproductor es más fiable que la etiqueta.
      duration: meta.duration || previous?.duration || 0,
    };
  }

  /**
   * Analiza rutas de carpeta. Solo lee etiquetas de lo que ha cambiado de
   * tamaño o de fecha: la segunda pasada sobre 20.000 canciones es casi instantánea.
   */
  async function scan(folderPaths, { full = false } = {}) {
    if (scanning) return { busy: true };
    scanning = true;
    stopRequested = false;
    const summary = { added: 0, updated: 0, missing: 0, unchanged: 0, unavailable: [], scanned: 0 };

    try {
      for (const folder of folderPaths) {
        let rootStat;
        try {
          rootStat = await stat(folder);
        } catch {
          rootStat = null;
        }
        if (!rootStat?.isDirectory()) {
          // Disco externo desconectado: no se marca nada como ausente.
          summary.unavailable.push(folder);
          continue;
        }

        report('buscando', { folder, found: 0 });
        const files = [];
        for await (const file of walkAudio(folder, { shouldStop: () => stopRequested })) {
          files.push(file);
          if (files.length % 200 === 0) report('buscando', { folder, found: files.length });
        }
        if (stopRequested) break;

        const onDisk = new Set(files.map((f) => trackIdFor(f)));
        let done = 0;
        await pool(files, 4, async (file) => {
          if (stopRequested) return;
          const id = trackIdFor(file);
          const previous = tracks()[id];
          try {
            const stats = await stat(file);
            const unchanged = previous &&
              !full &&
              previous.size === stats.size &&
              previous.mtimeMs === Math.round(stats.mtimeMs) &&
              !previous.missing;
            if (unchanged) {
              summary.unchanged += 1;
            } else {
              const track = await buildTrack(file, stats, folder, previous);
              store.update((d) => {
                d.tracks[id] = track;
              });
              if (previous) summary.updated += 1;
              else summary.added += 1;
            }
          } catch {
            /* el archivo se ha movido mientras se analizaba */
          }
          done += 1;
          summary.scanned += 1;
          if (done % 10 === 0 || done === files.length) {
            report('leyendo', { folder, done, total: files.length });
          }
        });

        // Lo que ya no está en la carpeta se marca, no se borra: puede volver.
        store.update((d) => {
          for (const track of Object.values(d.tracks)) {
            if (track.folder !== folder) continue;
            const gone = !onDisk.has(track.id);
            if (gone && !track.missing) summary.missing += 1;
            if (gone !== Boolean(track.missing)) track.missing = gone;
          }
        });
      }
    } finally {
      scanning = false;
      covers.resetFolderCache();
      report('fin', summary);
    }
    return summary;
  }

  async function addFolders(folderPaths) {
    const now = Date.now();
    store.update((d) => {
      for (const folder of folderPaths) {
        if (!d.folders.some((f) => f.path === folder)) d.folders.push({ path: folder, addedAt: now });
      }
    });
    return scan(folderPaths);
  }

  /** Archivos sueltos: entran sin carpeta asociada, así ningún reanálisis los borra. */
  async function addFiles(filePaths) {
    const audio = filePaths.filter((f) => isAudioPath(f));
    let added = 0;
    let done = 0;
    await pool(audio, 4, async (file) => {
      try {
        const stats = await stat(file);
        if (!stats.isFile()) return;
        const id = trackIdFor(file);
        const previous = tracks()[id];
        const track = await buildTrack(file, stats, previous?.folder ?? null, previous);
        store.update((d) => {
          d.tracks[id] = track;
        });
        if (!previous) added += 1;
      } catch {
        /* ignorado */
      }
      done += 1;
      report('leyendo', { done, total: audio.length });
    });
    report('fin', { added, scanned: audio.length });
    return { added, scanned: audio.length };
  }

  function removeFolder(folderPath, { keepTracks = false } = {}) {
    store.update((d) => {
      d.folders = d.folders.filter((f) => f.path !== folderPath);
      if (keepTracks) return;
      const gone = [];
      for (const track of Object.values(d.tracks)) {
        if (track.folder === folderPath) gone.push(track.id);
      }
      for (const id of gone) delete d.tracks[id];
      for (const playlist of d.playlists) {
        playlist.trackIds = playlist.trackIds.filter((id) => !gone.includes(id));
      }
    });
  }

  function removeTracks(ids) {
    const gone = new Set(ids);
    store.update((d) => {
      for (const id of gone) delete d.tracks[id];
      for (const playlist of d.playlists) {
        playlist.trackIds = playlist.trackIds.filter((id) => !gone.has(id));
      }
    });
  }

  function removeMissing() {
    const ids = listTracks().filter((t) => t.missing).map((t) => t.id);
    removeTracks(ids);
    return ids;
  }

  function patchTrack(id, patch) {
    return store.update((d) => {
      const track = d.tracks[id];
      if (!track) return null;
      Object.assign(track, patch);
      return track;
    });
  }

  /**
   * Campos que el usuario puede corregir. Las etiquetas de media internet están
   * mal escritas y Pletina no reescribe los archivos —esa es su promesa—, así
   * que la corrección vive en la biblioteca y se aplica encima de lo leído.
   */
  const CAMPOS_EDITABLES = ['title', 'artist', 'albumArtist', 'album', 'genre', 'year', 'trackNo', 'discNo'];
  const NUMERICOS = new Set(['year', 'trackNo', 'discNo']);
  // Un título o un artista en blanco dejarían la fila sin nada que enseñar.
  const NO_VACIABLES = new Set(['title', 'artist']);

  function limpiarEdicion(patch = {}) {
    const limpio = {};
    for (const campo of CAMPOS_EDITABLES) {
      if (!(campo in patch)) continue;
      if (NUMERICOS.has(campo)) {
        const numero = Number.parseInt(patch[campo], 10);
        limpio[campo] = Number.isFinite(numero) && numero > 0 ? numero : 0;
        continue;
      }
      const texto = String(patch[campo] ?? '').trim().slice(0, 300);
      if (!texto && NO_VACIABLES.has(campo)) continue;
      limpio[campo] = texto;
    }
    return limpio;
  }

  function editTracks(ids, patch) {
    const cambios = limpiarEdicion(patch);
    if (!Object.keys(cambios).length) return { edited: 0, campos: [] };
    let edited = 0;
    store.update((d) => {
      for (const id of ids) {
        const track = d.tracks[id];
        if (!track) continue;
        track.edits = { ...(track.edits ?? {}), ...cambios };
        Object.assign(track, cambios);
        edited += 1;
      }
    });
    return { edited, campos: Object.keys(cambios) };
  }

  /**
   * Baja al archivo lo que Pletina tiene guardado. Es lo contrario de la
   * corrección normal: aquí sí se toca la música del usuario, y por eso solo
   * ocurre cuando se pide y en los formatos que se saben escribir bien.
   *
   * Al conseguirlo se olvida la corrección: la verdad ya está en el archivo, y
   * dejar el apaño encima solo serviría para que un día se pisaran.
   */
  async function escribirEnArchivos(ids) {
    const hechos = [];
    const fallidos = [];
    const noSoportados = [];
    for (const id of ids) {
      const track = tracks()[id];
      if (!track) continue;
      if (!escritor.puedeEscribir(track.path)) {
        noSoportados.push({ id, title: track.title, motivo: escritor.motivoNoEscribible(track.path) });
        continue;
      }
      let caratula = null;
      if (track.coverId) {
        caratula = await readFile(covers.pathFor(track.coverId))
          .then((buffer) => ({ buffer, mime: 'image/jpeg' }))
          .catch(() => null);
      }
      const resultado = await escritor.escribirEtiquetas(track.path, track, { caratula });
      if (!resultado.ok) {
        fallidos.push({ id, title: track.title, error: resultado.error });
        continue;
      }
      hechos.push({ id, title: track.title, aviso: resultado.aviso, copia: resultado.copia });
      // El archivo acaba de cambiar: se apunta su nuevo estado para que el
      // próximo análisis no lo relea sin motivo, y se retira la corrección.
      try {
        const stats = await stat(track.path);
        store.update((d) => {
          if (!d.tracks[id]) return;
          d.tracks[id].size = stats.size;
          d.tracks[id].mtimeMs = Math.round(stats.mtimeMs);
          d.tracks[id].edits = null;
        });
      } catch {
        /* si no se puede consultar, el reanálisis lo pondrá al día */
      }
    }
    return { hechos, fallidos, noSoportados };
  }

  /**
   * Guarda el resultado del análisis. Se apunta también la confianza: un tempo
   * dudoso vale para ordenar, pero no para mezclar a ciegas.
   */
  function setAnalysis(id, datos = {}) {
    return store.update((d) => {
      const track = d.tracks[id];
      if (!track) return null;
      const bpm = Number(datos.bpm);
      track.bpm = Number.isFinite(bpm) && bpm > 0 ? Math.round(bpm * 10) / 10 : 0;
      track.key = typeof datos.key === 'string' ? datos.key.slice(0, 8) : '';
      track.tonalidad = typeof datos.tonalidad === 'string' ? datos.tonalidad.slice(0, 24) : '';
      // La rejilla es lo que permite pinchar en el compás: sin ella el
      // mezclador sabe a qué velocidad ir, pero no cuándo entrar.
      const rejilla = datos.rejilla ?? null;
      track.rejilla = rejilla && Number(rejilla.bpm) > 0 ? {
        bpm: Math.round(Number(rejilla.bpm) * 10) / 10,
        offset: Math.max(0, Number(rejilla.offset) || 0),
        tiempoFuerte: Math.min(7, Math.max(0, Math.round(Number(rejilla.tiempoFuerte) || 0))),
        fuerza: Number(rejilla.fuerza) || 0,
        porBombo: Boolean(rejilla.porBombo),
        tiemposPorCompas: Math.min(8, Math.max(2, Math.round(Number(rejilla.tiemposPorCompas) || 4))),
      } : null;
      track.analisis = {
        bpmConfianza: Number(datos.bpmConfianza) || 0,
        keyConfianza: Number(datos.keyConfianza) || 0,
        en: Date.now(),
      };
      return track;
    });
  }

  /** Pone una imagen como carátula. Vive en la caché; al archivo solo si se pide. */
  async function setCover(ids, imagePath) {
    const buffer = await readFile(imagePath);
    const coverId = await covers.store(buffer);
    if (!coverId) throw new Error('no he podido leer esa imagen');
    store.update((d) => {
      for (const id of ids) {
        if (d.tracks[id]) d.tracks[id].coverId = coverId;
      }
    });
    return { coverId, changed: ids.length };
  }

  function clearCover(ids) {
    let changed = 0;
    store.update((d) => {
      for (const id of ids) {
        if (!d.tracks[id]) continue;
        d.tracks[id].coverId = null;
        changed += 1;
      }
    });
    return { changed };
  }

  /**
   * Deshace las correcciones y vuelve a leer las etiquetas del archivo.
   *
   * Si el archivo no se puede leer —disco desconectado— la corrección se
   * conserva: quitarla dejaría el nombre inventado y sin manera de recuperar el
   * de verdad.
   */
  async function restoreTags(ids) {
    let restored = 0;
    let unavailable = 0;
    for (const id of ids) {
      const track = tracks()[id];
      if (!track?.edits) continue;
      try {
        const stats = await stat(track.path);
        const fresco = await buildTrack(track.path, stats, track.folder, { ...track, edits: null });
        store.update((d) => {
          d.tracks[id] = fresco;
        });
        restored += 1;
      } catch {
        unavailable += 1;
      }
    }
    return { restored, unavailable };
  }

  /** Marcar cien canciones no son cien viajes al proceso principal. */
  function setFavorite(ids, favorite) {
    let changed = 0;
    store.update((d) => {
      for (const id of ids) {
        if (!d.tracks[id]) continue;
        d.tracks[id].favorite = Boolean(favorite);
        changed += 1;
      }
    });
    return { changed, favorite: Boolean(favorite) };
  }

  function registerPlay(id) {
    return patchTrack(id, {
      playCount: (tracks()[id]?.playCount ?? 0) + 1,
      lastPlayedAt: Date.now(),
    });
  }

  /* ---------- listas ---------- */

  function playlistById(id) {
    return data().playlists.find((p) => p.id === id) ?? null;
  }

  function createPlaylist(name, trackIds = []) {
    const playlist = {
      id: newId(),
      name: String(name).slice(0, 120),
      trackIds: [...new Set(trackIds)],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    store.update((d) => {
      d.playlists.push(playlist);
    });
    return playlist;
  }

  function updatePlaylist(id, patch) {
    return store.update((d) => {
      const playlist = d.playlists.find((p) => p.id === id);
      if (!playlist) return null;
      Object.assign(playlist, patch, { updatedAt: Date.now() });
      return playlist;
    });
  }

  function addToPlaylist(id, trackIds) {
    return store.update((d) => {
      const playlist = d.playlists.find((p) => p.id === id);
      if (!playlist) return null;
      const known = new Set(playlist.trackIds);
      const fresh = trackIds.filter((tid) => !known.has(tid) && d.tracks[tid]);
      playlist.trackIds.push(...fresh);
      playlist.updatedAt = Date.now();
      return { playlist, added: fresh.length, skipped: trackIds.length - fresh.length };
    });
  }

  function deletePlaylist(id) {
    store.update((d) => {
      d.playlists = d.playlists.filter((p) => p.id !== id);
    });
  }

  function reorderPlaylists(orderedIds) {
    store.update((d) => {
      const byId = new Map(d.playlists.map((p) => [p.id, p]));
      const next = orderedIds.map((id) => byId.get(id)).filter(Boolean);
      for (const playlist of d.playlists) if (!orderedIds.includes(playlist.id)) next.push(playlist);
      d.playlists = next;
    });
  }

  /* ---------- M3U ---------- */

  /** Exporta con rutas relativas al destino: la lista sigue valiendo si se mueve la carpeta. */
  function toM3U(playlistId, targetPath) {
    const playlist = playlistById(playlistId);
    if (!playlist) return null;
    const dir = path.dirname(targetPath);
    const lines = ['#EXTM3U'];
    for (const id of playlist.trackIds) {
      const track = tracks()[id];
      if (!track) continue;
      lines.push(`#EXTINF:${Math.round(track.duration || 0)},${track.artist} - ${track.title}`);
      lines.push(path.relative(dir, track.path).split(path.sep).join('/'));
    }
    return `${lines.join('\n')}\n`;
  }

  async function exportPlaylist(playlistId, targetPath) {
    const content = toM3U(playlistId, targetPath);
    if (content == null) return { ok: false };
    await writeFile(targetPath, content, 'utf8');
    return { ok: true, path: targetPath };
  }

  /** Importa un `.m3u`/`.m3u8` y da de alta las canciones que aún no estuvieran. */
  async function importPlaylist(filePath) {
    const raw = await readFile(filePath, 'utf8');
    const dir = path.dirname(filePath);
    const entries = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .filter((line) => !/^[a-z][a-z0-9+.-]*:\/\//i.test(line))
      .map((line) => path.resolve(dir, line.split('/').join(path.sep)))
      .filter((candidate) => isAudioPath(candidate));

    const existing = [];
    const unknown = [];
    for (const candidate of entries) {
      const id = trackIdFor(candidate);
      if (tracks()[id]) existing.push(id);
      else unknown.push(candidate);
    }
    if (unknown.length) await addFiles(unknown);

    const ids = entries.map((candidate) => trackIdFor(candidate)).filter((id) => tracks()[id]);
    const name = path.basename(filePath).replace(/\.[^.]+$/, '') || 'Lista importada';
    const playlist = createPlaylist(name, ids);
    return { playlist, imported: ids.length, missing: entries.length - ids.length, discovered: unknown.length, existing: existing.length };
  }

  return {
    listTracks,
    getTrack: (id) => tracks()[id] ?? null,
    snapshot: () => ({
      folders: data().folders,
      tracks: listTracks(),
      playlists: data().playlists,
    }),
    scan,
    rescan: (options) => scan(data().folders.map((f) => f.path), options),
    stopScan: () => {
      stopRequested = true;
    },
    get isScanning() {
      return scanning;
    },
    addFolders,
    addFiles,
    removeFolder,
    removeTracks,
    removeMissing,
    patchTrack,
    editTracks,
    setAnalysis,
    escribirEnArchivos,
    setCover,
    clearCover,
    restoreTags,
    setFavorite,
    registerPlay,
    playlistById,
    createPlaylist,
    updatePlaylist,
    addToPlaylist,
    deletePlaylist,
    reorderPlaylists,
    toM3U,
    exportPlaylist,
    importPlaylist,
  };
}
