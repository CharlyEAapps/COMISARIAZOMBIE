import * as THREE from 'three';
import { PropBuilder } from './props/Builder.js';
import { DRONE_STATE } from '../entities/Drone.js';

// Dron de mantenimiento "de bloques" (estilo diorama): cuadricóptero blanco y naranja municipal
// con cuatro hélices que giran, piloto de color (azul volando, verde trabajando, ámbar pulsante
// cargando), mancha de sombra en el suelo, rayo y chispas de soldadura sobre el objetivo y, en
// la base, el cable y la barra de carga. La base fija (plataforma, poste y cartel) la hornea
// DespachoRenderer con los props. Medidas en metros; sin asignaciones por frame.

const WHITE = 0xe9ecef, ORANGE = 0xf08a24, DARK = 0x2a2d31, STEEL = 0x8d97a1, GLASS = 0x1d3f5c;
const LED_FLY = new THREE.Color(0.35, 0.75, 1.6);
const LED_WORK = new THREE.Color(0.3, 1.6, 0.45);
const LED_CHARGE = new THREE.Color(1.6, 0.75, 0.1);
const LED_FULL = new THREE.Color(0.3, 1.5, 0.4);
const BAR_LOW = new THREE.Color(0xe0a020), BAR_OK = new THREE.Color(0x4cd36a);
const ARM = 0.36;          // distancia del centro a cada motor
const SPIN = 55;           // rad/s de las hélices en vuelo
const SPIN_IDLE = 0;       // aparcado, quietas
const TILT = 0.09;         // inclinación por m/s
const SCALE = 1.35;        // un poco exagerado para que se lea desde la cámara (como las orejas de Luigi)
/** Altura del cuerpo sobre los patines (el origen del dron son los patines). */
const BODY_Y = 0.12;

/** Pulso del piloto de carga (función pura): 0–1 a `hz` ciclos por segundo. */
export function chargePulse(time, hz) {
  return 0.5 + 0.5 * Math.sin(time * Math.PI * 2 * hz);
}

