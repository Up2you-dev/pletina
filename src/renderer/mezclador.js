import { LIMITE_AJUSTE, daTiempoAMezclar, describirPlan, planDeMezcla } from '../shared/mezcla.js';
import {
  analizada, anclarElUno, duracionDeCompases, golpeMasCercano, rejillaVigente, siguienteCompas,
  tempoDeGolpes,
} from '../shared/beats.js';
import { esReproducible, nombreDeFormato } from '../shared/audio-files.js';
import { tonalidadesCompatibles } from '../shared/musica.js';
import { advance } from '../shared/queue.js';
import { getTrack, state } from './state.js';
import * as player from './player.js';

/**
 * El mezclador.
 *
 * Es una unidad con entidad propia y no un interruptor del reproductor: tiene
 * su estado, su vista, sus ajustes y su propio criterio sobre cuándo se puede
 * mezclar y cuándo no. El reproductor le presta los dos platos; el resto —qué
 * canción entra, a qué velocidad, en qué compás y cómo se cruzan los graves—
 * se decide aquí.
 *
 * Lo que no hace: inventarse datos. Si a una canción le falta el análisis, el
 * mezclador lo dice y ofrece analizarla, en vez de pinchar a ciegas.
 */

export const AJUSTES_POR_DEFECTO = {
  auto: false,
  compases: 8,
  estilo: 'bombo',
  ajustarTempo: true,
  estirarTiempo: true,
  /** Hasta dónde llega el fader de tempo, en tanto por ciento. */
  rangoFader: 10,
  /** Cuántos tiempos salta el botón de salto. */
  salto: 4,
  /** Cuántos compases dura el bucle que se abre con un clic. */
  bucle: 4,
};

/** Los recorridos de fader de siempre: el de vinilo, el de CD y el largo. */
export const RANGOS_FADER = [6, 10, 16];
/** Tamaños de salto, en tiempos. Cuatro tiempos es un compás. */
export const SALTOS = [1, 4, 8, 16, 32];
/** Bucles, en compases. */
export const BUCLES = [1, 2, 4, 8, 16];
/** Puntos de referencia por canción. */
export const CUES = 4;

const oyentes = new Set();
let enCurso = null;

export function alCambiarMezclador(oyente) {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}

function avisar() {
  for (const oyente of oyentes) oyente(estadoDeMezcla());
}

/** Lo que hace falta saber de una canción para poder mezclarla. */
export function fichaDeMezcla(id) {
  const track = getTrack(id);
  if (!track) return null;
  // Una rejilla vieja no se usa a medias: o sirve para pinchar o no está. Si se
  // usara, el mezclador diría que no está analizada y pincharía igualmente con
  // los datos malos.
  const rejilla = rejillaVigente(track.rejilla) ? track.rejilla : null;
  return {
    id,
    titulo: track.title,
    artista: track.artist,
    coverId: track.coverId,
    duracion: track.duration || 0,
    // El tempo que manda es el de la rejilla: el del detector es un punto de
    // partida y el de la rejilla es el que hace que los golpes caigan en su
    // sitio del primer minuto al último.
    bpm: rejilla?.bpm || track.bpm || 0,
    key: track.key || '',
    tonalidad: track.tonalidad || '',
    rejilla,
    conFrase: (rejilla?.fuerzaFrase ?? 0) > 0,
    analizada: rejillaVigente(rejilla),
    // Analizada de verdad, pero sin rejilla que valga: tiene tempo y no tiene
    // pulso con el que pinchar en el compás. No es lo mismo que estar sin
    // analizar, y ofrecer «Analizar» aquí manda a repetir un trabajo que ya se
    // hizo y va a salir igual.
    sinPulso: analizada(track) && !rejillaVigente(rejilla),
    // Y si este equipo no sabe decodificar el formato, se dice: es la
    // diferencia entre «pulsa Analizar» —que no va a servir de nada— y saber
    // por qué esta canción no va a tener rejilla nunca.
    formatoMudo: esReproducible(track) ? '' : nombreDeFormato(track),
  };
}

/** La que sonará después, sin tocar la cola. */
export function siguienteEnLaCola() {
  const resultado = advance(state.queue, { repeat: state.repeat, auto: true });
  return resultado.id && !resultado.restart ? resultado.id : null;
}

