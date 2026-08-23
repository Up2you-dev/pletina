import { coverHtml, esc } from './dom.js';
import { ICO } from './icons.js';
import { ESTILOS } from '../../shared/mezcla.js';
import { formatTime } from '../../shared/format.js';
import { estadoDeMezcla, prepararPlan } from '../mezclador.js';
import { estadoDePlatos } from '../player.js';
import { state } from '../state.js';

/**
 * La pantalla del mezclador. Enseña las dos canciones como dos platos, lo que
 * el mezclador sabe de cada una y qué va a hacer exactamente al pulsar el botón.
 *
 * La regla de esta pantalla: nada de números mágicos. Si va a estirar el tempo
 * un 1,6 %, lo dice; si va a cambiar los graves en el compás cuatro, lo dice; y
 * si le falta el análisis de una canción, lo dice antes de que suene mal.
 */

const COMPASES = [4, 8, 16, 32];

function plato(ficha, papel) {
  if (!ficha) {
    return `<div class="plato vacio">
      <div class="papel">${esc(papel)}</div>
      <p>Nada aquí todavía.</p>
    </div>`;
  }
  const datos = [
    ficha.bpm ? `${Math.round(ficha.bpm)} bpm` : 'sin tempo',
    ficha.tonalidad || (ficha.key ? ficha.key : 'sin tonalidad'),
    ficha.rejilla?.porBombo ? 'rejilla por bombo' : ficha.rejilla ? 'rejilla por pulso' : 'sin rejilla',
  ];
  return `<div class="plato${ficha.analizada ? '' : ' sin-analizar'}">
    <div class="papel">${esc(papel)}</div>
    <div class="plato-cuerpo">
      ${coverHtml(ficha, 'plato-caratula')}
      <div class="plato-texto">
        <strong>${esc(ficha.titulo)}</strong>
        <span>${esc(ficha.artista)}</span>
        <span class="plato-datos">${datos.map((d) => esc(d)).join(' · ')}</span>
        <span class="plato-datos">${formatTime(ficha.duracion)}</span>
      </div>
    </div>
    ${ficha.analizada ? '' : `<button class="btn btn-ghost pequeno" data-mezcla="analizar" data-id="${esc(ficha.id)}">
      ${ICO.waves}Analizar esta
    </button>`}
  </div>`;
}

export function pintarMezclador() {
  const { enCurso, ajustes, disponible } = estadoDeMezcla();
  // Con una mezcla en marcha manda ella: la cola ya ha avanzado y preguntar por
  // «la siguiente» dejaría los dos platos vacíos justo cuando están sonando.
  const preparado = enCurso ?? prepararPlan();
  const saliente = preparado?.saliente ?? null;
  const entrante = preparado?.entrante ?? null;

  const avisos = preparado?.plan?.avisos ?? [];
  const resumen = preparado?.resumen ?? '';

  return `<div class="mezclador">
    <div class="platos">
      ${plato(saliente, 'Suena ahora')}
      <div class="flecha" aria-hidden="true">${ICO.next}</div>
      ${plato(entrante, 'Entra después')}
    </div>

    ${resumen ? `<p class="resumen">${esc(resumen)}</p>` : ''}
    ${avisos.map((a) => `<p class="aviso-mezcla">${ICO.warn}<span>${esc(a)}</span></p>`).join('')}

    ${enCurso ? `<div class="mezcla-en-curso">
      <div class="barra">
        <span id="mezcla-progreso"></span>
        ${enCurso.plan.cambioDeGraves
    ? `<i class="marca-cambio" style="left:${(enCurso.plan.cambioDeGraves / enCurso.plan.duracion) * 100}%"
            title="Aquí se cambian los graves"></i>`
    : ''}
      </div>
      <p id="mezcla-estado">Mezclando · ${esc(enCurso.resumen)}</p>
      <div class="platos-vivos" id="platos-vivos"></div>
    </div>` : ''}

    <div class="ajustes-mezcla">
      <div class="grupo">
        <span class="etiqueta">Longitud</span>
        <div class="chips">
          ${COMPASES.map((c) => `<button class="chip${ajustes.compases === c ? ' on' : ''}"
            data-mezcla="compases" data-valor="${c}">${c} compases</button>`).join('')}
        </div>
      </div>

      <div class="grupo">
        <span class="etiqueta">Cómo entra</span>
        <div class="chips">
          ${Object.entries(ESTILOS).map(([clave, nombre]) => `<button class="chip${ajustes.estilo === clave ? ' on' : ''}"
            data-mezcla="estilo" data-valor="${clave}">${esc(nombre)}</button>`).join('')}
        </div>
      </div>

      <div class="grupo">
        <label class="interruptor ancho">
          <input type="checkbox" data-mezcla="ajustarTempo"${ajustes.ajustarTempo ? ' checked' : ''}>
          <span>Igualar el tempo de la que entra al de la que sale</span>
        </label>
        <label class="interruptor ancho">
          <input type="checkbox" data-mezcla="estirarTiempo"${ajustes.estirarTiempo ? ' checked' : ''}>
          <span>Mantener el tono al cambiar el tempo (estirado de tiempo)</span>
        </label>
        <label class="interruptor ancho">
          <input type="checkbox" data-mezcla="auto"${ajustes.auto ? ' checked' : ''}>
          <span>Mezclar sola cada canción con la siguiente</span>
        </label>
      </div>
    </div>

    <button class="btn btn-primary grande" data-mezcla="ahora"${disponible.puede ? '' : ' disabled'}>
      ${ICO.play}Mezclar ahora
    </button>
    ${disponible.puede ? '' : `<p class="hint">${esc(disponible.motivo)}</p>`}

    <p class="nota-mezcla">La transición empieza en el siguiente inicio de compás de la que está sonando,
    no al pulsar el botón: es lo que hace que los dos bombos caigan juntos. Mientras dura suenan las dos
    canciones a la vez, con la que entra sin graves hasta el cambio.</p>
  </div>`;
}

