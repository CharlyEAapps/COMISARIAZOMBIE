import interactionsData from '../data/interactions.json';
import { STATION } from './Station.js';
import { resolveCircleVsGrid } from './Physics.js';
import { chooseSite, clock, insideBuilding, nearestZombie } from './missionUtils.js';

// Comportamiento de cada misión. El gestor (Missions.js) las arranca al empezar la noche y llama
// a update() en cada paso; cada tipo es un objeto con estos ganchos (todos opcionales):
//   start(m, M)          la noche empieza: crea entidades, interacciones y efectos
//   update(m, dt, M)     paso de lógica mientras la misión está activa
//   onEvent(m, ev, e, M) eventos del bus ('player:hurt', 'weapon:fired', 'grenade:thrown', 'zombie:killed')
//   interact(m, action, it, M) / availability(m, action, it, M)  acciones de las interacciones `mision_*`
//   evaluate(m, M)       al amanecer, si no se ha decidido antes: ¿cumplida?
//   penalty(m, M)        puntos que se pierden al fracasar un evento forzado
//   onResolve(m, M)      la misión se decide (éxito/fracaso) en mitad de la noche
//   cleanup(m, M)        quita todo lo que haya creado (idempotente)
//   fx(m, fx)            efectos globales mientras está activa (apagón, niebla, puntos por baja)
//   hud(m, M)            { text, state } para el HUD
//   target(m, M)         punto al que apuntar la flecha del HUD
// Todo el equilibrado sale de `m.p` (parámetros de missions.json ya escalados a la noche).

const TAU = Math.PI * 2;
const CHASE = 0; // estado "vivo" de los zombis
const _tmp = { x: 0, z: 0 };

/** Mundo (x, z) de un sitio: [i, j] = centro de la celda; {x, z} = coordenadas decimales de celda. */
export function sitePos(grid, s, out = { x: 0, z: 0 }) {
  if (Array.isArray(s)) { out.x = grid.centerX(s[0]); out.z = grid.centerZ(s[1]); } else {
    out.x = grid.originX + s.x * grid.cellSize;
    out.z = grid.originZ + s.z * grid.cellSize;
  }
  return out;
}

/** Punto transitable junto a la tienda del almacén donde se entregan las pruebas. */
export function findDropoff(grid, dist) {
  const w = grid.shops?.almacen?.[0];
  if (!w) return null;
  const bx = grid.centerX(w.i), bz = grid.centerZ(w.j);
  for (const [dx, dz] of [[0, dist], [0, -dist], [dist, 0], [-dist, 0], [dist, dist], [-dist, dist]]) {
    const x = bx + dx, z = bz + dz;
    if (grid.isWalkable(grid.cellX(x), grid.cellZ(z))) return { x, z };
  }
  return { x: bx, z: bz };
}

/** Puerta principal de la comisaría (por donde se mete al gato): el hueco de la fachada sur. */
export function frontDoor(grid) {
  const g = STATION.facade?.doorGaps?.[0];
  if (!g) return { x: 0, z: 0 };
  return { x: grid.originX + ((g[0] + g[1]) / 2) * grid.cellSize, z: grid.originZ + (STATION.building[3] + 0.5) * grid.cellSize };
}

const walkableAt = (grid) => (s, p) => grid.isWalkable(grid.cellX(p.x), grid.cellZ(p.z));

function playerFacing(player) {
  const a = player.aimDir;
  return a ? { x: a.x, z: a.z } : { x: 0, z: 1 };
}

/** Pega la entidad a la espalda del jugador. */
function carryAt(e, player, follow) {
  const f = playerFacing(player);
  e.x = player.position.x - f.x * follow;
  e.z = player.position.z - f.z * follow;
}

