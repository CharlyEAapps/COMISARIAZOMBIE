import { describe, it, expect, beforeEach } from 'vitest';
import tiles from '../src/data/tiles.json';
import map from '../src/data/map.json';
import data from '../src/data/missions.json';
import zombies from '../src/data/zombies.json';
import humor from '../src/data/humor.json';
import interactions from '../src/data/interactions.json';
import { NavGrid } from '../src/systems/NavGrid.js';
import { EventBus } from '../src/core/EventBus.js';
import { PHASE } from '../src/systems/DayNight.js';
import { Score } from '../src/systems/Score.js';
import { InteractionSystem } from '../src/systems/InteractionSystem.js';
import { Missions, MISSION_IDS, isAvailable } from '../src/systems/Missions.js';
import { TYPES, sitePos, findDropoff, frontDoor } from '../src/systems/MissionTypes.js';
import {
  scaleParam, resolveParams, fillText, missionReward, forcedChance, pushOutOfRect, carBox, zombiesNear,
  insideBuilding, chooseSite, clock,
} from '../src/systems/missionUtils.js';
import { STATION } from '../src/systems/Station.js';

const M = data.missions;
const DT = 1 / 30;

// Juego mínimo con el mapa real, la puntuación y las interacciones reales (como despacho.test.js).
function makeGame(night = 3) {
  const grid = new NavGrid(map.rows, tiles, 1);
  const bus = new EventBus();
  const noop = () => {};
  const toasts = [], banners = [], floats = [], spawned = [];
  const start = grid.playerStart;
  const game = {
    grid, bus, time: 0, toasts, banners, floats, spawned,
    run: { points: 500, score: 0, kills: 0, nights: 0, killsByType: {} },
    power: { generator: true, lightsOn: true },
    dayNight: { phase: PHASE.DAY, night, t: 0, duration: 140 },
    player: { position: { x: grid.centerX(start.i), z: grid.centerZ(start.j) }, radius: 0.35, alive: true, hp: 100, maxHp: 100, facing: 0, aimDir: { x: 0, z: 1 } },
    zombies: {
      active: [],
      decoy: { x: 0, z: 0, timer: 0, radius: 0 },
      setDecoy(x, z, s, r) { Object.assign(this.decoy, { x, z, timer: s, radius: r }); },
    },
    waves: {
      total: 20, toSpawn: 20, activeSpawns: grid.spawns,
      spawnAt: (s, type) => { const z = { type }; spawned.push(z); return z; },
    },
    weapons: { owned: new Map([['pistola', { data: {} }]]) },
    build: { transformer: { hp: 700, maxHp: 700, flash: 0 } },
    hud: { toast: (t) => toasts.push(t), banner: (t, s) => banners.push([t, s]) },
    floating: { spawn: (...a) => floats.push(a) },
    effects: { burst: noop, shake: noop },
    despacho: { caseRewardMul: 1, emergencyOn: false },
  };
  game.score = new Score(game);
  game.interactions = new InteractionSystem(game);
  game.interactions.setAnchors([
    { id: 'cuadro_1', type: 'cuadro_electrico', x: grid.centerX(30), z: grid.centerZ(25) },
    { id: 'cuadro_2', type: 'cuadro_electrico', x: grid.centerX(50), z: grid.centerZ(25) },
    { id: 'pizarra_1', type: 'pizarra_casos', x: grid.centerX(30), z: grid.centerZ(16) },
  ]);
  // rnd determinista y configurable.
  game.rndValue = 0;
  game.missions = new Missions(game, () => game.rndValue);
  return game;
}

const zombie = (x, z, state = 0) => ({ state, pos: { x, z }, radius: 0.38, type: 'caminante' });
const nightfall = (g) => { g.dayNight.phase = PHASE.NIGHT; g.dayNight.t = 0; g.bus.emit('phase:noche', { night: g.dayNight.night, duration: 140 }); g.missions.update(DT); };
const step = (g, seconds) => { for (let t = 0; t < seconds; t += DT) { g.time += DT; g.dayNight.t += DT; g.missions.update(DT); } };
const dawn = (g) => {
  let summary = null;
  const off = g.bus.on('score:nightSummary', (s) => { summary = s; });
  g.bus.emit('night:survived', { night: g.dayNight.night });
  off();
  g.dayNight.phase = PHASE.DAWN;
  return summary;
};
const accept = (g, id, forced = false) => g.missions.accept(id, forced, g.dayNight.night);
const item = (g, id) => g.interactions.items.find((i) => i.id === id);
const use = (g, id) => { const it = item(g, id); g.interactions.execute(it); return it; };
const place = (g, x, z) => { g.player.position.x = x; g.player.position.z = z; };

