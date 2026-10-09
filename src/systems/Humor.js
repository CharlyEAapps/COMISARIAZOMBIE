import humorData from '../data/humor.json';
import { PHASE } from './DayNight.js';

/**
 * Bolsa de frases sin repetición: baraja la lista y la recorre entera antes de volver a
 * barajar (función pura con su propio estado; testeable con un rnd fijo).
 */
export class Bag {
  constructor(list, rnd = Math.random) {
    this.list = list;
    this.rnd = rnd;
    this.order = [];
  }

  next() {
    if (!this.list.length) return '';
    if (!this.order.length) {
      this.order = this.list.map((_, i) => i);
      for (let i = this.order.length - 1; i > 0; i--) {
        const j = (this.rnd() * (i + 1)) | 0;
        [this.order[i], this.order[j]] = [this.order[j], this.order[i]];
      }
    }
    return this.list[this.order.pop()];
  }
}

/** Valor de `humor.json` por ruta con puntos ('events.bossKilled'). */
function at(path) {
  return path.split('.').reduce((o, k) => o?.[k], humorData);
}

// Humor negro e irónico: la central de radio comenta la noche, los zombis sueltan alguna
// frase al caer y los avisos, partes y esquelas llevan su coletilla.
export class Humor {
  constructor(game) {
    this.game = game;
    this.cfg = humorData;
    this.bags = new Map();
    this.reset();
    game.bus.on('phase:noche', () => { this.radioTimer = this.cfg.radio.firstNightDelay; });
    game.bus.on('phase:dia', ({ night }) => { if (night > 1) this.dayTimer = this.cfg.radio.dayDelay; });
    game.bus.on('zombie:killed', (e) => this.onKill(e));
  }

  reset() {
    this.radioTimer = Infinity;
    this.dayTimer = Infinity;
    this.quipReady = 0;
  }

  /** Siguiente frase de la lista `path` (sin repetir hasta agotarla). */
  pick(path) {
    let bag = this.bags.get(path);
    if (!bag) {
      const list = at(path);
      if (!Array.isArray(list)) return '';
      bag = new Bag(list);
      this.bags.set(path, bag);
    }
    return bag.next();
  }

  /** Coletilla para un aviso: ' frase' o ''. */
  tag(event) {
    const s = this.pick(`events.${event}`);
    return s ? ` ${s}` : '';
  }

  /** Frase de un zombi al caer, de vez en cuando (nunca si revienta él solo). */
  onKill({ type, x, z, selfDestruct }) {
    const q = this.cfg.quips;
    if (selfDestruct || !q[type] || this.game.time < this.quipReady || Math.random() > q.chance) return;
    this.quipReady = this.game.time + q.cooldown;
    this.game.floating?.spawn(`«${this.pick(`quips.${type}`)}»`, x, 2.3, z, 'quip', 2.2);
  }

  /** Línea del parte de servicio al amanecer. */
  dawnLine(kills) {
    return this.pick('dawn').replaceAll('{kills}', String(kills));
  }

  update(dt) {
    const { dayNight, hud, player } = this.game;
    if (!player.alive) return;
    if (dayNight.phase === PHASE.NIGHT && (this.radioTimer -= dt) <= 0) {
      const [a, b] = this.cfg.radio.nightInterval;
      this.radioTimer = a + Math.random() * (b - a);
      hud?.toast(this.pick('radio.night'), 7);
      this.game.bus.emit('radio');
    }
    if (dayNight.phase === PHASE.DAY && (this.dayTimer -= dt) <= 0) {
      this.dayTimer = Infinity;
      hud?.toast(this.pick('radio.day'), 7);
      this.game.bus.emit('radio');
    }
  }
}
