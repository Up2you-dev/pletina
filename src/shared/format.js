/** Formateo de duraciones, tamaños y plurales. Sin estado: se prueba en test/format.test.js. */

/** Segundos → `m:ss` (o `h:mm:ss` a partir de la hora). */
export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Segundos → duración larga en castellano: «2 h 14 min». */
export function formatTotal(seconds) {
  const s = Math.round(Math.max(0, Number.isFinite(seconds) ? seconds : 0));
  if (s < 60) return `${s} s`;
  const totalMin = Math.round(s / 60);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** `plural(1, 'canción', 'canciones')` → «1 canción». */
export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Ficha técnica corta: «FLAC · 44,1 kHz · 1024 kbps · 128 bpm · Am».
 * El tempo y la tonalidad solo aparecen cuando se han analizado.
 */
/**
 * Un tempo como se dice: redondo, sin decimales de adorno.
 *
 * La rejilla guarda tres decimales porque los necesita para no irse en seis
 * minutos, pero «127,996 bpm» no es un dato para leer de un vistazo en una
 * lista: es ruido. En pantalla, 128.
 */
export const formatTempo = (bpm) => (Number(bpm) > 0 ? String(Math.round(Number(bpm))) : '');

/**
 * Un porcentaje como se escribe en castellano: coma decimal, sin ceros de
 * adorno y con el signo cuando suma. «+1,6 %», «-5 %», «0 %».
 */
export function formatPorcentaje(valor) {
  const redondeado = Math.round(valor * 10) / 10;
  return `${redondeado > 0 ? '+' : ''}${String(redondeado).replace('.', ',')} %`;
}

export function formatQuality(track, { velocidad = 1 } = {}) {
  const parts = [];
  if (track.codec) parts.push(String(track.codec).toUpperCase());
  if (track.sampleRate) parts.push(`${String(track.sampleRate / 1000).replace('.', ',')} kHz`);
  if (track.bitrate) parts.push(`${Math.round(track.bitrate / 1000)} kbps`);
  // Con el tempo ajustado, el bpm que se enseña es el que suena, no el del
  // archivo: si el mezclador ha estirado la canción, decir otra cosa es mentir.
  if (track.bpm) parts.push(`${Math.round(track.bpm * velocidad)} bpm`);
  if (track.key) parts.push(track.key);
  const ajuste = Math.round((velocidad - 1) * 1000) / 10;
  if (ajuste) parts.push(formatPorcentaje(ajuste));
  return parts.join(' · ');
}

/** Fecha → «hoy», «ayer», «hace 3 días» o fecha corta. Base inyectable para poder probarla. */
export function formatWhen(timestamp, now = Date.now()) {
  if (!timestamp) return '—';
  const day = 86400000;
  const startOf = (t) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const days = Math.round((startOf(now) - startOf(timestamp)) / day);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 30) return `hace ${days} días`;
  return new Date(timestamp).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}
