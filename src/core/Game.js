import * as THREE from 'three';
import config from '../data/config.json';
import tiles from '../data/tiles.json';
import map from '../data/map.json';
import { EventBus } from './EventBus.js';
import { FixedStepLoop } from './FixedStepLoop.js';
import { Renderer } from '../render/Renderer.js';
import { CameraRig } from '../render/CameraRig.js';
import { MapRenderer } from '../render/MapRenderer.js';
import { Effects } from '../render/Effects.js';
import { updateCutaway } from '../render/Cutaway.js';
import { FlowFieldViz } from '../render/DebugViz.js';
import { Input } from '../input/Input.js';
import { DebugPanel } from '../ui/DebugPanel.js';
import { Hud } from '../ui/Hud.js';
import { NavGrid } from '../systems/NavGrid.js';
import { ZombieSystem } from '../systems/ZombieSystem.js';
import { WeaponSystem } from '../systems/WeaponSystem.js';
import { TestSpawner } from '../systems/TestSpawner.js';
import { Player } from '../entities/Player.js';

export const STATE = { MENU: 'menu', PLAYING: 'playing', PAUSED: 'paused', GAMEOVER: 'gameover' };

const AIM_HEIGHT = 1; // el ratón apunta a la altura del torso, no al suelo

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

    this.grid = new NavGrid(map.rows, tiles, config.world.cellSize);
    this.mapRenderer = new MapRenderer(this.scene, this.grid);
    this.effects = new Effects(this.scene);
    this.player = new Player(this);
    this.zombies = new ZombieSystem(this);
    this.weapons = new WeaponSystem(this);
    this.spawner = new TestSpawner(this);
    this.flowViz = new FlowFieldViz(this.scene, this.grid);
    this.run = { time: 0, points: 0, kills: 0 };
    this.hud = new Hud(this);

    this.aimPoint = new THREE.Vector3();
    this._raycaster = new THREE.Raycaster();
    this._aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -AIM_HEIGHT);
    this._ndc = new THREE.Vector2();
    this._cutTarget = new THREE.Vector3();
    this._camFocus = new THREE.Vector3();

    this.bus.on('zombie:killed', ({ points, x, z }) => {
      this.run.kills++;
      this.run.points += points;
      this.effects.burst(x, 0.9, z, 14, 0x3d1a1a, { speed: 3, up: 3, size: 0.11, life: 1.4 });
    });
    this.bus.on('player:died', () => { this.deathTimer = 1.8; });
    this.deathTimer = 0;

    this.setupDebug();
    this.cameraRig.snap(this.player.position);

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();

    this._last = performance.now();
    this._frame = this.frame.bind(this);
    requestAnimationFrame(this._frame);
  }

  setupDebug() {
    const d = this.debug;
    const q = { calidad: this.qualityName };
    d.folder('Render')
      .add(q, 'calidad', Object.keys(config.quality.presets))
      .onChange((v) => this.setQuality(v));
    d.folder('Cámara').add(config.camera, 'pitchDeg', 35, 89, 1).name('Inclinación')
      .onChange(() => this.cameraRig.updateOffset());
    d.folder('Cámara').add(config.camera, 'fov', 25, 70, 1).name('FOV')
      .onChange((v) => { this.cameraRig.camera.fov = v; this.cameraRig.camera.updateProjectionMatrix(); });
    d.addToggle('Trucos', 'Modo dios', d.flags, 'godMode');
    d.addAction('Trucos', '+1000 puntos', () => { this.run.points += 1000; });
    d.addAction('Zombis', 'Generar 10 caminantes', () => {
      for (let i = 0; i < 10; i++) this.spawner.spawnAtRandomPoint('caminante');
    });
    d.addAction('Zombis', 'Matar a todos', () => {
      for (const z of [...this.zombies.active]) this.zombies.damage(z, 1e9);
    });
    const spawnCtl = { activo: true };
    d.addToggle('Zombis', 'Aparición automática', spawnCtl, 'activo', (v) => { this.spawnerEnabled = v; });
    this.spawnerEnabled = true;
    d.addToggle('Zombis', 'Ver flow field', d.flags, 'showFlowField', (v) => { this.flowViz.setVisible(v); });
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

  restart() {
    this.zombies.reset();
    this.player.reset();
    this.weapons.reset();
    this.spawner.reset();
    this.effects.reset();
    this.run.time = 0;
    this.run.points = 0;
    this.run.kills = 0;
    this.deathTimer = 0;
    this.state = STATE.PLAYING;
    this.cameraRig.snap(this.player.position);
    this.bus.emit('run:start');
  }

  updateAimPoint() {
    const p = this.input.pointer;
    if (!p.inside) return;
    this._ndc.set(p.ndcX, p.ndcY);
    this._raycaster.setFromCamera(this._ndc, this.cameraRig.camera);
    this._raycaster.ray.intersectPlane(this._aimPlane, this.aimPoint);
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
    const { input } = this;
    input.sample();
    // Acciones a nivel de frame (deben funcionar aunque la lógica esté en pausa).
    if (input.consume('debug')) this.debug.toggle();
    if (input.consume('pause')) {
      if (this.state === STATE.PLAYING) this.state = STATE.PAUSED;
      else if (this.state === STATE.PAUSED) this.state = STATE.PLAYING;
    }
    if (this.state === STATE.GAMEOVER && input.consume('confirm')) this.restart();
    const wheel = input.takeWheel();
    if (wheel) this.cameraRig.zoom(wheel);

    this.updateAimPoint();

    if (this.state === STATE.PLAYING) {
      this.loop.advance(dt, (step) => {
        this.update(step);
        input.endStep();
      });
    } else {
      input.endStep();
    }

    const visualDt = this.state === STATE.PAUSED ? 0 : dt;
    this.player.render();
    this.zombies.render();
    this.effects.update(visualDt);
    if (this.debug.flags.showFlowField) this.flowViz.update(this.zombies.flow, visualDt);

    const pp = this.player.position;
    this.cameraRig.update(dt, pp, this.input.pointer.inside && this.player.alive ? this.aimPoint : null);
    this.cameraRig.camera.position.add(this.effects.shakeOffset);
    this._cutTarget.set(pp.x, 1.0, pp.z);
    updateCutaway(this.cameraRig.camera.position, this._cutTarget);
    this.renderer.followFocus(this.cameraRig.focus);
    this.renderer.render(this.cameraRig.camera);

    this.hud.update(dt);
    this.debug.frame(dt, [
      `Estado ${this.state}`,
      `Zombis ${this.zombies.aliveCount} vivos / ${this.zombies.active.length} activos`,
      `Draw calls ${this.renderer.renderer.info.render.calls}`,
      `Jugador ${pp.x.toFixed(1)}, ${pp.z.toFixed(1)}`,
    ]);
  }

  update(dt) {
    if (this.player.alive) this.run.time += dt;
    this.player.update(dt);
    this.weapons.update(dt);
    if (this.spawnerEnabled && this.player.alive) this.spawner.update(dt);
    this.zombies.update(dt);
    if (this.deathTimer > 0) {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) {
        this.state = STATE.GAMEOVER;
        this.bus.emit('run:over', { ...this.run });
      }
    }
  }
}
