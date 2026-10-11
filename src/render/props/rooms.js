import { C, PI, monitor, keyboard, mug, papers, deskLamp, cardboard, phone, gun } from './common.js';
import { spriteAspect } from './Atlas.js';
import { STATION, GLOBAL_MAX } from '../../systems/Station.js';

// Piezas de las salas de la comisaría que cambian con su NIVEL (fp.level; la maqueta y la
// fachada usan el nivel global, fp.global). Nivel 0 = presupuesto municipal: cajas, cinta
// americana, goteras y muebles viejos; cada nivel reforma la sala a la vista.
// Convenciones como en furniture.js (bloqueantes: origen en el centro de la huella, frente = +Z)
// y decor.js (de pared: origen en la cara del muro, hacia +Z).

export const ROOM_FURNITURE = {};
export const ROOM_DECOR = {};
const addF = (name, def) => { ROOM_FURNITURE[name] = { blocking: true, ...def }; };
const addD = (name, def) => { ROOM_DECOR[name] = { blocking: false, ...def }; };
const back = (fp) => -fp.ld / 2 + 0.03;
const TAPE = 0xb9b3a4;   // cinta americana
const RUST = 0x8a5232;
const BINDERS = [C.blue, C.red, C.green, C.yellow, C.navy];

/** Tira de cinta americana (cruz o tira) sobre una superficie. */
function tape(b, x, y, z, len, ry = 0, o = {}) {
  b.box(x, y, z, len, 0.006, 0.05, TAPE, { ry, ao: 0, ...o });
}

// ================================================================ MUEBLES (bloqueantes)

addF('estanteria_archivo', {
  build(b, fp) {
    const w = fp.lw - 0.08, z0 = back(fp), dep = 0.42, rnd = fp.rnd, lvl = fp.level ?? 0;
    for (const sx of [-1, 1]) for (const sz of [0, 1]) b.box(sx * (w / 2 - 0.03), 0, z0 + 0.03 + sz * (dep - 0.06), 0.05, 1.8, 0.05, lvl ? C.steelD : RUST);
    for (let l = 0; l < 5; l++) {
      const y = 0.05 + l * 0.42;
      b.box(0, y, z0 + dep / 2, w, 0.03, dep, lvl ? C.steel : 0x9a8f80, { ry: lvl ? 0 : (rnd() - 0.5) * 0.02 });
      if (l === 4) break;
      let x = -w / 2 + 0.08, nb = l;
      while (x < w / 2 - 0.12) {
        if (lvl) {
          // Archivadores de anillas en fila, con su etiqueta.
          const bw = 0.075;
          const col = BINDERS[(nb++ >> 2) % BINDERS.length];
          b.box(x + bw / 2, y + 0.03, z0 + 0.2, bw - 0.008, 0.32, 0.28, col, { ao: 0.05 });
          b.box(x + bw / 2, y + 0.2, z0 + 0.342, bw - 0.03, 0.06, 0.004, C.paper, { ao: 0 });
          x += bw;
        } else {
          // Cajas torcidas, huecos vacíos y papeles asomando.
          if (rnd() < 0.3) { x += 0.2 + rnd() * 0.2; continue; }
          const bw = 0.24 + rnd() * 0.2, bh = 0.14 + rnd() * 0.18;
          if (x + bw > w / 2 - 0.04) break;
          cardboard(b, x + bw / 2, y + 0.03, z0 + 0.2, bw, bh, 0.3, (rnd() - 0.5) * 0.3, rnd() < 0.5 ? C.kraft : C.kraftD);
          if (rnd() < 0.5) b.box(x + bw / 2, y + 0.03 + bh, z0 + 0.25, 0.2, 0.06, 0.004, C.paper, { ao: 0, rx: 0.4, ry: rnd() });
          x += bw + 0.04;
        }
      }
    }
    if (!lvl) papers(b, 0.2, 0.0, 0.3, rnd, 3);
  },
});

addF('servidor', {
  build(b, fp) {
    const z0 = back(fp), rnd = fp.rnd;
    b.box(0, 0, z0 + 0.36, 0.7, 1.95, 0.7, 0x1d2128);
    b.box(0, 0.06, z0 + 0.715, 0.6, 1.8, 0.012, 0x2b313a, { ao: 0.05 });
    for (let k = 0; k < 9; k++) {
      const y = 0.15 + k * 0.19;
      b.box(0, y, z0 + 0.722, 0.56, 0.14, 0.01, 0x3a414c, { ao: 0 });
      for (let n = 0; n < 6; n++) b.box(-0.22 + n * 0.06, y + 0.05, z0 + 0.73, 0.025, 0.025, 0.006, rnd() < 0.7 ? C.greenL : C.screenBlue, { layer: 'glow', ao: 0 });
      b.box(0.18, y + 0.05, z0 + 0.73, 0.08, 0.03, 0.006, (k % 3) ? C.screenBlue : C.orange, { layer: 'glow', ao: 0 });
    }
    b.box(0, 1.95, z0 + 0.36, 0.72, 0.04, 0.72, C.iron, { ao: 0 });
    b.light('pantalla', 0, 1.0, z0 + 0.9, 0x6ab8ff);
  },
});

addF('mesa_comedor', {
  build(b, fp) {
    const w = fp.lw - 0.9, d = fp.ld - 0.9, rnd = fp.rnd;
    b.box(0, 0, 0, 0.1, 0.72, 0.1, C.steelD);
    b.box(0, 0, 0, 0.6, 0.03, 0.6, C.iron, { ao: 0 });
    b.box(0, 0.72, 0, w, 0.04, d, 0xf0ead8);
    b.box(0, 0.72, 0, w + 0.02, 0.02, d + 0.02, C.steelL, { ao: 0 });
    for (const [x, z, a] of [[0, d / 2 + 0.2, 0], [0, -d / 2 - 0.2, PI], [w / 2 + 0.2, 0, PI / 2], [-w / 2 - 0.2, 0, -PI / 2]]) {
      b.push(x, 0, z, a);
      b.box(0, 0.42, 0, 0.4, 0.05, 0.38, C.red);
      b.box(0, 0.47, -0.17, 0.4, 0.4, 0.04, C.red);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 0.16, 0, sz * 0.15, 0.03, 0.42, 0.03, C.steelD, { ao: 0 });
      b.pop();
    }
    // Caja de pizza (vacía, como las esperanzas) y tazas.
    b.box(-0.2, 0.76, 0.1, 0.42, 0.04, 0.42, C.kraftL, { ry: 0.3 });
    b.box(-0.2, 0.8, 0.1, 0.2, 0.004, 0.2, C.red, { ry: 0.3, ao: 0 });
    mug(b, 0.3, 0.76, -0.2, C.white);
    mug(b, 0.4, 0.76, 0.25, C.sky);
    papers(b, 0.15, 0.76, -0.35, rnd, 2);
  },
});

