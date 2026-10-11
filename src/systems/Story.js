import storyData from '../data/story.json';
import familyData from '../data/familia.json';
import { PHASE } from './DayNight.js';
import { Bag } from './Humor.js';
import { captureRun } from '../save/RunSave.js';

// Historia del turno contada por la radio (15 días con su final y después, modo infinito) y
// llamadas de Ana y de Oliver. Solo lógica: emite 'story:show', 'story:stage' y 'story:hide' con
// lo que hay que enseñar, y `ui/RadioPanel.js` lo pinta. Un solo mensaje a la vez: una llamada
// interrumpe la radio, que vuelve a emitir la línea cortada al colgar.

export const STORY_STATE_VERSION = 1;

/** Segundos que se deja un texto en pantalla según su longitud. */
export function readTime(text, t) {
  return Math.min(t.readMax, Math.max(t.readMin, t.readBase + t.readPerChar * String(text).length));
}

/** Pausa entre líneas para repartir `n` líneas (con `totalRead` s de lectura) en `window` s. */
export function spreadGap(n, totalRead, window, t) {
  if (n <= 1) return t.minGap;
  return Math.min(t.maxGap, Math.max(t.minGap, (window - totalRead) / (n - 1)));
}

/**
 * Índice de la siguiente llamada de `when` ('day' o 'night'; las 'any' valen para los dos) sin
 * repetir hasta agotar las de ese periodo. `used` (Set de índices) se actualiza. -1 si no hay.
 */
export function pickCall(calls, used, when, rnd = Math.random) {
  const fits = (c) => c.when === 'any' || c.when === when;
  const pool = [];
  for (let i = 0; i < calls.length; i++) if (fits(calls[i]) && !used.has(i)) pool.push(i);
  if (!pool.length) {
    for (let i = 0; i < calls.length; i++) if (fits(calls[i])) { used.delete(i); pool.push(i); }
  }
  if (!pool.length) return -1;
  const i = pool[Math.min(pool.length - 1, (rnd() * pool.length) | 0)];
  used.add(i);
  return i;
}

/** ¿Es el peor momento para que suene el móvil? (zombis encima, jefe o poca vida). */
export function isBadMoment({ near, boss, hpFrac }, cfg) {
  return near >= cfg.nearZombies || !!boss || hpFrac <= cfg.lowHp;
}

const line = ([speaker, text], rerun = false) => ({ speaker, text, rerun });

/**
 * Episodio de radio del día `n`: el del guion hasta el día final y, después, uno generado con
 * boletines y reposiciones de días anteriores.
 */
export function buildEpisode(n, data, rnd = Math.random, bulletins = null) {
  const d = n <= data.finalNight ? data.days.find((e) => e.day === n) : null;
  if (d) {
    return {
      day: n, title: d.title, infinite: false,
      lines: d.lines.map((l) => line(l)),
      night: (d.night ?? []).map((l) => line(l)),
      boss: (d.boss ?? []).map((l) => line(l)),
      bossNick: d.bossNick ?? '',
      call: d.call ?? null,
    };
  }
  const inf = data.infinite;
  const bag = bulletins ?? new Bag(inf.bulletins, rnd);
  const lines = [];
  for (let k = 0; k < inf.linesPerDay; k++) {
    if (rnd() < inf.rerunChance && data.days.length) {
      const day = data.days[Math.min(data.days.length - 1, (rnd() * data.days.length) | 0)];
      const l = day.lines[Math.min(day.lines.length - 1, (rnd() * day.lines.length) | 0)];
      lines.push(line(l, true));
    } else {
      lines.push(line(bag.next()));
    }
  }
  const title = inf.titles[Math.min(inf.titles.length - 1, (rnd() * inf.titles.length) | 0)];
  return { day: n, title, infinite: true, lines, night: [], boss: [], bossNick: '', call: null };
}

