import * as THREE from 'three';
import zombieData from '../data/zombies.json';
import { FlowField } from './FlowField.js';
import { resolveCircleVsGrid, raycastGrid, rayCircle, SpatialHash } from './Physics.js';
import { PARTS, PART_NAMES, partGeometry, computePose, makePose } from '../render/BlockyCharacter.js';

const SHIRTS = [0x7a5c3e, 0x4b5d73, 0x8c3b3b, 0x5f6b4e, 0x6b6b6b, 0x6a4f7a];
const PANTS = [0x2e3542, 0x3e3328, 0x24282e, 0x40464f];
const WHITE = new THREE.Color(0xffffff);

export const Z_STATE = { CHASE: 0, DYING: 1 };

function makeZombie() {
  return {
    active: false, type: '', data: null,
    pos: { x: 0, z: 0 }, vx: 0, vz: 0, facing: 0, scale: 1,
    hp: 0, maxHp: 0, speed: 0, radius: 0.38,
    state: Z_STATE.CHASE, windup: 0, cooldown: 0, attackAnim: 0,
    losTimer: 0, hasLos: false, walkPhase: 0, flash: 0,
    deathTimer: 0, fall: 0, sink: 0,
    colors: PART_NAMES.map(() => new THREE.Color()),
  };
}

export class ZombieSystem {
  constructor(game) {
    this.game = game;
    this.types = zombieData;
    this.ai = zombieData._ai;
    const max = this.ai.maxZombies;
    this.pool = Array.from({ length: max }, makeZombie);
    this.active = [];
    this.flow = new FlowField(game.grid);
    this.flowTimer = 0;
    this.flowCell = -1;
    this.hash = new SpatialHash(game.grid.w * game.grid.cellSize, 2, max + 8);
    this.pose = makePose();

    // Un InstancedMesh por parte del cuerpo → 6 draw calls para toda la horda.
    this.meshes = {};
    for (const name of PART_NAMES) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
      const mesh = new THREE.InstancedMesh(partGeometry(name), mat, max);
      mesh.castShadow = true;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.setColorAt(0, WHITE); // crea instanceColor
      game.scene.add(mesh);
      this.meshes[name] = mesh;
    }
    this._base = new THREE.Matrix4();
    this._part = new THREE.Matrix4();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  get aliveCount() {
    let n = 0;
    for (const z of this.active) if (z.state !== Z_STATE.DYING) n++;
    return n;
  }

  reset() {
    for (const z of this.active) z.active = false;
    this.active.length = 0;
    this.flowCell = -1;
  }

  spawn(type, x, z) {
    const zb = this.pool.find((p) => !p.active);
    if (!zb) return null;
    const d = this.types[type];
    const rnd = (v) => 1 + (Math.random() * 2 - 1) * v;
    zb.active = true;
    zb.type = type;
    zb.data = d;
    zb.pos.x = x; zb.pos.z = z;
    zb.vx = zb.vz = 0;
    zb.facing = Math.random() * Math.PI * 2;
    zb.scale = d.scale * rnd(0.06);
    zb.radius = d.radius * zb.scale;
    zb.hp = zb.maxHp = d.hp;
    zb.speed = d.speed * rnd(d.speedVariance);
    zb.state = Z_STATE.CHASE;
    zb.windup = 0; zb.cooldown = 0; zb.attackAnim = 0;
    zb.losTimer = Math.random() * this.ai.losCheckInterval;
    zb.hasLos = false;
    zb.walkPhase = Math.random() * 10;
    zb.flash = 0; zb.deathTimer = 0; zb.fall = 0; zb.sink = 0;
    const skin = this._c.set(d.color).multiplyScalar(rnd(d.colorVariance));
    const shirt = SHIRTS[(Math.random() * SHIRTS.length) | 0];
    const pants = PANTS[(Math.random() * PANTS.length) | 0];
    PART_NAMES.forEach((n, k) => {
      const c = zb.colors[k];
      if (n === 'torso') c.setHex(shirt);
      else if (n === 'legL' || n === 'legR') c.setHex(pants);
      else if (n === 'armL' || n === 'armR') c.setHex(Math.random() < 0.5 ? shirt : skin.getHex());
      else c.copy(skin);
    });
    this.active.push(zb);
    return zb;
  }

