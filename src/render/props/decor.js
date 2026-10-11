import { C, PI, plantInPot, swivelBase } from './common.js';
import { spriteAspect } from './Atlas.js';

// Decoración NO bloqueante: sillas, carteles y objetos de pared, alfombras, marcas del suelo,
// conos, barreras, señales, arbustos… Los objetos de pared tienen el origen en la superficie
// del muro (z = 0) y se extienden hacia +Z (hacia el interior de la sala).
// Parámetros extra de cada entrada de `decor` en p (fp.p).

export const DECOR = {};
const add = (name, def) => { DECOR[name] = { blocking: false, ...def }; };

// ------------------------------------------------------------ mobiliario suelto
add('silla_oficina', {
  build(b, fp) {
    const col = [C.blue, C.greenD, 0x5b6b7a, C.red][fp.seed % 4];
    swivelBase(b, 0, 0, C.iron);
    b.box(0, 0.34, 0, 0.46, 0.07, 0.46, col);
    b.box(0, 0.4, -0.2, 0.44, 0.5, 0.06, col, { rx: -0.08 });
    b.box(0, 0.42, -0.215, 0.18, 0.26, 0.02, C.iron, { ao: 0 });
    for (const s of [-1, 1]) {
      b.box(s * 0.25, 0.42, -0.05, 0.035, 0.03, 0.3, C.iron, { ao: 0 });
      b.box(s * 0.25, 0.38, -0.03, 0.03, 0.05, 0.03, C.iron, { ao: 0 });
    }
  },
});

add('silla_ruedas', {
  build(b) {
    b.box(0, 0.45, 0, 0.5, 0.05, 0.45, C.blue);
    b.box(0, 0.5, -0.22, 0.5, 0.42, 0.04, C.blue);
    for (const s of [-1, 1]) {
      b.cyl(s * 0.3, 0.02, -0.05, 0.28, 0.28, 0.04, C.black, 12, { rz: PI / 2, ox: 0, oy: 0.0 });
      b.box(s * 0.26, 0.58, -0.05, 0.03, 0.03, 0.4, C.iron, { ao: 0 });
      b.box(s * 0.22, 0.05, 0.25, 0.04, 0.4, 0.04, C.steelD, { ao: 0 });
    }
  },
});

add('alfombra', {
  build(b, fp) {
    const w = fp.p.w ?? 3, d = fp.p.d ?? 1.6, col = fp.p.color ?? C.red;
    b.box(0, 0.004, 0, w, 0.014, d, 0x7a2b25, { ao: 0 });
    b.box(0, 0.012, 0, w - 0.14, 0.008, d - 0.14, col, { ao: 0 });
    b.box(0, 0.018, 0, w - 0.4, 0.006, d - 0.4, 0xf0e6d0, { ao: 0 });
    b.box(0, 0.022, 0, w - 0.55, 0.006, d - 0.55, col, { ao: 0 });
    b.box(0, 0.027, 0, w * 0.4, 0.006, d - 0.65, 0x1f3260, { ao: 0 });
  },
});

add('linea', {
  build(b, fp) { b.box(0, 0.003, 0, fp.p.w ?? 0.12, 0.008, fp.p.d ?? 0.12, fp.p.color ?? 0xf1f1ea, { ao: 0 }); },
});

add('papeles_suelo', {
  build(b, fp) {
    const n = fp.p.n ?? 4;
    for (let k = 0; k < n; k++) b.box((fp.rnd() - 0.5) * 0.8, 0.004 + k * 0.001, (fp.rnd() - 0.5) * 0.8, 0.21, 0.004, 0.3, k % 2 ? C.paper : C.paperD, { ry: fp.rnd() * 3, ao: 0 });
  },
});

