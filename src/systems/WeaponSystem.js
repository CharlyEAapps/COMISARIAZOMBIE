import * as THREE from 'three';
import weapons from '../data/weapons.json';
import config from '../data/config.json';
import { raycastGrid } from './Physics.js';

const { shotHeight: SHOT_HEIGHT, fireBuffer: FIRE_BUFFER } = config.combat; // el búfer guarda un clic hecho durante la cadencia

export class WeaponSystem {
  constructor(game) {
    this.game = game;
    this.defs = weapons;
    this.slots = [];
    this._from = new THREE.Vector3();
    this._to = new THREE.Vector3();
    this._exclude = new Set();
    this.shotBlocked = (i, j) => game.grid.isShotBlocked(i, j);
    this.reset();
  }

  reset() {
    this.slots = [];
    this.give(this.game.player.data.startWeapon);
    this.current = 0;
  }

  give(id) {
    const d = this.defs[id];
    const slot = { id, data: d, mag: d.magSize, reserve: d.reserve, reloading: 0, cooldown: 0, buffer: 0 };
    this.slots.push(slot);
    return slot;
  }

  get weapon() { return this.slots[this.current]; }

  startReload() {
    const w = this.weapon;
    if (w.reloading > 0 || w.mag >= w.data.magSize || w.reserve === 0) return;
    w.reloading = w.data.reloadTime;
    this.game.bus.emit('weapon:reload', { weapon: w });
  }

  update(dt) {
    const { input, player } = this.game;
    const w = this.weapon;
    w.cooldown = Math.max(0, w.cooldown - dt);
    w.buffer = Math.max(0, w.buffer - dt);

    if (w.reloading > 0) {
      w.reloading -= dt;
      if (w.reloading <= 0) {
        w.reloading = 0;
        const need = w.data.magSize - w.mag;
        const take = w.reserve < 0 ? need : Math.min(need, w.reserve);
        w.mag += take;
        if (w.reserve >= 0) w.reserve -= take;
      }
    }
    if (!player.alive) return;

    if (input.consume('reload')) this.startReload();
    // En modo construcción el clic es para construir.
    if (this.game.build?.active) { w.buffer = 0; return; }

    const pressed = input.consume('fire');
    if (pressed) w.buffer = FIRE_BUFFER;
    const wantsFire = w.data.auto ? input.isHeld('fire') : w.buffer > 0;
    if (!wantsFire || w.cooldown > 0 || w.reloading > 0) return;

    if (w.mag <= 0) {
      this.startReload();
      return;
    }
    w.buffer = 0;
    w.mag--;
    w.cooldown = 1 / w.data.fireRate;
    this.fire(w.data);
    if (w.mag === 0) this.startReload();
  }

  fire(d) {
    const { game } = this;
    const { player, grid, zombies, effects } = game;
    const muzzle = player.getMuzzleWorld(this._from);
    const ox = player.position.x, oz = player.position.z;
    // Si hay un muro más cerca que la boca del arma, el fogonazo y la trazadora salen
    // desde este lado del muro (no desde la sala contigua).
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

    for (let p = 0; p < d.pellets; p++) {
      const spread = THREE.MathUtils.degToRad(d.spreadDeg) * (Math.random() - 0.5);
      const base = Math.atan2(player.aimDir.x, player.aimDir.z) + spread;
      const dx = Math.sin(base), dz = Math.cos(base);

      // Las balas salen del centro del jugador (no atraviesan el muro que tenga pegado).
      const wallDist = raycastGrid(grid, ox, oz, dx, dz, d.range, this.shotBlocked);
      let endDist = wallDist;
      this._exclude.clear();
      for (let pierce = 0; pierce <= d.pierce; pierce++) {
        const hit = zombies.raycast(ox, oz, dx, dz, wallDist, this._exclude);
        if (!hit) break;
        this._exclude.add(hit.zombie);
        zombies.damage(hit.zombie, d.damage, dx, dz, d.knockback);
        effects.burst(hit.zombie.pos.x, 1.2, hit.zombie.pos.z, 7, 0x4a1d1d, { speed: 2.5, dirX: dx, dirZ: dz, size: 0.08 });
        endDist = hit.t;
      }
      if (endDist === wallDist && wallDist < d.range) {
        effects.burst(ox + dx * wallDist, SHOT_HEIGHT, oz + dz * wallDist, 4, 0xbfb6a3, { speed: 1.5, dirX: -dx, dirZ: -dz, size: 0.06, life: 0.4 });
      }
      this._to.set(ox + dx * endDist, SHOT_HEIGHT, oz + dz * endDist);
      effects.tracer(muzzle, this._to, d.tracerColor);
    }
    effects.muzzleFlash(muzzle);
    effects.shake(d.shake);
    game.bus.emit('weapon:fired', { weapon: d });
  }
}
