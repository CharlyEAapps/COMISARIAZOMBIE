import wavesData from '../data/waves.json';
import zombieData from '../data/zombies.json';
import { PHASE } from './DayNight.js';

/** Número de zombis de la noche n (función pura, testeable). */
export function nightCount(cfg, n) {
  return Math.round((cfg.baseCount + cfg.perNight * (n - 1)) * Math.pow(cfg.growth, n - 1));
}

/** Peso de un tipo en la noche n: crece con las noches desde su aparición, con tope. */
export function typeWeight(t, n) {
  if (t.fromNight > n) return 0;
  return Math.min(t.maxWeight ?? Infinity, t.weight + (t.perNight ?? 0) * (n - t.fromNight));
}

/** Tamaño medio de la manada de un tipo (1 si llega suelto). */
export function packSize(type) {
  const p = zombieData[type]?.pack;
  return p ? (p[0] + p[1]) / 2 : 1;
}

/**
 * Tipo de zombi ponderado entre los disponibles en la noche n. Los pesos son proporción de
 * zombis: un tipo de manada se elige menos veces porque cada elección trae un grupo entero.
 */
export function pickType(types, n, rnd = Math.random, sizeOf = packSize) {
  let total = 0;
  for (const t of types) total += typeWeight(t, n) / sizeOf(t.type);
  let r = rnd() * total;
  for (const t of types) {
    const w = typeWeight(t, n) / sizeOf(t.type);
    if (!w) continue;
    r -= w;
    if (r <= 0) return t.type;
  }
  return types[0].type;
}

/** ¿Hay jefe en la noche n? */
export function isBossNight(boss, n) {
  return !!boss && n > 0 && n % boss.every === 0;
}

// Director de oleadas: reparte la horda de cada noche en grupos durante la primera parte
// de la noche, con tope de zombis vivos; de día manda algún rezagado.
export class WaveDirector {
  constructor(game) {
    this.game = game;
    this.cfg = wavesData;
    this.reset();
  }

