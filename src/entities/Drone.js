import { PHASE } from '../systems/DayNight.js';
import { scaledCost } from '../systems/BuildSystem.js';

// Dron de mantenimiento (mejora del despacho, en el almacén de pruebas). De día despega de su
// base y vuela por encima de los muros: repone poco a poco la munición de las torretas del
// jugador y repara lo dañado (barricadas, sacos, vallas, puertas, torretas, el transformador…),
// cobrando cada reparación como una normal y solo si hay puntos. Al anochecer vuelve a la base
// y se queda cargando. No se puede destruir y los zombis no lo ven (no está en ninguna lista suya).
// Lógica en pasos fijos y sin asignaciones por paso; lo que se ve lo pinta render/DroneRenderer.js.
// Los datos (velocidades, tiempos, costes por nivel...) están en despacho.json → upgrades.dron.

export const DRONE_STATE = { OFF: 0, DOCKED: 1, PATROL: 2, FLY: 3, WORK: 4, HOME: 5 };
export const DRONE_JOB = { NONE: 0, REPAIR: 1, AMMO: 2, TRANSFORMER: 3 };

/** Valor de una tabla por nivel (`arr[level - 1]`), o `def` con nivel 0. */
const byLevel = (arr, level, def) => (level > 0 ? arr[Math.min(level, arr.length) - 1] : def);

/** ¿Se puede comprar ya una mejora con `availableFromNight` en la noche (o el día) `night`? */
export function droneAvailable(u, night) {
  return !u?.availableFromNight || night >= u.availableFromNight;
}

/**
 * Puntuación de un trabajo (función pura): más alta cuanto más dañado (o más vacío) y más cerca.
 * `frac` = parte que falta (0–1), `dist` en metros, `weight` = peso del tipo de trabajo.
 */
export function jobScore(frac, dist, weight, cfg) {
  return frac * weight - dist * cfg.distWeight;
}

export class Drone {
  /**
   * @param {object} cfg despacho.json → upgrades.dron
   * @param {(u:number)=>number} wx  @param {(v:number)=>number} wz  celdas → metros del mundo
   */
  constructor(game, cfg, wx, wz) {
    this.game = game;
    this.cfg = cfg;
    this.baseX = wx(cfg.base.x);
    this.baseZ = wz(cfg.base.z);
    this.patrol = cfg.patrol.map(([x, z]) => ({ x: wx(x), z: wz(z) }));
    this.kinds = new Set(cfg.repairKinds);
    this.pos = { x: this.baseX, y: cfg.parkY, z: this.baseZ };
    this.vel = { x: 0, z: 0 };
    this.level = 0;
    this.reset();
  }

  reset() {
    this.state = DRONE_STATE.OFF;
    this.pos.x = this.baseX; this.pos.y = this.cfg.parkY; this.pos.z = this.baseZ;
    this.vel.x = 0; this.vel.z = 0;
    this.yaw = 0;
    this.charge = 1;
    this.landing = false;
    this.clearJob();
    this.retarget = 0;
    this.patrolIdx = 0;
    this.weldT = 0;
    this.humT = 0;
    this.warnedNight = -1;  // noche (día) en que ya avisó de que no hay presupuesto
    this.repairs = 0;       // contadores (QA y tests)
    this.spent = 0;
    this.ammoGiven = 0;
  }

  clearJob() {
    this.job = DRONE_JOB.NONE;
    this.target = null;
    this.tx = 0; this.tz = 0;
    this.workT = 0;
    this.ammoAcc = 0;
    this.ammoAdded = 0;
  }

  get active() {
    return this.state !== DRONE_STATE.OFF;
  }

  get docked() {
    return this.state === DRONE_STATE.DOCKED;
  }

  /** ¿Está trabajando sobre un objetivo (rayo y chispas)? */
  get working() {
    return this.state === DRONE_STATE.WORK;
  }

  /** Nivel de la mejora (0 = no hay dron). */
  setLevel(level) {
    this.level = level;
    if (!level) this.reset();
  }

  /** Aparece aparcado en su base (al comprarlo o al continuar un turno). */
  spawnAtBase() {
    const lvl = this.level;
    this.reset();
    this.level = lvl;
    if (lvl > 0) this.state = DRONE_STATE.DOCKED;
  }

  get speed() { return byLevel(this.cfg.speed, this.level, 0); }
  get repairSeconds() { return byLevel(this.cfg.repairSeconds, this.level, 0); }
  get costMul() { return byLevel(this.cfg.repairCostMul, this.level, 1); }
  get ammoRate() { return byLevel(this.cfg.ammoPerSec, this.level, 0); }

