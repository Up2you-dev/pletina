/**
 * Un estudio de grabación de mentira.
 *
 * La caja de ritmos de las otras pruebas es demasiado fácil: bombo a negras y
 * nada más. Con eso cualquier detector acierta, y el detector de verdad falla
 * con música de verdad. Aquí hay caja, charles a corcheas, un bajo que se mueve
 * y un pad que tapa; y estilos donde el bombo no está en todos los tiempos, que
 * es exactamente donde un detector se equivoca de octava y dice la mitad o el
 * doble del tempo que suena.
 *
 * Nada de esto suena bien. No hace falta: hace falta que se parezca a la música
 * de verdad en lo que el análisis mira, que son los golpes y las bandas.
 */

export function ruido(semilla) {
  let estado = semilla >>> 0;
  return () => {
    estado = (estado * 1664525 + 1013904223) >>> 0;
    return (estado / 0xffffffff) * 2 - 1;
  };
}

const sumar = (dest, desde, largo, fn) => {
  const i0 = Math.round(desde);
  for (let i = 0; i < largo && i0 + i < dest.length; i += 1) {
    if (i0 + i < 0) continue;
    dest[i0 + i] += fn(i);
  }
};

export function bombo(dest, tasa, en, ganancia = 1) {
  sumar(dest, en * tasa, tasa * 0.18, (i) => {
    const t = i / tasa;
    // Un bombo baja de tono al golpear: de 110 a 45 Hz en veinte milisegundos.
    const f = 45 + 65 * Math.exp(-t / 0.02);
    return ganancia * Math.sin(2 * Math.PI * f * t) * Math.exp(-t / 0.055);
  });
}

export function caja(dest, tasa, en, azar, ganancia = 1) {
  sumar(dest, en * tasa, tasa * 0.16, (i) => {
    const t = i / tasa;
    const cuerpo = Math.sin(2 * Math.PI * 190 * t) * 0.5;
    return ganancia * (cuerpo + azar() * 0.9) * Math.exp(-t / 0.045);
  });
}

export function charle(dest, tasa, en, azar, ganancia = 0.3) {
  sumar(dest, en * tasa, tasa * 0.05, (i) => (
    ganancia * azar() * Math.exp(-(i / tasa) / 0.008)
  ));
}

export function nota(dest, tasa, en, duracion, hz, ganancia, armonicos = 1) {
  sumar(dest, en * tasa, duracion * tasa, (i) => {
    const t = i / tasa;
    let v = 0;
    for (let a = 1; a <= armonicos; a += 1) v += Math.sin(2 * Math.PI * hz * a * t) / a;
    const sobre = Math.min(1, t / 0.01) * Math.exp(-t / (duracion * 0.7));
    return ganancia * v * sobre;
  });
}

/**
 * Una canción de mentira pero completa.
 *
 * `patron` decide dónde cae el bombo dentro del compás; `feel` mueve las
 * corcheas para imitar el swing; `deriva` hace que el tempo se vaya yendo,
 * como en una grabación tocada a mano.
 */
export function cancion({
  bpm = 124.7,
  segundos = 100,
  tasa = 11025,
  desfase = 0.37,
  patron = [0, 2],          // bombo en el uno y en el tres
  cajaEn = [1, 3],
  charlesCada = 0.5,        // corcheas
  bajo = true,
  pad = true,
  swing = 0,
  deriva = 0,               // bpm que se va a lo largo de la canción
  gananciaBombo = 1,
  semilla = 20260827,
} = {}) {
  const muestras = new Float32Array(Math.floor(segundos * tasa));
  const azar = ruido(semilla);
  const escala = [0, 3, 5, 7, 10];

  let t = desfase;
  let golpe = 0;
  while (t < segundos) {
    const bpmAqui = bpm + (deriva * t) / segundos;
    const periodo = 60 / bpmAqui;
    const enCompas = golpe % 4;
    const compas = Math.floor(golpe / 4);

    if (patron.includes(enCompas)) bombo(muestras, tasa, t, gananciaBombo);
    if (cajaEn.includes(enCompas)) caja(muestras, tasa, t, azar, 0.8);
    if (charlesCada) {
      for (let s = 0; s < 1 / charlesCada; s += 1) {
        const empujon = s % 2 === 1 ? swing * periodo * charlesCada : 0;
        charle(muestras, tasa, t + s * charlesCada * periodo + empujon, azar, s % 2 ? 0.18 : 0.3);
      }
    }
    if (bajo && enCompas % 2 === 0) {
      const grado = escala[(compas + enCompas) % escala.length];
      nota(muestras, tasa, t, periodo * 1.6, 55 * 2 ** (grado / 12), 0.45, 3);
    }
    if (pad && enCompas === 0 && compas % 2 === 0) {
      nota(muestras, tasa, t, periodo * 8, 220 * 2 ** (((compas / 2) % 4) / 12), 0.12, 5);
    }
    t += periodo;
    golpe += 1;
  }
  // Un poco de suelo de ruido, como cualquier grabación.
  for (let i = 0; i < muestras.length; i += 1) muestras[i] += azar() * 0.004;
  return { muestras, tasa };
}

