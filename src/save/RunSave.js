import { weaponStats } from '../systems/WeaponSystem.js';
import { PHASE } from '../systems/DayNight.js';

// Guardado del turno en curso para "Continuar turno": se escribe solo al amanecer (al empezar
// cada día desde el 2) y se borra al caer o abandonar. Va aparte del guardado permanente
// (medallas, mejoras, récords) y, como él, en el localStorage del propio dispositivo.

// v2: comisaría nueva por salas (las construcciones de la v1 no encajan en el mapa nuevo).
export const RUN_SAVE_VERSION = 2;

const num = (v, def = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Foto del turno en curso (objeto plano, serializable). */
export function captureRun(game) {
  const { run, player, weapons, shop, build, score, waves, meta, dayNight } = game;
  return {
    version: RUN_SAVE_VERSION,
    savedAt: new Date().toISOString(),
    night: dayNight.night,
    run: { points: run.points, score: run.score, kills: run.kills, nights: run.nights, time: run.time, killsByType: { ...run.killsByType } },
    maxCombo: score.maxCombo,
    bossCount: waves.bossCount,
    player: {
      hp: player.hp, maxHp: player.maxHp, medkits: player.medkits,
      armor: player.armor, armorMax: player.armorMax, armorAbsorb: player.armorAbsorb,
    },
    weapons: {
      current: weapons.current,
      grenades: weapons.grenades,
      owned: [...weapons.owned.values()].map((w) => ({ id: w.id, lv: { ...w.lv }, mag: w.mag, reserve: w.reserve })),
    },
    shop: { unlocked: [...shop.unlocked], bought: { ...shop.bought } },
    build: {
      freeBarricades: build.freeBarricades,
      transformerHp: build.transformer?.hp ?? null,
      // Las piezas automáticas (persianas del despacho) se vuelven a poner solas cada noche.
      structures: [...build.all].filter((s) => !s.auto).map((s) => ({
        type: s.type, level: s.level, cells: [...s.cells], hp: s.hp, maxHp: s.maxHp,
        invested: s.invested, open: !!s.open, ammo: s.ammo ?? null,
      })),
    },
    despacho: game.despacho?.getState?.() ?? null,
    story: game.story?.getState?.() ?? null, // historia por radio: final visto y llamadas ya oídas
    runStats: meta.runStats ? JSON.parse(JSON.stringify(meta.runStats)) : null,
  };
}

/** Vuelve a montar una construcción guardada (sin coste ni comprobaciones de colocación). */
function restoreStructure(build, r) {
  const { grid } = build.game;
  const def = build.pieces[r.type];
  if (!def || !Array.isArray(r.cells) || !r.cells.length) return;
  const total = grid.w * grid.h;
  const cells = r.cells.filter((c) => Number.isInteger(c) && c >= 0 && c < total);
  if (cells.length !== r.cells.length || cells.some((c) => build.structures.has(c))) return;
  const n = cells.length;
  let cx = 0, cz = 0;
  for (const c of cells) { cx += grid.centerX(c % grid.w); cz += grid.centerZ((c / grid.w) | 0); }
  const i = cells[0] % grid.w, j = (cells[0] / grid.w) | 0;
  const level = clamp(Math.floor(num(r.level)), 0, def.levels.length - 1);
  const baseMax = def.levels[level].hp * n;
  const maxHp = Math.max(1, num(r.maxHp, baseMax));
  const s = {
    id: build.nextId++, type: r.type, def, cells, n, k: cells[0], i, j, cx: cx / n, cz: cz / n,
    level, hp: clamp(num(r.hp, maxHp), 1, maxHp), maxHp, invested: Math.max(0, num(r.invested)),
    flash: 0, open: !!r.open && r.type === 'puerta', axis: r.type === 'puerta' ? build.doorAxis(i, j) : 'x',
    rearm: 0, fuse: -1, repairReady: 0, zap: 0,
  };
  for (const c of cells) build.structures.set(c, s);
  build.all.add(s);
  build.lists[r.type]?.push(s);
  build.applyGrid(s);
  if (r.type === 'puerta') build.registerDoor(s);
  if (r.type === 'torreta') {
    build.initTurret(s);
    if (r.ammo !== null && r.ammo !== undefined) s.ammo = clamp(Math.floor(num(r.ammo)), 0, s.ammoMax);
  }
}

/**
 * Restaura un turno guardado sobre una partida recién reiniciada (y con las mejoras
 * permanentes ya aplicadas). Empieza al principio del día guardado.
 */
export function restoreRun(game, d) {
  const { run, player, weapons, shop, build, score, waves, meta, dayNight } = game;
  Object.assign(run, {
    points: num(d.run?.points), score: num(d.run?.score), kills: num(d.run?.kills),
    nights: num(d.run?.nights), time: num(d.run?.time), killsByType: { ...(d.run?.killsByType ?? {}) },
  });
  score.maxCombo = num(d.maxCombo);
  waves.bossCount = num(d.bossCount);

  const p = d.player ?? {};
  player.maxHp = Math.max(1, num(p.maxHp, player.maxHp));
  player.hp = clamp(num(p.hp, player.maxHp), 1, player.maxHp);
  player.medkits = Math.max(0, Math.floor(num(p.medkits, player.medkits)));
  player.armorMax = Math.max(0, num(p.armorMax));
  player.armor = clamp(num(p.armor), 0, player.armorMax);
  player.armorAbsorb = num(p.armorAbsorb);

  for (const w of d.weapons?.owned ?? []) {
    if (!weapons.defs[w.id]) continue;
    const cur = weapons.give(w.id);
    cur.lv = { ...cur.lv, ...(w.lv ?? {}) };
    cur.stats = weaponStats(cur.data, cur.lv);
    cur.mag = clamp(Math.floor(num(w.mag, cur.stats.magSize)), 0, cur.stats.magSize || 0);
    cur.reserve = num(w.reserve, cur.reserve);
  }
  if (weapons.has(d.weapons?.current)) weapons.switchTo(d.weapons.current, true);
  weapons.grenades = Math.max(0, Math.floor(num(d.weapons?.grenades, weapons.grenades)));

  for (const u of d.shop?.unlocked ?? []) if (typeof u === 'string') shop.unlocked.add(u);
  shop.bought = { ...(d.shop?.bought ?? {}) };

  // Primero el nivel de las salas (despacho del jefe: puede cambiar vidas máximas y reforma las
  // salas a la vista); después lo construido, que ya trae guardada su vida.
  if (d.despacho && game.despacho?.setState) game.despacho.setState(d.despacho);
  build.freeBarricades = Math.max(0, num(d.build?.freeBarricades));
  for (const r of d.build?.structures ?? []) restoreStructure(build, r);
  build.changed(true);
  const tr = build.transformer;
  if (tr && d.build?.transformerHp !== null && d.build?.transformerHp !== undefined) tr.hp = clamp(num(d.build.transformerHp), 0, tr.maxHp);

  if (d.runStats && meta.runStats) Object.assign(meta.runStats, d.runStats);
  if (d.story && game.story?.setState) game.story.setState(d.story);

  dayNight.night = Math.max(1, Math.floor(num(d.night, 1)));
  dayNight.enter(PHASE.DAY);
}

/** Resumen corto para el menú ("Día 6 · 4.120 puntos"). */
export function describeSave(d) {
  return d ? { night: num(d.night, 1), points: num(d.run?.points), nights: num(d.run?.nights) } : null;
}

export class RunSaveStore {
  /** @param {Storage|null} [storage] */
  constructor(key, storage) {
    this.key = key;
    try { this.storage = storage === undefined ? globalThis.localStorage ?? null : storage; } catch { this.storage = null; }
  }

  /** Guardado válido o null (versión distinta, corrupto o inexistente). */
  load() {
    try {
      const d = JSON.parse(this.storage?.getItem(this.key) ?? 'null');
      return d && d.version === RUN_SAVE_VERSION && typeof d.night === 'number' ? d : null;
    } catch {
      return null;
    }
  }

  save(data) {
    try { this.storage?.setItem(this.key, JSON.stringify(data)); return !!this.storage; } catch { return false; }
  }

  clear() {
    try { this.storage?.removeItem(this.key); } catch { /* sin almacenamiento */ }
  }
}
