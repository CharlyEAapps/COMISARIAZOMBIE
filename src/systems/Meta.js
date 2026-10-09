import metaData from '../data/meta.json';
import zombieData from '../data/zombies.json';
import weaponsData from '../data/weapons.json';
import { SaveStore, addRecord, defaultSave } from '../save/SaveStore.js';

/**
 * Medallas ganadas en una partida (función pura, testeable).
 * @param {{nights:number}} run
 * @param {Record<string, number>} stats bossKills, kills, maxCombo, perfectNights, cases, built, weaponsUsed
 * @returns {{label:string, medals:number}[]}
 */
export function medalsForRun(cfg, run, stats) {
  const out = [];
  if (run.nights > 0) out.push({ label: `${run.nights} ${run.nights === 1 ? 'noche' : 'noches'} sobrevivida${run.nights === 1 ? '' : 's'}`, medals: run.nights * cfg.perNight });
  for (const m of cfg.milestones) if (run.nights >= m.night) out.push({ label: m.label, medals: m.medals });
  for (const a of cfg.achievements) {
    const v = stats[a.stat] ?? 0;
    if (v < a.min) continue;
    const units = a.perUnit ? Math.min(a.maxUnits ?? Infinity, Math.floor(v / a.min)) : 1;
    out.push({ label: units > 1 ? `${a.label} ×${units}` : a.label, medals: a.medals * units });
  }
  return out;
}

/** Coste en medallas del siguiente nivel de una mejora (0 si está al máximo). */
export function upgradeCost(def, level) {
  return level < def.maxLevel ? def.cost[level] : 0;
}

// Meta-progresión: recoge las estadísticas de la partida, reparte medallas al terminar,
// guarda récords y mejoras permanentes, y aplica las mejoras al empezar cada partida.
export class Meta {
  constructor(game, storage) {
    this.game = game;
    this.cfg = metaData;
    this.store = new SaveStore(metaData.storageKey, storage);
    this.data = this.store.load({ maxRecords: metaData.maxRecords });
    this.upgrades = metaData.upgrades;
    this.lastRun = null;
    this.resetRunStats();
    const on = (t, fn) => game.bus.on(t, fn);
    this._unsub = [
      on('run:start', () => this.resetRunStats()),
      on('weapon:fired', ({ id }) => this.useWeapon(id)),
      on('weapon:melee', ({ id }) => this.useWeapon(id)),
      on('boss:killed', () => { this.runStats.bossKills++; }),
      on('build:placed', () => { this.runStats.built++; }),
      on('case:solved', () => { this.runStats.cases++; }),
      on('night:survived', () => { if (game.score.nightStats.damage === 0) this.runStats.perfectNights++; }),
      on('run:over', ({ abandoned }) => this.finishRun(abandoned)),
    ];
  }

  resetRunStats() {
    this.runStats = { bossKills: 0, built: 0, cases: 0, perfectNights: 0, shots: {} };
  }

  useWeapon(id) {
    const s = this.runStats.shots;
    s[id] = (s[id] ?? 0) + 1;
  }

  get medals() { return this.data.medals; }
  get records() { return this.data.records; }
  get settings() { return this.data.settings; }

  /** Nivel de una mejora, siempre dentro de [0, maxLevel] (aunque el guardado diga otra cosa). */
  level(id) {
    const def = this.upgrades.find((u) => u.id === id);
    const lv = Math.floor(this.data.upgrades[id] ?? 0);
    return def ? Math.max(0, Math.min(def.maxLevel, lv)) : 0;
  }

  /** Arma más usada de la partida (por disparos o golpes). */
  favoriteWeapon() {
    let best = null, n = 0;
    for (const [id, c] of Object.entries(this.runStats.shots)) if (c > n) { n = c; best = id; }
    return best;
  }

  // ------------------------------------------------------------------ fin de partida
  finishRun(abandoned = false) {
    try {
      this.recordRun(abandoned);
    } finally {
      this.game.bus.emit('meta:runFinished', this.lastRun);
    }
  }

