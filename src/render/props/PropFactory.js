import { PropBuilder, rng } from './Builder.js';
import { FURNITURE } from './furniture.js';
import { OUTDOOR } from './outdoor.js';
import { DECOR } from './decor.js';
import { ROOM_FURNITURE, ROOM_DECOR } from './rooms.js';
import { defaultDecor } from './layout.js';
import { FLOOR_COLORS } from '../MapRenderer.js';
import { ROOMS_LIST, ROOM_RECTS, roomAt, roomSigns, wallPoint, roomMaxLevel, STATION } from '../../systems/Station.js';

// Fábrica de props. El EDIFICIO sale de src/data/station.json: cada sala trae sus muebles
// (bloqueantes, con huella en celdas), su decoración y sus carteles, y se construye según su
// nivel (buildRoom). El resto del mapa (exterior) se detecta por grupos de celdas ('o', 'c', 'k',
// 'L') y se clasifica por forma (con posibilidad de forzarlo desde props.json). Todo se acumula
// en PropBuilders (capas): uno para lo fijo y uno por cada sala con nivel (se rehace al subirla).

export const TYPES = { ...FURNITURE, ...OUTDOOR, ...DECOR, ...ROOM_FURNITURE, ...ROOM_DECOR };

/** Salas del edificio (coordenadas de celda, inclusivas), sacadas de station.json. */
export const ROOMS = ROOM_RECTS;
export function roomOf(i, j) {
  return roomAt(i, j);
}

const DEG = Math.PI / 180;

// ---------------------------------------------------------------- grupos
/** Grupos contiguos (4 vecinos) de un carácter. Los no rectangulares se parten en celdas sueltas. */
export function findGroups(grid, ch, skip = null) {
  const seen = new Uint8Array(grid.w * grid.h);
  const groups = [];
  for (let j = 0; j < grid.h; j++) {
    for (let i = 0; i < grid.w; i++) {
      const k = grid.index(i, j);
      if (seen[k] || grid.chars[k] !== ch || skip?.has(k)) continue;
      const cells = [];
      const stack = [[i, j]];
      seen[k] = 1;
      while (stack.length) {
        const [ci, cj] = stack.pop();
        cells.push([ci, cj]);
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = ci + di, nj = cj + dj;
          if (!grid.inBounds(ni, nj)) continue;
          const nk = grid.index(ni, nj);
          if (seen[nk] || grid.chars[nk] !== ch || skip?.has(nk)) continue;
          seen[nk] = 1;
          stack.push([ni, nj]);
        }
      }
      groups.push(...makeGroups(ch, cells));
    }
  }
  return groups;
}

function makeGroups(ch, cells) {
  const bb = bboxOf(cells);
  const w = bb.i1 - bb.i0 + 1, h = bb.j1 - bb.j0 + 1;
  if (w * h === cells.length) return [{ ch, cells, ...bb, w, h, key: `${bb.i0},${bb.j0}` }];
  return cells.map(([i, j]) => ({ ch, cells: [[i, j]], i0: i, j0: j, i1: i, j1: j, w: 1, h: 1, key: `${i},${j}` }));
}
function bboxOf(cells) {
  let i0 = Infinity, j0 = Infinity, i1 = -Infinity, j1 = -Infinity;
  for (const [i, j] of cells) { if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; }
  return { i0, j0, i1, j1 };
}

/** Lado (N/S/W/E) con más tramos de muro/valla/reja pegados al grupo, o null. */
export function wallSide(grid, g) {
  const count = { N: 0, S: 0, W: 0, E: 0 };
  const isWall = (i, j) => grid.inBounds(i, j) && !grid.walkable[grid.index(i, j)] && grid.collisionInset[grid.index(i, j)] > 0;
  for (const [i, j] of g.cells) {
    if (isWall(i, j - 1)) count.N++;
    if (isWall(i, j + 1)) count.S++;
    if (isWall(i - 1, j)) count.W++;
    if (isWall(i + 1, j)) count.E++;
  }
  let best = null, bestN = 0;
  for (const s of ['N', 'S', 'W', 'E']) if (count[s] > bestN) { best = s; bestN = count[s]; }
  return best;
}
const FACE_AWAY = { N: 0, S: 180, W: 90, E: 270 };

