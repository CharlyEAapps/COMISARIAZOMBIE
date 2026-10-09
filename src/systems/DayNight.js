// Ciclo día → atardecer → noche → amanecer. Lógica pura (sin Three.js) para poder testearla.
// La noche solo termina cuando se ha agotado su tiempo Y no queda ningún zombi de la oleada.
export const PHASE = { DAY: 'dia', DUSK: 'atardecer', NIGHT: 'noche', DAWN: 'amanecer' };

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class DayNight {
  /** @param {object} cfg daynight.json  @param {{emit:Function}} bus */
  constructor(cfg, bus) {
    this.cfg = cfg;
    this.bus = bus;
    this.reset();
  }

  reset() {
    this.night = 1; // número de la noche que viene (o en curso)
    this.phase = PHASE.DAY;
    this.t = 0;
    this.duration = this.cfg.firstDayDuration;
  }

  get day() { return this.night; }
  get progress() { return Math.min(1, this.t / this.duration); }
  get isNight() { return this.phase === PHASE.NIGHT; }

  nightDuration(n) {
    const c = this.cfg;
    return Math.min(c.nightMaxDuration, c.nightBaseDuration + c.nightDurationPerNight * (n - 1));
  }

  durationOf(phase) {
    const c = this.cfg;
    if (phase === PHASE.DAY) return this.night === 1 ? c.firstDayDuration : c.dayDuration;
    if (phase === PHASE.DUSK) return c.duskDuration;
    if (phase === PHASE.NIGHT) return this.nightDuration(this.night);
    return c.dawnDuration;
  }

  enter(phase) {
    this.phase = phase;
    this.t = 0;
    this.duration = this.durationOf(phase);
    this.bus?.emit(`phase:${phase}`, { night: this.night, duration: this.duration });
  }

  /** @param {() => boolean} nightCleared ¿se ha generado y abatido toda la oleada? */
  update(dt, nightCleared) {
    this.t += dt;
    switch (this.phase) {
      case PHASE.DAY:
        if (this.t >= this.duration) this.enter(PHASE.DUSK);
        break;
      case PHASE.DUSK:
        if (this.t >= this.duration) this.enter(PHASE.NIGHT);
        break;
      case PHASE.NIGHT:
        // La noche acaba al abatir a toda la horda (o, si no, al acabarse el tiempo y la horda).
        if ((this.cfg.nightEndsWhenCleared ? this.t >= this.cfg.nightMinTime : this.t >= this.duration) && nightCleared()) {
          this.bus?.emit('night:survived', { night: this.night });
          this.enter(PHASE.DAWN);
        }
        break;
      case PHASE.DAWN:
        if (this.t >= this.duration) {
          this.night++;
          this.enter(PHASE.DAY);
        }
        break;
    }
  }

  /** "Estoy listo": adelanta el atardecer. */
  skipDay() {
    if (this.phase === PHASE.DAY) this.enter(PHASE.DUSK);
  }

  /** Hora del reloj del juego (0–24, con decimales). */
  clockHours() {
    const c = this.cfg.clock;
    const p = this.progress;
    const lerp = (a, b) => a + (b - a) * p;
    let h;
    if (this.phase === PHASE.DAY) h = lerp(c.dayStart, c.duskStart);
    else if (this.phase === PHASE.DUSK) h = lerp(c.duskStart, c.nightStart);
    else if (this.phase === PHASE.NIGHT) h = lerp(c.nightStart, c.nightEnd + 24);
    else h = lerp(c.nightEnd, c.dayStart);
    return h % 24;
  }

  formatClock() {
    const h = this.clockHours();
    const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  /** 0 = pleno día, 1 = noche cerrada. */
  nightFactor() {
    const p = this.progress;
    if (this.phase === PHASE.DAY) return 0;
    if (this.phase === PHASE.DUSK) return smooth(0.35, 1, p);
    if (this.phase === PHASE.NIGHT) return 1;
    return 1 - smooth(0, 0.8, p);
  }

  /** Paletas a mezclar para la iluminación: { from, to, t }. */
  paletteBlend() {
    const p = this.progress;
    switch (this.phase) {
      case PHASE.DAY: return { from: 'dia', to: 'dia', t: 0 };
      case PHASE.DUSK: return p < 0.5 ? { from: 'dia', to: 'atardecer', t: p * 2 } : { from: 'atardecer', to: 'noche', t: (p - 0.5) * 2 };
      case PHASE.NIGHT: return { from: 'noche', to: 'noche', t: 0 };
      default: return p < 0.5 ? { from: 'noche', to: 'atardecer', t: p * 2 } : { from: 'atardecer', to: 'dia', t: (p - 0.5) * 2 };
    }
  }
}
