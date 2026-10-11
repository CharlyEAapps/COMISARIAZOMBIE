import { C, PI, monitor, keyboard, mouse, mug, papers, deskLamp, phone, plantInPot, swivelBase, cardboard, gun } from './common.js';

// Mobiliario interior BLOQUEANTE. Cada builder recibe (b, fp):
//   fp.lw / fp.ld = tamaño de la huella en el sistema local (X = ancho, Z = fondo; frente = +Z)
//   fp.rnd() = aleatorio determinista por prop, fp.variant = variante opcional.
// Dentro de la huella nada debe sobresalir más de ~0.05 m (la colisión es la celda completa).

export const FURNITURE = {};
const add = (name, def) => { FURNITURE[name] = { blocking: true, ...def }; };
const back = (fp) => -fp.ld / 2 + 0.03; // fondo útil pegado al lado de la pared

// ---------------------------------------------------------------- oficinas
/**
 * Mesa del comisario (variante de escritorio): madera oscura con tapete verde, placa con su
 * cargo, lámpara de banquero, teléfono rojo y banderitas. Es el mostrador del despacho (tienda
 * de mejoras de la comisaría): el punto de uso va delante, en su lado de la mesa.
 */
function comisarioDesk(b, fp) {
  const w = fp.lw - 0.06, d = fp.ld - 0.1;
  b.box(0, 0.7, 0, w, 0.07, d, C.woodDD);
  b.box(0, 0.77, 0, w - 0.3, 0.006, d - 0.25, C.greenD, { ao: 0 });
  for (const s of [-1, 1]) {
    const x = s * (w / 2 - 0.25);
    b.box(x, 0, 0, 0.48, 0.7, d - 0.06, C.woodD);
    for (let k = 0; k < 3; k++) b.box(x, 0.06 + k * 0.215, d / 2 - 0.03, 0.4, 0.18, 0.025, C.wood, { ao: 0.05 });
    for (let k = 0; k < 3; k++) b.box(x, 0.13 + k * 0.215, d / 2 - 0.01, 0.1, 0.02, 0.02, C.yellow, { ao: 0 });
  }
  b.box(0, 0.05, -d / 2 + 0.05, w - 1.0, 0.62, 0.03, C.woodDD);
  // Placa con el cargo, mirando al frente.
  b.box(0, 0.776, d / 2 - 0.16, 0.66, 0.025, 0.08, C.woodDD, { ao: 0 });
  b.sprite('comisario', 0, 0.9, d / 2 - 0.15, 0.6, 0.19, { rx: -0.25 });
  monitor(b, -0.42, 0.77, -0.2);
  keyboard(b, -0.42, 0.77, 0.12);
  deskLamp(b, -0.85, 0.77, -0.22, 0.4);
  phone(b, 0.3, 0.77, -0.15, 0.3, C.red);
  papers(b, 0.08, 0.77, 0.05, fp.rnd, 4);
  mug(b, 0.84, 0.77, 0.08, C.navy);
  // Banderitas de mesa.
  for (const [x, f] of [[0.55, 'bandera_es'], [0.68, 'bandera_pol']]) {
    b.cyl(x, 0.77, 0.1, 0.04, 0.045, 0.02, C.steelD, 8);
    b.cyl(x, 0.79, 0.1, 0.006, 0.006, 0.34, C.steelD, 6);
    b.flag(f, x + 0.006, 0.95, 0.1, 0.18, 0.12, 0.02, 4);
  }
}

