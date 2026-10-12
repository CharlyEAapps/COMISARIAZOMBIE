import { describe, it, expect, beforeEach } from 'vitest';
import tiles from '../src/data/tiles.json';
import map from '../src/data/map.json';
import despachoData from '../src/data/despacho.json';
import { NavGrid } from '../src/systems/NavGrid.js';
import { BuildSystem, scaledCost } from '../src/systems/BuildSystem.js';
import { InteractionSystem } from '../src/systems/InteractionSystem.js';
import { ShopSystem } from '../src/systems/ShopSystem.js';
import { EventBus } from '../src/core/EventBus.js';
import { PHASE } from '../src/systems/DayNight.js';
import { Despacho } from '../src/systems/Despacho.js';
import { DRONE_STATE, DRONE_JOB, droneAvailable, jobScore } from '../src/entities/Drone.js';
import { chargePulse } from '../src/render/DroneRenderer.js';
import { roomOfUpgrade } from '../src/systems/Station.js';

const U = despachoData.upgrades.dron;
const DT = 1 / 60;

// Juego mínimo con el mapa real (como despacho.test.js).
function makeGame() {
  const grid = new NavGrid(map.rows, tiles, 1);
  const bus = new EventBus();
  const noop = () => {};
  const toasts = [];
  const floats = [];
  const game = {
    grid, bus, time: 0,
    run: { points: 100000 },
    power: { generator: true, lightsOn: true },
    dayNight: { phase: PHASE.DAY, night: 5 },
    player: { position: { x: 0, z: 0 }, radius: 0.35, alive: true },
    zombies: { active: [], flowDirty: false, damage: noop, stun: noop, boss: null },
    effects: { burst: noop, shake: noop },
    hud: { toast: (t) => toasts.push(t) },
    floating: { spawn: (t) => floats.push(t) },
    waves: { dominantSide: () => 'norte' },
    lighting: { alarmTimer: 0 },
    props: null,
    toasts, floats,
  };
  game.interactions = new InteractionSystem(game);
  game.build = new BuildSystem(game);
  game.shop = new ShopSystem(game);
  game.despacho = new Despacho(game);
  return game;
}

/** Avanza solo el dron (y el reloj) `secs` segundos en pasos fijos. */
function run(g, secs) {
  const n = Math.round(secs / DT);
  for (let k = 0; k < n; k++) { g.time += DT; g.despacho.drone.update(DT); }
}

/** Barricada dañada en la celda (i, j) del mapa, con `frac` de vida. */
function damaged(g, i, j, frac = 0.4, type = 'barricada') {
  const s = g.build.createStructure(type, [g.grid.index(i, j)], 0, 40);
  s.hp = Math.round(s.maxHp * frac);
  return s;
}

describe('Dron: datos y funciones puras', () => {
  it('precios por nivel en el rango pedido, sala del almacén y requisito de noche', () => {
    expect(U.prices).toHaveLength(2);
    expect(U.prices[0]).toBeGreaterThanOrEqual(600); expect(U.prices[0]).toBeLessThanOrEqual(900);
    expect(U.prices[1]).toBeGreaterThanOrEqual(1200); expect(U.prices[1]).toBeLessThanOrEqual(1500);
    expect(U.desc).toHaveLength(2);
    expect(roomOfUpgrade('dron')).toBe('almacen');
    expect(U.availableFromNight).toBeGreaterThan(1);
    expect(U.repairCostMul[1]).toBeCloseTo(0.75);
    expect(U.speed[1]).toBeGreaterThan(U.speed[0]);
    expect(U.ammoPerSec[1]).toBeGreaterThan(U.ammoPerSec[0]);
    expect(U.repairSeconds[1]).toBeLessThan(U.repairSeconds[0]);
    expect(U.flyY).toBeGreaterThanOrEqual(3);
    expect(U.flyY).toBeLessThanOrEqual(4);
  });

  it('droneAvailable, jobScore, scaledCost y chargePulse', () => {
    expect(droneAvailable(U, 1)).toBe(false);
    expect(droneAvailable(U, U.availableFromNight - 1)).toBe(false);
    expect(droneAvailable(U, U.availableFromNight)).toBe(true);
    expect(droneAvailable({}, 1)).toBe(true);
    // Más dañado gana; a igual daño, más cerca gana.
    expect(jobScore(0.8, 10, 1, U)).toBeGreaterThan(jobScore(0.3, 10, 1, U));
    expect(jobScore(0.5, 2, 1, U)).toBeGreaterThan(jobScore(0.5, 30, 1, U));
    expect(scaledCost(0, 0.75)).toBe(0);
    expect(scaledCost(100, 0.75)).toBe(75);
    expect(scaledCost(1, 0.1)).toBe(1);
    for (const t of [0, 0.3, 1.7]) { expect(chargePulse(t, 1.2)).toBeGreaterThanOrEqual(0); expect(chargePulse(t, 1.2)).toBeLessThanOrEqual(1); }
  });
});

