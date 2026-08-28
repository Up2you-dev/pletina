import { $, esc } from './dom.js';
import { ICO } from './icons.js';
import { formatTempo, formatTime, plural } from '../../shared/format.js';
import { getTrack, state } from '../state.js';

let actions = {};

export function bindQueue(handlers) {
  actions = handlers;
  const panel = $('#queue-panel');
  // Arrastrar desde la cola: en la cabina no se ve la biblioteca, así que la
  // cola es de donde se sacan las canciones para el plato B. Viaja el mismo
  // formato que usa la biblioteca, para que quien las recoja no distinga.
  panel.addEventListener('dragstart', (event) => {
    const item = event.target.closest('.q-item[data-id]');
    if (!item) return;
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-pletina-tracks', JSON.stringify([item.dataset.id]));
    event.dataTransfer.setData('text/plain', item.dataset.id);
  });
  panel.addEventListener('click', (event) => {
    const tool = event.target.closest('[data-qtool]');
    if (tool) return actions[tool.dataset.qtool]?.();
    const drop = event.target.closest('[data-drop-manual]');
    if (drop) {
      event.stopPropagation();
      return actions.dropManual(Number(drop.dataset.dropManual));
    }
    const item = event.target.closest('[data-jump]');
    if (item) return actions.jump(Number(item.dataset.jump));
    return undefined;
  });
}

/**
 * La segunda línea de una canción en la cola.
 *
 * Con el tempo y la tonalidad cuando se saben: en la cola es donde uno decide
 * qué mueve y qué no, y esa decisión se toma con esos dos números delante. Sin
 * analizar, la línea es la de siempre y no se inventa nada.
 */
const lineaDe = (track) => [
  track.artist,
  formatTime(track.duration),
  formatTempo(track.bpm) ? `${formatTempo(track.bpm)} bpm` : '',
  track.key || '',
].filter(Boolean).join(' · ');

const itemHtml = (track, { number, current = false, manualIndex = null }) => {
  if (!track) return '';
  const jump = manualIndex == null ? ` data-jump="${number}"` : '';
  // Arrastrable: en la cabina, la cola es de donde se saca lo que va al plato B.
  return `<li class="q-item${current ? ' current' : ''}"${jump} draggable="true" data-id="${esc(track.id)}">
    <span class="q-num">${current ? ICO.play.replace('<svg', '<svg style="width:12px;height:12px;margin:auto"') : number + 1}</span>
    <span>
      <span class="q-title">${esc(track.title)}</span>
      <span class="q-artist">${esc(lineaDe(track))}</span>
    </span>
    ${manualIndex == null
      ? '<span></span>'
      : `<button class="icon-btn" data-drop-manual="${manualIndex}" aria-label="Quitar de la cola">${ICO.x}</button>`}
  </li>`;
};

export function renderQueue() {
  const panel = $('#queue-panel');
  panel.hidden = !state.queueOpen;
  $('#app').classList.toggle('queue-open', state.queueOpen);
  if (!state.queueOpen) return;

  const { queue } = state;
  const after = queue.order.slice(queue.index + 1);
  const pendingCount = queue.manual.length + after.length;
  const remaining = [...queue.manual, ...after]
    .map((id) => getTrack(id))
    .reduce((sum, track) => sum + (track?.duration || 0), 0);

  const current = state.currentId ? getTrack(state.currentId) : null;
  const manual = queue.manual
    .map((id, i) => itemHtml(getTrack(id), { number: i, manualIndex: i }))
    .join('');
  const next = after
    .slice(0, 200)
    .map((id, i) => itemHtml(getTrack(id), { number: queue.index + 1 + i }))
    .join('');

  panel.innerHTML = `
    <div class="queue-head">
      <h3>A continuación</h3>
      <div class="sub">${pendingCount ? `${plural(pendingCount, 'canción', 'canciones')} · ${formatTime(remaining)}` : 'La cola se ha terminado'}</div>
      <div class="acts">
        ${pendingCount || current ? `<button class="btn btn-ghost" data-qtool="saveAsPlaylist">${ICO.list}Guardar como lista</button>` : ''}
        ${queue.manual.length ? `<button class="btn btn-ghost" data-qtool="clearManual">${ICO.x}Vaciar lo añadido a mano</button>` : ''}
        <button class="btn btn-ghost" data-qtool="close">Cerrar</button>
      </div>
    </div>
    ${current ? `<div class="q-section">Sonando</div><ul class="q-list">${itemHtml(current, { number: queue.index, current: true })}</ul>` : ''}
    ${manual ? `<div class="q-section">Añadidas a mano</div><ul class="q-list">${manual}</ul>` : ''}
    ${next ? `<div class="q-section">Después</div><ul class="q-list">${next}</ul>` : ''}
    ${!pendingCount && !current ? '<p class="rail-note" style="border:0;margin:14px 16px">Elige algo en la biblioteca y la cola se llenará sola.</p>' : ''}`;
}
