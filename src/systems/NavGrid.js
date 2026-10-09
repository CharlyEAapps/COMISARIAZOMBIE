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
    // Capa dinámica (construcciones del jugador): bloqueo de paso/balas y caja de colisión por celda.
    this.blocked = new Uint8Array(n);
    this.blockedShot = new Uint8Array(n);
    this.dynBox = new Float32Array(n * 4);
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
    this.buildCollisionBoxes();
  }

  /**
   * Cajas de colisión por celda (fuente única para física, raycast y render del mapa).
   * Los tiles con collisionInset (muros, vallas, rejas) son barras finas de grosor
   * cellSize − 2·inset que llegan al borde solo hacia vecinos de su mismo tipo "fino"; los
   * muros llegan también hasta el borde de los huecos de puerta ('D'), para que el hueco
   * quede enmarcado y una puerta construida encaje justo entre ellos.
   * El resto de tiles no transitables ocupan la celda entera.
   */
  buildCollisionBoxes() {
    const n = this.w * this.h;
    this.boxStart = new Int32Array(n);
    this.boxCount = new Uint8Array(n);
    const boxes = [];
    const cs = this.cellSize;
    const thinAt = (i, j) => this.inBounds(i, j) && !this.walkable[j * this.w + i] && this.collisionInset[j * this.w + i] > 0;
    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        const k = j * this.w + i;
        this.boxStart[k] = boxes.length / 4;
        if (this.walkable[k]) continue;
        const x0 = this.originX + i * cs, z0 = this.originZ + j * cs;
        const inset = this.collisionInset[k];
        if (inset <= 0) {
          boxes.push(x0, z0, x0 + cs, z0 + cs);
          this.boxCount[k] = 1;
          continue;
        }
        const isWall = this.chars[k] === '#';
        const doorAt = (a, b) => isWall && this.inBounds(a, b) && this.tiles[this.chars[b * this.w + a]].door === true;
        const joins = (a, b) => thinAt(a, b) || doorAt(a, b);
        const e = joins(i + 1, j), w = joins(i - 1, j), s = joins(i, j + 1), nn = joins(i, j - 1);
        const lo = inset, hi = cs - inset;
        let count = 0;
        if (e || w) { boxes.push(x0 + (w ? 0 : lo), z0 + lo, x0 + (e ? cs : hi), z0 + hi); count++; }
        if (nn || s) { boxes.push(x0 + lo, z0 + (nn ? 0 : lo), x0 + hi, z0 + (s ? cs : hi)); count++; }
        if (!count) { boxes.push(x0 + lo, z0 + lo, x0 + hi, z0 + hi); count = 1; }
        this.boxCount[k] = count;
      }
    }
    this.boxes = new Float32Array(boxes);
  }

  /**
   * Celda transitable que corresponde a (x,z). Con colisiones finas, el centro de una
   * entidad puede quedar sobre una celda de muro: entonces se devuelve la vecina
   * transitable más cercana al punto. -1 si no hay ninguna.
   */
  walkableCellAt(x, z) {
    const i = this.cellX(x), j = this.cellZ(z);
    if (this.isWalkable(i, j)) return j * this.w + i;
    let best = -1, bestD = Infinity;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const ni = i + di, nj = j + dj;
        if ((!di && !dj) || !this.isWalkable(ni, nj)) continue;
        const d = (this.centerX(ni) - x) ** 2 + (this.centerZ(nj) - z) ** 2;
        if (d < bestD) { bestD = d; best = nj * this.w + ni; }
      }
    }
    return best;
  }

  index(i, j) { return j * this.w + i; }
  inBounds(i, j) { return i >= 0 && j >= 0 && i < this.w && j < this.h; }

  /** Transitable ahora mismo (mapa + construcciones). */
  isWalkable(i, j) {
    if (!this.inBounds(i, j)) return false;
    const k = j * this.w + i;
    return this.walkable[k] === 1 && this.blocked[k] === 0;
  }

  /** Transitable según el mapa, ignorando construcciones (para el flow field con costes). */
  isStaticWalkable(i, j) {
    return this.inBounds(i, j) && this.walkable[j * this.w + i] === 1;
  }

  /** Bloquea balas (fuera del mapa también bloquea). */
  isShotBlocked(i, j) {
    if (!this.inBounds(i, j)) return true;
    const k = j * this.w + i;
    return this.blocksShot[k] === 1 || this.blockedShot[k] === 1;
  }

  /**
   * Marca una celda transitable como ocupada por una construcción.
   * @param {[number,number,number,number]} box caja de colisión en mundo [minX,minZ,maxX,maxZ]
   */
  setDynamic(k, blocks, blocksShot, box) {
    this.blocked[k] = blocks ? 1 : 0;
    this.blockedShot[k] = blocksShot ? 1 : 0;
    this.dynBox.set(box, k * 4);
  }

  clearDynamic(k) {
    this.blocked[k] = 0;
    this.blockedShot[k] = 0;
    this.extraCost[k] = 0;
  }

  /** Caja [minX,minZ,maxX,maxZ] de una celda completa (con un margen opcional). */
  cellBox(i, j, margin = 0) {
    const x0 = this.originX + i * this.cellSize, z0 = this.originZ + j * this.cellSize;
    return [x0 + margin, z0 + margin, x0 + this.cellSize - margin, z0 + this.cellSize - margin];
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
