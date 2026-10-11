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
import { Decals } from '../render/Decals.js';
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
import { Missions } from '../systems/Missions.js';
import { MissionRenderer } from '../render/MissionRenderer.js';
import { MissionHud } from '../ui/MissionHud.js';
import { InteractionSystem } from '../systems/InteractionSystem.js';
import { BuildSystem } from '../systems/BuildSystem.js';
import { StructureRenderer } from '../render/StructureRenderer.js';
import { Despacho } from '../systems/Despacho.js';
import { DespachoRenderer } from '../render/DespachoRenderer.js';
import { GrenadeRenderer } from '../render/GrenadeRenderer.js';
import { ShopSystem } from '../systems/ShopSystem.js';
import { BlastQueue } from '../systems/Explosions.js';
import { AcidSystem } from '../systems/AcidSystem.js';
import { Humor } from '../systems/Humor.js';
import { Story } from '../systems/Story.js';
import { RadioPanel } from '../ui/RadioPanel.js';
import { AudioSystem } from '../audio/AudioSystem.js';
import { Meta } from '../systems/Meta.js';
import { RunSaveStore, captureRun, restoreRun } from '../save/RunSave.js';
import { Menus } from '../ui/Menus.js';
import { TouchControls } from '../input/TouchControls.js';
import { ThreatIndicators } from '../ui/ThreatIndicators.js';
import { GamepadInput } from '../input/GamepadInput.js';
import zombieData from '../data/zombies.json';
import { ShopPanel } from '../ui/ShopPanel.js';
import { WEAPON_IDS, assistParams } from '../systems/WeaponSystem.js';
import { Player } from '../entities/Player.js';
import { assistBarrel } from '../systems/Barrels.js';

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
    this.state = STATE.MENU;
    this.time = 0; // tiempo de simulación total (para cooldowns)

    this.grid = new NavGrid(map.rows, tiles, config.world.cellSize);
    this.mapRenderer = new MapRenderer(this.scene, this.grid, { skip: PROP_TILES });
    this.props = new PropRenderer(this.scene, this.grid);
    this.effects = new Effects(this.scene);
    this.effects.bind(this);
    this.decals = new Decals(this);
    this.player = new Player(this);
    this.zombies = new ZombieSystem(this);
    this.weapons = new WeaponSystem(this);
    this.dayNight = new DayNight(daynightData, this.bus);
    this.waves = new WaveDirector(this);
    this.power = { generator: true, lightsOn: true }; // generator = el transformador funciona
    this.run = { time: 0, points: 0, score: 0, kills: 0, nights: 0, killsByType: {} };
    this.blasts = new BlastQueue(this);
    this.acid = new AcidSystem(this);
    this.floating = new WorldLabels(this);
    this.score = new Score(this);
    this.humor = new Humor(this);
    this.missions = new Missions(this); // misiones de la pizarra y eventos forzados de la noche
    this.interactions = new InteractionSystem(this);
    this.lighting = new Lighting(this);
    this.lighting.setAnchors(this.props.lightAnchors);
    this.lighting.applyQuality(config.quality.presets[this.qualityName]);
    this.interactions.setAnchors([...this.props.interactAnchors, ...this.shopAnchors()]);
    this.shop = new ShopSystem(this);
    this.build = new BuildSystem(this);
    this.structureRenderer = new StructureRenderer(this);
    this.despacho = new Despacho(this); // mejoras de la comisaría (despacho del comisario)
    this.despachoRenderer = new DespachoRenderer(this);
    this.grenadeRenderer = new GrenadeRenderer(this);
    this.flowViz = new FlowFieldViz(this.scene, this.grid);
    this.hud = new Hud(this);
    this.missionHud = new MissionHud(this);
    this.missionRenderer = new MissionRenderer(this);
    this.story = new Story(this); // historia por radio y llamadas de la familia (antes del guardado del amanecer)
    this.radioPanel = new RadioPanel(this);
    this.shopPanel = new ShopPanel(this);
    this.audio = new AudioSystem(this);
    this.meta = new Meta(this);
    this.runSave = new RunSaveStore('turno-de-noche.run');
    this.menus = new Menus(this);
    this.touch = new TouchControls(this);
    this.threats = new ThreatIndicators(this);
    this.gamepad = new GamepadInput(this);

    this.aimPoint = new THREE.Vector3();
    this._raycaster = new THREE.Raycaster();
    this._aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -AIM_HEIGHT);
    this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.groundPoint = new THREE.Vector3(); // punto del suelo bajo el cursor (modo construcción)
    this._ndc = new THREE.Vector2();
    this._cutTarget = new THREE.Vector3();

    this.bus.on('player:died', () => { this.deathTimer = this.player.data.gameOverDelay; });
    // Continuar turno: se guarda al empezar cada día (tras sobrevivir una noche) y se borra al caer.
    this.bus.on('phase:dia', ({ night }) => {
      if (night > 1 && this.player.alive) this.runSave.save(captureRun(this));
    });
    this.bus.on('run:over', () => this.runSave.clear());
    this.bus.on('phase:noche', ({ night, duration }) => this.waves.startNight(night, duration));
    this.deathTimer = 0;
    this.wavesEnabled = true;
    this._nightCleared = () => this.waves.cleared();

    this.setupDebug();
    this.cameraRig.snap(this.player.position);

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    // Al girar el móvil, iOS cambia las medidas un poco después del evento: se repite.
    this._onOrient = () => { this.resize(); setTimeout(this._onResize, 250); setTimeout(this._onResize, 700); };
    window.addEventListener('orientationchange', this._onOrient);
    window.visualViewport?.addEventListener('resize', this._onResize);
    this._resizeObs = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
    this._resizeObs?.observe(this.canvas);
    // Opciones guardadas.
    const st = this.meta.settings;
    if (st.quality && Object.hasOwn(config.quality.presets, st.quality)) this.setQuality(st.quality);
    if (st.shake === false) this.effects.shakeMul = 0;
    this.resize();
    // Compila ya todos los shaders (efectos incluidos): sin tirón en el primer disparo o explosión.
    this.renderer.renderer.compile(this.scene, this.cameraRig.camera);
    this.menus.show('main', true);

    this._last = performance.now();
    this._frame = this.frame.bind(this);
    requestAnimationFrame(this._frame);
  }

  /** Cómo se llama el botón de "usar" con el control actual (teclado E, táctil ✋, mando A). */
  get useKey() {
    const d = this.input.lastDevice;
    return d === 'touch' ? '✋' : d === 'pad' ? 'A' : 'E';
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
    const spawnSel = { tipo: 'corredor' };
    const types = Object.keys(zombieData).filter((t) => !t.startsWith('_'));
    d.folder('Zombis').add(spawnSel, 'tipo', types).name('Tipo');
    d.addAction('Zombis', 'Generar 5 del tipo', () => {
      const n = zombieData[spawnSel.tipo].boss ? 1 : 5;
      for (let i = 0; i < n; i++) this.waves.spawnAtRandomPoint(spawnSel.tipo);
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
    window.removeEventListener('orientationchange', this._onOrient);
    window.visualViewport?.removeEventListener('resize', this._onResize);
    this._resizeObs?.disconnect();
    this.input.dispose();
    this.props.dispose();
    this.structureRenderer.dispose();
    this.despachoRenderer.dispose();
    this.despacho.dispose();
    this.missionRenderer.dispose();
    this.missionHud.dispose();
    this.missions.dispose();
    this.grenadeRenderer.dispose();
    this.weapons.dispose();
    this.acid.dispose();
    this.zombies.dispose();
    this.effects.dispose();
    this.decals.dispose();
    this.audio.dispose();
    this.humor.dispose();
    this.story.dispose();
    this.radioPanel.dispose();
    this.meta.dispose();
    this.menus.dispose();
    this.touch.dispose();
    this.threats.dispose();
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

  /**
   * En la app instalada de iOS, el alto que da Safari descuenta la barra de estado y deja una
   * franja negra abajo: se ajusta el contenedor al tamaño real de la pantalla.
   */
  fitScreen() {
    const app = this.canvas.parentElement;
    if (!app || !window.navigator.standalone) return;
    const land = window.innerWidth > window.innerHeight;
    const a = window.screen.width, b = window.screen.height;
    app.style.width = `${land ? Math.max(a, b) : Math.min(a, b)}px`;
    app.style.height = `${land ? Math.min(a, b) : Math.max(a, b)}px`;
  }

  resize() {
    this.fitScreen();
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
    this.missions.reset();
    this.humor.reset();
    this.story.reset();
    this.interactions.reset();
    this.build.reset();
    this.shop.reset();
    this.despacho.reset();
    this.effects.reset();
    this.decals.reset();
    this.blasts.reset();
    this.acid.reset();
    this.floating.reset();
    this.threats.reset();
    this.hud.reset();
    this.missionHud.reset();
    this.lighting.alarmTimer = 0;
    Object.assign(this.power, { generator: true, lightsOn: true });
    Object.assign(this.run, { time: 0, points: 0, score: 0, kills: 0, nights: 0, killsByType: {} });
    this.deathTimer = 0;
    this.state = STATE.PLAYING;
    this.cameraRig.snap(this.player.position);
    this.bus.emit('run:start');
  }

  // ------------------------------------------------------------------ partidas y menús
  /** Empieza un turno nuevo con las mejoras permanentes del tablón. */
  startRun() {
    this.runSave.clear(); // un turno nuevo descarta el guardado
    this.restart();
    this.meta.applyUpgrades();
    this.menus.hide();
  }

  /** Continúa el turno guardado al último amanecer (o empieza uno nuevo si no hay). */
  continueRun() {
    const save = this.runSave.load();
    if (!save) { this.startRun(); return; }
    this.restart();
    this.meta.applyUpgrades();
    try {
      restoreRun(this, save);
    } catch (e) {
      console.warn('No se pudo restaurar el turno guardado', e);
      this.runSave.clear();
      this.restart();
      this.meta.applyUpgrades();
    }
    this.cameraRig.snap(this.player.position);
    this.menus.hide();
  }

  pause() {
    if (this.state !== STATE.PLAYING) return;
    this.state = STATE.PAUSED;
    this.menus.show('pause', true);
    this.touch.reset();
  }

  resume() {
    if (this.state !== STATE.PAUSED) return;
    this.state = STATE.PLAYING;
    this.menus.hide();
  }

  /** Abandonar desde la pausa: cuenta como fin de turno (medallas y récord incluidos). */
  abandonRun() {
    if (this.state !== STATE.PAUSED) return;
    this.deathTimer = 0;
    this.endRun(true);
  }

  /** Fin del turno: medallas y récord (Meta) y pantalla de resumen, pase lo que pase. */
  endRun(abandoned = false) {
    this.state = STATE.GAMEOVER;
    try {
      this.bus.emit('run:over', { ...this.run, abandoned });
    } finally {
      if (this.menus.current !== 'gameover') this.menus.show('gameover', true);
    }
  }

  quitToMenu() {
    this.restart();
    this.state = STATE.MENU;
    this.menus.show('main', true);
  }

  updateAimPoint() {
    const p = this.input.pointer;
    const analog = this.input.analog;
    // Construyendo en el móvil, el cursor solo se mueve mientras el dedo está en el suelo: si no,
    // se quedaría resbalando al moverse la cámara.
    const lockBuild = this.build.active && this.input.lastDevice === 'touch' && !(this.touch?.buildTouch >= 0);
    if (p.inside && !lockBuild) {
      this._ndc.set(p.ndcX, p.ndcY);
      this._raycaster.setFromCamera(this._ndc, this.cameraRig.camera);
      this._raycaster.ray.intersectPlane(this._groundPlane, this.groundPoint);
      if (!analog) this._raycaster.ray.intersectPlane(this._aimPlane, this.aimPoint);
    }
    if (analog) this.updateAnalogAim();
  }

  /**
   * Apuntado con joystick (táctil o mando): la dirección del joystick derecho, con ayuda hacia
   * el zombi más alineado; sin apuntar, el policía mira hacia donde camina. La cámara mira al
   * norte sin girar, así que pantalla derecha = +X y pantalla abajo = +Z.
   */
  updateAnalogAim() {
    const { input, player } = this;
    const T = config.touch;
    let dx, dz;
    if (input.aim.active) { dx = input.aim.x; dz = input.aim.y; } else if (input.move.x || input.move.y) { dx = input.move.x; dz = input.move.y; } else return;
    const px = player.position.x, pz = player.position.z;
    if (input.aim.active) {
      // Cada arma puede tener su propio alcance y ángulo de ayuda (lanzallamas y sable, de corto alcance).
      const assist = assistParams(this.weapons.weapon?.data, T);
      const cosMax = Math.cos(THREE.MathUtils.degToRad(assist.angleDeg));
      let best = null, bestCos = cosMax;
      for (const z of this.zombies.active) {
        if (z.state !== 0) continue;
        const zx = z.pos.x - px, zz = z.pos.z - pz;
        const d = Math.hypot(zx, zz);
        if (d > assist.range || d < 1e-3) continue;
        const c = (zx * dx + zz * dz) / d;
        if (c > bestCos) { bestCos = c; best = z; }
      }
      // Un barril con zombis al lado y más alineado que el mejor zombi también vale (Barrels.js).
      const bar = assistBarrel(this.build.barrels, this.zombies.active, px, pz, dx, dz, bestCos, assist.range);
      if (bar || best) {
        const tx = bar ? bar.cx : best.pos.x, tz = bar ? bar.cz : best.pos.z;
        const d = Math.hypot(tx - px, tz - pz);
        dx = (tx - px) / d; dz = (tz - pz) / d;
      }
    }
    this.aimPoint.set(px + dx * T.aimDistance, AIM_HEIGHT, pz + dz * T.aimDistance);
    // Con mando no hay puntero: se construye en la celda de delante del policía.
    if (input.lastDevice === 'pad') this.groundPoint.set(px + dx * config.gamepad.buildDistance, 0, pz + dz * config.gamepad.buildDistance);
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
    this.gamepad.poll();
    input.sample();
    // Acciones a nivel de frame (deben funcionar aunque la lógica esté en pausa).
    if (input.consume('debug')) this.debug.toggle();
    if (input.consume('pause')) {
      // Con una tienda abierta, Esc la cierra; en un menú, vuelve atrás.
      if (this.state === STATE.PLAYING) {
        if (this.shop.open) this.shop.close();
        else this.pause();
      } else this.menus.back();
    }
    if (this.state !== STATE.PLAYING && input.consume('confirm')) this.menus.confirm();
    const wheel = input.takeWheel();
    if (wheel) this.cameraRig.zoom(wheel);

    this.updateAimPoint();

    if (this.state === STATE.PLAYING) {
      this.loop.advance(dt, (step) => {
        // Si la partida acaba en un subpaso, los siguientes no avanzan nada más.
        if (this.state === STATE.PLAYING) this.update(step);
        input.endStep();
      });
    } else {
      input.endStep();
    }

    const visualDt = this.state === STATE.PAUSED ? 0 : dt;
    this.player.render();
    this.zombies.render();
    this.structureRenderer.update();
    this.despachoRenderer.update();
    this.grenadeRenderer.update();
    this.acid.render(this.time);
    this.effects.update(visualDt);
    this.decals.update(visualDt);
    this.lighting.update(visualDt);
    this.missionRenderer.update(visualDt); // niebla y apagón: después de la luz, que fija esos valores cada frame
    if (this.debug.flags.showFlowField) this.flowViz.update(this.zombies.flow, visualDt);

    const pp = this.player.position;
    const aiming = this.input.pointer.inside || this.input.analog;
    this.cameraRig.update(dt, pp, aiming && this.player.alive ? this.aimPoint : null);
    this.cameraRig.camera.position.add(this.effects.shakeOffset);
    this._cutTarget.set(pp.x, 1.0, pp.z);
    updateCutaway(this.cameraRig.camera.position, this._cutTarget);
    this.renderer.followFocus(this.cameraRig.focus);
    this.audio.update(visualDt);
    this.renderer.render(this.cameraRig.camera);

    this.hud.update(dt);
    this.missionHud.update(dt);
    this.touch.update();
    this.shopPanel.update(visualDt);
    this.floating.update(visualDt);
    this.threats.update(visualDt);
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
    this.despacho.update(dt);
    this.missions.update(dt);
    if (this.wavesEnabled && this.player.alive) this.waves.update(dt, this.dayNight);
    this.zombies.update(dt);
    this.blasts.update(dt);
    this.acid.update(dt);
    this.score.update(dt);
    this.humor.update(dt);
    this.story.update(dt);
    if (this.deathTimer > 0) {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) {
        this.endRun(false);
      }
    }
  }
}