export const TYPES = {
  // ---------------------------------------------------------------- Apagón programado
  apagon: {
    start(m, M) {
      const g = M.game;
      const t = g.build?.transformer;
      m.s.timeLeft = m.p.deadline;
      m.s.blackout = true;
      if (t && t.hp > 0) {
        t.hp = 0;
        t.flash = 0.12;
        g.bus.emit('transformer:destroyed');
      }
      if (g.power) { g.power.generator = !!g.despacho?.emergencyOn; }
      // El cuadro eléctrico más lejano: se convierte en la caja de fusibles hasta que se arregla.
      const panels = g.interactions.items.filter((it) => it.type === 'cuadro_electrico');
      const p = g.player.position;
      panels.sort((a, b) => Math.hypot(b.x - p.x, b.z - p.z) - Math.hypot(a.x - p.x, a.z - p.z));
      const panel = panels[0] ?? g.interactions.items.find((it) => it.type === 'generador');
      if (panel) {
        m.s.panel = panel;
        m.s.origDef = panel.def;
        panel.def = { ...panel.def, ...interactionsData.mision_fusibles, hold: m.p.fuseHold, requiresPower: false };
        panel.missionId = m.id;
      }
    },
    update(m, dt, M) {
      const g = M.game;
      const t = g.build?.transformer;
      const fixed = t ? t.hp > 0 : !!g.power?.generator;
      if (fixed) { M.succeed(m); return; }
      m.s.timeLeft -= dt;
      if (m.s.timeLeft <= 0) M.fail(m);
    },
    interact(m, action, it, M) {
      const g = M.game;
      const t = g.build?.transformer;
      if (t) t.hp = Math.max(t.hp, t.maxHp * m.p.restoreFrac);
      else if (g.power) g.power.generator = true;
      return '🔌 ¡Fusibles cambiados! Vuelve la luz.';
    },
    evaluate(m, M) {
      const t = M.game.build?.transformer;
      return t ? t.hp > 0 : !!M.game.power?.generator;
    },
    onResolve(m) { m.s.blackout = false; TYPES.apagon.cleanup(m); },
    cleanup(m) {
      if (m.s.panel) { m.s.panel.def = m.s.origDef; delete m.s.panel.missionId; m.s.panel = null; }
      m.s.blackout = false;
    },
    fx(m, fx) { if (m.s.blackout) fx.blackout = true; },
    hud(m) {
      if (m.status === 'success') return { text: 'Luz recuperada', state: 'ok' };
      return { text: `Fusibles del cuadro · ${clock(m.s.timeLeft)}`, state: m.s.timeLeft < 20 ? 'warn' : '' };
    },
    target(m) { return m.s.panel ? m.s.panel : null; },
  },

  // ---------------------------------------------------------------- El concejal en apuros
  concejal: {
    start(m, M) {
      const g = M.game;
      const site = chooseSite(M.def(m).sites, (s) => sitePos(g.grid, s), null, g.player.position.x, g.player.position.z, M.cfg.common.minSpawnDistance, M.rnd);
      const p = sitePos(g.grid, site);
      m.s.where = site.where;
      const cell = g.grid.walkableCellAt(p.x, p.z);
      const lure = { x: p.x, z: p.z, radius: m.p.lureRadius };
      if (cell >= 0) { lure.x = g.grid.centerX(cell % g.grid.w); lure.z = g.grid.centerZ((cell / g.grid.w) | 0); }
      m.s.e = M.addEntity({ kind: 'concejal', x: p.x, z: p.z, y: site.y, hp: m.p.hp, maxHp: m.p.hp, lure, icon: '🎩', yell: 2 });
      M.toast(M.fill(M.line(m, 'start'), { where: site.where }), 6);
    },
    update(m, dt, M) {
      const e = m.s.e;
      const dmg = M.hurtEntity(e, dt, m.p);
      e.yell -= dt;
      if (e.yell <= 0) {
        e.yell = M.cfg.common.floatEvery * (0.7 + M.rnd() * 0.6);
        M.say(e.x, e.z, M.line(m, dmg > 0 ? 'hurt' : 'ambient'), 'quip', e.y + 1.2);
      }
      if (e.hp <= 0) M.fail(m);
    },
    evaluate(m) { return m.s.e.hp > 0; },
    onResolve(m, M) { if (m.status === 'failed') { M.removeEntity(m.s.e); m.s.e = null; } },
    cleanup(m, M) { if (m.s.e) { M.removeEntity(m.s.e); m.s.e = null; } },
    hud(m) {
      const e = m.s.e;
      if (!e) return { text: 'Concejal perdido', state: 'bad' };
      return { text: `Peláez ♥ ${Math.ceil((e.hp / e.maxHp) * 100)} %`, state: e.hp < e.maxHp * 0.4 ? 'warn' : '' };
    },
    target(m) { return m.s.e; },
  },

  // ---------------------------------------------------------------- Recuperar las pruebas
  pruebas: {
    start(m, M) {
      const g = M.game;
      const site = chooseSite(M.def(m).sites, (s) => sitePos(g.grid, s), walkableAt(g.grid), g.player.position.x, g.player.position.z, M.cfg.common.minSpawnDistance, M.rnd);
      const p = sitePos(g.grid, site);
      m.s.box = M.addEntity({ kind: 'box', x: p.x, z: p.z, y: 0, state: 'ground', icon: '📦' });
      m.s.drop = findDropoff(g.grid, m.p.deliverOffset) ?? { x: g.player.position.x, z: g.player.position.z };
      M.addItem(m, { id: `mision_caja`, type: 'mision_caja', x: p.x, z: p.z }, { hold: m.p.pickHold });
      M.addItem(m, { id: `mision_entrega`, type: 'mision_entrega', x: m.s.drop.x, z: m.s.drop.z }, { hold: m.p.deliverHold });
      M.toast(M.line(m, 'start'), 6);
    },
    update(m, dt, M) {
      const b = m.s.box;
      if (b.state === 'carried') carryAt(b, M.game.player, M.cfg.common.carryFollow);
    },
    availability(m, action, it, M) {
      const st = m.s.box.state;
      if (action === 'pickBox') return st === 'ground' ? { ok: true } : { ok: false, reason: 'Ya la llevas' };
      return st === 'carried' ? { ok: true } : { ok: false, reason: 'No llevas las pruebas' };
    },
    interact(m, action, it, M) {
      const b = m.s.box;
      if (action === 'pickBox') {
        b.state = 'carried';
        M.removeItem(m, 'mision_caja');
        return M.line(m, 'pickup');
      }
      b.state = 'delivered';
      b.x = m.s.drop.x; b.z = m.s.drop.z;
      M.removeItem(m, 'mision_entrega');
      M.succeed(m);
      return null;
    },
    onEvent(m, ev, e, M) {
      const b = m.s.box;
      if (ev !== 'player:hurt' || b?.state !== 'carried' || e.amount < m.p.dropDamage) return;
      b.state = 'ground';
      const px = M.game.player.position.x, pz = M.game.player.position.z;
      b.x = px; b.z = pz;
      M.addItem(m, { id: 'mision_caja', type: 'mision_caja', x: px, z: pz }, { hold: m.p.pickHold });
      M.toast(`📦 ${M.line(m, 'drop')}`, 4);
    },
    evaluate(m) { return m.s.box?.state === 'delivered'; },
    cleanup(m, M) { M.removeItems(m); if (m.s.box) { M.removeEntity(m.s.box); m.s.box = null; } },
    hud(m) {
      const st = m.s.box?.state;
      if (st === 'delivered') return { text: 'Pruebas entregadas', state: 'ok' };
      return { text: st === 'carried' ? 'Llévalas al almacén' : 'Busca la caja en el parking', state: '' };
    },
    target(m) {
      const b = m.s.box;
      if (!b || b.state === 'delivered') return null;
      return b.state === 'carried' ? m.s.drop : b;
    },
  },

  // ---------------------------------------------------------------- Noche de niebla
  niebla: {
    start(m, M) { M.toast(M.line(m, 'start'), 6); },
    evaluate(m, M) { const p = M.game.player; return p.alive && (p.hp / p.maxHp) * 100 >= m.p.minHpPct; },
    fx(m, fx) { fx.fog = m.p; },
    hud(m, M) {
      const p = M.game.player;
      const pct = Math.ceil((p.hp / p.maxHp) * 100);
      return { text: `Vida ${pct} % (mín. ${m.p.minHpPct} %)`, state: pct < m.p.minHpPct ? 'warn' : '' };
    },
  },

  // ---------------------------------------------------------------- Solo porra
  solo_porra: {
    start(m, M) { m.s.need = Math.max(1, Math.ceil(((M.game.waves?.total ?? 0) * m.p.killPct) / 100)); M.toast(M.line(m, 'start'), 6); },
    onEvent(m, ev, e, M) {
      if (m.status !== 'active') return;
      if (ev === 'weapon:fired' || ev === 'grenade:thrown') { M.toast(M.line(m, 'broken'), 4); M.fail(m); }
    },
    evaluate(m, M) { return (M.game.score?.nightStats?.kills ?? 0) >= m.s.need; },
    hud(m, M) {
      if (m.status === 'failed') return { text: 'Has disparado', state: 'bad' };
      const k = M.game.score?.nightStats?.kills ?? 0;
      return { text: `Solo cuerpo a cuerpo · bajas ${Math.min(k, m.s.need)}/${m.s.need}`, state: k >= m.s.need ? 'ok' : '' };
    },
  },

  // ---------------------------------------------------------------- Proteger el coche patrulla
  patrulla: {
    start(m, M) {
      const g = M.game;
      const site = chooseSite(M.def(m).sites, (s) => sitePos(g.grid, s), null, g.player.position.x, g.player.position.z, M.cfg.common.minSpawnDistance, M.rnd);
      const p = sitePos(g.grid, site);
      m.s.repairs = m.p.repairs;
      m.s.e = M.addEntity({ kind: 'car', x: p.x, z: p.z, rot: site.rot ?? 0, hp: m.p.hp, maxHp: m.p.hp, lure: { x: p.x, z: p.z, radius: m.p.lureRadius }, icon: '🚓', smoke: 0 });
      M.addItem(m, { id: 'mision_coche', type: 'mision_coche', x: p.x, z: p.z + 1.6 }, { hold: m.p.repairHold, radius: 2.2 });
      M.toast(M.line(m, 'start'), 6);
    },
    update(m, dt, M) {
      const e = m.s.e;
      if (e.hp <= 0) return;
      M.hurtEntity(e, dt, m.p);
      e.smoke -= dt;
      if (e.hp < e.maxHp * 0.4 && e.smoke <= 0) {
        e.smoke = 0.25;
        M.game.effects?.burst(e.x, 1.2, e.z, 2, 0x2b2b2b, { speed: 1, up: 2.5, size: 0.14, life: 1.2 });
      }
      if (e.hp <= 0) {
        M.game.effects?.burst(e.x, 1, e.z, 28, 0xffa030, { speed: 4, up: 5, size: 0.12, life: 0.8 });
        M.game.effects?.shake(0.25);
        M.fail(m);
      }
    },
    availability(m) {
      const e = m.s.e;
      if (!e || e.hp <= 0) return { ok: false, reason: 'Siniestro total' };
      if (e.hp >= e.maxHp) return { ok: false, reason: 'No hace falta' };
      if (m.s.repairs <= 0) return { ok: false, reason: 'Sin cinta americana' };
      return { ok: true };
    },
    interact(m, action, it, M) {
      const e = m.s.e;
      e.hp = Math.min(e.maxHp, e.hp + e.maxHp * m.p.repairHeal);
      m.s.repairs--;
      if (m.s.repairs <= 0) M.removeItem(m, 'mision_coche');
      return M.line(m, 'repaired');
    },
    evaluate(m) { return m.s.e.hp > 0; },
    onResolve(m, M) { M.removeItems(m); },
    cleanup(m, M) { M.removeItems(m); if (m.s.e) { M.removeEntity(m.s.e); m.s.e = null; } },
    hud(m) {
      const e = m.s.e;
      if (!e) return { text: 'Coche perdido', state: 'bad' };
      const pct = Math.ceil((e.hp / e.maxHp) * 100);
      return { text: `Coche ♥ ${pct} % · cinta ×${m.s.repairs}`, state: e.hp <= 0 ? 'bad' : pct < 40 ? 'warn' : '' };
    },
    target(m) { return m.s.e; },
  },

  // ---------------------------------------------------------------- El gato del comisario
  gato: {
    start(m, M) {
      const g = M.game;
      const site = chooseSite(M.def(m).sites, (s) => sitePos(g.grid, s), walkableAt(g.grid), g.player.position.x, g.player.position.z, M.cfg.common.minSpawnDistance, M.rnd);
      const p = sitePos(g.grid, site);
      m.s.cat = M.addEntity({
        kind: 'cat', x: p.x, z: p.z, y: 0, hx: p.x, hz: p.z, tx: p.x, tz: p.z, wander: 0, meow: 3,
        vx: 0, vz: 0, facing: 0, radius: 0.22, hp: m.p.hp, maxHp: m.p.hp, state: 'loose', icon: '🐈',
        lure: { x: p.x, z: p.z, radius: m.p.lureRadius },
      });
      M.addItem(m, { id: 'mision_gato', type: 'mision_gato', x: p.x, z: p.z }, { hold: m.p.catchHold });
      M.toast(M.line(m, 'start'), 6);
    },
    update(m, dt, M) {
      const g = M.game;
      const c = m.s.cat;
      if (c.state === 'carried') { carryAt(c, g.player, M.cfg.common.carryFollow * 0.6); c.vx = c.vz = 0; }
      if (c.state === 'carried' && insideBuilding(g.grid, STATION.building, g.player.position.x, g.player.position.z)) {
        c.state = 'safe';
        c.x = g.player.position.x; c.z = g.player.position.z;
        M.succeed(m);
        return;
      }
      if (c.state !== 'loose') return;
      const P = m.p;
      // Huye de los zombis cercanos; si no, pasea por su zona.
      const dz = nearestZombie(g.zombies.active, c.x, c.z, P.fleeRange, _tmp);
      let speed = 0, dx = 0, dzv = 0;
      if (dz < Infinity) {
        const d = Math.hypot(c.x - _tmp.x, c.z - _tmp.z) || 1;
        dx = (c.x - _tmp.x) / d; dzv = (c.z - _tmp.z) / d; speed = P.fleeSpeed;
      } else {
        c.wander -= dt;
        if (c.wander <= 0) {
          const a = M.rnd() * TAU, r = M.rnd() * P.wanderRadius;
          c.tx = c.hx + Math.cos(a) * r; c.tz = c.hz + Math.sin(a) * r;
          c.wander = 2 + M.rnd() * 3;
        }
        const tx = c.tx - c.x, tz = c.tz - c.z, td = Math.hypot(tx, tz);
        if (td > 0.25) { dx = tx / td; dzv = tz / td; speed = P.wanderSpeed; }
      }
      c.vx += (dx * speed - c.vx) * Math.min(1, dt * 8);
      c.vz += (dzv * speed - c.vz) * Math.min(1, dt * 8);
      c.x += c.vx * dt; c.z += c.vz * dt;
      resolveCircleVsGrid(c, c.radius, g.grid);
      if (Math.hypot(c.vx, c.vz) > 0.1) c.facing = Math.atan2(c.vx, c.vz);
      c.lure.x = c.x; c.lure.z = c.z;
      // El pickup sigue al gato.
      const it = g.interactions.items.find((x) => x.id === 'mision_gato');
      if (it) { it.x = c.x; it.z = c.z; }
      M.hurtEntity(c, dt, P);
      c.meow -= dt;
      if (c.meow <= 0) { c.meow = M.cfg.common.floatEvery * (0.6 + M.rnd() * 0.8); M.say(c.x, c.z, M.line(m, 'ambient'), 'quip', 0.9); }
      if (c.hp <= 0) { c.state = 'dead'; M.fail(m); }
    },
    availability(m) { return m.s.cat.state === 'loose' ? { ok: true } : { ok: false, reason: 'Ya lo llevas' }; },
    interact(m, action, it, M) {
      m.s.cat.state = 'carried';
      m.s.cat.lure = null;
      M.removeItem(m, 'mision_gato');
      return M.line(m, 'caught');
    },
    evaluate(m) { return m.s.cat?.state === 'safe'; },
    onResolve(m, M) {
      M.removeItems(m);
      if (m.status === 'failed' && m.s.cat) { M.removeEntity(m.s.cat); m.s.cat = null; }
    },
    cleanup(m, M) { M.removeItems(m); if (m.s.cat) { M.removeEntity(m.s.cat); m.s.cat = null; } },
    hud(m) {
      const c = m.s.cat;
      if (!c) return { text: 'Bigotes perdido', state: 'bad' };
      if (c.state === 'safe') return { text: 'Bigotes a salvo', state: 'ok' };
      if (c.state === 'carried') return { text: 'Llévalo dentro de la comisaría', state: '' };
      return { text: `Atrapa a Bigotes ♥ ${Math.ceil((c.hp / c.maxHp) * 100)} %`, state: c.hp < c.maxHp * 0.5 ? 'warn' : '' };
    },
    target(m, M) {
      const c = m.s.cat;
      if (!c || c.state === 'safe') return null;
      return c.state === 'carried' ? frontDoor(M.game.grid) : c;
    },
  },

  // ---------------------------------------------------------------- Inspección de Hacienda
  hacienda: {
    start(m, M) { m.s.fined = 0; M.toast(M.line(m, 'start'), 6); },
    update(m, dt, M) {
      if (M.spent > 0.5) { M.toast(M.line(m, 'broken'), 4); M.fail(m); }
    },
    penalty(m, M) {
      return Math.min(m.p.fineMax, Math.round((M.game.run.points * m.p.finePct) / 100));
    },
    evaluate() { return true; },
    hud(m) { return m.status === 'failed' ? { text: 'Gasto detectado', state: 'bad' } : { text: 'No gastes ni un punto', state: '' }; },
  },

  // ---------------------------------------------------------------- Horda de antidisturbios
  antidisturbios: {
    start(m, M) {
      m.s.delay = m.p.delay;
      m.s.spawned = false;
      m.s.total = Math.round(m.p.count);
      m.s.killed = 0;
      m.s.timeLeft = m.p.timeLimit;
      M.toast(M.line(m, 'start'), 6);
    },
    update(m, dt, M) {
      const g = M.game;
      if (!m.s.spawned) {
        m.s.delay -= dt;
        if (m.s.delay > 0) return;
        const spawns = g.waves?.activeSpawns ?? [];
        let best = spawns[0], bestD = -1;
        const p = g.player.position;
        for (const s of spawns) {
          const d = Math.hypot(g.grid.centerX(s.i) - p.x, g.grid.centerZ(s.j) - p.z);
          if (d > bestD) { bestD = d; best = s; }
        }
        let n = 0;
        if (best) for (let k = 0; k < m.s.total; k++) if (g.waves.spawnAt(best, M.def(m).type)) n++;
        if (!n) { m.s.delay = 1; return; } // sin hueco en el pool: se reintenta
        m.s.total = n;
        m.s.spawned = true;
        M.toast(M.line(m, 'arrived'), 6);
        return;
      }
      if (m.s.killed >= m.s.total) { M.succeed(m); return; }
      m.s.timeLeft -= dt;
      if (m.s.timeLeft <= 0) M.fail(m);
    },
    onEvent(m, ev, e) {
      if (ev === 'zombie:killed' && m.s.spawned && e.type === 'agente_antidisturbios') m.s.killed++;
    },
    evaluate(m) { return m.s.spawned && m.s.killed >= m.s.total; },
    hud(m) {
      if (m.status === 'success') return { text: 'Pelotón desmantelado', state: 'ok' };
      if (!m.s.spawned) return { text: `Llegan en ${clock(m.s.delay)}`, state: '' };
      return { text: `Quedan ${m.s.total - m.s.killed} · ${clock(m.s.timeLeft)}`, state: m.s.timeLeft < 30 ? 'warn' : '' };
    },
  },

  // ---------------------------------------------------------------- Horas extra
  horas_extra: {
    start(m, M) {
      const w = M.game.waves;
      m.s.extra = Math.round((w.total * m.p.extraPct) / 100);
      w.toSpawn += m.s.extra;
      w.total += m.s.extra;
      M.toast(M.line(m, 'start'), 6);
    },
    update(m, dt, M) {
      const dn = M.game.dayNight;
      if (dn.t > dn.duration + m.p.graceSeconds) M.fail(m);
    },
    evaluate(m, M) { const dn = M.game.dayNight; return dn.t <= dn.duration + m.p.graceSeconds; },
    fx(m, fx) { fx.killPointsMul *= m.p.killPointsMul; },
    hud(m, M) {
      const dn = M.game.dayNight;
      if (m.status === 'failed') return { text: 'Te has pasado de hora', state: 'bad' };
      const left = dn.duration + m.p.graceSeconds - dn.t;
      return { text: `Reloj ${clock(left)} · ×${m.p.killPointsMul} bajas`, state: left < 30 ? 'warn' : '' };
    },
  },
};
