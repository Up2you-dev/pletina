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

/**
 * Versión del análisis.
 *
 * Sube cuando lo que sabe la aplicación de una canción cambia de forma, y sirve
 * para una sola cosa: que un análisis viejo cuente como pendiente en vez de
 * como hecho. Sin esto, quien actualiza se queda con datos de la versión
 * anterior y sin manera de saber por qué le falta algo.
 *
 *   1 · tempo estimado y envolvente que adelantaba los golpes: no vale para
 *       pinchar, solo para saber el tempo aproximado.
 *   2 · rejilla ajustada de verdad (tempo y fase a la vez).
 *   3 · además, la forma de onda guardada para poder dibujarla.
 *   4 · octava resuelta —el doble y la mitad ya no se cuelan— y confianza que
 *       dice la verdad. Las rejillas de la 3 pueden ir al doble o a la mitad
 *       del tempo que suena y no hay manera de saber cuáles: se rehacen.
 */
export const ANALISIS_VERSION = 4;
/** La rejilla es utilizable desde la versión 3, que es la que resuelve octavas. */
export const REJILLA_VERSION = 3;

/** ¿Esta rejilla sirve para mezclar? */
export const rejillaVigente = (rejilla) => Boolean(
  rejilla && Number(rejilla.bpm) > 0 && Number(rejilla.version || 1) >= REJILLA_VERSION,
);

/**
 * ¿Esta canción está analizada con lo que hace falta HOY?
 *
 * Con rejilla al día y con onda dibujable. Y también cuando se intentó y no
 * salió: hay música sin pulso que agarrar —una charla, un ambiente, un minuto
 * de ruido—, y volver a intentarlo en cada lote es tiempo tirado; en ese caso
 * basta con que el intento sea de esta versión.
 */
export function analizada(track) {
  if (!track?.analisis?.en) return false;
  if (Number(track.analisis.version || 1) < ANALISIS_VERSION) return false;
  if (rejillaVigente(track.rejilla)) return Boolean(track.onda);
  // Se intentó y no había pulso: eso no se repite, pero sí tiene que tener onda.
  return !track.rejilla && Boolean(track.onda);
}

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

/** Lee la envolvente en un marco fraccionario, interpolando entre vecinos. */
function leer(envolvente, marco) {
  if (marco < 0 || marco >= envolvente.length - 1) return 0;
  const i = Math.floor(marco);
  const f = marco - i;
  return envolvente[i] * (1 - f) + envolvente[i + 1] * f;
}

/** Cuánta energía cae encima de la rejilla (tempo, fase). */
function puntuar(envolvente, periodo, fase) {
  let suma = 0;
  let golpes = 0;
  const limite = envolvente.length - 1;
  for (let marco = fase; marco < limite; marco += periodo) {
    if (marco < 0) continue;
    suma += leer(envolvente, marco);
    golpes += 1;
  }
  return golpes ? suma / golpes : 0;
}

/**
 * Contraste: cuánta más energía hay en los golpes que entre golpe y golpe.
 *
 * Es lo que distingue el tempo bueno del doble y de la mitad, y la media de
 * energía por golpe no lo distingue: una rejilla a la mitad cae solo sobre los
 * golpes fuertes y saca mejor media que la buena. Pero a la mitad, el punto
 * medio entre sus golpes cae justo encima de los golpes que se ha saltado, y
 * ahí su contraste se desploma. Al doble pasa al revés: acierta los golpes de
 * verdad y también los huecos, y se queda a medias. Solo el tempo bueno tiene
 * los golpes llenos y los huecos vacíos.
 */
export function contraste(envolvente, periodo, fase) {
  let dentro = 0;
  let fuera = 0;
  let n = 0;
  const mitad = periodo / 2;
  const limite = envolvente.length - 1 - mitad;
  for (let marco = fase; marco < limite; marco += periodo) {
    if (marco < 0) continue;
    dentro += leer(envolvente, marco);
    fuera += leer(envolvente, marco + mitad);
    n += 1;
  }
  return n ? (dentro - fuera) / n : 0;
}

