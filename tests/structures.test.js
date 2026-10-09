import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import build from '../src/data/build.json';
import {
  structureGeometry, doorLeafGeometry, doorFrameGeometry, doorSignGeometry, mineLightGeometry,
  structureGhostGeometry, transformerDamageGeometry, STRUCTURE_MATERIAL_OPTIONS,
} from '../src/render/StructureModels.js';

const TOL = 0.02;
const cases = [];
for (const [type, def] of Object.entries(build.pieces)) {
  def.levels.forEach((lv, level) => cases.push({ type, level, def, name: `${type} nivel ${level} (${lv.name})` }));
}

function checkAttributes(g) {
  const pos = g.attributes.position, nor = g.attributes.normal, col = g.attributes.color;
  expect(pos && nor && col).toBeTruthy();
  expect(pos.itemSize).toBe(3);
  expect(nor.count).toBe(pos.count);
  expect(col.count).toBe(pos.count);
  expect(pos.count % 3).toBe(0);
  expect(g.index).toBeNull();
  for (const a of [pos.array, nor.array, col.array]) for (const v of a) if (!Number.isFinite(v)) throw new Error('NaN/Infinity en un atributo');
}

const bbox = (g) => { g.computeBoundingBox(); return g.boundingBox; };

describe('StructureModels: piezas de build.json', () => {
  it('cubre las 6 piezas del JSON', () => {
    expect(Object.keys(build.pieces).sort()).toEqual(['barricada', 'cepo', 'mina', 'pinchos', 'puerta', 'sacos']);
    expect(cases.length).toBe(12);
  });

  for (const { type, level, def, name } of cases) {
    describe(name, () => {
      const g = structureGeometry(type, level);
      it('no tiene NaN y position/normal/color casan', () => checkAttributes(g));
      it('la huella cabe en la celda [-0,5, 0,5] ± 0,02 y la base está en y = 0', () => {
        const b = bbox(g);
        expect(b.min.x).toBeGreaterThanOrEqual(-0.5 - TOL);
        expect(b.max.x).toBeLessThanOrEqual(0.5 + TOL);
        expect(b.min.z).toBeGreaterThanOrEqual(-0.5 - TOL);
        expect(b.max.z).toBeLessThanOrEqual(0.5 + TOL);
        expect(b.min.y).toBeGreaterThanOrEqual(-0.01);
        expect(b.min.y).toBeLessThanOrEqual(0.05);
      });
      it('la altura coincide con build.json (±0,1; trampas ≤ 0,25)', () => {
        const top = bbox(g).max.y;
        if (def.kind === 'trampa') {
          expect(top).toBeLessThanOrEqual(0.25);
          expect(top).toBeGreaterThan(0.05);
        } else {
          expect(Math.abs(top - def.height)).toBeLessThanOrEqual(0.1);
        }
      });
      it('tiene entre 100 y 700 triángulos', () => {
        const tris = g.attributes.position.count / 3;
        expect(tris).toBeGreaterThanOrEqual(100);
        expect(tris).toBeLessThanOrEqual(700);
      });
      it('las normales están normalizadas', () => {
        const n = g.attributes.normal.array;
        for (let i = 0; i < n.length; i += 3) {
          expect(Math.abs(Math.hypot(n[i], n[i + 1], n[i + 2]) - 1)).toBeLessThan(1e-3);
        }
      });
    });
  }

  it('las piezas bloqueantes ocupan casi toda la celda (>= 0,85 en X y Z)', () => {
    for (const { type, level, def } of cases) {
      if (!def.blocks || type === 'puerta') continue;
      const b = bbox(structureGeometry(type, level));
      expect(b.max.x - b.min.x, `${type} ${level} X`).toBeGreaterThanOrEqual(0.85);
      expect(b.max.z - b.min.z, `${type} ${level} Z`).toBeGreaterThanOrEqual(0.85);
    }
  });

  it('la puerta va de lado a lado en X y tiene el grosor de build.json en Z', () => {
    for (const level of [0, 1]) {
      const b = bbox(structureGeometry('puerta', level));
      expect(b.max.x - b.min.x).toBeGreaterThanOrEqual(0.96);
      expect(b.max.z - b.min.z).toBeLessThanOrEqual(build.pieces.puerta.thickness + 0.04);
      expect(b.max.z - b.min.z).toBeGreaterThanOrEqual(build.pieces.puerta.thickness - 0.04);
    }
  });

  it('tipo desconocido lanza error; nivel fuera de rango se limita', () => {
    expect(() => structureGeometry('torreta', 0)).toThrow();
    expect(structureGeometry('mina', 5).attributes.position.count).toBe(structureGeometry('mina', 0).attributes.position.count);
  });

  it('es determinista: dos llamadas dan los mismos vértices', () => {
    for (const { type, level } of cases) {
      const a = structureGeometry(type, level).attributes.position.array;
      const c = structureGeometry(type, level).attributes.position.array;
      expect(a.length).toBe(c.length);
      for (let i = 0; i < a.length; i++) if (a[i] !== c[i]) throw new Error(`${type} ${level} no determinista`);
    }
  });
});