/** Mesa de saldo del jefe (despacho a nivel 0): formica, patas de hierro, cinta americana y flexo. */
function cheapDesk(b, fp) {
  const w = fp.lw - 0.08, d = fp.ld - 0.12;
  b.box(0, 0.72, 0, w, 0.04, d, 0xd8cfb8);
  b.box(0, 0.72, d / 2 - 0.004, w, 0.04, 0.008, 0x9a8f76, { ao: 0 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * (w / 2 - 0.06), 0, sz * (d / 2 - 0.06), 0.05, 0.72, 0.05, C.iron);
  b.box(-w / 2 + 0.35, 0.3, 0, 0.5, 0.42, d - 0.14, 0x9aa0a8);            // cajonera metálica abollada
  b.box(w / 2 - 0.3, 0.76, d / 2 - 0.12, 0.4, 0.006, 0.05, 0xb9b3a4, { ry: 0.6, ao: 0 }); // cinta en la esquina rota
  b.box(w / 2 - 0.3, 0.761, d / 2 - 0.12, 0.4, 0.006, 0.05, 0xb9b3a4, { ry: -0.6, ao: 0 });
  b.box(0, 0.762, d / 2 - 0.16, 0.66, 0.025, 0.08, 0x8a8f98, { ao: 0 });
  b.sprite('comisario', 0, 0.88, d / 2 - 0.15, 0.6, 0.19, { rx: -0.25 });
  deskLamp(b, -0.9, 0.76, -0.2, 0.4);
  phone(b, 0.5, 0.76, -0.15, 0.3, 0x9aa0a8);
  papers(b, -0.2, 0.76, -0.05, fp.rnd, 6);
  mug(b, 0.95, 0.76, 0.0, C.white);
  cardboard(b, 0.15, 0.76, -0.2, 0.36, 0.2, 0.3, 0.2);
}

add('escritorio', {
  build(b, fp) {
    if (fp.variant === 'comisario') {
      // La tienda (baldosa J) va delante; la mesa mejora con el nivel del despacho.
      if ((fp.level ?? 1) > 0) comisarioDesk(b, fp);
      else cheapDesk(b, fp);
      return;
    }
    const w = fp.lw - 0.08, d = fp.ld - 0.12, rnd = fp.rnd;
    b.box(0, 0.7, 0, w, 0.05, d, C.woodL);
    b.box(0, 0.7, d / 2 - 0.004, w, 0.05, 0.008, C.wood, { ao: 0 });
    for (const s of [-1, 1]) {
      const x = s * (w / 2 - 0.21);
      b.box(x, 0, 0, 0.4, 0.7, d - 0.04, C.wood);
      for (let k = 0; k < 3; k++) {
        b.box(x, 0.05 + k * 0.215, d / 2 - 0.03, 0.34, 0.18, 0.025, C.woodL, { ao: 0.05 });
        b.box(x, 0.12 + k * 0.215, d / 2 - 0.01, 0.12, 0.02, 0.02, C.steelD, { ao: 0 });
      }
    }
    b.box(0, 0.25, -d / 2 + 0.05, w - 0.8, 0.45, 0.03, C.woodD);
    const lampSide = rnd() < 0.5 ? -1 : 1;
    for (const s of [-1, 1]) {
      const x = s * 0.47;
      monitor(b, x, 0.75, -0.16);
      keyboard(b, x - 0.02, 0.75, 0.12);
      mouse(b, x + 0.27, 0.75, 0.13);
      if (rnd() < 0.7) mug(b, x + (s > 0 ? 0.36 : -0.36), 0.75, -0.18, [C.white, C.red, C.sky, C.yellowL][(rnd() * 4) | 0]);
      papers(b, x + (s > 0 ? -0.3 : 0.3), 0.75, -0.1 + rnd() * 0.1, rnd, 2 + ((rnd() * 3) | 0));
    }
    deskLamp(b, lampSide * 0.12, 0.75, -0.25, lampSide * 0.4);
    phone(b, -lampSide * 0.1, 0.75, -0.2, 0.2, C.steelD);
    if (rnd() < 0.4) { // impresora pequeña
      b.box(0, 0.75, 0.1, 0.3, 0.12, 0.24, 0xdfe3e8);
      b.box(0, 0.87, 0.04, 0.24, 0.015, 0.14, C.black, { ao: 0, rx: -0.5 });
      b.box(0, 0.76, 0.24, 0.2, 0.004, 0.12, C.paper, { ao: 0 });
      b.box(0.1, 0.84, 0.215, 0.05, 0.015, 0.01, C.green, { layer: 'glow', ao: 0 });
    }
    b.box(0.03, 0.75, 0.2, 0.13, 0.03, 0.04, C.navy, { ao: 0 }); // placa con nombre
  },
  companions: (fp) => (fp.variant === 'comisario'
    ? [{ type: 'silla_oficina', lx: 0, lz: -fp.ld / 2 - 0.35, rel: 0 }]
    : [-0.47, 0.47].map((x) => ({ type: 'silla_oficina', lx: x, lz: fp.ld / 2 + 0.12, rel: 180 }))),
});

add('archivador', {
  build(b, fp) {
    const n = Math.round(fp.lw);
    for (let k = 0; k < n; k++) {
      const x = -fp.lw / 2 + 0.5 + k, z0 = back(fp), dep = 0.56;
      const col = k % 2 ? C.steelL : 0xd9d3c0;
      b.box(x, 0, z0 + dep / 2, 0.8, 1.38, dep, col);
      b.box(x, 0, z0 + dep / 2, 0.82, 0.05, dep + 0.01, C.steelD, { ao: 0 });
      for (let d = 0; d < 4; d++) {
        const y = 0.1 + d * 0.31;
        b.box(x, y, z0 + dep - 0.005, 0.72, 0.27, 0.02, col === C.steelL ? C.steel : 0xc9c2ac, { ao: 0.1 });
        b.box(x, y + 0.15, z0 + dep + 0.02, 0.22, 0.025, 0.025, C.steelD, { ao: 0 });
        b.box(x, y + 0.2, z0 + dep + 0.012, 0.16, 0.06, 0.006, C.paper, { ao: 0 });
      }
      // bandeja con carpetas encima
      b.box(x - 0.12, 1.38, z0 + 0.3, 0.3, 0.1, 0.22, C.blue, { ao: 0.1 });
      b.box(x + 0.12, 1.38, z0 + 0.3, 0.26, 0.08, 0.2, C.red, { ao: 0.1, ry: 0.15 });
      b.interact('archivador', 'Archivador', x, fp.ld / 2 + 0.5);
    }
  },
});

add('consola_camaras', {
  build(b, fp) {
    const w = fp.lw - 0.08, d = fp.ld - 0.12;
    b.box(0, 0.7, 0, w, 0.05, d, C.steelL);
    for (const s of [-1, 1]) b.box(s * (w / 2 - 0.1), 0, 0, 0.2, 0.7, d - 0.04, C.steelD);
    b.box(0, 0.25, -d / 2 + 0.05, w - 0.5, 0.45, 0.03, C.iron);
    // panel trasero con monitores de las cámaras
    b.box(0, 0.75, -0.4, w - 0.1, 0.95, 0.06, C.iron);
    for (const s of [-1, 1]) {
      monitor(b, s * 0.48, 0.75, -0.25, { screen: 'pantalla_cam', w: 0.5, h: 0.31 });
      b.box(s * 0.48, 1.28, -0.34, 0.55, 0.35, 0.03, C.black, { ao: 0 });
      b.sprite('pantalla_cam', s * 0.48, 1.455, -0.318, 0.5, 0.31, { screen: true });
      b.light('pantalla', s * 0.48, 1.45, -0.2, 0x7affb0);
    }
    keyboard(b, 0, 0.75, 0.08);
    mouse(b, 0.3, 0.75, 0.1);
    b.box(-0.5, 0.75, 0.15, 0.16, 0.05, 0.12, C.iron); // joystick/mando
    b.cyl(-0.5, 0.8, 0.15, 0.015, 0.015, 0.1, C.black, 6);
    b.box(0.75, 0.75, 0.05, 0.1, 0.03, 0.1, C.red, { layer: 'glow', ao: 0 }); // piloto REC
    b.interact('ordenador_camaras', 'Cámaras de seguridad', 0, fp.ld / 2 + 0.5);
  },
  companions: (fp) => [{ type: 'silla_oficina', lx: 0, lz: fp.ld / 2 + 0.12, rel: 180 }],
});

add('fuente', {
  build(b, fp) {
    const z = -0.1;
    b.box(0, 0, z, 0.4, 0.95, 0.4, C.white);
    b.box(0, 0, z, 0.42, 0.06, 0.42, C.steelD, { ao: 0 });
    b.box(0, 0.65, z + 0.2, 0.3, 0.02, 0.06, C.steelD, { ao: 0 });         // bandeja
    b.box(-0.06, 0.74, z + 0.2, 0.05, 0.05, 0.05, C.blueL, { ao: 0.05 });  // grifo azul
    b.box(0.06, 0.74, z + 0.2, 0.05, 0.05, 0.05, C.red, { ao: 0.05 });     // grifo rojo
    b.box(0.26, 0.55, z, 0.1, 0.34, 0.1, C.skyL, { ao: 0.05 });            // dispensador de vasos
    b.cyl(0, 0.95, z, 0.2, 0.2, 0.05, C.white, 12);
    b.cyl(0, 1.0, z, 0.17, 0.17, 0.42, 0x9fd6f0, 14, { ao: 0.05 });        // garrafón
    b.cyl(0, 1.42, z, 0.07, 0.17, 0.08, 0x9fd6f0, 14, { ao: 0 });
    b.cyl(0, 1.5, z, 0.05, 0.05, 0.03, C.blue, 8);
    b.interact('fuente', 'Fuente de agua', 0, fp.ld / 2 + 0.5);
  },
});

add('fotocopiadora', {
  build(b, fp) {
    const z = back(fp) + 0.32;
    b.box(0, 0, z, 0.84, 0.92, 0.6, 0xc9ced4);
    b.box(0, 0.92, z, 0.84, 0.07, 0.6, C.white);
    b.box(0, 0.99, z + 0.02, 0.7, 0.025, 0.46, 0x3d4a58, { ao: 0 });      // cristal del escáner
    b.box(0, 0.62, z + 0.3, 0.76, 0.2, 0.01, C.steelD, { ao: 0 });
    b.box(0.27, 0.93, z + 0.2, 0.22, 0.04, 0.12, C.black, { ao: 0, rx: -0.4 }); // panel de control
    b.box(0.27, 0.955, z + 0.255, 0.16, 0.025, 0.012, C.screenBlue, { layer: 'glow', ao: 0, rx: -0.4 });
    for (let k = 0; k < 3; k++) b.box(-0.2 + k * 0.2, 0.24, z + 0.3, 0.17, 0.3, 0.01, C.steel, { ao: 0.05 }); // bandejas
    cardboard(b, -0.2, 1.06, z, 0.3, 0.1, 0.22, 0.1, C.paper);
    b.light('lampara', 0.27, 1.0, z + 0.3, 0x8fd0ff);
  },
});

add('planta', {
  build(b, fp) { plantInPot(b, 0, 0, 1.0 + fp.rnd() * 0.12, fp.rnd, [C.terracotta, C.white, C.blueL][(fp.rnd() * 3) | 0]); },
});

// ---------------------------------------------------------------- bancos y sillas
add('banco_madera', {
  build(b, fp) {
    const w = fp.lw - 0.1, z = -0.1;
    for (let k = 0; k < 3; k++) b.box(0, 0.44, z - 0.14 + k * 0.14, w, 0.045, 0.12, k === 1 ? C.woodL : C.wood);
    for (let k = 0; k < 2; k++) b.box(0, 0.62 + k * 0.17, z - 0.24, w, 0.14, 0.04, C.wood);
    for (const s of [-1, 0, 1]) {
      const x = s * (w / 2 - 0.08);
      b.box(x, 0, z, 0.05, 0.44, 0.44, C.iron);
      b.box(x, 0.44, z - 0.24, 0.05, 0.5, 0.04, C.iron);
    }
  },
});

add('banco_parque', {
  ground: true,
  build(b, fp) {
    const w = fp.lw - 0.1, z = -0.05;
    for (let k = 0; k < 4; k++) b.box(0, 0.44, z - 0.18 + k * 0.12, w, 0.04, 0.1, k % 2 ? C.woodL : C.wood);
    for (let k = 0; k < 3; k++) b.box(0, 0.58 + k * 0.13, z - 0.26, w, 0.1, 0.035, C.wood);
    for (const s of [-1, 1]) {
      const x = s * (w / 2 - 0.05);
      b.box(x, 0, z, 0.06, 0.44, 0.46, C.greenD);
      b.box(x, 0.44, z - 0.26, 0.06, 0.5, 0.045, C.greenD);
      b.box(x, 0.62, z - 0.1, 0.06, 0.04, 0.3, C.greenD);
    }
  },
});

add('sillas_espera', {
  build(b, fp) {
    const n = Math.round(fp.lw), z = -0.1;
    b.box(0, 0.36, z, fp.lw - 0.1, 0.05, 0.08, C.steelD);
    for (const s of [0, 1, 2, 3].map((k) => -fp.lw / 2 + 0.1 + k * (fp.lw - 0.2) / 3)) {
      b.box(s, 0, z, 0.05, 0.36, 0.05, C.iron);
      b.box(s, 0, z - 0.18, 0.05, 0.36, 0.05, C.iron, { ry: 0 });
    }
    const broken = (fp.level ?? 1) === 0 ? 1 : -1;
    for (let k = 0; k < n; k++) {
      if (k === broken) { b.box(-fp.lw / 2 + 0.5 + k, 0.41, z, 0.36, 0.006, 0.05, 0xb9b3a4, { ao: 0, ry: 0.5 }); continue; }
      const x = -fp.lw / 2 + 0.5 + k, col = [C.blue, C.blueL, C.blue][k % 3];
      b.box(x, 0.41, z + 0.02, 0.42, 0.05, 0.4, col);
      b.box(x, 0.46, z - 0.2, 0.42, 0.4, 0.05, col, { rx: -0.1 });
      b.box(x - 0.2, 0.46, z, 0.025, 0.2, 0.3, C.steelD, { ao: 0 });
    }
    b.box(fp.lw / 2 - 0.5, 0.46, z + 0.03, 0.18, 0.012, 0.24, C.paper, { ao: 0, ry: 0.3 }); // revista
  },
});

// ---------------------------------------------------------------- mostradores
function counterBody(b, w, d, h, body, trim, top, frontZ) {
  b.box(0, 0, 0, w, h, d, body);
  b.box(0, 0, frontZ, w + 0.02, 0.12, 0.02, trim, { ao: 0 });
  b.box(0, h, 0.02, w + 0.04, 0.05, d + 0.04, top, { ao: 0.05 });
}

add('mostrador_recepcion', {
  build(b, fp) {
    const w = fp.lw - 0.1, rnd = fp.rnd;
    const denuncias = fp.variant === 'denuncias';
    counterBody(b, w, 0.8, 1.0, C.cream, C.blue, C.woodD, 0.4);
    for (let k = 0; k < 3; k++) b.box(-w / 3 + k * (w / 3), 0.16, 0.405, w / 3 - 0.12, 0.7, 0.012, 0xfaf3e2, { ao: 0 });
    b.box(0, 0.9, 0.405, w, 0.06, 0.018, C.blue, { ao: 0 });
    // mampara de cristal con ventanilla central: con cinta americana (nivel 0) o blindada (I+)
    const armored = (fp.level ?? 0) > 0;
    for (const s of [-1, 1]) {
      b.box(s * (w / 2 - 0.58), 1.05, 0.08, w / 2 - 0.45, 0.46, armored ? 0.05 : 0.014, armored ? 0x9fd0e6 : 0xbfe3f2, { layer: 'glass', ao: 0 });
      b.box(s * 0.28, 1.05, 0.08, armored ? 0.08 : 0.04, 0.46, armored ? 0.07 : 0.03, armored ? C.steelD : C.steel, { ao: 0 });
      if (!armored) {
        for (const r of [0.6, -0.6]) b.box(s * (w / 2 - 0.58), 1.27, 0.09, w / 2 - 0.5, 0.006, 0.04, 0xb9b3a4, { rz: r, rx: PI / 2, ao: 0 });
      } else {
        for (const x of [w / 2 - 0.12, 0.38]) for (const y of [1.08, 1.47]) b.box(s * x, y, 0.115, 0.04, 0.04, 0.02, C.iron, { ao: 0 });
      }
    }
    b.box(0, 1.5, 0.08, w - 0.1, 0.03, 0.03, C.steel, { ao: 0 });
    b.box(0, 1.05, 0.08, w - 0.1, 0.03, 0.03, C.steel, { ao: 0 });
    for (const s of [-1, 1]) b.box(s * (w / 2 - 0.05), 1.05, 0.08, 0.04, 0.48, 0.03, C.steel, { ao: 0 });
    // rótulo sobre la mampara
    b.box(0, 1.53, 0.08, 1.7, 0.36, 0.06, C.navy, { ao: 0.05 });
    b.sprite(denuncias ? 'denuncias' : 'atencion', 0, 1.71, 0.112, 1.6, 0.32);
    // lado público (frente)
    b.box(w / 2 - 0.4, 1.05, 0.27, 0.24, 0.02, 0.14, C.paper, { ao: 0 });          // formularios
    b.cyl(w / 2 - 0.9, 1.05, 0.27, 0.025, 0.02, 0.03, C.yellow, 8);                 // timbre
    b.cyl(w / 2 - 0.9, 1.08, 0.27, 0.012, 0.012, 0.012, C.steelD, 6);
    if (denuncias) {
      phone(b, -w / 2 + 0.45, 1.05, 0.26, 0.1, C.red);
      b.interact('telefono', 'Teléfono', -w / 2 + 0.45, fp.ld / 2 + 0.5);
    }
    // lado del agente (detrás): ordenadores
    for (const s of [-1, 1]) {
      monitor(b, s * 0.85, 1.05, -0.2, { ry: PI });
      keyboard(b, s * 0.85, 1.05, -0.05, PI);
      mouse(b, s * 0.85 - 0.26, 1.05, -0.05);
    }
    papers(b, 0, 1.05, -0.2, rnd, 3);
    mug(b, 0.4, 1.05, -0.28, C.sky);
  },
});

add('mostrador_armeria', {
  build(b, fp) {
    const w = fp.lw - 0.1, rnd = fp.rnd;
    counterBody(b, w, 0.8, 1.0, 0x59606a, C.orange, C.steelL, 0.4);
    for (let k = 0; k < 3; k++) b.box(-w / 3 + k * (w / 3), 0.18, 0.405, w / 3 - 0.1, 0.62, 0.012, 0x6c7580, { ao: 0 });
    b.box(0, 0.8, 0.41, w - 0.1, 0.05, 0.012, C.yellow, { ao: 0 });
    // jaula de seguridad
    const top = 1.8;
    for (const y of [1.05, 1.42, top - 0.04]) b.box(0, y, 0.12, w, 0.04, 0.04, C.black, { ao: 0 });
    for (let x = -w / 2 + 0.04; x <= w / 2 - 0.03; x += 0.1) {
      if (Math.abs(x) < 0.3) continue; // ventanilla
      b.box(x, 1.05, 0.12, 0.025, top - 1.05, 0.025, C.iron, { ao: 0 });
    }
    for (const s of [-1, 1]) b.box(s * 0.3, 1.05, 0.12, 0.05, top - 1.05, 0.05, C.black, { ao: 0 });
    b.box(0, 1.05, 0.22, 0.5, 0.03, 0.2, C.steelD, { ao: 0 });                   // bandeja de la ventanilla
    // lado trasero: escopeta desmontada, pistola en la bandeja, cargadores y cajas de munición
    gun(b, 'escopeta', -1.25, 1.05, -0.2, { mode: 'flat', s: 0.95 });
    gun(b, 'pistola', -0.08, 1.08, 0.24, { mode: 'flat', s: 1.1 });
    for (let k = 0; k < 3; k++) b.box(0.25 + k * 0.07, 1.05, -0.05 + rnd() * 0.04, 0.03, 0.02, 0.12, C.black, { ry: rnd() * 0.3, ao: 0 });
    for (let k = 0; k < 3; k++) {
      const x = 0.65 + k * 0.32;
      b.box(x, 1.05, -0.18, 0.28, 0.14, 0.18, 0x5b6b3a, { ao: 0.05 });
      b.box(x, 1.19, -0.18, 0.29, 0.02, 0.19, 0x3f4a28, { ao: 0 });
      b.sprite('caja_municion', x, 1.12, -0.088, 0.24, 0.12);
    }
    b.box(0.97, 1.21, -0.18, 0.28, 0.12, 0.18, 0x5b6b3a, { ao: 0.05, ry: 0.15 });
    b.sprite('municion', -0.7, 1.9, 0.0, 0.3, 0.1);
  },
});

add('mostrador_pruebas', {
  build(b, fp) {
    const w = fp.lw - 0.1, rnd = fp.rnd;
    counterBody(b, w, 0.8, 1.0, C.kraftD, C.steelD, C.steelL, 0.4);
    for (let k = 0; k < 3; k++) b.box(-w / 3 + k * (w / 3), 0.16, 0.405, w / 3 - 0.12, 0.7, 0.012, C.kraft, { ao: 0 });
    b.box(0, 0.9, 0.41, w, 0.05, 0.012, C.yellow, { ao: 0 });
    // bolsas de pruebas (transparentes, con objetos)
    for (let k = 0; k < 3; k++) {
      const x = -1.0 + k * 0.38 + rnd() * 0.06;
      b.box(x, 1.05, 0.2, 0.28, 0.02, 0.2, 0xdff0f4, { layer: 'glass', ao: 0, ry: rnd() * 0.5 - 0.25 });
      b.box(x, 1.06, 0.2, 0.1 + rnd() * 0.08, 0.04 + rnd() * 0.06, 0.07, [C.iron, C.redD, C.steelD][k], { ry: rnd(), ao: 0.05 });
      b.box(x, 1.07, 0.3, 0.12, 0.012, 0.03, C.yellow, { ao: 0 });
    }
    // balanza
    b.box(0.75, 1.05, 0.1, 0.34, 0.06, 0.26, C.steelD);
    b.box(0.75, 1.11, 0.1, 0.3, 0.02, 0.22, C.steelL, { ao: 0 });
    b.box(0.75, 1.11, 0.24, 0.12, 0.02, 0.02, C.screenBlue, { layer: 'glow', ao: 0 });
    // cajas de pruebas y carpeta
    cardboard(b, 1.15, 1.05, -0.15, 0.3, 0.22, 0.26, 0.2);
    cardboard(b, 1.15, 1.27, -0.15, 0.24, 0.18, 0.22, -0.1, C.kraftL);
    b.box(-1.2, 1.05, -0.1, 0.24, 0.04, 0.32, C.red, { ry: 0.2 });
    deskLamp(b, -0.8, 1.05, -0.2, 0.3);
    monitor(b, 0.2, 1.05, -0.2, { ry: PI });
    keyboard(b, 0.2, 1.05, -0.05, PI);
  },
});

add('mostrador_enfermeria', {
  fixedRot: 90,
  build(b, fp) {
    const w = fp.lw - 0.1, rnd = fp.rnd;
    counterBody(b, w, 0.8, 1.0, C.mint, C.white, C.white, 0.4);
    for (let k = 0; k < 3; k++) b.box(-w / 3 + k * (w / 3), 0.16, 0.405, w / 3 - 0.12, 0.7, 0.012, 0xcfe9d9, { ao: 0 });
    b.sprite('cruz', 0, 0.5, 0.416, 0.4, 0.4);
    // objetos encima
    for (let k = 0; k < 4; k++) {
      const x = -1.0 + k * 0.28;
      b.cyl(x, 1.05, -0.12, 0.04, 0.04, 0.12 + rnd() * 0.06, [C.orange, C.sky, C.white, C.greenL][k], 8);
      b.cyl(x, 1.17 + rnd() * 0.04, -0.12, 0.03, 0.03, 0.02, C.white, 8);
    }
    b.box(0.2, 1.05, 0.05, 0.3, 0.05, 0.2, C.white, { ry: 0.1 });
    b.box(0.2, 1.1, 0.05, 0.3, 0.02, 0.2, C.red, { ry: 0.1, ao: 0 });
    b.box(0.2, 1.1, 0.05, 0.08, 0.02, 0.2, C.white, { ry: 0.1, ao: 0 });
    // báscula
    b.box(0.85, 1.05, 0.0, 0.3, 0.04, 0.3, C.steelL);
    b.box(0.85, 1.09, 0.1, 0.1, 0.02, 0.06, C.screenBlue, { layer: 'glow', ao: 0 });
    // tablilla y estetoscopio
    b.box(-0.2, 1.05, 0.15, 0.2, 0.012, 0.28, C.woodD, { ry: -0.2, ao: 0 });
    b.box(-0.2, 1.062, 0.15, 0.18, 0.004, 0.24, C.paper, { ry: -0.2, ao: 0 });
    b.cyl(-0.55, 1.05, 0.2, 0.06, 0.06, 0.012, C.iron, 10);
  },
});

// ---------------------------------------------------------------- armero y munición
const ARMERO_FILL = [3, 6, 8, 10]; // de cada 10 huecos, cuántos con arma según el nivel de la armería
const fillAt = (lvl, n) => ARMERO_FILL[Math.min(lvl ?? 2, ARMERO_FILL.length - 1)] > ((n * 7) % 10);

/**
 * Armero de armas largas: mueble de cajones abajo, panel trasero, apoyo ranurado y barra de
 * retención con fusiles, escopetas y subfusiles en vertical (de perfil, para reconocerlos desde
 * la cámara). Se llena con el nivel; los huecos vacíos llevan la nota de «prestada». Arriba,
 * cascos y cajas.
 */
add('armero', {
  build(b, fp) {
    const z0 = back(fp), dep = 0.4, W = fp.lw - 0.04, lvl = fp.level ?? 2, rnd = fp.rnd;
    // mueble bajo con cajones
    b.box(0, 0, z0 + dep / 2, W, 0.72, dep, 0x59606a);
    const nd = Math.max(1, Math.round(fp.lw));
    for (let k = 0; k < nd; k++) {
      const x = -W / 2 + (k + 0.5) * (W / nd);
      for (let r = 0; r < 2; r++) {
        b.box(x, 0.08 + r * 0.32, z0 + dep + 0.005, W / nd - 0.06, 0.28, 0.012, 0x6c7580, { ao: 0.05 });
        b.box(x, 0.3 + r * 0.32, z0 + dep + 0.015, 0.22, 0.025, 0.02, C.steelL, { ao: 0 });
        b.box(x - 0.3, 0.26 + r * 0.32, z0 + dep + 0.013, 0.12, 0.04, 0.004, C.paper, { ao: 0 });
      }
    }
    b.box(0, 0.72, z0 + dep / 2, W + 0.02, 0.04, dep + 0.02, C.steelL, { ao: 0 });
    // panel trasero y apoyo ranurado
    b.box(0, 0.76, z0 + 0.02, W, 1.28, 0.04, 0x8a929c);
    b.box(0, 0.76, z0 + 0.15, W, 0.06, 0.22, C.steelD, { ao: 0.05 });
    b.box(0, 1.5, z0 + 0.13, W, 0.05, 0.04, C.iron, { ao: 0 });                         // barra de retención
    b.box(0, 1.55, z0 + 0.13, W, 0.012, 0.042, C.orange, { ao: 0 });
    const n = Math.max(4, Math.floor(W / 0.23));
    const kinds = ['fusil', 'escopeta', 'fusil', 'subfusil', 'escopeta'];
    for (let k = 0; k < n; k++) {
      const x = -W / 2 + (k + 0.5) * (W / n);
      b.box(x, 0.82, z0 + 0.15, 0.08, 0.015, 0.2, C.black, { ao: 0 });                  // ranura
      if (!fillAt(lvl, k + (fp.seed ?? 0) % 3)) {
        if (!lvl && k % 3 === 1) b.sprite('prestada', x, 1.32, z0 + 0.045, 0.2, 0.075);
        continue;
      }
      const kind = kinds[(k + ((fp.seed ?? 0) % 5)) % kinds.length];
      const sc = kind === 'subfusil' ? 1.15 : 1;
      gun(b, kind, x, 0.84, z0 + 0.12, { mode: 'up', s: sc, flip: k % 2 === 1 });
    }
    // estante de arriba: cascos y cajas
    b.box(0, 2.04, z0 + 0.17, W, 0.04, 0.34, C.steelD);
    const nh = lvl >= 2 ? 4 : lvl ? 2 : 1;
    for (let k = 0; k < nh; k++) {
      const x = -W / 2 + 0.35 + k * 0.5;
      b.sphere(x, 2.08, z0 + 0.17, 0.28, 0.2, 0.3, C.navy, 8, { ao: 0.1 });
      b.box(x, 2.11, z0 + 0.32, 0.2, 0.05, 0.02, 0x9fd0e6, { layer: 'glass', ao: 0 });   // visera
    }
    for (let k = 0; k < (lvl ? 3 : 1); k++) {
      const x = W / 2 - 0.3 - k * 0.34;
      b.box(x, 2.08, z0 + 0.17, 0.28, 0.14, 0.2, 0x5b6b3a, { ao: 0.05, ry: (rnd() - 0.5) * 0.1 });
      b.sprite('caja_municion', x, 2.15, z0 + 0.272, 0.24, 0.12);
    }
    b.box(0, 2.0, z0 + 0.02, W, 0.04, 0.05, C.red, { ao: 0 });
  },
});

/**
 * Armario de armas cortas (abierto): cajonera con bandejas de cargadores y tablero perforado con
 * pistolas, subfusiles, porras y grilletes. Los huecos vacíos dejan ver la silueta pintada.
 */
add('armero_cortas', {
  build(b, fp) {
    const z0 = back(fp), dep = 0.42, W = fp.lw - 0.06, lvl = fp.level ?? 2, rnd = fp.rnd;
    const SIL = 0x4a4f57;
    b.box(0, 0, z0 + dep / 2, W, 0.86, dep, C.navy);
    for (let k = 0; k < 3; k++) for (let r = 0; r < 3; r++) {
      const x = -W / 3 + k * (W / 3);
      b.box(x, 0.06 + r * 0.27, z0 + dep + 0.005, W / 3 - 0.06, 0.23, 0.012, 0x2b4a7e, { ao: 0.05 });
      b.box(x, 0.24 + r * 0.27, z0 + dep + 0.014, 0.16, 0.025, 0.02, C.steelL, { ao: 0 });
    }
    b.box(0, 0.86, z0 + dep / 2, W + 0.02, 0.04, dep + 0.02, C.steelL, { ao: 0 });
    // bandejas con cargadores
    for (let k = 0; k < 6; k++) b.box(-W / 2 + 0.3 + k * 0.42, 0.9, z0 + 0.3, 0.035, 0.12, 0.025, C.black, { ao: 0, rz: (rnd() - 0.5) * 0.2 });
    // tablero perforado
    b.box(0, 0.9, z0 + 0.02, W, 1.15, 0.04, 0xb7bdc4);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 10; c++) b.box(-W / 2 + 0.1 + c * ((W - 0.2) / 9), 1.0 + r * 0.28, z0 + 0.042, 0.012, 0.012, 0.002, 0x7b848e, { ao: 0 });
    let slot = 0;
    const put = (kind, x, y, o = {}) => {
      const has = fillAt(lvl, slot++);
      gun(b, kind, x, y, z0 + 0.06, has ? o : { ...o, color: SIL, t: 0.004 });
      if (has) b.box(x + (o.flip ? -1 : 1) * 0.05 * (o.s ?? 1), y + 0.07 * (o.s ?? 1), z0 + 0.05, 0.015, 0.015, 0.05, C.iron, { ao: 0 }); // gancho
    };
    // fila de pistolas
    for (let k = 0; k < 6; k++) put('pistola', -W / 2 + 0.2 + k * ((W - 0.5) / 5), 1.72, { s: 1.3, flip: k >= 3 });
    // subfusiles
    put('subfusil', -W / 2 + 0.15, 1.36, { s: 1.1 });
    put('subfusil', 0.2, 1.36, { s: 1.1 });
    // porras en vertical y grilletes
    for (let k = 0; k < 4; k++) put('porra', W / 2 - 0.12 - k * 0.12, 0.98, { mode: 'up', s: 1.05, flip: k % 2 === 1 });
    for (let k = 0; k < 2; k++) {
      const x = -0.55 + k * 0.28;
      for (const dx of [-0.05, 0.05]) b.cyl(x + dx, 1.05, z0 + 0.07, 0.045, 0.045, 0.012, C.steelL, 8, { rx: PI / 2, ao: 0 });
    }
    b.box(0, 2.05, z0 + 0.12, W + 0.02, 0.05, 0.24, C.navy, { ao: 0 });
    b.box(0, 2.0, z0 + 0.23, W, 0.05, 0.02, C.yellow, { ao: 0 });
  },
});