export class Story {
  /**
   * @param {object} game  necesita bus, dayNight, player y zombies (lo demás es opcional)
   */
  constructor(game, data = storyData, family = familyData, rnd = Math.random) {
    this.game = game;
    this.data = data;
    this.family = family;
    this.rnd = rnd;
    this.t = data.timing;
    this.bulletins = new Bag(data.infinite.bulletins, rnd);
    this.queue = [];
    this.used = new Set();
    this.reset();
    const bus = game.bus;
    this._unsub = [
      bus.on('run:start', () => this.onDay(1)),
      bus.on('phase:dia', ({ night }) => this.onDay(night)),
      bus.on('phase:atardecer', () => this.onDusk()),
      bus.on('phase:noche', ({ night }) => this.onNight(night)),
      bus.on('phase:amanecer', () => { this.pendingCall = null; }),
      bus.on('boss:spawned', () => this.onBoss()),
      bus.on('run:over', () => this.flush()),
    ];
    this.setupDebug();
  }

  dispose() {
    for (const off of this._unsub) off();
  }

  /** Turno nuevo. */
  reset() {
    this.queue.length = 0;
    this.current = null;
    this.wait = 0;
    this.gap = this.t.minGap;
    this.periodT = 0;
    this.pendingCall = null;
    this.endingTimer = -1;
    this.endingShown = false;
    this.used.clear();
    this.day = 1;
    this._ep = null;
    this.game.bus.emit('story:hide');
  }

  get finalNight() { return this.data.finalNight; }
  /** ¿Ya se ha pasado la noche final (modo infinito)? */
  get infinite() { return this.game.dayNight.night > this.data.finalNight; }

  // ------------------------------------------------------------------ guardado
  getState() {
    return { v: STORY_STATE_VERSION, endingShown: this.endingShown, usedCalls: [...this.used] };
  }

  setState(s) {
    if (!s || typeof s !== 'object') return;
    this.endingShown = !!s.endingShown;
    this.used.clear();
    const n = this.family.calls.length;
    for (const i of Array.isArray(s.usedCalls) ? s.usedCalls : []) if (Number.isInteger(i) && i >= 0 && i < n) this.used.add(i);
  }

  // ------------------------------------------------------------------ episodios
  /** Episodio del día n (se guarda el último para que el banner y la radio cuenten lo mismo). */
  episode(n) {
    if (this._ep?.day !== n) this._ep = buildEpisode(n, this.data, this.rnd, this.bulletins);
    return this._ep;
  }

  /** Subtítulo del banner de cada día. */
  dayBanner(n) {
    const ep = this.episode(n);
    return ep.infinite ? `Modo infinito · «${ep.title}»` : `${this.data.bannerPrefix} «${ep.title}»`;
  }

  /** Apodo del jefe de esta noche según el guion ('' si no hay). */
  bossNick() {
    const n = this.game.dayNight.night;
    return n <= this.data.finalNight ? this.episode(n).bossNick : '';
  }

  // ------------------------------------------------------------------ fases
  onDay(n) {
    const { t, family } = this;
    this.day = n;
    this.flush();
    const ep = this.episode(n);
    this.queue.push(...ep.lines);
    let total = 0;
    for (const l of ep.lines) total += readTime(l.text, t);
    const dur = this.game.dayNight.duration;
    this.gap = spreadGap(ep.lines.length, total, dur * t.fill - t.firstDelay, t);
    this.wait = t.firstDelay;
    this.periodT = 0;
    this.pendingCall = null;
    if (ep.call) {
      this.pendingCall = { when: 'day', at: ep.call.at ?? this.randIn(family.day.at), call: ep.call };
    } else if (n >= family.fromDay && this.rnd() < family.day.chance) {
      this.pendingCall = { when: 'day', at: this.randIn(family.day.at) };
    }
    if (n > this.data.finalNight && !this.endingShown) this.endingTimer = this.data.ending.delay;
  }

  /** Al atardecer se acaba el día: lo que quede se emite más seguido y la llamada no espera. */
  onDusk() {
    this.gap = this.t.minGap;
    const p = this.pendingCall;
    if (p?.when === 'day') p.at = Math.min(p.at, this.periodT + this.t.duskCallDelay);
  }

