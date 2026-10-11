import * as THREE from 'three';
import { PARTS, PART_NAMES, partGeometry } from './BlockyCharacter.js';

// Dibuja lo que crean las misiones (src/systems/Missions.js): la caja de pruebas, el gato, el
// concejal, el coche patrulla y los anillos de aviso; y aplica sus efectos globales a la escena
// (niebla, apagón) justo DESPUÉS de Lighting.update, que fija esos valores cada frame, así que no
// hace falta deshacer nada. Todo se crea con primitivas; cada vista tiene su geometría y sus
// materiales y los libera al quitarse la entidad.

const FOG_COLOR = new THREE.Color(0x8d98a6);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

const RING_COLORS = { box: 0xffd24a, cat: 0xffa84a, concejal: 0xff5a4a, car: 0x6ab4ff };

// ---------------------------------------------------------------- vistas de cada tipo
function buildBox() {
  const root = new THREE.Group();
  const kraft = std(0xb98a52), tape = std(0xe9d9a8), flag = std(0xd9473b);
  root.add(box(0.56, 0.38, 0.42, kraft, 0, 0.19, 0));
  root.add(box(0.12, 0.392, 0.43, tape, 0, 0.19, 0));
  root.add(box(0.2, 0.02, 0.12, tape, 0.13, 0.385, 0.1));
  const pole = box(0.03, 0.5, 0.03, std(0x3a3d44), -0.24, 0.62, -0.16);
  root.add(pole, box(0.2, 0.12, 0.02, flag, -0.14, 0.78, -0.16));
  return { root, animate(e, t, g) {
    const carried = e.state === 'carried';
    root.scale.setScalar(carried ? 0.85 : 1);
    const p = g.player;
    root.position.set(e.x, carried ? 0.95 : 0, e.z);
    root.rotation.y = carried ? p.facing : (e.x * 0.7);
  } };
}

function buildCat() {
  const root = new THREE.Group();
  const fur = std(0xd9923a), dark = std(0x8a5a22), eye = new THREE.MeshBasicMaterial({ color: 0x1a1a1a }), pink = std(0xe99a9a);
  const body = box(0.3, 0.2, 0.55, fur, 0, 0.3, 0);
  const head = new THREE.Group();
  head.position.set(0, 0.42, 0.33);
  head.add(box(0.24, 0.22, 0.22, fur, 0, 0, 0));
  head.add(box(0.07, 0.09, 0.05, dark, -0.08, 0.15, -0.02), box(0.07, 0.09, 0.05, dark, 0.08, 0.15, -0.02));
  head.add(box(0.04, 0.04, 0.02, eye, -0.06, 0.03, 0.115), box(0.04, 0.04, 0.02, eye, 0.06, 0.03, 0.115));
  head.add(box(0.04, 0.03, 0.02, pink, 0, -0.03, 0.115));
  const tail = new THREE.Group();
  tail.position.set(0, 0.36, -0.28);
  tail.add(box(0.06, 0.06, 0.34, dark, 0, 0.05, -0.16));
  const legs = [[-0.1, 0.2], [0.1, 0.2], [-0.1, -0.2], [0.1, -0.2]].map(([x, z]) => {
    const l = new THREE.Group();
    l.position.set(x, 0.22, z);
    l.add(box(0.07, 0.22, 0.07, dark, 0, -0.11, 0));
    root.add(l);
    return l;
  });
  root.add(body, head, tail);
  return { root, animate(e, t, g) {
    const speed = Math.hypot(e.vx ?? 0, e.vz ?? 0);
    const carried = e.state === 'carried';
    const sit = e.state === 'safe';
    root.position.set(e.x, carried ? 0.78 : 0, e.z);
    root.rotation.y = carried ? g.player.facing + Math.PI : (e.facing ?? 0);
    const ph = t * (speed > 2 ? 22 : 12);
    legs.forEach((l, k) => { l.rotation.x = speed > 0.1 ? Math.sin(ph + (k % 2 ? Math.PI : 0) + (k > 1 ? Math.PI / 2 : 0)) * 0.7 : 0; });
    tail.rotation.y = Math.sin(t * (speed > 2 ? 14 : 4)) * 0.5;
    tail.rotation.x = sit ? -0.2 : speed > 2 ? -0.3 : 0.5;
    head.rotation.x = sit ? -0.15 : 0;
    root.scale.setScalar(carried ? 0.85 : 1);
    body.position.y = 0.3 + (e.hurt > 0 ? 0.03 : 0);
  } };
}