add('estanteria_municion', {
  build(b, fp) {
    const w = fp.lw - 0.08, z0 = back(fp), dep = 0.46, rnd = fp.rnd;
    for (const sx of [-1, 1]) for (const sz of [0, 1]) b.box(sx * (w / 2 - 0.03), 0, z0 + 0.03 + sz * (dep - 0.06), 0.05, 1.8, 0.05, C.blue);
    for (let l = 0; l < 5; l++) {
      const y = 0.06 + l * 0.43;
      b.box(0, y, z0 + dep / 2, w, 0.035, dep, C.steel);
      if (l < 4) {
        const n = Math.floor(w / 0.3);
        for (let k = 0; k < n; k++) {
          const x = -w / 2 + 0.16 + k * (w - 0.3) / Math.max(1, n - 1);
          const olive = (k + l) % 3 !== 0;
          b.box(x, y + 0.035, z0 + 0.3, 0.26, 0.15, 0.2, olive ? 0x5b6b3a : C.kraftD, { ao: 0.06 });
          b.box(x, y + 0.185, z0 + 0.3, 0.27, 0.015, 0.21, olive ? 0x3f4a28 : C.kraft, { ao: 0 });
          if (olive) b.sprite('caja_municion', x, y + 0.11, z0 + 0.402, 0.22, 0.11);
          else b.box(x, y + 0.1, z0 + 0.402, 0.12, 0.05, 0.004, C.yellowL, { ao: 0 });
          if (rnd() < 0.5) b.box(x, y + 0.035, z0 + 0.1, 0.2, 0.12, 0.14, [C.redD, 0x3f4a56][k % 2], { ao: 0.06 });
        }
      }
    }
  },
});

