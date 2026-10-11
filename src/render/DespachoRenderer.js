import * as THREE from 'three';
import * as Models from './StructureModels.js';
import { withCutaway } from './Cutaway.js';
import { PropBuilder, rng } from './props/Builder.js';
import { TYPES, LEVEL_ROOMS } from './props/PropFactory.js';
import { ROOM_BY_ID } from '../systems/Station.js';
import { bakeBuilder } from './PropRenderer.js';
import { UPGRADES } from '../systems/Despacho.js';
import { LuigiRenderer } from './LuigiRenderer.js';

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
// Colores del estilo maqueta (como StructureModels / props).
const STEEL = 0x8d97a1, STEEL_D = 0x4f5862, IRON = 0x30353b, YEL = 0xf2c230, BLK = 0x2a2d31;
const CONC = 0xbab8ae, CONC_D = 0x9e9c93, SAND = 0xd9c7a0;
const LED_ON = new THREE.Color(1.6, 0.15, 0.1);
const BED = 0x9c2f3a, BED_D = 0x6e1f29, CUSHION = 0xe9dcc4, WOOD = 0x8a5a33, BONE = 0xf3ecd8;

// Letras de 3×5 "píxeles" (filas de arriba abajo) para la placa de la cama de Luigi.
const GLYPHS = {
  L: ['100', '100', '100', '100', '111'],
  U: ['101', '101', '101', '101', '111'],
  I: ['111', '010', '010', '010', '111'],
  G: ['111', '100', '101', '101', '111'],
};

