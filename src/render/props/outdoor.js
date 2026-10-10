import { C, PI } from './common.js';

// Props bloqueantes del exterior: coches, furgoneta, contenedores, farolas, árboles,
// mástiles, caseta de vigilancia y generador.

export const OUTDOOR = {};
const add = (name, def) => { OUTDOOR[name] = { blocking: true, ...def }; };

const WHEEL = (b, x, z, r = 0.3, w = 0.22) => {
  b.cyl(x, r, z, r, r, w, C.black, 12, { rx: PI / 2, oy: -w / 2, ao: 0 });
  b.cyl(x, r, z + (z > 0 ? w / 2 + 0.004 : -w / 2 - 0.004), r * 0.55, r * 0.55, 0.01, C.steelL, 10, { rx: PI / 2, ao: 0 });
};

/** Sirenas: cúpulas roja (capa 'red') y azul (capa 'blue') sobre una base. */
function lightBar(b, x, y, len = 1.2, rnd) {
  const half = len / 2;
  b.box(x, y, 0, 0.36, 0.045, len, C.iron);
  b.box(x, y + 0.045, -half / 2 - 0.01, 0.3, 0.11, half - 0.06, 0xff3a3a, { layer: 'red', ao: 0.05 });
  b.box(x, y + 0.045, half / 2 + 0.01, 0.3, 0.11, half - 0.06, 0x3a6aff, { layer: 'blue', ao: 0.05 });
  b.box(x, y + 0.045, 0, 0.3, 0.11, 0.1, C.white, { ao: 0.05 });
  b.box(x, y + 0.155, 0, 0.32, 0.015, len - 0.04, C.iron, { ao: 0 });
  b.light('sirena', x, y + 0.2, -half / 2, 0xff2a2a);
  b.light('sirena', x, y + 0.2, half / 2, 0x2a5aff);
}

function sedan(b, fp, o) {
  const L = 3.92, W = 1.66, body = o.body, stripe = o.stripe, roof = o.roof ?? body;
  for (const sx of [-1.22, 1.2]) for (const sz of [-1, 1]) WHEEL(b, sx, sz * (W / 2 - 0.08));
  b.box(0, 0.18, 0, L, 0.5, W, body);                                  // carrocería baja
  if (stripe != null) b.box(0, 0.36, 0, L + 0.012, 0.16, W + 0.012, stripe, { ao: 0 });
  b.box(1.4, 0.68, 0, 1.1, 0.1, W - 0.06, body);                       // capó
  b.box(-1.5, 0.68, 0, 0.85, 0.12, W - 0.06, body);                    // maletero
  b.box(-0.05, 0.68, 0, 1.9, 0.3, W - 0.1, 0x2a3a4f, { ao: 0.05 });  // cristales bajos
  b.box(-0.15, 0.98, 0, 1.36, 0.2, W - 0.2, 0x2a3a4f, { ao: 0.05 });  // cristales altos
  b.box(-0.15, 1.18, 0, 1.44, 0.06, W - 0.2, roof);                    // techo
  for (const sz of [-1, 1]) {
    for (const px of [-0.95, -0.12, 0.84]) b.box(px, 0.68, sz * (W / 2 - 0.045), 0.08, 0.3, 0.05, body, { ao: 0.05 });
    for (const px of [-0.8, -0.12, 0.55]) b.box(px, 0.98, sz * (W / 2 - 0.1), 0.07, 0.2, 0.05, body, { ao: 0.05 });
    b.box(-0.45, 0.5, sz * (W / 2 + 0.004), 0.012, 0.3, 0.005, 0x4a4f57, { ao: 0 });
    b.box(0.4, 0.5, sz * (W / 2 + 0.004), 0.012, 0.3, 0.005, 0x4a4f57, { ao: 0 });
    b.box(0.2, 0.56, sz * (W / 2 + 0.012), 0.12, 0.025, 0.02, C.steelD, { ao: 0 });
    b.box(0.9, 0.88, sz * (W / 2 + 0.06), 0.1, 0.08, 0.1, body, { ao: 0.05 });
  }
  // parachoques, parrilla, faros y pilotos
  b.box(L / 2 + 0.03, 0.14, 0, 0.1, 0.2, W - 0.06, C.iron);
  b.box(-L / 2 - 0.03, 0.14, 0, 0.1, 0.2, W - 0.06, C.iron);
  b.box(L / 2 + 0.002, 0.36, 0, 0.02, 0.12, 0.7, C.black, { ao: 0 });
  for (const sz of [-1, 1]) {
    b.box(L / 2 + 0.002, 0.45, sz * 0.58, 0.03, 0.09, 0.22, 0xfff2c0, { layer: 'glow', ao: 0 });
    b.box(-L / 2 - 0.002, 0.45, sz * 0.58, 0.03, 0.09, 0.22, 0xff3030, { layer: 'glow', ao: 0 });
  }
  b.box(-L / 2 - 0.002, 0.36, 0, 0.02, 0.07, 0.3, C.white, { ao: 0 });
  b.light('lampara', L / 2 + 0.2, 0.5, 0.58, 0xfff2c0);
  b.light('lampara', L / 2 + 0.2, 0.5, -0.58, 0xfff2c0);
}

