import * as THREE from 'three';
import buildData from '../data/build.json';
import zombieData from '../data/zombies.json';
import { PHASE } from './DayNight.js';
import { explode } from './Explosions.js';
import { raycastGrid, rayCircle } from './Physics.js';

/** Páginas de la barra de construcción (Tab cambia de página; 1-9 eligen dentro de ella). */
export const PIECE_PAGES = buildData.pages;
export const PIECE_ORDER = PIECE_PAGES.flatMap((p) => p.pieces);
/** Piezas con lista propia (para recorrerlas sin filtrar todas las construcciones). */
const LISTED = ['generador', 'torreta', 'valla', 'foco', 'barril'];
/** Radio del zombi más grande (para buscar a los que tocan una valla). */
const MAX_ZOMBIE_RADIUS = Math.max(...Object.entries(zombieData).filter(([k]) => !k.startsWith('_')).map(([, d]) => d.radius * d.scale * 1.1));
const SELECT_ACTIONS = Array.from({ length: 9 }, (_, n) => `weapon${n + 1}`);
const NO_BUILD_CHARS = new Set(['S', 'A', 'M', 'W', 'J']);
const MAX_DOOR_WIDTH = 6;

/**
 * Vida máxima de una pieza (función pura): la del nivel por celda, con el refuerzo de muros del
 * despacho (`mul`, no se aplica a las trampas: su vida es desgaste o usos) y la bonificación
 * propia de la pieza (`bonus`, persianas automáticas).
 */
