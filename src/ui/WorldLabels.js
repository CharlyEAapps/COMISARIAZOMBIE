import * as THREE from 'three';

// Textos y marcadores DOM anclados a posiciones del mundo (proyectados cada frame):
// números flotantes de puntos/curación y los "!" de interacciones disponibles.
const MAX_FLOATING = 32;
const MAX_MARKERS = 16;
const EMPTY = [];

export class WorldLabels {
  constructor(game) {
    this.game = game;
    this.root = document.createElement('div');
    this.root.className = 'world-labels';
    game.uiRoot.appendChild(this.root);
    this._v = new THREE.Vector3();
    this._p = { sx: 0, sy: 0, visible: false };

    this.floats = [];
    for (let i = 0; i < MAX_FLOATING; i++) {
      const el = document.createElement('div');
      el.className = 'float-text';
      el.style.display = 'none';
      this.root.appendChild(el);
      this.floats.push({ el, life: 0, x: 0, y: 0, z: 0 });
    }
    this._fIdx = 0;

    this.markers = [];
    for (let i = 0; i < MAX_MARKERS; i++) {
      const el = document.createElement('div');
      el.className = 'marker';
      el.textContent = '!';
      el.style.display = 'none';
      this.root.appendChild(el);
      this.markers.push(el);
    }
  }

  /** Muestra un texto flotante que sube y se desvanece. cls: 'pts' | 'heal' | 'neg' | 'dmg' */
  spawn(text, x, y, z, cls = 'pts') {
    const f = this.floats[this._fIdx];
    this._fIdx = (this._fIdx + 1) % MAX_FLOATING;
    f.el.textContent = text;
    f.el.className = `float-text ${cls}`;
    f.life = f.maxLife = 1.1;
    f.x = x; f.y = y; f.z = z;
    f.el.style.display = '';
  }

  project(x, y, z) {
    const cam = this.game.cameraRig.camera;
    const v = this._v.set(x, y, z).project(cam);
    const w = this.game.canvas.clientWidth, h = this.game.canvas.clientHeight;
    const p = this._p;
    p.sx = (v.x * 0.5 + 0.5) * w;
    p.sy = (-v.y * 0.5 + 0.5) * h;
    p.visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
    return p;
  }

  update(dt) {
    for (const f of this.floats) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) { f.el.style.display = 'none'; continue; }
      const k = 1 - f.life / f.maxLife;
      const p = this.project(f.x, f.y + k * 0.9, f.z);
      f.el.style.transform = `translate(${p.sx}px, ${p.sy}px) translate(-50%, -50%) scale(${1 + (k < 0.15 ? (0.15 - k) * 3 : 0)})`;
      f.el.style.opacity = String(Math.min(1, f.life / 0.35));
    }

    const showMarkers = this.game.player.alive && this.game.state === 'playing';
    const list = showMarkers ? this.game.interactions.markers() : EMPTY;
    const t = performance.now() * 0.004;
    for (let i = 0; i < MAX_MARKERS; i++) {
      const el = this.markers[i];
      const it = list[i];
      if (!it || it === this.game.interactions.current) { el.style.display = 'none'; continue; }
      const p = this.project(it.x, 2.3 + Math.sin(t + i) * 0.08, it.z);
      if (!p.visible) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.transform = `translate(${p.sx}px, ${p.sy}px) translate(-50%, -100%)`;
    }
  }

  reset() {
    for (const f of this.floats) { f.life = 0; f.el.style.display = 'none'; }
  }
}
