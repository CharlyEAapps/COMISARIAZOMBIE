import * as THREE from 'three';
import cfg from '../data/audio.json';
import { RECIPES, renderRecipe } from './Synth.js';
import { Music } from './Music.js';
import { PHASE } from '../systems/DayNight.js';

const STORE_KEY = 'turno-de-noche.audio';
const BASE = import.meta.env?.BASE_URL ?? '/';
const MATERIAL_SOUND = { madera: 'hit_wood', metal: 'hit_metal', blando: 'hit_soft', hormigon: 'hit_concrete' };
const TYPE_VOICE = { corredor: 'runner_screech', tanque: 'tank_grunt', explosivo: 'bloat_hiss' };
const HIT_OPTS = { vol: cfg.ambient.hitVolume };
const BOSS_OPTS = { rate: cfg.ambient.bossVoiceRate };
const NORMAL_OPTS = { rate: 1 };

/** Material de una pieza para su sonido de golpe (según tipo y nivel). */
export function structureMaterial(type, level) {
  if (type === 'sacos') return 'blando';
  if (type === 'barricada') return ['madera', 'metal', 'hormigon'][level] ?? 'madera';
  return 'metal';
}

/**
 * ¿Hay que usar MP3 en lugar de OGG? Safari/iOS no decodifica bien OGG Vorbis con
 * decodeAudioData, así que se usa MP3 si el navegador no declara soporte de Vorbis o es Safari.
 * @param {string} canPlayOgg resultado de `new Audio().canPlayType('audio/ogg; codecs="vorbis"')`
 * @param {string} userAgent
 */
export function preferMp3(canPlayOgg, userAgent = '') {
  if (!canPlayOgg) return true;
  const safari = /safari/i.test(userAgent) && !/chrome|chromium|crios|fxios|edg|android/i.test(userAgent);
  const iosWebkit = /iphone|ipad|ipod/i.test(userAgent);
  return safari || iosWebkit;
}

/** Cambia la extensión de audio de una URL (`audio/x.ogg` → `audio/x.mp3`). */
export function withAudioExt(url, ext) {
  return url.replace(/\.(ogg|mp3)$/i, '.' + ext);
}

function detectMp3() {
  try {
    return preferMp3(new Audio().canPlayType('audio/ogg; codecs="vorbis"'), navigator.userAgent);
  } catch { return true; }
}

/** Escala el buffer para que su pico sea `peak` (iguala sonidos sintetizados y grabados). */
export function normalize(buffer, peak) {
  let max = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > max) max = a; }
  }
  if (max < 1e-6) return buffer;
  const k = peak / max;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= k;
  }
  return buffer;
}

/** Volúmenes guardados (solo números entre 0 y 1; lo demás se ignora). */
function loadVolumes() {
  let raw;
  try { raw = JSON.parse(localStorage.getItem(STORE_KEY)); } catch { return {}; }
  const out = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'number' && v >= 0 && v <= 1) out[k] = v;
  }
  return out;
}