describe('Misiones: funciones puras', () => {
  it('scaleParam: número fijo o [base, extra por noche, mín, máx]', () => {
    expect(scaleParam(5, 9)).toBe(5);
    expect(scaleParam([10, 2], 1)).toBe(10);
    expect(scaleParam([10, 2], 4)).toBe(16);
    expect(scaleParam([130, -3, 80], 30)).toBe(80);
    expect(scaleParam([1, 1, 3, 8], 1)).toBe(3);
    expect(scaleParam([1, 1, 3, 8], 50)).toBe(8);
  });

  it('resolveParams, fillText y missionReward', () => {
    expect(resolveParams({ a: [2, 1], b: 7 }, 3)).toEqual({ a: 4, b: 7 });
    expect(fillText('a {x} b {y}', { x: 3 })).toBe('a 3 b {y}');
    expect(missionReward({ reward: [200, 25] }, 3, 1)).toBe(250);
    expect(missionReward({ reward: [200, 25] }, 3, 1.5)).toBe(375);
  });

  it('forcedChance: sube con las noches, tiene tope y se garantiza tras unas noches sin evento', () => {
    const f = data.forced;
    expect(forcedChance(f, f.fromNight - 1, 0)).toBe(0);
    expect(forcedChance(f, f.fromNight, 0)).toBeCloseTo(f.chance);
    expect(forcedChance(f, f.fromNight + 5, 0)).toBeCloseTo(f.chance + f.chancePerNight * 5);
    expect(forcedChance(f, 500, 0)).toBe(f.maxChance);
    expect(forcedChance(f, 5, f.pityNights)).toBe(1);
  });

  it('pushOutOfRect saca al círculo de la caja, también si su centro está dentro', () => {
    const p = { x: 2.1, z: 0 };
    expect(pushOutOfRect(p, 0.35, -2, -1, 2, 1)).toBe(true);
    expect(p.x).toBeCloseTo(2.35);
    const q = { x: 1.9, z: 0 };
    pushOutOfRect(q, 0.35, -2, -1, 2, 1);
    expect(q.x).toBeGreaterThanOrEqual(2.35 - 1e-9);
    expect(pushOutOfRect({ x: 5, z: 5 }, 0.35, -2, -1, 2, 1)).toBe(false);
    expect(carBox(10, 20, false)).toEqual([8, 19.05, 12, 20.95]);
  });

  it('zombiesNear cuenta solo vivos dentro del radio y respeta el tope; clock formatea', () => {
    const list = [zombie(0, 0), zombie(1, 0), zombie(1, 1, 1), zombie(10, 0)];
    expect(zombiesNear(list, 0, 0, 2)).toBe(2);
    expect(zombiesNear(list, 0, 0, 2, 1)).toBe(1);
    expect(clock(75)).toBe('1:15');
    expect(clock(-3)).toBe('0:00');
  });

  it('chooseSite prefiere sitios lejos del jugador y descarta los no válidos', () => {
    const sites = [[0, 0], [50, 0], [100, 0]];
    const pos = (s) => ({ x: s[0], z: s[1] });
    expect(chooseSite(sites, pos, null, 0, 0, 40, () => 0)).toEqual([50, 0]);
    expect(chooseSite(sites, pos, (s) => s[0] < 60, 0, 0, 200, () => 0)).toEqual([50, 0]);
  });
});

