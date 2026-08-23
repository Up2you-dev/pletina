import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStore } from '../src/main/store.js';

let dir;
const defaults = { version: 1, items: [], flag: false };
const make = (overrides = {}) => createStore({ dir, name: 'prueba', defaults, debounceMs: 5, ...overrides });

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'pletina-store-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('createStore', () => {
  it('arranca con los valores por defecto cuando no hay archivo', async () => {
    const store = make();
    expect(await store.load()).toEqual({ ok: true, fresh: true });
    expect(store.data).toEqual(defaults);
  });

  it('guarda y recupera entre sesiones', async () => {
    const store = make();
    await store.load();
    store.update((d) => {
      d.items.push('uno');
      d.flag = true;
    });
    await store.flush();

    const reloaded = make();
    await reloaded.load();
    expect(reloaded.data.items).toEqual(['uno']);
    expect(reloaded.data.flag).toBe(true);
  });

  it('completa con los valores por defecto las claves que falten', async () => {
    await writeFile(path.join(dir, 'prueba.json'), JSON.stringify({ items: ['solo esto'] }), 'utf8');
    const store = make();
    await store.load();
    expect(store.data.flag).toBe(false);
    expect(store.data.version).toBe(1);
  });

  it('aparta un JSON dañado en vez de perder el archivo', async () => {
    const file = path.join(dir, 'prueba.json');
    await writeFile(file, '{"items": [pero esto no es JSON', 'utf8');
    const store = make();
    const result = await store.load();
    expect(result.ok).toBe(false);
    expect(result.backup).toBe(`${file}.corrupto`);
    expect(await readFile(result.backup, 'utf8')).toContain('pero esto no es JSON');
    expect(store.data).toEqual(defaults);
  });

  it('agrupa muchas escrituras seguidas en una sola', async () => {
    const store = make({ debounceMs: 20 });
    await store.load();
    for (let i = 0; i < 200; i += 1) store.update((d) => d.items.push(i));
    await store.flush();
    const saved = JSON.parse(await readFile(path.join(dir, 'prueba.json'), 'utf8'));
    expect(saved.items).toHaveLength(200);
  });

  it('escribe de forma síncrona al cerrar de golpe', async () => {
    const store = make({ debounceMs: 10000 });
    await store.load();
    store.update((d) => {
      d.flag = true;
    });
    store.flushSync();
    const saved = JSON.parse(await readFile(path.join(dir, 'prueba.json'), 'utf8'));
    expect(saved.flag).toBe(true);
  });

  it('no deja restos del archivo temporal', async () => {
    const store = make();
    await store.load();
    store.update((d) => d.items.push('x'));
    await store.flush();
    await expect(readFile(path.join(dir, 'prueba.json.tmp'), 'utf8')).rejects.toThrow();
  });
});
