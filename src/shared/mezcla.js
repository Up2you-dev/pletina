import { duracionDeCompases, siguienteCompas } from './beats.js';
import { tonalidadesCompatibles } from './musica.js';

/**
 * El plan de una mezcla.
 *
 * Aquí no suena nada: esto decide QUÉ tiene que pasar y CUÁNDO, y devuelve una
 * lista de eventos que el motor de audio ejecuta al pie de la letra. Separarlo
 * así es lo que permite probar una transición de discoteca sin altavoces: se
 * mira el plan y se comprueba que los graves se cambian en el compás correcto.
 *
 * La coreografía por defecto es la que hace cualquier pinchadiscos con dos
 * platos: la canción que entra lo hace SIN graves —dos bombos a la vez suenan a
 * barro—, sube de volumen durante la primera mitad y, justo en un inicio de
 * compás, se hace el cambio: se le quitan los graves a la que sale y se le
 * devuelven a la que entra. A partir de ahí la saliente se apaga.
 */

export const ESTILOS = {
  bombo: 'Cambio de graves',
  fundido: 'Fundido largo',
  corte: 'Corte en el compás',
};

/** Cuánto se puede estirar el tempo antes de que se note. */
export const LIMITE_AJUSTE = 0.12;

/** Decibelios a los que se considera que un grave está fuera. */
export const GRAVE_FUERA = -26;

const redondear = (v) => Math.round(v * 1000) / 1000;

/**
 * @param {object} opciones
 * @param {object} opciones.saliente  bpm, rejilla, posicion (segundo actual), duracion, key
 * @param {object} opciones.entrante  bpm, rejilla, duracion, key
 * @param {number} opciones.compases  longitud de la transición
 * @param {string} opciones.estilo    bombo | fundido | corte
 */
export function planDeMezcla({
  saliente,
  entrante,
  compases = 8,
  estilo = 'bombo',
  ajustarTempo = true,
  entradaEntrante = 0,
  limite = LIMITE_AJUSTE,
} = {}) {
  const avisos = [];
  const bpmSale = Number(saliente?.bpm) || 0;
  const bpmEntra = Number(entrante?.bpm) || 0;

  /* ---- tempo ---- */
  let velocidad = 1;
  let sincronizado = false;
  if (ajustarTempo && bpmSale && bpmEntra) {
    let razon = bpmSale / bpmEntra;
    // Medio tempo y doble tempo son el mismo pulso: se busca el más cercano a 1.
    for (const factor of [0.5, 2]) {
      if (Math.abs(razon * factor - 1) < Math.abs(razon - 1)) razon *= factor;
    }
    if (Math.abs(razon - 1) <= limite) {
      velocidad = redondear(razon);
      sincronizado = true;
    } else {
      avisos.push(`Los tempos están demasiado lejos (${Math.round(bpmSale)} y ${Math.round(bpmEntra)}): se mezcla sin ajustar.`);
    }
  } else if (ajustarTempo) {
    avisos.push('Falta el tempo de alguna de las dos: analízalas para que se sincronicen.');
  }

  /* ---- tonalidad ---- */
  if (saliente?.key && entrante?.key && !tonalidadesCompatibles(saliente.key, entrante.key)) {
    avisos.push(`Las tonalidades chocan (${saliente.key} y ${entrante.key}): la mezcla puede sonar tensa.`);
  }

  /* ---- cuándo y cuánto ---- */
  const tempoReferencia = bpmSale || bpmEntra || 120;
  const duracion = redondear(duracionDeCompases(tempoReferencia, compases));
  const posicion = Number(saliente?.posicion) || 0;
  // El pinchazo cae en un inicio de compás de la que está sonando.
  const arranque = saliente?.rejilla?.bpm
    ? redondear(siguienteCompas(posicion + 0.25, saliente.rejilla))
    : redondear(posicion + 0.25);

  // Y la que entra empieza en SU inicio de compás, para que los unos coincidan.
  const inicioEntrante = entrante?.rejilla?.bpm
    ? redondear(siguienteCompas(entradaEntrante, entrante.rejilla))
    : redondear(entradaEntrante);

  const restante = Number(saliente?.duracion)
    ? redondear(saliente.duracion - arranque)
    : Infinity;
  if (restante < duracion) {
    avisos.push('La canción que sale se acaba antes de terminar la transición: se acorta.');
  }
  const duracionReal = Math.max(1, Math.min(duracion, restante));

  /* ---- la coreografía ---- */
  const eventos = [];
  const en = (t) => redondear(Math.min(duracionReal, Math.max(0, t)));
  const mitad = en(duracionReal / 2);
  const tiempo = 60 / tempoReferencia;

  if (estilo === 'corte') {
    // Corte seco en el compás: nada de fundidos, cambio limpio.
    eventos.push({ en: 0, plato: 'entrante', parametro: 'ganancia', a: 1, rampa: 0.05 });
    eventos.push({ en: 0, plato: 'saliente', parametro: 'ganancia', a: 0, rampa: 0.05 });
  } else if (estilo === 'fundido') {
    eventos.push({ en: 0, plato: 'entrante', parametro: 'ganancia', desde: 0, a: 1, rampa: duracionReal, curva: 'potencia' });
    eventos.push({ en: 0, plato: 'saliente', parametro: 'ganancia', a: 0, rampa: duracionReal, curva: 'potencia' });
  } else {
    // Cambio de graves, la mezcla de siempre.
    eventos.push({ en: 0, plato: 'entrante', parametro: 'grave', a: GRAVE_FUERA, rampa: 0.05 });
    eventos.push({ en: 0, plato: 'entrante', parametro: 'ganancia', desde: 0, a: 1, rampa: en(duracionReal * 0.45), curva: 'potencia' });
    // El cambio ocurre en un solo tiempo, seco, a mitad de transición.
    eventos.push({ en: mitad, plato: 'saliente', parametro: 'grave', a: GRAVE_FUERA, rampa: tiempo });
    eventos.push({ en: mitad, plato: 'entrante', parametro: 'grave', a: 0, rampa: tiempo });
    // Y la saliente se va por arriba en la segunda mitad.
    eventos.push({ en: mitad, plato: 'saliente', parametro: 'medio', a: -6, rampa: en(duracionReal - mitad) });
    eventos.push({ en: mitad, plato: 'saliente', parametro: 'ganancia', a: 0, rampa: en(duracionReal - mitad), curva: 'potencia' });
  }

  // Al terminar, la que entra queda como una canción normal.
  eventos.push({ en: duracionReal, plato: 'entrante', parametro: 'grave', a: 0, rampa: 0.05 });
  eventos.push({ en: duracionReal, plato: 'entrante', parametro: 'ganancia', a: 1, rampa: 0.05 });
  eventos.sort((a, b) => a.en - b.en);

  return {
    velocidad,
    sincronizado,
    arranque,
    inicioEntrante,
    duracion: duracionReal,
    compases,
    estilo,
    cambioDeGraves: estilo === 'bombo' ? mitad : null,
    eventos,
    avisos,
  };
}

/** Resumen corto para enseñar en la interfaz antes de lanzar la mezcla. */
export function describirPlan(plan) {
  if (!plan) return '';
  const partes = [`${plan.compases} compases`, ESTILOS[plan.estilo] ?? plan.estilo];
  if (plan.sincronizado) {
    const porcentaje = Math.round((plan.velocidad - 1) * 1000) / 10;
    partes.push(porcentaje === 0 ? 'ya van al mismo tempo' : `ajuste de tempo ${porcentaje > 0 ? '+' : ''}${porcentaje} %`);
  }
  return partes.join(' · ');
}