// ---------------------------------------------------------------- pasillo
add('taquillas', {
  build(b, fp) {
    const n = Math.round(fp.lw), z0 = back(fp), dep = 0.5, rnd = fp.rnd;
    const fresh = (fp.level ?? 2) >= 2;
    b.box(0, 0, z0 + dep / 2, fp.lw - 0.02, 0.1, dep, C.iron);
    for (let k = 0; k < n * 2; k++) {
      const x = -fp.lw / 2 + 0.25 + k * 0.5;
      const col = fresh ? ((k >> 1) % 2 ? 0x3f7fd0 : 0x2f5fa8) : (k >> 1) % 2 ? 0x8a9aa8 : 0x9a9f94;
      b.box(x, 0.1, z0 + dep / 2, 0.47, 1.78, dep, col);
      b.box(x, 0.1, z0 + dep, 0.44, 1.74, 0.012, fresh ? 0x5a9ae0 : 0xa8aea0, { ao: 0.05, ry: !fresh && k === 1 ? 0.35 : 0 });
      if (!fresh && k % 3 === 0) b.box(x + 0.05, 0.7, z0 + dep + 0.014, 0.16, 0.12, 0.006, 0x6c6a60, { ao: 0, rz: 0.4 }); // abolladura
      for (let v = 0; v < 3; v++) b.box(x, 1.55 + v * 0.05, z0 + dep + 0.008, 0.28, 0.016, 0.01, C.iron, { ao: 0 });
      b.box(x + 0.14, 0.95, z0 + dep + 0.02, 0.025, 0.14, 0.03, C.steelD, { ao: 0 });
      b.sprite(`nombre_${(k + (fp.seed ?? 0)) % 8}`, x, 1.41, z0 + dep + 0.014, 0.24, 0.072); // etiqueta con el nombre
      if (rnd() < 0.5) b.box(x - 0.1, 0.85, z0 + dep + 0.02, 0.05, 0.07, 0.02, C.yellow, { ao: 0 }); // candado
      b.box(x, 1.88, z0 + dep / 2, 0.47, 0.01, dep, C.iron, { ao: 0 });
    }
    for (let k = 0; k < n; k++) b.interact('taquilla', 'Taquilla', -fp.lw / 2 + 0.5 + k, fp.ld / 2 + 0.5);
  },
});

