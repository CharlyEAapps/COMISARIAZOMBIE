import * as THREE from 'three';
import weapons from '../data/weapons.json';
import config from '../data/config.json';
import { raycastGrid } from './Physics.js';
import { explode } from './Explosions.js';

const { shotHeight: SHOT_HEIGHT, fireBuffer: FIRE_BUFFER } = config.combat; // el búfer guarda un clic hecho durante la cadencia
const GRENADE = weapons._granada;
const UPG = weapons._upgrades;
export const WEAPON_IDS = Object.keys(weapons)
  .filter((k) => !k.startsWith('_'))
  .sort((a, b) => weapons[a].slot - weapons[b].slot);
const SWITCH_TIME = weapons._switchTime;

/** Mejoras disponibles para un arma (por defecto: daño, cargador y recarga). */
export function tracksOf(def) {
  return def.tracks ?? UPG.defaultTracks;
}

const ZERO_LV = { damage: 0, mag: 0, reload: 0, stun: 0, chain: 0 };

/** Estadísticas efectivas de un arma con sus mejoras (función pura, testeable). */
export function weaponStats(def, lv = ZERO_LV) {
  const t = UPG.tracks;
  const l = { ...ZERO_LV, ...lv };
  return {
    damage: def.damage * (1 + t.damage.perLevel * l.damage),
    magSize: def.magSize ? Math.round(def.magSize * (1 + t.mag.perLevel * l.mag)) : 0,
    reloadTime: def.reloadTime * (1 - t.reload.perLevel * l.reload),
    stun: (def.stun ?? 0) + t.stun.perLevel * l.stun,
    chain: (def.chain ?? 0) + t.chain.perLevel * l.chain,
  };
}

/** Precio de la mejora de nivel `nextLevel` (la pistola es gratis: usa pistolBasePrice). */
export function upgradeCost(def, nextLevel) {
  const base = def.price || UPG.pistolBasePrice;
  return Math.round(base * UPG.costByLevel[nextLevel - 1]);
}

// Armas del policía: inventario (una por ranura 1-7), munición por arma, mejoras (daño,
// cargador, recarga), disparo hitscan (perdigones, perforación, cadena del táser), porra cuerpo
// a cuerpo y granadas con trayectoria parabólica.
export class WeaponSystem {
  constructor(game) {
    this.game = game;
    this.defs = weapons;
    this.owned = new Map();
    this._from = new THREE.Vector3();
    this._to = new THREE.Vector3();
    this._muzzle = new THREE.Vector3(); // boca del arma (no se reutiliza para otros trazos)
    this._exclude = new Set();
    this._chainHit = new Set();
    this.shotBlocked = (i, j) => game.grid.isShotBlocked(i, j);
    this.grenadesInAir = [];
    this.reloadMul = 1; // mejora permanente "Prácticas de tiro"
    this.reset();
  }

  reset() {
    this.owned.clear();
    this.current = null;
    this.give(this.game.player.data.startWeapon);
    this.switchTo(this.game.player.data.startWeapon, true);
    this.grenades = GRENADE.start;
    this.grenadeCooldown = 0;
    this.grenadesInAir.length = 0;
    this.meleeTimer = 0;
  }

  /** Añade un arma al inventario (si ya se tenía, no hace nada). */
  give(id) {
    const d = this.defs[id];
    if (this.owned.has(id)) return this.owned.get(id);
    const w = {
      id, data: d, lv: { ...ZERO_LV }, stats: weaponStats(d),
      mag: d.magSize, reserve: d.reserve, reloading: 0, cooldown: 0, buffer: 0,
    };
    this.owned.set(id, w);
    this.game.bus.emit('weapon:acquired', { id });
    return w;
  }

  has(id) { return this.owned.has(id); }

  get weapon() { return this.owned.get(this.current); }

  switchTo(id, instant = false) {
    if (!this.owned.has(id) || this.current === id) return false;
    const prev = this.weapon;
    if (prev) { prev.reloading = 0; prev.buffer = 0; }
    this.current = id;
    this.weapon.cooldown = instant ? 0 : SWITCH_TIME;
    this.game.bus.emit('weapon:switched', { id });
    return true;
  }

  addAmmo(id, amount) {
    const w = this.owned.get(id);
    if (!w || w.reserve < 0) return 0;
    const max = w.data.maxReserve ?? Infinity;
    const before = w.reserve;
    w.reserve = Math.min(max, w.reserve + amount);
    return w.reserve - before;
  }

