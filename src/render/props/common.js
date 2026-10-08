// Paleta "maqueta" y piezas pequeñas reutilizables (monitor, teclado, taza, papeles…).
// Convención de los builders: origen en el centro de la huella sobre el suelo, frente = +Z local.

export const C = {
  white: 0xf3f1ea, cream: 0xf0e6d0, paper: 0xfaf8f0, paperD: 0xe6e2d2,
  wood: 0xc79a64, woodL: 0xe0bd8c, woodD: 0x8a5e3a, woodDD: 0x5e3d26,
  steel: 0xb4bcc6, steelL: 0xd3d9df, steelD: 0x6c7580, iron: 0x3e444c, black: 0x24272c,
  blue: 0x2f5fa8, blueL: 0x6a8cb8, navy: 0x1f3260, sky: 0x8fc0e8, skyL: 0xcfe6f6,
  red: 0xd24a3e, redD: 0x9c2f26, orange: 0xe58a3a, yellow: 0xeab43c, yellowL: 0xf4d77a,
  green: 0x4f9a68, greenL: 0x7fc08a, greenD: 0x2f6b48, mint: 0xa8d5ba, teal: 0x4fa6a0,
  pink: 0xe8a3a8, purple: 0x8a6fb0, kraft: 0xc89c62, kraftD: 0xa57c46, kraftL: 0xdcb87e,
  terracotta: 0xc9714a, grass: 0x9cbb72, asphalt: 0x9a9ca1, concrete: 0xc4c4c0,
  lampWarm: 0xffe7a6, screenBlue: 0x8fd0ff,
};

export const PI = Math.PI;

/** Monitor sobre peana con pantalla emisiva (sprite del atlas) y ancla de luz 'pantalla'. */
export function monitor(b, x, y, z, o = {}) {
  const w = o.w ?? 0.46, h = o.h ?? 0.28, screen = o.screen ?? 'pantalla_pc';
  b.box(x, y, z, 0.2, 0.014, 0.15, C.iron, { ao: 0 });
  b.box(x, y + 0.014, z - 0.02, 0.045, 0.1, 0.03, C.iron);
  const y0 = y + 0.1;
  b.box(x, y0, z, w + 0.04, h + 0.04, 0.035, C.black, { ao: 0.05 });
  b.sprite(screen, x, y0 + (h + 0.04) / 2, z + 0.0185, w, h, { screen: true });
  b.light('pantalla', x, y0 + h / 2, z + 0.12, 0x8fd0ff);
}

export function keyboard(b, x, y, z, ry = 0) {
  b.box(x, y, z, 0.38, 0.018, 0.13, 0xcfd3d9, { ao: 0.1, ry });
  b.box(x, y + 0.018, z, 0.34, 0.006, 0.1, 0x8b929c, { ao: 0, ry });
}
export const mouse = (b, x, y, z) => b.box(x, y, z, 0.06, 0.026, 0.1, 0x2b2e33, { ao: 0.1 });

export function mug(b, x, y, z, color = C.white) {
  b.cyl(x, y, z, 0.04, 0.036, 0.09, color, 8);
  b.box(x + 0.052, y + 0.02, z, 0.025, 0.05, 0.015, color, { ao: 0 });
  b.cyl(x, y + 0.085, z, 0.034, 0.034, 0.006, 0x5a3a22, 8, { ao: 0 });
}

export function papers(b, x, y, z, rnd, n = 3) {
  for (let k = 0; k < n; k++) {
    b.box(x + (rnd() - 0.5) * 0.04, y + k * 0.006, z + (rnd() - 0.5) * 0.04, 0.21, 0.005, 0.3, k % 2 ? C.paper : C.paperD, { ry: (rnd() - 0.5) * 0.5, ao: 0 });
  }
}

export function deskLamp(b, x, y, z, ry = 0) {
  b.cyl(x, y, z, 0.07, 0.08, 0.02, C.iron, 10);
  b.box(x, y + 0.02, z, 0.02, 0.26, 0.02, C.steelD, { rz: 0.0 });
  b.box(x, y + 0.27, z, 0.02, 0.2, 0.02, C.steelD, { rx: -1.0, ry });
  b.push(x, y + 0.4, z, ry);
  b.cyl(0, 0, 0.12, 0.03, 0.075, 0.09, C.green, 10, { rx: 0.5 });
  b.cyl(0, 0, 0.12, 0.05, 0.05, 0.02, C.lampWarm, 8, { layer: 'glow', oy: -0.004, ao: 0, rx: 0.5 });
  b.light('lampara', 0, -0.02, 0.15, C.lampWarm);
  b.pop();
}

export function phone(b, x, y, z, ry = 0, color = C.iron) {
  b.box(x, y, z, 0.17, 0.05, 0.21, color, { ry });
  b.box(x, y + 0.05, z, 0.05, 0.03, 0.2, C.black, { ry });
  b.box(x, y + 0.05, z + 0.01, 0.15, 0.015, 0.05, color, { ry });
}

/** Maceta con planta de hojas en abanico (puro bloque). */
export function plantInPot(b, x, z, scale, rnd, potColor = C.terracotta) {
  const s = scale;
  b.cyl(x, 0, z, 0.19 * s, 0.14 * s, 0.34 * s, potColor, 10);
  b.cyl(x, 0.34 * s, z, 0.2 * s, 0.2 * s, 0.03 * s, 0xa9583a, 10);
  b.cyl(x, 0.35 * s, z, 0.17 * s, 0.17 * s, 0.03 * s, 0x4a3426, 10, { ao: 0 });
  const greens = [C.green, C.greenL, C.greenD];
  const n = 9;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * PI * 2 + rnd() * 0.5;
    const tilt = 0.2 + rnd() * 0.35;
    const len = (0.38 + rnd() * 0.3) * s;
    b.box(x, 0.37 * s, z, 0.13 * s, len, 0.025, greens[k % 3], { ry: a, rx: tilt, ao: 0.1 });
  }
  b.box(x, 0.37 * s, z, 0.03, 0.55 * s, 0.03, C.greenD, { ao: 0 });
}

/** Rodilla de ruedas/estrella de una silla giratoria. */
export function swivelBase(b, x, z, color = C.iron) {
  b.cyl(x, 0.07, z, 0.025, 0.03, 0.28, C.steelD, 8);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * PI * 2;
    b.box(x, 0.04, z, 0.28, 0.025, 0.04, color, { ry: a, ox: 0.14, ao: 0.05 });
    b.box(x + Math.cos(a) * 0.27, 0, z - Math.sin(a) * 0.27, 0.05, 0.045, 0.05, C.black, { ao: 0 });
  }
}

/** Caja de cartón con cinta. */
export function cardboard(b, x, y, z, w, h, d, ry = 0, color = C.kraft) {
  b.box(x, y, z, w, h, d, color, { ry, ao: 0.1 });
  b.box(x, y + h - 0.004, z, w * 0.18, 0.008, d + 0.004, C.kraftL, { ry, ao: 0 });
  b.box(x, y + h * 0.5, z, w + 0.004, h * 0.12, d * 0.0 + 0.004, C.kraftD, { ry, ao: 0, oz: d / 2 });
}