// ---------------------------------------------------------------- muebles de las salas (station.json)
/** Grupo (celdas absolutas) de un mueble de sala. */
export function furnitureGroup(room, f) {
  const [x0, y0] = room.rect;
  const i0 = x0 + f.x, j0 = y0 + f.y, w = f.w ?? 1, h = f.h ?? 1;
  const cells = [];
  for (let j = j0; j < j0 + h; j++) for (let i = i0; i < i0 + w; i++) cells.push([i, j]);
  return { ch: 'o', cells, i0, j0, i1: i0 + w - 1, j1: j0 + h - 1, w, h, key: `${i0},${j0}` };
}

/** Índices de celda ocupados por los muebles de las salas (no se reclasifican como exterior). */
export function stationCells(grid) {
  const set = new Set();
  for (const r of ROOMS_LIST) {
    if (!r.rect) continue;
    for (const f of r.furniture ?? []) for (const [i, j] of furnitureGroup(r, f).cells) set.add(grid.index(i, j));
  }
  return set;
}

/** Tipo de un mueble de sala con el nivel dado (byLevel = un tipo por nivel). */
export function furnitureType(f, level) {
  if (f.byLevel) return f.byLevel[Math.min(level, f.byLevel.length - 1)];
  return f.type;
}

// ---------------------------------------------------------------- clasificación (exterior)
/** Muebles del exterior según su forma. */
function classifyO(g) {
  const { w, h } = g;
  if (w === 2 && h === 1) return { type: 'generador' };
  if (w === 3 && h === 1) return { type: 'banco_parque' };
  if (w === 2 && h === 2) return { type: 'caseta' };
  if (w === 1 && h === 1) return { type: 'arbol' };
  return { type: 'mueble_generico' };
}

export function classifyGroup(grid, g, overrides = {}) {
  const forced = overrides.groups?.[g.key];
  let res;
  const room = roomOf(g.i0, g.j0);
  if (g.ch === 'o') res = room ? { type: 'mueble_generico' } : classifyO(g);
  else if (g.ch === 'c') res = { type: 'patrulla', rot: 0 };
  else if (g.ch === 'k') res = { type: 'contenedor' };
  else res = { type: 'farola' };
  if (forced) res = { ...res, ...forced };
  const def = TYPES[res.type];
  if (!def) throw new Error(`Tipo de prop desconocido: ${res.type} (grupo ${g.key})`);
  if (res.rot == null) res.rot = autoRot(grid, g, def);
  res.room = room;
  return res;
}

function autoRot(grid, g, def) {
  if (def.fixedRot != null) return def.fixedRot;
  const side = g.ch === 'o' ? wallSide(grid, g) : null;
  return side ? FACE_AWAY[side] : 0;
}