add('patrulla', {
  build(b, fp) {
    const blue = fp.variant === 'azul';
    sedan(b, fp, { body: blue ? C.blue : 0xf3f1ea, stripe: blue ? C.white : C.blue, roof: blue ? C.white : 0xf3f1ea });
    for (const sz of [-1, 1]) {
      b.push(0, 0, sz * 0.838, sz > 0 ? 0 : PI);
      b.sprite('policia_lado', sz > 0 ? -0.1 : 0.1, 0.4, 0, 1.3, 0.254);
      b.pop();
    }
    b.box(1.96, 0.62, -0.32, 0.03, 0.04, 0.12, 0xff3a3a, { layer: 'red', ao: 0 });
    b.box(1.96, 0.62, 0.32, 0.03, 0.04, 0.12, 0x3a6aff, { layer: 'blue', ao: 0 });
    lightBar(b, -0.1, 1.24, 1.15);
    b.cyl(-0.4, 1.24, 0, 0.015, 0.015, 0.2, C.iron, 6); // antena
    b.interact('coche_sirena', 'Sirena del coche', 0.3, (fp.rot === 0 ? 1 : -1) * (fp.ld / 2 + 0.5));
  },
});

add('civil', {
  build(b, fp) {
    const col = fp.variant && /^#?[0-9a-f]{6}$/i.test(String(fp.variant)) ? parseInt(String(fp.variant).replace('#', ''), 16) : [0xd9a441, 0x4fa6a0, 0xc2564b, 0x7d8794][fp.seed % 4];
    sedan(b, fp, { body: col, stripe: null });
  },
});

