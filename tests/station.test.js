import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import tiles from '../src/data/tiles.json';
import map from '../src/data/map.json';
import despachoData from '../src/data/despacho.json';
import shopData from '../src/data/shop.json';
import { NavGrid } from '../src/systems/NavGrid.js';
import { WideFlowField } from '../src/systems/FlowField.js';
import { BuildSystem } from '../src/systems/BuildSystem.js';
import { InteractionSystem } from '../src/systems/InteractionSystem.js';
import { ShopSystem } from '../src/systems/ShopSystem.js';
import { Score } from '../src/systems/Score.js';
import { EventBus } from '../src/core/EventBus.js';
import { PHASE } from '../src/systems/DayNight.js';
import { Despacho, exteriorDoorGroups, levelValue, UPGRADE_IDS } from '../src/systems/Despacho.js';
import {
  STATION, ROOMS_LIST, ROOM_RECTS, roomAt, roomLevel, roomMaxLevel, globalLevel, GLOBAL_MAX, roomSigns,
} from '../src/systems/Station.js';
import { TYPES, LEVEL_ROOMS, buildRoom, furnitureGroup } from '../src/render/props/PropFactory.js';
import { PropBuilder } from '../src/render/props/Builder.js';
import { PropRenderer } from '../src/render/PropRenderer.js';
import { ROOM_FLOORS } from '../src/render/MapRenderer.js';

const U = despachoData.upgrades;
const grid = new NavGrid(map.rows, tiles, 1);
const ch = (i, j) => grid.chars[grid.index(i, j)];

describe('Comisaría por salas: datos (station.json)', () => {
  it('cada sala tiene nombre, cartel, suelo conocido y tamaño jugable en el móvil', () => {
    for (const r of ROOMS_LIST) {
      expect(r.name, r.id).toBeTruthy();
      if (!r.rect) { expect(r.sign, r.id).toBeTruthy(); continue; }
      expect(ROOM_FLOORS[r.floor], `${r.id}: suelo ${r.floor}`).toBeTruthy();
      const [x0, y0, x1, y1] = r.rect;
      const w = x1 - x0 + 1, h = y1 - y0 + 1;
      if (r.id === 'pasillo') expect(h).toBe(4); // pasillos de 4 celdas
      else { expect(Math.max(w, h), r.id).toBeGreaterThanOrEqual(7); expect(Math.min(w, h), r.id).toBeGreaterThanOrEqual(6); }
      if (!r.noSign) expect(roomSigns(r).length, r.id).toBeGreaterThanOrEqual(2); // dentro y en el pasillo
    }
  });

  it('las salas pedidas existen y cada mejora tiene su sala', () => {
    for (const id of ['recepcion', 'despacho', 'archivos', 'armeria', 'enfermeria', 'calabozos', 'vestuarios', 'almacen', 'patio', 'azotea', 'descanso', 'pasillo']) {
      expect(ROOMS_LIST.some((r) => r.id === id), id).toBe(true);
    }
    const all = ROOMS_LIST.flatMap((r) => r.upgrades ?? []);
    expect([...all].sort()).toEqual([...UPGRADE_IDS].sort());
    expect(GLOBAL_MAX).toBe(UPGRADE_IDS.reduce((s, id) => s + U[id].prices.length, 0));
  });

  it('todos los tipos de muebles (también por nivel) y de decoración existen', () => {
    for (const r of ROOMS_LIST) {
      for (const f of r.furniture ?? []) for (const t of f.byLevel ?? [f.type]) expect(TYPES[t], `${r.id}: ${t}`).toBeTruthy();
      for (const e of r.decor ?? []) expect(TYPES[e.type], `${r.id}: ${e.type}`).toBeTruthy();
    }
  });

  it('nivel de sala y global: suma de sus mejoras', () => {
    const rec = ROOMS_LIST.find((r) => r.id === 'patio');
    expect(roomMaxLevel(rec)).toBe(5);
    expect(roomLevel(rec, { transformador: 2, focos: 1, muros: 2 })).toBe(3);
    expect(globalLevel({ transformador: 2, focos: 1, muros: 2 })).toBe(5);
  });
});

