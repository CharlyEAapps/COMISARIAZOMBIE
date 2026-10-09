import buildData from '../data/build.json';
import { PHASE } from './DayNight.js';

export const PIECE_ORDER = ['barricada', 'sacos', 'puerta', 'pinchos', 'cepo', 'mina'];
const NO_BUILD_CHARS = new Set(['S', 'A', 'M', 'W']);

/** Coste de reparar una pieza (función pura): proporcional al daño y al coste del nivel actual. */
export function repairCost(cfg, def, s) {
  if (s.hp >= s.maxHp) return 0;
  return Math.max(1, Math.ceil(((s.maxHp - s.hp) / s.maxHp) * def.levels[s.level].cost * cfg.repairCostFactor));
}

// Construcción del jugador: barricadas, sacos, puertas y trampas (1 celda cada una), y el
// transformador de la comisaría. Las piezas que bloquean se marcan en la capa dinámica de
// NavGrid (colisión, balas, coste en el flow field) y los zombis las golpean al toparse con ellas.
export class BuildSystem {
  constructor(game) {
    this.game = game;
    this.cfg = buildData;
    this.pieces = buildData.pieces;
    this.structures = new Map(); // celda → estructura
    this.active = false;         // modo construcción
    this.selected = PIECE_ORDER[0];
    this.hoverCell = -1;
    this.hoverReason = null;
    this.dragging = false;
    this.lastDragCell = -1;
    this.version = 0;            // sube en cada cambio (para el render)
    this.nextId = 1;
    this.initTransformer();
    this.reset();
  }

  // ------------------------------------------------------------------ transformador
  initTransformer() {
    const { grid, props } = this.game;
    const inst = props?.instances.find((p) => p.type === 'generador');
    const anchor = props?.interactAnchors.find((a) => a.type === 'generador');
    if (!inst || !anchor) { this.transformer = null; return; }
    const { i0, j0, i1, j1 } = inst.bbox;
    const a = grid.cellBox(i0, j0), b = grid.cellBox(i1, j1);
    this.transformer = {
      hp: this.cfg.transformer.hp,
      maxHp: this.cfg.transformer.hp,
      x: (a[0] + b[2]) / 2,
      z: (a[1] + b[3]) / 2,
      box: [a[0], a[1], b[2], b[3]],
      cell: grid.walkableCellAt(anchor.x, anchor.z),
      flash: 0,
    };
  }

  damageTransformer(amount) {
    const t = this.transformer;
    if (!t || t.hp <= 0) return;
    t.hp = Math.max(0, t.hp - amount);
    t.flash = 0.12;
    this.game.effects.burst(t.x, 1.0, t.z, 5, 0xffd24a, { speed: 2.5, up: 3, size: 0.05, life: 0.5 });
    if (t.hp <= 0) {
      this.game.effects.burst(t.x, 1.2, t.z, 30, 0x2b2b2b, { speed: 3, up: 4, size: 0.12, life: 1.6 });
      this.game.effects.shake(0.2);
      this.game.hud.toast('⚠ ¡Han destruido el transformador! Sin corriente: repáralo en el patio.', 6);
      this.game.bus.emit('transformer:destroyed');
    }
  }

  transformerRepairCost() {
    const t = this.transformer;
    if (!t || t.hp >= t.maxHp) return 0;
    return Math.max(1, Math.ceil((t.maxHp - t.hp) * this.cfg.transformer.repairCostPerHp));
  }

  repairTransformer() {
    const t = this.transformer;
    const cost = this.transformerRepairCost();
    if (!cost || this.game.run.points < cost) return null;
    this.game.run.points -= cost;
    const wasDead = t.hp <= 0;
    t.hp = t.maxHp;
    this.game.floating?.spawn(`-${cost}`, t.x, 2, t.z, 'neg');
    return wasDead ? `⚡ Transformador reparado (−${cost}): vuelve la luz` : `🔧 Transformador reparado (−${cost})`;
  }

