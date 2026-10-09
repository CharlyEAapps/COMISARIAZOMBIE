import { PropBuilder } from './props/Builder.js';

// Accesorios de los zombis especiales (casco y escudo del jefe, pústulas del explosivo,
// buche del escupidor). Cada uno va pegado a una parte del cuerpo y se dibuja con un
// InstancedMesh propio. Coordenadas en el espacio de esa parte, sin escalar:
//  - head: base de la cabeza en y = 0, caja de 0,38 de lado centrada en X y Z.
//  - torso: base en la cadera (y = 0), 0,5 × 0,62 × 0,28.
//  - armR: pivote en el hombro, el brazo cuelga hacia -Y (mano en y ≈ -0,6).
//  - base: el personaje entero (pies en y = 0, mirando a +Z).

function geo(build) {
  const b = new PropBuilder();
  b.root(0, 0, 0);
  build(b);
  const g = b.toGeometry('solid');
  g.computeBoundingSphere();
  return g;
}

const NAVY = 0x1b2433, NAVY_D = 0x111824, VISOR = 0x34414f;

export const ACCESSORIES = {
  casco: {
    part: 'head',
    geometry: () => geo((b) => {
      b.box(0, 0.2, 0, 0.46, 0.24, 0.46, NAVY, { ao: 0.1 });
      b.box(0, 0.44, 0, 0.38, 0.05, 0.38, NAVY_D, { ao: 0 });
      b.box(0, 0.08, 0.215, 0.42, 0.22, 0.03, VISOR, { ao: 0, rx: -0.12 });
      b.box(0, 0.31, 0.235, 0.46, 0.05, 0.05, NAVY_D, { ao: 0 });
      b.box(0, 0.02, -0.225, 0.42, 0.2, 0.04, NAVY_D, { ao: 0.1 });
      b.box(0.235, 0.16, 0, 0.03, 0.08, 0.12, 0xd8d8d8, { ao: 0 });
    }),
  },
  escudo: {
    part: 'base',
    geometry: () => geo((b) => {
      const z = 0.6;
      b.box(-0.06, 0.28, z, 0.86, 1.22, 0.05, 0x4a5868, { ao: 0.15 });
      b.box(-0.06, 0.25, z, 0.92, 0.05, 0.08, 0x20262e, { ao: 0 });
      b.box(-0.06, 1.5, z, 0.92, 0.05, 0.08, 0x20262e, { ao: 0 });
      for (const sx of [-1, 1]) b.box(-0.06 + sx * 0.44, 0.25, z, 0.05, 1.3, 0.08, 0x20262e, { ao: 0 });
      b.box(-0.06, 1.08, z + 0.03, 0.62, 0.11, 0.01, 0xf0f0f0, { ao: 0 });
      b.box(-0.06, 1.24, z + 0.03, 0.5, 0.14, 0.01, 0x8fa6ba, { ao: 0 });
      b.box(-0.06, 0.55, z + 0.03, 0.14, 0.14, 0.01, 0xe8c23a, { ao: 0 });
    }),
  },
  porra: {
    part: 'armR',
    geometry: () => geo((b) => {
      b.box(0, -0.66, 0.18, 0.07, 0.07, 0.62, 0x15181c, { ao: 0 });
      b.box(0, -0.66, -0.02, 0.09, 0.09, 0.08, 0x2b2f35, { ao: 0 });
    }),
  },
  pustulas: {
    part: 'torso',
    geometry: () => geo((b) => {
      const spots = [
        [0.1, 0.38, 0.14, 0.14], [-0.12, 0.22, 0.14, 0.12], [0.02, 0.1, 0.14, 0.1], [-0.05, 0.5, 0.14, 0.09],
        [0.25, 0.3, 0, 0.12], [-0.25, 0.42, 0.03, 0.11], [0.2, 0.12, -0.08, 0.09], [-0.15, 0.3, -0.14, 0.12],
      ];
      for (const [x, y, z, s] of spots) {
        b.box(x, y, z, s, s, s, 0xb9cc4e, { ao: 0.1 });
        b.box(x, y + s * 0.3, z + Math.sign(z || 1) * s * 0.35, s * 0.45, s * 0.45, s * 0.45, 0xe8a03a, { ao: 0 });
      }
    }),
  },
  buche: {
    part: 'head',
    geometry: () => geo((b) => {
      b.box(0, -0.1, 0.11, 0.3, 0.17, 0.2, 0x93bb52, { ao: 0.1 });
      b.box(0, -0.14, 0.18, 0.22, 0.11, 0.1, 0xb4dc64, { ao: 0 });
      b.box(0.05, -0.28, 0.21, 0.03, 0.16, 0.03, 0xa6e05e, { ao: 0 });
      b.box(-0.06, -0.22, 0.2, 0.025, 0.1, 0.025, 0xa6e05e, { ao: 0 });
    }),
  },
};

/** Accesorios de cada tipo de zombi (zombies.json → "accessory"). */
export const ACCESSORY_SETS = {
  antidisturbios: ['casco', 'escudo', 'porra'],
  pustulas: ['pustulas'],
  buche: ['buche'],
};