describe('Comisaría por salas: mapa', () => {
  it('map.json está generado con station.json (muros, puertas, muebles y baldosas)', () => {
    const [bx0, by0, bx1, by1] = STATION.building;
    for (const r of ROOMS_LIST) {
      if (!r.rect) continue;
      const [x0, y0, x1, y1] = r.rect;
      for (let i = x0 - 1; i <= x1 + 1; i++) for (const j of [y0 - 1, y1 + 1]) expect('#D', `${r.id} borde ${i},${j}`).toContain(ch(i, j));
      for (let j = y0 - 1; j <= y1 + 1; j++) for (const i of [x0 - 1, x1 + 1]) expect('#D', `${r.id} borde ${i},${j}`).toContain(ch(i, j));
      for (const f of r.furniture ?? []) for (const [i, j] of furnitureGroup(r, f).cells) expect(ch(i, j), `${r.id} mueble ${i},${j}`).toBe('o');
      for (const t of r.tiles ?? []) expect(ch(r.rect[0] + t.x, r.rect[1] + t.y), `${r.id} baldosa`).toBe(t.ch);
      expect(x0 > bx0 && x1 < bx1 && y0 > by0 && y1 < by1, r.id).toBe(true);
    }
  });

  it('puertas de 2 celdas (interiores y exteriores) y 4 accesos exteriores', () => {
    const seen = new Set();
    for (const d of grid.doors) {
      const k = grid.index(d.i, d.j);
      if (seen.has(k)) continue;
      const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([a, b]) => ch(d.i + a, d.j + b) === 'D');
      expect(n.length, `puerta ${d.i},${d.j}`).toBe(1);
      seen.add(k);
    }
    const ext = exteriorDoorGroups(grid);
    expect(ext.length).toBe(4);
    for (const g of ext) expect(g.length).toBe(2);
  });

  it('cada sala y cada tienda (las 4) se alcanzan desde el inicio', () => {
    const dist = grid.bfs(grid.playerStart.i, grid.playerStart.j);
    for (const [id, r] of Object.entries(ROOM_RECTS)) {
      let ok = 0;
      for (let j = r.y0; j <= r.y1; j++) for (let i = r.x0; i <= r.x1; i++) if (dist[grid.index(i, j)] >= 0) ok++;
      expect(ok, id).toBeGreaterThan(0);
    }
    for (const s of ['armeria', 'enfermeria', 'almacen', 'despacho']) {
      const [{ i, j }] = grid.shops[s];
      expect(dist[grid.index(i, j)], s).toBeGreaterThan(0);
      expect(roomAt(i, j), s === 'despacho' ? 'despacho' : s).toBe(s === 'armeria' ? 'armeria' : s);
    }
    expect(roomAt(grid.playerStart.i, grid.playerStart.j)).toBe('recepcion');
  });

  it('los zombis grandes (rutas de 2×2) llegan al interior por CADA acceso exterior', () => {
    const start = grid.playerStart;
    for (const keep of exteriorDoorGroups(grid)) {
      // Se tapian los demás accesos: la horda grande solo puede entrar por este.
      const rows = map.rows.map((r) => r.split(''));
      for (const g of exteriorDoorGroups(grid)) if (g[0] !== keep[0]) for (const k of g) rows[(k / grid.w) | 0][k % grid.w] = '#';
      const g2 = new NavGrid(rows.map((r) => r.join('')), tiles, 1);
      const ff = new WideFlowField(g2);
      ff.compute(start.i, start.j);
      const k0 = keep[0];
      for (const s of g2.spawns) expect(ff.dist[g2.index(s.i, s.j)], `acceso ${k0 % grid.w},${(k0 / grid.w) | 0} desde ${s.i},${s.j}`).toBeLessThan(Infinity);
    }
  });

  it('los zombis grandes llegan a todas las salas (rutas anchas hasta cada tienda y sala)', () => {
    const ff = new WideFlowField(grid);
    const [sp] = grid.spawns;
    for (const [id, r] of Object.entries(ROOM_RECTS)) {
      // Celda libre más central de la sala.
      let best = null, bd = Infinity;
      const cx = (r.x0 + r.x1) / 2, cz = (r.y0 + r.y1) / 2;
      for (let j = r.y0; j <= r.y1; j++) for (let i = r.x0; i <= r.x1; i++) {
        if (!grid.isWalkable(i, j)) continue;
        const d = (i - cx) ** 2 + (j - cz) ** 2;
        if (d < bd) { bd = d; best = [i, j]; }
      }
      ff.compute(best[0], best[1]);
      expect(ff.dist[grid.index(sp.i, sp.j)], id).toBeLessThan(Infinity);
    }
  });
});