addF('sofa', {
  build(b, fp) {
    const w = fp.lw - 0.1, d = fp.ld - 0.14, z = 0, col = 0x7a5a8a, colD = 0x5f4470;
    b.box(0, 0.08, z, w, 0.32, d, colD);
    for (let k = 0; k < 3; k++) b.box(-w / 3 + k * (w / 3), 0.4, z + 0.06, w / 3 - 0.04, 0.12, d - 0.18, col, { ao: 0.1 });
    b.box(0, 0.4, z - d / 2 + 0.1, w, 0.45, 0.2, colD);
    for (const s of [-1, 1]) b.box(s * (w / 2 - 0.08), 0.4, z, 0.16, 0.25, d, colD);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * (w / 2 - 0.08), 0, sz * (d / 2 - 0.08), 0.06, 0.08, 0.06, C.woodDD, { ao: 0 });
    tape(b, w * 0.18, 0.525, 0.06, 0.32, 0.6);
    tape(b, w * 0.18, 0.526, 0.06, 0.32, -0.6);
    b.box(-w / 4, 0.52, 0.0, 0.34, 0.12, 0.26, C.yellowL, { ry: 0.3, ao: 0.1 }); // cojín
  },
});

addF('maqueta', {
  build(b, fp) {
    const w = fp.lw - 0.12, d = fp.ld - 0.16;
    b.box(0, 0, 0, w - 0.1, 0.72, d - 0.1, C.woodD);
    b.box(0, 0.72, 0, w, 0.05, d, C.woodDD);
    b.box(0, 0.77, 0, w - 0.1, 0.02, d - 0.1, C.greenL, { ao: 0 });   // césped de maqueta
    // Edificio en miniatura: 27 casillas en el tejado, una encendida por nivel de la comisaría.
    const bw = w * 0.78, bd = d * 0.55, by = 0.79;
    b.box(0, by, 0, bw, 0.16, bd, 0xeee5d3);
    b.box(0, by + 0.16, 0, bw + 0.02, 0.012, bd + 0.02, C.black, { ao: 0 });
    const cols = 9, rows = Math.max(1, Math.round(GLOBAL_MAX / cols));
    const g = fp.global ?? 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const n = r * cols + c;
        const x = -bw / 2 + (c + 0.5) * (bw / cols), z = -bd / 2 + (r + 0.5) * (bd / rows);
        b.box(x, by + 0.172, z, bw / cols - 0.02, 0.01, bd / rows - 0.02, n < g ? C.yellow : 0x8a8f98, { layer: n < g ? 'glow' : 'solid', ao: 0 });
      }
    }
    // Banderita y cochecitos.
    b.cyl(-bw / 2 - 0.05, 0.79, bd / 2 + 0.08, 0.005, 0.005, 0.22, C.steelD, 5);
    b.box(-bw / 2 - 0.01, 0.93, bd / 2 + 0.08, 0.08, 0.05, 0.004, C.blue, { ao: 0 });
    for (const x of [-0.25, 0.05, 0.3]) b.box(x, 0.79, d / 2 - 0.1, 0.12, 0.05, 0.06, x > 0 ? C.white : C.blue, { ao: 0.1 });
    if (g >= STATION.facade.thresholds.placas) b.box(0, by + 0.02, bd / 2 + 0.005, bw, 0.06, 0.01, C.steel, { ao: 0 });
  },
});

addF('trastos', {
  build(b, fp) {
    const rnd = fp.rnd, n = Math.max(1, Math.round(fp.lw));
    for (let k = 0; k < n; k++) {
      const x = -fp.lw / 2 + 0.5 + k;
      const t = (k + ((fp.seed ?? 0) % 3)) % 3;
      if (t === 0) {
        cardboard(b, x - 0.1, 0, 0.0, 0.5, 0.4, 0.45, rnd() * 0.4 - 0.2);
        cardboard(b, x + 0.05, 0.4, -0.05, 0.38, 0.3, 0.36, rnd() * 0.4, C.kraftL);
        tape(b, x + 0.05, 0.705, -0.05, 0.3, 0.2);
      } else if (t === 1) {
        // Silla vieja patas arriba sobre una mesa coja.
        b.box(x, 0, -0.1, 0.06, 0.62, 0.06, C.woodD, { rz: 0.06 });
        b.box(x + 0.3, 0, 0.15, 0.06, 0.58, 0.06, C.woodD);
        b.box(x - 0.3, 0, 0.15, 0.06, 0.62, 0.06, C.woodD);
        b.box(x, 0.6, 0.0, 0.8, 0.04, 0.6, C.wood, { rz: 0.04 });
        b.box(x, 0.66, 0.0, 0.42, 0.05, 0.4, C.blue, { rz: PI - 0.1 });
        for (const sx of [-1, 1]) b.box(x + sx * 0.17, 0.7, 0.0, 0.03, 0.36, 0.03, C.iron, { ao: 0 });
      } else {
        // Cubo, fregona y rollo de cinta.
        b.cyl(x - 0.15, 0, 0.1, 0.17, 0.14, 0.3, C.yellow, 10);
        b.cyl(x - 0.15, 0.3, 0.1, 0.15, 0.15, 0.005, 0x6a8a9a, 10, { ao: 0 });
        b.box(x + 0.15, 0, -0.1, 0.03, 1.3, 0.03, C.woodL, { rz: 0.25 });
        b.cyl(x + 0.2, 0, 0.25, 0.08, 0.08, 0.05, TAPE, 10);
        cardboard(b, x + 0.15, 0, -0.25, 0.3, 0.25, 0.3, 0.3, C.kraftD);
      }
    }
  },
});

addF('banco_trabajo', {
  build(b, fp) {
    const w = fp.lw - 0.1, d = fp.ld - 0.14, rnd = fp.rnd, lvl = fp.level ?? 0;
    if (lvl < 2) {
      // Mesa vieja con herramientas tiradas.
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * (w / 2 - 0.06), 0, sz * (d / 2 - 0.06), 0.06, 0.8, 0.06, C.woodD);
      b.box(0, 0.8, 0, w, 0.04, d, C.wood, { rz: 0.01 });
      tape(b, 0.2, 0.84, 0.0, 0.5, 0.3);
      for (let k = 0; k < 4; k++) b.box(-0.6 + k * 0.35, 0.84, (rnd() - 0.5) * 0.3, 0.2, 0.03, 0.05, [C.red, C.steelD, C.yellow, C.iron][k], { ry: rnd() * 3, ao: 0 });
      cardboard(b, 0.6, 0, 0.0, 0.4, 0.3, 0.4, 0.2);
      return;
    }
    // Banco de trabajo de acero con panel de herramientas, tornillo de banco y flexo.
    b.box(0, 0, 0, w, 0.82, d, 0x59606a);
    for (let k = 0; k < 3; k++) b.box(-w / 3 + k * (w / 3), 0.1, d / 2 + 0.005, w / 3 - 0.06, 0.6, 0.01, 0x6c7580, { ao: 0.05 });
    b.box(0, 0.82, 0, w + 0.02, 0.05, d + 0.02, C.woodL);
    b.box(0, 0.87, -d / 2 + 0.03, w, 0.9, 0.03, 0x9aa4ae);
    for (let k = 0; k < 7; k++) b.box(-w / 2 + 0.2 + k * (w - 0.4) / 6, 1.1 + (k % 2) * 0.3, -d / 2 + 0.06, 0.05, 0.22, 0.02, [C.red, C.blue, C.yellow, C.iron][k % 4], { ao: 0 });
    b.box(w / 2 - 0.3, 0.87, 0.1, 0.16, 0.12, 0.2, C.blue);
    b.box(w / 2 - 0.3, 0.99, 0.1, 0.22, 0.04, 0.08, C.iron, { ao: 0 });
    b.box(-0.2, 0.87, 0.05, 0.5, 0.04, 0.1, C.iron, { ry: 0.1 });       // fusil desmontado
    b.box(0.1, 0.87, 0.05, 0.16, 0.06, 0.05, C.woodD, { ry: 0.1 });
    deskLamp(b, -w / 2 + 0.2, 0.87, -0.1, 0.5);
  },
});

