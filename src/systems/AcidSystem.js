import * as THREE from 'three';
import { raycastGrid } from './Physics.js';

const MAX_BLOBS = 32;
const MAX_PUDDLES = 24;
const BLOB_COLOR = 0x9be03c;

// Ácido de los escupidores: proyectiles en arco que dejan un charco temporal. El charco
// quema al jugador que lo pisa y corroe las construcciones de su celda.
export class AcidSystem {
  constructor(game) {
    this.game = game;
    this.blobs = Array.from({ length: MAX_BLOBS }, () => ({ active: false }));
    this.puddles = Array.from({ length: MAX_PUDDLES }, () => ({ active: false }));
    this.shotBlocked = (i, j) => game.grid.isShotBlocked(i, j);

    this.blobMesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.16, 0),
      new THREE.MeshBasicMaterial({ color: BLOB_COLOR }),
      MAX_BLOBS,
    );
    this.puddleMesh = new THREE.InstancedMesh(
      new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x7fd02a, transparent: true, opacity: 0.55, depthWrite: false }),
      MAX_PUDDLES,
    );
    for (const m of [this.blobMesh, this.puddleMesh]) {
      m.count = 0;
      m.frustumCulled = false;
      game.scene.add(m);
    }
    this.puddleMesh.renderOrder = 2;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
  }

  reset() {
    for (const b of this.blobs) b.active = false;
    for (const p of this.puddles) p.active = false;
  }

  /**
   * Lanza un proyectil de ácido de (x0,z0) a (x1,z1). Pasa por encima de lo bajo y se para
   * antes del primer obstáculo alto (muros, barricadas, puertas cerradas).
   */
  launch(x0, z0, x1, z1, sp, height) {
    const b = this.blobs.find((o) => !o.active);
    if (!b) return;
    let dx = x1 - x0, dz = z1 - z0;
    let dist = Math.hypot(dx, dz);
    if (dist < 1e-3) return;
    dx /= dist; dz /= dist;
    const wall = raycastGrid(this.game.grid, x0, z0, dx, dz, dist, this.shotBlocked);
    if (wall < dist) dist = Math.max(0, wall - sp.wallMargin);
    Object.assign(b, {
      active: true, x0, z0, x1: x0 + dx * dist, z1: z0 + dz * dist, t: 0,
      flight: Math.max(sp.minFlight, dist / sp.speed), h0: height, x: x0, y: height, z: z0, sp,
    });
    this.game.bus.emit('acid:spit', { x: x0, z: z0 });
  }

  splash(b) {
    const { game } = this;
    const sp = b.sp;
    const p = this.puddles.find((o) => !o.active) ?? this.puddles.reduce((a, o) => (o.timer < a.timer ? o : a));
    Object.assign(p, { active: true, x: b.x1, z: b.z1, r: sp.puddleRadius, timer: sp.puddleTime, life: sp.puddleTime, sp, acc: 0 });
    game.effects.burst(b.x1, 0.2, b.z1, 12, BLOB_COLOR, { speed: 2.5, up: 2.5, size: 0.08, life: 0.6 });
    const pl = game.player;
    if (Math.hypot(pl.position.x - b.x1, pl.position.z - b.z1) < sp.puddleRadius + pl.radius) pl.damage(sp.impactDamage);
  }

  update(dt) {
    const { game } = this;
    for (const b of this.blobs) {
      if (!b.active) continue;
      b.t += dt;
      const k = Math.min(1, b.t / b.flight);
      b.x = b.x0 + (b.x1 - b.x0) * k;
      b.z = b.z0 + (b.z1 - b.z0) * k;
      b.y = b.h0 * (1 - k) + Math.sin(k * Math.PI) * b.sp.arcHeight;
      if (k >= 1) {
        b.active = false;
        this.splash(b);
      }
    }
    const { player, grid, build } = game;
    for (const p of this.puddles) {
      if (!p.active) continue;
      p.timer -= dt;
      if (p.timer <= 0) { p.active = false; continue; }
      // El daño se aplica a golpes (sin destello constante).
      const sp = p.sp, TICK = sp.damageTick;
      p.acc += dt;
      if (p.acc < TICK) continue;
      p.acc -= TICK;
      const r = this.radiusOf(p);
      if (player.alive && Math.hypot(player.position.x - p.x, player.position.z - p.z) < r + player.radius * sp.footprint) {
        player.damage(sp.puddleDps * TICK);
      }
      // Corroe lo construido en su celda y en las vecinas que toca.
      const i0 = grid.cellX(p.x - r), i1 = grid.cellX(p.x + r);
      const j0 = grid.cellZ(p.z - r), j1 = grid.cellZ(p.z + r);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        if (!grid.inBounds(i, j)) continue;
        const k = grid.index(i, j);
        const s = build.structures.get(k);
        if (!s || s.def.kind === 'trampa') continue;
        const [x0, z0, x1, z1] = grid.cellBox(i, j);
        const cx = Math.max(x0, Math.min(p.x, x1)), cz = Math.max(z0, Math.min(p.z, z1));
        if (Math.hypot(cx - p.x, cz - p.z) < r) build.damageCell(k, sp.structureDps * TICK / s.n, true);
      }
    }
  }

  /** Radio actual de un charco: encoge al secarse. */
  radiusOf(p) {
    return p.r * Math.min(1, p.timer / (p.life * p.sp.shrinkFrom));
  }

  render(time) {
    const { _m, _q, _p, _s } = this;
    let n = 0;
    for (const b of this.blobs) {
      if (!b.active) continue;
      _p.set(b.x, b.y, b.z);
      _s.setScalar(1);
      _m.compose(_p, _q, _s);
      this.blobMesh.setMatrixAt(n++, _m);
    }
    this.blobMesh.count = n;
    this.blobMesh.instanceMatrix.needsUpdate = true;
    n = 0;
    for (const p of this.puddles) {
      if (!p.active) continue;
      const r = this.radiusOf(p) * (1 + 0.04 * Math.sin(time * 6 + p.x));
      _p.set(p.x, 0.03 + n * 0.001, p.z);
      _s.set(r, 1, r);
      _m.compose(_p, _q, _s);
      this.puddleMesh.setMatrixAt(n++, _m);
    }
    this.puddleMesh.count = n;
    this.puddleMesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    for (const m of [this.blobMesh, this.puddleMesh]) {
      this.game.scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
  }
}
