import { describe, it, expect, vi } from 'vitest';
import story from '../src/data/story.json';
import familia from '../src/data/familia.json';
import waves from '../src/data/waves.json';
import daynight from '../src/data/daynight.json';
import audio from '../src/data/audio.json';
import { RECIPES } from '../src/audio/Synth.js';
import { EventBus } from '../src/core/EventBus.js';
import { DayNight, PHASE } from '../src/systems/DayNight.js';
import { Humor } from '../src/systems/Humor.js';
import { isBossNight } from '../src/systems/WaveDirector.js';
import { Story, readTime, spreadGap, pickCall, isBadMoment, buildEpisode } from '../src/systems/Story.js';

const T = story.timing;

/** Juego mínimo para la historia: bus, ciclo real, jugador y zombis de mentira. */
function fakeGame() {
  const bus = new EventBus();
  const g = {
    bus,
    dayNight: new DayNight(daynight, bus),
    player: { alive: true, position: { x: 0, z: 0 }, hp: 100, maxHp: 100 },
    zombies: { active: [], boss: null },
    run: { nights: 15, kills: 900, points: 5000, time: 3600 },
    waves: { bossCount: 3 },
    score: { maxCombo: 12, addPoints: vi.fn() },
    pause: vi.fn(),
    menus: { show: vi.fn() },
  };
  g.shown = [];
  bus.on('story:show', (it) => g.shown.push({ ...it }));
  return g;
}

/** Avanza la historia `s` segundos en pasos de 1/60. */
function advance(st, s) {
  for (let k = 0, n = Math.round(s * 60); k < n; k++) st.update(1 / 60);
}

/** Generador pseudoaleatorio fijo (tests reproducibles). */
function seeded(seed = 1) {
  let x = seed;
  return () => ((x = (x * 16807) % 2147483647) - 1) / 2147483646;
}

