import { describe, expect, it } from 'vitest';
import {
  ajustarRejilla,
  analizada,
  detectarCompas,
  detectarFrase,
  duracionDeCompases,
  envolventes,
  primerSonido,
  rejillaCompleta,
  siguienteCompas,
  siguienteFrase,
  siguienteGolpe,
} from '../src/shared/beats.js';

/** Ruido reproducible: una prueba que falla una vez de cada diez no sirve. */
function ruido(semilla) {
  let estado = semilla >>> 0;
  return () => {
    estado = (estado * 1664525 + 1013904223) >>> 0;
    return (estado / 0xffffffff) * 2 - 1;
  };
}

/**
 * Caja de ritmos de laboratorio: bombo grave en los tiempos que se pidan,
 * charles agudo entre medias y, si se pide, una capa que entra al empezar cada
 * frase, que es de lo que se agarra el detector de frases.
 */
function ritmo({
  bpm = 120,
  segundos = 16,
  tasa = 11025,
  desfase = 0,
  acentoCada = 0,
  charles = true,
  capaEnCompas = -1,
  compasesPorFrase = 4,
} = {}) {
  const muestras = new Float32Array(Math.floor(segundos * tasa));
  const periodo = (60 / bpm) * tasa;
  const azar = ruido(20260823);
  let golpe = 0;
  for (let inicio = desfase * tasa; inicio < muestras.length; inicio += periodo) {
    const acento = acentoCada && golpe % acentoCada === 0 ? 1.6 : 1;
    // Bombo: seno de 60 Hz con caída rápida.
    for (let i = 0; i < tasa * 0.12 && inicio + i < muestras.length; i += 1) {
      muestras[Math.floor(inicio) + i] += acento * Math.sin((2 * Math.PI * 60 * i) / tasa) * Math.exp(-i / (tasa * 0.02));
    }
    if (charles) {
      const contra = Math.floor(inicio + periodo / 2);
      for (let i = 0; i < tasa * 0.03 && contra + i < muestras.length; i += 1) {
        muestras[contra + i] += 0.25 * azar() * Math.exp(-i / (tasa * 0.004));
      }
    }
    // Una capa sostenida durante el compás que abre la frase.
    const compas = Math.floor(golpe / 4);
    if (capaEnCompas >= 0 && compas % compasesPorFrase === capaEnCompas) {
      for (let i = 0; i < periodo && Math.floor(inicio) + i < muestras.length; i += 1) {
        muestras[Math.floor(inicio) + i] += 0.3 * Math.sin((2 * Math.PI * 880 * i) / tasa);
      }
    }
    golpe += 1;
  }
  return { muestras, tasa };
}

/** Error hasta el golpe más cercano, en segundos. */
function errorDeFase(offset, referencia, periodo) {
  const d = (((offset - referencia) % periodo) + periodo) % periodo;
  return Math.min(d, periodo - d);
}

describe('envolventes', () => {
  it('separa la banda del bombo de la señal completa', () => {
    const { muestras, tasa } = ritmo({ bpm: 120 });
    const { grave, total, tasa: tasaEnv } = envolventes(muestras, tasa);
    expect(grave.length).toBeGreaterThan(100);
    expect(tasaEnv).toBeCloseTo(tasa / 64, 3);
    const energiaGrave = grave.reduce((s, v) => s + v, 0);
    expect(energiaGrave).toBeGreaterThan(0);
    expect(energiaGrave).toBeGreaterThan(total.reduce((s, v) => s + v, 0) * 0.08);
  });

  it('marca el golpe donde ocurre, sin adelantarlo', () => {
    // Esta es la propiedad que hace que una mezcla suene cuadrada: el filtro se
    // aplica de ida y de vuelta justamente para que no haya desfase.
    const tasa = 11025;
    const muestras = new Float32Array(tasa * 2);
    const en = Math.floor(tasa * 1.0);
    for (let i = 0; i < tasa * 0.12; i += 1) {
      muestras[en + i] = Math.sin((2 * Math.PI * 60 * i) / tasa) * Math.exp(-i / (tasa * 0.02));
    }
    const { grave, tasa: tasaEnv } = envolventes(muestras, tasa);
    let pico = 0;
    for (let i = 1; i < grave.length; i += 1) if (grave[i] > grave[pico]) pico = i;
    expect(Math.abs(pico / tasaEnv - 1.0)).toBeLessThan(0.012);
  });

  it('con una señal muda no inventa golpes', () => {
    const { grave } = envolventes(new Float32Array(11025 * 4), 11025);
    expect(grave.every((v) => v === 0)).toBe(true);
  });
});

