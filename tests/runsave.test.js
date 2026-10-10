import { describe, it, expect } from 'vitest';
import { RunSaveStore, describeSave, RUN_SAVE_VERSION } from '../src/save/RunSave.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

describe('Guardado del turno (continuar)', () => {
  it('guarda, carga y borra', () => {
    const s = new RunSaveStore('r', memoryStorage());
    expect(s.load()).toBeNull();
    expect(s.save({ version: RUN_SAVE_VERSION, night: 4, run: { points: 900, nights: 3 } })).toBe(true);
    expect(s.load().night).toBe(4);
    s.clear();
    expect(s.load()).toBeNull();
  });

  it('ignora guardados de otra versión o corruptos', () => {
    const st = memoryStorage();
    const s = new RunSaveStore('r', st);
    st.setItem('r', JSON.stringify({ version: 999, night: 3 }));
    expect(s.load()).toBeNull();
    st.setItem('r', '{roto');
    expect(s.load()).toBeNull();
  });

  it('sin almacenamiento no falla', () => {
    const s = new RunSaveStore('r', null);
    expect(s.save({ version: RUN_SAVE_VERSION, night: 2 })).toBe(false);
    expect(s.load()).toBeNull();
    expect(() => s.clear()).not.toThrow();
  });

  it('resumen para el menú', () => {
    expect(describeSave(null)).toBeNull();
    expect(describeSave({ night: 6, run: { points: 4120, nights: 5 } })).toEqual({ night: 6, points: 4120, nights: 5 });
  });
});