  ammoFull(id) {
    const w = this.owned.get(id);
    return !w || w.reserve < 0 || w.reserve >= (w.data.maxReserve ?? Infinity);
  }

  upgradeLevel(id, track) {
    return this.owned.get(id)?.lv[track] ?? 0;
  }

  /** Coste de la siguiente mejora de `track`, o 0 si está al máximo / no aplica / no se tiene el arma. */
  nextUpgradeCost(id, track) {
    const w = this.owned.get(id);
    if (!w || !tracksOf(w.data).includes(track)) return 0;
    const next = w.lv[track] + 1;
    return next > UPG.levels ? 0 : upgradeCost(w.data, next);
  }

  applyUpgrade(id, track) {
    const w = this.owned.get(id);
    if (!w) return false;
    w.lv[track]++;
    const oldMag = w.stats.magSize;
    w.stats = weaponStats(w.data, w.lv);
    if (track === 'mag') w.mag += w.stats.magSize - oldMag; // la parte añadida del cargador viene llena
    return true;
  }

  startReload() {
    const w = this.weapon;
    if (w.data.melee || w.reloading > 0 || w.mag >= w.stats.magSize || w.reserve === 0) return;
    w.reloading = w.reloadTotal = w.stats.reloadTime * this.reloadMul;
    this.game.bus.emit('weapon:reload', { weapon: w });
  }

  canAct() {
    const { game } = this;
    return game.player.alive && !game.build?.active && !game.shop?.open;
  }

  update(dt) {
    const { input, player } = this.game;
    this.grenadeCooldown = Math.max(0, this.grenadeCooldown - dt);
    this.meleeTimer = Math.max(0, this.meleeTimer - dt);
    this.updateGrenades(dt);

    const w = this.weapon;
    w.cooldown = Math.max(0, w.cooldown - dt);
    w.buffer = Math.max(0, w.buffer - dt);
    if (w.reloading > 0) {
      w.reloading -= dt;
      if (w.reloading <= 0) {
        w.reloading = 0;
        const need = w.stats.magSize - w.mag;
        const take = w.reserve < 0 ? need : Math.min(need, w.reserve);
        w.mag += take;
        if (w.reserve >= 0) w.reserve -= take;
        this.game.bus.emit('weapon:reloaded', { weapon: w });
      }
    }
    if (!player.alive) return;

    if (this.canAct()) {
      // Cambio de arma con 1-7 (en modo construcción esas teclas eligen pieza).
      for (const id of WEAPON_IDS) {
        if (input.consume(`weapon${this.defs[id].slot}`)) this.switchTo(id);
      }
      if (input.consume('grenade')) this.throwGrenade();
    }
    if (input.consume('reload')) this.startReload();
    if (!this.canAct()) { this.weapon.buffer = 0; return; }

    const cur = this.weapon;
    const pressed = input.consume('fire');
    if (pressed) cur.buffer = FIRE_BUFFER;
    // Automáticas: disparan mientras se mantiene el botón, y un clic rápido (pulsar y soltar
    // dentro del mismo paso) también cuenta gracias al búfer.
    const wantsFire = cur.data.auto ? input.isHeld('fire') || cur.buffer > 0 : cur.buffer > 0;
    if (!wantsFire || cur.cooldown > 0 || cur.reloading > 0) return;

    if (cur.data.melee) {
      cur.buffer = 0;
      cur.cooldown = 1 / cur.data.fireRate;
      this.melee(cur);
      return;
    }
    if (cur.mag <= 0) {
      // Sin balas ni reserva: solo el clic del gatillo.
      if (cur.reserve === 0 && cur.buffer > 0) { cur.buffer = 0; this.game.bus.emit('weapon:empty'); }
      this.startReload();
      return;
    }
    cur.buffer = 0;
    cur.mag--;
    cur.cooldown = 1 / cur.data.fireRate;
    this.fire(cur);
    if (cur.mag === 0) this.startReload();
  }

