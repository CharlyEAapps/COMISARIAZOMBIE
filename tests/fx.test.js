import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import config from '../src/data/config.json';
import weapons from '../src/data/weapons.json';
import build from '../src/data/build.json';
import { EventBus } from '../src/core/EventBus.js';
import { Effects, debrisKind, puffAlpha, hex } from '../src/render/Effects.js';
import { decalAlpha, decalGrow } from '../src/render/Decals.js';
import {
  fallCurve, hitReaction, armAnglesToward, weaponPointInChar, reloadPhases, smooth, PARTS, WEAPON_MOUNT,
} from '../src/render/BlockyCharacter.js';

const FX = config.fx;
const WEAPON_IDS = Object.keys(weapons).filter((k) => !k.startsWith('_'));

describe('fx: constantes en config.json', () => {
  it('hay datos de efectos por cada arma de fuego y ninguno para la porra', () => {
    for (const id of WEAPON_IDS) {
      if (weapons[id].melee) expect(FX.weapons[id], id).toBeUndefined();
      else expect(FX.weapons[id], id).toBeTruthy();
    }
    expect(FX.weapons.taser.casings).toBe(0); // el táser no suelta casquillos
  });

  it('todos los colores son hexadecimales válidos', () => {
    const walk = (o, path) => {
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === 'string' && /color/i.test(k)) expect(Number.isFinite(hex(v)), `${path}.${k}`).toBe(true);
        else if (Array.isArray(v) && /colors$/i.test(k)) for (const c of v) expect(Number.isFinite(hex(c)), `${path}.${k}`).toBe(true);
        else if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, `${path}.${k}`);
      }
    };
    walk(FX, 'fx');
  });

  it('cada pieza construible tiene un material de escombros definido', () => {
    for (const type of Object.keys(build.pieces)) {
      const kind = debrisKind(type, 0);
      expect(FX.debris[kind], type).toBeTruthy();
      expect(FX.debris[kind].colors.length).toBeGreaterThan(0);
    }
  });

  it('los materiales por nivel cubren todos los niveles de barricada y puerta', () => {
    expect(FX.debris.barricadaLevels.length).toBe(build.pieces.barricada.levels.length);
    expect(FX.debris.puertaLevels.length).toBe(build.pieces.puerta.levels.length);
    expect(debrisKind('barricada', 0)).toBe('wood');
    expect(debrisKind('barricada', 1)).toBe('metal');
    expect(debrisKind('barricada', 2)).toBe('concrete');
    expect(debrisKind('sacos', 1)).toBe('sack');
    expect(debrisKind('generador', 0)).toBe('metal');
  });
});