// ---------------------------------------------------------------- enfermería
add('camillas', {
  build(b, fp) {
    const n = Math.max(1, Math.round(fp.lw / 2));
    for (let k = 0; k < n; k++) {
      const cx = -fp.lw / 2 + 1 + k * 2;
      b.push(cx, 0, 0.0);
      const L = 1.9, W = 0.8;
      b.box(0, 0.2, 0, L, 0.05, W - 0.1, C.steel);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        b.box(sx * (L / 2 - 0.1), 0.0, sz * (W / 2 - 0.12), 0.05, 0.22, 0.05, C.steelD);
        b.cyl(sx * (L / 2 - 0.1), 0, sz * (W / 2 - 0.12), 0.05, 0.05, 0.07, C.black, 8, { ao: 0 });
      }
      b.box(0.0, 0.25, 0, L, 0.14, W, 0xeef1f4);                          // colchón
      b.box(0.0, 0.25, 0, L + 0.01, 0.03, W + 0.01, C.sky, { ao: 0 });
      b.box(-L / 2 + 0.3, 0.39, 0, 0.42, 0.1, 0.5, C.white, { ao: 0.1 }); // almohada
      const lvl = fp.level ?? 1;
      b.box(0.3, 0.39, 0, 0.9, 0.06, W - 0.02, lvl ? C.teal : 0x8a8f98, { ao: 0.1 });       // manta
      b.box(0.3, 0.45, 0, 0.9, 0.012, 0.18, lvl ? 0x78c0ba : 0xb9b3a4, { ao: 0 });
      if (!lvl) b.box(-0.3, 0.392, 0.1, 0.4, 0.006, 0.06, 0xb9b3a4, { ry: 0.5, ao: 0 }); // remiendo
      if (lvl >= 2) {
        // Monitor con el pulso en el soporte del suero y cortina hacia la cama vecina.
        b.box(-L / 2 + 0.12, 1.0, -W / 2 + 0.06, 0.3, 0.22, 0.12, C.iron);
        b.sprite('pantalla_radio', -L / 2 + 0.12, 1.11, -W / 2 + 0.121, 0.26, 0.17, { screen: true });
        if (k < n - 1) b.box(L / 2 + 0.03, 0.25, 0, 0.03, 1.55, W - 0.02, 0xa8d8d0, { ao: 0.05 });
      }
      b.box(-L / 2, 0.2, 0, 0.05, 0.62, W, C.white);                       // cabecero
      b.box(L / 2, 0.2, 0, 0.05, 0.42, W, C.white);                        // piecero
      for (const sz of [-1, 1]) {                                         // barandillas
        b.box(0, 0.4, sz * (W / 2 + 0.0), 1.1, 0.025, 0.025, C.steelL, { ao: 0 });
        b.box(0, 0.5, sz * (W / 2 + 0.0), 1.1, 0.025, 0.025, C.steelL, { ao: 0 });
        b.box(-0.55, 0.4, sz * W / 2, 0.025, 0.14, 0.025, C.steelL, { ao: 0 });
        b.box(0.55, 0.4, sz * W / 2, 0.025, 0.14, 0.025, C.steelL, { ao: 0 });
      }
      // soporte de suero
      b.cyl(-L / 2 + 0.12, 0.04, -W / 2 - 0.02, 0.012, 0.012, 1.55, C.steelL, 6);
      b.cyl(-L / 2 + 0.12, 0, -W / 2 - 0.02, 0.1, 0.1, 0.04, C.steelD, 8);
      b.box(-L / 2 + 0.12, 1.3, -W / 2 - 0.02, 0.1, 0.18, 0.03, 0xcfe9f4, { layer: 'glass', ao: 0 });
      b.box(-L / 2 + 0.12, 1.28, -W / 2 - 0.02, 0.07, 0.06, 0.02, C.skyL, { ao: 0 });
      b.pop();
      b.interact('cama', 'Camilla', cx, fp.ld / 2 + 0.5);
    }
  },
});

