import * as THREE from 'three';

// Luigi, el chihuahua "de bloques" (mismo estilo que BlockyCharacter): cajas con su pivote,
// animadas por código. Trote (patas y cola), ladrido (cabeza arriba y boca abierta), saltito al
// morder y voltereta corta al recibir un manotazo. Medidas en metros (es pequeño, pero con las
// orejas exageradas para que se reconozca desde la cámara). El chaleco sale con el nivel II.

const LEGS = ['legFL', 'legFR', 'legBL', 'legBR'];
const FUR = 0xd9a46a, FUR_D = 0xb98450, EAR_IN = 0xf0b4a8, DARK = 0x1d1a18, VEST = 0x23395f, VEST_Y = 0xf2c230;

/** Pose de Luigi (función pura, sin asignaciones): rellena `out` a partir del estado. */
export function luigiPose(out, phase, speed, barkT, hopT, yelpT, time, cfg) {
  const trot = Math.min(1, speed / cfg.walkSpeed);
  const s = Math.sin(phase) * 0.8 * trot;
  out.legFL = s; out.legBR = s;
  out.legFR = -s; out.legBL = -s;
  out.bob = Math.abs(Math.cos(phase)) * 0.025 * trot;
  // Cola: menea siempre (más rápido al correr).
  out.tail = Math.sin(time * (10 + trot * 8)) * 0.6;
  const bark = barkT > 0 ? Math.sin((barkT / cfg.barkSeconds) * Math.PI) : 0;
  out.headX = -0.45 * bark;
  out.jaw = 0.5 * bark;
  // Saltito al morder: parábola corta.
  const h = hopT > 0 ? hopT / cfg.hopSeconds : 0;
  out.hop = h > 0 ? Math.sin(h * Math.PI) * 0.16 : 0;
  // Gañido: voltereta lateral y bote.
  const y = yelpT > 0 ? yelpT / cfg.yelpSeconds : 0;
  out.roll = y > 0 ? (1 - y) * Math.PI * 2 : 0;
  out.hop += y > 0 ? Math.sin(y * Math.PI) * 0.3 : 0;
  // Tiembla un poco parado (es un chihuahua).
  out.shiver = trot < 0.1 && !y ? Math.sin(time * 70) * 0.012 : 0;
  return out;
}

export class LuigiRenderer {
  constructor(game, parent) {
    this.game = game;
    this.cfg = game.despacho.luigi.cfg;
    this.geos = [];
    this.mats = new Map();
    this.root = new THREE.Group();
    this.root.name = 'luigi';
    this.root.visible = false;
    parent.add(this.root);
    this.pose = { legFL: 0, legFR: 0, legBL: 0, legBR: 0, bob: 0, tail: 0, headX: 0, jaw: 0, hop: 0, roll: 0, shiver: 0 };

    const box = (parentObj, w, h, d, color, x, y, z) => {
      const g = new THREE.BoxGeometry(w, h, d);
      this.geos.push(g);
      const m = new THREE.Mesh(g, this.mat(color));
      m.position.set(x, y, z);
      m.castShadow = true;
      parentObj.add(m);
      return m;
    };
    const pivot = (parentObj, x, y, z) => {
      const o = new THREE.Group();
      o.position.set(x, y, z);
      parentObj.add(o);
      return o;
    };

    // Cuerpo (todo cuelga de `body`, que bota y gira).
    const body = this.body = pivot(this.root, 0, 0, 0);
    box(body, 0.2, 0.15, 0.34, FUR, 0, 0.24, 0);
    box(body, 0.16, 0.05, 0.22, 0xf1d2a4, 0, 0.17, 0.02); // tripa clara
    // Patas: pivote en la cadera, cuelgan hacia abajo.
    const legs = {};
    for (const [name, x, z] of [['legFL', -0.06, 0.12], ['legFR', 0.06, 0.12], ['legBL', -0.06, -0.12], ['legBR', 0.06, -0.12]]) {
      const p = pivot(body, x, 0.2, z);
      box(p, 0.06, 0.2, 0.06, FUR_D, 0, -0.1, 0);
      box(p, 0.065, 0.03, 0.08, 0xf1d2a4, 0, -0.19, 0.01);
      legs[name] = p;
    }
    this.legs = legs;
    // Cola.
    this.tail = pivot(body, 0, 0.3, -0.17);
    box(this.tail, 0.04, 0.04, 0.16, FUR_D, 0, 0.04, -0.07).rotation.x = -0.7;
    // Cabeza: cabezón de chihuahua, orejas enormes, hocico corto, ojos saltones.
    const head = this.head = pivot(body, 0, 0.32, 0.17);
    box(head, 0.2, 0.17, 0.17, FUR, 0, 0.06, 0.04);
    box(head, 0.09, 0.05, 0.08, 0xf1d2a4, 0, 0.03, 0.15);  // hocico (arriba)
    box(head, 0.035, 0.03, 0.02, DARK, 0, 0.055, 0.19);    // trufa
    this.jaw = pivot(head, 0, 0.005, 0.11);
    box(this.jaw, 0.08, 0.025, 0.08, 0xe6c79a, 0, -0.01, 0.03);
    for (const sx of [-1, 1]) {
      box(head, 0.045, 0.05, 0.02, DARK, sx * 0.055, 0.1, 0.13);      // ojos
      box(head, 0.015, 0.015, 0.005, 0xffffff, sx * 0.065, 0.115, 0.141);
      const ear = pivot(head, sx * 0.07, 0.13, 0.03);
      ear.rotation.z = -sx * 0.45;
      box(ear, 0.09, 0.16, 0.025, FUR, 0, 0.08, 0);
      box(ear, 0.06, 0.11, 0.01, EAR_IN, 0, 0.075, 0.016);
    }
    // Chaleco (nivel II): azul con franja amarilla y "K9" de mentira.
    this.vest = pivot(body, 0, 0, 0);
    box(this.vest, 0.215, 0.11, 0.22, VEST, 0, 0.27, 0.0);
    box(this.vest, 0.22, 0.025, 0.05, VEST_Y, 0, 0.3, 0.03);
    box(this.vest, 0.03, 0.03, 0.03, 0xd24a3e, 0, 0.335, -0.05); // luz de emergencia, por supuesto
  }

  mat(color) {
    let m = this.mats.get(color);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
      this.mats.set(color, m);
    }
    return m;
  }

  update() {
    const { game } = this;
    const L = game.despacho.luigi;
    this.root.visible = L.active;
    if (!L.active) return;
    const p = luigiPose(this.pose, L.phase, L.speed, L.barkT, L.hopT, L.yelpT, game.time, this.cfg);
    this.root.position.set(L.pos.x + p.shiver, 0, L.pos.z);
    this.root.rotation.y = L.yaw;
    this.body.position.y = p.bob + p.hop;
    this.body.rotation.z = p.roll;
    for (const k of LEGS) this.legs[k].rotation.x = p[k];
    this.tail.rotation.y = p.tail;
    this.head.rotation.x = p.headX;
    this.jaw.rotation.x = p.jaw;
    this.vest.visible = L.level >= 2;
  }

  dispose() {
    this.root.parent?.remove(this.root);
    for (const g of this.geos) g.dispose();
    for (const m of this.mats.values()) m.dispose();
  }
}
