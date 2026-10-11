import * as THREE from 'three';
import weapons from '../data/weapons.json';
import config from '../data/config.json';
import { raycastGrid } from './Physics.js';
import { explode } from './Explosions.js';
import { Burning } from './Burning.js';
import { weaponGlowGeometry } from '../render/WeaponModels.js';

const { shotHeight: SHOT_HEIGHT, fireBuffer: FIRE_BUFFER } = config.combat; // el búfer guarda un clic hecho durante la cadencia
const GRENADE = weapons._granada;
const UPG = weapons._upgrades;
export const WEAPON_IDS = Object.keys(weapons)
  .filter((k) => !k.startsWith('_'))
  .sort((a, b) => weapons[a].slot - weapons[b].slot);
const SWITCH_TIME = weapons._switchTime;
const FX = weapons._fx;
const MAX_DEFLECTED = 8; // escupitajos devueltos a la vez (el AcidSystem tiene 32 proyectiles)

/** Mejoras disponibles para un arma (por defecto: daño, cargador y recarga). */
export function tracksOf(def) {
  return def.tracks ?? UPG.defaultTracks;
}

const ZERO_LV = { damage: 0, mag: 0, reload: 0, stun: 0, chain: 0, heat: 0, cool: 0, reach: 0 };

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
    // Armas de calor (rifle láser): calor por disparo y velocidad de enfriamiento.
    heatPerShot: def.heat ? def.heat.perShot * (1 - t.heat.perLevel * l.heat) : 0,
    coolRate: def.heat ? def.heat.coolRate * (1 + t.cool.perLevel * l.cool) : 0,
    lockedCoolRate: def.heat ? def.heat.coolRate * (1 + t.cool.perLevel * l.cool) * def.heat.lockedMul : 0,
    // Alcance (sable) y quemadura (lanzallamas: crece con el daño).
    range: (def.range ?? 0) * (1 + t.reach.perLevel * l.reach),
    burnDps: def.burn ? def.burn.dps * (1 + t.damage.perLevel * l.damage) : 0,
    burnTime: def.burn?.duration ?? 0,
  };
}

// ---------------------------------------------------------------------- lógica pura (testeable)

/**
 * Un disparo del arma de calor `w` ({ heat, locked, coolWait, stats, data }): sube el calor y
 * reinicia la espera de enfriamiento. Devuelve true si con este disparo se bloquea (100 %).
 */
export function heatAfterShot(w) {
  w.heat = Math.min(1, w.heat + w.stats.heatPerShot);
  w.coolWait = w.data.heat.coolDelay;
  if (w.heat >= 1) { w.locked = true; return true; }
  return false;
}

/**
 * Enfría el arma de calor `w` durante `dt`: tras `coolDelay` sin disparar baja a `coolRate`; si
 * está bloqueada baja a `lockedCoolRate` desde el primer instante y no se desbloquea hasta llegar
 * a 0. Devuelve true en el instante en que termina de enfriarse un bloqueo.
 */
export function heatStep(w, dt) {
  if (w.locked) {
    w.heat = Math.max(0, w.heat - w.stats.lockedCoolRate * dt);
    if (w.heat <= 0) { w.locked = false; w.coolWait = 0; return true; }
    return false;
  }
  if (w.heat <= 0) return false;
  if (w.coolWait > 0) {
    if (dt <= w.coolWait) { w.coolWait -= dt; return false; }
    dt -= w.coolWait; // lo que sobra de este paso ya enfría
    w.coolWait = 0;
  }
  w.heat = Math.max(0, w.heat - w.stats.coolRate * dt);
  return false;
}

/**
 * ¿Cae un objetivo dentro del arco frontal? (a = dirección de apuntado normalizada, d = vector al
 * objetivo con longitud `dist`, `radius` = radio del objetivo, `range` = alcance desde el borde,
 * `cosHalf` = coseno de la mitad del arco). Usado por la porra y el sable.
 */
export function inArc(ax, az, dx, dz, dist, radius, range, cosHalf) {
  if (dist < 1e-4 || dist - radius > range) return false;
  return (dx * ax + dz * az) / dist >= cosHalf;
}

/**
 * ¿Cae dentro de un cono (lanzallamas)? Como `inArc`, pero el cono se ensancha lo que mide el
 * objetivo: un zombi grande a poca distancia se ve alcanzado aunque su centro quede fuera.
 */