addF('duchas', {
  build(b, fp) {
    const n = Math.round(fp.lw), z0 = back(fp), lvl = fp.level ?? 0;
    const tile = lvl >= 2 ? 0xdfeef6 : 0xc9d3c8;
    b.box(0, 0, z0 + 0.03, fp.lw - 0.04, 2.1, 0.06, tile);
    for (let k = 0; k < n; k++) {
      const x = -fp.lw / 2 + 0.5 + k;
      b.box(x, 0.003, 0, 0.86, 0.02, fp.ld - 0.1, lvl >= 2 ? C.white : 0xb8b8ae, { ao: 0 });
      b.cyl(x, 0.004, 0, 0.05, 0.05, 0.022, C.iron, 8, { ao: 0 });
      b.box(x, 1.95, z0 + 0.12, 0.03, 0.03, 0.2, C.steelL, { ao: 0 });
      if (lvl >= 2 || k !== 1) b.cyl(x, 1.88, z0 + 0.22, 0.06, 0.08, 0.07, C.steelL, 10);
      b.box(x, 0.95, z0 + 0.07, 0.12, 0.12, 0.04, C.steelD, { ao: 0 });
      if (k < n) b.box(x + 0.48, 0, 0, 0.04, 1.9, fp.ld - 0.1, lvl >= 2 ? C.white : 0xa8b4a0); // mampara
      if (lvl >= 2) {
        b.box(x, 0.1, fp.ld / 2 - 0.08, 0.8, 1.75, 0.02, 0xcfe9f4, { layer: 'glass', ao: 0 });
      } else if (k % 2 === 0) {
        b.box(x - 0.2, 0.35, fp.ld / 2 - 0.1, 0.35, 1.5, 0.02, 0xd9c26a, { ao: 0.05, rz: 0.05 }); // cortina amarillenta
      }
      if (!lvl) b.box(x + 0.1, 0.6, z0 + 0.065, 0.3, 0.5, 0.004, 0x6b7a4a, { ao: 0 }); // moho
    }
  },
});

addF('banco_vestuario', {
  build(b, fp) {
    const w = fp.lw - 0.1, lvl = fp.level ?? 0;
    b.box(0, 0.42, 0, w, 0.05, 0.36, lvl >= 2 ? C.woodL : C.wood);
    for (const s of [-1, 0, 1]) b.box(s * (w / 2 - 0.12), 0, 0, 0.05, 0.42, 0.3, C.iron);
    if (lvl >= 2) {
      b.box(-0.6, 0.47, 0, 0.4, 0.06, 0.3, C.white, { ao: 0.1 });
      b.box(0.5, 0.47, 0.02, 0.38, 0.05, 0.28, C.sky, { ao: 0.1, ry: 0.2 });
    } else {
      tape(b, 0.3, 0.475, 0.0, 0.34, 0.0);
      b.box(-0.7, 0.47, 0.05, 0.3, 0.1, 0.2, C.greenD, { ao: 0.1, ry: 0.4 }); // bolsa de deporte olvidada
    }
  },
});

addF('lavabos', {
  build(b, fp) {
    const w = fp.lw - 0.1, z0 = back(fp), lvl = fp.level ?? 0;
    b.box(0, 0, z0 + 0.25, w, 0.82, 0.5, lvl >= 2 ? C.white : 0xd8d2c0);
    b.box(0, 0.82, z0 + 0.27, w + 0.02, 0.05, 0.54, lvl >= 2 ? 0x3a4a5a : 0x9a948a);
    const n = Math.round(fp.lw);
    for (let k = 0; k < n; k++) {
      const x = -w / 2 + (k + 0.5) * (w / n);
      b.cyl(x, 0.8, z0 + 0.3, 0.17, 0.14, 0.08, C.white, 12, { ao: 0 });
      b.box(x, 0.87, z0 + 0.06, 0.03, 0.14, 0.03, C.steelL, { ao: 0 });
      b.box(x, 0.98, z0 + 0.1, 0.03, 0.03, 0.12, C.steelL, { ao: 0 });
    }
    b.box(0, 1.1, z0 + 0.01, w - 0.1, 0.8, 0.02, 0xbfe3f2, { layer: 'glass', ao: 0 });
    b.box(0, 1.1, z0 + 0.005, w - 0.06, 0.82, 0.01, C.steelD, { ao: 0 });
    if (!lvl) b.box(0.3, 1.2, z0 + 0.024, 0.02, 0.6, 0.004, C.black, { rz: 0.5, ao: 0 }); // espejo roto
  },
});

// ================================================================ DECORACIÓN (no bloqueante)

/**
 * Cartel de sala con sus estrellas de nivel. p: { room, stars, max, hang (banderola),
 * post (poste en el exterior), ladder (escalera a la azotea) }.
 */
addD('cartel_sala', {
  build(b, fp) {
    const p = fp.p, S = STATION.signs;
    const spr = `sala_${p.room}`;
    const w = p.w ?? S.w, h = w / spriteAspect(spr), cy = p.y ?? S.y;
    let z = 0.033;
    if (p.post) {
      b.cyl(0, 0, -0.06, 0.04, 0.05, cy + h / 2, C.steelD, 8);
      b.cyl(0, 0, -0.06, 0.12, 0.14, 0.05, C.iron, 8);
      z = 0.0;
    }
    if (p.ladder) {
      // Escalera de gato hasta el tejado.
      for (const s of [-1, 1]) b.box(s * 0.22, 0, 0.12, 0.04, 2.85, 0.04, C.steelD, { ao: 0 });
      for (let k = 0; k < 9; k++) b.box(0, 0.25 + k * 0.3, 0.12, 0.44, 0.03, 0.03, C.steel, { ao: 0 });
      for (const y of [0.6, 2.2]) for (const s of [-1, 1]) b.box(s * 0.22, y, 0.06, 0.03, 0.03, 0.1, C.iron, { ao: 0 });
      b.push(0.85, 0, 0);
    }
    if (p.hang) for (const s of [-1, 1]) b.box(s * (w / 2 - 0.08), cy + h / 2, z - 0.01, 0.015, 2.6 - cy - h / 2, 0.015, C.iron, { ao: 0 });
    b.box(0, cy - h / 2 - 0.02, z - 0.03, w + 0.05, h + 0.04, 0.03, 0x2b2b30, { ao: 0 });
    b.sprite(spr, 0, cy, z + 0.003, w, h);
    if (p.hang) b.sprite(spr, 0, cy, z - 0.034, w, h, { ry: PI }); // por detrás también
    const n = p.max ?? 0;
    if (n > 0) {
      const sz = S.star, step = S.star + S.starGap, sy = cy - h * 0.27;
      for (let k = 0; k < n; k++) {
        const x = (k - (n - 1) / 2) * step;
        const on = k < (p.stars ?? 0);
        b.sprite(on ? 'estrella_on' : 'estrella_off', x, sy, z + 0.008, sz, sz, { screen: on });
      }
    }
    if (p.ladder) b.pop();
  },
});

