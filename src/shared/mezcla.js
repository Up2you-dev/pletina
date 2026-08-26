import { duracionDeCompases, siguienteCompas, siguienteFrase } from './beats.js';
import { formatPorcentaje } from './format.js';
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

/** Y cuánto se le baja a los medios de la que entra hasta el cambio. */
export const MEDIO_FUERA = -4;

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
  velocidadSaliente = 1,
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
      // Sin redondear a milésimas: una milésima de más son siete milisegundos
      // de desfase al final de una transición de ocho compases.
      velocidad = Math.round(razon * 1e6) / 1e6;
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
  const compasSegundos = duracionDeCompases(tempoReferencia, 1);
  const duracion = redondear(duracionDeCompases(tempoReferencia, compases));
  const posicion = Number(saliente?.posicion) || 0;

  // Un pinchadiscos no entra en cualquier compás: entra al empezar la frase.
  // Si las dos canciones la tienen clara y la transición mide frases enteras,
  // se pincha en frase; si no, en compás, que sigue siendo cuadrado.
  const porFrases = compases % 4 === 0
    && (saliente?.rejilla?.fuerzaFrase ?? 0) > 0
    && (entrante?.rejilla?.fuerzaFrase ?? 0) > 0;
  const cuando = porFrases ? siguienteFrase : siguienteCompas;

  const arranque = saliente?.rejilla?.bpm
    ? redondear(cuando(posicion + 0.25, saliente.rejilla))
    : redondear(posicion + 0.25);

  // Y la que entra empieza en SU sitio, para que los unos coincidan. El margen
  // de sesenta milisegundos evita perder un compás entero cuando el instante en
  // el que empieza a sonar cae un pelo después de uno.
  const inicioEntrante = entrante?.rejilla?.bpm
    ? redondear(cuando(Math.max(0, entradaEntrante - 0.06), entrante.rejilla))
    : redondear(entradaEntrante);

  // De aquí en adelante, todo en segundos de reloj. Lo que le queda a un
  // archivo no es lo que le queda a la sala: un plato ajustado un 10 % gasta su
  // último minuto en cincuenta y cuatro segundos.
  const restante = Number(saliente?.duracion)
    ? redondear((saliente.duracion - arranque) / (velocidadSaliente || 1))
    : Infinity;
  if (restante < duracion) {
    avisos.push('La canción que sale se acaba antes de terminar la transición: se acorta.');
  }
  // Y lo mismo por el otro lado: si la que entra es corta —una intro, un
  // interludio—, la transición no puede durar más que ella.
  const cabeEntrante = Number(entrante?.duracion)
    ? redondear((entrante.duracion - inicioEntrante) / (velocidad || 1))
    : Infinity;
  if (cabeEntrante < duracion) {
    avisos.push('La canción que entra es más corta que la transición: se acorta.');
  }
  // Acortar sí, descuadrar no: lo que se recorta se recorta por compases.
  const bruto = Math.min(duracion, restante, cabeEntrante);
  const enCompases = compasSegundos > 0 ? Math.floor(bruto / compasSegundos) * compasSegundos : 0;
  const duracionReal = redondear(Math.max(1, enCompases || bruto));

  /* ---- la coreografía ---- */
  const eventos = [];
  const en = (t) => redondear(Math.min(duracionReal, Math.max(0, t)));
  const tiempo = 60 / tempoReferencia;
  // El cambio de graves también cae en un inicio de compás: a mitad de
  // transición, sí, pero al compás más cercano y nunca entre dos.
  const mitad = compasSegundos > 0
    ? en(Math.max(compasSegundos, Math.round(duracionReal / 2 / compasSegundos) * compasSegundos))
    : en(duracionReal / 2);

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
    // Y un pellizco a los medios de la que entra hasta el cambio: es donde
    // viven las voces, y dos voces a la vez se pelean.
    eventos.push({ en: 0, plato: 'entrante', parametro: 'medio', a: MEDIO_FUERA, rampa: 0.05 });
    eventos.push({ en: 0, plato: 'entrante', parametro: 'ganancia', desde: 0, a: 1, rampa: en(duracionReal * 0.45), curva: 'potencia' });
    // El cambio ocurre en un solo tiempo, seco, a mitad de transición.
    eventos.push({ en: mitad, plato: 'saliente', parametro: 'grave', a: GRAVE_FUERA, rampa: tiempo });
    eventos.push({ en: mitad, plato: 'entrante', parametro: 'grave', a: 0, rampa: tiempo });
    eventos.push({ en: mitad, plato: 'entrante', parametro: 'medio', a: 0, rampa: tiempo });
    // Y la saliente se va por arriba en la segunda mitad.
    eventos.push({ en: mitad, plato: 'saliente', parametro: 'medio', a: -6, rampa: en(duracionReal - mitad) });
    eventos.push({ en: mitad, plato: 'saliente', parametro: 'ganancia', a: 0, rampa: en(duracionReal - mitad), curva: 'potencia' });
  }

  // Al terminar, la que entra queda como una canción normal.
  eventos.push({ en: duracionReal, plato: 'entrante', parametro: 'grave', a: 0, rampa: 0.05 });
  eventos.push({ en: duracionReal, plato: 'entrante', parametro: 'medio', a: 0, rampa: 0.05 });
  eventos.push({ en: duracionReal, plato: 'entrante', parametro: 'ganancia', a: 1, rampa: 0.05 });
  eventos.sort((a, b) => a.en - b.en);

  return {
    velocidad,
    sincronizado,
    arranque,
    inicioEntrante,
    duracion: duracionReal,
    // La que se pidió, sin recortar por el final de la canción. Quien decida
    // CUÁNDO lanzar la mezcla tiene que mirar esta: si mira la recortada, cada
    // vuelta la acorta un poco más y acaba mezclando en un compás.
    duracionPlena: duracion,
    compases: compasSegundos > 0 ? Math.max(1, Math.round(duracionReal / compasSegundos)) : compases,
    compasSegundos: redondear(compasSegundos),
    porFrases,
    estilo,
    cambioDeGraves: estilo === 'bombo' ? mitad : null,
    eventos,
    avisos,
  };
}

/** Resumen corto para enseñar en la interfaz antes de lanzar la mezcla. */
export function describirPlan(plan) {
  if (!plan) return '';
  const partes = [
    `${plan.compases} compases`,
    plan.porFrases ? 'en frase' : 'en compás',
    ESTILOS[plan.estilo] ?? plan.estilo,
  ];
  if (plan.sincronizado) {
    const porcentaje = Math.round((plan.velocidad - 1) * 1000) / 10;
    partes.push(porcentaje === 0 ? 'ya van al mismo tempo' : `ajuste de tempo ${formatPorcentaje(porcentaje)}`);
  }
  return partes.join(' · ');
}
