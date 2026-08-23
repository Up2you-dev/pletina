import { describe, expect, it } from 'vitest';
import { parseRange } from '../src/shared/range.js';

describe('parseRange', () => {
  const size = 1000;

  it('devuelve null cuando no hay cabecera', () => {
    expect(parseRange(null, size)).toBeNull();
    expect(parseRange('', size)).toBeNull();
    expect(parseRange('bytes=-', size)).toBeNull();
  });

  it('lee un tramo cerrado', () => {
    expect(parseRange('bytes=0-99', size)).toEqual({ start: 0, end: 99, length: 100 });
    expect(parseRange('bytes=200-299', size)).toEqual({ start: 200, end: 299, length: 100 });
  });

  it('completa un tramo abierto hasta el final', () => {
    expect(parseRange('bytes=500-', size)).toEqual({ start: 500, end: 999, length: 500 });
  });

  it('entiende el sufijo de los últimos bytes', () => {
    expect(parseRange('bytes=-100', size)).toEqual({ start: 900, end: 999, length: 100 });
    // Un sufijo mayor que el archivo se sirve entero, no da error.
    expect(parseRange('bytes=-5000', size)).toEqual({ start: 0, end: 999, length: 1000 });
  });

  it('recorta un final que se pasa del archivo', () => {
    expect(parseRange('bytes=900-5000', size)).toEqual({ start: 900, end: 999, length: 100 });
  });

  it('marca como insatisfacible lo que no se puede servir', () => {
    expect(parseRange('bytes=1000-1100', size)).toEqual({ unsatisfiable: true });
    expect(parseRange('bytes=300-100', size)).toEqual({ unsatisfiable: true });
    expect(parseRange('bytes=-0', size)).toEqual({ unsatisfiable: true });
  });

  it('ignora formatos que no son de bytes', () => {
    expect(parseRange('items=0-10', size)).toBeNull();
    expect(parseRange('bytes=abc-def', size)).toBeNull();
  });
});