describe('ajustarRejilla', () => {
  it('afina el tempo aunque el aproximado venga con error', () => {
    const { muestras, tasa } = ritmo({ bpm: 128, segundos: 30, desfase: 0.1 });
    const { grave, tasa: tasaEnv } = envolventes(muestras, tasa);
    // El detector de tempo entrega 129,4: la rejilla tiene que volver a 128.
    const rejilla = ajustarRejilla(grave, tasaEnv, 129.4);
    expect(Math.abs(rejilla.bpm - 128)).toBeLessThan(0.06);
    expect(errorDeFase(rejilla.offset, 0.1, 60 / 128)).toBeLessThan(0.012);
    expect(rejilla.fuerza).toBeGreaterThan(0.1);
  });

  it('la rejilla sigue cuadrando al final de una canción larga', () => {
    // Cuatro minutos: aquí es donde un tempo con medio punto de error se cae.
    const bpm = 127.3;
    const { muestras, tasa } = ritmo({ bpm, segundos: 240, desfase: 0.37, charles: false });
    const { grave, tasa: tasaEnv } = envolventes(muestras, tasa);
    const rejilla = ajustarRejilla(grave, tasaEnv, 128);

    const periodo = 60 / bpm;
    const golpesHastaElFinal = Math.floor((235 - 0.37) / periodo);
    const real = 0.37 + golpesHastaElFinal * periodo;
    const predicho = siguienteGolpe(real - periodo / 2, rejilla);
    expect(Math.abs(predicho - real)).toBeLessThan(0.03);
  });

  it('ajustada sobre un tramo central, los tiempos siguen siendo de la canción', () => {
    const bpm = 124;
    const { muestras, tasa } = ritmo({ bpm, segundos: 120, desfase: 0.2, charles: false });
    const desde = 40;
    const tramo = muestras.subarray(desde * tasa, 100 * tasa);
    const { grave, tasa: tasaEnv } = envolventes(tramo, tasa);
    const rejilla = ajustarRejilla(grave, tasaEnv, 124.6, { desde });
    expect(errorDeFase(rejilla.offset, 0.2, 60 / bpm)).toBeLessThan(0.012);
  });

  it('sin datos devuelve una rejilla vacía en vez de fallar', () => {
    expect(ajustarRejilla(null, 172, 120)).toEqual({ bpm: 120, offset: 0, fuerza: 0 });
    expect(ajustarRejilla(new Float32Array(10), 172, 0)).toEqual({ bpm: 0, offset: 0, fuerza: 0 });
  });
});

describe('detectarCompas', () => {
  it('encuentra el tiempo fuerte cuando un bombo de cada cuatro pega más', () => {
    const { muestras, tasa } = ritmo({ bpm: 120, segundos: 32, acentoCada: 4, charles: false });
    const { grave, tasa: tasaEnv } = envolventes(muestras, tasa);
    const rejilla = ajustarRejilla(grave, tasaEnv, 120);
    const compas = detectarCompas(grave, tasaEnv, rejilla);
    expect(compas.fuerza).toBeGreaterThan(0.05);
    // La fase de la rejilla solo está definida dentro de un tiempo, así que el
    // número del tiempo fuerte depende de dónde caiga: lo que tiene que cuadrar
    // es el INSTANTE del uno, que es el acento de la caja de ritmos.
    const primerFuerte = rejilla.offset + compas.tiempoFuerte * (60 / 120);
    expect(errorDeFase(primerFuerte, 0, (60 / 120) * 4)).toBeLessThan(0.02);
  });

  it('el uno no cambia por mirar solo un tramo del medio', () => {
    const bpm = 120;
    const { muestras, tasa } = ritmo({ bpm, segundos: 64, acentoCada: 4, charles: false });
    const entero = envolventes(muestras, tasa);
    const rejilla = ajustarRejilla(entero.grave, entero.tasa, bpm);
    const desdeElPrincipio = detectarCompas(entero.grave, entero.tasa, rejilla);

    const desde = 21;
    const tramo = envolventes(muestras.subarray(desde * tasa), tasa);
    const desdeElMedio = detectarCompas(tramo.grave, tramo.tasa, rejilla, { desde });
    expect(desdeElMedio.tiempoFuerte).toBe(desdeElPrincipio.tiempoFuerte);
  });

  it('con todos los golpes iguales no se inventa un acento fuerte', () => {
    const { muestras, tasa } = ritmo({ bpm: 120, charles: false });
    const { grave, tasa: tasaEnv } = envolventes(muestras, tasa);
    const compas = detectarCompas(grave, tasaEnv, { bpm: 120, offset: 0 });
    expect(compas.fuerza).toBeLessThan(0.6);
  });
});