/**
 * Qué va a entrar: lo que haya cargado en el plato B y, si no hay nada, lo
 * siguiente de la cola.
 *
 * Este orden es la diferencia entre un reproductor y una cabina. En un
 * reproductor manda la lista; en una cabina mandas tú, y la lista es solo lo
 * que hay si no dices otra cosa.
 */
export function entranteElegida() {
  return player.estadoPreparado().id || siguienteEnLaCola();
}

/** Carga una canción en el plato B, por donde empiece a sonar de verdad. */
export function cargarEnPlatoB(id, { en } = {}) {
  // Los golpecitos eran para la canción de antes.
  olvidarGolpes();
  const ficha = fichaDeMezcla(id);
  if (!ficha) return { ok: false, motivo: 'Esa canción ya no está.' };
  if (player.mezclando()) return { ok: false, motivo: 'Espera a que termine la mezcla.' };
  if (id === state.currentId) return { ok: false, motivo: 'Esa es la que está sonando.' };
  const entrada = Number.isFinite(en) ? en : (ficha.rejilla?.entrada ?? 0);
  if (!player.prepararPlato(id, { en: entrada })) {
    return { ok: false, motivo: 'Este equipo no permite preparar el segundo plato.' };
  }
  avisar();
  return { ok: true, ficha, en: entrada };
}

/** Deja el plato B libre. */
export function soltarPlatoB() {
  const hecho = player.soltarPreparado();
  if (hecho) avisar();
  return hecho;
}

/**
 * Qué pinchar después.
 *
 * Ordenado como lo pensaría un pinchadiscos: primero lo que encaja de
 * tonalidad, luego lo que menos hay que estirar, y fuera lo que no se puede
 * cuadrar sin que se note. No es «la siguiente de la lista», es un abanico.
 */
/**
 * Cuánto se parecen dos canciones a efectos de pincharlas seguidas.
 *
 * El tempo, contando con que media velocidad y el doble también cuadran; y si
 * las tonalidades se llevan bien. `cuadra` es si se puede sin que se note el
 * estirón.
 */
function encajeCon(sonando, ficha) {
  if (!sonando?.bpm || !ficha?.bpm) return { ajuste: null, armonica: false, cuadra: false };
  let razon = sonando.bpm / ficha.bpm;
  for (const factor of [0.5, 2]) {
    if (Math.abs(razon * factor - 1) < Math.abs(razon - 1)) razon *= factor;
  }
  const ajuste = Math.abs(razon - 1);
  return {
    ajuste,
    armonica: Boolean(sonando.key && ficha.key && tonalidadesCompatibles(sonando.key, ficha.key)),
    cuadra: ajuste <= LIMITE_AJUSTE,
  };
}

/**
 * Qué se puede pinchar después de lo que suena.
 *
 * Sin buscar nada, sugiere: lo que encaja de tonalidad primero y luego lo que
 * menos hay que estirar. Con una búsqueda, manda la búsqueda y no el criterio
 * —sale lo que se pide, cuadre o no, esté analizado o no—, porque una lista
 * cerrada de la que uno no conoce el criterio no es una ayuda: es un muro.
 */
export function candidatos({ cuantos = 14, busqueda = '' } = {}) {
  const sonando = fichaDeMezcla(state.currentId);
  const enPlatoB = player.estadoPreparado().id;
  const texto = busqueda.trim().toLowerCase();
  // Sin nada sonando no hay con qué comparar, y sugerir por sugerir sería
  // inventarse un criterio. Buscando, en cambio, siempre se puede buscar.
  if (!texto && !sonando?.bpm) return [];

  const lista = [];
  for (const track of state.tracks) {
    if (track.id === state.currentId || track.id === enPlatoB) continue;
    if (texto) {
      const donde = `${track.title ?? ''} ${track.artist ?? ''} ${track.album ?? ''}`.toLowerCase();
      if (!donde.includes(texto)) continue;
    } else if (!analizada(track) || !track.bpm) continue;

    const ficha = fichaDeMezcla(track.id);
    if (!ficha) continue;
    const encaje = encajeCon(sonando, ficha);
    if (!texto && !encaje.cuadra) continue;

    lista.push({
      ...ficha,
      ...encaje,
      // La tonalidad pesa más que el tempo: estirar un 3 % no se oye, y una
      // tonalidad que choca sí. Lo que no cuadra va al final, pero va.
      puntos: (encaje.armonica ? 2 : 0)
        + (encaje.ajuste == null ? -1 : (encaje.cuadra ? 1 - encaje.ajuste / LIMITE_AJUSTE : -encaje.ajuste)),
    });
  }
  return lista.sort((a, b) => b.puntos - a.puntos).slice(0, cuantos);
}

