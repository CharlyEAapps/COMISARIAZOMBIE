import data from '../data/missions.json';
import { PHASE } from './DayNight.js';
import { Bag } from './Humor.js';
import { weightedPick } from './InteractionSystem.js';
import { TYPES } from './MissionTypes.js';
import {
  resolveParams, fillText, missionReward, forcedChance, carBox, pushOutOfRect, zombiesNear,
} from './missionUtils.js';

export const MISSION_IDS = Object.keys(data.missions);

/** ¿Puede ofrecerse esta misión? (modo, noche, requisitos y conflictos con las ya activas). Función pura. */
export function isAvailable(game, id, mode, night, activeIds = []) {
  const def = data.missions[id];
  if (!def || night < def.fromNight) return false;
  if (def.mode !== 'both' && def.mode !== mode) return false;
  if (activeIds.includes(id)) return false;
  if (def.requires === 'melee') {
    const owned = game.weapons?.owned;
    if (!owned) return false;
    let melee = false;
    for (const w of owned.values()) if (w.data?.melee) melee = true;
    if (!melee) return false;
  }
  for (const other of activeIds) {
    if (data.missions[other]?.conflicts?.includes(id) || def.conflicts?.includes(other)) return false;
  }
  return true;
}

// Misiones originales de la pizarra y eventos forzados de la noche. Complementan a los "casos"
// clásicos de Score (contadores): aquí cambian la partida (apagón, niebla, un civil o un gato que
// proteger, una caja que llevar...). Se aceptan de día en la pizarra o llegan solas al atardecer
// (evento forzado), se ponen en marcha al caer la noche y se liquidan al amanecer desde
// Score.onNightSurvived (settle). Máximo dos a la vez: un caso aceptado y un evento forzado.
// Sin DOM ni Three.js: lo que se ve lo dibujan render/MissionRenderer.js y ui/MissionHud.js.
export class Missions {
  constructor(game, rnd = Math.random) {
    this.game = game;
    this.cfg = data;
    this.rnd = rnd;
    this.bags = new Map();
    this.reset();
    const bus = game.bus;
    this._off = [
      bus.on('phase:atardecer', ({ night }) => this.onDusk(night)),
      bus.on('phase:noche', () => { this.nightPending = true; }),
      bus.on('phase:dia', () => this.clearAll()),
      bus.on('player:hurt', (e) => this.dispatch('player:hurt', e)),
      bus.on('weapon:fired', (e) => this.dispatch('weapon:fired', e)),
      bus.on('grenade:thrown', (e) => this.dispatch('grenade:thrown', e)),
      bus.on('zombie:killed', (e) => this.dispatch('zombie:killed', e)),
    ];
  }

  dispose() {
    for (const off of this._off) off();
    this.clearAll();
  }

  reset() {
    this.clearAll();
    this.entityVersion = 0;
    this.lastForcedNight = 0;
    this.completed = 0;
    this.announce = null;
    this.spent = 0;
    this.ledger = { last: this.game.run?.points ?? 0, gains: 0 };
  }

  /** Quita todas las misiones y lo que hayan creado (entidades, interacciones, efectos). */
  clearAll() {
    for (const m of this.list) this.disposeMission(m);
    if (this._lure && this.ownsDecoy()) this.game.zombies.decoy.timer = 0; // el señuelo de la misión se apaga con ella
    this.slots = { case: null, event: null };
    this.entities = [];
    this.entityVersion = (this.entityVersion ?? 0) + 1;
    this.nightPending = false;
    this.fx = { blackout: false, fog: null, killPointsMul: 1 };
    this._lure = { x: NaN, z: NaN, until: -1, idx: 0, timer: 0 };
    this._targets = [];
    this._targetPool = [];
  }

  get list() {
    const s = this.slots;
    if (!s) return [];
    return [s.case, s.event].filter(Boolean);
  }

  def(m) { return data.missions[m.id]; }

  // ------------------------------------------------------------------ textos
  line(m, kind) {
    const list = this.def(m)[kind];
    if (!Array.isArray(list) || !list.length) return '';
    const key = `${m.id}.${kind}`;
    let bag = this.bags.get(key);
    if (!bag) { bag = new Bag(list, this.rnd); this.bags.set(key, bag); }
    return bag.next();
  }

  fill(text, vars) { return fillText(text, vars); }

  toast(text, seconds = 5) { this.game.hud?.toast(text, seconds); }

