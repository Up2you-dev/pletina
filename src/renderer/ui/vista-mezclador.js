import { coverHtml, esc } from './dom.js';
import { ICO } from './icons.js';
import { ESTILOS } from '../../shared/mezcla.js';
import { formatPorcentaje, formatTime } from '../../shared/format.js';
import { desfaseEntre } from '../../shared/onda-vista.js';
import {
  candidatos, estadoDeMezcla, fichaDeMezcla, pendientesDeAnalizar, prepararPlan,
} from '../mezclador.js';
import { estadoDePlatos, estadoPreparado, estadoTira, platoActivo } from '../player.js';
import { ondaCargada, pedirOnda } from '../ondas.js';
import { state } from '../state.js';
import { pintarGeneral, pintarZoom, segundoEnLaGeneral } from './onda.js';

/**
 * La cabina.
 *
 * Dos platos, uno encima del otro, con sus ondas alineadas en el mismo eje de
 * tiempo. Eso es lo que permite mezclar mirando en vez de contando: cuando las
 * dos canciones van cuadradas, sus líneas de compás caen a la misma altura de
 * la pantalla. Es la disposición de una cabina de verdad —rekordbox, Serato,
 * Mixxx— y no es capricho: es la única que deja comparar dos ondas.
 *
 * Arriba, lo que suena. Abajo, lo que preparas: se carga a mano, se coloca
 * donde tú quieras arrastrando, se preescucha y entra cuando lo digas. La cola
 * sigue estando, pero deja de mandar.
 */

const COMPASES = [4, 8, 16, 32];
/** Segundos de canción que se ven en la vista ampliada. */
export const ZOOMS = [4, 8, 16];

let acciones = {};
let bucle = null;
let arrastre = null;
let zoom = 8;
/** Lo que se ha escrito en el buscador del plato B. */
let busqueda = '';

/** Lo escrito en el buscador de la cabina, que manda sobre las sugerencias. */
export function buscarParaPlatoB(texto) {
  busqueda = typeof texto === 'string' ? texto : '';
}

export function bindCabina(handlers) {
  acciones = handlers;
}

/* ----------------------------------------------------------------- pintado */

const conComa = (numero, decimales = 1) => numero.toFixed(decimales).replace('.', ',');

/**
 * Cuánto se puede fiar uno de esta rejilla, dicho como se dice en una cabina.
 *
 * Es lo que faltaba: la aplicación sabía cuándo una rejilla era dudosa y se lo
 * callaba, así que el usuario descubría el problema pinchando. Un tempo que se
 * va no es un error del análisis, es una canción tocada a mano; pero hay que
 * decirlo antes, no después.
 */
function fiabilidad(rejilla, ficha) {
  if (ficha?.formatoMudo) return `${ficha.formatoMudo} · este equipo no sabe decodificarlo`;
  // Analizada y sin pulso: se dice, porque no es lo mismo que estar sin
  // analizar y el usuario tiene que saber por qué no hay rejilla que mirar.
  if (ficha?.sinPulso) return 'sin pulso claro · no hay rejilla que cuadrar';
  if (!rejilla?.bpm) return '';
  if (rejilla.aMano) return 'rejilla puesta a mano';
  if ((rejilla.deriva ?? 0) > 0.5) return 'el tempo se mueve · cuadra a ojo';
  if ((rejilla.fuerza ?? 1) < 0.25) return 'pulso flojo · repasa la rejilla';
  return '';
}

function datosDe(ficha, extra = []) {
  return [
    ficha.bpm ? `${conComa(ficha.bpm)} bpm` : 'sin tempo',
    ficha.tonalidad || ficha.key || 'sin tonalidad',
    ficha.rejilla?.porBombo ? 'rejilla por bombo' : '',
    fiabilidad(ficha.rejilla, ficha),
    ...extra,
  ].filter(Boolean).map((d) => esc(d)).join(' · ');
}

