import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import tiles from '../src/data/tiles.json';
import map from '../src/data/map.json';
import { NavGrid } from '../src/systems/NavGrid.js';
import { PropRenderer, PROP_TILES } from '../src/render/PropRenderer.js';
import { findGroups, classifyGroup, TYPES } from '../src/render/props/PropFactory.js';
import propsData from '../src/data/props.json';
import { SPRITE_NAMES, spriteUV } from '../src/render/props/Atlas.js';

const grid = new NavGrid(map.rows, tiles, 1);
const scene = new THREE.Scene();
const props = new PropRenderer(scene, grid);

const REQUIRED_INTERACTS = [
  'cafetera', 'vending', 'fuente', 'taquilla', 'archivador', 'radio', 'telefono', 'ordenador_camaras',
  'cuadro_electrico', 'generador', 'cama', 'pizarra_casos', 'coche_sirena', 'botiquin_pared', 'alarma',
];

describe('PropRenderer', () => {
  it('se construye en Node sin WebGL con el mapa real', () => {
    expect(PROP_TILES).toEqual(['o', 'c', 'k', 'L']);
    expect(props.group.children.length).toBeGreaterThan(0);
    expect(props.triangles).toBeGreaterThan(1000);
  });

  it('usa pocas mallas fusionadas (≤ 10 draw calls)', () => {
    const meshes = props.group.children.filter((c) => c.isMesh);
    expect(meshes.length).toBeLessThanOrEqual(10);
    expect(props.drawCalls).toBe(meshes.length);
  });

  it('todas las geometrías tienen position/normal y color o uv, sin NaN', () => {
    for (const geo of props.geometries) {
      const n = geo.attributes.position.count;
      expect(n % 3).toBe(0);
      expect(geo.attributes.normal.count).toBe(n);
      expect(Boolean(geo.attributes.color) || Boolean(geo.attributes.uv)).toBe(true);
      for (const v of geo.attributes.position.array) if (!Number.isFinite(v)) throw new Error('NaN en posición');
    }
  });

  it('todas las celdas o/c/k/L del mapa pertenecen a algún prop reconocido (sin muebles genéricos)', () => {
    const covered = new Set();
    for (const inst of props.instances) for (const [i, j] of inst.cells) covered.add(`${i},${j}`);
    for (let j = 0; j < grid.h; j++) for (let i = 0; i < grid.w; i++) {
      if (PROP_TILES.includes(grid.chars[grid.index(i, j)])) expect(covered.has(`${i},${j}`), `celda ${i},${j}`).toBe(true);
    }
    expect(props.instances.filter((x) => x.type === 'mueble_generico').map((x) => x.key)).toEqual([]);
  });

  it('ningún vértice de un prop bloqueante se sale de las celdas de su grupo (margen 0,05)', () => {
    const M = 0.05, cs = grid.cellSize;
    const bad = [];
    for (const inst of props.instances) {
      if (!inst.blocking) continue;
      const { i0, j0, i1, j1 } = inst.bbox;
      for (const [i, j] of inst.cells) expect(grid.isWalkable(i, j), `celda ${i},${j} de ${inst.type}`).toBe(false);
      const x0 = grid.originX + i0 * cs - M, x1 = grid.originX + (i1 + 1) * cs + M;
      const z0 = grid.originZ + j0 * cs - M, z1 = grid.originZ + (j1 + 1) * cs + M;
      const b = inst.bounds;
      if (b.minX < x0 || b.maxX > x1 || b.minZ < z0 || b.maxZ > z1) {
        bad.push(`${inst.type}@${inst.key} x[${b.minX.toFixed(2)},${b.maxX.toFixed(2)}] z[${b.minZ.toFixed(2)},${b.maxZ.toFixed(2)}] caja x[${x0.toFixed(2)},${x1.toFixed(2)}] z[${z0.toFixed(2)},${z1.toFixed(2)}]`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('hay un ancla de luz tipo farola por cada L del mapa (y sirenas / pantallas / lámparas)', () => {
    const lamps = grid.lights.length;
    expect(lamps).toBeGreaterThan(0);
    expect(props.lightAnchors.filter((a) => a.type === 'farola').length).toBe(lamps);
    for (const l of grid.lights) {
      const near = props.lightAnchors.find((a) => a.type === 'farola' && Math.abs(a.x - grid.centerX(l.i)) < 1 && Math.abs(a.z - grid.centerZ(l.j)) < 1);
      expect(near, `farola ${l.i},${l.j}`).toBeTruthy();
      expect(near.y).toBeGreaterThan(3);
    }
    for (const t of ['sirena', 'pantalla', 'lampara']) expect(props.lightAnchors.some((a) => a.type === t), t).toBe(true);
  });

  it('expone sirenMeshes para el parpadeo', () => {
    expect(props.sirenMeshes.length).toBe(2);
    props.setSirens(true, 0);
    props.setSirens(false);
  });

  it('interactAnchors: todos los tipos pedidos, en celdas transitables y con ids únicos', () => {
    const anchors = props.interactAnchors;
    for (const t of REQUIRED_INTERACTS) expect(anchors.some((a) => a.type === t), t).toBe(true);
    expect(anchors.filter((a) => a.type === 'taquilla').length).toBeGreaterThanOrEqual(3);
    expect(anchors.filter((a) => a.type === 'archivador').length).toBeGreaterThanOrEqual(2);
    expect(new Set(anchors.map((a) => a.id)).size).toBe(anchors.length);
    for (const a of anchors) {
      expect(a.label).toBeTruthy();
      expect(grid.isWalkable(grid.cellX(a.x), grid.cellZ(a.z)), `${a.id} en (${a.x.toFixed(2)}, ${a.z.toFixed(2)})`).toBe(true);
    }
  });

  it('cada coche patrulla tiene su ancla coche_sirena y un par de sirenas', () => {
    const patrols = props.instances.filter((x) => x.type === 'patrulla');
    expect(patrols.length).toBeGreaterThanOrEqual(3);
    expect(props.interactAnchors.filter((a) => a.type === 'coche_sirena').length).toBe(patrols.length);
    expect(props.lightAnchors.filter((a) => a.type === 'sirena').length).toBeGreaterThanOrEqual(patrols.length * 2);
  });

  it('dispose() libera las geometrías', () => {
    const p2 = new PropRenderer(new THREE.Scene(), grid);
    p2.dispose();
    expect(p2.geometries.length).toBe(0);
  });
});

describe('Clasificación de grupos', () => {
  it('los tipos forzados de props.json existen', () => {
    for (const o of Object.values(propsData.groups)) expect(TYPES[o.type], o.type).toBeTruthy();
  });

  it('reconoce los muebles de las salas por su forma', () => {
    const types = {};
    for (const ch of ['o']) for (const g of findGroups(grid, ch)) types[g.key] = classifyGroup(grid, g, propsData).type;
    expect(types['36,17']).toBe('escritorio');
    expect(types['51,17']).toBe('mostrador_armeria');
    expect(types['35,31']).toBe('mostrador_recepcion');
    expect(types['34,34']).toBe('sillas_espera');
    expect(types['25,30']).toBe('mostrador_enfermeria');
    expect(types['28,34']).toBe('camillas');
    expect(types['48,34']).toBe('estanterias');
    expect(types['50,31']).toBe('mostrador_pruebas');
    expect(types['30,24']).toBe('taquillas');
  });
});

describe('Atlas de sprites', () => {
  it('todos los sprites tienen UV válidas dentro de [0,1]', () => {
    expect(SPRITE_NAMES.length).toBeGreaterThan(20);
    for (const n of SPRITE_NAMES) {
      const [u0, v0, u1, v1] = spriteUV(n);
      expect(u1).toBeGreaterThan(u0);
      expect(v1).toBeGreaterThan(v0);
      for (const v of [u0, v0, u1, v1]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    }
  });
});
