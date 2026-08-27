import { describe, expect, it } from 'vitest';
import {
  calcularOndas, desempaquetar, empaquetar, resumir,
} from '../src/shared/ondas.js';

/** Un tono puro de la frecuencia que se pida, para saber en qué banda debe caer. */
function tono(hz, { segundos = 2, tasa = 11025, amplitud = 0.8 } = {}) {
  const muestras = new Float32Array(Math.floor(segundos * tasa));
  for (let i = 0; i < muestras.length; i += 1) {
    muestras[i] = amplitud * Math.sin((2 * Math.PI * hz * i) / tasa);
  }
  return { muestras, tasa };
}

const media = (tira) => tira.reduce((s, v) => s + v, 0) / (tira.length || 1);

describe('calcularOndas', () => {
  it('un grave pinta en la banda grave y no en las otras', () => {
    const { muestras, tasa } = tono(60);
    const ondas = calcularOndas(muestras, tasa);
    expect(media(ondas.grave)).toBeGreaterThan(150);
    expect(media(ondas.medio)).toBeLessThan(30);
    expect(media(ondas.agudo)).toBeLessThan(30);
  });

  it('una voz pinta en los medios', () => {
    const { muestras, tasa } = tono(800);
    const ondas = calcularOndas(muestras, tasa);
    expect(media(ondas.medio)).toBeGreaterThan(150);
    expect(media(ondas.grave)).toBeLessThan(30);
    expect(media(ondas.agudo)).toBeLessThan(30);
  });

  it('un platillo pinta en los agudos', () => {
    const { muestras, tasa } = tono(4000);
    const ondas = calcularOndas(muestras, tasa);
    expect(media(ondas.agudo)).toBeGreaterThan(150);
    expect(media(ondas.grave)).toBeLessThan(30);
  });

  it('las tres bandas se escalan con la misma vara', () => {
    // Un grave el doble de fuerte que un agudo tiene que pintar el doble: si
    // cada banda se normalizara por su cuenta, los dos pintarían igual y la
    // onda dejaría de decir nada.
    const tasa = 11025;
    const n = tasa * 2;
    const muestras = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      muestras[i] = 0.8 * Math.sin((2 * Math.PI * 60 * i) / tasa)
        + 0.2 * Math.sin((2 * Math.PI * 4000 * i) / tasa);
    }
    const ondas = calcularOndas(muestras, tasa);
    const razon = media(ondas.grave) / media(ondas.agudo);
    expect(razon).toBeGreaterThan(2.5);
    expect(razon).toBeLessThan(6);
  });

  it('un chasquido no aplana la canción entera', () => {
    const tasa = 11025;
    const { muestras } = tono(60, { segundos: 4, amplitud: 0.3 });
    // Un pico aislado diez veces más alto que el resto.
    for (let i = 0; i < 40; i += 1) muestras[tasa * 2 + i] = 3;
    const ondas = calcularOndas(muestras, tasa);
    expect(media(ondas.grave)).toBeGreaterThan(120);
  });

  it('con silencio no inventa nada', () => {
    const ondas = calcularOndas(new Float32Array(11025), 11025);
    expect(ondas.marcos).toBeGreaterThan(0);
    expect(media(ondas.grave)).toBe(0);
  });

  it('sin muestras devuelve una onda vacía en vez de fallar', () => {
    const ondas = calcularOndas(new Float32Array(0), 11025);
    expect(ondas.marcos).toBe(0);
    expect(ondas.grave).toHaveLength(0);
  });

  it('los marcos cuadran con la duración', () => {
    const { muestras, tasa } = tono(200, { segundos: 3 });
    const ondas = calcularOndas(muestras, tasa, { fps: 100 });
    expect(ondas.duracion).toBeCloseTo(3, 2);
    expect(ondas.marcos / ondas.fps).toBeCloseTo(3, 1);
  });
});

describe('empaquetar y desempaquetar', () => {
  it('lo que entra es lo que sale', () => {
    const { muestras, tasa } = tono(120, { segundos: 1.5 });
    const ondas = calcularOndas(muestras, tasa);
    const vuelta = desempaquetar(empaquetar(ondas));

    expect(vuelta.marcos).toBe(ondas.marcos);
    expect(Math.round(vuelta.fps)).toBe(Math.round(ondas.fps));
    expect(vuelta.duracion).toBeCloseTo(ondas.duracion, 2);
    expect([...vuelta.grave]).toEqual([...ondas.grave]);
    expect([...vuelta.agudo]).toEqual([...ondas.agudo]);
  });

  it('ocupa tres bytes por marco y poco más', () => {
    const { muestras, tasa } = tono(120, { segundos: 10 });
    const ondas = calcularOndas(muestras, tasa);
    expect(empaquetar(ondas).byteLength).toBe(16 + ondas.marcos * 3);
  });

  it('un archivo que no es una onda no revienta la pantalla', () => {
    expect(desempaquetar(null)).toBe(null);
    expect(desempaquetar(new Uint8Array(4))).toBe(null);
    expect(desempaquetar(new Uint8Array(64))).toBe(null);
  });

  it('un archivo a medias tampoco', () => {
    const { muestras, tasa } = tono(120, { segundos: 2 });
    const entero = empaquetar(calcularOndas(muestras, tasa));
    expect(desempaquetar(entero.subarray(0, entero.byteLength - 100))).toBe(null);
  });
});

describe('resumir', () => {
  it('se queda con el pico de cada tramo', () => {
    const tira = new Uint8Array([0, 10, 200, 5, 0, 0, 30, 0]);
    expect([...resumir(tira, 4)]).toEqual([10, 200, 0, 30]);
  });

  it('devuelve tantas columnas como se le piden', () => {
    expect(resumir(new Uint8Array(1000), 320)).toHaveLength(320);
    expect(resumir(new Uint8Array(10), 40)).toHaveLength(40);
  });

  it('sin datos, columnas vacías', () => {
    expect([...resumir(new Uint8Array(0), 3)]).toEqual([0, 0, 0]);
    expect(resumir(null, 3)).toHaveLength(3);
    expect(resumir(new Uint8Array(4), 0)).toHaveLength(0);
  });
});
