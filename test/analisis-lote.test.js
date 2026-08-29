import { describe, expect, it } from 'vitest';
import { analizandoLote, analizarLote, cancelarLote, estadoDelLote } from '../src/renderer/analisis-lote.js';

const espera = (ms = 0) => new Promise((listo) => { setTimeout(listo, ms); });

describe('analizarLote', () => {
  it('analiza todas y guarda cada una', async () => {
    const guardadas = [];
    const resumen = await analizarLote(['a', 'b', 'c'], {
      analizar: async (id) => ({ bpm: 128, id }),
      guardar: async (id, resultado) => guardadas.push([id, resultado.bpm]),
    });
    expect(resumen).toMatchObject({ ok: true, hechas: 3, fallidas: 0, saltadas: 0 });
    expect(guardadas).toEqual([['a', 128], ['b', 128], ['c', 128]]);
    expect(analizandoLote()).toBe(false);
  });

  it('se salta lo que ya está analizado', async () => {
    const hechas = [];
    const resumen = await analizarLote(['a', 'b', 'c'], {
      analizar: async (id) => { hechas.push(id); return {}; },
      guardar: async () => {},
      yaHecha: (id) => id !== 'b',
    });
    expect(hechas).toEqual(['b']);
    expect(resumen).toMatchObject({ hechas: 1, saltadas: 2 });
  });

  it('con forzar rehace también lo analizado', async () => {
    const hechas = [];
    await analizarLote(['a', 'b'], {
      analizar: async (id) => { hechas.push(id); return {}; },
      guardar: async () => {},
      yaHecha: () => true,
      forzar: true,
    });
    expect(hechas).toEqual(['a', 'b']);
  });

  it('quita los repetidos y los huecos', async () => {
    const hechas = [];
    await analizarLote(['a', 'a', null, 'b', undefined], {
      analizar: async (id) => { hechas.push(id); return {}; },
      guardar: async () => {},
    });
    expect(hechas).toEqual(['a', 'b']);
  });

  it('una canción rota no tumba el lote', async () => {
    const resumen = await analizarLote(['a', 'rota', 'c'], {
      analizar: async (id) => {
        if (id === 'rota') throw new Error('no se puede decodificar');
        return {};
      },
      guardar: async () => {},
    });
    expect(resumen).toMatchObject({ hechas: 2, fallidas: 1 });
  });

  it('se puede parar a la mitad y no sigue analizando', async () => {
    const hechas = [];
    const lote = analizarLote(['a', 'b', 'c', 'd'], {
      analizar: async (id) => { hechas.push(id); await espera(5); return {}; },
      guardar: async () => {},
    });
    await espera(8);
    cancelarLote();
    const resumen = await lote;
    expect(hechas.length).toBeLessThan(4);
    expect(resumen.cancelado).toBe(true);
    expect(resumen.pendientesSinHacer).toBeGreaterThan(0);
  });

  it('cuenta el progreso mientras trabaja y dice qué canción va', async () => {
    const vistos = [];
    await analizarLote(['a', 'b'], {
      analizar: async () => ({}),
      guardar: async () => {},
      titulo: (id) => `Canción ${id.toUpperCase()}`,
      alProgreso: (estado) => vistos.push(estado && { ...estado }),
    });
    expect(vistos.at(0)).toMatchObject({ total: 2, hechas: 0 });
    expect(vistos.map((v) => v?.titulo)).toContain('Canción B');
    // El último aviso es el de que ya no hay nada en marcha.
    expect(vistos.at(-1)).toBe(null);
  });

  it('con nada pendiente termina sin encender el aviso', async () => {
    const vistos = [];
    const resumen = await analizarLote(['a'], {
      analizar: async () => ({}),
      guardar: async () => {},
      yaHecha: () => true,
      alProgreso: (estado) => vistos.push(estado),
    });
    expect(resumen).toMatchObject({ total: 0, saltadas: 1 });
    expect(vistos).toEqual([null]);
  });

  it('solo el que fuerza pide sustituir lo puesto a mano', async () => {
    // Un repaso de la biblioteca no puede borrar el tempo que alguien marcó a
    // golpes; volver a analizar ESA canción, sí.
    const guardadas = [];
    const guardar = async (id, resultado) => guardadas.push(resultado.sustituirAMano);
    await analizarLote(['a'], { analizar: async () => ({}), guardar });
    await analizarLote(['b'], { analizar: async () => ({}), guardar, forzar: true });
    expect(guardadas).toEqual([false, true]);
  });

  it('no admite dos lotes a la vez', async () => {
    const primero = analizarLote(['a', 'b'], {
      analizar: async () => { await espera(5); return {}; },
      guardar: async () => {},
    });
    const segundo = await analizarLote(['c'], { analizar: async () => ({}), guardar: async () => {} });
    expect(segundo.ok).toBe(false);
    expect(estadoDelLote()).toMatchObject({ total: 2 });
    await primero;
  });
});
