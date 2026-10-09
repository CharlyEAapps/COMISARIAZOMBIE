import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import zombieData from '../data/zombies.json';
import { FlowField, WideFlowField } from './FlowField.js';
import { resolveCircleVsGrid, raycastGrid, rayCircle, SpatialHash } from './Physics.js';
import { PARTS, PART_NAMES, partGeometry, computePose, makePose } from '../render/BlockyCharacter.js';
import { ACCESSORIES, ACCESSORY_SETS } from '../render/ZombieAccessories.js';

const SHIRTS = [0x7a5c3e, 0x4b5d73, 0x8c3b3b, 0x5f6b4e, 0x6b6b6b, 0x6a4f7a];
const PANTS = [0x2e3542, 0x3e3328, 0x24282e, 0x40464f];
const WHITE = new THREE.Color(0xffffff);
const PART_COUNT = PART_NAMES.length;
const HEAD_INDEX = PART_NAMES.indexOf('head');
const ATTACH_INDEX = { head: HEAD_INDEX, torso: PART_NAMES.indexOf('torso'), armR: PART_NAMES.indexOf('armR'), base: -1 };

export const Z_STATE = { CHASE: 0, DYING: 1 };

/**
 * Cuerpo de un tipo de zombi: escala de cada parte y pivotes desplazados (un torso más alto
 * sube la cabeza y los hombros; `armSpread` separa los brazos de un torso ancho).
 */
export function bodyOf(d) {
  const b = d.body ?? {};
  const key = (n) => (n.startsWith('leg') ? 'legs' : n.startsWith('arm') ? 'arms' : n);
  const dy = PARTS.torso.size[1] * ((b.torso?.[1] ?? 1) - 1);
  const pivots = PART_NAMES.map((n) => {
    const v = new THREE.Vector3().fromArray(PARTS[n].pivot);
    if (n === 'head' || n.startsWith('arm')) v.y += dy;
    if (n.startsWith('arm')) v.x += Math.sign(v.x) * (b.armSpread ?? 0);
    return v;
  });
  const scales = PART_NAMES.map((n) => new THREE.Vector3().fromArray(b[key(n)] ?? [1, 1, 1]));
  const hex = (list, fallback) => (list ? list.map((c) => new THREE.Color(c).getHex()) : fallback);
  return {
    pivots, scales, lean: b.lean ?? 0,
    shirts: hex(d.shirts, SHIRTS), pants: hex(d.pants, PANTS),
    accessories: ACCESSORY_SETS[d.accessory] ?? [],
  };
}

function makeZombie(id) {
  return {
    id, active: false, type: '', data: null,
    pos: { x: 0, z: 0 }, vx: 0, vz: 0, facing: 0, scale: 1,
    hp: 0, maxHp: 0, speed: 0, radius: 0.38,
    state: Z_STATE.CHASE, windup: 0, cooldown: 0, attackAnim: 0,
    losTimer: 0, hasLos: false, walkPhase: 0, flash: 0,
    deathTimer: 0, fall: 0, sink: 0,
    stunTimer: 0, slowMul: 1, vandal: false, attackTarget: 0, // 0 jugador, 1 estructura, 2 transformador
    targetCell: -1, body: null, turn: 0, big: false, shieldMsgAt: -9,
    spitCd: 0, spitWindup: 0, spitLos: false, selfDestruct: false, exploded: false,
    colors: PART_NAMES.map(() => new THREE.Color()),
  };
}

const rnd = (v) => 1 + (Math.random() * 2 - 1) * v;