  reset() {
    this.toSpawn = 0;
    this.total = 0;
    this.spawnTimer = 0;
    this.dayTimer = this.cfg.day.interval;
    this.mods = { hpMul: 1, speedMul: 1 };
    this.bossMods = { hpMul: 1, speedMul: 1 };
    this.bossPending = false;
    this.bossTimer = 0;
    this.bossCount = 0; // apariciones del jefe en esta partida (escala en cada una)
    this.intros = [];
    this.introTimer = 0;
    this.maxAlive = this.cfg.night.maxAliveBase;
    // Orden de apertura de los puntos de aparición, distinto en cada partida (Fisher-Yates).
    const order = this.game.grid.spawns.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [order[i], order[j]] = [order[j], order[i]];
    }
    this.spawnOrder = order;
    this.activeSpawns = this.spawnsFor(1);
  }

  get remaining() {
    return this.toSpawn + (this.bossPending ? 1 : 0) + this.game.zombies.aliveCount;
  }

  /** Puntos de aparición activos en la noche n. */
  spawnsFor(n) {
    const c = this.cfg.night;
    return this.spawnOrder.slice(0, Math.min(this.spawnOrder.length, c.spawnPointsBase + c.spawnPointsPerNight * (n - 1)));
  }

  /** Tamaño previsto de la horda de la noche n (para la radio). */
  forecast(n) {
    return nightCount(this.cfg.night, n);
  }

  /** ¿Se ha generado y abatido toda la oleada? */
  cleared() {
    return this.toSpawn === 0 && !this.bossPending && this.game.zombies.aliveCount === 0;
  }

  startNight(n, nightDuration) {
    const c = this.cfg.night;
    this.total = this.toSpawn = nightCount(c, n);
    const avgGroup = (c.groupMin + c.groupMax) / 2;
    // Toda la horda de golpe (en grupos muy seguidos, con el tope de vivos) o repartida.
    this.interval = c.spawnAll ? c.burstInterval : (c.spawnWindow * nightDuration) / Math.max(1, this.total / avgGroup);
    this.spawnTimer = c.firstSpawnDelay;
    this.maxAlive = Math.min(c.maxAliveCap, c.maxAliveBase + c.maxAlivePerNight * (n - 1));
    this.mods.hpMul = 1 + c.hpBonusPerNight * (n - 1);
    this.mods.speedMul = 1 + Math.min(c.speedBonusCap, c.speedBonusPerNight * (n - 1));
    this.activeSpawns = this.spawnsFor(n);
    this.nightNumber = n;
    this.bossPending = isBossNight(this.cfg.boss, n);
    this.bossTimer = this.cfg.boss?.delay ?? 0;
    // Presenta los tipos nuevos de esta noche (cómo se les hace frente).
    // Si llegan varios a la vez, se presentan de uno en uno.
    this.intros.length = 0;
    for (const t of c.types) {
      const intro = zombieData[t.type]?.intro;
      if (t.fromNight === n && intro) this.intros.push(intro);
    }
    this.introTimer = 0;
  }

  update(dt, dayNight) {
    if (dayNight.phase === PHASE.NIGHT) this.updateNight(dt);
    else if (dayNight.phase === PHASE.DAY && dayNight.day >= this.cfg.day.fromDay) this.updateDay(dt);
  }

  updateNight(dt) {
    if (this.intros.length && (this.introTimer -= dt) <= 0) {
      this.game.hud?.toast(this.intros.shift(), this.cfg.introSeconds);
      this.introTimer = this.cfg.introSeconds * 0.8;
    }
    if (this.bossPending && (this.bossTimer -= dt) <= 0) this.spawnBoss();
    if (this.toSpawn <= 0) return;
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    const c = this.cfg.night;
    this.spawnTimer = this.interval * (1 + (Math.random() * 2 - 1) * c.intervalJitter);
    let room = this.maxAlive - this.game.zombies.aliveCount;
    if (room <= 0) { this.spawnTimer = c.retryDelay; return; }
    let group = Math.min(this.toSpawn, room, c.groupMin + Math.floor(Math.random() * (c.groupMax - c.groupMin + 1)));
    const s = this.activeSpawns[(Math.random() * this.activeSpawns.length) | 0];
    while (group > 0) {
      const type = pickType(c.types, this.nightNumber);
      // Los tipos de manada (corredores) llegan juntos: un grupo entero del mismo tipo.
      const pack = zombieData[type].pack;
      let n = pack ? pack[0] + Math.floor(Math.random() * (pack[1] - pack[0] + 1)) : 1;
      n = Math.min(n, this.toSpawn, Math.max(1, room));
      for (let k = 0; k < n; k++) if (this.spawnAt(s, type)) this.toSpawn--;
      group -= n;
      room -= n;
    }
  }

  /** El jefe: más vida en cada aparición. Aparece en el punto activo más alejado del jugador. */
  spawnBoss() {
    const b = this.cfg.boss;
    const d = zombieData[b.type];
    const { grid, player } = this.game;
    let best = this.activeSpawns[0], bestD = -1;
    for (const s of this.activeSpawns) {
      const dd = Math.hypot(grid.centerX(s.i) - player.position.x, grid.centerZ(s.j) - player.position.z);
      if (dd > bestD) { bestD = dd; best = s; }
    }
    this.bossMods.hpMul = this.mods.hpMul * (1 + d.hpPerAppearance * this.bossCount);
    this.bossMods.speedMul = 1;
    const zb = this.game.zombies.spawn(b.type, grid.centerX(best.i), grid.centerZ(best.j), this.bossMods);
    if (!zb) { this.bossTimer = this.cfg.night.retryDelay; return; }
    this.bossPending = false;
    this.bossCount++;
    this.game.hud?.banner(b.title, zb.nick ? `<i>${zb.nick}</i><br>${b.sub}` : b.sub, 4.5);
    this.game.bus.emit('boss:spawned', { type: b.type, appearance: this.bossCount });
  }

  updateDay(dt) {
    const d = this.cfg.day;
    this.dayTimer -= dt;
    if (this.dayTimer > 0) return;
    this.dayTimer = d.interval * (1 + (Math.random() * 2 - 1) * d.intervalJitter);
    if (this.game.zombies.aliveCount >= d.maxAlive) return;
    const spawns = this.game.grid.spawns;
    this.spawnAt(spawns[(Math.random() * spawns.length) | 0], d.type);
  }

  spawnAt(s, type) {
    const { grid, zombies } = this.game;
    const k = this.cfg.night.spawnScatter;
    const j = () => (Math.random() - 0.5) * k;
    return zombies.spawn(type, grid.centerX(s.i) + j(), grid.centerZ(s.j) + j(), this.mods);
  }

  /** Para el panel de depuración y la radio. */
  spawnAtRandomPoint(type) {
    const spawns = this.game.grid.spawns;
    return this.spawnAt(spawns[(Math.random() * spawns.length) | 0], type);
  }

  /** Dirección dominante de los puntos de aparición de la noche n (para la radio). */
  dominantSide(n) {
    const { grid } = this.game;
    const sides = { norte: 0, sur: 0, este: 0, oeste: 0 };
    for (const s of this.spawnsFor(n)) {
      const dx = s.i - grid.w / 2, dz = s.j - grid.h / 2;
      if (Math.abs(dx) > Math.abs(dz)) sides[dx > 0 ? 'este' : 'oeste']++;
      else sides[dz > 0 ? 'sur' : 'norte']++;
    }
    return Object.entries(sides).sort((a, b) => b[1] - a[1])[0][0];
  }
}
