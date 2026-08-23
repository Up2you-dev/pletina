import { describe, expect, it } from 'vitest';
import { formatQuality, formatTime, formatTotal, formatWhen, plural } from '../src/shared/format.js';

describe('formatTime', () => {
  it('usa m:ss por debajo de la hora', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(9)).toBe('0:09');
    expect(formatTime(61)).toBe('1:01');
    expect(formatTime(599)).toBe('9:59');
  });

  it('pasa a h:mm:ss en grabaciones largas', () => {
    expect(formatTime(3600)).toBe('1:00:00');
    expect(formatTime(3661)).toBe('1:01:01');
  });

  it('no se rompe con duraciones inválidas', () => {
    expect(formatTime(NaN)).toBe('0:00');
    expect(formatTime(-5)).toBe('0:00');
    expect(formatTime(Infinity)).toBe('0:00');
    expect(formatTime(undefined)).toBe('0:00');
  });
});

describe('formatTotal', () => {
  it('elige la unidad según el tamaño', () => {
    expect(formatTotal(45)).toBe('45 s');
    expect(formatTotal(300)).toBe('5 min');
    expect(formatTotal(3600)).toBe('1 h');
    expect(formatTotal(8040)).toBe('2 h 14 min');
  });
});

describe('plural', () => {
  it('concuerda en singular y plural', () => {
    expect(plural(1, 'canción', 'canciones')).toBe('1 canción');
    expect(plural(0, 'canción', 'canciones')).toBe('0 canciones');
    expect(plural(12, 'canción', 'canciones')).toBe('12 canciones');
  });
});

describe('formatQuality', () => {
  it('resume el formato del archivo', () => {
    expect(formatQuality({ codec: 'flac', sampleRate: 44100, bitrate: 1024000 })).toBe('FLAC · 44,1 kHz · 1024 kbps');
  });

  it('omite lo que no se sabe', () => {
    expect(formatQuality({ codec: 'MPEG 1 Layer 3' })).toBe('MPEG 1 LAYER 3');
    expect(formatQuality({})).toBe('');
  });
});

describe('formatWhen', () => {
  const now = new Date('2026-08-23T12:00:00Z').getTime();
  const day = 86400000;

  it('usa palabras para lo reciente', () => {
    expect(formatWhen(now, now)).toBe('hoy');
    expect(formatWhen(now - day, now)).toBe('ayer');
    expect(formatWhen(now - day * 3, now)).toBe('hace 3 días');
  });

  it('cae a la fecha cuando queda lejos', () => {
    expect(formatWhen(now - day * 100, now)).toMatch(/2026/);
  });

  it('marca lo que nunca ha sonado', () => {
    expect(formatWhen(0, now)).toBe('—');
  });
});
