// Física mínima sobre el plano XZ: círculos contra celdas bloqueadas, raycast DDA
// sobre la rejilla y una rejilla espacial (spatial hash) para consultas entre entidades.

/**
 * Empuja un círculo fuera de las celdas no transitables. Modifica `pos` (con x,z).
 * @returns {boolean} si hubo contacto
 */
export function resolveCircleVsGrid(pos, r, grid) {
  let hit = false;
  for (let iter = 0; iter < 2; iter++) {
    const i0 = grid.cellX(pos.x - r), i1 = grid.cellX(pos.x + r);
    const j0 = grid.cellZ(pos.z - r), j1 = grid.cellZ(pos.z + r);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (grid.isWalkable(i, j)) continue;
        let minX = grid.originX + i * grid.cellSize, maxX = minX + grid.cellSize;
        let minZ = grid.originZ + j * grid.cellSize, maxZ = minZ + grid.cellSize;
        const inset = grid.inBounds(i, j) ? grid.collisionInset[grid.index(i, j)] : 0;
        if (inset > 0) {
          if (grid.isWalkable(i - 1, j)) minX += inset;
          if (grid.isWalkable(i + 1, j)) maxX -= inset;
          if (grid.isWalkable(i, j - 1)) minZ += inset;
          if (grid.isWalkable(i, j + 1)) maxZ -= inset;
        }
        const cx = Math.max(minX, Math.min(pos.x, maxX));
        const cz = Math.max(minZ, Math.min(pos.z, maxZ));
        let dx = pos.x - cx, dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        hit = true;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          const push = r - d;
          pos.x += (dx / d) * push;
          pos.z += (dz / d) * push;
        } else {
          // Centro dentro de la celda: sacarlo por el lado más cercano.
          const left = pos.x - minX, right = maxX - pos.x, top = pos.z - minZ, bottom = maxZ - pos.z;
          const m = Math.min(left, right, top, bottom);
          if (m === left) pos.x = minX - r;
          else if (m === right) pos.x = maxX + r;
          else if (m === top) pos.z = minZ - r;
          else pos.z = maxZ + r;
        }
      }
    }
  }
  return hit;
}

/**
 * Recorre la rejilla (DDA) desde (ox,oz) en dirección (dx,dz) normalizada.
 * @param {(i:number,j:number)=>boolean} blocked
 * @returns {number} distancia hasta la primera celda bloqueada, o maxDist
 */
export function raycastGrid(grid, ox, oz, dx, dz, maxDist, blocked) {
  const cs = grid.cellSize;
  let i = grid.cellX(ox), j = grid.cellZ(oz);
  if (blocked(i, j)) return 0;
  const stepI = dx > 0 ? 1 : -1, stepJ = dz > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(cs / dx) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(cs / dz) : Infinity;
  const cellMinX = grid.originX + i * cs, cellMinZ = grid.originZ + j * cs;
  let tMaxX = dx > 0 ? (cellMinX + cs - ox) / dx : dx < 0 ? (cellMinX - ox) / dx : Infinity;
  let tMaxZ = dz > 0 ? (cellMinZ + cs - oz) / dz : dz < 0 ? (cellMinZ - oz) / dz : Infinity;
  let t = 0;
  while (t < maxDist) {
    if (tMaxX < tMaxZ) { t = tMaxX; tMaxX += tDeltaX; i += stepI; }
    else { t = tMaxZ; tMaxZ += tDeltaZ; j += stepJ; }
    if (t >= maxDist) break;
    if (blocked(i, j)) return t;
  }
  return maxDist;
}

/** Intersección rayo–círculo en 2D. Devuelve t ≥ 0 o -1. */
export function rayCircle(ox, oz, dx, dz, cx, cz, r) {
  const fx = ox - cx, fz = oz - cz;
  const b = fx * dx + fz * dz;
  const c = fx * fx + fz * fz - r * r;
  if (c <= 0) return 0; // origen dentro del círculo
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : -1;
}

/** Rejilla espacial con listas enlazadas en arrays tipados (sin asignaciones por frame). */
export class SpatialHash {
  constructor(worldSize, cellSize, maxItems) {
    this.cellSize = cellSize;
    this.dim = Math.ceil(worldSize / cellSize) + 2;
    this.offset = worldSize / 2 + cellSize;
    this.head = new Int32Array(this.dim * this.dim).fill(-1);
    this.nextItem = new Int32Array(maxItems);
    this.items = new Array(maxItems);
    this.count = 0;
  }

  clear() {
    this.head.fill(-1);
    this.count = 0;
  }

  key(x, z) {
    let i = Math.floor((x + this.offset) / this.cellSize);
    let j = Math.floor((z + this.offset) / this.cellSize);
    i = Math.max(0, Math.min(this.dim - 1, i));
    j = Math.max(0, Math.min(this.dim - 1, j));
    return j * this.dim + i;
  }

  insert(item, x, z) {
    if (this.count >= this.items.length) return;
    const idx = this.count++;
    const k = this.key(x, z);
    this.items[idx] = item;
    this.nextItem[idx] = this.head[k];
    this.head[k] = idx;
  }

  /** Llama a fn(item) para los elementos en las celdas que tocan el círculo (x,z,r). */
  query(x, z, r, fn) {
    const cs = this.cellSize;
    const i0 = Math.max(0, Math.floor((x - r + this.offset) / cs));
    const i1 = Math.min(this.dim - 1, Math.floor((x + r + this.offset) / cs));
    const j0 = Math.max(0, Math.floor((z - r + this.offset) / cs));
    const j1 = Math.min(this.dim - 1, Math.floor((z + r + this.offset) / cs));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        for (let idx = this.head[j * this.dim + i]; idx !== -1; idx = this.nextItem[idx]) fn(this.items[idx]);
      }
    }
  }
}