  /** Punto de salida del disparo, sin atravesar el muro que el jugador tenga pegado. */
  muzzlePoint() {
    const { player, grid } = this.game;
    const muzzle = player.getMuzzleWorld(this._muzzle);
    const ox = player.position.x, oz = player.position.z;
    const mdx = muzzle.x - ox, mdz = muzzle.z - oz;
    const muzzleDist = Math.hypot(mdx, mdz);
    if (muzzleDist > 1e-4) {
      const wall = raycastGrid(grid, ox, oz, mdx / muzzleDist, mdz / muzzleDist, muzzleDist, this.shotBlocked);
      if (wall < muzzleDist) {
        const k = Math.max(0, wall - 0.08) / muzzleDist;
        muzzle.x = ox + mdx * k;
        muzzle.z = oz + mdz * k;
      }
    }
    return muzzle;
  }

  fire(w) {
    const { game } = this;
    const { player, grid, zombies, effects } = game;
    const d = w.data;
    const muzzle = this.muzzlePoint();
    const ox = player.position.x, oz = player.position.z;
    const aim = Math.atan2(player.aimDir.x, player.aimDir.z);

    for (let p = 0; p < d.pellets; p++) {
      // La escopeta reparte los perdigones por todo el abanico (con algo de azar).
      const t = d.pellets > 1 ? (p + Math.random()) / d.pellets - 0.5 : Math.random() - 0.5;
      const base = aim + THREE.MathUtils.degToRad(d.spreadDeg) * t;
      const dx = Math.sin(base), dz = Math.cos(base);

      // Las balas salen del centro del jugador (no atraviesan el muro que tenga pegado).
      // Un barril explosivo en el camino para la bala y estalla.
      const wallDist0 = raycastGrid(grid, ox, oz, dx, dz, d.range, this.shotBlocked);
      const barrel = game.build.barrelRaycast(ox, oz, dx, dz, wallDist0);
      const wallDist = barrel ? barrel.t : wallDist0;
      let endDist = wallDist;
      let shielded = false;
      this._exclude.clear();
      for (let pierce = 0; pierce <= d.pierce; pierce++) {
        const hit = zombies.raycast(ox, oz, dx, dz, wallDist, this._exclude);
        if (!hit) break;
        // El escudo del jefe para la bala (y la perforación) si le llega de frente.
        if (zombies.shieldBlocks(hit.zombie, dx, dz)) {
          zombies.shieldHit(hit.zombie, dx, dz);
          endDist = hit.t;
          shielded = true;
          break;
        }
        this._exclude.add(hit.zombie);
        zombies.damage(hit.zombie, w.stats.damage, dx, dz, d.knockback);
        effects.burst(hit.zombie.pos.x, 1.2, hit.zombie.pos.z, 7, 0x4a1d1d, { speed: 2.5, dirX: dx, dirZ: dz, size: 0.08 });
        if (d.stun) this.taserChain(hit.zombie, w);
        // Sin perforación restante, la trazadora acaba en este zombi; si no, sigue hasta el muro.
        endDist = pierce === d.pierce ? hit.t : wallDist;
      }
      // El impacto en el muro (chispas y polvo) lo pinta Effects.tracer al detectar el muro.
      if (barrel && !shielded && endDist === wallDist) game.build.detonateBarrel(barrel.s, 0);
      this._to.set(ox + dx * endDist, SHOT_HEIGHT, oz + dz * endDist);
      effects.tracer(muzzle, this._to, d.tracerColor);
    }
    effects.muzzleFlash(muzzle);
    effects.shake(d.shake);
    game.bus.emit('weapon:fired', { weapon: d, id: w.id });
  }

  /** Táser: aturde al zombi alcanzado y salta a los más cercanos (sin atravesar muros). */
  taserChain(first, w) {
    const { zombies, effects, grid } = this.game;
    const d = w.data, st = w.stats;
    zombies.stun(first, st.stun);
    let from = first;
    const hit = this._chainHit;
    hit.clear();
    hit.add(first);
    for (let n = 0; n < st.chain; n++) {
      let best = null, bestD = d.chainRange;
      for (const z of zombies.active) {
        if (z.state !== 0 || hit.has(z)) continue;
        const dx = z.pos.x - from.pos.x, dz = z.pos.z - from.pos.z;
        const dd = Math.hypot(dx, dz);
        if (dd >= bestD || dd < 1e-4 || zombies.shieldBlocks(z, dx / dd, dz / dd)) continue;
        if (raycastGrid(grid, from.pos.x, from.pos.z, dx / dd, dz / dd, dd, this.shotBlocked) < dd) continue;
        bestD = dd; best = z;
      }
      if (!best) break;
      hit.add(best);
      zombies.stun(best, st.stun);
      zombies.damage(best, st.damage * d.chainDamageMul);
      this._from.set(from.pos.x, 1.2, from.pos.z);
      this._to.set(best.pos.x, 1.2, best.pos.z);
      effects.tracer(this._from, this._to, d.tracerColor);
      from = best;
    }
  }

