import buildData from '../data/build.json';
import { PHASE } from './DayNight.js';
import { explode } from './Explosions.js';

export const PIECE_ORDER = ['barricada', 'sacos', 'puerta', 'pinchos', 'cepo', 'mina'];
const NO_BUILD_CHARS = new Set(['S', 'A', 'M', 'W']);
const MAX_DOOR_WIDTH = 6;

/** Coste de reparar una pieza (función pura): proporcional al daño y al coste del nivel actual. */
export function repairCost(cfg, def, s, mul = 1) {
  if (s.hp >= s.maxHp) return 0;
  return Math.max(1, Math.ceil(((s.maxHp - s.hp) / s.maxHp) * def.levels[s.level].cost * cfg.repairCostFactor * mul));
}

// Construcción del jugador: barricadas, sacos, puertas y trampas, y el transformador de la
// comisaría. Casi todas las piezas ocupan 1 celda; la puerta reforzada cubre el hueco entero
// de la puerta del mapa (varias celdas 'D' seguidas), con coste y vida por celda.
// Las piezas que bloquean se marcan en la capa dinámica de NavGrid (colisión, balas, coste en
// el flow field) y los zombis las golpean al toparse con ellas.
export class BuildSystem {
  constructor(game) {
    this.game = game;
    this.cfg = buildData;
    this.pieces = buildData.pieces;
    this.structures = new Map(); // celda → estructura (una pieza de varias celdas aparece en todas)
    this.all = new Set();        // estructuras únicas
    this.active = false;         // modo construcción
    this.selected = PIECE_ORDER[0];
    this.hoverCell = -1;
    this.hoverCells = [];        // huella de la pieza seleccionada bajo el cursor
    this.hoverReason = null;
    this.dragging = false;
    this.lastDragCell = -1;
    this.version = 0;            // sube en cada cambio (para el render)
    this.nextId = 1;
    this.sellArmed = -1;         // id de la pieza con la venta "armada"
    this.sellArmedUntil = 0;
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
      alertAt: -Infinity,
    };
  }

  damageTransformer(amount) {
    const t = this.transformer;
    if (!t || t.hp <= 0) return;
    t.hp = Math.max(0, t.hp - amount);
    t.flash = 0.12;
    const tc = this.cfg.transformer;
    if (t.hp > 0 && this.game.time - t.alertAt > tc.alertCooldown) {
      t.alertAt = this.game.time;
      this.game.hud.toast('⚡ ¡Están atacando el transformador! (patio norte)', 4);
    }
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
    return Math.max(1, Math.ceil((t.maxHp - t.hp) * this.cfg.transformer.repairCostPerHp * this.surcharge));
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
    for (const s of this.all) {
      for (const k of s.cells) grid.clearDynamic(k);
      if (s.type === 'puerta') this.game.interactions?.removeItem(`puerta_${s.id}`);
    }
    this.structures.clear();
    this.all.clear();
    this.active = false;
    this.dragging = false;
    if (this.transformer) { this.transformer.hp = this.transformer.maxHp; this.transformer.flash = 0; this.transformer.alertAt = -Infinity; }
    this.sellArmed = -1;
    this.changed(true);
  }

  /** @param {boolean} paths la rejilla de paso ha cambiado (piezas que bloquean): recalcular rutas */
  changed(paths) {
    this.version++;
    if (paths && this.game.zombies) this.game.zombies.flowDirty = true;
  }

  get isNight() {
    return this.game.dayNight.phase === PHASE.NIGHT;
  }

  get surcharge() {
    return this.isNight ? this.cfg.nightSurcharge : 1;
  }

  /** Coste por celda (con recargo nocturno). */
  costOf(type, level = 0) {
    return Math.ceil(this.pieces[type].levels[level].cost * this.surcharge);
  }

  /** Coste total de colocar `type` en la celda k (la puerta cubre todo el hueco). */
  placeCost(type, k) {
    return this.costOf(type) * Math.max(1, this.footprint(type, k).length);
  }

  /** ¿Está el punto (x, z) al alcance del jugador para construir, reparar o vender? */
  inReachXY(x, z) {
    const p = this.game.player.position;
    return Math.hypot(x - p.x, z - p.z) <= this.cfg.buildRange;
  }

  inReach(k) {
    const g = this.game.grid;
    return this.inReachXY(g.centerX(k % g.w), g.centerZ((k / g.w) | 0));
  }

  countOf(type) {
    let n = 0;
    for (const s of this.all) if (s.type === type) n++;
    return n;
  }

  levelStat(def, level, key) {
    return def.levels[level][key] ?? def[key];
  }

  // ------------------------------------------------------------------ huecos de puerta
  /** Orientación de una puerta: 'x' si el hueco corre a lo largo de X (muros a izquierda y derecha). */
  doorAxis(i, j) {
    const g = this.game.grid;
    const isD = (a, b) => g.inBounds(a, b) && g.chars[g.index(a, b)] === 'D';
    if (isD(i - 1, j) || isD(i + 1, j)) return 'x';
    if (isD(i, j - 1) || isD(i, j + 1)) return 'z';
    const wallX = !g.isStaticWalkable(i - 1, j) || !g.isStaticWalkable(i + 1, j);
    const wallZ = !g.isStaticWalkable(i, j - 1) || !g.isStaticWalkable(i, j + 1);
    if (wallX && !wallZ) return 'x';
    return 'z';
  }

  /** Celdas 'D' seguidas que forman el hueco de la puerta que contiene k (ordenadas). */
  doorGroup(k) {
    const g = this.game.grid;
    const i = k % g.w, j = (k / g.w) | 0;
    if (g.chars[k] !== 'D') return [k];
    const [di, dj] = this.doorAxis(i, j) === 'x' ? [1, 0] : [0, 1];
    const isD = (a, b) => g.inBounds(a, b) && g.chars[g.index(a, b)] === 'D';
    let a = 0, b = 0;
    while (a < MAX_DOOR_WIDTH && isD(i - (a + 1) * di, j - (a + 1) * dj)) a++;
    while (a + b + 1 < MAX_DOOR_WIDTH && isD(i + (b + 1) * di, j + (b + 1) * dj)) b++;
    const cells = [];
    for (let n = -a; n <= b; n++) cells.push(g.index(i + n * di, j + n * dj));
    return cells;
  }

  /** Celdas que ocuparía `type` colocado en k. */
  footprint(type, k) {
    if (k < 0) return [];
    if (type === 'puerta' && this.game.grid.chars[k] === 'D') return this.doorGroup(k);
    return [k];
  }

  // ------------------------------------------------------------------ reglas de colocación
  /** @returns {string|null} motivo por el que no se puede construir, o null si se puede */
  canPlace(type, k) {
    const { grid, player, zombies, interactions } = this.game;
    const def = this.pieces[type];
    if (k < 0) return 'Fuera del mapa';
    if (this.game.shop && !this.game.shop.isUnlocked(type, 0)) return 'Desbloquéalo en el almacén';
    if (def.onlyOn && grid.chars[k] !== def.onlyOn) return 'Solo en el hueco de una puerta';
    const cells = this.footprint(type, k);
    let sx = 0, sz = 0;
    for (const c of cells) {
      const i = c % grid.w, j = (c / grid.w) | 0;
      if (!grid.isStaticWalkable(i, j)) return 'No se puede construir ahí';
      if (this.structures.has(c)) return cells.length > 1 ? 'El hueco ya está ocupado' : 'Ya hay algo construido';
      if (NO_BUILD_CHARS.has(grid.chars[c])) return 'Zona reservada';
      sx += grid.centerX(i); sz += grid.centerZ(j);
    }
    if (!this.inReachXY(sx / cells.length, sz / cells.length)) return 'Demasiado lejos';
    if (this.countOf(type) >= this.cfg.maxPerType) return 'Límite de piezas de este tipo';
    for (const it of interactions.items) {
      if (!it.dynamic && cells.includes(grid.walkableCellAt(it.x, it.z))) return 'Bloquearía un objeto útil';
    }
    if (def.blocks) {
      const half = grid.cellSize / 2 + this.cfg.placeMargin;
      for (const c of cells) {
        const cx = grid.centerX(c % grid.w), cz = grid.centerZ((c / grid.w) | 0);
        const overlaps = (x, z, r) => Math.abs(x - cx) < half + r && Math.abs(z - cz) < half + r;
        if (overlaps(player.position.x, player.position.z, player.radius)) return 'Estás encima';
        for (const z of zombies.active) {
          if (z.state === 0 && overlaps(z.pos.x, z.pos.z, z.radius)) return 'Hay un zombi en medio';
        }
      }
    }
    const cost = this.costOf(type) * cells.length;
    if (this.game.run.points < cost) return `Necesitas ${cost} puntos`;
    return null;
  }

  /** Caja de colisión de la pieza s en su celda k. */
  boxFor(s, k) {
    const g = this.game.grid;
    const i = k % g.w, j = (k / g.w) | 0;
    if (s.type === 'puerta') {
      const [x0, z0, x1, z1] = g.cellBox(i, j);
      const half = this.pieces.puerta.thickness / 2;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      return s.axis === 'x' ? [x0, cz - half, x1, cz + half] : [cx - half, z0, cx + half, z1];
    }
    return g.cellBox(i, j, 0);
  }

  applyGrid(s) {
    const g = this.game.grid;
    const blocks = s.def.blocks && !s.open;
    // Cruzar cualquier celda de la pieza obliga a romperla entera: el coste usa la vida total.
    const cost = blocks ? s.hp * this.cfg.flowCostPerHp : 0;
    for (const k of s.cells) {
      g.setDynamic(k, blocks, s.def.blocksShot && !s.open, this.boxFor(s, k));
      g.extraCost[k] = cost;
    }
  }

  // ------------------------------------------------------------------ acciones
  place(type, k) {
    if (this.canPlace(type, k)) return false;
    const { grid, run } = this.game;
    const def = this.pieces[type];
    const cells = this.footprint(type, k);
    const n = cells.length;
    const cost = this.costOf(type) * n;
    run.points -= cost;
    const i = cells[0] % grid.w, j = (cells[0] / grid.w) | 0;
    let cx = 0, cz = 0;
    for (const c of cells) { cx += grid.centerX(c % grid.w); cz += grid.centerZ((c / grid.w) | 0); }
    const hp = def.levels[0].hp * n;
    const s = {
      id: this.nextId++, type, def, cells, n, k: cells[0], i, j, cx: cx / n, cz: cz / n,
      level: 0, hp, maxHp: hp, invested: cost,
      flash: 0, open: false, axis: type === 'puerta' ? this.doorAxis(i, j) : 'x',
      rearm: 0, fuse: -1, repairReady: 0,
    };
    for (const c of cells) this.structures.set(c, s);
    this.all.add(s);
    this.applyGrid(s);
    if (type === 'puerta') this.registerDoor(s);
    this.game.floating?.spawn(`-${cost}`, s.cx, 1.6, s.cz, 'neg');
    this.game.bus.emit('build:placed', { type, k });
    this.changed(def.blocks);
    return true;
  }

  upgradeCost(s) {
    return s.level + 1 < s.def.levels.length ? this.costOf(s.type, s.level + 1) * s.n : 0;
  }

  /** ¿Está desbloqueado (en el almacén) el siguiente nivel de la pieza? */
  upgradeUnlocked(s) {
    return !this.game.shop || this.game.shop.isUnlocked(s.type, s.level + 1);
  }

  upgrade(s) {
    const cost = this.upgradeCost(s);
    // Las piezas dañadas se reparan antes de mejorar (si no, mejorar curaría gratis).
    if (!cost || s.hp < s.maxHp || !this.upgradeUnlocked(s) || this.game.run.points < cost) return false;
    this.game.run.points -= cost;
    s.level++;
    s.maxHp = s.def.levels[s.level].hp * s.n;
    s.hp = s.maxHp;
    s.invested += cost;
    this.applyGrid(s);
    this.game.floating?.spawn(`-${cost}`, s.cx, 1.6, s.cz, 'neg');
    this.changed(s.def.blocks);
    return true;
  }

  repairCostOf(s) {
    return repairCost(this.cfg, s.def, s, this.surcharge * s.n);
  }

  repair(s) {
    const cost = this.repairCostOf(s);
    if (!cost || this.game.run.points < cost || this.game.time < s.repairReady) return false;
    this.game.run.points -= cost;
    s.hp = s.maxHp;
    s.repairReady = this.game.time + this.cfg.repairCooldown;
    // La reparación no cuenta como inversión: vender devuelve sobre lo construido/mejorado.
    this.applyGrid(s);
    this.game.floating?.spawn(`-${cost}`, s.cx, 1.6, s.cz, 'neg');
    this.changed(false);
    return true;
  }

  sellValue(s) {
    return Math.floor(s.invested * this.cfg.sellRefund * (s.hp / s.maxHp));
  }

  sell(s) {
    const v = this.sellValue(s);
    this.game.run.points += v;
    this.game.floating?.spawn(`+${v}`, s.cx, 1.6, s.cz, 'pts');
    this.remove(s);
  }

  remove(s) {
    for (const k of s.cells) {
      this.game.grid.clearDynamic(k);
      this.structures.delete(k);
    }
    this.all.delete(s);
    if (s.type === 'puerta') this.game.interactions.removeItem(`puerta_${s.id}`);
    if (this.sellArmed === s.id) this.sellArmed = -1;
    this.changed(s.def.blocks);
  }

  /** Daño de un zombi a la pieza que ocupa la celda k. */
  damageCell(k, amount) {
    const s = this.structures.get(k);
    // Una puerta abierta no se interpone: los zombis la ignoran y no le hacen daño
    // (aunque alguno estuviera a mitad de golpe cuando se abrió).
    if (!s || s.hp <= 0 || s.open) return;
    s.hp -= amount;
    s.flash = 0.12;
    const g = this.game.grid;
    const x = g.centerX(k % g.w), z = g.centerZ((k / g.w) | 0);
    const debris = s.level === 0 && s.type === 'barricada' ? 0x8a5a32 : s.type === 'sacos' ? 0xc9b48a : 0x9a9a9a;
    this.game.effects.burst(x, 0.9, z, 4, debris, { speed: 2, up: 2.5, size: 0.07, life: 0.7 });
    if (s.hp <= 0) {
      for (const c of s.cells) {
        this.game.effects.burst(g.centerX(c % g.w), 0.7, g.centerZ((c / g.w) | 0), 22, debris, { speed: 3.5, up: 4, size: 0.12, life: 1.5 });
      }
      this.game.effects.shake(0.12);
      this.game.bus.emit('build:destroyed', { type: s.type, k });
      this.remove(s);
      return;
    }
    // El coste en el flow field baja con la vida: la horda insiste en lo que ya está roto.
    if (s.def.blocks && !s.open) for (const c of s.cells) g.extraCost[c] = s.hp * this.cfg.flowCostPerHp;
  }

  // ------------------------------------------------------------------ puertas
  registerDoor(s) {
    this.game.interactions.addItem({
      id: `puerta_${s.id}`, type: 'puerta_reforzada', x: s.cx, z: s.cz, cell: s.k, dynamic: true,
    });
  }

  doorBlocked(s) {
    const { player, zombies } = this.game;
    for (const k of s.cells) {
      const [x0, z0, x1, z1] = this.boxFor(s, k);
      const hit = (x, z, r) => x + r > x0 && x - r < x1 && z + r > z0 && z - r < z1;
      if (hit(player.position.x, player.position.z, player.radius)) return true;
      for (const z of zombies.active) if (z.state === 0 && hit(z.pos.x, z.pos.z, z.radius)) return true;
    }
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
    this.changed(true);
    return null;
  }

  // ------------------------------------------------------------------ trampas
  updateTraps(dt) {
    const { grid, zombies, effects } = this.game;
    for (const s of this.all) {
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
        // Daño continuo acumulado y aplicado por ticks (sin destello constante).
        z.trapAcc = (z.trapAcc ?? 0) + this.levelStat(s.def, s.level, 'dps') * dt;
        const tickDmg = this.levelStat(s.def, s.level, 'dps') * this.cfg.trapDamageTick;
        if (z.trapAcc >= tickDmg) { zombies.damage(z, z.trapAcc, 0, 0, 0, true); z.trapAcc = 0; }
        z.slowMul = s.def.slow;
        s.hp -= s.def.wearPerZombieSecond * dt;
        if (Math.random() < dt * 6) effects.burst(z.pos.x, 0.3, z.pos.z, 1, 0x4a1d1d, { speed: 1, up: 1.5, size: 0.06, life: 0.5 });
        if (s.hp <= 0) { this.game.hud.toast('📌 Unos pinchos se han roto'); this.remove(s); }
      } else if (s.type === 'cepo') {
        if (s.rearm > 0 || z.stunTimer > 0) continue;
        z.stunTimer = this.levelStat(s.def, s.level, 'holdTime');
        z.pos.x = s.cx; z.pos.z = s.cz;
        zombies.damage(z, s.def.damage);
        effects.burst(z.pos.x, 0.3, z.pos.z, 8, 0x4a1d1d, { speed: 2, up: 2, size: 0.07, life: 0.8 });
        s.rearm = this.levelStat(s.def, s.level, 'holdTime') + s.def.rearmTime;
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
    explode(this.game, s.cx, s.cz, s.def);
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
      if (!this.inReachXY(s.cx, s.cz)) return null;
      if (s.hp < s.maxHp) return this.repair(s) ? 'repair' : null;
      return this.upgrade(s) ? 'upgrade' : null;
    }
    return this.place(this.selected, k) ? 'place' : null;
  }

  /** Clic derecho: el primero arma la venta, el segundo (en sellConfirmTime s) vende. */
  sellAction(s) {
    if (!this.inReachXY(s.cx, s.cz)) return;
    if (this.sellArmed === s.id && this.game.time < this.sellArmedUntil) {
      this.sellArmed = -1;
      this.sell(s);
    } else {
      this.sellArmed = s.id;
      this.sellArmedUntil = this.game.time + this.cfg.sellConfirmTime;
    }
  }

  update(dt) {
    const { game } = this;
    const { input, player } = game;
    const t = this.transformer;
    if (t) {
      t.flash = Math.max(0, t.flash - dt);
      game.power.generator = t.hp > 0;
      // Chispas si está dañado.
      if (t.hp > 0 && t.hp < t.maxHp * this.cfg.transformer.damagedThreshold && Math.random() < dt * 3) {
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

    // Celda bajo el cursor y huella de la pieza seleccionada.
    const g = game.grid;
    const gp = game.groundPoint;
    const i = g.cellX(gp.x), j = g.cellZ(gp.z);
    this.hoverCell = g.inBounds(i, j) ? g.index(i, j) : -1;
    const hovered = this.structures.get(this.hoverCell);
    this.hoverCells = hovered ? hovered.cells : this.footprint(this.selected, this.hoverCell);
    this.hoverReason = hovered ? null : this.canPlace(this.selected, this.hoverCell);

    if (input.consume('alt')) {
      if (hovered) this.sellAction(hovered);
      else this.setActive(false);
      return;
    }
    if (this.sellArmed >= 0 && (hovered?.id !== this.sellArmed || this.game.time >= this.sellArmedUntil)) this.sellArmed = -1;
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
