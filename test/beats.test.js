import { describe, expect, it } from 'vitest';
import {
  detectarCompas,
  detectarRejilla,
  duracionDeCompases,
  envolventeDeBombo,
  rejillaCompleta,
  siguienteCompas,
  siguienteGolpe,
} from '../src/shared/beats.js';

/**
 * Caja de ritmos de laboratorio: bombo grave en los tiempos que se pidan, y
 * charles agudo entre medias para que la señal no sea solo bombo.
 */
function ritmo({
  bpm = 120,
  segundos = 16,
  tasa = 11025,
  desfase = 0,
  acentoCada = 0,
  charles = true,
} = {}) {
  const muestras = new Float32Array(Math.floor(segundos * tasa));
  const periodo = (60 / bpm) * tasa;
  let golpe = 0;
  for (let inicio = desfase * tasa; inicio < muestras.length; inicio += periodo) {
    const acento = acentoCada && golpe % acentoCada === 0 ? 1.6 : 1;
    // Bombo: seno de 60 Hz con caída rápida.
    for (let i = 0; i < tasa * 0.12 && inicio + i < muestras.length; i += 1) {
      muestras[Math.floor(inicio) + i] += acento * Math.sin((2 * Math.PI * 60 * i) / tasa) * Math.exp(-i / (tasa * 0.02));
    }
    if (charles) {
      // Charles: ruido agudo en la contra.
      const contra = Math.floor(inicio + periodo / 2);
      for (let i = 0; i < tasa * 0.03 && contra + i < muestras.length; i += 1) {
        muestras[contra + i] += 0.25 * (Math.random() * 2 - 1) * Math.exp(-i / (tasa * 0.004));
      }
    }
    golpe += 1;
  }
  return { muestras, tasa };
}

describe('envolventeDeBombo', () => {
  it('separa la banda del bombo de la señal completa', () => {
    const { muestras, tasa } = ritmo({ bpm: 120 });
    const { grave, total, tasa: tasaEnv } = envolventeDeBombo(muestras, tasa);
    expect(grave.length).toBeGreaterThan(100);
    expect(tasaEnv).toBeCloseTo(tasa / 256, 3);
    // Con bombo de verdad, la banda grave tiene energía propia y pesa dentro
    // de la señal completa: es lo que decide si la rejilla se saca del bombo.
    const energiaGrave = grave.reduce((s, v) => s + v, 0);
    expect(energiaGrave).toBeGreaterThan(0);
    expect(energiaGrave).toBeGreaterThan(total.reduce((s, v) => s + v, 0) * 0.08);
  });

  it('con una señal muda no inventa golpes', () => {
    const { grave } = envolventeDeBombo(new Float32Array(11025 * 4), 11025);
    expect(grave.every((v) => v === 0)).toBe(true);
  });
});

describe('detectarRejilla', () => {
  it('encuentra el primer golpe cuando el ritmo empieza en el cero', () => {
    const { muestras, tasa } = ritmo({ bpm: 120, desfase: 0 });
    const { grave, tasa: tasaEnv } = envolventeDeBombo(muestras, tasa);
    const { retardo } = envolventeDeBombo(muestras, tasa);
    const rejilla = detectarRejilla(grave, tasaEnv, 120, { retardo });
    // 0 y medio segundo son el mismo sitio: el error se mide sobre el periodo.
    const error = Math.min(rejilla.offset % 0.5, 0.5 - (rejilla.offset % 0.5));
    expect(error).toBeLessThan(0.03);
    expect(rejilla.fuerza).toBeGreaterThan(0.1);
  });

  it('encuentra el desfase cuando el ritmo entra tarde', () => {
    const { muestras, tasa } = ritmo({ bpm: 120, desfase: 0.25 });
    const { grave, tasa: tasaEnv } = envolventeDeBombo(muestras, tasa);
    const { retardo } = envolventeDeBombo(muestras, tasa);
    const rejilla = detectarRejilla(grave, tasaEnv, 120, { retardo });
    const distancia = Math.abs(((rejilla.offset - 0.25) % 0.5 + 0.5) % 0.5);
    expect(Math.min(distancia, 0.5 - distancia)).toBeLessThan(0.03);
  });

  it('sin datos devuelve una rejilla vacía en vez de fallar', () => {
    expect(detectarRejilla(null, 43, 120)).toEqual({ offset: 0, fuerza: 0 });
    expect(detectarRejilla(new Float32Array(10), 43, 0)).toEqual({ offset: 0, fuerza: 0 });
  });
});

describe('detectarCompas', () => {
  it('encuentra el tiempo fuerte cuando un bombo de cada cuatro pega más', () => {
    const { muestras, tasa } = ritmo({ bpm: 120, acentoCada: 4, charles: false });
    const { grave, tasa: tasaEnv } = envolventeDeBombo(muestras, tasa);
    const rejilla = detectarRejilla(grave, tasaEnv, 120);
    const compas = detectarCompas(grave, tasaEnv, 120, rejilla.offset);
    expect(compas.fuerza).toBeGreaterThan(0.05);
    expect(compas.tiempoFuerte).toBeGreaterThanOrEqual(0);
    expect(compas.tiempoFuerte).toBeLessThan(4);
  });

  it('con todos los golpes iguales no se inventa un acento fuerte', () => {
    const { muestras, tasa } = ritmo({ bpm: 120, charles: false });
    const { grave, tasa: tasaEnv } = envolventeDeBombo(muestras, tasa);
    const compas = detectarCompas(grave, tasaEnv, 120, 0);
    expect(compas.fuerza).toBeLessThan(0.6);
  });
});

describe('rejillaCompleta', () => {
  it('describe el ritmo entero de una vez', () => {
    const { muestras, tasa } = ritmo({ bpm: 128, desfase: 0.1, acentoCada: 4 });
    const rejilla = rejillaCompleta(muestras, tasa, 128);
    expect(rejilla.porBombo).toBe(true);
    expect(rejilla.offset).toBeGreaterThanOrEqual(0);
    expect(rejilla.offset).toBeLessThan(60 / 128);
    expect(rejilla.fuerza).toBeGreaterThan(0);
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

  it('sin tempo no se inventa un instante', () => {
    expect(siguienteGolpe(5, { bpm: 0 })).toBe(5);
    expect(siguienteCompas(5, { bpm: 0 })).toBe(5);
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