  say(x, z, text, cls = 'quip', y = 2.2) {
    if (text) this.game.floating?.spawn(text, x, y, z, cls, 1.8);
  }

  // ------------------------------------------------------------------ aceptar misiones
  activeIds() { return this.list.map((m) => m.id); }

  /** Misiones que pueden ofrecerse ahora en el modo dado ('optional' = pizarra, 'forced' = evento). */
  candidates(mode, night) {
    const ids = this.activeIds();
    const out = [];
    for (const id of MISSION_IDS) if (isAvailable(this.game, id, mode, night, ids)) out.push({ id, w: data.missions[id].w });
    return out;
  }

  /** Pizarra de casos: un caso clásico (contador) o una misión original. Devuelve el aviso para el jugador. */
  offerCase(night) {
    const { score } = this.game;
    const entries = [{ id: 'classic', w: data.board.classicWeight }, ...this.candidates('optional', night)];
    const pick = weightedPick(entries, this.rnd);
    if (pick.id === 'classic') {
      this.removeSlot('case');
      const o = score.pickObjective(night);
      return `📋 Caso aceptado: ${o.text} (+${o.reward})`;
    }
    this.removeSlot('case');
    score.objective = null;
    const m = this.accept(pick.id, false, night);
    return `📋 ${this.def(m).icon} ${this.def(m).name}: ${m.text} (+${m.reward})`;
  }

  accept(id, forced, night) {
    const def = data.missions[id];
    const p = resolveParams(def.params, night);
    const mul = this.game.despacho?.caseRewardMul ?? 1;
    const m = {
      id, forced, night, p, s: {}, items: [], status: 'accepted',
      reward: missionReward(def, night, mul),
    };
    m.text = fillText(def.text, p);
    this.slots[forced ? 'event' : 'case'] = m;
    return m;
  }

  removeSlot(slot) {
    const m = this.slots[slot];
    if (m) { this.disposeMission(m); this.slots[slot] = null; }
  }

  /** Atardecer: ¿llega un evento forzado esta noche? */
  onDusk(night) {
    if (this.slots.event) return;
    const p = forcedChance(data.forced, night, night - this.lastForcedNight);
    if (p <= 0 || (p < 1 && this.rnd() >= p)) return;
    const entries = this.candidates('forced', night);
    if (!entries.length) return;
    const pick = weightedPick(entries, this.rnd);
    const m = this.accept(pick.id, true, night);
    this.lastForcedNight = night;
    const def = this.def(m);
    this.toast(`${def.icon} ${def.name}: ${def.forcedIntro ?? m.text}`, 7);
    this.announce = {
      t: data.forced.announceDelay,
      title: `${def.icon} ${def.name}`.toUpperCase(),
      sub: `${m.text} <b>+${m.reward}</b>`,
    };
  }

  // ------------------------------------------------------------------ vida de la misión
  beginNight() {
    this.nightPending = false;
    this.spent = 0;
    this.ledger.last = this.game.run.points;
    this.ledger.gains = 0;
    for (const m of this.list) {
      if (m.status !== 'accepted') continue;
      m.status = 'active';
      TYPES[m.id].start?.(m, this);
    }
    this.refreshFx();
  }

  disposeMission(m) {
    TYPES[m.id].cleanup?.(m, this);
    this.removeItems(m);
  }

  succeed(m, text) {
    if (m.status !== 'active') return;
    m.status = 'success';
    this.toast(`${this.def(m).icon} ${text ?? this.line(m, 'success')}`, 5);
    TYPES[m.id].onResolve?.(m, this);
    this.refreshFx();
  }

  fail(m, text) {
    if (m.status !== 'active') return;
    m.status = 'failed';
    this.toast(`${this.def(m).icon} ${text ?? this.line(m, 'fail')}`, 5);
    TYPES[m.id].onResolve?.(m, this);
    this.refreshFx();
  }

  refreshFx() {
    const fx = this.fx;
    fx.blackout = false; fx.fog = null; fx.killPointsMul = 1;
    for (const m of this.list) if (m.status === 'active') TYPES[m.id].fx?.(m, fx);
  }

  /** Reparto de eventos del bus a las misiones activas. */
  dispatch(ev, e) {
    for (const m of this.list) if (m.status === 'active') TYPES[m.id].onEvent?.(m, ev, e, this);
  }

  /** Puntos ganados por Score.addPoints (para distinguir un gasto de un cobro). */
  noteGain(amount) { if (amount > 0) this.ledger.gains += amount; }