/** Una barra de volumen de 0 a 1 con el número al lado. */
function medidor(valor) {
  const ancho = Math.round(Math.max(0, Math.min(1, valor)) * 100);
  return `<span class="medidor"><i style="width:${ancho}%"></i></span>`;
}

function platoVivo(estado, papel) {
  if (!estado?.id) return '';
  const ajuste = Math.round((estado.velocidad - 1) * 1000) / 10;
  const datos = [
    `${Math.round(estado.grave)} dB de graves`,
    ajuste === 0 ? 'a su tempo' : `${ajuste > 0 ? '+' : ''}${ajuste} %`,
    estado.estirando ? 'tono intacto' : 'tono desplazado',
  ];
  return `<div class="plato-vivo${estado.grave <= -20 ? ' sin-graves' : ''}">
    <span class="papel">${esc(papel)}</span>
    ${medidor(estado.ganancia)}
    <span class="plato-datos">${datos.map((d) => esc(d)).join(' · ')}</span>
  </div>`;
}

/**
 * Progreso de la mezcla en marcha, sin repintar la pantalla entera.
 *
 * Enseña los valores reales del grafo de audio —volumen y graves de cada
 * plato—, no una animación decorativa: si el cambio de graves ocurre, se ve.
 */
export function refrescarProgreso() {
  const { enCurso } = estadoDeMezcla();
  const barra = document.querySelector('#mezcla-progreso');
  if (!barra || !enCurso) return;
  const desdeElLanzamiento = (Date.now() - enCurso.desde) / 1000;
  const espera = enCurso.espera || 0;
  const transcurrido = desdeElLanzamiento - espera;

  const porcentaje = Math.min(100, Math.max(0, (transcurrido / enCurso.plan.duracion) * 100));
  barra.style.width = `${porcentaje}%`;
  barra.classList.toggle('tras-cambio', Boolean(enCurso.plan.cambioDeGraves)
    && transcurrido >= enCurso.plan.cambioDeGraves);

  const texto = document.querySelector('#mezcla-estado');
  if (texto) {
    texto.textContent = transcurrido < 0
      ? `Esperando al inicio de compás · ${(-transcurrido).toFixed(1)} s`
      : `Mezclando · ${enCurso.resumen}`;
  }

  const vivos = document.querySelector('#platos-vivos');
  if (!vivos) return;
  const platos = estadoDePlatos();
  const sale = platos.find((p) => p.id === enCurso.saliente.id);
  const entra = platos.find((p) => p.id === enCurso.entrante.id);
  vivos.innerHTML = platoVivo(sale, 'Sale') + platoVivo(entra, 'Entra');
}

export const vistaDelMezclador = () => state.view.type === 'mezclador';
