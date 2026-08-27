import { describe, expect, it } from 'vitest';
import {
  ANCHO_COSTUMBRE, FUERZA_MINIMA, contraste, elegirTempo, envolventes, firmeza, medirDeriva,
  rejillaCompleta, siguienteGolpe,
} from '../src/shared/beats.js';
import { detectarTempo, envolventeDeAtaques } from '../src/shared/musica.js';
import { cancion, nota, ruido } from './musica-falsa.js';

/**
 * Lo que separa un reproductor con un número de bpm de uno con el que se puede
 * pinchar.
 *
 * Estas pruebas no miran si el análisis «funciona»: miran cuánto se equivoca,
 * con música que se parece a la de verdad y en las dos cosas que importan. El
 * tempo tiene que estar en la octava buena —decir 87 de un drum & bass de 174
 * no es medio acierto, es una mezcla que no cuadra jamás— y los golpes tienen
 * que caer donde caen, con error de milisegundos y no de décimas.
 *
 * El listón está donde se nota al oído: veinte milisegundos de desfase ya se
 * oyen como un eco, y medio punto de tempo son dos segundos de desfase en una
 * canción de cinco minutos.
 */

/** El análisis entero, igual que lo hace la aplicación. */
function analizar({ muestras, tasa }) {
  const { envolvente, tasa: tasaEnv } = envolventeDeAtaques(muestras, tasa);
  const { bpm } = detectarTempo(envolvente, tasaEnv);
  if (!bpm) return null;
  const rejilla = rejillaCompleta(muestras, tasa, bpm);
  return rejilla.fuerza >= FUERZA_MINIMA ? rejilla : null;
}

/** Desfase medio entre los golpes de la rejilla y los golpes de verdad. */
function desfaseMedio(rejilla, { bpm, desfase }, segundos = 60) {
  const periodo = 60 / bpm;
  let suma = 0;
  let n = 0;
  for (let t = desfase; t < segundos; t += periodo) {
    // Se busca el golpe de la rejilla más cercano por los dos lados.
    const golpe = siguienteGolpe(t - 60 / rejilla.bpm / 2, rejilla);
    suma += Math.abs(golpe - t);
    n += 1;
  }
  return suma / n;
}

const CASOS = [
  { nombre: 'house a negras, 124,7', hecho: { bpm: 124.7, patron: [0, 1, 2, 3] } },
  { nombre: 'pop con el bombo al uno y al tres, 98,3', hecho: { bpm: 98.3 } },
  {
    nombre: 'hip-hop de bombo espaciado, 87,5',
    hecho: { bpm: 87.5, patron: [0, 2], cajaEn: [2], charlesCada: 0.25 },
  },
  { nombre: 'techno seco, 138', hecho: { bpm: 138, patron: [0, 1, 2, 3], pad: false } },
  { nombre: 'balada con el bombo flojo, 72,4', hecho: { bpm: 72.4, gananciaBombo: 0.25 } },
  { nombre: 'funk con swing, 104', hecho: { bpm: 104, swing: 0.18 } },
  {
    nombre: 'canción sin bombo ninguno, 92,5',
    hecho: { bpm: 92.5, patron: [], cajaEn: [1, 3], gananciaBombo: 0 },
  },
  { nombre: 'garage con la caja a contratiempo, 130', hecho: { bpm: 130, cajaEn: [1, 3] } },
];

// Analizar cien segundos de música cuesta un décimo de segundo, y cada caso se
// mira dos veces: una vez grabado, dos preguntas.
const GRABADAS = CASOS.map(({ nombre, hecho }) => {
  const entero = { segundos: 100, desfase: 0.37, ...hecho };
  return { nombre, entero, rejilla: analizar(cancion(entero)) };
});

describe('el tempo sale en su octava', () => {
  for (const { nombre, entero, rejilla } of GRABADAS) {
    it(nombre, () => {
      expect(rejilla).not.toBe(null);
      // Menos de medio por ciento: en cinco minutos, menos de un segundo y
      // medio de desfase acumulado. Y en la octava buena, no en la mitad.
      expect(Math.abs(rejilla.bpm - entero.bpm) / entero.bpm).toBeLessThan(0.005);
    });
  }
});

describe('los golpes caen donde caen', () => {
  for (const { nombre, entero, rejilla } of GRABADAS) {
    it(nombre, () => {
      // Veinte milisegundos es donde empieza a oírse el eco de dos bombos que
      // no caen juntos.
      expect(desfaseMedio(rejilla, entero)).toBeLessThan(0.02);
    });
  }
});

