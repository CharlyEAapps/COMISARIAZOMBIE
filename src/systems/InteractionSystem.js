import data from '../data/interactions.json';
import { PHASE } from './DayNight.js';

const DEFAULTS = data._defaults;

/** Elige un elemento de una lista con pesos `w` (función pura, testeable). */
export function weightedPick(list, rnd = Math.random) {
  const total = list.reduce((s, e) => s + e.w, 0);
  let r = rnd() * total;
  for (const e of list) {
    r -= e.w;
    if (r <= 0) return e;
  }
  return list[list.length - 1];
}

// Interacciones con la comisaría: el jugador se acerca a un punto (anchor), ve el aviso
// "E · acción" y mantiene E durante `hold` segundos. Cada tipo se define en interactions.json.
export class InteractionSystem {
  constructor(game) {
    this.game = game;
    this.items = [];
    this.current = null;
    this.holdT = 0;
    this.waitRelease = false;
    // Recibir daño cancela la acción: hay que soltar E y volver a pulsarla.
    game.bus.on('player:hurt', () => { this.holdT = 0; this.waitRelease = true; });
    this._markers = [];
  }

  /** @param {{id:string,type:string,x:number,z:number,label?:string}[]} anchors */
  setAnchors(anchors) {
    this.items = anchors
      .filter((a) => data[a.type])
      .map((a) => ({ ...a, def: { ...DEFAULTS, ...data[a.type] }, readyAt: 0, usedCycle: 0 }));
  }

  /** Interacción añadida en partida (p. ej. una puerta construida). */
  addItem(a) {
    if (!data[a.type]) return;
    this.removeItem(a.id);
    this.items.push({ ...a, def: { ...DEFAULTS, ...data[a.type] }, readyAt: 0, usedCycle: 0 });
  }

  removeItem(id) {
    const n = this.items.findIndex((it) => it.id === id);
    if (n >= 0) {
      if (this.current === this.items[n]) this.current = null;
      this.items.splice(n, 1);
    }
  }

  reset() {
    this.items = this.items.filter((it) => !it.dynamic);
    for (const it of this.items) { it.readyAt = 0; it.usedCycle = 0; }
    this.current = null;
    this.holdT = 0;
  }

  /** @returns {{ok:boolean, reason?:string}} */
  availability(it) {
    const { game } = this;
    const d = it.def;
    const phase = game.dayNight.phase;
    if (d.availability === 'day' && phase !== PHASE.DAY) return { ok: false, reason: 'Solo de día' };
    if (d.availability === 'night' && phase !== PHASE.NIGHT) return { ok: false, reason: 'Solo de noche' };
    if (d.noDawn && phase === PHASE.DAWN) return { ok: false, reason: 'Está amaneciendo' };
    if (typeof d.cooldown === 'number' && game.time < it.readyAt) {
      return { ok: false, reason: `Disponible en ${Math.ceil(it.readyAt - game.time)} s` };
    }
    if (typeof d.cooldown === 'string' && it.usedCycle === game.dayNight.night) {
      return { ok: false, reason: d.availability === 'night' ? 'Ya usado esta noche' : 'Ya usado hoy' };
    }
    if (d.cost && game.run.points < d.cost) return { ok: false, reason: `Necesitas ${d.cost} puntos` };
    if (d.requiresPower && !game.power.generator) return { ok: false, reason: 'Sin corriente: repara el transformador' };
    const e = d.effect;
    const p = game.player;
    if (e.repairTransformer) {
      const cost = game.build.transformerRepairCost();
      if (!cost) return { ok: false, reason: 'Funciona correctamente' };
      if (game.run.points < cost) return { ok: false, reason: `Necesitas ${cost} puntos` };
    }
    if (e.reloadTurret) {
      const cost = game.build.turretReloadCost(it.cell);
      if (!cost) return { ok: false, reason: 'Munición completa' };
      if (game.run.points < cost) return { ok: false, reason: `Necesitas ${cost} puntos` };
    }
    if (e.medkit && !e.loot && p.medkits >= data._medkit.max) return { ok: false, reason: 'Llevas el máximo de botiquines' };
    if (e.heal && !e.skipDay && p.hp >= p.maxHp) return { ok: false, reason: 'Vida al máximo' };
    return { ok: true };
  }