  // ------------------------------------------------------------------ estado
  reset() {
    const { grid } = this.game;
    for (const s of this.structures.values()) {
      grid.clearDynamic(s.k);
      if (s.type === 'puerta') this.game.interactions?.removeItem(`puerta_${s.k}`);
    }
    this.structures.clear();
    this.active = false;
    this.dragging = false;
    if (this.transformer) { this.transformer.hp = this.transformer.maxHp; this.transformer.flash = 0; }
    this.changed();
  }

  changed() {
    this.version++;
    if (this.game.zombies) this.game.zombies.flowDirty = true;
  }

  get isNight() {
    return this.game.dayNight.phase === PHASE.NIGHT;
  }

  costOf(type, level = 0) {
    const base = this.pieces[type].levels[level].cost;
    return Math.ceil(base * (this.isNight ? this.cfg.nightSurcharge : 1));
  }

  levelStat(def, level, key) {
    return def.levels[level][key] ?? def[key];
  }

  // ------------------------------------------------------------------ reglas de colocación
  /** @returns {string|null} motivo por el que no se puede construir, o null si se puede */
  canPlace(type, k) {
    const { grid, player, zombies, interactions } = this.game;
    const def = this.pieces[type];
    if (k < 0) return 'Fuera del mapa';
    const i = k % grid.w, j = (k / grid.w) | 0;
    if (!grid.isStaticWalkable(i, j)) return 'No se puede construir ahí';
    if (this.structures.has(k)) return 'Ya hay algo construido';
    const ch = grid.chars[k];
    if (NO_BUILD_CHARS.has(ch)) return 'Zona reservada';
    if (def.onlyOn && ch !== def.onlyOn) return 'Solo en el hueco de una puerta';
    const cx = grid.centerX(i), cz = grid.centerZ(j);
    const dp = Math.hypot(cx - player.position.x, cz - player.position.z);
    if (dp > this.cfg.buildRange) return 'Demasiado lejos';
    for (const it of interactions.items) {
      if (!it.dynamic && grid.walkableCellAt(it.x, it.z) === k) return 'Bloquearía un objeto útil';
    }
    if (def.blocks) {
      const half = grid.cellSize / 2 + 0.05;
      const overlaps = (x, z, r) => Math.abs(x - cx) < half + r && Math.abs(z - cz) < half + r;
      if (overlaps(player.position.x, player.position.z, player.radius)) return 'Estás encima';
      for (const z of zombies.active) {
        if (z.state === 0 && overlaps(z.pos.x, z.pos.z, z.radius)) return 'Hay un zombi en medio';
      }
    }
    if (this.game.run.points < this.costOf(type)) return `Necesitas ${this.costOf(type)} puntos`;
    return null;
  }

  /** Orientación de una puerta: 'x' si los muros están a izquierda y derecha (hoja a lo largo de X). */
  doorAxis(i, j) {
    const g = this.game.grid;
    const wallX = !g.isStaticWalkable(i - 1, j) || !g.isStaticWalkable(i + 1, j) || g.chars[g.index(i - 1, j)] === 'D' || g.chars[g.index(i + 1, j)] === 'D';
    const wallZ = !g.isStaticWalkable(i, j - 1) || !g.isStaticWalkable(i, j + 1);
    if (wallX && !wallZ) return 'x';
    if (wallZ && !wallX) return 'z';
    return g.chars[g.index(i - 1, j)] === 'D' || g.chars[g.index(i + 1, j)] === 'D' ? 'x' : 'z';
  }

  /** Caja de colisión de una pieza en su celda. */
  boxFor(s) {
    const g = this.game.grid;
    if (s.type === 'puerta') {
      const [x0, z0, x1, z1] = g.cellBox(s.i, s.j);
      const half = this.pieces.puerta.thickness / 2;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      return s.axis === 'x' ? [x0, cz - half, x1, cz + half] : [cx - half, z0, cx + half, z1];
    }
    return g.cellBox(s.i, s.j, 0.02);
  }

