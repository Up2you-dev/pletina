/**
 * La forma de onda de una canción, en tres bandas.
 *
 * Un pinchadiscos no mira una onda para ver «cuánto suena»: la mira para ver
 * DÓNDE están las cosas —dónde entra el bombo, dónde se va la voz, dónde
 * arranca el estribillo— y eso no se ve en una silueta gris. Se ve separando
 * graves, medios y agudos y pintando cada banda de un color, que es lo que
 * hacen rekordbox, Serato y Mixxx desde hace quince años.
 *
 * Aquí se calcula eso una sola vez, al analizar, y se guarda en disco: mirar
 * una onda tiene que ser instantáneo, no decodificar seis minutos de audio.
 *
 * El formato es un binario tonto a propósito —tres tiras de bytes, una por
 * banda— para que quepa en poco y se dibuje sin convertir nada.
 */

/** Corte entre graves y medios, y entre medios y agudos. */
export const CORTE_GRAVE = 200;
export const CORTE_AGUDO = 2000;

/** Marcos por segundo. A 150, cada marco son 6,7 ms: un píxel por marco a zoom de trabajo. */
export const FPS = 150;

const MAGIA = 0x504f4e44; // 'POND'
const VERSION = 1;
export const CABECERA = 16;

/* ------------------------------------------------------------------ cálculo */

/** Biquad paso bajo Butterworth aplicado de ida y de vuelta: sin desfase. */
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
  const salida = new Float32Array(n);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < n; i += 1) {
    const x = muestras[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    salida[i] = y;
  }
  x1 = 0; x2 = 0; y1 = 0; y2 = 0;
  for (let i = n - 1; i >= 0; i -= 1) {
    const x = salida[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    salida[i] = y;
  }
  return salida;
}

/** Percentil de un array, sin ordenar el original. */
function percentil(valores, p) {
  if (!valores.length) return 0;
  const orden = Float32Array.from(valores).sort();
  return orden[Math.min(orden.length - 1, Math.max(0, Math.floor(orden.length * p)))];
}

/**
 * Calcula las tres tiras a partir de las muestras ya reducidas a mono.
 *
 * Las tres se normalizan con el MISMO factor —el percentil 99,5 de la señal
 * entera— para que la proporción entre bandas signifique algo: si los graves
 * pintan el doble que los agudos es porque suenan el doble, no porque cada
 * banda se haya escalado por su cuenta.
 */
export function calcularOndas(muestras, tasa, { fps = FPS } = {}) {
  const salto = Math.max(1, Math.round(tasa / fps));
  const marcos = Math.max(0, Math.floor((muestras?.length ?? 0) / salto));
  const grave = new Uint8Array(marcos);
  const medio = new Uint8Array(marcos);
  const agudo = new Uint8Array(marcos);
  const fpsReal = tasa / salto;
  if (!marcos) return { fps: fpsReal, marcos: 0, duracion: 0, grave, medio, agudo };

  const graves = pasoBajo(muestras, tasa, CORTE_GRAVE);
  const hastaMedios = pasoBajo(muestras, tasa, CORTE_AGUDO);

  const rmsGrave = new Float32Array(marcos);
  const rmsMedio = new Float32Array(marcos);
  const rmsAgudo = new Float32Array(marcos);
  const rmsTotal = new Float32Array(marcos);
  for (let i = 0; i < marcos; i += 1) {
    const desde = i * salto;
    let sg = 0;
    let sm = 0;
    let sa = 0;
    let st = 0;
    for (let j = 0; j < salto; j += 1) {
      const total = muestras[desde + j];
      const g = graves[desde + j];
      const m = hastaMedios[desde + j] - g;
      const a = total - hastaMedios[desde + j];
      sg += g * g;
      sm += m * m;
      sa += a * a;
      st += total * total;
    }
    rmsGrave[i] = Math.sqrt(sg / salto);
    rmsMedio[i] = Math.sqrt(sm / salto);
    rmsAgudo[i] = Math.sqrt(sa / salto);
    rmsTotal[i] = Math.sqrt(st / salto);
  }

  // Referencia alta pero no el máximo: un chasquido no puede aplanar la canción.
  const referencia = percentil(rmsTotal, 0.995) || Math.max(...rmsTotal) || 1;
  const escala = (v) => Math.max(0, Math.min(255, Math.round((v / referencia) * 255)));
  for (let i = 0; i < marcos; i += 1) {
    grave[i] = escala(rmsGrave[i]);
    medio[i] = escala(rmsMedio[i]);
    agudo[i] = escala(rmsAgudo[i]);
  }

  return {
    fps: fpsReal,
    marcos,
    duracion: muestras.length / tasa,
    grave,
    medio,
    agudo,
  };
}

/* ------------------------------------------------------------------ formato */

/** A binario: cabecera de 16 bytes y las tres tiras seguidas. */
export function empaquetar(ondas) {
  const marcos = ondas?.marcos ?? 0;
  const buffer = new ArrayBuffer(CABECERA + marcos * 3);
  const vista = new DataView(buffer);
  vista.setUint32(0, MAGIA);
  vista.setUint8(4, VERSION);
  vista.setUint8(5, 3);
  vista.setUint16(6, Math.round(ondas.fps));
  vista.setUint32(8, marcos);
  vista.setFloat32(12, ondas.duracion || 0);
  const bytes = new Uint8Array(buffer);
  bytes.set(ondas.grave, CABECERA);
  bytes.set(ondas.medio, CABECERA + marcos);
  bytes.set(ondas.agudo, CABECERA + marcos * 2);
  return bytes;
}

/** Y de vuelta. Devuelve null si no es una onda nuestra: un archivo a medias no revienta la pantalla. */
export function desempaquetar(datos) {
  if (!datos) return null;
  const bytes = datos instanceof Uint8Array ? datos : new Uint8Array(datos);
  if (bytes.byteLength < CABECERA) return null;
  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (vista.getUint32(0) !== MAGIA || vista.getUint8(4) !== VERSION) return null;
  const marcos = vista.getUint32(8);
  if (bytes.byteLength < CABECERA + marcos * 3) return null;
  return {
    fps: vista.getUint16(6),
    marcos,
    duracion: vista.getFloat32(12),
    grave: bytes.subarray(CABECERA, CABECERA + marcos),
    medio: bytes.subarray(CABECERA + marcos, CABECERA + marcos * 2),
    agudo: bytes.subarray(CABECERA + marcos * 2, CABECERA + marcos * 3),
  };
}

/**
 * Reduce una tira a `ancho` columnas quedándose con el máximo de cada tramo.
 *
 * Con el máximo y no con la media: en una vista general de seis minutos en
 * novecientos píxeles, cada columna resume medio segundo, y lo que hay que ver
 * ahí es dónde pega, no cuánto pega de media.
 */
export function resumir(tira, ancho) {
  const salida = new Uint8Array(Math.max(0, ancho));
  if (!tira?.length || ancho <= 0) return salida;
  const porColumna = tira.length / ancho;
  for (let x = 0; x < ancho; x += 1) {
    const desde = Math.floor(x * porColumna);
    const hasta = Math.min(tira.length, Math.max(desde + 1, Math.floor((x + 1) * porColumna)));
    let mayor = 0;
    for (let i = desde; i < hasta; i += 1) if (tira[i] > mayor) mayor = tira[i];
    salida[x] = mayor;
  }
  return salida;
}