add('furgoneta', {
  build(b, fp) {
    const W = 1.7, white = 0xf3f1ea;
    for (const sx of [-1.15, 1.25]) for (const sz of [-1, 1]) WHEEL(b, sx, sz * (W / 2 - 0.08), 0.32, 0.24);
    b.box(0, 0.2, 0, 3.92, 0.55, W, white);
    b.box(0, 0.36, 0, 3.93, 0.18, W + 0.012, C.blue, { ao: 0 });
    b.box(-0.55, 0.75, 0, 2.7, 1.0, W - 0.02, white);                   // caja
    b.box(0.95, 0.75, 0, 1.05, 0.62, W - 0.06, 0x2a3a4f, { ao: 0.05 }); // cabina acristalada
    b.box(0.95, 1.37, 0, 1.15, 0.06, W - 0.04, white);
    b.box(1.65, 0.75, 0, 0.55, 0.1, W - 0.06, white);                    // capó
    for (const sz of [-1, 1]) {
      b.box(0.5, 0.75, sz * (W / 2 - 0.05), 0.07, 0.62, 0.05, white, { ao: 0.05 });
      b.box(1.35, 0.75, sz * (W / 2 - 0.05), 0.07, 0.62, 0.05, white, { ao: 0.05 });
      b.box(1.0, 0.93, sz * (W / 2 + 0.06), 0.1, 0.08, 0.1, white, { ao: 0.05 });
      b.box(0.95, 0.4, sz * (W / 2 + 0.01), 0.012, 0.7, 0.005, 0x4a4f57, { ao: 0 });
      b.push(0, 0, sz * (W / 2 - 0.02 + 0.016), sz > 0 ? 0 : PI);
      b.sprite('policia_lado', sz > 0 ? -0.6 : 0.6, 1.25, 0, 1.9, 0.371);
      b.pop();
    }
    // luna trasera con rejilla y puertas
    b.box(-L2(), 0.95, 0, 0.012, 0.5, 1.2, 0x2a3a4f, { ao: 0 });
    for (let k = 0; k < 6; k++) b.box(-L2() - 0.01, 0.95, -0.5 + k * 0.2, 0.012, 0.5, 0.025, C.iron, { ao: 0 });
    b.box(-L2() - 0.01, 0.75, 0, 0.01, 1.0, 0.012, 0x4a4f57, { ao: 0 });
    // paragolpes, parrilla y faros
    b.box(2.0, 0.16, 0, 0.1, 0.22, W - 0.06, C.iron);
    b.box(-1.97, 0.16, 0, 0.1, 0.22, W - 0.06, C.iron);
    b.box(1.93, 0.45, 0, 0.02, 0.14, 0.8, C.black, { ao: 0 });
    for (const sz of [-1, 1]) {
      b.box(1.93, 0.5, sz * 0.66, 0.03, 0.1, 0.22, 0xfff2c0, { layer: 'glow', ao: 0 });
      b.box(-1.96, 0.55, sz * 0.7, 0.03, 0.12, 0.14, 0xff3030, { layer: 'glow', ao: 0 });
    }
    b.box(1.93, 0.66, -0.34, 0.03, 0.04, 0.12, 0xff3a3a, { layer: 'red', ao: 0 });
    b.box(1.93, 0.66, 0.34, 0.03, 0.04, 0.12, 0x3a6aff, { layer: 'blue', ao: 0 });
    lightBar(b, 0.95, 1.43, 1.2);
    b.box(-0.9, 1.75, 0, 0.5, 0.1, 0.5, C.steelL);   // ventilador
  },
});
const L2 = () => 1.97;

// ---------------------------------------------------------------- contenedor de basura
add('contenedor', {
  build(b, fp) {
    const w = fp.lw - 0.12, d = fp.ld - 0.14, rnd = fp.rnd;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      b.cyl(sx * (w / 2 - 0.15), 0.1, sz * (d / 2 - 0.1), 0.1, 0.1, 0.1, C.black, 8, { rx: PI / 2, oy: -0.05, ao: 0 });
    }
    b.box(0, 0.12, 0, w, 0.98, d, 0x3f7a5a);
    b.box(0, 0.12, 0, w + 0.03, 0.08, d + 0.03, 0x2c5a40, { ao: 0 });
    b.box(0, 0.55, 0, w + 0.02, 0.05, d + 0.02, 0x2c5a40, { ao: 0 });
    b.box(0, 1.0, 0, w + 0.04, 0.1, d + 0.04, 0x2c5a40, { ao: 0.05 });
    for (const s of [-1, 1]) {
      b.box(s * 0.7, 1.1, 0, 1.38, 0.07, d + 0.04, 0x4a8d68, { rz: s * 0.0, ao: 0.05 });
      b.box(s * 0.7, 1.17, d / 2 - 0.12, 1.0, 0.07, 0.05, 0x2c5a40, { ao: 0 });
    }
    for (let k = 0; k < 3; k++) b.box(-w / 2 + 0.4 + k * 0.5, 0.2, d / 2 + 0.01, 0.2, 0.28, 0.005, C.yellow, { ao: 0 });
    b.box(0.0, 0.62, d / 2 + 0.008, 0.9, 0.26, 0.005, C.paper, { ao: 0 });
    b.sphere(-0.5, 1.15, -0.1, 0.62, 0.4, 0.55, 0x1d2430, 8);
    b.sphere(0.7, 1.15, 0.2, 0.5, 0.34, 0.45, 0x3a4a6a, 8);
    b.box(-0.9, 1.18, 0.25, 0.28, 0.1, 0.22, C.kraft, { ry: rnd() });
  },
});