// ---------------------------------------------------------------- construcción
function hash(...n) {
  let h = 2166136261;
  for (const v of n) { h ^= (v * 2654435761) | 0; h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Color del terreno (hex sRGB, como en MapRenderer) convertido a lineal para los colores por vértice.
const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
function terrainRgb(hex) {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => srgbToLinear(v / 255));
}

function groundColor(grid, g) {
  for (let j = g.j0 - 1; j <= g.j1 + 1; j++) {
    for (let i = g.i0 - 1; i <= g.i1 + 1; i++) {
      if (!grid.inBounds(i, j)) continue;
      const ch = grid.chars[grid.index(i, j)];
      if (ch === 'o') continue;
      const f = grid.tiles[ch]?.floor;
      if (f === 'hierba') return terrainRgb(FLOOR_COLORS.hierba[1]);
      if (f === 'asfalto') return terrainRgb(FLOOR_COLORS.asfalto[1]);
    }
  }
  return terrainRgb(FLOOR_COLORS.asfalto[1]);
}

/**
 * Colocador ligado a un builder: construye un tipo en una posición (celdas) y devuelve sus límites.
 * meta: { u, v (centro, celdas), y, rot (grados), lw, ld, seed, variant, p, level, global }
 */
function makePlacer(b, grid) {
  const cs = grid.cellSize;
  const wx = (u) => grid.originX + u * cs;
  const wz = (v) => grid.originZ + v * cs;
  return (type, def, meta) => {
    b.root(wx(meta.u), meta.y ?? 0, wz(meta.v), meta.rot * DEG);
    b.resetBounds();
    const fp = {
      type, lw: meta.lw, ld: meta.ld, rot: meta.rot, seed: meta.seed, variant: meta.variant,
      rnd: rng(meta.seed), p: meta.p ?? {}, level: meta.level, global: meta.global,
    };
    def.build(b, fp);
    return { fp, bounds: { ...b.bounds } };
  };
}

/** Coloca un mueble (grupo de celdas) y apunta sus acompañantes (sillas…) para la decoración. */
function placeGroup(place, g, cls, extra, instances, companions) {
  const def = TYPES[cls.type];
  const even = cls.rot % 180 === 0;
  const lw = even ? g.w : g.h, ld = even ? g.h : g.w;
  const u = (g.i0 + g.i1 + 1) / 2, v = (g.j0 + g.j1 + 1) / 2;
  const seed = hash(g.i0, g.j0, g.ch.charCodeAt(0));
  const { fp, bounds } = place(cls.type, def, { u, v, rot: cls.rot, lw, ld, seed, variant: cls.variant, p: cls, ...extra });
  instances.push({
    type: cls.type, ch: g.ch, blocking: true, key: g.key, cells: g.cells, bbox: { i0: g.i0, j0: g.j0, i1: g.i1, j1: g.j1 },
    rot: cls.rot, room: cls.room, bounds,
  });
  if (def.companions) {
    for (const c of def.companions({ ...fp, variant: cls.variant })) companions.push({ c, u, v, rot: cls.rot, seed });
  }
}

/** Convierte los acompañantes en entradas de decoración (posición girada con su mueble). */
function companionDecor(companions, out) {
  for (const { c, u, v, rot, seed } of companions) {
    const a = rot * DEG;
    out.push({
      type: c.type,
      x: u + c.lx * Math.cos(a) + c.lz * Math.sin(a),
      z: v - c.lx * Math.sin(a) + c.lz * Math.cos(a),
      rot: rot + (c.rel ?? 0) + (c.jitter ?? 0),
      ...(c.p ?? {}),
      _seed: seed,
    });
  }
}

/** Construye una lista de decoración (no bloqueante). */
function placeDecor(place, decor, instances, extra = {}) {
  decor.forEach((e, n) => {
    const def = TYPES[e.type];
    if (!def) throw new Error(`Tipo de decoración desconocido: ${e.type}`);
    const seed = e._seed != null ? hash(e._seed, n, Math.round(e.x * 10)) : hash(n, Math.round(e.x * 10), Math.round(e.z * 10));
    const { bounds } = place(e.type, def, {
      u: e.x, v: e.z, y: e.y0 ?? 0, rot: e.rot ?? 0, lw: e.w ?? 1, ld: e.d ?? 1, seed, variant: e.variant, p: e, ...extra,
    });
    instances.push({ type: e.type, ch: null, blocking: false, key: null, cells: [], bounds, room: extra.room ?? null });
  });
}

const visibleAt = (e, level) => (e.minLevel == null || level >= e.minLevel) && (e.maxLevel == null || level <= e.maxLevel);

/**
 * Construye una sala de station.json en `b` con su nivel (y el global, para la maqueta).
 * @returns {object[]} instancias (muebles y decoración)
 */
export function buildRoom(b, grid, room, level = 0, global = 0) {
  const place = makePlacer(b, grid);
  const instances = [], companions = [], decor = [];
  const extra = { level, global, room: room.id };
  if (room.rect) {
    const [x0, y0] = room.rect;
    for (const f of room.furniture ?? []) {
      const g = furnitureGroup(room, f);
      const type = furnitureType(f, level);
      const def = TYPES[type];
      if (!def) throw new Error(`Tipo de mueble desconocido: ${type} (sala ${room.id})`);
      const cls = { type, variant: f.variant, rot: f.rot ?? autoRot(grid, g, def), room: room.id };
      placeGroup(place, g, cls, extra, instances, companions);
    }
    companionDecor(companions, decor);
    for (const e of room.decor ?? []) {
      if (!visibleAt(e, level)) continue;
      if (e.wall) {
        const w = wallPoint(room.rect, e.wall, e.at);
        decor.push({ ...e, x: w.x, z: w.z, rot: e.rot ?? w.rot });
      } else decor.push({ ...e, x: x0 + e.x, z: y0 + e.z });
    }
  }
  const max = roomMaxLevel(room);
  for (const s of roomSigns(room)) {
    decor.push({ type: 'cartel_sala', x: s.x, z: s.z, rot: s.rot, y: s.y, room: room.id, stars: level, max, hang: s.hang, post: s.post, ladder: s.ladder });
  }
  placeDecor(place, decor, instances, extra);
  return instances;
}

/** Fachada sur con el nivel global de la comisaría. */
export function buildFacade(b, grid, global = 0) {
  const place = makePlacer(b, grid);
  const instances = [];
  placeDecor(place, [{ type: 'fachada', x: 0, z: STATION.facade.z, ox: 0 }], instances, { level: global, global, room: 'fachada' });
  return instances;
}

/** Salas que se reconstruyen por separado: las que tienen nivel (mejoras) o dependen del global. */
export const LEVEL_ROOMS = ROOMS_LIST.filter((r) => (r.upgrades ?? []).length || r.globalLevel).map((r) => r.id);

/**
 * Construye todos los props del mapa a nivel 0.
 * @returns {{ builder, instances, rooms: Map<string, {builder, instances}>, facade: {builder, instances}, interacts }}
 *   builder = lo fijo (exterior y salas sin nivel); rooms = un builder por sala con nivel.
 */
export function buildProps(grid, overrides = {}) {
  const b = new PropBuilder();
  const place = makePlacer(b, grid);
  const cs = grid.cellSize;
  const wx = (u) => grid.originX + u * cs;
  const wz = (v) => grid.originZ + v * cs;
  const instances = [];
  const companions = [];
  const claimed = stationCells(grid);

  const groupsAll = [];
  for (const ch of ['o', 'c', 'k', 'L']) groupsAll.push(...findGroups(grid, ch, claimed));
  for (const g of groupsAll) {
    const cls = classifyGroup(grid, g, overrides);
    if (g.ch === 'o' && !cls.room) {
      // Exterior: la baldosa 'o' dibuja suelo interior; se tapa con el color del terreno.
      b.root(wx((g.i0 + g.i1 + 1) / 2), 0, wz((g.j0 + g.j1 + 1) / 2), 0);
      b.box(0, 0, 0, g.w, 0.012, g.h, groundColor(grid, g), { ao: 0 });
    }
    placeGroup(place, g, cls, {}, instances, companions);
  }
  // Decoración exterior (layout.js + props.json) y acompañantes de los muebles.
  const decor = [...defaultDecor(), ...(overrides.decor ?? [])];
  companionDecor(companions, decor);
  placeDecor(place, decor, instances);

  // Salas: las de nivel fijo van al builder común; las demás, cada una al suyo.
  const rooms = new Map();
  const anchors = [b.interacts];
  for (const room of ROOMS_LIST) {
    if (LEVEL_ROOMS.includes(room.id)) {
      const rb = new PropBuilder();
      const inst = buildRoom(rb, grid, room, 0, 0);
      rooms.set(room.id, { builder: rb, instances: inst });
      instances.push(...inst);
      b.lights.push(...rb.lights);
      anchors.push(rb.interacts);
    } else {
      instances.push(...buildRoom(b, grid, room, 0, 0));
    }
  }
  const fb = new PropBuilder();
  const facade = { builder: fb, instances: buildFacade(fb, grid, 0) };
  instances.push(...facade.instances);

  // Puntos de interacción de todo (ajustados a celdas transitables, ids únicos por tipo).
  const interacts = [];
  for (const list of anchors) interacts.push(...list);
  snapAnchors(grid, interacts);
  return { builder: b, instances, rooms, facade, interacts };
}

function snapAnchors(grid, anchors) {
  const counters = {};
  for (const a of anchors) {
    const i = grid.cellX(a.x), j = grid.cellZ(a.z);
    if (!grid.isWalkable(i, j)) {
      let best = null, bestD = Infinity;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        if (!grid.isWalkable(i + di, j + dj)) continue;
        const d = (grid.centerX(i + di) - a.x) ** 2 + (grid.centerZ(j + dj) - a.z) ** 2;
        if (d < bestD) { bestD = d; best = [i + di, j + dj]; }
      }
      if (best) { a.x = grid.centerX(best[0]); a.z = grid.centerZ(best[1]); }
    }
    counters[a.type] = (counters[a.type] ?? 0) + 1;
    a.id = `${a.type}_${counters[a.type]}`;
  }
}

