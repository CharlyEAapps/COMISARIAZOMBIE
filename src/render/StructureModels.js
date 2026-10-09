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

// ---------------------------------------------------------------- API pública

/**
 * Geometría de una pieza de construcción.
 * @param {'barricada'|'sacos'|'puerta'|'pinchos'|'cepo'|'mina'} type
 * @param {number} level índice de nivel (0..n-1; se limita al rango de build.json)
 * @returns {THREE.BufferGeometry} no indexada; position + normal + color (lineal), sin uv.
 *   Coordenadas locales de la celda (centro en 0,0,0; base en y=0); la pieza corre a lo largo de X.
 *   La mina incluye el piloto rojo como color; para que brille, superponer mineLightGeometry().
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