describe('la confianza dice la verdad', () => {
  const tasa = 11025;
  const azar = ruido(7);

  it('una charla no tiene pulso, y el análisis lo dice', () => {
    // Lo malo no es no saber el tempo de una charla: es decir uno. Una rejilla
    // inventada cuadra el pinchazo con la nada y suena a accidente.
    const charla = new Float32Array(tasa * 60);
    let t = 0;
    while (t < 60) {
      const dura = 0.12 + Math.abs(azar()) * 0.3;
      nota(charla, tasa, t, dura, 110 + Math.abs(azar()) * 180, 0.5, 6);
      t += dura + Math.abs(azar()) * 0.25;
    }
    expect(analizar({ muestras: charla, tasa })).toBe(null);
  });

  it('un ambiente de pads tampoco', () => {
    const ambiente = new Float32Array(tasa * 60);
    for (let i = 0; i < 6; i += 1) nota(ambiente, tasa, i * 10, 12, 110 * 2 ** (i / 12), 0.3, 8);
    expect(analizar({ muestras: ambiente, tasa })).toBe(null);
  });

  it('ruido puro tampoco', () => {
    const puro = new Float32Array(tasa * 60);
    for (let i = 0; i < puro.length; i += 1) puro[i] = azar() * 0.2;
    expect(analizar({ muestras: puro, tasa })).toBe(null);
  });

  it('una canción con el bombo bajito sí, aunque suene floja', () => {
    const rejilla = analizar(cancion({ bpm: 126, patron: [0, 1, 2, 3], gananciaBombo: 0.12 }));
    expect(rejilla?.bpm).toBeCloseTo(126, 0);
    expect(rejilla.fuerza).toBeGreaterThan(FUERZA_MINIMA);
  });

  it('una grabación cuyo tempo se va se analiza, pero avisa', () => {
    const viva = cancion({ bpm: 118, deriva: 1.4, segundos: 100 });
    const quieta = cancion({ bpm: 118, segundos: 100 });
    const rejillaViva = analizar(viva);
    const rejillaQuieta = analizar(quieta);
    expect(rejillaViva).not.toBe(null);
    expect(rejillaViva.deriva).toBeGreaterThan(0.5);
    expect(rejillaQuieta.deriva).toBeLessThan(0.2);
    // Y se nota en la confianza, que es lo que mira quien va a pinchar.
    expect(rejillaViva.fuerza).toBeLessThan(rejillaQuieta.fuerza / 2);
  });
});

describe('contraste', () => {
  it('el tempo bueno destaca más que la mitad y que el doble', () => {
    const { muestras, tasa } = cancion({ bpm: 120, desfase: 0, segundos: 60 });
    const { total, tasa: tasaEnv } = envolventes(muestras, tasa);
    const en = (bpm) => contraste(total, (60 / bpm) * tasaEnv, 0);
    expect(en(120)).toBeGreaterThan(en(60));
    expect(en(120)).toBeGreaterThan(en(240));
  });

  it('sin golpes no hay contraste que sacar', () => {
    expect(contraste(new Float32Array(1000), 40, 0)).toBe(0);
    expect(contraste(new Float32Array(0), 40, 0)).toBe(0);
  });
});

describe('elegirTempo', () => {
  it('la costumbre pesa, pero no manda', () => {
    // El ancho de la curva está medido con noventa y seis canciones
    // fabricadas; si alguien lo mueve, esto avisa de que ha dejado de estarlo.
    expect(ANCHO_COSTUMBRE).toBeCloseTo(0.8, 6);
  });

  it('un tempo rápido con kit escaso no se lee a la mitad', () => {
    // Es el caso que se llevaba media biblioteca de música rápida: bombo al
    // uno, caja al tres y charles a semicorcheas.
    const { muestras, tasa } = cancion({
      bpm: 148, patron: [0, 1, 2, 3], cajaEn: [1, 3], segundos: 70,
    });
    const { total, tasa: tasaEnv } = envolventes(muestras, tasa);
    expect(elegirTempo(total, tasaEnv, 148).bpm).toBeGreaterThan(140);
  });

  it('recupera la octava aunque el detector diga la mitad', () => {
    const { muestras, tasa } = cancion({ bpm: 128, patron: [0, 1, 2, 3], segundos: 60 });
    const { total, tasa: tasaEnv } = envolventes(muestras, tasa);
    expect(elegirTempo(total, tasaEnv, 64).bpm).toBeCloseTo(128, 0);
    expect(elegirTempo(total, tasaEnv, 256).bpm).toBeCloseTo(128, 0);
  });

  it('sin datos no se inventa un tempo', () => {
    expect(elegirTempo(null, 172, 120)).toEqual({ bpm: 0, contraste: 0 });
    expect(elegirTempo(new Float32Array(500), 172, 0)).toEqual({ bpm: 0, contraste: 0 });
  });
});

describe('medirDeriva y firmeza', () => {
  it('un tempo quieto no se va', () => {
    const { muestras, tasa } = cancion({ bpm: 124, segundos: 90 });
    const { grave, tasa: tasaEnv } = envolventes(muestras, tasa);
    expect(medirDeriva(grave, tasaEnv, 124)).toBeLessThan(0.3);
  });

  it('con la canción demasiado corta no se pronuncia', () => {
    expect(medirDeriva(new Float32Array(100), 172, 120)).toBe(0);
    expect(medirDeriva(null, 172, 120)).toBe(0);
  });

  it('media décima de tempo no penaliza; tres puntos, del todo', () => {
    expect(firmeza(0.3)).toBe(1);
    expect(firmeza(3)).toBe(0);
    expect(firmeza(1.4)).toBeGreaterThan(0.5);
    expect(firmeza(1.4)).toBeLessThan(0.7);
  });
});