function buildConcejal() {
  const root = new THREE.Group();
  const colors = { legL: 0x3d4048, legR: 0x3d4048, torso: 0x59606e, armL: 0x59606e, armR: 0x59606e, head: 0xe2b48c };
  const mats = {}, parts = {};
  for (const n of PART_NAMES) {
    mats[n] = std(colors[n]);
    const m = new THREE.Mesh(partGeometry(n), mats[n]);
    m.position.fromArray(PARTS[n].pivot);
    m.castShadow = true;
    root.add(m);
    parts[n] = m;
  }
  // Camisa blanca, corbata roja y pelo cano de político.
  parts.torso.add(box(0.12, 0.5, 0.02, std(0xf2efe6), 0, 0.3, 0.145), box(0.05, 0.36, 0.025, std(0xc23a3a), 0, 0.26, 0.155));
  parts.head.add(box(0.4, 0.07, 0.4, std(0xb8b8b8), 0, 0.37, 0), box(0.04, 0.04, 0.02, new THREE.MeshBasicMaterial({ color: 0x1a1a1a }), -0.08, 0.2, 0.195), box(0.04, 0.04, 0.02, new THREE.MeshBasicMaterial({ color: 0x1a1a1a }), 0.08, 0.2, 0.195));
  return { root, mats, animate(e, t, g) {
    root.position.set(e.x, e.y ?? 0, e.z);
    const p = g.player.position;
    root.rotation.y = Math.atan2(p.x - e.x, p.z - e.z);
    // Brazos en alto agitándose y un temblor de miedo.
    parts.armL.rotation.x = -2.7 + Math.sin(t * 8) * 0.3;
    parts.armR.rotation.x = -2.5 + Math.sin(t * 8 + 1.3) * 0.35;
    parts.armL.rotation.z = -0.25; parts.armR.rotation.z = 0.25;
    parts.legL.rotation.x = Math.sin(t * 16) * 0.08; parts.legR.rotation.x = -Math.sin(t * 16) * 0.08;
    root.position.y += Math.abs(Math.sin(t * 6)) * 0.04;
    const flash = e.hurt > 0 ? 0.7 : 0;
    for (const n of PART_NAMES) mats[n].emissive.setRGB(flash, 0, 0);
  } };
}

function buildCar() {
  const root = new THREE.Group();
  const body = std(0x1b1f27, { roughness: 0.5, metalness: 0.2 }), white = std(0xeceff2, { roughness: 0.5 });
  const glass = std(0x1f3a52, { roughness: 0.2 }), tire = std(0x15171b);
  const red = new THREE.MeshBasicMaterial({ color: 0xff2a2a }), blue = new THREE.MeshBasicMaterial({ color: 0x2a6aff });
  const head = new THREE.MeshBasicMaterial({ color: 0xfff1b0 });
  // Largo en X (4 m), ancho en Z (1,9 m).
  const parts = [
    box(4.0, 0.6, 1.9, body, 0, 0.55, 0), box(2.0, 0.5, 1.7, body, -0.1, 1.1, 0),
    box(1.9, 0.18, 1.72, white, -0.1, 1.38, 0), box(1.25, 0.5, 1.93, white, 0.55, 0.52, 0), box(0.9, 0.5, 1.93, white, -1.45, 0.52, 0),
    box(0.05, 0.28, 1.5, glass, 0.92, 1.12, 0), box(0.05, 0.28, 1.5, glass, -1.12, 1.12, 0),
    box(1.2, 0.24, 0.04, glass, -0.1, 1.12, 0.86), box(1.2, 0.24, 0.04, glass, -0.1, 1.12, -0.86),
    box(0.05, 0.14, 0.4, head, 2.0, 0.62, 0.6), box(0.05, 0.14, 0.4, head, 2.0, 0.62, -0.6),
  ];
  for (const p of parts) root.add(p);
  for (const [x, z] of [[1.25, 0.95], [1.25, -0.95], [-1.25, 0.95], [-1.25, -0.95]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.26, 12), tire);
    w.rotation.x = Math.PI / 2;
    w.position.set(x, 0.34, z);
    w.castShadow = true;
    root.add(w);
  }
  const bar = new THREE.Group();
  bar.position.set(-0.1, 1.55, 0);
  const lr = box(0.2, 0.12, 0.7, red, 0, 0, 0.36), lb = box(0.2, 0.12, 0.7, blue, 0, 0, -0.36);
  bar.add(lr, lb);
  root.add(bar);
  return { root, mats: { body, white }, animate(e, t, g) {
    root.position.set(e.x + (e.hurt > 0 ? Math.sin(t * 60) * 0.03 : 0), 0, e.z);
    root.rotation.y = e.rot === 90 ? Math.PI / 2 : 0;
    const dead = e.hp <= 0;
    const dmg = 1 - clamp01(e.hp / e.maxHp);
    body.color.setHex(dead ? 0x0c0c0e : 0x1b1f27);
    white.color.setRGB(1 - dmg * 0.55, 1 - dmg * 0.55, 1 - dmg * 0.55);
    if (dead) white.color.setHex(0x2a2a2e);
    const on = !dead && Math.floor(g.time * 5) % 2 === 0;
    red.color.setHex(dead ? 0x222222 : on ? 0xff2a2a : 0x551010);
    blue.color.setHex(dead ? 0x222222 : on ? 0x1a2a55 : 0x2a6aff);
    body.emissive.setRGB(e.hurt > 0 ? 0.5 : 0, 0, 0);
  } };
}

