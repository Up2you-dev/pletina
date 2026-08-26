import { describe, expect, it } from 'vitest';
import {
  formatPorcentaje, formatQuality, formatTime, formatTotal, formatWhen, plural,
} from '../src/shared/format.js';

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

  it('añade tempo y tonalidad cuando se han analizado', () => {
    expect(formatQuality({ codec: 'flac', bpm: 128.4, key: 'Am' })).toBe('FLAC · 128 bpm · Am');
    // Sin analizar, ni se mencionan.
    expect(formatQuality({ codec: 'flac', bpm: 0, key: '' })).toBe('FLAC');
  });

  it('con el tempo ajustado enseña el bpm que suena y cuánto se ha estirado', () => {
    expect(formatQuality({ codec: 'flac', bpm: 128, key: 'Am' }, { velocidad: 1.016 }))
      .toBe('FLAC · 130 bpm · Am · +1,6 %');
    expect(formatQuality({ codec: 'flac', bpm: 128 }, { velocidad: 0.95 }))
      .toBe('FLAC · 122 bpm · -5 %');
    // A velocidad normal no aparece ningún porcentaje.
    expect(formatQuality({ codec: 'flac', bpm: 128 }, { velocidad: 1 })).toBe('FLAC · 128 bpm');
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

describe('formatPorcentaje', () => {
  it('escribe el porcentaje como se escribe en castellano', () => {
    expect(formatPorcentaje(1.6)).toBe('+1,6 %');
    expect(formatPorcentaje(-5)).toBe('-5 %');
    expect(formatPorcentaje(0)).toBe('0 %');
  });

  it('no arrastra decimales de adorno', () => {
    expect(formatPorcentaje(1.58730)).toBe('+1,6 %');
    expect(formatPorcentaje(12.0)).toBe('+12 %');
  });
});
