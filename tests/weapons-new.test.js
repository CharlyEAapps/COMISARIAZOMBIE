import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import weapons from '../src/data/weapons.json';
import config from '../src/data/config.json';
import tiles from '../src/data/tiles.json';
import { EventBus } from '../src/core/EventBus.js';
import { NavGrid } from '../src/systems/NavGrid.js';
import {
  WeaponSystem, WEAPON_IDS, weaponStats, upgradeCost, heatAfterShot, heatStep, inArc, inCone, assistParams,
} from '../src/systems/WeaponSystem.js';
import { Burning, burnColor } from '../src/systems/Burning.js';
import { weaponGeometry, weaponGlowGeometry, WEAPON_SPECS } from '../src/render/WeaponModels.js';
import { RECIPES } from '../src/audio/Synth.js';
import audio from '../src/data/audio.json';

const DT = 1 / 60;
const rad = THREE.MathUtils.degToRad;

// ---------------------------------------------------------------------------------- juego mínimo
const ROWS = Array.from({ length: 40 }, () => ' '.repeat(40));

function mkZombie(id, x, z, extra = {}) {
  return {
    id, active: true, state: 0, pos: { x, z }, radius: 0.4, scale: 1, hp: 100, maxHp: 100,
    data: {}, colors: [new THREE.Color(0x889977), new THREE.Color(0x445566)], ...extra,
  };
}

/** Juego con la parte justa para WeaponSystem: bus real, rejilla abierta, entrada y zombis simulados. */
function makeGame() {
  const held = new Set(), pressed = new Set();
  const game = {
    bus: new EventBus(), time: 0,
    grid: new NavGrid(ROWS, tiles, 1),
    input: {
      analog: false,
      isHeld: (a) => held.has(a),
      consume: (a) => (pressed.delete(a) ? true : false),
      hold: (a) => held.add(a), release: (a) => held.delete(a), press: (a) => pressed.add(a),
    },
    player: {
      alive: true, data: { startWeapon: 'pistola' }, position: { x: 0, z: 0 }, aimDir: new THREE.Vector3(0, 0, 1),
      getMuzzleWorld(out) { return out.set(this.position.x, 1, this.position.z + 0.5); },
    },
    build: { active: false, barrelRaycast: () => null, detonateBarrel() {} },
    shop: { open: null },
    zombies: {
      active: [], pool: Array.from({ length: 8 }),
      raycast(ox, oz, dx, dz, maxDist, exclude) {
        let best = null, bestT = maxDist;
        for (const zb of this.active) {
          if (zb.state !== 0 || exclude?.has(zb)) continue;
          const px = zb.pos.x - ox, pz = zb.pos.z - oz;
          const t = px * dx + pz * dz;
          const off = Math.abs(px * dz - pz * dx);
          if (t > 0 && off < zb.radius && t < bestT) { bestT = t; best = zb; }
        }
        return best ? { zombie: best, t: bestT } : null;
      },
      damage(zb, amount) { zb.hp -= amount; if (zb.hp <= 0) zb.state = 1; return zb.hp <= 0; },
      shieldBlocks: () => false, shieldHit() {}, stun() {},
    },
    effects: new Proxy({}, { get: () => () => {} }),
  };
  game.weapons = new WeaponSystem(game);
  return game;
}

function equip(game, id) {
  game.weapons.give(id);
  game.weapons.switchTo(id, true);
  return game.weapons.weapon;
}

function run(game, seconds) {
  for (let t = 0; t < seconds; t += DT) {
    game.time += DT;
    game.weapons.update(DT);
    game.input.endStep?.();
  }
}

const count = (game, type) => {
  let n = 0;
  game.bus.on(type, () => { n++; });
  return () => n;
};

