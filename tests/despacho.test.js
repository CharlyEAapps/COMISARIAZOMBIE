import { describe, it, expect, beforeEach } from 'vitest';
import tiles from '../src/data/tiles.json';
import map from '../src/data/map.json';
import buildData from '../src/data/build.json';
import shopData from '../src/data/shop.json';
import despachoData from '../src/data/despacho.json';
import { NavGrid } from '../src/systems/NavGrid.js';
import { BuildSystem, pieceMaxHp } from '../src/systems/BuildSystem.js';
import { InteractionSystem } from '../src/systems/InteractionSystem.js';
import { ShopSystem } from '../src/systems/ShopSystem.js';
import { EventBus } from '../src/core/EventBus.js';
import { PHASE } from '../src/systems/DayNight.js';
import {
  Despacho, UPGRADE_IDS, exteriorDoorGroups, nextPrice, maxLevel, sanitizeLevels, transformerMaxHp, sideOf, levelValue,
  sensorStep, rectDist, gateTowerCells,
} from '../src/systems/Despacho.js';
import { barrelCount, barrelCells, assistBarrel, barrelHasVictims } from '../src/systems/Barrels.js';
import { LUIGI_MODE, nearestThreat, luigiMode } from '../src/entities/Luigi.js';
import { roomOfUpgrade, ROOMS_LIST } from '../src/systems/Station.js';

const U = despachoData.upgrades;

// Juego mínimo con el mapa real (como build.test.js) más el despacho y la tienda.
function makeGame() {
  const grid = new NavGrid(map.rows, tiles, 1);
  const bus = new EventBus();
  const noop = () => {};
  const toasts = [];
  const game = {
    grid, bus, time: 0,
    run: { points: 100000 },
    power: { generator: true, lightsOn: true },
    dayNight: { phase: PHASE.DAY, night: 1 },
    player: { position: { x: 0, z: 0 }, radius: 0.35, alive: true },
    zombies: { active: [], flowDirty: false, damage: noop, stun: (z, t) => { z.stunTimer = t; }, boss: null },
    effects: { burst: noop, shake: noop },
    hud: { toast: (t) => toasts.push(t) },
    floating: { spawn: noop },
    waves: { dominantSide: () => 'norte' },
    lighting: { alarmTimer: 0 },
    props: null,
    toasts,
  };
  game.interactions = new InteractionSystem(game);
  game.interactions.setAnchors([
    { id: 'alarma_1', type: 'alarma', x: 0, z: 0 },
    { id: 'botiquin_pared_1', type: 'botiquin_pared', x: 5, z: 5 },
  ]);
  game.build = new BuildSystem(game);
  game.shop = new ShopSystem(game);
  game.despacho = new Despacho(game);
  return game;
}

const nightfall = (g) => { g.dayNight.phase = PHASE.NIGHT; g.bus.emit('phase:noche', { night: g.dayNight.night }); };
const dawn = (g) => { g.dayNight.phase = PHASE.DAWN; g.bus.emit('phase:amanecer', { night: g.dayNight.night }); };

