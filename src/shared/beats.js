import { fft } from './musica.js';

/**
 * Dónde caen los golpes.
 *
 * Saber el tempo no basta para mezclar: hay que saber en qué instante entra el
 * bombo. Un pinchazo alineado al tempo pero desfasado medio tiempo suena a dos
 * canciones peleándose, que es exactamente lo que distingue una mezcla de un
 * atropello.
 *
 * Todo esto son funciones puras sobre muestras, para poder probarlas con una
 * caja de ritmos fabricada en vez de a oído.
 */

/** El bombo vive abajo: por encima de esto ya es caja, voz o platos. */
export const GRAVE_MAX = 150;
export const GRAVE_MIN = 25;

/**
 * Envolvente de golpes graves: cuánta energía nueva entra en la banda del bombo
 * en cada instante. Devuelve también la envolvente completa, que sirve para
 * afinar la rejilla cuando la percusión grave es floja.
 */
export function envolventeDeBombo(muestras, tasa, { ventana = 1024, salto = 256 } = {}) {
  const marcos = Math.max(0, Math.floor((muestras.length - ventana) / salto));
  const grave = new Float32Array(marcos);
  const total = new Float32Array(marcos);
  /**
   * La ventana de análisis empieza en el marco pero se extiende hacia delante,
   * así que la energía de un golpe aparece antes de que el golpe ocurra: medido
   * con un bombo en un instante conocido, la envolvente lo sitúa unos 45 ms
   * pronto, que es media ventana. Se devuelve ese retardo para que quien
   * convierta marcos a segundos lo compense en vez de arrastrar el error hasta
   * la mezcla, donde 45 ms ya se oyen.
   */
  const retardo = ventana / 2 / tasa;
  if (!marcos) return { grave, total, tasa: tasa / salto, retardo };

  const real = new Float32Array(ventana);
  const imag = new Float32Array(ventana);
  const binMin = Math.max(1, Math.floor((GRAVE_MIN * ventana) / tasa));
  const binMax = Math.max(binMin + 1, Math.ceil((GRAVE_MAX * ventana) / tasa));

  let graveAnterior = 0;
  let totalAnterior = 0;
  for (let i = 0; i < marcos; i += 1) {
    const desde = i * salto;
    for (let j = 0; j < ventana; j += 1) {
      // Ventana de Hann en línea: evita reservar otro array por marco.
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * j) / (ventana - 1));
      real[j] = muestras[desde + j] * w;
      imag[j] = 0;
    }
    fft(real, imag);

    let energiaGrave = 0;
    let energiaTotal = 0;
    for (let bin = 1; bin < ventana / 2; bin += 1) {
      const magnitud = Math.hypot(real[bin], imag[bin]);
      energiaTotal += magnitud;
      if (bin >= binMin && bin <= binMax) energiaGrave += magnitud;
    }
    // Solo interesa cuando la energía SUBE: eso es un ataque, no un sostenido.
    grave[i] = Math.max(0, energiaGrave - graveAnterior);
    total[i] = Math.max(0, energiaTotal - totalAnterior);
    graveAnterior = energiaGrave;
    totalAnterior = energiaTotal;
  }
  return { grave, total, tasa: tasa / salto, retardo };
}

/**
 * Fase de la rejilla: en qué segundo cae el primer golpe. Se prueban todas las
 * fases posibles dentro de un tiempo y se queda la que más energía acumula en
 * los sitios donde debería haber golpe.
 */
export function detectarRejilla(envolvente, tasaEnvolvente, bpm, { resolucion = 64, retardo = 0 } = {}) {
  if (!envolvente?.length || !bpm || !tasaEnvolvente) return { offset: 0, fuerza: 0 };
  const periodo = (60 / bpm) * tasaEnvolvente; // en marcos
  if (!Number.isFinite(periodo) || periodo < 2) return { offset: 0, fuerza: 0 };

  let mejor = { puntuacion: -1, fase: 0 };
  let suma = 0;
  for (let paso = 0; paso < resolucion; paso += 1) {
    const fase = (paso / resolucion) * periodo;
    let puntuacion = 0;
    let golpes = 0;
    for (let marco = fase; marco < envolvente.length; marco += periodo) {
      const indice = Math.round(marco);
      if (indice >= envolvente.length) break;
      // Se mira el marco y sus vecinos: un golpe rara vez cae en el centro exacto.
      puntuacion += Math.max(
        envolvente[indice],
        envolvente[indice - 1] ?? 0,
        envolvente[indice + 1] ?? 0,
      );
      golpes += 1;
    }
    if (golpes) puntuacion /= golpes;
    suma += puntuacion;
    if (puntuacion > mejor.puntuacion) mejor = { puntuacion, fase };
  }

  const media = suma / resolucion;
  const periodoSegundos = 60 / bpm;
  // Se compensa el retardo del análisis y se deja el desfase dentro de un tiempo.
  const crudo = mejor.fase / tasaEnvolvente + retardo;
  const offset = Math.round(((crudo % periodoSegundos) + periodoSegundos) % periodoSegundos * 1000) / 1000;
  return {
    offset,
    fuerza: media > 0 ? Math.round(Math.min(1, (mejor.puntuacion / media - 1) / 2) * 100) / 100 : 0,
  };
}

