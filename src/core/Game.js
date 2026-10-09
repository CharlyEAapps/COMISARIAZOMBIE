import * as THREE from 'three';
import config from '../data/config.json';
import tiles from '../data/tiles.json';
import map from '../data/map.json';
import daynightData from '../data/daynight.json';
import { EventBus } from './EventBus.js';
import { FixedStepLoop } from './FixedStepLoop.js';
import { Renderer } from '../render/Renderer.js';
import { CameraRig } from '../render/CameraRig.js';
import { MapRenderer } from '../render/MapRenderer.js';
import { PropRenderer, PROP_TILES } from '../render/PropRenderer.js';
import { Effects } from '../render/Effects.js';
import { Lighting } from '../render/Lighting.js';
import { updateCutaway } from '../render/Cutaway.js';
import { FlowFieldViz } from '../render/DebugViz.js';
import { Input } from '../input/Input.js';
import { DebugPanel } from '../ui/DebugPanel.js';
import { Hud } from '../ui/Hud.js';
import { WorldLabels } from '../ui/WorldLabels.js';
import { NavGrid } from '../systems/NavGrid.js';
import { ZombieSystem } from '../systems/ZombieSystem.js';
import { WeaponSystem } from '../systems/WeaponSystem.js';
import { WaveDirector } from '../systems/WaveDirector.js';
import { DayNight, PHASE } from '../systems/DayNight.js';
import { Score } from '../systems/Score.js';
import { InteractionSystem } from '../systems/InteractionSystem.js';
import { BuildSystem } from '../systems/BuildSystem.js';
import { StructureRenderer } from '../render/StructureRenderer.js';
import { GrenadeRenderer } from '../render/GrenadeRenderer.js';
import { ShopSystem } from '../systems/ShopSystem.js';
import { ShopPanel } from '../ui/ShopPanel.js';
import { WEAPON_IDS } from '../systems/WeaponSystem.js';
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
    this.time = 0; // tiempo de simulación total (para cooldowns)

    this.grid = new NavGrid(map.rows, tiles, config.world.cellSize);
    this.mapRenderer = new MapRenderer(this.scene, this.grid, { skip: PROP_TILES });
    this.props = new PropRenderer(this.scene, this.grid);
    this.effects = new Effects(this.scene);
    this.player = new Player(this);
    this.zombies = new ZombieSystem(this);
    this.weapons = new WeaponSystem(this);
    this.dayNight = new DayNight(daynightData, this.bus);
    this.waves = new WaveDirector(this);
    this.power = { generator: true, lightsOn: true }; // generator = el transformador funciona
    this.run = { time: 0, points: 0, kills: 0, nights: 0 };
    this.floating = new WorldLabels(this);
    this.score = new Score(this);
    this.interactions = new InteractionSystem(this);
    this.lighting = new Lighting(this);
    this.lighting.setAnchors(this.props.lightAnchors);
    this.lighting.applyQuality(config.quality.presets[this.qualityName]);
    this.interactions.setAnchors([...this.props.interactAnchors, ...this.shopAnchors()]);
    this.shop = new ShopSystem(this);
    this.build = new BuildSystem(this);
    this.structureRenderer = new StructureRenderer(this);
    this.grenadeRenderer = new GrenadeRenderer(this);
    this.flowViz = new FlowFieldViz(this.scene, this.grid);
    this.hud = new Hud(this);
    this.shopPanel = new ShopPanel(this);

    this.aimPoint = new THREE.Vector3();
    this._raycaster = new THREE.Raycaster();
    this._aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -AIM_HEIGHT);
    this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.groundPoint = new THREE.Vector3(); // punto del suelo bajo el cursor (modo construcción)
    this._ndc = new THREE.Vector2();
    this._cutTarget = new THREE.Vector3();

    this.bus.on('zombie:killed', ({ x, z }) => {
      this.effects.burst(x, 0.9, z, 14, 0x3d1a1a, { speed: 3, up: 3, size: 0.11, life: 1.4 });
    });
    this.bus.on('player:died', () => { this.deathTimer = this.player.data.gameOverDelay; });
    this.bus.on('phase:noche', ({ night, duration }) => this.waves.startNight(night, duration));
    this.deathTimer = 0;
    this.wavesEnabled = true;
    this._nightCleared = () => this.waves.cleared();

    this.setupDebug();
    this.cameraRig.snap(this.player.position);

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
    this.bus.emit('run:start');

    this._last = performance.now();
    this._frame = this.frame.bind(this);
    requestAnimationFrame(this._frame);
  }

  /** Puntos de interacción de los mostradores (A, M, W del mapa). */
  shopAnchors() {
    const g = this.grid;
    const out = [];
    for (const [shop, cells] of Object.entries(g.shops)) {
      cells.forEach(({ i, j }, n) => out.push({ id: `tienda_${shop}_${n}`, type: `tienda_${shop}`, x: g.centerX(i), z: g.centerZ(j) }));
    }
    return out;
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
      .onChange(() => this.cameraRig.applyFov());
    d.addToggle('Trucos', 'Modo dios', d.flags, 'godMode');
    d.addAction('Trucos', '+1000 puntos', () => { this.run.points += 1000; });
    d.addAction('Trucos', '+1 botiquín', () => { this.player.medkits++; });
    d.addAction('Trucos', 'Romper transformador', () => this.build.damageTransformer(1e9));
    d.addAction('Trucos', 'Todas las armas', () => {
      for (const id of WEAPON_IDS) { this.weapons.give(id); this.weapons.addAmmo(id, 999); }
      this.weapons.grenades = this.weapons.defs._granada.max;
    });
    d.addAction('Trucos', 'Desbloquear construcción', () => {
      for (const [type, def] of Object.entries(this.build.pieces)) def.levels.forEach((_, l) => this.shop.unlocked.add(`${type}:${l}`));
    });
    d.addAction('Ciclo', 'Saltar a la noche', () => {
      if (this.dayNight.phase === PHASE.DAY) this.dayNight.skipDay();
      if (this.dayNight.phase === PHASE.DUSK) this.dayNight.t = this.dayNight.duration;
    });
    d.addAction('Ciclo', 'Terminar la noche', () => {
      if (this.dayNight.phase !== PHASE.NIGHT) return;
      this.waves.toSpawn = 0;
      for (const z of [...this.zombies.active]) this.zombies.damage(z, 1e9);
      this.dayNight.t = this.dayNight.duration;
    });
    d.addAction('Zombis', 'Generar 10 caminantes', () => {
      for (let i = 0; i < 10; i++) this.waves.spawnAtRandomPoint('caminante');
    });
    d.addAction('Zombis', 'Matar a todos', () => {
      for (const z of [...this.zombies.active]) this.zombies.damage(z, 1e9);
    });
    d.addToggle('Zombis', 'Oleadas activas', this, 'wavesEnabled');
    d.addToggle('Zombis', 'Ver flow field', d.flags, 'showFlowField', (v) => { this.flowViz.setVisible(v); });
  }

  /** Libera listeners globales (útil si se recrea el juego, p. ej. con HMR). */
  dispose() {
    this._disposed = true;
    window.removeEventListener('resize', this._onResize);
    this.input.dispose();
    this.props.dispose();
    this.structureRenderer.dispose();
    this.grenadeRenderer.dispose();
    this.lighting.dispose();
    this.debug.gui.destroy();
    this.renderer.renderer.dispose();
  }

  setQuality(name) {
    this.qualityName = name;
    const preset = config.quality.presets[name];
    this.renderer.applyQuality(preset);
    this.lighting.applyQuality(preset);
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
    this.dayNight.reset();
    this.waves.reset();
    this.score.reset();
    this.interactions.reset();
    this.build.reset();
    this.shop.reset();
    this.effects.reset();
    this.floating.reset();
    this.hud.reset();
    this.lighting.alarmTimer = 0;
    Object.assign(this.power, { generator: true, lightsOn: true });
    Object.assign(this.run, { time: 0, points: 0, kills: 0, nights: 0 });
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
    this._raycaster.ray.intersectPlane(this._groundPlane, this.groundPoint);
  }

  frame(now) {
    const dt = Math.min((now - this._last) / 1000, 0.25);
    this._last = now;
    this.tick(dt);
    if (!this._disposed) requestAnimationFrame(this._frame);
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
      // Con una tienda abierta, Esc la cierra en lugar de pausar.
      if (this.shop.open) this.shop.close();
      else if (this.state === STATE.PLAYING) this.state = STATE.PAUSED;
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
    this.structureRenderer.update();
    this.grenadeRenderer.update();
    this.effects.update(visualDt);
    this.lighting.update(visualDt);
    if (this.debug.flags.showFlowField) this.flowViz.update(this.zombies.flow, visualDt);

    const pp = this.player.position;
    this.cameraRig.update(dt, pp, this.input.pointer.inside && this.player.alive ? this.aimPoint : null);
    this.cameraRig.camera.position.add(this.effects.shakeOffset);
    this._cutTarget.set(pp.x, 1.0, pp.z);
    updateCutaway(this.cameraRig.camera.position, this._cutTarget);
    this.renderer.followFocus(this.cameraRig.focus);
    this.renderer.render(this.cameraRig.camera);

    this.hud.update(dt);
    this.shopPanel.update(visualDt);
    this.floating.update(visualDt);
    this.debug.frame(dt, this.debug.visible ? [
      `Estado ${this.state} · ${this.dayNight.phase} ${this.dayNight.night} (${this.dayNight.t.toFixed(0)}/${this.dayNight.duration.toFixed(0)} s)`,
      `Zombis ${this.zombies.aliveCount} vivos / ${this.zombies.active.length} activos · por salir ${this.waves.toSpawn}`,
      `Draw calls ${this.renderer.renderer.info.render.calls}`,
      `Jugador ${pp.x.toFixed(1)}, ${pp.z.toFixed(1)}`,
    ] : null);
  }

  /** Tienda abierta: E la cierra y 1-9 compran (antes de que lleguen a las armas). */
  updateShop() {
    const { shop, input } = this;
    shop.update();
    if (!shop.open) return;
    if (input.consume('interact')) {
      shop.close();
      this.interactions.waitRelease = true;
      return;
    }
    for (let n = 1; n <= 9; n++) if (input.consume(`weapon${n}`)) this.shopPanel.buyIndex(n - 1);
  }

  update(dt) {
    this.time += dt;
    if (this.player.alive) this.run.time += dt;
    if (this.input.consume('ready') && this.player.alive) this.dayNight.skipDay();
    // Muerto, el ciclo se congela (no hay "noche superada" encima de "Has caído").
    if (this.player.alive) this.dayNight.update(dt, this._nightCleared);
    this.lighting.updateLogic(dt);
    this.player.update(dt);
    this.updateShop();
    this.interactions.update(dt);
    this.weapons.update(dt);
    this.build.update(dt);
    if (this.wavesEnabled && this.player.alive) this.waves.update(dt, this.dayNight);
    this.zombies.update(dt);
    this.score.update(dt);
    if (this.deathTimer > 0) {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) {
        this.state = STATE.GAMEOVER;
        this.bus.emit('run:over', { ...this.run });
      }
    }
  }
}