addD('fluorescente', {
  build(b, fp) {
    const y = fp.p.y ?? 2.42, w = fp.p.w ?? 1.2;
    b.box(0, y, 0.06, w, 0.06, 0.12, C.steelL, { ao: 0 });
    b.box(0, y - 0.04, 0.06, w - 0.1, 0.04, 0.03, C.lampWarm, { layer: 'glow', ao: 0, oz: -0.03 });
    if (fp.p.flicker) {
      // Un tubo fundido y el otro a medio colgar: el presupuesto de mantenimiento en acción.
      b.box(-0.25, y - 0.05, 0.1, w * 0.5, 0.035, 0.03, 0x6d6a60, { ao: 0, rz: 0.12 });
    } else {
      b.box(0, y - 0.04, 0.09, w - 0.1, 0.04, 0.03, C.lampWarm, { layer: 'glow', ao: 0 });
    }
    b.light('lampara', 0, y - 0.3, 0.8, 0xfff3d6);
  },
});

addD('manchas_oxido', {
  build(b, fp) {
    for (let k = 0; k < 5; k++) b.cyl((fp.rnd() - 0.5) * 3, 0.003, (fp.rnd() - 0.5) * 1.6, 0.2 + fp.rnd() * 0.25, 0.2, 0.004, k % 2 ? RUST : 0x6b4a33, 10, { ao: 0 });
  },
});

addD('gotera', {
  build(b) {
    b.cyl(0.05, 0.003, 0.05, 0.42, 0.42, 0.004, 0x7fa3bf, 14, { layer: 'glass', ao: 0 });
    b.cyl(0, 0, 0, 0.14, 0.11, 0.28, C.red, 10);
    b.cyl(0, 0.27, 0, 0.12, 0.12, 0.006, 0x6a8a9a, 10, { ao: 0 });
    b.box(0, 0.28, -0.13, 0.2, 0.012, 0.012, C.iron, { ao: 0, rx: 0.8 });
  },
});

addD('suelo_electrico', {
  build(b, fp) {
    const w = fp.p.w ?? 4, d = fp.p.d ?? 3;
    // Rejilla de pletinas de cobre y un borde de franjas de peligro.
    for (let x = -w / 2; x <= w / 2 + 1e-3; x += 0.5) b.box(x, 0.002, 0, 0.04, 0.006, d, 0xb8733a, { ao: 0 });
    for (let z = -d / 2; z <= d / 2 + 1e-3; z += 0.5) b.box(0, 0.002, z, w, 0.006, 0.04, 0xb8733a, { ao: 0 });
    const n = Math.round(w / 0.4);
    for (let k = 0; k < n; k++) {
      const x = -w / 2 + (k + 0.5) * (w / n);
      for (const s of [-1, 1]) b.box(x, 0.004, s * (d / 2 + 0.06), w / n, 0.006, 0.1, k % 2 ? C.black : C.yellow, { ao: 0 });
    }
  },
});

addD('chispas', {
  build(b, fp) {
    const w = fp.p.w ?? 4, d = fp.p.d ?? 3, rnd = fp.rnd;
    for (let k = 0, n = fp.p.n ?? 14; k < n; k++) {
      const x = (rnd() - 0.5) * w, z = (rnd() - 0.5) * d, a = rnd() * PI;
      b.box(x, 0.01, z, 0.22, 0.012, 0.025, 0x8fd8ff, { layer: 'glow', ao: 0, ry: a });
      b.box(x, 0.01, z, 0.14, 0.012, 0.025, 0xffffff, { layer: 'glow', ao: 0, ry: a + PI / 2 });
    }
  },
});

addD('cajas_suelo', {
  build(b, fp) {
    const rnd = fp.rnd;
    for (let k = 0; k < 3; k++) b.box((rnd() - 0.5) * 0.9, 0.004 + k * 0.006, (rnd() - 0.5) * 0.6, 0.6, 0.012, 0.45, k % 2 ? C.kraft : C.kraftD, { ry: rnd() * 3, ao: 0 });
    cardboard(b, 0.25, 0, 0.1, 0.32, 0.18, 0.28, rnd(), C.kraftL);
  },
});

addD('toallas_suelo', {
  build(b, fp) {
    for (let k = 0; k < 2; k++) b.box((fp.rnd() - 0.5) * 0.6, 0.006 + k * 0.01, (fp.rnd() - 0.5) * 0.4, 0.6, 0.02, 0.35, k ? C.white : C.sky, { ry: fp.rnd() * 3, ao: 0.05 });
  },
});

addD('silla_rota', {
  build(b) {
    b.box(0, 0.0, 0, 0.44, 0.05, 0.42, C.blue, { rz: 0.25 });
    b.box(-0.22, 0.05, 0, 0.42, 0.4, 0.05, C.blue, { rz: 1.5, ry: 0.1 });
    for (const [x, z] of [[0.18, 0.15], [0.18, -0.15]]) b.box(x, 0.08, z, 0.03, 0.4, 0.03, C.iron, { rz: 1.2, ao: 0 });
    b.box(0.35, 0.0, 0.3, 0.03, 0.4, 0.03, C.iron, { rz: 1.57, ry: 0.6, ao: 0 });
  },
});

addD('calendario', {
  build(b, fp) {
    const cy = fp.p.y ?? 1.6;
    b.sprite('calendario', 0, cy, 0.012, 0.4, 0.5);
    b.box(0, cy + 0.25, 0.01, 0.03, 0.03, 0.02, C.iron, { ao: 0 });
  },
});

/** Pared de monitores del despacho: tele vieja (0), 2×2 (I) o 3×3 con barra de estado (II). */
addD('monitores_pared', {
  build(b, fp) {
    const lvl = fp.level ?? 0;
    if (!lvl) {
      b.box(0, 1.55, 0.06, 0.06, 0.06, 0.12, C.iron, { ao: 0 });
      b.box(0, 1.25, 0.22, 0.62, 0.48, 0.42, 0x5a5048);
      b.sprite('pantalla_cam', 0, 1.49, 0.432, 0.48, 0.3, { screen: true });
      b.box(0.23, 1.3, 0.433, 0.06, 0.06, 0.004, C.black, { ao: 0 });
      b.light('pantalla', 0, 1.45, 0.7, 0x7affb0);
      return;
    }
    const n = lvl >= 2 ? 3 : 2, mw = 0.62, mh = 0.4, gap = 0.06;
    const W = n * mw + (n - 1) * gap, H = n * mh + (n - 1) * gap, y0 = 2.45 - H;
    b.box(0, y0 - 0.06, 0.02, W + 0.12, H + 0.12, 0.04, C.iron, { ao: 0 });
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const x = -W / 2 + mw / 2 + c * (mw + gap), y = y0 + mh / 2 + r * (mh + gap);
      b.box(x, y - mh / 2 - 0.02, 0.06, mw + 0.04, mh + 0.04, 0.05, C.black, { ao: 0 });
      b.sprite((r + c) % 3 === 1 ? 'pantalla_radio' : 'pantalla_cam', x, y, 0.087, mw, mh, { screen: true });
    }
    if (lvl >= 2) b.box(0, y0 - 0.16, 0.06, W, 0.06, 0.02, C.red, { layer: 'glow', ao: 0 });
    b.light('pantalla', 0, y0 + H / 2, 0.8, 0x7affb0);
  },
});

