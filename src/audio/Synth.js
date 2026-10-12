// Efectos de sonido sintetizados por código (Web Audio, OfflineAudioContext). Cada receta
// dibuja un sonido corto con ruido, osciladores, filtros y envolventes; se renderizan una vez
// al arrancar y luego se reproducen como AudioBuffer (igual que un archivo).
//
// Las recetas son diseño de sonido (no equilibrado de juego): sus números viven aquí.

export const SAMPLE_RATE = 22050;

/** Utilidades de síntesis sobre un OfflineAudioContext. */
class Kit {
  constructor(ctx) {
    this.ctx = ctx;
    this.out = ctx.destination;
    const n = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }

  /** Envolvente de ganancia: [[t, v], ...] (rampas exponenciales; v=0 se trata como 0,0001). */
  env(points, base = 0) {
    const g = this.ctx.createGain();
    const p = g.gain;
    p.setValueAtTime(base, 0);
    let first = true;
    for (const [t, v] of points) {
      const val = Math.max(1e-4, v);
      if (first) { p.setValueAtTime(val, t); first = false; } else p.exponentialRampToValueAtTime(val, t);
    }
    return g;
  }

  /** Envolvente percusiva: ataque, pico y caída exponencial. */
  perc(t0, attack, peak, decay) {
    return this.env([[t0, 1e-4], [t0 + attack, peak], [t0 + attack + decay, 1e-4]]);
  }

  noise(t0, dur) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    s.start(t0, Math.random());
    s.stop(t0 + dur);
    return s;
  }

  osc(type, freq, t0, dur, endFreq) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur);
    o.start(t0);
    o.stop(t0 + dur);
    return o;
  }

  filter(type, freq, q = 1, endFreq, t0 = 0, dur = 0) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (endFreq) f.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur);
    f.Q.value = q;
    return f;
  }

  /** Conecta en cadena y al final a la salida. */
  chain(...nodes) {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
    nodes[nodes.length - 1].connect(this.out);
    return nodes[0];
  }

  // -------------------------------------------------------------- bloques reutilizables
  /** Golpe de ruido filtrado. */
  burst(t0, dur, type, freq, q, peak, endFreq) {
    this.chain(this.noise(t0, dur + 0.02), this.filter(type, freq, q, endFreq, t0, dur), this.perc(t0, 0.002, peak, dur));
  }

  /** Golpe tonal con caída de tono (bombo, golpe sordo). */
  thump(t0, f0, f1, dur, peak, type = 'sine') {
    this.chain(this.osc(type, f0, t0, dur + 0.02, f1), this.perc(t0, 0.003, peak, dur));
  }

  /** Campanita metálica inarmónica. */
  ping(t0, f, dur, peak) {
    for (const [m, a] of [[1, 1], [1.52, 0.6], [2.37, 0.35]]) this.chain(this.osc('triangle', f * m, t0, dur + 0.02), this.perc(t0, 0.001, peak * a, dur));
  }

  /** Clic mecánico. */
  click(t0, peak = 0.5, freq = 3500) {
    this.burst(t0, 0.025, 'highpass', freq, 0.7, peak);
  }

  /** Voz de zombi: diente de sierra con vibrato a través de dos formantes. */
  groan(t0, dur, f0, f1, formants, peak, rough = 0.3) {
    const o = this.osc('sawtooth', f0, t0, dur + 0.05, f1);
    const lfo = this.osc('sine', 4 + Math.random() * 3, t0, dur + 0.05);
    const depth = this.ctx.createGain();
    depth.gain.value = f0 * 0.06;
    lfo.connect(depth).connect(o.frequency);
    const g = this.env([[t0, 1e-4], [t0 + dur * 0.2, peak], [t0 + dur * 0.7, peak * 0.7], [t0 + dur, 1e-4]]);
    for (const [ff, q, a] of formants) {
      const bp = this.filter('bandpass', ff, q);
      const amp = this.ctx.createGain();
      amp.gain.value = a;
      o.connect(bp).connect(amp).connect(g);
    }
    // Aspereza: ruido grave modulado.
    const n = this.noise(t0, dur + 0.05);
    const nf = this.filter('bandpass', formants[0][0], 1.5);
    const na = this.ctx.createGain();
    na.gain.value = rough;
    n.connect(nf).connect(na).connect(g);
    g.connect(this.out);
  }

  /** Disparo: chasquido + cuerpo de ruido grave + golpe de baja frecuencia. */
  gunshot(t0, { crack = 0.8, body = 900, len = 0.25, boom = 0.9, low = 70, tail = 0 }) {
    this.burst(t0, 0.05, 'highpass', 2500, 0.7, crack);
    this.burst(t0, len, 'lowpass', body, 0.8, boom, body * 0.3);
    this.thump(t0, low * 1.8, low * 0.6, len * 0.6, boom * 0.8);
    if (tail) this.burst(t0 + 0.04, tail, 'lowpass', 500, 0.5, boom * 0.25, 150); // eco
  }
}