  label(it) {
    const d = it.def;
    if (d.effect.toggleLights) return !this.game.power.generator ? 'Luces de la comisaría' : this.game.power.lightsOn ? 'Apagar las luces' : 'Encender las luces';
    if (d.effect.toggleDoor) return this.game.build.structures.get(it.cell)?.open ? 'Cerrar puerta' : 'Abrir puerta';
    if (d.effect.repairTransformer) {
      const t = this.game.build.transformer;
      const cost = this.game.build.transformerRepairCost();
      return cost ? `Reparar el transformador (${Math.round((t.hp / t.maxHp) * 100)} %, ${cost} pts)` : 'Transformador';
    }
    if (d.effect.reloadTurret) {
      const s = this.game.build.structures.get(it.cell);
      const cost = this.game.build.turretReloadCost(it.cell);
      return s ? `Recargar torreta (${s.ammo}/${s.ammoMax}${cost ? `, ${cost} pts` : ''})` : d.label;
    }
    return d.cost ? `${d.label} (${d.cost} pts)` : d.label;
  }

  update(dt) {
    const { game } = this;
    const p = game.player;
    if (!p.alive || game.shop?.open) { this.current = null; this.holdT = 0; return; }

    // Punto más cercano dentro de su radio.
    let best = null, bestD = Infinity;
    for (const it of this.items) {
      const d2 = (it.x - p.position.x) ** 2 + (it.z - p.position.z) ** 2;
      if (d2 < it.def.radius * it.def.radius && d2 < bestD) { bestD = d2; best = it; }
    }
    if (best !== this.current) { this.current = best; this.holdT = 0; }

    const held = game.input.isHeld('interact');
    if (!held) this.waitRelease = false;
    if (!best || !held || this.waitRelease) { this.holdT = 0; return; }
    if (!this.availability(best).ok) { this.holdT = 0; return; }
    this.holdT += dt;
    if (this.holdT >= best.def.hold) {
      this.holdT = 0;
      this.waitRelease = true;
      this.execute(best);
    }
  }

  /** Progreso de la acción en curso (0–1) para el HUD. */
  get progress() {
    return this.current ? Math.min(1, this.holdT / this.current.def.hold) : 0;
  }

  execute(it) {
    const { game } = this;
    const d = it.def;
    if (d.cost) game.run.points -= d.cost;
    if (typeof d.cooldown === 'number') it.readyAt = game.time + d.cooldown;
    else it.usedCycle = game.dayNight.night;
    const msg = this.apply(d.effect, it);
    const text = msg ?? d.msg;
    if (text) game.hud.toast(text);
    game.bus.emit('interact', { type: it.type, id: it.id });
  }

