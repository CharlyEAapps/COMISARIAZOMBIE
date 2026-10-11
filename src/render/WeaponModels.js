import { PropBuilder } from './props/Builder.js';

// Modelos por código de las armas de mano y la granada (estilo maqueta, low-poly).
//
// Convención LOCAL del arma:
//  - origen = punto donde la MANO DERECHA agarra la empuñadura,
//  - el cañón apunta a +Z, la parte de arriba del arma es +Y, X = lado derecho del arma, unidades en metros.
//  - Geometría NO indexada con position, normal y color (color por vértice, LINEAL como en Builder).
//  - Una sola capa "solid": un único material con WEAPON_MATERIAL_OPTIONS sirve para todas.
//  - Cada llamada construye una BufferGeometry nueva: quien las use debe cachearla por id.
//
// Colocación en el policía de bloques (BlockyCharacter): en `parts.armR`, position (0, -0.62, 0.06),
// rotation.x = Math.PI / 2, con el brazo en rotation.x = -Math.PI / 2.
// Las siluetas están algo exageradas (más gruesas) para que se lean desde la cámara cenital.

/** Opciones del material: `new THREE.MeshStandardMaterial(WEAPON_MATERIAL_OPTIONS)`. */
export const WEAPON_MATERIAL_OPTIONS = Object.freeze({ vertexColors: true, roughness: 0.55, metalness: 0.25 });

/**
 * Datos por arma (en el espacio local del arma):
 *  - muzzle  = punta del cañón (de ahí salen el fogonazo y la trazadora),
 *  - support = dónde va la mano IZQUIERDA en las armas de dos manos (guardamanos), o null,
 *  - length  = longitud total aproximada en Z.
 */
export const WEAPON_SPECS = Object.freeze({
  pistola:       { muzzle: [0, 0.032, 0.20], support: null, length: 0.26 },
  escopeta:      { muzzle: [0, 0.045, 0.67], support: [0, -0.04, 0.33], length: 0.95 },
  subfusil:      { muzzle: [0, 0.035, 0.38], support: [0, -0.04, 0.255], length: 0.50 },
  fusil:         { muzzle: [0, 0.045, 0.63], support: [0, -0.015, 0.31], length: 0.91 },
  francotirador: { muzzle: [0, 0.035, 0.80], support: [0, -0.04, 0.30], length: 1.16 },
  taser:         { muzzle: [0, 0.04, 0.216], support: null, length: 0.27 },
  porra:         { muzzle: [0, 0, 0.585], support: null, length: 0.665 },
  laser:         { muzzle: [0, 0.04, 0.72], support: [0, -0.03, 0.33], length: 0.96 },
  lanzallamas:   { muzzle: [0, 0.035, 0.67], support: [0, -0.04, 0.32], length: 0.88 },
  sable:         { muzzle: [0, 0, 0.92], support: null, length: 1.04 },
});

// ---------------------------------------------------------------- paleta
const BLK = 0x1c1e23;     // negro polímero
const GUN = 0x2e3239;     // acero oscuro
const DGRY = 0x41464f;    // gris oscuro
const MGRY = 0x646b76;
const LGRY = 0x9aa2ad;
const WOOD = 0x9a6034;
const WOOD2 = 0x7a4a27;
const OLIVE = 0x5d6b38;
const OLIVE2 = 0x48552b;
const YEL = 0xf2c418;
const WHT = 0xe3e7ee;     // carcasa blanca del rifle láser
const LBLU = 0x5fa8d3;
const RED = 0xc8372d;     // rojo bombero del lanzallamas
const STEEL = 0xaab2bc;
const CYAN = 0x6fe3ff;    // hoja del sable
const BLADE = 0xe4fcff;

// ---------------------------------------------------------------- utilidades

/** Caja centrada en (x, y, z); `rx` la inclina alrededor de su centro. */
function bx(b, x, y, z, w, h, d, color, rx = 0) {
  b.box(x, y, z, w, h, d, color, { oy: -h / 2, rx, ao: 0.12 });
}
/** Cilindro/cono con eje Z: base en z0 (radio rBack), extremo en z0 + len (radio rFront). */
function cylZ(b, x, y, z0, rFront, rBack, len, color, seg = 8) {
  b.cyl(x, y, z0, rFront, rBack, len, color, seg, { rx: Math.PI / 2, ao: 0.1 });
}