describe('Despacho: funciones puras', () => {
  it('los datos tienen precio, descripción por nivel y una sala (y solo una)', () => {
    for (const id of UPGRADE_IDS) {
      const u = U[id];
      expect(roomOfUpgrade(id), id).toBeTruthy();
      expect(ROOMS_LIST.filter((r) => (r.upgrades ?? []).includes(id))).toHaveLength(1);
      expect(u.prices.length).toBeGreaterThan(0);
      expect(u.desc.length).toBe(u.prices.length);
      expect(u.flavor).toBeTruthy();
      for (const p of u.prices) { expect(p).toBeGreaterThanOrEqual(300); expect(p).toBeLessThanOrEqual(1500); }
    }
  });

  it('nextPrice: precio del siguiente nivel y 0 al máximo', () => {
    expect(nextPrice('persianas', 0)).toBe(U.persianas.prices[0]);
    expect(nextPrice('persianas', 2)).toBe(U.persianas.prices[2]);
    expect(nextPrice('persianas', maxLevel('persianas'))).toBe(0);
    expect(nextPrice('focos', 1)).toBe(0);
    expect(nextPrice('no_existe', 0)).toBe(0);
  });

  it('sanitizeLevels: descarta ids desconocidos y limita los niveles', () => {
    expect(sanitizeLevels({ persianas: 9, muros: 1.7, archivo: -2, foo: 3, radar: 1, camaras: 'x' })).toEqual({ persianas: 3, muros: 1 });
    expect(sanitizeLevels(null)).toEqual({});
  });

  it('transformerMaxHp y levelValue', () => {
    expect(transformerMaxHp(700, 0)).toBe(700);
    expect(transformerMaxHp(700, 1)).toBe(Math.round(700 * (1 + U.transformador.hpBonus[0])));
    expect(transformerMaxHp(700, 3)).toBe(Math.round(700 * (1 + U.transformador.hpBonus[2])));
    expect(levelValue([2, 4, 6], 0, 0)).toBe(0);
    expect(levelValue([2, 4, 6], 2, 0)).toBe(4);
  });

  it('sideOf: z crece hacia el sur', () => {
    expect(sideOf(0, -5)).toBe('norte');
    expect(sideOf(0, 5)).toBe('sur');
    expect(sideOf(5, 1)).toBe('este');
    expect(sideOf(-5, 1)).toBe('oeste');
  });

  it('pieceMaxHp: el refuerzo no se aplica a las trampas', () => {
    const P = buildData.pieces;
    expect(pieceMaxHp(P.barricada, 0, 1, 1.5)).toBe(Math.round(P.barricada.levels[0].hp * 1.5));
    expect(pieceMaxHp(P.puerta, 1, 2, 1.25, 2)).toBe(Math.round(P.puerta.levels[1].hp * 2 * 1.25 * 2));
    expect(pieceMaxHp(P.pinchos, 0, 1, 1.5)).toBe(P.pinchos.levels[0].hp);
  });

  it('exteriorDoorGroups: los 4 accesos exteriores del edificio, de 2 celdas', () => {
    const grid = new NavGrid(map.rows, tiles, 1);
    const groups = exteriorDoorGroups(grid).map((g) => g.map((k) => [k % grid.w, (k / grid.w) | 0]));
    expect(groups).toHaveLength(4);
    expect(groups).toContainEqual([[39, 14], [40, 14]]); // norte (sala de descanso → patio)
    expect(groups).toContainEqual([[33, 37], [34, 37]]); // sur (recepción)
    expect(groups).toContainEqual([[15, 24], [15, 25]]); // oeste (pasillo)
    expect(groups).toContainEqual([[63, 24], [63, 25]]); // este (pasillo)
  });
});

