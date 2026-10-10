import * as THREE from 'three';
import config from '../data/config.json';
import { WEAPON_SPECS } from './WeaponModels.js';

// Efectos visuales con pools fijos (todo instanciado, sin asignaciones por frame):
//  - trazadoras de bala y fogonazo (una única luz reutilizada),
//  - partículas de cubitos (sangre oscura, astillas, escombros),
//  - chispas aditivas (impactos en muros, metal, brasas),
//  - casquillos que rebotan en el suelo,
//  - bocanadas de humo y polvo (cubos translúcidos que crecen y se desvanecen),
//  - anillos de onda expansiva,
//  - temblor de cámara.
// Las constantes viven en config.json → fx.
const FX = config.fx;
const num = Number;

/** Color hex de una cadena "0xRRGGBB" de config. */
export const hex = (s) => num(s);

/** Alfa de una bocanada: aparece rápido y se desvanece despacio (t = edad/vida). */
export function puffAlpha(t, a0) {
  if (t <= 0 || t >= 1) return 0;
  return a0 * Math.min(1, t / 0.1) * Math.pow(1 - t, 1.3);
}

/** Material de un objeto roto: 'wood', 'metal', 'concrete' o 'sack'. */
export function debrisKind(type, level = 0, cfg = FX.debris) {
  if (type === 'barricada') return cfg.barricadaLevels[level] ?? cfg.default;
  if (type === 'puerta') return cfg.puertaLevels[level] ?? cfg.default;
  return cfg.types[type] ?? cfg.default;
}

/**
 * Parchea un material de three para que cada instancia tenga su propio alfa (atributo
 * `instanceAlpha`) y, opcionalmente, su propia baldosa horizontal del atlas (`instanceTile`).
 */
export function withInstanceAlpha(mat, { tiles = 0 } = {}) {
  mat.transparent = true;
  mat.depthWrite = false;
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float instanceAlpha;\nvarying float vInstAlpha;${tiles ? '\nattribute float instanceTile;' : ''}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInstAlpha = instanceAlpha;');
    if (tiles) {
      sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv.x = (vMapUv.x + instanceTile) / ${tiles.toFixed(1)};\n#endif`);
    }
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vInstAlpha;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vInstAlpha;');
  };
  mat.customProgramCacheKey = () => `instanceAlpha${tiles}`;
  return mat;
}

/** Geometría con un atributo por instancia (alfa, baldosa…). */
export function instanceAttr(geo, name, count, fill = 0) {
  const attr = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(fill), 1);
  attr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute(name, attr);
  return attr;
}

const DEBRIS = {};
for (const k of ['wood', 'metal', 'concrete', 'sack']) {
  const d = FX.debris[k];
  DEBRIS[k] = { ...d, palette: d.colors.map(hex), dustHex: hex(d.dustColor) };
}
const CASINGS = FX.casings;
const SMOKE = FX.muzzleSmoke;
const EXP = FX.explosion;
const AXIS_Z = new THREE.Vector3(0, 0, 1);

export class Effects {
  constructor(scene) {
    this.shakeMul = 1; // opción "Temblor de cámara"
    this.scene = scene;
    this.game = null; // se enlaza con bind(game)

    // Trazadoras: caja fina estirada entre origen y destino.
    const tracerGeo = new THREE.BoxGeometry(1, 1, 1);
    tracerGeo.translate(0, 0, 0.5);
    this.tracerGeo = tracerGeo;
    this.tracers = [];
    this.maxTracers = FX.tracers.max;
    for (let i = 0; i < this.maxTracers; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffe6a0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      const mesh = new THREE.Mesh(tracerGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.tracers.push({ mesh, life: 0, maxLife: FX.tracers.life });
    }
    this._tracerIdx = 0;

    // Fogonazo: una única luz puntual reutilizada (fundido rápido).
    this.flashLight = new THREE.PointLight(0xffc870, 0, 9, 1.6);
    scene.add(this.flashLight);
    this.flashTimer = 0;
    this.flashDur = FX.flash.time;
    this.flashPeak = FX.flash.intensity;
    this.lastMuzzle = new THREE.Vector3();
    this.recoil = 0; // 0..~2: patada del arma (la anima el Player)

    // Partículas: un InstancedMesh de cubitos.
    const maxP = this.maxParticles = FX.particles.max;
    this.particles = new Array(maxP);
    for (let i = 0; i < maxP; i++) {
      this.particles[i] = {
        life: 0, maxLife: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0.1, color: new THREE.Color(), rot: 0, grav: 1, long: 1,
      };
    }
    this._pIdx = 0;
    this.particleMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
      maxP,
    );
    this.particleMesh.frustumCulled = false;
    this.particleMesh.count = 0;
    this.particleMesh.setColorAt(0, new THREE.Color());
    scene.add(this.particleMesh);

    // Chispas aditivas: rayitas orientadas por su velocidad.
    const maxS = this.maxSparks = FX.sparks.max;
    this.sparks = Array.from({ length: maxS }, () => ({ life: 0, maxLife: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, w: 0.03, color: new THREE.Color(), grav: 1 }));
    this._sIdx = 0;
    this.sparkMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
      maxS,
    );
    this.sparkMesh.frustumCulled = false;
    this.sparkMesh.count = 0;
    this.sparkMesh.setColorAt(0, new THREE.Color());
    scene.add(this.sparkMesh);