/** Igual que cylZ pero en la capa 'glow' (sin iluminación: se pinta aditivo aparte, ver weaponGlowGeometry). */
function glowZ(b, x, y, z0, rFront, rBack, len, color, seg = 8) {
  b.cyl(x, y, z0, rFront, rBack, len, color, seg, { rx: Math.PI / 2, ao: 0, layer: 'glow' });
}

function finish(b) {
  const g = b.toGeometry('solid');
  g.computeBoundingBox();
  return g;
}

// ---------------------------------------------------------------- armas

function pistola(b) {
  bx(b, 0, -0.06, -0.02, 0.036, 0.135, 0.052, BLK, 0.2);        // empuñadura inclinada
  bx(b, 0, 0.0, 0.06, 0.036, 0.022, 0.2, GUN);                  // armazón
  bx(b, 0, 0.034, 0.07, 0.044, 0.052, 0.22, GUN);               // corredera
  bx(b, 0, 0.058, 0.07, 0.03, 0.006, 0.2, BLK);                 // lomo de la corredera
  cylZ(b, 0, 0.032, 0.18, 0.012, 0.012, 0.02, LGRY, 6);         // boca del cañón
  bx(b, 0, 0.066, 0.17, 0.008, 0.014, 0.01, LGRY);              // punto de mira
  bx(b, 0, 0.066, -0.03, 0.02, 0.012, 0.012, LGRY);             // alza
  bx(b, 0, -0.03, 0.065, 0.014, 0.008, 0.07, BLK);              // guardamonte
  bx(b, 0, -0.018, 0.098, 0.014, 0.03, 0.008, BLK);
}

function escopeta(b) {
  // culata y empuñadura de madera
  bx(b, 0, -0.005, -0.15, 0.042, 0.08, 0.19, WOOD);
  bx(b, 0, -0.045, -0.255, 0.046, 0.14, 0.06, WOOD2);
  bx(b, 0, -0.06, -0.02, 0.042, 0.12, 0.048, WOOD2, 0.25);
  // cajón de mecanismos
  bx(b, 0, 0.025, 0.04, 0.05, 0.072, 0.2, GUN);
  bx(b, 0.026, 0.03, 0.05, 0.004, 0.026, 0.07, BLK);
  bx(b, 0, -0.025, 0.05, 0.016, 0.008, 0.06, BLK);              // guardamonte
  // cañón y tubo del cargador
  cylZ(b, 0, 0.045, 0.14, 0.021, 0.021, 0.53, GUN);
  cylZ(b, 0, 0.0, 0.14, 0.019, 0.019, 0.46, DGRY);
  cylZ(b, 0, 0.0, 0.6, 0.024, 0.024, 0.02, LGRY, 6);            // tapón del tubo
  bx(b, 0, 0.072, 0.65, 0.008, 0.016, 0.012, LGRY);             // punto de mira
  // guardamanos de corredera
  bx(b, 0, -0.004, 0.33, 0.066, 0.072, 0.2, WOOD);
  bx(b, 0, -0.004, 0.27, 0.07, 0.076, 0.012, WOOD2);
  bx(b, 0, -0.004, 0.39, 0.07, 0.076, 0.012, WOOD2);
}

function subfusil(b) {
  bx(b, 0, 0.03, 0.07, 0.05, 0.07, 0.28, BLK);                  // cajón
  bx(b, 0, 0.07, 0.07, 0.03, 0.012, 0.26, GUN);                 // raíl
  bx(b, 0, -0.055, -0.02, 0.04, 0.11, 0.05, BLK, 0.2);          // empuñadura
  bx(b, 0, -0.1, 0.12, 0.032, 0.2, 0.05, GUN);                  // cargador recto
  bx(b, 0, -0.2, 0.12, 0.036, 0.012, 0.056, LGRY);              // base del cargador
  bx(b, 0, 0.035, 0.275, 0.048, 0.052, 0.13, DGRY);             // cubrecañón
  cylZ(b, 0, 0.035, 0.34, 0.013, 0.013, 0.04, LGRY, 6);         // cañón
  bx(b, 0, -0.03, 0.255, 0.034, 0.07, 0.04, BLK);               // empuñadura delantera
  bx(b, 0, -0.025, 0.06, 0.016, 0.008, 0.07, GUN);              // guardamonte
  // culata plegada contra el costado izquierdo
  bx(b, -0.037, 0.03, 0.0, 0.016, 0.03, 0.2, MGRY);
  bx(b, -0.037, 0.03, -0.108, 0.018, 0.07, 0.016, MGRY);
  bx(b, 0.032, 0.052, 0.0, 0.016, 0.014, 0.03, LGRY);           // palanca de montar
  bx(b, 0, 0.085, 0.3, 0.008, 0.02, 0.01, LGRY);                // punto de mira
}