describe('Despacho: mejoras en partida', () => {
  let g;
  beforeEach(() => { g = makeGame(); });

  it('getState/setState: objeto plano serializable que reaplica los efectos', () => {
    const b = g.build;
    const k = g.grid.index(30, 25);
    g.player.position = { x: g.grid.centerX(30), z: g.grid.centerZ(27) };
    expect(b.place('barricada', k)).toBe(true);
    const s = b.structures.get(k);
    g.despacho.setState(JSON.parse(JSON.stringify({ muros: 2, archivo: 1 })));
    expect(g.despacho.getState()).toEqual({ muros: 2, archivo: 1 });
    expect(g.despacho.roomLevel('almacen')).toBe(2);
    expect(g.despacho.globalLevel).toBe(3);
    expect(s.maxHp).toBe(Math.round(buildData.pieces.barricada.levels[0].hp * U.muros.hpMul[1]));
    g.despacho.reset();
    expect(g.despacho.getState()).toEqual({});
    expect(b.hpMul).toBe(1);
  });

  it('muros reforzados: suben la vida de lo construido conservando la proporción y de lo nuevo', () => {
    const b = g.build;
    g.player.position = { x: g.grid.centerX(30), z: g.grid.centerZ(27) };
    const k1 = g.grid.index(30, 25), k2 = g.grid.index(31, 25);
    b.place('barricada', k1);
    const s = b.structures.get(k1);
    const base = s.maxHp;
    s.hp = base / 2;
    g.despacho.buy('muros');
    expect(s.maxHp).toBe(Math.round(base * U.muros.hpMul[0]));
    expect(s.hp).toBe(Math.round(s.maxHp / 2));
    b.place('barricada', k2);
    expect(b.structures.get(k2).maxHp).toBe(Math.round(base * U.muros.hpMul[0]));
  });

  it('persianas: se reponen al anochecer en los huecos libres y no se suben al amanecer (van por sensor)', () => {
    const b = g.build;
    let placedEvents = 0;
    g.bus.on('build:placed', () => placedEvents++);
    // Un hueco ya ocupado por una puerta del jugador se respeta.
    g.shop.unlocked.add('puerta:0');
    const [first] = exteriorDoorGroups(g.grid);
    g.player.position = { x: g.grid.centerX(first[0] % g.grid.w), z: g.grid.centerZ(((first[0] / g.grid.w) | 0) + 2) };
    expect(b.place('puerta', first[0])).toBe(true);
    placedEvents = 0;
    g.player.position = { x: 0, z: 0 };

    g.despacho.buy('persianas');
    nightfall(g);
    expect(g.despacho.shutters).toHaveLength(3);
    for (const s of g.despacho.shutters) {
      expect(s.auto).toBe(true);
      expect(s.type).toBe('puerta');
      expect(s.level).toBe(U.persianas.doorLevel);
      expect(s.open).toBe(false);
      expect(s.maxHp).toBe(pieceMaxHp(buildData.pieces.puerta, U.persianas.doorLevel, s.n));
      expect(b.upgradeCost(s)).toBe(0);
    }
    expect(placedEvents).toBe(0); // no cuentan como construcciones del jugador
    // No se venden.
    const s0 = g.despacho.shutters[0];
    g.player.position = { x: s0.cx, z: s0.cz + 1 };
    b.sellAction(s0); b.sellAction(s0);
    expect(b.all.has(s0)).toBe(true);
    g.player.position = { x: 0, z: 0 };
    // El refuerzo de muros no se suma a las persianas (tienen su propia mejora).
    const before = s0.maxHp;
    g.despacho.buy('muros');
    expect(s0.maxHp).toBe(before);
    // Nivel II: más vida a las que ya están puestas.
    g.despacho.buy('persianas');
    expect(s0.maxHp).toBe(pieceMaxHp(buildData.pieces.puerta, U.persianas.doorLevel, s0.n, 1, U.persianas.hpMul[1]));
    // Al amanecer siguen puestas y cerradas: las abre el sensor al acercarse Carlos.
    dawn(g);
    expect(g.despacho.shutters).toHaveLength(3);
    for (const s of g.despacho.shutters) expect(s.open).toBe(false);
    expect(b.all.has(s0)).toBe(true);
    // Si rompen una, se repone al anochecer con la vida al máximo.
    b.remove(s0);
    g.player.position = { x: 0, z: 0 };
    nightfall(g);
    expect(g.despacho.shutters).toHaveLength(3);
    for (const s of g.despacho.shutters) { expect(s.open).toBe(false); expect(s.hp).toBe(s.maxHp); }
    expect([...b.all].filter((s) => s.type === 'puerta' && !s.auto)).toHaveLength(1); // la del jugador sigue
  });

  it('portones del recinto: cierran los 3 huecos de la valla de noche y se abren de día', () => {
    g.despacho.buy('portones');
    const gates = g.despacho.shutters.filter((s) => s.upgrade === 'portones');
    expect(gates).toHaveLength(3);
    for (const s of gates) { expect(s.open).toBe(true); expect(s.n).toBe(4); expect(s.auto).toBe(true); }
    nightfall(g);
    for (const s of gates) expect(s.open).toBe(false);
    dawn(g);
    for (const s of gates) expect(s.open).toBe(true);
    // Las persianas del edificio son aparte.
    expect(g.despacho.shutters.filter((s) => s.upgrade === 'persianas')).toHaveLength(0);
  });

  it('persianas compradas de día se instalan al momento, cerradas y sin aviso de "usar"', () => {
    g.despacho.buy('persianas');
    expect(g.despacho.shutters).toHaveLength(4);
    for (const s of g.despacho.shutters) {
      expect(g.build.all.has(s)).toBe(true);
      expect(s.open).toBe(false);
      expect(g.interactions.items.some((it) => it.id === `puerta_${s.id}`)).toBe(false);
    }
  });

  it('persianas compradas de noche se ponen al momento; con alguien en medio quedan abiertas', () => {
    const groups = exteriorDoorGroups(g.grid);
    const k = groups[0][0];
    g.player.position = { x: g.grid.centerX(k % g.grid.w), z: g.grid.centerZ((k / g.grid.w) | 0) };
    g.dayNight.phase = PHASE.NIGHT;
    g.despacho.buy('persianas');
    expect(g.despacho.shutters).toHaveLength(4);
    const blocked = g.build.structures.get(k);
    expect(blocked.open).toBe(true);
  });

  it('transformador reforzado y generador de emergencia', () => {
    const b = g.build;
    b.transformer = { hp: 700, maxHp: 700, x: 0, z: 0, box: [0, 0, 1, 1], cell: -1, flash: 0, alertAt: -Infinity };
    g.despacho.buy('transformador');
    expect(b.transformer.maxHp).toBe(transformerMaxHp(700, 1));
    expect(b.transformer.hp).toBe(b.transformer.maxHp);
    b.transformer.hp = 100;
    g.despacho.update(1);
    expect(b.transformer.hp).toBe(100 + U.transformador.dayRepair[0]);
    g.dayNight.phase = PHASE.NIGHT;
    g.despacho.update(1);
    expect(b.transformer.hp).toBe(100 + U.transformador.dayRepair[0]); // de noche no

    g.despacho.buy('generador_emergencia');
    b.transformer.hp = 0;
    g.bus.emit('transformer:destroyed');
    expect(g.despacho.emergencyOn).toBe(true);
    expect(b.powered).toBe(true);
    g.despacho.update(U.generador_emergencia.seconds + 0.1);
    expect(g.despacho.emergencyOn).toBe(false);
    expect(b.powered).toBe(false);
    g.bus.emit('transformer:destroyed'); // no se recarga hasta reparar
    expect(g.despacho.emergencyOn).toBe(false);
  });

  it('alarma mejorada: dura más y se puede usar dos veces por noche', () => {
    const it0 = g.interactions.items.find((it) => it.type === 'alarma');
    const base = it0.def.effect.alarm;
    g.despacho.buy('alarma');
    expect(it0.def.effect.alarm).toBe(base + U.alarma.extraSeconds);
    nightfall(g);
    const z = { state: 0, stunTimer: 0 }, dead = { state: 2, stunTimer: 0 };
    g.zombies.active.push(z, dead);
    it0.usedCycle = g.dayNight.night;
    g.bus.emit('interact', { type: 'alarma' });
    expect(z.stunTimer).toBe(U.alarma.stunSeconds); // la sirena los deja aturdidos
    expect(dead.stunTimer).toBe(0);
    g.zombies.active.length = 0;
    g.lighting.alarmTimer = 5;
    g.despacho.update(1 / 60);
    expect(it0.usedCycle).toBe(g.dayNight.night); // sigue sonando
    g.lighting.alarmTimer = 0;
    g.despacho.update(1 / 60);
    expect(it0.usedCycle).toBe(0); // segundo uso
    it0.usedCycle = g.dayNight.night;
    g.bus.emit('interact', { type: 'alarma' });
    g.despacho.update(1 / 60);
    expect(it0.usedCycle).toBe(g.dayNight.night); // ya no hay más
    g.despacho.reset();
    expect(it0.def.effect.alarm).toBe(base);
  });

  it('botiquines de pared: se reponen también al anochecer', () => {
    const med = g.interactions.items.find((it) => it.type === 'botiquin_pared');
    med.usedCycle = 1;
    nightfall(g);
    expect(med.usedCycle).toBe(1);
    g.despacho.buy('enfermeria');
    nightfall(g);
    expect(med.usedCycle).toBe(0);
  });

  it('archivo (radar) y cámaras', () => {
    expect(g.despacho.has('camaras')).toBe(false);
    expect(g.despacho.threatMul(true)).toBe(1);
    g.despacho.buy('camaras');
    expect(g.despacho.has('camaras')).toBe(true);
    expect(g.despacho.threatMul(false)).toBe(U.camaras.rangeMul[0]);
    g.despacho.buy('camaras');
    expect(g.despacho.threatMul(true)).toBe(U.camaras.specialRangeMul[1]);
    g.despacho.buy('archivo');
    nightfall(g);
    expect(g.toasts.some((t) => t.includes('norte'))).toBe(true);
  });

  it('tienda: catálogo por bloques, recargo nocturno y compra con puntos', () => {
    const items = g.shop.catalog('despacho');
    expect(items).toHaveLength(UPGRADE_IDS.length);
    // Agrupadas por sala, en el orden de station.json, con el nivel de la sala en la sección.
    const order = ROOMS_LIST.filter((r) => (r.upgrades ?? []).length).map((r) => r.name);
    const idx = items.map((i) => order.findIndex((n) => i.section.startsWith(n)));
    expect(idx.every((n) => n >= 0)).toBe(true);
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
    expect(items.find((i) => i.id === 'despacho:muros').section).toContain('nivel 0/4'); // muros (2) + dron (2)
    const pers = items.find((i) => i.id === 'despacho:persianas');
    expect(pers.price).toBe(U.persianas.prices[0]);
    expect(pers.name).toContain('☆☆☆');
    g.dayNight.phase = PHASE.NIGHT;
    const night = g.shop.catalog('despacho').find((i) => i.id === 'despacho:persianas');
    expect(night.price).toBe(Math.ceil(U.persianas.prices[0] * shopData.nightSurcharge));
    g.dayNight.phase = PHASE.DAY;
    g.shop.open = 'despacho';
    const before = g.run.points;
    expect(g.shop.buy('despacho:focos')).toBeTruthy();
    expect(g.run.points).toBe(before - U.focos.prices[0]);
    expect(g.despacho.level('focos')).toBe(1);
    expect(g.shop.whyNot('despacho:focos')).toBeTruthy(); // ya lo tienes
    expect(g.shop.catalog('despacho').find((i) => i.id === 'despacho:focos').section).toContain('nivel 1/');
  });
});