add('bolsas_suelo', {
  build(b, fp) {
    const n = fp.p.n ?? 3;
    for (let k = 0; k < n; k++) {
      const x = (fp.rnd() - 0.5) * 0.6, z = (fp.rnd() - 0.5) * 0.6, a = fp.rnd() * 3;
      b.box(x, 0.004, z, 0.3, 0.02, 0.22, 0xdff0f4, { layer: 'glass', ry: a, ao: 0 });
      b.box(x, 0.012, z, 0.14, 0.05, 0.08, [C.iron, C.redD, C.steelD][k % 3], { ry: a, ao: 0.05 });
      b.box(x, 0.022, z, 0.1, 0.012, 0.03, C.yellow, { ry: a, ao: 0, oz: 0.1 });
    }
  },
});

// ------------------------------------------------------------ carteles y objetos de pared
function backing(b, cy, w, h, color = 0x2b2b30) { b.box(0, cy - h / 2 - 0.02, 0, w + 0.05, h + 0.04, 0.03, color, { ao: 0 }); }

add('cartel', {
  build(b, fp) {
    const spr = fp.p.sprite, w = fp.p.w ?? 1, cy = fp.p.y ?? 2.0;
    const h = fp.p.h ?? w / spriteAspect(spr);
    if (fp.p.plain) { b.sprite(spr, 0, cy, 0.006, w, h); return; } // pintado en la pared, sin marco
    backing(b, cy, w, h);
    b.sprite(spr, 0, cy, 0.033, w, h, { screen: !!fp.p.glow });
  },
});

add('reloj', {
  build(b, fp) {
    const cy = fp.p.y ?? 2.0, r = (fp.p.w ?? 0.4) / 2;
    b.cyl(0, cy, 0, r + 0.025, r + 0.025, 0.045, C.black, 20, { rx: PI / 2, ao: 0 });
    b.sprite('reloj', 0, cy, 0.048, r * 2, r * 2);
  },
});

add('tablon_corcho', {
  build(b, fp) {
    const w = fp.p.w ?? 1.4, cy = fp.p.y ?? 1.5, h = w * 0.75;
    backing(b, cy, w, h, C.woodD);
    b.sprite('corcho', 0, cy, 0.034, w, h);
  },
});

add('tablon_se_busca', {
  build(b, fp) {
    const w = fp.p.w ?? 1.6, cy = fp.p.y ?? 1.55, h = w / 2;
    backing(b, cy, w, h, C.woodD);
    b.sprite('se_busca', 0, cy, 0.034, w, h);
  },
});

add('mapa_pared', {
  build(b, fp) {
    const w = fp.p.w ?? 1.2, cy = fp.p.y ?? 1.6, h = w * (2 / 3);
    backing(b, cy, w, h, C.woodD);
    b.sprite('mapa', 0, cy, 0.034, w, h);
  },
});

add('pizarra_casos', {
  build(b, fp) {
    const w = fp.p.w ?? 2.4, cy = fp.p.y ?? 1.55, h = w * (448 / 768);
    backing(b, cy, w, h, C.steelD);
    b.sprite('pizarra', 0, cy, 0.034, w, h);
    b.box(0, cy - h / 2 - 0.08, 0, w * 0.9, 0.03, 0.09, C.steelL, { ao: 0 });
    for (let k = 0; k < 3; k++) b.box(-0.4 + k * 0.16, cy - h / 2 - 0.05, 0.03, 0.1, 0.02, 0.02, [C.red, C.blue, C.black][k], { ao: 0 });
    b.interact('pizarra_casos', 'Pizarra de casos', 0, 0.9);
  },
});

add('escudo_pared', {
  build(b, fp) {
    const cy = fp.p.y ?? 1.5;
    b.box(0, cy - 0.55, 0, 0.82, 1.1, 0.03, C.woodD, { ao: 0 });
    b.spriteH('escudo', 0, cy, 0.034, 0.98);
    for (const [s, spr] of [[-1, 'bandera_es'], [1, 'bandera_pol']]) {
      b.cyl(s * 0.78, cy + 0.2, 0.03, 0.012, 0.012, 0.62, C.yellow, 6, { rz: PI / 2, ox: 0, ao: 0 });
      b.sprite(spr, s * 0.78, cy - 0.06, 0.06, 0.52, 0.34);
      b.sprite(spr, s * 0.78, cy - 0.06, 0.059, 0.52, 0.34, { ry: PI });
      b.box(s * 0.78, cy - 0.3, 0.05, 0.54, 0.02, 0.02, C.yellow, { ao: 0 });
    }
  },
});

