import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import zombieData from '../data/zombies.json';
import { FlowField } from './FlowField.js';
import { resolveCircleVsGrid, raycastGrid, rayCircle, SpatialHash } from './Physics.js';
import { PARTS, PART_NAMES, partGeometry, computePose, makePose } from '../render/BlockyCharacter.js';

const SHIRTS = [0x7a5c3e, 0x4b5d73, 0x8c3b3b, 0x5f6b4e, 0x6b6b6b, 0x6a4f7a];
const PANTS = [0x2e3542, 0x3e3328, 0x24282e, 0x40464f];
const WHITE = new THREE.Color(0xffffff);
const PART_COUNT = PART_NAMES.length;
const HEAD_INDEX = PART_NAMES.indexOf('head');

export const Z_STATE = { CHASE: 0, DYING: 1 };

function makeZombie(id) {
  return {
    id, active: false, type: '', data: null,
    pos: { x: 0, z: 0 }, vx: 0, vz: 0, facing: 0, scale: 1,
    hp: 0, maxHp: 0, speed: 0, radius: 0.38,
    state: Z_STATE.CHASE, windup: 0, cooldown: 0, attackAnim: 0,
    losTimer: 0, hasLos: false, walkPhase: 0, flash: 0,
    deathTimer: 0, fall: 0, sink: 0,
    stunTimer: 0, slowMul: 1, vandal: false, attackTarget: 0, // 0 jugador, 1 estructura, 2 transformador
    targetCell: -1,
    colors: PART_NAMES.map(() => new THREE.Color()),
  };
}

const rnd = (v) => 1 + (Math.random() * 2 - 1) * v;

