import * as THREE from 'three';
import { spriteUV, spriteAspect } from './Atlas.js';

// Constructor de geometría para props: acumula primitivas (cajas, cilindros, esferas, quads de
// sprite) ya transformadas a coordenadas de mundo y con color por vértice, en "capas" que luego
// se fusionan en una malla por capa:
//   solid  → MeshStandardMaterial con vertexColors (casi todo)
//   glow   → emisivo sin iluminación (lámparas, faros, luces de estado)
//   red / blue → luces de sirena (se pueden hacer parpadear por separado)
//   glass  → cristal translúcido
//   sign   → rótulos con textura de atlas (iluminados)
//   screen → pantallas con textura de atlas (emisivas)

export const COLOR_LAYERS = ['solid', 'glow', 'red', 'blue', 'glass'];
export const UV_LAYERS = ['sign', 'screen'];

const mk = (g) => ({ pos: g.attributes.position.array, nor: g.attributes.normal.array });
const BOX = mk(new THREE.BoxGeometry(1, 1, 1).toNonIndexed());
const cylTemplates = new Map();
const cylTemplate = (seg) => {
  if (!cylTemplates.has(seg)) cylTemplates.set(seg, mk(new THREE.CylinderGeometry(0.5, 0.5, 1, seg, 1).toNonIndexed()));
  return cylTemplates.get(seg);
};
const sphereTemplates = new Map();
const sphereTemplate = (seg) => {
  if (!sphereTemplates.has(seg)) sphereTemplates.set(seg, mk(new THREE.SphereGeometry(0.5, seg, Math.max(4, seg - 3)).toNonIndexed()));
  return sphereTemplates.get(seg);
};

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _T = new THREE.Matrix4();
const _R = new THREE.Matrix4();
const _E = new THREE.Euler();
const _rt = new THREE.Matrix4();
const _col = new THREE.Color();
const colorCache = new Map();
function rgb(c) {
  if (Array.isArray(c)) return c; // color lineal ya calculado
  let v = colorCache.get(c);
  if (!v) { _col.set(c); v = [_col.r, _col.g, _col.b]; colorCache.set(c, v); }
  return v;
}