export function pieceMaxHp(def, level, n, mul = 1, bonus = 1) {
  return Math.round(def.levels[level].hp * n * (def.kind === 'trampa' ? 1 : mul) * bonus);
}

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
    this.page = 0;
    this.hpMul = 1;              // refuerzo de muros (despacho del comisario)
    this.lists = {};
    for (const t of LISTED) this.lists[t] = [];
    this.generators = this.lists.generador;
    this.turrets = this.lists.torreta;
    this.fences = this.lists.valla;
    this.lights = this.lists.foco;
    this.barrels = this.lists.barril;
    this._near = new Array(256);
    this._from = new THREE.Vector3();
    this._to = new THREE.Vector3();
    this.shotBlocked = (i, j) => this.game.grid.isShotBlocked(i, j);
    // Solo los muros y objetos del mapa (para las explosiones contra construcciones).
    this.staticShotBlocked = (i, j) => {
      const g = this.game.grid;
      return !g.inBounds(i, j) || g.blocksShot[g.index(i, j)] === 1;
    };
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
      this.game.hud.toast(`⚡ ¡Están atacando el transformador! (patio norte)${this.game.humor?.tag('transformerHit') ?? ''}`, 5);
    }
    this.game.effects.burst(t.x, 1.0, t.z, 5, 0xffd24a, { speed: 2.5, up: 3, size: 0.05, life: 0.5 });
    if (t.hp <= 0) {
      this.game.effects.burst(t.x, 1.2, t.z, 30, 0x2b2b2b, { speed: 3, up: 4, size: 0.12, life: 1.6 });
      this.game.effects.shake(0.2);
      this.game.hud.toast(`⚠ ¡Han destruido el transformador! Sin corriente: repáralo en el patio.${this.game.humor?.tag('transformerDown') ?? ''}`, 7);
      this.game.bus.emit('transformer:destroyed');
    }
  }

  // ------------------------------------------------------------------ vándalos y corriente
  /** ¿Queda algo eléctrico que los vándalos puedan romper? */
  vandalTargetsAlive() {
    return (this.transformer?.hp > 0) || this.generators.length > 0;
  }

  /** Celdas objetivo de los vándalos: el transformador y las celdas junto a cada generador. */
  vandalTargetCells(out) {
    out.length = 0;
    const g = this.game.grid;
    if (this.transformer?.hp > 0 && this.transformer.cell >= 0) out.push(this.transformer.cell);
    for (const s of this.generators) {
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if ((di || dj) && g.isStaticWalkable(s.i + di, s.j + dj)) out.push(g.index(s.i + di, s.j + dj));
      }
    }
    return out;
  }

  /** Las vallas electrificadas funcionan si hay algún generador en pie. */
  get powered() {
    return this.generators.length > 0 || !!this.game.despacho?.emergencyOn;
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
      this.game.interactions?.removeItem(`puerta_${s.id}`);
      this.game.interactions?.removeItem(`torreta_${s.id}`);
    }
    this.structures.clear();
    this.all.clear();
    for (const t of LISTED) this.lists[t].length = 0;
    this.active = false;
    this.dragging = false;
    if (this.transformer) { this.transformer.hp = this.transformer.maxHp; this.transformer.flash = 0; this.transformer.alertAt = -Infinity; }
    this.sellArmed = -1;
    this.freeBarricades = 0;
    this.hpMul = 1;
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
  /**
   * Coste por celda (con recargo nocturno). Algunas piezas (torretas) se encarecen por cada una
   * que ya tengas: `others` = cuántas hay ya, sin contar la que se mejora.
   */
  costOf(type, level = 0, others = this.countFast(type)) {
    // Mejora permanente: las primeras barricadas de madera de la partida son gratis.
    if (type === 'barricada' && level === 0 && this.freeBarricades > 0) return 0;
    const def = this.pieces[type];
    const step = 1 + (def.costStep ?? 0) * others;
    return Math.ceil(def.levels[level].cost * step * this.surcharge);
  }

  /** Número de piezas de un tipo (O(1) para las que tienen lista propia). */
  countFast(type) {
    return this.lists[type]?.length ?? this.countOf(type);
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
      if (NO_BUILD_CHARS.has(grid.chars[c]) || this.game.despacho?.isReserved(c)) return 'Zona reservada';
      sx += grid.centerX(i); sz += grid.centerZ(j);
    }
    if (!this.inReachXY(sx / cells.length, sz / cells.length)) return 'Demasiado lejos';
    const max = def.maxCount ?? this.cfg.maxPerType;
    if (this.countOf(type) >= max) return `Máximo ${max} de este tipo`;
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
    return g.cellBox(i, j, s.def.inset ?? 0);
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
    const { run } = this.game;
    const def = this.pieces[type];
    const cells = this.footprint(type, k);
    const n = cells.length;
    const cost = this.costOf(type) * n;
    run.points -= cost;
    const s = this.createStructure(type, cells, 0, cost);
    if (type === 'barricada' && this.freeBarricades > 0) this.freeBarricades = Math.max(0, this.freeBarricades - n);
    if (type === 'generador' && this.generators.length === 1 && this.fences.length) this.game.hud?.toast('⚡ Vallas electrificadas en marcha', 3);
    this.game.floating?.spawn(`-${cost}`, s.cx, 1.6, s.cz, 'neg');
    this.game.bus.emit('build:placed', { type, k });
    this.changed(def.blocks);
    return true;
  }

  /** Monta una pieza en `cells` (sin cobrar ni comprobar nada) y la registra. */
  createStructure(type, cells, level, invested, extra) {
    const { grid } = this.game;
    const def = this.pieces[type];
    const n = cells.length;
    const i = cells[0] % grid.w, j = (cells[0] / grid.w) | 0;
    let cx = 0, cz = 0;
    for (const c of cells) { cx += grid.centerX(c % grid.w); cz += grid.centerZ((c / grid.w) | 0); }
    const s = {
      id: this.nextId++, type, def, cells, n, k: cells[0], i, j, cx: cx / n, cz: cz / n,
      level, hp: 0, maxHp: 0, invested,
      flash: 0, open: false, axis: type === 'puerta' ? this.doorAxis(i, j) : 'x',
      rearm: 0, fuse: -1, repairReady: 0, zap: 0, ...extra,
    };
    s.hp = s.maxHp = this.maxHpOf(s);
    for (const c of cells) this.structures.set(c, s);
    this.all.add(s);
    this.lists[type]?.push(s);
    this.applyGrid(s);
    if (type === 'puerta') this.registerDoor(s);
    if (type === 'torreta') this.initTurret(s);
    return s;
  }

  /**
   * Pieza automática (persianas del despacho): gratis, no se vende ni se mejora y no cuenta como
   * construida por el jugador (no emite 'build:placed'). `hpBonus` multiplica su vida.
   */
  placeAuto(type, cells, level, hpBonus = 1) {
    if (!cells.length || cells.some((c) => this.structures.has(c))) return null;
    const s = this.createStructure(type, cells, level, 0, { auto: true, hpBonus });
    this.changed(s.def.blocks);
    return s;
  }

  /** Vida máxima de la pieza; el refuerzo de muros no afecta a las automáticas (tienen el suyo). */
  maxHpOf(s) {
    return pieceMaxHp(s.def, s.level, s.n, s.auto ? 1 : this.hpMul, s.hpBonus ?? 1);
  }

  /**
   * Cambia el refuerzo de muros y reajusta la vida de lo ya construido (y de las piezas
   * automáticas si cambia su bonificación): conserva la proporción de vida de cada pieza.
   */
  setHpMul(mul) {
    this.hpMul = mul;
    this.refreshMaxHp();
  }

  refreshMaxHp() {
    let any = false;
    for (const s of this.all) {
      const m = this.maxHpOf(s);
      if (m === s.maxHp) continue;
      s.hp = s.maxHp > 0 ? Math.max(Math.min(s.hp, 1), Math.round((s.hp * m) / s.maxHp)) : m;
      s.maxHp = m;
      this.applyGrid(s);
      any = true;
    }
    if (any) this.changed(true);
  }

  upgradeCost(s) {
    if (s.auto) return 0;
    return s.level + 1 < s.def.levels.length ? this.costOf(s.type, s.level + 1, this.countFast(s.type) - 1) * s.n : 0;
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
    s.maxHp = this.maxHpOf(s);
    s.hp = s.maxHp;
    s.invested += cost;
    if (s.type === 'torreta') {
      // La mejora amplía el cargador, pero no rellena gratis lo gastado.
      const oldMax = s.ammoMax;
      s.ammoMax = this.levelStat(s.def, s.level, 'ammo');
      s.ammo += s.ammoMax - oldMax;
    }
    this.applyGrid(s);
    this.game.floating?.spawn(`-${cost}`, s.cx, 1.6, s.cz, 'neg');
    this.game.bus.emit('build:upgraded', { s });
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
    this.game.bus.emit('build:repaired', { s });
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
    this.game.bus.emit('build:sold', { s });
    this.remove(s);
  }

  remove(s) {
    for (const k of s.cells) {
      this.game.grid.clearDynamic(k);
      this.structures.delete(k);
    }
    this.all.delete(s);
    const list = this.lists[s.type];
    const idx = list ? list.indexOf(s) : -1;
    if (idx >= 0) list.splice(idx, 1);
    if (s.type === 'puerta') this.game.interactions.removeItem(`puerta_${s.id}`);
    if (s.type === 'torreta') this.game.interactions.removeItem(`torreta_${s.id}`);
    if (s.type === 'generador' && !this.generators.length && this.fences.length) {
      this.game.hud?.toast('⚡ Sin generadores: las vallas ya no dan corriente', 4);
    }
    if (this.sellArmed === s.id) this.sellArmed = -1;
    this.changed(s.def.blocks);
  }

  /**
   * Daño a la pieza que ocupa la celda k (golpes de zombis, ácido, explosiones).
   * @param {boolean} [quiet] daño continuo: sin cascotes en cada golpe
   */
  damageCell(k, amount, quiet = false) {
    const s = this.structures.get(k);
    // Una puerta abierta no se interpone: los zombis la ignoran y no le hacen daño
    // (aunque alguno estuviera a mitad de golpe cuando se abrió).
    if (!s || s.hp <= 0 || s.open) return;
    s.hp -= amount;
    s.flash = 0.12;
    // Un barril golpeado hasta romperse estalla.
    if (s.type === 'barril') {
      if (s.hp <= 0) this.detonateBarrel(s, s.def.hitDelay);
      return;
    }
    const g = this.game.grid;
    const x = g.centerX(k % g.w), z = g.centerZ((k / g.w) | 0);
    // Los escombros por material los pinta Effects al oír 'structure:hit' y 'build:destroyed'.
    if (!quiet) this.game.bus.emit('structure:hit', { s, x, z });
    if (s.hp <= 0) {
      if (s.type === 'generador') this.game.hud?.toast(`🔋 ¡Han destruido un generador!${this.game.humor?.tag('generatorDown') ?? ''}`, 5);
      if (s.type === 'torreta') this.game.hud?.toast('🎯 ¡Han destruido una torreta!', 4);
      this.game.effects.shake(0.12);
      this.game.bus.emit('build:destroyed', { type: s.type, k });
      this.remove(s);
      return;
    }
    // El coste en el flow field baja con la vida: la horda insiste en lo que ya está roto.
    if (s.def.blocks && !s.open) for (const c of s.cells) g.extraCost[c] = s.hp * this.cfg.flowCostPerHp;
  }

  // ------------------------------------------------------------------ barriles y explosiones
  /** Retira el barril y programa su explosión (las cadenas se ven en cascada). */
  detonateBarrel(s, delay) {
    if (!this.all.has(s)) return;
    this.remove(s);
    this.game.blasts.schedule(s.cx, s.cz, s.def, delay);
  }

  /** Primer barril que corta el rayo antes de maxT, o null. */
  barrelRaycast(ox, oz, dx, dz, maxT) {
    let best = null, bestT = maxT;
    for (const s of this.barrels) {
      const t = rayCircle(ox, oz, dx, dz, s.cx, s.cz, this.game.grid.cellSize / 2 - s.def.inset);
      if (t >= 0 && t < bestT) { bestT = t; best = s; }
    }
    return best ? { s: best, t: bestT } : null;
  }

  /**
   * Onda expansiva sobre las construcciones: los barriles del radio estallan en cadena y, si
   * `damage` > 0 (zombis explosivos), daña lo construido y el transformador. Solo protegen
   * los muros del mapa.
   */
  blast(x, z, R, damage, falloff) {
    const g = this.game.grid;
    const reach = (px, pz) => {
      const d = Math.hypot(px - x, pz - z);
      if (d > R) return -1;
      if (d > 1e-3 && raycastGrid(g, x, z, (px - x) / d, (pz - z) / d, d, this.staticShotBlocked) < d) return -1;
      return 1 - (d / R) * falloff;
    };
    for (let n = this.barrels.length - 1; n >= 0; n--) {
      const s = this.barrels[n];
      if (reach(s.cx, s.cz) >= 0) this.detonateBarrel(s, s.def.chainDelay);
    }
    if (damage <= 0) return;
    for (const s of [...this.all]) {
      if (s.def.kind === 'trampa' || !this.all.has(s)) continue;
      let k = -1;
      for (const c of s.cells) k = Math.max(k, reach(g.centerX(c % g.w), g.centerZ((c / g.w) | 0)));
      if (k >= 0) this.damageCell(s.k, damage * k * s.n);
    }
    const t = this.transformer;
    if (t && t.hp > 0) {
      const cx = Math.max(t.box[0], Math.min(x, t.box[2])), cz = Math.max(t.box[1], Math.min(z, t.box[3]));
      const k = reach(cx, cz);
      if (k >= 0) this.damageTransformer(damage * k);
    }
  }

  // ------------------------------------------------------------------ torretas
  initTurret(s) {
    s.yaw = 0; s.cooldown = 0; s.target = null; s.retarget = 0; s.emptyWarned = false;
    this.game.interactions.addItem({ id: `torreta_${s.id}`, type: 'recargar_torreta', x: s.cx, z: s.cz, cell: s.k, dynamic: true });
    s.ammoMax = s.ammo = this.levelStat(s.def, s.level, 'ammo');
  }

  turretReloadCost(k) {
    const s = this.structures.get(k);
    if (!s || s.type !== 'torreta' || s.ammo >= s.ammoMax) return 0;
    return Math.max(1, Math.ceil((s.ammoMax - s.ammo) * s.def.ammoCost * this.surcharge));
  }

  reloadTurret(k) {
    const cost = this.turretReloadCost(k);
    if (!cost || this.game.run.points < cost) return null;
    const s = this.structures.get(k);
    this.game.run.points -= cost;
    s.ammo = s.ammoMax;
    s.emptyWarned = false;
    this.game.floating?.spawn(`-${cost}`, s.cx, 1.6, s.cz, 'neg');
    return `🎯 Torreta recargada (−${cost})`;
  }

  updateTurrets(dt) {
    for (const s of this.turrets) this.updateTurret(s, dt);
  }

  /**
   * Una torreta: apunta al zombi más cercano con línea de tiro y dispara. La del tejado del
   * despacho trae su propio `shotBlocked` (dispara por encima de lo construido) y munición
   * infinita.
   */
  updateTurret(s, dt) {
    const { zombies, grid, effects } = this.game;
    const blocked = s.shotBlocked ?? this.shotBlocked;
    const def = s.def;
    s.cooldown -= dt;
    s.retarget -= dt;
    if (s.target && (s.target.state !== 0 || !s.target.active)) s.target = null;
    if (s.retarget <= 0) {
      // Objetivo: el zombi más cercano dentro del alcance y con línea de tiro.
      s.retarget = def.retarget;
      let best = null, bestD = def.range;
      for (const z of zombies.active) {
        if (z.state !== 0) continue;
        const dx = z.pos.x - s.cx, dz = z.pos.z - s.cz;
        const d = Math.hypot(dx, dz);
        // No malgasta munición contra un escudo que la mira de frente.
        if (d >= bestD || d < 1e-3 || zombies.shieldBlocks(z, dx / d, dz / d)) continue;
        if (raycastGrid(grid, s.cx, s.cz, dx / d, dz / d, d, blocked) < d) continue;
        bestD = d; best = z;
      }
      s.target = best;
    }
    const z = s.target;
    if (!z) return;
    const want = Math.atan2(z.pos.x - s.cx, z.pos.z - s.cz);
    let dy = want - s.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const step = def.turnSpeed * dt;
    s.yaw += Math.max(-step, Math.min(step, dy));
    if (Math.abs(dy) > def.aimTolerance || s.cooldown > 0) return;
    if (s.ammo <= 0) {
      // Clic de vacío como mucho una vez por cadencia de disparo (sin evento en cada paso).
      s.cooldown = 1 / this.levelStat(def, s.level, 'fireRate');
      this.game.bus.emit('turret:empty', s);
      if (!s.emptyWarned) {
        s.emptyWarned = true;
        this.game.hud?.toast(`🎯 Una torreta se ha quedado sin munición: recárgala con ${this.game.useKey}.${this.game.humor?.tag('turretEmpty') ?? ''}`, 5);
      }
      return;
    }
    s.ammo--;
    s.cooldown = 1 / this.levelStat(def, s.level, 'fireRate');
    const a = s.yaw + THREE.MathUtils.degToRad(def.spreadDeg) * (Math.random() - 0.5);
    const dx = Math.sin(a), dz = Math.cos(a);
    // Igual que las balas del jugador: un barril en la trayectoria la para y estalla.
    const wall0 = raycastGrid(grid, s.cx, s.cz, dx, dz, def.range, blocked);
    const barrel = this.barrelRaycast(s.cx, s.cz, dx, dz, wall0);
    const wall = barrel ? barrel.t : wall0;
    const hit = zombies.raycast(s.cx, s.cz, dx, dz, wall);
    let end = wall;
    if (!hit && barrel) this.detonateBarrel(barrel.s, 0);
    if (hit) {
      end = hit.t;
      if (zombies.shieldBlocks(hit.zombie, dx, dz)) zombies.shieldHit(hit.zombie, dx, dz);
      else zombies.damage(hit.zombie, this.levelStat(def, s.level, 'damage'), dx, dz, def.knockback);
    }
    const h = def.headHeight;
    this._from.set(s.cx + dx * 0.55, h, s.cz + dz * 0.55);
    // La del tejado dispara hacia abajo: la trazadora acaba a la altura del torso.
    this._to.set(s.cx + dx * end, s.hitY ?? h, s.cz + dz * end);
    effects.tracer(this._from, this._to, 0xffd27a);
    this.game.bus.emit('turret:fired', s);
  }

  // ------------------------------------------------------------------ vallas electrificadas
  updateFences(dt) {
    const { zombies, effects } = this.game;
    const powered = this.powered;
    const grid = this.game.grid;
    for (const s of this.fences) {
      if (s.zap > 0) s.zap -= dt;
      if (!powered || s.zap > 0) continue;
      const reach = s.def.zapReach;
      const n = zombies.hash.queryInto(s.cx, s.cz, grid.cellSize / 2 + MAX_ZOMBIE_RADIUS + reach, this._near);
      let zapped = 0;
      for (let q = 0; q < n; q++) {
        const z = this._near[q];
        if (z.state !== 0 || !zombies.nearBox(z, grid.dynBox, s.k * 4, z.radius + reach)) continue;
        zombies.damage(z, this.levelStat(s.def, s.level, 'zapDamage'), 0, 0, 0);
        zombies.stun(z, s.def.zapStun);
        effects.burst(z.pos.x, 1.0, z.pos.z, 6, 0x8fdcff, { speed: 3, up: 3, size: 0.05, life: 0.3 });
        zapped++;
      }
      if (zapped) {
        s.zap = s.def.zapInterval;
        s.flash = 0.15;
        effects.burst(s.cx, 1.2, s.cz, 8, 0xd8f4ff, { speed: 2.5, up: 2, size: 0.04, life: 0.25 });
        this.game.bus.emit('fence:zap', { s, count: zapped });
      }
    }
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
    this.game.bus.emit('door:toggle', { open: s.open, x: s.cx, z: s.cz });
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
      if (s.type === 'pinchos' || s.type === 'alambre') {
        // Daño continuo acumulado y aplicado por ticks (sin destello constante).
        z.trapAcc = (z.trapAcc ?? 0) + this.levelStat(s.def, s.level, 'dps') * dt;
        const tickDmg = this.levelStat(s.def, s.level, 'dps') * this.cfg.trapDamageTick;
        if (z.trapAcc >= tickDmg) { zombies.damage(z, z.trapAcc, 0, 0, 0, true); z.trapAcc = 0; }
        z.slowMul = Math.min(z.slowMul, this.levelStat(s.def, s.level, 'slow'));
        s.hp -= s.def.wearPerZombieSecond * dt;
        if (Math.random() < dt * 3) this.game.bus.emit('trap', { kind: 'spike', x: s.cx, z: s.cz });
        if (Math.random() < dt * 6) effects.burst(z.pos.x, 0.3, z.pos.z, 1, 0x4a1d1d, { speed: 1, up: 1.5, size: 0.06, life: 0.5 });
        if (s.hp <= 0) {
          this.game.hud.toast(s.type === 'pinchos' ? '📌 Unos pinchos se han roto' : '➰ Un alambre de espino se ha roto');
          this.remove(s);
        }
      } else if (s.type === 'cepo') {
        if (s.rearm > 0 || z.stunTimer > 0) continue;
        zombies.stun(z, this.levelStat(s.def, s.level, 'holdTime'));
        z.pos.x = s.cx; z.pos.z = s.cz;
        zombies.damage(z, s.def.damage);
        effects.burst(z.pos.x, 0.3, z.pos.z, 8, 0x4a1d1d, { speed: 2, up: 2, size: 0.07, life: 0.8 });
        s.rearm = this.levelStat(s.def, s.level, 'holdTime') + s.def.rearmTime;
        s.flash = 0.2;
        this.game.bus.emit('trap', { kind: 'trap_snap', x: s.cx, z: s.cz });
        s.hp -= 1;
        if (s.hp <= 0) this.remove(s);
      } else if (s.type === 'mina' && s.fuse < 0) {
        s.fuse = s.def.fuse;
        this.game.bus.emit('trap', { kind: 'mine_beep', x: s.cx, z: s.cz });
        s.flash = s.def.fuse;
      }
    }
  }

  explodeMine(s) {
    explode(this.game, s.cx, s.cz, s.def);
    this.remove(s);
  }

  // ------------------------------------------------------------------ modo construcción
  /** Selecciona una pieza (desde el HUD) y salta a su página. */
  select(type) {
    const page = PIECE_PAGES.findIndex((p) => p.pieces.includes(type));
    if (page < 0) return;
    this.page = page;
    this.selected = type;
  }

  setActive(on) {
    this.active = on;
    this.dragging = false;
    // Móvil: el cursor empieza delante de Carlos (luego se mueve tocando el suelo).
    const { game } = this;
    if (on && game.input?.lastDevice === 'touch' && game.player && game.groundPoint) {
      const p = game.player.position, f = game.player.facing ?? 0, d = this.cfg.touchStartDistance;
      game.groundPoint.set(p.x + Math.sin(f) * d, 0, p.z + Math.cos(f) * d);
    }
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
    if (s.auto) {
      this.game.hud?.toast(s.type === 'barril' ? '🛢️ Los barriles son de la comisaría: no se venden' : '🛡️ Las persianas son de la comisaría: no se venden', 2);
      return;
    }
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
      // Con el generador de emergencia del despacho, la luz aguanta un rato sin transformador.
      game.power.generator = t.hp > 0 || !!game.despacho?.emergencyOn;
      // Chispas si está dañado.
      if (t.hp > 0 && t.hp < t.maxHp * this.cfg.transformer.damagedThreshold && Math.random() < dt * 3) {
        game.effects.burst(t.x, 1.3, t.z, 2, 0xffe08a, { speed: 1.5, up: 2.5, size: 0.04, life: 0.4 });
      }
    }
    this.updateTraps(dt);
    this.updateTurrets(dt);
    this.updateFences(dt);

    if (input.consume('build') && player.alive && !game.shop?.open) this.setActive(!this.active);
    if (this.active && game.shop?.open) this.setActive(false);
    if (!player.alive && this.active) this.setActive(false);
    if (!this.active) return;

    if (input.consume('buildPage')) {
      this.page = (this.page + 1) % PIECE_PAGES.length;
      this.selected = PIECE_PAGES[this.page].pieces[0];
    }
    const pieces = PIECE_PAGES[this.page].pieces;
    for (let n = 0; n < pieces.length; n++) {
      if (input.consume(SELECT_ACTIONS[n])) this.selected = pieces[n];
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
    // Móvil: el dedo solo mueve el cursor; construir, mejorar o reparar se confirma con el botón ✔.
    if (input.consume('buildConfirm')) {
      this.primaryAction(this.hoverCell);
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
