import data from '../data/despacho.json';
import { PHASE } from './DayNight.js';

// Despacho del comisario: mejoras de la comisaría compradas con los puntos del turno (se pierden
// al acabarlo). El estado es un objeto plano `levels` (id → nivel) que se puede guardar y
// restaurar con getState()/setState(); apply() reaplica todos los efectos de forma idempotente.
// Los modelos visibles de cada mejora los dibuja render/DespachoRenderer.js.

export const DESPACHO = data;
export const UPGRADES = data.upgrades;
export const UPGRADE_IDS = Object.keys(UPGRADES);

/** Nivel máximo de una mejora. */
export function maxLevel(id) {
  return UPGRADES[id]?.prices.length ?? 0;
}

/** Precio base (de día) del siguiente nivel de `id` estando en `level`, o 0 si ya está al máximo. */
export function nextPrice(id, level) {
  const u = UPGRADES[id];
  return u && level < u.prices.length ? u.prices[level] : 0;
}

/** Valor de una tabla por nivel (`arr[level - 1]`) o `def` con nivel 0. */
export function levelValue(arr, level, def) {
  return level > 0 ? arr[Math.min(level, arr.length) - 1] : def;
}

/** Niveles válidos a partir de datos guardados: ids conocidos, enteros y dentro de su rango. */
export function sanitizeLevels(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const id of UPGRADE_IDS) {
    const v = Math.floor(Number(raw[id]));
    if (Number.isFinite(v) && v > 0) out[id] = Math.min(v, maxLevel(id));
  }
  return out;
}

/** Vida máxima del transformador con el refuerzo de nivel `level`. */
export function transformerMaxHp(base, level) {
  return Math.round(base * (1 + levelValue(UPGRADES.transformador.hpBonus, level, 0)));
}

/** Lado (norte/sur/este/oeste) de un desplazamiento en el plano; z crece hacia el sur. */
export function sideOf(dx, dz) {
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 'este' : 'oeste';
  return dz > 0 ? 'sur' : 'norte';
}

/**
 * Huecos de puerta ('D') que dan al exterior del edificio: grupos de celdas 'D' contiguas en los
 * que alguna celda toca una baldosa que no es suelo interior. Cada grupo, ordenado de menor a
 * mayor índice (el mismo orden que BuildSystem.doorGroup).
 */
export function exteriorDoorGroups(grid) {
  const isD = (i, j) => grid.inBounds(i, j) && grid.chars[grid.index(i, j)] === 'D';
  const outside = (i, j) => grid.inBounds(i, j) && grid.tiles[grid.chars[grid.index(i, j)]]?.floor !== 'interior';
  const seen = new Set();
  const groups = [];
  for (let j = 0; j < grid.h; j++) {
    for (let i = 0; i < grid.w; i++) {
      const k = grid.index(i, j);
      if (seen.has(k) || !isD(i, j)) continue;
      const cells = [];
      const stack = [[i, j]];
      seen.add(k);
      let ext = false;
      while (stack.length) {
        const [ci, cj] = stack.pop();
        cells.push(grid.index(ci, cj));
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = ci + di, nj = cj + dj;
          if (outside(ni, nj)) ext = true;
          if (!isD(ni, nj) || seen.has(grid.index(ni, nj))) continue;
          seen.add(grid.index(ni, nj));
          stack.push([ni, nj]);
        }
      }
      if (ext) groups.push(cells.sort((a, b) => a - b));
    }
  }
  return groups;
}

