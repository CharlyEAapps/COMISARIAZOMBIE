import { raycastGrid } from './Physics.js';
import config from '../data/config.json';

/**
 * Explosión en (x, z): daña a los zombis y al jugador con línea de tiro desde el centro
 * (no atraviesa muros, puertas cerradas ni coches) y con caída lineal hasta el borde.
 * Si `structureDamage` > 0 (zombis explosivos), también daña las construcciones y el
 * transformador al alcance (solo los muros del mapa las protegen). Los barriles explosivos
 * del radio estallan siempre en cadena.
 * @param {object} game
 * @param {{damage:number, radius:number, falloff:number, knockback:number, playerDamageMul:number,
 *   structureDamage?:number, color?:string|number}} o
 * @returns {number} zombis alcanzados
 */
export function explode(game, x, z, o) {
  const { grid, zombies, effects, player } = game;
  const R = o.radius, F = o.falloff;
  const blocked = game.weapons.shotBlocked;
  const exposed = (px, pz, d) => d < 1e-3 || raycastGrid(grid, x, z, (px - x) / d, (pz - z) / d, d, blocked) >= d;
  let hits = 0;
  for (const zb of zombies.active) {
    if (zb.state !== 0) continue;
    const d = Math.hypot(zb.pos.x - x, zb.pos.z - z);
    if (d > R + zb.radius * 0.5 || !exposed(zb.pos.x, zb.pos.z, d)) continue;
    const k = 1 - Math.min(1, d / R) * F;
    const dx = (zb.pos.x - x) / (d || 1), dz = (zb.pos.z - z) / (d || 1);
    zombies.damage(zb, o.damage * k * (zb.data.explosionDamageMul ?? 1), dx, dz, o.knockback * k);
    hits++;
  }
  const dp = Math.hypot(player.position.x - x, player.position.z - z);
  if (dp < R && exposed(player.position.x, player.position.z, dp)) {
    player.damage(o.damage * o.playerDamageMul * (1 - (dp / R) * F));
  }
  game.build?.blast(x, z, R, o.structureDamage ?? 0, F);
  effects.burst(x, 0.4, z, 40, o.color ?? 0xff9a2a, { speed: 6, up: 6, size: 0.1, life: 0.7 });
  effects.burst(x, 0.4, z, 25, 0x2a2a2a, { speed: 3, up: 5, size: 0.16, life: 1.6 });
  effects.muzzleFlash({ x, y: 1.2, z });
  effects.shake(config.combat.explosionShake);
  game.bus.emit('explosion', { x, z, radius: R });
  return hits;
}

/**
 * Explosiones diferidas (reacciones en cadena de barriles y zombis explosivos): cada una
 * estalla un instante después de la anterior, así la cadena se ve y no hay recursión.
 */
export class BlastQueue {
  constructor(game) {
    this.game = game;
    this.list = [];
  }

  schedule(x, z, opts, delay) {
    this.list.push({ x, z, opts, timer: delay });
  }

  update(dt) {
    const list = this.list;
    for (let n = list.length - 1; n >= 0; n--) {
      const b = list[n];
      b.timer -= dt;
      if (b.timer > 0) continue;
      list.splice(n, 1);
      explode(this.game, b.x, b.z, b.opts);
    }
  }

  reset() {
    this.list.length = 0;
  }
}
