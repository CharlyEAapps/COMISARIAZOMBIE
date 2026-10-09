import { describe, it, expect, beforeEach } from 'vitest';
import tiles from '../src/data/tiles.json';
import map from '../src/data/map.json';
import buildData from '../src/data/build.json';
import { NavGrid } from '../src/systems/NavGrid.js';
import { FlowField } from '../src/systems/FlowField.js';
import { resolveCircleVsGrid, raycastGrid } from '../src/systems/Physics.js';
import { BuildSystem, repairCost } from '../src/systems/BuildSystem.js';
import { InteractionSystem } from '../src/systems/InteractionSystem.js';
import { EventBus } from '../src/core/EventBus.js';
import { PHASE } from '../src/systems/DayNight.js';

// Juego mínimo con el mapa real: lo justo para BuildSystem e InteractionSystem.
function makeGame() {
  const grid = new NavGrid(map.rows, tiles, 1);
  const bus = new EventBus();
  const noop = () => {};
  const game = {
    grid, bus, time: 0,
    run: { points: 5000 },
    power: { generator: true, lightsOn: true },
    dayNight: { phase: PHASE.DAY, night: 1 },
    player: { position: { x: 0, z: 0 }, radius: 0.35, alive: true },
    zombies: { active: [], flowDirty: false, damage: noop },
    effects: { burst: noop, shake: noop, muzzleFlash: noop },
    hud: { toast: noop },
    floating: { spawn: noop },
    props: null, // sin transformador en los tests
  };
  game.interactions = new InteractionSystem(game);
  game.build = new BuildSystem(game);
  return game;
}

// Celda libre de interior (pasillo central) y una puerta 'D' del mapa.
const findCell = (grid, ch) => {
  for (let k = 0; k < grid.chars.length; k++) if (grid.chars[k] === ch) return k;
  return -1;
};