  applyGrid(s) {
    const g = this.game.grid;
    const blocks = s.def.blocks && !s.open;
    g.setDynamic(s.k, blocks, s.def.blocksShot && !s.open, this.boxFor(s));
    g.extraCost[s.k] = blocks ? s.hp * this.cfg.flowCostPerHp : 0;
  }

  // ------------------------------------------------------------------ acciones
  place(type, k) {
    if (this.canPlace(type, k)) return false;
    const { grid, run } = this.game;
    const def = this.pieces[type];
    const cost = this.costOf(type);
    run.points -= cost;
    const i = k % grid.w, j = (k / grid.w) | 0;
    const hp = def.levels[0].hp;
    const s = {
      id: this.nextId++, type, def, k, i, j, level: 0, hp, maxHp: hp, invested: cost,
      flash: 0, open: false, axis: type === 'puerta' ? this.doorAxis(i, j) : 'x',
      rearm: 0, fuse: -1, uses: hp, // trampas: uses = hp
    };
    this.structures.set(k, s);
    this.applyGrid(s);
    if (type === 'puerta') this.registerDoor(s);
    this.game.floating?.spawn(`-${cost}`, grid.centerX(i), 1.6, grid.centerZ(j), 'neg');
    this.game.bus.emit('build:placed', { type, k });
    this.changed();
    return true;
  }

  upgradeCost(s) {
    return s.level + 1 < s.def.levels.length ? this.costOf(s.type, s.level + 1) : 0;
  }

  upgrade(s) {
    const cost = this.upgradeCost(s);
    if (!cost || this.game.run.points < cost) return false;
    this.game.run.points -= cost;
    s.level++;
    s.maxHp = s.def.levels[s.level].hp;
    s.hp = s.maxHp;
    s.uses = s.maxHp;
    s.invested += cost;
    this.applyGrid(s);
    this.game.floating?.spawn(`-${cost}`, this.game.grid.centerX(s.i), 1.6, this.game.grid.centerZ(s.j), 'neg');
    this.changed();
    return true;
  }

  repairCostOf(s) {
    return repairCost(this.cfg, s.def, s);
  }

  repair(s) {
    const cost = this.repairCostOf(s);
    if (!cost || this.game.run.points < cost) return false;
    this.game.run.points -= cost;
    s.hp = s.maxHp;
    s.uses = s.maxHp;
    s.invested += cost;
    this.applyGrid(s);
    this.game.floating?.spawn(`-${cost}`, this.game.grid.centerX(s.i), 1.6, this.game.grid.centerZ(s.j), 'neg');
    this.changed();
    return true;
  }

  sellValue(s) {
    return Math.floor(s.invested * this.cfg.sellRefund * (s.hp / s.maxHp));
  }

  sell(s) {
    const v = this.sellValue(s);
    this.game.run.points += v;
    this.game.floating?.spawn(`+${v}`, this.game.grid.centerX(s.i), 1.6, this.game.grid.centerZ(s.j), 'pts');
    this.remove(s);
  }

  remove(s) {
    this.game.grid.clearDynamic(s.k);
    this.structures.delete(s.k);
    if (s.type === 'puerta') this.game.interactions.removeItem(`puerta_${s.k}`);
    this.changed();
  }