// Lo que se ve de las reformas del despacho del jefe. Las SALAS (muebles, carteles con estrellas,
// fachada con el nivel global) las reconstruye PropRenderer.setRoomLevel cuando cambia su nivel;
// aquí se sincronizan y se dibuja lo de fuera y del tejado. Lo estático (jaula del
// transformador, mástil del radar, cámaras, balizas, persianas enrolladas, plataforma de la torreta…) se
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
    // Torretas ligeras de las torres de los accesos (nivel III): comparten geometría.
    this.gateBases = d.gateTurrets.map((t) => {
      const m = new THREE.Mesh(this.turretBases[0].geometry, this.material);
      m.castShadow = true; m.visible = false;
      m.position.set(t.cx, t.baseY, t.cz);
      this.group.add(m);
      return m;
    });
    this.gateHeads = d.gateTurrets.map((t) => {
      const m = new THREE.Mesh(this.turretHeads[0].geometry, this.material);
      m.castShadow = true; m.visible = false;
      m.position.set(t.cx, t.def.headHeight, t.cz);
      this.group.add(m);
      return m;
    });

    // Luigi, el chihuahua (mejora de la sala de descanso).
    this.luigi = new LuigiRenderer(game, this.group);

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
    const RD = UPGRADES.archivo;
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

    // Torres de vigilancia de los accesos de la valla (torre de vigilancia III).
    if (d.towersUp) {
      const GT = UPGRADES.torreta_tejado.gateTowers;
      for (const sp of GT.spots) {
        const x = sp.x + GT.size / 2, z = sp.z + GT.size / 2;
        b.root(d.wx(x), 0, d.wz(z), sp.rot * DEG);
        const seed = (sp.x * 73856093) ^ (sp.z * 19349663);
        TYPES.torre_vigilancia.build(b, { type: 'torre_vigilancia', lw: GT.size, ld: GT.size, rot: sp.rot, seed, rnd: rng(seed), p: {} });
      }
      any = true;
    }

    // Cama de Luigi en la sala de descanso (siempre: sin la mejora, la cama espera).
    this.dogBed(b);
    any = true;

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

    if (d.has('persianas')) {
      // Cajón de la persiana enrollada sobre cada acceso exterior (de noche baja sola).
      const P = UPGRADES.persianas.roll, g = game.grid;
      for (const cells of d.doorGroups) {
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (const k of cells) {
          const i = k % g.w, j = (k / g.w) | 0;
          x0 = Math.min(x0, i); x1 = Math.max(x1, i + 1); z0 = Math.min(z0, j); z1 = Math.max(z1, j + 1);
        }
        const alongX = x1 - x0 >= z1 - z0;
        const len = alongX ? x1 - x0 : z1 - z0;
        b.root(d.wx((x0 + x1) / 2), P.y, d.wz((z0 + z1) / 2), alongX ? 0 : Math.PI / 2);
        b.box(0, 0, 0, len + 0.1, P.h, P.d, STEEL_D, { ao: 0.1 });
        for (let k = 0; k < 4; k++) b.box(0, -0.03 - k * 0.035, 0, len, 0.03, 0.06, k % 2 ? STEEL : 0x6f7882, { ao: 0 });
        for (const s of [-1, 1]) b.box(s * (len / 2 + 0.02), -2.2 + P.h, 0, 0.06, 2.2, 0.1, IRON, { ao: 0 }); // guías
        b.box(0, P.h, 0, len + 0.12, 0.04, P.d + 0.04, YEL, { ao: 0 });
      }
      any = true;
    }

    if (d.has('archivo')) {
      const RD = UPGRADES.archivo;
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

    if (any) {
      const baked = bakeBuilder(b, game.props.materials, this.staticGroup);
      this.staticGeos.push(...baked.geometries);
    }
  }

  /** Cama de Luigi: cesta roja con cojín, hueso y una placa con su nombre en la pared. */
  dogBed(b) {
    const d = this.game.despacho;
    const B = UPGRADES.luigi.bed;
    const w = B.w, dd = B.d;
    b.root(d.wx(B.x), 0, d.wz(B.z + dd / 2), 0);
    b.box(0, 0, 0, w, 0.06, dd, BED_D, { ao: 0.2 });
    b.box(0, 0.06, 0, w - 0.16, 0.06, dd - 0.16, CUSHION, { ao: 0.25 });
    // Borde acolchado (más alto detrás).
    b.box(0, 0.06, -dd / 2 + 0.05, w, 0.16, 0.1, BED, { ao: 0.1 });
    b.box(0, 0.06, dd / 2 - 0.04, w, 0.08, 0.08, BED, { ao: 0.1 });
    for (const s of [-1, 1]) b.box(s * (w / 2 - 0.05), 0.06, 0, 0.1, 0.12, dd, BED, { ao: 0.1 });
    // Hueso de juguete.
    b.box(0.18, 0.12, 0.06, 0.16, 0.03, 0.035, BONE, { ry: 0.5, ao: 0 });
    for (const s of [-1, 1]) b.box(0.18 + s * 0.07 * Math.cos(0.5), 0.12, 0.06 - s * 0.07 * Math.sin(0.5), 0.05, 0.04, 0.06, BONE, { ry: 0.5, ao: 0 });
    // Placa de madera en la pared norte con "LUIGI" en letras de bloques.
    const name = 'LUIGI';
    const px = 0.03, gap = px, letterW = px * 3;
    const textW = name.length * letterW + (name.length - 1) * gap;
    const zWall = B.plateZ - (B.z + dd / 2); // cara interior del muro norte
    const y0 = B.plateY;
    b.box(0, y0 - 0.05, zWall, textW + 0.12, 0.25, 0.03, WOOD, { ao: 0.1 });
    let x = -textW / 2 + px / 2;
    for (const ch of name) {
      const rows = GLYPHS[ch];
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 3; c++) {
          if (rows[r][c] === '1') b.box(x + c * px, y0 + (4 - r) * px, zWall + 0.02, px, px, 0.012, CUSHION, { ao: 0 });
        }
      }
      x += letterW + gap;
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

  /** Pone cada sala y la fachada a su nivel (solo se reconstruye la que cambia) y pinta las rejas. */
  syncRooms() {
    const { game } = this;
    const d = game.despacho, props = game.props;
    const g = d.globalLevel;
    for (const id of LEVEL_ROOMS) props.setRoomLevel(id, d.roomLevel(id), g);
    props.setRoomLevel('fachada', g, g);
    const bars = ROOM_BY_ID.calabozos?.barColors;
    const mat = game.mapRenderer?.barMaterial;
    if (bars && mat) mat.color.set(bars[Math.min(d.roomLevel('calabozos'), bars.length - 1)]);
  }

  update() {
    const { game } = this;
    const d = game.despacho;
    if (d.version !== this._version) {
      this._version = d.version;
      this.rebuildStatic();
      this.syncRooms();
    }
    const tl = d.level('torreta_tejado');
    for (let l = 0; l < 2; l++) {
      const on = tl > 0 && d.roofTurret.level === l;
      this.turretBases[l].visible = on;
      this.turretHeads[l].visible = on;
      if (on) this.turretHeads[l].rotation.y = d.roofTurret.yaw;
    }
    for (let n = 0; n < this.gateHeads.length; n++) {
      this.gateBases[n].visible = this.gateHeads[n].visible = d.towersUp;
      if (d.towersUp) this.gateHeads[n].rotation.y = d.gateTurrets[n].yaw;
    }
    this.luigi.update();
    this.generator.visible = d.has('generador_emergencia');
    const focos = d.has('focos');
    this.focos.visible = this.lenses.visible = focos;
    if (focos) this.lensMaterial.color.copy(game.structureRenderer.lensMaterial.color);
    this.dish.visible = d.has('archivo');
    if (this.dish.visible) this.dish.rotation.y = game.time * UPGRADES.archivo.spin;
    this.leds.visible = d.has('camaras') && Math.sin(game.time * Math.PI * 2 * UPGRADES.camaras.blinkHz) > 0;
  }

  dispose() {
    this.luigi.dispose();
    this.game.scene.remove(this.group);
    for (const g of [...this.geos, ...this.staticGeos]) g.dispose();
    this.material.dispose();
    this.lensMaterial.dispose();
    this.ledMaterial.dispose();
  }
}