export class DroneRenderer {
  constructor(game, parent) {
    this.game = game;
    const D = game.despacho.drone;
    this.cfg = D.cfg;
    this.geos = [];
    this.mats = [];
    this._spin = 0;
    this._lastT = 0;
    this._from = new THREE.Vector3();
    this._to = new THREE.Vector3();

    this.root = new THREE.Group();
    this.root.name = 'dron';
    this.root.visible = false;
    this.root.scale.setScalar(SCALE);
    parent.add(this.root);
    this.tilt = new THREE.Group();
    this.root.add(this.tilt);
    this.body = new THREE.Group();
    this.tilt.add(this.body);

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
    this.mats.push(mat);
    const geoOf = (b) => { const g = b.toGeometry('solid'); this.geos.push(g); return g; };

    // Cuerpo: chasis, cúpula, brazos en aspa, motores, patines y cámara con boquilla de soldar.
    const b = new PropBuilder();
    b.root(0, 0, 0);
    for (const s of [-1, 1]) {
      b.box(s * 0.16, 0, 0, 0.04, 0.03, 0.5, DARK, { ao: 0 });               // patín
      for (const z of [-0.14, 0.14]) b.box(s * 0.13, 0.02, z, 0.025, BODY_Y - 0.02, 0.025, DARK, { ao: 0, rz: s * 0.35 });
    }
    b.box(0, BODY_Y, 0, 0.34, 0.12, 0.42, WHITE, { ao: 0.15 });                // chasis
    b.box(0, BODY_Y + 0.04, 0, 0.35, 0.04, 0.43, ORANGE, { ao: 0 });            // franja municipal
    b.box(0, BODY_Y + 0.12, -0.02, 0.24, 0.07, 0.28, WHITE, { ao: 0.1 });       // cúpula
    b.box(0, BODY_Y + 0.13, 0.13, 0.16, 0.04, 0.03, GLASS, { ao: 0 });          // visor
    b.box(0, BODY_Y + 0.19, -0.05, 0.03, 0.08, 0.03, DARK, { ao: 0 });          // antena
    b.box(0, BODY_Y - 0.06, 0.12, 0.08, 0.06, 0.08, DARK, { ao: 0 });           // cámara
    b.box(0, BODY_Y - 0.1, 0.12, 0.025, 0.05, 0.025, STEEL, { ao: 0 });         // boquilla
    for (const a of [45, 135, 225, 315]) {
      const r = (a * Math.PI) / 180;
      const mx = Math.sin(r) * ARM, mz = Math.cos(r) * ARM;
      b.box(mx / 2, BODY_Y + 0.05, mz / 2, 0.045, 0.035, ARM, DARK, { ry: r, ao: 0 });  // brazo
      b.cyl(mx, BODY_Y + 0.02, mz, 0.05, 0.055, 0.09, STEEL, 8, { ao: 0.1 });            // motor
      b.cyl(mx, BODY_Y + 0.11, mz, 0.015, 0.015, 0.03, DARK, 6, { ao: 0 });              // eje
    }
    const bodyMesh = new THREE.Mesh(geoOf(b), mat);
    bodyMesh.castShadow = true;
    this.body.add(bodyMesh);

    // Hélices: dos palas cruzadas por motor (geometría compartida) y un disco translúcido que
    // sugiere el giro rápido.
    const pb = new PropBuilder();
    pb.root(0, 0, 0);
    pb.box(0, 0, 0, 0.34, 0.012, 0.045, DARK, { ao: 0 });
    pb.box(0, 0, 0, 0.045, 0.012, 0.34, DARK, { ao: 0 });
    const bladeGeo = geoOf(pb);
    const discGeo = new THREE.CircleGeometry(0.19, 16);
    discGeo.rotateX(-Math.PI / 2);
    this.geos.push(discGeo);
    this.discMat = new THREE.MeshBasicMaterial({ color: 0xdfe6ee, transparent: true, opacity: 0.22, depthWrite: false });
    this.mats.push(this.discMat);
    this.rotors = [];
    this.discs = [];
    for (const a of [45, 135, 225, 315]) {
      const r = (a * Math.PI) / 180;
      const rotor = new THREE.Mesh(bladeGeo, mat);
      rotor.position.set(Math.sin(r) * ARM, BODY_Y + 0.14, Math.cos(r) * ARM);
      rotor.castShadow = true;
      this.body.add(rotor);
      this.rotors.push(rotor);
      const disc = new THREE.Mesh(discGeo, this.discMat);
      disc.position.copy(rotor.position);
      disc.position.y += 0.008;
      this.body.add(disc);
      this.discs.push(disc);
    }

    // Piloto de color (arriba, detrás de la antena) y luz de trabajo bajo la cámara.
    const ledGeo = new THREE.BoxGeometry(0.06, 0.04, 0.06);
    this.geos.push(ledGeo);
    this.ledMat = new THREE.MeshBasicMaterial({ color: LED_FLY.clone() });
    this.mats.push(this.ledMat);
    this.led = new THREE.Mesh(ledGeo, this.ledMat);
    this.led.position.set(0, BODY_Y + 0.19, -0.12);
    this.body.add(this.led);

    // Sombra en el suelo (mancha que se encoge al bajar y se difumina al subir).
    const shadowGeo = new THREE.CircleGeometry(0.42, 20);
    shadowGeo.rotateX(-Math.PI / 2);
    this.geos.push(shadowGeo);
    this.shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false });
    this.mats.push(this.shadowMat);
    this.shadow = new THREE.Mesh(shadowGeo, this.shadowMat);
    this.shadow.renderOrder = 1;
    parent.add(this.shadow);

    // En la base: cable al dron aparcado, piloto del poste y barra de carga.
    const { base } = this.cfg;
    const dsp = game.despacho;
    const bx = dsp.wx(base.x), bz = dsp.wz(base.z);
    const px = dsp.wx(base.postX), pz = dsp.wz(base.postZ);
    this.dock = new THREE.Group();
    this.dock.visible = false;
    parent.add(this.dock);
    const cb = new PropBuilder();
    // Cable: del poste al borde de la plataforma y subida hasta el dron.
    const ex = bx + 0.3, ez = bz - 0.12; // lado del poste
    const len = Math.hypot(ex - px, ez - pz);
    cb.root(px, 0, pz, Math.atan2(ex - px, ez - pz));
    cb.box(0, 0.62, 0.12, 0.04, 0.04, 0.2, DARK, { ao: 0 });
    cb.box(0, 0.06, 0.22, 0.035, 0.6, 0.035, DARK, { ao: 0 });
    cb.box(0, 0.06, len / 2 + 0.1, 0.035, 0.03, len - 0.2, DARK, { ao: 0 });
    cb.root(ex, 0, ez);
    const plugY = this.cfg.parkY + (BODY_Y + 0.02) * SCALE;
    cb.box(0, 0.06, 0, 0.035, plugY - 0.06, 0.035, DARK, { ao: 0 });
    cb.box(-0.06, plugY, 0, 0.14, 0.035, 0.035, DARK, { ao: 0 });
    const cable = new THREE.Mesh(geoOf(cb), mat);
    cable.castShadow = true;
    this.dock.add(cable);
    // Barra de carga en la cara sur del poste (el marco está horneado con la base).
    const barGeo = new THREE.BoxGeometry(0.12, 1, 0.02);
    barGeo.translate(0, 0.5, 0);
    this.geos.push(barGeo);
    this.barMat = new THREE.MeshBasicMaterial({ color: BAR_OK.clone() });
    this.mats.push(this.barMat);
    this.bar = new THREE.Mesh(barGeo, this.barMat);
    this.bar.position.set(px, 0.33, pz + 0.147);
    this.barH = 0.64;
    this.dock.add(this.bar);
    this.postLedMat = new THREE.MeshBasicMaterial({ color: LED_CHARGE.clone() });
    this.mats.push(this.postLedMat);
    this.postLed = new THREE.Mesh(ledGeo, this.postLedMat);
    this.postLed.position.set(px, 1.1, pz + 0.135);
    this.dock.add(this.postLed);

    // Rayo de trabajo (del dron al objetivo, parpadea) y chispas de soldadura en cada paso que
    // marca la lógica ('drone:weld').
    const beamGeo = new THREE.BoxGeometry(0.05, 0.05, 1);
    beamGeo.translate(0, 0, 0.5);
    this.geos.push(beamGeo);
    this.beamMat = new THREE.MeshBasicMaterial({
      color: parseInt(this.cfg.beamColor.slice(1), 16), transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.mats.push(this.beamMat);
    this.beam = new THREE.Mesh(beamGeo, this.beamMat);
    this.beam.visible = false;
    parent.add(this.beam);
    this._sparkColor = parseInt(this.cfg.sparkColor.slice(1), 16);
    this._unsub = game.bus.on('drone:weld', (d) => this.weld(d));
  }

  /** Punto del objetivo donde apunta el rayo (en `out`). */
  aimPoint(s, out) {
    const h = Math.max(0.3, (s.def?.height ?? 1.4) * 0.75);
    return out.set(s.cx ?? s.x, h, s.cz ?? s.z);
  }

  /** Chispas de soldadura sobre el objetivo. */
  weld(d) {
    const fx = this.game.effects;
    if (!fx?.sparkBurst || !d.target) return;
    const p = this.aimPoint(d.target, this._to);
    fx.sparkBurst(p.x + (Math.random() - 0.5) * 0.3, p.y, p.z + (Math.random() - 0.5) * 0.3, 0, 0, 5, 2.2, 2.5, this._sparkColor, 0.35, 0.025, 1);
  }

  update() {
    const { game } = this;
    const D = game.despacho.drone;
    const on = D.active;
    this.root.visible = on;
    this.shadow.visible = on && !D.docked;
    this.beam.visible = on && D.working && !!D.target;
    this.dock.visible = on;
    const t = game.time;
    const dt = Math.min(0.1, Math.max(0, t - this._lastT));
    this._lastT = t;
    if (!on) return;

    const flying = !D.docked;
    const bob = flying ? Math.sin(t * 2.3) * 0.05 : 0;
    this.root.position.set(D.pos.x, D.pos.y + bob, D.pos.z);
    // Se inclina hacia donde avanza (ejes del mundo) y gira hacia el destino.
    this.tilt.rotation.set(D.vel.z * TILT, 0, -D.vel.x * TILT);
    this.body.rotation.y = D.yaw;

    this._spin += (flying ? SPIN : SPIN_IDLE) * dt;
    for (let n = 0; n < this.rotors.length; n++) this.rotors[n].rotation.y = this._spin * (n % 2 ? -1 : 1);
    for (const d of this.discs) d.visible = flying;

    // Piloto: azul volando, verde trabajando; aparcado, ámbar pulsante mientras carga.
    const P = chargePulse(t, 1.2);
    if (!flying) {
      const full = D.charge >= 1;
      this.ledMat.color.copy(full ? LED_FULL : LED_CHARGE).multiplyScalar(full ? 1 : 0.35 + 0.65 * P);
    } else this.ledMat.color.copy(D.state === DRONE_STATE.WORK ? LED_WORK : LED_FLY);
    this.postLedMat.color.copy(this.ledMat.color);
    if (flying) this.postLedMat.color.multiplyScalar(0.25);

    // Barra de carga.
    this.bar.scale.y = Math.max(0.02, D.charge) * this.barH;
    this.barMat.color.copy(D.charge < 0.5 ? BAR_LOW : BAR_OK);
    if (!flying && D.charge < 1) this.barMat.color.multiplyScalar(0.7 + 0.3 * P);

    // Rayo: de la boquilla al objetivo, con parpadeo.
    if (this.beam.visible) {
      this._from.set(D.pos.x, D.pos.y + bob + (BODY_Y - 0.1) * SCALE, D.pos.z);
      const to = this.aimPoint(D.target, this._to);
      to.x += Math.sin(t * 13) * 0.12;
      to.z += Math.cos(t * 11) * 0.12;
      this.beam.position.copy(this._from);
      this.beam.lookAt(to);
      this.beam.scale.set(1, 1, this._from.distanceTo(to));
      this.beamMat.opacity = 0.45 + 0.4 * Math.abs(Math.sin(t * 31));
    }

    // Sombra: justo debajo, más grande y suave cuanto más alto vuela.
    const k = Math.min(1, D.pos.y / this.cfg.flyY);
    this.shadow.position.set(D.pos.x, 0.03, D.pos.z);
    this.shadow.scale.setScalar(0.8 + 0.5 * k);
    this.shadowMat.opacity = 0.4 - 0.18 * k;
  }

  dispose() {
    this._unsub?.();
    this.root.parent?.remove(this.root);
    this.shadow.parent?.remove(this.shadow);
    this.beam.parent?.remove(this.beam);
    this.dock.parent?.remove(this.dock);
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