add('biombo', {
  build(b, fp) {
    const n = 3, pw = 0.62, h = 1.45;
    for (let k = 0; k < n; k++) {
      const x = (k - 1) * 0.56, a = k % 2 ? 0.45 : -0.45;
      b.push(x, 0, 0, a);
      b.box(0, 0.08, 0, pw, h - 0.08, 0.04, C.woodD);
      b.box(0, 0.14, 0.021, pw - 0.1, h - 0.2, 0.01, k % 2 ? 0xe8dfc8 : 0xf4ecd6, { ao: 0.05 });
      b.box(0, 0.14, -0.021, pw - 0.1, h - 0.2, 0.01, k % 2 ? 0xe8dfc8 : 0xf4ecd6, { ao: 0.05 });
      b.box(0, 0.5, 0.027, pw - 0.14, 0.02, 0.004, C.sky, { ao: 0 });
      b.box(0, 0.95, 0.027, pw - 0.14, 0.02, 0.004, C.sky, { ao: 0 });
      b.box(0, 0, 0, pw, 0.08, 0.1, C.steelD);
      b.pop();
    }
  },
});

add('armario_medicinas', {
  build(b, fp) {
    const w = fp.lw - 0.1, z0 = back(fp), dep = 0.42, rnd = fp.rnd;
    b.box(0, 0, z0 + dep / 2, w, 0.85, dep, C.white);
    for (let k = 0; k < 4; k++) b.box(-w / 2 + 0.25 + k * (w - 0.5) / 3, 0.1, z0 + dep + 0.005, (w - 0.2) / 4, 0.7, 0.012, 0xe4eaee, { ao: 0.05 });
    b.box(0, 0.85, z0 + dep / 2, w + 0.02, 0.04, dep + 0.02, C.steelL, { ao: 0 });
    b.box(0, 0.89, z0 + dep / 2 - 0.04, w, 0.95, dep - 0.08, C.white);
    for (let l = 0; l < 4; l++) {
      const y = 0.96 + l * 0.23;
      b.box(0, y, z0 + dep / 2 - 0.04, w - 0.06, 0.02, dep - 0.1, C.steelL, { ao: 0 });
      const n = 6, empty = (fp.level ?? 1) === 0;
      for (let k = 0; k < n; k++) {
        if (empty && (k + l) % 4 !== 0) continue;
        const x = -w / 2 + 0.2 + k * (w - 0.4) / (n - 1);
        b.cyl(x, y + 0.02, z0 + 0.2, 0.035, 0.035, 0.07 + rnd() * 0.08, [C.orange, C.sky, C.white, C.greenL, C.pink][(k + l) % 5], 7);
        b.cyl(x + 0.0, y + 0.02, z0 + 0.3, 0.03, 0.03, 0.06 + rnd() * 0.05, [C.white, C.orange, C.sky][(k + l) % 3], 7);
      }
    }
    b.box(0, 0.9, z0 + dep - 0.01, w - 0.02, 0.92, 0.012, 0xcfe9f4, { layer: 'glass', ao: 0 });
    b.box(0, 0.9, z0 + dep, w - 0.02, 0.03, 0.02, C.steelL, { ao: 0 });
    b.box(0, 1.8, z0 + dep, w - 0.02, 0.03, 0.02, C.steelL, { ao: 0 });
    b.box(0, 1.83, z0 + dep / 2 - 0.04, w, 0.04, dep - 0.08, C.steelL, { ao: 0 });
  },
});