function fusil(b) {
  // culata
  bx(b, 0, -0.02, -0.165, 0.042, 0.1, 0.21, DGRY);
  bx(b, 0, -0.025, -0.27, 0.046, 0.12, 0.02, BLK);
  // cajón y empuñadura
  bx(b, 0, 0.03, 0.07, 0.052, 0.09, 0.26, GUN);
  bx(b, 0, -0.06, -0.02, 0.04, 0.12, 0.05, BLK, 0.25);
  bx(b, 0, -0.025, 0.04, 0.016, 0.008, 0.08, BLK);              // guardamonte
  // cargador curvo (dos tramos inclinados hacia delante)
  bx(b, 0, -0.07, 0.115, 0.034, 0.1, 0.052, BLK, -0.1);
  bx(b, 0, -0.145, 0.14, 0.034, 0.1, 0.052, BLK, -0.42);
  // guardamanos y cañón
  bx(b, 0, 0.03, 0.31, 0.058, 0.072, 0.22, DGRY);
  bx(b, 0, 0.073, 0.31, 0.026, 0.01, 0.22, GUN);
  cylZ(b, 0, 0.048, 0.42, 0.013, 0.013, 0.19, GUN, 6);
  bx(b, 0, 0.065, 0.46, 0.03, 0.036, 0.04, GUN);                // bloque de gas
  bx(b, 0, 0.082, 0.56, 0.01, 0.036, 0.014, LGRY);              // punto de mira
  cylZ(b, 0, 0.048, 0.61, 0.021, 0.021, 0.02, BLK, 6);          // freno de boca
  // mira (visor holográfico con lente roja)
  bx(b, 0, 0.088, 0.04, 0.026, 0.02, 0.1, GUN);
  bx(b, 0, 0.12, 0.04, 0.046, 0.05, 0.11, BLK);
  bx(b, 0, 0.12, 0.099, 0.034, 0.036, 0.006, 0xd23a3a);
}

function francotirador(b) {
  // culata con carrillera
  bx(b, 0, -0.02, -0.195, 0.046, 0.1, 0.27, OLIVE);
  bx(b, 0, 0.04, -0.19, 0.04, 0.03, 0.13, OLIVE2);
  bx(b, 0, -0.03, -0.345, 0.05, 0.14, 0.03, BLK);
  // cajón, empuñadura y cargador
  bx(b, 0, 0.03, 0.08, 0.052, 0.08, 0.28, DGRY);
  bx(b, 0, -0.06, -0.02, 0.04, 0.12, 0.05, OLIVE2, 0.25);
  bx(b, 0, -0.045, 0.1, 0.032, 0.07, 0.06, GUN);
  // guardamanos y cañón largo con freno
  bx(b, 0, 0.0, 0.34, 0.052, 0.062, 0.24, OLIVE);
  cylZ(b, 0, 0.035, 0.22, 0.017, 0.017, 0.53, GUN, 6);
  cylZ(b, 0, 0.035, 0.75, 0.027, 0.027, 0.05, BLK, 6);
  // cerrojo
  bx(b, 0.045, 0.055, 0.0, 0.05, 0.012, 0.014, GUN);
  bx(b, 0.075, 0.055, 0.0, 0.022, 0.022, 0.022, LGRY);
  // mira telescópica grande
  bx(b, 0, 0.095, 0.0, 0.022, 0.05, 0.04, GUN);
  bx(b, 0, 0.095, 0.16, 0.022, 0.05, 0.04, GUN);
  cylZ(b, 0, 0.15, -0.04, 0.031, 0.031, 0.3, BLK);              // tubo
  cylZ(b, 0, 0.15, 0.17, 0.052, 0.034, 0.11, BLK);              // objetivo
  cylZ(b, 0, 0.15, -0.1, 0.032, 0.042, 0.06, BLK);              // ocular
  cylZ(b, 0, 0.15, 0.276, 0.045, 0.045, 0.006, 0x5fb3d9, 8);    // lente
  bx(b, 0, 0.19, 0.08, 0.026, 0.024, 0.03, GUN);                // torreta
  bx(b, 0.04, 0.15, 0.08, 0.024, 0.024, 0.03, GUN);
  // bípode plegado hacia delante bajo el guardamanos
  bx(b, 0, -0.04, 0.42, 0.07, 0.022, 0.03, GUN);
  bx(b, -0.026, -0.052, 0.51, 0.014, 0.016, 0.18, MGRY);
  bx(b, 0.026, -0.052, 0.51, 0.014, 0.016, 0.18, MGRY);
}