function cabeceraDeck(ficha, papel) {
  if (!ficha) {
    return `<header class="deck-cab vacia">
      <span class="papel">${esc(papel)}</span>
      <span class="deck-vacio">Nada cargado. Elige abajo qué preparar.</span>
    </header>`;
  }
  return `<header class="deck-cab">
    <span class="papel">${esc(papel)}</span>
    ${coverHtml(ficha, 'deck-caratula')}
    <span class="deck-texto">
      <strong>${esc(ficha.titulo)}</strong>
      <span>${esc(ficha.artista)}</span>
      <span class="deck-datos" data-datos="${esc(papel[0])}">${datosDe(ficha)}</span>
    </span>
    <span class="deck-reloj" data-reloj="${esc(papel[0])}"></span>
    ${ficha.formatoMudo ? '' : ficha.analizada || ficha.sinPulso
    // Ya analizada: el botón se queda en icono. Sigue estando —es el que se
    // busca cuando algo no cuadra— pero no le come el sitio a los datos, que
    // es lo que se mira todo el rato.
    ? `<button class="icon-btn" data-mezcla="analizar" data-id="${esc(ficha.id)}"
        title="Volver a analizar esta canción" aria-label="Volver a analizar esta canción">${ICO.waves}</button>`
    : `<button class="btn btn-ghost pequeno" data-mezcla="analizar" data-id="${esc(ficha.id)}"
        title="Tempo, tonalidad y rejilla de compases">${ICO.waves}Analizar</button>`}
  </header>`;
}

/** Qué se le dice a uno del encaje de una canción, en dos palabras. */
function encajeHtml(c) {
  if (!c.analizada) return '<i class="ojo">sin analizar</i>';
  if (c.ajuste == null) return '<i class="ojo">no hay con qué comparar</i>';
  // El porcentaje que se enseña es lo que habría que estirar ESA canción.
  const estiron = Math.round((1 / (1 - c.ajuste) - 1) * 1000) / 10;
  if (!c.cuadra) return `<i class="ojo">no cuadra · ${esc(formatPorcentaje(estiron))}</i>`;
  return `${c.armonica ? '<i class="pega">encaja de tono</i>' : ''}<i>${
    esc(c.ajuste < 0.001 ? 'mismo tempo' : formatPorcentaje(estiron))}</i>`;
}

/**
 * La tira de canal de un plato: lo que en una mesa son cuatro mandos.
 *
 * Es la carencia que más se nota al abrir la cabina viniendo de rekordbox,
 * Serato o Traktor: en todos ellos el centro de la pantalla es esto. El motor ya
 * sabía hacerlo —lo hace solo durante quince segundos en cada transición—; lo
 * que faltaban eran los mandos. Doble clic en una banda la mata y la devuelve.
 */
function tiraHtml(cual, hay) {
  const t = estadoTira(cual);
  const mando = (clave, etiqueta, titulo, min, max, paso, valor) => `
    <label class="mando" title="${esc(titulo)}">
      <span>${esc(etiqueta)}</span>
      <input type="range" data-tira="${cual}" data-mando="${clave}"
        min="${min}" max="${max}" step="${paso}" value="${valor}"${hay ? '' : ' disabled'}
        aria-label="${esc(titulo)}">
    </label>`;
  return `<div class="tira" data-tira-de="${cual}">
    ${mando('grave', 'GRA', 'Graves de este plato · doble clic para quitarlos del todo', -26, 6, 0.5, t.grave)}
    ${mando('medio', 'MED', 'Medios de este plato · doble clic para quitarlos del todo', -26, 6, 0.5, t.medio)}
    ${mando('agudo', 'AGU', 'Agudos de este plato · doble clic para quitarlos del todo', -26, 6, 0.5, t.agudo)}
    ${mando('filtro', 'FILTRO', 'A la izquierda cierra por arriba, a la derecha abre por abajo · doble clic para centrarlo', -1, 1, 0.01, t.filtro)}
    ${mando('volumen', 'VOL', 'Volumen de este plato, sin tocar el general', 0, 1.4, 0.01, t.volumen)}
  </div>`;
}

function candidatoHtml(c) {
  return `<button class="candidato${c.cuadra ? '' : ' floja'}" data-cargar="${esc(c.id)}"
    draggable="true" data-id="${esc(c.id)}" title="Cargar en el plato B">
    ${coverHtml(c, 'candidato-caratula')}
    <span class="candidato-texto">
      <strong>${esc(c.titulo)}</strong>
      <span>${esc(c.artista)}</span>
    </span>
    <span class="candidato-datos">${c.bpm ? `${esc(conComa(c.bpm))} bpm` : 'sin tempo'} · ${esc(c.tonalidad || c.key || '—')}</span>
    <span class="candidato-encaje">${encajeHtml(c)}</span>
  </button>`;
}