/**
 * Cuántas canciones de la biblioteca están sin analizar.
 *
 * La cabina lo enseña para poder analizarlas desde aquí: sin análisis no hay
 * sugerencias, y descubrirlo yendo a la biblioteca es un viaje de más.
 */
export function pendientesDeAnalizar() {
  // Sin contar las que este equipo no puede decodificar: el contador no bajaba
  // nunca y el aviso de «biblioteca sin analizar» se quedaba fijo para siempre.
  return state.tracks.filter(
    (track) => !track.missing && esReproducible(track) && !analizada(track),
  ).length;
}

/**
 * Prepara el plan con lo que hay ahora mismo: qué suena, por dónde va y qué
 * viene después. No cambia nada; sirve para enseñarlo antes de lanzarlo.
 */
export function prepararPlan(idEntrante = entranteElegida()) {
  const salienteId = state.currentId;
  if (!salienteId || !idEntrante || salienteId === idEntrante) return null;

  const saliente = fichaDeMezcla(salienteId);
  const entrante = fichaDeMezcla(idEntrante);
  if (!saliente || !entrante) return null;

  const { tiempo, velocidad } = player.platoActivo();
  const preparado = player.estadoPreparado();
  const ajustes = state.mezclador;
  const plan = planDeMezcla({
    saliente: {
      // El tempo que suena, no el del archivo: si esta canción entró con ajuste
      // en la mezcla anterior, va más rápida y encadenar sobre su bpm original
      // desincronizaría la siguiente.
      bpm: saliente.bpm * velocidad,
      key: saliente.key,
      duracion: saliente.duracion,
      posicion: tiempo,
      rejilla: saliente.rejilla ?? { bpm: saliente.bpm, offset: 0, tiempoFuerte: 0, tiemposPorCompas: 4 },
    },
    entrante: {
      // El tempo al que YA suena el plato preparado, con su fader puesto: si se
      // ha cuadrado a mano, el plan tiene que partir de ahí y no del tempo del
      // archivo, o el ajuste se aplicaría dos veces.
      bpm: entrante.bpm * (1 + player.faderDePlato('b') / 100),
      key: entrante.key,
      duracion: entrante.duracion,
      rejilla: entrante.rejilla ?? { bpm: entrante.bpm, offset: 0, tiempoFuerte: 0, tiemposPorCompas: 4 },
    },
    // Por dónde entra la que entra: si la has colocado tú en el plato B, manda
    // eso. Si no, por donde la canción empieza a sonar de verdad, porque casi
    // ningún archivo empieza en el segundo cero y meter ese silencio en la
    // mezcla es de las cosas que más cantan.
    entradaEntrante: preparado.id === idEntrante && preparado.listo
      ? preparado.tiempo
      : (entrante.rejilla?.entrada ?? 0),
    compases: ajustes.compases,
    estilo: ajustes.estilo,
    ajustarTempo: ajustes.ajustarTempo,
    // Para convertir lo que le queda al archivo en lo que le queda a la sala.
    velocidadSaliente: velocidad,
  });

  const faltan = [saliente, entrante].filter((f) => !f.analizada);
  if (faltan.length) {
    plan.avisos.unshift(faltan.length === 2
      ? 'Ninguna de las dos está analizada: sin tempo ni rejilla, la mezcla es a ciegas.'
      : `«${faltan[0].titulo}» no está analizada: sin su rejilla no se puede pinchar en el compás.`);
  }

  // Lo que falta hasta el inicio de compás donde cae el pinchazo, en reloj real.
  const espera = Math.max(0, (plan.arranque - tiempo) / velocidad);

  return {
    plan,
    saliente,
    entrante,
    espera,
    faltan: faltan.map((f) => f.id),
    resumen: describirPlan(plan),
  };
}