add('extintor', {
  build(b, fp) {
    const y = fp.p.y ?? 0.75;
    b.box(0, y + 0.05, 0.0, 0.2, 0.3, 0.03, C.iron, { ao: 0 });
    b.cyl(0, y, 0.1, 0.075, 0.075, 0.4, C.red, 12);
    b.cyl(0, y + 0.4, 0.1, 0.03, 0.075, 0.07, C.red, 12);
    b.cyl(0, y + 0.47, 0.1, 0.025, 0.025, 0.04, C.black, 8);
    b.box(0, y + 0.5, 0.1, 0.03, 0.03, 0.12, C.black, { ao: 0 });
    b.box(0.06, y + 0.38, 0.06, 0.035, 0.03, 0.12, C.black, { ao: 0, rz: 0.4 });
    b.cyl(0, y + 0.18, 0.1, 0.0765, 0.0765, 0.1, C.paper, 12, { ao: 0 });
    b.box(0, y + 0.28, 0.0, 0.2, 0.025, 0.12, C.iron, { ao: 0 });
    b.spriteW('extintor', 0, y + 0.82, 0.02, 0.2);
  },
});

add('salida', {
  build(b, fp) {
    const cy = fp.p.y ?? 2.15, w = fp.p.w ?? 0.55;
    const h = w / spriteAspect('salida');
    b.box(0, cy - h / 2 - 0.01, 0, w + 0.03, h + 0.02, 0.05, 0x1b3b2b, { ao: 0 });
    b.sprite('salida', 0, cy, 0.052, w, h, { screen: true });
    b.light('lampara', 0, cy, 0.3, 0x6dff9a);
  },
});

add('camara_seguridad', {
  build(b, fp) {
    const y = fp.p.y ?? 2.3;
    b.box(0, y - 0.07, 0, 0.12, 0.14, 0.03, C.steel, { ao: 0 });
    b.box(0, y, 0.06, 0.04, 0.04, 0.13, C.steelD, { ao: 0 });
    b.box(0, y - 0.02, 0.12, 0.13, 0.11, 0.3, C.white, { rx: 0.35, oz: 0.12 });
    b.box(0, y - 0.02, 0.12, 0.09, 0.08, 0.03, C.black, { rx: 0.35, oz: 0.29 });
    b.box(0.05, y + 0.06, 0.2, 0.025, 0.02, 0.025, C.red, { layer: 'glow', ao: 0, rx: 0.35 });
  },
});

add('cruz_roja', {
  build(b, fp) {
    const cy = fp.p.y ?? 1.55, w = fp.p.w ?? 0.8;
    backing(b, cy, w, w, C.white);
    b.sprite('cruz', 0, cy, 0.033, w, w);
  },
});

add('botiquin_pared', {
  build(b, fp) {
    const cy = fp.p.y ?? 1.3;
    b.box(0, cy - 0.21, 0, 0.42, 0.42, 0.12, C.white);
    b.sprite('botiquin', 0, cy, 0.122, 0.38, 0.38);
    b.interact('botiquin_pared', 'Botiquín', 0, 0.85);
  },
});

add('cuadro_electrico', {
  build(b, fp) {
    const cy = fp.p.y ?? 1.3;
    b.box(0, cy - 0.38, 0, 0.5, 0.76, 0.14, C.steelD);
    b.box(0, cy - 0.36, 0.14, 0.44, 0.7, 0.012, C.steel, { ao: 0.05 });
    b.sprite('cuadro_elec', 0, cy + 0.0, 0.158, 0.26, 0.325);
    b.box(0.16, cy - 0.5, 0.16, 0.05, 0.12, 0.03, C.red, { ao: 0 });
    b.box(-0.19, cy - 0.3, 0.16, 0.025, 0.4, 0.015, C.iron, { ao: 0 });
    b.interact('cuadro_electrico', 'Cuadro eléctrico', 0, 0.85);
  },
});

