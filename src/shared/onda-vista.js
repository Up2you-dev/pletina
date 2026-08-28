/**
 * La geometría de un visor de ondas.
 *
 * Separado del dibujo a propósito: aquí no hay canvas ni colores, solo las
 * cuentas —qué tramo de canción se ve, qué columna le toca a cada marco, dónde
 * caen las líneas de la rejilla y qué segundo hay debajo del ratón—. Eso es lo
 * que se puede probar sin pantalla, y es donde se equivoca uno.
 */

/**
 * El tramo visible en una vista ampliada, con la cabeza lectora en el centro.
 *
 * Se deja salir de la canción por los dos lados a propósito: si al empezar la
 * vista se pegase al cero, la cabeza dejaría de estar en el centro y ya no se
 * podría comparar con el otro plato, que es justo para lo que sirve.
 */
export function ventana(centro, segundos) {
  const mitad = Math.max(0.1, segundos) / 2;
  return { desde: centro - mitad, hasta: centro + mitad };
}

/** Dónde cae un segundo dentro de la vista, en píxeles. */
export const xDeSegundo = (segundo, { desde, hasta, ancho }) => (
  ((segundo - desde) / (hasta - desde)) * ancho
);

/** Y al revés: qué segundo hay debajo de un píxel. */
export const segundoDeX = (x, { desde, hasta, ancho }) => (
  desde + (x / Math.max(1, ancho)) * (hasta - desde)
);

/**
 * Resume una tira de la onda al ancho pedido, quedándose con el pico de cada
 * columna. Los tramos que caen fuera de la canción salen a cero, que es lo
 * honesto: ahí no hay música.
 */
export function franja(tira, { desde, hasta, ancho, fps }) {
  const salida = new Uint8Array(Math.max(0, ancho));
  if (!tira?.length || ancho <= 0 || !(fps > 0) || hasta <= desde) return salida;
  const porColumna = ((hasta - desde) * fps) / ancho;
  for (let x = 0; x < ancho; x += 1) {
    const primero = (desde + (x / ancho) * (hasta - desde)) * fps;
    const inicio = Math.floor(primero);
    const fin = Math.max(inicio + 1, Math.floor(primero + porColumna));
    let mayor = 0;
    for (let i = Math.max(0, inicio); i < fin && i < tira.length; i += 1) {
      if (tira[i] > mayor) mayor = tira[i];
    }
    salida[x] = mayor;
  }
  return salida;
}

/**
 * Las líneas de la rejilla que se ven en el tramo, cada una con su rango.
 *
 * `frase` es el uno de cada cuatro compases, `compas` el uno de cada cuatro
 * tiempos y `golpe` el resto. Se dibujan distinto porque no valen lo mismo: en
 * una cabina se pincha en frase, se cuenta en compases y se baila a golpes.
 */
export function lineasDeRejilla(rejilla, { desde, hasta, maximo = 512 } = {}) {
  const {
    bpm, offset = 0, tiempoFuerte = 0, tiemposPorCompas = 4,
    compasFuerte = 0, compasesPorFrase = 4, fuerzaFrase = 0,
  } = rejilla ?? {};
  if (!bpm || !(hasta > desde)) return [];

  const periodo = 60 / bpm;
  // Antes del segundo cero no hay canción, así que no hay compases: la vista
  // ampliada se sale por la izquierda a propósito —para que la cabeza lectora
  // siga en el centro— y ahí se dibujaban líneas y números de compases que no
  // existen, algunos con número negativo.
  const arranque = Math.max(0, desde);
  const primero = Math.ceil((arranque - offset) / periodo);
  const ultimo = Math.floor((hasta - offset) / periodo);
  if (ultimo < primero) return [];
  if (ultimo - primero > maximo) return [];

  // La jerarquía se dibuja SIEMPRE. Los compases van de cuatro en cuatro porque
  // así es la música, no porque lo haya medido nadie; lo que el análisis mide
  // es cuál de los cuatro abre la frase, y eso solo cambia dónde empieza a
  // contar. En música masterizada `fuerzaFrase` sale casi siempre 0, y
  // condicionar la jerarquía a ese número dejaba la rejilla plana —sin una sola
  // línea fuerte— y numerando compases desde el principio de la canción, con
  // números de tres cifras que no sirven para contar.
  const conFrase = fuerzaFrase > 0;
  const lineas = [];
  for (let k = primero; k <= ultimo; k += 1) {
    const segundo = offset + k * periodo;
    // El índice del tiempo dentro del compás, contando desde el uno.
    const desdeElUno = k - tiempoFuerte;
    const enCompas = ((desdeElUno % tiemposPorCompas) + tiemposPorCompas) % tiemposPorCompas;
    let tipo = 'golpe';
    let numero = null;
    if (enCompas === 0) {
      const compas = Math.floor(desdeElUno / tiemposPorCompas) - compasFuerte;
      const enFrase = ((compas % compasesPorFrase) + compasesPorFrase) % compasesPorFrase;
      tipo = enFrase === 0 ? 'frase' : 'compas';
      // Del uno al cuatro, que es como se cuenta en una cabina.
      numero = enFrase + 1;
    }
    // `medida` dice si el análisis encontró la frase o si el uno de cada cuatro
    // es solo la cuenta por defecto: el visor la dibuja algo más floja cuando
    // no está medida, para no prometer lo que no se sabe.
    lineas.push({ segundo, tipo, compas: numero, medida: tipo === 'frase' ? conFrase : null });
  }
  return lineas;
}

/**
 * Cuánto hay que mover un plato para que su rejilla case con la del otro, en
 * segundos y dentro de un tiempo. Es el número que mira un pinchadiscos cuando
 * empuja el plato: positivo, va tarde; negativo, va pronto.
 */
export function desfaseEntre(unPlato, otroPlato) {
  const a = unPlato?.rejilla;
  const b = otroPlato?.rejilla;
  if (!a?.bpm || !b?.bpm) return null;
  const faseDe = (tiempo, rejilla) => {
    const periodo = 60 / rejilla.bpm;
    const uno = (rejilla.offset ?? 0) + (rejilla.tiempoFuerte ?? 0) * periodo;
    return ((((tiempo - uno) % periodo) + periodo) % periodo) / periodo;
  };
  const diferencia = faseDe(unPlato.tiempo, a) - faseDe(otroPlato.tiempo, b);
  const normalizada = ((diferencia % 1) + 1) % 1;
  const fraccion = normalizada > 0.5 ? normalizada - 1 : normalizada;
  // En segundos del plato que se mira, que es lo que hay que empujar.
  return fraccion * (60 / a.bpm);
}