addD('puerta_acorazada', {
  build(b) {
    const cy = 1.0, r = 0.82;
    b.box(0, cy - r - 0.1, 0.02, r * 2 + 0.3, r * 2 + 0.2, 0.04, 0x59606a, { ao: 0 });
    b.cyl(0, cy, 0.06, r, r, 0.16, C.steel, 24, { rx: PI / 2, oy: -0.08, ao: 0.05 });
    b.cyl(0, cy, 0.15, r * 0.82, r * 0.82, 0.03, C.steelL, 24, { rx: PI / 2, ao: 0 });
    b.cyl(0, cy, 0.17, 0.12, 0.12, 0.08, C.steelD, 12, { rx: PI / 2, ao: 0 });
    for (let k = 0; k < 3; k++) b.box(0, cy, 0.22, 0.9, 0.06, 0.05, C.steelD, { rz: (k * PI) / 3, ao: 0, oy: -0.03 });
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * PI * 2;
      b.cyl(Math.cos(a) * r * 0.9, cy + Math.sin(a) * r * 0.9, 0.15, 0.03, 0.03, 0.03, C.iron, 6, { rx: PI / 2, ao: 0 });
    }
    b.box(r + 0.1, cy - 0.3, 0.1, 0.12, 0.6, 0.12, C.iron); // bisagra
  },
});

addD('cruz_luminosa', {
  build(b, fp) {
    const cy = fp.p.y ?? 1.75, s = 0.8;
    b.box(0, cy - s / 2 - 0.04, 0.02, s + 0.08, s + 0.08, 0.04, C.white, { ao: 0 });
    b.box(0, cy - s / 2, 0.05, s * 0.3, s, 0.03, 0x2fd06a, { layer: 'glow', ao: 0 });
    b.box(0, cy - s * 0.15, 0.05, s, s * 0.3, 0.03, 0x2fd06a, { layer: 'glow', ao: 0 });
    b.light('lampara', 0, cy, 0.5, 0x2fd06a);
  },
});

addD('perchero_chalecos', {
  build(b, fp) {
    const n = (fp.level ?? 1) >= 2 ? 4 : 2, w = 0.9;
    b.box(0, 1.72, 0.12, w, 0.03, 0.03, C.steelL, { ao: 0 });
    for (const s of [-1, 1]) b.box(s * (w / 2), 1.72, 0.06, 0.03, 0.03, 0.12, C.steelL, { ao: 0 });
    for (let k = 0; k < n; k++) {
      const x = -w / 2 + (k + 0.5) * (w / n);
      b.box(x, 1.05, 0.13, w / n - 0.04, 0.62, 0.1, C.navy, { ao: 0.1 });
      b.box(x, 1.3, 0.183, w / n - 0.06, 0.07, 0.004, C.yellow, { ao: 0 });
      b.box(x, 1.67, 0.13, 0.04, 0.06, 0.04, C.iron, { ao: 0 });
    }
  },
});

/**
 * Fachada sur con el nivel global de la comisaría: rótulo «COMISARÍA · DISTRITO 13» y placa
 * «NIVEL n»; con el nivel sube la pintura (franja y zócalo), el rótulo luminoso y las placas de acero.
 */
addD('fachada', {
  build(b, fp) {
    const F = STATION.facade, T = F.thresholds, g = fp.global ?? 0;
    const col = (k) => parseInt(F.colors[k].slice(1), 16);
    const gaps = F.doorGaps;
    const spans = [];
    let from = F.x0;
    for (const [a, c] of gaps) { spans.push([from, a]); from = c; }
    spans.push([from, F.x1]);
    // b.root está en (0, 0, F.z) sin giro: x en celdas absolutas → desplazamiento local.
    const ox = fp.p.ox ?? 0;
    for (const [a, c] of spans) {
      const w = c - a, cx = (a + c) / 2 - ox;
      if (g >= T.pintura) {
        b.box(cx, 0.0, 0.012, w, 0.35, 0.024, col('zocalo'), { ao: 0 });
        b.box(cx, 0.95, 0.012, w, 0.18, 0.024, col('pintura'), { ao: 0 });
      }
      if (g >= T.placas) {
        const n = Math.max(1, Math.round(w / 1.6));
        for (let k = 0; k < n; k++) {
          const px = a + (k + 0.5) * (w / n) - ox;
          b.box(px, 0.36, 0.03, w / n - 0.06, 0.56, 0.04, col('placas'), { ao: 0.05 });
          for (const sx of [-1, 1]) for (const y of [0.42, 0.86]) b.box(px + sx * (w / n / 2 - 0.12), y, 0.052, 0.05, 0.05, 0.02, col('remaches'), { ao: 0 });
        }
      }
    }
    // Rótulo principal y nivel.
    const S = F.sign, L = F.level;
    const lit = g >= T.rotulo;
    const sw = S.w, sh = sw / spriteAspect('comisaria');
    b.box(S.x - ox, S.y - sh / 2 - 0.05, 0.02, sw + 0.12, sh + 0.1, 0.05, lit ? C.steelD : 0x2b2b30, { ao: 0 });
    b.sprite('comisaria', S.x - ox, S.y, 0.047, sw, sh, { screen: lit });
    if (lit) {
      b.box(S.x - ox, S.y + sh / 2 + 0.02, 0.06, sw + 0.1, 0.04, 0.06, C.lampWarm, { layer: 'glow', ao: 0 });
      b.light('lampara', S.x - ox, S.y, 0.8, 0xfff3d6);
    }
    const lw = L.w, lh = lw / spriteAspect('nivel');
    const digits = String(g);
    const dh = lh, dw = dh * spriteAspect('dig_0');
    const total = lw + digits.length * dw + 0.05;
    let x = L.x - ox - total / 2;
    b.box(L.x - ox, L.y - dh / 2 - 0.04, 0.02, total + 0.1, dh + 0.08, 0.04, 0x14181f, { ao: 0 });
    b.sprite('nivel', x + lw / 2, L.y, 0.043, lw, lh, { screen: lit });
    x += lw + 0.05;
    for (const ch of digits) { b.sprite(`dig_${ch}`, x + dw / 2, L.y, 0.043, dw, dh, { screen: true }); x += dw; }
  },
});

// ================================================================ CALABOZOS

/** Color de las rejas con el nivel de los calabozos (el mismo que les pone DespachoRenderer). */
function barColor(lvl) {
  const cols = STATION.rooms.find((r) => r.id === 'calabozos')?.barColors ?? ['#3a3d42'];
  return parseInt(cols[Math.min(lvl, cols.length - 1)].slice(1), 16);
}

