/** Qué cuenta como audio y con qué tipo MIME se sirve. Compartido por escáner y protocolo. */

export const AUDIO_EXTENSIONS = [
  '.mp3', '.m4a', '.m4b', '.mp4', '.aac', '.flac', '.ogg', '.oga', '.opus',
  '.wav', '.wave', '.wma', '.aif', '.aiff', '.aifc', '.caf', '.ape', '.wv', '.mpc',
];

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