function taser(b) {
  bx(b, 0, -0.06, -0.015, 0.042, 0.135, 0.056, BLK, 0.18);      // empuñadura
  bx(b, 0, 0.04, 0.055, 0.056, 0.076, 0.21, YEL);               // cuerpo amarillo
  for (const z of [0.0, 0.06, 0.12]) bx(b, 0, 0.0795, z, 0.058, 0.008, 0.024, BLK); // franjas
  bx(b, 0, 0.04, 0.185, 0.046, 0.062, 0.05, BLK);               // cartucho
  for (const x of [-0.013, 0.013]) bx(b, x, 0.04, 0.213, 0.012, 0.012, 0.006, 0xc8d6e0); // salidas de los dardos
  bx(b, 0, -0.012, 0.05, 0.018, 0.008, 0.075, BLK);             // guardamonte
  bx(b, 0, 0.0, 0.088, 0.018, 0.034, 0.008, BLK);
  bx(b, 0.0295, 0.04, 0.0, 0.004, 0.03, 0.05, BLK);             // placa lateral
  bx(b, -0.0295, 0.04, 0.0, 0.004, 0.03, 0.05, BLK);
}

function porra(b) {
  // porra extensible negra desplegada: mango con anillos, tres tramos telescópicos y bola en la punta
  cylZ(b, 0, 0, -0.08, 0.026, 0.026, 0.012, GUN);               // contera
  cylZ(b, 0, 0, -0.068, 0.024, 0.024, 0.168, BLK);              // mango
  for (const z of [-0.05, -0.01, 0.03, 0.07]) cylZ(b, 0, 0, z, 0.027, 0.027, 0.01, DGRY);
  cylZ(b, 0, 0, 0.1, 0.027, 0.027, 0.02, MGRY);                 // collarín
  cylZ(b, 0, 0, 0.12, 0.02, 0.02, 0.18, BLK);                   // tramo 1
  cylZ(b, 0, 0, 0.3, 0.023, 0.023, 0.012, MGRY);
  cylZ(b, 0, 0, 0.312, 0.016, 0.016, 0.15, BLK);                // tramo 2
  cylZ(b, 0, 0, 0.462, 0.019, 0.019, 0.012, MGRY);
  cylZ(b, 0, 0, 0.474, 0.012, 0.012, 0.096, BLK);               // tramo 3
  cylZ(b, 0, 0, 0.57, 0.016, 0.016, 0.015, LGRY);               // punta
}