/** Mesa del guardia: libro de registro, llavero, emisora, flexo y monitor de las celdas. */
addF('mesa_guardia', {
  build(b, fp) {
    const w = fp.lw - 0.1, d = fp.ld - 0.2, lvl = fp.level ?? 0, rnd = fp.rnd;
    b.box(0, 0.72, 0, w, 0.04, d, lvl ? 0x8d97a1 : 0xb9ad8f);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.05), 0.05, 0.72, 0.05, C.iron);
    b.box(w / 2 - 0.3, 0.3, 0, 0.45, 0.42, d - 0.1, lvl ? C.steelD : 0x9aa0a8);         // cajonera
    for (let k = 0; k < 2; k++) b.box(w / 2 - 0.3, 0.35 + k * 0.2, d / 2 - 0.04, 0.12, 0.02, 0.02, C.iron, { ao: 0 });
    // libro de registro abierto y bolígrafo atado con cuerda
    b.box(-0.35, 0.76, 0.05, 0.42, 0.03, 0.3, C.redD, { ry: 0.08 });
    b.box(-0.35, 0.79, 0.05, 0.38, 0.006, 0.27, C.paper, { ry: 0.08, ao: 0 });
    b.box(-0.35, 0.796, 0.05, 0.004, 0.004, 0.27, C.paperD, { ry: 0.08, ao: 0 });
    b.box(-0.1, 0.79, 0.12, 0.13, 0.012, 0.012, C.blue, { ry: 0.5, ao: 0 });
    // llavero de las celdas
    b.cyl(0.05, 0.76, -0.12, 0.06, 0.06, 0.01, C.yellow, 10, { ao: 0 });
    for (let k = 0; k < 4; k++) b.box(0.05 + Math.cos(k) * 0.06, 0.765, -0.12 + Math.sin(k) * 0.06, 0.07, 0.01, 0.02, C.yellow, { ry: k, ao: 0 });
    monitor(b, 0.45, 0.76, -0.15, { screen: 'pantalla_cam', w: 0.36, h: 0.22 });
    deskLamp(b, -0.75, 0.76, -0.12, 0.6);
    mug(b, 0.2, 0.76, 0.15, lvl ? C.navy : C.white);
    if (!lvl) { papers(b, 0.0, 0.76, -0.05, rnd, 4); cardboard(b, 0.62, 0.76, 0.12, 0.2, 0.1, 0.16, 0.4, C.kraftL); } // caja de donuts
    else phone(b, 0.0, 0.76, -0.05, 0.3, C.steelD);
  },
  companions: (fp) => [{ type: 'silla_oficina', lx: -0.2, lz: fp.ld / 2 + 0.12, rel: 180 }],
});

/**
 * Puerta de reja corredera de una celda, abierta: corre sobre la reja vecina (p.slide = -1 / 1)
 * por el lado del pasillo. Nivel 0 oxidada y descolgada; I candado nuevo; II cerradura con piloto.
 */
addD('puerta_reja', {
  build(b, fp) {
    const lvl = fp.level ?? 0, s = fp.p.slide ?? -1, col = barColor(lvl);
    const z = 0.14, H = 2.2, W = 0.9;
    b.box(s * 0.45, 2.24, z, 1.9, 0.06, 0.06, C.iron, { ao: 0 });                         // carril
    b.push(s * 0.82, 0, z);
    const tilt = lvl ? 0 : 0.02;
    for (const y of [0.06, 1.05, H - 0.05]) b.box(0, y, 0, W, 0.06, 0.05, col, { ao: 0, rz: tilt });
    for (const x of [-W / 2 + 0.03, W / 2 - 0.03]) b.box(x, 0.06, 0, 0.06, H - 0.06, 0.05, col, { ao: 0.05, rz: tilt });
    for (let k = 1; k < 8; k++) b.box(-W / 2 + k * (W / 8), 0.08, 0, 0.03, H - 0.1, 0.03, col, { ao: 0, rz: tilt });
    b.box(0, 0.95, 0.02, 0.36, 0.22, 0.012, col, { ao: 0 });                               // bandeja para la comida
    // cerradura en el canto que cierra (hacia el hueco)
    const lx = -s * (W / 2 - 0.06);
    b.box(lx, 0.98, 0.035, 0.12, 0.2, 0.06, lvl ? C.steelD : 0x6b4a33);
    if (lvl === 1) b.box(lx, 0.86, 0.07, 0.07, 0.08, 0.025, C.yellow, { ao: 0 });         // candado
    if (lvl >= 2) b.box(lx, 1.06, 0.068, 0.04, 0.03, 0.006, C.green, { layer: 'glow', ao: 0 });
    for (const x of [-0.3, 0.3]) b.cyl(x, H + 0.0, 0, 0.035, 0.035, 0.04, C.iron, 8, { rx: PI / 2, ao: 0 }); // ruedas
    b.pop();
  },
});

/** Ventanuco alto con barrotes (pared exterior de las celdas). */
addD('ventanuco', {
  build(b, fp) {
    const cy = fp.p.y ?? 2.0, w = 0.62, h = 0.34, lvl = fp.level ?? 0;
    b.box(0, cy - h / 2 - 0.05, 0.02, w + 0.1, h + 0.1, 0.04, 0x8a8f86, { ao: 0 });
    b.box(0, cy - h / 2, 0.03, w, h, 0.02, lvl ? 0x9fc8e8 : 0x8aa0aa, { ao: 0 });
    b.box(0, cy - h / 2, 0.041, w * 0.45, h, 0.004, 0xdbeef8, { ao: 0, rz: 0.0 });        // reflejo
    for (let k = 0; k < 5; k++) b.box(-w / 2 + (k + 0.5) * (w / 5), cy - h / 2, 0.06, 0.025, h, 0.025, lvl ? C.iron : RUST, { ao: 0 });
    b.box(0, cy - h / 2 - 0.07, 0.05, w + 0.12, 0.04, 0.08, 0x8a8f86, { ao: 0 });         // alféizar
  },
});

/** Plafón enrejado antivandálico (con su luz). */
addD('lampara_jaula', {
  build(b, fp) {
    const y = fp.p.y ?? 2.32;
    b.box(0, y - 0.02, 0.0, 0.34, 0.12, 0.04, C.iron, { ao: 0 });
    b.box(0, y, 0.08, 0.26, 0.08, 0.14, C.lampWarm, { layer: 'glow', ao: 0 });
    for (const x of [-0.12, -0.04, 0.04, 0.12]) b.box(x, y - 0.03, 0.08, 0.015, 0.14, 0.18, C.iron, { ao: 0 });
    b.box(0, y - 0.03, 0.17, 0.3, 0.14, 0.015, C.iron, { ao: 0 });
    b.light('lampara', 0, y - 0.25, 0.6, 0xfff3d6);
  },
});

/** Manta tirada en el suelo de una celda (nivel 0). */
addD('manta_suelo', {
  build(b, fp) {
    const rnd = fp.rnd;
    b.box(0, 0.005, 0, 0.7, 0.03, 0.5, 0x7d7f7a, { ry: rnd(), ao: 0.05 });
    b.box(0.15, 0.03, 0.05, 0.35, 0.05, 0.3, 0x6f716c, { ry: rnd() * 2, ao: 0.05 });
    b.box(-0.2, 0.004, -0.15, 0.12, 0.012, 0.18, C.paperD, { ry: rnd() * 3, ao: 0 });     // carta a mamá
  },
});


// ================================================================ ARMERÍA

/**
 * Tablero de pared con pistolas, porras, grilletes y emisoras sobre sus siluetas pintadas: lo que
 * falta (nivel bajo) deja a la vista la silueta, como en los talleres.
 */
