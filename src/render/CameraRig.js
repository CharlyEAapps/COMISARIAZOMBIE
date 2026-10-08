import * as THREE from 'three';

// Cámara en perspectiva inclinada (no cenital) que sigue a un objetivo con suavizado
// y se adelanta ligeramente hacia el punto de apuntado.
export class CameraRig {
  constructor(cfg, aspect) {
    this.cfg = cfg;
    this.camera = new THREE.PerspectiveCamera(cfg.fov, aspect, 0.5, 300);
    this.distance = cfg.distance;
    this.focus = new THREE.Vector3();
    this.desiredFocus = new THREE.Vector3();
    this.offset = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this.updateOffset();
    this.snap(new THREE.Vector3());
  }

  updateOffset() {
    const pitch = THREE.MathUtils.degToRad(this.cfg.pitchDeg);
    // La cámara mira hacia -Z (el "norte" del mapa queda arriba en pantalla).
    this.offset.set(0, Math.sin(pitch) * this.distance, Math.cos(pitch) * this.distance);
  }

  zoom(direction) {
    const { zoomStep, minDistance, maxDistance } = this.cfg;
    this.distance = THREE.MathUtils.clamp(this.distance + direction * zoomStep, minDistance, maxDistance);
    this.updateOffset();
  }

  snap(target) {
    this.focus.copy(target);
    this.desiredFocus.copy(target);
    this.apply();
  }

  /**
   * @param {THREE.Vector3} target posición del jugador
   * @param {THREE.Vector3|null} aim punto de apuntado en el suelo
   */
  update(dt, target, aim) {
    this.desiredFocus.copy(target);
    if (aim) {
      this._tmp.subVectors(aim, target).multiplyScalar(this.cfg.lookAhead);
      this._tmp.y = 0;
      this._tmp.clampLength(0, this.cfg.maxLookAhead);
      this.desiredFocus.add(this._tmp);
    }
    // Suavizado exponencial independiente de los FPS.
    const t = 1 - Math.exp(-this.cfg.followSharpness * dt);
    this.focus.lerp(this.desiredFocus, t);
    this.apply();
  }

  apply() {
    this.camera.position.copy(this.focus).add(this.offset);
    this.camera.lookAt(this.focus);
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.applyFov();
  }

  /** En pantallas verticales se abre el FOV para mantener el campo horizontal de una pantalla cuadrada. */
  applyFov() {
    const aspect = this.camera.aspect;
    let fov = this.cfg.fov;
    if (aspect < 1) {
      const half = THREE.MathUtils.degToRad(this.cfg.fov / 2);
      fov = Math.min(75, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(half) / aspect)));
    }
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }
}
