import { describe, expect, it } from 'vitest';
import {
  chromaDeMuestras,
  detectarTempo,
  detectarTonalidad,
  envolventeDeAtaques,
  fft,
  tonalidadesCompatibles,
} from '../src/shared/musica.js';

/** Señal con un golpe seco cada `periodo` segundos: un metrónomo de laboratorio. */
function claves({ bpm, segundos = 12, tasa = 11025 }) {
  const muestras = new Float32Array(Math.floor(segundos * tasa));
  const periodo = Math.round((60 / bpm) * tasa);
  for (let inicio = 0; inicio < muestras.length; inicio += periodo) {
    // Golpe corto con caída rápida, como una caja.
    for (let i = 0; i < 400 && inicio + i < muestras.length; i += 1) {
      muestras[inicio + i] = Math.sin(i * 0.7) * Math.exp(-i / 60);
    }
  }
  return { muestras, tasa };
}

/** Acorde sostenido a partir de las notas que se le pasen (en semitonos sobre Do4). */
function acorde(semitonos, { segundos = 4, tasa = 11025 } = {}) {
  const muestras = new Float32Array(Math.floor(segundos * tasa));
  const frecuencia = (semitono) => 261.63 * 2 ** (semitono / 12);
  for (let i = 0; i < muestras.length; i += 1) {
    let valor = 0;
    for (const semitono of semitonos) valor += Math.sin((2 * Math.PI * frecuencia(semitono) * i) / tasa);
    muestras[i] = valor / semitonos.length;
  }
  return { muestras, tasa };
}

describe('fft', () => {
  it('encuentra la frecuencia de un seno puro', () => {
    const n = 1024;
    const tasa = 8000;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let i = 0; i < n; i += 1) real[i] = Math.sin((2 * Math.PI * 1000 * i) / tasa);

    fft(real, imag);

    let mejor = 0;
    let bin = 0;
    for (let i = 1; i < n / 2; i += 1) {
      const magnitud = Math.hypot(real[i], imag[i]);
      if (magnitud > mejor) {
        mejor = magnitud;
        bin = i;
      }
    }
    expect((bin * tasa) / n).toBeCloseTo(1000, -1);
  });

  it('una señal constante concentra toda la energía en el primer bin', () => {
    const real = new Float32Array(64).fill(1);
    const imag = new Float32Array(64);
    fft(real, imag);
    expect(real[0]).toBeCloseTo(64, 5);
    expect(Math.hypot(real[5], imag[5])).toBeCloseTo(0, 5);
  });
});

describe('detectarTempo', () => {
  for (const bpm of [90, 120, 128, 140]) {
    it(`cuenta ${bpm} pulsaciones en un metrónomo de ${bpm}`, () => {
      const { muestras, tasa } = claves({ bpm });
      const { envolvente, tasa: tasaEnv } = envolventeDeAtaques(muestras, tasa);
      const resultado = detectarTempo(envolvente, tasaEnv);
      expect(resultado.bpm).toBeGreaterThan(bpm - 3);
      expect(resultado.bpm).toBeLessThan(bpm + 3);
      expect(resultado.confianza).toBeGreaterThan(0.1);
    });
  }

  it('lleva los tempos lentos al intervalo donde vive la música', () => {
    // 70 se detecta, pero se dobla a 140: es la misma pulsación contada al doble.
    const { muestras, tasa } = claves({ bpm: 70 });
    const { envolvente, tasa: tasaEnv } = envolventeDeAtaques(muestras, tasa);
    expect(detectarTempo(envolvente, tasaEnv).bpm).toBeGreaterThan(79);
  });

  it('con silencio no se inventa un tempo', () => {
    const muestras = new Float32Array(11025 * 5);
    const { envolvente, tasa } = envolventeDeAtaques(muestras, 11025);
    expect(detectarTempo(envolvente, tasa).bpm).toBe(0);
  });

  it('con una envolvente demasiado corta devuelve cero, no un número inventado', () => {
    expect(detectarTempo(new Float32Array(4), 21).bpm).toBe(0);
  });
});

describe('detectarTonalidad', () => {
  it('reconoce un acorde de Do mayor', () => {
    const { muestras, tasa } = acorde([0, 4, 7]);
    const resultado = detectarTonalidad(chromaDeMuestras(muestras, tasa));
    expect(resultado.cifrado).toBe('C');
    expect(resultado.tonalidad).toBe('Do mayor');
  });

  it('distingue el modo menor', () => {
    const { muestras, tasa } = acorde([9, 12, 16]); // La, Do, Mi
    const resultado = detectarTonalidad(chromaDeMuestras(muestras, tasa));
    expect(resultado.cifrado).toBe('Am');
  });

  it('reconoce otra tónica', () => {
    const { muestras, tasa } = acorde([7, 11, 14]); // Sol, Si, Re
    expect(detectarTonalidad(chromaDeMuestras(muestras, tasa)).cifrado).toBe('G');
  });

  it('sin energía no devuelve tonalidad', () => {
    expect(detectarTonalidad(new Float32Array(12)).tonalidad).toBe('');
  });
});

describe('tonalidadesCompatibles', () => {
  it('acepta la misma, la quinta y la cuarta', () => {
    expect(tonalidadesCompatibles('C', 'C')).toBe(true);
    expect(tonalidadesCompatibles('C', 'G')).toBe(true);
    expect(tonalidadesCompatibles('C', 'F')).toBe(true);
  });

  it('acepta la relativa menor', () => {
    expect(tonalidadesCompatibles('C', 'Am')).toBe(true);
    expect(tonalidadesCompatibles('Am', 'C')).toBe(true);
  });

  it('rechaza las que chocan', () => {
    expect(tonalidadesCompatibles('C', 'C#')).toBe(false);
    expect(tonalidadesCompatibles('C', 'Bm')).toBe(false);
  });

  it('sin datos no se moja', () => {
    expect(tonalidadesCompatibles('', 'C')).toBe(false);
    expect(tonalidadesCompatibles('C', null)).toBe(false);
  });
});
