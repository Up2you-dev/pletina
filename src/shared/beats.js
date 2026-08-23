/**
 * Dónde caen los golpes.
 *
 * Saber el tempo no basta para mezclar: hay que saber en qué instante entra el
 * bombo, y hay que saberlo con precisión de milisegundos. Un pinchazo alineado
 * al tempo pero desfasado veinte milisegundos ya no suena cuadrado, y un tempo
 * con medio punto de error acumula un segundo de desfase en tres minutos: la
 * mezcla empieza bien y termina hecha un desastre.
 *
 * Por eso aquí no se estima el tempo, se AJUSTA la rejilla: se busca el par
 * (tempo, fase) que mejor explica todos los golpes de la canción a la vez. Con
 * eso, la rejilla vale para el minuto uno y para el minuto seis.
 *
 * Todo son funciones puras sobre muestras, para poder probarlas con una caja de
 * ritmos fabricada en vez de a oído.
 */

/** El bombo vive abajo: por encima de esto ya es caja, voz o platos. */
export const GRAVE_MAX = 150;

/** Muestras por marco de envolvente. A 11 kHz son 5,8 ms de resolución. */
export const SALTO = 64;

/* ---------------------------------------------------------- envolventes */

/**
 * Paso bajo de segundo orden aplicado de ida y de vuelta.
 *
 * La ida y la vuelta cancelan el desfase del filtro: la envolvente sale con
 * fase cero y el golpe aparece en el instante en el que de verdad ocurre. La
 * versión anterior medía la energía con una FFT por marco, que además de costar
 * diez veces más adelantaba los golpes media ventana —45 ms— y obligaba a
 * compensarlo a mano.
 */
