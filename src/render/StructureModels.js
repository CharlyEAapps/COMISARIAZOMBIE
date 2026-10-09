import * as THREE from 'three';
import { PropBuilder, rng } from './props/Builder.js';
import build from '../data/build.json';

// Modelos por código de las piezas de construcción y trampas de la fase 3 (estilo maqueta).
//
// Convenciones:
//  - Geometría NO indexada con position, normal y color (color por vértice, LINEAL como en Builder).
//  - Coordenadas locales de la celda: centro en (0, 0, 0), base en y = 0, huella dentro de [-0,5, 0,5] en X y Z.
//  - La pieza "corre" a lo largo de X (la puerta tiene la hoja en el plano XY y el grosor en Z).
//  - Todo va en una sola geometría (una sola capa "solid"): un único material con
//    STRUCTURE_MATERIAL_OPTIONS vale para todas las piezas.
//  - Cada llamada construye una BufferGeometry nueva: el sistema de construcción debe cachearla por (tipo, nivel).

/**
 * Opciones del material para todas las piezas: `new THREE.MeshStandardMaterial(STRUCTURE_MATERIAL_OPTIONS)`.
 * (Si se quiere el recorte de oclusión, aplicar `withCutaway` igual que a los props.)
 */
export const STRUCTURE_MATERIAL_OPTIONS = Object.freeze({ vertexColors: true, roughness: 0.85, metalness: 0 });

// ---------------------------------------------------------------- utilidades

const _c = new THREE.Color();
const _lin = new Map();
/** Hex sRGB → [r, g, b] lineal (igual que hace PropBuilder). */
function lin(c) {
  if (Array.isArray(c)) return c;
  let v = _lin.get(c);
  if (!v) { _c.set(c); v = [_c.r, _c.g, _c.b]; _lin.set(c, v); }
  return v;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Triángulo con normal plana. `hint` (opcional) = dirección hacia fuera para corregir el sentido de giro. */
function tri(L, a, p, q, ca, cp, cq, hint) {
  const u = sub(p, a), v = sub(q, a);
  let nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0];
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-10) return;
  if (hint && nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) {
    [p, q] = [q, p]; [cp, cq] = [cq, cp];
    nx = -nx; ny = -ny; nz = -nz;
  }
  nx /= len; ny /= len; nz /= len;
  for (const [pt, col] of [[a, ca], [p, cp], [q, cq]]) {
    L.pos.push(pt[0], pt[1], pt[2]);
    L.nor.push(nx, ny, nz);
    L.col.push(col[0], col[1], col[2]);
  }
}

/** Sombreado de ambiente barato: más oscuro cerca del suelo, como las cajas de PropBuilder. */
const shade = (c, y, y0, y1, ao) => {
  const t = Math.min(1, Math.max(0, (y - y0) / ((y1 - y0) || 1)));
  const m = 1 - ao * (1 - t);
  return [c[0] * m, c[1] * m, c[2] * m];
};

/**
 * Prisma de polígono extruido (no necesita ser convexo). `pts` = [[u, v], …] en el plano indicado:
 *   'zy' → u = z, v = y, se extruye a lo largo de X (w0..w1)
 *   'xy' → u = x, v = y, se extruye a lo largo de Z
 *   'xz' → u = x, v = z, se extruye a lo largo de Y
 */
function extrude(b, pts, plane, w0, w1, color, o = {}) {
  const L = b.layers.solid;
  const ao = o.ao ?? 0.14;
  const map = plane === 'zy' ? (u, v, w) => [w, v, u] : plane === 'xy' ? (u, v, w) => [u, v, w] : (u, v, w) => [u, w, v];
  const axis = plane === 'zy' ? [1, 0, 0] : plane === 'xy' ? [0, 0, 1] : [0, 1, 0];
  const col = lin(color);
  const A = pts.map((p) => map(p[0], p[1], w0));
  const B = pts.map((p) => map(p[0], p[1], w1));
  let y0 = Infinity, y1 = -Infinity;
  for (const p of [...A, ...B]) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  if (o.y0 != null) y0 = o.y0;
  if (o.y1 != null) y1 = o.y1;
  const C = (p) => shade(col, p[1], y0, y1, ao);
  // tapas
  const tris = THREE.ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p[0], p[1])), []);
  for (const [i, j, k] of tris) {
    tri(L, A[i], A[j], A[k], C(A[i]), C(A[j]), C(A[k]), [-axis[0], -axis[1], -axis[2]]);
    tri(L, B[i], B[j], B[k], C(B[i]), C(B[j]), C(B[k]), axis);
  }
  // laterales: el sentido hacia fuera de cada arista sale del signo del área del polígono
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    area += p[0] * q[1] - q[0] * p[1];
  }
  const sgn = area >= 0 ? 1 : -1;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const du = pts[j][0] - pts[i][0], dv = pts[j][1] - pts[i][1];
    const out = map(dv * sgn, -du * sgn, 0);
    tri(L, A[i], A[j], B[j], C(A[i]), C(A[j]), C(B[j]), out);
    tri(L, A[i], B[j], B[i], C(A[i]), C(B[j]), C(B[i]), out);
  }
}

/** Pirámide/cono sin base (la base queda apoyada). Eje: 'y' (por defecto), '+z', '-z', '+x', '-x'. */
function cone(b, x, y, z, r, h, seg, cBase, cTip, o = {}) {
  const L = b.layers.solid;
  const cb = lin(cBase), ct = lin(cTip ?? cBase);
  const ax = o.axis || 'y';
  const lean = o.lean || [0, 0];
  let e1, e2, a;
  if (ax === 'y') { e1 = [1, 0, 0]; e2 = [0, 0, 1]; a = [0, 1, 0]; }
  else if (ax === '+z') { e1 = [1, 0, 0]; e2 = [0, 1, 0]; a = [0, 0, 1]; }
  else if (ax === '-z') { e1 = [1, 0, 0]; e2 = [0, 1, 0]; a = [0, 0, -1]; }
  else if (ax === '+x') { e1 = [0, 0, 1]; e2 = [0, 1, 0]; a = [1, 0, 0]; }
  else { e1 = [0, 0, 1]; e2 = [0, 1, 0]; a = [-1, 0, 0]; }
  const apex = [x + a[0] * h + e1[0] * lean[0] + e2[0] * lean[1], y + a[1] * h + e1[1] * lean[0] + e2[1] * lean[1], z + a[2] * h + e1[2] * lean[0] + e2[2] * lean[1]];
  const ring = [];
  const a0 = o.rot || 0;
  for (let i = 0; i < seg; i++) {
    const t = a0 + (i / seg) * Math.PI * 2;
    const c1 = Math.cos(t) * r, s1 = Math.sin(t) * r;
    ring.push([x + e1[0] * c1 + e2[0] * s1, y + e1[1] * c1 + e2[1] * s1, z + e1[2] * c1 + e2[2] * s1]);
  }
  const ctr = [x, y, z];
  const cbs = (p) => (ax === 'y' ? shade(cb, p[1], y, y + h, o.ao ?? 0.2) : cb);
  for (let i = 0; i < seg; i++) {
    const p = ring[i], q = ring[(i + 1) % seg];
    const mid = [(p[0] + q[0]) / 2 - x + a[0] * 0.3 * r, (p[1] + q[1]) / 2 - y + a[1] * 0.3 * r, (p[2] + q[2]) / 2 - z + a[2] * 0.3 * r];
    tri(L, p, q, apex, cbs(p), cbs(q), ct, mid);
  }
  if (o.cap) for (let i = 0; i < seg; i++) tri(L, ctr, ring[i], ring[(i + 1) % seg], cb, cb, cb, [-a[0], -a[1], -a[2]]);
}

/** Cadena de n eslabones planos alternados a lo largo de +Z desde z0 con paso `step`. */
function chain(b, x, y, z0, n, step, color) {
  for (let k = 0; k < n; k++) {
    const flat = k % 2 === 0;
    if (flat) b.box(x, y, z0 + k * step, 0.06, 0.02, 0.085, color, { ao: 0.05 });
    else b.box(x, y, z0 + k * step, 0.025, 0.05, 0.085, color, { ao: 0.05 });
  }
}

function finish(b) {
  const g = b.toGeometry('solid');
  g.computeBoundingBox();
  return g;
}

// ---------------------------------------------------------------- barricadas

const WOOD = [0xc98f55, 0xb8844c, 0xd6a066, 0xa87440, 0xc4894f];
const NAIL = 0x474b52, NAIL_TIP = 0xb7bdc4;