const rango = (centro, radio, pasos) => Array.from(
  { length: pasos },
  (unused, i) => centro - radio + (2 * radio * i) / (pasos - 1),
);

/**
 * Busca el par (tempo, fase) que mejor explica los golpes, en marcos.
 *
 * Dos pasadas: una amplia y otra fina alrededor de la ganadora. Devuelve la
 * fase en marcos porque quien llama todavía tiene que medir cosas sobre ella;
 * `ajustarRejilla` es quien la pasa a segundos de canción.
 */
function fijar(envolvente, tasaEnvolvente, bpmAprox, {
  margen = 0.04, pasosBpm = 121, pasosFase = 64, afinado = 256,
} = {}) {
  const periodoDe = (bpm) => (60 / bpm) * tasaEnvolvente;
  if (!Number.isFinite(periodoDe(bpmAprox)) || periodoDe(bpmAprox) < 4) return null;

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

  return { ...mejor, media: cuenta ? suma / cuenta : 0 };
}

/**
 * Nivel de referencia de una envolvente: el percentil alto, no la media.
 *
 * Entre golpe y golpe hay silencio, y con silencio de por medio la media dice
 * más de cuánto calla la canción que de cuánto pega. El percentil mide lo que
 * pega un golpe, que es contra lo que hay que comparar el contraste.
 */
function nivelTipico(envolvente, percentil = 0.98) {
  if (!envolvente?.length) return 0;
  const ordenada = Float32Array.from(envolvente).sort();
  return ordenada[Math.min(ordenada.length - 1, Math.floor(ordenada.length * percentil))];
}

/**
 * Ajusta tempo y fase a la vez, alrededor de un tempo aproximado.
 *
 * El detector de tempo da un número con la resolución de su autocorrelación;
 * aquí se afina buscando el par que hace que TODOS los golpes de la canción
 * caigan sobre la rejilla. De ahí sale que la rejilla valga en el minuto uno y
 * en el minuto seis.
 *
 * `desde` es el segundo de la canción al que corresponde el primer marco, para
 * poder ajustar sobre un tramo central y devolver tiempos de la canción entera.
 *
 * La `fuerza` que devuelve no es «cuánta energía he encontrado» sino cuánto
 * destacan los golpes de lo que hay entre ellos, medido contra lo que pega un
 * golpe de esta canción. Así un cero significa «esta rejilla no la creas», y no
 * «esta canción suena flojito».
 */
export function ajustarRejilla(envolvente, tasaEnvolvente, bpmAprox, {
  margen = 0.04, desde = 0, pasosBpm = 121, pasosFase = 64, afinado = 256,
} = {}) {
  const vacia = { bpm: bpmAprox || 0, offset: 0, fuerza: 0 };
  if (!envolvente?.length || !bpmAprox || !tasaEnvolvente) return vacia;

  const mejor = fijar(envolvente, tasaEnvolvente, bpmAprox, {
    margen, pasosBpm, pasosFase, afinado,
  });
  if (!mejor) return vacia;

  const periodoSegundos = 60 / mejor.bpm;
  const crudo = desde + mejor.fase / tasaEnvolvente;
  const offset = ((crudo % periodoSegundos) + periodoSegundos) % periodoSegundos;
  const nivel = nivelTipico(envolvente);
  const separacion = contraste(envolvente, (60 / mejor.bpm) * tasaEnvolvente, mejor.fase);
  return {
    bpm: Math.round(mejor.bpm * 1000) / 1000,
    offset: Math.round(offset * 1000) / 1000,
    fuerza: nivel > 0 ? Math.round(Math.max(0, Math.min(1, separacion / nivel)) * 100) / 100 : 0,
  };
}

/**
 * Por debajo de esto no hay rejilla que valga.
 *
 * El contraste va de cero a uno: cero es «los golpes no destacan de lo que hay
 * entre ellos», o sea que no hay golpes. Una rejilla así no es una rejilla
 * floja, es una rejilla falsa, y vale más decir que la canción no tiene pulso.
 */