  /** Porra: golpea a todos los zombis dentro del arco frontal. */
  melee(w) {
    const { player, zombies, effects, grid } = this.game;
    const d = w.data;
    this.meleeTimer = 1 / d.fireRate;
    const ox = player.position.x, oz = player.position.z;
    const ax = player.aimDir.x, az = player.aimDir.z;
    const cosArc = Math.cos(THREE.MathUtils.degToRad(d.arcDeg / 2));
    let hits = 0;
    for (const z of zombies.active) {
      if (z.state !== 0) continue;
      const dx = z.pos.x - ox, dz = z.pos.z - oz;
      const dist = Math.hypot(dx, dz);
      if (dist - z.radius > d.range || dist < 1e-4) continue;
      if ((dx * ax + dz * az) / dist < cosArc) continue;
      if (raycastGrid(grid, ox, oz, dx / dist, dz / dist, dist, this.shotBlocked) < dist) continue;
      if (zombies.shieldBlocks(z, dx / dist, dz / dist)) { zombies.shieldHit(z, dx / dist, dz / dist); continue; }
      zombies.damage(z, w.stats.damage, dx / dist, dz / dist, d.knockback);
      effects.burst(z.pos.x, 1.2, z.pos.z, 6, 0x4a1d1d, { speed: 2, dirX: dx / dist, dirZ: dz / dist, size: 0.08 });
      hits++;
    }
    if (hits) effects.shake(d.shake);
    this.game.bus.emit('weapon:melee', { hits });
  }

  // ------------------------------------------------------------------ granadas
  throwGrenade() {
    if (this.grenades <= 0 || this.grenadeCooldown > 0 || this.grenadesInAir.length >= GRENADE.maxInAir) return;
    const { player, aimPoint, grid } = this.game;
    const ox = player.position.x, oz = player.position.z;
    let dx = aimPoint.x - ox, dz = aimPoint.z - oz;
    let dist = Math.hypot(dx, dz);
    if (dist < 1e-3) { dx = player.aimDir.x; dz = player.aimDir.z; dist = 1; }
    dx /= dist; dz /= dist;
    dist = Math.min(dist, GRENADE.maxRange);
    // Pasa por encima de lo bajo (sacos, mesas, vallas) y se detiene antes del primer obstáculo
    // alto (muros, puertas cerradas, coches), sin acabar nunca dentro de él.
    const wall = raycastGrid(grid, ox, oz, dx, dz, dist, this.shotBlocked);
    if (wall < dist) dist = Math.max(0, wall - GRENADE.wallMargin);
    const flight = Math.max(GRENADE.minFlight, dist / GRENADE.throwSpeed);
    this.grenades--;
    this.grenadeCooldown = GRENADE.cooldown;
    this.grenadesInAir.push({
      x0: ox, z0: oz, x1: ox + dx * dist, z1: oz + dz * dist, t: 0, flight,
      fuse: GRENADE.fuse, x: ox, y: GRENADE.handHeight, z: oz, spin: 0,
    });
    this.game.bus.emit('grenade:thrown');
  }

  updateGrenades(dt) {
    const list = this.grenadesInAir;
    for (let n = list.length - 1; n >= 0; n--) {
      const g = list[n];
      g.t += dt;
      g.fuse -= dt;
      const k = Math.min(1, g.t / g.flight);
      g.x = g.x0 + (g.x1 - g.x0) * k;
      g.z = g.z0 + (g.z1 - g.z0) * k;
      // Parábola: sale a la altura de la mano, sube y cae al suelo.
      const G = GRENADE;
      g.y = k < 1
        ? G.handHeight * (1 - k) + Math.sin(k * Math.PI) * Math.min(G.arcHeight, g.flight * G.arcPerSecond) + G.groundY * k
        : G.groundY;
      g.spin += dt * (k < 1 ? G.spin : 0);
      if (g.fuse <= 0) {
        list.splice(n, 1);
        explode(this.game, g.x, g.z, GRENADE);
      }
    }
  }
}