describe('detectarFrase', () => {
  it('encuentra el compás que abre la frase', () => {
    const { muestras, tasa } = ritmo({
      bpm: 128, segundos: 60, acentoCada: 4, charles: false, capaEnCompas: 0,
    });
    const { grave, energia, tasa: tasaEnv } = envolventes(muestras, tasa);
    const rejilla = ajustarRejilla(grave, tasaEnv, 128);
    const compas = detectarCompas(grave, tasaEnv, rejilla);
    const frase = detectarFrase(energia, tasaEnv, { ...rejilla, tiempoFuerte: compas.tiempoFuerte });
    // La capa entra en el primer compás de cada cuatro; el salto de nivel se ve
    // tanto al entrar como al salir, así que vale el compás 0 o el 1.
    expect([0, 1]).toContain(frase.compasFuerte);
    expect(frase.fuerza).toBeGreaterThan(0.1);
  });

  it('sin estructura no señala ninguna frase con fuerza', () => {
    const { muestras, tasa } = ritmo({ bpm: 128, segundos: 40, charles: false });
    const { grave, energia, tasa: tasaEnv } = envolventes(muestras, tasa);
    const rejilla = ajustarRejilla(grave, tasaEnv, 128);
    expect(detectarFrase(energia, tasaEnv, rejilla).fuerza).toBeLessThan(0.35);
  });
});

describe('rejillaCompleta', () => {
  it('describe el ritmo entero de una vez', () => {
    const { muestras, tasa } = ritmo({ bpm: 128, segundos: 40, desfase: 0.1, acentoCada: 4 });
    const rejilla = rejillaCompleta(muestras, tasa, 129);
    expect(rejilla.porBombo).toBe(true);
    expect(Math.abs(rejilla.bpm - 128)).toBeLessThan(0.06);
    expect(errorDeFase(rejilla.offset, 0.1, 60 / 128)).toBeLessThan(0.012);
    expect(rejilla.fuerza).toBeGreaterThan(0);
    expect(rejilla.tiemposPorCompas).toBe(4);
    expect(rejilla.compasesPorFrase).toBe(4);
  });
});

