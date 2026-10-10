import * as THREE from 'three';
import * as Models from './StructureModels.js';
import { withCutaway } from './Cutaway.js';
import { PropBuilder, rng } from './props/Builder.js';
import { TYPES } from './props/PropFactory.js';
import { bakeBuilder } from './PropRenderer.js';
import { UPGRADES } from '../systems/Despacho.js';

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
// Colores del estilo maqueta (como StructureModels / props).
const STEEL = 0x8d97a1, STEEL_D = 0x4f5862, IRON = 0x30353b, YEL = 0xf2c230, BLK = 0x2a2d31;
const CONC = 0xbab8ae, CONC_D = 0x9e9c93, SAND = 0xd9c7a0;
const LED_ON = new THREE.Color(1.6, 0.15, 0.1);

// Modelos visibles de las mejoras del despacho del comisario. Lo estático (jaula del
// transformador, mástil del radar, cámaras, balizas, botiquines, plataforma de la torreta…) se
// hornea con PropBuilder en las mallas por capa de los props (mismos materiales) y solo se
// rehace al cambiar las mejoras. Lo que se mueve o brilla va aparte: cabeza de la torreta,
// plato del radar, focos con sus cristales, pilotos de las cámaras y el generador.
export class DespachoRenderer {
  constructor(game) {
    this.game = game;
    const d = game.despacho;
    this.group = new THREE.Group();
    this.group.name = 'despacho';
    game.scene.add(this.group);
    this.staticGroup = new THREE.Group();
    this.group.add(this.staticGroup);
    this.staticGeos = [];
    this._version = -1;
    this.geos = [];

    this.material = withCutaway(new THREE.MeshStandardMaterial(Models.STRUCTURE_MATERIAL_OPTIONS));
    const mesh = (geo, mat = this.material) => {
      this.geos.push(geo);
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.visible = false;
      this.group.add(m);
      return m;
    };

    // Torreta del tejado: base y cabeza por nivel.
    const R = d.roofTurret;
    this.turretBases = [0, 1].map((l) => mesh(Models.structureGeometry('torreta', l)));
    this.turretHeads = [0, 1].map((l) => mesh(Models.turretHeadGeometry(l)));
    for (const m of this.turretBases) m.position.set(R.cx, R.baseY, R.cz);
    for (const m of this.turretHeads) m.position.set(R.cx, R.def.headHeight, R.cz);

    // Generador de emergencia junto al transformador.
    const G = UPGRADES.generador_emergencia;
    this.generator = mesh(Models.structureGeometry('generador', 0));
    this.generator.position.set(d.wx(G.x), 0, d.wz(G.z));
    this.generator.rotation.y = G.rotDeg * DEG;

    // Focos del patio: modelo de foco instanciado (4) y sus cristales, que brillan de noche.
    const F = UPGRADES.focos;
    const n = F.positions.length;
    const focoGeo = Models.structureGeometry('foco', 0);
    const lensGeo = Models.floodLensGeometry();
    this.geos.push(focoGeo, lensGeo);
    this.focos = new THREE.InstancedMesh(focoGeo, this.material, n);
    this.lensMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.lenses = new THREE.InstancedMesh(lensGeo, this.lensMaterial, n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s1 = new THREE.Vector3(1, 1, 1);
    const ax = d.wx(F.aimAt[0]), az = d.wz(F.aimAt[1]);
    F.positions.forEach(([x, z], k) => {
      const wx = d.wx(x), wz = d.wz(z);
      q.setFromAxisAngle(UP, Math.atan2(ax - wx, az - wz)); // un proyector mira al edificio
      m4.compose(p.set(wx, 0, wz), q, s1);
      this.focos.setMatrixAt(k, m4);
      this.lenses.setMatrixAt(k, m4);
    });
    for (const im of [this.focos, this.lenses]) {
      im.castShadow = im === this.focos;
      im.visible = false;
      this.group.add(im);
    }

    // Plato del radar (gira) sobre su mástil.
    const RD = UPGRADES.radar;
    const dish = new PropBuilder();
    dish.root(0, 0, 0);
    dish.box(0, 0, 0, 0.12, 0.1, 0.12, IRON);
    dish.box(0, 0.1, 0, 1.2, 0.08, 0.1, STEEL, { ao: 0.05 });               // brazo
    dish.box(0, 0.18, 0.02, 1.1, 0.34, 0.04, 0xdfe3e8, { rx: -0.35, ao: 0.1 }); // antena plana
    dish.box(0, 0.24, 0.12, 0.08, 0.08, 0.2, STEEL_D, { ao: 0 });
    dish.box(0.5, 0.18, -0.02, 0.06, 0.06, 0.06, 0xd24a3e, { ao: 0 });
    const dishGeo = dish.toGeometry('solid');
    this.dish = mesh(dishGeo);
    this.dish.position.set(d.wx(RD.x), RD.y + RD.mastH, d.wz(RD.z));

    // Pilotos rojos de las cámaras (parpadean).
    const C = UPGRADES.camaras;
    this.ledMaterial = new THREE.MeshBasicMaterial({ color: LED_ON.clone() });
    const ledGeo = new THREE.SphereGeometry(0.03, 6, 4);
    this.geos.push(ledGeo);
    this.leds = new THREE.InstancedMesh(ledGeo, this.ledMaterial, C.mounts.length);
    C.mounts.forEach((mt, k) => {
      const a = mt.rot * DEG, [lx, ly, lz] = C.led;
      // Piloto en el frontal de la cámara (local x, y, z girado `rot` grados).
      p.set(d.wx(mt.x) + lx * Math.cos(a) + lz * Math.sin(a), C.y + ly, d.wz(mt.z) - lx * Math.sin(a) + lz * Math.cos(a));
      m4.compose(p, q.identity(), s1);
      this.leds.setMatrixAt(k, m4);
    });
    this.leds.visible = false;
    this.group.add(this.leds);
  }

  /** Rehace la parte estática (solo cuando cambian las mejoras). */
  rebuildStatic() {
    const { game } = this;
    const d = game.despacho;
    for (const g of this.staticGeos) g.dispose();
    this.staticGeos.length = 0;
    this.staticGroup.clear();
    const b = new PropBuilder();
    const place = (type, x, z, rot, p) => {
      b.root(d.wx(x), 0, d.wz(z), rot * DEG);
      const seed = (x * 73856093) ^ (z * 19349663);
      TYPES[type].build(b, { type, lw: 1, ld: 1, rot, seed, rnd: rng(seed), p });
    };
    let any = false;

    const tl = d.level('transformador');
    if (tl) { any = true; this.transformerCage(b, tl); }

    if (d.has('generador_emergencia')) {
      // Cable del generador al transformador.
      const G = UPGRADES.generador_emergencia;
      const t = game.build.transformer;
      if (t) {
        const gx = d.wx(G.x), gz = d.wz(G.z);
        const len = Math.hypot(t.x - gx, t.z - gz);
        b.root(gx, 0, gz, Math.atan2(t.x - gx, t.z - gz));
        b.box(0, 0.005, len / 2, 0.05, 0.03, len, BLK, { ao: 0 });
        any = true;
      }
    }

    if (d.has('radar')) {
      const RD = UPGRADES.radar;
      b.root(d.wx(RD.x), RD.y, d.wz(RD.z), 0);
      b.box(0, 0, 0, 0.5, 0.25, 0.5, STEEL_D);
      b.cyl(0, 0.25, 0, 0.06, 0.08, RD.mastH - 0.25, STEEL, 8);
      for (const a of [0, 120, 240]) b.box(0, 0.2, 0, 0.03, 0.03, 0.9, IRON, { ry: a * DEG, rx: 0.6, ao: 0 });
      b.box(0.12, 0.25, 0.26, 0.1, 0.1, 0.02, 0x59f08a, { layer: 'glow', ao: 0 });
      any = true;
    }

    if (d.has('camaras')) {
      const C = UPGRADES.camaras;
      for (const mt of C.mounts) place('camara_seguridad', mt.x, mt.z, mt.rot, { y: C.y });
      any = true;
    }

    if (d.has('torreta_tejado')) {
      // Plataforma de hormigón con sacos sobre los muros de la entrada sur.
      const T = UPGRADES.torreta_tejado, P = T.platform;
      b.root(d.wx(T.x), T.roofY - P.h, d.wz(T.z), 0);
      b.box(0, 0, 0, P.w, P.h, P.d, CONC);
      b.box(0, -0.05, 0, P.w - 0.1, 0.05, P.d - 0.1, CONC_D, { ao: 0 });
      for (const sx of [-1, 1]) {
        for (let k = 0; k < 2; k++) b.box(sx * (P.w / 2 - 0.35 - k * 0.42), P.h, P.d / 2 - 0.16, 0.4, 0.2, 0.26, SAND, { ao: 0.2 });
      }
      for (let k = 0; k < 6; k++) b.box(-P.w / 2 + 0.27 + k * 0.53, P.h - 0.002, P.d / 2 + 0.003, 0.26, 0.05, 0.01, k % 2 ? BLK : YEL, { ao: 0 });
      any = true;
    }

    if (d.has('alarma')) {
      const A = UPGRADES.alarma;
      const r = A.beaconSize;
      for (const [x, z] of A.beacons) {
        b.root(d.wx(x), A.beaconY, d.wz(z), 0);
        b.box(0, 0, 0, r * 1.4, 0.1, r * 1.4, IRON);
        b.cyl(0, 0.1, 0, r * 0.5, r * 0.55, r * 0.8, 0xd24a3e, 10, { layer: 'red', ao: 0 }); // parpadea con las sirenas
        b.sphere(0, 0.1 + r * 0.8, 0, r, r * 0.6, r, 0xff6a5a, 8, { layer: 'red', ao: 0 });
        b.box(0, 0.1 + r * 0.8, 0, r * 1.2, 0.03, 0.05, IRON, { ao: 0 });
      }
      any = true;
    }

    if (d.has('botiquines')) {
      for (const c of UPGRADES.botiquines.cabinets) {
        place('botiquin_pared', c.x, c.z, 0, { y: c.y });
        // Rótulo verde "24 h" encima del armario nuevo.
        b.root(d.wx(c.x), 0, d.wz(c.z), 0);
        b.box(0, c.y + 0.26, 0.01, 0.34, 0.1, 0.02, 0x2f7d55, { layer: 'glow', ao: 0 });
      }
      any = true;
    }

    if (any) {
      const baked = bakeBuilder(b, game.props.materials, this.staticGroup);
      this.staticGeos.push(...baked.geometries);
    }
  }

  /** Jaula metálica alrededor del transformador: postes y barandillas (I), barrotes (II), chapas y techo (III). */
  transformerCage(b, level) {
    const t = this.game.build.transformer;
    if (!t) return;
    const CG = UPGRADES.transformador.cage;
    const m = CG.margin, H = CG.height[level - 1];
    const x0 = t.box[0] - m, z0 = t.box[1] - m, x1 = t.box[2] + m, z1 = t.box[3] + m;
    b.root(0, 0, 0, 0);
    const W = x1 - x0, D = z1 - z0;
    const sides = [
      [x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0],
    ];
    for (const [ax, az, bx, bz] of sides) {
      const len = Math.hypot(bx - ax, bz - az);
      const ry = Math.atan2(bx - ax, bz - az);
      const cx = (ax + bx) / 2, cz = (az + bz) / 2;
      // Barandillas inferior, media y superior.
      for (const y of [0.08, H / 2, H - 0.05]) b.box(cx, y, cz, 0.05, 0.05, len, STEEL_D, { ry, ao: 0 });
      const posts = Math.max(2, Math.round(len / CG.postEvery) + 1);
      for (let k = 0; k < posts; k++) {
        const f = k / (posts - 1);
        b.box(ax + (bx - ax) * f, 0, az + (bz - az) * f, 0.07, H, 0.07, IRON, { ao: 0.1 });
      }
      if (level >= 2) {
        const bars = Math.round(len / 0.16);
        for (let k = 1; k < bars; k++) {
          const f = k / bars;
          b.box(ax + (bx - ax) * f, 0.08, az + (bz - az) * f, 0.02, H - 0.13, 0.02, STEEL, { ao: 0 });
        }
      }
      if (level >= 3) {
        // Chapas de blindaje a media altura con franjas de aviso.
        b.box(cx, 0.1, cz, 0.04, H * 0.42, len - 0.1, 0x9aa4ae, { ry, ao: 0.1 });
        const n = Math.max(2, Math.round(len / 0.35));
        for (let k = 0; k < n; k++) {
          const f = (k + 0.5) / n;
          b.box(ax + (bx - ax) * f, 0.1 + H * 0.42, az + (bz - az) * f, 0.05, 0.06, len / n, k % 2 ? BLK : YEL, { ry, ao: 0 });
        }
      }
    }
    if (level >= 3) {
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      for (let k = 0; k <= 4; k++) b.box(x0 + (W * k) / 4, H - 0.05, cz, 0.04, 0.04, D, STEEL_D, { ao: 0 });
      for (let k = 0; k <= 2; k++) b.box(cx, H - 0.05, z0 + (D * k) / 2, W, 0.04, 0.04, STEEL_D, { ao: 0 });
    }
    // Cartel de peligro amarillo en la cara sur.
    b.box((x0 + x1) / 2, H * 0.55, z1 + 0.04, 0.34, 0.3, 0.02, YEL, { ao: 0 });
    b.box((x0 + x1) / 2, H * 0.55 + 0.08, z1 + 0.052, 0.1, 0.14, 0.01, BLK, { ao: 0 });
  }

  update() {
    const { game } = this;
    const d = game.despacho;
    if (d.version !== this._version) {
      this._version = d.version;
      this.rebuildStatic();
    }
    const tl = d.level('torreta_tejado');
    for (let l = 0; l < 2; l++) {
      const on = tl === l + 1;
      this.turretBases[l].visible = on;
      this.turretHeads[l].visible = on;
      if (on) this.turretHeads[l].rotation.y = d.roofTurret.yaw;
    }
    this.generator.visible = d.has('generador_emergencia');
    const focos = d.has('focos');
    this.focos.visible = this.lenses.visible = focos;
    if (focos) this.lensMaterial.color.copy(game.structureRenderer.lensMaterial.color);
    this.dish.visible = d.has('radar');
    if (this.dish.visible) this.dish.rotation.y = game.time * UPGRADES.radar.spin;
    this.leds.visible = d.has('camaras') && Math.sin(game.time * Math.PI * 2 * UPGRADES.camaras.blinkHz) > 0;
  }

  dispose() {
    this.game.scene.remove(this.group);
    for (const g of [...this.geos, ...this.staticGeos]) g.dispose();
    this.material.dispose();
    this.lensMaterial.dispose();
    this.ledMaterial.dispose();
  }
}
