/** La cola de reproducción, como funciones puras. Todo el estado lo guarda quien llama. */

/** Fisher-Yates con generador inyectable: en los tests el azar deja de serlo. */
export function shuffle(items, rng = Math.random) {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Construye la cola a partir de la lista visible. `source` conserva el orden
 * original para poder volver de aleatorio a secuencial sin perder el sitio.
 */
export function createQueue(ids, { startId = null, shuffled = false, rng = Math.random } = {}) {
  const source = ids.slice();
  let order;
  if (shuffled) {
    const rest = shuffle(source.filter((id) => id !== startId), rng);
    order = startId && source.includes(startId) ? [startId, ...rest] : rest;
  } else {
    order = source.slice();
  }
  const index = startId ? order.indexOf(startId) : 0;
  return { source, order, index: index === -1 ? 0 : index, manual: [] };
}

/** Recoloca la cola al cambiar el aleatorio, dejando donde está lo que ya suena. */
export function reshuffle(queue, currentId, { shuffled, rng = Math.random }) {
  const next = createQueue(queue.source, { startId: currentId, shuffled, rng });
  next.manual = queue.manual.slice();
  return next;
}

/** «Reproducir a continuación»: se cuela justo detrás de lo que suena. */
export function enqueueNext(queue, ids) {
  return { ...queue, manual: [...ids, ...queue.manual] };
}

/** «Añadir a la cola»: al final de lo insertado a mano. */
export function enqueueLast(queue, ids) {
  return { ...queue, manual: [...queue.manual, ...ids] };
}

/** Quita una entrada del tramo manual de la cola por su posición. */
export function dropManual(queue, position) {
  const manual = queue.manual.slice();
  manual.splice(position, 1);
  return { ...queue, manual };
}

/**
 * Qué suena después. `auto` distingue el final natural de la canción —donde
 * «repetir una» tiene sentido— del botón de siguiente, que siempre avanza.
 */
export function advance(queue, { repeat = 'off', auto = false } = {}) {
  if (auto && repeat === 'one') {
    return { queue, id: queue.order[queue.index] ?? null, restart: true };
  }
  if (queue.manual.length) {
    const [id, ...rest] = queue.manual;
    return { queue: { ...queue, manual: rest }, id, restart: false, fromManual: true };
  }
  const next = queue.index + 1;
  if (next < queue.order.length) {
    return { queue: { ...queue, index: next }, id: queue.order[next], restart: false };
  }
  if ((repeat === 'all' || !auto) && queue.order.length) {
    return { queue: { ...queue, index: 0 }, id: queue.order[0], restart: false, wrapped: true };
  }
  return { queue, id: null, restart: false, ended: true };
}

/** Anterior. Por debajo de `restartBefore` segundos salta; por encima, rebobina. */
export function retreat(queue, currentTime, restartBefore = 3) {
  if (currentTime > restartBefore || queue.index <= 0) return { queue, id: null, restart: true };
  const index = queue.index - 1;
  return { queue: { ...queue, index }, id: queue.order[index], restart: false };
}

/** Al borrar canciones de la biblioteca hay que sacarlas también de la cola. */
export function withoutIds(queue, ids) {
  const gone = new Set(ids);
  const currentId = queue.order[queue.index];
  const order = queue.order.filter((id) => !gone.has(id));
  const index = gone.has(currentId)
    ? Math.min(queue.index, Math.max(0, order.length - 1))
    : order.indexOf(currentId);
  return {
    source: queue.source.filter((id) => !gone.has(id)),
    order,
    index: index === -1 ? 0 : index,
    manual: queue.manual.filter((id) => !gone.has(id)),
  };
}
