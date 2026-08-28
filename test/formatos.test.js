import { describe, expect, it } from 'vitest';
import { esReproducible, nombreDeFormato } from '../src/shared/audio-files.js';

/**
 * Qué se puede sonar y qué no.
 *
 * La lista sale de preguntárselo a este mismo Electron con `canPlayType`, no de
 * suponerlo: AIFF, WMA, APE, WavPack, Musepack, CAF y ALAC contestan «no». Sin
 * esta distinción esas canciones entraban en la biblioteca y se quedaban para
 * siempre «sin analizar», sin que nada dijera por qué.
 */
describe('esReproducible', () => {
  it('los formatos que Chromium decodifica, sí', () => {
    for (const ruta of ['a.mp3', 'a.M4A', 'a.flac', 'a.ogg', 'a.opus', 'a.wav', 'a.aac']) {
      expect(esReproducible({ path: `/musica/${ruta}` })).toBe(true);
    }
  });

  it('y los que no, no', () => {
    for (const ruta of ['a.aiff', 'a.aif', 'a.wma', 'a.ape', 'a.wv', 'a.mpc', 'a.caf']) {
      expect(esReproducible({ path: `/musica/${ruta}` })).toBe(false);
    }
  });

  it('un m4a con ALAC dentro no suena, aunque el envoltorio sí valga', () => {
    // Por fuera es idéntico a un AAC; la diferencia está en el códec.
    expect(esReproducible({ path: '/m/a.m4a', codec: 'AAC' })).toBe(true);
    expect(esReproducible({ path: '/m/a.m4a', codec: 'ALAC' })).toBe(false);
    expect(esReproducible({ path: '/m/a.m4a', codec: 'alac' })).toBe(false);
  });

  it('sin ruta no se afirma nada', () => {
    expect(esReproducible({})).toBe(false);
    expect(esReproducible()).toBe(false);
  });

  it('sabe cómo se llama el formato, para poder decirlo', () => {
    expect(nombreDeFormato({ path: '/m/a.aiff' })).toBe('AIFF');
    expect(nombreDeFormato({ path: '/m/a.m4a', codec: 'ALAC' })).toBe('ALAC');
  });
});