export const FUERZA_MINIMA = 0.08;

/** Las octavas que se prueban: el doble, la mitad y los tercios de por medio. */
export const MULTIPLOS = [1 / 3, 1 / 2, 2 / 3, 1, 3 / 2, 2, 3];

/** Fuera de aquí no hay música que pinchar: hay un error de octava. */
export const BPM_MIN = 58;
export const BPM_MAX = 200;

/**
 * Con qué tempo llama la gente al mismo ritmo.
 *
 * Un ritmo se puede contar al doble o a la mitad y las dos cuentas son
 * ciertas; lo que decide es la costumbre, y la costumbre vive alrededor de las
 * ciento veinte. Es un empate que el sonido no rompe, así que lo rompe esto.
 *
 * El ancho está medido, no elegido a ojo: con noventa y seis canciones
 * fabricadas —seis patrones por dieciséis tempos— 0,8 acierta la octava en
 * setenta y dos, y tanto abrirlo como cerrarlo empeora. Abierto se le escapan
 * los tempos rápidos de kit escaso, que salen a la mitad; cerrado dobla las
 * canciones lentas. Lo que queda fuera es el medio tiempo de verdad, donde
 * dos personas tampoco se pondrían de acuerdo: para eso está el ×2.
 */
export const ANCHO_COSTUMBRE = 0.8;
const preferencia = (bpm, ancho = ANCHO_COSTUMBRE) => Math.exp(
  -0.5 * ((Math.log2(bpm / 120) / ancho) ** 2),
);

/**
 * La rejilla probando también el doble, la mitad y los tercios.
 *
 * El detector de tempo se equivoca de octava a menudo —en un drum & bass dice
 * la mitad, en una balada con el bombo flojo dice el doble— y da igual lo fino
 * que se ajuste después: con la octava cambiada la mezcla no cuadra jamás, y
 * el número que enseña la aplicación es sencillamente falso. Así que se prueban
 * las octavas de alrededor con un ajuste barato, gana la que más contraste
 * saca, y solo a esa se le hace el ajuste fino.
 */
export function elegirTempo(envolvente, tasaEnvolvente, bpmAprox, { ancho } = {}) {
  const nada = { bpm: 0, contraste: 0 };
  if (!envolvente?.length || !bpmAprox || !tasaEnvolvente) return nada;
  const tanteos = [];
  for (const multiplo of MULTIPLOS) {
    const bpm = bpmAprox * multiplo;
    if (bpm < BPM_MIN || bpm > BPM_MAX) continue;
    const tanteo = fijar(envolvente, tasaEnvolvente, bpm, {
      margen: 0.05, pasosBpm: 21, pasosFase: 48, afinado: 96,
    });
    if (!tanteo) continue;
    const separacion = contraste(envolvente, (60 / tanteo.bpm) * tasaEnvolvente, tanteo.fase);
    tanteos.push({ bpm: tanteo.bpm, contraste: separacion, valor: separacion * preferencia(tanteo.bpm, ancho) });
  }
  if (!tanteos.length) return nada;
  tanteos.sort((a, b) => b.valor - a.valor);
  // La distancia hasta la segunda octava se midió y se descartó como aviso: en
  // noventa y seis canciones fabricadas avisaba de cuatro de los nueve fallos
  // pero también de catorce de los treinta y nueve aciertos. Un aviso que se
  // equivoca un tercio de las veces no informa, cansa; y para el empate de
  // verdad ya están el ×2 y el ÷2, que están a un clic y no hace falta creerse.
  const [mejor] = tanteos;
  return { bpm: mejor.bpm, contraste: mejor.contraste };
}

/**
 * La rejilla entera: octava, tempo fino y fase.
 *
 * `octavas` es la envolvente con la que se decide la octava, que no tiene por
 * qué ser la misma con la que se afina. Y no lo es casi nunca: la octava se
 * decide con el grupo entero —bombo, caja y charles— porque en la banda del
 * bombo un ritmo de bombo al uno y al tres parece ir a la mitad de velocidad
 * de lo que va; y la fase se afina con el bombo, porque es el golpe que marca
 * el instante exacto y el que se oye cuando dos canciones no cuadran.
 */