describe('fx: curvas de animación', () => {
  it('la caída de un zombi crece de 0 a 1, rebota un poco al final y se asienta', () => {
    expect(fallCurve(0)).toBe(0);
    let prev = 0;
    for (let t = 0.05; t < FX.zombieDeath.settleStart; t += 0.05) {
      const v = fallCurve(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    // Justo al tocar el suelo ya está casi tumbado, y rebota hacia arriba sin pasarse.
    const mid = fallCurve((FX.zombieDeath.settleStart + 1) / 2);
    expect(mid).toBeLessThan(1);
    expect(mid).toBeGreaterThan(1 - 2 * FX.zombieDeath.settleBounce);
    expect(fallCurve(1)).toBe(1);
    expect(fallCurve(5)).toBe(1);
  });

  it('la reacción a un impacto se apaga con el tiempo y no existe antes ni después', () => {
    const T = FX.zombieHit.time;
    expect(hitReaction(-1, T)).toBe(0);
    expect(hitReaction(0, T)).toBe(1);
    expect(hitReaction(T / 2, T)).toBeLessThan(hitReaction(T / 4, T));
    expect(hitReaction(T, T)).toBe(0);
    expect(hitReaction(99, T)).toBe(0);
  });

  it('smooth hace una rampa suave entre dos extremos', () => {
    expect(smooth(0, 1, -1)).toBe(0);
    expect(smooth(0, 1, 2)).toBe(1);
    expect(smooth(0, 1, 0.5)).toBeCloseTo(0.5, 6);
  });

  it('armAnglesToward orienta el hueso del brazo hacia el objetivo', () => {
    const out = { x: 0, z: 0 };
    for (const [tx, ty, tz] of [[0, 0.5, 1], [-0.3, 1, 0.4], [0.2, 0.7, -0.5], [0, 0.2, 0.1]]) {
      const [sx, sy, sz] = PARTS.armL.pivot;
      armAnglesToward(out, sx, sy, sz, tx, ty, tz);
      // dirección del brazo con Euler XYZ: (sin z, -cos z·cos x, -cos z·sin x)
      const dir = new THREE.Vector3(Math.sin(out.z), -Math.cos(out.z) * Math.cos(out.x), -Math.cos(out.z) * Math.sin(out.x));
      const want = new THREE.Vector3(tx - sx, ty - sy, tz - sz).normalize();
      expect(dir.distanceTo(want)).toBeLessThan(1e-6);
    }
  });

  it('weaponPointInChar coincide con el montaje del arma con el brazo estirado', () => {
    const out = new THREE.Vector3();
    weaponPointInChar(out, -Math.PI / 2, 0, 0, 0);
    expect(out.x).toBeCloseTo(PARTS.armR.pivot[0], 6);
    expect(out.y).toBeCloseTo(PARTS.armR.pivot[1] + WEAPON_MOUNT.position.z, 6);
    expect(out.z).toBeCloseTo(-WEAPON_MOUNT.position.y, 6);
    // El cañón (+Z del arma) apunta al frente con el brazo estirado y hacia abajo si se baja.
    weaponPointInChar(out, -Math.PI / 2, 0, 0, 1);
    expect(out.z).toBeCloseTo(-WEAPON_MOUNT.position.y + 1, 6);
    const lowered = weaponPointInChar(new THREE.Vector3(), 0, 0, 0, 1);
    expect(lowered.y).toBeLessThan(PARTS.armR.pivot[1]);
  });

  it('reloadPhases: empieza y acaba con el arma arriba y la mano en su sitio', () => {
    const ph = { lower: 0, belt: 0, mag: 0, hasMag: false, bump: 0 };
    const R = FX.player.reload;
    reloadPhases(ph, 0);
    expect([ph.lower, ph.belt, ph.mag, ph.hasMag]).toEqual([0, 0, 0, false]);
    reloadPhases(ph, 1);
    expect([ph.lower, ph.belt, ph.mag, ph.hasMag]).toEqual([0, 0, 0, false]);
    reloadPhases(ph, R.beltAt);
    expect(ph.belt).toBeCloseTo(1, 6);
    expect(ph.lower).toBeCloseTo(1, 6);
    reloadPhases(ph, R.insertAt);
    expect(ph.mag).toBeCloseTo(1, 6);
    expect(ph.bump).toBeCloseTo(1, 6);
    for (let p = 0; p <= 1.0001; p += 0.01) {
      reloadPhases(ph, p);
      expect(ph.belt).toBeGreaterThanOrEqual(-1e-9);
      expect(ph.mag).toBeGreaterThanOrEqual(-1e-9);
      expect(ph.belt + ph.mag).toBeLessThanOrEqual(1 + 1e-9);
      expect(ph.hasMag).toBe(p > R.beltAt && p < R.insertAt);
    }
  });
});

describe('fx: desvanecimiento', () => {
  it('las calcomanías se mantienen y se desvanecen al final de su vida', () => {
    const life = FX.decals.stainLife, f = FX.decals.stainFadeFraction, a = FX.decals.stainAlpha;
    expect(decalAlpha(0, life, f, a)).toBe(a);
    expect(decalAlpha(life * (1 - f) - 0.01, life, f, a)).toBe(a);
    let prev = a;
    for (let age = life * (1 - f); age < life; age += 0.25) {
      const v = decalAlpha(age, life, f, a);
      expect(v).toBeLessThanOrEqual(prev + 1e-12);
      prev = v;
    }
    expect(decalAlpha(life, life, f, a)).toBe(0);
    expect(life).toBeGreaterThanOrEqual(15); // la mancha dura ~20 s
  });

  it('la mancha crece al aparecer hasta su tamaño final', () => {
    expect(decalGrow(0)).toBeCloseTo(FX.decals.growFrom, 6);
    expect(decalGrow(FX.decals.growTime)).toBe(1);
    expect(decalGrow(1)).toBe(1);
  });

  it('el humo aparece rápido y se desvanece sin pasarse de su alfa máxima', () => {
    expect(puffAlpha(0, 0.5)).toBe(0);
    expect(puffAlpha(1, 0.5)).toBe(0);
    for (let t = 0.01; t < 1; t += 0.01) {
      expect(puffAlpha(t, 0.5)).toBeLessThanOrEqual(0.5);
      expect(puffAlpha(t, 0.5)).toBeGreaterThanOrEqual(0);
    }
  });
});

/** Juego mínimo para probar los efectos sin DOM ni WebGL. */
function fakeGame(over = {}) {
  const bus = new EventBus();
  const walls = { blocked: false };
  return {
    bus,
    time: 0,
    walls,
    grid: { isShotBlocked: () => walls.blocked, cellX: (x) => Math.floor(x), cellZ: (z) => Math.floor(z), centerX: (i) => i + 0.5, centerZ: (j) => j + 0.5, w: 10 },
    player: { alive: true, aimDir: new THREE.Vector3(1, 0, 0), velocity: new THREE.Vector3(), position: new THREE.Vector3() },
    zombies: { ai: { fallTime: 0.4 } },
    ...over,
  };
}
const live = (list) => list.filter((p) => p.life > 0).length;

describe('fx: Effects (pools sin DOM)', () => {
  it('un disparo suelta un casquillo (salvo el táser), humo y retroceso', () => {
    const fx = new Effects(new THREE.Scene());
    const game = fakeGame();
    fx.bind(game);
    fx.muzzleFlash(new THREE.Vector3(1, 1.3, 2));
    game.bus.emit('weapon:fired', { id: 'pistola' });
    expect(live(fx.casings)).toBe(1);
    expect(live(fx.puffs)).toBeGreaterThan(0);
    expect(fx.recoil).toBeGreaterThan(0);
    game.bus.emit('weapon:fired', { id: 'taser' });
    expect(live(fx.casings)).toBe(1);
    // El casquillo sale hacia la derecha del jugador (apunta a +X → derecha = -Z).
    const c = fx.casings.find((p) => p.life > 0);
    expect(c.vz).toBeLessThan(0);
  });

  it('los casquillos rebotan, se quedan quietos en el suelo y desaparecen en ~2 s', () => {
    const fx = new Effects(new THREE.Scene());
    fx.casing(0, 1.3, 0, 0, -1, -1, 0, 0xe0aa3c, 1);
    const c = fx.casings[0];
    let bounced = false, rested = false;
    for (let t = 0; t < 1.6; t += 1 / 60) {
      const vy = c.vy;
      fx.update(1 / 60);
      if (vy < 0 && c.vy > 0) bounced = true;
      if (c.rest) rested = true;
      expect(c.y).toBeGreaterThan(0);
    }
    expect(bounced).toBe(true);
    expect(rested).toBe(true);
    for (let t = 0; t < FX.casings.life + 0.2; t += 1 / 60) fx.update(1 / 60);
    expect(live(fx.casings)).toBe(0);
    expect(fx.casingMesh.count).toBe(0);
  });

  it('los pools son circulares: nunca superan su tamaño', () => {
    const fx = new Effects(new THREE.Scene());
    for (let i = 0; i < FX.puffs.max * 3; i++) fx.puff(0, 1, 0, 0, 1, 0, 0.1, 0.3, 1, 0.4, 0xffffff, 1, 0);
    for (let i = 0; i < FX.sparks.max * 3; i++) fx.spark(0, 1, 0, 1, 1, 0, 0xffffff, 0.3);
    for (let i = 0; i < FX.casings.max * 3; i++) fx.casing(0, 1, 0, 1, 0, 0, 0, 0xffffff, 1);
    fx.update(1 / 60);
    expect(fx.puffMesh.count).toBeLessThanOrEqual(FX.puffs.max);
    expect(fx.sparkMesh.count).toBeLessThanOrEqual(FX.sparks.max);
    expect(fx.casingMesh.count).toBeLessThanOrEqual(FX.casings.max);
  });

  it('una explosión lanza anillos, humo y luz, y todo se apaga solo', () => {
    const fx = new Effects(new THREE.Scene());
    const game = fakeGame();
    fx.bind(game);
    game.bus.emit('explosion', { x: 3, z: 3, radius: 4 });
    expect(live(fx.rings)).toBe(2);
    expect(live(fx.puffs)).toBe(FX.explosion.smokeCount + FX.explosion.dustCount);
    expect(fx.flashLight.intensity).toBe(FX.flash.explosionIntensity);
    let maxRing = 0;
    for (let t = 0; t < 4; t += 1 / 60) {
      fx.update(1 / 60);
      maxRing = Math.max(maxRing, fx.ringMesh.count);
    }
    expect(maxRing).toBe(2);
    expect(live(fx.rings)).toBe(0);
    expect(live(fx.puffs)).toBe(0);
    expect(fx.flashLight.intensity).toBe(0);
  });

  it('el humo con retardo no aparece hasta que le toca', () => {
    const fx = new Effects(new THREE.Scene());
    fx.puff(0, 1, 0, 0, 1, 0, 0.1, 0.3, 1, 0.4, 0xffffff, 1, 0.5);
    fx.update(0.25);
    expect(fx.puffMesh.count).toBe(0);
    fx.update(0.3);
    fx.update(1 / 60);
    expect(fx.puffMesh.count).toBe(1);
  });

  it('la trazadora que acaba contra un muro suelta chispas; en campo abierto, no', () => {
    const fx = new Effects(new THREE.Scene());
    const game = fakeGame();
    fx.bind(game);
    const from = new THREE.Vector3(0, 1.25, 0), to = new THREE.Vector3(5, 1.25, 0);
    fx.tracer(from, to);
    expect(live(fx.sparks)).toBe(0);
    game.walls.blocked = true;
    fx.tracer(from, to);
    expect(live(fx.sparks)).toBe(FX.wallSpark.count);
  });

  it('el polvo de esprintar solo sale al ir por encima del umbral', () => {
    const fx = new Effects(new THREE.Scene());
    const game = fakeGame();
    fx.bind(game);
    game.player.velocity.set(5, 0, 0); // caminando
    for (let i = 0; i < 60; i++) fx.update(1 / 60);
    expect(live(fx.puffs)).toBe(0);
    game.player.velocity.set(7.5, 0, 0); // esprintando
    for (let i = 0; i < 60; i++) fx.update(1 / 60);
    expect(live(fx.puffs)).toBeGreaterThanOrEqual(4);
  });

  it('un objeto roto suelta escombros según su material', () => {
    const fx = new Effects(new THREE.Scene());
    const game = fakeGame({ build: { structures: new Map([[12, { level: 0, cells: [12] }]]) } });
    fx.bind(game);
    game.bus.emit('build:destroyed', { type: 'barricada', k: 12 });
    expect(live(fx.particles)).toBe(FX.debris.wood.chips + FX.debris.wood.splinters);
    expect(live(fx.sparks)).toBe(0);
    game.bus.emit('build:destroyed', { type: 'generador', k: 12 });
    expect(live(fx.sparks)).toBe(FX.debris.metal.sparks);
  });

  it('reset() vacía todos los pools', () => {
    const fx = new Effects(new THREE.Scene());
    const game = fakeGame();
    fx.bind(game);
    game.bus.emit('explosion', { x: 0, z: 0, radius: 4 });
    game.bus.emit('weapon:fired', { id: 'escopeta' });
    fx.burst(0, 1, 0, 10, 0xffffff);
    fx.update(0.1);
    fx.reset();
    for (const list of [fx.particles, fx.sparks, fx.casings, fx.puffs, fx.rings]) expect(live(list)).toBe(0);
    expect(fx.recoil).toBe(0);
    expect(fx.flashLight.intensity).toBe(0);
    fx.update(0.1);
    expect(fx.puffMesh.count + fx.casingMesh.count + fx.ringMesh.count + fx.sparkMesh.count + fx.particleMesh.count).toBe(0);
  });

  it('dispose() cancela las suscripciones al bus', () => {
    const fx = new Effects(new THREE.Scene());
    const game = fakeGame();
    fx.bind(game);
    fx.dispose();
    game.bus.emit('weapon:fired', { id: 'pistola' });
    expect(live(fx.casings)).toBe(0);
  });
});