// Audio del juego: efectos posicionales (THREE.PositionalAudio, el oyente va con el policía y
// orientado como la cámara), sonidos de interfaz sin posición y música de día y noche, con
// volúmenes separados que se guardan en el navegador. Los efectos se sintetizan al arrancar
// (Synth.js) y los archivos CC0 de public/audio sustituyen o amplían los grupos.
export class AudioSystem {
  constructor(game) {
    this.game = game;
    this.cfg = cfg;
    this.volumes = { ...cfg.volumes, ...loadVolumes() };
    this.buffers = new Map();
    this.ready = false;
    this.enabled = typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
    if (!this.enabled) return;

    this.listener = new THREE.AudioListener();
    game.scene.add(this.listener);
    const ctx = this.ctx = this.listener.context;
    this.sfxBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.sfxBus.connect(this.listener.getInput());
    this.musicBus.connect(this.listener.getInput());
    this.applyVolumes();

    const mk = (positional) => {
      const a = positional ? new THREE.PositionalAudio(this.listener) : new THREE.Audio(this.listener);
      if (positional) {
        a.setDistanceModel(cfg.distanceModel);
        a.setRefDistance(cfg.refDistance);
        a.setRolloffFactor(cfg.rolloff);
        a.setMaxDistance(cfg.maxDistance);
      }
      a.gain.disconnect();
      a.gain.connect(this.sfxBus);
      a.userData.name = '';
      a.userData.t = 0;
      game.scene.add(a);
      return a;
    };
    this.positional = Array.from({ length: cfg.voices.positional }, () => mk(true));
    this.flat = Array.from({ length: cfg.voices.flat }, () => mk(false));
    this.music = new Music(ctx, this.musicBus, cfg.music);
    this.groups = new Map(Object.entries(cfg.groups));

    // Los navegadores no dejan sonar nada hasta el primer gesto del usuario.
    this.unlocked = false;
    this._unlock = () => {
      this.unlocked = true;
      if (ctx.state !== 'running' && ctx.state !== 'closed' && !document.hidden) ctx.resume().catch(() => {});
    };
    window.addEventListener('pointerdown', this._unlock);
    window.addEventListener('keydown', this._unlock);
    // iOS solo desbloquea el AudioContext con touchend/click (pointerdown no basta).
    window.addEventListener('touchend', this._unlock);
    window.addEventListener('click', this._unlock);
    // Con la pestaña oculta no suena nada (ni la música de fondo).
    this._visibility = () => {
      if (ctx.state === 'closed') return;
      if (document.hidden) ctx.suspend().catch(() => {});
      else if (this.unlocked) ctx.resume().catch(() => {});
    };
    document.addEventListener('visibilitychange', this._visibility);

    this.groanTimer = 0;
    this.roarTimer = 0;
    this.heartTimer = 0;
    this.lastStep = 0;
    this.repeats = [];
    this.load();
    this.bindEvents();
  }

  // ------------------------------------------------------------------ carga
  async load() {
    await Promise.all(Object.keys(RECIPES).map(async (name) => {
      try { this.buffers.set(name, normalize(await renderRecipe(name), cfg.normalizePeak)); } catch (e) { console.warn('Audio: receta', name, e); }
    }));
    this.ready = true;
    // Formato: MP3 si el navegador no lee OGG (Safari/iOS); si el OGG falla al decodificar, se reintenta con MP3.
    let mp3 = this.useMp3 = detectMp3();
    const fetchExt = async (url, ext) => {
      const u = withAudioExt(url, ext);
      const res = await fetch(BASE + u);
      if (!res.ok) throw new Error(`${res.status} ${u}`);
      return this.ctx.decodeAudioData(await res.arrayBuffer());
    };
    const fetchBuf = async (url) => {
      if (mp3) return fetchExt(url, 'mp3');
      try { return await fetchExt(url, 'ogg'); } catch {
        const buf = await fetchExt(url, 'mp3');
        mp3 = this.useMp3 = true; // el resto de archivos ya van directos en MP3
        return buf;
      }
    };
    await Promise.all(Object.entries(cfg.files).map(async ([name, url]) => {
      try { this.buffers.set(name, normalize(await fetchBuf(url), cfg.normalizePeak)); } catch (e) { console.warn('Audio: archivo', url, e.message); }
    }));
    for (const [mode, url] of Object.entries(cfg.music.files)) {
      try { this.music.setTrack(mode, await fetchBuf(url)); } catch (e) { console.warn('Audio: música', url, e.message); }
    }
  }

  // ------------------------------------------------------------------ volumen
  applyVolumes() {
    const v = this.volumes;
    this.listener.setMasterVolume(v.master);
    this.sfxBus.gain.value = v.sfx;
    this.musicBus.gain.value = v.music;
  }