  /** Aplica daño. Devuelve true si lo mata. */
  damage(zb, amount, dirX = 0, dirZ = 0, knockback = 0) {
    if (zb.state === Z_STATE.DYING) return false;
    zb.hp -= amount;
    zb.flash = 0.1;
    zb.pos.x += dirX * knockback;
    zb.pos.z += dirZ * knockback;
    resolveCircleVsGrid(zb.pos, zb.radius, this.game.grid);
    this.game.bus.emit('zombie:hit', { zombie: zb, amount });
    if (zb.hp <= 0) {
      zb.state = Z_STATE.DYING;
      zb.deathTimer = 0;
      this.game.bus.emit('zombie:killed', { type: zb.type, points: zb.data.points, x: zb.pos.x, z: zb.pos.z });
      return true;
    }
    return false;
  }

  /**
   * Primer zombi vivo que corta el rayo antes de maxDist. Ignora los de `exclude`.
   * @returns {{zombie:object, t:number}|null}
   */
  raycast(ox, oz, dx, dz, maxDist, exclude) {
    let best = null, bestT = maxDist;
    for (const zb of this.active) {
      if (zb.state === Z_STATE.DYING || exclude?.has(zb)) continue;
      const t = rayCircle(ox, oz, dx, dz, zb.pos.x, zb.pos.z, zb.radius + 0.08);
      if (t >= 0 && t < bestT) { bestT = t; best = zb; }
    }
    return best ? { zombie: best, t: bestT } : null;
  }

  update(dt) {
    const { game, ai, flow } = this;
    const { grid, player } = game;
    const px = player.position.x, pz = player.position.z;

    // Flow field hacia la celda del jugador (solo si ha cambiado de celda).
    this.flowTimer -= dt;
    const pcell = grid.index(grid.cellX(px), grid.cellZ(pz));
    if (this.flowTimer <= 0 && pcell !== this.flowCell) {
      flow.compute(grid.cellX(px), grid.cellZ(pz));
      this.flowCell = pcell;
      this.flowTimer = ai.flowFieldInterval;
    }

    this.hash.clear();
    for (const zb of this.active) if (zb.state !== Z_STATE.DYING) this.hash.insert(zb, zb.pos.x, zb.pos.z);

    const turn = 1 - Math.exp(-ai.turnSharpness * dt);
    const sepR = ai.separationRadius;
    const blockedWalk = (i, j) => !grid.isWalkable(i, j);

    for (let n = this.active.length - 1; n >= 0; n--) {
      const zb = this.active[n];
      zb.flash = Math.max(0, zb.flash - dt);

      if (zb.state === Z_STATE.DYING) {
        zb.deathTimer += dt;
        zb.fall = Math.min(1, zb.deathTimer / 0.4);
        if (zb.deathTimer > ai.corpseTime) zb.sink = Math.min(1, (zb.deathTimer - ai.corpseTime) / 1);
        if (zb.deathTimer > ai.corpseTime + 1) {
          zb.active = false;
          this.active.splice(n, 1);
        }
        continue;
      }

      const dx = px - zb.pos.x, dz = pz - zb.pos.z;
      const dist = Math.hypot(dx, dz) || 1e-6;

      // Línea de visión escalonada en el tiempo (no todos los zombis en el mismo paso).
      zb.losTimer -= dt;
      if (zb.losTimer <= 0) {
        zb.losTimer = ai.losCheckInterval;
        zb.hasLos = dist < ai.directChaseRange &&
          raycastGrid(grid, zb.pos.x, zb.pos.z, dx / dist, dz / dist, dist, blockedWalk) >= dist;
      }

      // Dirección deseada: directa si ve al jugador; si no, la del flow field.
      let mx = dx / dist, mz = dz / dist;
      if (!zb.hasLos) {
        const nk = flow.nextCell(grid.cellX(zb.pos.x), grid.cellZ(zb.pos.z));
        if (nk >= 0) {
          const tx = grid.centerX(nk % grid.w) - zb.pos.x;
          const tz = grid.centerZ((nk / grid.w) | 0) - zb.pos.z;
          const tl = Math.hypot(tx, tz) || 1;
          mx = tx / tl; mz = tz / tl;
        }
      }

      // Separación entre zombis.
      let sx = 0, sz = 0;
      this.hash.query(zb.pos.x, zb.pos.z, sepR, (o) => {
        if (o === zb) return;
        const ox = zb.pos.x - o.pos.x, oz = zb.pos.z - o.pos.z;
        const d2 = ox * ox + oz * oz;
        if (d2 > sepR * sepR || d2 < 1e-8) return;
        const d = Math.sqrt(d2);
        const w = (sepR - d) / sepR;
        sx += (ox / d) * w; sz += (oz / d) * w;
      });

      // Ataque: preparación (windup) y golpe si el jugador sigue al alcance.
      const gap = dist - zb.radius - player.radius;
      const inRange = gap < zb.data.attackRange && player.alive;
      zb.cooldown = Math.max(0, zb.cooldown - dt);
      if (zb.windup > 0) {
        zb.windup -= dt;
        zb.attackAnim = 1 - zb.windup / zb.data.attackWindup;
        if (zb.windup <= 0) {
          if (gap < zb.data.attackRange + 0.25) player.damage(zb.data.damage);
          zb.cooldown = zb.data.attackCooldown;
          zb.attackAnim = 0;
        }
      } else if (inRange && zb.cooldown <= 0) {
        zb.windup = zb.data.attackWindup;
      }

      const speed = zb.windup > 0 || inRange ? zb.speed * 0.25 : zb.speed;
      let tvx = mx * speed + sx * ai.separationStrength;
      let tvz = mz * speed + sz * ai.separationStrength;
      const tl = Math.hypot(tvx, tvz);
      const maxV = zb.speed * 1.3;
      if (tl > maxV) { tvx *= maxV / tl; tvz *= maxV / tl; }
      zb.vx += (tvx - zb.vx) * turn;
      zb.vz += (tvz - zb.vz) * turn;
      zb.pos.x += zb.vx * dt;
      zb.pos.z += zb.vz * dt;
      resolveCircleVsGrid(zb.pos, zb.radius, grid);

      // Mira al jugador si está cerca; si no, hacia donde camina.
      const targetFacing = dist < 3 || zb.hasLos ? Math.atan2(dx, dz) : Math.atan2(zb.vx, zb.vz);
      let df = targetFacing - zb.facing;
      df = Math.atan2(Math.sin(df), Math.cos(df));
      zb.facing += df * turn;
      zb.walkPhase += Math.hypot(zb.vx, zb.vz) * dt * 2.4;
    }

    // Empuje mutuo jugador–zombis (el jugador no atraviesa la horda).
    if (player.alive) {
      const pr = player.radius;
      this.hash.query(px, pz, 1.5, (o) => {
        const ox = player.position.x - o.pos.x, oz = player.position.z - o.pos.z;
        const minD = pr + o.radius;
        const d2 = ox * ox + oz * oz;
        if (d2 >= minD * minD || d2 < 1e-8) return;
        const d = Math.sqrt(d2);
        const push = (minD - d) * 0.5;
        player.position.x += (ox / d) * push;
        player.position.z += (oz / d) * push;
        o.pos.x -= (ox / d) * push;
        o.pos.z -= (oz / d) * push;
      });
      resolveCircleVsGrid(player.position, pr, grid);
    }
  }