  trackPoints() {
    const now = this.game.run.points;
    const expected = this.ledger.last + this.ledger.gains;
    this.spent = now < expected - 0.5 ? expected - now : 0;
    this.ledger.last = now;
    this.ledger.gains = 0;
  }

  update(dt) {
    const g = this.game;
    this.trackPoints();
    if (this.announce) {
      this.announce.t -= dt;
      if (this.announce.t <= 0) {
        g.hud?.banner(`Evento: ${this.announce.title}`, this.announce.sub, data.forced.bannerSeconds);
        this.announce = null;
      }
    }
    if (this.nightPending && g.dayNight.phase === PHASE.NIGHT) this.beginNight();
    for (const m of this.list) if (m.status === 'active') TYPES[m.id].update?.(m, dt, this);
    this.refreshFx();
    this.updateLures(dt);
    this.updateEntities(dt);
  }

  updateEntities(dt) {
    const player = this.game.player;
    for (const e of this.entities) {
      if (e.hurt > 0) e.hurt = Math.max(0, e.hurt - dt);
      // El coche patrulla es sólido para el jugador (los zombis lo rodean o lo atraviesan).
      if (e.kind === 'car' && player?.alive) {
        const b = carBox(e.x, e.z, e.rot === 90);
        pushOutOfRect(player.position, player.radius, b[0], b[1], b[2], b[3]);
      }
    }
  }

  // ------------------------------------------------------------------ entidades y señuelos
  addEntity(e) {
    const ent = { x: 0, z: 0, y: 0, hp: 1, maxHp: 1, hurt: 0, acc: 0, lure: null, ...e };
    this.entities.push(ent);
    this.entityVersion++;
    return ent;
  }

  removeEntity(e) {
    const n = this.entities.indexOf(e);
    if (n >= 0) { this.entities.splice(n, 1); this.entityVersion++; }
  }

  /** Daño de los zombis cercanos a una entidad protegida. Devuelve el daño de este paso. */
  hurtEntity(e, dt, p) {
    const n = zombiesNear(this.game.zombies.active, e.x, e.z, p.reach, p.maxAttackers);
    if (!n) return 0;
    const dmg = n * p.dpsPerZombie * dt;
    e.hp = Math.max(0, e.hp - dmg);
    e.hurt = 0.25;
    e.acc += dmg;
    if (e.acc >= 12) { this.say(e.x, e.z, `-${Math.round(e.acc)}`, 'neg', (e.y ?? 0) + 1.6); e.acc = 0; }
    return dmg;
  }

  /** ¿El señuelo actual de ZombieSystem es de una misión (y no la sirena del jugador)? */
  ownsDecoy() {
    const dc = this.game.zombies?.decoy;
    const L = this._lure;
    return !!dc && dc.timer > 0 && dc.x === L.x && dc.z === L.z && L.until > this.game.time;
  }

  /** Atrae a los zombis hacia lo que hay que proteger, de uno en uno si hay varios. */
  updateLures(dt) {
    const z = this.game.zombies;
    if (!z?.setDecoy) return;
    const L = this._lure;
    L.timer -= dt;
    if (L.timer > 0) return;
    L.timer = data.common.lureRefresh;
    const dc = z.decoy;
    // La sirena del jugador manda mientras suena.
    if (dc.timer > 0.5 && !(dc.x === L.x && dc.z === L.z)) return;
    let n = 0;
    for (const e of this.entities) if (e.lure && e.hp > 0) n++;
    if (!n) return;
    let pick = L.idx++ % n;
    for (const e of this.entities) {
      if (!e.lure || e.hp <= 0) continue;
      if (pick-- > 0) continue;
      z.setDecoy(e.lure.x, e.lure.z, data.common.lureDuration, e.lure.radius);
      L.x = e.lure.x; L.z = e.lure.z;
      L.until = this.game.time + data.common.lureDuration;
      break;
    }
  }

  // ------------------------------------------------------------------ interacciones dinámicas
  /** Añade un punto de interacción de la misión (`patch` sobrescribe campos de su definición). */
  addItem(m, anchor, patch) {
    const ia = this.game.interactions;
    ia.addItem({ ...anchor, dynamic: true });
    const it = ia.items.find((x) => x.id === anchor.id);
    if (!it) return null;
    it.missionId = m.id;
    if (patch) Object.assign(it.def, patch);
    if (!m.items.includes(anchor.id)) m.items.push(anchor.id);
    return it;
  }

