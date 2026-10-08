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

  it('el raycast se detiene en la cara real del muro fino', () => {
    const blocked = (i, j) => grid.isShotBlocked(i, j);
    const d = raycastGrid(grid, grid.centerX(0), grid.centerZ(2), 1, 0, 20, blocked);
    expect(d).toBeCloseTo(1.5 + tiles['#'].collisionInset, 5);
  });

  it('el raycast cruza la parte libre de una celda de muro fino', () => {
    // Fila 1 "  ###   ": barra horizontal en z ∈ [1.35, 1.65] relativo a la celda.
    // Un rayo hacia el este por z = 1.1 (dentro de las celdas de muro, pero fuera de la barra) no choca.
    const blocked = (i, j) => grid.isShotBlocked(i, j);
    const z = grid.originZ + 1.1;
    expect(raycastGrid(grid, grid.originX + 0.5, z, 1, 0, 6, blocked)).toBe(6);
  });

  it('la colisión de las esquinas en L coincide con las barras (sin salientes)', () => {
    // Esquina (2,1): barra horizontal hacia el este y vertical hacia el sur. La esquina
    // interior (3,2) debe permitir llegar a 0,35 de las caras de ambas barras.
    const inset = tiles['#'].collisionInset, r = 0.2;
    const pos = { x: grid.originX + 2.7, z: grid.originZ + 1.7 }; // solapa ambas barras
    resolveCircleVsGrid(pos, r, grid);
    expect(pos.x).toBeCloseTo(grid.originX + 2 + (1 - inset) + r, 3);
    expect(pos.z).toBeCloseTo(grid.originZ + 1 + (1 - inset) + r, 3);
  });

  it('walkableCellAt devuelve una vecina transitable si el punto cae en una celda de muro', () => {
    const k = grid.walkableCellAt(grid.originX + 2.1, grid.originZ + 2.5); // dentro de la celda (2,2)
    expect(k).toBeGreaterThanOrEqual(0);
    expect(grid.walkable[k]).toBe(1);
    expect(k).toBe(grid.index(1, 2));
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