/** Lo que hay ahora mismo en el plato B, con su ficha. */
export function platoB() {
  const preparado = player.estadoPreparado();
  if (!preparado.id) return null;
  const ficha = fichaDeMezcla(preparado.id);
  // Sin ficha, la canción ya no está en la biblioteca: mejor plato vacío que
  // una cabina con los botones activos sobre algo que no existe.
  if (!ficha) return null;
  return { ...preparado, ficha };
}

/**
 * Cualquiera de los dos platos, con lo que hace falta para trabajar sobre él.
 *
 * Las herramientas de precisión eran todas del plato B, y eso obligaba a
 * preparar una canción para poder corregirle la rejilla o ponerle un punto. La
 * que suena es justo la que más falta hace corregir: es la que se está oyendo.
 */
export function platoDe(cual) {
  if (cual === 'b') return platoB();
  if (!state.currentId) return null;
  const ficha = fichaDeMezcla(state.currentId);
  if (!ficha) return null;
  const { tiempo } = player.platoActivo();
  return {
    id: state.currentId, tiempo, ficha, escuchando: state.playing, listo: true,
  };
}

/**
 * Deja el plato donde se le diga.
 *
 * `cuadrar` solo cuando se está MARCANDO un sitio —un punto de referencia, el
 * principio de un bucle—, que es cuando «aquí» quiere decir «en el golpe». Un
 * salto relativo no se cuadra: adelanta un número exacto de tiempos, así que si
 * el plato estaba en la rejilla sigue estándolo, y si no, volver atrás lo deja
 * exactamente donde estaba. Cuadrando, ir y volver no devolvía al mismo sitio.
 */
function llevar(cual, segundo, rejilla, { cuadrar = false } = {}) {
  const destino = cuadrar ? golpeMasCercano(Math.max(0, segundo), rejilla) : Math.max(0, segundo);
  const hecho = player.saltarEn(cual, destino);
  if (hecho) avisar();
  return hecho;
}

/**
 * Salta compases enteros. Con la rejilla puesta es exacto: no se mueve «un
 * poco», se mueve un compás.
 */
export function saltarCompasesEn(cual, compases) {
  const actual = platoDe(cual);
  if (!actual?.ficha) return false;
  const rejilla = actual.ficha.rejilla;
  const compas = rejilla?.bpm
    ? duracionDeCompases(rejilla.bpm, 1, rejilla.tiemposPorCompas ?? 4)
    : 2;
  return llevar(cual, actual.tiempo + compas * compases, rejilla);
}

/** Y tiempos sueltos: el salto de cuatro, ocho o treinta y dos que se usa
 * para buscar la parte de la canción sin perder el compás. */
export function saltarTiemposEn(cual, tiempos) {
  const actual = platoDe(cual);
  if (!actual?.ficha) return false;
  const rejilla = actual.ficha.rejilla;
  const golpe = rejilla?.bpm ? 60 / rejilla.bpm : 0.5;
  return llevar(cual, actual.tiempo + golpe * tiempos, rejilla);
}

export function saltarCompasesEnB(compases) {
  return saltarCompasesEn('b', compases);
}

/* ------------------------------------------------ puntos de referencia */

/** Los puntos de una canción, ordenados por su número. */
export function cuesDe(id) {
  const track = getTrack(id);
  const lista = Array.isArray(track?.cues) ? track.cues : [];
  return lista
    .filter((c) => Number.isFinite(Number(c?.segundo)) && Number(c.n) >= 1 && Number(c.n) <= CUES)
    .map((c) => ({ n: Math.round(Number(c.n)), segundo: Number(c.segundo), nombre: c.nombre || '' }))
    .sort((a, b) => a.n - b.n);
}

/**
 * Pone un punto de referencia donde está el plato.
 *
 * Cuadrado al golpe más cercano, que es lo que quiere decir quien lo pone: un
 * punto quince milisegundos corrido no sirve para entrar, y a ojo sobre una
 * onda no se afina más que eso.
 */
export async function ponerCue(cual, n) {
  const actual = platoDe(cual);
  if (!actual?.id) return { ok: false, motivo: 'No hay nada en ese plato.' };
  const segundo = golpeMasCercano(actual.tiempo, actual.ficha?.rejilla);
  const guardado = await window.pletina.track.cue(actual.id, { n, segundo });
  const track = getTrack(actual.id);
  if (track) track.cues = guardado?.cues ?? track.cues;
  avisar();
  return { ok: true, segundo };
}

