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
} from '../src/systems/Despacho.js';

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
    zombies: { active: [], flowDirty: false, damage: noop, boss: null },
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
  it('los datos tienen precio, descripción por nivel y sección conocida', () => {
    const sections = despachoData.sections.map((s) => s.id);
    for (const id of UPGRADE_IDS) {
      const u = U[id];
      expect(sections).toContain(u.section);
      expect(u.prices.length).toBeGreaterThan(0);
      expect(u.desc.length).toBe(u.prices.length);
      expect(u.flavor).toBeTruthy();
      for (const p of u.prices) expect(p).toBeGreaterThanOrEqual(300);
    }
  });

  it('nextPrice: precio del siguiente nivel y 0 al máximo', () => {
    expect(nextPrice('persianas', 0)).toBe(U.persianas.prices[0]);
    expect(nextPrice('persianas', 2)).toBe(U.persianas.prices[2]);
    expect(nextPrice('persianas', maxLevel('persianas'))).toBe(0);
    expect(nextPrice('radar', 1)).toBe(0);
    expect(nextPrice('no_existe', 0)).toBe(0);
  });

  it('sanitizeLevels: descarta ids desconocidos y limita los niveles', () => {
    expect(sanitizeLevels({ persianas: 9, muros: 1.7, radar: -2, foo: 3, camaras: 'x' })).toEqual({ persianas: 3, muros: 1 });
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

  it('exteriorDoorGroups: los 3 accesos exteriores del edificio', () => {
    const grid = new NavGrid(map.rows, tiles, 1);
    const groups = exteriorDoorGroups(grid).map((g) => g.map((k) => [k % grid.w, (k / grid.w) | 0]));
    expect(groups).toHaveLength(3);
    expect(groups).toContainEqual([[38, 14], [39, 14]]);
    expect(groups).toContainEqual([[38, 35], [39, 35]]);
    expect(groups).toContainEqual([[55, 25], [55, 26]]);
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
    g.despacho.setState(JSON.parse(JSON.stringify({ muros: 2, radar: 1 })));
    expect(g.despacho.getState()).toEqual({ muros: 2, radar: 1 });
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

  it('persianas: se ponen al anochecer en los huecos libres y se retiran al amanecer', () => {
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
    expect(g.despacho.shutters).toHaveLength(2);
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
    // El refuerzo de muros no se suma a las persianas (tienen su propia mejora).
    const before = s0.maxHp;
    g.despacho.buy('muros');
    expect(s0.maxHp).toBe(before);
    // Nivel II: más vida a las que ya están puestas.
    g.despacho.buy('persianas');
    expect(s0.maxHp).toBe(pieceMaxHp(buildData.pieces.puerta, U.persianas.doorLevel, s0.n, 1, U.persianas.hpMul[1]));
    dawn(g);
    expect(g.despacho.shutters).toHaveLength(0);
    expect(b.all.has(s0)).toBe(false);
    expect([...b.all].filter((s) => s.type === 'puerta')).toHaveLength(1); // la del jugador sigue
  });

  it('persianas compradas de noche se ponen al momento; con alguien en medio quedan abiertas', () => {
    const groups = exteriorDoorGroups(g.grid);
    const k = groups[0][0];
    g.player.position = { x: g.grid.centerX(k % g.grid.w), z: g.grid.centerZ((k / g.grid.w) | 0) };
    g.dayNight.phase = PHASE.NIGHT;
    g.despacho.buy('persianas');
    expect(g.despacho.shutters).toHaveLength(3);
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
    it0.usedCycle = g.dayNight.night;
    g.bus.emit('interact', { type: 'alarma' });
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
    g.despacho.buy('botiquines');
    nightfall(g);
    expect(med.usedCycle).toBe(0);
  });

  it('radar y cámaras', () => {
    expect(g.despacho.has('camaras')).toBe(false);
    g.despacho.buy('camaras');
    expect(g.despacho.has('camaras')).toBe(true);
    g.despacho.buy('radar');
    nightfall(g);
    expect(g.toasts.some((t) => t.includes('norte'))).toBe(true);
  });

  it('tienda: catálogo por bloques, recargo nocturno y compra con puntos', () => {
    const items = g.shop.catalog('despacho');
    expect(items).toHaveLength(UPGRADE_IDS.length);
    const order = despachoData.sections.map((s) => s.name);
    const idx = items.map((i) => order.indexOf(i.section));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
    const pers = items.find((i) => i.id === 'despacho:persianas');
    expect(pers.price).toBe(U.persianas.prices[0]);
    expect(pers.name).toContain('☆☆☆');
    g.dayNight.phase = PHASE.NIGHT;
    const night = g.shop.catalog('despacho').find((i) => i.id === 'despacho:persianas');
    expect(night.price).toBe(Math.ceil(U.persianas.prices[0] * shopData.nightSurcharge));
    g.dayNight.phase = PHASE.DAY;
    g.shop.open = 'despacho';
    const before = g.run.points;
    expect(g.shop.buy('despacho:radar')).toBeTruthy();
    expect(g.run.points).toBe(before - U.radar.prices[0]);
    expect(g.despacho.level('radar')).toBe(1);
    expect(g.shop.whyNot('despacho:radar')).toBeTruthy(); // ya lo tienes
  });
});