add('alarma', {
  build(b, fp) {
    const cy = fp.p.y ?? 1.35;
    b.box(0, cy - 0.15, 0, 0.2, 0.3, 0.08, C.redD);
    b.sprite('alarma', 0, cy, 0.083, 0.17, 0.227);
    b.cyl(0.0, cy + 0.17, 0.0, 0.035, 0.035, 0.05, C.red, 8, { layer: 'glow', rx: PI / 2, oy: 0.0, ao: 0 });
    b.light('lampara', 0, cy + 0.17, 0.12, 0xff3a2a);
    b.interact('alarma', 'Alarma', 0, 0.85);
  },
});

add('medicion_pared', {
  build(b, fp) {
    const w = fp.p.w ?? 0.66, h = 1.72, cy = 0.1 + h / 2;
    b.box(0, 0.08, 0, w + 0.04, h + 0.04, 0.03, C.iron, { ao: 0 });
    b.sprite('medicion', 0, cy + 0.0, 0.033, w, h);
    b.box(0, 0.002, 0.45, w * 1.4, 0.006, 0.07, C.yellow, { ao: 0 });
    b.box(0, 0.002, 0.9, w * 1.4, 0.006, 0.07, C.yellow, { ao: 0 });
  },
});

// ------------------------------------------------------------ entrada
add('detector_metales', {
  build(b, fp) {
    const w = fp.p.w ?? 2.0, d = 0.34;
    for (const s of [-1, 1]) {
      b.box(s * (w / 2 - 0.08), 0, 0, 0.16, 2.05, d, 0xcfd5db);
      b.box(s * (w / 2 - 0.08), 0.0, 0, 0.17, 0.1, d + 0.01, C.iron, { ao: 0 });
      b.box(s * (w / 2 - 0.08), 0.5, 0, 0.17, 0.05, d + 0.01, C.blue, { ao: 0 });
      b.box(s * (w / 2 - 0.08), 1.5, 0, 0.17, 0.05, d + 0.01, C.blue, { ao: 0 });
    }
    b.box(0, 2.0, 0, w, 0.22, d, 0xcfd5db);
    b.box(0, 2.0, d / 2 + 0.002, w - 0.3, 0.1, 0.01, C.iron, { ao: 0 });
    b.box(-0.2, 2.06, d / 2 + 0.008, 0.1, 0.05, 0.01, C.green, { layer: 'glow', ao: 0 });
    b.box(0.2, 2.06, d / 2 + 0.008, 0.1, 0.05, 0.01, C.red, { layer: 'glow', ao: 0 });
    b.box(w / 2 - 0.08, 1.0, d / 2 + 0.002, 0.1, 0.18, 0.01, C.iron, { ao: 0 });
    b.light('lampara', 0, 2.1, 0.3, 0x6dff9a);
  },
});

add('bandera_stand', {
  build(b, fp) {
    b.cyl(0, 0, 0, 0.18, 0.2, 0.06, C.steel, 14);
    b.cyl(0, 0.06, 0, 0.018, 0.018, 2.0, C.woodD, 8);
    b.sphere(0, 2.04, 0, 0.07, 0.07, 0.07, C.yellow, 8);
    b.flag(fp.p.sprite ?? 'bandera_es', 0.02, 1.35, 0, 0.78, 0.52, 0.07, 6);
  },
});

add('bandera_mastil', {
  build(b, fp) {
    const y = fp.p.y ?? 4.0;
    b.flag(fp.p.sprite ?? 'bandera_es', 0.05, y, 0, 1.5, 1.0, 0.16, 10, { ry: fp.p.flagRy ?? 0 });
  },
});

// ------------------------------------------------------------ exterior
add('cono', {
  build(b) {
    b.box(0, 0, 0, 0.32, 0.03, 0.32, C.iron, { ao: 0 });
    b.cyl(0, 0.03, 0, 0.025, 0.12, 0.48, 0xf0731c, 8);
    b.cyl(0, 0.2, 0, 0.0765, 0.0888, 0.08, C.white, 8, { ao: 0 });
    b.cyl(0, 0.33, 0, 0.0525, 0.0645, 0.06, C.white, 8, { ao: 0 });
  },
});