/**
 * Cuál de los cuatro tiempos del compás lleva el bombo fuerte. Devuelve 0 si el
 * primer golpe detectado ya es el uno.
 */
export function detectarCompas(envolvente, tasaEnvolvente, bpm, offset, { tiemposPorCompas = 4 } = {}) {
  if (!envolvente?.length || !bpm) return { tiempoFuerte: 0, fuerza: 0 };
  const periodo = (60 / bpm) * tasaEnvolvente;
  const inicio = offset * tasaEnvolvente;
  const acumulado = new Array(tiemposPorCompas).fill(0);
  const cuenta = new Array(tiemposPorCompas).fill(0);

  let indiceGolpe = 0;
  for (let marco = inicio; marco < envolvente.length; marco += periodo) {
    const indice = Math.round(marco);
    if (indice >= envolvente.length) break;
    const grupo = indiceGolpe % tiemposPorCompas;
    acumulado[grupo] += Math.max(envolvente[indice], envolvente[indice - 1] ?? 0, envolvente[indice + 1] ?? 0);
    cuenta[grupo] += 1;
    indiceGolpe += 1;
  }

  const medias = acumulado.map((v, i) => (cuenta[i] ? v / cuenta[i] : 0));
  const mayor = Math.max(...medias);
  const mediaGeneral = medias.reduce((s, v) => s + v, 0) / tiemposPorCompas;
  return {
    tiempoFuerte: medias.indexOf(mayor),
    fuerza: mediaGeneral > 0 ? Math.round(Math.min(1, (mayor / mediaGeneral - 1)) * 100) / 100 : 0,
  };
}

/** Analiza de una vez la rejilla completa de una canción. */
export function rejillaCompleta(muestras, tasa, bpm) {
  const { grave, total, tasa: tasaEnv } = envolventeDeBombo(muestras, tasa);
  // Si el bombo es flojo, la envolvente completa marca mejor el pulso.
  const fuerzaGrave = grave.reduce((s, v) => s + v, 0);
  const fuerzaTotal = total.reduce((s, v) => s + v, 0);
  const usarGrave = fuerzaGrave > fuerzaTotal * 0.08;
  const elegida = usarGrave ? grave : total;

  const { retardo } = envolventeDeBombo(muestras.subarray(0, 1), tasa);
  const rejilla = detectarRejilla(elegida, tasaEnv, bpm, { retardo });
  // El compás se mide sobre los marcos, sin compensar: ahí solo importa qué
  // golpe pega más fuerte, no en qué segundo exacto cae.
  const compas = detectarCompas(elegida, tasaEnv, bpm, Math.max(0, rejilla.offset - retardo));
  return {
    offset: rejilla.offset,
    fuerza: rejilla.fuerza,
    tiempoFuerte: compas.tiempoFuerte,
    fuerzaCompas: compas.fuerza,
    porBombo: usarGrave,
  };
}

/* -------------------------------------------------------------- utilidades */

/** Instante del siguiente golpe a partir de un momento dado. */
export function siguienteGolpe(segundo, { bpm, offset = 0 }) {
  if (!bpm) return segundo;
  const periodo = 60 / bpm;
  const golpes = Math.ceil((segundo - offset) / periodo - 1e-9);
  return Math.round((offset + golpes * periodo) * 1000) / 1000;
}

/** Instante del siguiente comienzo de compás: donde de verdad se pincha. */
export function siguienteCompas(segundo, { bpm, offset = 0, tiempoFuerte = 0, tiemposPorCompas = 4 }) {
  if (!bpm) return segundo;
  const periodo = 60 / bpm;
  const compas = periodo * tiemposPorCompas;
  const primerFuerte = offset + tiempoFuerte * periodo;
  const compases = Math.ceil((segundo - primerFuerte) / compas - 1e-9);
  return Math.round((primerFuerte + compases * compas) * 1000) / 1000;
}

/** Cuánto dura una transición de N compases al tempo dado. */
export function duracionDeCompases(bpm, compases, tiemposPorCompas = 4) {
  if (!bpm) return 0;
  return (60 / bpm) * tiemposPorCompas * compases;
}
