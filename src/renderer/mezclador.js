import { describirPlan, planDeMezcla } from '../shared/mezcla.js';
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
  return {
    id,
    titulo: track.title,
    artista: track.artist,
    coverId: track.coverId,
    duracion: track.duration || 0,
    bpm: track.bpm || 0,
    key: track.key || '',
    tonalidad: track.tonalidad || '',
    rejilla: track.rejilla ?? null,
    analizada: Boolean(track.bpm && track.rejilla),
  };
}

/** La que sonará después, sin tocar la cola. */
export function siguienteEnLaCola() {
  const resultado = advance(state.queue, { repeat: state.repeat, auto: true });
  return resultado.id && !resultado.restart ? resultado.id : null;
}

/**
 * Prepara el plan con lo que hay ahora mismo: qué suena, por dónde va y qué
 * viene después. No cambia nada; sirve para enseñarlo antes de lanzarlo.
 */
export function prepararPlan(idEntrante = siguienteEnLaCola()) {
  const salienteId = state.currentId;
  if (!salienteId || !idEntrante || salienteId === idEntrante) return null;

  const saliente = fichaDeMezcla(salienteId);
  const entrante = fichaDeMezcla(idEntrante);
  if (!saliente || !entrante) return null;

  const { tiempo, velocidad } = player.platoActivo();
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
    compases: ajustes.compases,
    estilo: ajustes.estilo,
    ajustarTempo: ajustes.ajustarTempo,
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

/** ¿Se puede mezclar ahora mismo? */
export function puedeMezclar() {
  if (!state.currentId || !state.playing) return { puede: false, motivo: 'No hay nada sonando.' };
  if (player.mezclando()) return { puede: false, motivo: 'Ya hay una mezcla en marcha.' };
  if (!player.hayMotor()) return { puede: false, motivo: 'Este equipo no permite mezclar.' };
  if (!siguienteEnLaCola()) return { puede: false, motivo: 'No hay ninguna canción esperando en la cola.' };
  return { puede: true };
}

/** Lanza la mezcla. Devuelve el plan ejecutado o un motivo por el que no. */
export function mezclarAhora(idEntrante = siguienteEnLaCola()) {
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
  avisar();
  setTimeout(() => {
    enCurso = null;
    avisar();
  }, (preparado.espera + preparado.plan.duracion + 0.4) * 1000);
  return { ok: true, ...preparado };
}

export function estadoDeMezcla() {
  return {
    enCurso,
    ajustes: state.mezclador,
    disponible: puedeMezclar(),
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
  // Hay que lanzarla con tiempo para la espera hasta el compás y para la
  // transición entera; si no, la saliente se acaba a media mezcla.
  return preparado.espera + preparado.plan.duracion + 0.5;
}