// ---------------------------------------------------------------- farola
add('farola', {
  build(b) {
    b.cyl(0, 0, 0, 0.13, 0.17, 0.38, C.iron, 10);
    b.cyl(0, 0.38, 0, 0.045, 0.065, 3.82, 0x484f58, 8);
    b.box(0.22, 4.12, 0, 0.5, 0.05, 0.07, 0x484f58);
    b.box(0.32, 4.1, 0, 0.34, 0.08, 0.2, 0x5a6270);
    b.box(0.32, 4.06, 0, 0.3, 0.025, 0.16, 0xffeab0, { layer: 'glow', ao: 0 });
    b.light('farola', 0.32, 4.05, 0, 0xffe3a0);
  },
});

// ---------------------------------------------------------------- árbol y mástil
add('arbol', {
  ground: true,
  build(b, fp) {
    const rnd = fp.rnd;
    b.box(0, 0, 0, 0.26, 1.15, 0.26, C.woodD);
    b.box(0.0, 0.0, 0, 0.36, 0.1, 0.36, C.woodDD, { ao: 0 });
    const g = [C.green, C.greenL, C.greenD];
    b.box(0, 0.9, 0, 0.92, 0.55, 0.92, g[0], { ry: 0.0 });
    b.box(0, 1.4, 0, 0.78, 0.5, 0.78, g[1], { ry: 0.3 });
    b.box(0, 1.85, 0, 0.55, 0.45, 0.55, g[2], { ry: 0.15 });
    b.box(0.2 + rnd() * 0.1, 1.25, 0.25, 0.14, 0.14, 0.14, C.red, { ao: 0 });
    b.box(-0.25, 0.85, 0.3, 0.14, 0.14, 0.14, C.yellow, { ao: 0 });
  },
});

add('mastil', {
  ground: true,
  build(b) {
    b.cyl(0, 0, 0, 0.36, 0.42, 0.14, C.concrete, 12);
    b.cyl(0, 0.14, 0, 0.2, 0.26, 0.12, 0xa8a8a2, 12);
    b.cyl(0, 0.26, 0, 0.032, 0.048, 5.3, C.steelL, 8, { ao: 0.05 });
    b.sphere(0, 5.52, 0, 0.14, 0.14, 0.14, C.yellow, 8);
  },
  companions: (fp) => [{ type: 'bandera_mastil', lx: 0, lz: 0, rel: 0, p: { y: 4.3, sprite: fp.variant === 'pol' ? 'bandera_pol' : 'bandera_es' } }],
});

// ---------------------------------------------------------------- torre de vigilancia
/**
 * Torre del patio sur: patas de acero, escalera y plataforma con sacos terreros. La torreta de
 * la mejora "Torre de vigilancia" (despacho.json → torreta_tejado.roofY) se monta encima.
 */