// ---------------------------------------------------------------- galería (previsualización)
/** Huella típica (celdas X×Z) de cada tipo bloqueante, para la galería de desarrollo. */
export const GALLERY_SIZES = {
  escritorio: [2, 1], archivador: [2, 1], consola_camaras: [2, 1], fuente: [1, 1], fotocopiadora: [1, 1], planta: [1, 1],
  banco_madera: [3, 1], banco_parque: [3, 1], sillas_espera: [3, 1], mostrador_recepcion: [3, 1], mostrador_armeria: [3, 1],
  mostrador_pruebas: [3, 1], mostrador_enfermeria: [3, 1], armero: [4, 1], estanteria_municion: [2, 1], taquillas: [4, 1],
  camillas: [4, 1], biombo: [2, 1], armario_medicinas: [2, 1], centralita_radio: [2, 1], cafetera: [1, 1], vending: [1, 1],
  camastro: [2, 1], wc: [1, 1], estanterias: [6, 1], cajas_apiladas: [1, 1], mueble_generico: [1, 1],
  patrulla: [4, 2], civil: [4, 2], furgoneta: [4, 2], contenedor: [3, 2], farola: [1, 1], arbol: [1, 1], mastil: [1, 1],
  caseta: [2, 2], generador: [2, 1],
  estanteria_archivo: [3, 1], servidor: [1, 1], mesa_comedor: [2, 2], sofa: [3, 1], maqueta: [2, 1], trastos: [3, 1],
  banco_trabajo: [2, 1], duchas: [4, 1], banco_vestuario: [3, 1], lavabos: [3, 1],
};
/** Parámetros de ejemplo para la decoración en la galería. */
export const GALLERY_DECOR = {
  silla_oficina: {}, silla_ruedas: {}, alfombra: { w: 2, d: 1.2, color: 0xb23c33 }, linea: { w: 0.12, d: 1.5 },
  papeles_suelo: { n: 4 }, bolsas_suelo: { n: 3 }, cartel: { sprite: 'comisaria', w: 1.8, y: 1.2 }, reloj: { y: 1.2 },
  tablon_corcho: { y: 1.2 }, tablon_se_busca: { y: 1.2 }, mapa_pared: { y: 1.2 }, pizarra_casos: { y: 1.3 },
  escudo_pared: { y: 1.3 }, extintor: {}, salida: { y: 1.4 }, camara_seguridad: { y: 1.4 }, cruz_roja: { y: 1.3 },
  botiquin_pared: { y: 1.0 }, cuadro_electrico: { y: 1.0 }, alarma: { y: 1.0 }, medicion_pared: {}, detector_metales: {},
  bandera_stand: {}, bandera_mastil: { y: 1.2 }, cono: {}, barrera: { raise: 0.2 }, senal: { sprite: 'stop', w: 0.6, top: 2.2 },
  arbusto: {}, planta_deco: {},
  fluorescente: { y: 1.4 }, gotera: {}, monitores_pared: {}, puerta_acorazada: {}, cruz_luminosa: { y: 1.3 },
  perchero_chalecos: {}, calendario: { y: 1.2 }, silla_rota: {}, cajas_suelo: {},
};

