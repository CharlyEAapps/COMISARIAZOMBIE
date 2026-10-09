import { describe, it, expect, vi } from 'vitest';
import daynight from '../src/data/daynight.json';
import waves from '../src/data/waves.json';
import score from '../src/data/score.json';
import interactions from '../src/data/interactions.json';
import { DayNight, PHASE } from '../src/systems/DayNight.js';
import { nightCount, pickType } from '../src/systems/WaveDirector.js';
import { comboMultiplier } from '../src/systems/Score.js';
import { weightedPick } from '../src/systems/InteractionSystem.js';
import { EventBus } from '../src/core/EventBus.js';

const run = (dn, seconds, cleared = () => true) => {
  for (let t = 0; t < seconds; t += 0.1) dn.update(0.1, cleared);
};

describe('DayNight', () => {
  it('recorre día → atardecer → noche → amanecer → día 2', () => {
    const bus = new EventBus();
    const phases = [];
    for (const p of Object.values(PHASE)) bus.on(`phase:${p}`, () => phases.push(p));
    const dn = new DayNight({ ...daynight, nightEndsWhenCleared: false }, bus);
    expect(dn.phase).toBe(PHASE.DAY);
    run(dn, daynight.firstDayDuration + daynight.duskDuration + dn.nightDuration(1) + daynight.dawnDuration + 0.5);
    expect(phases).toEqual([PHASE.DUSK, PHASE.NIGHT, PHASE.DAWN, PHASE.DAY]);
    expect(dn.night).toBe(2);
  });

  it('con nightEndsWhenCleared, la noche acaba al abatir la horda (tras el mínimo)', () => {
    const dn = new DayNight({ ...daynight, nightEndsWhenCleared: true, nightMinTime: 5 }, null);
    dn.enter(PHASE.NIGHT);
    dn.update(1, () => true);
    expect(dn.phase).toBe(PHASE.NIGHT);
    run(dn, 5, () => true);
    expect(dn.phase).toBe(PHASE.DAWN);
  });

  it('la noche no termina mientras queden zombis', () => {
    const dn = new DayNight(daynight, null);
    dn.enter(PHASE.NIGHT);
    run(dn, dn.duration + 30, () => false);
    expect(dn.phase).toBe(PHASE.NIGHT);
    dn.update(0.1, () => true);
    expect(dn.phase).toBe(PHASE.DAWN);
  });

  it('emite night:survived con el número de noche', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    bus.on('night:survived', fn);
    const dn = new DayNight(daynight, bus);
    dn.enter(PHASE.NIGHT);
    run(dn, dn.duration + 1);
    expect(fn).toHaveBeenCalledWith({ night: 1 });
  });

  it('skipDay solo actúa de día', () => {
    const dn = new DayNight(daynight, null);
    dn.skipDay();
    expect(dn.phase).toBe(PHASE.DUSK);
    dn.skipDay();
    expect(dn.phase).toBe(PHASE.DUSK);
  });

  it('el reloj y el factor de noche son coherentes', () => {
    const dn = new DayNight(daynight, null);
    expect(dn.formatClock()).toBe('07:00');
    expect(dn.nightFactor()).toBe(0);
    dn.enter(PHASE.NIGHT);
    expect(dn.nightFactor()).toBe(1);
    expect(dn.formatClock()).toBe('21:00');
    dn.t = dn.duration;
    expect(dn.formatClock()).toBe('05:00');
  });

  it('la duración de la noche crece y tiene tope', () => {
    const dn = new DayNight(daynight, null);
    expect(dn.nightDuration(2)).toBeGreaterThan(dn.nightDuration(1));
    expect(dn.nightDuration(100)).toBe(daynight.nightMaxDuration);
  });
});

