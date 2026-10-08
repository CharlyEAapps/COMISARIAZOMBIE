// Rejilla del mundo: 1 celda = cellSize metros. Columna i → eje X, fila j → eje Z.
// La fila 0 es el norte (z mínima), que en pantalla queda arriba.
export class NavGrid {
  /**
   * @param {string[]} rows mapa ASCII (todas las filas con la misma longitud)
   * @param {Record<string, object>} tiles leyenda de tiles.json
   * @param {number} cellSize
   */
  constructor(rows, tiles, cellSize = 1) {
    this.rows = rows;
    this.tiles = tiles;
    this.cellSize = cellSize;
    this.h = rows.length;
    this.w = rows[0].length;
    this.originX = -(this.w * cellSize) / 2;
    this.originZ = -(this.h * cellSize) / 2;
    const n = this.w * this.h;
    this.chars = new Array(n);
    this.walkable = new Uint8Array(n);
    this.blocksShot = new Uint8Array(n);
    this.height = new Float32Array(n);
    // Coste extra de atravesar la celda (estructuras construidas, fase 3). 0 = libre.
    this.extraCost = new Float32Array(n);
    // Margen de colisión de los tiles finos (muros): se recorta en los lados que dan a celdas libres.
    this.collisionInset = new Float32Array(n);
    this.playerStart = null;
    this.spawns = [];
    this.shops = {};
    this.lights = [];
    this.doors = [];

    for (let j = 0; j < this.h; j++) {
      const row = rows[j];
      if (row.length !== this.w) throw new Error(`Fila ${j} mide ${row.length}, se esperaba ${this.w}`);
      for (let i = 0; i < this.w; i++) {
        const ch = row[i];
        const t = tiles[ch];
        if (!t) throw new Error(`Carácter desconocido '${ch}' en (${i},${j})`);
        const k = j * this.w + i;
        this.chars[k] = ch;
        this.walkable[k] = t.walk ? 1 : 0;
        this.blocksShot[k] = t.blocksShot ? 1 : 0;
        this.height[k] = t.height;
        this.collisionInset[k] = t.collisionInset ?? 0;
        if (t.playerStart) this.playerStart = { i, j };
        if (t.spawn) this.spawns.push({ i, j });
        if (t.shop) (this.shops[t.shop] ??= []).push({ i, j });
        if (t.light) this.lights.push({ i, j });
        if (t.door) this.doors.push({ i, j });
      }
    }
  }

  index(i, j) { return j * this.w + i; }
  inBounds(i, j) { return i >= 0 && j >= 0 && i < this.w && j < this.h; }

  isWalkable(i, j) {
    return this.inBounds(i, j) && this.walkable[j * this.w + i] === 1;
  }

  /** Bloquea balas (fuera del mapa también bloquea). */
  isShotBlocked(i, j) {
    return !this.inBounds(i, j) || this.blocksShot[j * this.w + i] === 1;
  }

  cellX(x) { return Math.floor((x - this.originX) / this.cellSize); }
  cellZ(z) { return Math.floor((z - this.originZ) / this.cellSize); }
  centerX(i) { return this.originX + (i + 0.5) * this.cellSize; }
  centerZ(j) { return this.originZ + (j + 0.5) * this.cellSize; }

  /** BFS de 4 vecinos: devuelve el número de pasos desde (si,sj) o -1 en celdas inalcanzables. */
  bfs(si, sj) {
    const dist = new Int32Array(this.w * this.h).fill(-1);
    const queue = new Int32Array(this.w * this.h);
    let head = 0, tail = 0;
    const s = this.index(si, sj);
    dist[s] = 0;
    queue[tail++] = s;
    while (head < tail) {
      const k = queue[head++];
      const i = k % this.w, j = (k / this.w) | 0;
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [di, dj] of nb) {
        const ni = i + di, nj = j + dj;
        if (!this.isWalkable(ni, nj)) continue;
        const nk = this.index(ni, nj);
        if (dist[nk] !== -1) continue;
        dist[nk] = dist[k] + 1;
        queue[tail++] = nk;
      }
    }
    return dist;
  }
}