// ---------------------------------------------------------------- recepción: radio
add('centralita_radio', {
  build(b, fp) {
    const w = fp.lw - 0.1, d = fp.ld - 0.14;
    b.box(0, 0.7, 0, w, 0.05, d, 0x3b4658);
    for (const s of [-1, 1]) b.box(s * (w / 2 - 0.1), 0, 0, 0.2, 0.7, d - 0.04, 0x2d3646);
    b.box(0, 0.2, -d / 2 + 0.06, w - 0.5, 0.5, 0.03, 0x232a36);
    // equipo de radio en rack
    b.box(-0.4, 0.75, -0.25, 0.7, 0.3, 0.26, C.iron);
    b.sprite('panel_radio', -0.4, 0.9, -0.117, 0.62, 0.23, { screen: true });
    b.box(-0.4, 1.05, -0.25, 0.7, 0.14, 0.26, 0x2a2f36);
    b.box(-0.4, 1.12, -0.12, 0.5, 0.03, 0.01, C.green, { layer: 'glow', ao: 0 });
    b.light('pantalla', -0.4, 0.95, -0.05, 0x59f08a);
    monitor(b, 0.45, 0.75, -0.22, { screen: 'pantalla_radio', w: 0.4, h: 0.25 });
    // micrófono de sobremesa con cuello de cisne
    b.cyl(0.0, 0.75, 0.15, 0.07, 0.08, 0.025, C.iron, 10);
    b.box(0.0, 0.775, 0.15, 0.02, 0.22, 0.02, C.steelD, { rx: -0.12 });
    b.box(0.0, 0.99, 0.13, 0.02, 0.1, 0.02, C.steelD, { rx: -0.9 });
    b.sphere(0.0, 1.03, 0.2, 0.07, 0.07, 0.07, C.black, 8);
    b.box(-0.55, 0.75, 0.15, 0.3, 0.015, 0.12, C.black);          // pulsador
    b.cyl(-0.55, 0.765, 0.15, 0.035, 0.035, 0.02, C.red, 8);
    // antena y altavoz
    b.cyl(0.8, 0.75, -0.25, 0.01, 0.01, 0.7, C.steelD, 6);
    b.sphere(0.8, 1.45, -0.25, 0.04, 0.04, 0.04, C.red, 6);
    b.box(0.8, 0.75, -0.1, 0.2, 0.22, 0.14, C.black);
    b.cyl(0.8, 0.8, -0.03, 0.06, 0.06, 0.01, 0x555c66, 10, { rx: PI / 2 });
    // auriculares
    b.box(0.3, 0.75, 0.2, 0.18, 0.02, 0.1, C.iron);
    b.interact('radio', 'Centralita de radio', 0, fp.ld / 2 + 0.5);
  },
  companions: (fp) => [{ type: 'silla_oficina', lx: 0, lz: fp.ld / 2 + 0.12, rel: 180 }],
});

// ---------------------------------------------------------------- recepción: máquinas
add('cafetera', {
  build(b, fp) {
    const z0 = back(fp), rnd = fp.rnd;
    b.box(0, 0, z0 + 0.25, 0.9, 0.9, 0.5, C.cream);
    b.box(0, 0.9, z0 + 0.25, 0.94, 0.04, 0.54, C.woodD, { ao: 0.05 });
    b.box(0, 0.05, z0 + 0.505, 0.8, 0.78, 0.01, 0xfaf3e2, { ao: 0 });
    // cafetera industrial
    b.box(-0.15, 0.94, z0 + 0.28, 0.42, 0.48, 0.36, C.iron);
    b.box(-0.15, 1.4, z0 + 0.28, 0.44, 0.06, 0.38, C.red);
    b.sprite('cafe_panel', -0.15, 1.2, z0 + 0.462, 0.34, 0.255, { screen: true });
    b.light('pantalla', -0.15, 1.2, z0 + 0.55, 0x8fd0ff);
    b.box(-0.15, 1.0, z0 + 0.4, 0.14, 0.06, 0.1, C.steelD);
    b.cyl(-0.15, 0.94, z0 + 0.4, 0.04, 0.035, 0.07, C.white, 8);
    // jarra, tazas y azucarillos
    b.cyl(0.25, 0.94, z0 + 0.3, 0.07, 0.07, 0.17, 0xcfe0e8, 10);
    b.box(0.25, 0.94, z0 + 0.3, 0.2, 0.01, 0.2, C.iron, { ao: 0 });
    for (let k = 0; k < 3; k++) mug(b, 0.05 + k * 0.1, 0.94, z0 + 0.1 + rnd() * 0.06, [C.white, C.red, C.sky][k]);
    b.cyl(0.36, 0.94, z0 + 0.12, 0.05, 0.05, 0.14, C.white, 8);
    b.box(-0.35, 0.94, z0 + 0.1, 0.1, 0.07, 0.07, C.pink, { ao: 0.05 });
    b.interact('cafetera', 'Cafetera', 0, fp.ld / 2 + 0.5);
  },
});

add('vending', {
  build(b, fp) {
    const z0 = back(fp), dep = 0.78;
    b.box(0, 0, z0 + dep / 2, 0.88, 1.85, dep, 0xc92f26);
    b.box(0, 1.85, z0 + dep / 2, 0.9, 0.04, dep + 0.02, C.redD, { ao: 0 });
    b.sprite('vending_front', 0, 0.93, z0 + dep + 0.003, 0.82, 1.64);
    b.box(0, 0.0, z0 + dep / 2, 0.9, 0.08, dep + 0.02, C.iron, { ao: 0 });
    b.box(0, 0.27, z0 + dep + 0.01, 0.35, 0.1, 0.01, C.black, { ao: 0 }); // bandeja
    b.box(0.22, 1.35, z0 + dep + 0.004, 0.14, 0.05, 0.01, C.screenBlue, { layer: 'glow', ao: 0 });
    b.light('pantalla', 0, 1.5, z0 + dep + 0.4, 0xffe0c0);
    b.interact('vending', 'Máquina expendedora', 0, fp.ld / 2 + 0.5);
  },
});

// ---------------------------------------------------------------- calabozos
/**
 * Catre de celda: plancha de acero anclada a la pared con escuadras y patas, colchón fino de
 * vinilo y manta. Nivel 0: colchón con manchas, manta gris de saldo y cadena; I+: colchón nuevo y
 * manta naranja doblada. El largo va a lo largo de la pared (rot 90/270: el fondo es la pared).
 */
add('camastro', {
  fixedRot: 90,
  build(b, fp) {
    const L = fp.lw - 0.14, W = fp.ld - 0.32, lvl = fp.level ?? 0, rnd = fp.rnd;
    const zb = -fp.ld / 2 + 0.06;
    const plate = lvl ? C.steel : 0x8a8f86;
    b.box(0, 0.36, 0, L, 0.05, W, plate);
    b.box(0, 0.33, W / 2 - 0.02, L, 0.05, 0.04, C.steelD, { ao: 0 });                 // canto doblado
    for (const sx of [-1, 1]) {
      b.box(sx * (L / 2 - 0.12), 0.0, W / 2 - 0.07, 0.06, 0.36, 0.06, C.iron);          // pata
      b.box(sx * (L / 2 - 0.12), 0.1, zb + 0.06, 0.05, 0.26, 0.12, C.steelD, { ao: 0.05 }); // escuadra a la pared
      b.box(sx * (L / 2 - 0.12), 0.0, 0, 0.05, 0.03, W, C.iron, { ao: 0 });               // travesaño
    }
    const mat = lvl ? 0x4f74a0 : 0x9a9480;
    b.box(0, 0.41, 0, L - 0.08, 0.08, W - 0.06, mat, { ao: 0.08 });                      // colchón
    b.box(0, 0.41, 0, L - 0.06, 0.02, W - 0.04, lvl ? 0x3d5f88 : 0x857f6a, { ao: 0 });  // ribete
    b.box(L / 2 - 0.28, 0.49, 0, 0.4, 0.08, W - 0.14, lvl ? C.white : 0xcfc8b4, { ao: 0.1 }); // almohada
    if (!lvl) {
      for (let k = 0; k < 3; k++) b.box(-0.5 + k * 0.35 + rnd() * 0.1, 0.491, (rnd() - 0.5) * 0.2, 0.18 + rnd() * 0.12, 0.004, 0.12 + rnd() * 0.1, 0x7a6f55, { ry: rnd() * 3, ao: 0 });
      b.box(-0.25, 0.49, 0.05, 0.85, 0.04, W - 0.02, 0x7d7f7a, { ry: 0.12, ao: 0.08 });   // manta gris arrugada
      b.box(-0.6, 0.49, W / 2 - 0.02, 0.3, 0.3, 0.03, 0x7d7f7a, { rx: 0.25, ao: 0.08, oy: -0.3 }); // colgando
      // cadena oxidada en la pared
      for (let k = 0; k < 5; k++) b.box(L / 2 - 0.1, 0.5 + k * 0.08, zb, k % 2 ? 0.02 : 0.05, 0.07, k % 2 ? 0.05 : 0.02, 0x8a5232, { ao: 0 });
    } else {
      b.box(-0.45, 0.49, 0, 0.62, 0.07, W - 0.08, C.orange, { ao: 0.06 });                // manta doblada
      b.box(-0.45, 0.56, 0, 0.62, 0.008, 0.12, 0xf2c88a, { ao: 0 });
      if (lvl >= 2) b.box(-0.45, 0.568, 0.1, 0.22, 0.05, 0.16, C.white, { ao: 0.1 });     // toalla y jabón
    }
  },
});