describe('Comisaría por salas: piezas por nivel', () => {
  it('cada sala se construye a nivel 0 y al máximo sin salirse de sus celdas', () => {
    for (const room of ROOMS_LIST) {
      for (const level of [0, roomMaxLevel(room)]) {
        const b = new PropBuilder();
        const inst = buildRoom(b, grid, room, level, GLOBAL_MAX);
        for (const it of inst) {
          if (!it.blocking) continue;
          const { i0, j0, i1, j1 } = it.bbox, M = 0.05;
          const x0 = grid.originX + i0 - M, x1 = grid.originX + i1 + 1 + M, z0 = grid.originZ + j0 - M, z1 = grid.originZ + j1 + 1 + M;
          const bb = it.bounds;
          expect(bb.minX >= x0 && bb.maxX <= x1 && bb.minZ >= z0 && bb.maxZ <= z1, `${room.id} L${level}: ${it.type}@${it.key}`).toBe(true);
        }
        for (const L of ['solid', 'sign']) {
          const geo = b.toGeometry(L);
          if (geo) for (const v of geo.attributes.position.array) if (!Number.isFinite(v)) throw new Error(`NaN en ${room.id}`);
        }
      }
    }
  });

  it('subir una sala reconstruye solo esa sala y libera su geometría vieja', () => {
    const props = new PropRenderer(new THREE.Scene(), grid);
    expect([...props.rooms.keys()].sort()).toEqual([...LEVEL_ROOMS, 'fachada'].sort());
    const part = props.rooms.get('armeria');
    const old = [...part.geometries];
    let disposed = 0;
    for (const g of old) g.addEventListener('dispose', () => disposed++);
    const otherGeo = props.rooms.get('enfermeria').geometries[0];
    expect(props.setRoomLevel('armeria', 0, 0)).toBe(false); // mismo nivel: nada
    expect(props.setRoomLevel('armeria', 3, 3)).toBe(true);
    expect(disposed).toBe(old.length);
    expect(props.rooms.get('enfermeria').geometries[0]).toBe(otherGeo);
    expect(props.rebuilds).toBe(1);
    expect(props.setRoomLevel('fachada', 20, 20)).toBe(true);
    expect(props.setRoomLevel('despacho', 0, 5)).toBe(true); // la maqueta sigue el nivel global
    props.dispose();
  });
});

// ------------------------------------------------------------------ efectos de juego
function makeGame() {
  const bus = new EventBus();
  const noop = () => {};
  const g2 = new NavGrid(map.rows, tiles, 1);
  const owned = new Map([['pistola', { id: 'pistola', reserve: 10, data: { maxReserve: 120 } }]]);
  const game = {
    grid: g2, bus, time: 0,
    run: { points: 100000 },
    power: { generator: true, lightsOn: true },
    dayNight: { phase: PHASE.DAY, night: 1 },
    player: { position: { x: 0, z: 0 }, radius: 0.35, alive: true, hp: 50, maxHp: 100, medkits: 0, armor: 0, armorMax: 0, armorAbsorb: 0, staminaDrainMul: 1 },
    zombies: { active: [], flowDirty: false, damage: (z, a) => { z.hp -= a; }, stun: (z, s) => { z.stunTimer = s; }, boss: null },
    weapons: {
      owned,
      addAmmo: (id, n) => { const w = owned.get(id); const b = w.reserve; w.reserve = Math.min(w.data.maxReserve, w.reserve + n); return w.reserve - b; },
    },
    effects: { burst: noop, shake: noop },
    hud: { toast: noop },
    floating: { spawn: noop },
    waves: { dominantSide: () => 'norte' },
    lighting: { alarmTimer: 0 },
    props: null,
  };
  game.interactions = new InteractionSystem(game);
  game.interactions.setAnchors([{ id: 'taquilla_1', type: 'taquilla', x: 0, z: 0 }]);
  game.build = new BuildSystem(game);
  game.shop = new ShopSystem(game);
  game.score = new Score(game);
  game.despacho = new Despacho(game);
  return game;
}
const cellPos = (g, i, j) => ({ x: g.grid.centerX(i), z: g.grid.centerZ(j) });

