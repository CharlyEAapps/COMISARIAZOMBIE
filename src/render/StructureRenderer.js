import * as THREE from 'three';
import * as Models from './StructureModels.js';
import { withCutaway } from './Cutaway.js';
import { PIECE_ORDER } from '../systems/BuildSystem.js';
import { JOIN_TYPES, JOIN_SHAPES, JOIN_BITS, joinShape, structureJoinGeometry } from './StructureModels.js';

const MAX_PER_KIND = 256;
const MAX_PREVIEW = 8; // celdas de la vista previa (huecos de puerta anchos)
const WHITE = new THREE.Color(1, 1, 1);
const EMPTY = [];
const IDENTITY_Q = new THREE.Quaternion();
const DAMAGED = new THREE.Color(0.5, 0.47, 0.45);
const FLASH = new THREE.Color(1.8, 1.6, 1.5);
const POWERED = new THREE.Color(0.85, 0.95, 1.25);
const LENS_OFF = new THREE.Color(0.35, 0.33, 0.3);
const LENS_ON = new THREE.Color(2.2, 2.1, 1.9);
// Despacho del comisario: tono acerado de los muros reforzados (niveles I y II) y de las persianas.
const REINFORCED = [new THREE.Color(0.86, 0.93, 1.08), new THREE.Color(0.74, 0.86, 1.15)];
const SHUTTER = new THREE.Color(0.72, 0.78, 0.9);
/** Piezas lineales (corren a lo largo de X) que se giran 90° en una columna (para el fantasma). */
const LINEAR = new Set(['valla', 'alambre']);
/** Piezas que se unen con sus vecinas (poste compartido y tramos hacia cada vecino). */
const JOINS = new Set(JOIN_TYPES);
/** Con qué se une cada tipo (además de muros, vallas, rejas y puertas). */
const JOIN_WITH = {
  barricada: new Set(['barricada', 'sacos', 'valla']),
  sacos: new Set(['barricada', 'sacos', 'valla']),
  valla: new Set(['barricada', 'sacos', 'valla']),
  alambre: new Set(['alambre']),
};
const DIRS = [[1, 0, JOIN_BITS.E], [0, 1, JOIN_BITS.S], [-1, 0, JOIN_BITS.W], [0, -1, JOIN_BITS.N]];
const bitCount = (m) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
const opposite = (m) => ((m << 2) | (m >> 2)) & 15;

/**
 * Máscara de unión de una pieza (E=1, S=2, W=4, N=8) a partir de sus vecinos: `link` = piezas con
 * las que se une; `wall` = muros, vallas del mapa, rejas o puertas. Con dos o más piezas vecinas
 * solo cuentan ellas (una fila pegada a un muro no le clava brazos); con una, el muro de enfrente
 * prolonga la fila; suelta, se apoya en los muros del eje que más tenga (como un tapón de puerta).
 */
export function joinMask(link, wall) {
  const n = bitCount(link);
  if (n >= 2) return link;
  if (n === 1) return link | (wall & opposite(link));
  const wx = wall & (JOIN_BITS.E | JOIN_BITS.W), wz = wall & (JOIN_BITS.S | JOIN_BITS.N);
  return bitCount(wz) > bitCount(wx) ? wz : wx;
}