/** El criterio, dicho en una línea: una lista sin criterio no se puede usar. */
function pistaDeCandidatos(lista) {
  if (busqueda.trim()) return 'buscando en toda la biblioteca · manda lo que escribes, no el criterio';
  if (lista.length) return 'primero lo que encaja de tonalidad, luego lo que menos hay que estirar';
  return 'o busca cualquier canción, o arrastra una aquí desde la cola';
}

/**
 * Y por qué no hay nada, cuando no hay nada.
 *
 * Antes decía siempre lo mismo —«nada cuadra con lo que suena»— aunque no
 * sonara nada y aunque la biblioteca estuviera sin analizar. Un motivo falso es
 * peor que ninguno: manda a buscar el problema donde no está.
 */
function porQueNoHay() {
  if (busqueda.trim()) return 'Nada en tu biblioteca se llama así.';
  if (!state.currentId) return 'Pon algo a sonar y aquí saldrá lo que le va detrás. O busca una canción y arrástrala al plato B.';
  const sonando = fichaDeMezcla(state.currentId);
  if (!sonando?.bpm) return 'La canción que suena está sin analizar: sin su tempo no hay con qué comparar.';
  if (pendientesDeAnalizar() >= state.tracks.length) return 'Tu biblioteca está sin analizar: sin tempo no se puede sugerir nada.';
  return 'Nada de lo analizado cuadra con lo que suena sin estirarlo más de un 12 %. Búscala arriba y ponla igual: tú mandas.';
}