add('torre_vigilancia', {
  ground: true,
  build(b, fp) {
    const w = fp.lw - 0.3, H = 3.1, h = w / 2 - 0.1;
    b.box(0, 0, 0, w, 0.12, w, C.concrete);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * h, 0.12, sz * h, 0.16, H - 0.12, 0.16, C.steelD);
    // Riostras en cruz en los cuatro lados.
    const diag = Math.hypot(2 * h, H * 0.45), ang = Math.atan2(H * 0.45, 2 * h);
    for (const y of [0.35 + H * 0.225, 0.35 + H * 0.675]) {
      for (const s of [-1, 1]) {
        for (const a of [ang, -ang]) {
          b.box(0, y, s * h, diag, 0.06, 0.06, C.iron, { rz: a, oy: -0.03, ao: 0 });
          b.box(s * h, y, 0, 0.06, 0.06, diag, C.iron, { rx: a, oy: -0.03, ao: 0 });
        }
      }
    }
    // Plataforma y barandilla con sacos terreros (el frente, +Z, mira al edificio).
    b.box(0, H, 0, w + 0.2, 0.2, w + 0.2, C.concrete);
    b.box(0, H - 0.04, 0, w + 0.22, 0.06, w + 0.22, C.yellow, { ao: 0 });
    for (const s of [-1, 1]) {
      b.box(0, H + 0.2, s * (w / 2 + 0.08), w + 0.2, 0.06, 0.06, C.steelL, { oy: 0.8, ao: 0 });
      b.box(s * (w / 2 + 0.08), H + 0.2, 0, 0.06, 0.06, w + 0.2, C.steelL, { oy: 0.8, ao: 0 });
      for (let k = 0; k < 4; k++) {
        const t = -w / 2 + 0.25 + k * ((w - 0.5) / 3);
        b.box(t, H + 0.2, -s * (w / 2 - 0.05), 0.42, 0.22, 0.28, 0xd9c7a0, { ao: 0.2 });
        if (s < 0) b.box(-s * (w / 2 - 0.05) * (k % 2 ? 1 : -1), H + 0.2, t, 0.28, 0.22, 0.42, 0xd9c7a0, { ao: 0.2 });
      }
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * (w / 2 + 0.08), H + 0.2, sz * (w / 2 + 0.08), 0.08, 0.86, 0.08, C.steelL);
    // Escalera de mano en el frente.
    for (const sx of [-0.22, 0.22]) b.box(sx, 0.12, h + 0.2, 0.05, H, 0.05, C.steelL);
    for (let y = 0.4; y < H; y += 0.32) b.box(0, y, h + 0.2, 0.44, 0.035, 0.035, C.steelL, { ao: 0 });
    b.sprite('seguridad', 0, H + 0.1, w / 2 + 0.1, 0.95, 0.297);
  },
});

