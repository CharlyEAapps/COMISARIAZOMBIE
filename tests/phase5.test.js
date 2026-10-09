import { describe, it, expect } from 'vitest';
import tiles from '../src/data/tiles.json';
import zombies from '../src/data/zombies.json';
import waves from '../src/data/waves.json';
import build from '../src/data/build.json';
import shop from '../src/data/shop.json';
import { NavGrid } from '../src/systems/NavGrid.js';
import { FlowField } from '../src/systems/FlowField.js';
import { typeWeight, pickType, isBossNight } from '../src/systems/WaveDirector.js';
import { bodyOf } from '../src/systems/ZombieSystem.js';
import { PART_NAMES } from '../src/render/BlockyCharacter.js';
import { ACCESSORIES, ACCESSORY_SETS } from '../src/render/ZombieAccessories.js';

const ZTYPES = Object.keys(zombies).filter((t) => !t.startsWith('_'));

describe('Fase 5: oleadas', () => {
  const types = waves.night.types;

  it('cada tipo aparece desde su noche y su peso crece hasta el tope', () => {
    const corredor = types.find((t) => t.type === 'corredor');
    expect(typeWeight(corredor, corredor.fromNight - 1)).toBe(0);
    expect(typeWeight(corredor, corredor.fromNight)).toBe(corredor.weight);
    expect(typeWeight(corredor, 100)).toBe(corredor.maxWeight);
  });

  it('la noche 1 solo trae caminantes', () => {
    for (let k = 0; k < 50; k++) expect(pickType(types, 1)).toBe('caminante');
  });

  it('pickType elige entre los disponibles según el número aleatorio', () => {
    expect(pickType(types, 10, () => 0)).toBe('caminante');
    expect(pickType(types, 10, () => 0.999999)).toBe(types[types.length - 1].type);
  });

  it('el jefe llega cada 5 noches', () => {
    expect(isBossNight(waves.boss, 4)).toBe(false);
    expect(isBossNight(waves.boss, 5)).toBe(true);
    expect(isBossNight(waves.boss, 10)).toBe(true);
    expect(zombies[waves.boss.type].boss).toBe(true);
  });

  it('todos los tipos de las oleadas existen en zombies.json', () => {
    for (const t of types) expect(zombies[t.type]).toBeTruthy();
  });
});

describe('Fase 5: cuerpos y accesorios', () => {
  it('cada tipo tiene un cuerpo válido (pivotes y escalas por parte)', () => {
    for (const t of ZTYPES) {
      const b = bodyOf(zombies[t]);
      expect(b.pivots.length).toBe(PART_NAMES.length);
      expect(b.scales.length).toBe(PART_NAMES.length);
      for (const v of [...b.pivots, ...b.scales]) expect(Number.isFinite(v.x + v.y + v.z)).toBe(true);
      for (const a of b.accessories) expect(ACCESSORIES[a]).toBeTruthy();
    }
  });

  it('todos los zombis caben por un hueco de puerta de 2 celdas (radio < 0,9 m)', () => {
    for (const t of ZTYPES) expect(zombies[t].radius * zombies[t].scale * 1.06, t).toBeLessThan(0.9);
  });

  it('un torso más alto sube la cabeza', () => {
    const base = bodyOf(zombies.caminante), tall = bodyOf(zombies.explosivo);
    const h = PART_NAMES.indexOf('head');
    expect(tall.pivots[h].y).toBeGreaterThan(base.pivots[h].y);
  });

  it('los accesorios generan geometría sin NaN', () => {
    for (const [name, a] of Object.entries(ACCESSORIES)) {
      const g = a.geometry();
      const pos = g.attributes.position.array;
      expect(pos.length, name).toBeGreaterThan(0);
      for (const v of pos) expect(Number.isFinite(v)).toBe(true);
    }
    for (const set of Object.values(ACCESSORY_SETS)) for (const n of set) expect(ACCESSORIES[n]).toBeTruthy();
  });
});

describe('Fase 5: FlowField con varios objetivos', () => {
  const ROWS = [
    '          ',
    '          ',
    '          ',
  ];
  const grid = new NavGrid(ROWS, tiles, 1);
  const ff = new FlowField(grid);

  it('cada celda va hacia el objetivo más cercano', () => {
    ff.computeMulti([grid.index(0, 1), grid.index(9, 1)]);
    expect(ff.distanceAt(0, 1)).toBe(0);
    expect(ff.distanceAt(9, 1)).toBe(0);
    expect(ff.distanceAt(2, 1)).toBeCloseTo(2);
    expect(ff.distanceAt(7, 1)).toBeCloseTo(2);
    expect(ff.nextCell(2, 1)).toBe(grid.index(1, 1));
    expect(ff.nextCell(7, 1)).toBe(grid.index(8, 1));
  });

  it('sin objetivos no hay rutas', () => {
    ff.computeMulti([]);
    expect(ff.distanceAt(5, 1)).toBe(Infinity);
  });

  it('compute(i, j) sigue funcionando como antes', () => {
    ff.compute(5, 1);
    expect(ff.distanceAt(5, 1)).toBe(0);
    expect(ff.target).toEqual({ i: 5, j: 1 });
  });
});

describe('Fase 5: datos de construcción y tienda', () => {
  it('las páginas de la barra cubren todas las piezas sin repetir', () => {
    const listed = build.pages.flatMap((p) => p.pieces);
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed.sort()).toEqual(Object.keys(build.pieces).sort());
    for (const p of build.pages) expect(p.pieces.length).toBeLessThanOrEqual(9);
  });

  it('cada pieza tiene desbloqueo en el almacén o empieza desbloqueada', () => {
    const ids = new Set(shop.almacen.map((i) => i.id.replace('unlock:', '')));
    for (const [type, def] of Object.entries(build.pieces)) {
      def.levels.forEach((_, l) => {
        const key = `${type}:${l}`;
        expect(ids.has(key) || shop.startUnlocked.includes(key), key).toBe(true);
      });
    }
  });

  it('los requisitos del almacén existen', () => {
    const ids = new Set(shop.almacen.map((i) => i.id));
    for (const it of shop.almacen) if (it.requires) expect(ids.has(it.requires), it.id).toBe(true);
  });
});