  /** @param {'master'|'music'|'sfx'} kind */
  setVolume(kind, value) {
    this.volumes[kind] = value;
    if (!this.enabled) return;
    this.applyVolumes();
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.volumes)); } catch { /* sin almacenamiento */ }
  }

  // ------------------------------------------------------------------ reproducción
  /** Nombre concreto de un sonido (los grupos eligen una variante al azar entre las cargadas). */
  resolve(name) {
    const g = this.groups.get(name);
    if (!g) return this.buffers.has(name) ? name : null;
    let pick = null, seen = 0;
    for (const m of g) if (this.buffers.has(m) && Math.random() * ++seen < 1) pick = m;
    // Si no ha cargado ningún archivo del grupo, la versión sintetizada.
    const fb = cfg.fallbacks[name];
    if (!pick && fb) for (const m of fb) if (this.buffers.has(m) && Math.random() * ++seen < 1) pick = m;
    return pick;
  }

  /**
   * Reproduce `name` en (x, z) (o sin posición si x es undefined).
   * @param {{vol?:number, rate?:number}} [o]
   */
  play(name, x, z, o) {
    if (!this.ready || !this.enabled || this.ctx.state !== 'running') return;
    const s = cfg.sounds[name] ?? {};
    const now = this.ctx.currentTime;
    const pool = x === undefined ? this.flat : this.positional;
    // Límites: tiempo mínimo entre repeticiones y voces a la vez del mismo sonido.
    let count = 0, oldest = null;
    for (const v of pool) {
      if (v.isPlaying && v.userData.name === name) {
        count++;
        if (now - v.userData.t < (s.min ?? 0)) return;
      }
    }
    if (count >= (s.max ?? 4)) return;
    const real = this.resolve(name);
    if (!real) return;
    let voice = null;
    for (const v of pool) {
      if (!v.isPlaying) { voice = v; break; }
      if (!oldest || v.userData.t < oldest.userData.t) oldest = v;
    }
    voice ??= oldest;
    if (voice.isPlaying) voice.stop();
    voice.setBuffer(this.buffers.get(real));
    const rate = (o?.rate ?? 1) * (1 + (Math.random() * 2 - 1) * (s.rate ?? 0));
    const vol = (s.vol ?? 1) * (o?.vol ?? 1);
    voice.playbackRate = rate;
    if (x !== undefined) {
      // Posición del panner al instante (si no, se desliza desde donde sonó lo anterior).
      voice.position.set(x, cfg.sourceHeight, z);
      const p = voice.panner;
      for (const [param, v] of [[p.positionX, x], [p.positionY, cfg.sourceHeight], [p.positionZ, z]]) {
        param.cancelScheduledValues(now);
        param.setValueAtTime(v, now);
      }
    }
    voice.userData.name = name;
    voice.userData.t = now;
    voice.play();
    // Volumen y tono al instante (setVolume/setPlaybackRate de three se deslizan ~30 ms).
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(vol, now);
    voice.source.playbackRate.cancelScheduledValues(now);
    voice.source.playbackRate.setValueAtTime(rate, now);
  }

  /** Para todas las voces (al reiniciar la partida). */
  stopAll() {
    for (const v of [...this.positional, ...this.flat]) if (v.isPlaying) v.stop();
    this.repeats.length = 0;
  }

  /** Repite un sonido sin posición `times` veces cada `gap` s (sirena, alarma). */
  repeat(name, times, gap) {
    for (let k = 0; k < times; k++) this.repeats.push({ name, at: this.game.time + k * gap });
  }

  playAt(name, pos, o) {
    this.play(name, pos.x, pos.z, o);
  }

  cellPos(k) {
    const g = this.game.grid;
    return { x: g.centerX(k % g.w), z: g.centerZ((k / g.w) | 0) };
  }

  // ------------------------------------------------------------------ eventos del juego
  bindEvents() {
    this._unsub = [];
    const bus = { on: (type, fn) => this._unsub.push(this.game.bus.on(type, fn)) };
    const P = () => this.game.player.position;
    bus.on('weapon:fired', ({ id }) => this.playAt(`shot_${id}`, P()));
    bus.on('weapon:melee', ({ hits, id }) => { this.playAt(id === 'sable' ? 'swing_sable' : 'swing', P()); if (hits) this.playAt('melee_hit', P()); });
    bus.on('weapon:overheat', () => this.play('overheat'));
    bus.on('weapon:locked', () => this.play('laser_locked'));
    bus.on('weapon:cooled', () => this.play('cooled'));
    bus.on('weapon:deflect', ({ x, z }) => this.play('deflect', x, z));
    bus.on('weapon:reload', () => this.play('reload'));
    bus.on('weapon:reloaded', () => this.play('reloaded'));
    bus.on('weapon:switched', ({ id }) => this.play(id === 'sable' ? 'saber_on' : 'switch'));
    bus.on('weapon:empty', () => this.play('empty'));
    bus.on('grenade:thrown', () => this.playAt('grenade_throw', P()));
    bus.on('zombie:hit', ({ zombie }) => this.playAt('hit_flesh', zombie.pos, HIT_OPTS));
    bus.on('zombie:blocked', ({ zombie }) => this.playAt('hit_shield', zombie.pos));
    bus.on('zombie:killed', ({ type, x, z, selfDestruct }) => {
      if (type === 'antidisturbios') this.play('boss_death', x, z, BOSS_OPTS);
      else if (!selfDestruct) this.play('zombie_death', x, z);
    });
    bus.on('explosion', ({ x, z }) => this.play('explosion', x, z));
    bus.on('player:hurt', () => this.play('hurt'));
    bus.on('medkit:use', () => this.play('medkit'));
    bus.on('build:placed', ({ k }) => this.playAt('place', this.cellPos(k)));
    bus.on('build:upgraded', ({ s }) => this.play('upgrade', s.cx, s.cz));
    bus.on('build:repaired', ({ s }) => this.play('repair', s.cx, s.cz));
    bus.on('build:sold', ({ s }) => this.play('sell', s.cx, s.cz));
    bus.on('build:destroyed', ({ k }) => this.playAt('break', this.cellPos(k)));
    bus.on('structure:hit', ({ s, x, z }) => this.play(MATERIAL_SOUND[structureMaterial(s.type, s.level)], x, z));
    bus.on('trap', ({ kind, x, z }) => this.play(kind, x, z));
    bus.on('fence:zap', ({ s }) => this.play('zap', s.cx, s.cz));
    bus.on('turret:fired', (s) => this.play('shot_torreta', s.cx, s.cz));
    bus.on('turret:empty', (s) => this.play('turret_empty', s.cx, s.cz));
    bus.on('drone:hum', (p) => this.play('drone_hum', p.x, p.z));
    bus.on('drone:weld', (d) => this.play('drone_weld', d.pos.x, d.pos.z));
    bus.on('acid:spit', ({ x, z }) => this.play('spit', x, z));
    bus.on('acid:splash', ({ x, z }) => this.play('splash', x, z));
    bus.on('door:toggle', ({ x, z }) => this.play('door', x, z));
    bus.on('shop:open', () => this.play('ui_click'));
    bus.on('shop:close', () => this.play('ui_click'));
    bus.on('shop:bought', () => this.play('ui_buy'));
    bus.on('shop:denied', () => this.play('ui_error'));
    bus.on('interact', ({ type }) => this.play(type === 'cafetera' ? 'coffee' : 'interact'));
    bus.on('radio', () => this.play('radio'));
    bus.on('combo', () => this.play('combo'));
    bus.on('phase:atardecer', () => this.repeat('siren', cfg.ambient.sirenRepeats, cfg.ambient.sirenGap));
    // Señuelo: la sirena del coche patrulla suena donde está el coche.
    bus.on('siren', ({ id }) => {
      const it = this.game.interactions.items.find((i) => i.id === id);
      if (it) this.play('siren_car', it.x, it.z);
    });
    bus.on('phase:noche', () => this.play('night_start'));
    bus.on('night:survived', () => this.play('dawn'));
    bus.on('alarm', () => this.repeat('alarm', cfg.ambient.alarmRepeats, cfg.ambient.alarmGap));
    bus.on('boss:spawned', () => {
      this.play('boss_horn');
      const b = this.game.zombies.boss;
      if (b) this.play('boss_roar', b.pos.x, b.pos.z);
    });
    bus.on('run:start', () => this.stopAll());
  }

  // ------------------------------------------------------------------ cada frame
  update(dt) {
    if (!this.enabled) return;
    const { game } = this;
    const p = game.player;
    // Oyente sobre el policía, orientado como la cámara (izquierda/derecha de la pantalla).
    this.listener.position.set(p.position.x, cfg.listenerHeight, p.position.z);
    this.listener.quaternion.copy(game.cameraRig.camera.quaternion);

    const dn = game.dayNight;
    this.music.setMode(game.zombies.boss ? 'jefe' : dn.phase === PHASE.NIGHT ? 'noche' : 'dia');
    this.music.intensity = Math.min(1, game.zombies.aliveCount / cfg.music.intensityZombies);
    if (game.state !== 'playing') return;

    for (let n = this.repeats.length - 1; n >= 0; n--) {
      if (game.time >= this.repeats[n].at) { this.play(this.repeats[n].name); this.repeats.splice(n, 1); }
    }

    // Pasos del policía (dos por ciclo de zancada).
    const step = Math.floor(p.walkPhase / Math.PI);
    if (step !== this.lastStep) {
      this.lastStep = step;
      if (p.alive && p.velocity.lengthSq() > 0.01) this.play('step');
    }

    // Gruñidos de la horda: de vez en cuando, uno de los cercanos.
    const A = cfg.ambient;
    if ((this.groanTimer -= dt) <= 0) {
      this.groanTimer = A.groanInterval * (0.5 + Math.random());
      const list = game.zombies.active;
      if (list.length && Math.random() < A.groanChance) {
        const z = list[(Math.random() * list.length) | 0];
        if (z.state === 0 && Math.hypot(z.pos.x - p.position.x, z.pos.z - p.position.z) < A.groanRange) {
          const voice = TYPE_VOICE[z.type] ?? 'groan';
          this.play(Math.random() < A.typeVoiceChance ? voice : 'groan', z.pos.x, z.pos.z, z.data.boss ? BOSS_OPTS : NORMAL_OPTS);
        }
      }
    }
    const boss = game.zombies.boss;
    if (boss && (this.roarTimer -= dt) <= 0) {
      this.roarTimer = A.bossRoarEvery * (0.7 + Math.random() * 0.6);
      this.play('boss_roar', boss.pos.x, boss.pos.z);
    }
    // Latido con poca vida.
    if (p.alive && p.hp < p.maxHp * A.heartbeatBelow && (this.heartTimer -= dt) <= 0) {
      this.heartTimer = A.heartbeatInterval;
      this.play('heartbeat');
    }
  }

  dispose() {
    if (!this.enabled) return;
    window.removeEventListener('pointerdown', this._unlock);
    window.removeEventListener('keydown', this._unlock);
    window.removeEventListener('touchend', this._unlock);
    window.removeEventListener('click', this._unlock);
    document.removeEventListener('visibilitychange', this._visibility);
    for (const off of this._unsub) off();
    this.music.dispose();
    for (const v of [...this.positional, ...this.flat]) {
      if (v.isPlaying) v.stop();
      this.game.scene.remove(v);
    }
    this.game.scene.remove(this.listener);
    // El AudioContext es el global de three (compartido): no se cierra, solo se suspende.
    this.ctx.suspend().catch(() => {});
  }
}
