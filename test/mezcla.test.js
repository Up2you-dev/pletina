import { describe, expect, it } from 'vitest';
import { GRAVE_FUERA, MEDIO_FUERA, describirPlan, planDeMezcla } from '../src/shared/mezcla.js';

const rejilla = (bpm, offset = 0) => ({ bpm, offset, tiempoFuerte: 0, tiemposPorCompas: 4 });

const base = {
  saliente: { bpm: 128, key: 'Am', posicion: 60, duracion: 300, rejilla: rejilla(128) },
  entrante: { bpm: 126, key: 'C', duracion: 300, rejilla: rejilla(126) },
};

const eventosDe = (plan, plato, parametro) => plan.eventos.filter(
  (e) => e.plato === plato && e.parametro === parametro,
);

describe('ajuste de tempo', () => {
  it('calcula la velocidad para igualar los tempos', () => {
    const plan = planDeMezcla(base);
    expect(plan.sincronizado).toBe(true);
    expect(plan.velocidad).toBeCloseTo(128 / 126, 3);
  });

  it('entiende que 64 y 128 son el mismo pulso', () => {
    const plan = planDeMezcla({
      ...base,
      entrante: { ...base.entrante, bpm: 64, rejilla: rejilla(64) },
    });
    expect(plan.sincronizado).toBe(true);
    // 128/64 = 2, que se lleva a 1: es el mismo pulso al doble.
    expect(plan.velocidad).toBeCloseTo(1, 2);
  });

  it('se niega a estirar de más y lo dice', () => {
    const plan = planDeMezcla({
      ...base,
      entrante: { ...base.entrante, bpm: 95, rejilla: rejilla(95) },
    });
    expect(plan.sincronizado).toBe(false);
    expect(plan.velocidad).toBe(1);
    expect(plan.avisos.join(' ')).toMatch(/demasiado lejos/);
  });

  it('sin tempo analizado avisa en vez de inventar', () => {
    const plan = planDeMezcla({
      ...base,
      entrante: { ...base.entrante, bpm: 0, rejilla: rejilla(0) },
    });
    expect(plan.sincronizado).toBe(false);
    expect(plan.avisos.join(' ')).toMatch(/analízalas/);
  });

  it('se puede pinchar sin sincronizar', () => {
    const plan = planDeMezcla({ ...base, ajustarTempo: false });
    expect(plan.velocidad).toBe(1);
    expect(plan.sincronizado).toBe(false);
  });
});

describe('cuándo entra', () => {
  it('el pinchazo cae en un inicio de compás de la que suena', () => {
    const plan = planDeMezcla(base);
    const compas = (60 / 128) * 4;
    const compases = plan.arranque / compas;
    // Tiene que ser un número entero de compases desde el origen de la rejilla.
    expect(Math.abs(Math.round(compases) - compases)).toBeLessThan(0.01);
    // Y siempre por delante de donde está sonando ahora.
    expect(plan.arranque).toBeGreaterThan(base.saliente.posicion);
  });

  it('la que entra empieza en su propio uno', () => {
    const plan = planDeMezcla({
      ...base,
      entrante: { ...base.entrante, rejilla: rejilla(126, 0.4) },
    });
    const compas = (60 / 126) * 4;
    const desdeSuUno = (plan.inicioEntrante - 0.4) / compas;
    expect(Math.abs(Math.round(desdeSuUno) - desdeSuUno)).toBeLessThan(0.01);
  });

  it('ocho compases a 128 duran quince segundos', () => {
    expect(planDeMezcla(base).duracion).toBeCloseTo(15, 0);
  });

  it('la transición se acorta si la canción se acaba antes', () => {
    const plan = planDeMezcla({
      ...base,
      saliente: { ...base.saliente, posicion: 292, duracion: 300 },
    });
    expect(plan.duracion).toBeLessThan(15);
    expect(plan.avisos.join(' ')).toMatch(/se acorta/);
  });
});

describe('coreografía del cambio de graves', () => {
  const plan = planDeMezcla(base);

  it('la que entra lo hace sin graves', () => {
    const primero = eventosDe(plan, 'entrante', 'grave')[0];
    expect(primero.en).toBe(0);
    expect(primero.a).toBe(GRAVE_FUERA);
  });

  it('los graves se cambian a la vez, a mitad de transición', () => {
    const sale = eventosDe(plan, 'saliente', 'grave').find((e) => e.a === GRAVE_FUERA);
    const entra = eventosDe(plan, 'entrante', 'grave').find((e) => e.en > 0 && e.a === 0);
    expect(sale.en).toBeCloseTo(plan.duracion / 2, 2);
    expect(entra.en).toBeCloseTo(sale.en, 3);
    expect(plan.cambioDeGraves).toBeCloseTo(sale.en, 3);
  });

  it('el cambio es rápido: un tiempo, no medio minuto', () => {
    const sale = eventosDe(plan, 'saliente', 'grave').find((e) => e.a === GRAVE_FUERA);
    expect(sale.rampa).toBeLessThan(0.6);
  });

  it('la que sale se apaga del todo al final', () => {
    const ultima = eventosDe(plan, 'saliente', 'ganancia').at(-1);
    expect(ultima.a).toBe(0);
    expect(ultima.en + ultima.rampa).toBeCloseTo(plan.duracion, 1);
  });

  it('la que entra acaba como una canción normal', () => {
    const final = plan.eventos.filter((e) => e.en === plan.duracion && e.plato === 'entrante');
    expect(final.find((e) => e.parametro === 'grave').a).toBe(0);
    expect(final.find((e) => e.parametro === 'ganancia').a).toBe(1);
  });

  it('los eventos van en orden de tiempo', () => {
    const tiempos = plan.eventos.map((e) => e.en);
    expect([...tiempos].sort((a, b) => a - b)).toEqual(tiempos);
  });
});

