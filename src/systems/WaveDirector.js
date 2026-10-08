import wavesData from '../data/waves.json';
import { PHASE } from './DayNight.js';

/** Número de zombis de la noche n (función pura, testeable). */
export function nightCount(cfg, n) {
  return Math.round((cfg.baseCount + cfg.perNight * (n - 1)) * Math.pow(cfg.growth, n - 1));
}

/** Tipo de zombi ponderado entre los disponibles en la noche n. */
export function pickType(types, n, rnd = Math.random) {
  let total = 0;
  for (const t of types) if (t.fromNight <= n) total += t.weight;
  let r = rnd() * total;
  for (const t of types) {
    if (t.fromNight > n) continue;
    r -= t.weight;
    if (r <= 0) return t.type;
  }
  return types[0].type;
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
    this.maxAlive = this.cfg.night.maxAliveBase;
    // Orden de apertura de los puntos de aparición, distinto en cada partida.
    this.spawnOrder = this.game.grid.spawns.map((s) => s).sort(() => Math.random() - 0.5);
    this.activeSpawns = this.spawnOrder.slice(0, this.cfg.night.spawnPointsBase);
  }

  get remaining() {
    return this.toSpawn + this.game.zombies.aliveCount;
  }

  /** Tamaño previsto de la horda de la noche n (para la radio). */
  forecast(n) {
    return nightCount(this.cfg.night, n);
  }

  /** ¿Se ha generado y abatido toda la oleada? */
  cleared() {
    return this.toSpawn === 0 && this.game.zombies.aliveCount === 0;
  }

  startNight(n, nightDuration) {
    const c = this.cfg.night;
    this.total = this.toSpawn = nightCount(c, n);
    const avgGroup = (c.groupMin + c.groupMax) / 2;
    this.interval = (c.spawnWindow * nightDuration) / Math.max(1, this.total / avgGroup);
    this.spawnTimer = 2;
    this.maxAlive = Math.min(c.maxAliveCap, c.maxAliveBase + c.maxAlivePerNight * (n - 1));
    this.mods.hpMul = 1 + c.hpBonusPerNight * (n - 1);
    this.mods.speedMul = 1 + Math.min(c.speedBonusCap, c.speedBonusPerNight * (n - 1));
    const points = Math.min(this.spawnOrder.length, c.spawnPointsBase + c.spawnPointsPerNight * (n - 1));
    this.activeSpawns = this.spawnOrder.slice(0, points);
    this.nightNumber = n;
  }

  update(dt, dayNight) {
    if (dayNight.phase === PHASE.NIGHT) this.updateNight(dt);
    else if (dayNight.phase === PHASE.DAY && dayNight.day >= this.cfg.day.fromDay) this.updateDay(dt);
  }

  updateNight(dt) {
    if (this.toSpawn <= 0) return;
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    const c = this.cfg.night;
    this.spawnTimer = this.interval * (0.7 + Math.random() * 0.6);
    const room = this.maxAlive - this.game.zombies.aliveCount;
    if (room <= 0) { this.spawnTimer = 1; return; }
    const group = Math.min(this.toSpawn, room, c.groupMin + Math.floor(Math.random() * (c.groupMax - c.groupMin + 1)));
    const s = this.activeSpawns[(Math.random() * this.activeSpawns.length) | 0];
    for (let k = 0; k < group; k++) {
      const type = pickType(c.types, this.nightNumber);
      if (this.spawnAt(s, type)) this.toSpawn--;
    }
  }

  updateDay(dt) {
    const d = this.cfg.day;
    this.dayTimer -= dt;
    if (this.dayTimer > 0) return;
    this.dayTimer = d.interval * (0.7 + Math.random() * 0.6);
    if (this.game.zombies.aliveCount >= d.maxAlive) return;
    const spawns = this.game.grid.spawns;
    this.spawnAt(spawns[(Math.random() * spawns.length) | 0], d.type);
  }

  spawnAt(s, type) {
    const { grid, zombies } = this.game;
    const j = () => (Math.random() - 0.5) * 1.2;
    return zombies.spawn(type, grid.centerX(s.i) + j(), grid.centerZ(s.j) + j(), this.mods);
  }

  /** Para el panel de depuración y la radio. */
  spawnAtRandomPoint(type) {
    const spawns = this.game.grid.spawns;
    return this.spawnAt(spawns[(Math.random() * spawns.length) | 0], type);
  }

  /** Dirección dominante de los puntos activos (para la radio). */
  dominantSide() {
    const { grid } = this.game;
    const sides = { norte: 0, sur: 0, este: 0, oeste: 0 };
    for (const s of this.activeSpawns) {
      const dx = s.i - grid.w / 2, dz = s.j - grid.h / 2;
      if (Math.abs(dx) > Math.abs(dz)) sides[dx > 0 ? 'este' : 'oeste']++;
      else sides[dz > 0 ? 'sur' : 'norte']++;
    }
    return Object.entries(sides).sort((a, b) => b[1] - a[1])[0][0];
  }
}