// ---------------------------------------------------------------------------------- datos
describe('Armas nuevas: datos', () => {
  it('rifle láser, lanzallamas y sable existen, con ranuras 8-10 distintas', () => {
    expect(weapons.laser.slot).toBe(8);
    expect(weapons.lanzallamas.slot).toBe(9);
    expect(weapons.sable.slot).toBe(10);
    const slots = WEAPON_IDS.map((id) => weapons[id].slot);
    expect(new Set(slots).size).toBe(slots.length);
    expect(WEAPON_IDS).toEqual(expect.arrayContaining(['laser', 'lanzallamas', 'sable']));
  });

  it('cada una tiene modelo, boca, precio y frase de tienda', () => {
    for (const id of ['laser', 'lanzallamas', 'sable']) {
      expect(WEAPON_SPECS[id], id).toBeTruthy();
      expect(weaponGeometry(id).attributes.position.count).toBeGreaterThan(0);
      expect(weapons[id].price).toBeGreaterThan(0);
      expect(weapons[id].flavor.length).toBeGreaterThan(10);
    }
  });

  it('el rifle láser, el lanzallamas y el sable tienen partes luminosas; las demás no', () => {
    for (const id of ['laser', 'lanzallamas', 'sable']) expect(weaponGlowGeometry(id), id).not.toBeNull();
    expect(weaponGlowGeometry('pistola')).toBeNull();
  });

  it('los sonidos nuevos existen como receta y están mezclados en audio.json', () => {
    for (const n of ['shot_laser', 'shot_lanzallamas', 'swing_sable', 'saber_on', 'overheat', 'laser_locked', 'cooled', 'deflect']) {
      expect(RECIPES[n], n).toBeTruthy();
      expect(audio.sounds[n], n).toBeTruthy();
    }
  });

  it('el efecto de armas de fuego existe para láser y lanzallamas, y no para el sable', () => {
    expect(config.fx.weapons.laser).toBeTruthy();
    expect(config.fx.weapons.lanzallamas).toBeTruthy();
    expect(config.fx.weapons.sable).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------- estadísticas
describe('Armas nuevas: mejoras', () => {
  it('láser: disipador baja el calor por disparo y refrigeración acelera el enfriamiento', () => {
    const d = weapons.laser;
    const s0 = weaponStats(d), s3 = weaponStats(d, { heat: 3, cool: 3 });
    expect(s0.heatPerShot).toBeCloseTo(d.heat.perShot);
    expect(s3.heatPerShot).toBeCloseTo(d.heat.perShot * (1 - 3 * weapons._upgrades.tracks.heat.perLevel));
    expect(s3.coolRate).toBeGreaterThan(s0.coolRate);
    expect(s3.lockedCoolRate).toBeGreaterThan(s0.lockedCoolRate);
    expect(s0.lockedCoolRate).toBeLessThan(s0.coolRate); // bloqueado enfría más despacio
    expect(s0.magSize).toBe(0);
  });

  it('las armas sin calor no tienen estadísticas de calor', () => {
    expect(weaponStats(weapons.fusil).heatPerShot).toBe(0);
  });

  it('lanzallamas: el daño sube también la quemadura; sable: el alcance mejora', () => {
    const f0 = weaponStats(weapons.lanzallamas), f3 = weaponStats(weapons.lanzallamas, { damage: 3 });
    expect(f3.burnDps).toBeGreaterThan(f0.burnDps);
    expect(f0.burnTime).toBe(weapons.lanzallamas.burn.duration);
    const s0 = weaponStats(weapons.sable), s3 = weaponStats(weapons.sable, { reach: 3 });
    expect(s0.range).toBe(weapons.sable.range);
    expect(s3.range).toBeGreaterThan(s0.range);
  });

  it('los costes de mejora crecen por nivel', () => {
    for (const id of ['laser', 'lanzallamas', 'sable']) expect(upgradeCost(weapons[id], 3)).toBeGreaterThan(upgradeCost(weapons[id], 1));
  });

  it('las mejoras de cada arma existen entre las pistas', () => {
    for (const id of ['laser', 'lanzallamas', 'sable']) {
      for (const t of weapons[id].tracks ?? weapons._upgrades.defaultTracks) expect(weapons._upgrades.tracks[t], `${id}:${t}`).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------------- calor (puro)
describe('Calor del rifle láser (lógica pura)', () => {
  const mkW = () => ({ heat: 0, locked: false, coolWait: 0, data: weapons.laser, stats: weaponStats(weapons.laser) });

  it('cada disparo suma calor y reinicia la espera', () => {
    const w = mkW();
    expect(heatAfterShot(w)).toBe(false);
    expect(w.heat).toBeCloseTo(weapons.laser.heat.perShot);
    expect(w.coolWait).toBe(weapons.laser.heat.coolDelay);
  });

  it('con el disparo que llega al 100 % se bloquea', () => {
    const w = mkW();
    let shots = 0, locked = false;
    while (!locked && shots < 100) { locked = heatAfterShot(w); shots++; }
    expect(locked).toBe(true);
    expect(shots).toBe(Math.ceil(1 / weapons.laser.heat.perShot));
    expect(w.heat).toBe(1);
    expect(w.locked).toBe(true);
  });

  it('el calor no baja hasta pasar la espera, y luego baja a coolRate', () => {
    const w = mkW();
    heatAfterShot(w);
    const h = w.heat;
    heatStep(w, weapons.laser.heat.coolDelay * 0.5);
    expect(w.heat).toBe(h);
    heatStep(w, weapons.laser.heat.coolDelay * 0.5 + 0.1);
    expect(w.heat).toBeCloseTo(h - w.stats.coolRate * 0.1, 5);
  });

  it('bloqueado, enfría desde el primer instante (más despacio) y solo se desbloquea al llegar a 0', () => {
    const w = mkW();
    w.heat = 1; w.locked = true;
    const full = 1 / w.stats.lockedCoolRate;
    expect(heatStep(w, full * 0.5)).toBe(false);
    expect(w.locked).toBe(true);
    expect(w.heat).toBeCloseTo(0.5, 5);
    expect(heatStep(w, full * 0.49)).toBe(false);
    expect(w.locked).toBe(true); // al 1 % todavía bloqueado
    expect(heatStep(w, full * 0.05)).toBe(true);
    expect(w.locked).toBe(false);
    expect(w.heat).toBe(0);
  });

  it('con las mejoras se bloquea más tarde y se desbloquea antes', () => {
    const a = { ...mkW() }, b = { ...mkW(), stats: weaponStats(weapons.laser, { heat: 3, cool: 3 }) };
    const shotsUntilLock = (w) => { let n = 0; while (!heatAfterShot(w)) n++; return n + 1; };
    expect(shotsUntilLock(b)).toBeGreaterThan(shotsUntilLock(a));
    expect(1 / b.stats.lockedCoolRate).toBeLessThan(1 / a.stats.lockedCoolRate);
  });
});

// ---------------------------------------------------------------------------------- geometría pura
describe('Arcos y conos', () => {
  const half = rad(weapons.sable.arcDeg / 2);
  const at = (deg, d) => { const a = rad(deg); return [Math.sin(a) * d, Math.cos(a) * d, d]; }; // apuntando a +Z

  it('inArc: dentro, fuera por ángulo y fuera por alcance', () => {
    const cos = Math.cos(half);
    const [x1, z1, d1] = at(60, 1.5);
    expect(inArc(0, 1, x1, z1, d1, 0.4, 2.3, cos)).toBe(true);
    const [x2, z2, d2] = at(150, 1.5);
    expect(inArc(0, 1, x2, z2, d2, 0.4, 2.3, cos)).toBe(false);
    const [x3, z3, d3] = at(0, 5);
    expect(inArc(0, 1, x3, z3, d3, 0.4, 2.3, cos)).toBe(false);
    expect(inArc(0, 1, 0, 0, 0, 0.4, 2.3, cos)).toBe(false);
  });

  it('el sable cubre un arco mucho más amplio que la porra', () => {
    const [x, z, d] = at(80, 1.5);
    expect(inArc(0, 1, x, z, d, 0.4, 2.3, Math.cos(rad(weapons.sable.arcDeg / 2)))).toBe(true);
    expect(inArc(0, 1, x, z, d, 0.4, 2.3, Math.cos(rad(weapons.porra.arcDeg / 2)))).toBe(false);
  });

  it('inCone: el cono se ensancha con el tamaño del objetivo', () => {
    const halfCone = rad(weapons.lanzallamas.coneDeg / 2);
    const [x, z, d] = at(25, 3); // fuera del medio cono (19°) por el centro
    expect(inCone(0, 1, x, z, d, 0.05, 5.2, halfCone)).toBe(false);
    expect(inCone(0, 1, x, z, d, 0.8, 5.2, halfCone)).toBe(true); // un zombi grande sí lo toca
    const [x2, z2, d2] = at(0, 6.5);
    expect(inCone(0, 1, x2, z2, d2, 0.4, 5.2, halfCone)).toBe(false); // más allá del alcance
    expect(inCone(0, 1, 0, 0, 0, 0.4, 5.2, halfCone)).toBe(true);
  });

  it('assistParams: usa el valor del arma o el global táctil', () => {
    const T = config.touch;
    expect(assistParams(weapons.pistola, T)).toEqual({ range: T.assistRange, angleDeg: T.assistAngleDeg });
    expect(assistParams(weapons.lanzallamas, T).range).toBe(weapons.lanzallamas.assist.range);
    expect(assistParams(weapons.sable, T).angleDeg).toBe(weapons.sable.assist.angleDeg);
    expect(assistParams(undefined, T).range).toBe(T.assistRange);
    // el alcance de ayuda del lanzallamas cubre su alcance de llama; el del sable, su alcance
    expect(weapons.lanzallamas.assist.range).toBeGreaterThanOrEqual(weapons.lanzallamas.range);
    expect(weapons.sable.assist.range).toBeGreaterThanOrEqual(weapons.sable.range);
  });
});

// ---------------------------------------------------------------------------------- rifle láser
describe('Rifle láser en juego', () => {
  let g, w;
  beforeEach(() => { g = makeGame(); w = equip(g, 'laser'); });

  it('munición infinita: dispara sin gastar cargador ni reserva', () => {
    const fired = count(g, 'weapon:fired');
    g.input.hold('fire');
    run(g, 0.5);
    expect(fired()).toBeGreaterThan(0);
    expect(w.mag).toBe(0);
    expect(w.reserve).toBe(-1);
  });

  it('se sobrecalienta tras ~12 disparos, avisa una vez y se bloquea', () => {
    const fired = count(g, 'weapon:fired'), over = count(g, 'weapon:overheat'), locked = count(g, 'weapon:locked');
    g.input.hold('fire');
    run(g, 4);
    expect(over()).toBe(1);
    expect(fired()).toBe(Math.ceil(1 / weapons.laser.heat.perShot));
    expect(w.locked).toBe(true);
    expect(locked()).toBeGreaterThan(0); // el gatillo suena a vacío, sin disparar
  });

  it('suelta el gatillo, se enfría del todo y avisa; entonces vuelve a disparar', () => {
    const fired = count(g, 'weapon:fired'), cooled = count(g, 'weapon:cooled');
    g.input.hold('fire');
    run(g, 3);
    g.input.release('fire');
    const n0 = fired();
    run(g, 1 / w.stats.lockedCoolRate + 0.2);
    expect(cooled()).toBe(1);
    expect(w.locked).toBe(false);
    expect(w.heat).toBe(0);
    g.input.hold('fire');
    run(g, 0.3);
    expect(fired()).toBeGreaterThan(n0);
  });

  it('bloqueado no dispara aunque se pulse a mitad de enfriamiento', () => {
    g.input.hold('fire');
    run(g, 3);
    const fired = count(g, 'weapon:fired');
    run(g, 1.0);
    expect(w.locked).toBe(true);
    expect(fired()).toBe(0);
  });

  it('el rayo atraviesa a un zombi (2 en total) y no a un tercero', () => {
    const zs = [3, 6, 9].map((d, i) => mkZombie(i, 0, d));
    g.zombies.active.push(...zs);
    g.input.press('fire');
    run(g, DT * 2);
    expect(zs[0].hp).toBeLessThan(100);
    expect(zs[1].hp).toBeLessThan(100);
    expect(zs[2].hp).toBe(100);
  });

  it('también se enfrían las armas de calor guardadas', () => {
    g.input.hold('fire');
    run(g, 0.5);
    g.input.release('fire');
    const h = w.heat;
    g.weapons.switchTo('pistola', true);
    run(g, 2);
    expect(w.heat).toBeLessThan(h);
  });

  it('recargar no hace nada con el láser', () => {
    g.input.press('reload');
    run(g, 0.1);
    expect(w.reloading).toBe(0);
  });
});

// ---------------------------------------------------------------------------------- lanzallamas
describe('Lanzallamas en juego', () => {
  let g, w;
  beforeEach(() => { g = makeGame(); w = equip(g, 'lanzallamas'); });

  it('gasta combustible muy rápido (el cargador dura unos segundos)', () => {
    const fired = count(g, 'weapon:fired');
    g.input.hold('fire');
    run(g, 2);
    expect(fired()).toBeGreaterThan(20);
    expect(w.mag).toBeLessThan(w.stats.magSize - 20);
    const seconds = w.stats.magSize / weapons.lanzallamas.fireRate;
    expect(seconds).toBeLessThan(6);
  });

  it('daña y prende a los zombis del cono, y no a los de fuera', () => {
    const inside = mkZombie(1, 0, 3), side = mkZombie(2, 4, 2), far = mkZombie(3, 0, 8);
    g.zombies.active.push(inside, side, far);
    g.input.hold('fire');
    run(g, 0.3);
    expect(inside.hp).toBeLessThan(100);
    expect(g.weapons.burning.isBurning(inside)).toBe(true);
    expect(side.hp).toBe(100);
    expect(far.hp).toBe(100);
    expect(g.weapons.burning.isBurning(far)).toBe(false);
  });

  it('un muro corta las llamas', () => {
    g.grid = new NavGrid(ROWS.map((r, j) => (j === 21 ? '#'.repeat(40) : r)), tiles, 1); // muro en z = 1..2
    const z = mkZombie(1, 0, 3);
    g.zombies.active.push(z);
    g.input.hold('fire');
    run(g, 0.3);
    expect(z.hp).toBe(100);
  });

  it('el escudo de un jefe frena las llamas', () => {
    g.zombies.shieldBlocks = () => true;
    const z = mkZombie(1, 0, 3);
    g.zombies.active.push(z);
    g.input.hold('fire');
    run(g, 0.3);
    expect(z.hp).toBe(100);
    expect(g.weapons.burning.isBurning(z)).toBe(false);
  });

  it('enciende el barril que apunta el cono', () => {
    let boom = 0;
    g.build.barrelRaycast = (ox, oz, dx, dz, max) => ({ s: { id: 'b' }, t: Math.min(3, max) });
    g.build.detonateBarrel = () => { boom++; };
    g.input.press('fire');
    run(g, DT * 2);
    expect(boom).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------- quemaduras
describe('Quemaduras', () => {
  let g, b;
  beforeEach(() => { g = makeGame(); b = g.weapons.burning; });

  it('el daño por tiempo sigue después de apagar el lanzallamas y acaba cuando termina la duración', () => {
    const z = mkZombie(1, 5, 5, { hp: 1000, maxHp: 1000 });
    g.zombies.active.push(z);
    b.ignite(z, 4, 10);
    for (let t = 0; t < 2; t += DT) b.update(DT);
    expect(z.hp).toBeCloseTo(1000 - 20, 0);
    for (let t = 0; t < 3; t += DT) b.update(DT);
    expect(z.hp).toBeCloseTo(1000 - 40, 0); // 4 s × 10 dps y se apaga
    expect(b.isBurning(z)).toBe(false);
  });

  it('prender de nuevo renueva el tiempo pero no acumula daño', () => {
    const z = mkZombie(1, 5, 5, { hp: 1000, maxHp: 1000 });
    g.zombies.active.push(z);
    b.ignite(z, 2, 10);
    for (let t = 0; t < 1.5; t += DT) b.update(DT);
    b.ignite(z, 2, 10);
    expect(b.list.length).toBe(1);
    for (let t = 0; t < 3; t += DT) b.update(DT);
    expect(z.hp).toBeCloseTo(1000 - 35, 0); // 1,5 + 2 s a 10 dps
  });

  it('el zombi quemado se mata solo si le falta vida', () => {
    const z = mkZombie(1, 5, 5, { hp: 10 });
    g.zombies.active.push(z);
    b.ignite(z, 4, 20);
    for (let t = 0; t < 1; t += DT) b.update(DT);
    expect(z.state).toBe(1);
    expect(b.isBurning(z)).toBe(false);
  });

  it('brilla naranja mientras arde y queda tiznado (más oscuro) después', () => {
    const z = mkZombie(1, 5, 5, { hp: 1000, maxHp: 1000 });
    g.zombies.active.push(z);
    const base = z.colors[0].clone();
    b.ignite(z, 2, 1);
    for (let t = 0; t < 0.6; t += DT) { g.time += DT; b.update(DT); }
    expect(z.colors[0].r).toBeGreaterThan(base.r); // más rojo/naranja
    for (let t = 0; t < 2.5; t += DT) { g.time += DT; b.update(DT); }
    const sooted = z.colors[0];
    expect(sooted.r).toBeCloseTo(base.r * weapons._fx.burn.sootMul, 5);
    expect(sooted.g).toBeLessThan(base.g);
    expect(sooted.b).toBeLessThan(base.b);
  });

  it('burnColor: sin brillo ni tizne deja el color, con tizne lo oscurece', () => {
    const base = new THREE.Color(0.8, 0.6, 0.4), out = new THREE.Color();
    burnColor(out, base, { soot: 0, glow: 0 });
    expect(out.r).toBeCloseTo(0.8);
    burnColor(out, base, { soot: 1, glow: 0 });
    expect(out.r).toBeCloseTo(0.8 * weapons._fx.burn.sootMul);
  });

  it('reset apaga todo y un zombi reciclado no hereda la quemadura', () => {
    const z = mkZombie(1, 5, 5, { hp: 1000, maxHp: 1000 });
    g.zombies.active.push(z);
    b.ignite(z, 4, 10);
    b.reset();
    expect(b.isBurning(z)).toBe(false);
    expect(b.list.length).toBe(0);
    b.update(DT);
    expect(z.hp).toBe(1000);
    // una entrada vieja apuntando a otro zombi tampoco cuenta
    const z2 = mkZombie(2, 6, 6);
    z2._burn = { active: true, zb: z };
    expect(b.isBurning(z2)).toBe(false);
  });

  it('un zombi muerto deja de arder', () => {
    const z = mkZombie(1, 5, 5, { hp: 1000, maxHp: 1000 });
    g.zombies.active.push(z);
    b.ignite(z, 4, 10);
    z.state = 1;
    b.update(DT);
    expect(b.isBurning(z)).toBe(false);
  });

  it('no prende a un zombi ya muerto', () => {
    const z = mkZombie(1, 5, 5, { state: 1 });
    expect(b.ignite(z, 4, 10)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------- sable
describe('Sable láser en juego', () => {
  let g, w;
  beforeEach(() => { g = makeGame(); w = equip(g, 'sable'); });

  it('golpea a todos los del arco (incluso a los costados) y no a los de atrás ni lejanos', () => {
    const at = (deg, d, id) => mkZombie(id, Math.sin(rad(deg)) * d, Math.cos(rad(deg)) * d);
    const front = at(0, 1.5, 1), side = at(85, 1.5, 2), back = at(170, 1.5, 3), far = at(0, 4, 4);
    g.zombies.active.push(front, side, back, far);
    const melee = [];
    g.bus.on('weapon:melee', (e) => melee.push(e));
    g.input.press('fire');
    run(g, DT * 2);
    expect(front.hp).toBeLessThan(100);
    expect(side.hp).toBeLessThan(100);
    expect(back.hp).toBe(100);
    expect(far.hp).toBe(100);
    expect(melee[0].hits).toBe(2);
    expect(melee[0].id).toBe('sable');
  });

  it('hace mucho más daño que la porra y no gasta munición', () => {
    expect(weapons.sable.damage).toBeGreaterThan(weapons.porra.damage * 2);
    expect(w.reserve).toBe(-1);
    expect(w.data.melee).toBe(true);
  });

  it('el alcance mejorado golpea más lejos', () => {
    const z = mkZombie(1, 0, weapons.sable.range + 0.4 + 0.2); // justo fuera del alcance base
    g.zombies.active.push(z);
    g.input.press('fire');
    run(g, DT * 2);
    expect(z.hp).toBe(100);
    g.weapons.applyUpgrade('sable', 'reach');
    g.weapons.applyUpgrade('sable', 'reach');
    g.weapons.applyUpgrade('sable', 'reach');
    w.cooldown = 0;
    g.input.press('fire');
    run(g, DT * 2);
    expect(z.hp).toBeLessThan(100);
  });

  it('desvía un escupitajo que llega hacia el arco y lo devuelve a quien lo lanzó', () => {
    const D = weapons.sable.deflect;
    // Escupitajo lanzado desde (0, 10) hacia el policía en (0, 0), ahora a 2 m.
    const blob = {
      active: true, x0: 0, z0: 10, x1: 0, z1: 0, x: 0, z: 2, y: 1.0, h0: 1.5, t: 0.5, flight: 1, sp: { speed: 9, minFlight: 0.3 },
    };
    g.acid = { blobs: [blob] };
    const deflected = count(g, 'weapon:deflect');
    run(g, DT * 3);
    expect(deflected()).toBe(1);
    expect(blob.deflected).toBe(true);
    expect(blob.x1).toBe(0);
    expect(blob.z1).toBe(10); // vuelve a su origen
    expect(blob.z0).toBe(2);
    expect(blob.t).toBe(0);
    // al caer daña a los zombis cercanos
    const spitter = mkZombie(9, 0, 10);
    g.zombies.active.push(spitter);
    blob.active = false;
    run(g, DT * 2);
    expect(spitter.hp).toBe(100 - D.damage);
    expect(g.weapons.deflected.length).toBe(0);
  });

  it('no desvía lo que viene por la espalda, lo que se aleja ni con otra arma', () => {
    const mk = (z, z0, z1) => ({
      active: true, x0: 0, z0, x1: 0, z1, x: 0, z, y: 1.0, h0: 1.5, t: 0.5, flight: 1, sp: { speed: 9, minFlight: 0.3 },
    });
    const behind = mk(-2, -10, 0);   // llega desde atrás
    const leaving = mk(2, 0, 10);    // se aleja
    g.acid = { blobs: [behind, leaving] };
    const deflected = count(g, 'weapon:deflect');
    run(g, DT * 3);
    expect(deflected()).toBe(0);
    g.weapons.switchTo('pistola', true);
    const incoming = mk(2, 10, 0);
    g.acid.blobs.push(incoming);
    run(g, DT * 3);
    expect(deflected()).toBe(0);
    expect(incoming.deflected).toBeUndefined();
  });
});
