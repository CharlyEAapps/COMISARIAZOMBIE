import * as THREE from 'three';
import config from '../data/config.json';
import { EventBus } from './EventBus.js';
import { FixedStepLoop } from './FixedStepLoop.js';
import { Renderer } from '../render/Renderer.js';
import { CameraRig } from '../render/CameraRig.js';
import { Input } from '../input/Input.js';
import { DebugPanel } from '../ui/DebugPanel.js';

export const STATE = { MENU: 'menu', PLAYING: 'playing', PAUSED: 'paused', GAMEOVER: 'gameover' };

export class Game {
  constructor({ canvas, uiRoot }) {
    this.canvas = canvas;
    this.uiRoot = uiRoot;
    this.config = config;
    this.bus = new EventBus();
    this.loop = new FixedStepLoop({ step: 1 / config.loop.updateHz, maxSubSteps: config.loop.maxSubSteps });
    this.qualityName = config.quality.default;
    this.renderer = new Renderer(canvas, config.quality.presets[this.qualityName]);
    this.scene = this.renderer.scene;
    this.cameraRig = new CameraRig(config.camera, 1);
    this.input = new Input(canvas);
    this.debug = new DebugPanel(uiRoot);
    this.state = STATE.PLAYING;
    this.time = 0;

    // Punto de apuntado en el suelo (se recalcula cada frame desde el ratón).
    this.aimPoint = new THREE.Vector3();
    this._raycaster = new THREE.Raycaster();
    this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._ndc = new THREE.Vector2();

    this.buildSandbox();
    this.setupDebug();

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();

    this._last = performance.now();
    this._frame = this.frame.bind(this);
    requestAnimationFrame(this._frame);
  }

  // Escena provisional de la fase 0: suelo con rejilla y un marcador que se mueve con WASD
  // para comprobar cámara y entrada. En la fase 1 lo sustituyen el mapa y el jugador.
  buildSandbox() {
    const size = config.world.size;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({ color: 0x5d6b4f, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.grid = new THREE.GridHelper(size, size / config.world.cellSize, 0x2c3326, 0x47533c);
    this.grid.position.y = 0.01;
    this.scene.add(this.grid);

    this.marker = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.4, 1, 4, 12),
      new THREE.MeshStandardMaterial({ color: 0x2f4f8f }),
    );
    this.marker.position.y = 0.9;
    this.marker.castShadow = true;
    this.scene.add(this.marker);

    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x8a8378 });
    for (let i = 0; i < 12; i++) {
      const b = new THREE.Mesh(boxGeo, boxMat);
      const h = 1 + (i % 3);
      b.scale.set(2, h, 2);
      b.position.set(((i * 37) % 50) - 25, h / 2, ((i * 53) % 50) - 25);
      b.castShadow = b.receiveShadow = true;
      this.scene.add(b);
    }
  }

  setupDebug() {
    const d = this.debug;
    const q = { calidad: this.qualityName };
    d.folder('Render')
      .add(q, 'calidad', Object.keys(config.quality.presets))
      .onChange((v) => this.setQuality(v));
    d.addToggle('Render', 'Mostrar rejilla', this.grid, 'visible');
    d.folder('Cámara').add(config.camera, 'pitchDeg', 35, 89, 1).name('Inclinación')
      .onChange(() => this.cameraRig.updateOffset());
    d.folder('Cámara').add(config.camera, 'fov', 25, 70, 1).name('FOV')
      .onChange((v) => { this.cameraRig.camera.fov = v; this.cameraRig.camera.updateProjectionMatrix(); });
    d.addToggle('Trucos', 'Modo dios', d.flags, 'godMode');
  }

  setQuality(name) {
    this.qualityName = name;
    this.renderer.applyQuality(config.quality.presets[name]);
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.resize(w, h);
    this.cameraRig.resize(w / h);
  }

  updateAimPoint() {
    const p = this.input.pointer;
    if (!p.inside) return;
    this._ndc.set(p.ndcX, p.ndcY);
    this._raycaster.setFromCamera(this._ndc, this.cameraRig.camera);
    this._raycaster.ray.intersectPlane(this._groundPlane, this.aimPoint);
  }

  frame(now) {
    const dt = Math.min((now - this._last) / 1000, 0.25);
    this._last = now;
    this.tick(dt);
    requestAnimationFrame(this._frame);
  }

  /**
   * Avanza el juego `seconds` de forma síncrona en frames de 1/60 s. Sirve para tests y QA
   * cuando la pestaña está oculta y el navegador congela requestAnimationFrame.
   */
  simulate(seconds) {
    const frames = Math.round(seconds * 60);
    for (let i = 0; i < frames; i++) this.tick(1 / 60);
  }

  tick(dt) {
    this.input.sample();
    // Acciones a nivel de frame (deben funcionar aunque la lógica esté en pausa).
    if (this.input.consume('debug')) this.debug.toggle();
    if (this.input.consume('pause')) {
      if (this.state === STATE.PLAYING) this.state = STATE.PAUSED;
      else if (this.state === STATE.PAUSED) this.state = STATE.PLAYING;
    }
    const wheel = this.input.takeWheel();
    if (wheel) this.cameraRig.zoom(wheel);

    this.updateAimPoint();

    if (this.state === STATE.PLAYING) {
      this.loop.advance(dt, (step) => {
        this.update(step);
        this.input.endStep();
      });
    }

    this.cameraRig.update(dt, this.marker.position, this.input.pointer.inside ? this.aimPoint : null);
    this.renderer.followFocus(this.cameraRig.focus);
    this.renderer.render(this.cameraRig.camera);

    this.debug.frame(dt, [
      `Estado ${this.state}`,
      `Calidad ${this.qualityName}`,
      `Draw calls ${this.renderer.renderer.info.render.calls}`,
    ]);
  }

  update(dt) {
    this.time += dt;
    const speed = 6;
    const half = config.world.size / 2 - 1;
    const m = this.marker.position;
    m.x = THREE.MathUtils.clamp(m.x + this.input.move.x * speed * dt, -half, half);
    m.z = THREE.MathUtils.clamp(m.z + this.input.move.y * speed * dt, -half, half);
    this.marker.lookAt(this.aimPoint.x, m.y, this.aimPoint.z);
  }
}
