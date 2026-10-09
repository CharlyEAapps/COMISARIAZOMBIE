// Música: pistas en bucle (archivos) con fundido cruzado entre día y noche; si no hay
// archivos, una música generativa por código (provisional):
//  - día: acordes suaves de pad y notas sueltas de una escala menor, algo inquietantes;
//  - noche: zumbido grave, pulso de latido que se acelera con la horda y disonancias.

const LOOKAHEAD = 0.25;   // s de programación por adelantado
const TICK_MS = 100;
const DAY_CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G (MIDI)
const DAY_SCALE = [57, 60, 62, 64, 67, 69, 72];
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

export class Music {
  /**
   * @param {AudioContext} ctx
   * @param {AudioNode} out bus de música
   * @param {object} cfg audio.json → music
   */
  constructor(ctx, out, cfg) {
    this.ctx = ctx;
    this.cfg = cfg;
    this.out = out;
    this.mode = null;       // 'dia' | 'noche' | 'jefe' | null
    this.intensity = 0;     // 0..1 (zombis vivos)
    this.tracks = {};       // modo → AudioBuffer (archivos, si existen)
    this.layers = {};       // modo → { gain, source? }
    for (const m of ['dia', 'noche', 'jefe']) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(out);
      this.layers[m] = { gain, source: null };
    }
    this.nextBeat = 0;
    this.beat = 0;
    this._timer = null;
  }

  setTrack(mode, buffer) {
    this.tracks[mode] = buffer;
    if (this.mode === mode) this.startTrack(mode);
  }

  startTrack(mode) {
    const L = this.layers[mode];
    if (L.source) { try { L.source.stop(); } catch { /* ya parada */ } }
    const s = this.ctx.createBufferSource();
    s.buffer = this.tracks[mode];
    s.loop = true;
    s.connect(L.gain);
    s.start();
    L.source = s;
  }

  /** Cambia de ambiente con fundido cruzado. */
  setMode(mode) {
    if (mode === this.mode) return;
    const now = this.ctx.currentTime, fade = this.cfg.crossfade;
    for (const [m, L] of Object.entries(this.layers)) {
      L.gain.gain.cancelScheduledValues(now);
      L.gain.gain.setValueAtTime(L.gain.gain.value, now);
      L.gain.gain.linearRampToValueAtTime(m === mode ? this.cfg.levels[m] : 0, now + fade);
    }
    this.mode = mode;
    if (this.tracks[mode] && !this.layers[mode].source) this.startTrack(mode);
    if (!this._timer) {
      this.nextBeat = now + 0.1;
      this._timer = setInterval(() => this.schedule(), TICK_MS);
    }
  }

  // ------------------------------------------------------------------ música generativa
  schedule() {
    const { ctx } = this;
    if (ctx.state !== 'running') return;
    while (this.nextBeat < ctx.currentTime + LOOKAHEAD) {
      const t = this.nextBeat;
      if (!this.tracks.dia) this.dayBeat(t, this.beat);
      if (!this.tracks.noche) this.nightBeat(t, this.beat);
      // El pulso nocturno se acelera con la horda.
      const bpm = this.mode === 'noche' ? this.cfg.nightBpm[0] + (this.cfg.nightBpm[1] - this.cfg.nightBpm[0]) * this.intensity : this.cfg.dayBpm;
      this.nextBeat += 60 / bpm;
      this.beat++;
    }
  }

  voice(type, freq, t, dur, peak, out, { attack = 0.01, filter = 0 } = {}) {
    const { ctx } = this;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filter;
      o.connect(f);
      node = f;
    }
    node.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  dayBeat(t, beat) {
    const out = this.layers.dia.gain;
    if (this.layers.dia.gain.gain.value < 0.001 && this.mode !== 'dia') return;
    // Un acorde cada 8 pulsos, notas sueltas de vez en cuando.
    if (beat % 8 === 0) {
      const chord = DAY_CHORDS[(beat / 8) % DAY_CHORDS.length | 0];
      for (const m of chord) {
        this.voice('triangle', mtof(m - 12), t, 7, 0.05, out, { attack: 1.5, filter: 900 });
        this.voice('sine', mtof(m - 12) * 1.004, t, 7, 0.04, out, { attack: 1.8 });
      }
    }
    if (Math.random() < 0.3) {
      const m = DAY_SCALE[(Math.random() * DAY_SCALE.length) | 0];
      this.voice('sine', mtof(m + 12), t, 1.6, 0.04, out, { attack: 0.01 });
    }
  }

  nightBeat(t, beat) {
    const out = this.layers.noche.gain;
    if (this.layers.noche.gain.gain.value < 0.001 && this.mode !== 'noche') return;
    // Latido (dos golpes graves) en cada pulso, zumbido cada 8 y disonancias al azar.
    this.voice('sine', 55, t, 0.25, 0.35, out, { attack: 0.005 });
    if (beat % 2 === 0) this.voice('sine', 49, t + 0.18, 0.22, 0.22, out, { attack: 0.005 });
    if (beat % 8 === 0) {
      this.voice('sawtooth', 41.2, t, 8, 0.05, out, { attack: 2, filter: 220 });
      this.voice('sawtooth', 41.6, t, 8, 0.05, out, { attack: 2.4, filter: 200 });
    }
    if (Math.random() < 0.06 + this.intensity * 0.12) {
      const base = [69, 70, 75, 76][(Math.random() * 4) | 0];
      this.voice('triangle', mtof(base), t, 1.2, 0.03, out, { attack: 0.3 });
      this.voice('triangle', mtof(base + 1), t, 1.2, 0.025, out, { attack: 0.35 });
    }
  }

  dispose() {
    clearInterval(this._timer);
    for (const L of Object.values(this.layers)) {
      try { L.source?.stop(); } catch { /* ya parada */ }
      L.gain.disconnect();
    }
  }
}