export function elegirRejilla(envolvente, tasaEnvolvente, bpmAprox, {
  desde = 0, octavas = null,
} = {}) {
  const vacia = { bpm: 0, offset: 0, fuerza: 0 };
  if (!envolvente?.length || !bpmAprox || !tasaEnvolvente) return vacia;
  const { bpm } = elegirTempo(octavas ?? envolvente, tasaEnvolvente, bpmAprox);
  if (!bpm) return vacia;
  // Margen corto: la octava ya está decidida y aquí solo se afina.
  return ajustarRejilla(envolvente, tasaEnvolvente, bpm, { desde, margen: 0.02 });
}

/**
 * Cuánto se va el tempo a lo largo de la canción.
 *
 * Una grabación tocada a mano no tiene un tempo, tiene un tempo por minuto. Una
 * sola rejilla no puede cuadrar entera una canción así, y callárselo es peor
 * que no analizarla: el pinchazo entra bien y a los treinta segundos se ha ido.
 * Se ajusta el primer tercio y el último por separado y se mira la diferencia.
 */
/**
 * Cuánto se puede fiar uno de una rejilla que se va.
 *
 * Un tempo que se mueve medio punto es una grabación humana y se aguanta; uno
 * que se mueve tres puntos no es un tempo, es que ahí no había pulso y el
 * ajuste se ha agarrado a lo que ha podido. Esto es lo que separa una canción
 * floja de una charla: el ruido también saca contraste, pero no saca el mismo
 * tempo en el primer tercio que en el último.
 */
export const firmeza = (deriva) => Math.max(0, Math.min(1, 1 - Math.max(0, deriva - 0.4) / 2.6));

export function medirDeriva(envolvente, tasaEnvolvente, bpm) {
  if (!envolvente?.length || !bpm) return 0;
  const tercio = Math.floor(envolvente.length / 3);
  if (tercio * tasaEnvolvente <= 0 || tercio < tasaEnvolvente * 8) return 0;
  const cabo = (trozo) => fijar(trozo, tasaEnvolvente, bpm, {
    margen: 0.06, pasosBpm: 61, pasosFase: 32, afinado: 64,
  })?.bpm ?? bpm;
  const principio = cabo(envolvente.subarray(0, tercio));
  const final = cabo(envolvente.subarray(envolvente.length - tercio));
  return Math.round(Math.abs(final - principio) * 1000) / 1000;
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

  const rejilla = elegirRejilla(elegida, tasaEnv, bpmAprox, { desde, octavas: total });
  const deriva = medirDeriva(elegida, tasaEnv, rejilla.bpm);
  const compas = detectarCompas(elegida, tasaEnv, rejilla, { desde, tiemposPorCompas });
  const frase = detectarFrase(energia, tasaEnv, { ...rejilla, tiempoFuerte: compas.tiempoFuerte }, {
    desde, tiemposPorCompas,
  });

  return {
    bpm: rejilla.bpm,
    offset: rejilla.offset,
    // La confianza es lo que destacan los golpes por lo bien que un solo tempo
    // explica la canción entera. Las dos cosas a la vez, porque cada una sola
    // se deja engañar: el ruido saca contraste, y un tempo estable sin golpes
    // no es un tempo.
    fuerza: Math.round(rejilla.fuerza * firmeza(deriva) * 100) / 100,
    deriva,
    tiempoFuerte: compas.tiempoFuerte,
    fuerzaCompas: compas.fuerza,
    compasFuerte: frase.compasFuerte,
    fuerzaFrase: frase.fuerza,
    compasesPorFrase: 4,
    tiemposPorCompas,
    porBombo,
    // Solo tiene sentido si se ha mirado la canción desde el principio.
    entrada: desde === 0 ? primerSonido(energia, tasaEnv) : 0,
    version: REJILLA_VERSION,
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