// ---------------------------------------------------------------- caseta de vigilancia
add('caseta', {
  ground: true,
  build(b, fp) {
    const w = fp.lw - 0.1;
    b.box(0, 0, 0, w, 0.1, w, C.concrete);
    b.box(0, 0.1, 0, w - 0.06, 0.85, w - 0.06, C.cream);
    b.box(0, 0.1, w / 2 - 0.025, w - 0.04, 0.1, 0.03, C.blue, { ao: 0 });
    b.box(0, 0.95, 0, w - 0.06, 0.95, w - 0.06, 0xbfe3f2, { layer: 'glass', ao: 0 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * (w / 2 - 0.05), 0.95, sz * (w / 2 - 0.05), 0.1, 0.95, 0.1, C.steelL);
    for (const s of [-1, 1]) b.box(0, 0.95 + 0.45, s * (w / 2 - 0.05), w - 0.1, 0.05, 0.05, C.steelL, { ao: 0 });
    b.box(0, 1.9, 0, w + 0.06, 0.12, w + 0.06, C.navy, { ao: 0.05 });
    b.box(0.35, 2.02, -0.3, 0.5, 0.2, 0.4, C.steelL);
    b.cyl(-0.5, 2.02, 0.4, 0.05, 0.05, 0.3, C.steelD, 6);
    b.sprite('seguridad', 0, 0.58, w / 2 - 0.005, 0.95, 0.297);
    // interior: mesa, silla y monitor
    b.box(0, 0.1, -0.5, 1.3, 0.7, 0.5, C.wood);
    b.box(0, 0.8, -0.5, 1.4, 0.05, 0.56, C.woodL);
    b.box(0.3, 0.85, -0.55, 0.4, 0.26, 0.04, C.black, { ao: 0 });
    b.sprite('pantalla_cam', 0.3, 1.0, -0.527, 0.36, 0.225, { screen: true });
    b.light('pantalla', 0.3, 1.0, -0.2, 0x7affb0);
    b.cyl(-0.3, 0.1, 0.0, 0.2, 0.2, 0.4, C.blue, 8);
    b.box(-0.3, 0.5, -0.12, 0.38, 0.4, 0.06, C.blue);
    b.box(-0.55, 0.85, -0.5, 0.18, 0.12, 0.18, C.yellowL, { ao: 0.1 });
  },
});

// ---------------------------------------------------------------- generador
add('generador', {
  ground: true,
  build(b, fp) {
    const L = fp.lw - 0.16, D = fp.ld - 0.14, rnd = fp.rnd;
    b.box(0, 0.0, 0, L, 0.1, D, C.iron);
    for (const sx of [-1, 1]) b.cyl(sx * (L / 2 - 0.1), 0.1, D / 2 - 0.02, 0.1, 0.1, 0.06, C.black, 8, { rx: PI / 2, oy: -0.03, ao: 0 });
    b.box(-0.12, 0.1, 0, L - 0.4, 0.68, D - 0.04, 0xe2a52f);
    b.box(-0.12, 0.78, 0, L - 0.36, 0.05, D, 0xb98322);
    b.box(-0.12, 0.3, D / 2 - 0.012, L - 0.6, 0.3, 0.016, 0x3a3f46, { ao: 0 });       // rejilla
    for (let k = 0; k < 5; k++) b.box(-0.12, 0.34 + k * 0.05, D / 2 + 0.003, L - 0.7, 0.012, 0.012, C.iron, { ao: 0 });
    // depósito de combustible
    b.cyl(-0.3, 0.9, 0, 0.17, 0.17, 0.95, C.red, 12, { rz: PI / 2, oy: -0.475, ao: 0.1 });
    b.cyl(-0.3, 1.06, 0.0, 0.04, 0.04, 0.05, C.black, 8);
    // panel de control
    b.box(0.62, 0.1, 0, 0.34, 0.8, D - 0.06, 0x2a2f36);
    b.box(0.62, 0.55, D / 2 - 0.01, 0.28, 0.2, 0.01, C.black, { ao: 0 });
    b.box(0.55, 0.62, D / 2 + 0.002, 0.08, 0.05, 0.01, C.green, { layer: 'glow', ao: 0 });
    b.box(0.7, 0.62, D / 2 + 0.002, 0.08, 0.05, 0.01, C.red, { layer: 'glow', ao: 0 });
    b.box(0.62, 0.42, D / 2 + 0.002, 0.2, 0.06, 0.01, C.yellow, { ao: 0 });
    b.cyl(0.62, 0.3, D / 2, 0.04, 0.04, 0.03, C.steelL, 8, { rx: PI / 2, ao: 0 });
    // escape y asas
    b.cyl(0.62, 0.9, -0.15, 0.045, 0.045, 0.3, C.steelD, 8);
    b.cyl(0.62, 1.2, -0.15, 0.06, 0.06, 0.03, C.iron, 8);
    for (const sx of [-1, 1]) {
      b.box(sx * (L / 2 - 0.02), 0.1, 0, 0.04, 0.9, 0.04, C.steelD, { ao: 0 });
    }
    b.box(0, 0.98, D / 2 - 0.02, L - 0.04, 0.04, 0.04, C.steelD, { ao: 0 });
    b.box(0, 0.98, -D / 2 + 0.02, L - 0.04, 0.04, 0.04, C.steelD, { ao: 0 });
    // cable enrollado
    b.cyl(-0.65, 0.1, D / 2 - 0.08, 0.12, 0.12, 0.08, C.black, 10, { rx: PI / 2, ao: 0 });
    b.light('lampara', 0.62, 0.7, D / 2 + 0.05, 0x59f08a);
    b.interact('generador', 'Generador', 0.55, fp.ld / 2 + 0.5);
  },
});
