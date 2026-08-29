import { describe, expect, it } from 'vitest';
import {
  camelot, distanciaArmonica, etiquetaDeTono, leerCifrado, openKey, pegan, relacionArmonica,
} from '../src/shared/camelot.js';

/**
 * La rueda tiene una propiedad que se puede comprobar entera: cada casilla
 * tiene exactamente una tonalidad mayor y una menor, y las veinticuatro
 * tonalidades ocupan las veinticuatro casillas. Si algo se rota o se dobla, esto
 * lo caza sin tener que saberse la tabla de memoria.
 */
describe('la rueda de Camelot', () => {
  it('coloca los anclas donde todo el mundo los espera', () => {
    expect(camelot('C')).toBe('8B');
    expect(camelot('Am')).toBe('8A');
    expect(camelot('G')).toBe('9B');
    expect(camelot('F')).toBe('7B');
    expect(camelot('Em')).toBe('9A');
    expect(camelot('Dm')).toBe('7A');
  });

  it('las veinticuatro tonalidades ocupan las veinticuatro casillas', () => {
    const notas = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const casillas = new Set();
    for (const nota of notas) {
      casillas.add(camelot(nota));
      casillas.add(camelot(`${nota}m`));
    }
    expect(casillas.size).toBe(24);
    expect([...casillas].every((c) => /^([1-9]|1[0-2])[AB]$/.test(c))).toBe(true);
  });

  it('una menor comparte casilla con su relativa mayor', () => {
    // La relativa mayor está tres semitonos por encima: La menor y Do mayor.
    const notas = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    notas.forEach((nota, i) => {
      const relativa = notas[(i + 3) % 12];
      expect(camelot(`${nota}m`)).toBe(`${camelot(relativa).slice(0, -1)}A`);
    });
  });

  it('subir una quinta es avanzar un puesto', () => {
    expect(camelot('C')).toBe('8B');
    expect(camelot('G')).toBe('9B');
    expect(camelot('D')).toBe('10B');
    expect(camelot('A')).toBe('11B');
    expect(camelot('E')).toBe('12B');
    expect(camelot('B')).toBe('1B');
  });

  it('lee los bemoles y las formas que traen los archivos ajenos', () => {
    expect(camelot('Bb')).toBe(camelot('A#'));
    expect(camelot('Abm')).toBe(camelot('G#m'));
    expect(camelot('A min')).toBe('8A');
    expect(camelot('Amin')).toBe('8A');
    expect(camelot('a menor')).toBe('8A');
    expect(camelot('F#maj')).toBe(camelot('F#'));
    expect(camelot('C♯m')).toBe(camelot('C#m'));
  });

  it('lo que no se entiende no se inventa', () => {
    expect(camelot('')).toBe('');
    expect(camelot('Hm')).toBe('');
    expect(camelot(null)).toBe('');
    expect(camelot(42)).toBe('');
    expect(leerCifrado('   ')).toBe(null);
  });
});

describe('Open Key', () => {
  it('es la misma rueda girada cuatro puestos', () => {
    expect(openKey('C')).toBe('1d');
    expect(openKey('Am')).toBe('1m');
    expect(openKey('G')).toBe('2d');
    expect(openKey('B')).toBe('6d');
    expect(openKey('nada')).toBe('');
  });
});

describe('qué pega con qué', () => {
  it('la misma, la vecina y la relativa', () => {
    expect(pegan('C', 'C')).toBe(true);
    expect(pegan('C', 'G')).toBe(true);
    expect(pegan('C', 'F')).toBe(true);
    expect(pegan('C', 'Am')).toBe(true);
    expect(pegan('Am', 'C')).toBe(true);
  });

  it('y lo que choca, no', () => {
    expect(pegan('C', 'C#')).toBe(false);
    expect(pegan('C', 'Bm')).toBe(false);
    expect(pegan('C', '')).toBe(false);
  });

  it('dice la relación con palabras, que es lo que se lee de un vistazo', () => {
    expect(relacionArmonica('C', 'C').etiqueta).toBe('misma tonalidad');
    expect(relacionArmonica('C', 'Am').etiqueta).toBe('relativa');
    expect(relacionArmonica('C', 'G').clase).toBe('vecina');
    expect(relacionArmonica('C', 'D').clase).toBe('energia');
    expect(relacionArmonica('C', 'C#').clase).toBe('lejana');
    expect(relacionArmonica('C', 'zzz')).toBe(null);
  });

  it('y ordena: la misma antes que la vecina, y la vecina antes que el salto', () => {
    expect(distanciaArmonica('C', 'C')).toBe(0);
    expect(distanciaArmonica('C', 'G')).toBe(1);
    expect(distanciaArmonica('C', 'Am')).toBe(1);
    expect(distanciaArmonica('C', 'D')).toBe(2);
    expect(distanciaArmonica('C', 'C#')).toBe(3);
    expect(distanciaArmonica('C', '')).toBe(null);
  });

  it('la vuelta de la rueda no crea un abismo entre el doce y el uno', () => {
    // 12B y 1B son vecinas: si la resta no diera la vuelta, saldrían a once.
    expect(pegan('E', 'B')).toBe(true);
    expect(relacionArmonica('E', 'B').salto).toBe(1);
    expect(relacionArmonica('B', 'E').salto).toBe(-1);
  });
});

describe('cómo se enseña', () => {
  it('la casilla delante, que es la que se usa para decidir', () => {
    expect(etiquetaDeTono({ key: 'Am', tonalidad: 'La menor' })).toBe('8A · Am');
    // Sin cifrado que entender, se enseña lo que haya.
    expect(etiquetaDeTono({ key: '', tonalidad: 'La menor' })).toBe('La menor');
    expect(etiquetaDeTono({})).toBe('');
  });
});