  onNight(n) {
    const { t, family } = this;
    this.periodT = 0;
    this.gap = t.minGap;
    this.pendingCall = null;
    const ep = this.episode(n);
    if (ep.night.length) {
      this.queue.unshift(...ep.night);
      if (!this.current) this.wait = t.nightDelay;
    }
    if (n >= family.fromDay && this.rnd() < family.night.chance) {
      this.pendingCall = { when: 'night', min: family.night.minDelay, max: family.night.maxDelay };
    }
  }

  onBoss() {
    const n = this.game.dayNight.night;
    if (n > this.data.finalNight) return;
    const lines = this.episode(n).boss;
    if (!lines.length) return;
    this.queue.unshift(...lines);
    if (!this.current) this.wait = Math.min(this.wait, this.t.bossDelay);
  }

  /** Línea suelta de la radio irónica de la noche (Humor). Devuelve false si no se puede. */
  radio(text) {
    const m = /^📻\s*([^:]{1,30}):\s*/.exec(text);
    const speaker = (m && this.data.ambientSpeakers[m[1]]) || 'central';
    const body = m ? text.slice(m[0].length) : text;
    if (this.queue.length >= this.t.maxAmbientQueue) return true; // hay cola: se descarta sin ruido
    this.queue.push({ speaker, text: body, rerun: false });
    return true;
  }

  // ------------------------------------------------------------------ mensajes
  randIn([a, b]) { return a + this.rnd() * (b - a); }

  speakerOf(l) {
    const s = this.data.speakers[l.speaker] ?? { name: l.speaker, icon: '📻' };
    return { name: l.rerun ? `${s.name} (${this.data.infinite.rerunTag})` : s.name, icon: s.icon };
  }

  showNext() {
    const l = this.queue.shift();
    const sp = this.speakerOf(l);
    this.current = { kind: 'radio', line: l, who: l.speaker, name: sp.name, icon: sp.icon, text: l.text, t: 0, dur: readTime(l.text, this.t) };
    this.game.bus.emit('story:show', this.current);
    this.game.bus.emit('radio');
  }

  /** Quita lo que haya en pantalla; `gap` = espera hasta el siguiente. */
  finish(gap) {
    this.current = null;
    this.wait = gap;
    this.game.bus.emit('story:hide');
  }

  /** Vacía la radio (cambio de día, fin de turno). */
  flush() {
    this.queue.length = 0;
    if (this.current) this.finish(this.t.minGap);
  }

  /** Tocar el panel: pasa al siguiente mensaje. */
  skip() {
    if (!this.current) return false;
    this.finish(this.t.skipGap);
    return true;
  }

  /** Llamada de la familia: la fija del guion o la siguiente de la lista sin repetir. */
  makeCall(p) {
    const f = this.family;
    let c = p.call;
    if (!c) {
      const i = pickCall(f.calls, this.used, p.when, this.rnd);
      if (i < 0) return null;
      c = f.calls[i];
    }
    const person = f.people[c.who] ?? { name: c.who, icon: '📱' };
    const ring = f.ring.time;
    const tText = readTime(c.text, this.t);
    const replyAt = ring + tText * f.replyAt;
    return {
      kind: 'call', who: c.who, name: person.name, icon: person.icon, text: c.text, reply: c.reply,
      replyName: f.replyName, night: p.when === 'night', stage: 0, t: 0, ring, replyAt,
      dur: replyAt + readTime(c.reply, this.t),
    };
  }

  startCall(p) {
    const item = this.makeCall(p);
    if (!item) return;
    const c = this.current;
    if (c?.kind === 'radio') {
      // La radio cortada se vuelve a emitir después, salvo que ya estuviera casi leída.
      if (c.t < c.dur * this.t.interruptKeep) this.queue.unshift(c.line);
      this.game.bus.emit('story:hide');
    }
    // Primero suena el móvil (2-3 timbrazos, sin posición) y el panel enseña solo "llamada
    // entrante"; el texto llega en la fase 1, pasados `ring.time` s.
    const r = this.family.ring;
    this.game.bus.emit('story:ring', item);
    this.game.audio?.repeat?.(r.sound, r.times, r.gap);
    this.current = item;
    this.game.bus.emit('story:show', item);
  }