  /** Aplica un efecto y devuelve, si procede, un mensaje que sustituye al genérico. */
  apply(e, it) {
    const { game } = this;
    const p = game.player;
    let msg = null;
    if (e.loot) {
      let pick = weightedPick(e.loot);
      // Botiquín con el inventario lleno: se convierte en puntos.
      if (pick.medkit && p.medkits >= data._medkit.max) {
        pick = { points: data._medkit.fullLootPoints, msg: `🩹 Un botiquín… pero ya llevas el máximo: +${data._medkit.fullLootPoints}` };
      }
      const sub = this.apply(pick, it);
      if (pick.msg && sub) return `${pick.msg}: ${sub}`;
      return sub ?? pick.msg ?? null;
    }
    if (e.heal) p.heal(e.heal);
    if (e.stamina) p.stamina = Math.min(p.data.maxStamina, p.stamina + e.stamina);
    if (e.staminaRegenMul) p.addBuff('staminaRegen', e.staminaRegenMul, e.buffDuration);
    if (e.speedMul) p.addBuff('speed', e.speedMul, e.buffDuration);
    if (e.medkit) p.medkits = Math.min(data._medkit.max, p.medkits + e.medkit);
    if (e.points) game.score.addPoints(e.points, it.x, it.z);
    if (e.intel) msg = this.intelMessage();
    if (e.call) {
      const call = data._calls[(Math.random() * data._calls.length) | 0];
      msg = call.text;
      if (call.points) game.score.addPoints(call.points, it.x, it.z);
      if (call.intel) msg += `  ${this.intelMessage()}`;
    }
    if (e.cameras) msg = this.camerasMessage();
    if (e.toggleLights) {
      game.power.lightsOn = !game.power.lightsOn;
      msg = game.power.lightsOn ? '💡 Luces de la comisaría encendidas' : '🌑 Luces apagadas';
    }
    if (e.skipDay) game.dayNight.skipDay();
    if (e.objective) {
      const o = game.score.pickObjective(game.dayNight.night);
      msg = `📋 Caso aceptado: ${o.text} (+${o.reward})`;
    }
    if (e.decoy) {
      game.zombies.setDecoy(it.x, it.z, e.decoy, e.decoyRadius);
      game.bus.emit('siren', { id: it.id, seconds: e.decoy });
    }
    if (e.toggleDoor) msg = game.build.toggleDoor(it.cell);
    if (e.openShop) game.shop.openShop(e.openShop, it.x, it.z);
    if (e.repairTransformer) msg = game.build.repairTransformer();
    if (e.reloadTurret) msg = game.build.reloadTurret(it.cell);
    if (e.alarm) {
      game.lighting.triggerAlarm(e.alarm);
      game.zombies.slowAll(e.alarmSlow, e.alarm);
    }
    return msg;
  }

  intelMessage() {
    const { game } = this;
    const dnSys = game.dayNight;
    // En el amanecer, la noche que viene es la siguiente.
    const n = dnSys.phase === PHASE.DAWN ? dnSys.night + 1 : dnSys.night;
    const side = game.waves.dominantSide(n);
    if (dnSys.phase === PHASE.NIGHT) return `📻 Quedan unos ${game.waves.remaining} zombis. Llegan sobre todo por el ${side}.`;
    const count = game.waves.forecast(n);
    return `📻 Noche ${n}: se esperan unos ${count} zombis, sobre todo por el ${side}.`;
  }

  camerasMessage() {
    const { game } = this;
    const zs = game.zombies.active;
    const p = game.player.position;
    let alive = 0;
    const q = { norte: 0, sur: 0, este: 0, oeste: 0 };
    for (const z of zs) {
      if (z.state !== 0) continue;
      alive++;
      const dx = z.pos.x - p.x, dz = z.pos.z - p.z; // relativo al jugador
      if (Math.abs(dx) > Math.abs(dz)) q[dx > 0 ? 'este' : 'oeste']++;
      else q[dz > 0 ? 'sur' : 'norte']++;
    }
    if (!alive) return '📹 Cámaras: perímetro despejado.';
    const [side, n] = Object.entries(q).sort((a, b) => b[1] - a[1])[0];
    return `📹 Cámaras: ${alive} zombis a la vista, ${n} por el ${side}.`;
  }

  /** Puntos con "!" (interacción útil disponible) cerca del jugador, para el HUD. Reutiliza el array. */
  markers(maxDist = 20) {
    const p = this.game.player.position;
    const out = this._markers;
    out.length = 0;
    for (const it of this.items) {
      if (!it.def.marker) continue;
      if ((it.x - p.x) ** 2 + (it.z - p.z) ** 2 > maxDist * maxDist) continue;
      if (this.availability(it).ok) out.push(it);
    }
    return out;
  }
}