export class ZombieSystem {
  constructor(game) {
    this.game = game;
    this.types = zombieData;
    this.ai = zombieData._ai;
    const max = this.ai.maxZombies;
    this.pool = Array.from({ length: max }, (_, id) => makeZombie(id));
    // Pila de huecos libres del pool: spawn O(1).
    this.free = this.pool.map((z) => z).reverse();
    this.active = [];
    this.flow = new FlowField(game.grid);
    this.decoyFlow = new FlowField(game.grid); // rutas hacia el señuelo (sirena)
    this.vandalFlow = new FlowField(game.grid); // rutas hacia el transformador
    this.flowDirty = false; // una construcción ha cambiado: recalcular los flow fields
    this.vandalTarget = -1;
    this.flowTimer = 0;
    this.flowCell = -1;
    const g = game.grid;
    this.hash = new SpatialHash(Math.max(g.w, g.h) * g.cellSize, 2, max + 8);
    this.neighbors = new Array(max + 8); // resultado reutilizable de las consultas al hash
    this.pose = makePose();
    this.blockedWalk = (i, j) => !g.isWalkable(i, j);

    // Un InstancedMesh por parte del cuerpo → 6 draw calls para toda la horda.
    this.meshList = PART_NAMES.map((name) => {
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
      const mesh = new THREE.InstancedMesh(partGeometry(name), mat, max);
      mesh.castShadow = true;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.setColorAt(0, WHITE); // crea instanceColor
      game.scene.add(mesh);
      return mesh;
    });
    this.partPivots = PART_NAMES.map((n) => new THREE.Vector3().fromArray(PARTS[n].pivot));

    // Ojos brillantes (visibles de noche): dos cubitos en la cara, siguen a la cabeza.
    const eyeL = new THREE.BoxGeometry(0.08, 0.05, 0.02); eyeL.translate(-0.085, 0.2, 0.2);
    const eyeR = new THREE.BoxGeometry(0.08, 0.05, 0.02); eyeR.translate(0.085, 0.2, 0.2);
    this.eyeMaterial = new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0, fog: false });
    this.eyes = new THREE.InstancedMesh(mergeGeometries([eyeL, eyeR]), this.eyeMaterial, max);
    this.eyes.count = 0;
    this.eyes.frustumCulled = false;
    game.scene.add(this.eyes);

    // Señuelo (sirena de coche) y modificador global de velocidad (alarma).
    this.decoy = { x: 0, z: 0, timer: 0, radius: 0 };
    this.speedMul = 1;
    this.speedMulTimer = 0;
    this._base = new THREE.Matrix4();
    this._part = new THREE.Matrix4();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._one = new THREE.Vector3(1, 1, 1);
    this._c = new THREE.Color();
  }

  get aliveCount() {
    let n = 0;
    for (const z of this.active) if (z.state !== Z_STATE.DYING) n++;
    return n;
  }

  reset() {
    for (const z of this.active) this.release(z);
    this.active.length = 0;
    this.flowCell = -1;
    this.flowTimer = 0;
    this.flowDirty = false;
    this.vandalTarget = -1;
    this.decoy.timer = 0;
    this.speedMul = 1;
    this.speedMulTimer = 0;
  }

  /** ¿Está el círculo del zombi a menos de `reach` de la caja [minX,minZ,maxX,maxZ] en arr[o..o+3]? */
  nearBox(zb, arr, o, reach) {
    const cx = Math.max(arr[o], Math.min(zb.pos.x, arr[o + 2]));
    const cz = Math.max(arr[o + 1], Math.min(zb.pos.z, arr[o + 3]));
    return (zb.pos.x - cx) ** 2 + (zb.pos.z - cz) ** 2 < reach * reach;
  }

  /** Atrae hacia (x,z) a los zombis en `radius` que no ven al jugador, durante `seconds`. */
  setDecoy(x, z, seconds, radius) {
    Object.assign(this.decoy, { x, z, timer: seconds, radius });
    const g = this.game.grid;
    const cell = g.walkableCellAt(x, z);
    if (cell >= 0) this.decoyFlow.compute(cell % g.w, (cell / g.w) | 0);
  }

  /** Multiplica la velocidad de todos los zombis durante `seconds` (alarma). */
  slowAll(mul, seconds) {
    this.speedMul = mul;
    this.speedMulTimer = seconds;
  }

  release(zb) {
    zb.active = false;
    this.free.push(zb);
  }

  /** @param {{hpMul?:number, speedMul?:number}} [mods] escalado por noche */
  spawn(type, x, z, mods) {
    const zb = this.free.pop();
    if (!zb) return null;
    const d = this.types[type];
    zb.active = true;
    zb.type = type;
    zb.data = d;
    zb.pos.x = x; zb.pos.z = z;
    zb.vx = zb.vz = 0;
    zb.facing = Math.random() * Math.PI * 2;
    zb.scale = d.scale * rnd(0.06);
    zb.radius = d.radius * zb.scale;
    zb.hp = zb.maxHp = d.hp * (mods?.hpMul ?? 1);
    zb.speed = d.speed * rnd(d.speedVariance) * (mods?.speedMul ?? 1);
    zb.state = Z_STATE.CHASE;
    zb.windup = 0; zb.cooldown = 0; zb.attackAnim = 0;
    zb.losTimer = Math.random() * this.ai.losCheckInterval;
    zb.hasLos = false;
    zb.walkPhase = Math.random() * 10;
    zb.flash = 0; zb.deathTimer = 0; zb.fall = 0; zb.sink = 0;
    zb.stunTimer = 0; zb.slowMul = 1; zb.attackTarget = 0; zb.targetCell = -1;
    const tr = this.game.build?.transformer;
    zb.vandal = !!tr && tr.hp > 0 && Math.random() < this.game.build.cfg.transformer.vandalChance;
    const skin = this._c.set(d.color).multiplyScalar(rnd(d.colorVariance));
    const shirt = SHIRTS[(Math.random() * SHIRTS.length) | 0];
    const pants = PANTS[(Math.random() * PANTS.length) | 0];
    for (let k = 0; k < PART_COUNT; k++) {
      const n = PART_NAMES[k], c = zb.colors[k];
      if (n === 'torso') c.setHex(shirt);
      else if (n === 'legL' || n === 'legR') c.setHex(pants);
      else if (n === 'armL' || n === 'armR') c.setHex(Math.random() < 0.5 ? shirt : skin.getHex());
      else c.copy(skin);
    }
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
      zb.windup = 0;
      zb.attackAnim = 0;
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
      const t = rayCircle(ox, oz, dx, dz, zb.pos.x, zb.pos.z, zb.radius + this.ai.hitPadding);
      if (t >= 0 && t < bestT) { bestT = t; best = zb; }
    }
    return best ? { zombie: best, t: bestT } : null;
  }

  update(dt) {
    const { game, ai, flow, hash, neighbors } = this;
    const { grid, player } = game;
    const px = player.position.x, pz = player.position.z;

    // Flow field hacia la celda transitable del jugador (si cambia de celda o cambian las construcciones).
    this.flowTimer -= dt;
    const pcell = grid.walkableCellAt(px, pz);
    if (this.flowTimer <= 0 && (pcell !== this.flowCell || this.flowDirty) && pcell >= 0) {
      flow.compute(pcell % grid.w, (pcell / grid.w) | 0);
      this.flowCell = pcell;
      this.flowTimer = ai.flowFieldInterval;
      // Rutas al transformador (destino fijo): solo al cambiar las construcciones.
      const tr = game.build?.transformer;
      if (tr && (this.flowDirty || this.vandalTarget !== tr.cell)) {
        this.vandalFlow.compute(tr.cell % grid.w, (tr.cell / grid.w) | 0);
        this.vandalTarget = tr.cell;
      }
      if (this.flowDirty && this.decoy.timer > 0) this.setDecoy(this.decoy.x, this.decoy.z, this.decoy.timer, this.decoy.radius);
      this.flowDirty = false;
    }
    const transformer = game.build?.transformer;
    const vandalsActive = !!transformer && transformer.hp > 0;

    hash.clear();
    for (const zb of this.active) if (zb.state !== Z_STATE.DYING) hash.insert(zb, zb.pos.x, zb.pos.z);

    const turn = 1 - Math.exp(-ai.turnSharpness * dt);
    const sepR = ai.separationRadius;
    const decoy = this.decoy;
    if (decoy.timer > 0) decoy.timer -= dt;
    if (this.speedMulTimer > 0 && (this.speedMulTimer -= dt) <= 0) this.speedMul = 1;

    for (let n = this.active.length - 1; n >= 0; n--) {
      const zb = this.active[n];
      zb.flash = Math.max(0, zb.flash - dt);

      if (zb.state === Z_STATE.DYING) {
        zb.deathTimer += dt;
        zb.fall = Math.min(1, zb.deathTimer / ai.fallTime);
        if (zb.deathTimer > ai.corpseTime) zb.sink = Math.min(1, (zb.deathTimer - ai.corpseTime) / ai.sinkTime);
        if (zb.deathTimer > ai.corpseTime + ai.sinkTime) {
          this.active.splice(n, 1);
          this.release(zb);
        }
        continue;
      }

      const dx = px - zb.pos.x, dz = pz - zb.pos.z;
      const dist = Math.hypot(dx, dz) || 1e-6;
      const ux = dx / dist, uz = dz / dist;

      // Atrapado en un cepo: no se mueve ni ataca.
      if (zb.stunTimer > 0) {
        zb.stunTimer -= dt;
        zb.vx *= 0.5; zb.vz *= 0.5;
        zb.windup = 0; zb.attackAnim = 0;
        zb.slowMul = 1;
        continue;
      }

      // Línea de visión escalonada en el tiempo (no todos los zombis en el mismo paso).
      zb.losTimer -= dt;
      if (zb.losTimer <= 0) {
        zb.losTimer = ai.losCheckInterval;
        zb.hasLos = dist < ai.directChaseRange &&
          raycastGrid(grid, zb.pos.x, zb.pos.z, ux, uz, dist, this.blockedWalk) >= dist;
      }

      // Dirección deseada: directa si ve al jugador; hacia el señuelo si lo oye;
      // si no, la del flow field.
      let mx = ux, mz = uz;
      let toDecoy = false;
      if (!zb.hasLos && decoy.timer > 0) {
        const dd = Math.hypot(decoy.x - zb.pos.x, decoy.z - zb.pos.z);
        toDecoy = dd < decoy.radius;
        if (toDecoy && dd < 1.5) { mx = 0; mz = 0; }
      }
      // Los vándalos van a por el transformador salvo que tengan al jugador encima.
      const goVandal = zb.vandal && vandalsActive && !(zb.hasLos && dist < 6);
      zb.targetCell = -1;
      if ((!zb.hasLos || goVandal) && !(toDecoy && mx === 0 && mz === 0)) {
        // Flow field hacia el jugador, el señuelo o el transformador.
        const field = goVandal ? this.vandalFlow : toDecoy ? this.decoyFlow : flow;
        const cell = grid.walkableCellAt(zb.pos.x, zb.pos.z);
        const nk = cell >= 0 ? field.next[cell] : -1;
        if (nk >= 0) {
          const tx = grid.centerX(nk % grid.w) - zb.pos.x;
          const tz = grid.centerZ((nk / grid.w) | 0) - zb.pos.z;
          const tl = Math.hypot(tx, tz) || 1;
          mx = tx / tl; mz = tz / tl;
          // La siguiente celda tiene una construcción que bloquea: hay que romperla.
          if (grid.blocked[nk] && this.nearBox(zb, grid.dynBox, nk * 4, zb.radius + ai.structureReach)) zb.targetCell = nk;
        }
        if (goVandal && this.nearBox(zb, transformer.box, 0, zb.radius + game.build.cfg.transformer.attackRange * 0.5)) {
          zb.targetCell = -2;
          mx = 0; mz = 0;
        }
      }

      // Separación blanda entre zombis (dirección de evitación).
      let sx = 0, sz = 0;
      let count = hash.queryInto(zb.pos.x, zb.pos.z, sepR, neighbors);
      for (let q = 0; q < count; q++) {
        const o = neighbors[q];
        if (o === zb) continue;
        const ox = zb.pos.x - o.pos.x, oz = zb.pos.z - o.pos.z;
        const d2 = ox * ox + oz * oz;
        if (d2 > sepR * sepR || d2 < 1e-8) continue;
        const d = Math.sqrt(d2);
        const w = (sepR - d) / sepR;
        sx += (ox / d) * w; sz += (oz / d) * w;
      }

      // Ataque: preparación (windup) y golpe si el jugador sigue al alcance y no hay
      // un muro en medio (con muros finos, ambos pueden quedar a menos del alcance).
      const gap = dist - zb.radius - player.radius;
      const near = player.alive && gap < zb.data.attackRange + ai.attackHitTolerance;
      const clear = near && raycastGrid(grid, zb.pos.x, zb.pos.z, ux, uz, dist, this.blockedWalk) >= dist;
      const playerInRange = clear && gap < zb.data.attackRange;
      // Prioridad: jugador al alcance > construcción que bloquea > transformador.
      const inRange = playerInRange || zb.targetCell !== -1;
      zb.cooldown = Math.max(0, zb.cooldown - dt);
      if (zb.windup > 0) {
        zb.windup -= dt;
        zb.attackAnim = 1 - zb.windup / zb.data.attackWindup;
        if (zb.windup <= 0) {
          const sdmg = zb.data.damage * (zb.data.structureDamageMul ?? 1);
          if (zb.attackTarget === 0 && clear) player.damage(zb.data.damage);
          else if (zb.attackTarget === 1 && zb.targetCell >= 0) game.build.damageCell(zb.targetCell, sdmg);
          else if (zb.attackTarget === 2 && zb.targetCell === -2) game.build.damageTransformer(sdmg);
          zb.cooldown = zb.data.attackCooldown;
          zb.attackAnim = 0;
        }
      } else if (inRange && zb.cooldown <= 0) {
        zb.windup = zb.data.attackWindup;
        zb.attackTarget = playerInRange ? 0 : zb.targetCell >= 0 ? 1 : 2;
      }

      const baseSpeed = zb.speed * this.speedMul * zb.slowMul;
      zb.slowMul = 1; // las trampas lo vuelven a fijar en cada paso
      const speed = zb.windup > 0 || inRange ? baseSpeed * ai.attackSlowFactor : baseSpeed;
      let tvx = mx * speed + sx * ai.separationStrength;
      let tvz = mz * speed + sz * ai.separationStrength;
      const tl = Math.hypot(tvx, tvz);
      const maxV = baseSpeed * ai.maxSpeedFactor;
      if (tl > maxV) { tvx *= maxV / tl; tvz *= maxV / tl; }
      zb.vx += (tvx - zb.vx) * turn;
      zb.vz += (tvz - zb.vz) * turn;
      zb.pos.x += zb.vx * dt;
      zb.pos.z += zb.vz * dt;

      // Colisión "dura" entre zombis: cada uno corrige la mitad del solape (el otro hará
      // su mitad en su turno). Evita que la horda se apile en un mismo punto.
      count = hash.queryInto(zb.pos.x, zb.pos.z, zb.radius * 2 + 0.1, neighbors);
      for (let q = 0; q < count; q++) {
        const o = neighbors[q];
        if (o === zb) continue;
        const ox = zb.pos.x - o.pos.x, oz = zb.pos.z - o.pos.z;
        const minD = zb.radius + o.radius;
        const d2 = ox * ox + oz * oz;
        if (d2 >= minD * minD) continue;
        if (d2 < 1e-8) { zb.pos.x += (Math.random() - 0.5) * 0.02; continue; }
        const d = Math.sqrt(d2);
        const push = (minD - d) * 0.5;
        zb.pos.x += (ox / d) * push;
        zb.pos.z += (oz / d) * push;
      }
      resolveCircleVsGrid(zb.pos, zb.radius, grid);

      // Mira al jugador si está cerca; si golpea algo, hacia ello; si no, hacia donde camina.
      let targetFacing = dist < 3 || zb.hasLos ? Math.atan2(dx, dz) : Math.atan2(zb.vx, zb.vz);
      if (zb.targetCell >= 0 && !playerInRange) {
        targetFacing = Math.atan2(grid.centerX(zb.targetCell % grid.w) - zb.pos.x, grid.centerZ((zb.targetCell / grid.w) | 0) - zb.pos.z);
      } else if (zb.targetCell === -2 && !playerInRange) {
        targetFacing = Math.atan2(transformer.x - zb.pos.x, transformer.z - zb.pos.z);
      }
      let df = targetFacing - zb.facing;
      df = Math.atan2(Math.sin(df), Math.cos(df));
      zb.facing += df * turn;
      zb.walkPhase += Math.hypot(zb.vx, zb.vz) * dt * 2.4;
    }

    // Empuje jugador–zombis: el jugador cede poco para que la horda no lo arrastre.
    if (player.alive) {
      const pr = player.radius;
      const share = ai.playerPushShare;
      const count = hash.queryInto(px, pz, 1.5, neighbors);
      for (let q = 0; q < count; q++) {
        const o = neighbors[q];
        const ox = player.position.x - o.pos.x, oz = player.position.z - o.pos.z;
        const minD = pr + o.radius;
        const d2 = ox * ox + oz * oz;
        if (d2 >= minD * minD || d2 < 1e-8) continue;
        const d = Math.sqrt(d2);
        const overlap = minD - d;
        player.position.x += (ox / d) * overlap * share;
        player.position.z += (oz / d) * overlap * share;
        o.pos.x -= (ox / d) * overlap * (1 - share);
        o.pos.z -= (oz / d) * overlap * (1 - share);
        resolveCircleVsGrid(o.pos, o.radius, grid);
      }
      resolveCircleVsGrid(player.position, pr, grid);
    }
  }

  render() {
    const { meshList, pose, partPivots, _base, _part, _m, _q, _e, _v, _s, _one, _c } = this;
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
      for (let k = 0; k < PART_COUNT; k++) {
        const p = pose[PART_NAMES[k]];
        _e.set(p.x, 0, p.z, 'XYZ');
        _q.setFromEuler(_e);
        _part.compose(partPivots[k], _q, _one);
        _m.multiplyMatrices(_base, _part);
        meshList[k].setMatrixAt(count, _m);
        _c.copy(zb.colors[k]);
        if (zb.flash > 0) _c.lerp(WHITE, 0.7);
        if (zb.state === Z_STATE.DYING) _c.multiplyScalar(0.6);
        meshList[k].setColorAt(count, _c);
        if (k === HEAD_INDEX) {
          // Los muertos no tienen ojos brillantes: se esconden escalando a 0.
          if (zb.state === Z_STATE.DYING) _m.makeScale(0, 0, 0);
          this.eyes.setMatrixAt(count, _m);
        }
      }
      count++;
    }
    for (const m of meshList) {
      m.count = count;
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor.needsUpdate = true;
    }
    this.eyes.count = count;
    this.eyes.instanceMatrix.needsUpdate = true;
    this.eyes.visible = this.eyeMaterial.opacity > 0.01;
  }
}