describe('StructureModels: puerta (hoja y marco)', () => {
  for (const level of [0, 1]) {
    it(`doorLeafGeometry(${level}): x minima ~ -0,5 (bisagra), valida y dentro de la altura`, () => {
      const g = doorLeafGeometry(level);
      checkAttributes(g);
      const b = bbox(g);
      expect(b.min.x).toBeGreaterThanOrEqual(-0.5 - TOL);
      expect(b.min.x).toBeLessThanOrEqual(-0.5 + TOL);
      expect(b.max.x).toBeLessThanOrEqual(0.5 + TOL);
      expect(b.max.y).toBeLessThanOrEqual(build.pieces.puerta.height);
      expect(b.min.z).toBeGreaterThanOrEqual(-0.5 * build.pieces.puerta.thickness - TOL);
      expect(b.max.z).toBeLessThanOrEqual(0.5 * build.pieces.puerta.thickness + TOL);
    });
    it(`doorFrameGeometry(${level}) + hoja = pieza completa (mismos vertices)`, () => {
      const f = doorFrameGeometry(level), l = doorLeafGeometry(level), all = structureGeometry('puerta', level);
      checkAttributes(f);
      expect(f.attributes.position.count + l.attributes.position.count).toBe(all.attributes.position.count);
      expect(bbox(f).max.y).toBeCloseTo(build.pieces.puerta.height, 2);
    });
  }
  it('la hoja del nivel 1 es mas gruesa que la del 0', () => {
    const t = (l) => { const b = bbox(doorLeafGeometry(l)); return b.max.z - b.min.z; };
    expect(t(1)).toBeGreaterThan(t(0));
  });
  it('doorSignGeometry: null en el nivel 0; con uv en el nivel 1', () => {
    expect(doorSignGeometry(0)).toBeNull();
    const g = doorSignGeometry(1);
    expect(g.attributes.uv.count).toBe(g.attributes.position.count);
    for (const v of g.attributes.position.array) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('StructureModels: extras', () => {
  it('mineLightGeometry: piloto pequeno sobre el disco de la mina', () => {
    const g = mineLightGeometry();
    checkAttributes(g);
    const b = bbox(g), mine = bbox(structureGeometry('mina', 0));
    expect(b.max.y).toBeLessThanOrEqual(0.25);
    expect(b.max.x).toBeLessThan(0.1);
    expect(b.min.y).toBeGreaterThan(mine.min.y);
  });

  it('structureGhostGeometry: una o dos cajas con la altura de build.json', () => {
    for (const [type, def] of Object.entries(build.pieces)) {
      const g = structureGhostGeometry(type);
      checkAttributes(g);
      expect(g.attributes.position.count / 3).toBeLessThanOrEqual(80);
      const b = bbox(g);
      expect(b.max.y).toBeLessThanOrEqual(def.height + 1e-6);
      expect(b.min.x).toBeGreaterThanOrEqual(-0.5 - TOL);
      expect(b.max.x).toBeLessThanOrEqual(0.5 + TOL);
      expect(b.min.z).toBeGreaterThanOrEqual(-0.5 - TOL);
      expect(b.max.z).toBeLessThanOrEqual(0.5 + TOL);
    }
  });

  it('transformerDamageGeometry: valida, centrada en la huella 2x1 en X', () => {
    const g = transformerDamageGeometry();
    checkAttributes(g);
    const b = bbox(g);
    expect(b.min.x).toBeGreaterThanOrEqual(-1 - TOL);
    expect(b.max.x).toBeLessThanOrEqual(1 + TOL);
    expect(b.min.z).toBeGreaterThanOrEqual(-0.6);
    expect(b.max.z).toBeLessThanOrEqual(0.75);
    expect(b.min.y).toBeGreaterThanOrEqual(-0.01);
    expect(g.attributes.position.count / 3).toBeLessThanOrEqual(700);
  });

  it('STRUCTURE_MATERIAL_OPTIONS crea un material con colores por vertice', () => {
    expect(STRUCTURE_MATERIAL_OPTIONS.vertexColors).toBe(true);
    const m = new THREE.MeshStandardMaterial(STRUCTURE_MATERIAL_OPTIONS);
    expect(m.vertexColors).toBe(true);
  });
});

if (process.env.STRUCT_TABLE) {
  describe('tabla de triangulos', () => {
    it('imprime', () => {
      const row = (pieza, g) => {
        const b = bbox(g);
        return { pieza, tris: g.attributes.position.count / 3, ancho: +(b.max.x - b.min.x).toFixed(2), fondo: +(b.max.z - b.min.z).toFixed(2), minx: +b.min.x.toFixed(2), maxx: +b.max.x.toFixed(2), alto: +b.max.y.toFixed(3) };
      };
      const rows = cases.map(({ type, level }) => row(`${type} ${level}`, structureGeometry(type, level)));
      rows.push(row('hoja0', doorLeafGeometry(0)), row('hoja1', doorLeafGeometry(1)), row('marco0', doorFrameGeometry(0)), row('marco1', doorFrameGeometry(1)), row('luz mina', mineLightGeometry()), row('transformador', transformerDamageGeometry()));
      console.table(rows);
    });
  });
}