export class Despacho {
  constructor(game) {
    this.game = game;
    this.cfg = data;
    this.levels = {};
    this.version = 0; // sube con cada cambio (modelos visibles y focos)
    const { grid, build, bus } = game;
    const cs = grid.cellSize;
    this.wx = (u) => grid.originX + u * cs;
    this.wz = (v) => grid.originZ + v * cs;

    this.doorGroups = exteriorDoorGroups(grid);
    this.shutters = [];
    this.emergencyTimer = 0;
    this.emergencyUsed = false;
    this.alarmUses = 0;

    // Focos del patio: posiciones fijas (en metros) que Lighting suma a los focos construidos.
    this._yard = UPGRADES.focos.positions.map(([x, z]) => ({ cx: this.wx(x), cz: this.wz(z) }));
    this._noLights = [];

    // Torreta del tejado: misma lógica que las torretas construidas (BuildSystem.updateTurret).
    const T = UPGRADES.torreta_tejado;
    const base = build.pieces.torreta;
    this.roofTurret = {
      type: 'torreta_tejado', cx: this.wx(T.x), cz: this.wz(T.z), level: 0,
      yaw: 0, cooldown: 0, target: null, retarget: 0, ammo: Infinity, ammoMax: Infinity, emptyWarned: false,
      baseY: T.roofY, hitY: T.hitY, shotBlocked: build.staticShotBlocked,
      def: { ...base, range: T.range, spreadDeg: T.spreadDeg, headHeight: T.roofY + base.headHeight, levels: T.levels },
    };

    // Interacciones de la comisaría que modifican las mejoras (los objetos persisten entre turnos).
    const items = game.interactions.items;
    this.alarmItems = items.filter((it) => it.type === 'alarma');
    this.medkitItems = items.filter((it) => it.type === 'botiquin_pared');
    this._alarmBase = new Map(this.alarmItems.map((it) => [it, it.def]));

    this._unsub = [
      bus.on('phase:noche', ({ night }) => this.onNightfall(night)),
      bus.on('phase:amanecer', () => this.removeShutters()),
      bus.on('boss:spawned', () => this.onBoss()),
      bus.on('transformer:destroyed', () => this.onTransformerDown()),
      bus.on('interact', ({ type }) => { if (type === 'alarma') this.alarmUses++; }),
    ];
    this.reset();
  }

  level(id) {
    return this.levels[id] ?? 0;
  }

  has(id) {
    return this.level(id) > 0;
  }

  /** ¿Mantiene la luz el generador de emergencia? */
  get emergencyOn() {
    return this.emergencyTimer > 0;
  }

  /** Focos fijos del patio (vacío sin la mejora). */
  get yardLights() {
    return this.has('focos') ? this._yard : this._noLights;
  }

  // ------------------------------------------------------------------ estado (guardado)
  /** Objeto plano serializable: id → nivel (solo las compradas). */
  getState() {
    return { ...this.levels };
  }

  /** Restaura los niveles (validados) y reaplica todos los efectos y modelos. */
  setState(levels) {
    this.levels = sanitizeLevels(levels);
    this.apply();
    if (this.has('persianas') && this.game.dayNight.phase === PHASE.NIGHT) this.placeShutters();
  }

  reset() {
    this.removeShutters();
    this.levels = {};
    this.emergencyTimer = 0;
    this.emergencyUsed = false;
    this.alarmUses = 0;
    const r = this.roofTurret;
    r.yaw = 0; r.cooldown = 0; r.target = null; r.retarget = 0;
    this.apply();
    const t = this.game.build.transformer;
    if (t) t.hp = t.maxHp;
  }

  /** Reaplica los efectos de los niveles actuales (idempotente). */
  apply() {
    const { build } = this.game;
    build.setHpMul(levelValue(UPGRADES.muros.hpMul, this.level('muros'), 1));
    // Persianas que ya estén puestas: su vida sigue el nivel.
    const shutterMul = levelValue(UPGRADES.persianas.hpMul, this.level('persianas'), 1);
    for (const s of this.shutters) s.hpBonus = shutterMul;
    build.refreshMaxHp();
    // Transformador: conserva la proporción de vida.
    const t = build.transformer;
    if (t) {
      const max = transformerMaxHp(build.cfg.transformer.hp, this.level('transformador'));
      if (max !== t.maxHp) {
        if (t.hp > 0) t.hp = Math.max(1, Math.round((t.hp * max) / t.maxHp));
        t.maxHp = max;
      }
    }
    // Alarma: dura más (y el mensaje lo dice).
    const A = UPGRADES.alarma;
    for (const it of this.alarmItems) {
      const base = this._alarmBase.get(it);
      if (!this.has('alarma')) { it.def = base; continue; }
      const secs = base.effect.alarm + A.extraSeconds;
      it.def = { ...base, effect: { ...base.effect, alarm: secs }, msg: A.msg.replace('{s}', secs) };
    }
    this.roofTurret.level = Math.max(0, this.level('torreta_tejado') - 1);
    this.version++;
  }

  // ------------------------------------------------------------------ compras
  /** Sube un nivel la mejora `id` (el cobro lo hace ShopSystem). @returns {string|null} mensaje */
  buy(id) {
    const u = UPGRADES[id];
    const lvl = this.level(id);
    if (!u || lvl >= u.prices.length) return null;
    this.levels[id] = lvl + 1;
    this.apply();
    const { game } = this;
    if (id === 'persianas' && game.dayNight.phase === PHASE.NIGHT) this.placeShutters();
    if (id === 'generador_emergencia') this.onTransformerDown();
    return `🗄️ ${u.icon} ${u.name}${u.prices.length > 1 ? ` (nivel ${lvl + 1})` : ''}: ¡instalado!`;
  }

