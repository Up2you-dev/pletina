/** Qué cuenta como audio y con qué tipo MIME se sirve. Compartido por escáner y protocolo. */

export const AUDIO_EXTENSIONS = [
  '.mp3', '.m4a', '.m4b', '.mp4', '.aac', '.flac', '.ogg', '.oga', '.opus',
  '.wav', '.wave', '.wma', '.aif', '.aiff', '.aifc', '.caf', '.ape', '.wv', '.mpc',
];

/**
 * Lo que este programa sabe SONAR, que no es lo mismo que lo que sabe leer.
 *
 * Las etiquetas y la carátula se leen de casi cualquier formato; el audio lo
 * decodifica Chromium, y Chromium no trae ni AIFF, ni WMA, ni ALAC, ni APE, ni
 * WavPack, ni Musepack. Preguntado directamente a este Electron con
 * `canPlayType`, esos siete contestan «no».
 *
 * La distinción importa porque sin ella esas canciones entraban en la
 * biblioteca, salían en la cabina como «sin analizar · pulsa Analizar», y por
 * mucho que se pulsara no había manera: la decodificación fallaba en silencio,
 * el contador de pendientes no bajaba nunca y en ningún sitio se nombraba la
 * causa. El usuario concluía, con razón, que la rejilla estaba rota.
 */
const REPRODUCIBLES = new Set([
  '.mp3', '.m4a', '.m4b', '.mp4', '.aac', '.flac', '.ogg', '.oga', '.opus', '.wav', '.wave',
]);

/** Códecs que van dentro de un contenedor que sí se reproduce, pero no suenan. */
const CODECS_MUDOS = new Set(['alac', 'ape', 'wavpack', 'musepack', 'dsd', 'dsf']);

/**
 * ¿Puede este equipo decodificar esta canción?
 *
 * Por extensión y, cuando hace falta, por códec: un `.m4a` puede traer AAC (que
 * suena) o ALAC (que no), y por fuera son idénticos.
 */
export function esReproducible({ path: ruta = '', codec = '' } = {}) {
  const punto = String(ruta).lastIndexOf('.');
  const extension = punto < 0 ? '' : String(ruta).slice(punto).toLowerCase();
  if (!REPRODUCIBLES.has(extension)) return false;
  const nombre = String(codec).toLowerCase();
  return ![...CODECS_MUDOS].some((mudo) => nombre.includes(mudo));
}

/** Y cómo se llama el formato, para poder decirlo. */
export function nombreDeFormato({ path: ruta = '', codec = '' } = {}) {
  if (codec) return String(codec).toUpperCase();
  const punto = String(ruta).lastIndexOf('.');
  return punto < 0 ? 'este formato' : String(ruta).slice(punto + 1).toUpperCase();
}

const MIME = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.m4b': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.wave': 'audio/wav',
  '.wma': 'audio/x-ms-wma',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
  '.aifc': 'audio/aiff',
  '.caf': 'audio/x-caf',
  '.ape': 'audio/x-ape',
  '.wv': 'audio/x-wavpack',
  '.mpc': 'audio/x-musepack',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/** Extensión en minúsculas, con punto. `''` si no tiene. */
export function extname(filePath) {
  const name = String(filePath).replace(/\\/g, '/').split('/').pop() || '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

export function isAudioPath(filePath) {
  return AUDIO_EXTENSIONS.includes(extname(filePath));
}

export function contentTypeFor(filePath) {
  return MIME[extname(filePath)] || 'application/octet-stream';
}

/** Carátulas sueltas junto al disco, en el orden en que se prefieren. */
export const COVER_FILENAMES = [
  'cover.jpg', 'cover.jpeg', 'cover.png', 'folder.jpg', 'folder.jpeg', 'folder.png',
  'front.jpg', 'front.jpeg', 'front.png', 'album.jpg', 'album.png', 'caratula.jpg',
];

/** Archivos y carpetas que el escáner nunca mira. */
export function isIgnoredEntry(name) {
  return name.startsWith('.') || name === 'node_modules' || name === '$RECYCLE.BIN' ||
    name === 'System Volume Information';
}