/**
 * Váter de celda de acero (sin tapa, como manda el reglamento). Con variant 'lavabo+x' / 'lavabo-x'
 * va con un lavabo de pie de acero a ese lado; sin variante, el conjunto clásico con el lavabo
 * sobre la cisterna.
 */
add('wc', {
  build(b, fp) {
    const z0 = back(fp), lvl = fp.level ?? 0;
    const side = fp.variant === 'lavabo+x' ? 1 : fp.variant === 'lavabo-x' ? -1 : 0;
    const tx = side ? -side * 0.17 : 0;
    const steel = lvl >= 2 ? C.steelL : C.steel;
    b.box(tx, 0, z0 + 0.12, 0.42, 0.85, 0.22, steel);                                     // cisterna empotrada
    b.box(tx, 0.85, z0 + 0.12, 0.44, 0.03, 0.24, C.steelD, { ao: 0 });
    b.box(tx + 0.12, 0.7, z0 + 0.235, 0.07, 0.07, 0.02, C.steelD, { ao: 0 });            // pulsador
    b.box(tx, 0, z0 + 0.4, 0.3, 0.32, 0.32, steel);                                       // pie
    b.cyl(tx, 0.32, z0 + 0.42, 0.21, 0.17, 0.1, C.steelL, 14);                            // taza
    b.cyl(tx, 0.4, z0 + 0.43, 0.15, 0.15, 0.025, 0x7b848e, 14, { ao: 0 });
    if (!lvl) b.cyl(tx, 0.405, z0 + 0.43, 0.1, 0.1, 0.01, 0x8a7a4a, 10, { ao: 0 });      // agua turbia
    if (side) {
      const sx = side * 0.25;
      b.box(sx, 0, z0 + 0.22, 0.12, 0.78, 0.12, steel);                                   // pie del lavabo
      b.box(sx, 0.78, z0 + 0.22, 0.38, 0.1, 0.36, C.steelL);                              // pila
      b.box(sx, 0.85, z0 + 0.24, 0.3, 0.035, 0.26, 0x7b848e, { ao: 0 });
      b.box(sx, 0.88, z0 + 0.06, 0.05, 0.12, 0.05, C.steelD, { ao: 0 });                  // grifo
      b.box(sx, 0.97, z0 + 0.1, 0.03, 0.03, 0.1, C.steelD, { ao: 0 });
      if (lvl) b.box(sx + 0.1, 0.88, z0 + 0.12, 0.07, 0.03, 0.05, lvl >= 2 ? C.white : C.pink, { ao: 0 }); // pastilla de jabón
      else b.box(sx - 0.05, 0.4, z0 + 0.29, 0.02, 0.35, 0.02, 0x8a5232, { ao: 0, rz: 0.1 }); // tubería oxidada
      return;
    }
    b.box(tx, 0.88, z0 + 0.1, 0.46, 0.06, 0.2, C.steelL);
    b.cyl(tx, 0.82, z0 + 0.14, 0.14, 0.12, 0.07, C.steel, 12, { ao: 0 });
    b.cyl(tx, 0.94, z0 + 0.04, 0.012, 0.012, 0.1, C.steelD, 6);
  },
});

// ---------------------------------------------------------------- almacén
add('estanterias', {
  build(b, fp) {
    const n = Math.max(1, Math.round(fp.lw / 2)), z0 = back(fp), dep = 0.48, rnd = fp.rnd;
    for (let u = 0; u < n; u++) {
      const cx = -fp.lw / 2 + 1 + u * 2, w = 1.9;
      for (const sx of [-1, 1]) for (const sz of [0, 1]) b.box(cx + sx * (w / 2 - 0.03), 0, z0 + 0.03 + sz * (dep - 0.06), 0.05, 1.92, 0.05, C.blue);
      for (let l = 0; l < 5; l++) {
        const y = 0.05 + l * 0.44;
        b.box(cx, y, z0 + dep / 2, w, 0.035, dep, C.steel);
        if (l === 4) break;
        let x = cx - w / 2 + 0.1;
        while (x < cx + w / 2 - 0.3) {
          const bw = 0.22 + rnd() * 0.26, bh = 0.14 + rnd() * 0.2, bd = 0.22 + rnd() * 0.2;
          if (x + bw > cx + w / 2 - 0.06) break;
          if (rnd() < 0.18) {
            // bolsa de pruebas transparente con objeto
            b.box(x + bw / 2, y + 0.035, z0 + 0.12 + bd / 2, bw * 0.8, 0.02, bd * 0.8, 0xdff0f4, { layer: 'glass', ao: 0 });
            b.box(x + bw / 2, y + 0.04, z0 + 0.12 + bd / 2, bw * 0.4, 0.05, bd * 0.4, [C.iron, C.redD, C.steelD][(rnd() * 3) | 0], { ao: 0.05 });
          } else {
            cardboard(b, x + bw / 2, y + 0.035, z0 + 0.1 + bd / 2, bw, bh, bd, (rnd() - 0.5) * 0.08, rnd() < 0.3 ? C.kraftL : rnd() < 0.5 ? C.kraft : C.kraftD);
            b.box(x + bw / 2, y + 0.035 + bh * 0.55, z0 + 0.1 + bd + 0.002, 0.12, 0.06, 0.004, C.paper, { ao: 0 });
          }
          x += bw + 0.03 + rnd() * 0.05;
        }
      }
    }
    // Muros reforzados (almacén I-II): planchas de acero apoyadas y sacos de arena delante.
    const lvl = fp.level ?? 0;
    if (lvl >= 1) {
      const plates = lvl >= 2 ? n * 2 : n;
      for (let k = 0; k < plates; k++) {
        const x = -fp.lw / 2 + 0.5 + k * ((fp.lw - 1) / Math.max(1, plates - 1));
        b.box(x, 0, 0.2, 0.7, 1.15, 0.04, k % 2 ? 0x9aa4ae : 0x8d97a1, { rx: -0.22, ao: 0.08 });
        b.box(x, 0.85, 0.08, 0.5, 0.06, 0.01, k % 2 ? C.black : C.yellow, { rx: -0.22, oz: 0.03, ao: 0 });
      }
      for (let k = 0; k < (lvl >= 2 ? n * 3 : n * 2); k++) {
        const x = -fp.lw / 2 + 0.35 + k * 0.62;
        if (x > fp.lw / 2 - 0.3) break;
        b.sphere(x, 0, 0.36, 0.5, 0.2, 0.26, 0xd9c7a0, 7, { ao: 0.2 });
      }
    }
  },
});

add('cajas_apiladas', {
  build(b, fp) {
    const rnd = fp.rnd;
    cardboard(b, -0.12, 0, 0.1, 0.52, 0.4, 0.46, 0.12);
    cardboard(b, 0.2, 0, -0.22, 0.4, 0.34, 0.4, -0.2, C.kraftL);
    cardboard(b, -0.1, 0.4, 0.08, 0.42, 0.32, 0.38, -0.1, C.kraftD);
    cardboard(b, 0.22, 0.34, -0.22, 0.3, 0.26, 0.32, 0.25);
    cardboard(b, 0.0, 0.72, 0.05, 0.34, 0.26, 0.3, 0.3, C.kraftL);
    b.box(-0.1, 0.42 + 0.32 - 0.005, 0.08 + 0.19 + 0.002, 0.14, 0.07, 0.004, C.paper, { ao: 0, ry: -0.1 });
    b.box(0.3, 0.0, 0.3, 0.2, 0.04, 0.26, C.yellow, { ry: rnd() }); // bolsa de pruebas amarilla en el suelo
  },
});

add('mueble_generico', {
  build(b, fp) {
    b.box(0, 0, 0, fp.lw - 0.1, 0.8, fp.ld - 0.1, C.wood);
    b.box(0, 0.8, 0, fp.lw - 0.06, 0.05, fp.ld - 0.06, C.woodL);
  },
});
