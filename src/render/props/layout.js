// Decoración por defecto del mapa de la comisaría (coordenadas en celdas; 1 celda = 1 m).
// Se puede ampliar o sustituir desde src/data/props.json (clave `decor`).
//
// Muros: son barras finas de 0,3 m centradas en su celda, así que la cara visible de un muro
// en la fila j mira al sur en z = j + 0,65 (pared norte de una sala) y al norte en z = j + 0,35.
// Rotación `rot` (grados): hacia dónde mira el frente del objeto (0 sur, 90 este, 180 norte, 270 oeste).

const NORTH_OFI = 14.65;  // pared norte de calabozos, oficinas y armería
const NORTH_PAS = 23.65;  // pared norte del pasillo
const NORTH_REC = 28.65;  // pared norte de enfermería, recepción y almacén
const SOUTH_FACE = 35.65; // fachada sur del edificio

export function defaultDecor() {
  const d = [];
  const add = (type, x, z, p = {}) => d.push({ type, x, z, rot: 0, ...p });

  // ---------------------------------------------------------------- calabozos
  add('cartel', 29.5, NORTH_OFI, { sprite: 'calabozos', w: 1.3, y: 2.05 });
  add('camara_seguridad', 32.55, NORTH_OFI, { y: 2.3 });
  add('medicion_pared', 22.65, 20.4, { rot: 90 });
  add('papeles_suelo', 25.2, 20.2, { n: 3 });
  add('papeles_suelo', 30.6, 21.0, { n: 2 });
  add('bolsas_suelo', 31.0, 19.6, { n: 2 });

  // ---------------------------------------------------------------- oficinas
  add('mapa_pared', 35.0, NORTH_OFI, { w: 0.95, y: 2.0 });
  add('tablon_corcho', 36.9, NORTH_OFI, { w: 1.3, y: 1.45 });
  add('salida', 37.65, NORTH_OFI, { y: 2.3, w: 0.42 });
  add('pizarra_casos', 41.3, NORTH_OFI, { w: 2.3, y: 1.5 });
  add('reloj', 43.3, NORTH_OFI, { y: 2.2, w: 0.38 });
  add('camara_seguridad', 43.55, NORTH_OFI, { y: 2.38, rot: 0 });
  add('papeles_suelo', 38.6, 19.2, { n: 4 });
  add('papeles_suelo', 42.2, 21.9, { n: 2 });
  add('alfombra', 38.5, 18.9, { w: 3.0, d: 1.0, color: 0x6a8cb8 });

  // ---------------------------------------------------------------- armería
  add('cartel', 52.5, NORTH_OFI, { sprite: 'armeria', w: 1.5, y: 2.1 });
  add('camara_seguridad', 45.6, NORTH_OFI, { y: 2.38 });
  add('extintor', 50.6, NORTH_OFI);
  add('reloj', 54.3, NORTH_OFI, { y: 2.1, w: 0.34 });
  add('cartel', 47.5, NORTH_OFI, { sprite: 'acceso', w: 1.3, y: 2.3 });

  // ---------------------------------------------------------------- pasillo central
  add('cartel', 25.0, NORTH_PAS, { sprite: 'calabozos', w: 1.6, y: 2.1 });
  add('tablon_se_busca', 25.0, NORTH_PAS, { w: 1.5, y: 1.15 });
  add('reloj', 32.0, NORTH_PAS, { y: 2.25, w: 0.38 });
  add('escudo_pared', 36.0, NORTH_PAS, { y: 1.5 });
  add('cartel', 41.0, NORTH_PAS, { sprite: 'oficinas', w: 1.4, y: 2.1 });
  add('cuadro_electrico', 43.2, NORTH_PAS, { y: 1.3 });
  add('extintor', 44.6, NORTH_PAS);
  add('botiquin_pared', 45.7, NORTH_PAS, { y: 1.3 });
  add('cartel', 47.8, NORTH_PAS, { sprite: 'armeria', w: 1.6, y: 2.1 });
  add('mapa_pared', 52.5, NORTH_PAS, { w: 1.2, y: 1.6 });
  add('camara_seguridad', 23.45, NORTH_PAS, { y: 2.38 });
  add('camara_seguridad', 54.55, NORTH_PAS, { y: 2.38 });
  add('salida', 55.35, 24.5, { rot: 270, y: 2.15 });
  add('alfombra', 38.5, 25.5, { w: 29, d: 1.0, color: 0x4f78b0 });
  add('papeles_suelo', 36.0, 26.2, { n: 3 });

  // ---------------------------------------------------------------- enfermería
  add('cruz_roja', 24.6, NORTH_REC, { w: 0.8, y: 1.55 });
  add('cartel', 28.9, NORTH_REC, { sprite: 'enfermeria', w: 1.7, y: 2.1 });
  add('botiquin_pared', 30.7, NORTH_REC, { y: 1.3 });
  add('silla_ruedas', 30.4, 31.5, { rot: 200 });
  add('alfombra', 27.0, 32.9, { w: 1.4, d: 1.0, color: 0x78c0ba });

  // ---------------------------------------------------------------- recepción
  add('cartel', 35.0, NORTH_REC, { sprite: 'comisaria', w: 2.4, y: 2.0 });
  add('reloj', 37.2, NORTH_REC, { y: 2.1, w: 0.38 });
  add('alarma', 40.6, NORTH_REC, { y: 1.35 });
  add('tablon_se_busca', 42.4, NORTH_REC, { w: 1.3, y: 1.55 });
  add('camara_seguridad', 43.55, NORTH_REC, { y: 2.38 });
  add('detector_metales', 39.0, 34.45, { w: 2.0 });
  add('alfombra', 39.0, 33.55, { w: 3.0, d: 1.5, color: 0xb23c33 });
  add('bandera_stand', 33.65, 34.65, { sprite: 'bandera_pol' });
  add('bandera_stand', 44.3, 34.65, { sprite: 'bandera_es' });
  add('papeles_suelo', 36.6, 32.4, { n: 3 });
  add('papeles_suelo', 41.8, 32.6, { n: 2 });

  // ---------------------------------------------------------------- almacén de pruebas
  add('cartel', 47.7, NORTH_REC, { sprite: 'almacen', w: 1.7, y: 2.0 });
  add('extintor', 51.6, NORTH_REC);
  add('camara_seguridad', 53.55, NORTH_REC, { y: 2.38 });
  add('bolsas_suelo', 49.2, 32.9, { n: 3 });
  add('papeles_suelo', 47.5, 31.0, { n: 2 });

  // ---------------------------------------------------------------- fachada sur
  add('cartel', 35.4, SOUTH_FACE, { sprite: 'policia', w: 2.3, y: 1.9 });
  add('cartel', 43.2, SOUTH_FACE, { sprite: 'comisaria', w: 2.4, y: 1.9 });
  add('camara_seguridad', 54.4, SOUTH_FACE, { y: 2.35 });
  add('camara_seguridad', 22.6, SOUTH_FACE, { y: 2.35 });
  add('alfombra', 39.0, 36.15, { w: 2.2, d: 0.9, color: 0x3f6aa8 });
  add('alfombra', 39.0, 13.55, { w: 2.2, d: 0.9, color: 0x3f6aa8 });
  add('alfombra', 56.2, 26.0, { w: 0.9, d: 2.2, color: 0x3f6aa8 });

  // ---------------------------------------------------------------- aparcamiento: marcas de plazas
  const bays = (zc, xs) => xs.forEach((x) => add('linea', x, zc, { w: 0.12, d: 3.6 }));
  bays(43, [13, 19, 25, 31.5, 38, 44.5, 51, 57]);
  bays(51, [13, 19, 25, 31.4, 37.8, 44.2, 50.6, 57, 63]);
  add('senal', 25.4, 40.2, { sprite: 'parking', w: 0.55, top: 2.3 });
  add('senal', 47.6, 40.2, { sprite: 'solo_policia', w: 0.6, top: 2.3 });
  [[26.6, 40.7], [27.4, 40.7], [28.2, 40.7], [56.5, 46.6], [57.1, 47.0], [18.3, 47.4]].forEach(([x, z], k) => add('cono', x, z, { rot: k * 40 }));

  // ---------------------------------------------------------------- accesos
  add('barrera', 29.6, 62.4, { rot: 0, raise: 1.3 });
  add('barrera', 34.4, 62.4, { rot: 180, raise: 1.3 });
  add('senal', 35.4, 66.4, { sprite: 'stop', w: 0.6, top: 2.2 });
  add('barrera', 69.6, 23.4, { rot: 90, raise: 1.3 });
  [[28.3, 61.0], [35.7, 61.0], [68.9, 28.6], [68.9, 23.0]].forEach(([x, z]) => add('cono', x, z));

  // ---------------------------------------------------------------- césped: arbustos
  [[10.4, 16.4], [19.4, 16.6], [10.7, 33.3], [19.6, 33.1], [14.5, 17.1], [58.3, 15.8], [69.3, 15.8], [58.4, 20.6], [69.3, 20.6],
    [58.3, 30.7], [69.4, 30.6], [58.5, 34.5], [69.3, 34.5], [64.0, 15.6], [14.6, 33.2]].forEach(([x, z], k) => add('arbusto', x, z, { s: 0.9 + (k % 3) * 0.12 }));
  // patio norte
  add('cono', 40.2, 12.6); add('cono', 37.7, 12.6);
  add('papeles_suelo', 13.0, 12.0, { n: 3 });
  return d;
}
