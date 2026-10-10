// Decoración EXTERIOR por defecto del mapa de la comisaría (coordenadas en celdas; 1 celda = 1 m).
// La de dentro del edificio va con cada sala en src/data/station.json. Se puede ampliar desde
// src/data/props.json (clave `decor`).
//
// Rotación `rot` (grados): hacia dónde mira el frente del objeto (0 sur, 90 este, 180 norte, 270 oeste).

const SOUTH_FACE = 37.65; // fachada sur del edificio (cara exterior del muro de la fila 37)

export function defaultDecor() {
  const d = [];
  const add = (type, x, z, p = {}) => d.push({ type, x, z, rot: 0, ...p });

  // ---------------------------------------------------------------- fachada sur y accesos
  add('cartel', 30.6, SOUTH_FACE, { sprite: 'policia', w: 2.0, y: 1.9 });
  add('alfombra', 34.0, 38.15, { w: 2.2, d: 0.9, color: 0x3f6aa8 });
  add('alfombra', 40.0, 13.55, { w: 2.2, d: 0.9, color: 0x3f6aa8 });
  add('alfombra', 14.0 - 0.2, 25.0, { w: 0.9, d: 2.2, color: 0x3f6aa8 });
  add('alfombra', 64.2, 25.0, { w: 0.9, d: 2.2, color: 0x3f6aa8 });

  // ---------------------------------------------------------------- aparcamiento: marcas de plazas
  const bays = (zc, xs) => xs.forEach((x) => add('linea', x, zc, { w: 0.12, d: 3.6 }));
  bays(43, [13, 19, 25, 31.5, 38, 44.5, 51, 57]);
  bays(51, [13, 19, 25, 31.4, 37.8, 44.2, 50.6, 57, 63]);
  add('senal', 25.4, 41.2, { sprite: 'parking', w: 0.55, top: 2.3 });
  add('senal', 47.6, 41.2, { sprite: 'solo_policia', w: 0.6, top: 2.3 });
  [[27.6, 41.2], [28.4, 41.2], [29.2, 41.2], [56.5, 46.6], [57.1, 47.0], [18.3, 47.4]].forEach(([x, z], k) => add('cono', x, z, { rot: k * 40 }));

  // ---------------------------------------------------------------- accesos del recinto
  add('barrera', 29.6, 62.4, { rot: 0, raise: 1.3 });
  add('barrera', 34.4, 62.4, { rot: 180, raise: 1.3 });
  add('senal', 35.4, 66.4, { sprite: 'stop', w: 0.6, top: 2.2 });
  add('barrera', 69.6, 23.4, { rot: 90, raise: 1.3 });
  [[28.3, 61.0], [35.7, 61.0], [68.9, 28.6], [68.9, 23.0]].forEach(([x, z]) => add('cono', x, z));

  // ---------------------------------------------------------------- césped: arbustos
  [[9.6, 15.6], [13.2, 16.2], [9.7, 22.4], [13.3, 30.0], [9.6, 33.6], [13.3, 36.2], [65.6, 15.6], [70.2, 18.3],
    [65.7, 21.8], [70.2, 28.8], [65.6, 35.8], [70.3, 31.6], [67.9, 28.6]].forEach(([x, z], k) => add('arbusto', x, z, { s: 0.9 + (k % 3) * 0.12 }));
  // patio norte (sala de máquinas)
  add('cono', 46.2, 12.9); add('cono', 36.0, 12.6);
  add('papeles_suelo', 13.0, 12.0, { n: 3 });
  return d;
}
