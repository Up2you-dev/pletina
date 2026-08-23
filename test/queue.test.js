import { describe, expect, it } from 'vitest';
import {
  advance,
  createQueue,
  dropManual,
  enqueueLast,
  enqueueNext,
  reshuffle,
  retreat,
  shuffle,
  withoutIds,
} from '../src/shared/queue.js';

/** Generador previsible: el aleatorio deja de serlo dentro de los tests. */
const fakeRng = (values) => {
  let i = 0;
  return () => values[i++ % values.length];
};

const ids = ['a', 'b', 'c', 'd'];

describe('createQueue', () => {
  it('respeta el orden de la vista y arranca donde se ha pulsado', () => {
    const queue = createQueue(ids, { startId: 'c' });
    expect(queue.order).toEqual(ids);
    expect(queue.index).toBe(2);
    expect(queue.source).toEqual(ids);
  });

  it('en aleatorio pone primero lo elegido y baraja el resto', () => {
    const queue = createQueue(ids, { startId: 'c', shuffled: true, rng: fakeRng([0, 0, 0]) });
    expect(queue.order[0]).toBe('c');
    expect([...queue.order].sort()).toEqual(ids);
    expect(queue.index).toBe(0);
  });

  it('no pierde canciones al barajar', () => {
    const result = shuffle(ids, fakeRng([0.9, 0.1, 0.5]));
    expect([...result].sort()).toEqual(ids);
  });
});

describe('advance', () => {
  it('avanza una posición', () => {
    const queue = createQueue(ids, { startId: 'a' });
    const result = advance(queue, { auto: true });
    expect(result.id).toBe('b');
    expect(result.queue.index).toBe(1);
  });

  it('con repetir una, repite la misma al terminarse', () => {
    const queue = createQueue(ids, { startId: 'b' });
    const result = advance(queue, { repeat: 'one', auto: true });
    expect(result.id).toBe('b');
    expect(result.restart).toBe(true);
  });

  it('con el botón de siguiente, «repetir una» no atrapa al oyente', () => {
    const queue = createQueue(ids, { startId: 'b' });
    const result = advance(queue, { repeat: 'one', auto: false });
    expect(result.id).toBe('c');
  });

  it('al final de la lista se para si no hay repetición', () => {
    const queue = createQueue(ids, { startId: 'd' });
    const result = advance(queue, { repeat: 'off', auto: true });
    expect(result.id).toBeNull();
    expect(result.ended).toBe(true);
  });

  it('al final vuelve al principio si se repite todo', () => {
    const queue = createQueue(ids, { startId: 'd' });
    const result = advance(queue, { repeat: 'all', auto: true });
    expect(result.id).toBe('a');
    expect(result.wrapped).toBe(true);
  });

  it('el botón de siguiente da la vuelta aunque no haya repetición', () => {
    const queue = createQueue(ids, { startId: 'd' });
    expect(advance(queue, { repeat: 'off', auto: false }).id).toBe('a');
  });
});

describe('cola manual', () => {
  it('«a continuación» se cuela por delante de la lista', () => {
    let queue = createQueue(ids, { startId: 'a' });
    queue = enqueueNext(queue, ['d']);
    const result = advance(queue, { auto: true });
    expect(result.id).toBe('d');
    expect(result.fromManual).toBe(true);
    // Y no altera el sitio de la lista: después sigue 'b'.
    expect(advance(result.queue, { auto: true }).id).toBe('b');
  });

  it('«al final de la cola» respeta lo que ya estaba a mano', () => {
    let queue = createQueue(ids, { startId: 'a' });
    queue = enqueueNext(queue, ['c']);
    queue = enqueueLast(queue, ['d']);
    expect(queue.manual).toEqual(['c', 'd']);
  });

  it('se puede sacar una entrada concreta de la cola manual', () => {
    let queue = createQueue(ids, { startId: 'a' });
    queue = enqueueLast(queue, ['b', 'c', 'd']);
    expect(dropManual(queue, 1).manual).toEqual(['b', 'd']);
  });

});

describe('retreat', () => {
  it('rebobina si ya ha sonado un rato', () => {
    const queue = createQueue(ids, { startId: 'c' });
    const result = retreat(queue, 12);
    expect(result.restart).toBe(true);
    expect(result.queue.index).toBe(2);
  });

  it('salta a la anterior si acaba de empezar', () => {
    const queue = createQueue(ids, { startId: 'c' });
    const result = retreat(queue, 1.2);
    expect(result.id).toBe('b');
  });

  it('en la primera canción siempre rebobina', () => {
    const queue = createQueue(ids, { startId: 'a' });
    expect(retreat(queue, 0.5).restart).toBe(true);
  });
});

describe('reshuffle', () => {
  it('cambia el orden sin mover lo que está sonando', () => {
    const queue = createQueue(ids, { startId: 'b' });
    const next = reshuffle(queue, 'b', { shuffled: true, rng: fakeRng([0.5, 0.2, 0.8]) });
    expect(next.order[0]).toBe('b');
    expect(next.index).toBe(0);
    expect([...next.order].sort()).toEqual(ids);
  });

  it('al volver a secuencial recupera el orden original', () => {
    const shuffled = createQueue(ids, { startId: 'c', shuffled: true, rng: fakeRng([0.3]) });
    const back = reshuffle(shuffled, 'c', { shuffled: false });
    expect(back.order).toEqual(ids);
    expect(back.index).toBe(2);
  });
});

describe('withoutIds', () => {
  it('saca de la cola lo que ya no existe', () => {
    let queue = createQueue(ids, { startId: 'b' });
    queue = enqueueLast(queue, ['d']);
    const result = withoutIds(queue, ['a', 'd']);
    expect(result.order).toEqual(['b', 'c']);
    expect(result.manual).toEqual([]);
    expect(result.order[result.index]).toBe('b');
  });

  it('si desaparece lo que sonaba, el índice sigue siendo válido', () => {
    const queue = createQueue(ids, { startId: 'd' });
    const result = withoutIds(queue, ['d']);
    expect(result.index).toBeLessThan(result.order.length);
  });
});
