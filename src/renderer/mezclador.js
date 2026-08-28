import { LIMITE_AJUSTE, daTiempoAMezclar, describirPlan, planDeMezcla } from '../shared/mezcla.js';
import {
  analizada, duracionDeCompases, rejillaVigente, siguienteCompas,
} from '../shared/beats.js';
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
};

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
  return state.tracks.filter((track) => !track.missing && !analizada(track)).length;
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
      bpm: entrante.bpm,
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
  return { ...preparado, ficha: fichaDeMezcla(preparado.id) };
}

/**
 * Salta el plato B compases enteros. Con la rejilla puesta es exacto: no se
 * mueve «un poco», se mueve un compás.
 */
export function saltarCompasesEnB(compases) {
  const actual = platoB();
  if (!actual?.ficha) return false;
  const rejilla = actual.ficha.rejilla;
  const compas = rejilla?.bpm
    ? duracionDeCompases(rejilla.bpm, 1, rejilla.tiemposPorCompas ?? 4)
    : 2;
  const hecho = player.moverPreparado(Math.max(0, actual.tiempo + compas * compases));
  if (hecho) avisar();
  return hecho;
}

/**
 * Mueve el «uno» de la rejilla al punto donde está parado el plato B.
 *
 * El detector acierta casi siempre con el pulso y falla más con el uno: hay
 * canciones cuyo primer golpe fuerte no es el que parece, y con el uno mal la
 * mezcla entra a contratiempo por muy afinado que esté el tempo. Esto lo
 * arregla mirando la onda, que es como se arregla en una cabina.
 */
export async function ponerElUnoEnB() {
  const actual = platoB();
  const rejilla = actual?.ficha?.rejilla;
  if (!rejilla?.bpm) return { ok: false, motivo: 'Esa canción no tiene rejilla que mover.' };

  const periodo = 60 / rejilla.bpm;
  const compas = periodo * (rejilla.tiemposPorCompas ?? 4);
  // El desfase se guarda dentro de un tiempo, y el uno pasa a ser este punto.
  const offset = ((actual.tiempo % periodo) + periodo) % periodo;
  await window.pletina.track.rejilla(actual.id, { offset, tiempoFuerte: 0, compasFuerte: 0 });
  const track = getTrack(actual.id);
  if (track?.rejilla) {
    track.rejilla = {
      ...track.rejilla, offset, tiempoFuerte: 0, compasFuerte: 0, aMano: true,
    };
  }
  // Y el plato se coloca en ese mismo uno, que es donde el usuario lo ha puesto.
  player.moverPreparado(siguienteCompas(actual.tiempo - compas / 2, track?.rejilla ?? rejilla));
  avisar();
  return { ok: true };
}

/**
 * Cuenta el tempo del plato B al doble o a la mitad.
 *
 * Hay ritmos que se pueden contar de las dos maneras y las dos son ciertas: un
 * drum & bass son 174 o son 87, un hip-hop de bombo espaciado son 87 o son 174.
 * El análisis elige la lectura más habitual, y a veces se equivoca. Esto no
 * vuelve a analizar nada ni mueve un golpe de sitio: solo cambia la cuenta, con
 * la rejilla anclada en el «uno» que ya está puesto.
 */
export async function cambiarOctavaEnB(factor) {
  const actual = platoB();
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
  };
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