export function inCone(ax, az, dx, dz, dist, radius, range, halfRad) {
  if (dist < 1e-4) return true;
  if (dist - radius > range) return false;
  const widen = dist > radius ? Math.asin(Math.min(1, radius / dist)) : Math.PI / 2;
  const c = (dx * ax + dz * az) / dist;
  return Math.acos(Math.max(-1, Math.min(1, c))) <= halfRad + widen;
}

/** Alcance y ángulo de la asistencia de apuntado táctil para un arma (valor propio o el global de `touch`). */
export function assistParams(def, touch) {
  const a = def?.assist;
  return { range: a?.range ?? touch.assistRange, angleDeg: a?.angleDeg ?? touch.assistAngleDeg };
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
    this.burning = new Burning(game);
    this.deflected = []; // escupitajos devueltos por el sable: { b, x1, z1 }
    this.deflectCd = 0;
    this._flameShieldT = 0;
    this._unsub = [];
    this.initGlow();
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
    this.burning.reset();
    this.deflected.length = 0;
    this.deflectCd = 0;
  }

  // ------------------------------------------------------------------ partes luminosas del arma
  /** Malla aditiva pegada al arma de la mano (bobinas del láser, hoja del sable, piloto del lanzallamas). */
  initGlow() {
    this.glowGeos = new Map();
    this.glow = null;
    const mount = this.game.player?.weaponMesh;
    if (!mount) return;
    this.glowMat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: FX.glow.opacity, blending: THREE.AdditiveBlending,
      depthWrite: false, fog: false,
    });
    this.glow = new THREE.Mesh(new THREE.BufferGeometry(), this.glowMat);
    this.glow.visible = false;
    this.glow.frustumCulled = false;
    mount.add(this.glow);
    this._unsub.push(this.game.bus.on('weapon:switched', ({ id }) => this.setGlow(id)));
  }

  setGlow(id) {
    if (!this.glow) return;
    if (!this.glowGeos.has(id)) this.glowGeos.set(id, weaponGlowGeometry(id));
    const g = this.glowGeos.get(id);
    if (g) this.glow.geometry = g;
    this.glow.visible = !!g;
    this.glowMat.color.set(0xffffff);
    this.glowMat.opacity = FX.glow.opacity;
  }

  /** Brillo vivo: el halo del sable zumba, las bobinas del láser pasan de rojo a blanco con el calor. */
  updateGlow() {
    if (!this.glow?.visible) return;
    const w = this.weapon, t = this.game.time ?? 0;
    if (w.id === 'sable') {
      const S = FX.saber;
      this.glowMat.color.set(S.glowColor);
      this.glowMat.opacity = S.glowOpacity * (1 - S.flickerAmp + S.flickerAmp * Math.sin(t * S.flicker));
    } else if (w.data.heat) {
      const L = FX.laser;
      this.glowMat.color.set(L.glowCool).lerp(this._hot ??= new THREE.Color(L.glowHot), w.locked ? 1 : w.heat);
      this.glowMat.opacity = FX.glow.opacity * (0.55 + 0.45 * w.heat);
    } else if (w.data.coneDeg) {
      this.glowMat.opacity = FX.glow.opacity * (0.7 + 0.3 * Math.sin(t * 40));
    }
  }

  dispose() {
    for (const off of this._unsub) off();
    this._unsub.length = 0;
    this.glow?.removeFromParent();
    for (const g of this.glowGeos?.values() ?? []) g?.dispose();
    this.glow?.geometry.dispose();
    this.glowMat?.dispose();
  }

  /** Añade un arma al inventario (si ya se tenía, no hace nada). */
  give(id) {
    const d = this.defs[id];
    if (this.owned.has(id)) return this.owned.get(id);
    const w = {
      id, data: d, lv: { ...ZERO_LV }, stats: weaponStats(d),
      mag: d.magSize, reserve: d.reserve, reloading: 0, cooldown: 0, buffer: 0,
      heat: 0, locked: false, coolWait: 0, smokeT: 0, // solo las armas de calor
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
    if (w.data.melee || w.data.heat || w.reloading > 0 || w.mag >= w.stats.magSize || w.reserve === 0) return;
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
    this._flameShieldT = Math.max(0, this._flameShieldT - dt);
    this.updateGrenades(dt);
    this.burning.update(dt);
    this.updateHeat(dt);
    this.updateGlow();

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
    this.updateDeflect(dt);

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
    // Con joystick (táctil o mando) mantener dispara también las semiautomáticas a su cadencia.
    const wantsFire = cur.data.auto || input.analog ? input.isHeld('fire') || cur.buffer > 0 : cur.buffer > 0;
    if (!wantsFire || cur.cooldown > 0 || cur.reloading > 0) return;

    if (cur.data.melee) {
      cur.buffer = 0;
      cur.cooldown = 1 / cur.data.fireRate;
      this.melee(cur);
      return;
    }
    if (cur.data.heat) {
      // Arma de calor: munición infinita, pero bloqueada hasta enfriarse del todo tras el 100 %.
      cur.buffer = 0;
      if (cur.locked) {
        cur.cooldown = cur.data.heat.lockClick;
        this.game.bus.emit('weapon:locked', { id: cur.id });
        return;
      }
      cur.cooldown = 1 / cur.data.fireRate;
      this.fire(cur);
      if (heatAfterShot(cur)) this.game.bus.emit('weapon:overheat', { id: cur.id });
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
    if (cur.data.coneDeg) this.flame(cur); else this.fire(cur);
    if (cur.mag === 0) this.startReload();
  }

  /** Enfría todas las armas de calor (también las guardadas) y echa humo si la actual está caliente. */
  updateHeat(dt) {
    const { game } = this;
    for (const w of this.owned.values()) {
      if (!w.data.heat) continue;
      if (heatStep(w, dt)) game.bus.emit('weapon:cooled', { id: w.id });
    }
    const w = this.weapon;
    const H = w?.data.heat;
    if (!H || !game.effects || !game.player.alive) return;
    if (!w.locked && w.heat < H.warnAt) { w.smokeT = 0; return; }
    if ((w.smokeT -= dt) > 0) return;
    w.smokeT = w.locked ? H.smokeEvery : H.smokeEvery * 3;
    const S = FX.laser.smoke, m = this.muzzlePoint();
    game.effects.puff(
      m.x, m.y + 0.03, m.z, (Math.random() - 0.5) * 0.4, S.rise * (0.7 + Math.random() * 0.6), (Math.random() - 0.5) * 0.4,
      S.size, S.size * S.grow, S.life * (0.8 + Math.random() * 0.4), S.alpha, S.color, 1.6, 0,
    );
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
        effects.burst(hit.zombie.pos.x, 1.2, hit.zombie.pos.z, 7, d.hitColor ?? 0x4a1d1d, { speed: 2.5, dirX: dx, dirZ: dz, size: 0.08 });
        if (d.beam) effects.sparkBurst(hit.zombie.pos.x, 1.2, hit.zombie.pos.z, -dx, -dz, FX.laser.impactSparks, 4, 1.5, d.hitColor, 0.25, 0.04);
        if (d.stun) this.taserChain(hit.zombie, w);
        // Sin perforación restante, la trazadora acaba en este zombi; si no, sigue hasta el muro.
        endDist = pierce === d.pierce ? hit.t : wallDist;
      }
      // El impacto en el muro (chispas y polvo) lo pinta Effects.tracer al detectar el muro.
      if (barrel && !shielded && endDist === wallDist) game.build.detonateBarrel(barrel.s, 0);
      this._to.set(ox + dx * endDist, SHOT_HEIGHT, oz + dz * endDist);
      effects.tracer(muzzle, this._to, d.tracerColor, d.beam?.width, d.beam?.life);
      if (d.beam?.core) effects.tracer(muzzle, this._to, d.beam.core.color, d.beam.core.width, d.beam.life);
    }
    effects.muzzleFlash(muzzle, d.flashColor);
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

  /** Cuerpo a cuerpo (porra, sable): golpea a todos los zombis dentro del arco frontal. */
  melee(w) {
    const { player, zombies, effects, grid } = this.game;
    const d = w.data;
    this.meleeTimer = 1 / d.fireRate;
    const ox = player.position.x, oz = player.position.z;
    const ax = player.aimDir.x, az = player.aimDir.z;
    const cosArc = Math.cos(THREE.MathUtils.degToRad(d.arcDeg / 2));
    const range = w.stats.range;
    const hitColor = d.hitColor ?? 0x4a1d1d;
    let hits = 0;
    for (const z of zombies.active) {
      if (z.state !== 0) continue;
      const dx = z.pos.x - ox, dz = z.pos.z - oz;
      const dist = Math.hypot(dx, dz);
      if (!inArc(ax, az, dx, dz, dist, z.radius, range, cosArc)) continue;
      if (raycastGrid(grid, ox, oz, dx / dist, dz / dist, dist, this.shotBlocked) < dist) continue;
      if (zombies.shieldBlocks(z, dx / dist, dz / dist)) { zombies.shieldHit(z, dx / dist, dz / dist); continue; }
      zombies.damage(z, w.stats.damage, dx / dist, dz / dist, d.knockback);
      effects.burst(z.pos.x, 1.2, z.pos.z, 6, hitColor, { speed: 2, dirX: dx / dist, dirZ: dz / dist, size: 0.08 });
      if (d.deflect) effects.sparkBurst(z.pos.x, 1.2, z.pos.z, -dx / dist, -dz / dist, FX.laser.impactSparks, 4, 1.5, hitColor, 0.25, 0.04);
      hits++;
    }
    if (d.deflect) this.slashFx(ax, az, d.arcDeg, range);
    if (hits) effects.shake(d.shake);
    this.game.bus.emit('weapon:melee', { hits, id: w.id });
  }

  /** Estela del sable: chispas a lo largo del arco, en el sentido del golpe. */
  slashFx(ax, az, arcDeg, range) {
    const { effects, player } = this.game;
    if (!effects) return;
    const S = FX.saber, half = THREE.MathUtils.degToRad(arcDeg / 2) * 0.9;
    const base = Math.atan2(ax, az), px = player.position.x, pz = player.position.z;
    const r = Math.min(range, S.radius * range);
    for (let n = 0; n < S.sparks; n++) {
      const a = base - half + (n / (S.sparks - 1)) * 2 * half; // de un lado al otro
      const sx = Math.sin(a), sz = Math.cos(a);
      // Cada chispa sigue la tangente del arco (sentido del barrido) con algo de empuje hacia fuera.
      effects.spark(
        px + sx * r, S.height, pz + sz * r, sz * S.speed * 0.5 + sx * 0.8, 0.2, -sx * S.speed * 0.5 + sz * 0.8,
        S.colors[n % S.colors.length], S.life, S.width, 0,
      );
    }
  }

  // ------------------------------------------------------------------ lanzallamas
  /**
   * Un "tic" del lanzallamas: cono corto delante. Daña y prende a todos los zombis dentro del
   * cono con línea de tiro (el escudo del jefe lo para) y enciende el barril que apunta el cono.
   */
  flame(w) {
    const { game } = this;
    const { player, zombies, grid } = game;
    const d = w.data, F = FX.flame;
    const ox = player.position.x, oz = player.position.z;
    const ax = player.aimDir.x, az = player.aimDir.z;
    const half = THREE.MathUtils.degToRad(d.coneDeg / 2);
    // Las llamas no pasan los muros: el alcance se recorta contra ellos (y contra un barril).
    const wall = raycastGrid(grid, ox, oz, ax, az, d.range, this.shotBlocked);
    const barrel = game.build?.barrelRaycast(ox, oz, ax, az, wall);
    const reach = barrel ? barrel.t : wall;
    for (const z of zombies.active) {
      if (z.state !== 0) continue;
      const dx = z.pos.x - ox, dz = z.pos.z - oz;
      const dist = Math.hypot(dx, dz);
      if (!inCone(ax, az, dx, dz, dist, z.radius, reach, half)) continue;
      const ux = dx / (dist || 1), uz = dz / (dist || 1);
      if (dist > 1e-4 && raycastGrid(grid, ox, oz, ux, uz, dist, this.shotBlocked) < dist) continue;
      if (zombies.shieldBlocks(z, ux, uz)) {
        if (this._flameShieldT <= 0) { this._flameShieldT = F.shieldMsg; zombies.shieldHit(z, ux, uz); }
        continue;
      }
      // Daño continuo en silencio (sin destello blanco ni empujón): el brillo lo pone la quemadura.
      zombies.damage(z, w.stats.damage, ux, uz, d.knockback, true);
      this.burning.ignite(z, w.stats.burnTime, w.stats.burnDps);
    }
    if (barrel) game.build.detonateBarrel(barrel.s, 0);
    this.flameFx(reach);
    game.bus.emit('weapon:fired', { weapon: d, id: w.id });
  }

  /** Chorro de llamas: chispas aditivas en abanico, una bocanada naranja que se vuelve humo y luz parpadeante. */
  flameFx(reach) {
    const { effects, player } = this.game;
    if (!effects) return;
    const d = this.weapon.data, F = FX.flame;
    const m = this.muzzlePoint();
    const aim = Math.atan2(player.aimDir.x, player.aimDir.z);
    const half = THREE.MathUtils.degToRad(d.coneDeg / 2);
    const [v0, v1] = F.speed;
    for (let n = 0; n < F.sparks; n++) {
      const a = aim + (Math.random() * 2 - 1) * half * 0.9;
      // Las chispas mueren a la distancia del alcance (más cerca si hay un muro delante).
      const v = Math.min(v0 + Math.random() * (v1 - v0), (reach / F.life) * (0.8 + Math.random() * 0.3));
      effects.spark(m.x, m.y, m.z, Math.sin(a) * v, (Math.random() - 0.3) * 0.8, Math.cos(a) * v,
        F.colors[(Math.random() * F.colors.length) | 0], F.life, F.width, 0);
    }
    for (let n = 0; n < F.puffs; n++) {
      const a = aim + (Math.random() * 2 - 1) * half * 0.6, v = v0 * 0.55;
      effects.puff(m.x, m.y, m.z, Math.sin(a) * v, 0.7, Math.cos(a) * v, F.puffSize[0], F.puffSize[1], F.puffLife, F.puffAlpha, F.puffColor, 1.5, 0, F.puffColor2);
    }
    effects.muzzleFlash(m, F.flashColor);
    effects.shake(d.shake);
  }

  // ------------------------------------------------------------------ sable: desvío de escupitajos
  /**
   * Con el sable en la mano, los escupitajos de ácido que llegan hacia el arco frontal rebotan
   * hacia quien los lanzó (y le dañan al caer). También se resuelven los ya devueltos.
   */
  updateDeflect(dt) {
    const acid = this.game.acid;
    if (!acid) return;
    for (let n = this.deflected.length - 1; n >= 0; n--) {
      const e = this.deflected[n], b = e.b;
      if (b.active && b.deflected && b.x1 === e.x1 && b.z1 === e.z1) continue; // sigue volando
      b.deflected = false;
      this.deflected.splice(n, 1);
      this.deflectLanded(e.x1, e.z1, e.D);
    }
    this.deflectCd = Math.max(0, this.deflectCd - dt);
    const D = this.weapon?.data.deflect;
    if (!D || !this.canAct() || this.deflectCd > 0) return;
    const { player } = this.game;
    const px = player.position.x, pz = player.position.z;
    const ax = player.aimDir.x, az = player.aimDir.z;
    const cosHalf = Math.cos(THREE.MathUtils.degToRad(D.arcDeg / 2));
    for (const b of acid.blobs) {
      if (!b.active || b.deflected || b.y > D.height || this.deflected.length >= MAX_DEFLECTED) continue;
      const dx = b.x - px, dz = b.z - pz;
      const dist = Math.hypot(dx, dz);
      if (dist > D.range || dist < 1e-4) continue;
      if ((dx * ax + dz * az) / dist < cosHalf) continue;
      // Solo si viene hacia Carlos (no si ya se aleja).
      if ((b.x1 - b.x0) * -dx + (b.z1 - b.z0) * -dz <= 0) continue;
      this.deflectBlob(b, D);
      this.deflectCd = D.cooldown;
    }
  }

  /** Devuelve el proyectil hacia donde salió (o hacia atrás de su trayectoria). */
  deflectBlob(b, D) {
    const { effects, floating, bus } = this.game;
    let tx = b.x0, tz = b.z0;
    if (Math.hypot(tx - b.x, tz - b.z) < 1) { tx = b.x - (b.x1 - b.x) * 4; tz = b.z - (b.z1 - b.z) * 4; }
    const dist = Math.hypot(tx - b.x, tz - b.z);
    b.x0 = b.x; b.z0 = b.z; b.x1 = tx; b.z1 = tz; b.h0 = b.y; b.t = 0;
    b.flight = Math.max(b.sp.minFlight, dist / (b.sp.speed * D.speedMul));
    b.deflected = true;
    this.deflected.push({ b, x1: tx, z1: tz, D });
    effects?.sparkBurst(b.x, b.y, b.z, 0, 0, FX.laser.impactSparks * 2, 5, 1.5, FX.saber.deflectColor, 0.3, 0.05, 1);
    floating?.spawn(D.text, b.x, 1.8, b.z, 'quip', 0.9);
    bus.emit('weapon:deflect', { x: b.x, z: b.z });
  }

  /** Un escupitajo devuelto ha caído: daña a los zombis de alrededor. */
  deflectLanded(x, z, D) {
    const { zombies, effects } = this.game;
    for (const zb of zombies.active) {
      if (zb.state !== 0) continue;
      if (Math.hypot(zb.pos.x - x, zb.pos.z - z) - zb.radius > D.radius) continue;
      zombies.damage(zb, D.damage, 0, 0, 0);
    }
    effects?.burst(x, 0.4, z, 8, FX.saber.deflectColor, { speed: 2.5, up: 2.5, size: 0.08, life: 0.5 });
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