  /** Daño de un zombi a la pieza de la celda k. */
  damageCell(k, amount) {
    const s = this.structures.get(k);
    if (!s || s.hp <= 0) return;
    s.hp -= amount;
    s.flash = 0.12;
    const g = this.game.grid;
    const x = g.centerX(s.i), z = g.centerZ(s.j);
    const debris = s.level === 0 && s.type === 'barricada' ? 0x8a5a32 : s.type === 'sacos' ? 0xc9b48a : 0x9a9a9a;
    this.game.effects.burst(x, 0.9, z, 4, debris, { speed: 2, up: 2.5, size: 0.07, life: 0.7 });
    if (s.hp <= 0) {
      this.game.effects.burst(x, 0.7, z, 22, debris, { speed: 3.5, up: 4, size: 0.12, life: 1.5 });
      this.game.effects.shake(0.12);
      this.game.bus.emit('build:destroyed', { type: s.type, k });
      this.remove(s);
      return;
    }
    // El coste en el flow field baja con la vida: la horda insiste en lo que ya está roto.
    if (s.def.blocks && !s.open) g.extraCost[k] = s.hp * this.cfg.flowCostPerHp;
  }

  // ------------------------------------------------------------------ puertas
  registerDoor(s) {
    const g = this.game.grid;
    this.game.interactions.addItem({
      id: `puerta_${s.k}`, type: 'puerta_reforzada', x: g.centerX(s.i), z: g.centerZ(s.j), cell: s.k, dynamic: true,
    });
  }

  doorBlocked(s) {
    const [x0, z0, x1, z1] = this.boxFor(s);
    const { player, zombies } = this.game;
    const hit = (x, z, r) => x + r > x0 && x - r < x1 && z + r > z0 && z - r < z1;
    if (hit(player.position.x, player.position.z, player.radius)) return true;
    for (const z of zombies.active) if (z.state === 0 && hit(z.pos.x, z.pos.z, z.radius)) return true;
    return false;
  }

  toggleDoor(k) {
    const s = this.structures.get(k);
    if (!s) return null;
    if (!s.open) {
      s.open = true;
    } else {
      if (this.doorBlocked(s)) return '🚪 Algo impide cerrar la puerta';
      s.open = false;
    }
    this.applyGrid(s);
    this.changed();
    return null;
  }

  // ------------------------------------------------------------------ trampas
  updateTraps(dt) {
    const { grid, zombies, effects } = this.game;
    for (const s of this.structures.values()) {
      if (s.rearm > 0) s.rearm -= dt;
      s.flash = Math.max(0, s.flash - dt);
      if (s.fuse > 0) {
        s.fuse -= dt;
        if (s.fuse <= 0) this.explodeMine(s);
      }
    }
    for (const z of zombies.active) {
      if (z.state !== 0) continue;
      const k = grid.cellX(z.pos.x) + grid.cellZ(z.pos.z) * grid.w;
      const s = this.structures.get(k);
      if (!s || s.def.kind !== 'trampa') continue;
      if (s.type === 'pinchos') {
        zombies.damage(z, this.levelStat(s.def, s.level, 'dps') * dt);
        z.slowMul = s.def.slow;
        s.hp -= s.def.wearPerZombieSecond * dt;
        if (Math.random() < dt * 6) effects.burst(z.pos.x, 0.3, z.pos.z, 1, 0x4a1d1d, { speed: 1, up: 1.5, size: 0.06, life: 0.5 });
        if (s.hp <= 0) { this.game.hud.toast('📌 Unos pinchos se han roto'); this.remove(s); }
      } else if (s.type === 'cepo') {
        if (s.rearm > 0 || z.stunTimer > 0) continue;
        z.stunTimer = this.levelStat(s.def, s.level, 'holdTime');
        z.pos.x = grid.centerX(s.i); z.pos.z = grid.centerZ(s.j);
        zombies.damage(z, s.def.damage);
        effects.burst(z.pos.x, 0.3, z.pos.z, 8, 0x4a1d1d, { speed: 2, up: 2, size: 0.07, life: 0.8 });
        s.rearm = s.def.holdTime + s.def.rearmTime;
        s.flash = 0.2;
        s.hp -= 1;
        if (s.hp <= 0) this.remove(s);
      } else if (s.type === 'mina' && s.fuse < 0) {
        s.fuse = s.def.fuse;
        s.flash = s.def.fuse;
      }
    }
  }

