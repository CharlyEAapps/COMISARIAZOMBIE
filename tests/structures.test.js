import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import build from '../src/data/build.json';
import {
  structureGeometry, doorLeafGeometry, doorFrameGeometry, doorSignGeometry, mineLightGeometry,
  structureGhostGeometry, transformerDamageGeometry, turretHeadGeometry, floodLensGeometry, STRUCTURE_MATERIAL_OPTIONS,
} from '../src/render/StructureModels.js';

const TOL = 0.02;
const CASE_COUNT = Object.values(build.pieces).reduce((n, d) => n + d.levels.length, 0); // 12 piezas, 20 casos
// Trampas "bajas" (altura <= 0,25); alambre y barril son trampas altas y se comparan con def.height.
const LOW_TRAPS = new Set(['pinchos', 'cepo', 'mina']);
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
  it('cubre las 12 piezas del JSON', () => {
    expect(Object.keys(build.pieces).sort()).toEqual(['alambre', 'barricada', 'barril', 'cepo', 'foco', 'generador', 'mina', 'pinchos', 'puerta', 'sacos', 'torreta', 'valla']);
    expect(cases.length).toBe(CASE_COUNT);
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
      it('la altura coincide con build.json (±0,1; trampas bajas ≤ 0,25; torreta: base ≤ headHeight)', () => {
        const top = bbox(g).max.y;
        if (type === 'torreta') {
          expect(top).toBeLessThanOrEqual(def.headHeight);
          expect(top).toBeGreaterThan(def.headHeight - 0.1);
        } else if (LOW_TRAPS.has(type)) {
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

  it('las piezas bloqueantes ocupan casi toda la celda (>= 0,85 en X y Z; excepciones por forma)', () => {
    // puerta y valla son paneles finos en Z; barril/torreta/foco son columnas más estrechas que la celda
    const thinZ = new Set(['puerta', 'valla']), slim = new Set(['barril', 'torreta', 'foco']);
    for (const { type, level, def } of cases) {
      if (!def.blocks || slim.has(type)) continue;
      const b = bbox(structureGeometry(type, level));
      expect(b.max.x - b.min.x, `${type} ${level} X`).toBeGreaterThanOrEqual(0.85);
      if (!thinZ.has(type)) expect(b.max.z - b.min.z, `${type} ${level} Z`).toBeGreaterThanOrEqual(0.85);
    }
  });

  it('valla: panel fino en Z (0,1-0,2; 0,25 con el remate del nivel 1) que llega de borde a borde en X (para unirse en fila)', () => {
    for (const level of [0, 1]) {
      const b = bbox(structureGeometry('valla', level));
      expect(b.max.x - b.min.x, `valla ${level} X`).toBeGreaterThanOrEqual(0.96);
      expect(b.max.z - b.min.z, `valla ${level} Z`).toBeLessThanOrEqual(level === 1 ? 0.25 : 0.2);
      expect(b.max.z - b.min.z, `valla ${level} Z`).toBeGreaterThanOrEqual(0.1);
    }
  });

  it('alambre: rollos que llegan casi de borde a borde en X; barril: diámetro ~0,6 centrado', () => {
    for (const level of [0, 1]) {
      const b = bbox(structureGeometry('alambre', level));
      expect(b.max.x - b.min.x, `alambre ${level}`).toBeGreaterThanOrEqual(0.9);
    }
    const b = bbox(structureGeometry('barril', 0));
    expect(b.max.x - b.min.x).toBeGreaterThanOrEqual(0.55);
    expect(b.max.x - b.min.x).toBeLessThanOrEqual(0.66);
    expect(Math.abs(b.max.x + b.min.x)).toBeLessThan(0.03);
    expect(Math.abs(b.max.z + b.min.z)).toBeLessThan(0.03);
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
    expect(() => structureGeometry('lanzallamas', 0)).toThrow();
    expect(structureGeometry('torreta', 9).attributes.position.count).toBe(structureGeometry('torreta', 1).attributes.position.count);
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

describe('StructureModels: cabeza de la torreta y lente del foco', () => {
  const T = build.pieces.torreta;
  for (const level of [0, 1]) {
    it(`turretHeadGeometry(${level}): atributos válidos, cañón hacia +Z y altura total ≈ build.json`, () => {
      const g = turretHeadGeometry(level);
      checkAttributes(g);
      const b = bbox(g);
      const tris = g.attributes.position.count / 3;
      expect(tris).toBeGreaterThanOrEqual(100);
      expect(tris).toBeLessThanOrEqual(700);
      expect(b.max.z).toBeGreaterThanOrEqual(0.55);           // cañón de ~0,6
      expect(b.max.z).toBeLessThanOrEqual(0.65);
      expect(b.min.z).toBeGreaterThanOrEqual(-0.25);          // casi centrada hacia atrás
      expect(b.min.x).toBeGreaterThanOrEqual(-0.35);
      expect(b.max.x).toBeLessThanOrEqual(0.35);
      expect(b.min.y).toBeGreaterThanOrEqual(-0.1);           // vástago bajo el origen
      const baseTop = bbox(structureGeometry('torreta', level)).max.y;
      expect(Math.abs(T.headHeight + b.max.y - T.height)).toBeLessThanOrEqual(0.1);
      expect(baseTop).toBeLessThanOrEqual(T.headHeight);
      expect(b.min.y + T.headHeight).toBeLessThanOrEqual(baseTop + 0.01); // la cabeza apoya en la base sin hueco
    });
  }
  it('el nivel 1 de la torreta tiene doble cañón (más triángulos y más ancho)', () => {
    const a = turretHeadGeometry(0), c = turretHeadGeometry(1);
    expect(c.attributes.position.count).toBeGreaterThan(a.attributes.position.count);
    expect(bbox(c).max.x - bbox(c).min.x).toBeGreaterThan(bbox(a).max.x - bbox(a).min.x);
    expect(turretHeadGeometry(7).attributes.position.count).toBe(c.attributes.position.count);
  });
  it('floodLensGeometry: dos cristales (4 triángulos), casi blancos, dentro de la silueta del foco', () => {
    const g = floodLensGeometry();
    checkAttributes(g);
    expect(g.attributes.position.count / 3).toBe(4);
    const col = g.attributes.color.array;
    for (let i = 0; i < col.length; i += 3) expect(Math.min(col[i], col[i + 1], col[i + 2])).toBeGreaterThan(0.6);
    const b = bbox(g), f = bbox(structureGeometry('foco', 0));
    expect(b.min.x).toBeGreaterThanOrEqual(f.min.x);
    expect(b.max.x).toBeLessThanOrEqual(f.max.x);
    expect(b.max.y).toBeLessThanOrEqual(f.max.y);
    expect(b.min.y).toBeGreaterThan(1.5);
    expect(b.max.z).toBeGreaterThan(0.2);                       // un cristal en cada lado
    expect(b.min.z).toBeLessThan(-0.2);
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
      rows.push(row('cabeza torreta 0', turretHeadGeometry(0)), row('cabeza torreta 1', turretHeadGeometry(1)), row('lente foco', floodLensGeometry()), row('hoja0', doorLeafGeometry(0)), row('hoja1', doorLeafGeometry(1)), row('marco0', doorFrameGeometry(0)), row('marco1', doorFrameGeometry(1)), row('luz mina', mineLightGeometry()), row('transformador', transformerDamageGeometry()));
      console.table(rows);
    });
  });
}