  // ------------------------------------------------------------------ paso fijo
  update(dt) {
    if (!this.active) return;
    const { cfg, game } = this;
    const day = game.dayNight.phase === PHASE.DAY;

    if (this.state === DRONE_STATE.DOCKED) {
      this.charge = Math.min(1, this.charge + cfg.chargePerSec * dt);
      if (day && this.charge >= cfg.resumeCharge) {
        this.state = DRONE_STATE.PATROL;
        this.retarget = 0;
      }
      return;
    }
    this.charge = Math.max(0, this.charge - cfg.drainPerSec * dt);
    // Al anochecer (o sin batería) se deja lo que esté haciendo y vuelve a cargar.
    if ((!day || this.charge <= 0) && this.state !== DRONE_STATE.HOME) {
      this.clearJob();
      this.state = DRONE_STATE.HOME;
    }
    this.humT -= dt;
    if (this.humT <= 0) {
      this.humT = cfg.humEvery;
      game.bus?.emit('drone:hum', this.pos);
    }

    switch (this.state) {
      case DRONE_STATE.HOME:
        // Llega por arriba y luego baja en vertical hasta posarse.
        if (this.landing || this.flyTo(this.baseX, this.baseZ, dt)) {
          this.landing = true;
          if (this.descend(dt)) {
            this.state = DRONE_STATE.DOCKED;
            this.landing = false;
            this.vel.x = 0; this.vel.z = 0;
          }
        }
        break;
      case DRONE_STATE.PATROL: {
        this.retarget -= dt;
        if (this.retarget <= 0) {
          this.retarget = cfg.retarget;
          if (this.pickJob()) { this.state = DRONE_STATE.FLY; break; }
        }
        const p = this.patrol[this.patrolIdx];
        if (this.flyTo(p.x, p.z, dt)) this.patrolIdx = (this.patrolIdx + 1) % this.patrol.length;
        break;
      }
      case DRONE_STATE.FLY:
        if (!this.jobValid()) { this.toPatrol(); break; }
        if (this.flyTo(this.tx, this.tz, dt)) {
          this.state = DRONE_STATE.WORK;
          this.workT = 0;
          this.weldT = 0;
        }
        break;
      case DRONE_STATE.WORK:
        this.hover(dt);
        this.work(dt);
        break;
    }
  }

  toPatrol() {
    this.clearJob();
    this.state = DRONE_STATE.PATROL;
    this.retarget = 0;
  }

