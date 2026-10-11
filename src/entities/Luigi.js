import { raycastGrid, resolveCircleVsGrid } from '../systems/Physics.js';

// Luigi, el chihuahua de la comisaría (mejora del despacho en la sala de descanso). Va pegado a
// Carlos; si un zombi se le acerca, corre a morderle. No puede morir: los zombis no le hacen
// caso y, si alguno le suelta un manotazo, sale despedido con un gañido y vuelve a la carga.
// Lógica en pasos fijos y sin asignaciones; lo que se ve lo pinta render/LuigiRenderer.js.
// Los datos (velocidades, alcances, daño por nivel...) están en despacho.json → upgrades.luigi.

export const LUIGI_MODE = { FOLLOW: 0, CHASE: 1, RETURN: 2 };

/** Valor de una tabla por nivel (`arr[level - 1]`), o `def` con nivel 0. */
const byLevel = (arr, level, def) => (level > 0 ? arr[Math.min(level, arr.length) - 1] : def);

/**
 * Zombi vivo más cercano al punto (px, pz) dentro de `range`, o null (función pura).
 * @param {{state:number, pos:{x:number,z:number}}[]} zombies
 */
export function nearestThreat(zombies, px, pz, range) {
  let best = null, bestD = range;
  for (const z of zombies) {
    if (z.state !== 0) continue;
    const d = Math.hypot(z.pos.x - px, z.pos.z - pz);
    if (d <= bestD) { bestD = d; best = z; }
  }
  return best;
}

/**
 * Modo de Luigi (función pura): vuelve con Carlos si se ha alejado más de `leash` (y no deja de
 * volver hasta estar a `followDist`); si no, persigue a la amenaza si la hay.
 */
export function luigiMode(mode, distToCarlos, hasThreat, cfg) {
  if (mode === LUIGI_MODE.RETURN && distToCarlos > cfg.followDist * 1.5) return LUIGI_MODE.RETURN;
  if (distToCarlos > cfg.leashRange) return LUIGI_MODE.RETURN;
  return hasThreat ? LUIGI_MODE.CHASE : LUIGI_MODE.FOLLOW;
}

export class Luigi {
  constructor(game, cfg) {
    this.game = game;
    this.cfg = cfg;
    this.pos = { x: 0, z: 0 };
    this._prev = { x: 0, z: 0 };
    this.level = 0;
    this.active = false;
    this._blocked = (i, j) => !game.grid.isWalkable(i, j);
    this.reset();
  }

  get radius() {
    return this.cfg.radius;
  }

  reset() {
    this.active = false;
    this.mode = LUIGI_MODE.FOLLOW;
    this.target = null;
    this.yaw = 0;
    this.speed = 0;      // m/s del último paso (para la animación)
    this.phase = 0;      // ciclo del trote
    this.biteCd = 0;
    this.retarget = 0;
    this.barkT = 0;      // ladrando (animación)
    this.barkCd = 0;
    this.hopT = 0;       // saltito al morder
    this.yelpT = 0;      // gañido: sale despedido
    this.yelpX = 0; this.yelpZ = 0;
    this.stuckT = 0;
    this.bites = 0;
  }

  /** Nivel de la mejora (0 = no hay Luigi). */
  setLevel(level) {
    this.level = level;
    if (!level) this.reset();
  }

  /** Aparece en (x, z) (su cama al comprarlo, o junto a Carlos al continuar un turno). */
  spawn(x, z) {
    const lvl = this.level;
    this.reset();
    this.level = lvl;
    this.active = lvl > 0;
    this.pos.x = x; this.pos.z = z;
    this._prev.x = x; this._prev.z = z;
  }

  /** Aparece a la espalda de Carlos (en una celda libre). */
  spawnNearPlayer() {
    const { player, grid } = this.game;
    const p = player.position;
    const d = this.cfg.followDist;
    for (const [ox, oz] of [[0, d], [d, 0], [-d, 0], [0, -d], [0, 0]]) {
      if (grid.isWalkable(grid.cellX(p.x + ox), grid.cellZ(p.z + oz))) { this.spawn(p.x + ox, p.z + oz); return; }
    }
  }

  get damage() {
    return byLevel(this.cfg.damage, this.level, 0);
  }

