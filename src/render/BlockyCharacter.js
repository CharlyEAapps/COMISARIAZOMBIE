import * as THREE from 'three';
import config from '../data/config.json';

// Personaje "de bloques" (estilo vóxel) compartido por el policía y los zombis.
// Cada parte tiene su pivote (cadera, hombro, cuello) para animar por rotación.
// Medidas en metros; altura total ≈ 1,78 m.
export const PARTS = {
  legL:  { size: [0.22, 0.75, 0.24], pivot: [-0.12, 0.75, 0], hang: true },
  legR:  { size: [0.22, 0.75, 0.24], pivot: [0.12, 0.75, 0], hang: true },
  torso: { size: [0.5, 0.62, 0.28], pivot: [0, 0.75, 0], hang: false },
  armL:  { size: [0.17, 0.6, 0.2], pivot: [-0.335, 1.34, 0], hang: true },
  armR:  { size: [0.17, 0.6, 0.2], pivot: [0.335, 1.34, 0], hang: true },
  head:  { size: [0.38, 0.38, 0.38], pivot: [0, 1.37, 0], hang: false },
};
export const PART_NAMES = Object.keys(PARTS);
/** Dónde se sujeta el arma en el brazo derecho (espacio del brazo). */
export const WEAPON_MOUNT = { position: new THREE.Vector3(0, -0.62, 0.06), rotationX: Math.PI / 2 };

/** Geometría de una parte con el origen en su pivote (las extremidades cuelgan hacia abajo). */
export function partGeometry(name) {
  const p = PARTS[name];
  const g = new THREE.BoxGeometry(...p.size);
  g.translate(0, p.hang ? -p.size[1] / 2 : p.size[1] / 2, 0);
  return g;
}

/**
 * Pose de caminar/atacar. Rellena `out[name] = {x, z}` (rotaciones en radianes).
 * @param {number} phase fase del ciclo de paso
 * @param {number} amount 0 = quieto, 1 = paso completo
 * @param {'police'|'zombie'} style
 */
export function computePose(out, phase, amount, style, attack = 0) {
  const swing = Math.sin(phase) * 0.7 * amount;
  out.legL.x = swing;
  out.legR.x = -swing;
  out.legL.z = out.legR.z = 0;
  out.torso.x = 0; out.torso.z = 0;
  out.head.x = 0; out.head.z = 0;
  if (style === 'zombie') {
    // Brazos extendidos hacia delante, con un balanceo leve; el ataque los baja de golpe.
    const reach = -1.45 + Math.sin(phase * 0.5) * 0.12 + attack * 0.9;
    out.armL.x = reach + swing * 0.15;
    out.armR.x = reach - swing * 0.15;
    out.armL.z = -0.08; out.armR.z = 0.08;
    out.torso.x = 0.12;
    out.head.z = Math.sin(phase * 0.5) * 0.12;
    out.head.x = 0.1;
  } else {
    // Policía: brazo derecho apuntando, el izquierdo sujetando el arma.
    out.armR.x = -Math.PI / 2;
    out.armR.z = 0;
    out.armL.x = -1.2;
    out.armL.z = 0.55;
  }
}

export function makePose() {
  const o = {};
  for (const n of PART_NAMES) o[n] = { x: 0, z: 0 };
  return o;
}

const POLICE_COLORS = {
  legL: 0x1c2333, legR: 0x1c2333,
  torso: 0x2a4377,
  armL: 0x2a4377, armR: 0x2a4377,
  head: 0xe2b48c,
};

/** Policía como grupo de mallas normales (solo hay uno). */
export function buildPolice() {
  const root = new THREE.Group();
  const parts = {};
  for (const name of PART_NAMES) {
    const mesh = new THREE.Mesh(partGeometry(name), new THREE.MeshStandardMaterial({ color: POLICE_COLORS[name], roughness: 0.8 }));
    mesh.position.fromArray(PARTS[name].pivot);
    mesh.castShadow = true;
    root.add(mesh);
    parts[name] = mesh;
  }
  // Gorra con visera.
  const capMat = new THREE.MeshStandardMaterial({ color: 0x141b2b, roughness: 0.7 });
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.4), capMat);
  cap.position.set(0, 0.42, 0);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 0.16), capMat);
  visor.position.set(0, 0.37, 0.25);
  parts.head.add(cap, visor);
  // Placa dorada y ojos.
  const badge = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.02), new THREE.MeshStandardMaterial({ color: 0xe8c23a, metalness: 0.6, roughness: 0.3 }));
  badge.position.set(-0.13, 0.45, 0.15);
  parts.torso.add(badge);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
  for (const x of [-0.08, 0.08]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.02), eyeMat);
    eye.position.set(x, 0.2, 0.195);
    parts.head.add(eye);
  }
  // Soporte del arma en la mano derecha: con el brazo estirado, su +Z sigue al brazo y su +Y
  // queda hacia arriba (convención de WeaponModels). El Player cuelga ahí el arma actual.
  const mount = new THREE.Object3D();
  mount.position.copy(WEAPON_MOUNT.position);
  mount.rotation.x = WEAPON_MOUNT.rotationX;
  parts.armR.add(mount);
  // Punto de salida del disparo, en coordenadas del arma (lo coloca el Player según el arma).
  const muzzle = new THREE.Object3D();
  mount.add(muzzle);
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { root, parts, mount, muzzle };
}

