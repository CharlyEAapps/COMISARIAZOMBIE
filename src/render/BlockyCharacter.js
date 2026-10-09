import * as THREE from 'three';

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