// ------------------------------------------------------------------ Frente A (octubre)
const at = (g, i, j) => ({ x: g.grid.centerX(i), z: g.grid.centerZ(j) });
const zombie = (x, z, hp = 100) => ({ state: 0, active: true, hp, radius: 0.35, stunTimer: 0, pos: { x, z } });

describe('Persianas con sensor', () => {
  let g;
  beforeEach(() => { g = makeGame(); });

  it('sensorStep: abre con Carlos cerca, espera con el hueco ocupado y cierra tras el retardo', () => {
    const s = { open: false, sensorT: 0 };
    expect(sensorStep(s, false, true, 0.1, 0.6)).toBe(false); // zombis solos: no abren
    expect(sensorStep(s, true, false, 0.1, 0.6)).toBe(true);
    s.open = true;
    expect(sensorStep(s, false, true, 1, 0.6)).toBe(true);    // alguien pasando: no cierra
    expect(sensorStep(s, false, false, 0.5, 0.6)).toBe(true);
    expect(sensorStep(s, false, false, 0.2, 0.6)).toBe(false); // 0,7 s libre
  });

  it('rectDist: 0 dentro y distancia al borde fuera', () => {
    const r = [0, 0, 2, 1];
    expect(rectDist(1, 0.5, r)).toBe(0);
    expect(rectDist(3, 0.5, r)).toBe(1);
    expect(rectDist(5, 5, r)).toBe(5);
  });

  it('se abren al acercarse Carlos y se cierran solas; los zombis no las abren pero las mantienen', () => {
    const P = U.persianas;
    g.despacho.buy('persianas');
    // La del sur (recepción): hueco a lo largo de X.
    const s = g.despacho.shutters.find((x) => x.upgrade === 'persianas' && x.j === 37);
    expect(s.open).toBe(false);
    // Un zombi pegado a la persiana (por fuera) no la abre.
    const z = zombie(s.cx, s.gap[3] + 0.3);
    g.zombies.active.push(z);
    g.despacho.update(1 / 60);
    expect(s.open).toBe(false);
    // Carlos a 1 m por dentro: se abre (y el hueco deja de bloquear).
    g.player.position = { x: s.cx, z: s.gap[1] - 1 };
    g.despacho.update(1 / 60);
    expect(s.open).toBe(true);
    expect(g.grid.isWalkable(s.i, s.j)).toBe(true);
    // Carlos se va, pero el zombi está pasando por el hueco: sigue abierta.
    g.player.position = { x: 0, z: 0 };
    z.pos.z = s.cz;
    for (let n = 0; n < 60; n++) g.despacho.update(1 / 60);
    expect(s.open).toBe(true);
    // El zombi sale: se cierra tras el retardo (no antes).
    z.pos.z = s.cz - 3;
    g.despacho.update(P.closeDelay * 0.5);
    expect(s.open).toBe(true);
    g.despacho.update(P.closeDelay * 0.6);
    expect(s.open).toBe(false);
    expect(g.grid.isWalkable(s.i, s.j)).toBe(false);
  });

  it('los portones del recinto siguen abriendo de día y cerrando de noche', () => {
    g.despacho.buy('persianas');
    g.despacho.buy('portones');
    nightfall(g);
    dawn(g);
    for (const s of g.despacho.shutters) expect(s.open).toBe(s.upgrade === 'portones');
  });
});