const BUILDERS = { box: buildBox, cat: buildCat, concejal: buildConcejal, car: buildCar };

export class MissionRenderer {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'misiones';
    game.scene.add(this.group);
    this.views = new Map();
    this.version = -1;
    this.fogK = 0;
    this.blackK = 0;
    this._fogP = null;
    this.ringGeo = new THREE.RingGeometry(0.7, 0.95, 40);
    this.ringGeo.rotateX(-Math.PI / 2);
  }

  /** Crea las vistas de las entidades nuevas y quita las de las que ya no existen. */
  sync() {
    const M = this.game.missions;
    this.version = M.entityVersion;
    const live = new Set(M.entities);
    for (const [e, v] of this.views) {
      if (live.has(e)) continue;
      this.disposeView(v);
      this.views.delete(e);
    }
    for (const e of M.entities) {
      if (this.views.has(e) || !BUILDERS[e.kind]) continue;
      const v = BUILDERS[e.kind]();
      v.ring = null;
      if (RING_COLORS[e.kind]) {
        v.ringMat = new THREE.MeshBasicMaterial({ color: RING_COLORS[e.kind], transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
        v.ring = new THREE.Mesh(this.ringGeo, v.ringMat);
        v.ring.position.y = 0.06;
        v.ring.renderOrder = 3;
        this.group.add(v.ring);
      }
      this.group.add(v.root);
      this.views.set(e, v);
    }
  }

  disposeView(v) {
    this.group.remove(v.root);
    v.root.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    if (v.ring) { this.group.remove(v.ring); v.ringMat.dispose(); }
  }

  update(dt) {
    const g = this.game;
    const M = g.missions;
    if (!M) return;
    if (M.entityVersion !== this.version) this.sync();
    const t = g.time;
    for (const [e, v] of this.views) {
      v.animate(e, t, g);
      if (v.ring) {
        const show = e.state !== 'carried' && e.state !== 'safe' && e.state !== 'delivered' && e.hp > 0;
        v.ring.visible = show;
        if (show) {
          const r = e.kind === 'car' ? 2.6 : e.kind === 'concejal' ? 1.8 : 1.1;
          const pulse = 1 + Math.sin(t * 4) * 0.12;
          v.ring.position.x = e.x; v.ring.position.z = e.z;
          v.ring.scale.setScalar(r * pulse);
        }
      }
    }
    this.applyBlackout(dt);
    this.applyFog(dt);
  }

  /** Apagón: sin farolas ni charcos de luz (Lighting los recalcula cada frame, aquí se atenúan). */
  applyBlackout(dt) {
    const g = this.game;
    const target = g.missions.fx.blackout ? 1 : 0;
    const bstep = dt / 1.2;
    this.blackK = clamp01(this.blackK + Math.max(-bstep, Math.min(bstep, target - this.blackK)));
    const k = this.blackK;
    if (k <= 0.001) return;
    const L = g.lighting;
    const keep = 1 - k;
    for (const m of [L.lampPools, L.interiorPools, L.focoPools]) if (m) m.material.opacity *= keep;
    for (const pl of [...L.lampLights, ...L.focoLights]) pl.intensity *= keep;
    g.renderer.hemi.intensity *= 1 - 0.4 * k;
  }

  /** Niebla: acerca la niebla a la cámara (en proporción a su distancia al policía) y la aclara. */
  applyFog(dt) {
    const g = this.game;
    const P = g.missions.fx.fog;
    if (P) this._fogP = P;
    const p = this._fogP;
    if (!p) return;
    const target = P ? 1 : 0;
    const step = dt / Math.max(0.1, p.fadeSeconds);
    this.fogK = clamp01(this.fogK + Math.max(-step, Math.min(step, target - this.fogK)));
    const k = this.fogK;
    if (k <= 0.001) { if (!P) this._fogP = null; return; }
    const scene = g.scene;
    const d = g.cameraRig.camera.position.distanceTo(g.player.position);
    const night = g.dayNight.nightFactor();
    scene.fog.near += (d * p.nearMul - scene.fog.near) * k;
    scene.fog.far += (d * p.farMul - scene.fog.far) * k;
    scene.fog.color.lerp(FOG_COLOR, p.tint * k * night);
    scene.background.copy(scene.fog.color);
    const eyes = g.zombies.eyeMaterial;
    if (eyes) eyes.opacity *= 1 - (1 - p.eyesMul) * k;
  }

  dispose() {
    for (const v of this.views.values()) this.disposeView(v);
    this.views.clear();
    this.ringGeo.dispose();
    this.game.scene.remove(this.group);
  }
}
