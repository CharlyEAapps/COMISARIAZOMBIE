import * as THREE from 'three';
import weapons from '../data/weapons.json';

const CFG = weapons._fx.burn;
const GLOW = new THREE.Color(CFG.glowColor);
const FLAMES = CFG.flameColors.map((c) => new THREE.Color(c));
const DEFAULT_POOL = 128;
const ALIVE = 0; // Z_STATE.CHASE (se evita importar ZombieSystem para no cargar el render en los tests)

/** Mezcla del color de un zombi quemándose: tizne que va oscureciendo + brillo naranja parpadeante (función pura). */
export function burnColor(out, base, { soot, glow }) {
  const s = 1 - (1 - CFG.sootMul) * soot;
  out.copy(base).multiplyScalar(s);
  if (glow > 0) out.lerp(GLOW, glow);
  return out;
}

/**
 * Zombis quemados (lanzallamas): daño por tiempo, brillo naranja mientras arden y tizne
 * permanente después (sin gore). Los zombis son del pool de ZombieSystem y se reciclan, así que
 * la quemadura vive en una entrada propia (`zb._burn`) que se comprueba siempre contra su zombi.
 *
 *  - `ignite(zb, seconds, dps)` enciende o renueva (no se acumula: manda el mayor dps).
 *  - `update(dt)` aplica el daño, anima el color de `zb.colors` y suelta llamitas.
 */
export class Burning {
  /** @param {{zombies:{pool?:object[], damage:Function}, effects?:object, time?:number}} game */
  constructor(game) {
    this.game = game;
    const n = game.zombies?.pool?.length ?? DEFAULT_POOL;
    this.free = Array.from({ length: n }, () => ({ active: false, zb: null, left: 0, total: 0, dps: 0, acc: 0, base: [], seed: 0 }));
    this.list = [];
  }

  /** ¿Está ardiendo este zombi ahora mismo? */
  isBurning(zb) {
    const e = zb._burn;
    return !!e && e.active && e.zb === zb;
  }

  ignite(zb, seconds, dps) {
    if (zb.state !== ALIVE) return false;
    let e = zb._burn;
    if (!e || !e.active || e.zb !== zb) {
      e = this.free.pop();
      if (!e) return false;
      e.active = true; e.zb = zb; e.acc = 0; e.seed = zb.id * 0.7;
      e.total = e.left = seconds;
      e.dps = dps;
      // Guarda el color de partida de cada parte (los zombis sooted antes parten de su color actual).
      while (e.base.length < zb.colors.length) e.base.push(new THREE.Color());
      for (let k = 0; k < zb.colors.length; k++) e.base[k].copy(zb.colors[k]);
      zb._burn = e;
      this.list.push(e);
      return true;
    }
    e.left = Math.max(e.left, seconds);
    e.total = Math.max(e.total, e.left);
    e.dps = Math.max(e.dps, dps);
    return true;
  }

  /** Termina una quemadura dejando el tizne final en los colores del zombi. */
  finish(i) {
    const e = this.list[i];
    const zb = e.zb;
    if (zb && zb._burn === e) {
      for (let k = 0; k < zb.colors.length; k++) burnColor(zb.colors[k], e.base[k], { soot: 1, glow: 0 });
      zb._burn = null;
    }
    e.active = false; e.zb = null;
    this.free.push(e);
    this.list[i] = this.list[this.list.length - 1];
    this.list.pop();
  }

  update(dt) {
    const { game, list } = this;
    const time = game.time ?? 0;
    let flames = CFG.flamesPerStep;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i], zb = e.zb;
      if (!zb || !zb.active || zb.state !== ALIVE || zb._burn !== e) { this.finish(i); continue; }
      e.left -= dt;
      game.zombies.damage(zb, e.dps * dt, 0, 0, 0, true);
      if (zb.state !== ALIVE) { this.finish(i); continue; }
      if (e.left <= 0) { this.finish(i); continue; }
      // Color: el tizne sube con el tiempo ardiendo; el brillo parpadea y se apaga al final.
      const soot = Math.min(1, (e.total - e.left) / CFG.sootTime);
      const fade = Math.min(1, e.left / CFG.fade);
      const glow = CFG.glow * fade * (0.75 + 0.25 * Math.sin(time * CFG.flicker + e.seed));
      for (let k = 0; k < zb.colors.length; k++) burnColor(zb.colors[k], e.base[k], { soot, glow });
      // Llamitas sobre el cuerpo (con presupuesto por paso).
      e.acc += dt * CFG.flameRate;
      if (e.acc >= 1 && flames > 0 && game.effects) {
        e.acc -= 1;
        flames--;
        const c = FLAMES[(Math.random() * FLAMES.length) | 0];
        const h = zb.scale * (0.5 + Math.random() * 1.1);
        game.effects.spark(
          zb.pos.x + (Math.random() - 0.5) * 0.35, h, zb.pos.z + (Math.random() - 0.5) * 0.35,
          (Math.random() - 0.5) * 0.6, CFG.flameRise * (0.7 + Math.random() * 0.6), (Math.random() - 0.5) * 0.6,
          c, CFG.flameLife, CFG.flameWidth, 0,
        );
      } else if (e.acc > 2) e.acc = 2;
    }
  }

  /** Apaga todo (nueva partida): los zombis conservan el color que tengan. */
  reset() {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (e.zb && e.zb._burn === e) e.zb._burn = null;
      e.active = false; e.zb = null;
      this.free.push(e);
    }
    this.list.length = 0;
  }
}
