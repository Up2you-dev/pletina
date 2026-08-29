import { pegan } from './camelot.js';

/**
 * Tempo y tonalidad, a partir de las muestras de audio.
 *
 * Vive fuera del renderizador y sin Web Audio a propósito: así se puede probar
 * con señales fabricadas —un clic cada medio segundo tiene que dar 120— en vez
 * de a ojo con una canción y un metrónomo.
 */

/* --------------------------------------------------------------------- FFT */

/**
 * FFT radix-2 sobre arrays separados de parte real e imaginaria, in situ.
 * `n` debe ser potencia de dos.
 */
export function fft(real, imag) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }
  for (let largo = 2; largo <= n; largo <<= 1) {
    const angulo = (-2 * Math.PI) / largo;
    const wr = Math.cos(angulo);
    const wi = Math.sin(angulo);
    for (let i = 0; i < n; i += largo) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < largo / 2; k += 1) {
        const a = i + k;
        const b = a + largo / 2;
        const tr = real[b] * cr - imag[b] * ci;
        const ti = real[b] * ci + imag[b] * cr;
        real[b] = real[a] - tr;
        imag[b] = imag[a] - ti;
        real[a] += tr;
        imag[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

const hann = (n) => {
  const v = new Float32Array(n);
  for (let i = 0; i < n; i += 1) v[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return v;
};

/* ------------------------------------------------------------------- tempo */

export const TEMPO_MIN = 60;
export const TEMPO_MAX = 190;

/**
 * Envolvente de ataques: cuánta energía nueva entra en cada trozo. Los golpes
 * de percusión aparecen como picos, que es lo que luego se cuenta.
 */
export function envolventeDeAtaques(muestras, tasa, salto = 256) {
  const marcos = Math.max(0, Math.floor((muestras.length - salto) / salto));
  const envolvente = new Float32Array(marcos);
  let anterior = 0;
  for (let i = 0; i < marcos; i += 1) {
    let energia = 0;
    const desde = i * salto;
    for (let j = desde; j < desde + salto; j += 1) energia += muestras[j] * muestras[j];
    energia = Math.sqrt(energia / salto);
    // Rectificado de media onda: solo interesa cuando la energía sube.
    envolvente[i] = Math.max(0, energia - anterior);
    anterior = energia;
  }
  return { envolvente, tasa: tasa / salto };
}

/**
 * Tempo por autocorrelación de la envolvente. Devuelve pulsaciones por minuto
 * y una confianza entre 0 y 1; sin picos claros, la confianza se desploma y
 * quien llama puede decidir no enseñar el número.
 */
export function detectarTempo(envolvente, tasaEnvolvente) {
  const n = envolvente.length;
  if (n < 16 || !Number.isFinite(tasaEnvolvente) || tasaEnvolvente <= 0) {
    return { bpm: 0, confianza: 0 };
  }

  let media = 0;
  for (const v of envolvente) media += v;
  media /= n;
  const centrada = new Float32Array(n);
  for (let i = 0; i < n; i += 1) centrada[i] = envolvente[i] - media;

  const desfaseMin = Math.max(1, Math.floor((60 / TEMPO_MAX) * tasaEnvolvente));
  const desfaseMax = Math.min(n - 1, Math.ceil((60 / TEMPO_MIN) * tasaEnvolvente));
  if (desfaseMax <= desfaseMin) return { bpm: 0, confianza: 0 };

  const correlaciones = new Float64Array(desfaseMax + 1);
  let mejor = 0;
  let mejorDesfase = 0;
  let suma = 0;
  let cuenta = 0;
  for (let desfase = desfaseMin; desfase <= desfaseMax; desfase += 1) {
    let acumulado = 0;
    for (let i = 0; i + desfase < n; i += 1) acumulado += centrada[i] * centrada[i + desfase];
    acumulado /= n - desfase;
    correlaciones[desfase] = acumulado;
    suma += Math.abs(acumulado);
    cuenta += 1;
    if (acumulado > mejor) {
      mejor = acumulado;
      mejorDesfase = desfase;
    }
  }
  if (!mejorDesfase) return { bpm: 0, confianza: 0 };

  // El desfase es un número entero de marcos, y a tempos altos eso es un salto
  // grande: entre 9 y 10 marcos hay catorce pulsaciones de diferencia. Se afina
  // el pico con una parábola sobre sus vecinos.
  let desfaseFino = mejorDesfase;
  if (mejorDesfase > desfaseMin && mejorDesfase < desfaseMax) {
    const izquierda = correlaciones[mejorDesfase - 1];
    const derecha = correlaciones[mejorDesfase + 1];
    const denominador = izquierda - 2 * mejor + derecha;
    if (denominador !== 0) {
      const ajuste = (0.5 * (izquierda - derecha)) / denominador;
      if (Math.abs(ajuste) <= 1) desfaseFino = mejorDesfase + ajuste;
    }
  }

  let bpm = (60 * tasaEnvolvente) / desfaseFino;
  // La autocorrelación confunde con frecuencia el doble y la mitad: se lleva al
  // intervalo en el que vive casi toda la música bailable.
  while (bpm < 80) bpm *= 2;
  while (bpm > 165) bpm /= 2;

  const mediaAbsoluta = cuenta ? suma / cuenta : 0;
  const confianza = mediaAbsoluta > 0 ? Math.min(1, mejor / (mediaAbsoluta * 6)) : 0;
  return { bpm: Math.round(bpm * 10) / 10, confianza: Math.round(confianza * 100) / 100 };
}

/* --------------------------------------------------------------- tonalidad */

export const NOTAS = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
const NOTAS_CIFRADO = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Perfiles de Krumhansl y Kessler: cuánto pesa cada grado en mayor y en menor.
const PERFIL_MAYOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const PERFIL_MENOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** Reparte la energía del espectro en las doce clases de altura. */
export function chromaDeMuestras(muestras, tasa, { ventana = 4096, salto = 2048 } = {}) {
  const chroma = new Float32Array(12);
  if (muestras.length < ventana) return chroma;
  const ventanaHann = hann(ventana);
  const real = new Float32Array(ventana);
  const imag = new Float32Array(ventana);

  for (let inicio = 0; inicio + ventana <= muestras.length; inicio += salto) {
    for (let i = 0; i < ventana; i += 1) {
      real[i] = muestras[inicio + i] * ventanaHann[i];
      imag[i] = 0;
    }
    fft(real, imag);
    for (let bin = 1; bin < ventana / 2; bin += 1) {
      const frecuencia = (bin * tasa) / ventana;
      // Fuera del rango donde vive la melodía, el espectro solo aporta ruido.
      if (frecuencia < 65 || frecuencia > 2100) continue;
      const magnitud = Math.hypot(real[bin], imag[bin]);
      if (magnitud <= 0) continue;
      // Nota MIDI: 69 es La4. Como 69 % 12 = 9 y La ocupa el índice 9, el resto
      // cae ya en su clase sin ningún ajuste. (Aquí hubo un «+3» que rotaba la
      // tonalidad entera y convertía un Do mayor en un Re# mayor.)
      const midi = 12 * Math.log2(frecuencia / 440) + 69;
      const clase = ((Math.round(midi) % 12) + 12) % 12;
      chroma[clase] += magnitud;
    }
  }
  return chroma;
}

/** Compara el chroma con los doce mayores y los doce menores. */
export function detectarTonalidad(chroma) {
  const total = chroma.reduce((suma, v) => suma + v, 0);
  if (!total) return { tonalidad: '', cifrado: '', confianza: 0 };
  const normalizado = Array.from(chroma, (v) => v / total);

  const correlacion = (perfil, giro) => {
    const rotado = perfil.map((_, i) => perfil[(i - giro + 12) % 12]);
    const mediaA = normalizado.reduce((s, v) => s + v, 0) / 12;
    const mediaB = rotado.reduce((s, v) => s + v, 0) / 12;
    let arriba = 0;
    let abajoA = 0;
    let abajoB = 0;
    for (let i = 0; i < 12; i += 1) {
      const a = normalizado[i] - mediaA;
      const b = rotado[i] - mediaB;
      arriba += a * b;
      abajoA += a * a;
      abajoB += b * b;
    }
    const abajo = Math.sqrt(abajoA * abajoB);
    return abajo ? arriba / abajo : 0;
  };

  let mejor = { valor: -2, tonica: 0, menor: false };
  for (let tonica = 0; tonica < 12; tonica += 1) {
    const mayor = correlacion(PERFIL_MAYOR, tonica);
    if (mayor > mejor.valor) mejor = { valor: mayor, tonica, menor: false };
    const menor = correlacion(PERFIL_MENOR, tonica);
    if (menor > mejor.valor) mejor = { valor: menor, tonica, menor: true };
  }

  return {
    tonalidad: `${NOTAS[mejor.tonica]}${mejor.menor ? ' menor' : ' mayor'}`,
    cifrado: `${NOTAS_CIFRADO[mejor.tonica]}${mejor.menor ? 'm' : ''}`,
    confianza: Math.round(Math.max(0, mejor.valor) * 100) / 100,
  };
}

/**
 * Dos canciones pegan si sus tonalidades son vecinas en el círculo de quintas.
 *
 * La cuenta está en `camelot.js`, que es la misma rueda mirada como la mira
 * quien pincha: la misma casilla, la de al lado o la relativa. Antes vivía aquí
 * con la aritmética a mano, y había dos sitios que sabían lo mismo.
 */
export const tonalidadesCompatibles = pegan;