  /** Contexto para decidir si es "el peor momento" (sin crear objetos por paso). */
  badMoment() {
    const { player, zombies } = this.game;
    const cfg = this.family.night;
    const px = player.position.x, pz = player.position.z, r2 = cfg.nearRadius * cfg.nearRadius;
    let near = 0;
    for (const z of zombies.active) {
      if (z.state !== 0) continue; // 0 = persiguiendo (vivo)
      const dx = z.pos.x - px, dz = z.pos.z - pz;
      if (dx * dx + dz * dz <= r2) near++;
    }
    const hpFrac = player.maxHp ? player.hp / player.maxHp : 1;
    return isBadMoment({ near, boss: zombies.boss, hpFrac }, cfg);
  }

  callReady(p) {
    if (p.when === 'day') return this.periodT >= p.at;
    if (this.game.dayNight.phase !== PHASE.NIGHT || this.periodT < p.min) return false;
    return this.periodT >= p.max || this.badMoment();
  }

  update(dt) {
    if (!this.game.player.alive) return;
    this.periodT += dt;
    if (this.endingTimer > 0 && (this.endingTimer -= dt) <= 0) {
      this.showEnding();
      return;
    }
    const p = this.pendingCall;
    if (p && this.current?.kind !== 'call' && this.callReady(p)) {
      this.pendingCall = null;
      this.startCall(p);
    }
    const c = this.current;
    if (c) {
      c.t += dt;
      if (c.kind === 'call') {
        const stage = c.t >= c.replyAt ? 2 : c.t >= c.ring ? 1 : 0;
        if (stage !== c.stage) {
          c.stage = stage;
          this.game.bus.emit('story:stage', c);
        }
      }
      if (c.t >= c.dur) this.finish(c.kind === 'call' ? this.t.afterCallGap : this.gap);
    } else if (this.queue.length && (this.wait -= dt) <= 0) {
      this.showNext();
    }
  }

  // ------------------------------------------------------------------ final
  /** Datos de la pantalla final (Menus.screen_ending). */
  endingData() {
    const { run, waves, score } = this.game;
    const e = this.data.ending;
    return {
      title: e.title, subtitle: e.subtitle, paragraphs: e.paragraphs, footer: e.footer, continueLabel: e.continue,
      bonusText: e.bonus ? e.bonusText.replaceAll('{bonus}', String(e.bonus).replace(/\B(?=(\d{3})+(?!\d))/g, '.')) : '',
      nights: run?.nights ?? 0, kills: run?.kills ?? 0, points: run?.points ?? 0, time: run?.time ?? 0,
      bosses: waves?.bossCount ?? 0, maxCombo: score?.maxCombo ?? 0,
    };
  }

  /** Amanecer del día 16: gratificación, guardado y pantalla final; después sigue en modo infinito. */
  showEnding() {
    const g = this.game;
    this.endingTimer = -1;
    this.endingShown = true;
    // Lo que estuviera sonando se repite al volver (los boletines del modo infinito siguen).
    const c = this.current;
    if (c) {
      if (c.kind === 'radio') this.queue.unshift(c.line);
      this.finish(this.t.firstDelay);
    }
    const bonus = this.data.ending.bonus;
    if (bonus) g.score?.addPoints(bonus);
    // Se vuelve a guardar para que "Continuar turno" no repita el final.
    if (g.runSave) {
      try { g.runSave.save(captureRun(g)); } catch (e) { console.warn('No se pudo guardar tras el final', e); }
    }
    g.bus.emit('story:ending');
    g.pause?.();
    g.menus?.show('ending', true, true);
  }

  // ------------------------------------------------------------------ depuración
  setupDebug() {
    const d = this.game.debug;
    if (!d?.addAction) return;
    const g = this.game;
    const sel = { dia: 15 };
    d.folder('Historia').add(sel, 'dia', 1, this.data.finalNight + 3, 1).name('Día');
    d.addAction('Historia', 'Ir a ese día', () => {
      g.dayNight.night = sel.dia;
      g.dayNight.enter(PHASE.DAY);
    });
    d.addAction('Historia', 'Llamada ahora', () => {
      this.startCall({ when: g.dayNight.phase === PHASE.NIGHT ? 'night' : 'day' });
    });
    d.addAction('Historia', 'Ver el final', () => this.showEnding());
  }
}
