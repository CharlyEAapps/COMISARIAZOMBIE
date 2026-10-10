import station from '../data/station.json';
import despacho from '../data/despacho.json';

// Comisaría por salas: datos de src/data/station.json (rectángulos, puertas, muebles, piezas por
// nivel y mejoras de cada sala) y funciones puras sobre ellos. El nivel de una sala es la suma
// de los niveles de sus mejoras (despacho.json); el nivel global, la suma de todas.
// Coordenadas en CELDAS: la celda i ocupa [i, i + 1) (como src/render/props/layout.js).

export const STATION = station;
export const ROOMS_LIST = station.rooms;
export const ROOM_BY_ID = Object.fromEntries(station.rooms.map((r) => [r.id, r]));

/** Salas con rectángulo en el mapa: id → { x0, y0, x1, y1 } (interior, inclusivo). */
export const ROOM_RECTS = Object.fromEntries(
  station.rooms.filter((r) => r.rect).map((r) => [r.id, { x0: r.rect[0], y0: r.rect[1], x1: r.rect[2], y1: r.rect[3] }]),
);

/** Sala (id) que contiene la celda (i, j), o null. */
export function roomAt(i, j) {
  for (const id in ROOM_RECTS) {
    const r = ROOM_RECTS[id];
    if (i >= r.x0 && i <= r.x1 && j >= r.y0 && j <= r.y1) return id;
  }
  return null;
}

/** ¿Está la celda (i, j) dentro de la sala `id`? (sin asignaciones: para bucles calientes) */
export function inRoom(id, i, j) {
  const r = ROOM_RECTS[id];
  return !!r && i >= r.x0 && i <= r.x1 && j >= r.y0 && j <= r.y1;
}

const maxOf = (id) => despacho.upgrades[id]?.prices.length ?? 0;

/** Nivel máximo de una sala (suma de los máximos de sus mejoras). */
export function roomMaxLevel(room) {
  let n = 0;
  for (const u of room.upgrades ?? []) n += maxOf(u);
  return n;
}

/** Nivel de una sala con los niveles de mejora `levels` (id → nivel). */
export function roomLevel(room, levels) {
  let n = 0;
  for (const u of room.upgrades ?? []) n += levels[u] ?? 0;
  return n;
}

/** Nivel global de la comisaría (suma de todas las mejoras). */
export function globalLevel(levels) {
  let n = 0;
  for (const id in levels) n += levels[id] ?? 0;
  return n;
}

export const GLOBAL_MAX = Object.keys(despacho.upgrades).reduce((s, id) => s + maxOf(id), 0);

/** Sala a la que pertenece una mejora (id de sala) o null. */
export function roomOfUpgrade(id) {
  for (const r of station.rooms) if ((r.upgrades ?? []).includes(id)) return r.id;
  return null;
}

/**
 * Punto sobre la cara interior de un muro de la sala: N/S/W/E y `at` metros desde x0 (N/S) o
 * y0 (W/E). Devuelve { x, z, rot } (rot: hacia dónde mira el objeto, 0 = sur).
 * Los muros son barras de 0,3 m centradas en su celda: la cara interior está a 0,35 del borde.
 */
export function wallPoint(rect, wall, at) {
  const [x0, y0, x1, y1] = rect;
  if (wall === 'N') return { x: x0 + at, z: y0 - 0.35, rot: 0 };
  if (wall === 'S') return { x: x0 + at, z: y1 + 1.35, rot: 180 };
  if (wall === 'W') return { x: x0 - 0.35, z: y0 + at, rot: 90 };
  return { x: x1 + 1.35, z: y0 + at, rot: 270 };
}

/**
 * Carteles de una sala: uno dentro y otro en el pasillo, junto a la puerta principal. Como la
 * cámara mira al norte, solo se ven las caras que miran al sur: en las salas con la puerta al sur
 * el de dentro va en el muro norte; en las de la puerta al norte, el del pasillo cuelga del techo
 * delante del muro. @returns {{ x, z, rot, y, hang }[]}
 */
export function roomSigns(room) {
  const S = station.signs;
  if (room.sign) return [{ x: room.sign.x, z: room.sign.z, rot: room.sign.rot ?? 0, y: S.y, post: !!room.sign.post, ladder: !!room.sign.ladder }];
  if (!room.rect || room.noSign || !room.doors?.length) return [];
  const [x0, y0, x1, y1] = room.rect;
  const d = room.doors[0];
  const w = d.w ?? 2;
  const a = x0 + d.at;
  const right = a + w + S.w / 2 + 0.2;
  const beside = right + S.w / 2 <= x1 + 1 ? right : a - S.w / 2 - 0.2;
  const inner = x0 + (room.signAt ?? (x1 + 1 - x0) / 2);
  if (d.wall === 'S') {
    return [
      { x: beside, z: y1 + 1 + 0.65, rot: 0, y: S.y },  // pasillo (cara sur del muro)
      { x: inner, z: y0 - 0.35, rot: 0, y: S.y },         // dentro (muro norte)
    ];
  }
  if (d.wall === 'N') {
    return [
      { x: beside, z: y0 - 0.35, rot: 0, y: S.y },                    // dentro, junto a la puerta
      { x: beside, z: y0 - 0.65 - S.hangZ, rot: 0, y: S.hangY, hang: true }, // pasillo: banderola
    ];
  }
  return [];
}