  removeItem(m, id) {
    this.game.interactions?.removeItem(id);
    const n = m.items.indexOf(id);
    if (n >= 0) m.items.splice(n, 1);
  }

  removeItems(m) {
    for (const id of [...m.items]) this.removeItem(m, id);
  }

  byId(id) { return this.list.find((m) => m.id === id) ?? null; }

  /** Ejecuta la acción de una interacción `mision_*`. @returns {string|null} aviso */
  interact(action, it) {
    const m = this.byId(it.missionId);
    if (!m || m.status !== 'active') return null;
    return TYPES[m.id].interact?.(m, action, it, this) ?? null;
  }

  availability(action, it) {
    const m = this.byId(it.missionId);
    if (!m || m.status !== 'active') return { ok: false, reason: 'Ahora no' };
    return TYPES[m.id].availability?.(m, action, it, this) ?? { ok: true };
  }

  // ------------------------------------------------------------------ amanecer
  /**
   * Liquida las misiones de la noche `night`. Devuelve las líneas del parte y los puntos
   * (recompensas menos multas) para que Score los sume al resumen.
   * @returns {{lines: string[], total: number}|null}
   */
  settle(night) {
    const list = this.list;
    if (!list.length) return null;
    const lines = [];
    let total = 0;
    for (const m of list) {
      const def = this.def(m), h = TYPES[m.id];
      let ok;
      if (m.status === 'success') ok = true;
      else if (m.status === 'failed') ok = false;
      else ok = m.status === 'active' ? !!h.evaluate?.(m, this) : false;
      if (ok) {
        total += m.reward;
        this.completed++;
        lines.push(`${def.icon} ${def.name} +${m.reward}`);
        this.game.bus.emit('case:solved', { id: m.id });
        if (m.status !== 'success') this.toast(`${def.icon} ${this.line(m, 'success')}`, 6);
      } else {
        let fine = 0;
        if (m.forced && h.penalty && m.status !== 'accepted') fine = Math.min(this.game.run.points, h.penalty(m, this));
        total -= fine;
        lines.push(`${def.icon} ${def.name}: fallida${fine ? ` −${fine}` : ''}`);
        if (m.status !== 'failed') this.toast(`${def.icon} ${this.line(m, 'fail')}`, 6);
      }
    }
    this.clearAll();
    return { lines, total };
  }

  // ------------------------------------------------------------------ HUD
  /** Líneas para el HUD: caso clásico de la pizarra + misiones activas. */
  hudLines() {
    const g = this.game;
    const out = [];
    const score = g.score;
    const o = score?.objective;
    if (o) {
      const night = g.dayNight.phase === PHASE.NIGHT;
      const met = night && score.objectiveMet();
      out.push({
        key: `c:${o.id}`, icon: '📋', name: 'Caso de la noche', desc: o.text,
        short: `${o.short ?? o.id} ${night ? score.objectiveProgress(o) : ''}`.trim(),
        state: met ? 'ok' : '', reward: o.reward, forced: false,
      });
    }
    for (const m of this.list) {
      const def = this.def(m);
      let h = { text: m.status === 'accepted' ? 'Empieza esta noche' : '', state: '' };
      if (m.status !== 'accepted') h = TYPES[m.id].hud?.(m, this) ?? h;
      else if (m.forced) h = { text: 'Esta noche', state: 'warn' };
      if (m.status === 'success') h = { ...h, state: 'ok' };
      if (m.status === 'failed') h = { ...h, state: 'bad' };
      out.push({
        key: `m:${m.id}`, icon: def.icon, name: def.name, desc: m.text, short: `${def.short}: ${h.text}`,
        state: h.state, reward: m.reward, forced: m.forced,
      });
    }
    return out;
  }

  /** Puntos a los que apuntar con flechas en el borde de la pantalla ({x, z, icon}). */
  targets() {
    const out = this._targets;
    out.length = 0;
    let n = 0;
    for (const m of this.list) {
      if (m.status !== 'active') continue;
      const t = TYPES[m.id].target?.(m, this);
      if (!t) continue;
      let slot = this._targetPool[n];
      if (!slot) slot = this._targetPool[n] = { x: 0, z: 0, icon: '' };
      slot.x = t.x; slot.z = t.z; slot.icon = this.def(m).icon;
      out.push(slot);
      n++;
    }
    return out;
  }
}