/**
 * El paso que faltaba: la masterización.
 *
 * Todo lo de arriba sale con veinte decibelios de margen entre el pico y la
 * media, y no existe una sola canción publicada así. Un máster pasa por un
 * limitador: sube el nivel hasta que los picos chocan contra el techo, y lo
 * que suena justo después de un bombo se queda agachado mientras el limitador
 * suelta. Eso no es un detalle de volumen, es exactamente lo que confunde a un
 * detector de tempo: la caja del dos y del cuatro sale más floja que el bombo
 * del uno y del tres, y entonces la rejilla de la mitad parece la buena.
 *
 * Sin este paso, las pruebas de análisis se hacían con música que no existe.
 *
 * `drive` son los decibelios que se empujan contra el limitador. Seis dejan la
 * cresta en unos once decibelios, que es un máster normal; catorce la dejan
 * cerca de nueve, que es un máster que va alto. Por encima de eso lo que sale
 * ya no se parece a una canción: se parece a una pared, y no vale para medir.
 */
export function masterizar(muestras, {
  drive = 6, ataque = 0.003, soltar = 0.15, tasa = 11025, objetivo = 0.18,
} = {}) {
  const n = muestras.length;
  const salida = new Float32Array(n);
  if (!n) return salida;
  const nivel = rms(muestras);
  if (!(nivel > 0)) return salida;
  const ganancia = (10 ** (drive / 20) / nivel) * objetivo;
  const subir = Math.exp(-1 / Math.max(1, ataque * tasa));
  const bajar = Math.exp(-1 / Math.max(1, soltar * tasa));
  let seguimiento = 0;
  for (let i = 0; i < n; i += 1) {
    const x = Math.abs(muestras[i]) * ganancia;
    // Ataque rápido y soltar lento: es el bombeo lo que hay que reproducir.
    seguimiento = x > seguimiento
      ? subir * seguimiento + (1 - subir) * x
      : bajar * seguimiento + (1 - bajar) * x;
    const reduccion = seguimiento > 0.9 ? 0.9 / seguimiento : 1;
    salida[i] = Math.tanh(muestras[i] * ganancia * reduccion);
  }
  // Ganancia de recuperación a un nivel fijo, como un máster que va alto.
  const recuperar = objetivo / (rms(salida) || 1);
  for (let i = 0; i < n; i += 1) {
    salida[i] = Math.max(-1, Math.min(1, salida[i] * recuperar));
  }
  return salida;
}

const rms = (muestras) => {
  let suma = 0;
  for (let i = 0; i < muestras.length; i += 1) suma += muestras[i] * muestras[i];
  return Math.sqrt(suma / (muestras.length || 1));
};

/** Decibelios entre el pico y la media: cuánto margen dinámico le queda. */
export function cresta(muestras) {
  let pico = 0;
  for (let i = 0; i < muestras.length; i += 1) {
    const v = Math.abs(muestras[i]);
    if (v > pico) pico = v;
  }
  const medio = rms(muestras);
  return medio > 0 ? 20 * Math.log10(pico / medio) : 0;
}

/** Una canción de mentira ya masterizada, que es como suenan las de verdad. */
export function cancionMasterizada({ drive = 6, ...opciones } = {}) {
  const { muestras, tasa } = cancion(opciones);
  return { muestras: masterizar(muestras, { drive, tasa }), tasa };
}