describe('Misiones: datos (missions.json)', () => {
  it('hay al menos 8 misiones, todas con comportamiento y datos completos', () => {
    expect(MISSION_IDS.length).toBeGreaterThanOrEqual(8);
    for (const id of MISSION_IDS) {
      const d = M[id];
      expect(TYPES[id], id).toBeTruthy();
      expect(['optional', 'forced', 'both']).toContain(d.mode);
      expect(d.icon && d.name && d.short && d.text, id).toBeTruthy();
      expect(d.reward[0], id).toBeGreaterThan(0);
      expect(d.w, id).toBeGreaterThan(0);
      for (const k of ['start', 'success', 'fail']) expect(d[k]?.length, `${id}.${k}`).toBeGreaterThan(0);
      if (d.mode !== 'optional') expect(d.forcedIntro, id).toBeTruthy();
      for (const c of d.conflicts ?? []) expect(M[c]?.conflicts ?? [], `${id}↔${c}`).toContain(id);
    }
    expect(MISSION_IDS.filter((id) => M[id].mode !== 'optional').length).toBeGreaterThanOrEqual(3); // forzadas
    expect(MISSION_IDS.filter((id) => M[id].mode !== 'forced').length).toBeGreaterThanOrEqual(4);   // de la pizarra
  });

  it('los textos no dejan {huecos} sin rellenar con los parámetros de cualquier noche', () => {
    for (const id of MISSION_IDS) {
      for (const night of [1, 3, 8, 30]) {
        const text = fillText(M[id].text, resolveParams(M[id].params, night));
        expect(text, `${id} noche ${night}`).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it('las interacciones mision_* existen y apuntan a una acción de misión', () => {
    for (const k of ['mision_fusibles', 'mision_caja', 'mision_entrega', 'mision_gato', 'mision_coche']) {
      expect(interactions[k].label, k).toBeTruthy();
      expect(interactions[k].effect.mission, k).toBeTruthy();
    }
  });

  it('los sitios de caja, gato y coche son transitables; los del concejal están dentro del mapa', () => {
    const grid = new NavGrid(map.rows, tiles, 1);
    const walk = (p) => grid.isWalkable(grid.cellX(p.x), grid.cellZ(p.z));
    for (const id of ['pruebas', 'gato']) for (const s of M[id].sites) expect(walk(sitePos(grid, s)), `${id} ${s}`).toBe(true);
    for (const s of M.patrulla.sites) {
      const p = sitePos(grid, s);
      const [x0, z0, x1, z1] = carBox(p.x, p.z, s.rot === 90);
      for (let x = x0 + 0.1; x < x1; x += 1) for (let z = z0 + 0.1; z < z1; z += 1) expect(walk({ x, z }), `coche ${s.x},${s.z}`).toBe(true);
    }
    for (const s of M.concejal.sites) {
      const p = sitePos(grid, s);
      expect(grid.walkableCellAt(p.x, p.z), `concejal ${s.x},${s.z}`).toBeGreaterThanOrEqual(0);
    }
  });

  it('el punto de entrega junto al almacén y la puerta principal son válidos', () => {
    const grid = new NavGrid(map.rows, tiles, 1);
    const d = findDropoff(grid, M.pruebas.params.deliverOffset);
    expect(grid.isWalkable(grid.cellX(d.x), grid.cellZ(d.z))).toBe(true);
    const w = grid.shops.almacen[0];
    expect(Math.hypot(d.x - grid.centerX(w.i), d.z - grid.centerZ(w.j))).toBeLessThan(2.5);
    const door = frontDoor(grid);
    expect(insideBuilding(grid, STATION.building, door.x, door.z - 3)).toBe(true);
    expect(insideBuilding(grid, STATION.building, door.x, door.z + 3)).toBe(false);
  });

  it('el pelotón existe como zombi (con frases al caer) y no es un jefe', () => {
    const t = zombies[M.antidisturbios.type];
    expect(t).toBeTruthy();
    expect(t.boss).toBeFalsy();
    expect(t.shield).toBeTruthy();
    expect(humor.quips[M.antidisturbios.type].length).toBeGreaterThan(0);
  });

  it('las recompensas son comparables a los casos clásicos y las difíciles pagan más', () => {
    for (const id of MISSION_IDS) {
      expect(M[id].reward[0], id).toBeGreaterThanOrEqual(150);
      expect(M[id].reward[0], id).toBeLessThanOrEqual(400);
    }
    expect(M.solo_porra.reward[0]).toBeGreaterThan(M.pruebas.reward[0]);
  });
});

describe('Pizarra y eventos forzados', () => {
  let g;
  beforeEach(() => { g = makeGame(3); });

  it('con el azar al principio sale un caso clásico (contador); con el azar al final, una misión', () => {
    g.rndValue = 0;
    const msg = g.missions.offerCase(3);
    expect(msg).toContain('Caso aceptado');
    expect(g.score.objective).toBeTruthy();
    expect(g.missions.list).toHaveLength(0);
    g.rndValue = 0.999;
    const msg2 = g.missions.offerCase(3);
    expect(g.missions.list).toHaveLength(1);
    expect(g.score.objective).toBeNull();
    expect(msg2).toContain(g.missions.list[0].text);
  });

  it('la interacción de la pizarra ofrece el caso a través del gestor', () => {
    g.dayNight.phase = PHASE.DAY;
    g.rndValue = 0.999;
    const it = item(g, 'pizarra_1');
    it.def.hold = 0;
    g.interactions.execute(it);
    expect(g.missions.list).toHaveLength(1);
    expect(g.toasts.at(-1)).toContain('+');
  });

  it('solo se ofrecen las misiones de su noche, de su modo y con sus requisitos', () => {
    expect(isAvailable(g, 'apagon', 'optional', 1)).toBe(false);          // desde la noche 2
    expect(isAvailable(g, 'apagon', 'optional', 2)).toBe(true);
    expect(isAvailable(g, 'niebla', 'optional', 5)).toBe(false);           // solo forzada
    expect(isAvailable(g, 'niebla', 'forced', 5)).toBe(true);
    expect(isAvailable(g, 'pruebas', 'forced', 5)).toBe(false);            // solo de la pizarra
    expect(isAvailable(g, 'solo_porra', 'optional', 5)).toBe(false);       // sin arma cuerpo a cuerpo
    g.weapons.owned.set('porra', { data: { melee: true } });
    expect(isAvailable(g, 'solo_porra', 'optional', 5)).toBe(true);
    expect(isAvailable(g, 'apagon', 'optional', 5, ['apagon'])).toBe(false); // ya activa
    expect(isAvailable(g, 'niebla', 'forced', 5, ['apagon'])).toBe(false);   // incompatibles
  });

  it('el evento forzado llega al atardecer, no antes de su noche, y se anuncia', () => {
    g.rndValue = 0;
    g.missions.onDusk(1);
    expect(g.missions.slots.event).toBeNull();
    g.missions.onDusk(3);
    const ev = g.missions.slots.event;
    expect(ev).toBeTruthy();
    expect(ev.forced).toBe(true);
    expect(M[ev.id].mode).not.toBe('optional');
    expect(g.toasts.at(-1)).toContain(M[ev.id].name);
    g.missions.update(data.forced.announceDelay + 0.1);
    expect(g.banners.at(-1)[0]).toContain(M[ev.id].name.toUpperCase());
  });

  it('con mala suerte no hay evento, salvo que lleve varias noches sin haberlo', () => {
    g.rndValue = 0.99;
    g.missions.lastForcedNight = 3 - data.forced.pityNights + 1;
    g.missions.onDusk(3);
    expect(g.missions.slots.event).toBeNull();
    g.missions.lastForcedNight = 3 - data.forced.pityNights;
    g.missions.onDusk(3);
    expect(g.missions.slots.event).toBeTruthy();
  });

  it('el archivo ordenado sube la recompensa de las misiones', () => {
    const base = accept(g, 'pruebas').reward;
    g.despacho.caseRewardMul = 1.5;
    expect(accept(g, 'pruebas').reward).toBe(Math.round(base * 1.5));
  });

  it('un caso aceptado y un evento forzado conviven; el resumen del amanecer suma las dos recompensas', () => {
    const a = accept(g, 'pruebas');
    const b = accept(g, 'hacienda', true);
    nightfall(g);
    place(g, item(g, 'mision_caja').x, item(g, 'mision_caja').z);
    use(g, 'mision_caja');
    place(g, item(g, 'mision_entrega').x, item(g, 'mision_entrega').z);
    use(g, 'mision_entrega');
    const before = g.run.points;
    const solved = [];
    g.bus.on('case:solved', (e) => solved.push(e.id));
    const summary = dawn(g);
    expect(solved.sort()).toEqual(['hacienda', 'pruebas']);
    expect(summary.lines.filter((l) => l.includes('+')).length).toBeGreaterThanOrEqual(3);
    expect(g.run.points - before).toBe(g.score.cfg.nightBonusBase * 3 + g.score.cfg.noDamageBonusBase * 3 + a.reward + b.reward);
    expect(g.missions.list).toHaveLength(0);
    expect(g.missions.entities).toHaveLength(0);
  });
});

describe('Misión: Apagón programado', () => {
  let g;
  beforeEach(() => { g = makeGame(3); });

  it('inicio: la noche empieza sin luz y un cuadro eléctrico pasa a ser la caja de fusibles', () => {
    const m = accept(g, 'apagon', true);
    nightfall(g);
    expect(m.status).toBe('active');
    expect(g.build.transformer.hp).toBe(0);
    expect(g.power.generator).toBe(false);
    expect(g.missions.fx.blackout).toBe(true);
    const panel = m.s.panel;
    expect(panel.def.label).toBe(interactions.mision_fusibles.label);
    expect(panel.def.hold).toBe(m.p.fuseHold);
    expect(g.missions.targets()[0].x).toBe(panel.x);
  });

  it('cumplimiento: cambiar los fusibles devuelve la luz y paga al amanecer', () => {
    const m = accept(g, 'apagon', true);
    nightfall(g);
    const panel = m.s.panel;
    g.interactions.execute(panel);
    expect(g.build.transformer.hp).toBeGreaterThan(0);
    step(g, 0.1);
    expect(m.status).toBe('success');
    expect(g.missions.fx.blackout).toBe(false);
    expect(panel.def.label).not.toBe(interactions.mision_fusibles.label); // cuadro restaurado
    const before = g.run.points;
    const s = dawn(g);
    expect(s.lines.some((l) => l.includes('Apagón') && l.includes(`+${m.reward}`))).toBe(true);
    expect(g.run.points - before).toBeGreaterThanOrEqual(m.reward);
  });

  it('fracaso: se acaba el plazo sin reparar', () => {
    const m = accept(g, 'apagon', true);
    nightfall(g);
    step(g, m.p.deadline + 1);
    expect(m.status).toBe('failed');
    expect(g.missions.fx.blackout).toBe(false);
    const s = dawn(g);
    expect(s.lines.some((l) => l.includes('Apagón') && l.includes('fallida'))).toBe(true);
  });

  it('repararlo por otro medio (transformador) también cuenta', () => {
    const m = accept(g, 'apagon', false);
    nightfall(g);
    g.build.transformer.hp = g.build.transformer.maxHp;
    step(g, 0.1);
    expect(m.status).toBe('success');
  });
});

describe('Misión: El concejal en apuros', () => {
  let g;
  beforeEach(() => { g = makeGame(3); });

  it('inicio: aparece el concejal con vida y atrae a los zombis', () => {
    const m = accept(g, 'concejal', true);
    nightfall(g);
    const e = m.s.e;
    expect(e.kind).toBe('concejal');
    expect(e.hp).toBe(m.p.hp);
    expect(g.missions.entities).toContain(e);
    g.missions.updateLures(10);
    expect(g.zombies.decoy.timer).toBeGreaterThan(0);
    expect(g.missions.ownsDecoy()).toBe(true);
    expect(Math.hypot(g.zombies.decoy.x - e.x, g.zombies.decoy.z - e.z)).toBeLessThan(3);
  });

  it('cumplimiento: sobrevive hasta el amanecer', () => {
    const m = accept(g, 'concejal', true);
    nightfall(g);
    const e = m.s.e;
    g.zombies.active.push(zombie(e.x + 5, e.z));
    step(g, 20);
    expect(e.hp).toBe(e.maxHp);
    const before = g.run.points;
    dawn(g);
    expect(g.run.points - before).toBeGreaterThanOrEqual(m.reward);
  });

  it('fracaso: los zombis lo alcanzan y muere', () => {
    const m = accept(g, 'concejal', true);
    nightfall(g);
    const e = m.s.e;
    for (let i = 0; i < 6; i++) g.zombies.active.push(zombie(e.x + 1, e.z + i * 0.1));
    step(g, m.p.hp / (m.p.maxAttackers * m.p.dpsPerZombie) + 2);
    expect(m.status).toBe('failed');
    expect(g.missions.entities).toHaveLength(0);
    const s = dawn(g);
    expect(s.lines.some((l) => l.includes('fallida'))).toBe(true);
  });

  it('los zombis muertos no le hacen daño', () => {
    const m = accept(g, 'concejal', true);
    nightfall(g);
    const e = m.s.e;
    g.zombies.active.push(zombie(e.x + 1, e.z, 1));
    step(g, 5);
    expect(e.hp).toBe(e.maxHp);
  });
});

describe('Misión: Recuperar las pruebas', () => {
  let g;
  beforeEach(() => { g = makeGame(2); });

  it('inicio: la caja aparece lejos en el parking y hay punto de recogida y de entrega', () => {
    const m = accept(g, 'pruebas');
    nightfall(g);
    const b = m.s.box;
    expect(b.state).toBe('ground');
    expect(g.grid.cellZ(b.z)).toBeGreaterThanOrEqual(38); // parking
    expect(Math.hypot(b.x - g.player.position.x, b.z - g.player.position.z)).toBeGreaterThanOrEqual(data.common.minSpawnDistance);
    expect(item(g, 'mision_caja')).toBeTruthy();
    expect(item(g, 'mision_entrega')).toBeTruthy();
  });

  it('no se puede entregar sin llevar la caja', () => {
    accept(g, 'pruebas');
    nightfall(g);
    expect(g.interactions.availability(item(g, 'mision_entrega')).ok).toBe(false);
    expect(g.interactions.availability(item(g, 'mision_caja')).ok).toBe(true);
  });

  it('cumplimiento: recoger la caja y entregarla en el almacén', () => {
    const m = accept(g, 'pruebas');
    nightfall(g);
    const caja = item(g, 'mision_caja');
    place(g, caja.x, caja.z);
    use(g, 'mision_caja');
    expect(m.s.box.state).toBe('carried');
    expect(item(g, 'mision_caja')).toBeUndefined();
    step(g, 0.1);
    expect(Math.hypot(m.s.box.x - g.player.position.x, m.s.box.z - g.player.position.z)).toBeLessThan(1.5); // la lleva encima
    expect(g.interactions.availability(item(g, 'mision_entrega')).ok).toBe(true);
    const drop = item(g, 'mision_entrega');
    place(g, drop.x, drop.z);
    use(g, 'mision_entrega');
    expect(m.status).toBe('success');
    expect(m.s.box.state).toBe('delivered');
    const s = dawn(g);
    expect(s.lines.some((l) => l.includes('Recuperar las pruebas') && l.includes(`+${m.reward}`))).toBe(true);
  });

  it('un golpe fuerte la suelta; uno leve no', () => {
    const m = accept(g, 'pruebas');
    nightfall(g);
    const caja = item(g, 'mision_caja');
    place(g, caja.x, caja.z);
    use(g, 'mision_caja');
    g.bus.emit('player:hurt', { amount: m.p.dropDamage - 1, hp: 90 });
    expect(m.s.box.state).toBe('carried');
    g.bus.emit('player:hurt', { amount: m.p.dropDamage, hp: 80 });
    expect(m.s.box.state).toBe('ground');
    expect(item(g, 'mision_caja')).toBeTruthy();
  });

  it('fracaso: sin entregarla al amanecer', () => {
    const m = accept(g, 'pruebas');
    nightfall(g);
    step(g, 5);
    const s = dawn(g);
    expect(s.lines.some((l) => l.includes('Recuperar las pruebas') && l.includes('fallida'))).toBe(true);
    expect(m.status).toBe('active');
    expect(item(g, 'mision_caja')).toBeUndefined(); // se limpia
  });
});

describe('Misión: Noche de niebla', () => {
  let g;
  beforeEach(() => { g = makeGame(3); });

  it('inicio: la niebla se activa para toda la noche', () => {
    const m = accept(g, 'niebla', true);
    expect(g.missions.fx.fog).toBeNull();
    nightfall(g);
    expect(g.missions.fx.fog).toBe(m.p);
    expect(m.p.farMul).toBeLessThan(2);
  });

  it('cumplimiento: acaba la noche con vida suficiente', () => {
    const m = accept(g, 'niebla', true);
    nightfall(g);
    g.player.hp = 60;
    const s = dawn(g);
    expect(s.lines.some((l) => l.includes('niebla') && l.includes(`+${m.reward}`))).toBe(true);
    expect(g.missions.fx.fog).toBeNull();
  });

  it('fracaso: acaba la noche por debajo del mínimo de vida', () => {
    accept(g, 'niebla', true);
    nightfall(g);
    g.player.hp = 30;
    const s = dawn(g);
    expect(s.lines.some((l) => l.includes('niebla') && l.includes('fallida'))).toBe(true);
  });
});

describe('Misión: Solo porra', () => {
  let g;
  beforeEach(() => { g = makeGame(3); g.weapons.owned.set('porra', { data: { melee: true } }); });

  it('inicio: calcula las bajas necesarias de la horda de la noche', () => {
    const m = accept(g, 'solo_porra');
    nightfall(g);
    expect(m.s.need).toBe(Math.ceil((20 * m.p.killPct) / 100));
  });

  it('cumplimiento: sin disparos y con suficientes bajas', () => {
    const m = accept(g, 'solo_porra');
    nightfall(g);
    g.bus.emit('weapon:melee', { hits: 2, id: 'porra' });
    g.score.nightStats.kills = m.s.need;
    const s = dawn(g);
    expect(s.lines.some((l) => l.includes('Solo porra') && l.includes(`+${m.reward}`))).toBe(true);
  });

  it('fracaso: un disparo o una granada la rompen al instante', () => {
    const m = accept(g, 'solo_porra');
    nightfall(g);
    g.bus.emit('weapon:fired', { id: 'pistola' });
    expect(m.status).toBe('failed');
    const g2 = makeGame(3);
    g2.weapons.owned.set('porra', { data: { melee: true } });
    const m2 = accept(g2, 'solo_porra');
    nightfall(g2);
    g2.bus.emit('grenade:thrown');
    expect(m2.status).toBe('failed');
  });

  it('fracaso: sin disparar pero sin abatir a suficientes', () => {
    accept(g, 'solo_porra');
    nightfall(g);
    g.score.nightStats.kills = 1;
    const s = dawn(g);
    expect(s.lines.some((l) => l.includes('Solo porra') && l.includes('fallida'))).toBe(true);
  });
});

describe('Misión: Proteger el coche patrulla', () => {
  let g;
  beforeEach(() => { g = makeGame(3); });

  it('inicio: aparece el coche con vida, sólido para el jugador y con cinta americana', () => {
    const m = accept(g, 'patrulla', true);
    nightfall(g);
    const e = m.s.e;
    expect(e.kind).toBe('car');
    expect(e.hp).toBe(m.p.hp);
    place(g, e.x + 0.5, e.z);
    g.missions.update(DT);
    const [x0, z0, x1, z1] = carBox(e.x, e.z, false);
    const p = g.player.position;
    expect(p.x < x0 - 0.3 || p.x > x1 + 0.3 || p.z < z0 - 0.3 || p.z > z1 + 0.3).toBe(true); // sacado del coche
    expect(item(g, 'mision_coche')).toBeTruthy();
  });

  it('cumplimiento: el coche aguanta hasta el amanecer, y se puede remendar', () => {
    const m = accept(g, 'patrulla', true);
    nightfall(g);
    const e = m.s.e;
    g.zombies.active.push(zombie(e.x + 2, e.z), zombie(e.x - 2, e.z));
    step(g, 10);
    const hurt = e.hp;
    expect(hurt).toBeLessThan(e.maxHp);
    g.zombies.active.length = 0;
    expect(g.interactions.availability(item(g, 'mision_coche')).ok).toBe(true);
    use(g, 'mision_coche');
    expect(e.hp).toBeCloseTo(Math.min(e.maxHp, hurt + e.maxHp * m.p.repairHeal));
    expect(m.s.repairs).toBe(m.p.repairs - 1);
    const s = dawn(g);
    expect(s.lines.some((l) => l.includes('coche patrulla') && l.includes(`+${m.reward}`))).toBe(true);
  });

  it('fracaso: los zombis lo destrozan', () => {
    const m = accept(g, 'patrulla', true);
    nightfall(g);
    const e = m.s.e;
    for (let i = 0; i < 8; i++) g.zombies.active.push(zombie(e.x + (i % 4) - 1.5, e.z));
    step(g, m.p.hp / (m.p.maxAttackers * m.p.dpsPerZombie) + 2);
    expect(m.status).toBe('failed');
    expect(item(g, 'mision_coche')).toBeUndefined(); // el remiendo desaparece con el coche
    const s = dawn(g);
    expect(s.lines.some((l) => l.includes('coche patrulla') && l.includes('fallida'))).toBe(true);
  });
});

describe('Misión: El gato del comisario', () => {
  let g;
  beforeEach(() => { g = makeGame(2); });

  it('inicio: el gato anda suelto por el parking y se puede atrapar', () => {
    const m = accept(g, 'gato');
    nightfall(g);
    const c = m.s.cat;
    expect(c.state).toBe('loose');
    expect(g.grid.cellZ(c.z)).toBeGreaterThanOrEqual(38);
    step(g, 6);
    expect(g.grid.isWalkable(g.grid.cellX(c.x), g.grid.cellZ(c.z))).toBe(true);
    expect(g.interactions.availability(item(g, 'mision_gato')).ok).toBe(true);
  });

  it('huye de los zombis cercanos', () => {
    const m = accept(g, 'gato');
    nightfall(g);
    const c = m.s.cat;
    const z = zombie(c.x - 3, c.z);
    g.zombies.active.push(z);
    const d0 = Math.hypot(c.x - z.pos.x, c.z - z.pos.z);
    step(g, 0.6);
    expect(Math.hypot(c.x - z.pos.x, c.z - z.pos.z)).toBeGreaterThan(d0);
  });

  it('cumplimiento: atraparlo y llevarlo dentro de la comisaría', () => {
    const m = accept(g, 'gato');
    nightfall(g);
    const c = m.s.cat;
    place(g, c.x, c.z);
    use(g, 'mision_gato');
    expect(c.state).toBe('carried');
    expect(c.lure).toBeNull();
    step(g, 0.1);
    expect(m.status).toBe('active');
    const door = frontDoor(g.grid);
    place(g, door.x, door.z - 3);
    step(g, 0.1);
    expect(m.status).toBe('success');
    expect(c.state).toBe('safe');
    const s = dawn(g);
    expect(s.lines.some((l) => l.includes('gato') && l.includes(`+${m.reward}`))).toBe(true);
  });

  it('fracaso: los zombis lo alcanzan', () => {
    const m = accept(g, 'gato');
    nightfall(g);
    const c = m.s.cat;
    for (let i = 0; i < 4; i++) g.zombies.active.push(zombie(c.x, c.z));
    step(g, 3);
    expect(m.status).toBe('failed');
    expect(c.state).toBe('dead');
    expect(g.missions.entities).toHaveLength(0);
  });

  it('fracaso: sin ponerlo a salvo al amanecer', () => {
    accept(g, 'gato');
    nightfall(g);
    step(g, 2);
    const s = dawn(g);
    expect(s.lines.some((l) => l.includes('gato') && l.includes('fallida'))).toBe(true);
  });
});

describe('Misión: Inspección de Hacienda', () => {
  let g;
  beforeEach(() => { g = makeGame(3); });

  it('inicio: nada más empezar no hay gasto detectado', () => {
    const m = accept(g, 'hacienda', true);
    nightfall(g);
    step(g, 1);
    expect(m.status).toBe('active');
  });

  it('cumplimiento: cobrar puntos (bajas) no es gastar', () => {
    const m = accept(g, 'hacienda', true);
    nightfall(g);
    g.score.addPoints(120);
    step(g, 0.1);
    g.score.addPoints(80);
    step(g, 0.1);
    expect(m.status).toBe('active');
    const before = g.run.points;
    const s = dawn(g);
    expect(s.lines.some((l) => l.includes('Hacienda') && l.includes(`+${m.reward}`))).toBe(true);
    expect(g.run.points).toBeGreaterThan(before);
  });

  it('fracaso: gastar un punto la hace fracasar, y el evento forzado cobra multa', () => {
    const m = accept(g, 'hacienda', true);
    nightfall(g);
    g.run.points -= 40; // comprar algo
    step(g, 0.1);
    expect(m.status).toBe('failed');
    const pts = g.run.points;
    const fine = Math.min(m.p.fineMax, Math.round((pts * m.p.finePct) / 100));
    const s = dawn(g);
    expect(s.lines.some((l) => l.includes('Hacienda') && l.includes(`−${fine}`))).toBe(true);
  });

  it('un gasto y un cobro en el mismo paso se detectan igualmente', () => {
    const m = accept(g, 'hacienda', false);
    nightfall(g);
    g.run.points -= 50;
    g.score.addPoints(70);
    step(g, 0.1);
    expect(m.status).toBe('failed');
  });

  it('la misión de la pizarra (no forzada) no cobra multa', () => {
    accept(g, 'hacienda', false);
    nightfall(g);
    g.run.points -= 40;
    step(g, 0.1);
    const s = dawn(g);
    expect(s.lines.some((l) => l.includes('Hacienda') && l.includes('−'))).toBe(false);
  });
});

describe('Misión: Horda de antidisturbios', () => {
  let g;
  beforeEach(() => { g = makeGame(5); });

  it('inicio: el pelotón llega tras unos segundos, con más agentes en noches avanzadas', () => {
    const m = accept(g, 'antidisturbios', true);
    expect(m.p.count).toBe(5);
    nightfall(g);
    step(g, m.p.delay - 1);
    expect(g.spawned).toHaveLength(0);
    step(g, 2);
    expect(g.spawned).toHaveLength(m.p.count);
    expect(g.spawned.every((z) => z.type === 'agente_antidisturbios')).toBe(true);
    expect(resolveParams(M.antidisturbios.params, 30).count).toBe(8);
  });

  it('cumplimiento: abatir a todo el pelotón', () => {
    const m = accept(g, 'antidisturbios', true);
    nightfall(g);
    step(g, m.p.delay + 1);
    for (let i = 0; i < m.s.total; i++) g.bus.emit('zombie:killed', { type: 'agente_antidisturbios' });
    g.bus.emit('zombie:killed', { type: 'caminante' }); // otros zombis no cuentan
    step(g, 0.1);
    expect(m.status).toBe('success');
    const s = dawn(g);
    expect(s.lines.some((l) => l.includes('antidisturbios') && l.includes(`+${m.reward}`))).toBe(true);
  });

  it('fracaso: se acaba el plazo con agentes en pie', () => {
    const m = accept(g, 'antidisturbios', true);
    nightfall(g);
    step(g, m.p.delay + 1);
    g.bus.emit('zombie:killed', { type: 'agente_antidisturbios' });
    step(g, m.p.timeLimit + 1);
    expect(m.status).toBe('failed');
  });
});

describe('Misión: Horas extra', () => {
  let g;
  beforeEach(() => { g = makeGame(4); });

  it('inicio: más zombis esta noche y las bajas se pagan más', () => {
    const m = accept(g, 'horas_extra', true);
    g.waves.total = 30; g.waves.toSpawn = 30;
    nightfall(g);
    expect(g.waves.total).toBe(30 + Math.round((30 * m.p.extraPct) / 100));
    expect(g.waves.toSpawn).toBe(g.waves.total);
    expect(g.missions.fx.killPointsMul).toBe(m.p.killPointsMul);
    const before = g.run.points;
    g.bus.emit('zombie:killed', { type: 'caminante', points: 10, x: 0, z: 0 });
    expect(g.run.points - before).toBe(Math.round(10 * m.p.killPointsMul));
  });

  it('cumplimiento: la noche acaba dentro del reloj', () => {
    const m = accept(g, 'horas_extra', true);
    nightfall(g);
    step(g, 30);
    const s = dawn(g);
    expect(s.lines.some((l) => l.includes('Horas extra') && l.includes(`+${m.reward}`))).toBe(true);
  });

  it('fracaso: se pasa de hora y se pierde el pago extra de las bajas', () => {
    const m = accept(g, 'horas_extra', true);
    nightfall(g);
    g.dayNight.t = g.dayNight.duration + m.p.graceSeconds + 1;
    step(g, 0.1);
    expect(m.status).toBe('failed');
    expect(g.missions.fx.killPointsMul).toBe(1);
    const s = dawn(g);
    expect(s.lines.some((l) => l.includes('Horas extra') && l.includes('fallida'))).toBe(true);
  });
});

describe('HUD de misiones', () => {
  it('enseña el caso clásico y las misiones con su estado en vivo', () => {
    const g = makeGame(3);
    g.score.pickObjective(3);
    accept(g, 'pruebas');
    accept(g, 'hacienda', true);
    let lines = g.missions.hudLines();
    expect(lines).toHaveLength(3);
    expect(lines.every((l) => l.icon && l.name && l.short && l.reward > 0)).toBe(true);
    nightfall(g);
    lines = g.missions.hudLines();
    expect(lines.find((l) => l.key === 'm:pruebas').short).toContain('Busca la caja');
    expect(lines.find((l) => l.key === 'm:hacienda').short).toContain('No gastes');
    g.run.points -= 10;
    step(g, 0.1);
    expect(g.missions.hudLines().find((l) => l.key === 'm:hacienda').state).toBe('bad');
  });

  it('las flechas apuntan a lo que hay que buscar o llevar', () => {
    const g = makeGame(2);
    accept(g, 'pruebas');
    nightfall(g);
    const t = g.missions.targets();
    expect(t).toHaveLength(1);
    expect(t[0].icon).toBe('📦');
    const caja = item(g, 'mision_caja');
    expect(t[0].x).toBe(caja.x);
    place(g, caja.x, caja.z);
    use(g, 'mision_caja');
    const drop = item(g, 'mision_entrega');
    expect(g.missions.targets()[0].x).toBe(drop.x);
  });
});

describe('Ciclo de vida', () => {
  it('reset deja el juego limpio: interacciones, entidades y efectos', () => {
    const g = makeGame(3);
    const panelBefore = g.interactions.items.find((i) => i.type === 'cuadro_electrico').def;
    accept(g, 'apagon', true);
    accept(g, 'pruebas');
    nightfall(g);
    expect(g.missions.entities.length).toBeGreaterThan(0);
    g.missions.reset();
    expect(g.missions.list).toHaveLength(0);
    expect(g.missions.entities).toHaveLength(0);
    expect(g.missions.fx.blackout).toBe(false);
    expect(item(g, 'mision_caja')).toBeUndefined();
    expect(g.interactions.items.find((i) => i.type === 'cuadro_electrico').def).toBe(panelBefore);
  });

  it('al empezar el día siguiente se descarta cualquier resto', () => {
    const g = makeGame(3);
    accept(g, 'niebla', true);
    nightfall(g);
    g.bus.emit('phase:dia', { night: 4 });
    expect(g.missions.list).toHaveLength(0);
    expect(g.missions.fx.fog).toBeNull();
  });

  it('una misión aceptada no arranca hasta que cae la noche', () => {
    const g = makeGame(3);
    const m = accept(g, 'pruebas');
    g.missions.update(DT);
    expect(m.status).toBe('accepted');
    expect(g.missions.entities).toHaveLength(0);
  });
});