/** Barricada de madera: tablones horizontales, aspa de tablones claveteados y puntales. */
function barricadaMadera(b) {
  const r = rng(101);
  const H = 1.35;
  for (const sx of [-1, 1]) {
    b.box(sx * 0.41, 0, 0, 0.14, 0.11, 0.94, 0x7a4f2c);                         // patín
    b.box(sx * 0.41, 0, 0, 0.12, H, 0.2, 0x8a5e3a);                             // poste
    b.box(sx * 0.41, 0.07, 0.43, 0.08, 0.9, 0.07, 0x7a4f2c, { rx: -0.35 });     // puntal +Z
    b.box(sx * 0.41, 0.07, -0.43, 0.08, 0.9, 0.07, 0x7a4f2c, { rx: 0.35 });     // puntal -Z
  }
  const ang = Math.atan2(1.12, 0.78);
  const len = Math.hypot(1.12, 0.78) + 0.04;
  for (const side of [-1, 1]) {
    const zH = side * 0.135;
    for (let k = 0; k < 6; k++) {
      const l = 0.9 + r() * 0.06, cx = (r() - 0.5) * 0.04;
      b.box(cx, 0.04 + k * 0.215, zH, l, 0.19, 0.07, WOOD[(k + (side > 0 ? 0 : 2)) % WOOD.length]);
      for (const sx of [-1, 1]) cone(b, sx * 0.41 + (r() - 0.5) * 0.02, 0.135 + k * 0.215, zH + side * 0.035, 0.022, 0.03, 5, NAIL, NAIL_TIP, { axis: side > 0 ? '+z' : '-z' });
    }
    const zD = side * 0.2;
    for (const dir of [-1, 1]) {
      b.box(0, 0.68, zD, 0.12, len, 0.05, dir > 0 ? 0xb07a45 : 0xc58a50, { rz: dir * (Math.PI / 2 - ang), oy: -len / 2, ao: 0.1 });
      // clavos en los extremos y en el cruce
      const ex = Math.cos(ang) * (len / 2 - 0.1), ey = Math.sin(ang) * (len / 2 - 0.1);
      for (const s of [-1, 1]) cone(b, -s * dir * ex, 0.68 + s * ey, zD + side * 0.025, 0.022, 0.03, 5, NAIL, NAIL_TIP, { axis: side > 0 ? '+z' : '-z' });
    }
    cone(b, 0, 0.68, zD + side * 0.025, 0.026, 0.035, 5, NAIL, NAIL_TIP, { axis: side > 0 ? '+z' : '-z' });
  }
}

const SHEET = 0x9aa4ae, SHEET_D = 0x838d97, STEEL_D = 0x4f5862;
const YEL = 0xf2c230, BLK = 0x2a2d31;

/** Barricada de chapa: bastidor de acero, planchas onduladas remachadas y franja de peligro. */
function barricadaMetal(b) {
  const H = 1.35;
  for (const sx of [-1, 1]) {
    b.box(sx * 0.41, 0, 0, 0.14, 0.1, 0.94, STEEL_D);                                         // patín
    b.box(sx * 0.41, 0, 0, 0.11, H, 0.22, 0x5b646e);                                          // poste
    b.box(sx * 0.41, 0.06, 0.43, 0.07, 0.9, 0.06, STEEL_D, { rx: -0.35 });                    // puntales
    b.box(sx * 0.41, 0.06, -0.43, 0.07, 0.9, 0.06, STEEL_D, { rx: 0.35 });
  }
  for (const side of [-1, 1]) {
    const zs = side * 0.12;
    b.box(0, 0.1, zs, 0.84, 1.05, 0.04, SHEET, { ao: 0.1 });                                   // plancha
    for (let k = 0; k < 6; k++) {
      b.box(-0.35 + k * 0.14, 0.12, zs + side * 0.028, 0.065, 1.0, 0.024, k % 2 ? SHEET_D : 0xaab3bc, { ao: 0.05 }); // ondas
    }
    // remaches
    for (const sx of [-1, 1]) for (const yy of [0.16, 0.5, 0.84, 1.1]) {
      cone(b, sx * 0.4, yy, zs + side * 0.02, 0.026, 0.03, 5, 0x6a737d, 0xc9d0d6, { axis: side > 0 ? '+z' : '-z' });
    }
  }
  // viga superior con franjas de peligro (arriba y en las dos caras)
  b.box(0, 1.17, 0, 0.96, 0.18, 0.3, STEEL_D);
  const sl = 0.08;
  for (let k = 0; k < 4; k++) {
    const x0 = -0.4 + k * 0.22;
    const para = (lo, hi) => [[x0, lo], [x0 + 0.09, lo], [x0 + 0.09 + sl, hi], [x0 + sl, hi]];
    extrude(b, para(-0.15, 0.15), 'xz', 1.346, 1.352, YEL, { ao: 0 });
    for (const side of [-1, 1]) {
      extrude(b, para(1.18, 1.34), 'xy', side > 0 ? 0.15 : -0.156, side > 0 ? 0.156 : -0.15, YEL, { ao: 0 });
    }
  }
}

const CONC = 0xbab8ae, CONC_D = 0xa4a299;
const JB_PTS = [[0.46, 0], [0.46, 0.1], [0.33, 0.42], [0.2, 1.0], [0.17, 1.35]];
function jbHalf(y) {
  for (let i = 0; i < JB_PTS.length - 1; i++) {
    const [w0, y0] = JB_PTS[i], [w1, y1] = JB_PTS[i + 1];
    if (y <= y1) return w0 + (w1 - w0) * ((y - y0) / (y1 - y0));
  }
  return JB_PTS[JB_PTS.length - 1][0];
}

/** Barrera de hormigón tipo "jersey" con franjas rojas y blancas. */
function barricadaHormigon(b) {
  const pts = [...JB_PTS.map(([w, y]) => [w, y]), ...JB_PTS.slice().reverse().map(([w, y]) => [-w, y])];
  extrude(b, pts, 'zy', -0.48, 0.48, CONC, { ao: 0.2 });
  // franja de colores sobre la pendiente (8 tramos de 12 cm)
  const y0 = 0.56, y1 = 0.98, e = 0.006;
  for (let k = 0; k < 8; k++) {
    const xa = -0.48 + k * 0.12;
    extrude(b, [[-jbHalf(y0) - e, y0], [jbHalf(y0) + e, y0], [jbHalf(y1) + e, y1], [-jbHalf(y1) - e, y1]], 'zy', xa, xa + 0.12, k % 2 ? 0xf2efe6 : 0xd24a3e, { ao: 0.08, y0: 0, y1: 1.35 });
  }
  // reflectores amarillos arriba y ranuras de horquilla en la base
  for (const sx of [-1, 1]) b.box(sx * 0.3, 1.35, 0, 0.12, 0.012, 0.1, YEL, { ao: 0 });
  for (const side of [-1, 1]) for (const sx of [-1, 1]) {
    b.box(sx * 0.27, 0.16, side * (jbHalf(0.16) - 0.002), 0.2, 0.09, 0.012, CONC_D, { ao: 0 });
  }
  b.box(0, 1.28, 0, 0.96, 0.02, 0.36, 0xcfcdc3, { ao: 0 }); // brillo del borde superior
}

// ---------------------------------------------------------------- sacos de arena

const SACK_BEIGE = [0xd9c7a0, 0xcdb88d, 0xe2d2ae, 0xd3bf94];
const SACK_GREEN = [0x6e7a4a, 0x5f6b3f];
const SACK_TIE = 0x8f7c55;

/** Sacos apilados en hiladas alternas (a lo largo de Z / a lo largo de X). */
function sacos(b, level) {
  const r = rng(300 + level);
  const courses = level === 0 ? 2 : 3;
  const h = level === 0 ? 0.42 : 0.34;
  const top = level === 0 ? 0.8 : 0.86;
  const seg = level === 0 ? 8 : 7;
  const step = (top - h) / (courses - 1);
  const green = level === 0 ? [] : [1, 4, 6];
  let n = 0;
  const sack = (x, y0, z, len, dep, rot, tieSign) => {
    const isGreen = green.includes(n);
    const col = isGreen ? SACK_GREEN[n % 2] : SACK_BEIGE[(n * 3 + 1) % SACK_BEIGE.length];
    n++;
    b.sphere(x, y0, z, len, h, dep, col, seg, { ry: rot, ao: 0.22 });
    b.box(x, y0 + h * 0.06, z, len * 0.86, h * 0.44, dep * 0.86, col, { ry: rot, ao: 0.22 });   // cuerpo del saco: rellena los huecos entre elipsoides
    b.box(x, y0 + h * 0.32, z, 0.07, h * 0.34, dep * 0.4, isGreen ? 0x434b2a : SACK_TIE, { ry: rot, ox: tieSign * (len / 2 - 0.025), ao: 0.05 });
  };
  for (let c = 0; c < courses; c++) {
    const y0 = c * step;
    if (c % 2 === 0) {
      for (const sx of [-1, 1]) sack(sx * 0.25 + (r() - 0.5) * 0.01, y0, (r() - 0.5) * 0.01, 0.98, 0.5, Math.PI / 2 + (r() - 0.5) * 0.04, sx);
    } else {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) sack(sx * 0.25, y0, sz * 0.25, 0.5, 0.5, (r() - 0.5) * 0.1, sx);
    }
  }
}

// ---------------------------------------------------------------- puerta