export function pintarMezclador() {
  const {
    enCurso, ajustes, disponible, platoB,
  } = estadoDeMezcla();
  const preparado = enCurso ?? prepararPlan();
  const saliente = fichaDelPlato('a');
  const entrante = fichaDelPlato('b');
  const avisos = preparado?.plan?.avisos ?? [];
  const resumen = preparado?.resumen ?? '';
  const lista = candidatos({ busqueda });
  const pendientes = pendientesDeAnalizar();

  return `<div class="cabina">
    <section class="deck deck-a">
      ${cabeceraDeck(saliente, 'A · suena')}
      <canvas class="onda general" data-onda="general-a"></canvas>
      <canvas class="onda zoom" data-onda="zoom-a"></canvas>
      ${tiraHtml('a', Boolean(saliente))}
    </section>

    <div class="entre-platos">
      <span class="desfase" data-desfase>—</span>
      <div class="chips zoom-chips">
        ${ZOOMS.map((z) => `<button class="chip${zoom === z ? ' on' : ''}" data-zoom="${z}">${z} s</button>`).join('')}
      </div>
      <span class="hint">arrastra una onda para empujar el plato</span>
    </div>

    <section class="deck deck-b${entrante ? '' : ' vacia'}" data-suelta="b">
      <canvas class="onda zoom" data-onda="zoom-b"></canvas>
      <canvas class="onda general" data-onda="general-b"></canvas>
      ${cabeceraDeck(entrante, 'B · preparas')}
      ${tiraHtml('b', Boolean(platoB))}
      <div class="deck-botones">
        <button class="btn pequeno${platoB?.escuchando ? ' on' : ''}" data-mezcla="preescuchar"
          ${platoB ? '' : 'disabled'} aria-pressed="${Boolean(platoB?.escuchando)}"
          title="Escuchar el plato preparado sin lanzar la mezcla · tecla B">
          ${ICO.vol}${platoB?.escuchando ? 'Preescuchando' : 'Preescuchar'}</button>
        <button class="btn pequeno" data-mezcla="compas-atras"${platoB ? '' : ' disabled'}
          title="Un compás atrás">${ICO.prev}Compás</button>
        <button class="btn pequeno" data-mezcla="compas-adelante"${platoB ? '' : ' disabled'}
          title="Un compás adelante">Compás${ICO.next}</button>
        <button class="btn pequeno" data-mezcla="poner-uno"${platoB ? '' : ' disabled'}
          title="Mover el «uno» de la rejilla a donde está el plato">${ICO.check}El uno está aquí</button>
        <button class="btn pequeno" data-mezcla="marcar-tempo"${platoB ? '' : ' disabled'}
          title="Dar golpecitos al ritmo de la canción para ponerle el tempo a mano">${ICO.waves}Marcar tempo</button>
        <button class="btn pequeno" data-mezcla="octava" data-valor="2"${platoB?.ficha?.rejilla ? '' : ' disabled'}
          title="Contar el tempo al doble, sin mover un golpe de sitio">×2</button>
        <button class="btn pequeno" data-mezcla="octava" data-valor="0.5"${platoB?.ficha?.rejilla ? '' : ' disabled'}
          title="Contar el tempo a la mitad, sin mover un golpe de sitio">÷2</button>
        <button class="btn btn-ghost pequeno" data-mezcla="soltar-b"${platoB ? '' : ' disabled'}>
          ${ICO.x}Quitar</button>
      </div>
    </section>

    <div class="mesa">
      ${resumen ? `<p class="resumen">${esc(resumen)}</p>` : ''}
      ${avisos.map((a) => `<p class="aviso-mezcla">${ICO.warn}<span>${esc(a)}</span></p>`).join('')}

      ${enCurso ? `<div class="mezcla-en-curso">
        <div class="rejilla-compases" id="rejilla-compases" aria-hidden="true">
          ${Array.from({ length: enCurso.plan.compases }, (unused, i) => {
    const esElCambio = enCurso.plan.cambioDeGraves
              && Math.round(enCurso.plan.cambioDeGraves / enCurso.plan.compasSegundos) === i;
    return `<i class="${esElCambio ? 'cambio' : ''}"></i>`;
  }).join('')}
        </div>
        <p id="mezcla-estado">Mezclando · ${esc(enCurso.resumen)}</p>
      </div>` : ''}

      ${enCurso ? `<button class="btn btn-primary grande" data-mezcla="cortar">
        ${ICO.x}Cortar la mezcla
      </button>
      <p class="hint">Se queda sonando la que estaba entrando.</p>`
    : `<button class="btn btn-primary grande" data-mezcla="ahora"${disponible.puede ? '' : ' disabled'}
        title="Espera al compás y pincha · tecla M">
        ${ICO.play}Mezclar ahora${preparado?.espera > 0.3 ? ` · entra en ${conComa(preparado.espera)} s` : ''}
      </button>
      ${disponible.puede ? '' : `<p class="hint">${esc(disponible.motivo)}</p>`}`}

      <div class="grupo">
        <span class="etiqueta">Cuántos compases dura</span>
        <div class="chips">
          ${COMPASES.map((c) => `<button class="chip${ajustes.compases === c ? ' on' : ''}"
            data-mezcla="compases" data-valor="${c}">${c}</button>`).join('')}
        </div>
      </div>
      <div class="grupo">
        <span class="etiqueta">Cómo entra</span>
        <div class="chips">
          ${Object.entries(ESTILOS).map(([clave, nombre]) => `<button class="chip${ajustes.estilo === clave ? ' on' : ''}"
            data-mezcla="estilo" data-valor="${clave}">${esc(nombre)}</button>`).join('')}
        </div>
      </div>

      <div class="interruptores">
        <label class="interruptor">
          <input type="checkbox" data-mezcla="ajustarTempo"${ajustes.ajustarTempo ? ' checked' : ''}>
          <span>Igualar el tempo</span>
        </label>
        <label class="interruptor">
          <input type="checkbox" data-mezcla="estirarTiempo"${ajustes.estirarTiempo ? ' checked' : ''}>
          <span>Mantener el tono</span>
        </label>
        <label class="interruptor">
          <input type="checkbox" data-mezcla="auto"${ajustes.auto ? ' checked' : ''}>
          <span>Encadenar sola</span>
        </label>
      </div>
    </div>

    <div class="candidatos">
      <div class="candidatos-cab">
        <span class="etiqueta">Qué pinchar después</span>
        <span class="hint">${esc(pistaDeCandidatos(lista))}</span>
        <span class="candidatos-tools">
          <input type="search" class="buscar-candidato" data-buscar-candidato
            placeholder="Buscar en la biblioteca…" value="${esc(busqueda)}" aria-label="Buscar una canción para el plato B">
          <button class="btn btn-ghost pequeno" data-mezcla="analizar-pendientes"
            title="Tempo, tonalidad y rejilla de compases">
            ${ICO.waves}${pendientes ? `Analizar ${pendientes}` : 'Volver a analizar la biblioteca'}</button>
        </span>
      </div>
      <div class="candidatos-lista">${lista.map(candidatoHtml).join('')}</div>
      ${lista.length ? '' : `<p class="candidatos-vacio">${esc(porQueNoHay())}</p>`}
    </div>
  </div>`;
}