/** Lleva el plato a uno de sus puntos. */
export function irAlCue(cual, n) {
  const actual = platoDe(cual);
  if (!actual?.id) return false;
  const punto = cuesDe(actual.id).find((c) => c.n === n);
  if (!punto) return false;
  return llevar(cual, punto.segundo, null);
}

/** Y lo borra, que es lo que hace falta cuando se pone donde no era. */
export async function borrarCue(cual, n) {
  const actual = platoDe(cual);
  if (!actual?.id) return false;
  const guardado = await window.pletina.track.cue(actual.id, { n, segundo: null });
  const track = getTrack(actual.id);
  if (track) track.cues = guardado?.cues ?? null;
  avisar();
  return true;
}

/* ------------------------------------------------------------------ bucles */

/**
 * Abre un bucle de tantos compases desde donde está el plato.
 *
 * Cuadrado a la rejilla por los dos lados: empieza en el golpe más cercano y
 * dura un número entero de compases. Un bucle que no cuadra no es un bucle, es
 * un tartamudeo.
 */
export function abrirBucle(cual, compases) {
  const actual = platoDe(cual);
  const rejilla = actual?.ficha?.rejilla;
  if (!actual?.id) return { ok: false, motivo: 'No hay nada en ese plato.' };
  if (!rejilla?.bpm) return { ok: false, motivo: 'Sin rejilla no hay compases que repetir.' };
  const desde = golpeMasCercano(actual.tiempo, rejilla);
  const largo = duracionDeCompases(rejilla.bpm, compases, rejilla.tiemposPorCompas ?? 4);
  const puesto = player.ponerBucle(cual, desde, desde + largo, compases);
  if (!puesto) return { ok: false, motivo: 'No he podido abrir el bucle.' };
  avisar();
  return { ok: true, bucle: puesto };
}

export function cerrarBucle() {
  player.quitarBucle();
  avisar();
  return true;
}

export const bucleActual = () => player.bucleActual();

/* ------------------------------------------------------- el fader de tempo */

/** Mueve el fader de un plato, dentro del recorrido elegido. */
export function moverFader(cual, porcentaje) {
  const tope = state.mezclador.rangoFader || 10;
  return player.ajustarFader(cual, Math.max(-tope, Math.min(tope, Number(porcentaje) || 0)));
}

/** Y lo devuelve al centro: el tempo del archivo, sin tocar. */
export function faderAlCentro(cual) {
  return player.ajustarFader(cual, 0);
}

/**
 * Pone el fader del plato preparado donde haga falta para que su tempo sea el
 * del que suena. Es «igualar el tempo», pero a la vista y antes de pinchar.
 */
export function igualarTempoEnB() {
  const sonando = fichaDeMezcla(state.currentId);
  const preparado = platoB();
  if (!sonando?.bpm || !preparado?.ficha?.bpm) {
    return { ok: false, motivo: 'Hacen falta las dos analizadas para igualar el tempo.' };
  }
  const objetivo = sonando.bpm * player.platoActivo().velocidad;
  let razon = objetivo / preparado.ficha.bpm;
  // A la octava más cercana: cuadrar un drum & bass con un hip-hop es
  // multiplicar por dos, no estirar un cien por cien.
  while (razon > 1.5) razon /= 2;
  while (razon < 0.67) razon *= 2;
  const porcentaje = (razon - 1) * 100;
  const tope = state.mezclador.rangoFader || 10;
  if (Math.abs(porcentaje) > tope) {
    return {
      ok: false,
      motivo: `Harían falta ${porcentaje > 0 ? '+' : '−'}${Math.abs(porcentaje).toFixed(1)} % y el fader llega a ${tope}. Amplía el recorrido.`,
    };
  }
  player.ajustarFader('b', porcentaje);
  avisar();
  return { ok: true, porcentaje };
}

/**
 * Mueve el «uno» de la rejilla al punto donde está parado el plato B.
 *
 * El detector acierta casi siempre con el pulso y falla más con el uno: hay
 * canciones cuyo primer golpe fuerte no es el que parece, y con el uno mal la
 * mezcla entra a contratiempo por muy afinado que esté el tempo. Esto lo
 * arregla mirando la onda, que es como se arregla en una cabina.
 */