  explodeMine(s) {
    const { grid, zombies, effects, player } = this.game;
    const x = grid.centerX(s.i), z = grid.centerZ(s.j);
    const R = s.def.radius;
    for (const zb of zombies.active) {
      if (zb.state !== 0) continue;
      const d = Math.hypot(zb.pos.x - x, zb.pos.z - z);
      if (d > R) continue;
      const k = 1 - d / R * 0.6;
      const dx = (zb.pos.x - x) / (d || 1), dz = (zb.pos.z - z) / (d || 1);
      zombies.damage(zb, s.def.damage * k, dx, dz, 0.8 * k);
    }
    const dp = Math.hypot(player.position.x - x, player.position.z - z);
    if (dp < R) player.damage(s.def.damage * s.def.playerDamageMul * (1 - dp / R * 0.6));
    effects.burst(x, 0.4, z, 40, 0xff9a2a, { speed: 6, up: 6, size: 0.1, life: 0.7 });
    effects.burst(x, 0.4, z, 25, 0x2a2a2a, { speed: 3, up: 5, size: 0.16, life: 1.6 });
    effects.muzzleFlash({ x, y: 1.2, z });
    effects.shake(0.45);
    this.game.bus.emit('explosion', { x, z, radius: R });
    this.remove(s);
  }

  // ------------------------------------------------------------------ modo construcción
  setActive(on) {
    this.active = on;
    this.dragging = false;
    this.game.bus.emit('build:mode', { active: on });
  }

  /** Acción principal sobre la celda señalada: colocar, o reparar/mejorar lo que haya. */
  primaryAction(k) {
    const s = this.structures.get(k);
    if (s) {
      if (s.hp < s.maxHp) return this.repair(s) ? 'repair' : null;
      return this.upgrade(s) ? 'upgrade' : null;
    }
    return this.place(this.selected, k) ? 'place' : null;
  }

  update(dt) {
    const { game } = this;
    const { input, player } = game;
    const t = this.transformer;
    if (t) {
      t.flash = Math.max(0, t.flash - dt);
      game.power.generator = t.hp > 0;
      // Chispas si está dañado.
      if (t.hp > 0 && t.hp < t.maxHp * 0.5 && Math.random() < dt * 3) {
        game.effects.burst(t.x, 1.3, t.z, 2, 0xffe08a, { speed: 1.5, up: 2.5, size: 0.04, life: 0.4 });
      }
    }
    this.updateTraps(dt);

    if (input.consume('build') && player.alive) this.setActive(!this.active);
    if (!player.alive && this.active) this.setActive(false);
    if (!this.active) return;

    for (let n = 0; n < PIECE_ORDER.length; n++) {
      if (input.consume(`weapon${n + 1}`)) this.selected = PIECE_ORDER[n];
    }

    // Celda bajo el cursor.
    const g = game.grid;
    const gp = game.groundPoint;
    const i = g.cellX(gp.x), j = g.cellZ(gp.z);
    this.hoverCell = g.inBounds(i, j) ? g.index(i, j) : -1;
    const hovered = this.structures.get(this.hoverCell);
    this.hoverReason = hovered ? null : this.canPlace(this.selected, this.hoverCell);

    if (input.consume('alt')) {
      if (hovered) this.sell(hovered);
      else this.setActive(false);
      return;
    }
    if (input.consume('fire')) {
      const action = this.primaryAction(this.hoverCell);
      // Arrastrar solo para colocar piezas que bloquean (filas de muro o sacos).
      this.dragging = action === 'place' && this.pieces[this.selected].blocks && this.selected !== 'puerta';
      this.lastDragCell = this.hoverCell;
    } else if (this.dragging) {
      if (!input.isHeld('fire')) this.dragging = false;
      else if (this.hoverCell !== this.lastDragCell) {
        this.lastDragCell = this.hoverCell;
        if (!this.structures.has(this.hoverCell)) this.place(this.selected, this.hoverCell);
      }
    }
  }
}