function laser(b) {
  // culata ligera y empuñadura
  bx(b, 0, -0.005, -0.15, 0.04, 0.09, 0.14, DGRY);
  bx(b, 0, -0.012, -0.225, 0.046, 0.11, 0.02, BLK);
  bx(b, 0, -0.06, -0.02, 0.04, 0.12, 0.05, BLK, 0.25);
  // carcasa blanca con franjas azules y célula de energía bajo el cajón
  bx(b, 0, 0.03, 0.08, 0.058, 0.095, 0.3, WHT);
  bx(b, 0, 0.0795, 0.08, 0.036, 0.008, 0.22, MGRY);             // raíl
  bx(b, 0.0305, 0.035, 0.1, 0.004, 0.03, 0.16, LBLU);           // franja lateral
  bx(b, -0.0305, 0.035, 0.1, 0.004, 0.03, 0.16, LBLU);
  bx(b, 0, -0.07, 0.13, 0.034, 0.075, 0.11, LBLU);              // célula de energía
  bx(b, 0, -0.112, 0.13, 0.038, 0.01, 0.116, BLK);
  bx(b, 0, -0.03, 0.06, 0.016, 0.008, 0.07, BLK);               // guardamonte
  // mira: visor oscuro con lente
  bx(b, 0, 0.088, 0.03, 0.03, 0.03, 0.09, BLK);
  bx(b, 0, 0.1, 0.078, 0.022, 0.022, 0.006, CYAN);
  // cañón: tubo central con tres bobinas de carga y emisor
  cylZ(b, 0, 0.04, 0.23, 0.02, 0.02, 0.4, STEEL, 8);
  for (const z of [0.3, 0.42, 0.54]) cylZ(b, 0, 0.04, z, 0.036, 0.036, 0.04, DGRY, 8);
  bx(b, 0, -0.012, 0.33, 0.07, 0.06, 0.2, WHT);                 // guardamanos
  cylZ(b, 0, 0.04, 0.63, 0.03, 0.022, 0.07, BLK, 8);            // emisor
  cylZ(b, 0, 0.04, 0.70, 0.016, 0.016, 0.02, LBLU, 6);          // boca
  // bobinas luminosas (se pintan aparte, ver weaponGlowGeometry)
  for (const z of [0.345, 0.465, 0.585]) glowZ(b, 0, 0.04, z, 0.04, 0.04, 0.006, 0xffffff, 8);
  glowZ(b, 0, 0.04, 0.705, 0.02, 0.02, 0.012, 0xffffff, 6);
  b.box(0, 0.1, 0.081, 0.018, 0.018, 0.004, 0xffffff, { layer: 'glow', ao: 0 }); // lente del visor
}

function lanzallamas(b) {
  // culata corta, empuñadura y asa
  bx(b, 0, -0.015, -0.17, 0.042, 0.08, 0.14, DGRY);
  bx(b, 0, -0.02, -0.245, 0.046, 0.1, 0.02, BLK);
  bx(b, 0, -0.06, -0.02, 0.042, 0.12, 0.05, BLK, 0.25);
  // cajón rojo con válvula
  bx(b, 0, 0.025, 0.07, 0.06, 0.08, 0.3, RED);
  bx(b, 0, 0.068, 0.07, 0.04, 0.012, 0.26, DGRY);
  bx(b, 0, -0.03, 0.06, 0.016, 0.008, 0.07, BLK);
  cylZ(b, 0.04, 0.03, 0.12, 0.016, 0.016, 0.07, LGRY, 6);       // manómetro lateral
  bx(b, 0.058, 0.03, 0.165, 0.012, 0.03, 0.03, 0xe8e3c8);
  // depósito de combustible encima, con abrazaderas
  cylZ(b, 0, 0.115, -0.1, 0.05, 0.05, 0.34, STEEL, 10);
  for (const z of [-0.06, 0.1]) cylZ(b, 0, 0.115, z, 0.054, 0.054, 0.025, DGRY, 10);
  cylZ(b, 0, 0.115, -0.105, 0.03, 0.03, 0.012, BLK, 8);         // tapón trasero
  cylZ(b, 0, 0.115, 0.236, 0.02, 0.02, 0.02, RED, 8);           // tapón delantero
  bx(b, 0, 0.085, 0.14, 0.024, 0.05, 0.05, DGRY);               // soporte del depósito
  // lanza: tubo, empuñadura delantera y boquilla
  cylZ(b, 0, 0.035, 0.22, 0.019, 0.019, 0.36, GUN, 8);
  bx(b, 0, -0.03, 0.32, 0.034, 0.075, 0.04, BLK);
  for (const z of [0.3, 0.42]) cylZ(b, 0, 0.035, z, 0.027, 0.027, 0.02, DGRY, 8);
  cylZ(b, 0, 0.035, 0.57, 0.03, 0.02, 0.1, BLK, 8);             // boquilla cónica
  cylZ(b, 0, 0.035, 0.65, 0.016, 0.016, 0.02, 0xd8d0b0, 6);     // boca del piloto
  // llamita del piloto
  glowZ(b, 0, 0.035, 0.665, 0.003, 0.014, 0.05, 0xffffff, 6);
}

