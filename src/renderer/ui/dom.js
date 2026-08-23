/** Utilidades de DOM: selección, escapado, avisos, menús y diálogos. */

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Todo lo que venga de las etiquetas de un archivo pasa por aquí antes de tocar el DOM. */
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]);

/** Color estable a partir de un texto: la misma canción tiene siempre el mismo degradado. */
export function hueOf(text) {
  let hue = 0;
  for (let i = 0; i < text.length; i += 1) hue = (hue * 31 + text.charCodeAt(i)) % 360;
  return hue;
}

export function gradientFor(text) {
  const hue = hueOf(String(text || '?'));
  return `linear-gradient(140deg, hsl(${hue} 62% 52%), hsl(${(hue + 42) % 360} 58% 38%))`;
}

/** Portada de una canción o, si no hay, un cuadro con su inicial. */
export function coverHtml(item, className = 't-cover') {
  const seed = `${item?.album || ''}${item?.artist || ''}${item?.title || ''}`;
  if (item?.coverId) {
    return `<img class="${className}" src="${esc(window.pletina.media.cover(item.coverId))}" alt="" loading="lazy">`;
  }
  const letter = esc((item?.title || item?.album || item?.artist || '?').trim().charAt(0).toUpperCase() || '?');
  return `<span class="${className} ph-box" style="background:${gradientFor(seed)};display:grid;place-items:center;color:#fff;font-family:var(--ff-display);font-weight:700">${letter}</span>`;
}

export function toast(message) {
  const host = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), 3400);
}

/* ---------------------------------------------------------------- popovers */

let openPop = null;

export function closePop() {
  if (!openPop) return;
  openPop.remove();
  openPop = null;
  document.removeEventListener('mousedown', outsideClick, true);
  document.removeEventListener('keydown', escapePop, true);
}

function outsideClick(event) {
  if (openPop && !openPop.contains(event.target)) closePop();
}

function escapePop(event) {
  if (event.key === 'Escape') {
    event.stopPropagation();
    closePop();
  }
}

/**
 * Menú flotante anclado a un botón. Se recoloca solo si no cabe hacia abajo,
 * que en una ventana de escritorio pasa constantemente.
 */
export function popover(anchor, items) {
  closePop();
  const el = document.createElement('div');
  el.className = 'pop';
  el.setAttribute('role', 'menu');
  el.innerHTML = items
    .map((item) => {
      if (item.type === 'cap') return `<div class="cap">${esc(item.label)}</div>`;
      if (item.type === 'sep') return '<div class="sep"></div>';
      if (item.type === 'html') return item.html;
      return `<button role="menuitem" data-k="${esc(item.key)}" class="${item.danger ? 'danger' : ''}">${
        item.icon || ''}<span>${esc(item.label)}</span></button>`;
    })
    .join('');
  document.body.appendChild(el);

  const rect = anchor.getBoundingClientRect();
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
  let top = rect.bottom + 6;
  if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 6);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;

  el.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-k]');
    if (!button) return;
    const item = items.find((x) => x.key === button.dataset.k);
    closePop();
    item?.run?.();
  });
  openPop = el;
  setTimeout(() => {
    document.addEventListener('mousedown', outsideClick, true);
    document.addEventListener('keydown', escapePop, true);
    el.querySelector('button')?.focus();
  }, 0);
}

/* ---------------------------------------------------------------- diálogos */

let dialogDepth = 0;
export const isDialogOpen = () => dialogDepth > 0;

/**
 * Diálogo modal propio (el nativo se reserva para lo irreversible, como la
 * papelera).
 *
 * Devuelve, según cómo se le llame: el texto escrito (`input`), un objeto con
 * los valores (`fields`), `true`/`false` en una confirmación, o `null` si se
 * cancela.
 */
export function dialog({ title, message, input, fields, value = '', ok = 'Aceptar', danger = false }) {
  return new Promise((resolve) => {
    dialogDepth += 1;
    const veil = document.createElement('div');
    veil.className = 'veil';
    veil.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <h3>${esc(title)}</h3>
      ${message ? `<p>${esc(message)}</p>` : ''}
      ${input ? `<input type="text" aria-label="${esc(input)}" placeholder="${esc(input)}" value="${esc(value)}">` : ''}
      ${fields ? `<div class="campos">${fields.map((campo) => `<div class="campo${campo.ancho === 'medio' ? ' medio' : ''}">
        <label for="campo-${esc(campo.name)}">${esc(campo.label)}</label>
        <input id="campo-${esc(campo.name)}" name="${esc(campo.name)}" type="${campo.type === 'numero' ? 'number' : 'text'}"
          ${campo.type === 'numero' ? 'min="0" step="1"' : ''}
          value="${esc(campo.value ?? '')}" placeholder="${esc(campo.placeholder ?? '')}"
          autocomplete="off" spellcheck="false">
      </div>`).join('')}</div>` : ''}
      <div class="modal-actions">
        <button class="btn" data-x="cancel">Cancelar</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-x="ok">${esc(ok)}</button>
      </div></div>`;
    document.body.appendChild(veil);
    const field = veil.querySelector('input');
    if (field) {
      field.focus();
      field.select();
    } else {
      veil.querySelector('[data-x="ok"]').focus();
    }

    /** Lo escrito en el formulario, campo a campo. */
    const valores = () => Object.fromEntries(
      [...veil.querySelectorAll('.campo input')].map((el) => [el.name, el.value.trim()]),
    );

    const done = (result) => {
      dialogDepth -= 1;
      veil.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(result);
    };
    const cancelado = () => (input || fields ? null : false);
    const aceptado = () => {
      if (fields) return valores();
      return input ? field.value.trim() || null : true;
    };

    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        done(cancelado());
      }
      if (event.key === 'Enter' && (input || fields)) {
        event.preventDefault();
        event.stopPropagation();
        done(aceptado());
      }
    }
    veil.addEventListener('click', (event) => {
      if (event.target === veil) return done(cancelado());
      const button = event.target.closest('[data-x]');
      if (!button) return;
      if (button.dataset.x === 'cancel') return done(cancelado());
      return done(aceptado());
    });
    document.addEventListener('keydown', onKey, true);
  });
}