  /** Sube a la altura de vuelo y avanza hacia (tx, tz) con aceleración suave. @returns {boolean} llegó */
  flyTo(tx, tz, dt) {
    const { cfg } = this;
    // Primero sube en vertical (no atraviesa muros al despegar desde dentro del almacén).
    if (this.pos.y < cfg.flyY - 0.05) {
      this.pos.y = Math.min(cfg.flyY, this.pos.y + cfg.climbSpeed * dt);
      this.brake(dt);
      return false;
    }
    this.pos.y = cfg.flyY;
    const dx = tx - this.pos.x, dz = tz - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d <= cfg.arriveDist) {
      this.brake(dt);
      return true;
    }
    // Llega frenando: la velocidad deseada baja al acercarse.
    const want = Math.min(this.speed, Math.sqrt(2 * cfg.accel * d));
    const vx = (dx / d) * want, vz = (dz / d) * want;
    const step = cfg.accel * dt;
    this.vel.x += Math.max(-step, Math.min(step, vx - this.vel.x));
    this.vel.z += Math.max(-step, Math.min(step, vz - this.vel.z));
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.yaw = Math.atan2(dx, dz);
    return false;
  }

  /** Frena (se queda flotando). */
  brake(dt) {
    const k = Math.max(0, 1 - this.cfg.accel * dt);
    this.vel.x *= k; this.vel.z *= k;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
  }

  /** Flota sobre el objetivo. */
  hover(dt) {
    this.brake(dt);
    this.pos.x += (this.tx - this.pos.x) * Math.min(1, dt * 2);
    this.pos.z += (this.tz - this.pos.z) * Math.min(1, dt * 2);
  }

  /** Baja hasta posarse en la base. @returns {boolean} aterrizado */
  descend(dt) {
    const { cfg } = this;
    this.pos.x += (this.baseX - this.pos.x) * Math.min(1, dt * 3);
    this.pos.z += (this.baseZ - this.pos.z) * Math.min(1, dt * 3);
    this.pos.y = Math.max(cfg.parkY, this.pos.y - cfg.climbSpeed * dt);
    return this.pos.y <= cfg.parkY + 1e-6;
  }

  // ------------------------------------------------------------------ trabajos
  /**
   * Elige el mejor trabajo: lo más dañado (o la torreta más vacía) y más cercano. Lo que no se
   * puede pagar se salta un rato y se avisa como mucho una vez por día. @returns {boolean}
   */
  pickJob() {
    const { cfg, game } = this;
    const { build, run } = game;
    const now = game.time;
    const x = this.pos.x, z = this.pos.z;
    let best = -Infinity, kind = DRONE_JOB.NONE, target = null, tx = 0, tz = 0;
    for (const s of build.all) {
      if (!this.kinds.has(s.def.kind) || s.hp <= 0 || s.hp >= s.maxHp || now < s.repairReady) continue;
      if ((s.droneSkipUntil ?? 0) > now) continue;
      const frac = 1 - s.hp / s.maxHp;
      if (frac < cfg.minDamage) continue;
      const sc = jobScore(frac, Math.hypot(s.cx - x, s.cz - z), cfg.repairWeight, cfg);
      if (sc <= best) continue;
      const cost = scaledCost(build.repairCostOf(s), this.costMul);
      if (run.points < cost) { this.noBudget(s, s.def.name.toLowerCase(), cost); continue; }
      best = sc; kind = DRONE_JOB.REPAIR; target = s; tx = s.cx; tz = s.cz;
    }
    for (const s of build.turrets) {
      if (!(s.ammoMax > 0) || s.ammo >= s.ammoMax) continue;
      const frac = 1 - s.ammo / s.ammoMax;
      if (frac < cfg.minAmmo) continue;
      const sc = jobScore(frac, Math.hypot(s.cx - x, s.cz - z), cfg.ammoWeight, cfg);
      if (sc > best) { best = sc; kind = DRONE_JOB.AMMO; target = s; tx = s.cx; tz = s.cz; }
    }
    const t = build.transformer;
    if (t && t.hp < t.maxHp && (t.droneSkipUntil ?? 0) <= now) {
      const frac = 1 - t.hp / t.maxHp;
      const sc = frac >= cfg.minDamage ? jobScore(frac, Math.hypot(t.x - x, t.z - z), cfg.repairWeight, cfg) : -Infinity;
      if (sc > best) {
        const cost = scaledCost(build.transformerRepairCost(), this.costMul);
        if (run.points < cost) this.noBudget(t, cfg.transformerName, cost);
        else { best = sc; kind = DRONE_JOB.TRANSFORMER; target = t; tx = t.x; tz = t.z; }
      }
    }
    if (kind === DRONE_JOB.NONE) return false;
    this.clearJob();
    this.job = kind; this.target = target; this.tx = tx; this.tz = tz;
    return true;
  }

  /** Sin puntos para `obj`: se salta un rato y avisa (una vez por día). */
  noBudget(obj, what, cost) {
    const { cfg, game } = this;
    obj.droneSkipUntil = game.time + cfg.skipSeconds;
    const night = game.dayNight.night;
    if (this.warnedNight === night) return;
    this.warnedNight = night;
    game.hud?.toast(cfg.noBudgetMsg.replace('{what}', what).replace('{p}', cost), 4);
  }

  /** ¿Sigue haciendo falta el trabajo en curso? */
  jobValid() {
    const s = this.target;
    const { build } = this.game;
    if (this.job === DRONE_JOB.REPAIR) return build.all.has(s) && s.hp > 0 && s.hp < s.maxHp;
    if (this.job === DRONE_JOB.AMMO) return build.all.has(s) && s.ammo < s.ammoMax;
    if (this.job === DRONE_JOB.TRANSFORMER) return s === build.transformer && s.hp < s.maxHp;
    return false;
  }

  /** Trabajo sobre el objetivo: soldadura (reparar) o recarga de munición. */
  work(dt) {
    const { cfg, game } = this;
    if (!this.jobValid()) { this.finishAmmo(); this.toPatrol(); return; }
    this.workT += dt;
    this.weldT -= dt;
    if (this.weldT <= 0) {
      this.weldT = cfg.weldEvery;
      game.bus?.emit('drone:weld', this);
    }
    if (this.job === DRONE_JOB.AMMO) {
      const s = this.target;
      this.ammoAcc += this.ammoRate * dt;
      while (this.ammoAcc >= 1 && s.ammo < s.ammoMax) {
        this.ammoAcc -= 1;
        s.ammo++;
        this.ammoAdded++;
      }
      s.emptyWarned = false;
      if (s.ammo >= s.ammoMax || this.workT >= cfg.ammoSeconds) { this.finishAmmo(); this.toPatrol(); }
      return;
    }
    if (this.workT < this.repairSeconds) return;
    this.finishRepair();
    this.toPatrol();
  }

  finishAmmo() {
    if (this.job !== DRONE_JOB.AMMO || !this.ammoAdded) return;
    const s = this.target;
    this.ammoGiven += this.ammoAdded;
    this.game.floating?.spawn(this.cfg.ammoFloat.replace('{n}', this.ammoAdded), s.cx, 1.8, s.cz, 'pts');
    this.ammoAdded = 0;
  }

  /** Cobra y repara (si sigue habiendo puntos; si no, avisa y lo salta). */
  finishRepair() {
    const { cfg, game } = this;
    const { build } = game;
    const s = this.target;
    const tr = this.job === DRONE_JOB.TRANSFORMER;
    const cost = tr ? build.remoteRepairTransformer(this.costMul) : build.remoteRepair(s, this.costMul);
    const x = tr ? s.x : s.cx, z = tr ? s.z : s.cz;
    if (!cost) {
      const need = scaledCost(tr ? build.transformerRepairCost() : build.repairCostOf(s), this.costMul);
      if (need > game.run.points) this.noBudget(s, tr ? cfg.transformerName : s.def.name.toLowerCase(), need);
      return;
    }
    this.repairs++;
    this.spent += cost;
    game.floating?.spawn(cfg.repairFloat.replace('{p}', cost), x, 1.8, z, 'neg');
    game.bus?.emit('drone:repaired', { x, z, cost });
  }
}
