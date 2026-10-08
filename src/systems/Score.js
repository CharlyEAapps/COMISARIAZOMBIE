import scoreData from '../data/score.json';

/** Multiplicador de combo (función pura): +comboMultStep cada comboStep bajas seguidas. */
export function comboMultiplier(cfg, combo) {
  return Math.min(cfg.maxMultiplier, 1 + Math.floor(combo / cfg.comboStep) * cfg.comboMultStep);
}

// Puntuación, combos, estadísticas de la noche, bonus al amanecer y "casos" (objetivos).
export class Score {
  constructor(game) {
    this.game = game;
    this.cfg = scoreData;
    this.reset();
    game.bus.on('zombie:killed', (e) => this.onKill(e));
    game.bus.on('player:hurt', ({ amount }) => { this.nightStats.damage += amount; });
    game.bus.on('phase:noche', () => this.resetNightStats());
    game.bus.on('night:survived', ({ night }) => this.onNightSurvived(night));
  }

  reset() {
    this.combo = 0;
    this.comboTimer = 0;
    this.maxCombo = 0;
    this.objective = null;
    this.resetNightStats();
  }

  resetNightStats() {
    this.nightStats = { kills: 0, damage: 0, maxCombo: 0 };
  }

  get multiplier() { return comboMultiplier(this.cfg, this.combo); }

  addPoints(amount, x, z, label) {
    const { run, floating } = this.game;
    run.points += amount;
    if (floating && x !== undefined) floating.spawn(label ?? `+${amount}`, x, 1.9, z, amount >= 0 ? 'pts' : 'neg');
  }

  onKill({ points, x, z }) {
    const { run } = this.game;
    this.combo = this.comboTimer > 0 ? this.combo + 1 : 1;
    this.comboTimer = this.cfg.comboWindow;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.nightStats.maxCombo = Math.max(this.nightStats.maxCombo, this.combo);
    this.nightStats.kills++;
    run.kills++;
    const mult = this.multiplier;
    const pts = Math.round(points * mult);
    this.addPoints(pts, x, z, mult > 1 ? `+${pts} ×${mult}` : `+${pts}`);
  }

  update(dt) {
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }
  }

  /** Acepta un caso aleatorio para la noche que viene (pizarra de casos). */
  pickObjective(night) {
    const list = this.cfg.objectives;
    const o = list[(Math.random() * list.length) | 0];
    const n = o.base + o.perNight * (night - 1);
    this.objective = { id: o.id, n, reward: o.reward, text: o.text.replace('{n}', n), night };
    return this.objective;
  }

  objectiveMet(o = this.objective) {
    if (!o) return false;
    const s = this.nightStats;
    if (o.id === 'kills') return s.kills >= o.n;
    if (o.id === 'maxDamage') return s.damage < o.n;
    if (o.id === 'combo') return s.maxCombo >= o.n;
    return false;
  }

  onNightSurvived(night) {
    const { game } = this;
    const lines = [];
    const bonus = this.cfg.nightBonusBase * night;
    lines.push(`Noche superada +${bonus}`);
    let total = bonus;
    if (this.nightStats.damage === 0) {
      const nd = this.cfg.noDamageBonusBase * night;
      lines.push(`Sin un rasguño +${nd}`);
      total += nd;
    }
    if (this.objective && this.objective.night === night) {
      if (this.objectiveMet()) {
        lines.push(`Caso resuelto +${this.objective.reward}`);
        total += this.objective.reward;
      } else {
        lines.push('Caso sin resolver');
      }
      this.objective = null;
    }
    game.run.points += total;
    game.run.nights = night;
    game.bus.emit('score:nightSummary', { night, lines, total });
  }
}