function sable(b) {
  // empuñadura negra con anillos y pomo
  cylZ(b, 0, 0, -0.11, 0.022, 0.022, 0.02, STEEL, 8);           // pomo
  cylZ(b, 0, 0, -0.09, 0.02, 0.02, 0.2, BLK, 8);                // mango
  for (const z of [-0.07, -0.02, 0.03, 0.08]) cylZ(b, 0, 0, z, 0.0235, 0.0235, 0.012, DGRY, 8);
  bx(b, 0.026, 0.0, 0.0, 0.012, 0.03, 0.05, 0xc8372d);           // botón de encendido
  // emisor: collarín metálico con guarda corta
  cylZ(b, 0, 0, 0.11, 0.03, 0.026, 0.06, STEEL, 8);
  cylZ(b, 0, 0, 0.17, 0.032, 0.032, 0.012, LGRY, 8);
  bx(b, 0, 0, 0.145, 0.1, 0.012, 0.014, DGRY);                  // guarda
  // hoja: núcleo claro (el halo luminoso va en la capa 'glow')
  cylZ(b, 0, 0, 0.18, 0.022, 0.022, 0.72, BLADE, 8);
  b.sphere(0, 0, 0.9, 0.044, 0.044, 0.03, BLADE, 6, { ao: 0, oy: -0.022, oz: 0 });
  glowZ(b, 0, 0, 0.18, 0.05, 0.05, 0.72, CYAN, 8);
  b.sphere(0, 0, 0.9, 0.1, 0.1, 0.05, CYAN, 6, { ao: 0, oy: -0.05, layer: 'glow' });
}

const BUILDERS = { pistola, escopeta, subfusil, fusil, francotirador, taser, porra, laser, lanzallamas, sable };

/** Geometría del arma `id` de weapons.json (pistola, escopeta, subfusil, fusil, francotirador, taser, porra, laser, lanzallamas, sable). */
export function weaponGeometry(id) {
  const fn = BUILDERS[id];
  if (!fn) throw new Error(`WeaponModels: arma desconocida "${id}"`);
  const b = new PropBuilder();
  fn(b);
  return finish(b);
}

/**
 * Partes luminosas del arma `id` (bobinas del láser, llama del piloto, halo de la hoja del sable) o
 * null si no tiene. Se pintan con un material aditivo sin iluminación pegado al arma
 * (`WeaponSystem`); mismo espacio local que `weaponGeometry`.
 */
export function weaponGlowGeometry(id) {
  const fn = BUILDERS[id];
  if (!fn) throw new Error(`WeaponModels: arma desconocida "${id}"`);
  const b = new PropBuilder();
  fn(b);
  return b.toGeometry('glow');
}

/** Granada de mano de piña (~0,09 m de cuerpo), centrada en su centro. */
export function grenadeGeometry() {
  const b = new PropBuilder();
  const R = 0.0425;
  b.sphere(0, -R, 0, 0.072, 0.085, 0.072, OLIVE, 8, { ao: 0.2 });          // cuerpo
  for (const y of [-0.022, 0.0, 0.022]) {                                  // anillos de la piña
    const r = y === 0 ? 0.0375 : 0.034;
    b.cyl(0, y - 0.004, 0, r, r, 0.008, OLIVE2, 8, { ao: 0 });
  }
  b.cyl(0, 0.036, 0, 0.016, 0.02, 0.014, MGRY, 8, { ao: 0.1 });            // cuello
  b.box(0, 0.05, 0, 0.026, 0.012, 0.026, LGRY, { ao: 0.1 });               // cabeza del percutor
  // palanca (cuchara) pegada al lateral +X, doblada sobre el cuello
  b.box(0.038, -0.034, 0, 0.007, 0.092, 0.02, LGRY, { ao: 0.1 });
  b.box(0.022, 0.058, 0, 0.04, 0.007, 0.02, LGRY, { ao: 0.1 });
  // anilla del pasador (marco cuadrado) a un lado del cuello
  b.box(-0.03, 0.04, 0, 0.026, 0.004, 0.004, 0xd4d9de, { ao: 0 });
  b.box(-0.03, 0.062, 0, 0.026, 0.004, 0.004, 0xd4d9de, { ao: 0 });
  b.box(-0.043, 0.04, 0, 0.004, 0.026, 0.004, 0xd4d9de, { ao: 0 });
  b.box(-0.017, 0.04, 0, 0.004, 0.026, 0.004, 0xd4d9de, { ao: 0 });
  b.box(-0.01, 0.046, 0, 0.02, 0.005, 0.005, 0xd4d9de, { ao: 0 });
  return finish(b);
}