export async function ponerElUnoEn(cual = 'b') {
  const actual = platoDe(cual);
  const rejilla = actual?.ficha?.rejilla;
  if (!rejilla?.bpm) return { ok: false, motivo: 'Esa canción no tiene rejilla que mover.' };

  const periodo = 60 / rejilla.bpm;
  const compas = periodo * (rejilla.tiemposPorCompas ?? 4);
  // El uno se ancla donde está el plato, y eso no es solo el desfase: hay que
  // decir además cuál de los cuatro tiempos es el uno. Ver `anclarElUno`.
  const anclado = anclarElUno(actual.tiempo, rejilla);
  if (!anclado) return { ok: false, motivo: 'Esa canción no tiene rejilla que mover.' };
  await window.pletina.track.rejilla(actual.id, { ...anclado, compasFuerte: 0 });
  const track = getTrack(actual.id);
  if (track?.rejilla) {
    track.rejilla = {
      ...track.rejilla, ...anclado, compasFuerte: 0, aMano: true,
    };
  }
  // Y el plato se coloca en ese mismo uno, que es donde el usuario lo ha puesto.
  // En el que suena no: mover la canción que está sonando para «confirmar» algo
  // es un salto en medio de la sala.
  if (cual === 'b') {
    player.moverPreparado(siguienteCompas(actual.tiempo - compas / 2, track?.rejilla ?? rejilla));
  }
  avisar();
  return { ok: true };
}

export const ponerElUnoEnB = () => ponerElUnoEn('b');

/**
 * El empujón fino de la rejilla: unos milisegundos a un lado o a otro.
 *
 * Es lo que falta cuando el tempo está bien y el «uno» está corrido cinco
 * milisegundos: se oye como un eco, y con el ratón sobre una onda no se afina
 * tanto. Aquí no se mueve el plato, se mueve la rejilla.
 */
export async function empujarRejilla(cual, milisegundos) {
  const actual = platoDe(cual);
  const rejilla = actual?.ficha?.rejilla;
  if (!rejilla?.bpm) return { ok: false, motivo: 'Esa canción no tiene rejilla que mover.' };
  const guardada = await window.pletina.track.rejilla(actual.id, { empujon: milisegundos / 1000 });
  const track = getTrack(actual.id);
  if (track && guardada?.rejilla) track.rejilla = guardada.rejilla;
  avisar();
  return { ok: true, offset: guardada?.rejilla?.offset ?? rejilla.offset };
}

/**
 * Afina el tempo en centésimas, sin volver a analizar.
 *
 * Medio punto de tempo son dos segundos de desfase al final de una canción, y
 * el análisis puede quedarse a una centésima. Con esto se corrige oyendo, que
 * es como se corrige de verdad.
 */
export async function afinarTempo(cual, delta) {
  const actual = platoDe(cual);
  const rejilla = actual?.ficha?.rejilla;
  if (!rejilla?.bpm) return { ok: false, motivo: 'Esa canción no tiene rejilla que afinar.' };
  const bpm = Math.round((rejilla.bpm + delta) * 100) / 100;
  if (bpm < 20 || bpm > 400) return { ok: false, motivo: 'Ese ya no es un tempo que se pueda pinchar.' };
  const guardada = await window.pletina.track.rejilla(actual.id, { bpm });
  const track = getTrack(actual.id);
  if (track && guardada?.rejilla) {
    track.rejilla = guardada.rejilla;
    track.bpm = guardada.bpm ?? track.bpm;
  }
  avisar();
  return { ok: true, bpm };
}

/* --------------------------------------------------- marcar el tempo a mano */

/** Los golpecitos que lleva dados quien está marcando el tempo. */
let golpes = [];
/** Si pasa esto entre dos golpes, es que empieza a marcar de nuevo. */
const OLVIDO = 2.5;

export const golpesMarcados = () => golpes.length;

/**
 * Marca el tempo del plato B dando golpecitos.
 *
 * La salida cuando el análisis no acierta —y hay música con la que no acierta
 * nadie: un directo, una grabación vieja, algo tocado a mano—. Pone solo el
 * tempo, no el «uno»: el uno se pone con su botón, que sabe exactamente dónde
 * está el plato. Prometer las dos cosas de un golpecito sería mentir.
 */