  // ------------------------------------------------------------------ eventos del ciclo
  onNightfall(night) {
    const { game } = this;
    this.alarmUses = 0;
    if (this.has('persianas')) this.placeShutters();
    // Botiquines de pared: se reponen también al anochecer (uno de día y otro de noche).
    if (this.has('botiquines')) for (const it of this.medkitItems) it.usedCycle = 0;
    if (this.has('radar')) {
      const R = UPGRADES.radar;
      game.hud?.toast(R.nightMsg.replace('{side}', game.waves.dominantSide(night)), R.toastSeconds);
    }
  }

  onBoss() {
    const zb = this.game.zombies.boss;
    if (!zb || !this.has('radar')) return;
    const R = UPGRADES.radar;
    const side = sideOf(zb.pos.x - this.wx(R.center[0]), zb.pos.z - this.wz(R.center[1]));
    this.game.hud?.toast(R.bossMsg.replace('{side}', side), R.toastSeconds);
  }

  onTransformerDown() {
    const t = this.game.build.transformer;
    if (!t || t.hp > 0 || !this.has('generador_emergencia') || this.emergencyUsed) return;
    const G = UPGRADES.generador_emergencia;
    this.emergencyUsed = true;
    this.emergencyTimer = G.seconds;
    this.game.hud?.toast(G.onMsg.replace('{s}', G.seconds), 5);
  }

  // ------------------------------------------------------------------ persianas
  /** Baja las persianas en los accesos exteriores libres (abiertas si hay alguien en medio). */
  placeShutters() {
    const { build, bus } = this.game;
    const P = UPGRADES.persianas;
    const mul = levelValue(P.hpMul, this.level('persianas'), 1);
    let placed = 0, open = 0;
    for (const cells of this.doorGroups) {
      const s = build.placeAuto('puerta', cells, P.doorLevel, mul);
      if (!s) continue;
      this.shutters.push(s);
      placed++;
      if (build.doorBlocked(s)) {
        s.open = true;
        build.applyGrid(s);
        open++;
      } else bus.emit('door:toggle', { open: false, x: s.cx, z: s.cz });
    }
    if (placed) build.changed(true);
    if (placed) this.game.hud?.toast((open ? P.msgOpen : P.msg).replace('{n}', placed).replace('{key}', this.game.useKey ?? 'E'), 4);
  }

  /** Retira las persianas que sigan en pie (sin reembolso). */
  removeShutters() {
    const { build } = this.game;
    for (const s of this.shutters) if (build.all.has(s)) build.remove(s);
    this.shutters.length = 0;
  }

  // ------------------------------------------------------------------ paso fijo
  update(dt) {
    const { game } = this;
    const t = game.build.transformer;
    // Generador de emergencia: se agota con el tiempo; se recarga al reparar el transformador.
    if (t && t.hp > 0) {
      this.emergencyTimer = 0;
      this.emergencyUsed = false;
    } else if (this.emergencyTimer > 0) {
      this.emergencyTimer -= dt;
      if (this.emergencyTimer <= 0) {
        this.emergencyTimer = 0;
        game.hud?.toast(UPGRADES.generador_emergencia.offMsg, 5);
      }
    }
    // Transformador reforzado: se repara solo de día si sigue en pie.
    const tl = this.level('transformador');
    if (t && tl && game.dayNight.phase === PHASE.DAY && t.hp > 0 && t.hp < t.maxHp) {
      t.hp = Math.min(t.maxHp, t.hp + levelValue(UPGRADES.transformador.dayRepair, tl, 0) * dt);
    }
    if (this.has('torreta_tejado')) game.build.updateTurret(this.roofTurret, dt);
    // Alarma mejorada: cuando se apaga, vuelve a estar disponible hasta gastar sus usos.
    if (this.has('alarma') && this.alarmUses > 0 && this.alarmUses < UPGRADES.alarma.usesPerNight &&
        game.dayNight.phase === PHASE.NIGHT && game.lighting.alarmTimer <= 0) {
      for (const it of this.alarmItems) if (it.usedCycle === game.dayNight.night) it.usedCycle = 0;
    }
  }

  dispose() {
    for (const off of this._unsub) off();
    this._unsub.length = 0;
  }
}
