import { describe, it, expect } from 'vitest';
import tiles from '../src/data/tiles.json';
import map from '../src/data/map.json';
import build from '../src/data/build.json';
import { NavGrid } from '../src/systems/NavGrid.js';
import { ROOM_BY_ID, ROOMS_LIST, roomMaxLevel } from '../src/systems/Station.js';
import { structureJoinGeometry, joinShape, JOIN_TYPES, JOIN_SHAPES, JOIN_BITS } from '../src/render/StructureModels.js';
import { joinMask } from '../src/render/StructureRenderer.js';
import { buildRoom, TYPES } from '../src/render/props/PropFactory.js';
import { PropBuilder } from '../src/render/props/Builder.js';
import { SPRITE_NAMES, spriteUV } from '../src/render/props/Atlas.js';
import { GUNS } from '../src/render/props/common.js';

// Frente E: uniones de las construcciones, calabozos con celdas de verdad, armería y detalle de salas.
const { E, S, W, N } = JOIN_BITS;
const DIR_BITS = [[1, 0, E], [0, 1, S], [-1, 0, W], [0, -1, N]];
/** Bits de los brazos UNIDOS de una forma girada (las de la geometría canónica, ver StructureModels). */
const CANON_ARMS = { I: [], end: [0], line: [0, Math.PI], L: [0, -Math.PI / 2], T: [0, -Math.PI / 2, Math.PI], X: [0, -Math.PI / 2, Math.PI, Math.PI / 2] };
function armBits(shape, rot) {
  let m = 0;
  for (const a of CANON_ARMS[shape]) {
    const t = a + rot, dx = Math.round(Math.cos(t)), dz = Math.round(-Math.sin(t));
    m |= DIR_BITS.find(([x, z]) => x === dx && z === dz)[2];
  }
  return m;
}

describe('Construcción: uniones en esquinas y en T', () => {
  it('cada máscara de vecinos tiene forma y giro, y los brazos unidos apuntan justo a esos vecinos', () => {
    for (let m = 0; m < 16; m++) {
      const js = joinShape(m);
      expect(JOIN_SHAPES[js.index]).toBe(js.shape);
      expect(armBits(js.shape, js.rot), `máscara ${m}`).toBe(m);
    }
    expect(joinShape(E | W).shape).toBe('line');
    expect(joinShape(N | S).shape).toBe('line');
    expect(joinShape(E | N).shape).toBe('L');
    expect(joinShape(E | W | N).shape).toBe('T');
    expect(joinShape(15).shape).toBe('X');
  });

  it('los muros solo prolongan filas y tapan huecos: una fila pegada a un muro no le clava brazos', () => {
    expect(joinMask(E | W, N)).toBe(E | W);          // fila paralela al muro
    expect(joinMask(E, W)).toBe(E | W);              // final de fila contra un muro: lo alcanza
    expect(joinMask(E, N)).toBe(E);                  // muro de lado: no cuenta
    expect(joinMask(0, E | W)).toBe(E | W);          // tapón en un hueco de puerta
    expect(joinMask(0, N)).toBe(N);                  // suelta junto a un muro: perpendicular
    expect(joinMask(0, 0)).toBe(0);                  // suelta: a lo largo de X
    expect(joinMask(E | S, N | W)).toBe(E | S);      // esquina dentro de una esquina de muros
  });

  for (const type of JOIN_TYPES) {
    build.pieces[type].levels.forEach((lv, level) => {
      it(`${type} ${lv.name}: las 6 formas son válidas, caben en la celda y llegan al borde de cada vecino`, () => {
        for (const shape of JOIN_SHAPES) {
          const g = structureJoinGeometry(type, level, shape);
          const { position: pos, normal: nor, color: col } = g.attributes;
          expect(nor.count).toBe(pos.count);
          expect(col.count).toBe(pos.count);
          for (const v of pos.array) if (!Number.isFinite(v)) throw new Error(`NaN en ${type} ${shape}`);
          const b = g.boundingBox;
          for (const v of [b.min.x, b.min.z]) expect(v, `${type} ${shape}`).toBeGreaterThanOrEqual(-0.5 - 1e-3);
          for (const v of [b.max.x, b.max.z]) expect(v, `${type} ${shape}`).toBeLessThanOrEqual(0.5 + 1e-3);
          expect(b.min.y).toBeGreaterThanOrEqual(-0.01);
          expect(Math.abs(b.max.y - build.pieces[type].height), `${type} ${shape} alto`).toBeLessThanOrEqual(0.12);
          // los brazos unidos tocan el borde de la celda (el tramo sigue en la vecina sin hueco)
          const reach = { E: b.max.x, W: -b.min.x, S: b.max.z, N: -b.min.z };
          for (const [, , bit] of DIR_BITS) {
            if (!(armBits(shape, 0) & bit)) continue;
            const key = Object.keys(JOIN_BITS).find((k) => JOIN_BITS[k] === bit);
            expect(reach[key], `${type} ${shape} hacia ${key}`).toBeGreaterThan(0.49); // el rollo de alambre acaba a 1 cm del borde
          }
          expect(pos.count / 3, `${type} ${shape} triángulos`).toBeLessThanOrEqual(1400);
          g.dispose();
        }
      });
    });
  }
});

