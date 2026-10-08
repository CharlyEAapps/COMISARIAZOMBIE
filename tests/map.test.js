import { describe, it, expect } from 'vitest';
import tiles from '../src/data/tiles.json';
import map from '../src/data/map.json';
import { NavGrid } from '../src/systems/NavGrid.js';

// Validación del mapa de la comisaría: si un cambio en map.json rompe la jugabilidad, falla aquí.
describe('Mapa de la comisaría', () => {
  const grid = new NavGrid(map.rows, tiles, 1);

  it('mide 80×80', () => {
    expect(grid.w).toBe(80);
    expect(grid.h).toBe(80);
  });

  it('tiene un inicio de jugador, ≥4 puntos de aparición y las 3 tiendas', () => {
    expect(grid.playerStart).not.toBeNull();
    expect(map.rows.join('').split('P').length - 1).toBe(1);
    expect(grid.spawns.length).toBeGreaterThanOrEqual(4);
    for (const s of ['armeria', 'enfermeria', 'almacen']) expect(grid.shops[s]?.length).toBeGreaterThan(0);
  });

  it('todos los puntos de aparición y tiendas son alcanzables desde el inicio', () => {
    const dist = grid.bfs(grid.playerStart.i, grid.playerStart.j);
    for (const s of grid.spawns) expect(dist[grid.index(s.i, s.j)], `spawn ${s.i},${s.j}`).toBeGreaterThan(0);
    for (const list of Object.values(grid.shops)) {
      for (const s of list) expect(dist[grid.index(s.i, s.j)], `tienda ${s.i},${s.j}`).toBeGreaterThanOrEqual(0);
    }
  });

  it('los puntos de aparición están fuera del recinto (cerca del borde)', () => {
    for (const s of grid.spawns) {
      const edge = Math.min(s.i, s.j, grid.w - 1 - s.i, grid.h - 1 - s.j);
      expect(edge, `spawn ${s.i},${s.j}`).toBeLessThanOrEqual(3);
    }
  });

  it('no hay celdas transitables aisladas (bolsas inaccesibles)', () => {
    const dist = grid.bfs(grid.playerStart.i, grid.playerStart.j);
    const isolated = [];
    for (let j = 0; j < grid.h; j++) for (let i = 0; i < grid.w; i++) {
      if (grid.isWalkable(i, j) && dist[grid.index(i, j)] === -1) isolated.push(`${i},${j}`);
    }
    expect(isolated.slice(0, 10)).toEqual([]);
  });
});