describe('Dron: en partida', () => {
  let g, D;
  beforeEach(() => { g = makeGame(); D = g.despacho.drone; });

  it('disponibilidad: bloqueado en la tienda (con el motivo) hasta la noche indicada', () => {
    g.dayNight.night = 1;
    const it = g.shop.catalog('despacho').find((i) => i.id === 'despacho:dron');
    expect(it.state).toBe('locked');
    expect(it.desc).toContain(`día ${U.availableFromNight}`);
    g.shop.open = 'despacho';
    expect(g.shop.whyNot('despacho:dron')).toContain(`día ${U.availableFromNight}`);
    const before = g.run.points;
    expect(g.shop.buy('despacho:dron')).toBeNull();
    expect(g.run.points).toBe(before);
    g.dayNight.night = U.availableFromNight;
    const ok = g.shop.catalog('despacho').find((i) => i.id === 'despacho:dron');
    expect(ok.state).toBe('ok');
    expect(ok.price).toBe(U.prices[0]);
    expect(g.shop.buy('despacho:dron')).toBeTruthy();
    expect(g.run.points).toBe(before - U.prices[0]);
    expect(g.despacho.level('dron')).toBe(1);
    // Ya comprado: el nivel II no se bloquea aunque se cargara una partida anterior.
    g.dayNight.night = 1;
    expect(g.shop.catalog('despacho').find((i) => i.id === 'despacho:dron').state).toBe('ok');
  });

  it('sin comprar no existe; al comprarlo aparca en la base y de día despega', () => {
    expect(D.active).toBe(false);
    run(g, 2);
    expect(D.active).toBe(false);
    g.despacho.buy('dron');
    expect(D.state).toBe(DRONE_STATE.DOCKED);
    expect(D.pos.x).toBeCloseTo(g.despacho.wx(U.base.x));
    expect(D.pos.z).toBeCloseTo(g.despacho.wz(U.base.z));
    run(g, 3);
    expect(D.docked).toBe(false);
    expect(D.pos.y).toBeCloseTo(U.flyY);
  });

  it('de día repara lo dañado y lo cobra como una reparación normal', () => {
    g.despacho.buy('dron');
    const s = damaged(g, 39, 42, 0.4);
    const cost = g.build.repairCostOf(s);
    expect(cost).toBeGreaterThan(0);
    const before = g.run.points;
    run(g, 25);
    expect(s.hp).toBe(s.maxHp);
    expect(g.run.points).toBe(before - cost);
    expect(D.repairs).toBe(1);
    expect(D.spent).toBe(cost);
    expect(g.floats.some((t) => t.includes(String(cost)))).toBe(true);
  });

  it('prioriza lo más dañado y, a igualdad, lo más cercano', () => {
    g.despacho.buy('dron');
    const a = damaged(g, 39, 42, 0.8);
    const b = damaged(g, 41, 42, 0.2);
    D.state = DRONE_STATE.PATROL;
    D.pos.y = U.flyY;
    expect(D.pickJob()).toBe(true);
    expect(D.target).toBe(b);
    b.hp = a.hp;
    D.pos.x = a.cx; D.pos.z = a.cz;
    D.pickJob();
    expect(D.target).toBe(a);
  });

  it('repone poco a poco la munición de las torretas (gratis)', () => {
    g.despacho.buy('dron');
    const t = g.build.createStructure('torreta', [g.grid.index(39, 42)], 0, 600);
    t.ammo = 0;
    const before = g.run.points;
    run(g, 30);
    expect(t.ammo).toBeGreaterThan(0);
    expect(t.ammo).toBeLessThanOrEqual(t.ammoMax);
    expect(g.run.points).toBe(before);
    expect(D.ammoGiven + D.ammoAdded).toBe(t.ammo); // entregada + la de la visita en curso
    // Nunca de golpe: como mucho ammoPerSec por segundo trabajado.
    expect(t.ammo).toBeLessThanOrEqual(Math.ceil(U.ammoPerSec[0] * 30));
  });

  it('repara el transformador cobrando lo normal', () => {
    g.despacho.buy('dron');
    // Sin props en el juego mínimo no hay transformador: uno de prueba en el patio norte.
    g.build.transformer ??= { hp: 700, maxHp: 700, x: 1, z: -29, box: [0, -30, 2, -28], cell: -1, flash: 0, alertAt: -Infinity };
    const tr = g.build.transformer;
    tr.hp = tr.maxHp / 2;
    const cost = g.build.transformerRepairCost();
    const before = g.run.points;
    run(g, 40);
    expect(tr.hp).toBe(tr.maxHp);
    expect(g.run.points).toBe(before - cost);
  });

  it('al anochecer vuelve a la base y se queda cargando; de noche no repara', () => {
    g.despacho.buy('dron');
    run(g, 6);
    expect(D.docked).toBe(false);
    g.dayNight.phase = PHASE.DUSK;
    run(g, 30);
    expect(D.state).toBe(DRONE_STATE.DOCKED);
    expect(D.pos.y).toBeCloseTo(U.parkY);
    g.dayNight.phase = PHASE.NIGHT;
    const s = damaged(g, 39, 42, 0.3);
    D.charge = 0.2;
    const before = g.run.points;
    run(g, 30);
    expect(D.docked).toBe(true);
    expect(s.hp).toBeLessThan(s.maxHp);
    expect(g.run.points).toBe(before);
    expect(D.charge).toBeGreaterThan(0.2);
    // Al amanecer sigue en la base; de día vuelve a salir y repara.
    g.dayNight.phase = PHASE.DAWN;
    run(g, 2);
    expect(D.docked).toBe(true);
    g.dayNight.phase = PHASE.DAY;
    run(g, 25);
    expect(s.hp).toBe(s.maxHp);
  });

  it('sin puntos no repara, pasa a lo siguiente y avisa una sola vez al día', () => {
    g.despacho.buy('dron');
    const a = damaged(g, 39, 42, 0.3);
    const b = damaged(g, 44, 42, 0.3);
    g.run.points = 0;
    run(g, 40);
    expect(a.hp).toBeLessThan(a.maxHp);
    expect(b.hp).toBeLessThan(b.maxHp);
    expect(g.run.points).toBe(0);
    const warns = () => g.toasts.filter((t) => t.startsWith('🚁 Sin presupuesto')).length;
    expect(warns()).toBe(1);
    // Al día siguiente puede volver a avisar.
    g.dayNight.night++;
    run(g, 25);
    expect(warns()).toBe(2);
    // Con puntos otra vez, repara.
    g.run.points = 10000;
    run(g, 60);
    expect(a.hp).toBe(a.maxHp);
    expect(b.hp).toBe(b.maxHp);
  });

  it('si al terminar ya no hay puntos, no cobra ni repara', () => {
    g.despacho.buy('dron');
    const s = damaged(g, 39, 42, 0.3);
    D.state = DRONE_STATE.PATROL;
    D.pos.y = U.flyY;
    D.pickJob();
    expect(D.job).toBe(DRONE_JOB.REPAIR);
    g.run.points = 0;
    D.finishRepair();
    expect(s.hp).toBeLessThan(s.maxHp);
    expect(g.run.points).toBe(0);
    expect(s.droneSkipUntil).toBeGreaterThan(g.time);
  });

  it('nivel II: más rápido y repara un 25 % más barato', () => {
    g.despacho.buy('dron');
    const v1 = D.speed, t1 = D.repairSeconds;
    g.despacho.buy('dron');
    expect(g.despacho.level('dron')).toBe(2);
    expect(D.speed).toBeGreaterThan(v1);
    expect(D.repairSeconds).toBeLessThan(t1);
    const s = damaged(g, 39, 42, 0.2);
    const full = g.build.repairCostOf(s);
    const before = g.run.points;
    run(g, 25);
    expect(s.hp).toBe(s.maxHp);
    expect(g.run.points).toBe(before - scaledCost(full, U.repairCostMul[1]));
    expect(before - g.run.points).toBeLessThan(full);
  });

  it('guardado: el nivel se guarda y al continuar aparece aparcado en su base', () => {
    g.despacho.buy('dron');
    g.despacho.buy('dron');
    const st = JSON.parse(JSON.stringify(g.despacho.getState()));
    expect(st.dron).toBe(2);
    const h = makeGame();
    h.despacho.setState(st);
    const D2 = h.despacho.drone;
    expect(D2.level).toBe(2);
    expect(D2.state).toBe(DRONE_STATE.DOCKED);
    expect(D2.pos.x).toBeCloseTo(h.despacho.wx(U.base.x));
    // Niveles imposibles se recortan; reiniciar el turno lo quita.
    h.despacho.setState({ dron: 9 });
    expect(h.despacho.level('dron')).toBe(2);
    h.despacho.reset();
    expect(h.despacho.drone.active).toBe(false);
  });

  it('las piezas destruidas o vendidas a mitad de trabajo no dan error', () => {
    g.despacho.buy('dron');
    const s = damaged(g, 39, 42, 0.3);
    run(g, 4);
    g.build.remove(s);
    run(g, 10);
    expect(D.target).not.toBe(s);
    expect(D.repairs).toBe(0);
  });
});