export async function marcarTempoEn(cual = 'b') {
  const actual = platoDe(cual);
  if (!actual) return { ok: false, motivo: 'No hay nada en ese plato.' };

  const ahora = performance.now() / 1000;
  if (golpes.length && ahora - golpes[golpes.length - 1] > OLVIDO) golpes = [];
  golpes.push(ahora);

  const medido = tempoDeGolpes(golpes);
  if (!medido) return { ok: true, golpes: golpes.length, bpm: 0 };

  const guardada = await window.pletina.track.rejilla(actual.id, { bpm: medido.bpm });
  const track = getTrack(actual.id);
  if (track && guardada?.rejilla) {
    track.rejilla = guardada.rejilla;
    track.bpm = guardada.bpm ?? track.bpm;
  }
  // Sin `avisar()`: quien marca un tempo da golpes seguidos, y repintar la
  // cabina en cada uno destruye el botón bajo el dedo. Un `mousedown` en el
  // botón viejo y su `mouseup` en el nuevo ni siquiera cuentan como clic, así
  // que se perdían golpes y el tempo salía de una serie con huecos. La cabina
  // se repinta cuando se acaba la ráfaga.
  return {
    ok: true, golpes: golpes.length, bpm: medido.bpm, firme: medido.firme,
  };
}

export const marcarTempoEnB = () => marcarTempoEn('b');

/** Se olvida de los golpes: al soltar el plato o al cambiar de canción. */
export function olvidarGolpes() {
  golpes = [];
}

/** ¿Se sigue marcando el tempo ahora mismo? La cabina no repinta mientras. */
export const marcandoTempo = () => golpes.length > 0
  && performance.now() / 1000 - golpes[golpes.length - 1] < OLVIDO;

/**
 * Cuenta el tempo del plato B al doble o a la mitad.
 *
 * Hay ritmos que se pueden contar de las dos maneras y las dos son ciertas: un
 * drum & bass son 174 o son 87, un hip-hop de bombo espaciado son 87 o son 174.
 * El análisis elige la lectura más habitual, y a veces se equivoca. Esto no
 * vuelve a analizar nada ni mueve un golpe de sitio: solo cambia la cuenta, con
 * la rejilla anclada en el «uno» que ya está puesto.
 */
export async function cambiarOctavaEn(cual, factor) {
  const actual = platoDe(cual);
  const rejilla = actual?.ficha?.rejilla;
  if (!rejilla?.bpm) return { ok: false, motivo: 'Esa canción no tiene rejilla que cambiar.' };
  const bpm = rejilla.bpm * factor;
  if (bpm < 40 || bpm > 260) {
    return { ok: false, motivo: `A ${Math.round(bpm)} ya no es un tempo que se pueda pinchar.` };
  }

  const guardada = await window.pletina.track.rejilla(actual.id, { factor });
  const track = getTrack(actual.id);
  if (track && guardada?.rejilla) {
    track.rejilla = guardada.rejilla;
    track.bpm = guardada.bpm ?? track.bpm;
  }
  avisar();
  return { ok: true, bpm: guardada?.rejilla?.bpm ?? bpm };
}

export const cambiarOctavaEnB = (factor) => cambiarOctavaEn('b', factor);

/** ¿Se puede mezclar ahora mismo? */
export function puedeMezclar() {
  if (!state.currentId || !state.playing) return { puede: false, motivo: 'No hay nada sonando.' };
  if (player.mezclando()) return { puede: false, motivo: 'Ya hay una mezcla en marcha.' };
  if (!player.hayMotor()) return { puede: false, motivo: 'Este equipo no permite mezclar.' };
  const siguiente = entranteElegida();
  if (!siguiente) return { puede: false, motivo: 'Carga algo en el plato B o pon algo en la cola.' };
  // Una canción no se mezcla consigo misma: sin esto el botón se ofrecía y al
  // pulsarlo solo decía que no había podido preparar la mezcla.
  if (siguiente === state.currentId) {
    return { puede: false, motivo: 'La siguiente de la cola es la que ya está sonando.' };
  }
  // Y que quepa: la transición empieza en el siguiente compás, así que a tres
  // segundos del final el pinchazo caería después de la canción. Antes el botón
  // se ofrecía igual y al pulsarlo no pasaba nada.
  const sonando = fichaDeMezcla(state.currentId);
  if (!daTiempoAMezclar({
    duracion: sonando?.duracion,
    posicion: player.currentTime(),
    bpm: sonando?.bpm,
    tiemposPorCompas: sonando?.rejilla?.tiemposPorCompas ?? 4,
  })) {
    return { puede: false, motivo: 'A esta canción ya no le queda ni un compás: no da tiempo a mezclar.' };
  }
  return { puede: true };
}