const DOOR = { H: 2.3, T: 0.3, postW: 0.07, lintel: 0.16, sill: 0.04 };
const XR = 0.5 - DOOR.postW;
const SIGN_Y = 1.62; // centro del cartel de la puerta blindada // borde derecho de la hoja cerrada

/** Marco: dos jambas, dintel y umbral (grosor 0,3 en Z). */
function doorFrame(b, level) {
  const col = level === 0 ? 0x5d6671 : 0x3d444d;
  const { H, T, postW, lintel, sill } = DOOR;
  b.box(-0.5 + postW / 2, 0, 0, postW, H, T, col);
  b.box(0.5 - postW / 2, 0, 0, postW, H, T, col);
  b.box(0, H - lintel, 0, 1, lintel, T, col);
  b.box(0, 0, 0, 1 - 2 * postW, sill, T, 0x2f353c);
  // chapa de cierre en la jamba derecha y tornillos
  b.box(0.5 - postW / 2, 0.95, 0, postW + 0.004, 0.2, T + 0.006, 0x2a2f36, { ao: 0 });
  for (const sz of [-1, 1]) {
    for (const yy of [0.3, 1.1, 1.9]) cone(b, 0.47, yy, sz * (T / 2 - 0.012), 0.022, 0.014, 5, 0x30363d, 0x8a929b, { axis: sz > 0 ? '+z' : '-z' });
  }
  if (level === 1) {
    // pletinas amarillas de peligro en el dintel
    for (const sz of [-1, 1]) for (let k = 0; k < 4; k++) {
      b.box(-0.36 + k * 0.24, 2.17, sz * (T / 2), 0.1, 0.09, 0.008, k % 2 ? BLK : YEL, { ao: 0 });
    }
  }
}

/** Hoja de la puerta, bisagra en x = -0,5 (la parte x ∈ [-0,5, -0,43] queda dentro de la jamba). */
function doorLeaf(b, level) {
  const y0 = DOOR.sill, y1 = DOOR.H - DOOR.lintel;
  const cx = (-0.5 + XR) / 2, w = XR + 0.5;
  if (level === 0) {
    const d = 0.1, g = 0xa9b2bb, gD = 0x8a939d, gL = 0xbcc4cc, glass = 0x2b3440, bar = 0x5d6671;
    b.box(cx, y0, 0, w, 1.35 - y0, d, g);
    b.box(-0.345, 1.35, 0, 0.31, 0.5, d, g);
    b.box(0.31, 1.35, 0, 0.24, 0.5, d, g);
    b.box(cx, 1.85, 0, w, y1 - 1.85, d, g);
    // ventanuco enrejado
    b.box(0, 1.35, 0, 0.38, 0.5, 0.012, glass, { ao: 0 });
    for (const k of [-2, -1, 0, 1, 2]) b.box(k * 0.07, 1.36, 0, 0.018, 0.48, d + 0.02, bar, { ao: 0.05 });
    b.box(0, 1.58, 0, 0.38, 0.018, d + 0.02, bar, { ao: 0.05 });
    b.box(0, 1.33, 0, 0.46, 0.04, d + 0.03, gD);
    b.box(0, 1.85, 0, 0.46, 0.04, d + 0.03, gD);
    for (const sx of [-1, 1]) b.box(sx * 0.21, 1.35, 0, 0.04, 0.54, d + 0.03, gD);
    // paneles resaltados y zócalo
    for (const sz of [-1, 1]) {
      b.box(0, 0.32, sz * (d / 2 + 0.006), 0.62, 0.9, 0.012, gL, { ao: 0.06 });
      for (const yy of [0.3, 1.1, 1.98]) b.box(-0.4, yy, sz * (d / 2 + 0.008), 0.2, 0.07, 0.016, gD, { ao: 0 });
    }
    b.box(cx, y0, 0, w, 0.12, d + 0.012, gD);
    // manilla
    b.box(0.31, 0.95, 0, 0.04, 0.04, d + 0.1, 0x5d6671, { ao: 0 });
    for (const sz of [-1, 1]) b.box(0.27, 0.95, sz * (d / 2 + 0.05), 0.12, 0.03, 0.03, 0x2f353c, { ao: 0 });
    // bisagras
    for (const yy of [0.25, 1.05, 1.93]) b.cyl(-0.465, yy, 0, 0.035, 0.035, 0.1, 0x4a525b, 6, { ao: 0 });
  } else {
    const d = 0.16, g = 0x59626d, gD = 0x474f58, gL = 0x6b7580;
    b.box(cx, y0, 0, w, y1 - y0, d, g);
    for (const sz of [-1, 1]) {
      const zf = sz * (d / 2 + 0.009);
      b.box(-0.02, 0.2, zf, 0.74, 1.8, 0.018, gL, { ao: 0.06 });                 // panel interior
      // remaches en los dos bordes del panel
      for (const sx of [-1, 1]) for (let k = 0; k < 6; k++) {
        cone(b, sx * 0.34, 0.3 + k * 0.3, zf + sz * 0.009, 0.026, 0.028, 5, 0x3a4149, 0xaab2ba, { axis: sz > 0 ? '+z' : '-z' });
      }
      // barra transversal con soportes y marcas amarillas
      const zb = sz * (d / 2 + 0.045);
      b.box(-0.01, 0.9, zb, 0.9, 0.12, 0.05, 0x2f353c);
      for (const sx of [-1, 1]) b.box(sx * 0.4, 0.84, sz * (d / 2 + 0.025), 0.1, 0.24, 0.05, gD);
      for (const sx of [-1, 1]) b.box(sx * 0.15, 0.905, zb + sz * 0.026, 0.1, 0.11, 0.004, YEL, { ao: 0 });
      // cartel SOLO POLICÍA (versión de geometría; hay doorSignGeometry con la textura del atlas)
      const zp = sz * (d / 2 + 0.0185), yc = SIGN_Y;
      b.box(-0.02, yc - 0.21, zp, 0.42, 0.42, 0.016, 0xeab43c, { ao: 0 });
      b.box(-0.02, yc - 0.19, zp + sz * 0.007, 0.38, 0.38, 0.012, 0x1f3260, { ao: 0 });
      b.box(-0.02, yc + 0.05, zp + sz * 0.012, 0.26, 0.06, 0.006, 0xffffff, { ao: 0 });
      b.box(-0.02, yc - 0.08, zp + sz * 0.012, 0.32, 0.07, 0.006, 0xffffff, { ao: 0 });
    }
    b.box(0.18, 1.88, 0, 0.3, 0.05, d + 0.03, 0x1c2026, { ao: 0 });            // mirilla
    for (const yy of [0.22, 1.05, 1.9]) b.cyl(-0.455, yy, 0, 0.045, 0.045, 0.12, 0x30363d, 6, { ao: 0 });
  }
}

function doorGeometry(level, part) {
  const b = new PropBuilder();
  b.root(0, 0, 0);
  if (part !== 'leaf') doorFrame(b, level);
  if (part !== 'frame') doorLeaf(b, level);
  return finish(b);
}

// ---------------------------------------------------------------- trampas