describe('BuildSystem', () => {
  let game, grid, build, k, cx, cz;
  beforeEach(() => {
    game = makeGame();
    ({ grid, build } = game);
    k = grid.index(40, 25); // pasillo central
    cx = grid.centerX(40); cz = grid.centerZ(25);
    game.player.position.x = cx + 3; game.player.position.z = cz;
  });

  it('colocar una barricada cobra, bloquea el paso y las balas', () => {
    const before = game.run.points;
    expect(build.place('barricada', k)).toBe(true);
    expect(game.run.points).toBe(before - buildData.pieces.barricada.levels[0].cost);
    expect(grid.isWalkable(40, 25)).toBe(false);
    const pos = { x: cx - 0.6, z: cz };
    expect(resolveCircleVsGrid(pos, 0.35, grid)).toBe(true);
    expect(pos.x).toBeLessThan(cx - 0.5 - 0.3);
    const shot = raycastGrid(grid, cx - 3, cz, 1, 0, 10, (i, j) => grid.isShotBlocked(i, j));
    expect(shot).toBeCloseTo(2.5, 2); // sin margen: piezas contiguas no dejan rendijas
  });

  it('los sacos frenan a los zombis pero no las balas', () => {
    build.place('sacos', k);
    expect(grid.isWalkable(40, 25)).toBe(false);
    expect(grid.isShotBlocked(40, 25)).toBe(false);
    const shot = raycastGrid(grid, cx - 3, cz, 1, 0, 6, (i, j) => grid.isShotBlocked(i, j));
    expect(shot).toBe(6);
  });

  it('el flow field atraviesa construcciones con coste proporcional a su vida', () => {
    const ff = new FlowField(grid);
    ff.compute(42, 25);
    const free = ff.distanceAt(38, 25);
    build.place('barricada', k);
    ff.compute(42, 25);
    expect(ff.distanceAt(38, 25)).toBeGreaterThan(free);      // más caro…
    expect(ff.distanceAt(38, 25)).toBeLessThan(Infinity);     // …pero no imposible
  });

  it('el daño destruye la pieza y libera la celda', () => {
    build.place('barricada', k);
    build.damageCell(k, 100);
    expect(build.structures.get(k).hp).toBe(buildData.pieces.barricada.levels[0].hp - 100);
    build.damageCell(k, 1e6);
    expect(build.structures.has(k)).toBe(false);
    expect(grid.isWalkable(40, 25)).toBe(true);
    expect(grid.extraCost[k]).toBe(0);
  });

  it('reparar cuesta en proporción al daño; mejorar sube la vida', () => {
    build.place('barricada', k);
    const s = build.structures.get(k);
    s.hp = s.maxHp / 2;
    expect(build.repairCostOf(s)).toBe(repairCost(buildData, s.def, s));
    expect(build.repairCostOf(s)).toBe(Math.ceil(0.5 * s.def.levels[0].cost * buildData.repairCostFactor));
    build.repair(s);
    expect(s.hp).toBe(s.maxHp);
    build.upgrade(s);
    expect(s.level).toBe(1);
    expect(s.maxHp).toBe(buildData.pieces.barricada.levels[1].hp);
  });

  it('vender devuelve el 50 % de lo invertido (proporcional a la vida)', () => {
    build.place('barricada', k);
    const before = game.run.points;
    build.sell(build.structures.get(k));
    expect(game.run.points - before).toBe(Math.floor(buildData.pieces.barricada.levels[0].cost * buildData.sellRefund));
    expect(build.structures.has(k)).toBe(false);
  });

  it('de noche cuesta más', () => {
    const day = build.costOf('barricada');
    game.dayNight.phase = PHASE.NIGHT;
    expect(build.costOf('barricada')).toBe(Math.ceil(day * buildData.nightSurcharge));
  });

  it('reglas de colocación', () => {
    expect(build.canPlace('barricada', grid.index(22, 14))).toMatch(/No se puede/); // muro
    expect(build.canPlace('puerta', k)).toMatch(/puerta/);
    game.player.position.x = cx + 30;
    expect(build.canPlace('barricada', k)).toMatch(/lejos/);
    game.player.position.x = cx;
    expect(build.canPlace('barricada', k)).toMatch(/encima/);
    game.player.position.x = cx + 3;
    game.run.points = 0;
    expect(build.canPlace('barricada', k)).toMatch(/puntos/);
    game.run.points = 5000;
    const shop = findCell(grid, 'A');
    game.player.position.x = grid.centerX(shop % grid.w) + 2; game.player.position.z = grid.centerZ((shop / grid.w) | 0);
    expect(build.canPlace('barricada', shop)).toMatch(/reservada/);
  });

  it('una puerta reforzada se abre y se cierra (con interacción propia)', () => {
    const d = findCell(grid, 'D');
    const di = d % grid.w, dj = (d / grid.w) | 0;
    game.player.position.x = grid.centerX(di) + 3; game.player.position.z = grid.centerZ(dj) + 3;
    expect(build.place('puerta', d)).toBe(true);
    expect(game.interactions.items.some((it) => it.id === `puerta_${d}`)).toBe(true);
    expect(grid.isWalkable(di, dj)).toBe(false);
    build.toggleDoor(d);
    expect(grid.isWalkable(di, dj)).toBe(true);
    expect(grid.extraCost[d]).toBe(0);
    build.toggleDoor(d);
    expect(grid.isWalkable(di, dj)).toBe(false);
    build.sell(build.structures.get(d));
    expect(game.interactions.items.some((it) => it.id === `puerta_${d}`)).toBe(false);
  });

  it('las trampas no bloquean el paso', () => {
    build.place('pinchos', k);
    expect(grid.isWalkable(40, 25)).toBe(true);
  });

  it('dos barricadas en diagonal no dejan pasar por la esquina', () => {
    // (40,25) y (41,26): el paso en diagonal de (40,26) a (41,25) queda prohibido.
    build.place('barricada', grid.index(40, 25));
    build.place('barricada', grid.index(41, 26));
    const ff = new FlowField(grid);
    ff.compute(41, 25);
    expect(ff.nextCell(40, 26)).not.toBe(grid.index(41, 25));
  });

  it('reparar, mejorar y vender exigen estar al alcance', () => {
    build.place('barricada', k);
    const s = build.structures.get(k);
    s.hp = 10;
    game.player.position.x = cx + 20;
    expect(build.primaryAction(k)).toBe(null);
    expect(s.hp).toBe(10);
    build.sellAction(s); build.sellAction(s);
    expect(build.structures.has(k)).toBe(true);
  });

  it('vender pide confirmación (dos clics derechos)', () => {
    build.place('barricada', k);
    const s = build.structures.get(k);
    build.sellAction(s);
    expect(build.structures.has(k)).toBe(true);
    build.sellAction(s);
    expect(build.structures.has(k)).toBe(false);
  });

  it('las piezas dañadas no se pueden mejorar (hay que repararlas antes)', () => {
    build.place('barricada', k);
    const s = build.structures.get(k);
    s.hp = s.maxHp - 1;
    expect(build.upgrade(s)).toBe(false);
    expect(s.level).toBe(0);
  });

  it('de noche reparar también lleva recargo', () => {
    build.place('barricada', k);
    const s = build.structures.get(k);
    s.hp = s.maxHp / 2;
    const day = build.repairCostOf(s);
    game.dayNight.phase = PHASE.NIGHT;
    expect(build.repairCostOf(s)).toBeGreaterThan(day);
  });

  it('la mina no daña a través de los muros', () => {
    game.weapons = { shotBlocked: (i, j) => grid.isShotBlocked(i, j) };
    let hits = 0;
    game.zombies.damage = () => { hits++; };
    // Mina en el pasillo (40,25) y un zombi justo al otro lado del muro sur del pasillo (40,29).
    build.place('mina', k);
    game.zombies.active = [{ state: 0, pos: { x: cx, z: grid.centerZ(29) - 0.2 }, radius: 0.38 }];
    game.player.damage = () => { hits += 100; };
    game.player.position.z = grid.centerZ(21); // también tras un muro (oficinas)
    build.explodeMine(build.structures.get(k));
    expect(hits).toBe(0);
  });

  it('reset deja la rejilla limpia', () => {
    build.place('barricada', k);
    build.reset();
    expect(build.structures.size).toBe(0);
    expect(grid.blocked.some((v) => v)).toBe(false);
  });
});