// ---------------------------------------------------------------------------------------------
// Animación (funciones puras, sin asignaciones: reciben el objeto de salida)
// ---------------------------------------------------------------------------------------------
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Suavizado 0→1 entre a y b (smoothstep). */
export function smooth(a, b, v) {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/**
 * Curva del ángulo de caída de un zombi muerto (t y resultado en 0..1): arranca despacio,
 * acelera (gravedad) y rebota un poco al tocar el suelo.
 */
export function fallCurve(t, cfg = config.fx.zombieDeath) {
  const c = clamp01(t);
  if (c >= 1) return 1;
  if (c < cfg.settleStart) return Math.pow(c / cfg.settleStart, cfg.fallPower);
  const k = (c - cfg.settleStart) / (1 - cfg.settleStart);
  return 1 - cfg.settleBounce * Math.sin(k * Math.PI);
}

/** Intensidad (1→0) de la reacción a un impacto `age` segundos después de recibirlo. */
export function hitReaction(age, time) {
  if (age < 0 || age >= time) return 0;
  const k = 1 - age / time;
  return k * k;
}

/**
 * Giros (x, z) que apuntan un brazo "de un solo hueso" desde el hombro (sx,sy,sz) hacia el
 * punto (tx,ty,tz). Con orden de Euler XYZ, la dirección (0,-1,0) del brazo gira primero en
 * Z y luego en X: dir = (sin z, -cos z·cos x, -cos z·sin x).
 */
export function armAnglesToward(out, sx, sy, sz, tx, ty, tz) {
  const dx = tx - sx, dy = ty - sy, dz = tz - sz;
  const l = Math.hypot(dx, dy, dz) || 1;
  out.z = Math.asin(Math.max(-1, Math.min(1, dx / l)));
  out.x = Math.atan2(-dz / l, -dy / l);
  return out;
}

/**
 * Punto (wx,wy,wz) del arma en el espacio del personaje, con el brazo derecho girado `armX`.
 * El soporte del arma gira con el brazo: Rx(armX+90°)·p + Rx(armX)·montaje + hombro.
 */
export function weaponPointInChar(out, armX, wx, wy, wz) {
  const a = armX + WEAPON_MOUNT.rotationX;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(armX), sb = Math.sin(armX);
  const my = WEAPON_MOUNT.position.y, mz = WEAPON_MOUNT.position.z;
  const piv = PARTS.armR.pivot;
  out.x = piv[0] + wx;
  out.y = piv[1] + wy * ca - wz * sa + my * cb - mz * sb;
  out.z = piv[2] + wy * sa + wz * ca + my * sb + mz * cb;
  return out;
}

/**
 * Fases de la animación de recarga para el progreso p (0→1). Rellena `out`:
 *  lower  0..1  cuánto baja y se ladea el arma,
 *  belt   0..1  peso de la mano izquierda yendo a la cartuchera,
 *  mag    0..1  peso de la mano izquierda en el cargador del arma,
 *  hasMag       si lleva el cargador en la mano,
 *  bump   0..1  sacudida al encajar el cargador.
 */
export function reloadPhases(out, p, cfg = config.fx.player.reload) {
  const q = clamp01(p);
  out.lower = smooth(0, cfg.lowerAt, q) * (1 - smooth(cfg.raiseFrom, 1, q));
  out.belt = smooth(0, cfg.beltAt, q) - smooth(cfg.beltAt, cfg.handoffAt, q);
  out.mag = smooth(cfg.beltAt, cfg.handoffAt, q) - smooth(cfg.returnAt, cfg.backAt, q);
  out.hasMag = q > cfg.beltAt && q < cfg.insertAt;
  out.bump = Math.max(0, 1 - Math.abs(q - cfg.insertAt) / cfg.bumpWidth);
  return out;
}