describe('Torre de vigilancia III: torres en los accesos', () => {
  let g;
  beforeEach(() => { g = makeGame(); });
  const T = U.torreta_tejado;

  it('las torres van dentro de la valla, pegadas a cada acceso, en sitio libre del mapa', () => {
    const groups = gateTowerCells(g.grid);
    expect(groups).toHaveLength(3);
    const gates = U.portones.gates;
    groups.forEach((cells, n) => {
      const [gx0, gz0, gx1, gz1] = gates[n];
      let touches = false;
      for (const k of cells) {
        const i = k % g.grid.w, j = (k / g.grid.w) | 0;
        expect(g.grid.isStaticWalkable(i, j), `${i},${j}`).toBe(true);
        expect(i > 8 && i < 71 && j > 8 && j < 64, `dentro de la valla ${i},${j}`).toBe(true);
        expect(i >= gx0 && i <= gx1 && j >= gz0 && j <= gz1).toBe(false); // no tapa el acceso
        // Pegada: a 2 celdas como mucho del hueco.
        if (Math.max(Math.max(gx0 - i, 0, i - gx1), Math.max(gz0 - j, 0, j - gz1)) <= 2) touches = true;
      }
      expect(touches, `torre ${n}`).toBe(true);
    });
  });

  it('nivel III: torres con colisión, retira lo construido devolviendo lo invertido y reserva el sitio', () => {
    const b = g.build;
    const [west] = gateTowerCells(g.grid);
    const k = west[0];
    g.player.position = at(g, (k % g.grid.w) + 2, ((k / g.grid.w) | 0) + 2);
    expect(b.place('barricada', k)).toBe(true);
    const invested = b.structures.get(k).invested;
    g.despacho.buy('torreta_tejado');
    g.despacho.buy('torreta_tejado');
    expect(g.despacho.towersUp).toBe(false);
    expect(g.despacho.roofTurret.level).toBe(1);
    const pts = g.run.points;
    g.despacho.buy('torreta_tejado');
    expect(g.despacho.towersUp).toBe(true);
    expect(g.despacho.roofTurret.level).toBe(1); // la del patio sigue siendo la pesada
    expect(b.structures.has(k)).toBe(false);
    expect(g.run.points).toBe(pts + invested);
    for (const cells of gateTowerCells(g.grid)) {
      for (const c of cells) expect(g.grid.isWalkable(c % g.grid.w, (c / g.grid.w) | 0)).toBe(false);
    }
    expect(b.canPlace('barricada', k)).toBe('Zona reservada');
    expect(g.despacho.gateTurrets).toHaveLength(3);
    for (const t of g.despacho.gateTurrets) expect(t.def.levels).toEqual(T.gateTowers.levels);
    // Los accesos siguen libres.
    for (const [x0, z0, x1, z1] of U.portones.gates) {
      for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) expect(g.grid.isWalkable(i, j)).toBe(true);
    }
    // Al reiniciar el turno desaparecen.
    g.despacho.reset();
    expect(g.despacho.towersUp).toBe(false);
    expect(g.grid.isWalkable(k % g.grid.w, (k / g.grid.w) | 0)).toBe(true);
  });

  it('setState con el nivel III vuelve a levantar las torres', () => {
    g.despacho.setState({ torreta_tejado: 3 });
    expect(g.despacho.towersUp).toBe(true);
    expect(g.despacho.isReserved(gateTowerCells(g.grid)[2][0])).toBe(true);
  });
});

