import { describe, expect, it } from 'vitest';
import {
  desfaseEntre, franja, lineasDeRejilla, segundoDeX, ventana, xDeSegundo,
} from '../src/shared/onda-vista.js';

const vista = { desde: 10, hasta: 18, ancho: 800 };

describe('ventana', () => {
  it('deja la cabeza en el centro', () => {
    expect(ventana(60, 8)).toEqual({ desde: 56, hasta: 64 });
  });

  it('al principio de la canción se sale por la izquierda, no se pega', () => {
    // Si se pegara al cero, la cabeza dejaría de estar en el centro y las dos
    // ondas ya no se podrían comparar, que es para lo que sirven.
    expect(ventana(1, 8)).toEqual({ desde: -3, hasta: 5 });
  });
});

describe('coordenadas', () => {
  it('el segundo de la izquierda cae en el cero y el de la derecha en el ancho', () => {
    expect(xDeSegundo(10, vista)).toBe(0);
    expect(xDeSegundo(18, vista)).toBe(800);
    expect(xDeSegundo(14, vista)).toBe(400);
  });

  it('y al revés', () => {
    expect(segundoDeX(0, vista)).toBe(10);
    expect(segundoDeX(800, vista)).toBe(18);
    expect(segundoDeX(400, vista)).toBe(14);
  });

  it('ida y vuelta dan lo mismo', () => {
    for (const s of [10.3, 12.7, 17.9]) {
      expect(segundoDeX(xDeSegundo(s, vista), vista)).toBeCloseTo(s, 6);
    }
  });
});

describe('franja', () => {
  const fps = 10;
  // Un pico en el segundo 1 y otro, más pequeño, en el 3.
  const tira = new Uint8Array(50);
  tira[10] = 200;
  tira[30] = 90;

  it('coge el pico de cada columna', () => {
    const columnas = franja(tira, { desde: 0, hasta: 5, ancho: 5, fps });
    // El marco 10 a 10 marcos por segundo es el segundo 1, que cae en la
    // segunda columna: cada columna resume un segundo.
    expect([...columnas]).toEqual([0, 200, 0, 90, 0]);
  });

  it('lo que cae fuera de la canción sale a cero', () => {
    const columnas = franja(tira, { desde: -2, hasta: 2, ancho: 4, fps });
    expect([...columnas.slice(0, 2)]).toEqual([0, 0]);
    expect(columnas[3]).toBe(200);
  });

  it('devuelve tantas columnas como se le piden', () => {
    expect(franja(tira, { desde: 0, hasta: 5, ancho: 313, fps })).toHaveLength(313);
  });

  it('sin datos no revienta', () => {
    expect([...franja(null, { desde: 0, hasta: 5, ancho: 3, fps })]).toEqual([0, 0, 0]);
    expect(franja(tira, { desde: 0, hasta: 5, ancho: 0, fps })).toHaveLength(0);
    expect([...franja(tira, { desde: 5, hasta: 5, ancho: 2, fps })]).toEqual([0, 0]);
  });
});

