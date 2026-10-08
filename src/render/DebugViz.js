import * as THREE from 'three';

// Visualización del flow field (panel F1): una flecha por celda alcanzable apuntando
// a la siguiente celda, coloreada por distancia al jugador.
export class FlowFieldViz {
  constructor(scene, grid) {
    this.grid = grid;
    const geo = new THREE.ConeGeometry(0.12, 0.45, 4);
    geo.rotateX(Math.PI / 2); // la punta mira a +Z
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }), grid.w * grid.h);
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.setColorAt(0, new THREE.Color());
    scene.add(this.mesh);
    this.timer = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._up = new THREE.Vector3(0, 1, 0);
    this._c = new THREE.Color();
  }

  setVisible(v) {
    this.mesh.visible = v;
    this.timer = 0;
  }

  update(flow, dt) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.3;
    const { grid } = this;
    let n = 0;
    for (let j = 0; j < grid.h; j++) {
      for (let i = 0; i < grid.w; i++) {
        const nk = flow.nextCell(i, j);
        if (nk < 0) continue;
        const ni = nk % grid.w, nj = (nk / grid.w) | 0;
        this._q.setFromAxisAngle(this._up, Math.atan2(ni - i, nj - j));
        this._v.set(grid.centerX(i), 0.08, grid.centerZ(j));
        this._m.compose(this._v, this._q, this._s);
        this.mesh.setMatrixAt(n, this._m);
        const d = flow.distanceAt(i, j);
        this._c.setHSL(Math.max(0, 0.33 - d / 180), 0.9, 0.5);
        this.mesh.setColorAt(n, this._c);
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}