describe('Barriles explosivos del parking', () => {
  let g;
  beforeEach(() => { g = makeGame(); });
  const B = U.barriles;

  it('6 en el nivel I y 10 en el II, en sitios libres del parking', () => {
    expect(barrelCount(0)).toBe(0);
    expect(barrelCount(1)).toBe(6);
    expect(barrelCount(2)).toBe(10);
    const cells = barrelCells(g.grid, 2);
    expect(new Set(cells).size).toBe(10);
    const towers = new Set(gateTowerCells(g.grid).flat());
    for (const k of cells) {
      const i = k % g.grid.w, j = (k / g.grid.w) | 0;
      expect(g.grid.isStaticWalkable(i, j), `${i},${j}`).toBe(true);
      expect(j).toBeGreaterThan(37); // parking (al sur del edificio)
      expect(towers.has(k)).toBe(false);
    }
  });

  it('se ponen al comprar, se reponen al anochecer, bloquean el paso y no se guardan', () => {
    const b = g.build;
    g.despacho.buy('barriles');
    expect(b.barrels).toHaveLength(6);
    for (const s of b.barrels) {
      expect(s.auto).toBe(true);
      expect(g.grid.isWalkable(s.i, s.j)).toBe(false);
    }
    g.despacho.buy('barriles');
    expect(b.barrels).toHaveLength(10);
    // Dos estallan (la explosión la pinta Explosions.js; aquí basta con quitarlos).
    b.remove(b.barrels[0]); b.remove(b.barrels[0]);
    expect(b.barrels).toHaveLength(8);
    nightfall(g);
    expect(b.barrels).toHaveLength(10);
    expect(g.toasts.some((t) => t.startsWith(B.nightMsg.slice(0, 10)))).toBe(true);
    // Con Carlos encima de un sitio, ese no se pone.
    b.remove(b.barrels[0]);
    const k = barrelCells(g.grid, 2).find((c) => !b.structures.has(c));
    g.player.position = at(g, k % g.grid.w, (k / g.grid.w) | 0);
    nightfall(g);
    expect(b.barrels).toHaveLength(9);
    // reset: se retiran.
    g.despacho.reset();
    expect(b.barrels).toHaveLength(0);
  });

  it('al continuar el turno se ponen en el primer paso, después de lo construido', () => {
    const b = g.build;
    const [k] = barrelCells(g.grid, 1);
    g.player.position = at(g, (k % g.grid.w) + 2, (k / g.grid.w) | 0);
    g.despacho.setState({ barriles: 1 });
    expect(b.barrels).toHaveLength(0);
    expect(b.place('sacos', k)).toBe(true); // lo construido (restaurado) tiene preferencia
    g.player.position = { x: 0, z: 0 };
    g.despacho.update(1 / 60);
    expect(b.barrels).toHaveLength(5);
    expect(b.structures.get(k).type).toBe('sacos');
  });

  it('asistencia de apuntado: solo apunta a barriles con zombis al lado y más alineados', () => {
    const s = { cx: 10, cz: 0, def: { radius: 3 } };
    const far = zombie(30, 0);
    expect(barrelHasVictims(s, [far])).toBe(false);
    expect(assistBarrel([s], [far], 0, 0, 1, 0, 0.9, 20)).toBe(null);
    const near = zombie(11, 1);
    expect(barrelHasVictims(s, [near])).toBe(true);
    expect(assistBarrel([s], [near], 0, 0, 1, 0, 0.9, 20)).toBe(s);
    expect(assistBarrel([s], [near], 0, 0, 1, 0, 0.9, 5)).toBe(null);    // fuera de alcance
    expect(assistBarrel([s], [near], 0, 0, 0, 1, 0.9, 20)).toBe(null);   // fuera del cono
    expect(assistBarrel([s], [near], 0, 0, 1, 0, 0.99999, 20)).toBe(s);  // más alineado que el zombi
    expect(assistBarrel([s], [near], 0, 0, 1, 0, 1, 20)).toBe(null);
  });
});