/** Recetas: nombre → [duración, (kit) => void]. */
export const RECIPES = {
  // ---------------------------------------------------------------- armas
  shot_pistola: [0.4, (k) => k.gunshot(0, { crack: 0.7, body: 1300, len: 0.22, boom: 0.85, low: 90 })],
  shot_escopeta: [0.8, (k) => k.gunshot(0, { crack: 0.9, body: 700, len: 0.45, boom: 1, low: 55, tail: 0.3 })],
  shot_subfusil: [0.25, (k) => k.gunshot(0, { crack: 0.6, body: 1700, len: 0.12, boom: 0.6, low: 110 })],
  shot_fusil: [0.45, (k) => k.gunshot(0, { crack: 0.9, body: 1100, len: 0.2, boom: 0.85, low: 80 })],
  shot_francotirador: [1.1, (k) => k.gunshot(0, { crack: 1, body: 900, len: 0.35, boom: 1, low: 60, tail: 0.6 })],
  shot_torreta: [0.2, (k) => k.gunshot(0, { crack: 0.45, body: 2000, len: 0.09, boom: 0.4, low: 140 })],
  shot_taser: [0.45, (k) => {
    const o = k.osc('sawtooth', 70, 0, 0.42);
    const am = k.osc('square', 45, 0, 0.42);
    const ag = k.ctx.createGain();
    ag.gain.value = 0.5;
    am.connect(ag.gain);
    k.chain(o, k.filter('highpass', 400, 0.7), ag, k.env([[0, 0.5], [0.4, 0.001]]));
    k.burst(0, 0.4, 'bandpass', 4000, 1, 0.4);
  }],
  // Rifle láser: chasquido agudo que cae en picado + siseo; avisos de calor.
  shot_laser: [0.32, (k) => {
    k.chain(k.osc('sawtooth', 2400, 0, 0.28, 260), k.filter('lowpass', 3500, 0.8), k.perc(0, 0.002, 0.45, 0.26));
    k.chain(k.osc('square', 1200, 0, 0.2, 140), k.filter('lowpass', 2000), k.perc(0, 0.002, 0.2, 0.18));
    k.burst(0, 0.12, 'highpass', 5000, 0.7, 0.3);
  }],
  overheat: [0.9, (k) => {
    for (let i = 0; i < 3; i++) k.chain(k.osc('square', 1900, i * 0.2, 0.12), k.filter('lowpass', 3000), k.perc(i * 0.2, 0.004, 0.3, 0.1));
    k.burst(0.05, 0.8, 'highpass', 3500, 0.6, 0.35, 1500);
  }],
  laser_locked: [0.2, (k) => k.chain(k.osc('square', 150, 0, 0.16), k.filter('lowpass', 700), k.perc(0, 0.004, 0.35, 0.15))],
  cooled: [0.35, (k) => { k.ping(0, 1500, 0.2, 0.25); k.ping(0.1, 2000, 0.2, 0.2); }],
  // Lanzallamas: rugido de gas encendido (se solapa en un chorro continuo).
  shot_lanzallamas: [0.26, (k) => {
    k.burst(0, 0.24, 'bandpass', 900, 0.7, 0.55, 380);
    k.burst(0, 0.24, 'lowpass', 300, 0.7, 0.7, 120);
    k.thump(0, 90, 55, 0.18, 0.4);
  }],
  // Sable láser: zumbido que sube al blandirlo, encendido y choque con un escupitajo.
  swing_sable: [0.5, (k) => {
    const o = k.osc('sawtooth', 120, 0, 0.45, 300);
    const lfo = k.osc('sine', 38, 0, 0.45);
    const d = k.ctx.createGain();
    d.gain.value = 22;
    lfo.connect(d).connect(o.frequency);
    k.chain(o, k.filter('lowpass', 1400, 1.2), k.env([[0, 0.001], [0.06, 0.4], [0.25, 0.35], [0.45, 0.001]]));
    k.burst(0, 0.3, 'bandpass', 900, 1.5, 0.15, 2600);
  }],
  saber_on: [0.6, (k) => {
    const o = k.osc('sawtooth', 55, 0, 0.55, 150);
    k.chain(o, k.filter('lowpass', 900), k.env([[0, 0.001], [0.1, 0.4], [0.4, 0.3], [0.55, 0.001]]));
    k.click(0, 0.4, 2600);
    k.burst(0.05, 0.4, 'bandpass', 700, 1.2, 0.18, 2200);
  }],
  deflect: [0.3, (k) => {
    k.ping(0, 1700, 0.25, 0.35);
    k.chain(k.osc('sawtooth', 900, 0, 0.22, 200), k.filter('lowpass', 2500), k.perc(0, 0.002, 0.35, 0.2));
  }],
  swing: [0.25, (k) => k.burst(0, 0.22, 'bandpass', 400, 1.2, 0.5, 1800)],
  melee_hit: [0.2, (k) => { k.burst(0, 0.1, 'lowpass', 350, 1, 0.9); k.thump(0, 140, 60, 0.12, 0.8); }],
  reload: [0.35, (k) => { k.click(0, 0.5, 2500); k.ping(0.02, 1700, 0.06, 0.15); k.click(0.12, 0.4, 3000); }],
  reloaded: [0.3, (k) => { k.click(0, 0.5, 2000); k.burst(0.1, 0.06, 'bandpass', 1800, 2, 0.6); k.click(0.14, 0.4); }],
  empty: [0.08, (k) => k.click(0, 0.45, 4500)],
  switch: [0.25, (k) => { k.burst(0, 0.12, 'bandpass', 1200, 0.8, 0.25); k.click(0.1, 0.35); }],
  grenade_throw: [0.4, (k) => k.burst(0, 0.35, 'bandpass', 300, 1.5, 0.35, 1400)],

  // ---------------------------------------------------------------- impactos
  hit_flesh: [0.15, (k) => { k.burst(0, 0.08, 'lowpass', 600, 1, 0.6); k.thump(0, 110, 60, 0.08, 0.5); }],
  hit_shield: [0.35, (k) => { k.ping(0, 1100, 0.25, 0.35); k.click(0, 0.5, 2000); }],
  explosion: [2.0, (k) => {
    k.burst(0, 1.6, 'lowpass', 500, 0.7, 1, 80);
    k.thump(0, 70, 28, 1.0, 1);
    k.burst(0, 0.35, 'highpass', 1500, 0.5, 0.45);
    for (let i = 0; i < 8; i++) k.burst(0.15 + Math.random() * 0.8, 0.05, 'bandpass', 1500 + Math.random() * 2000, 2, 0.12);
  }],

  // ---------------------------------------------------------------- zombis (provisional si no hay archivos)
  groan_1: [1.2, (k) => k.groan(0, 1.1, 95, 75, [[480, 4, 1], [1100, 5, 0.5]], 0.55)],
  groan_2: [1.0, (k) => k.groan(0, 0.9, 120, 90, [[560, 5, 1], [1300, 6, 0.4]], 0.5)],
  groan_3: [1.4, (k) => k.groan(0, 1.3, 80, 110, [[420, 4, 1], [950, 5, 0.6]], 0.5, 0.5)],
  groan_4: [0.8, (k) => k.groan(0, 0.7, 150, 110, [[650, 5, 1], [1500, 6, 0.4]], 0.45)],
  zombie_death: [0.9, (k) => { k.groan(0, 0.7, 130, 55, [[500, 4, 1], [1000, 5, 0.4]], 0.5); k.thump(0.6, 90, 45, 0.2, 0.5); }],
  runner_screech: [0.7, (k) => k.groan(0, 0.6, 260, 200, [[900, 6, 1], [2200, 6, 0.5]], 0.4, 0.6)],
  boss_roar: [2.0, (k) => k.groan(0, 1.9, 60, 45, [[300, 3, 1], [800, 4, 0.6], [1600, 5, 0.25]], 0.8, 0.8)],
  tank_grunt: [1.0, (k) => k.groan(0, 0.9, 55, 48, [[260, 3, 1], [700, 4, 0.5]], 0.7, 0.6)],
  bloat_hiss: [0.8, (k) => { k.burst(0, 0.75, 'highpass', 3000, 0.7, 0.35); k.groan(0, 0.6, 140, 210, [[700, 6, 1]], 0.25); }],
  spit: [0.35, (k) => { k.burst(0, 0.25, 'bandpass', 900, 2, 0.6, 300); k.thump(0.02, 320, 140, 0.12, 0.4); }],
  splash: [0.7, (k) => {
    k.burst(0, 0.08, 'lowpass', 900, 1, 0.5);
    for (let i = 0; i < 10; i++) k.burst(0.05 + i * 0.06 * Math.random() * 1.5, 0.04, 'highpass', 3500, 1, 0.15);
  }],

  // ---------------------------------------------------------------- construcción y trampas
  hit_wood: [0.2, (k) => { k.burst(0, 0.12, 'bandpass', 700, 2, 0.8); k.thump(0, 190, 120, 0.08, 0.5); }],
  hit_metal: [0.5, (k) => { k.ping(0, 620, 0.4, 0.4); k.burst(0, 0.04, 'bandpass', 2500, 2, 0.5); }],
  hit_soft: [0.2, (k) => k.burst(0, 0.14, 'lowpass', 450, 0.8, 0.8)],
  hit_concrete: [0.2, (k) => { k.burst(0, 0.1, 'lowpass', 700, 1, 0.9); k.burst(0, 0.05, 'bandpass', 2200, 2, 0.3); }],
  break: [0.9, (k) => {
    k.burst(0, 0.5, 'lowpass', 1000, 0.8, 0.8, 200);
    for (let i = 0; i < 7; i++) k.burst(0.04 + Math.random() * 0.6, 0.06, 'bandpass', 600 + Math.random() * 1500, 2, 0.35);
  }],
  place: [0.25, (k) => { k.thump(0, 150, 70, 0.14, 0.9); k.burst(0, 0.06, 'lowpass', 900, 1, 0.5); }],
  upgrade: [0.45, (k) => { for (let i = 0; i < 5; i++) k.click(i * 0.07, 0.4, 2000 + i * 300); k.ping(0.36, 1400, 0.08, 0.2); }],
  repair: [0.55, (k) => { for (let i = 0; i < 3; i++) { k.burst(i * 0.16, 0.06, 'bandpass', 900, 2, 0.6); k.ping(i * 0.16, 1300, 0.05, 0.12); } }],
  sell: [0.4, (k) => { k.ping(0, 1800, 0.15, 0.3); k.ping(0.1, 2400, 0.2, 0.3); }],
  spike: [0.12, (k) => k.burst(0, 0.08, 'bandpass', 1600, 2, 0.4)],
  trap_snap: [0.3, (k) => { k.click(0, 0.9, 1500); k.ping(0.01, 1150, 0.2, 0.3); }],
  mine_beep: [0.25, (k) => { k.chain(k.osc('square', 1400, 0, 0.05), k.perc(0, 0.002, 0.25, 0.05)); k.chain(k.osc('square', 1400, 0.12, 0.05), k.perc(0.12, 0.002, 0.25, 0.05)); }],
  zap: [0.45, (k) => {
    const o = k.osc('sawtooth', 110, 0, 0.42);
    const am = k.osc('square', 60, 0, 0.42);
    const ag = k.ctx.createGain();
    ag.gain.value = 0.5;
    am.connect(ag.gain);
    k.chain(o, k.filter('highpass', 300), ag, k.env([[0, 0.6], [0.4, 0.001]]));
    k.burst(0, 0.3, 'highpass', 5000, 0.7, 0.35);
  }],
  turret_empty: [0.2, (k) => { k.click(0, 0.4); k.click(0.1, 0.35); }],
  // Dron de mantenimiento: zumbido suave de hélices (se repite mientras vuela, con fundidos para
  // que las repeticiones empalmen) y chisporroteo flojo de soldadura.
  drone_hum: [1.1, (k) => {
    const env = () => k.env([[0, 1e-4], [0.18, 0.3], [0.9, 0.3], [1.1, 1e-4]]);
    for (const [f, a] of [[150, 1], [226, 0.5]]) {
      const o = k.osc('sawtooth', f, 0, 1.1);
      const am = k.osc('sine', 38, 0, 1.1); // batido de las palas
      const ag = k.ctx.createGain();
      ag.gain.value = 0.35 * a;
      const depth = k.ctx.createGain();
      depth.gain.value = 0.15 * a;
      am.connect(depth).connect(ag.gain);
      k.chain(o, k.filter('lowpass', 700, 0.8), ag, env());
    }
    k.chain(k.noise(0, 1.1), k.filter('bandpass', 1200, 0.8), env());
  }],
  drone_weld: [0.35, (k) => {
    for (let i = 0; i < 6; i++) k.burst(i * 0.05 + Math.random() * 0.02, 0.03, 'highpass', 3500 + Math.random() * 2500, 1, 0.25);
    k.chain(k.osc('square', 95, 0, 0.3), k.filter('bandpass', 1800, 2), k.perc(0, 0.01, 0.12, 0.28));
  }],
  door: [0.6, (k) => {
    const o = k.osc('sawtooth', 180, 0, 0.4, 260);
    const lfo = k.osc('sine', 23, 0, 0.4);
    const d = k.ctx.createGain();
    d.gain.value = 30;
    lfo.connect(d).connect(o.frequency);
    k.chain(o, k.filter('lowpass', 1200), k.env([[0, 0.001], [0.05, 0.15], [0.38, 0.1], [0.42, 0.001]]));
    k.thump(0.42, 110, 60, 0.12, 0.6);
  }],

  // ---------------------------------------------------------------- jugador
  hurt: [0.25, (k) => { k.burst(0, 0.1, 'lowpass', 700, 1, 0.7); k.thump(0, 170, 90, 0.15, 0.8); }],
  heartbeat: [0.6, (k) => { k.thump(0, 60, 45, 0.12, 0.9); k.thump(0.22, 55, 42, 0.14, 0.7); }],
  medkit: [0.4, (k) => k.burst(0, 0.35, 'bandpass', 2200, 1, 0.3)],
  coffee: [0.5, (k) => k.burst(0, 0.45, 'bandpass', 600, 2, 0.35, 1500)],
  step_1: [0.08, (k) => k.burst(0, 0.05, 'lowpass', 900, 0.7, 0.35)],
  step_2: [0.08, (k) => k.burst(0, 0.05, 'lowpass', 750, 0.7, 0.35)],

  // ---------------------------------------------------------------- interfaz y ambiente
  ui_click: [0.06, (k) => k.chain(k.osc('sine', 1200, 0, 0.05), k.perc(0, 0.002, 0.3, 0.04))],
  ui_buy: [0.35, (k) => { k.chain(k.osc('triangle', 880, 0, 0.12), k.perc(0, 0.003, 0.4, 0.11)); k.chain(k.osc('triangle', 1320, 0.1, 0.2), k.perc(0.1, 0.003, 0.4, 0.2)); }],
  ui_error: [0.25, (k) => { k.chain(k.osc('square', 180, 0, 0.2), k.filter('lowpass', 900), k.perc(0, 0.005, 0.3, 0.18)); }],
  interact: [0.15, (k) => k.chain(k.osc('sine', 700, 0, 0.1, 1050), k.perc(0, 0.003, 0.35, 0.09))],
  radio: [0.45, (k) => {
    k.chain(k.osc('sine', 1050, 0, 0.06), k.perc(0, 0.002, 0.25, 0.05));
    for (let i = 0; i < 12; i++) k.burst(0.06 + i * 0.03, 0.02, 'bandpass', 2500, 1, 0.08 + Math.random() * 0.12);
  }],
  // Timbrazo de móvil (llamadas de Ana y Oliver): doble trino suave de dos tonos alternos. Story lo
  // repite según familia.json (ring.times y ring.gap) antes de enseñar la llamada.
  phone_ring: [0.8, (k) => {
    for (const t0 of [0, 0.42]) {
      const g = k.env([[t0, 1e-4], [t0 + 0.02, 0.22], [t0 + 0.32, 0.2], [t0 + 0.36, 1e-4]]);
      const lp = k.filter('lowpass', 2600, 0.7);
      lp.connect(g);
      g.connect(k.out);
      for (let i = 0; i < 8; i++) k.osc('sine', i % 2 ? 1760 : 1320, t0 + i * 0.045, 0.047).connect(lp);
    }
  }],
  combo: [0.15, (k) => k.chain(k.osc('triangle', 660, 0, 0.12, 1320), k.perc(0, 0.003, 0.3, 0.11))],
  siren: [4.0, (k) => {
    const o = k.osc('sawtooth', 700, 0, 4);
    const f = o.frequency;
    f.setValueAtTime(650, 0);
    for (let c = 0; c < 2; c++) { f.linearRampToValueAtTime(1250, c * 2 + 1); f.linearRampToValueAtTime(650, c * 2 + 2); }
    k.chain(o, k.filter('lowpass', 2200), k.env([[0, 0.001], [0.2, 0.25], [3.7, 0.25], [4, 0.001]]));
  }],
  alarm: [1.0, (k) => {
    for (let i = 0; i < 4; i++) k.chain(k.osc('square', i % 2 ? 660 : 880, i * 0.25, 0.24), k.filter('lowpass', 2500), k.perc(i * 0.25, 0.005, 0.2, 0.23));
  }],
  night_start: [2.5, (k) => { k.thump(0, 55, 35, 2.2, 0.9); k.burst(0, 2.2, 'lowpass', 250, 0.7, 0.4, 60); }],
  dawn: [1.4, (k) => { [523, 659, 784, 1047].forEach((f, i) => k.chain(k.osc('triangle', f, i * 0.14, 0.9), k.perc(i * 0.14, 0.01, 0.25, 0.85))); }],
  boss_horn: [1.8, (k) => {
    for (const f of [110, 116.5]) k.chain(k.osc('sawtooth', f, 0, 1.7), k.filter('lowpass', 700), k.env([[0, 0.001], [0.3, 0.3], [1.3, 0.25], [1.7, 0.001]]));
  }],
};

/** Renderiza una receta a AudioBuffer (asíncrono). */
export function renderRecipe(name) {
  const [dur, build] = RECIPES[name];
  const ctx = new OfflineAudioContext(1, Math.ceil(dur * SAMPLE_RATE), SAMPLE_RATE);
  build(new Kit(ctx));
  return ctx.startRendering();
}
