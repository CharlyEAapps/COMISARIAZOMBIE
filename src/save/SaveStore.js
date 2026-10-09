// Guardado de la meta-progresión (medallas, mejoras, récords, opciones) en localStorage, con
// esquema versionado. Todo acceso al almacenamiento va en try/catch: si falla (modo privado,
// cuota llena, almacenamiento bloqueado) el juego sigue funcionando sin guardar.

export const SAVE_VERSION = 1;

/** Partida guardada vacía. */
export function defaultSave() {
  return {
    version: SAVE_VERSION,
    medals: 0,          // medallas disponibles para gastar
    medalsEarned: 0,    // total ganado (estadística)
    upgrades: {},       // id → nivel
    records: [],        // [{ points, nights, kills, time, date, weapon }]
    settings: {},       // opciones (calidad, temblor de cámara…)
    stats: { runs: 0, bestNight: 0, totalKills: 0 },
  };
}

const num = (v, def = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/** Valida y completa unos datos leídos (o de una versión anterior) contra el esquema actual. */
export function migrate(raw) {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object') return d;
  // (versión 1: no hay migraciones todavía; aquí irían las de versiones futuras)
  d.medals = Math.max(0, Math.floor(num(raw.medals)));
  d.medalsEarned = Math.max(d.medals, Math.floor(num(raw.medalsEarned)));
  for (const [k, v] of Object.entries(obj(raw.upgrades))) {
    const lv = Math.floor(num(v));
    if (lv > 0) d.upgrades[k] = lv;
  }
  if (Array.isArray(raw.records)) {
    d.records = raw.records
      .filter((r) => r && typeof r === 'object')
      .map((r) => ({
        points: num(r.points), nights: num(r.nights), kills: num(r.kills), time: num(r.time),
        date: typeof r.date === 'string' ? r.date : '', weapon: typeof r.weapon === 'string' ? r.weapon : '',
      }));
  }
  d.settings = { ...obj(raw.settings) };
  const s = obj(raw.stats);
  d.stats = { runs: num(s.runs), bestNight: num(s.bestNight), totalKills: num(s.totalKills) };
  return d;
}

/**
 * Inserta un récord y deja los `max` mejores (por puntos y, a igualdad, por noches).
 * @returns {{records: object[], rank: number}} rank = posición (0 = mejor) o -1 si no entra
 */
export function addRecord(records, entry, max) {
  const list = [...records, entry].sort((a, b) => b.points - a.points || b.nights - a.nights);
  const rank = list.indexOf(entry);
  return { records: list.slice(0, max), rank: rank < max ? rank : -1 };
}

export class SaveStore {
  /** @param {Storage|null} [storage] */
  constructor(key, storage) {
    this.key = key;
    try {
      this.storage = storage === undefined ? globalThis.localStorage ?? null : storage;
    } catch {
      this.storage = null; // acceder a localStorage puede lanzar si está bloqueado
    }
    this.ok = true;
  }

  load() {
    try {
      const txt = this.storage?.getItem(this.key);
      return migrate(txt ? JSON.parse(txt) : null);
    } catch {
      this.ok = false;
      return defaultSave();
    }
  }

  /** @returns {boolean} si se ha podido guardar */
  save(data) {
    try {
      if (!this.storage) return false;
      this.storage.setItem(this.key, JSON.stringify({ ...data, version: SAVE_VERSION }));
      this.ok = true;
      return true;
    } catch {
      this.ok = false;
      return false;
    }
  }

  clear() {
    try { this.storage?.removeItem(this.key); } catch { /* sin almacenamiento */ }
  }
}