describe('Oleadas', () => {
  it('cada noche trae más zombis', () => {
    let prev = 0;
    for (let n = 1; n <= 15; n++) {
      const c = nightCount(waves.night, n);
      expect(c).toBeGreaterThan(prev);
      prev = c;
    }
    expect(nightCount(waves.night, 1)).toBe(waves.night.baseCount);
  });

  it('pickType respeta fromNight', () => {
    const types = [{ type: 'a', weight: 1, fromNight: 1 }, { type: 'b', weight: 100, fromNight: 5 }];
    for (let i = 0; i < 20; i++) expect(pickType(types, 1)).toBe('a');
    expect(pickType(types, 5, () => 0.99)).toBe('b');
  });
});

describe('Puntuación', () => {
  it('el caso de bajas siempre es alcanzable con la horda de esa noche', () => {
    const o = score.objectives.find((x) => x.id === 'kills');
    for (let n = 1; n <= 20; n++) expect(o.base + o.perNight * (n - 1)).toBeLessThanOrEqual(nightCount(waves.night, n));
  });

  it('el multiplicador de combo sube por tramos y tiene tope', () => {
    expect(comboMultiplier(score, 1)).toBe(1);
    expect(comboMultiplier(score, score.comboStep)).toBe(1 + score.comboMultStep);
    expect(comboMultiplier(score, 1000)).toBe(score.maxMultiplier);
  });
});

describe('Interacciones', () => {
  it('weightedPick respeta los pesos', () => {
    const list = [{ w: 1, id: 'a' }, { w: 3, id: 'b' }];
    expect(weightedPick(list, () => 0.1).id).toBe('a');
    expect(weightedPick(list, () => 0.5).id).toBe('b');
  });

  it('todas las interacciones tienen etiqueta y un efecto', () => {
    for (const [k, v] of Object.entries(interactions)) {
      if (k.startsWith('_')) continue;
      expect(v.label, k).toBeTruthy();
      expect(Object.keys(v.effect ?? {}).length, k).toBeGreaterThan(0);
    }
  });
});

describe('InteractionSystem.apply (con un juego simulado)', async () => {
  const { InteractionSystem } = await import('../src/systems/InteractionSystem.js');
  const makeGame = () => {
    const bus = new EventBus();
    return {
      bus,
      time: 0,
      run: { points: 0 },
      power: { generator: false, lightsOn: true },
      player: { medkits: 0, hp: 100, maxHp: 100, stamina: 0, data: { maxStamina: 100 }, heal() {}, addBuff() {} },
      score: { addPoints(n) { this.total = (this.total ?? 0) + n; } },
      dayNight: { phase: PHASE.DAY, night: 1 },
      waves: { dominantSide: () => 'norte', forecast: () => 14, remaining: 0 },
      hud: { toast() {} },
      zombies: { setDecoy() {} },
      lighting: { triggerAlarm() {} },
    };
  };

  it('un botín con informe incluye el texto del informe', () => {
    const g = makeGame();
    const sys = new InteractionSystem(g);
    const msg = sys.apply({ loot: [{ w: 1, intel: true, msg: '📁 Informe' }] }, { x: 0, z: 0 });
    expect(msg).toMatch(/^📁 Informe: 📻 Noche 1: se esperan unos 14 zombis/);
  });

  it('un botiquín de botín con el inventario lleno se convierte en puntos', () => {
    const g = makeGame();
    g.player.medkits = interactions._medkit.max;
    const sys = new InteractionSystem(g);
    const msg = sys.apply({ loot: [{ w: 1, medkit: 1, msg: 'botiquín' }] }, { x: 0, z: 0 });
    expect(g.player.medkits).toBe(interactions._medkit.max);
    expect(g.score.total).toBe(interactions._medkit.fullLootPoints);
    expect(msg).toMatch(/máximo/);
  });

  it('en el amanecer la radio habla de la noche siguiente', () => {
    const g = makeGame();
    g.dayNight = { phase: PHASE.DAWN, night: 3 };
    let asked;
    g.waves.forecast = (n) => { asked = n; return 30; };
    const sys = new InteractionSystem(g);
    expect(sys.intelMessage()).toMatch(/Noche 4/);
    expect(asked).toBe(4);
  });
});