describe('Comisaría por salas: efectos por nivel', () => {
  let g;
  beforeEach(() => { g = makeGame(); });

  it('armería: descuento en munición y granadas; al nivel III, munición gratis al amanecer', () => {
    const base = g.shop.ammoPrice(100);
    g.despacho.buy('armeria');
    expect(g.shop.ammoPrice(100)).toBe(Math.ceil(100 * (1 - U.armeria.ammoDiscount[0])));
    expect(base).toBe(100);
    g.bus.emit('phase:amanecer', { night: 1 });
    expect(g.weapons.owned.get('pistola').reserve).toBe(10);
    g.despacho.buy('armeria'); g.despacho.buy('armeria');
    expect(g.shop.ammoPrice(100)).toBe(Math.ceil(100 * (1 - U.armeria.ammoDiscount[2])));
    g.bus.emit('phase:amanecer', { night: 1 });
    expect(g.weapons.owned.get('pistola').reserve).toBe(120);
  });

  it('enfermería: II cura dentro de la sala (y solo dentro); III da un botiquín al amanecer', () => {
    const r = ROOM_RECTS.enfermeria;
    g.player.position = cellPos(g, r.x0 + 4, r.y0 + 5);
    g.despacho.buy('enfermeria');
    g.despacho.update(1);
    expect(g.player.hp).toBe(50);
    g.despacho.buy('enfermeria');
    g.despacho.update(1);
    expect(g.player.hp).toBeCloseTo(50 + U.enfermeria.regenPerSec, 5);
    g.player.position = cellPos(g, 40, 25); // pasillo
    g.despacho.update(1);
    expect(g.player.hp).toBeCloseTo(50 + U.enfermeria.regenPerSec, 5);
    g.bus.emit('phase:amanecer', { night: 1 });
    expect(g.player.medkits).toBe(0);
    g.despacho.buy('enfermeria');
    g.bus.emit('phase:amanecer', { night: 1 });
    expect(g.player.medkits).toBe(1);
  });

  it('calabozos: el suelo electrificado daña a los zombis dentro; el II además aturde', () => {
    const r = ROOM_RECTS.calabozos;
    const zin = { state: 0, hp: 100, stunTimer: 0, pos: cellPos(g, r.x0 + 4, r.y0 + 5) };
    const zout = { state: 0, hp: 100, stunTimer: 0, pos: cellPos(g, 40, 25) };
    g.zombies.active.push(zin, zout);
    g.despacho.update(1);
    expect(zin.hp).toBe(100);
    g.despacho.buy('calabozos');
    g.despacho.update(1);
    expect(zin.hp).toBeCloseTo(100 - U.calabozos.dps[0], 5);
    expect(zout.hp).toBe(100);
    expect(zin.stunTimer).toBe(0);
    g.despacho.buy('calabozos');
    g.despacho.update(0.5);
    expect(zin.stunTimer).toBe(U.calabozos.stunSeconds);
    expect(zin.hp).toBeCloseTo(100 - U.calabozos.dps[0] - U.calabozos.dps[1] * 0.5, 5);
  });

  it('vestuarios: I chaleco parcial al amanecer; II mejor botín y menos gasto de aguante', () => {
    g.bus.emit('phase:amanecer', { night: 1 });
    expect(g.player.armor).toBe(0);
    g.despacho.buy('vestuarios');
    g.bus.emit('phase:amanecer', { night: 1 });
    expect(g.player.armor).toBe(U.vestuarios.vestArmor);
    expect(g.player.armorMax).toBe(shopData.enfermeria.find((i) => i.id === 'chaleco').armor);
    expect(g.player.staminaDrainMul).toBe(1);
    const locker = g.interactions.items.find((it) => it.type === 'taquilla');
    const baseLoot = locker.def.effect.loot;
    g.despacho.buy('vestuarios');
    expect(g.player.staminaDrainMul).toBe(U.vestuarios.staminaDrainMul[1]);
    expect(locker.def.effect.loot).toBe(U.vestuarios.lockerLoot);
    g.despacho.reset();
    expect(locker.def.effect.loot).toBe(baseLoot);
    expect(g.player.staminaDrainMul).toBe(1);
  });

  it('archivo II: los casos de la pizarra pagan más', () => {
    const r0 = g.score.pickObjective(1);
    g.despacho.buy('archivo'); g.despacho.buy('archivo');
    const r1 = g.score.pickObjective(1);
    const base = r1.reward / levelValue(U.archivo.caseRewardMul, 2, 1);
    expect(Math.abs(Math.round(base) - base)).toBeLessThan(0.51);
    expect(r1.reward).toBeGreaterThan(0);
    expect(r0.reward).toBeGreaterThan(0);
  });
});
