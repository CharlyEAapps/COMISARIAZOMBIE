// Funciones puras de las misiones (sin DOM ni Three.js) para poder testearlas.

/** Valor de un parámetro: número fijo o [base, extra por noche, mín, máx]. */
export function scaleParam(spec, night) {
  if (!Array.isArray(spec)) return spec;
  const [base, per = 0, min = -Infinity, max = Infinity] = spec;
  return Math.min(max, Math.max(min, base + per * (night - 1)));
}

/** Parámetros de una misión para la noche `night`. */
export function resolveParams(params, night) {
  const out = {};
  for (const [k, v] of Object.entries(params ?? {})) out[k] = scaleParam(v, night);
  return out;
}

/** Sustituye {clave} por su valor (si no existe, deja el texto tal cual). */
export function fillText(text, vars) {
  return String(text ?? '').replace(/\{(\w+)\}/g, (all, k) => (k in vars ? String(vars[k]) : all));
}

/** Recompensa (puntos) de una misión en la noche `night`, con el multiplicador del archivo. */
export function missionReward(def, night, mul = 1) {
  return Math.round(scaleParam(def.reward, night) * mul);
}

/** Probabilidad de un evento forzado esta noche; 1 si hace `pityNights` noches que no hay. */
export function forcedChance(cfg, night, nightsSinceLast) {
  if (night < cfg.fromNight) return 0;
  if (nightsSinceLast >= cfg.pityNights) return 1;
  return Math.min(cfg.maxChance, cfg.chance + cfg.chancePerNight * (night - cfg.fromNight));
}

/** Saca un círculo (pos con x,z) de una caja [minX, minZ, maxX, maxZ]. @returns {boolean} si había contacto */
export function pushOutOfRect(pos, r, minX, minZ, maxX, maxZ) {
  const cx = Math.max(minX, Math.min(pos.x, maxX));
  const cz = Math.max(minZ, Math.min(pos.z, maxZ));
  const dx = pos.x - cx, dz = pos.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 > 1e-10) {
    const d = Math.sqrt(d2);
    pos.x += (dx / d) * (r - d);
    pos.z += (dz / d) * (r - d);
    return true;
  }
  // Centro dentro de la caja: sale por el lado más cercano.
  const left = pos.x - minX, right = maxX - pos.x, up = pos.z - minZ, down = maxZ - pos.z;
  const m = Math.min(left, right, up, down);
  if (m === left) pos.x = minX - r;
  else if (m === right) pos.x = maxX + r;
  else if (m === up) pos.z = minZ - r;
  else pos.z = maxZ + r;
  return true;
}

/** Caja de colisión [minX, minZ, maxX, maxZ] de un coche de 4×1,9 m centrado en (x, z). */
export function carBox(x, z, rot90, length = 4, width = 1.9) {
  const hx = (rot90 ? width : length) / 2, hz = (rot90 ? length : width) / 2;
  return [x - hx, z - hz, x + hx, z + hz];
}

/** ¿Está el punto (x, z) dentro del edificio `b` = [x0, y0, x1, y1] (muros exteriores incluidos)? */
export function insideBuilding(grid, b, x, z) {
  const i = grid.cellX(x), j = grid.cellZ(z);
  return i > b[0] && i < b[2] && j > b[1] && j < b[3];
}

/** Cuenta los zombis vivos a menos de `r` de (x, z), con tope `cap`. */
export function zombiesNear(active, x, z, r, cap = Infinity) {
  let n = 0;
  const r2 = r * r;
  for (const zb of active) {
    if (zb.state !== 0) continue;
    const dx = zb.pos.x - x, dz = zb.pos.z - z;
    if (dx * dx + dz * dz < r2 && ++n >= cap) break;
  }
  return n;
}

/** Zombi vivo más cercano a (x, z) dentro de `r`: devuelve su distancia (Infinity si no hay) y deja la posición en `out`. */
export function nearestZombie(active, x, z, r, out) {
  let best = Infinity;
  for (const zb of active) {
    if (zb.state !== 0) continue;
    const dx = zb.pos.x - x, dz = zb.pos.z - z;
    const d = Math.hypot(dx, dz);
    if (d < r && d < best) { best = d; out.x = zb.pos.x; out.z = zb.pos.z; }
  }
  return best;
}

/** mm:ss */
export function clock(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Elige un sitio de una lista (celdas [i, j] o {x, z}) que cumpla `ok`, lejos de (px, pz) al
 * menos `minDist` si se puede; si no, el más lejano. `pos(site)` da (x, z) en el mundo.
 */
export function chooseSite(sites, pos, ok, px, pz, minDist, rnd = Math.random) {
  const good = [];
  let far = null, farD = -1;
  for (const s of sites) {
    const p = pos(s);
    if (ok && !ok(s, p)) continue;
    const d = Math.hypot(p.x - px, p.z - pz);
    if (d > farD) { farD = d; far = s; }
    if (d >= minDist) good.push(s);
  }
  if (good.length) return good[(rnd() * good.length) | 0];
  return far;
}