// Dibuja las construcciones del jugador con un InstancedMesh por (tipo, nivel), la vista
// previa de colocación (fantasma verde/rojo), el anillo de alcance y el daño del transformador.
export class StructureRenderer {
  constructor(game) {
    this.game = game;
    const scene = game.scene;
    const build = game.build;
    this.group = new THREE.Group();
    this.group.name = 'construcciones';
    scene.add(this.group);

    const matOpts = Models.STRUCTURE_MATERIAL_OPTIONS ?? { vertexColors: true, roughness: 0.8 };
    this.material = withCutaway(new THREE.MeshStandardMaterial(matOpts));
    this.meshes = {}; // tipo → [InstancedMesh por nivel]
    this.leafMeshes = [];    // hojas de puerta abiertas por nivel
    const instanced = (geo) => {
      const mesh = new THREE.InstancedMesh(geo, this.material, MAX_PER_KIND);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.setColorAt(0, WHITE);
      this.group.add(mesh);
      return mesh;
    };
    // Piezas que se unen: una malla por (tipo, nivel, forma de unión).
    this.joinMeshes = {};
    for (const type of JOIN_TYPES) {
      this.joinMeshes[type] = build.pieces[type].levels.map((_, level) => JOIN_SHAPES.map((shape) => instanced(structureJoinGeometry(type, level, shape))));
    }
    for (const type of PIECE_ORDER) {
      if (JOINS.has(type)) { this.meshes[type] = []; continue; }
      this.meshes[type] = build.pieces[type].levels.map((_, level) => {
        const mesh = new THREE.InstancedMesh(Models.structureGeometry(type, level), this.material, MAX_PER_KIND);
        mesh.count = 0;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        mesh.setColorAt(0, WHITE);
        this.group.add(mesh);
        return mesh;
      });
    }
    // Puertas abiertas: marco fijo + hoja girada.
    this.frameMeshes = build.pieces.puerta.levels.map((_, level) => {
      const mesh = new THREE.InstancedMesh(Models.doorFrameGeometry(level), this.material, MAX_PER_KIND);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      mesh.setColorAt(0, WHITE);
      this.group.add(mesh);
      return mesh;
    });
    build.pieces.puerta.levels.forEach((_, level) => {
      const mesh = new THREE.InstancedMesh(Models.doorLeafGeometry(level), this.material, MAX_PER_KIND);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      mesh.setColorAt(0, WHITE);
      this.group.add(mesh);
      this.leafMeshes.push(mesh);
    });

    // Cabezas giratorias de las torretas (una malla por nivel) y lentes de los focos.
    this.turretHeads = build.pieces.torreta.levels.map((_, level) => {
      const mesh = new THREE.InstancedMesh(Models.turretHeadGeometry(level), this.material, MAX_PER_KIND);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      mesh.setColorAt(0, WHITE);
      this.group.add(mesh);
      return mesh;
    });
    this.lensMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, color: LENS_OFF.clone() });
    this.lenses = new THREE.InstancedMesh(Models.floodLensGeometry(), this.lensMaterial, MAX_PER_KIND);
    this.lenses.count = 0;
    this.lenses.frustumCulled = false;
    this.group.add(this.lenses);
    this._orientVersion = -1;

    // Piloto de las minas (parpadea; rápido cuando la mecha está encendida).
    this.mineLights = new THREE.InstancedMesh(
      Models.mineLightGeometry ? Models.mineLightGeometry() : new THREE.SphereGeometry(0.035, 8, 6).translate(0, 0.12, 0),
      new THREE.MeshBasicMaterial({ color: 0xff2a2a }),
      MAX_PER_KIND,
    );
    this.mineLights.count = 0;
    this.mineLights.frustumCulled = false;
    this.group.add(this.mineLights);

    // Fantasma de colocación.
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x5cff7a, transparent: true, opacity: 0.45, depthWrite: false });
    this.ghostGeos = new Map();
    for (const type of PIECE_ORDER) {
      const g = Models.structureGhostGeometry ? Models.structureGhostGeometry(type) : Models.structureGeometry(type, 0);
      this.ghostGeos.set(type, g);
    }
    // Fantasma instanciado: una puerta ancha se previsualiza en todas las celdas del hueco.
    this.ghost = new THREE.InstancedMesh(this.ghostGeos.get(PIECE_ORDER[0]), this.ghostMat, MAX_PREVIEW);
    this.ghost.count = 0;
    this.ghost.frustumCulled = false;
    this.ghost.renderOrder = 3;
    this.group.add(this.ghost);
    this.ghostCenter = new THREE.Vector3();

    // Recuadro sobre una construcción existente (reparar / mejorar / vender), en todas sus celdas.
    this.highlight = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.04, 0.04, 1.04).translate(0, 0.02, 0),
      new THREE.MeshBasicMaterial({ color: 0xf4c94a, transparent: true, opacity: 0.55, depthWrite: false }),
      MAX_PREVIEW,
    );
    this.highlight.count = 0;
    this.highlight.frustumCulled = false;
    this.group.add(this.highlight);

    // Anillo de alcance de construcción alrededor del jugador.
    const R = build.cfg.buildRange;
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(R - 0.08, R, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xf4c94a, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.ring.position.y = 0.05;
    this.ring.visible = false;
    this.group.add(this.ring);

    // Radio de explosión de la mina (vista previa).
    const MR = build.pieces.mina.radius;
    this.mineRing = new THREE.Mesh(
      new THREE.RingGeometry(MR - 0.06, MR, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xff5a3a, transparent: true, opacity: 0.5, depthWrite: false }),
    );
    this.mineRing.visible = false;
    this.group.add(this.mineRing);

    // Daño del transformador (chispas/humo), si el modelo existe.
    const tr = build.transformer;
    if (tr && Models.transformerDamageGeometry) {
      this.trDamage = new THREE.Mesh(Models.transformerDamageGeometry(), withCutaway(new THREE.MeshStandardMaterial(matOpts)));
      this.trDamage.position.set(tr.x, 0, tr.z);
      this.trDamage.visible = false;
      this.group.add(this.trDamage);
    }

    this.allMeshes = [...Object.values(this.meshes).flat(), ...Object.values(this.joinMeshes).flat(2), ...this.leafMeshes, ...this.frameMeshes, ...this.turretHeads];
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._c = new THREE.Color();
    this._up = new THREE.Vector3(0, 1, 0);
    // Giro de la hoja sobre su bisagra (x = -0,5 en local). Las hojas "espejo" (bisagra al otro
    // lado, giradas 180°) giran en sentido contrario para que todas abran hacia el mismo lado (+Z local).
    const hinge = (angle) => new THREE.Matrix4().makeTranslation(-0.5, 0, 0)
      .multiply(new THREE.Matrix4().makeRotationY(angle))
      .multiply(new THREE.Matrix4().makeTranslation(0.5, 0, 0));
    this._hingeOpen = hinge(-Math.PI / 2);
    this._hingeOpenMirror = hinge(Math.PI / 2);
  }

  update() {
    const { game } = this;
    const { build, grid } = game;
    const { _m, _q, _p, _s, _c, _up } = this;
    for (const m of this.allMeshes) m.count = 0;
    this.mineLights.count = 0;
    this.lenses.count = 0;
    const t = game.time;
    if (build.version !== this._orientVersion) {
      this._orientVersion = build.version;
      for (const s of build.all) if (JOINS.has(s.type)) this.updateJoin(s);
    }
    const powered = build.powered;
    const wallsLevel = game.despacho?.level('muros') ?? 0;
    const reinforced = wallsLevel ? REINFORCED[Math.min(wallsLevel, REINFORCED.length) - 1] : null;
    this.lensMaterial.color.copy(LENS_OFF).lerp(LENS_ON, game.lighting?.focoGlow ?? 0);

    for (const s of build.all) {
      // Color: se oscurece con el daño; destello al recibir un golpe.
      _c.copy(WHITE).lerp(DAMAGED, s.def.kind === 'trampa' ? 0 : 1 - s.hp / s.maxHp);
      if (s.type === 'valla' && powered) _c.multiply(POWERED);
      if (s.auto && s.type === 'puerta') _c.multiply(SHUTTER);
      else if (reinforced && s.def.kind !== 'trampa') _c.multiply(reinforced);
      if (s.flash > 0) _c.lerp(FLASH, 0.6);
      const baseRot = s.type === 'puerta' && s.axis === 'z' ? Math.PI / 2 : (s.rot ?? 0);
      if (s.type === 'puerta' && s.cells.length > 1) {
        this.drawWideDoor(s, baseRot);
        continue;
      }
      for (let c = 0; c < s.cells.length; c++) {
        const k = s.cells[c];
        const x = grid.centerX(k % grid.w), z = grid.centerZ((k / grid.w) | 0);
        if (s.type === 'puerta' && s.open) {
          // Puerta abierta: marco fijo y hoja girada 90° sobre su bisagra (x = -0,5 en local):
          // T(celda) · Ry(orientación) · T(-0,5) · Ry(90°) · T(+0,5). Si la bisagra va al otro
          // lado (mitad final de una puerta doble, o muro al otro lado), se gira 180°.
          const mirror = this.hingeOnFarSide(s, c);
          const rotY = baseRot + (mirror ? Math.PI : 0);
          const mesh = this.leafMeshes[s.level];
          const frame = this.frameMeshes[s.level];
          if (mesh.count >= MAX_PER_KIND) continue;
          _q.setFromAxisAngle(_up, baseRot);
          _p.set(x, 0, z);
          _m.compose(_p, _q, _s);
          frame.setMatrixAt(frame.count, _m);
          frame.setColorAt(frame.count++, _c);
          _q.setFromAxisAngle(_up, rotY);
          _m.compose(_p, _q, _s).multiply(mirror ? this._hingeOpenMirror : this._hingeOpen);
          mesh.setMatrixAt(mesh.count, _m);
          mesh.setColorAt(mesh.count++, _c);
          continue;
        }
        const mesh = s.joinShape != null ? this.joinMeshes[s.type][s.level][s.joinShape] : this.meshes[s.type][s.level];
        if (mesh.count >= MAX_PER_KIND) continue;
        // Pequeño temblor al recibir un golpe.
        const shake = s.flash > 0 ? (Math.random() - 0.5) * 0.06 : 0;
        _q.setFromAxisAngle(_up, baseRot);
        _p.set(x + shake, 0, z + shake);
        _m.compose(_p, _q, _s);
        mesh.setMatrixAt(mesh.count, _m);
        mesh.setColorAt(mesh.count++, _c);

        if (s.type === 'torreta') {
          const head = this.turretHeads[s.level];
          _q.setFromAxisAngle(_up, s.yaw);
          _p.y = s.def.headHeight;
          _m.compose(_p, _q, _s);
          head.setMatrixAt(head.count, _m);
          head.setColorAt(head.count++, _c);
        } else if (s.type === 'foco') {
          this.lenses.setMatrixAt(this.lenses.count++, _m);
        }
        if (s.type === 'mina') {
          const blink = s.fuse > 0 ? Math.sin(t * 40) > 0 : Math.sin(t * 4 + s.id) > 0.6;
          _s.setScalar(blink ? 1 : 0.001);
          _m.compose(_p, _q, _s);
          _s.setScalar(1);
          this.mineLights.setMatrixAt(this.mineLights.count++, _m);
        }
      }
    }
    for (const m of this.allMeshes) {
      if (!m.count) continue;
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor.needsUpdate = true;
    }
    this.mineLights.instanceMatrix.needsUpdate = true;
    this.lenses.instanceMatrix.needsUpdate = true;

    // Modo construcción: fantasma, recuadro y anillo de alcance.
    const active = build.active;
    this.ring.visible = active;
    if (active) this.ring.position.set(game.player.position.x, 0.05, game.player.position.z);
    const k = build.hoverCell;
    const existing = build.structures.get(k);
    const cells = active && k >= 0 ? build.hoverCells : EMPTY;
    const n = Math.min(MAX_PREVIEW, cells.length);
    this.ghost.count = !existing ? n : 0;
    this.highlight.count = existing ? n : 0;
    this.ghostCenter.set(0, 0, 0);
    if (n) {
      const i = k % grid.w, j = (k / grid.w) | 0;
      const axis = build.selected === 'puerta' ? build.doorAxis(i, j) : 'x';
      const rot = LINEAR.has(build.selected) ? this.linearRotation(build.selected, i, j) : axis === 'z' ? Math.PI / 2 : 0;
      _q.setFromAxisAngle(_up, rot);
      if (!existing) {
        this.ghost.geometry = this.ghostGeos.get(build.selected);
        this.ghostMat.color.set(build.hoverReason ? 0xff4a3a : 0x5cff7a);
      }
      const target = existing ? this.highlight : this.ghost;
      for (let c = 0; c < n; c++) {
        const ck = cells[c];
        _p.set(grid.centerX(ck % grid.w), 0.01, grid.centerZ((ck / grid.w) | 0));
        this.ghostCenter.add(_p);
        _m.compose(_p, existing ? IDENTITY_Q : _q, _s);
        target.setMatrixAt(c, _m);
      }
      this.ghostCenter.divideScalar(n);
      target.instanceMatrix.needsUpdate = true;
    }

    // Transformador dañado.
    const tr = build.transformer;
    if (this.trDamage && tr) this.trDamage.visible = tr.hp < tr.maxHp * build.cfg.transformer.damagedThreshold;

    // Radio de la mina al colocarla.
    const showMine = this.ghost.count > 0 && build.selected === 'mina';
    this.mineRing.visible = showMine;
    if (showMine) this.mineRing.position.set(this.ghostCenter.x, 0.06, this.ghostCenter.z);
  }

  /**
   * Puerta de varias celdas: un único marco estirado a todo el hueco (jambas solo en los
   * extremos, sin barra central) y una hoja por celda que se juntan en el centro. Abiertas,
   * cada mitad gira hacia su extremo.
   */
  drawWideDoor(s, baseRot) {
    const { grid } = this.game;
    const { _m, _q, _p, _s, _c, _up } = this;
    const frame = this.frameMeshes[s.level];
    const leaves = this.leafMeshes[s.level];
    if (frame.count >= MAX_PER_KIND || leaves.count + s.cells.length > MAX_PER_KIND) return;
    _q.setFromAxisAngle(_up, baseRot);
    _p.set(s.cx, 0, s.cz);
    _s.set(s.cells.length, 1, 1);
    _m.compose(_p, _q, _s);
    _s.set(1, 1, 1);
    frame.setMatrixAt(frame.count, _m);
    frame.setColorAt(frame.count++, _c);
    for (let c = 0; c < s.cells.length; c++) {
      const k = s.cells[c];
      _p.set(grid.centerX(k % grid.w), 0, grid.centerZ((k / grid.w) | 0));
      const mirror = this.hingeOnFarSide(s, c);
      _q.setFromAxisAngle(_up, baseRot + (mirror ? Math.PI : 0));
      _m.compose(_p, _q, _s);
      if (s.open) _m.multiply(mirror ? this._hingeOpenMirror : this._hingeOpen);
      leaves.setMatrixAt(leaves.count, _m);
      leaves.setColorAt(leaves.count++, _c);
    }
  }

  /** Forma de unión (índice en JOIN_SHAPES) y giro de una pieza según sus vecinos. */
  updateJoin(s) {
    const { grid, build } = this.game;
    const with_ = JOIN_WITH[s.type];
    let link = 0, wall = 0;
    for (const [di, dj, bit] of DIRS) {
      const i = s.i + di, j = s.j + dj;
      if (!grid.inBounds(i, j)) continue;
      const k = grid.index(i, j);
      const o = build.structures.get(k);
      if (o) {
        if (with_.has(o.type)) link |= bit;
        else if (o.type === 'puerta') wall |= bit;
      } else if (grid.collisionInset[k] > 0 && !grid.isStaticWalkable(i, j)) wall |= bit;
    }
    const js = joinShape(joinMask(link, wall));
    s.joinShape = js.index;
    s.rot = js.rot;
  }

  /**
   * Giro de una valla o alambre en (i, j): en columna (vecinos del mismo tipo o muros arriba
   * y abajo, y nada a los lados) corre a lo largo de Z.
   */
  linearRotation(type, i, j) {
    const { grid, build } = this.game;
    const solid = (a, b) => {
      if (!grid.inBounds(a, b)) return false;
      const o = build.structures.get(grid.index(a, b));
      return o ? o.type === type : !grid.isStaticWalkable(a, b);
    };
    const sx = solid(i - 1, j) + solid(i + 1, j);
    const sz = solid(i, j - 1) + solid(i, j + 1);
    return sz > sx ? Math.PI / 2 : 0;
  }

  /**
   * ¿La bisagra de la hoja c va en el lado +X (o +Z) de su celda? En una puerta doble, la
   * mitad final abre hacia su extremo; en una sencilla, la bisagra va del lado del muro.
   */
  hingeOnFarSide(s, c) {
    if (s.cells.length > 1) return c >= s.cells.length / 2;
    const g = this.game.grid;
    const [di, dj] = s.axis === 'x' ? [1, 0] : [0, 1];
    const near = !g.isStaticWalkable(s.i - di, s.j - dj);
    const far = !g.isStaticWalkable(s.i + di, s.j + dj);
    return far && !near;
  }

  dispose() {
    this.game.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    for (const g of this.ghostGeos.values()) g.dispose();
    this.lensMaterial.dispose();
  }
}