addD('panel_armas', {
  build(b, fp) {
    const lvl = fp.level ?? 0, cy = fp.p.y ?? 1.45, w = fp.p.w ?? 1.4, h = 0.95, SIL = 0x3f444c;
    const fill = [3, 5, 8, 10][Math.min(lvl, 3)];
    b.box(0, cy - h / 2, 0.015, w, h, 0.03, 0x6c7580, { ao: 0 });
    b.box(0, cy - h / 2 - 0.03, 0.02, w + 0.06, 0.04, 0.05, C.iron, { ao: 0 });
    b.box(0, cy + h / 2 - 0.01, 0.02, w + 0.06, 0.04, 0.05, C.iron, { ao: 0 });
    let n = 0;
    const put = (kind, x, y, o = {}) => {
      const has = ((n++ * 7) % 10) < fill;
      gun(b, kind, x, y, 0.04, has ? o : { ...o, color: SIL, t: 0.004 });
    };
    for (let k = 0; k < 4; k++) put('pistola', -w / 2 + 0.12 + k * 0.3, cy + 0.27, { s: 1.25 });
    put('porra', -w / 2 + 0.1, cy - 0.05, { s: 1.0 });
    put('porra', -w / 2 + 0.1, cy - 0.28, { s: 1.0 });
    put('subfusil', 0.02, cy - 0.12, { s: 1.0 });
    // grilletes y una emisora (siempre: los zombis no se los llevan)
    for (const dx of [-0.05, 0.05]) b.cyl(0.32 + dx + 0.25, cy - 0.33, 0.045, 0.045, 0.045, 0.012, C.steelL, 8, { rx: PI / 2, ao: 0 });
    b.box(0.35, cy - 0.42, 0.05, 0.07, 0.17, 0.04, C.black, { ao: 0.05 });
    b.box(0.37, cy - 0.25, 0.05, 0.012, 0.09, 0.012, C.black, { ao: 0 });
    b.box(0.35, cy - 0.33, 0.071, 0.04, 0.04, 0.004, lvl ? C.green : C.red, { layer: 'glow', ao: 0 });
  },
});

/** Chalecos antibalas con «POLICÍA» y cascos antidisturbios colgados (más cuanto mayor el nivel). */
addD('chalecos_armeria', {
  build(b, fp) {
    const lvl = fp.level ?? 0, w = fp.p.w ?? 1.3, n = [1, 2, 3, 3][Math.min(lvl, 3)];
    b.box(0, 1.78, 0.1, w, 0.04, 0.04, C.steelD, { ao: 0 });
    b.box(0, 0.55, 0.13, w, 0.03, 0.24, C.steelD, { ao: 0.05 });                       // balda de los cascos
    for (let k = 0; k < 3; k++) {
      const x = -w / 2 + (k + 0.5) * (w / 3);
      b.box(x, 1.7, 0.05, 0.03, 0.1, 0.1, C.iron, { ao: 0 });                         // gancho
      if (k >= n) continue;
      b.box(x, 1.05, 0.12, 0.36, 0.64, 0.12, k === 2 ? 0x2b2e33 : C.navy, { ao: 0.08 });
      for (const s of [-1, 1]) b.box(x + s * 0.11, 1.62, 0.12, 0.08, 0.1, 0.1, C.navy, { ao: 0 }); // hombreras
      b.box(x, 1.12, 0.181, 0.28, 0.05, 0.004, 0x2b3a5a, { ao: 0 });                 // velcro
      b.sprite('policia_chaleco', x, 1.32, 0.182, 0.3, 0.075);
      b.sphere(x, 0.58, 0.14, 0.26, 0.2, 0.26, k % 2 ? C.navy : 0x2b2e33, 8, { ao: 0.1 });   // casco en la balda
    }
  },
});

// ================================================================ ACABADO DE TODAS LAS SALAS

/**
 * Pintura del zócalo de cada sala (lo que más ayuda a reconocerlas de un vistazo desde la cámara
 * del móvil) y color del rodapié.
 */
const ROOM_PAINT = {
  calabozos: [0x8a8f86, 0x3a3d42], archivos: [0xb79a74, 0x5e3d26], descanso: [0xe8c98a, 0x3b7a55],
  despacho: [0x8a5e3a, 0x4a2f1c], armeria: [0x8a5a52, 0x46201f], pasillo: [0x8fa9d0, 0x1f3260],
  enfermeria: [0xa8d5ba, 0x2f7d55], recepcion: [0x7f9cc8, 0x1f3260], almacen: [0xc4b08a, 0x5e4a2e],
  vestuarios: [0x9fcbe0, 0x2f6b8a],
};
let DOOR_CELLS = null;
/** Celdas de puerta del edificio (de todas las salas): huecos del zócalo. */
function doorCells() {
  if (DOOR_CELLS) return DOOR_CELLS;
  DOOR_CELLS = new Set();
  for (const r of STATION.rooms) {
    if (!r.rect) continue;
    const [x0, y0, x1, y1] = r.rect;
    for (const d of r.doors ?? []) {
      for (let k = 0; k < (d.w ?? 2); k++) {
        if (d.wall === 'N' || d.wall === 'S') DOOR_CELLS.add(`${x0 + d.at + k},${d.wall === 'N' ? y0 - 1 : y1 + 1}`);
        else DOOR_CELLS.add(`${d.wall === 'W' ? x0 - 1 : x1 + 1},${y0 + d.at + k}`);
      }
    }
  }
  return DOOR_CELLS;
}

/**
 * Zócalo pintado, moldura, rodapié y enchufes por las cuatro paredes de una sala (p.room). El
 * origen es la esquina (x0, y0) de la sala. Nivel 0: pintura desconchada y cables sueltos.
 */
addD('acabado_sala', {
  build(b, fp) {
    const room = STATION.rooms.find((r) => r.id === fp.p.room);
    if (!room?.rect) return;
    const [x0, y0, x1, y1] = room.rect, W = x1 - x0 + 1, H = y1 - y0 + 1;
    const [paint, skirt] = ROOM_PAINT[room.id] ?? [0xd8cfb8, 0x5e5a52];
    const lvl = fp.level ?? 0, rnd = fp.rnd, doors = doorCells();
    const F = 0.35, ZH = 0.9;
    // Cada pared: celda de muro k (la k-ésima, desde la esquina), si corre en X, posición fija y normal hacia dentro.
    const walls = [
      { cell: (k) => [x0 - 1 + k, y0 - 1], n: W + 2, alongX: true, fixed: -F, s: 1, max: W },
      { cell: (k) => [x0 - 1 + k, y1 + 1], n: W + 2, alongX: true, fixed: H + F, s: -1, max: W },
      { cell: (k) => [x0 - 1, y0 - 1 + k], n: H + 2, alongX: false, fixed: -F, s: 1, max: H },
      { cell: (k) => [x1 + 1, y0 - 1 + k], n: H + 2, alongX: false, fixed: W + F, s: -1, max: H },
    ];
    let outlet = 0;
    for (const wl of walls) {
      // Caja pegada a la pared: u = posición a lo largo, d = grosor hacia dentro.
      const box = (u, len, y, h, d, col) => {
        if (wl.alongX) b.box(u, y, wl.fixed + wl.s * d / 2, len, h, d, col, { ao: 0 });
        else b.box(wl.fixed + wl.s * d / 2, y, u, d, h, len, col, { ao: 0 });
      };
      let k = 0;
      while (k < wl.n) {
        while (k < wl.n && doors.has(wl.cell(k).join(','))) k++;
        const a = k;
        while (k < wl.n && !doors.has(wl.cell(k).join(','))) k++;
        const s0 = Math.max(a - 1, -F), s1 = Math.min(k - 1, wl.max + F);
        if (s1 - s0 < 0.05) continue;
        const u = (s0 + s1) / 2, len = s1 - s0;
        box(u, len, 0, ZH, 0.006, paint);                          // zócalo pintado
        box(u, len, ZH, 0.04, 0.014, skirt);                       // moldura
        box(u, len, 0, 0.1, 0.022, skirt);                         // rodapié
        if (!lvl) {
          for (let m = 0; m < Math.floor(len / 2.2); m++) {       // desconchones
            box(s0 + 0.6 + rnd() * (len - 1.2), 0.12 + rnd() * 0.2, 0.25 + rnd() * 0.45, 0.08 + rnd() * 0.12, 0.009, 0xeee5d3);
          }
        }
        for (let e = s0 + 1.1; e < s1 - 0.5; e += 2.8) {          // enchufes
          box(e, 0.09, 0.22, 0.09, 0.016, C.white);
          box(e, 0.02, 0.255, 0.02, 0.022, C.iron);
          if (!lvl && outlet++ % 2 === 0) {
            // cable suelto hacia el centro de la sala
            if (wl.alongX) b.box(e, 0.004, wl.fixed + wl.s * 0.3, 0.02, 0.012, 0.55, C.black, { ao: 0, ry: 0.2 });
            else b.box(wl.fixed + wl.s * 0.3, 0.004, e, 0.55, 0.012, 0.02, C.black, { ao: 0, ry: 0.2 });
          }
        }
      }
    }
  },
});