describe('Luigi, el chihuahua', () => {
  let g;
  beforeEach(() => {
    g = makeGame();
    g.zombies.damage = (z, a) => { z.hp -= a; if (z.hp <= 0) z.state = 2; };
  });
  const L = U.luigi;

  it('nearestThreat y luigiMode', () => {
    const a = zombie(3, 0), b = zombie(1, 1), dead = { ...zombie(0.5, 0), state: 2 };
    expect(nearestThreat([a, b, dead], 0, 0, 4)).toBe(b);
    expect(nearestThreat([a], 0, 0, 2)).toBe(null);
    expect(luigiMode(LUIGI_MODE.FOLLOW, 2, true, L)).toBe(LUIGI_MODE.CHASE);
    expect(luigiMode(LUIGI_MODE.CHASE, L.leashRange + 1, true, L)).toBe(LUIGI_MODE.RETURN);
    expect(luigiMode(LUIGI_MODE.RETURN, L.followDist * 2, true, L)).toBe(LUIGI_MODE.RETURN);
    expect(luigiMode(LUIGI_MODE.RETURN, L.followDist, false, L)).toBe(LUIGI_MODE.FOLLOW);
  });

  it('al comprarlo sale de su cama y sigue a Carlos', () => {
    const lu = g.despacho.luigi;
    expect(lu.active).toBe(false);
    g.despacho.buy('luigi');
    expect(lu.active).toBe(true);
    expect(lu.pos.z).toBeCloseTo(g.despacho.wz(L.bed.z + L.bed.d), 5);
    // Carlos en la sala de descanso: Luigi se le acerca.
    g.player.position = at(g, 39, 19);
    const d0 = Math.hypot(lu.pos.x - g.player.position.x, lu.pos.z - g.player.position.z);
    for (let n = 0; n < 120; n++) g.despacho.update(1 / 60);
    const d1 = Math.hypot(lu.pos.x - g.player.position.x, lu.pos.z - g.player.position.z);
    expect(d1).toBeLessThan(d0);
    expect(d1).toBeLessThan(L.followDist + 0.3);
  });

  it('corre a morder a los zombis que se acercan a Carlos (6 cada 0,8 s) y no puede morir', () => {
    g.player.position = at(g, 40, 50);
    g.despacho.buy('luigi');
    const lu = g.despacho.luigi;
    lu.spawnNearPlayer();
    const z = zombie(g.player.position.x + 3, g.player.position.z, 1000);
    g.zombies.active.push(z);
    lu.cfg = { ...L, yelpChance: 0 };
    for (let n = 0; n < 60 * 3; n++) g.despacho.update(1 / 60);
    expect(lu.mode).toBe(LUIGI_MODE.CHASE);
    expect(lu.bites).toBeGreaterThanOrEqual(2);
    expect(1000 - z.hp).toBe(lu.bites * L.damage[0]);
    expect(lu.bites).toBeLessThanOrEqual(Math.floor(3 / L.biteInterval) + 1);
    expect('hp' in lu).toBe(false); // no tiene vida: no se le puede matar
    // Nivel II: chaleco, más daño.
    g.despacho.buy('luigi');
    expect(lu.damage).toBe(L.damage[1]);
  });

  it('un manotazo solo le aparta con un gañido', () => {
    g.player.position = at(g, 40, 50);
    g.despacho.buy('luigi');
    const lu = g.despacho.luigi;
    lu.spawnNearPlayer();
    const z = zombie(g.player.position.x + 2, g.player.position.z, 1000);
    g.zombies.active.push(z);
    lu.cfg = { ...L, yelpChance: 1 };
    for (let n = 0; n < 60 * 2 && !lu.yelpT; n++) g.despacho.update(1 / 60);
    expect(lu.yelpT).toBeGreaterThan(0);
    expect(lu.active).toBe(true);
  });

  it('ignora a los zombis lejos de Carlos y vuelve si se aleja más de 8 m', () => {
    g.player.position = at(g, 40, 50);
    g.despacho.buy('luigi');
    const lu = g.despacho.luigi;
    lu.spawnNearPlayer();
    g.zombies.active.push(zombie(g.player.position.x + L.threatRange + 2, g.player.position.z));
    g.despacho.update(1 / 60);
    expect(lu.mode).toBe(LUIGI_MODE.FOLLOW);
    lu.pos.x = g.player.position.x - (L.leashRange + 1);
    g.despacho.update(1 / 60);
    expect(lu.mode).toBe(LUIGI_MODE.RETURN);
    // Muy lejos (encerrado): reaparece junto a Carlos.
    lu.pos.x = g.player.position.x - (L.teleportRange + 2);
    g.despacho.update(1 / 60);
    expect(Math.hypot(lu.pos.x - g.player.position.x, lu.pos.z - g.player.position.z)).toBeLessThan(L.followDist + 0.5);
  });

  it('se guarda con el despacho (setState) y desaparece al reiniciar; frases de tienda variadas', () => {
    g.player.position = at(g, 40, 50);
    g.despacho.setState({ luigi: 2 });
    expect(g.despacho.luigi.active).toBe(true);
    expect(g.despacho.luigi.level).toBe(2);
    g.despacho.reset();
    expect(g.despacho.luigi.active).toBe(false);
    expect(L.flavors.length).toBeGreaterThanOrEqual(5);
    expect(L.flavors).toContain(g.despacho.flavorOf('luigi'));
    expect(g.despacho.flavorOf('muros')).toBe(U.muros.flavor);
    const item = g.shop.catalog('despacho').find((i) => i.id === 'despacho:luigi');
    expect(item.section).toContain('Sala de descanso');
    expect(L.flavors).toContain(item.flavor);
  });
});