export class ZombieSystem {
  constructor(game) {
    this.game = game;
    this.types = zombieData;
    this.ai = zombieData._ai;
    this.bodies = {};
    for (const [type, d] of Object.entries(zombieData)) if (!type.startsWith('_')) this.bodies[type] = bodyOf(d);
    this.boss = null; // jefe vivo (barra de vida en el HUD)
    const max = this.ai.maxZombies;
    this.pool = Array.from({ length: max }, (_, id) => makeZombie(id));
    // Pila de huecos libres del pool: spawn O(1).
    this.free = this.pool.map((z) => z).reverse();
    this.active = [];
    this.flow = new FlowField(game.grid);
    this.bigFlow = new WideFlowField(game.grid); // rutas anchas para tanques y jefes
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
    this.blockedShot = (i, j) => g.isShotBlocked(i, j);
    this._vandalTargets = [];
    this._wp = { x: 0, z: 0 };

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
    // Accesorios de los tipos especiales: un InstancedMesh por accesorio.
    this.accessoryMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
    this.accessoryMeshes = {};
    for (const [name, a] of Object.entries(ACCESSORIES)) {
      const mesh = new THREE.InstancedMesh(a.geometry(), this.accessoryMaterial, max);
      mesh.castShadow = true;
      mesh.count = 0;
      mesh.frustumCulled = false;
      game.scene.add(mesh);
      this.accessoryMeshes[name] = { mesh, attach: ATTACH_INDEX[a.part] };
    }
    this._partM = PART_NAMES.map(() => new THREE.Matrix4());

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
    this.boss = null;
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

  /** Aturde (cepo, táser, valla) respetando la resistencia del tipo. */
  stun(zb, seconds) {
    zb.stunTimer = Math.max(zb.stunTimer, seconds * (1 - (zb.data.stunResist ?? 0)));
  }

  /**
   * ¿Para el escudo el impacto que viaja en la dirección (dx, dz)? Solo los que llegan de
   * frente, dentro del arco del escudo.
   */
  shieldBlocks(zb, dx, dz) {
    const sh = zb.data.shield;
    if (!sh || zb.state === Z_STATE.DYING) return false;
    const dot = dx * Math.sin(zb.facing) + dz * Math.cos(zb.facing);
    return dot < -Math.cos(THREE.MathUtils.degToRad(sh.arcDeg / 2));
  }

  /** Chispas y aviso de un impacto parado por el escudo. */
  shieldHit(zb, dx, dz) {
    const fx = Math.sin(zb.facing), fz = Math.cos(zb.facing);
    const r = zb.radius + 0.25;
    this.game.effects.burst(zb.pos.x + fx * r, 1.2 * zb.scale, zb.pos.z + fz * r, 5, 0xffe2a0, { speed: 2.5, up: 2, size: 0.05, life: 0.35, dirX: -dx, dirZ: -dz });
    if (this.game.time - zb.shieldMsgAt > zb.data.shield.msgCooldown) {
      zb.shieldMsgAt = this.game.time;
      this.game.floating?.spawn('¡Escudo!', zb.pos.x, 2.6 * zb.scale, zb.pos.z, 'neg');
    }
    this.game.bus.emit('zombie:blocked', { zombie: zb });
  }

  /** @param {{hpMul?:number, speedMul?:number}} [mods] escalado por noche */
  spawn(type, x, z, mods) {
    const zb = this.free.pop();
    if (!zb) return null;
    const d = this.types[type];
    zb.active = true;
    zb.type = type;
    zb.data = d;
    zb.body = this.bodies[type];
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
    zb.turn = d.turnSharpness ?? this.ai.turnSharpness;
    zb.spitCd = d.spit ? d.spit.cooldown * Math.random() : 0;
    zb.spitWindup = 0; zb.spitLos = false; zb.selfDestruct = false; zb.exploded = false;
    zb.shieldMsgAt = -9;
    const build = this.game.build;
    const tcfg = build?.cfg.transformer;
    // Los jefes no se distraen con las instalaciones eléctricas.
    zb.big = zb.radius > this.ai.bigRadius;
    // Los grandes no se distraen (solo siguen rutas anchas hacia el jugador).
    zb.vandal = !zb.big && !d.boss && !!build && build.vandalTargetsAlive() &&
      this.game.dayNight.night >= tcfg.vandalFromNight && Math.random() < tcfg.vandalChance;
    zb.trapAcc = 0;
    const body = zb.body;
    const skin = this._c.set(d.color).multiplyScalar(rnd(d.colorVariance));
    const shirt = body.shirts[(Math.random() * body.shirts.length) | 0];
    const pants = body.pants[(Math.random() * body.pants.length) | 0];
    for (let k = 0; k < PART_COUNT; k++) {
      const n = PART_NAMES[k], c = zb.colors[k];
      if (n === 'torso') c.setHex(shirt);
      else if (n === 'legL' || n === 'legR') c.setHex(pants);
      else if (n === 'armL' || n === 'armR') c.setHex(d.armsShirt || Math.random() < 0.5 ? shirt : skin.getHex());
      else c.copy(skin);
    }
    if (d.boss) this.boss = zb;
    this.active.push(zb);
    return zb;
  }

  /**
   * Aplica daño. Devuelve true si lo mata.
   * @param {boolean} [quiet] daño continuo (trampas): sin destello, empuje ni evento de impacto
   */
  damage(zb, amount, dirX = 0, dirZ = 0, knockback = 0, quiet = false) {
    if (zb.state === Z_STATE.DYING) return false;
    zb.hp -= amount;
    knockback *= 1 - (zb.data.knockbackResist ?? 0);
    if (!quiet) {
      zb.flash = 0.1;
      if (knockback) {
        zb.pos.x += dirX * knockback;
        zb.pos.z += dirZ * knockback;
        resolveCircleVsGrid(zb.pos, zb.radius, this.game.grid);
      }
      this.game.bus.emit('zombie:hit', { zombie: zb, amount });
    }
    if (zb.hp <= 0) {
      this.kill(zb);
      return true;
    }
    return false;
  }

  kill(zb) {
    const d = zb.data;
    zb.state = Z_STATE.DYING;
    zb.hp = 0;
    zb.deathTimer = 0;
    zb.windup = 0;
    zb.attackAnim = 0;
    zb.spitWindup = 0;
    if (this.boss === zb) {
      this.boss = null;
      this.game.bus.emit('boss:killed', { type: zb.type, x: zb.pos.x, z: zb.pos.z });
    }
    // Los explosivos revientan al morir (en cadena si hay más cerca).
    if (d.explosion && !zb.exploded) {
      zb.exploded = true;
      this.game.blasts.schedule(zb.pos.x, zb.pos.z, d.explosion, zb.selfDestruct ? 0 : d.explosion.chainDelay);
    }
    // Si revienta él solo al alcanzarte, no da puntos.
    this.game.bus.emit('zombie:killed', {
      type: zb.type, points: zb.selfDestruct ? 0 : d.points, x: zb.pos.x, z: zb.pos.z, selfDestruct: zb.selfDestruct,
    });
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
    // Rutas de los vándalos al transformador y a los generadores (destinos fijos): solo al
    // cambiar las construcciones o el estado del transformador.
    const build = game.build;
    const vandalKey = build?.transformer?.hp > 0 ? 1 : 0;
    let vandalDue = !!build && this.vandalTarget !== vandalKey;
    if (this.flowTimer <= 0 && (pcell !== this.flowCell || this.flowDirty) && pcell >= 0) {
      flow.compute(pcell % grid.w, (pcell / grid.w) | 0);
      this.bigFlow.compute(pcell % grid.w, (pcell / grid.w) | 0);
      this.flowCell = pcell;
      this.flowTimer = ai.flowFieldInterval;
      if (this.flowDirty) vandalDue = !!build;
      if (this.flowDirty && this.decoy.timer > 0) this.setDecoy(this.decoy.x, this.decoy.z, this.decoy.timer, this.decoy.radius);
      this.flowDirty = false;
    }
    if (vandalDue) {
      build.vandalTargetCells(this._vandalTargets);
      this.vandalFlow.computeMulti(this._vandalTargets);
      this.vandalTarget = vandalKey;
    }
    const transformer = game.build?.transformer;
    const trAlive = !!transformer && transformer.hp > 0;
    const vandalsActive = !!game.build && game.build.vandalTargetsAlive();
    const generators = game.build?.generators;

    hash.clear();
    for (const zb of this.active) if (zb.state !== Z_STATE.DYING) hash.insert(zb, zb.pos.x, zb.pos.z);

    const sepR = ai.separationRadius;
    const decoy = this.decoy;
    if (decoy.timer > 0) decoy.timer -= dt;
    if (this.speedMulTimer > 0 && (this.speedMulTimer -= dt) <= 0) this.speedMul = 1;

    for (let n = this.active.length - 1; n >= 0; n--) {
      const zb = this.active[n];
      const d = zb.data;
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

      // Atrapado en un cepo o aturdido: no se mueve ni ataca (un explosivo a punto de
      // reventar revienta igual).
      if (zb.stunTimer > 0 && !(d.explosion && zb.windup > 0)) {
        zb.stunTimer -= dt;
        zb.vx *= 0.5; zb.vz *= 0.5;
        zb.windup = 0; zb.attackAnim = 0;
        zb.spitWindup = 0;
        zb.slowMul = 1;
        continue;
      }

      // Línea de visión escalonada en el tiempo (no todos los zombis en el mismo paso).
      zb.losTimer -= dt;
      if (zb.losTimer <= 0) {
        zb.losTimer = ai.losCheckInterval;
        zb.hasLos = dist < ai.directChaseRange &&
          raycastGrid(grid, zb.pos.x, zb.pos.z, ux, uz, dist, this.blockedWalk) >= dist;
        // Un zombi grande solo va en línea recta si cabe: comprueba también los dos bordes.
        if (zb.hasLos && zb.big) {
          const ox = -uz * zb.radius, oz = ux * zb.radius;
          zb.hasLos = raycastGrid(grid, zb.pos.x + ox, zb.pos.z + oz, ux, uz, dist, this.blockedWalk) >= dist &&
            raycastGrid(grid, zb.pos.x - ox, zb.pos.z - oz, ux, uz, dist, this.blockedWalk) >= dist;
        }
        // Escupidor: el ácido va en arco y pasa por encima de lo bajo (sacos, vallas).
        if (d.spit) {
          zb.spitLos = player.alive && dist < d.spit.range &&
            raycastGrid(grid, zb.pos.x, zb.pos.z, ux, uz, dist, this.blockedShot) >= dist;
        }
      }

      // Dirección deseada: directa si ve al jugador; hacia el señuelo si lo oye;
      // si no, la del flow field.
      let mx = ux, mz = uz;
      let toDecoy = false;
      if (!zb.hasLos && decoy.timer > 0 && !zb.big) {
        const dd = Math.hypot(decoy.x - zb.pos.x, decoy.z - zb.pos.z);
        toDecoy = dd < decoy.radius;
        if (toDecoy && dd < 1.5) { mx = 0; mz = 0; }
      }
      // Los vándalos van a por el transformador o los generadores salvo que tengan al jugador encima.
      const goVandal = zb.vandal && vandalsActive && !(zb.hasLos && dist < game.build.cfg.transformer.vandalIgnoreRange);
      zb.targetCell = -1;
      if ((!zb.hasLos || goVandal) && !(toDecoy && mx === 0 && mz === 0)) {
        // Flow field hacia el jugador, el señuelo o el transformador.
        const cell = grid.walkableCellAt(zb.pos.x, zb.pos.z);
        // Los grandes usan rutas anchas; si no hay ninguna (rincones), la normal.
        const wide = zb.big && cell >= 0 && this.bigFlow.dist[cell] < Infinity;
        const field = goVandal ? this.vandalFlow : toDecoy ? this.decoyFlow : wide ? this.bigFlow : flow;
        const nk = cell >= 0 ? field.next[cell] : -1;
        if (nk >= 0) {
          // Los grandes apuntan al centro del hueco libre de 2×2 entre esta celda y la
          // siguiente (si no, se clavan en las esquinas de los muebles).
          const t = field === this.bigFlow ? this.wideWaypoint(zb, cell, nk) : null;
          const tx = (t ? t.x : grid.centerX(nk % grid.w)) - zb.pos.x;
          const tz = (t ? t.z : grid.centerZ((nk / grid.w) | 0)) - zb.pos.z;
          const tl = Math.hypot(tx, tz) || 1;
          mx = tx / tl; mz = tz / tl;
          // La siguiente celda tiene una construcción que bloquea: hay que romperla.
          if (grid.blocked[nk] && this.nearBox(zb, grid.dynBox, nk * 4, zb.radius + ai.structureReach)) zb.targetCell = nk;
        }
        if (goVandal) {
          const reach = zb.radius + game.build.cfg.transformer.attackRange;
          if (trAlive && this.nearBox(zb, transformer.box, 0, reach)) {
            zb.targetCell = -2;
            mx = 0; mz = 0;
          } else {
            for (const s of generators) {
              if (this.nearBox(zb, grid.dynBox, s.k * 4, reach)) { zb.targetCell = s.k; mx = 0; mz = 0; break; }
            }
          }
        }
      }

      // Escupidor: con el jugador a tiro se para a distancia (o retrocede si está muy cerca)
      // y le lanza ácido en arco.
      if (d.spit && !goVandal) {
        const sp = d.spit;
        zb.spitCd -= dt;
        if (zb.spitWindup > 0) {
          zb.spitWindup -= dt;
          mx = 0; mz = 0;
          if (zb.spitWindup <= 0) this.spit(zb, sp);
        } else if (zb.spitLos) {
          if (dist < sp.minRange) { mx = -ux; mz = -uz; }
          else if (dist <= sp.preferredRange) { mx = 0; mz = 0; }
          if (zb.spitCd <= 0 && dist >= sp.minRange * sp.minFireRangeMul) {
            zb.spitWindup = sp.windup;
            zb.spitCd = sp.cooldown * rnd(sp.cooldownJitter);
          }
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
          // El explosivo no golpea: revienta.
          if (d.explosion) {
            zb.selfDestruct = true;
            this.kill(zb);
            continue;
          }
          const sdmg = zb.data.damage * (zb.data.structureDamageMul ?? 1);
          if (zb.attackTarget === 0 && clear) {
            player.damage(zb.data.damage);
            if (d.playerKnockback) player.knockback(ux, uz, d.playerKnockback);
          } else if (zb.attackTarget === 1 && zb.targetCell >= 0) game.build.damageCell(zb.targetCell, sdmg);
          else if (zb.attackTarget === 2 && zb.targetCell === -2) game.build.damageTransformer(sdmg);
          zb.cooldown = zb.data.attackCooldown;
          zb.attackAnim = 0;
        }
      } else if (inRange && zb.cooldown <= 0) {
        zb.windup = zb.data.attackWindup;
        zb.attackTarget = playerInRange ? 0 : zb.targetCell >= 0 ? 1 : 2;
      }

      const turn = 1 - Math.exp(-zb.turn * dt);
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
      let targetFacing = dist < 3 || zb.hasLos || zb.spitLos ? Math.atan2(dx, dz) : Math.atan2(zb.vx, zb.vz);
      if (zb.targetCell >= 0 && !playerInRange) {
        targetFacing = Math.atan2(grid.centerX(zb.targetCell % grid.w) - zb.pos.x, grid.centerZ((zb.targetCell / grid.w) | 0) - zb.pos.z);
      } else if (zb.targetCell === -2 && !playerInRange) {
        targetFacing = Math.atan2(transformer.x - zb.pos.x, transformer.z - zb.pos.z);
      }
      let df = targetFacing - zb.facing;
      df = Math.atan2(Math.sin(df), Math.cos(df));
      zb.facing += df * turn;
      zb.walkPhase += Math.hypot(zb.vx, zb.vz) * dt * 2.4 * (d.walkCycle ?? 1);
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

  /**
   * Centro del bloque libre de 2×2 que contiene las celdas a y b (o null si no hay). En
   * diagonal es la esquina común; en recto, el lado libre más cercano al zombi.
   */
  blockCenter(zb, a, b, out) {
    const g = this.game.grid, w = g.w;
    const ai = a % w, aj = (a / w) | 0, bi = b % w, bj = (b / w) | 0;
    let ox = 0, oz = 0;
    if (ai !== bi && aj !== bj) {
      // diagonal: el bloque es el que forman
    } else if (ai !== bi) {
      const pref = zb.pos.z >= g.centerZ(aj) ? 1 : -1;
      if (g.isStaticWalkable(ai, aj + pref) && g.isStaticWalkable(bi, aj + pref)) oz = pref * 0.5;
      else if (g.isStaticWalkable(ai, aj - pref) && g.isStaticWalkable(bi, aj - pref)) oz = -pref * 0.5;
      else return null;
    } else {
      const pref = zb.pos.x >= g.centerX(ai) ? 1 : -1;
      if (g.isStaticWalkable(ai + pref, aj) && g.isStaticWalkable(ai + pref, bj)) ox = pref * 0.5;
      else if (g.isStaticWalkable(ai - pref, aj) && g.isStaticWalkable(ai - pref, bj)) ox = -pref * 0.5;
      else return null;
    }
    out.x = g.originX + ((ai + bi) / 2 + 0.5 + ox) * g.cellSize;
    out.z = g.originZ + ((aj + bj) / 2 + 0.5 + oz) * g.cellSize;
    return out;
  }

  /** Punto al que se dirige un zombi grande: el hueco actual o, si ya está en él, el siguiente. */
  wideWaypoint(zb, cell, nk) {
    const out = this._wp;
    let t = this.blockCenter(zb, cell, nk, out);
    if (t && Math.hypot(t.x - zb.pos.x, t.z - zb.pos.z) < this.ai.bigLookahead) {
      const nn = this.bigFlow.next[nk];
      t = nn >= 0 ? this.blockCenter(zb, nk, nn, out) : null;
    }
    return t;
  }

  /** Lanza ácido hacia el jugador (con algo de anticipación y error). */
  spit(zb, sp) {
    const { player, acid } = this.game;
    if (!player.alive || !acid) return;
    const px = player.position.x, pz = player.position.z;
    const dist = Math.hypot(px - zb.pos.x, pz - zb.pos.z);
    const flight = Math.max(sp.minFlight, dist / sp.speed);
    const err = () => (Math.random() - 0.5) * 2 * sp.error;
    const tx = px + player.velocity.x * flight * sp.lead + err();
    const tz = pz + player.velocity.z * flight * sp.lead + err();
    acid.launch(zb.pos.x, zb.pos.z, tx, tz, sp, sp.launchHeight * zb.scale);
  }

  dispose() {
    const { scene } = this.game;
    const meshes = [...this.meshList, this.eyes, ...Object.values(this.accessoryMeshes).map((a) => a.mesh)];
    for (const m of meshes) {
      scene.remove(m);
      m.geometry.dispose();
      m.dispose();
    }
    for (const m of this.meshList) m.material.dispose();
    this.eyeMaterial.dispose();
    this.accessoryMaterial.dispose();
  }

  render() {
    const { meshList, pose, _base, _part, _m, _q, _e, _v, _s, _c, _partM } = this;
    const acc = this.accessoryMeshes;
    for (const name in acc) acc[name].mesh.count = 0;
    let count = 0;
    for (const zb of this.active) {
      const d = zb.data, body = zb.body;
      const dying = zb.state === Z_STATE.DYING;
      const moving = Math.min(1, Math.hypot(zb.vx, zb.vz) / Math.max(zb.speed, 0.01));
      computePose(pose, zb.walkPhase, dying ? 0 : moving, 'zombie', zb.attackAnim);
      if (d.pose === 'boss') {
        // Escudo al frente con la izquierda; la porra se levanta durante la preparación.
        pose.armL.x = -1.2; pose.armL.z = 0.3;
        pose.armR.x = -0.35 - zb.attackAnim * 2.5; pose.armR.z = 0.05;
      }
      if (zb.spitWindup > 0) pose.head.x = -0.35; // echa la cabeza atrás antes de escupir
      // Base: posición, giro, inclinación al correr, caída hacia atrás al morir y hundimiento final.
      _e.set(-zb.fall * Math.PI / 2 + body.lean * moving, zb.facing, 0, 'YXZ');
      _q.setFromEuler(_e);
      _v.set(zb.pos.x, -zb.sink * 0.6 + zb.fall * 0.12, zb.pos.z);
      // El explosivo se hincha y parpadea mientras está a punto de reventar.
      const fusing = d.explosion && zb.windup > 0 && !dying;
      const swell = fusing ? 1 + zb.attackAnim * 0.18 * (0.6 + 0.4 * Math.sin(zb.attackAnim * 40)) : 1;
      _s.setScalar(zb.scale * swell);
      _base.compose(_v, _q, _s);
      const blink = fusing && Math.sin(zb.attackAnim * 40) > 0;
      for (let k = 0; k < PART_COUNT; k++) {
        const p = pose[PART_NAMES[k]];
        _e.set(p.x, 0, p.z, 'XYZ');
        _q.setFromEuler(_e);
        _part.compose(body.pivots[k], _q, body.scales[k]);
        _m.multiplyMatrices(_base, _part);
        _partM[k].copy(_m);
        meshList[k].setMatrixAt(count, _m);
        _c.copy(zb.colors[k]);
        if (zb.flash > 0 || blink) _c.lerp(WHITE, 0.7);
        if (dying) _c.multiplyScalar(0.6);
        meshList[k].setColorAt(count, _c);
        if (k === HEAD_INDEX) {
          // Los muertos no tienen ojos brillantes: se esconden escalando a 0.
          if (dying) _m.makeScale(0, 0, 0);
          this.eyes.setMatrixAt(count, _m);
        }
      }
      for (const name of body.accessories) {
        const a = acc[name];
        a.mesh.setMatrixAt(a.mesh.count++, a.attach < 0 ? _base : _partM[a.attach]);
      }
      count++;
    }
    for (const m of meshList) {
      m.count = count;
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor.needsUpdate = true;
    }
    for (const name in acc) if (acc[name].mesh.count) acc[name].mesh.instanceMatrix.needsUpdate = true;
    this.eyes.count = count;
    this.eyes.instanceMatrix.needsUpdate = true;
    this.eyes.visible = this.eyeMaterial.opacity > 0.01;
  }
}