/** Lanza la mezcla. Devuelve el plan ejecutado o un motivo por el que no. */
export function mezclarAhora(idEntrante = entranteElegida()) {
  const disponible = puedeMezclar();
  if (!disponible.puede) return { ok: false, motivo: disponible.motivo };

  const preparado = prepararPlan(idEntrante);
  if (!preparado) return { ok: false, motivo: 'No he podido preparar la mezcla.' };

  // La cola avanza a la vez que el audio: lo que entra pasa a ser lo que suena.
  const resultado = advance(state.queue, { repeat: state.repeat, auto: true });
  if (resultado.id === preparado.entrante.id) state.queue = resultado.queue;

  const lanzada = player.mezclar(preparado.entrante.id, preparado.plan, {
    estirarTiempo: state.mezclador.estirarTiempo,
  });
  if (!lanzada) return { ok: false, motivo: 'El reproductor no ha podido tomar el segundo plato.' };

  enCurso = { ...preparado, desde: Date.now() };
  const esta = enCurso;
  avisar();
  // Red de seguridad: si por lo que sea no llega el aviso de fin del
  // reproductor, la pantalla no se queda mezclando para siempre. Solo cierra la
  // suya: si ya hay otra en marcha, esta llega tarde y no le toca nada.
  setTimeout(() => {
    if (enCurso === esta) terminarMezcla();
  }, (preparado.espera + preparado.plan.duracion + 0.6) * 1000);
  return { ok: true, ...preparado };
}

/** El reproductor avisa de que la transición ha terminado (o se ha cortado). */
export function terminarMezcla() {
  if (!enCurso) return;
  enCurso = null;
  avisar();
}

export function estadoDeMezcla() {
  return {
    enCurso,
    ajustes: state.mezclador,
    disponible: puedeMezclar(),
    platoB: platoB(),
    bucle: player.bucleActual(),
    cascos: player.estadoCascos(),
    faders: { a: player.faderDePlato('a'), b: player.faderDePlato('b') },
  };
}

/* ------------------------------------------------------------------ cascos */

/**
 * Por dónde salen los auriculares.
 *
 * La lista de salidas la da el sistema y a veces sin nombre —hace falta permiso
 * de micrófono para leer las etiquetas—, así que lo que no tiene nombre se
 * numera en vez de salir en blanco.
 */
export async function salidasDeSonido() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const todos = await navigator.mediaDevices.enumerateDevices();
    return todos
      .filter((d) => d.kind === 'audiooutput')
      .map((d, i) => ({
        id: d.deviceId,
        nombre: d.label || (d.deviceId === 'default' ? 'La salida del sistema' : `Salida ${i + 1}`),
      }));
  } catch {
    return [];
  }
}

export function ajustarCascos(cambio) {
  const estado = player.ponerCascos(cambio);
  avisar();
  return estado;
}

export async function elegirSalidaDeCascos(id) {
  const hecho = await player.elegirSalidaDeCascos(id);
  avisar();
  return hecho;
}

export function cambiarAjustes(cambio) {
  state.mezclador = { ...state.mezclador, ...cambio };
  avisar();
  return state.mezclador;
}

/**
 * Momento en que hay que lanzar la mezcla automática: al plan le hace falta
 * empezar antes del final, no justo en él.
 */
export function margenAutomatico() {
  if (!state.mezclador.auto) return 0;
  const preparado = prepararPlan();
  if (!preparado) return 0;
  // Con la duración PLENA, no con la recortada: usando la recortada, cada
  // repaso adelantaba un poco menos el aviso y la mezcla automática acababa
  // durando un compás.
  return preparado.espera + (preparado.plan.duracionPlena ?? preparado.plan.duracion) + 0.5;
}
