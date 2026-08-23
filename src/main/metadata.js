import { parseFile } from 'music-metadata';
import { extname } from '../shared/audio-files.js';

/**
 * Cuando el archivo no trae etiquetas, el nombre suele ser la mejor pista:
 * «03 - Pixies - Where Is My Mind.mp3».
 */
export function guessFromFilename(filename) {
  const base = String(filename)
    .replace(/\.[^.]+$/, '')
    .replace(/_/g, ' ')
    .trim();
  const withoutIndex = base.replace(/^\s*\d{1,3}\s*[-.)]\s*/, '');
  const parts = withoutIndex.split(' - ');
  if (parts.length > 1) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  }
  return { artist: '', title: withoutIndex || base };
}

/** ReplayGain llega como `{ dB }`, como ratio o como texto según el formato. */
export function toDecibels(gain) {
  if (gain == null) return null;
  if (typeof gain === 'number') return Number.isFinite(gain) ? gain : null;
  if (typeof gain === 'object' && Number.isFinite(gain.dB)) return gain.dB;
  if (typeof gain === 'object' && Number.isFinite(gain.ratio)) return 10 * Math.log10(gain.ratio);
  const parsed = Number.parseFloat(String(gain));
  return Number.isFinite(parsed) ? parsed : null;
}

const trimmed = (value, max = 300) => {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : '';
};

/** Etiquetas de music-metadata → la ficha que guarda la biblioteca. */
export function mapMetadata({ common = {}, format = {} }, filePath) {
  const filename = String(filePath).replace(/\\/g, '/').split('/').pop() || '';
  const guess = guessFromFilename(filename);
  const year = common.year || Number.parseInt(String(common.date || '').slice(0, 4), 10) || 0;
  return {
    title: trimmed(common.title) || guess.title || filename,
    artist: trimmed(common.artist) || trimmed((common.artists || [])[0]) || guess.artist || 'Sin artista',
    albumArtist: trimmed(common.albumartist) || trimmed(common.artist) || guess.artist || '',
    album: trimmed(common.album),
    genre: trimmed((common.genre || [])[0], 80),
    year: Number.isFinite(year) && year > 0 && year < 3000 ? year : 0,
    trackNo: Number(common.track?.no) || 0,
    discNo: Number(common.disk?.no) || 0,
    duration: Number.isFinite(format.duration) ? Math.round(format.duration * 1000) / 1000 : 0,
    bitrate: Number.isFinite(format.bitrate) ? Math.round(format.bitrate) : 0,
    sampleRate: Number(format.sampleRate) || 0,
    channels: Number(format.numberOfChannels) || 0,
    lossless: Boolean(format.lossless),
    codec: trimmed(format.codec || format.container, 40),
    gainDb: toDecibels(common.replaygain_track_gain),
  };
}

/** Ficha mínima cuando el archivo no se deja leer: mejor eso que perder la canción. */
export function bareMetadata(filePath) {
  const filename = String(filePath).replace(/\\/g, '/').split('/').pop() || '';
  const guess = guessFromFilename(filename);
  return {
    title: guess.title || filename,
    artist: guess.artist || 'Sin artista',
    albumArtist: guess.artist || '',
    album: '',
    genre: '',
    year: 0,
    trackNo: 0,
    discNo: 0,
    duration: 0,
    bitrate: 0,
    sampleRate: 0,
    channels: 0,
    lossless: extname(filePath) === '.flac' || extname(filePath) === '.wav',
    codec: extname(filePath).replace('.', '').toUpperCase(),
    gainDb: null,
  };
}

/**
 * Lee etiquetas y carátula de un archivo. Nunca lanza: una canción con
 * etiquetas rotas entra en la biblioteca con lo que se pueda deducir del nombre.
 */
export async function readTags(filePath, { skipCovers = false } = {}) {
  try {
    const parsed = await parseFile(filePath, { duration: false, skipCovers });
    const picture = (parsed.common?.picture || [])[0] || null;
    return { meta: mapMetadata(parsed, filePath), picture, ok: true };
  } catch (err) {
    return { meta: bareMetadata(filePath), picture: null, ok: false, error: err.message };
  }
}