  recordRun(abandoned) {
    const { run, score } = this.game;
    const fav = this.favoriteWeapon();
    const stats = {
      ...this.runStats,
      kills: run.kills,
      maxCombo: score.maxCombo,
      weaponsUsed: Object.keys(this.runStats.shots).length,
    };
    const medals = medalsForRun(this.cfg.medals, run, stats);
    const total = medals.reduce((s, m) => s + m.medals, 0);
    // Los récords usan lo ganado en el turno (no el saldo: invertir en defensas no penaliza).
    const entry = {
      points: run.score, nights: run.nights, kills: run.kills, time: Math.round(run.time),
      date: new Date().toISOString().slice(0, 10), weapon: fav ? weaponsData[fav].name : '',
    };
    // Un turno sin puntos ni noches no es un récord.
    const counts = entry.points > 0 || entry.nights > 0;
    const { records, rank } = counts ? addRecord(this.data.records, entry, this.cfg.maxRecords) : { records: this.data.records, rank: -1 };
    const d = this.data;
    d.records = records;
    d.medals += total;
    d.medalsEarned += total;
    d.stats.runs++;
    d.stats.bestNight = Math.max(d.stats.bestNight, run.nights);
    d.stats.totalKills += run.kills;
    const saved = this.store.save(d);
    const killsByType = Object.entries(run.killsByType)
      .map(([type, n]) => ({ type, name: zombieData[type]?.name ?? type, n }))
      .sort((a, b) => b.n - a.n);
    this.lastRun = { ...entry, killsByType, favorite: entry.weapon, medals, totalMedals: total, rank, saved, maxCombo: score.maxCombo, abandoned };
  }

  // ------------------------------------------------------------------ tablón de mejoras
  /** Lista para el tablón: [{ ...def, level, nextCost, canBuy }]. */
  upgradeList() {
    return this.upgrades.map((def) => {
      const level = this.level(def.id);
      const nextCost = upgradeCost(def, level);
      return { ...def, level, nextCost, canBuy: nextCost > 0 && this.data.medals >= nextCost };
    });
  }

  buyUpgrade(id) {
    const def = this.upgrades.find((u) => u.id === id);
    if (!def) return false;
    const level = this.level(id);
    const cost = upgradeCost(def, level);
    if (!cost || this.data.medals < cost) return false;
    this.data.medals -= cost;
    this.data.upgrades[id] = level + 1;
    this.store.save(this.data);
    this.game.bus.emit('meta:upgrade', { id, level: level + 1 });
    return true;
  }

  /** Borra todo el progreso (medallas, mejoras, récords y estadísticas); las opciones se quedan. */
  resetProgress() {
    const settings = this.data.settings;
    this.store.clear();
    this.data = defaultSave();
    this.data.settings = settings;
    this.store.save(this.data);
  }

  setSetting(key, value) {
    this.data.settings[key] = value;
    this.store.save(this.data);
  }

  // ------------------------------------------------------------------ al empezar
  /** Aplica las mejoras permanentes a una partida recién reiniciada. */
  applyUpgrades() {
    const g = this.game;
    const per = (id) => this.level(id) * (this.upgrades.find((u) => u.id === id)?.per ?? 0);
    const p = g.player;
    p.maxHp += per('vida');
    p.hp = p.maxHp;
    g.run.points += per('puntos');
    p.medkits += per('botiquin');
    if (this.level('escopeta') > 0) g.weapons.give('escopeta'); // con su reserva inicial
    g.shop.armeriaDiscount = Math.min(this.cfg.maxDiscount, per('descuento'));
    g.weapons.reloadMul = Math.max(this.cfg.minReloadMul, 1 - per('recarga'));
    g.lighting.flashlightMul = 1 + per('linterna');
    g.build.freeBarricades = per('barricadas');
  }

  dispose() {
    for (const off of this._unsub) off();
  }
}
