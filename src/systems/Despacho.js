import data from '../data/despacho.json';
import interactionsData from '../data/interactions.json';
import { PHASE } from './DayNight.js';
import { ROOMS_LIST, ROOM_BY_ID, roomLevel, globalLevel, inRoom } from './Station.js';
import { YardBarrels } from './Barrels.js';
import { Luigi } from '../entities/Luigi.js';

// Despacho del jefe: reformas de la comisaría por SALAS, compradas con los puntos del turno (se
// pierden al acabarlo). Cada sala (station.json) agrupa sus mejoras; su nivel es la suma de los
// niveles de esas mejoras y el nivel global de la comisaría, la suma de todas. El estado es un
// objeto plano `levels` (id de mejora → nivel) que se guarda y restaura con getState()/setState();
// apply() reaplica todos los efectos de forma idempotente. Lo que se ve lo dibujan PropRenderer
// (cada sala se reconstruye al cambiar su nivel) y render/DespachoRenderer.js (exterior y tejado).

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

/** Distancia del punto (x, z) al rectángulo [x0, z0, x1, z1] (0 dentro). */
export function rectDist(x, z, r) {
  const dx = Math.max(r[0] - x, 0, x - r[2]);
  const dz = Math.max(r[1] - z, 0, z - r[3]);
  return Math.hypot(dx, dz);
}

/**
 * Sensor de una persiana: `near` = Carlos está a menos del alcance del sensor; `occupied` = hay
 * alguien (Carlos, Luigi o zombis) en el hueco. Abre si Carlos se acerca; los zombis solos no la
 * abren, pero la mantienen abierta mientras pasan. Cierra tras `delay` s con el hueco libre.
 * Actualiza `s.sensorT` (tiempo con el hueco libre). @returns {boolean} si debe estar abierta
 */
export function sensorStep(s, near, occupied, dt, delay) {
  if (near) { s.sensorT = 0; return true; }
  if (!s.open || occupied) { s.sensorT = 0; return s.open; }
  s.sensorT = (s.sensorT ?? 0) + dt;
  return s.sensorT < delay;
}

/** Celdas (índices) de las torres de los accesos (torre de vigilancia III), una lista por torre. */
export function gateTowerCells(grid) {
  const G = UPGRADES.torreta_tejado.gateTowers;
  return G.spots.map(({ x, z }) => {
    const cells = [];
    for (let j = z; j < z + G.size; j++) for (let i = x; i < x + G.size; i++) cells.push(grid.index(i, j));
    return cells;
  });
}

/** Mejoras que ponen puertas automáticas (persianas del edificio y portones de la valla). */
const AUTO_DOORS = ['persianas', 'portones'];

export class Despacho {
  constructor(game) {
    this.game = game;
    this.cfg = data;
    this.levels = {};
    this.version = 0; // sube con cada cambio (salas, modelos visibles y focos)
    this.roomLevels = {}; // id de sala → nivel (se recalcula en apply)
    this.global = 0;
    const { grid, build, bus } = game;
    const cs = grid.cellSize;
    this.wx = (u) => grid.originX + u * cs;
    this.wz = (v) => grid.originZ + v * cs;

    this.doorGroups = exteriorDoorGroups(grid);
    // Portones del recinto: huecos de la valla del parking (celdas de despacho.json).
    this.gateGroups = UPGRADES.portones.gates.map(([x0, y0, x1, y1]) => {
      const cells = [];
      for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) cells.push(grid.index(i, j));
      return cells;
    });
    this.shutters = [];
    this.emergencyTimer = 0;
    this.emergencyUsed = false;
    this.alarmUses = 0;
    this._regenAcc = 0;
    this.sparkTimer = 0;
    this._spark = parseInt(UPGRADES.suelo_electrico.sparkColor.slice(1), 16);

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
    // Nivel III: torres con torreta ligera junto a los 3 accesos de la valla (con colisión).
    const GT = T.gateTowers;
    this.towerGroups = gateTowerCells(grid);
    this.towerCells = new Set(this.towerGroups.flat());
    this.towersUp = false;
    const gateDef = { ...base, range: GT.range, spreadDeg: GT.spreadDeg, headHeight: T.roofY + base.headHeight, levels: GT.levels };
    this.gateTurrets = GT.spots.map((sp) => ({
      type: 'torreta_acceso', cx: this.wx(sp.x + GT.size / 2), cz: this.wz(sp.z + GT.size / 2), level: 0,
      yaw: (sp.rot * Math.PI) / 180, cooldown: 0, target: null, retarget: 0, ammo: Infinity, ammoMax: Infinity, emptyWarned: false,
      baseY: T.roofY, hitY: T.hitY, shotBlocked: build.staticShotBlocked, rot: sp.rot, def: gateDef,
    }));