describe('otros estilos', () => {
  it('el fundido no toca los graves', () => {
    const plan = planDeMezcla({ ...base, estilo: 'fundido' });
    expect(plan.eventos.filter((e) => e.parametro === 'grave' && e.a === GRAVE_FUERA)).toHaveLength(0);
    expect(plan.cambioDeGraves).toBeNull();
  });

  it('el corte cambia de canción de golpe', () => {
    const plan = planDeMezcla({ ...base, estilo: 'corte' });
    const sale = eventosDe(plan, 'saliente', 'ganancia')[0];
    expect(sale.rampa).toBeLessThan(0.2);
  });
});

describe('tonalidad', () => {
  it('avisa cuando las tonalidades chocan', () => {
    const plan = planDeMezcla({
      ...base,
      entrante: { ...base.entrante, key: 'C#' },
    });
    expect(plan.avisos.join(' ')).toMatch(/tonalidades chocan/);
  });

  it('no dice nada si son compatibles', () => {
    const plan = planDeMezcla({ ...base, entrante: { ...base.entrante, key: 'C' } });
    expect(plan.avisos.join(' ')).not.toMatch(/tonalidades/);
  });
});

describe('describirPlan', () => {
  it('resume lo que va a pasar', () => {
    const texto = describirPlan(planDeMezcla(base));
    expect(texto).toMatch(/8 compases/);
    expect(texto).toMatch(/graves/);
    expect(texto).toMatch(/tempo/);
  });

  it('con un plan vacío no se rompe', () => {
    expect(describirPlan(null)).toBe('');
  });
});

describe('cuadrar como un pinchadiscos', () => {
  const conFrase = (bpm, offset = 0) => ({
    bpm,
    offset,
    tiempoFuerte: 0,
    tiemposPorCompas: 4,
    compasFuerte: 0,
    compasesPorFrase: 4,
    fuerzaFrase: 0.4,
  });

  it('pincha en frase cuando las dos la tienen clara', () => {
    const plan = planDeMezcla({
      saliente: { bpm: 128, duracion: 300, posicion: 60, rejilla: conFrase(128) },
      entrante: { bpm: 128, duracion: 300, rejilla: conFrase(128, 0.2) },
      compases: 8,
    });
    expect(plan.porFrases).toBe(true);
    const frase = (60 / 128) * 16;
    expect(plan.arranque % frase).toBeCloseTo(0, 2);
    // Y la que entra empieza en el primer inicio de frase suyo.
    expect((plan.inicioEntrante - 0.2) % frase).toBeCloseTo(0, 2);
    expect(describirPlan(plan)).toMatch(/en frase/);
  });

  it('si una no tiene frase clara, se conforma con el compás', () => {
    const plan = planDeMezcla({
      saliente: { bpm: 128, duracion: 300, posicion: 60, rejilla: conFrase(128) },
      entrante: { bpm: 128, duracion: 300, rejilla: rejilla(128) },
      compases: 8,
    });
    expect(plan.porFrases).toBe(false);
    expect(describirPlan(plan)).toMatch(/en compás/);
    const compas = (60 / 128) * 4;
    expect(plan.arranque % compas).toBeCloseTo(0, 2);
  });

  it('con transiciones que no miden frases enteras, tampoco', () => {
    const plan = planDeMezcla({
      saliente: { bpm: 128, duracion: 300, posicion: 60, rejilla: conFrase(128) },
      entrante: { bpm: 128, duracion: 300, rejilla: conFrase(128) },
      compases: 2,
    });
    expect(plan.porFrases).toBe(false);
  });

  it('el cambio de graves cae en un inicio de compás', () => {
    for (const compases of [4, 8, 16, 32]) {
      const plan = planDeMezcla({ ...base, compases });
      const compas = plan.compasSegundos;
      expect(plan.cambioDeGraves / compas).toBeCloseTo(Math.round(plan.cambioDeGraves / compas), 3);
      expect(plan.cambioDeGraves).toBeGreaterThan(0);
      expect(plan.cambioDeGraves).toBeLessThan(plan.duracion);
    }
  });

  it('la duración plena no se recorta: es la que dice cuándo lanzar la mezcla', () => {
    const plan = planDeMezcla({
      ...base,
      saliente: { ...base.saliente, duracion: 71.4, posicion: 60 },
      compases: 8,
    });
    expect(plan.duracion).toBeLessThan(plan.duracionPlena);
    expect(plan.duracionPlena).toBeCloseTo((60 / 128) * 4 * 8, 2);
  });

  it('cuando hay que acortar, se acorta por compases enteros', () => {
    const plan = planDeMezcla({
      ...base,
      saliente: { ...base.saliente, duracion: 71.4, posicion: 60 },
      compases: 8,
    });
    expect(plan.avisos.join(' ')).toMatch(/se acorta/);
    expect(plan.duracion / plan.compasSegundos).toBeCloseTo(Math.round(plan.duracion / plan.compasSegundos), 3);
    expect(plan.duracion).toBeLessThanOrEqual(71.4 - plan.arranque + 0.001);
  });

  it('la que entra también deja sitio en los medios hasta el cambio', () => {
    const plan = planDeMezcla(base);
    const medios = eventosDe(plan, 'entrante', 'medio');
    expect(medios[0]).toMatchObject({ en: 0, a: MEDIO_FUERA });
    // Y se los devuelve justo en el cambio de graves.
    expect(medios.some((e) => e.en === plan.cambioDeGraves && e.a === 0)).toBe(true);
  });
});
