import { describe, it, expect } from 'vitest';
import meta from '../src/data/meta.json';
import { SaveStore, defaultSave, migrate, addRecord, SAVE_VERSION } from '../src/save/SaveStore.js';
import { medalsForRun, upgradeCost, Meta } from '../src/systems/Meta.js';

/** Almacenamiento en memoria con la API de localStorage. */
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const broken = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('lleno'); }, removeItem() { throw new Error('x'); } };

describe('Guardado', () => {
  it('guarda y vuelve a cargar los mismos datos', () => {
    const st = memoryStorage();
    const a = new SaveStore('k', st);
    const d = a.load();
    d.medals = 7; d.upgrades.vida = 2; d.records.push({ points: 100, nights: 2, kills: 30, time: 90, date: '2026-10-09', weapon: 'Pistola' });
    expect(a.save(d)).toBe(true);
    const b = new SaveStore('k', st).load();
    expect(b.medals).toBe(7);
    expect(b.upgrades.vida).toBe(2);
    expect(b.records[0].points).toBe(100);
    expect(JSON.parse(st.getItem('k')).version).toBe(SAVE_VERSION);
  });

  it('si el almacenamiento falla, el juego sigue con datos vacíos', () => {
    const s = new SaveStore('k', broken);
    expect(s.load()).toEqual(defaultSave());
    expect(s.save(defaultSave())).toBe(false);
    expect(s.ok).toBe(false);
    expect(() => s.clear()).not.toThrow();
    expect(new SaveStore('k', null).save(defaultSave())).toBe(false);
  });

  it('JSON corrupto o con tipos raros se sanea', () => {
    const st = memoryStorage();
    st.setItem('k', '{no es json');
    expect(new SaveStore('k', st).load()).toEqual(defaultSave());
    const d = migrate({ medals: -3, upgrades: { vida: 'x', puntos: 2.7, linterna: 0 }, records: [null, { points: 'a' }], stats: 5 });
    expect(d.medals).toBe(0);
    expect(d.upgrades).toEqual({ puntos: 2 });
    expect(d.records).toHaveLength(1);
    expect(d.records[0].points).toBe(0);
    expect(d.stats.runs).toBe(0);
  });

  it('los récords se ordenan por puntos y se quedan los 10 mejores', () => {
    let records = [];
    let rank;
    for (let k = 0; k < 12; k++) ({ records, rank } = addRecord(records, { points: k * 10, nights: 1 }, 10));
    expect(records).toHaveLength(10);
    expect(records[0].points).toBe(110);
    expect(rank).toBe(0);
    ({ rank } = addRecord(records, { points: 5, nights: 1 }, 10));
    expect(rank).toBe(-1);
  });
});

describe('Medallas y mejoras', () => {
  it('sin noches ni logros no hay medallas', () => {
    expect(medalsForRun(meta.medals, { nights: 0 }, {})).toEqual([]);
  });

  it('una noche por medalla, hitos y logros', () => {
    const list = medalsForRun(meta.medals, { nights: 5 }, { kills: 120, bossKills: 1, perfectNights: 2, maxCombo: 3 });
    const total = list.reduce((s, m) => s + m.medals, 0);
    expect(list.some((m) => m.label.includes('5 noches'))).toBe(true);
    expect(list.some((m) => m.label === '100 bajas')).toBe(true);
    expect(list.some((m) => m.label === 'Antidisturbios abatido')).toBe(true);
    expect(list.find((m) => m.label.startsWith('Noche sin'))?.medals).toBe(2);
    expect(total).toBe(5 + 1 + 2 + 3 + 1 + 2);
  });

  it('los logros por unidad tienen tope', () => {
    const list = medalsForRun(meta.medals, { nights: 0 }, { perfectNights: 99 });
    const perfect = meta.medals.achievements.find((a) => a.id === 'perfect');
    expect(list[0].medals).toBe(perfect.medals * perfect.maxUnits);
  });

  it('cada mejora tiene un coste por nivel y 0 al máximo', () => {
    for (const u of meta.upgrades) {
      expect(u.cost).toHaveLength(u.maxLevel);
      expect(upgradeCost(u, 0)).toBe(u.cost[0]);
      expect(upgradeCost(u, u.maxLevel)).toBe(0);
    }
  });

  it('un nivel de mejora fuera de rango en el guardado se limita a [0, maxLevel]', () => {
    const fake = { upgrades: meta.upgrades, data: { upgrades: { vida: 99, puntos: -4, desconocida: 3 } } };
    const level = (id) => Meta.prototype.level.call(fake, id);
    expect(level('vida')).toBe(meta.upgrades.find((u) => u.id === 'vida').maxLevel);
    expect(level('puntos')).toBe(0);
    expect(level('desconocida')).toBe(0);
  });

  it('los récords guardados se ordenan y se limitan al cargar', () => {
    const recs = Array.from({ length: 30 }, (_, k) => ({ points: k, nights: 1 }));
    const d = migrate({ records: recs }, { maxRecords: 10 });
    expect(d.records).toHaveLength(10);
    expect(d.records[0].points).toBe(29);
  });
});
