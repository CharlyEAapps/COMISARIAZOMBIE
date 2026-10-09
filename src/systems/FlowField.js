// Flow field por Dijkstra sobre la rejilla (8 vecinos, sin cortar esquinas).
// Cada celda guarda la distancia al objetivo y la siguiente celda a la que moverse,
// así cada zombi solo hace una lectura O(1) por paso.
const SQRT2 = Math.SQRT2;
const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

export class FlowField {
  constructor(grid) {
    this.grid = grid;
    const n = grid.w * grid.h;
    this.dist = new Float64Array(n);
    this.next = new Int32Array(n);
    // Cada celda entra en el heap como mucho una vez por mejora de distancia (≤ 8 vecinos).
    this.heapK = new Int32Array(n * 8);
    this.heapD = new Float64Array(n * 8);
    this.target = { i: -1, j: -1 };
    this._single = [0];
  }

  /**
   * Celda transitable para el cálculo: el mapa estático. Las construcciones no cortan el
   * camino, solo lo encarecen (extraCost ∝ vida): así, si la base está cerrada, la horda
   * elige la barricada más débil.
   */
  passable(i, j) {
    return this.grid.isStaticWalkable(i, j);
  }

  compute(ti, tj) {
    this._single[0] = tj * this.grid.w + ti;
    this.target.i = ti;
    this.target.j = tj;
    this.computeMulti(this._single);
  }

  /** Flow field hacia la más cercana de varias celdas objetivo (índices k). */
  computeMulti(targets) {
    const { grid, dist, next, heapK, heapD } = this;
    const w = grid.w;
    dist.fill(Infinity);
    next.fill(-1);

    let size = 0;
    const push = (k, d) => {
      let c = size++;
      while (c > 0) {
        const p = (c - 1) >> 1;
        if (heapD[p] <= d) break;
        heapK[c] = heapK[p]; heapD[c] = heapD[p];
        c = p;
      }
      heapK[c] = k; heapD[c] = d;
    };
    const pop = () => {
      const k = heapK[0];
      const lastK = heapK[--size], lastD = heapD[size];
      let c = 0;
      for (;;) {
        let l = 2 * c + 1;
        if (l >= size) break;
        if (l + 1 < size && heapD[l + 1] < heapD[l]) l++;
        if (heapD[l] >= lastD) break;
        heapK[c] = heapK[l]; heapD[c] = heapD[l];
        c = l;
      }
      heapK[c] = lastK; heapD[c] = lastD;
      return k;
    };

    for (const t of targets) {
      if (t < 0 || !this.passable(t % w, (t / w) | 0) || dist[t] === 0) continue;
      dist[t] = 0;
      push(t, 0);
    }
    while (size > 0) {
      const d0 = heapD[0];
      const k = pop();
      if (d0 > dist[k]) continue;
      const i = k % w, j = (k / w) | 0;
      for (const [di, dj, c] of DIRS) {
        const ni = i + di, nj = j + dj;
        if (!this.passable(ni, nj)) continue;
        // Sin cortar esquinas: en diagonal, ambas celdas ortogonales deben estar libres AHORA
        // (incluidas las construcciones; si no, dos barricadas en diagonal dejarían una rendija).
        if (di && dj && (!grid.isWalkable(i + di, j) || !grid.isWalkable(i, j + dj))) continue;
        const nk = nj * w + ni;
        const nd = d0 + c + grid.extraCost[nk];
        if (nd < dist[nk]) {
          dist[nk] = nd;
          next[nk] = k; // desde nk se avanza hacia k
          push(nk, nd);
        }
      }
    }
  }

  /** Índice de la siguiente celda desde (i,j), o -1 si no hay camino. */
  nextCell(i, j) {
    if (!this.grid.inBounds(i, j)) return -1;
    return this.next[j * this.grid.w + i];
  }

  distanceAt(i, j) {
    if (!this.grid.inBounds(i, j)) return Infinity;
    return this.dist[j * this.grid.w + i];
  }
}