/* ------------------------------------------------------------- el bucle */

const lienzo = (raiz, nombre) => raiz.querySelector(`[data-onda="${nombre}"]`);

/**
 * Qué canción hay en cada plato.
 *
 * El plato A es lo que suena, con o sin plan; el B es lo que hay preparado o,
 * durante una transición, la que está entrando.
 */
export function fichaDelPlato(cual, estado = estadoDeMezcla()) {
  const { platoB, enCurso } = estado;
  if (cual === 'b') return platoB?.ficha ?? enCurso?.entrante ?? null;
  return enCurso?.saliente ?? fichaDeMezcla(state.currentId);
}

/** Un cuadro: las cuatro ondas, el desfase y los números que cambian. */
function pintarCuadro(raiz) {
  const platos = estadoDePlatos();
  const activo = platoActivo();
  const preparado = estadoPreparado();
  // Un solo vistazo al estado por cuadro: preguntarlo tres veces sesenta veces
  // por segundo es preparar ciento ochenta planes de mezcla que nadie usa.
  const estado = estadoDeMezcla();
  const { enCurso } = estado;

  const fichas = { a: fichaDelPlato('a', estado), b: fichaDelPlato('b', estado) };
  const enPlato = {
    a: platos.find((p) => p.id && p.id === fichas.a?.id),
    b: platos.find((p) => p.id && p.id === fichas.b?.id),
  };

  for (const cual of ['a', 'b']) {
    const ficha = fichas[cual];
    const general = lienzo(raiz, `general-${cual}`);
    const ampliada = lienzo(raiz, `zoom-${cual}`);
    if (!general || !ampliada) continue;

    const ondas = ficha?.id ? ondaCargada(ficha.id) : null;
    if (ficha?.id && !ondas) pedirOnda(ficha.id);
    // Un hueco en blanco no dice nada. Si no hay onda que pintar, el lienzo
    // explica por qué y qué hacer, que es lo único que hay que saber ahí.
    let mensaje = '';
    if (!ficha?.id) mensaje = cual === 'b' ? 'arrastra aquí una canción, o elígela abajo' : 'no suena nada';
    else if (!ondas) {
      if (ficha.formatoMudo) mensaje = `${ficha.formatoMudo} · este equipo no sabe decodificar este formato`;
      else if (ficha.sinPulso) mensaje = 'sin pulso claro · esta canción no tiene rejilla';
      else mensaje = ficha.analizada ? 'sin onda guardada · vuelve a analizarla' : 'sin analizar · pulsa «Analizar»';
    }
    const estado = enPlato[cual];
    const tiempo = estado?.tiempo ?? (cual === 'a' ? activo.tiempo : preparado.tiempo) ?? 0;
    const apagado = cual === 'b' && !enCurso && !preparado.escuchando;

    pintarGeneral(general, ondas, {
      mensaje,
      posicion: tiempo,
      duracion: ficha?.duracion || ondas?.duracion || 0,
      apagado,
      // Las frases también en la vista de la canción entera: era el único de los
      // cuatro lienzos sin ninguna rejilla, y es el primero que se mira.
      rejilla: ficha?.rejilla ?? null,
      // Por dónde empieza a sonar de verdad, que es por donde entrará.
      marcas: ficha?.rejilla?.entrada ? [{ segundo: ficha.rejilla.entrada }] : [],
      zona: cual === 'a' && enCurso
        ? { desde: enCurso.plan.arranque, hasta: enCurso.plan.arranque + enCurso.plan.duracion }
        : null,
    });
    pintarZoom(ampliada, ondas, {
      mensaje,
      centro: tiempo,
      segundos: zoom,
      rejilla: ficha?.rejilla ?? null,
      apagado,
      sinGraves: (estado?.grave ?? 0) <= -20,
    });
  }

  pintarDesfase(raiz, fichas, enPlato);
  pintarDatosDelPlatoA(raiz, fichas.a, enPlato.a);
  for (const cual of ['a', 'b']) {
    const reloj = raiz.querySelector(`[data-reloj="${cual.toUpperCase()}"]`);
    if (!reloj) continue;
    const ficha = fichas[cual];
    const tiempo = enPlato[cual]?.tiempo ?? (cual === 'a' ? activo.tiempo : preparado.tiempo);
    const queda = (ficha?.duracion || 0) - (tiempo || 0);
    // Lo primero que se mira en una cabina es cuánto queda, no cuánto va.
    reloj.textContent = ficha?.duracion ? `-${formatTime(Math.max(0, queda))}` : '';
    reloj.classList.toggle('apurado', ficha?.duracion > 0 && queda < 30);
  }
  refrescarProgreso(enCurso);
}