/** Generador pseudoaleatorio determinista (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class PropBuilder {
  constructor() {
    this.layers = {};
    for (const n of COLOR_LAYERS) this.layers[n] = { pos: [], nor: [], col: [] };
    for (const n of UV_LAYERS) this.layers[n] = { pos: [], nor: [], uv: [] };
    this.mat = new THREE.Matrix4();
    this.stack = [];
    this.lights = [];     // { type, x, y, z, color }
    this.interacts = [];  // { type, label, x, z }
    this.resetBounds();
  }

  resetBounds() {
    this.bounds = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
  }

  /** Fija la transformación raíz (mundo) antes de construir un prop. */
  root(x, y, z, ry = 0) {
    this.stack.length = 0;
    this.mat.makeTranslation(x, y, z);
    if (ry) this.mat.multiply(_R.makeRotationY(ry));
  }
  push(x = 0, y = 0, z = 0, ry = 0) {
    this.stack.push(this.mat.clone());
    this.mat.multiply(_T.makeTranslation(x, y, z));
    if (ry) this.mat.multiply(_R.makeRotationY(ry));
  }
  pop() { this.mat = this.stack.pop(); }

  _rt(x, y, z, o) {
    _rt.copy(this.mat).multiply(_T.makeTranslation(x, y, z));
    if (o && (o.rx || o.ry || o.rz)) _rt.multiply(_R.makeRotationFromEuler(_E.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ')));
    return _rt;
  }

  _vert(L, rt, px, py, pz, nx, ny, nz, c, m) {
    _v.set(px, py, pz).applyMatrix4(rt);
    L.pos.push(_v.x, _v.y, _v.z);
    _n.set(nx, ny, nz).transformDirection(rt);
    L.nor.push(_n.x, _n.y, _n.z);
    if (c) L.col.push(c[0] * m, c[1] * m, c[2] * m);
    const b = this.bounds;
    if (_v.x < b.minX) b.minX = _v.x; if (_v.x > b.maxX) b.maxX = _v.x;
    if (_v.y < b.minY) b.minY = _v.y; if (_v.y > b.maxY) b.maxY = _v.y;
    if (_v.z < b.minZ) b.minZ = _v.z; if (_v.z > b.maxZ) b.maxZ = _v.z;
  }

  /**
   * Caja. (x, y, z) = centro de la base; w/h/d = tamaño en X/Y/Z.
   * o: { layer, ao, rx, ry, rz (rotación sobre la base), ox, oy, oz (desplazamiento previo a rotar) }
   */
  box(x, y, z, w, h, d, color, o = {}) {
    const L = this.layers[o.layer || 'solid'];
    const rt = this._rt(x, y, z, o);
    const c = rgb(color);
    const ao = o.ao ?? 0.16;
    const ox = o.ox || 0, oy = (o.oy || 0) + h / 2, oz = o.oz || 0;
    const P = BOX.pos, N = BOX.nor;
    for (let k = 0; k < P.length; k += 3) {
      this._vert(L, rt, P[k] * w + ox, P[k + 1] * h + oy, P[k + 2] * d + oz, N[k], N[k + 1], N[k + 2], c, 1 - ao * (0.5 - P[k + 1]));
    }
  }

  /** Cilindro/cono (eje Y). (x, y, z) = centro de la base. */
  cyl(x, y, z, rTop, rBot, h, color, seg = 10, o = {}) {
    const L = this.layers[o.layer || 'solid'];
    const rt = this._rt(x, y, z, o);
    const c = rgb(color);
    const ao = o.ao ?? 0.12;
    const t = cylTemplate(seg);
    const slope = (rBot - rTop) / h;
    const ox = o.ox || 0, oy = (o.oy || 0) + h / 2, oz = o.oz || 0;
    const P = t.pos, N = t.nor;
    for (let k = 0; k < P.length; k += 3) {
      const r = (P[k + 1] > 0 ? rTop : rBot) * 2;
      let nx = N[k], ny = N[k + 1], nz = N[k + 2];
      if (Math.abs(ny) < 0.5) { ny = slope; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l; }
      this._vert(L, rt, P[k] * r + ox, P[k + 1] * h + oy, P[k + 2] * r + oz, nx, ny, nz, c, 1 - ao * (0.5 - P[k + 1]));
    }
  }

  /** Esfera (o elipsoide). (x, y, z) = centro de la base; d = diámetro (dx, dy, dz). */
  sphere(x, y, z, dx, dy, dz, color, seg = 8, o = {}) {
    const L = this.layers[o.layer || 'solid'];
    const rt = this._rt(x, y, z, o);
    const c = rgb(color);
    const ao = o.ao ?? 0.18;
    const t = sphereTemplate(seg);
    const P = t.pos, N = t.nor;
    for (let k = 0; k < P.length; k += 3) {
      this._vert(L, rt, P[k] * dx + (o.ox || 0), P[k + 1] * dy + dy / 2 + (o.oy || 0), P[k + 2] * dz + (o.oz || 0), N[k], N[k + 1], N[k + 2], c, 1 - ao * (0.5 - P[k + 1]));
    }
  }

  /**
   * Quad con un sprite del atlas, centrado en (cx, cy, cz) y mirando a +Z local.
   * o: { screen (capa emisiva), flipX, rx, ry, rz }
   */
  sprite(name, cx, cy, cz, w, h, o = {}) {
    const L = this.layers[o.screen ? 'screen' : 'sign'];
    const rt = this._rt(cx, cy, cz, o);
    const [u0, v0, u1, v1] = spriteUV(name);
    const a = o.flipX ? u1 : u0, bU = o.flipX ? u0 : u1;
    const hw = w / 2, hh = h / 2;
    const quad = [[-hw, -hh, a, v0], [hw, -hh, bU, v0], [hw, hh, bU, v1], [-hw, hh, a, v1]];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const q = quad[i];
      this._vert(L, rt, q[0], q[1], 0, 0, 0, 1, null, 1);
      L.uv.push(q[2], q[3]);
    }
  }

  /** Igual que sprite() pero fijando el ancho y calculando el alto por la proporción del sprite. */
  spriteW(name, cx, cy, cz, w, o = {}) { this.sprite(name, cx, cy, cz, w, w / spriteAspect(name), o); return w / spriteAspect(name); }
  spriteH(name, cx, cy, cz, h, o = {}) { this.sprite(name, cx, cy, cz, h * spriteAspect(name), h, o); return h * spriteAspect(name); }

  /** Bandera ondulada: el sprite dividido en tiras con desplazamiento en Z. Arranca en (x, y, z) hacia +X. */
  flag(name, x, y, z, w, h, amp = 0.08, segs = 8, o = {}) {
    const L = this.layers.sign;
    const rt = this._rt(x, y, z, o);
    const [u0, v0, u1, v1] = spriteUV(name);
    for (let s = 0; s < segs; s++) {
      const t0 = s / segs, t1 = (s + 1) / segs;
      const z0 = Math.sin(t0 * 6) * amp * t0, z1 = Math.sin(t1 * 6) * amp * t1;
      const xa = t0 * w, xb = t1 * w;
      const ua = u0 + (u1 - u0) * t0, ub = u0 + (u1 - u0) * t1;
      const quad = [[xa, 0, z0, ua, v0], [xb, 0, z1, ub, v0], [xb, h, z1, ub, v1], [xa, h, z0, ua, v1]];
      for (const i of [0, 1, 2, 0, 2, 3]) {
        const q = quad[i];
        this._vert(L, rt, q[0], q[1], q[2], 0, 0, 1, null, 1);
        L.uv.push(q[3], q[4]);
      }
    }
  }

  /** Registra una luz para el sistema de iluminación nocturna (posición en mundo). */
  light(type, x, y, z, color) {
    _v.set(x, y, z).applyMatrix4(this.mat);
    this.lights.push({ type, x: _v.x, y: _v.y, z: _v.z, color });
  }

  /** Registra un punto de interacción (posición del jugador en mundo, delante del objeto). */
  interact(type, label, x, z) {
    _v.set(x, 0, z).applyMatrix4(this.mat);
    this.interacts.push({ type, label, x: _v.x, z: _v.z });
  }

  /** Convierte una capa en BufferGeometry no indexada (o null si está vacía). */
  toGeometry(layerName) {
    const L = this.layers[layerName];
    if (!L.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(L.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(L.nor, 3));
    if (L.col) g.setAttribute('color', new THREE.Float32BufferAttribute(L.col, 3));
    if (L.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(L.uv, 2));
    return g;
  }
}