/** Pinchos: base + rejilla de pirámides con ligera inclinación (altura total ≤ 0,25). */
function pinchos(b, level) {
  const r = rng(500 + level);
  if (level === 0) {
    // tabla de madera con travesaños y pinchos metálicos
    for (let k = 0; k < 3; k++) b.box(0, 0, -0.3 + k * 0.3, 0.92, 0.055, 0.27, WOOD[(k * 2) % WOOD.length], { ao: 0.2 });
    for (const sx of [-1, 1]) b.box(sx * 0.4, 0.055, 0, 0.1, 0.02, 0.9, 0x8a5e3a, { ao: 0.1 });
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      cone(b, -0.27 + i * 0.18, 0.055, -0.27 + j * 0.18, 0.05, 0.17, 5, 0x8f99a3, 0xeef2f5, { lean: [(r() - 0.5) * 0.03, (r() - 0.5) * 0.03], rot: r() });
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cone(b, sx * 0.4, 0.075, sz * 0.38, 0.025, 0.03, 5, NAIL, NAIL_TIP);
  } else {
    // placa de acero oscura con marco amarillo/negro y pinchos largos
    b.box(0, 0, 0, 0.94, 0.04, 0.94, 0x3b4149, { ao: 0.2 });
    for (let k = 0; k < 6; k++) {
      b.box(-0.39 + k * 0.156, 0.04, -0.455, 0.078, 0.014, 0.05, k % 2 ? BLK : YEL, { ao: 0 });
      b.box(-0.39 + k * 0.156, 0.04, 0.455, 0.078, 0.014, 0.05, k % 2 ? YEL : BLK, { ao: 0 });
    }
    for (let i = 0; i < 6; i++) for (let j = 0; j < 5; j++) {
      cone(b, -0.35 + i * 0.14, 0.04, -0.28 + j * 0.14, 0.037, 0.2, 4, 0x2b2f35, 0x7d8791, { lean: [(r() - 0.5) * 0.02, (r() - 0.5) * 0.02], rot: Math.PI / 4 });
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cone(b, sx * 0.4, 0.054, sz * 0.31, 0.03, 0.025, 6, 0x23272c, 0x8a929b);
  }
}

/** Cepo de oso abierto: placa con pedal, dos mandíbulas en semicírculo con dientes, muelle y cadena. */
function cepo(b, level) {
  const R = level === 0 ? 0.33 : 0.34, ri = level === 0 ? 0.25 : 0.225;
  const NSEG = 8;
  const dark = 0x3a3f46, steel = 0x7d8792;
  const red = 0xc23a30;
  // placa base, pedal y pasadores
  b.box(0, 0, 0, 0.26, 0.04, 0.68, dark, { ao: 0.2 });
  b.cyl(0, 0.04, 0, 0.1, 0.1, 0.03, level === 0 ? 0x6b747d : red, 8, { ao: 0.05 });
  b.cyl(0, 0.07, 0, 0.03, 0.03, 0.05, 0x9aa3ad, 6, { ao: 0 });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) b.cyl(sx * 0.12, 0.04, sz * 0.3, 0.028, 0.028, 0.07, 0x9aa3ad, 6, { ao: 0.05 });
    // muelle (bloque con espiras)
    b.box(sx * 0.07, 0.04, 0, 0.03, 0.07, 0.3, level === 0 ? 0x6b747d : red, { ao: 0.1 });
  }
  // mandíbulas: sectores de corona circular, y dientes triangulares hacia dentro
  for (const s of [-1, 1]) {
    const cx = s * 0.12;
    for (let i = 0; i < NSEG; i++) {
      const a0 = -Math.PI / 2 + (i / NSEG) * Math.PI, a1 = -Math.PI / 2 + ((i + 1) / NSEG) * Math.PI;
      const P = (rad, a) => [cx + s * rad * Math.cos(a), rad * Math.sin(a)];
      const col = level === 1 && i % 2 === 0 ? red : dark;
      extrude(b, [P(R, a0), P(R, a1), P(ri, a1), P(ri, a0)], 'xz', 0.03, 0.1, col, { ao: 0.15 });
      // diente: triángulo apuntando al centro de la corona
      const am = (a0 + a1) / 2, da = (a1 - a0) * 0.36;
      const tipR = ri - (level === 0 ? 0.07 : 0.08);
      extrude(b, [P(ri + 0.005, am - da), P(ri + 0.005, am + da), P(tipR, am)], 'xz', 0.05, level === 0 ? 0.14 : 0.16, steel, { ao: 0.1, y0: 0.03, y1: 0.16 });
    }
  }
  // cadena corta y anilla de anclaje
  chain(b, 0, 0.0, 0.34, 3, 0.045, 0x5a626b);
  b.cyl(0, 0, 0.455, 0.04, 0.04, 0.02, 0x5a626b, 8, { ao: 0.1 });
  b.cyl(0, 0.02, 0.455, 0.022, 0.022, 0.004, 0x23272c, 6, { ao: 0 });
}

/** Mina: disco gris/verde oliva con tapa y piloto rojo (el piloto también va en mineLightGeometry). */
function mina(b) {
  b.cyl(0, 0, 0, 0.3, 0.3, 0.05, 0x7f868e, 16, { ao: 0.2 });
  b.cyl(0, 0.05, 0, 0.26, 0.28, 0.045, 0x6b7440, 16, { ao: 0.15 });
  b.cyl(0, 0.095, 0, 0.12, 0.12, 0.013, 0x8a9097, 12, { ao: 0 });
  b.cyl(0, 0.108, 0, 0.05, 0.05, 0.012, 0xff2a1a, 8, { ao: 0 });
  // marcas radiales amarillas y cruz de presión
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    b.box(Math.cos(a) * 0.19, 0.095, -Math.sin(a) * 0.19, 0.075, 0.01, 0.025, k % 2 ? 0xe4b130 : 0x3b4129, { ry: a, ao: 0 });
  }
  b.box(0, 0.095, 0, 0.44, 0.008, 0.035, 0x3b4129, { ao: 0 });
  b.box(0, 0.095, 0, 0.035, 0.008, 0.44, 0x3b4129, { ao: 0 });
  // asa de transporte y pernos
  b.box(0.27, 0.02, 0, 0.1, 0.02, 0.05, 0x4a525b, { ao: 0.1 });
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    cone(b, Math.cos(a) * 0.235, 0.095, Math.sin(a) * 0.235, 0.022, 0.018, 6, 0x6d747c, 0xc5cbd1);
  }
}

// ---------------------------------------------------------------- utilidades de las piezas de la fase 5