    // Barriles del parking y Luigi, el chihuahua.
    this.barrels = new YardBarrels(game);
    this._reserved = (k) => this.towerCells.has(k);
    this.luigi = new Luigi(game, UPGRADES.luigi);

    // Interacciones de la comisaría que modifican las mejoras (los objetos persisten entre turnos).
    const items = game.interactions.items;
    this.alarmItems = items.filter((it) => it.type === 'alarma');
    this.medkitItems = items.filter((it) => it.type === 'botiquin_pared');
    this.lockerItems = items.filter((it) => it.type === 'taquilla');
    this._alarmBase = new Map(this.alarmItems.map((it) => [it, it.def]));
    this._lockerBase = new Map(this.lockerItems.map((it) => [it, it.def]));

    this._unsub = [
      bus.on('phase:noche', ({ night }) => this.onNightfall(night)),
      bus.on('phase:amanecer', () => this.onDawn()),
      bus.on('boss:spawned', () => this.onBoss()),
      bus.on('transformer:destroyed', () => this.onTransformerDown()),
      bus.on('interact', ({ type }) => { if (type === 'alarma') this.onAlarm(); }),
    ];
    this.reset();
  }

  level(id) {
    return this.levels[id] ?? 0;
  }

  has(id) {
    return this.level(id) > 0;
  }

  /** Nivel de una sala (suma de los niveles de sus mejoras). */
  roomLevel(roomId) {
    return this.roomLevels[roomId] ?? 0;
  }

  /** Nivel global de la comisaría (suma de todos los niveles). */
  get globalLevel() {
    return this.global;
  }

  /** ¿Mantiene la luz el generador de emergencia? */
  get emergencyOn() {
    return this.emergencyTimer > 0;
  }

  /** Focos fijos del patio (vacío sin la mejora). */
  get yardLights() {
    return this.has('focos') ? this._yard : this._noLights;
  }

  /** ¿Está la celda k ocupada por algo de las mejoras (torres de los accesos)? No se construye ahí. */
  isReserved(k) {
    return this.towersUp && this.towerCells.has(k);
  }

  /** Frase de humor de la tienda para la mejora `id` (Luigi tiene varias y cambian cada día). */
  flavorOf(id) {
    const u = UPGRADES[id];
    if (!u?.flavors?.length) return u?.flavor ?? '';
    return u.flavors[((this.game.dayNight?.night ?? 1) + this.level(id)) % u.flavors.length];
  }

  /** Descuento de la armería reformada en munición y granadas (0–1). */
  get ammoDiscount() {
    return levelValue(UPGRADES.armeria.ammoDiscount, this.level('armeria'), 0);
  }

  /** Multiplicador de la recompensa de los casos de la pizarra (archivo ordenado). */
  get caseRewardMul() {
    return levelValue(UPGRADES.archivo.caseRewardMul, this.level('archivo'), 1);
  }

  /** Multiplicador del daño que recibe el jugador (calabozos reforzados, si está dentro). */
  damageTakenMul() {
    const l = this.level('calabozos');
    if (!l) return 1;
    const { player, grid } = this.game;
    if (!inRoom('calabozos', grid.cellX(player.position.x), grid.cellZ(player.position.z))) return 1;
    return levelValue(UPGRADES.calabozos.damageTakenMul, l, 1);
  }

  /** Alcance extra de los avisos de amenaza (cámaras): `special` = especiales y jefe. */
  threatMul(special) {
    const C = UPGRADES.camaras, l = this.level('camaras');
    return levelValue(special ? C.specialRangeMul : C.rangeMul, l, 1);
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
    if (this.has('persianas') || this.has('portones')) this.placeShutters(this.game.dayNight.phase !== PHASE.NIGHT, false);
    // Los barriles, en el primer paso: antes se restaura lo construido (que tiene preferencia).
    this.barrels.pending = this.has('barriles');
    if (this.has('luigi')) this.luigi.spawnNearPlayer();
  }

  reset() {
    this.removeShutters();
    this.barrels.remove();
    this.levels = {};
    this.emergencyTimer = 0;
    this.emergencyUsed = false;
    this.alarmUses = 0;
    this.sparkTimer = 0;
    this._regenAcc = 0;
    const r = this.roofTurret;
    r.yaw = 0; r.cooldown = 0; r.target = null; r.retarget = 0;
    for (const g of this.gateTurrets) { g.yaw = (g.rot * Math.PI) / 180; g.cooldown = 0; g.target = null; g.retarget = 0; }
    this.apply();
    const t = this.game.build.transformer;
    if (t) t.hp = t.maxHp;
  }

  /** Reaplica los efectos de los niveles actuales (idempotente). */
  apply() {
    const { build, player } = this.game;
    for (const room of ROOMS_LIST) this.roomLevels[room.id] = roomLevel(room, this.levels);
    this.global = globalLevel(this.levels);
    build.setHpMul(levelValue(UPGRADES.muros.hpMul, this.level('muros'), 1));
    // Persianas que ya estén puestas: su vida sigue el nivel.
    for (const s of this.shutters) s.hpBonus = levelValue(UPGRADES[s.upgrade].hpMul, this.level(s.upgrade), 1);
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
      it.def = { ...base, effect: { ...base.effect, alarm: secs }, msg: A.msg.replace('{s}', secs).replace('{t}', A.stunSeconds) };
    }
    // Vestuarios II: taquillas con mejor botín y más aguante.
    const V = UPGRADES.vestuarios, vl = this.level('vestuarios');
    for (const it of this.lockerItems) {
      const base = this._lockerBase.get(it);
      it.def = vl >= V.betterLootFromLevel ? { ...base, effect: { ...base.effect, loot: V.lockerLoot } } : base;
    }
    if (player) player.staminaDrainMul = levelValue(V.staminaDrainMul, vl, 1);
    const T = UPGRADES.torreta_tejado;
    this.roofTurret.level = Math.max(0, Math.min(this.level('torreta_tejado'), T.levels.length) - 1);
    this.syncTowers();
    this.luigi.setLevel(this.level('luigi'));
    this.version++;
  }

  /**
   * Torres de los accesos (torre de vigilancia III): ocupan sus celdas en la capa dinámica de la
   * rejilla (colisión y un coste enorme en el flow field, para que la horda las rodee). Lo que el
   * jugador hubiera construido ahí se retira devolviendo lo invertido.
   */
  syncTowers() {
    const G = UPGRADES.torreta_tejado.gateTowers;
    const on = this.level('torreta_tejado') >= G.fromLevel;
    if (on === this.towersUp) return;
    this.towersUp = on;
    const { grid, build, run } = this.game;
    if (on) {
      let n = 0, pts = 0;
      for (const k of this.towerCells) {
        const s = build.structures.get(k);
        if (!s) continue;
        if (!s.auto) { n++; pts += s.invested; }
        build.remove(s);
      }
      if (n) {
        run.points += pts;
        this.game.hud?.toast(G.refundMsg.replace('{n}', n).replace('{p}', pts), 5);
      }
      for (const k of this.towerCells) {
        grid.setDynamic(k, true, G.blocksShot, grid.cellBox(k % grid.w, (k / grid.w) | 0));
        grid.extraCost[k] = G.flowCost;
      }
    } else {
      for (const k of this.towerCells) grid.clearDynamic(k);
    }
    build.changed(true);
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
    if (id === 'persianas' || id === 'portones') this.placeShutters(game.dayNight.phase !== PHASE.NIGHT, true, id);
    if (id === 'generador_emergencia') this.onTransformerDown();
    if (id === 'torreta_tejado' && lvl + 1 === u.gateTowers.fromLevel) game.hud?.toast(u.gateTowers.msg, 5);
    if (id === 'barriles') {
      const n = this.barrels.place(this.level(id), this._reserved);
      if (n) game.hud?.toast(u.msg.replace('{n}', this.barrels.prune()), 5);
    }
    if (id === 'luigi') {
      if (lvl === 0) {
        // Sale de su cama, en la sala de descanso, y va a buscar a Carlos.
        const B = u.bed;
        this.luigi.spawn(this.wx(B.x), this.wz(B.z + B.d));
        game.hud?.toast(u.buyMsg, 5);
      } else game.hud?.toast(u.vestMsg, 4);
    }
    return `🗄️ ${u.icon} ${u.name}${u.prices.length > 1 ? ` (nivel ${lvl + 1})` : ''}: ¡obra terminada! Comisaría nivel ${this.global}.`;
  }

  /** Sala (datos de station.json) de una mejora, o null. */
  roomOf(id) {
    for (const r of ROOMS_LIST) if ((r.upgrades ?? []).includes(id)) return r;
    return null;
  }

  // ------------------------------------------------------------------ eventos del ciclo
  onNightfall(night) {
    const { game } = this;
    this.alarmUses = 0;
    if (this.has('persianas') || this.has('portones')) this.placeShutters(false);
    if (this.has('barriles')) {
      const n = this.barrels.place(this.level('barriles'), this._reserved);
      if (n) game.hud?.toast(UPGRADES.barriles.nightMsg.replace('{n}', n), 4);
    }
    // Botiquines de pared: se reponen también al anochecer (uno de día y otro de noche).
    if (this.level('enfermeria') >= UPGRADES.enfermeria.nightRefillFromLevel) for (const it of this.medkitItems) it.usedCycle = 0;
    if (this.has('archivo')) {
      const R = UPGRADES.archivo;
      game.hud?.toast(R.nightMsg.replace('{side}', game.waves.dominantSide(night)), R.toastSeconds);
    }
  }

  /** Amanecer: se abren los portones y llegan los regalos de las salas reformadas. */
  onDawn() {
    this.raiseShutters();
    const { game } = this;
    const p = game.player;
    if (!p?.alive) return;
    const AR = UPGRADES.armeria;
    if (this.level('armeria') >= AR.refillFromLevel && game.weapons) {
      let got = 0;
      for (const w of game.weapons.owned.values()) got += game.weapons.addAmmo(w.id, w.data.maxReserve ?? 0);
      if (got > 0) game.hud?.toast(AR.refillMsg, 5);
    }
    const EN = UPGRADES.enfermeria;
    const max = interactionsData._medkit.max;
    if (this.level('enfermeria') >= EN.dawnMedkitFromLevel && p.medkits < max) {
      p.medkits++;
      game.hud?.toast(EN.dawnMedkitMsg, 4);
    }
    const V = UPGRADES.vestuarios;
    if (this.has('vestuarios') && p.armor < V.vestArmor) {
      const vest = game.shop?.cfg.enfermeria.find((i) => i.id === 'chaleco');
      p.armor = V.vestArmor;
      p.armorMax = Math.max(p.armorMax, vest?.armor ?? V.vestArmor);
      if (!p.armorAbsorb) p.armorAbsorb = vest?.absorb ?? 0.5;
      game.hud?.toast(V.vestMsg.replace('{a}', V.vestArmor), 4);
    }
  }

  /** Alarma activada: con la sirena mejorada, todos los zombis quedan aturdidos un momento. */
  onAlarm() {
    this.alarmUses++;
    if (!this.has('alarma')) return;
    const { zombies } = this.game;
    const t = UPGRADES.alarma.stunSeconds;
    for (const z of zombies.active) if (z.state === 0) zombies.stun(z, t);
  }

  onBoss() {
    const zb = this.game.zombies.boss;
    if (!zb || !this.has('archivo')) return;
    const R = UPGRADES.archivo;
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
  /**
   * Pone las puertas automáticas que falten (persianas del edificio y portones de la valla; las
   * rotas se reponen) con la vida al máximo. `up` = abiertas (de día); si no, cerradas salvo que
   * haya alguien en el hueco. `announce` = mensaje de la mejora `only` (o de las persianas).
   */
  placeShutters(up, announce = true, only = null) {
    const { build, bus } = this.game;
    for (let k = this.shutters.length - 1; k >= 0; k--) if (!build.all.has(this.shutters[k])) this.shutters.splice(k, 1);
    let shown = 0, open = 0;
    for (const id of AUTO_DOORS) {
      if (!this.has(id)) continue;
      const P = UPGRADES[id];
      const mul = levelValue(P.hpMul, this.level(id), 1);
      const groups = id === 'portones' ? this.gateGroups : this.doorGroups;
      for (const cells of groups) {
        let s = this.shutters.find((x) => x.cells[0] === cells[0]);
        if (!s) {
          s = build.placeAuto('puerta', cells, P.doorLevel, mul);
          if (!s) continue;
          s.upgrade = id;
          s.sensorT = 0;
          s.gap = this.gapOf(cells);
          // Las persianas con sensor se abren solas: sin aviso de "usar".
          if (id === 'persianas') this.game.interactions.removeItem(`puerta_${s.id}`);
          this.shutters.push(s);
        }
        s.hp = s.maxHp;
        if (id === (only ?? 'persianas')) shown++;
        // Persianas: siempre cerradas (las abre el sensor); portones: abiertos de día.
        const wantOpen = (up && id !== 'persianas') || build.doorBlocked(s);
        if (!up && wantOpen) open++;
        if (s.open !== wantOpen) {
          s.open = wantOpen;
          build.applyGrid(s);
          bus.emit('door:toggle', { open: wantOpen, x: s.cx, z: s.cz });
        }
      }
    }
    if (this.shutters.length) build.changed(true);
    if (!shown || !announce) return;
    const P = UPGRADES[only ?? 'persianas'];
    const key = this.game.useKey ?? 'E';
    const msg = up && P.msgDay ? P.msgDay : open && P.msgOpen ? P.msgOpen : P.msg;
    this.game.hud?.toast(msg.replace('{n}', shown).replace('{key}', key), 4);
  }

  /** Hueco entero [x0, z0, x1, z1] de una puerta (sus celdas), para el sensor. */
  gapOf(cells) {
    const g = this.game.grid;
    const r = [Infinity, Infinity, -Infinity, -Infinity];
    for (const k of cells) {
      const b = g.cellBox(k % g.w, (k / g.w) | 0);
      r[0] = Math.min(r[0], b[0]); r[1] = Math.min(r[1], b[1]);
      r[2] = Math.max(r[2], b[2]); r[3] = Math.max(r[3], b[3]);
    }
    return r;
  }

  /** Amanecer: abre los portones que sigan en pie (las persianas van por sensor). */
  raiseShutters() {
    const { build, bus } = this.game;
    let any = false;
    for (const s of this.shutters) {
      if (!build.all.has(s) || s.open || s.upgrade === 'persianas') continue;
      s.open = true;
      build.applyGrid(s);
      bus.emit('door:toggle', { open: true, x: s.cx, z: s.cz });
      any = true;
    }
    if (any) {
      build.changed(true);
      this.game.hud?.toast(UPGRADES.portones.msgUp, 3);
    }
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
    if (this.towersUp) for (const g of this.gateTurrets) game.build.updateTurret(g, dt);
    if (this.has('persianas')) this.updateSensors(dt);
    if (this.barrels.pending) {
      this.barrels.pending = false;
      this.barrels.place(this.level('barriles'), this._reserved);
    }
    this.luigi.update(dt);
    // Alarma mejorada: cuando se apaga, vuelve a estar disponible hasta gastar sus usos.
    if (this.has('alarma') && this.alarmUses > 0 && this.alarmUses < UPGRADES.alarma.usesPerNight &&
        game.dayNight.phase === PHASE.NIGHT && game.lighting.alarmTimer <= 0) {
      for (const it of this.alarmItems) if (it.usedCycle === game.dayNight.night) it.usedCycle = 0;
    }
    this.updateInfirmary(dt);
    this.updateCorridor(dt);
  }

  /**
   * Persianas con sensor: se abren cuando Carlos se acerca y se cierran cuando el hueco lleva un
   * rato libre (si le siguen zombis, esperan a que pasen). Los zombis solos no las abren.
   */
  updateSensors(dt) {
    const { build, bus, player, zombies } = this.game;
    const P = UPGRADES.persianas;
    const L = this.luigi;
    const px = player.position.x, pz = player.position.z;
    let changed = false;
    for (const s of this.shutters) {
      if (s.upgrade !== 'persianas' || !build.all.has(s)) continue;
      const g = s.gap;
      const near = player.alive && rectDist(px, pz, g) <= P.sensorRange;
      let occupied = false;
      if (s.open && !near) {
        occupied = rectDist(px, pz, g) < player.radius || (L.active && rectDist(L.pos.x, L.pos.z, g) < L.radius);
        if (!occupied) {
          for (const z of zombies.active) {
            if (z.state === 0 && rectDist(z.pos.x, z.pos.z, g) < z.radius) { occupied = true; break; }
          }
        }
      }
      const want = sensorStep(s, near, occupied, dt, P.closeDelay);
      if (want === s.open) continue;
      // Último seguro: nunca se cierra encima de nadie.
      if (!want && build.doorBlocked(s)) { s.sensorT = 0; continue; }
      s.open = want;
      build.applyGrid(s);
      bus.emit('door:toggle', { open: want, x: s.cx, z: s.cz });
      changed = true;
    }
    if (changed) build.changed(true);
  }

  /** Enfermería II: dentro se cura poco a poco (el número flotante sale cada punto entero). */
  updateInfirmary(dt) {
    const E = UPGRADES.enfermeria;
    const p = this.game.player;
    if (this.level('enfermeria') < E.regenFromLevel || !p?.alive || p.hp >= p.maxHp) { this._regenAcc = 0; return; }
    const g = this.game.grid;
    if (!inRoom('enfermeria', g.cellX(p.position.x), g.cellZ(p.position.z))) { this._regenAcc = 0; return; }
    const add = Math.min(p.maxHp - p.hp, E.regenPerSec * dt);
    p.hp += add;
    this._regenAcc += add;
    if (this._regenAcc >= E.regenPerSec) {
      this.game.floating?.spawn(`+${Math.round(this._regenAcc)}`, p.position.x, 2.1, p.position.z, 'heal');
      this._regenAcc = 0;
    }
  }

  /**
   * Pasillo electrificado: los zombis que pisan el pasillo central pierden vida poco a poco
   * (nunca de golpe) y en el nivel II además caminan más lentos. Chispas de vez en cuando.
   */
  updateCorridor(dt) {
    const l = this.level('suelo_electrico');
    if (!l) return;
    const K = UPGRADES.suelo_electrico;
    const { zombies, grid, effects } = this.game;
    const dmg = levelValue(K.dps, l, 0) * dt;
    const slow = l >= K.slowFromLevel ? K.slowMul : 1;
    this.sparkTimer -= dt;
    const spark = this.sparkTimer <= 0;
    if (spark) this.sparkTimer = K.sparkEvery;
    for (const z of zombies.active) {
      if (z.state !== 0) continue;
      if (!inRoom('pasillo', grid.cellX(z.pos.x), grid.cellZ(z.pos.z))) continue;
      if (slow < z.slowMul) z.slowMul = slow;
      if (spark) effects?.burst?.(z.pos.x, 0.3, z.pos.z, 5, this._spark, { speed: 2, up: 2.5, size: 0.05, life: 0.35 });
      zombies.damage(z, dmg, 0, 0, 0, true);
    }
  }

  dispose() {
    for (const off of this._unsub) off();
    this._unsub.length = 0;
  }
}

/** Sala de station.json por id (para la tienda y el render). */
export { ROOM_BY_ID };
