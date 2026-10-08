import { describe, it, expect } from 'vitest';
import tiles from '../src/data/tiles.json';
import { NavGrid } from '../src/systems/NavGrid.js';
import { FlowField } from '../src/systems/FlowField.js';
import { resolveCircleVsGrid, raycastGrid, rayCircle, SpatialHash } from '../src/systems/Physics.js';

// Mapa 8×6 con un muro en U: desde el oeste hay que rodear por abajo para llegar al objetivo.
const ROWS = [
  '        ',
  '  ###   ',
  '  #     ',
  '  #     ',
  '  ###   ',
  '        ',
];

describe('FlowField', () => {
  const grid = new NavGrid(ROWS, tiles, 1);
  const ff = new FlowField(grid);
  ff.compute(4, 2); // objetivo dentro de la U (abierta al este)

  it('la distancia en el objetivo es 0 y crece al alejarse', () => {
    expect(ff.distanceAt(4, 2)).toBe(0);
    expect(ff.distanceAt(5, 2)).toBeCloseTo(1);
  });

  it('las celdas bloqueadas son inalcanzables', () => {
    expect(ff.distanceAt(2, 2)).toBe(Infinity);
  });

  it('seguir next desde el oeste lleva al objetivo sin atravesar muros', () => {
    let i = 0, j = 2, steps = 0;
    while (!(i === 4 && j === 2) && steps < 50) {
      const n = ff.nextCell(i, j);
      expect(n).toBeGreaterThanOrEqual(0);
      i = n % grid.w; j = (n / grid.w) | 0;
      expect(grid.isWalkable(i, j)).toBe(true);
      steps++;
    }
    expect([i, j]).toEqual([4, 2]);
    expect(steps).toBeGreaterThan(4); // tuvo que rodear
  });

  it('el coste extra desvía el camino (base para barricadas)', () => {
    const g2 = new NavGrid(['     ', '     ', '     '], tiles, 1);
    const f2 = new FlowField(g2);
    f2.compute(4, 1);
    const direct = f2.distanceAt(0, 1);
    g2.extraCost[g2.index(2, 1)] = 50;
    f2.compute(4, 1);
    expect(f2.distanceAt(0, 1)).toBeGreaterThan(direct);
    expect(f2.distanceAt(0, 1)).toBeLessThan(direct + 50);
  });
});

describe('Physics', () => {
  const grid = new NavGrid(ROWS, tiles, 1);

  it('saca un círculo de un muro (con el margen de muro fino)', () => {
    // Celda (2,2) es muro; su borde oeste está en x = -2, recortado 0.35 por dar a una celda libre.
    const inset = tiles['#'].collisionInset;
    const pos = { x: -1.8, z: grid.centerZ(2) };
    expect(resolveCircleVsGrid(pos, 0.35, grid)).toBe(true);
    expect(pos.x).toBeCloseTo(-2 + inset - 0.35, 5);
  });

  it('el margen no abre huecos entre celdas de muro contiguas', () => {
    // (2,1)-(4,1) es un muro horizontal: un círculo justo en la junta (3,1)/(2,1) no lo atraviesa.
    const pos = { x: grid.originX + 3, z: grid.centerZ(1) };
    resolveCircleVsGrid(pos, 0.2, grid);
    expect(Math.abs(pos.z - grid.centerZ(1))).toBeGreaterThan(0.1);
  });

  it('no toca un círculo en zona libre', () => {
    const pos = { x: grid.centerX(6), z: grid.centerZ(5) };
    expect(resolveCircleVsGrid(pos, 0.35, grid)).toBe(false);
  });

  it('el raycast se detiene en el muro', () => {
    const blocked = (i, j) => grid.isShotBlocked(i, j);
    const d = raycastGrid(grid, grid.centerX(0), grid.centerZ(2), 1, 0, 20, blocked);
    expect(d).toBeCloseTo(1.5, 5);
  });

  it('rayCircle detecta impactos y fallos', () => {
    expect(rayCircle(0, 0, 1, 0, 5, 0, 1)).toBeCloseTo(4);
    expect(rayCircle(0, 0, 1, 0, 5, 3, 1)).toBe(-1);
    expect(rayCircle(0, 0, 1, 0, -5, 0, 1)).toBe(-1);
  });

  it('SpatialHash devuelve vecinos cercanos', () => {
    const h = new SpatialHash(80, 2, 10);
    h.insert('a', 0, 0); h.insert('b', 1, 1); h.insert('c', 30, 30);
    const found = [];
    h.query(0, 0, 1.5, (it) => found.push(it));
    expect(found.sort()).toEqual(['a', 'b']);
  });
});