describe('Historia: datos', () => {
  it('hay un episodio por día del 1 al día final, con título y varias líneas', () => {
    expect(story.finalNight).toBe(15);
    expect(story.days.map((d) => d.day)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    for (const d of story.days) {
      expect(d.title.length, `día ${d.day}`).toBeGreaterThan(2);
      expect(d.lines.length, `día ${d.day}`).toBeGreaterThanOrEqual(5);
    }
  });

  it('todas las líneas tienen locutor conocido y caben en el panel del móvil', () => {
    const all = [
      ...story.days.flatMap((d) => [...d.lines, ...(d.night ?? []), ...(d.boss ?? [])]),
      ...story.infinite.bulletins,
    ];
    for (const [who, text] of all) {
      expect(story.speakers[who], who).toBeTruthy();
      expect(text.length, text).toBeLessThanOrEqual(160);
    }
    expect(story.infinite.bulletins.length).toBeGreaterThanOrEqual(15);
  });

  it('las noches de jefe del guion tienen apodo y aviso por radio, y la final es noche de jefe', () => {
    for (const d of story.days) {
      if (!isBossNight(waves.boss, d.day)) continue;
      expect(d.bossNick, `día ${d.day}`).toBeTruthy();
      expect(d.boss?.length, `día ${d.day}`).toBeGreaterThan(0);
    }
    expect(isBossNight(waves.boss, story.finalNight)).toBe(true);
  });

  it('el final tiene texto, gratificación y botón de seguir', () => {
    const e = story.ending;
    expect(e.paragraphs.length).toBeGreaterThanOrEqual(4);
    expect(e.bonusText).toContain('{bonus}');
    expect(e.continue.length).toBeGreaterThan(3);
    expect(e.paragraphs.join(' ')).toContain('Carlos');
  });
});

describe('Llamadas de la familia: datos', () => {
  const calls = familia.calls;

  it('al menos 50 llamadas, todas con frase y respuesta de Carlos', () => {
    expect(calls.length).toBeGreaterThanOrEqual(50);
    for (const c of calls) {
      expect(['ana', 'oliver']).toContain(c.who);
      expect(['day', 'night', 'any']).toContain(c.when);
      expect(c.text.length).toBeGreaterThan(5);
      expect(c.reply.length).toBeGreaterThan(5);
      expect(c.text.length + c.reply.length, c.text).toBeLessThanOrEqual(200);
    }
  });

  it('no hay frases repetidas y llaman los dos, de día y de noche', () => {
    expect(new Set(calls.map((c) => c.text)).size).toBe(calls.length);
    for (const who of ['ana', 'oliver']) {
      for (const when of ['day', 'night']) expect(calls.some((c) => c.who === who && c.when === when), `${who} ${when}`).toBe(true);
    }
    for (const who of Object.keys(familia.people)) expect(familia.people[who].name).toBeTruthy();
  });

  it('las llamadas fijas del guion son de Ana o de Oliver', () => {
    for (const d of story.days.filter((e) => e.call)) {
      expect(familia.people[d.call.who], `día ${d.day}`).toBeTruthy();
      expect(d.call.reply.length).toBeGreaterThan(5);
    }
  });
});

describe('Historia: lógica pura', () => {
  it('el tiempo de lectura crece con el texto y tiene tope', () => {
    expect(readTime('hola', T)).toBe(T.readMin);
    expect(readTime('x'.repeat(100), T)).toBeCloseTo(T.readBase + T.readPerChar * 100);
    expect(readTime('x'.repeat(5000), T)).toBe(T.readMax);
  });

  it('las líneas se reparten por el día con pausas acotadas', () => {
    expect(spreadGap(5, 40, 76, T)).toBeCloseTo(9);
    expect(spreadGap(5, 40, 1000, T)).toBe(T.maxGap);
    expect(spreadGap(5, 40, 10, T)).toBe(T.minGap);
    expect(spreadGap(1, 8, 76, T)).toBe(T.minGap);
  });

  it('las llamadas no se repiten hasta agotar las de su periodo', () => {
    const calls = [
      { when: 'day' }, { when: 'day' }, { when: 'night' }, { when: 'any' }, { when: 'day' },
    ];
    const used = new Set();
    const rnd = seeded(7);
    const day = [];
    for (let k = 0; k < 4; k++) day.push(pickCall(calls, used, 'day', rnd));
    expect(new Set(day)).toEqual(new Set([0, 1, 3, 4]));
    expect(pickCall(calls, used, 'night', rnd)).toBe(2);
    // Agotadas las de día, se vuelve a empezar.
    expect([0, 1, 3, 4]).toContain(pickCall(calls, used, 'day', rnd));
    expect(pickCall([], new Set(), 'day')).toBe(-1);
  });

  it('el peor momento: zombis encima, jefe o poca vida', () => {
    const cfg = familia.night;
    expect(isBadMoment({ near: 0, boss: null, hpFrac: 1 }, cfg)).toBe(false);
    expect(isBadMoment({ near: cfg.nearZombies, boss: null, hpFrac: 1 }, cfg)).toBe(true);
    expect(isBadMoment({ near: 0, boss: {}, hpFrac: 1 }, cfg)).toBe(true);
    expect(isBadMoment({ near: 0, boss: null, hpFrac: cfg.lowHp }, cfg)).toBe(true);
  });

  it('después del día final, episodios de boletines y reposiciones', () => {
    const ep = buildEpisode(story.finalNight + 1, story, seeded(3));
    expect(ep.infinite).toBe(true);
    expect(ep.lines.length).toBe(story.infinite.linesPerDay);
    expect(ep.bossNick).toBe('');
    const reruns = [];
    for (let s = 1; s < 40; s++) reruns.push(...buildEpisode(20, story, seeded(s)).lines.filter((l) => l.rerun));
    expect(reruns.length).toBeGreaterThan(0);
    expect(buildEpisode(5, story).bossNick).toBe(story.days[4].bossNick);
  });
});

describe('Historia: radio, llamadas y final', () => {
  it('el día 1 empieza la radio tras la espera inicial y se puede pasar tocando', () => {
    const g = fakeGame();
    const st = new Story(g, story, familia, seeded(2));
    g.bus.emit('run:start');
    advance(st, T.firstDelay - 0.2);
    expect(g.shown.length).toBe(0);
    advance(st, 0.4);
    expect(g.shown[0].kind).toBe('radio');
    expect(g.shown[0].text).toBe(story.days[0].lines[0][1]);
    expect(g.shown[0].name).toBe(story.speakers.central.name);
    expect(st.skip()).toBe(true);
    expect(st.current).toBeNull();
    advance(st, T.skipGap + 0.05);
    expect(g.shown[1].text).toBe(story.days[0].lines[1][1]);
  });

  it('la llamada fija de Ana interrumpe la radio, enseña la respuesta de Carlos y la radio sigue', () => {
    const g = fakeGame();
    const st = new Story(g, story, familia, seeded(2));
    g.bus.emit('run:start');
    const call = story.days[0].call;
    advance(st, call.at - 0.1);
    const before = st.current;
    advance(st, 0.2);
    expect(st.current.kind).toBe('call');
    expect(st.current.name).toBe('Ana');
    expect(st.current.stage).toBe(0); // sonando
    advance(st, familia.ring.time + 0.1);
    expect(st.current.stage).toBe(1);
    advance(st, st.current.replyAt - st.current.t + 0.05);
    expect(st.current.stage).toBe(2);
    expect(st.current.reply).toBe(call.reply);
    expect(st.current.replyName).toBe('Carlos');
    advance(st, st.current.dur);
    // La línea cortada (si estaba a medias) vuelve a emitirse.
    if (before?.kind === 'radio' && before.t < before.dur * T.interruptKeep) {
      advance(st, T.afterCallGap + 0.1);
      expect(st.current?.text).toBe(before.text);
    }
  });

  it('antes del texto de la llamada suena el tono de móvil (2-3 timbrazos, 1,5-2 s)', () => {
    const g = fakeGame();
    const order = [];
    g.audio = { repeat: vi.fn((name) => order.push(`sonido:${name}`)) };
    g.bus.on('story:ring', () => order.push('ring'));
    g.bus.on('story:stage', (it) => order.push(`fase${it.stage}`));
    const st = new Story(g, story, familia, seeded(11));
    g.dayNight.night = 4;
    g.dayNight.enter(PHASE.DAY);
    st.startCall({ when: 'day' });
    const r = familia.ring;
    expect(g.audio.repeat).toHaveBeenCalledWith('phone_ring', r.times, r.gap);
    expect(r.times).toBeGreaterThanOrEqual(2);
    expect(r.times).toBeLessThanOrEqual(3);
    // Duración real del tono: timbrazos repetidos con la receta sintetizada.
    const toneLen = (r.times - 1) * r.gap + RECIPES[r.sound][0];
    expect(toneLen).toBeGreaterThanOrEqual(1.5);
    expect(toneLen).toBeLessThanOrEqual(2);
    expect(r.time).toBeGreaterThanOrEqual(toneLen);
    // Mientras suena no hay texto; sale al acabar el tono.
    expect(st.current.stage).toBe(0);
    advance(st, r.time - 0.05);
    expect(st.current.stage).toBe(0);
    advance(st, 0.1);
    expect(st.current.stage).toBe(1);
    expect(order.slice(0, 3)).toEqual(['ring', 'sonido:phone_ring', 'fase1']);
    expect(audio.sounds.phone_ring.vol).toBeLessThanOrEqual(0.5);
  });

  it('de noche la llamada espera al peor momento (o al tope)', () => {
    const g = fakeGame();
    const st = new Story(g, story, familia, () => 0); // siempre llaman
    g.dayNight.night = 3;
    g.dayNight.enter(PHASE.NIGHT);
    expect(st.pendingCall?.when).toBe('night');
    advance(st, familia.night.minDelay + 1);
    expect(st.current?.kind).not.toBe('call');
    // Cuatro zombis encima: suena.
    for (let k = 0; k < familia.night.nearZombies; k++) g.zombies.active.push({ state: 0, pos: { x: 1, z: 1 } });
    advance(st, 0.1);
    expect(st.current.kind).toBe('call');
    expect(st.current.night).toBe(true);
    expect(familia.calls.find((c) => c.text === st.current.text).when).not.toBe('day');

    // Sin peligro, suena igualmente al llegar al tope.
    const g2 = fakeGame();
    const st2 = new Story(g2, story, familia, () => 0);
    g2.dayNight.night = 3;
    g2.dayNight.enter(PHASE.NIGHT);
    advance(st2, familia.night.maxDelay + 0.1);
    expect(st2.current?.kind).toBe('call');
  });

  it('una llamada por periodo como mucho y nunca el día 1 al azar', () => {
    const g = fakeGame();
    const st = new Story(g, story, familia, () => 0);
    g.dayNight.night = 4;
    g.dayNight.enter(PHASE.DAY);
    advance(st, 90);
    const calls = g.shown.filter((s) => s.kind === 'call').length;
    expect(calls).toBe(1);
    const g1 = fakeGame();
    const st1 = new Story({ ...g1 }, { ...story, days: story.days.map((d) => ({ ...d, call: null })) }, familia, () => 0);
    g1.bus.emit('run:start');
    expect(st1.pendingCall).toBeNull();
  });

  it('el jefe de las noches del guion lleva su nombre, y la radio lo anuncia al aparecer', () => {
    const g = fakeGame();
    const st = new Story(g, story, familia, seeded(4));
    g.humor = new Humor(g);
    g.story = st;
    for (const n of [5, 10, 15]) {
      g.dayNight.night = n;
      expect(st.bossNick()).toBe(story.days[n - 1].bossNick);
      expect(g.humor.pick('bossNames')).toBe(story.days[n - 1].bossNick);
    }
    g.dayNight.night = 20;
    expect(st.bossNick()).toBe('');
    g.dayNight.night = 15;
    g.dayNight.enter(PHASE.NIGHT);
    st.queue.length = 0;
    g.bus.emit('boss:spawned', { type: 'antidisturbios', appearance: 3 });
    advance(st, T.bossDelay + 0.1);
    expect(st.current.text).toBe(story.days[14].boss[0][1]);
  });

  it('la radio irónica de la noche entra en el panel con su locutor', () => {
    const g = fakeGame();
    const st = new Story(g, story, familia, seeded(5));
    expect(st.radio('📻 Central: prueba de radio')).toBe(true);
    expect(st.queue.at(-1)).toEqual({ speaker: 'central', text: 'prueba de radio', rerun: false });
    st.radio('📻 Central: dos');
    st.radio('📻 Central: tres'); // cola llena: se descarta
    expect(st.queue.length).toBe(T.maxAmbientQueue);
  });

  it('al amanecer del día 16 sale el final una sola vez, con gratificación, y luego modo infinito', () => {
    const g = fakeGame();
    const st = new Story(g, story, familia, seeded(6));
    g.dayNight.night = story.finalNight + 1;
    g.dayNight.enter(PHASE.DAY);
    expect(st.infinite).toBe(true);
    expect(st.dayBanner(story.finalNight + 1)).toContain('Modo infinito');
    advance(st, story.ending.delay + 0.1);
    expect(st.endingShown).toBe(true);
    expect(g.pause).toHaveBeenCalledTimes(1);
    expect(g.menus.show).toHaveBeenCalledWith('ending', true, true);
    expect(g.score.addPoints).toHaveBeenCalledWith(story.ending.bonus);
    const e = st.endingData();
    expect(e.nights).toBe(15);
    expect(e.bonusText).toContain('1.000');
    // Los boletines siguen tras el final.
    advance(st, 20);
    expect(g.shown.some((s) => s.kind === 'radio')).toBe(true);
    // Día 17: no se repite.
    g.dayNight.night++;
    g.dayNight.enter(PHASE.DAY);
    advance(st, story.ending.delay + 1);
    expect(g.pause).toHaveBeenCalledTimes(1);
  });

  it('getState/setState: final visto y llamadas oídas (y saneado)', () => {
    const g = fakeGame();
    const st = new Story(g, story, familia, seeded(8));
    st.endingShown = true;
    st.used.add(3).add(10);
    const saved = JSON.parse(JSON.stringify(st.getState()));
    const st2 = new Story(fakeGame(), story, familia, seeded(8));
    st2.setState(saved);
    expect(st2.endingShown).toBe(true);
    expect([...st2.used].sort((a, b) => a - b)).toEqual([3, 10]);
    st2.setState({ endingShown: 0, usedCalls: [-1, 1.5, 'x', 9999, 2] });
    expect(st2.endingShown).toBe(false);
    expect([...st2.used]).toEqual([2]);
    expect(() => st2.setState(null)).not.toThrow();
    // Un turno nuevo lo olvida todo.
    st2.reset();
    expect(st2.used.size).toBe(0);
  });

  it('el banner de cada día del guion anuncia el episodio', () => {
    const st = new Story(fakeGame(), story, familia, seeded(9));
    expect(st.dayBanner(5)).toContain(story.days[4].title);
    expect(st.dayBanner(5)).toContain(story.bannerPrefix);
  });

  it('muerto, la radio se calla', () => {
    const g = fakeGame();
    const st = new Story(g, story, familia, seeded(10));
    g.bus.emit('run:start');
    g.player.alive = false;
    advance(st, 10);
    expect(g.shown.length).toBe(0);
    g.bus.emit('run:over', {});
    expect(st.queue.length).toBe(0);
  });
});