/** El desfase entre las dos rejillas: el número que mira un pinchadiscos. */
function pintarDesfase(raiz, fichas, enPlato) {
  const marcador = raiz.querySelector('[data-desfase]');
  if (!marcador) return;
  const suenanLosDos = enPlato.a?.sonando && enPlato.b?.sonando;
  const desfase = suenanLosDos && fichas.a?.rejilla && fichas.b?.rejilla
    ? desfaseEntre(
      { tiempo: enPlato.b.tiempo, rejilla: fichas.b.rejilla },
      { tiempo: enPlato.a.tiempo, rejilla: fichas.a.rejilla },
    )
    : null;
  if (desfase === null) {
    marcador.textContent = '—';
    marcador.className = 'desfase';
    return;
  }
  const ms = Math.round(desfase * 1000);
  marcador.textContent = `${ms > 0 ? '+' : ''}${ms} ms`;
  marcador.className = `desfase${Math.abs(ms) <= 12 ? ' cuadrado' : ''}`;
}

/** El tempo del plato A cambia al mezclar: la cabecera lo dice sin repintar todo. */
function pintarDatosDelPlatoA(raiz, ficha, estado) {
  const datos = raiz.querySelector('[data-datos="A"]');
  if (!datos || !ficha || !estado) return;
  const ajuste = Math.round((estado.velocidad - 1) * 1000) / 10;
  datos.textContent = [
    ficha.bpm ? `${conComa(ficha.bpm * estado.velocidad)} bpm` : 'sin tempo',
    ficha.tonalidad || ficha.key || 'sin tonalidad',
    ajuste ? formatPorcentaje(ajuste) : 'a su tempo',
    // Lo que dice de la rejilla también, que si no el bucle se lo comía en el
    // primer cuadro y el aviso solo se veía un instante.
    fiabilidad(ficha.rejilla, ficha),
  ].filter(Boolean).join(' · ');
}

/**
 * Monta la cabina: engancha los lienzos, el arrastre y el bucle de pintado.
 *
 * El bucle se para solo al salir de la pantalla —mira si sus lienzos siguen en
 * el documento—, así que no hay que acordarse de apagarlo.
 */
export function montarCabina(raiz) {
  cancelarBucle();
  const zoomA = lienzo(raiz, 'zoom-a');
  if (!zoomA) return;

  for (const cual of ['a', 'b']) {
    const ampliada = lienzo(raiz, `zoom-${cual}`);
    if (ampliada) {
      ampliada.addEventListener('pointerdown', (evento) => empezarArrastre(evento, ampliada, cual));
    }
    const general = lienzo(raiz, `general-${cual}`);
    if (general) {
      general.addEventListener('pointerdown', (evento) => {
        const ficha = fichaDelPlato(cual);
        const duracion = ficha?.duracion || ondaCargada(ficha?.id)?.duracion || 0;
        if (!duracion) return;
        acciones.saltar?.(cual, segundoEnLaGeneral(general, evento, duracion));
      });
    }
  }

  const dibujar = () => {
    if (!zoomA.isConnected) {
      bucle = null;
      return;
    }
    pintarCuadro(raiz);
    bucle = requestAnimationFrame(dibujar);
  };
  bucle = requestAnimationFrame(dibujar);
}