describe('Calabozos: celdas de verdad', () => {
  const grid = new NavGrid(map.rows, tiles, 1);
  const room = ROOM_BY_ID.calabozos;
  const [x0, y0, x1] = room.rect;
  const ch = (i, j) => grid.chars[grid.index(i, j)];

  it('tres celdas con reja frontal, una puerta de reja cada una, tabiques entre ellas y pasillo delante', () => {
    const front = y0 + 3;
    const doors = [];
    for (let i = x0; i <= x1; i++) {
      if (grid.isWalkable(i, front)) doors.push(i);
      else expect(ch(i, front), `reja ${i}`).toBe('|');
    }
    expect(doors.length).toBe(3);
    for (const rel of [3, 6]) for (let j = y0; j < front; j++) expect(ch(x0 + rel, j)).toBe('#');
    // pasillo de las celdas: libre de punta a punta delante de las rejas
    for (let i = x0; i <= x1; i++) if (!['o'].includes(ch(i, front + 1))) expect(grid.isWalkable(i, front + 1), `pasillo ${i}`).toBe(true);
    // cada celda se alcanza desde el inicio por su puerta
    const dist = grid.bfs(grid.playerStart.i, grid.playerStart.j);
    for (const i of doors) expect(dist[grid.index(i, front - 1)], `celda de la puerta ${i}`).toBeGreaterThan(0);
  });

  it('cada celda tiene catre, váter con lavabo y su puerta de reja dibujada', () => {
    const b = new PropBuilder();
    const inst = buildRoom(b, grid, room, 0, 0);
    const cellOf = (it) => (it.bbox.i0 - x0 < 3 ? 0 : it.bbox.i0 - x0 < 6 ? 1 : 2);
    const inCells = inst.filter((it) => it.blocking && it.bbox.j0 - y0 < 3);
    for (const c of [0, 1, 2]) {
      const types = inCells.filter((it) => cellOf(it) === c).map((it) => it.type);
      expect(types, `celda ${c}`).toContain('camastro');
      expect(types, `celda ${c}`).toContain('wc');
    }
    expect(room.furniture.filter((f) => f.type === 'wc').every((f) => /^lavabo[+-]x$/.test(f.variant))).toBe(true);
    expect(inst.filter((it) => it.type === 'puerta_reja').length).toBe(3);
  });
});

describe('Armería y detalle de las salas', () => {
  const grid = new NavGrid(map.rows, tiles, 1);
  const tris = (room, level) => {
    const b = new PropBuilder();
    buildRoom(b, grid, room, level, 0);
    return b.toGeometry('solid').attributes.position.count / 3;
  };

  it('las armas tienen perfiles reconocibles (escopeta, fusil, subfusil, pistola y porra)', () => {
    expect(Object.keys(GUNS).sort()).toEqual(['escopeta', 'fusil', 'pistola', 'porra', 'subfusil']);
    const len = (k) => Math.max(...GUNS[k].map((p) => p[1]));
    expect(len('escopeta')).toBeGreaterThan(len('fusil'));
    expect(len('fusil')).toBeGreaterThan(len('subfusil'));
    expect(len('subfusil')).toBeGreaterThan(len('pistola'));
  });

  it('la armería se llena con el nivel (más armas cuanto más alta)', () => {
    const arm = ROOM_BY_ID.armeria;
    const counts = [0, 1, 2, roomMaxLevel(arm)].map((l) => tris(arm, l));
    for (let k = 1; k < counts.length; k++) expect(counts[k], `nivel ${k}`).toBeGreaterThan(counts[k - 1]);
    expect(TYPES.armero_cortas && TYPES.panel_armas && TYPES.chalecos_armeria).toBeTruthy();
  });

  it('todas las salas llevan su acabado (zócalo pintado, rodapié y enchufes) y sus carteles existen', () => {
    for (const room of ROOMS_LIST) {
      if (!room.rect) continue;
      const b = new PropBuilder();
      const inst = buildRoom(b, grid, room, 0, 0);
      expect(inst.some((it) => it.type === 'acabado_sala'), room.id).toBe(true);
      for (const e of room.decor ?? []) if (e.sprite) expect(SPRITE_NAMES, `${room.id}: ${e.sprite}`).toContain(e.sprite);
    }
    for (const n of SPRITE_NAMES) for (const v of spriteUV(n)) expect(v >= 0 && v <= 1, n).toBe(true);
  });
});