// ================================================================ PIEZAS DE DETALLE DE LAS SALAS

/** Ventana con persiana de lamas (rota y torcida en el nivel 0). Va en la cara interior del muro. */
addD('ventana', {
  build(b, fp) {
    const w = fp.p.w ?? 1.0, h = fp.p.h ?? 0.9, cy = fp.p.y ?? 1.55, lvl = fp.level ?? 0;
    b.box(0, cy - h / 2 - 0.06, 0.02, w + 0.12, h + 0.12, 0.04, C.white, { ao: 0 });
    b.box(0, cy - h / 2, 0.03, w, h, 0.02, 0x9fc8e8, { ao: 0 });
    b.box(-w * 0.2, cy - h / 2, 0.041, w * 0.3, h, 0.004, 0xdbeef8, { ao: 0 });
    b.box(0, cy - h / 2 - 0.08, 0.07, w + 0.16, 0.04, 0.12, C.white, { ao: 0 });         // alféizar
    const down = lvl ? 0.55 : 0.7, nl = Math.round((h * down) / 0.06);
    for (let k = 0; k < nl; k++) {
      const broken = !lvl && k % 4 === 2;
      b.box(broken ? -w * 0.15 : 0, cy + h / 2 - 0.05 - k * 0.06, 0.07, broken ? w * 0.6 : w - 0.04, 0.035, 0.012, lvl ? 0xeeeae0 : 0xd8d0b8, { ao: 0, rz: broken ? 0.2 : 0, rx: 0.3 });
    }
    b.box(0, cy + h / 2 - 0.02, 0.06, w + 0.04, 0.06, 0.06, C.steelL, { ao: 0 });         // cajón de la persiana
    b.box(w / 2 - 0.06, cy - h / 2 + 0.1, 0.08, 0.008, h * 0.75, 0.008, C.white, { ao: 0 }); // cordón
  },
});

/** Televisor de pared con soporte (descanso). */
addD('tele_pared', {
  build(b, fp) {
    const cy = fp.p.y ?? 1.8, lvl = fp.level ?? 0;
    b.box(0, cy - 0.12, 0.02, 0.2, 0.24, 0.04, C.iron, { ao: 0 });
    b.box(0, cy - 0.32, 0.12, 0.9, 0.54, 0.06, C.black, { ao: 0.05 });
    b.sprite(lvl ? 'pantalla_cam' : 'pantalla_radio', 0, cy - 0.05, 0.151, 0.82, 0.46, { screen: true });
    b.light('pantalla', 0, cy - 0.05, 0.5, 0x8fd0ff);
  },
});

/** Perchero de pie con gabardina y gorra. */
addD('perchero', {
  build(b) {
    b.cyl(0, 0, 0, 0.18, 0.2, 0.04, C.woodDD, 10);
    b.cyl(0, 0.04, 0, 0.025, 0.03, 1.7, C.woodD, 8);
    for (let k = 0; k < 4; k++) b.box(0, 1.62, 0, 0.3, 0.025, 0.025, C.woodD, { ry: (k * PI) / 4, ao: 0 });
    b.box(0.1, 0.85, 0.02, 0.32, 0.78, 0.18, 0xb89a6a, { rz: -0.06, ao: 0.08 });        // gabardina
    b.box(0.1, 1.5, 0.02, 0.12, 0.12, 0.14, 0xb89a6a, { ao: 0 });
    b.cyl(-0.06, 1.66, 0, 0.13, 0.13, 0.06, C.navy, 10);                                // gorra
    b.box(-0.06, 1.66, 0.12, 0.2, 0.015, 0.1, C.black, { ao: 0 });
  },
});

/** Negatoscopio con una radiografía (enfermería): pantalla luminosa de pared. */
addD('negatoscopio', {
  build(b, fp) {
    const cy = fp.p.y ?? 1.6, w = fp.p.w ?? 0.8, h = w * 0.75;
    b.box(0, cy - h / 2 - 0.04, 0.02, w + 0.08, h + 0.08, 0.05, C.white, { ao: 0 });
    b.sprite('radiografia', 0, cy, 0.047, w, h, { screen: true });
    b.light('pantalla', 0, cy, 0.4, 0xcfe6f6);
  },
});

/** Dispensador de turnos de pie con su cartel «Coja número y rece». */
addD('dispensador_turnos', {
  build(b) {
    b.cyl(0, 0, 0, 0.18, 0.2, 0.04, C.iron, 10);
    b.cyl(0, 0.04, 0, 0.03, 0.03, 0.95, C.steel, 8);
    b.box(0, 0.95, 0, 0.22, 0.3, 0.16, C.red);
    b.box(0, 1.0, 0.081, 0.08, 0.02, 0.02, C.black, { ao: 0 });
    b.box(0, 0.98, 0.1, 0.06, 0.004, 0.05, C.paper, { ao: 0, rx: 0.6 });               // tique
    b.box(0, 1.27, -0.01, 0.52, 0.18, 0.012, C.iron, { ao: 0 });
    b.sprite('coja_numero', 0, 1.36, 0.0, 0.5, 0.15);
  },
});

/** Palé con cajas de pruebas precintadas (almacén). */
addD('palet', {
  build(b, fp) {
    const rnd = fp.rnd, lvl = fp.level ?? 0;
    for (let k = 0; k < 3; k++) b.box(0, 0, -0.4 + k * 0.4, 1.0, 0.1, 0.1, C.woodL);
    for (let k = 0; k < 5; k++) b.box(-0.4 + k * 0.2, 0.1, 0, 0.16, 0.025, 0.95, C.wood, { ao: 0.05 });
    for (let k = 0; k < (lvl ? 4 : 2); k++) {
      const x = k % 2 ? 0.22 : -0.22, y = 0.125 + (k >> 1) * 0.34;
      cardboard(b, x, y, (rnd() - 0.5) * 0.2, 0.4, 0.34, 0.5, (rnd() - 0.5) * 0.2);
      b.box(x, y + 0.17, 0.26, 0.4, 0.04, 0.004, C.yellow, { ao: 0 });                 // precinto
    }
  },
});

/** Carretilla de mano (almacén). */
addD('carretilla', {
  build(b) {
    for (const s of [-1, 1]) {
      b.box(s * 0.2, 0.08, 0, 0.04, 1.2, 0.04, C.red, { rx: -0.25, ao: 0 });
      b.cyl(s * 0.24, 0.1, -0.05, 0.1, 0.1, 0.05, C.black, 10, { rz: PI / 2, ao: 0 });
    }
    b.box(0, 0, 0.12, 0.44, 0.03, 0.24, C.steelD);
    b.box(0, 1.15, -0.28, 0.44, 0.04, 0.04, C.red, { ao: 0 });
  },
});