describe('lineasDeRejilla', () => {
  const rejilla = {
    bpm: 120,
    offset: 0.25,
    tiempoFuerte: 0,
    tiemposPorCompas: 4,
    compasFuerte: 0,
    compasesPorFrase: 4,
    fuerzaFrase: 0.4,
  };

  it('saca un golpe por tiempo dentro del tramo', () => {
    const lineas = lineasDeRejilla(rejilla, { desde: 0, hasta: 2 });
    expect(lineas.map((l) => l.segundo)).toEqual([0.25, 0.75, 1.25, 1.75]);
  });

  it('distingue frase, compás y golpe', () => {
    const lineas = lineasDeRejilla(rejilla, { desde: 0, hasta: 8.3 });
    const porTipo = Object.fromEntries(lineas.map((l) => [l.segundo.toFixed(2), l.tipo]));
    expect(porTipo['0.25']).toBe('frase');
    expect(porTipo['0.75']).toBe('golpe');
    expect(porTipo['2.25']).toBe('compas');
    expect(porTipo['8.25']).toBe('frase');
  });

  it('sin frase medida, la jerarquía sigue estando: los compases van de cuatro en cuatro', () => {
    // En música masterizada el análisis casi nunca encuentra la frase, y
    // condicionar la jerarquía a ese número dejaba la rejilla plana. Los
    // compases se agrupan de cuatro porque así es la música; lo que el análisis
    // aporta es cuál de los cuatro abre, y eso se marca aparte.
    const lineas = lineasDeRejilla({ ...rejilla, fuerzaFrase: 0 }, { desde: 0, hasta: 9 });
    const unos = lineas.filter((l) => l.tipo !== 'golpe');
    expect(unos).toHaveLength(5);
    expect(unos.filter((l) => l.tipo === 'frase')).toHaveLength(2);
    // Pero se dice que esa frase no está medida, para no prometerla.
    expect(unos.filter((l) => l.tipo === 'frase').every((l) => l.medida === false)).toBe(true);
  });

  it('con frase medida, se marca como tal', () => {
    const lineas = lineasDeRejilla(rejilla, { desde: 0, hasta: 9 });
    expect(lineas.filter((l) => l.tipo === 'frase').every((l) => l.medida === true)).toBe(true);
  });

  it('el tiempo fuerte mueve dónde caen los unos', () => {
    const lineas = lineasDeRejilla({ ...rejilla, tiempoFuerte: 2 }, { desde: 0, hasta: 4 });
    const unos = lineas.filter((l) => l.tipo !== 'golpe').map((l) => l.segundo);
    expect(unos).toEqual([1.25, 3.25]);
  });

  it('numera los compases dentro de la frase, que es como se cuentan', () => {
    const lineas = lineasDeRejilla(rejilla, { desde: 0, hasta: 17 });
    const unos = lineas.filter((l) => l.tipo !== 'golpe');
    // A 120, un compás son dos segundos y una frase ocho: uno, dos, tres,
    // cuatro y vuelta a empezar.
    expect(unos.map((l) => l.compas)).toEqual([1, 2, 3, 4, 1, 2, 3, 4, 1]);
    expect(unos.filter((l) => l.compas === 1).every((l) => l.tipo === 'frase')).toBe(true);
  });

  it('los compases se numeran del uno al cuatro aunque no haya frase medida', () => {
    // Antes se numeraban desde el principio de la canción: en el minuto cuatro
    // salían números de tres cifras, que no sirven para contar un compás.
    const lineas = lineasDeRejilla({ ...rejilla, fuerzaFrase: 0 }, { desde: 0, hasta: 9 });
    expect(lineas.filter((l) => l.tipo !== 'golpe').map((l) => l.compas)).toEqual([1, 2, 3, 4, 1]);
  });

  it('un golpe suelto no lleva número: no es un compás', () => {
    const lineas = lineasDeRejilla(rejilla, { desde: 0, hasta: 2 });
    expect(lineas.filter((l) => l.tipo === 'golpe').every((l) => l.compas === null)).toBe(true);
  });

  it('antes del segundo cero no hay compases que dibujar', () => {
    // La vista ampliada se sale por la izquierda para que la cabeza siga en el
    // centro, y ahí se pintaban líneas —y números negativos— de compases que
    // no existen.
    const lineas = lineasDeRejilla(rejilla, { desde: -4, hasta: 2 });
    expect(lineas.every((l) => l.segundo >= 0)).toBe(true);
    expect(lineas.every((l) => l.compas === null || l.compas >= 1)).toBe(true);
  });

  it('y si el tramo entero es anterior a la canción, no hay ninguna', () => {
    expect(lineasDeRejilla(rejilla, { desde: -8, hasta: -1 })).toEqual([]);
  });

  it('con un tramo enorme no devuelve diez mil líneas', () => {
    expect(lineasDeRejilla(rejilla, { desde: 0, hasta: 600 })).toEqual([]);
  });

  it('sin tempo no dibuja rejilla', () => {
    expect(lineasDeRejilla({ bpm: 0 }, { desde: 0, hasta: 10 })).toEqual([]);
    expect(lineasDeRejilla(null, { desde: 0, hasta: 10 })).toEqual([]);
  });
});

describe('desfaseEntre', () => {
  const uno = (bpm, offset = 0) => ({ bpm, offset, tiempoFuerte: 0, tiemposPorCompas: 4 });

  it('dos platos clavados no piden empujón', () => {
    const a = { tiempo: 10, rejilla: uno(120) };
    const b = { tiempo: 30, rejilla: uno(120) };
    expect(desfaseEntre(a, b)).toBeCloseTo(0, 6);
  });

  it('mide cuánto va tarde uno respecto al otro', () => {
    // El plato A va 50 ms por delante de su golpe; el B, justo en el suyo.
    const a = { tiempo: 10.05, rejilla: uno(120) };
    const b = { tiempo: 30, rejilla: uno(120) };
    expect(desfaseEntre(a, b)).toBeCloseTo(0.05, 6);
  });

  it('el desfase se da por el camino corto', () => {
    // Faltando 50 ms para el golpe, la respuesta es -0,05 y no +0,45.
    const a = { tiempo: 9.95, rejilla: uno(120) };
    const b = { tiempo: 30, rejilla: uno(120) };
    expect(desfaseEntre(a, b)).toBeCloseTo(-0.05, 6);
  });

  it('cuenta con el desfase de cada rejilla', () => {
    const a = { tiempo: 10.2, rejilla: uno(120, 0.2) };
    const b = { tiempo: 30.35, rejilla: uno(120, 0.35) };
    expect(desfaseEntre(a, b)).toBeCloseTo(0, 6);
  });

  it('sin rejilla no se inventa un número', () => {
    expect(desfaseEntre({ tiempo: 1 }, { tiempo: 2, rejilla: uno(120) })).toBe(null);
    expect(desfaseEntre(null, null)).toBe(null);
  });
});
