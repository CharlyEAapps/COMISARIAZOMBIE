import data from '../data/despacho.json';

// Barriles explosivos del parking (mejora "Barriles explosivos" del despacho, en el patio).
// Son piezas 'barril' automáticas de BuildSystem (placeAuto): bloquean el paso, las balas y las
// torretas los detonan (barrelRaycast), las explosiones los encadenan (BuildSystem.blast) y el
// estallido es el de Explosions.js con los datos de build.json → pieces.barril. No se guardan:
// se vuelven a poner cada anochecer (y al continuar un turno).

const B = data.upgrades.barriles;

/** Número de barriles del nivel `level` (0 sin la mejora). */
export function barrelCount(level) {
  return level > 0 ? B.count[Math.min(level, B.count.length) - 1] : 0;
}

/** Celdas (índices de la rejilla) donde van los barriles del nivel `level`. */
export function barrelCells(grid, level) {
  return B.spots.slice(0, barrelCount(level)).map(([x, z]) => grid.index(x, z));
}

/** ¿Hay algún zombi vivo dentro del radio de la explosión del barril `s`? */
export function barrelHasVictims(s, zombies) {
  const R = s.def.radius;
  for (const z of zombies) {
    if (z.state !== 0) continue;
    const dx = z.pos.x - s.cx, dz = z.pos.z - s.cz;
    if (dx * dx + dz * dz <= R * R) return true;
  }
  return false;
}

/**
 * Asistencia de apuntado (táctil y mando): el barril más alineado con la dirección (dx, dz)
 * desde (px, pz), dentro del alcance y más alineado que `minCos` (el mejor zombi encontrado),
 * pero solo si tiene zombis en su radio (para no volar barriles por error). null si ninguno.
 */
export function assistBarrel(barrels, zombies, px, pz, dx, dz, minCos, range) {
  let best = null, bestCos = minCos;
  for (const s of barrels) {
    const bx = s.cx - px, bz = s.cz - pz;
    const d = Math.hypot(bx, bz);
    if (d > range || d < 1e-3) continue;
    const c = (bx * dx + bz * dz) / d;
    if (c > bestCos && barrelHasVictims(s, zombies)) { bestCos = c; best = s; }
  }
  return best;
}

export class YardBarrels {
  constructor(game) {
    this.game = game;
    this.list = [];       // barriles puestos por la mejora que siguen en pie
    this.pending = false; // poner en el siguiente paso (tras restaurar lo construido)
  }

  /** Olvida los barriles que ya han estallado. @returns {number} los que siguen en pie */
  prune() {
    const all = this.game.build.all;
    for (let n = this.list.length - 1; n >= 0; n--) if (!all.has(this.list[n])) this.list.splice(n, 1);
    return this.list.length;
  }

  /** ¿Se puede poner un barril en la celda k ahora mismo? */
  free(k, reserved) {
    const { grid, build, player, zombies, interactions } = this.game;
    const i = k % grid.w, j = (k / grid.w) | 0;
    if (!grid.isStaticWalkable(i, j) || build.structures.has(k) || grid.blocked[k] || reserved?.(k)) return false;
    for (const it of interactions.items) if (!it.dynamic && grid.walkableCellAt(it.x, it.z) === k) return false;
    const [x0, z0, x1, z1] = grid.cellBox(i, j);
    const over = (x, z, r) => x + r > x0 && x - r < x1 && z + r > z0 && z - r < z1;
    if (over(player.position.x, player.position.z, player.radius)) return false;
    for (const z of zombies.active) if (z.state === 0 && over(z.pos.x, z.pos.z, z.radius)) return false;
    return true;
  }

  /** Pone los barriles que falten del nivel `level`. @returns {number} barriles nuevos */
  place(level, reserved) {
    this.prune();
    const { build } = this.game;
    let placed = 0;
    for (const k of barrelCells(this.game.grid, level)) {
      if (this.list.some((s) => s.k === k) || !this.free(k, reserved)) continue;
      const s = build.placeAuto('barril', [k], 0);
      if (!s) continue;
      this.list.push(s);
      placed++;
    }
    return placed;
  }

  /** Retira los barriles de la mejora (sin explosión). */
  remove() {
    const { build } = this.game;
    for (const s of this.list) if (build.all.has(s)) build.remove(s);
    this.list.length = 0;
    this.pending = false;
  }
}