add('barrera', {
  build(b, fp) {
    const raise = fp.p.raise ?? 1.25;
    b.box(0, 0, 0, 0.3, 1.0, 0.3, C.yellow);
    b.box(0, 0.6, 0.151, 0.3, 0.12, 0.004, C.black, { ao: 0 });
    b.box(0, 0.0, 0, 0.34, 0.08, 0.34, C.iron, { ao: 0 });
    b.cyl(0, 1.0, 0, 0.07, 0.07, 0.1, C.steelD, 8);
    for (let k = 0; k < 8; k++) {
      b.box(0, 1.05, 0, 0.35, 0.09, 0.07, k % 2 ? C.white : C.red, { rz: raise, ox: 0.175 + k * 0.35, ao: 0.05 });
    }
    b.box(0, 1.05, 0, 0.3, 0.08, 0.06, C.iron, { rz: raise + PI, ox: 0.15 });
    b.sphere(0, 1.0, 0.0, 0.1, 0.1, 0.1, C.red, 6, { layer: 'glow', oy: 0.1, ao: 0 });
    b.light('lampara', 0, 1.2, 0.0, 0xff3a2a);
  },
});

add('senal', {
  build(b, fp) {
    const spr = fp.p.sprite, w = fp.p.w ?? 0.6, h = fp.p.h ?? w / spriteAspect(spr);
    const top = (fp.p.top ?? 2.2);
    b.cyl(0, 0, 0, 0.03, 0.035, top, C.steelD, 8);
    b.cyl(0, 0, 0, 0.1, 0.12, 0.05, C.iron, 8);
    b.box(0, top - h - 0.02, -0.03, w + 0.04, h + 0.04, 0.03, C.steelL, { ao: 0 });
    b.sprite(spr, 0, top - h / 2, 0.0, w, h);
  },
});

add('arbusto', {
  build(b, fp) {
    const rnd = fp.rnd, s = fp.p.s ?? 1;
    const greens = [C.green, C.greenL, C.greenD];
    for (let k = 0; k < 4; k++) {
      const x = (rnd() - 0.5) * 0.5 * s, z = (rnd() - 0.5) * 0.5 * s, d = (0.45 + rnd() * 0.3) * s;
      b.sphere(x, 0, z, d, d * 0.85, d, greens[k % 3], 7, { ao: 0.25 });
    }
    if (rnd() < 0.7) for (let k = 0; k < 4; k++) b.box((rnd() - 0.5) * 0.7 * s, 0.35 * s + rnd() * 0.2, (rnd() - 0.5) * 0.7 * s, 0.06, 0.06, 0.06, [C.pink, C.yellow, C.white][k % 3], { ao: 0 });
  },
});

add('planta_deco', {
  build(b, fp) { plantInPot(b, 0, 0, fp.p.s ?? 1, fp.rnd, C.terracotta); },
});

add('papelera', {
  build(b, fp) {
    const rnd = fp.rnd, col = fp.p.color ?? 0x5b646e;
    b.cyl(0, 0, 0, 0.16, 0.13, 0.36, col, 10);
    b.cyl(0, 0.36, 0, 0.165, 0.165, 0.02, C.iron, 10, { ao: 0 });
    b.cyl(0, 0.33, 0, 0.14, 0.14, 0.01, 0x2b2e33, 10, { ao: 0 });
    for (let k = 0; k < 3; k++) b.box((rnd() - 0.5) * 0.12, 0.34 + k * 0.02, (rnd() - 0.5) * 0.12, 0.09, 0.07, 0.08, k % 2 ? C.paper : C.paperD, { ry: rnd() * 3, rx: rnd(), ao: 0.05 });
    if (fp.p.spill) for (let k = 0; k < 2; k++) b.box(0.25 + k * 0.1, 0.004, (rnd() - 0.5) * 0.3, 0.1, 0.06, 0.08, C.paperD, { ry: rnd() * 3, ao: 0.05 });
  },
});