/** Todos los tipos en filas de ancho limitado (muebles y luego decoración), cada uno con su nombre. */
export function buildGallery(origin = { x: 0, z: -60 }, maxRowWidth = 24) {
  const b = new PropBuilder();
  const labels = [], rows = [];
  const GAP = 1.4;
  const layoutRows = (names, sizeOf) => {
    const out = [];
    let cur = [], w = 0;
    for (const n of names) {
      const sw = sizeOf(n)[0] + GAP;
      if (cur.length && w + sw > maxRowWidth) { out.push(cur); cur = []; w = 0; }
      cur.push(n); w += sw;
    }
    if (cur.length) out.push(cur);
    return out;
  };
  let z = origin.z;
  const emit = (names, sizeOf, step) => {
    for (const row of layoutRows(names, sizeOf)) {
      const total = row.reduce((s, n) => s + sizeOf(n)[0] + GAP, 0);
      let x = origin.x - total / 2;
      const r = { z, x0: x, x1: x + total, names: row };
      for (const name of row) {
        const [lw, ld] = sizeOf(name);
        const cx = x + lw / 2;
        b.root(cx, 0, z, 0);
        b.resetBounds();
        const seed = hash(name.length, lw, name.charCodeAt(0));
        TYPES[name].build(b, { type: name, lw, ld, rot: 0, seed, variant: undefined, rnd: rng(seed), p: GALLERY_DECOR[name] ?? {} });
        labels.push({ name, x: cx, y: Math.max(1.5, b.bounds.maxY + 0.25), z });
        x += lw + GAP;
      }
      rows.push(r);
      z -= step;
    }
  };
  const furn = Object.keys(GALLERY_SIZES).filter((n) => TYPES[n]);
  emit(furn, (n) => GALLERY_SIZES[n], 7);
  const decor = Object.keys(GALLERY_DECOR).filter((n) => TYPES[n]);
  emit(decor, (n) => (n === 'alfombra' ? [2, 1] : [1, 1]), 4.5);
  return { builder: b, labels, rows };
}