describe('cuándo pinchar', () => {
  const rejilla = { bpm: 120, offset: 0.25, tiempoFuerte: 0, tiemposPorCompas: 4 };

  it('el siguiente golpe cae en la rejilla', () => {
    expect(siguienteGolpe(0.3, rejilla)).toBeCloseTo(0.75, 3);
    expect(siguienteGolpe(1.0, rejilla)).toBeCloseTo(1.25, 3);
    // Si ya estamos justo en un golpe, ese vale.
    expect(siguienteGolpe(0.75, rejilla)).toBeCloseTo(0.75, 3);
  });

  it('el siguiente compás cae cada cuatro tiempos', () => {
    expect(siguienteCompas(0.3, rejilla)).toBeCloseTo(2.25, 3);
    expect(siguienteCompas(2.3, rejilla)).toBeCloseTo(4.25, 3);
  });

  it('el tiempo fuerte desplaza el compás', () => {
    const conAcento = { ...rejilla, tiempoFuerte: 2 };
    expect(siguienteCompas(0, conAcento)).toBeCloseTo(1.25, 3);
  });

  it('la siguiente frase cae cada cuatro compases', () => {
    const conFrase = { ...rejilla, compasFuerte: 0, compasesPorFrase: 4, fuerzaFrase: 0.4 };
    // Tiempo de 0,5 s, compás de 2 s, frase de 8 s a partir del desfase.
    expect(siguienteFrase(0.3, conFrase)).toBeCloseTo(8.25, 3);
    expect(siguienteFrase(8.3, conFrase)).toBeCloseTo(16.25, 3);
  });

  it('el compás fuerte desplaza la frase', () => {
    const conFrase = {
      ...rejilla, compasFuerte: 1, compasesPorFrase: 4, fuerzaFrase: 0.4,
    };
    expect(siguienteFrase(0, conFrase)).toBeCloseTo(2.25, 3);
  });

  it('sin frase clara se conforma con el compás', () => {
    const sinFrase = { ...rejilla, compasFuerte: 2, compasesPorFrase: 4, fuerzaFrase: 0 };
    expect(siguienteFrase(0.3, sinFrase)).toBeCloseTo(siguienteCompas(0.3, sinFrase), 3);
  });

  it('sin tempo no se inventa un instante', () => {
    expect(siguienteGolpe(5, { bpm: 0 })).toBe(5);
    expect(siguienteCompas(5, { bpm: 0 })).toBe(5);
    expect(siguienteFrase(5, { bpm: 0 })).toBe(5);
  });
});

describe('duracionDeCompases', () => {
  it('ocho compases a 120 son dieciséis segundos', () => {
    expect(duracionDeCompases(120, 8)).toBeCloseTo(16, 5);
  });

  it('a 128 duran menos', () => {
    expect(duracionDeCompases(128, 8)).toBeCloseTo(15, 0);
  });

  it('sin tempo, cero', () => {
    expect(duracionDeCompases(0, 8)).toBe(0);
  });
});

describe('primerSonido', () => {
  it('se salta el silencio del principio', () => {
    const tasa = 11025;
    const { muestras } = ritmo({ bpm: 128, segundos: 20, charles: false });
    // Tres segundos de silencio por delante, como en tantos archivos.
    const conSilencio = new Float32Array(muestras.length + tasa * 3);
    conSilencio.set(muestras, tasa * 3);
    const { energia, tasa: tasaEnv } = envolventes(conSilencio, tasa);
    expect(primerSonido(energia, tasaEnv)).toBeGreaterThan(2.8);
    expect(primerSonido(energia, tasaEnv)).toBeLessThan(3.2);
  });

  it('si empieza a sonar desde el principio, entra por el cero', () => {
    const { muestras, tasa } = ritmo({ bpm: 128, segundos: 12, charles: false });
    const { energia, tasa: tasaEnv } = envolventes(muestras, tasa);
    expect(primerSonido(energia, tasaEnv)).toBeLessThan(0.1);
  });

  it('con silencio entero no se inventa una entrada', () => {
    const { energia, tasa: tasaEnv } = envolventes(new Float32Array(11025 * 3), 11025);
    expect(primerSonido(energia, tasaEnv)).toBe(0);
  });
});

describe('analizada', () => {
  const rejilla = { bpm: 128, offset: 0.1, version: 2 };

  it('con rejilla al día, sí', () => {
    expect(analizada({ rejilla, analisis: { en: 1 } })).toBe(true);
  });

  it('con una rejilla vieja, no: hay que rehacerla', () => {
    expect(analizada({ rejilla: { bpm: 128, offset: 0.1 }, analisis: { en: 1 } })).toBe(false);
  });

  it('sin analizar, no', () => {
    expect(analizada({})).toBe(false);
    expect(analizada(null)).toBe(false);
  });

  it('intentada y sin pulso, sí: no se repite en cada lote', () => {
    // Una charla o un minuto de ruido no tienen tempo, y volver a mirarlo cada
    // vez cuesta segundos por canción para nada.
    expect(analizada({ bpm: 0, rejilla: null, analisis: { en: 1712345678 } })).toBe(true);
  });
});