function pasoBajo(muestras, tasa, corte) {
  const w0 = (2 * Math.PI * corte) / tasa;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / Math.SQRT2;
  const a0 = 1 + alpha;
  const b0 = (1 - cos) / 2 / a0;
  const b1 = (1 - cos) / a0;
  const b2 = b0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;

  const n = muestras.length;
  const ida = new Float32Array(n);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < n; i += 1) {
    const x = muestras[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    ida[i] = y;
  }
  const vuelta = new Float32Array(n);
  x1 = 0; x2 = 0; y1 = 0; y2 = 0;
  for (let i = n - 1; i >= 0; i -= 1) {
    const x = ida[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    vuelta[i] = y;
  }
  return vuelta;
}

/**
 * Envolventes de la canción, en marcos de `salto` muestras:
 *
 * - `grave`: energía nueva en la banda del bombo. Es la que manda para cuadrar.
 * - `total`: energía nueva en toda la banda, para cuando el bombo es flojo.
 * - `energia`: el nivel, sin derivar, que es donde se ve la estructura.
 *
 * De las dos primeras solo interesa cuando la energía SUBE: eso es un ataque y
 * no un sostenido.
 */
export function envolventes(muestras, tasa, { salto = SALTO, corte = GRAVE_MAX } = {}) {
  const marcos = Math.max(0, Math.floor((muestras?.length ?? 0) / salto));
  const grave = new Float32Array(marcos);
  const total = new Float32Array(marcos);
  const energia = new Float32Array(marcos);
  if (!marcos) return { grave, total, energia, tasa: tasa / salto };

  const graves = pasoBajo(muestras, tasa, corte);
  const nivelGrave = new Float32Array(marcos);
  for (let i = 0; i < marcos; i += 1) {
    let sumaGrave = 0;
    let sumaTotal = 0;
    const desde = i * salto;
    for (let j = 0; j < salto; j += 1) {
      const g = graves[desde + j];
      const t = muestras[desde + j];
      sumaGrave += g * g;
      sumaTotal += t * t;
    }
    nivelGrave[i] = Math.sqrt(sumaGrave / salto);
    energia[i] = Math.sqrt(sumaTotal / salto);
  }
  for (let i = 1; i < marcos; i += 1) {
    grave[i] = Math.max(0, nivelGrave[i] - nivelGrave[i - 1]);
    total[i] = Math.max(0, energia[i] - energia[i - 1]);
  }
  return { grave, total, energia, tasa: tasa / salto };
}

/* -------------------------------------------------------------- rejilla */

/** Cuánta energía cae encima de la rejilla (tempo, fase). Interpola entre marcos. */
function puntuar(envolvente, periodo, fase) {
  let suma = 0;
  let golpes = 0;
  const limite = envolvente.length - 1;
  for (let marco = fase; marco < limite; marco += periodo) {
    if (marco < 0) continue;
    const i = Math.floor(marco);
    const f = marco - i;
    suma += envolvente[i] * (1 - f) + envolvente[i + 1] * f;
    golpes += 1;
  }
  return golpes ? suma / golpes : 0;
}

const rango = (centro, radio, pasos) => Array.from(
  { length: pasos },
  (unused, i) => centro - radio + (2 * radio * i) / (pasos - 1),
);

/**
 * Ajusta tempo y fase a la vez.
 *
 * El detector de tempo da un número aproximado —con la resolución de su
 * autocorrelación—; aquí se afina buscando el par que hace que TODOS los golpes
 * de la canción caigan sobre la rejilla. Dos pasadas: una amplia y otra fina
 * alrededor de la ganadora.
 *
 * `desde` es el segundo de la canción al que corresponde el primer marco, para
 * poder ajustar sobre un tramo central y devolver tiempos de la canción entera.
 */
export function ajustarRejilla(envolvente, tasaEnvolvente, bpmAprox, {
  margen = 0.04, desde = 0, pasosBpm = 121, pasosFase = 64, afinado = 256,
} = {}) {
  const vacia = { bpm: bpmAprox || 0, offset: 0, fuerza: 0 };
  if (!envolvente?.length || !bpmAprox || !tasaEnvolvente) return vacia;

  const periodoDe = (bpm) => (60 / bpm) * tasaEnvolvente;
  if (!Number.isFinite(periodoDe(bpmAprox)) || periodoDe(bpmAprox) < 4) return vacia;

  let mejor = { bpm: bpmAprox, fase: 0, puntuacion: -1 };
  let suma = 0;
  let cuenta = 0;

  const barrer = (bpms, fases) => {
    for (const bpm of bpms) {
      const periodo = periodoDe(bpm);
      if (!Number.isFinite(periodo) || periodo < 4) continue;
      for (let p = 0; p < fases; p += 1) {
        const fase = (p / fases) * periodo;
        const puntuacion = puntuar(envolvente, periodo, fase);
        suma += puntuacion;
        cuenta += 1;
        if (puntuacion > mejor.puntuacion) mejor = { bpm, fase, puntuacion };
      }
    }
  };

  const radio = bpmAprox * margen;
  barrer(rango(bpmAprox, radio, pasosBpm), pasosFase);
  // Segunda pasada: un solo paso de la primera a cada lado, con la fase fina.
  const paso = (2 * radio) / (pasosBpm - 1);
  barrer(rango(mejor.bpm, paso, 41), afinado);

  const media = cuenta ? suma / cuenta : 0;
  const periodoSegundos = 60 / mejor.bpm;
  const crudo = desde + mejor.fase / tasaEnvolvente;
  const offset = ((crudo % periodoSegundos) + periodoSegundos) % periodoSegundos;
  return {
    bpm: Math.round(mejor.bpm * 1000) / 1000,
    offset: Math.round(offset * 1000) / 1000,
    fuerza: media > 0 ? Math.round(Math.min(1, (mejor.puntuacion / media - 1) / 2) * 100) / 100 : 0,
  };
}

/**
 * Cuál de los cuatro tiempos del compás lleva el golpe fuerte. Devuelve 0 si el
 * primer golpe de la rejilla ya es el uno.
 */
export function detectarCompas(envolvente, tasaEnvolvente, { bpm, offset = 0 }, {
  tiemposPorCompas = 4, desde = 0,
} = {}) {
  if (!envolvente?.length || !bpm) return { tiempoFuerte: 0, fuerza: 0 };
  const periodo = 60 / bpm;
  const acumulado = new Array(tiemposPorCompas).fill(0);
  const cuenta = new Array(tiemposPorCompas).fill(0);

  // El índice del golpe se cuenta desde el principio de la canción aunque solo
  // se mire un tramo: si no, el «uno» saldría distinto según dónde se mirase.
  const primero = Math.ceil((desde - offset) / periodo);
  for (let k = primero; ; k += 1) {
    const marco = (offset + k * periodo - desde) * tasaEnvolvente;
    const i = Math.round(marco);
    if (i >= envolvente.length) break;
    if (i < 1) continue;
    const grupo = ((k % tiemposPorCompas) + tiemposPorCompas) % tiemposPorCompas;
    acumulado[grupo] += Math.max(envolvente[i], envolvente[i - 1], envolvente[i + 1] ?? 0);
    cuenta[grupo] += 1;
  }

  const medias = acumulado.map((v, i) => (cuenta[i] ? v / cuenta[i] : 0));
  const mayor = Math.max(...medias);
  const general = medias.reduce((s, v) => s + v, 0) / tiemposPorCompas;
  return {
    tiempoFuerte: medias.indexOf(mayor),
    fuerza: general > 0 ? Math.round(Math.min(1, mayor / general - 1) * 100) / 100 : 0,
  };
}

/**
 * Cuál de los cuatro compases abre la frase.
 *
 * Un pinchadiscos no mezcla en cualquier compás: mezcla en frase. Y una frase
 * se nota porque en su primer compás cambia algo —entra un elemento, se va
 * otro—, así que se busca el compás donde el nivel da el salto más grande.
 */
export function detectarFrase(energia, tasaEnvolvente, { bpm, offset = 0, tiempoFuerte = 0 }, {
  compasesPorFrase = 4, tiemposPorCompas = 4, desde = 0,
} = {}) {
  if (!energia?.length || !bpm) return { compasFuerte: 0, fuerza: 0 };
  const compas = (60 / bpm) * tiemposPorCompas;
  const marcosPorCompas = Math.round(compas * tasaEnvolvente);
  if (marcosPorCompas < 2) return { compasFuerte: 0, fuerza: 0 };

  const nivel = (desdeMarco) => {
    let suma = 0;
    let n = 0;
    for (let j = desdeMarco; j < desdeMarco + marcosPorCompas && j < energia.length; j += 1) {
      if (j < 0) continue;
      suma += energia[j];
      n += 1;
    }
    return n ? suma / n : 0;
  };

  const periodo = 60 / bpm;
  const primerFuerte = offset + tiempoFuerte * periodo;
  const acumulado = new Array(compasesPorFrase).fill(0);
  const cuenta = new Array(compasesPorFrase).fill(0);
  const primero = Math.ceil((desde - primerFuerte) / compas);
  for (let k = primero; ; k += 1) {
    const marco = Math.round((primerFuerte + k * compas - desde) * tasaEnvolvente);
    if (marco + marcosPorCompas >= energia.length) break;
    if (marco - marcosPorCompas < 0) continue;
    const grupo = ((k % compasesPorFrase) + compasesPorFrase) % compasesPorFrase;
    // Salto de nivel al cruzar el compás: da igual si sube o baja, lo que marca
    // la frase es que cambie.
    acumulado[grupo] += Math.abs(nivel(marco) - nivel(marco - marcosPorCompas));
    cuenta[grupo] += 1;
  }

  const medias = acumulado.map((v, i) => (cuenta[i] ? v / cuenta[i] : 0));
  const mayor = Math.max(...medias);
  const general = medias.reduce((s, v) => s + v, 0) / compasesPorFrase;
  // Un bucle sin estructura tiene saltos de nivel minúsculos, y entre dos
  // minucias la proporción puede salir enorme. Si el salto no llega al 2 % del
  // nivel de la canción, aquí no hay frase: hay ruido de coma flotante.
  const nivelMedio = energia.reduce((s, v) => s + v, 0) / energia.length;
  if (!(nivelMedio > 0) || mayor / nivelMedio < 0.02) return { compasFuerte: 0, fuerza: 0 };
  return {
    compasFuerte: medias.indexOf(mayor),
    fuerza: general > 0 ? Math.round(Math.min(1, mayor / general - 1) * 100) / 100 : 0,
  };
}

/**
 * Por dónde empieza la canción de verdad.
 *
 * Casi ningún archivo empieza a sonar en el segundo cero: hay silencio, o una
 * entrada que se va abriendo. Pinchar por el principio del archivo mete ese
 * silencio en la mezcla, así que se busca el primer instante con nivel de
 * verdad —una fracción del nivel típico de la canción— y se entra por ahí.
 */
export function primerSonido(energia, tasaEnvolvente, { fraccion = 0.15, percentil = 0.9 } = {}) {
  if (!energia?.length || !tasaEnvolvente) return 0;
  // El nivel de referencia es un percentil alto y no la mediana: entre golpe y
  // golpe hay silencio, y en una caja de ritmos la mediana puede ser cero.
  const ordenada = Float32Array.from(energia).sort();
  const referencia = ordenada[Math.min(ordenada.length - 1, Math.floor(ordenada.length * percentil))];
  if (!(referencia > 0)) return 0;
  const umbral = referencia * fraccion;
  for (let i = 0; i < energia.length; i += 1) {
    if (energia[i] > umbral) return Math.round((i / tasaEnvolvente) * 1000) / 1000;
  }
  return 0;
}

/**
 * La rejilla entera de una canción: tempo afinado, fase, tiempo fuerte, frase y
 * por dónde entra.
 *
 * `desde` es el segundo en el que empieza el tramo que se le pasa.
 */
export function rejillaCompleta(muestras, tasa, bpmAprox, { desde = 0, tiemposPorCompas = 4 } = {}) {
  const { grave, total, energia, tasa: tasaEnv } = envolventes(muestras, tasa);
  const fuerzaGrave = grave.reduce((s, v) => s + v, 0);
  const fuerzaTotal = total.reduce((s, v) => s + v, 0);
  // Si el bombo apenas pesa, la envolvente completa marca mejor el pulso.
  const porBombo = fuerzaGrave > fuerzaTotal * 0.08;
  const elegida = porBombo ? grave : total;

  const rejilla = ajustarRejilla(elegida, tasaEnv, bpmAprox, { desde });
  const compas = detectarCompas(elegida, tasaEnv, rejilla, { desde, tiemposPorCompas });
  const frase = detectarFrase(energia, tasaEnv, { ...rejilla, tiempoFuerte: compas.tiempoFuerte }, {
    desde, tiemposPorCompas,
  });

  return {
    bpm: rejilla.bpm,
    offset: rejilla.offset,
    fuerza: rejilla.fuerza,
    tiempoFuerte: compas.tiempoFuerte,
    fuerzaCompas: compas.fuerza,
    compasFuerte: frase.compasFuerte,
    fuerzaFrase: frase.fuerza,
    compasesPorFrase: 4,
    tiemposPorCompas,
    porBombo,
    // Solo tiene sentido si se ha mirado la canción desde el principio.
    entrada: desde === 0 ? primerSonido(energia, tasaEnv) : 0,
  };
}

/* -------------------------------------------------------------- utilidades */

const redondear = (v) => Math.round(v * 1000) / 1000;

/** Instante del siguiente golpe a partir de un momento dado. */
export function siguienteGolpe(segundo, { bpm, offset = 0 }) {
  if (!bpm) return segundo;
  const periodo = 60 / bpm;
  const golpes = Math.ceil((segundo - offset) / periodo - 1e-9);
  return redondear(offset + golpes * periodo);
}

/** Instante del siguiente comienzo de compás. */
export function siguienteCompas(segundo, { bpm, offset = 0, tiempoFuerte = 0, tiemposPorCompas = 4 }) {
  if (!bpm) return segundo;
  const periodo = 60 / bpm;
  const compas = periodo * tiemposPorCompas;
  const primerFuerte = offset + tiempoFuerte * periodo;
  const compases = Math.ceil((segundo - primerFuerte) / compas - 1e-9);
  return redondear(primerFuerte + compases * compas);
}

/**
 * Instante de la siguiente frase: donde de verdad se pincha. Si la canción no
 * tiene una frase clara, cae en el siguiente compás y no se inventa nada.
 */
export function siguienteFrase(segundo, rejilla) {
  const {
    bpm, offset = 0, tiempoFuerte = 0, tiemposPorCompas = 4,
    compasFuerte = 0, compasesPorFrase = 4, fuerzaFrase = 0,
  } = rejilla ?? {};
  if (!bpm) return segundo;
  if (!compasesPorFrase || fuerzaFrase <= 0) return siguienteCompas(segundo, rejilla ?? {});
  const periodo = 60 / bpm;
  const compas = periodo * tiemposPorCompas;
  const frase = compas * compasesPorFrase;
  const primera = offset + tiempoFuerte * periodo + compasFuerte * compas;
  const frases = Math.ceil((segundo - primera) / frase - 1e-9);
  return redondear(primera + frases * frase);
}

/** Cuánto dura una transición de N compases al tempo dado. */
export function duracionDeCompases(bpm, compases, tiemposPorCompas = 4) {
  if (!bpm) return 0;
  return (60 / bpm) * tiemposPorCompas * compases;
}
