import * as THREE from 'three';

// Efectos visuales con pools fijos: trazadoras de bala, fogonazo, partículas de
// cubitos (sangre oscura, polvo, chispas) y temblor de cámara.
const MAX_TRACERS = 24;
const MAX_PARTICLES = 500;

export class Effects {
  constructor(scene) {
    this.scene = scene;

    // Trazadoras: caja fina estirada entre origen y destino.
    const tracerGeo = new THREE.BoxGeometry(1, 1, 1);
    tracerGeo.translate(0, 0, 0.5);
    this.tracers = [];
    for (let i = 0; i < MAX_TRACERS; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffe6a0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      const mesh = new THREE.Mesh(tracerGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.tracers.push({ mesh, life: 0, maxLife: 0.07 });
    }
    this._tracerIdx = 0;

    // Fogonazo: una única luz puntual reutilizada.
    this.flashLight = new THREE.PointLight(0xffc870, 0, 9, 1.6);
    scene.add(this.flashLight);
    this.flashTimer = 0;

    // Partículas: un InstancedMesh de cubitos.
    this.particles = new Array(MAX_PARTICLES);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles[i] = { life: 0, maxLife: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0.1, color: new THREE.Color(), rot: 0 };
    }
    this._pIdx = 0;
    this.particleMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
      MAX_PARTICLES,
    );
    this.particleMesh.frustumCulled = false;
    this.particleMesh.count = 0;
    this.particleMesh.setColorAt(0, new THREE.Color());
    scene.add(this.particleMesh);

    this.trauma = 0;
    this.shakeOffset = new THREE.Vector3();

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
  }

  tracer(from, to, color = 0xffe6a0) {
    const t = this.tracers[this._tracerIdx];
    this._tracerIdx = (this._tracerIdx + 1) % MAX_TRACERS;
    const len = from.distanceTo(to);
    t.mesh.position.copy(from);
    t.mesh.lookAt(to);
    t.mesh.scale.set(0.05, 0.05, len);
    t.mesh.material.color.set(color);
    t.mesh.material.opacity = 1;
    t.mesh.visible = true;
    t.life = t.maxLife;
  }

  muzzleFlash(pos) {
    this.flashLight.position.copy(pos);
    this.flashLight.intensity = 25;
    this.flashTimer = 0.05;
  }

  /** Ráfaga de cubitos. */
  burst(x, y, z, count, color, { speed = 3, up = 2, size = 0.09, life = 0.6, dirX = 0, dirZ = 0 } = {}) {
    for (let n = 0; n < count; n++) {
      const p = this.particles[this._pIdx];
      this._pIdx = (this._pIdx + 1) % MAX_PARTICLES;
      p.x = x; p.y = y; p.z = z;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      p.vx = Math.cos(a) * s * 0.6 + dirX * s;
      p.vz = Math.sin(a) * s * 0.6 + dirZ * s;
      p.vy = up * (0.4 + Math.random() * 0.8);
      p.size = size * (0.6 + Math.random() * 0.8);
      p.maxLife = p.life = life * (0.6 + Math.random() * 0.6);
      p.rot = Math.random() * 3;
      p.color.set(color).multiplyScalar(0.8 + Math.random() * 0.4);
    }
  }

  shake(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(dt) {
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, t.life / t.maxLife);
      if (t.life <= 0) t.mesh.visible = false;
    }

    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) this.flashLight.intensity = 0;
    }

    const { _m, _q, _e, _v, _s } = this;
    let count = 0;
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.vy -= 12 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < p.size / 2) {
        // Se quedan en el suelo un momento (manchas de cubitos).
        p.y = p.size / 2; p.vy = 0; p.vx *= 0.6; p.vz *= 0.6;
      }
      const k = Math.min(1, p.life / (p.maxLife * 0.3));
      _e.set(p.rot, p.rot * 1.3, 0);
      _q.setFromEuler(_e);
      _v.set(p.x, p.y, p.z);
      _s.setScalar(p.size * k);
      _m.compose(_v, _q, _s);
      this.particleMesh.setMatrixAt(count, _m);
      this.particleMesh.setColorAt(count, p.color);
      count++;
    }
    this.particleMesh.count = count;
    this.particleMesh.instanceMatrix.needsUpdate = true;
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;

    // Temblor de cámara proporcional al cuadrado del "trauma".
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    const s = this.trauma * this.trauma * 0.6;
    const t = performance.now() * 0.05;
    this.shakeOffset.set(Math.sin(t * 1.7) * s, Math.sin(t * 2.3) * s * 0.5, Math.cos(t * 1.9) * s);
  }

  reset() {
    for (const p of this.particles) p.life = 0;
    for (const t of this.tracers) { t.life = 0; t.mesh.visible = false; }
    this.trauma = 0;
  }
}
