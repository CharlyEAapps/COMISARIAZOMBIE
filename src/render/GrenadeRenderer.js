import * as THREE from 'three';
import { grenadeGeometry, WEAPON_MATERIAL_OPTIONS } from './WeaponModels.js';
import weapons from '../data/weapons.json';

const G = weapons._granada;
const MAX = G.maxInAir;
const BLINK = new THREE.Color(3, 0.5, 0.4);
const WHITE = new THREE.Color(1, 1, 1);

// Granadas en vuelo y en el suelo (antes de explotar): un InstancedMesh pequeño.
export class GrenadeRenderer {
  constructor(game) {
    this.game = game;
    this.mesh = new THREE.InstancedMesh(grenadeGeometry(), new THREE.MeshStandardMaterial(WEAPON_MATERIAL_OPTIONS), MAX);
    this.mesh.count = 0;
    this.mesh.setColorAt(0, WHITE);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    game.scene.add(this.mesh);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3().setScalar(G.renderScale); // exagerada para que se lea desde la cámara
  }

  update() {
    const list = this.game.weapons.grenadesInAir;
    const n = Math.min(MAX, list.length);
    for (let i = 0; i < n; i++) {
      const g = list[i];
      this._e.set(g.spin, g.spin * 0.7, 0);
      this._q.setFromEuler(this._e);
      this._p.set(g.x, g.y, g.z);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
      // Parpadeo rojo cuando queda poca mecha.
      const blink = g.fuse < G.blinkBelow && Math.sin(g.fuse * 40) > 0;
      this.mesh.setColorAt(i, blink ? BLINK : WHITE);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.game.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