export function cancelarBucle() {
  if (bucle) cancelAnimationFrame(bucle);
  bucle = null;
}

/**
 * Arrastrar una onda es empujar el plato.
 *
 * En el que suena, el arrastre se traduce en un empujón —acelerar o frenar un
 * pelo— porque saltar sonaría a corte. En el que preparas, que está parado, se
 * mueve y ya está.
 */
function empezarArrastre(evento, canvas, cual) {
  const ficha = fichaDelPlato(cual);
  if (!ficha?.id) return;
  // El ancho se guarda AQUÍ y no se vuelve a preguntar. Si la cabina se repinta
  // a mitad de arrastre —al entrar una transición, por ejemplo—, el lienzo que
  // se estaba arrastrando queda fuera del documento y su ancho pasa a ser cero:
  // con el `|| 1` de antes, cada píxel de ratón valía ocho segundos y el plato
  // se desbocaba o saltaba al final de la canción.
  arrastre = { cual, canvas, desde: evento.clientX, ancho: canvas.getBoundingClientRect().width };
  if (!(arrastre.ancho > 0)) { arrastre = null; return; }
  canvas.setPointerCapture?.(evento.pointerId);
  canvas.classList.add('arrastrando');
}

function seguirArrastre(evento) {
  if (!arrastre) return;
  const { canvas, cual, ancho } = arrastre;
  // Y si el lienzo ha dejado de estar en la página, el arrastre se acabó.
  if (!canvas.isConnected) return terminarArrastre();
  const porPixel = zoom / ancho;
  const delta = (arrastre.desde - evento.clientX) * porPixel;
  if (Math.abs(delta) < 0.003) return undefined;
  arrastre.desde = evento.clientX;
  return acciones.empujar?.(cual, delta);
}

function terminarArrastre() {
  if (!arrastre) return;
  arrastre.canvas.classList.remove('arrastrando');
  arrastre = null;
}

document.addEventListener('pointermove', seguirArrastre);
document.addEventListener('pointerup', terminarArrastre);
document.addEventListener('pointercancel', terminarArrastre);

/** El zoom de las vistas ampliadas. */
export function cambiarZoom(segundos) {
  zoom = ZOOMS.includes(Number(segundos)) ? Number(segundos) : 8;
  return zoom;
}

export const zoomActual = () => zoom;

/* --------------------------------------------------------------- progreso */

/** La rejilla de compases de la transición, si hay una en marcha. */
export function refrescarProgreso(mezcla) {
  const enCurso = mezcla === undefined ? estadoDeMezcla().enCurso : mezcla;
  const rejilla = document.querySelector('#rejilla-compases');
  if (!rejilla || !enCurso) return;
  const { plan } = enCurso;
  const desdeElLanzamiento = (Date.now() - enCurso.desde) / 1000;
  const espera = enCurso.espera || 0;
  const transcurrido = desdeElLanzamiento - espera;
  const compasActual = Math.floor(transcurrido / plan.compasSegundos);

  [...rejilla.children].forEach((celda, i) => {
    celda.classList.toggle('pasado', i < compasActual);
    celda.classList.toggle('ahora', i === compasActual);
  });

  const texto = document.querySelector('#mezcla-estado');
  if (!texto) return;
  const alCambio = plan.cambioDeGraves
    ? Math.ceil((plan.cambioDeGraves - transcurrido) / plan.compasSegundos)
    : 0;
  if (transcurrido < 0) {
    texto.textContent = `Entra en ${(-transcurrido).toFixed(1)} s · ${plan.porFrases ? 'al empezar la frase' : 'al empezar el compás'}`;
  } else if (alCambio > 0) {
    texto.textContent = `Compás ${Math.min(compasActual + 1, plan.compases)} de ${plan.compases} · cambio de graves en ${alCambio === 1 ? 'un compás' : `${alCambio} compases`}`;
  } else {
    texto.textContent = `Compás ${Math.min(compasActual + 1, plan.compases)} de ${plan.compases} · graves cambiados`;
  }
}

export const vistaDelMezclador = () => state.view.type === 'mezclador';