  render() {
    const { meshes, pose, _base, _part, _m, _q, _e, _v, _s, _c } = this;
    let count = 0;
    for (const zb of this.active) {
      const moving = Math.min(1, Math.hypot(zb.vx, zb.vz) / Math.max(zb.speed, 0.01));
      computePose(pose, zb.walkPhase, zb.state === Z_STATE.DYING ? 0 : moving, 'zombie', zb.attackAnim);
      // Base: posición, giro, caída hacia atrás al morir y hundimiento final.
      _e.set(-zb.fall * Math.PI / 2, zb.facing, 0, 'YXZ');
      _q.setFromEuler(_e);
      _v.set(zb.pos.x, -zb.sink * 0.6 + zb.fall * 0.12, zb.pos.z);
      _s.setScalar(zb.scale);
      _base.compose(_v, _q, _s);
      PART_NAMES.forEach((name, k) => {
        const p = PARTS[name];
        _e.set(pose[name].x, 0, pose[name].z, 'XYZ');
        _q.setFromEuler(_e);
        _v.fromArray(p.pivot);
        _s.setScalar(1);
        _part.compose(_v, _q, _s);
        _m.multiplyMatrices(_base, _part);
        meshes[name].setMatrixAt(count, _m);
        _c.copy(zb.colors[k]);
        if (zb.flash > 0) _c.lerp(WHITE, 0.7);
        if (zb.state === Z_STATE.DYING) _c.multiplyScalar(0.6);
        meshes[name].setColorAt(count, _c);
      });
      count++;
    }
    for (const name of PART_NAMES) {
      const m = meshes[name];
      m.count = count;
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor.needsUpdate = true;
    }
  }
}