    // Casquillos: cajitas doradas con física propia (rebotan y se quedan un par de segundos).
    const maxC = this.maxCasings = CASINGS.max;
    this.casings = Array.from({ length: maxC }, () => ({
      life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, wx: 0, wy: 0, wz: 0, scale: 1, rest: false, color: new THREE.Color(),
    }));
    this._cIdx = 0;
    this.casingMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.35, emissive: 0x2a1c06 }),
      maxC,
    );
    this.casingMesh.frustumCulled = false;
    this.casingMesh.count = 0;
    this.casingMesh.castShadow = false;
    this.casingMesh.setColorAt(0, new THREE.Color());
    scene.add(this.casingMesh);

    // Humo y polvo: cubos translúcidos (alfa por instancia) que crecen, suben y se desvanecen.
    const maxU = this.maxPuffs = FX.puffs.max;
    this.puffs = Array.from({ length: maxU }, () => ({
      life: 0, age: 0, delay: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s0: 0.1, s1: 0.2, a0: 0.4, drag: 1,
      rot: 0, spin: 0, color: new THREE.Color(), color2: new THREE.Color(), blend: false,
    }));
    this._uIdx = 0;
    const puffGeo = new THREE.BoxGeometry(1, 1, 1);
    this.puffAlpha = instanceAttr(puffGeo, 'instanceAlpha', maxU);
    this.puffMesh = new THREE.InstancedMesh(puffGeo, withInstanceAlpha(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 })), maxU);
    this.puffMesh.frustumCulled = false;
    this.puffMesh.count = 0;
    this.puffMesh.setColorAt(0, new THREE.Color());
    scene.add(this.puffMesh);

    // Anillos de onda expansiva (planos, aditivos).
    const maxR = this.maxRings = FX.rings.max;
    this.rings = Array.from({ length: maxR }, () => ({ life: 0, age: 0, delay: 0, x: 0, z: 0, r: 1, bright: 1, color: new THREE.Color() }));
    this._rIdx = 0;
    const ringGeo = new THREE.RingGeometry(FX.rings.inner, 1, 40, 1);
    ringGeo.rotateX(-Math.PI / 2);
    this.ringMesh = new THREE.InstancedMesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }),
      maxR,
    );
    this.ringMesh.frustumCulled = false;
    this.ringMesh.count = 0;
    this.ringMesh.setColorAt(0, new THREE.Color());
    scene.add(this.ringMesh);

    this.trauma = 0;
    this.shakeOffset = new THREE.Vector3();
    this._dustT = 0;
    this._footSide = 1;
    this._unsub = [];

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  /** Se suscribe a los eventos del juego (disparos, explosiones, construcciones…). */
  bind(game) {
    this.game = game;
    const on = (type, fn) => this._unsub.push(game.bus.on(type, fn));
    on('weapon:fired', ({ id }) => this.onFired(id));
    on('explosion', ({ x, z, radius }) => this.explosion(x, z, radius));
    on('build:destroyed', ({ type, k }) => this.onBuildDestroyed(type, k));
    on('structure:hit', ({ s, x, z }) => this.debrisHit(debrisKind(s.type, s.level), x, z));
    on('zombie:killed', (e) => this.onZombieKilled(e));
    on('turret:fired', (s) => this.onTurretFired(s));
  }

  // ------------------------------------------------------------------ trazadoras y luz
  tracer(from, to, color = 0xffe6a0) {
    const t = this.tracers[this._tracerIdx];
    this._tracerIdx = (this._tracerIdx + 1) % this.maxTracers;
    const len = from.distanceTo(to);
    t.mesh.position.copy(from);
    t.mesh.lookAt(to);
    t.mesh.scale.set(FX.tracers.width, FX.tracers.width, len);
    t.mesh.material.color.set(color);
    t.mesh.material.opacity = 1;
    t.mesh.visible = true;
    t.life = t.maxLife;
    // Si la trazadora acaba contra un muro (celda que bloquea disparos justo detrás del
    // punto final), salta una lluvia de chispas.
    const game = this.game;
    if (game && len > 0.5) {
      const k = 0.12 / len;
      const px = to.x + (to.x - from.x) * k, pz = to.z + (to.z - from.z) * k;
      const g = game.grid;
      if (g.isShotBlocked(g.cellX(px), g.cellZ(pz))) {
        this.wallImpact(to.x, to.y, to.z, (to.x - from.x) / len, (to.z - from.z) / len);
      }
    }
  }

  muzzleFlash(pos) {
    this.flashLight.position.copy(pos);
    this.lastMuzzle.copy(pos);
    this.flashPeak = FX.flash.intensity;
    this.flashDur = FX.flash.time;
    this.flashLight.intensity = this.flashPeak;
    this.flashTimer = this.flashDur;
  }

  // ------------------------------------------------------------------ partículas de cubitos
  /** Ráfaga de cubitos. */
  burst(x, y, z, count, color, { speed = 3, up = 2, size = 0.09, life = 0.6, dirX = 0, dirZ = 0, gravity = 1, long = 1 } = {}) {
    for (let n = 0; n < count; n++) this.particle(x, y, z, color, speed, up, size, life, dirX, dirZ, gravity, long);
  }

  /** Ráfaga con colores de una paleta (escombros). */
  burstPalette(x, y, z, count, palette, opts) {
    const { speed = 3, up = 2, size = 0.09, life = 0.6, dirX = 0, dirZ = 0, gravity = 1, long = 1 } = opts;
    for (let n = 0; n < count; n++) {
      this.particle(x, y, z, palette[(Math.random() * palette.length) | 0], speed, up, size, life, dirX, dirZ, gravity, long);
    }
  }

  particle(x, y, z, color, speed, up, size, life, dirX, dirZ, gravity, long) {
    const p = this.particles[this._pIdx];
    this._pIdx = (this._pIdx + 1) % this.maxParticles;
    p.x = x; p.y = y; p.z = z;
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.3 + Math.random() * 0.7);
    p.vx = Math.cos(a) * s * 0.6 + dirX * s;
    p.vz = Math.sin(a) * s * 0.6 + dirZ * s;
    p.vy = up * (0.4 + Math.random() * 0.8);
    p.size = size * (0.6 + Math.random() * 0.8);
    p.maxLife = p.life = life * (0.6 + Math.random() * 0.6);
    p.rot = Math.random() * 3;
    p.grav = gravity;
    p.long = long;
    p.color.set(color).multiplyScalar(0.8 + Math.random() * 0.4);
  }

  // ------------------------------------------------------------------ chispas aditivas
  /** Una chispa (rayita brillante) con velocidad (vx,vy,vz). */
  spark(x, y, z, vx, vy, vz, color, life, width = 0.03, gravity = 1) {
    const p = this.sparks[this._sIdx];
    this._sIdx = (this._sIdx + 1) % this.maxSparks;
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.maxLife = p.life = life * (0.7 + Math.random() * 0.5);
    p.w = width; p.grav = gravity;
    p.color.set(color);
  }

  /** Cono de chispas hacia (dirX, dirZ) (normalizado) con abanico `spread` (0..1). */
  sparkBurst(x, y, z, dirX, dirZ, count, speed, up, color, life, width, spread = 0.7, gravity = 1) {
    for (let n = 0; n < count; n++) {
      const s = speed * (0.45 + Math.random() * 0.7);
      this.spark(
        x, y, z,
        (dirX + (Math.random() - 0.5) * 2 * spread) * s,
        up * (Math.random() * 1.3 - 0.15),
        (dirZ + (Math.random() - 0.5) * 2 * spread) * s,
        color, life, width, gravity,
      );
    }
  }

  /** Impacto de bala en un muro: chispas, una pizca de polvo y esquirlas. */
  wallImpact(x, y, z, dx, dz) {
    const w = FX.wallSpark;
    this.sparkBurst(x - dx * 0.05, y, z - dz * 0.05, -dx, -dz, w.count, w.speed, w.up, hex(w.color), w.life, w.width);
    this.burst(x - dx * 0.05, y, z - dz * 0.05, w.dustCount, hex(w.dustColor), { speed: 1.6, up: 1.2, size: 0.05, life: 0.45, dirX: -dx, dirZ: -dz });
    this.puff(x - dx * 0.1, y, z - dz * 0.1, -dx * 0.5, 0.35, -dz * 0.5, w.puffSize, w.puffSize * 2.2, w.puffLife, w.puffAlpha, hex(w.dustColor), 2.5, 0);
  }

  // ------------------------------------------------------------------ casquillos
  /** Expulsa un casquillo desde (x,y,z) hacia la derecha del arma (rx, rz) y un poco atrás. */
  casing(x, y, z, rx, rz, backX, backZ, color, scale) {
    const c = this.casings[this._cIdx];
    this._cIdx = (this._cIdx + 1) % this.maxCasings;
    const sp = CASINGS.ejectSpeed + (Math.random() - 0.5) * 2 * CASINGS.ejectSpeedJitter;
    c.x = x; c.y = y; c.z = z;
    c.vx = rx * sp + backX * CASINGS.ejectBack + (Math.random() - 0.5) * 0.5;
    c.vz = rz * sp + backZ * CASINGS.ejectBack + (Math.random() - 0.5) * 0.5;
    c.vy = CASINGS.ejectUp * (0.8 + Math.random() * 0.4);
    c.rx = Math.random() * 6; c.ry = Math.random() * 6; c.rz = Math.random() * 6;
    c.wx = (Math.random() - 0.5) * 2 * CASINGS.spin;
    c.wy = (Math.random() - 0.5) * 2 * CASINGS.spin;
    c.wz = (Math.random() - 0.5) * 2 * CASINGS.spin;
    c.life = CASINGS.life;
    c.scale = scale;
    c.rest = false;
    c.color.set(color);
  }

  // ------------------------------------------------------------------ humo y polvo
  /**
   * Bocanada de humo/polvo: un cubo translúcido que crece de s0 a s1, se frena (`drag`) y se
   * desvanece. `delay` la retrasa. Si se da `color2`, vira hacia él con la edad.
   */
  puff(x, y, z, vx, vy, vz, s0, s1, life, alpha, color, drag, delay, color2 = 0) {
    const p = this.puffs[this._uIdx];
    this._uIdx = (this._uIdx + 1) % this.maxPuffs;
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.s0 = s0; p.s1 = s1; p.maxLife = life; p.life = life; p.age = 0; p.delay = delay;
    p.a0 = alpha; p.drag = drag;
    p.rot = Math.random() * 6; p.spin = (Math.random() - 0.5) * 1.6;
    p.color.set(color);
    p.blend = color2 !== 0;
    if (p.blend) p.color2.set(color2);
  }

  /** Anillo de onda: radio final `r`, dura `life`. */
  ring(x, z, r, life, color, delay, bright = 1) {
    const g = this.rings[this._rIdx];
    this._rIdx = (this._rIdx + 1) % this.maxRings;
    g.x = x; g.z = z; g.r = r; g.life = life; g.age = 0; g.delay = delay; g.bright = bright;
    g.color.set(color);
  }

  // ------------------------------------------------------------------ eventos del juego
  onFired(id) {
    const game = this.game;
    const cfg = FX.weapons[id];
    if (!cfg) return;
    this.recoil = Math.max(this.recoil, cfg.recoil);
    const ax = game.player.aimDir.x, az = game.player.aimDir.z;
    const m = this.lastMuzzle;
    // Fogonazo visible: tres chispas al frente (la luz ya la pone muzzleFlash).
    if (cfg.smoke > 0) {
      const F = FX.muzzleFlash;
      this.sparkBurst(m.x, m.y, m.z, ax, az, Math.round(F.count * (0.6 + cfg.smoke * 0.5)), F.speed, F.up, hex(F.color), F.life, F.width, F.spread, 0);
    }
    // Bocanada de humo en la boca.
    const puffs = Math.ceil(cfg.smoke);
    for (let n = 0; n < puffs; n++) {
      const j = (Math.random() - 0.5) * 0.4;
      this.puff(
        m.x + ax * 0.05, m.y + 0.02, m.z + az * 0.05,
        ax * SMOKE.speed * (0.6 + Math.random() * 0.8) + az * j, SMOKE.rise * (0.7 + Math.random() * 0.6), az * SMOKE.speed * (0.6 + Math.random() * 0.8) - ax * j,
        SMOKE.size * (0.8 + cfg.smoke * 0.2), SMOKE.size * SMOKE.grow * (0.8 + cfg.smoke * 0.25), SMOKE.life * (0.8 + Math.random() * 0.4), SMOKE.alpha, hex(SMOKE.color), 2.4, 0,
      );
    }
    // Casquillo por la ventana de eyección (a la derecha del arma).
    if (cfg.casings > 0) {
      const back = WEAPON_SPECS[id] ? cfg.ejectBack : 0.2;
      const rx = az, rz = -ax; // derecha del jugador
      this.casing(
        m.x - ax * back + rx * CASINGS.ejectSide, m.y, m.z - az * back + rz * CASINGS.ejectSide,
        rx, rz, -ax, -az, hex(cfg.casingColor), cfg.casingScale,
      );
    }
  }

  onTurretFired(s) {
    const a = s.yaw, dx = Math.sin(a), dz = Math.cos(a);
    const h = (s.baseY ?? 0) + FX.turret.height; // baseY: torreta del tejado (despacho)
    const x = s.cx + dx * FX.turret.muzzle, z = s.cz + dz * FX.turret.muzzle;
    this.sparkBurst(x, h, z, dx, dz, 3, FX.muzzleFlash.speed, FX.muzzleFlash.up, hex(FX.muzzleFlash.color), FX.muzzleFlash.life, FX.muzzleFlash.width, FX.muzzleFlash.spread, 0);
    this.puff(x, h, z, dx * 0.8, 0.5, dz * 0.8, SMOKE.size, SMOKE.size * SMOKE.grow, SMOKE.life, SMOKE.alpha, hex(SMOKE.color), 2.4, 0);
    // El casquillo sale de lado.
    this.casing(s.cx, h, s.cz, dz, -dx, -dx, -dz, hex(FX.turret.casingColor), 1);
  }

  onZombieKilled({ x, z, fallX = 0, fallZ = 0, scale = 1 }) {
    // Polvo del cuerpo al tocar el suelo (poco después de empezar a caer).
    const D = FX.zombieDeath;
    const dist = D.landDist * scale;
    const delay = (this.game?.zombies?.ai?.fallTime ?? 0.4) * D.settleStart;
    for (let n = 0; n < D.dustPuffs; n++) {
      this.puff(
        x + fallX * dist + (Math.random() - 0.5) * 0.4, 0.08, z + fallZ * dist + (Math.random() - 0.5) * 0.4,
        (Math.random() - 0.5) * D.dustSpeed + fallX * 0.5, 0.25, (Math.random() - 0.5) * D.dustSpeed + fallZ * 0.5,
        D.dustSize, D.dustSize * D.dustGrow, D.dustLife, D.dustAlpha, hex(D.dustColor), 2.2, delay,
      );
    }
  }

  onBuildDestroyed(type, k) {
    const g = this.game.grid;
    const s = this.game.build?.structures?.get(k);
    const kind = debrisKind(type, s?.level ?? 0);
    const D = DEBRIS[kind];
    const cells = s?.cells ?? [k];
    for (const c of cells) {
      const x = g.centerX(c % g.w), z = g.centerZ((c / g.w) | 0);
      const sh = FX.debris;
      this.burstPalette(x, 0.7, z, D.chips, D.palette, { speed: sh.chipSpeed, up: sh.chipUp, size: sh.chipSize, life: sh.chipLife });
      if (D.splinters) this.burstPalette(x, 0.9, z, D.splinters, D.palette, { speed: sh.chipSpeed * 1.2, up: sh.chipUp * 0.9, size: sh.splinterSize, life: sh.chipLife, long: sh.splinterLong });
      if (D.sparks) this.sparkBurst(x, 0.8, z, 0, 0, D.sparks, sh.sparkSpeed, sh.sparkUp, hex(sh.sparkColor), sh.sparkLife, 0.03, 1.0);
      for (let n = 0; n < D.dust; n++) {
        this.puff(
          x + (Math.random() - 0.5) * 0.7, 0.3 + Math.random() * 0.5, z + (Math.random() - 0.5) * 0.7,
          (Math.random() - 0.5) * 1.8, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 1.8,
          sh.dustSize, sh.dustSize * sh.dustGrow, sh.dustLife * (0.8 + Math.random() * 0.5), sh.dustAlpha, D.dustHex, 1.8, 0,
        );
      }
    }
  }

  /** Golpe a una construcción: unas astillas/esquirlas y una voluta. */
  debrisHit(kind, x, z) {
    const D = DEBRIS[kind], sh = FX.debris;
    this.burstPalette(x, 0.9, z, sh.hitChips, D.palette, { speed: sh.chipSpeed * 0.7, up: sh.chipUp * 0.7, size: sh.chipSize * 0.7, life: sh.chipLife * 0.6 });
    if (D.sparks) this.sparkBurst(x, 0.9, z, 0, 0, sh.hitSparks, sh.sparkSpeed * 0.7, sh.sparkUp * 0.7, hex(sh.sparkColor), sh.sparkLife, 0.025, 1.0);
    if (D.dust) {
      this.puff(x, 0.8, z, (Math.random() - 0.5) * 1.2, 0.5, (Math.random() - 0.5) * 1.2, sh.dustSize * 0.6, sh.dustSize * sh.dustGrow * 0.8, sh.dustLife * 0.7, sh.dustAlpha * 0.8, D.dustHex, 2, 0);
    }
  }

  /** Explosión: destello, anillos de onda, bola de polvo, brasas y columna de humo. */
  explosion(x, z, radius) {
    const sc = radius / EXP.refRadius;
    // Destello de luz: reutiliza la luz del fogonazo, con fundido.
    this.flashLight.position.set(x, 1.4, z);
    this.flashPeak = FX.flash.explosionIntensity;
    this.flashDur = FX.flash.explosionTime;
    this.flashLight.intensity = this.flashPeak;
    this.flashTimer = this.flashDur;
    // Ondas.
    this.ring(x, z, radius * EXP.ringMul, EXP.ringLife, hex(EXP.ringColor), 0, EXP.ringBright);
    this.ring(x, z, radius * EXP.ringMul * 0.8, EXP.ring2Life, hex(EXP.ring2Color), EXP.ring2Delay, EXP.ring2Bright);
    // Anillo de polvo que sale rodando por el suelo.
    for (let n = 0; n < EXP.dustCount; n++) {
      const a = (n / EXP.dustCount) * Math.PI * 2 + Math.random() * 0.4;
      const sp = EXP.dustSpeed * sc * (0.7 + Math.random() * 0.6);
      this.puff(
        x + Math.cos(a) * 0.4, 0.2, z + Math.sin(a) * 0.4, Math.cos(a) * sp, 0.4, Math.sin(a) * sp,
        EXP.dustSize * sc, EXP.dustSize * EXP.dustGrow * sc, EXP.dustLife * (0.8 + Math.random() * 0.4), EXP.dustAlpha, hex(EXP.dustColor), 2.6, 0,
      );
    }
    // Brasas y chispas.
    this.sparkBurst(x, 0.5, z, 0, 0, EXP.emberCount, EXP.emberSpeed * sc, EXP.emberUp, hex(EXP.emberColor), EXP.emberLife, 0.045, 1.4, 0.7);
    // Columna de humo: bocanadas que se escalonan hacia arriba.
    for (let n = 0; n < EXP.smokeCount; n++) {
      const f = n / (EXP.smokeCount - 1);
      const a = Math.random() * Math.PI * 2, r = Math.random() * EXP.smokeSpread * sc;
      this.puff(
        x + Math.cos(a) * r * 0.5, 0.4 + f * 0.6, z + Math.sin(a) * r * 0.5,
        Math.cos(a) * r * 0.5, EXP.smokeRise * (0.55 + f * 0.6) * (0.85 + Math.random() * 0.3), Math.sin(a) * r * 0.5,
        EXP.smokeSize * sc * (0.7 + f * 0.5), EXP.smokeSize * EXP.smokeGrow * sc * (0.8 + f * 0.5),
        EXP.smokeLife * (1 + (Math.random() - 0.5) * 2 * EXP.smokeLifeJitter), EXP.smokeAlpha, hex(EXP.smokeColor), 0.9, n * EXP.smokeDelay, hex(EXP.smokeColorLight),
      );
    }
  }

  shake(amount) {
    this.trauma = Math.min(1, this.trauma + amount * this.shakeMul);
  }

  // ------------------------------------------------------------------ actualización
  /** Polvo de las carreras: unas bocanadas en los pies cada pocos pasos. */
  sprintDust(dt) {
    const game = this.game;
    const pl = game?.player;
    if (!pl?.alive) { this._dustT = 0; return; }
    const v = pl.velocity;
    const sp = Math.hypot(v.x, v.z);
    if (sp < FX.sprintDust.speedThreshold) { this._dustT = 0; return; }
    const S = FX.sprintDust;
    this._dustT += dt;
    if (this._dustT < S.interval) return;
    this._dustT -= S.interval;
    this._footSide = -this._footSide;
    const ux = v.x / sp, uz = v.z / sp;
    const fx = pl.position.x - ux * 0.12 + uz * this._footSide * S.footSide;
    const fz = pl.position.z - uz * 0.12 - ux * this._footSide * S.footSide;
    this.puff(
      fx, 0.07, fz, -ux * S.backSpeed + (Math.random() - 0.5) * 0.5, S.rise * (0.7 + Math.random() * 0.6), -uz * S.backSpeed + (Math.random() - 0.5) * 0.5,
      S.size, S.size * S.grow, S.life * (0.8 + Math.random() * 0.4), S.alpha, hex(S.color), 2.2, 0,
    );
    for (let n = 0; n < S.flecks; n++) this.particle(fx, 0.06, fz, hex(S.color), 1.2, 1.4, S.fleckSize, 0.35, -ux * 0.6, -uz * 0.6, 1, 1);
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
      else this.flashLight.intensity = this.flashPeak * (this.flashTimer / this.flashDur);
    }
    this.recoil *= Math.exp(-FX.player.recoilDecay * dt);
    if (this.recoil < 0.001) this.recoil = 0;

    if (this.game) this.sprintDust(dt);

    this.updateParticles(dt);
    this.updateSparks(dt);
    this.updateCasings(dt);
    this.updatePuffs(dt);
    this.updateRings(dt);

    // Temblor de cámara proporcional al cuadrado del "trauma".
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    const s = this.trauma * this.trauma * 0.6;
    const t = performance.now() * 0.05;
    this.shakeOffset.set(Math.sin(t * 1.7) * s, Math.sin(t * 2.3) * s * 0.5, Math.cos(t * 1.9) * s);
  }

  updateParticles(dt) {
    const { _m, _q, _e, _v, _s } = this;
    const grav = FX.particles.gravity, damp = FX.particles.floorDamp;
    let count = 0;
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.vy -= grav * p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < p.size / 2) {
        // Se quedan en el suelo un momento (manchas de cubitos).
        p.y = p.size / 2; p.vy = 0; p.vx *= damp; p.vz *= damp;
      }
      const k = Math.min(1, p.life / (p.maxLife * 0.3));
      _e.set(p.rot, p.rot * 1.3, 0);
      _q.setFromEuler(_e);
      _v.set(p.x, p.y, p.z);
      if (p.long !== 1) _s.set(p.size * 0.45 * k, p.size * 0.45 * k, p.size * p.long * k);
      else _s.setScalar(p.size * k);
      _m.compose(_v, _q, _s);
      this.particleMesh.setMatrixAt(count, _m);
      this.particleMesh.setColorAt(count, p.color);
      count++;
    }
    this.particleMesh.count = count;
    this.particleMesh.instanceMatrix.needsUpdate = true;
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
  }

  updateSparks(dt) {
    const { _m, _q, _v, _s, _d, _c } = this;
    const mesh = this.sparkMesh;
    const grav = FX.particles.gravity;
    let count = 0;
    for (const p of this.sparks) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.vy -= grav * p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.02) { p.life = 0; continue; }
      const sp = Math.hypot(p.vx, p.vy, p.vz);
      const k = Math.max(0, p.life / p.maxLife);
      _d.set(p.vx / (sp || 1), p.vy / (sp || 1), p.vz / (sp || 1));
      _q.setFromUnitVectors(AXIS_Z, _d);
      _v.set(p.x, p.y, p.z);
      _s.set(p.w, p.w, Math.max(0.03, sp * FX.sparks.streak) * (0.4 + 0.6 * k));
      _m.compose(_v, _q, _s);
      mesh.setMatrixAt(count, _m);
      mesh.setColorAt(count, _c.copy(p.color).multiplyScalar(k * k * 1.2));
      count++;
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  updateCasings(dt) {
    const { _m, _q, _e, _v, _s } = this;
    const mesh = this.casingMesh;
    const [sx, sy, sz] = CASINGS.size;
    let count = 0;
    for (const c of this.casings) {
      if (c.life <= 0) continue;
      c.life -= dt;
      if (!c.rest) {
        c.vy -= CASINGS.gravity * dt;
        c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
        c.rx += c.wx * dt; c.ry += c.wy * dt; c.rz += c.wz * dt;
        if (c.y < CASINGS.floorY && c.vy < 0) {
          c.y = CASINGS.floorY;
          c.vy = -c.vy * CASINGS.bounce;
          c.vx *= CASINGS.friction; c.vz *= CASINGS.friction;
          c.wx *= 0.55; c.wy *= 0.55; c.wz *= 0.55;
          // Se para cuando ya no rebota: queda plano sobre el suelo.
          if (c.vy < CASINGS.restSpeed) { c.rest = true; c.rx = 0; c.rz = 0; c.y = CASINGS.restOffsetY; }
        }
      }
      const fade = Math.min(1, c.life / CASINGS.fadeTime);
      _e.set(c.rx, c.ry, c.rz);
      _q.setFromEuler(_e);
      _v.set(c.x, c.y, c.z);
      _s.set(sx * c.scale * fade, sy * c.scale * fade, sz * c.scale * fade);
      _m.compose(_v, _q, _s);
      mesh.setMatrixAt(count, _m);
      mesh.setColorAt(count, c.color);
      count++;
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  updatePuffs(dt) {
    const { _m, _q, _e, _v, _s, _c } = this;
    const mesh = this.puffMesh, alpha = this.puffAlpha.array;
    let count = 0;
    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      if (p.delay > 0) { p.delay -= dt; continue; }
      p.age += dt;
      if (p.age >= p.life) { p.life = 0; continue; }
      const t = p.age / p.life;
      const damp = Math.exp(-p.drag * dt);
      p.vx *= damp; p.vz *= damp; p.vy *= Math.exp(-p.drag * 0.35 * dt);
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const size = p.s0 + (p.s1 - p.s0) * (1 - (1 - t) * (1 - t));
      p.rot += p.spin * dt;
      _e.set(p.rot * 0.5, p.rot, 0);
      _q.setFromEuler(_e);
      _v.set(p.x, Math.max(p.y, size * 0.3), p.z);
      _s.setScalar(size);
      _m.compose(_v, _q, _s);
      mesh.setMatrixAt(count, _m);
      mesh.setColorAt(count, p.blend ? _c.copy(p.color).lerp(p.color2, t) : p.color);
      alpha[count] = puffAlpha(t, p.a0);
      count++;
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.puffAlpha.needsUpdate = true;
  }

  updateRings(dt) {
    const { _m, _q, _v, _s, _c } = this;
    const mesh = this.ringMesh;
    _q.identity();
    let count = 0;
    for (const g of this.rings) {
      if (g.life <= 0) continue;
      if (g.delay > 0) { g.delay -= dt; continue; }
      g.age += dt;
      if (g.age >= g.life) { g.life = 0; continue; }
      const t = g.age / g.life;
      const r = g.r * (1 - Math.pow(1 - t, 2.6)) + 0.05;
      _v.set(g.x, FX.explosion.ringY, g.z);
      _s.set(r, 1, r);
      _m.compose(_v, _q, _s);
      mesh.setMatrixAt(count, _m);
      mesh.setColorAt(count, _c.copy(g.color).multiplyScalar(Math.pow(1 - t, 1.6) * g.bright));
      count++;
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  reset() {
    for (const p of this.particles) p.life = 0;
    for (const p of this.sparks) p.life = 0;
    for (const p of this.casings) p.life = 0;
    for (const p of this.puffs) p.life = 0;
    for (const p of this.rings) p.life = 0;
    for (const t of this.tracers) { t.life = 0; t.mesh.visible = false; }
    this.flashTimer = 0;
    this.flashLight.intensity = 0;
    this.trauma = 0;
    this.recoil = 0;
    this._dustT = 0;
    for (const m of [this.particleMesh, this.sparkMesh, this.casingMesh, this.puffMesh, this.ringMesh]) m.count = 0;
  }

  dispose() {
    for (const off of this._unsub) off();
    this._unsub.length = 0;
    const { scene } = this;
    for (const t of this.tracers) { scene.remove(t.mesh); t.mesh.material.dispose(); }
    this.tracerGeo.dispose();
    scene.remove(this.flashLight);
    for (const m of [this.particleMesh, this.sparkMesh, this.casingMesh, this.puffMesh, this.ringMesh]) {
      scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
      m.dispose();
    }
  }
}
