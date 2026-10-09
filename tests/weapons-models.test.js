import { describe, it, expect } from 'vitest';
import weapons from '../src/data/weapons.json';
import { weaponGeometry, grenadeGeometry, WEAPON_SPECS, WEAPON_MATERIAL_OPTIONS } from '../src/render/WeaponModels.js';

const ids = Object.keys(weapons).filter((k) => !k.startsWith('_'));
const MIN_TRIS = 80, MAX_TRIS = 500;

function checkAttributes(g) {
  const pos = g.attributes.position, nor = g.attributes.normal, col = g.attributes.color;
  expect(pos && nor && col).toBeTruthy();
  expect(pos.itemSize).toBe(3);
  expect(nor.count).toBe(pos.count);
  expect(col.count).toBe(pos.count);
  expect(pos.array.length).toBe(nor.array.length);
  expect(pos.array.length).toBe(col.array.length);
  expect(pos.count % 3).toBe(0);
  expect(g.index).toBeNull();
  for (const a of [pos.array, nor.array, col.array]) for (const v of a) if (!Number.isFinite(v)) throw new Error('NaN/Infinity en un atributo');
  // normales unitarias
  for (let i = 0; i < nor.count; i++) {
    const l = Math.hypot(nor.getX(i), nor.getY(i), nor.getZ(i));
    if (Math.abs(l - 1) > 1e-3) throw new Error(`normal no unitaria en el vértice ${i}`);
  }
}

describe('WeaponModels: armas de weapons.json', () => {
  it('hay una especificación por cada arma del JSON (y viceversa)', () => {
    expect(Object.keys(WEAPON_SPECS).sort()).toEqual([...ids].sort());
  });

  it('las opciones de material usan color por vértice', () => {
    expect(WEAPON_MATERIAL_OPTIONS.vertexColors).toBe(true);
    expect(typeof WEAPON_MATERIAL_OPTIONS.roughness).toBe('number');
    expect(typeof WEAPON_MATERIAL_OPTIONS.metalness).toBe('number');
  });

  it('un id desconocido lanza un error claro', () => {
    expect(() => weaponGeometry('bazuca')).toThrow(/desconocida/);
  });

  for (const id of ids) {
    describe(id, () => {
      const g = weaponGeometry(id);
      const spec = WEAPON_SPECS[id];
      g.computeBoundingBox();
      const bb = g.boundingBox;

      it('geometría sin NaN, no indexada, con position/normal/color del mismo tamaño', () => checkAttributes(g));

      it(`entre ${MIN_TRIS} y ${MAX_TRIS} triángulos`, () => {
        const tris = g.attributes.position.count / 3;
        expect(tris).toBeGreaterThanOrEqual(MIN_TRIS);
        expect(tris).toBeLessThanOrEqual(MAX_TRIS);
      });

      it('la longitud en Z coincide con WEAPON_SPECS (±25 %)', () => {
        const len = bb.max.z - bb.min.z;
        expect(len).toBeGreaterThan(spec.length * 0.75);
        expect(len).toBeLessThan(spec.length * 1.25);
      });

      it('la boca (muzzle) está en el extremo +Z (±0,05)', () => {
        expect(spec.muzzle).toHaveLength(3);
        expect(Math.abs(spec.muzzle[2] - bb.max.z)).toBeLessThanOrEqual(0.05);
        // y dentro de la caja del arma en X e Y
        expect(spec.muzzle[0]).toBeGreaterThanOrEqual(bb.min.x - 0.01);
        expect(spec.muzzle[0]).toBeLessThanOrEqual(bb.max.x + 0.01);
        expect(spec.muzzle[1]).toBeGreaterThanOrEqual(bb.min.y - 0.01);
        expect(spec.muzzle[1]).toBeLessThanOrEqual(bb.max.y + 0.01);
      });

      it('el punto de apoyo de la mano izquierda existe solo en las armas de dos manos', () => {
        if (weapons[id].twoHanded) {
          expect(spec.support).toHaveLength(3);
          expect(spec.support[2]).toBeGreaterThan(0);
          expect(spec.support[2]).toBeLessThan(spec.muzzle[2]);
        } else {
          expect(spec.support).toBeNull();
        }
      });

      it('el origen (mano derecha) queda dentro del arma en Z', () => {
        expect(bb.min.z).toBeLessThan(0);
        expect(bb.max.z).toBeGreaterThan(0);
      });

      it('es determinista', () => {
        const g2 = weaponGeometry(id);
        expect(Array.from(g2.attributes.position.array)).toEqual(Array.from(g.attributes.position.array));
      });
    });
  }

  it('la empuñadura de la pistola cae por debajo del origen', () => {
    const g = weaponGeometry('pistola');
    g.computeBoundingBox();
    expect(g.boundingBox.min.y).toBeLessThan(-0.08);
  });

  it('la porra mide ~0,6 m y su boca es la punta', () => {
    const g = weaponGeometry('porra');
    g.computeBoundingBox();
    expect(g.boundingBox.max.z - g.boundingBox.min.z).toBeGreaterThan(0.5);
    expect(g.boundingBox.max.z - g.boundingBox.min.z).toBeLessThan(0.75);
    expect(WEAPON_SPECS.porra.muzzle[2]).toBeCloseTo(g.boundingBox.max.z, 1);
  });
});

describe('WeaponModels: granada', () => {
  const g = grenadeGeometry();
  it('geometría válida', () => checkAttributes(g));
  it(`entre ${MIN_TRIS} y ${MAX_TRIS} triángulos`, () => {
    const tris = g.attributes.position.count / 3;
    expect(tris).toBeGreaterThanOrEqual(MIN_TRIS);
    expect(tris).toBeLessThanOrEqual(MAX_TRIS);
  });
  it('mide unos 0,09-0,12 m y está centrada en el origen', () => {
    g.computeBoundingBox();
    const s = new g.boundingBox.min.constructor();
    g.boundingBox.getSize(s);
    expect(s.y).toBeGreaterThan(0.08);
    expect(s.y).toBeLessThan(0.13);
    const c = new g.boundingBox.min.constructor();
    g.boundingBox.getCenter(c);
    expect(Math.abs(c.x)).toBeLessThan(0.03);
    expect(Math.abs(c.y)).toBeLessThan(0.03);
    expect(Math.abs(c.z)).toBeLessThan(0.03);
  });
});