  update(dt) {
    if (!this.active) return;
    const { game, cfg } = this;
    const { player, zombies } = game;
    const p = player.position;
    this.biteCd -= dt;
    this.retarget -= dt;
    this.barkCd -= dt;
    if (this.barkT > 0) this.barkT -= dt;
    if (this.hopT > 0) this.hopT -= dt;
    this._prev.x = this.pos.x; this._prev.z = this.pos.z;

    // Manotazo de un zombi: sale despedido hacia atrás (ni un rasguño) y luego sigue.
    if (this.yelpT > 0) {
      this.yelpT -= dt;
      this.moveBy(this.yelpX * cfg.yelpSpeed * dt, this.yelpZ * cfg.yelpSpeed * dt);
      this.finishStep(dt);
      return;
    }

    let dc = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
    // Muy lejos (se ha quedado encerrado o atascado): reaparece junto a Carlos.
    if (dc > cfg.teleportRange || (this.mode === LUIGI_MODE.RETURN && this.stuckT > cfg.stuckSeconds)) {
      this.spawnNearPlayer();
      dc = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
    }

    // Amenaza: el zombi más cercano a Carlos (no a Luigi) a menos de threatRange.
    const t = this.target;
    if (t && (t.state !== 0 || t.active === false || Math.hypot(t.pos.x - p.x, t.pos.z - p.z) > cfg.threatRange * 1.5)) this.target = null;
    if (this.retarget <= 0 && player.alive) {
      this.retarget = cfg.retarget;
      const nt = nearestThreat(zombies.active, p.x, p.z, cfg.threatRange);
      if (nt && nt !== this.target && !this.target) this.bark();
      if (nt) this.target = nt;
    }
    if (!player.alive) this.target = null;
    this.mode = luigiMode(this.mode, dc, !!this.target, cfg);
    if (this.mode !== LUIGI_MODE.CHASE) this.target = null;

    if (this.mode === LUIGI_MODE.CHASE) {
      const z = this.target;
      const dx = z.pos.x - this.pos.x, dz = z.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      const reach = cfg.biteRange + (z.radius ?? 0.35);
      if (d > reach) this.steer(z.pos.x, z.pos.z, cfg.runSpeed, dt, false);
      else {
        if (d > 1e-3) this.yaw = Math.atan2(dx, dz);
        if (this.biteCd <= 0) this.bite(z, d > 1e-3 ? dx / d : 0, d > 1e-3 ? dz / d : 0);
      }
    } else if (dc > cfg.followDist) {
      // Sigue a Carlos: al trote cerca, corriendo si se ha quedado atrás.
      const run = this.mode === LUIGI_MODE.RETURN || dc > cfg.followDist * 3;
      this.steer(p.x, p.z, run ? cfg.runSpeed : cfg.walkSpeed, dt, true);
    }
    this.finishStep(dt);
  }

  /** Avanza hacia (tx, tz): en línea recta si hay paso; si no, por el flow field hacia Carlos. */
  steer(tx, tz, speed, dt, towardPlayer) {
    const { grid, zombies } = this.game;
    let dx = tx - this.pos.x, dz = tz - this.pos.z;
    let d = Math.hypot(dx, dz);
    if (d < 1e-4) return;
    dx /= d; dz /= d;
    if (towardPlayer && zombies.flow && raycastGrid(grid, this.pos.x, this.pos.z, dx, dz, d, this._blocked) < d) {
      const cell = grid.walkableCellAt(this.pos.x, this.pos.z);
      const nk = cell >= 0 ? zombies.flow.next[cell] : -1;
      if (nk >= 0) {
        const nx = grid.centerX(nk % grid.w) - this.pos.x, nz = grid.centerZ((nk / grid.w) | 0) - this.pos.z;
        d = Math.hypot(nx, nz) || 1;
        dx = nx / d; dz = nz / d;
      }
    }
    this.yaw = Math.atan2(dx, dz);
    this.moveBy(dx * speed * dt, dz * speed * dt);
  }

  moveBy(mx, mz) {
    this.pos.x += mx;
    this.pos.z += mz;
    resolveCircleVsGrid(this.pos, this.cfg.radius, this.game.grid);
  }

  /** Velocidad real del paso (animación) y detección de atascos. */
  finishStep(dt) {
    const moved = Math.hypot(this.pos.x - this._prev.x, this.pos.z - this._prev.z);
    this.speed = moved / dt;
    this.phase += moved * this.cfg.trotStride;
    if (this.mode === LUIGI_MODE.RETURN && this.speed < this.cfg.walkSpeed * 0.25) this.stuckT += dt;
    else this.stuckT = 0;
  }

  bark() {
    if (this.barkCd > 0) return;
    const { cfg, game } = this;
    this.barkCd = cfg.barkCooldown;
    this.barkT = cfg.barkSeconds;
    game.floating?.spawn(cfg.barks[(Math.random() * cfg.barks.length) | 0], this.pos.x, 1.0, this.pos.z, 'quip', 0.9);
    game.bus?.emit('luigi:bark', { x: this.pos.x, z: this.pos.z });
  }

  bite(z, dx, dz) {
    const { cfg, game } = this;
    const { zombies } = game;
    this.biteCd = cfg.biteInterval;
    this.hopT = cfg.hopSeconds;
    this.bites++;
    zombies.damage(z, this.damage, dx, dz, cfg.knockback);
    const stun = byLevel(cfg.stunChance, this.level, 0);
    if (stun > 0 && z.state === 0 && Math.random() < stun) zombies.stun(z, cfg.stunSeconds);
    game.bus?.emit('luigi:bite', { x: this.pos.x, z: this.pos.z });
    // A veces el zombi le suelta un manotazo: gañido y vuelo hacia atrás, pero sin daño.
    if (z.state === 0 && Math.random() < cfg.yelpChance) this.yelp(-dx, -dz);
  }

  yelp(dx, dz) {
    const { cfg, game } = this;
    const l = Math.hypot(dx, dz) || 1;
    this.yelpX = dx / l; this.yelpZ = dz / l;
    this.yelpT = cfg.yelpSeconds;
    game.floating?.spawn(cfg.yelps[(Math.random() * cfg.yelps.length) | 0], this.pos.x, 1.0, this.pos.z, 'quip', 0.9);
    game.bus?.emit('luigi:yelp', { x: this.pos.x, z: this.pos.z });
  }
}