const cross = (a, c) => [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
const norm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Polígono regular (aproximación de un círculo) en el plano (u, v). */
function circlePts(r, seg, cu = 0, cv = 0, rot = 0) {
  const pts = [];
  for (let i = 0; i < seg; i++) {
    const t = rot + (i / seg) * Math.PI * 2;
    pts.push([cu + Math.cos(t) * r, cv + Math.sin(t) * r]);
  }
  return pts;
}
/** Prisma circular a lo largo de Z: centro (x, y), z0..z1. */
const prismZ = (b, x, y, r, z0, z1, seg, color, o) => extrude(b, circlePts(r, seg, x, y), 'xy', z0, z1, color, o);
/** Prisma circular a lo largo de X: centro (y, z), x0..x1. */
const prismX = (b, y, z, r, x0, x1, seg, color, o) => extrude(b, circlePts(r, seg, z, y), 'zy', x0, x1, color, o);

/** Pincho/cono con dirección arbitraria `d` (unitaria) desde `p`. */
function spike(b, p, d, r, h, seg, cBase, cTip) {
  const L = b.layers.solid;
  const cb = lin(cBase), ct = lin(cTip ?? cBase);
  const u = norm3(cross(d, Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const v = cross(d, u);
  const apex = [p[0] + d[0] * h, p[1] + d[1] * h, p[2] + d[2] * h];
  const ring = [];
  for (let i = 0; i < seg; i++) {
    const t = (i / seg) * Math.PI * 2, c = Math.cos(t) * r, s = Math.sin(t) * r;
    ring.push([p[0] + u[0] * c + v[0] * s, p[1] + u[1] * c + v[1] * s, p[2] + u[2] * c + v[2] * s]);
  }
  for (let i = 0; i < seg; i++) {
    const a = ring[i], c = ring[(i + 1) % seg];
    tri(L, a, c, apex, cb, cb, ct, [(a[0] + c[0]) / 2 - p[0] + d[0] * 0.2 * r, (a[1] + c[1]) / 2 - p[1] + d[1] * 0.2 * r, (a[2] + c[2]) / 2 - p[2] + d[2] * 0.2 * r]);
  }
}

/** Pata de trípode: del suelo en (R·cos a, 0, R·sin a) hasta el eje en (0, H, 0). */
function tripodLeg(b, a, R, H, w, color) {
  const len = Math.hypot(R, H), phi = Math.atan2(R, H);
  b.box(R * Math.cos(a), (w / 2) * Math.sin(phi), R * Math.sin(a), w, len, w, color, { ry: -a, rz: phi, ao: 0.1 });
}

/** Franja diagonal sobre un cilindro vertical de radio r (tira de cuadriláteros). Ángulos en radianes. */
function cylStripe(b, r, y0, y1, a0, a1, shift, color, sub = 2) {
  const L = b.layers.solid, col = lin(color);
  const P = (a, y) => [Math.cos(a) * r, y, Math.sin(a) * r];
  for (let j = 0; j < sub; j++) {
    const s0 = a0 + ((a1 - a0) * j) / sub, s1 = a0 + ((a1 - a0) * (j + 1)) / sub;
    const p0 = P(s0, y0), p1 = P(s1, y0), q1 = P(s1 + shift, y1), q0 = P(s0 + shift, y1);
    const am = (s0 + s1) / 2 + shift / 2, hint = [Math.cos(am), 0, Math.sin(am)];
    tri(L, p0, p1, q1, col, col, col, hint);
    tri(L, p0, q1, q0, col, col, col, hint);
  }
}

/** Rollo helicoidal de alambre a lo largo de X (de -0,49 a 0,49): tubo triangular de radio `wr` + púas. */
function coilTube(b, cy, cz, r, turns, segPer, wr, color, barbColor, phase = 0, barbEvery = 3) {
  const L = b.layers.solid, col = lin(color);
  const n = Math.round(turns * segPer);
  const frame = (i) => {
    const t = i / n, x = -0.49 + 0.98 * t, th = phase + t * turns * Math.PI * 2;
    const e1 = [0, Math.sin(th), Math.cos(th)];
    const c = [x, cy + r * e1[1], cz + r * e1[2]];
    const ring = [];
    for (let k = 0; k < 3; k++) {
      const f = (k / 3) * Math.PI * 2 + 0.5, a = Math.cos(f) * wr, s = Math.sin(f) * wr;
      ring.push([c[0] + s, c[1] + e1[1] * a, c[2] + e1[2] * a]);
    }
    return { c, ring, e1 };
  };
  const cs = (p) => shade(col, p[1], 0, 0.55, 0.22);
  let prev = frame(0);
  for (let i = 1; i <= n; i++) {
    const cur = frame(i);
    for (let k = 0; k < 3; k++) {
      const k2 = (k + 1) % 3;
      const p0 = prev.ring[k], p1 = prev.ring[k2], q1 = cur.ring[k2], q0 = cur.ring[k];
      const mid = [0, 1, 2].map((j) => (p0[j] + p1[j] + q0[j] + q1[j]) / 4 - (prev.c[j] + cur.c[j]) / 2);
      tri(L, p0, p1, q1, cs(p0), cs(p1), cs(q1), mid);
      tri(L, p0, q1, q0, cs(p0), cs(q1), cs(q0), mid);
    }
    if (barbEvery && i % barbEvery === 0) {
      spike(b, cur.c, norm3([i % 2 ? 0.5 : -0.5, cur.e1[1], cur.e1[2]]), wr * 1.1, 0.05, 3, barbColor, 0xdfe5ea);
    }
    prev = cur;
  }
}

// ---------------------------------------------------------------- alambre de espino

/** Alambre de espino (nivel 0: piquetas de madera cruzadas) y concertina (nivel 1: tres rollos sobre piquetas de acero). */
function alambre(b, level) {
  if (level === 0) {
    for (const sx of [-1, 1]) {
      for (const t of [-1, 1]) b.box(sx * 0.4, 0, 0, 0.065, 0.5, 0.065, WOOD[(t + 3) % WOOD.length], { rx: t * 0.22, ao: 0.18 });
      b.box(sx * 0.4, 0.27, 0, 0.075, 0.035, 0.1, 0x5b646e, { ao: 0 });                // abrazadera
    }
    coilTube(b, 0.265, 0, 0.215, 6, 6, 0.011, 0x6c747d, 0x2b2f35, 0.4, 3);
  } else {
    for (const sx of [-1, 1]) {
      b.box(sx * 0.4, 0, 0, 0.05, 0.54, 0.014, 0x3a424b, { ao: 0.15 });              // piqueta en estrella (dos chapas)
      b.box(sx * 0.4, 0, 0, 0.014, 0.54, 0.05, 0x3a424b, { ao: 0.15 });
      b.box(sx * 0.4, 0, 0, 0.09, 0.025, 0.09, 0x2f353c, { ao: 0.1 });               // pletina de apoyo
      b.box(sx * 0.4, 0.5, 0, 0.056, 0.045, 0.056, YEL, { ao: 0 });                  // capuchón amarillo
    }
    coilTube(b, 0.165, -0.165, 0.15, 4, 6, 0.011, 0xb9c2ca, 0x4f5862, 0.2, 3);
    coilTube(b, 0.165, 0.165, 0.15, 4, 6, 0.011, 0xc7cfd6, 0x4f5862, 2.6, 3);
    coilTube(b, 0.355, 0, 0.14, 3.5, 6, 0.011, 0xdde3e8, 0x4f5862, 1.4, 3);
  }
}

// ---------------------------------------------------------------- barril explosivo

const DRUM_RED = 0xc9372c, DRUM_RED_D = 0xa22a21, DRUM_BAND = 0xf2c230;

/** Bidón rojo con aros, banda de peligro diagonal y etiqueta de llama a ambos lados (+Z y -Z). Diámetro 0,6. */
function barril(b) {
  const R = 0.29, SEG = 12;
  b.cyl(0, 0.02, 0, R, R, 0.9, DRUM_RED, SEG, { ao: 0.22 });                    // cuerpo
  b.cyl(0, 0, 0, 0.31, 0.31, 0.05, DRUM_RED_D, SEG, { ao: 0.1 });               // aro inferior
  b.cyl(0, 0.875, 0, 0.31, 0.31, 0.05, DRUM_RED_D, SEG, { ao: 0.1 });           // aro superior
  b.cyl(0, 0.3, 0, 0.312, 0.312, 0.04, DRUM_RED_D, SEG, { ao: 0.1 });           // nervios
  b.cyl(0, 0.62, 0, 0.312, 0.312, 0.04, DRUM_RED_D, SEG, { ao: 0.1 });
  b.cyl(0, 0.34, 0, 0.3, 0.3, 0.28, DRUM_BAND, SEG, { ao: 0.06 });              // banda amarilla
  for (let k = 0; k < 8; k++) {                                                   // franjas negras diagonales
    const a0 = (k / 8) * Math.PI * 2;
    cylStripe(b, 0.308, 0.345, 0.615, a0, a0 + 0.3, 0.45, BLK, 2);
  }
  b.cyl(0, 0.92, 0, 0.27, 0.285, 0.02, 0x8f2a22, SEG, { ao: 0 });               // tapa
  b.cyl(0.1, 0.94, 0.08, 0.045, 0.045, 0.018, 0x2f353c, 8, { ao: 0.05 });        // tapón
  b.cyl(0.1, 0.958, 0.08, 0.02, 0.02, 0.004, 0xb7bdc4, 6, { ao: 0 });
  // etiqueta de llama (rombo claro con borde negro + llama roja/amarilla) delante y detrás
  const flame = [[0, -0.085], [0.05, -0.04], [0.055, 0.015], [0.025, 0.05], [0.03, 0.095], [-0.005, 0.07], [-0.03, 0.02], [-0.05, 0.0], [-0.045, -0.04]];
  const inner = [[0, -0.055], [0.028, -0.025], [0.02, 0.01], [0, 0.03], [-0.025, -0.005], [-0.022, -0.03]];
  for (const s of [1, -1]) {
    const y = 0.755;
    const dia = (hw, hh) => [[0, y - hh], [hw, y], [0, y + hh], [-hw, y]];
    const w = (a, c) => (s > 0 ? [a, c] : [-c, -a]);
    extrude(b, dia(0.14, 0.14), 'xy', ...w(0.25, 0.3), 0x1f2328, { ao: 0 });
    extrude(b, dia(0.12, 0.12), 'xy', ...w(0.25, 0.304), 0xf4efe0, { ao: 0 });
    extrude(b, flame.map(([u, v]) => [u * s, y + v * 0.95]), 'xy', ...w(0.3, 0.31), 0xd9381e, { ao: 0 });
    extrude(b, inner.map(([u, v]) => [u * s, y + v * 0.95]), 'xy', ...w(0.31, 0.316), 0xffc02e, { ao: 0 });
  }
}

// ---------------------------------------------------------------- valla electrificada

const FENCE_POST = 0x8d97a1, FENCE_POST_D = 0x5b646e, FENCE_WIRE = 0xc5ccd3, INSUL = 0xf2c230, INSUL_TIP = 0xffe27a;
const BOLT = [[0.015, 0.205], [-0.04, 0.115], [-0.005, 0.115], [-0.025, 0.04], [0.045, 0.14], [0.01, 0.14], [0.05, 0.205]];

/** Cartel de peligro eléctrico (triángulo amarillo con borde negro y rayo) en la cara `s` (±1), desde z = zs hacia fuera, centrado en x = dx. */
function boltSign(b, s, zs, y0, dx = 0) {
  const w = (a, c) => (s > 0 ? [zs + a, zs + c] : [-zs - c, -zs - a]);
  const tr = (hw, h, dy = 0) => [[dx - hw, y0 + dy], [dx + hw, y0 + dy], [dx, y0 + dy + h]];
  extrude(b, tr(0.17, 0.3, -0.02), 'xy', ...w(0, 0.005), 0x1f2328, { ao: 0 });
  extrude(b, tr(0.145, 0.25, 0), 'xy', ...w(0.005, 0.01), 0xf2c230, { ao: 0 });
  extrude(b, BOLT.map(([u, v]) => [u * s + dx, y0 + v]), 'xy', ...w(0.01, 0.014), 0x1f2328, { ao: 0 });
}

/** Valla electrificada: panel de 1 m (postes en x = ±0,5), hilos horizontales sobre aisladores amarillos y cartel de rayo. */
function valla(b, level) {
  const r1 = level === 1;
  const pw = r1 ? 0.1 : 0.08, pd = r1 ? 0.11 : 0.09;
  const H = r1 ? 1.46 : 1.56, px = 0.5 - pw / 2;
  const zf = pd / 2 + 0.03;
  for (const sx of [-1, 1]) {
    b.box(sx * px, 0, 0, pw, H, pd, r1 ? FENCE_POST_D : FENCE_POST, { ao: 0.16 });             // poste
    b.box(sx * px, 0, 0, pw, 0.05, pd + 0.08, 0x3f464e, { ao: 0.1 });                          // placa de anclaje
    b.box(sx * px, H, 0, pw + 0.012, 0.04, pd + 0.012, r1 ? BLK : 0x4f5862, { ao: 0 });        // remate
  }
  const rows = r1 ? [0.3, 0.55, 0.8, 1.05, 1.3] : [0.35, 0.65, 0.95, 1.25, 1.5];
  for (const y of rows) {
    for (const s of [-1, 1]) {
      for (const sx of [-1, 1]) cone(b, sx * px, y, s * pd / 2, 0.028, 0.03, 4, INSUL, INSUL_TIP, { axis: s > 0 ? '+z' : '-z', rot: Math.PI / 4 });
      b.box(0, y - 0.006, s * zf, 2 * px, 0.012, 0.012, FENCE_WIRE, { ao: 0.05 });
    }
  }
  if (!r1) {
    for (const s of [-1, 1]) b.box(0, 0.3, s * (zf - 0.004), 0.016, 1.25, 0.016, 0x59626d, { ao: 0.05 });   // separador central
  } else {
    // doble malla: montantes finos en las dos caras
    for (const s of [-1, 1]) for (const x of [-0.27, 0, 0.27]) b.box(x, 0.28, s * (zf + 0.012), 0.014, 1.04, 0.012, 0x59626d, { ao: 0.05 });
    // remate de alambre: brazos inclinados y dos hilos con púas
    const ang = 0.7, len = 0.14;
    for (const sx of [-1, 1]) for (const s of [-1, 1]) b.box(sx * px, H + 0.02, 0, 0.04, len, 0.03, FENCE_POST_D, { rx: s * ang, ao: 0.05 });
    const ty = H + 0.02 + len * Math.cos(ang), tz = len * Math.sin(ang);
    for (const s of [-1, 1]) {
      b.box(0, ty - 0.006, s * tz, 2 * px, 0.012, 0.012, FENCE_WIRE, { ao: 0.05 });
      for (let k = 0; k < 6; k++) spike(b, [-0.35 + k * 0.14, ty, s * tz], norm3([0, 1, s * 0.7]), 0.012, 0.045, 3, 0x4f5862, 0xdfe5ea);
    }
  }
  const sy = r1 ? 0.66 : 0.74, zs = zf + 0.004;
  boltSign(b, 1, zs, sy, -0.17);   // los dos carteles desfasados en X para que no se solapen al verlos a través de la malla
  boltSign(b, -1, zs, sy, 0.17);
}

// ---------------------------------------------------------------- generador

/** Generador diésel en bastidor de tubos: cuerpo amarillo, alternador, depósito, escape, panel (cara +Z) y cable enrollado. */
function generador(b) {
  const FR = 0x30353b, GY = 0xf0b928, GK = 0x24272b;
  const hx = 0.46, hz = 0.4, tw = 0.055, top = 1.0;
  // bastidor
  for (const sz of [-1, 1]) {
    b.box(0, 0, sz * hz, 2 * hx + tw, tw, tw, FR, { ao: 0.1 });
    b.box(0, top - tw, sz * hz, 2 * hx + tw, tw, tw, FR, { ao: 0 });
  }
  for (const sx of [-1, 1]) {
    b.box(sx * hx, 0, 0, tw, tw, 2 * hz, FR, { ao: 0.1 });
    b.box(sx * hx, top - tw, 0, tw, tw, 2 * hz, FR, { ao: 0 });
    for (const sz of [-1, 1]) b.box(sx * hx, 0, sz * hz, tw, top, tw, FR, { ao: 0.12 });
  }
  // franjas de peligro en el larguero superior delantero
  for (let k = 0; k < 6; k++) b.box(-0.35 + k * 0.14, top - tw - 0.001, hz, 0.07, tw + 0.004, tw + 0.004, k % 2 ? GK : GY, { ao: 0 });
  // cuerpo
  b.box(0, 0.06, 0, 0.62, 0.1, 0.6, GK, { ao: 0.2 });
  b.box(0, 0.16, 0, 0.6, 0.48, 0.58, GY, { ao: 0.2 });
  b.box(0, 0.64, 0, 0.62, 0.03, 0.6, GK, { ao: 0 });
  for (const k of [0, 1]) b.box(0.18 - k * 0.14, 0.26, -0.292, 0.1, 0.26, 0.014, GK, { ao: 0 });   // rejilla trasera
  prismX(b, 0.4, 0, 0.19, -0.44, -0.3, 8, 0x3a3f46, { ao: 0.15 });                    // alternador
  prismX(b, 0.4, 0, 0.15, -0.44, -0.42, 8, GY, { ao: 0 });
  // depósito
  prismX(b, 0.79, 0, 0.15, -0.3, 0.3, 8, 0xb53a2c, { ao: 0.18, y0: 0.64, y1: 0.94 });
  b.cyl(-0.12, 0.93, 0, 0.04, 0.04, 0.03, GK, 6, { ao: 0 });
  // escape
  b.cyl(0.37, 0.67, -0.2, 0.05, 0.05, 0.28, 0x555d66, 6, { ao: 0.15 });
  b.cyl(0.37, 0.95, -0.2, 0.025, 0.025, 0.25, 0x3a3f46, 5, { ao: 0.1 });
  b.cyl(0.37, 1.2, -0.2, 0.04, 0.04, 0.012, 0x23272c, 6, { ao: 0 });
  // panel de control (cara +Z)
  const zp = 0.29;
  b.box(0.04, 0.2, zp, 0.44, 0.3, 0.04, 0x2b3036, { ao: 0.05 });
  const zf = zp + 0.02;
  extrude(b, circlePts(0.045, 8, -0.1, 0.4), 'xy', zf, zf + 0.008, 0xe8e4d6, { ao: 0 });
  b.box(-0.1, 0.38, zf + 0.008, 0.006, 0.04, 0.006, 0xd9381e, { ao: 0, rz: -0.6 });
  [0x3fe06a, 0xffb02e, 0xff3b2b].forEach((c, k) => b.box(-0.02 + k * 0.07, 0.39, zf, 0.035, 0.035, 0.014, c, { ao: 0 }));
  for (const k of [0, 1]) extrude(b, circlePts(0.03, 6, -0.05 + k * 0.1, 0.3), 'xy', zf, zf + 0.025, 0x9aa3ad, { ao: 0 });
  for (const k of [0, 1]) b.box(0.0 + k * 0.17, 0.2, zf, 0.075, 0.07, 0.02, k ? GY : 0xd9381e, { ao: 0 });
  // cable enrollado sobre el larguero delantero
  b.cyl(-0.2, 0.055, 0.4, 0.09, 0.09, 0.07, 0xd8641e, 8, { ao: 0.15 });
  b.cyl(-0.2, 0.055, 0.4, 0.04, 0.04, 0.072, 0x23272c, 6, { ao: 0 });
  b.box(-0.08, 0.06, 0.46, 0.08, 0.03, 0.03, GK, { ao: 0 });
}

// ---------------------------------------------------------------- torreta automática

const TUR = { steel: 0x5b646e, dark: 0x30353b, olive: 0x6b7440, oliveD: 0x575f33, light: 0x8a929b };

/** BASE de la torreta: trípode (nivel 0) o pedestal blindado (nivel 1) con caja(s) de munición. Llega hasta y = 0,9. */
function torretaBase(b, level) {
  const r1 = level === 1;
  const R = r1 ? 0.4 : 0.38, legW = r1 ? 0.075 : 0.06, Hc = 0.82;
  for (const a of [Math.PI / 2, Math.PI / 2 + (Math.PI * 2) / 3, Math.PI / 2 + (Math.PI * 4) / 3]) {
    tripodLeg(b, a, R, Hc, legW, r1 ? TUR.dark : TUR.steel);
    b.cyl(R * Math.cos(a), 0, R * Math.sin(a), r1 ? 0.07 : 0.06, r1 ? 0.07 : 0.06, 0.03, TUR.dark, 6, { ao: 0.1 });
  }
  // columna central y plato giratorio
  b.cyl(0, 0.05, 0, 0.07, 0.07, 0.8, TUR.steel, 8, { ao: 0.15 });
  b.cyl(0, 0.78, 0, 0.1, 0.1, 0.06, TUR.dark, 8, { ao: 0.1 });
  b.cyl(0, 0.84, 0, 0.17, 0.17, 0.06, TUR.dark, 10, { ao: 0.05 });
  b.cyl(0, 0.89, 0, 0.12, 0.12, 0.012, TUR.light, 10, { ao: 0 });
  if (r1) {
    b.cyl(0, 0.08, 0, 0.17, 0.2, 0.62, TUR.steel, 6, { ao: 0.2 });                 // faja blindada
    b.cyl(0, 0.7, 0, 0.19, 0.17, 0.05, YEL, 6, { ao: 0 });
  }
  // caja(s) de munición detrás (-Z) y tolva de alimentación
  for (const y of r1 ? [0, 0.2] : [0]) {
    b.box(0, 0.03 + y, -0.3, r1 ? 0.36 : 0.32, 0.18, 0.2, TUR.olive, { ao: 0.2 });
    b.box(0, 0.21 + y, -0.3, r1 ? 0.37 : 0.33, 0.025, 0.21, TUR.oliveD, { ao: 0 });
    b.box(0, 0.12 + y, -0.403, 0.1, 0.05, 0.012, YEL, { ao: 0 });
    b.box(0, 0.235 + y, -0.3, 0.1, 0.03, 0.04, TUR.dark, { ao: 0 });
  }
  const y0 = r1 ? 0.45 : 0.25, len = r1 ? 0.42 : 0.6;
  b.box(0, y0, -0.3, 0.07, len, 0.035, TUR.dark, { rx: 0.35, ao: 0.1 });
}

/** Cabeza de la torreta (origen = eje de giro; cañón hacia +Z, longitud ~0,6; alto ~0,3). */
function torretaHead(b, level) {
  const r1 = level === 1;
  const hw = r1 ? 0.17 : 0.13;
  b.cyl(0, -0.06, 0, 0.06, 0.06, 0.08, TUR.dark, 6, { ao: 0 });                    // vástago hasta el plato
  b.cyl(0, 0, 0, 0.14, 0.14, 0.035, TUR.dark, 10, { ao: 0.1 });
  b.box(0, 0.035, 0.01, 2 * hw, r1 ? 0.19 : 0.17, 0.3, r1 ? TUR.steel : TUR.olive, { ao: 0.2 });   // carcasa
  b.box(0, 0.04, 0.17, 2 * hw - 0.04, r1 ? 0.15 : 0.12, 0.05, TUR.dark, { ao: 0.1 });               // mantelete
  const yb = 0.125;
  for (const x of r1 ? [-0.075, 0.075] : [0]) {
    prismZ(b, x, yb, r1 ? 0.028 : 0.03, 0.19, 0.58, 8, TUR.light, { ao: 0.1 });
    prismZ(b, x, yb, r1 ? 0.042 : 0.048, 0.19, r1 ? 0.34 : 0.32, 8, TUR.dark, { ao: 0.1 });
    prismZ(b, x, yb, r1 ? 0.04 : 0.043, 0.5, 0.6, 8, TUR.dark, { ao: 0.1 });
  }
  if (r1) {
    for (const sx of [-1, 1]) {
      prismX(b, 0.1, -0.02, 0.06, sx * (hw + 0.005), sx * (hw + 0.075), 8, TUR.olive, { ao: 0.1 });   // tambor de munición
      b.box(sx * hw, 0.04, 0.0, 0.03, 0.18, 0.26, TUR.dark, { ao: 0.05, rz: -sx * 0.35 });            // placa lateral
    }
    b.box(0, 0.225, 0.06, 0.3, 0.02, 0.2, TUR.dark, { ao: 0 });                    // visera blindada
  } else {
    b.box(-hw - 0.04, 0.05, -0.02, 0.08, 0.12, 0.14, TUR.oliveD, { ao: 0.15 });    // cajón de munición
  }
  // sensor / cámara
  const sx0 = r1 ? 0.0 : 0.06, sy = r1 ? 0.235 : 0.205;
  b.box(sx0, sy, 0.0, 0.1, 0.07, 0.1, TUR.dark, { ao: 0.1 });
  b.box(sx0, sy + 0.015, 0.055, 0.055, 0.04, 0.012, 0x35c8ff, { ao: 0 });
  b.box(sx0 + 0.04, sy + 0.07, -0.02, 0.012, 0.02, 0.012, 0xff3b2b, { ao: 0 });
  b.box(sx0 - 0.04, sy, -0.03, 0.014, r1 ? 0.06 : 0.09, 0.014, TUR.light, { ao: 0 });
}

// ---------------------------------------------------------------- foco de obra

const FL = { yc: 2.2, zc: 0.2, w: 0.42, h: 0.3, d: 0.14, tilt: (35 * Math.PI) / 180 };

/** Cada proyector va de espaldas al mástil, mirando a ±Z (s) e inclinado 35° hacia abajo; pivota sobre su centro. */
function floodProjector(b, s) {
  const rot = { rx: FL.tilt, ry: s > 0 ? 0 : Math.PI };
  const part = (w, h, d, ox, oyc, oz, color, ao = 0.12) =>
    b.box(0, FL.yc, s * FL.zc, w, h, d, color, { ...rot, ox, oy: oyc - h / 2, oz, ao });
  part(FL.w, FL.h, FL.d, 0, 0, 0, 0xe8b630);                                            // carcasa
  part(FL.w - 0.06, FL.h - 0.06, 0.016, 0, 0, FL.d / 2 + 0.002, 0xe7e0c6, 0);           // cristal
  part(FL.w + 0.03, 0.022, 0.1, 0, FL.h / 2 + 0.01, FL.d / 2 + 0.03, 0x2f353c, 0.05);   // visera
  for (const x of [-0.12, 0, 0.12]) part(0.022, FL.h - 0.04, 0.045, x, 0, -FL.d / 2 - 0.02, 0x30353b, 0.1); // aletas
  for (const sx of [-1, 1]) part(0.025, 0.04, 0.05, sx * (FL.w / 2 + 0.012), 0, 0.0, 0x4f5862, 0.05);        // pivotes
}

/** Foco de obra: trípode, batería de contrapeso, mástil telescópico y dos proyectores (+Z / -Z). */
function foco(b) {
  const H = 1.0, R = 0.4;
  for (const a of [Math.PI / 2, Math.PI / 2 + (Math.PI * 2) / 3, Math.PI / 2 + (Math.PI * 4) / 3]) {
    tripodLeg(b, a, R, H, 0.045, 0x3a4149);
    b.cyl(R * Math.cos(a), 0, R * Math.sin(a), 0.055, 0.055, 0.03, 0x23272c, 6, { ao: 0.1 });
  }
  // batería / contrapeso en la base
  b.box(0, 0, 0, 0.34, 0.28, 0.34, 0x3b4148, { ao: 0.2 });
  for (let k = 0; k < 4; k++) b.box(-0.12 + k * 0.08, 0.281, 0.0, 0.04, 0.006, 0.34, k % 2 ? BLK : YEL, { ao: 0 });
  b.box(0, 0.12, 0.172, 0.18, 0.08, 0.008, YEL, { ao: 0 });
  for (const sx of [-1, 1]) b.cyl(sx * 0.1, 0.28, -0.1, 0.022, 0.022, 0.03, sx > 0 ? 0xd9381e : 0x23272c, 6, { ao: 0 });
  // mástil telescópico, collares y yugo
  b.cyl(0, 0.28, 0, 0.05, 0.05, 1.0, 0x5b646e, 8, { ao: 0.15 });
  b.cyl(0, 0.96, 0, 0.07, 0.07, 0.07, 0x23272c, 6, { ao: 0.1 });
  b.cyl(0, 1.28, 0, 0.06, 0.06, 0.05, 0x23272c, 8, { ao: 0.1 });
  b.cyl(0, 1.33, 0, 0.034, 0.034, 0.82, 0x9aa3ad, 8, { ao: 0.1 });
  b.box(0.05, 0.3, 0, 0.014, 1.75, 0.014, 0x1c1f23, { ao: 0 });                          // cable
  b.box(0, FL.yc - 0.02, 0, 0.07, 0.06, 2 * FL.zc, 0x30353b, { ao: 0.05 });               // yugo
  b.cyl(0, 2.1, 0, 0.045, 0.045, 0.06, 0x23272c, 6, { ao: 0 });
  floodProjector(b, 1);
  floodProjector(b, -1);
}

// ---------------------------------------------------------------- API pública

/**
 * Geometría de una pieza de construcción.
 * @param {'barricada'|'sacos'|'puerta'|'pinchos'|'cepo'|'mina'|'alambre'|'barril'|'valla'|'generador'|'torreta'|'foco'} type
 * @param {number} level índice de nivel (0..n-1; se limita al rango de build.json)
 * @returns {THREE.BufferGeometry} no indexada; position + normal + color (lineal), sin uv.
 *   Coordenadas locales de la celda (centro en 0,0,0; base en y=0); la pieza corre a lo largo de X.
 *   La mina incluye el piloto rojo como color; para que brille, superponer mineLightGeometry().
 *   alambre/valla corren a lo largo de X (panel fino en Z): en una columna (eje Z) rotar 90° en Y.
 *   torreta devuelve SOLO la base (hasta y = 0,9): la cabeza giratoria es turretHeadGeometry(level), a y = headHeight.
 *   foco: los cristales de los proyectores se pueden hacer brillar superponiendo floodLensGeometry().
 */
export function structureGeometry(type, level = 0) {
  const def = build.pieces[type];
  if (!def) throw new Error(`structureGeometry: tipo desconocido "${type}"`);
  const lv = Math.max(0, Math.min(def.levels.length - 1, level | 0));
  if (type === 'puerta') return doorGeometry(lv, 'all');
  const b = new PropBuilder();
  b.root(0, 0, 0);
  switch (type) {
    case 'barricada': [barricadaMadera, barricadaMetal, barricadaHormigon][lv](b); break;
    case 'sacos': sacos(b, lv); break;
    case 'pinchos': pinchos(b, lv); break;
    case 'cepo': cepo(b, lv); break;
    case 'mina': mina(b); break;
    case 'alambre': alambre(b, lv); break;
    case 'barril': barril(b); break;
    case 'valla': valla(b, lv); break;
    case 'generador': generador(b); break;
    case 'torreta': torretaBase(b, lv); break;
    case 'foco': foco(b); break;
    default: throw new Error(`structureGeometry: tipo sin modelo "${type}"`);
  }
  return finish(b);
}

/**
 * SOLO la hoja de la puerta (sin marco), con la bisagra en x = -0,5, z = 0 (eje vertical).
 * Para abrirla: Group con position (cx - 0.5, 0, cz), la hoja dentro con position.x = +0.5,
 * y girar el Group en Y. Las bisagras sobresalen justo hasta x = -0,5.
 */
export function doorLeafGeometry(level = 0) {
  return doorGeometry(Math.max(0, Math.min(1, level | 0)), 'leaf');
}

/** SOLO el marco de la puerta (jambas, dintel y umbral). Con la hoja abierta se dibuja marco + hoja girada. */
export function doorFrameGeometry(level = 0) {
  return doorGeometry(Math.max(0, Math.min(1, level | 0)), 'frame');
}

/**
 * Opcional: cartel "SOLO POLICÍA" con la textura del atlas (position + normal + uv, SIN color) para la puerta
 * blindada (nivel 1), delante y detrás, sobre el cartel de geometría. Va en el espacio de la HOJA
 * (gira con ella). Material: atlas (`createAtlasTexture()`) con polygonOffset para evitar z-fighting.
 * Devuelve null en el nivel 0.
 */
export function doorSignGeometry(level = 0) {
  if (level < 1) return null;
  const b = new PropBuilder();
  b.root(0, 0, 0);
  const z = 0.1 + 0.0185 + 0.0125 + 0.009;
  b.sprite('solo_policia', -0.02, SIGN_Y, z, 0.38, 0.38);
  b.sprite('solo_policia', -0.02, SIGN_Y, -z, 0.38, 0.38, { ry: Math.PI });
  const g = b.toGeometry('sign');
  g.computeBoundingBox();
  return g;
}

/** Piloto de la mina (cúpula roja) para pintarlo con un material emisivo aparte, encima del piloto de structureGeometry. */
export function mineLightGeometry() {
  const b = new PropBuilder();
  b.root(0, 0, 0);
  b.cyl(0, 0.108, 0, 0.054, 0.054, 0.013, 0xff5a3a, 8, { ao: 0 });
  return finish(b);
}

/**
 * Cabeza giratoria de la torreta. Origen = eje de giro (se coloca en y = build.pieces.torreta.headHeight);
 * el cañón apunta a +Z (longitud ~0,6, sale de la celda por +Z). Alto ~0,3 sobre el origen (el vástago baja 0,06 hasta el plato).
 * Girar el Group de la cabeza en Y para apuntar (rotation.y = atan2(dx, dz)).
 */
export function turretHeadGeometry(level = 0) {
  const lv = Math.max(0, Math.min(build.pieces.torreta.levels.length - 1, level | 0));
  const b = new PropBuilder();
  b.root(0, 0, 0);
  torretaHead(b, lv);
  return finish(b);
}

/**
 * Caras frontales de los cristales de los dos proyectores del foco (blanco cálido), en la MISMA posición que en
 * structureGeometry('foco') pero 4 mm adelantadas. Pintar con un MeshBasicMaterial({ vertexColors: true }) para que brillen de noche.
 */
export function floodLensGeometry() {
  const b = new PropBuilder();
  b.root(0, 0, 0);
  const L = b.layers.solid, col = lin(0xfff6dc);
  const gw = (FL.w - 0.06) / 2, gh = (FL.h - 0.06) / 2, zl = FL.d / 2 + 0.002 + 0.008 + 0.004;
  for (const s of [1, -1]) {
    const m = new THREE.Matrix4().makeTranslation(0, FL.yc, s * FL.zc)
      .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(FL.tilt, s > 0 ? 0 : Math.PI, 0, 'YXZ')));
    const P = [[-gw, -gh], [gw, -gh], [gw, gh], [-gw, gh]].map(([x, y]) => {
      const v = new THREE.Vector3(x, y, zl).applyMatrix4(m);
      return [v.x, v.y, v.z];
    });
    const n = new THREE.Vector3(0, 0, 1).transformDirection(m);
    const hint = [n.x, n.y, n.z];
    tri(L, P[0], P[1], P[2], col, col, col, hint);
    tri(L, P[0], P[2], P[3], col, col, col, hint);
  }
  return finish(b);
}

/**
 * Versión simplificada (una o dos cajas, blanca) para la vista previa de colocación.
 * Las alturas salen de build.json. Los colores son blancos para poder teñirlos con el material.
 */
export function structureGhostGeometry(type) {
  const def = build.pieces[type];
  if (!def) throw new Error(`structureGhostGeometry: tipo desconocido "${type}"`);
  const h = def.height;
  const b = new PropBuilder();
  b.root(0, 0, 0);
  const W = 0xffffff;
  switch (type) {
    case 'puerta': b.box(0, 0, 0, 1, h, def.thickness ?? 0.3, W, { ao: 0.06 }); break;
    case 'pinchos': b.box(0, 0, 0, 0.92, h, 0.92, W, { ao: 0 }); break;
    case 'cepo': b.box(0, 0, 0, 0.9, h * 0.6, 0.7, W, { ao: 0 }); break;
    case 'mina': b.cyl(0, 0, 0, 0.3, 0.3, h, W, 16, { ao: 0 }); break;
    case 'barril': b.cyl(0, 0, 0, 0.31, 0.31, h, W, 16, { ao: 0 }); break;
    case 'valla': b.box(0, 0, 0, 1, h, 0.14, W, { ao: 0.06 }); break;
    case 'alambre': b.box(0, 0, 0, 0.98, h, 0.5, W, { ao: 0 }); break;
    case 'foco': b.cyl(0, 0, 0, 0.3, 0.3, h, W, 16, { ao: 0 }); break;
    default: b.box(0, 0, 0, 0.96, h, 0.96, W, { ao: 0.06 });
  }
  return finish(b);
}

/**
 * Superposición de daño para el transformador (huella 2×1 en X, centrada en 0,0,0, mirando a +Z): chapa
 * de acceso arrancada con el hueco chamuscado, chispas y humo. Pensada para un cuerpo de ~1,4 m de alto
 * (las chispas están entre 0,6 y 1,3 m y el humo hasta ~2,1 m). Si el transformador es distinto, escalar en Y.
 */
export function transformerDamageGeometry() {
  const b = new PropBuilder();
  b.root(0, 0, 0);
  const r = rng(777);
  const zf = 0.505;
  // hueco chamuscado con cables
  b.box(0.35, 0.45, zf, 0.7, 0.62, 0.012, 0x16181b, { ao: 0 });
  for (const [x, y, w, h, c] of [[0.1, 0.5, 0.06, 0.5, 0x2a2118], [0.55, 0.9, 0.5, 0.1, 0x2a2118], [-0.35, 0.3, 0.4, 0.45, 0x3a342c]]) b.box(x, y, zf + 0.002, w, h, 0.008, c, { ao: 0 });
  for (const [x, y, c] of [[0.2, 0.7, 0xe58a3a], [0.38, 0.62, 0xd24a3e], [0.5, 0.78, 0xeab43c]]) {
    b.box(x, y, zf + 0.012, 0.015, 0.22, 0.015, c, { ao: 0, rz: (r() - 0.5) * 0.8 });
  }
  // chapa arrancada, colgando de la bisagra superior
  b.box(0.35, 1.08, zf + 0.012, 0.7, 0.62, 0.03, 0x8b939c, { rx: -0.2, oy: -0.62, ao: 0.1 });
  b.box(0.7, 0.5, zf + 0.06, 0.12, 0.2, 0.03, 0x70777f, { rx: -0.5, rz: 0.4, ao: 0.1 });    // esquina doblada
  // chispas
  for (let k = 0; k < 14; k++) {
    const x = -0.15 + r() * 0.95, y = 0.65 + r() * 0.65;
    cone(b, x, y, zf + 0.04 + r() * 0.1, 0.018, 0.08 + r() * 0.08, 3, 0xff9a2a, 0xfff6c0, { axis: ['y', '+x', '-x'][k % 3], lean: [(r() - 0.5) * 0.16, (r() - 0.5) * 0.16], rot: r() * 6 });
  }
  // humo
  const smoke = [[0.1, 1.62, 0.1, 0.5], [-0.15, 1.82, -0.05, 0.42], [0.25, 1.95, 0.0, 0.34], [-0.45, 1.55, 0.1, 0.3], [0.55, 1.5, -0.1, 0.28]];
  smoke.forEach(([x, y, z, s], k) => b.sphere(x, y, z, s * 1.1, s * 0.85, s, k % 2 ? 0x55585e : 0x3e4045, 7, { ao: 0.3 }));
  return finish(b);
}
