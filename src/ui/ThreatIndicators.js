import * as THREE from 'three';
import config from '../data/config.json';
import { Z_STATE } from '../systems/ZombieSystem.js';

// Indicadores de amenaza:
//  1) Flechas en el borde de la pantalla hacia los zombis peligrosos cercanos que están fuera de
//     cuadro (escupidor, explosivo, tanque, jefe) y hacia grupos de zombis normales.
//  2) Destello rojo direccional al recibir daño (en el lado de donde viene el golpe).
// Todo el DOM se crea una vez (pool) y se reutiliza; las flechas se refrescan a ~15 Hz.

const T = config.threats;
const TAU = Math.PI * 2;
const MAX_ARROWS = T.maxArrows;
const SIDES = ['top', 'right', 'bottom', 'left'];

/**
 * Calcula dónde colocar una flecha en el borde de la pantalla (función pura, sin asignaciones).
 * `nx, ny` es la posición NDC del objetivo (-1..1, y hacia arriba); `behind` es true si queda
 * detrás de la cámara (la dirección se invierte). `L` describe el rectángulo interior:
 *   w, h, left, top, right, bottom            límites en px de la zona donde cabe el centro de la flecha
 *   leftMinY, leftMaxY, rightMinY, rightMaxY  rango de y permitido pegado a cada lado (evita botones)
 *   bottomMinX, bottomMaxX                    rango de x permitido en el borde inferior (evita esquinas)
 *   topMinX, topMaxX                          rango de x permitido en el borde superior (evita botones y paneles)
 * Devuelve `out` con x, y (px) y angle (radianes, 0 = derecha, y hacia abajo) del rayo centro -> objetivo.
 */
export function edgePosition(nx, ny, behind, L, out) {
  const cx = L.w * 0.5, cy = L.h * 0.5;
  let dx = nx * cx, dy = -ny * cy;
  if (behind) { dx = -dx; dy = -dy; }
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) dy = 1;
  const tx = dx > 0 ? (L.right - cx) / dx : dx < 0 ? (L.left - cx) / dx : Infinity;
  const ty = dy > 0 ? (L.bottom - cy) / dy : dy < 0 ? (L.top - cy) / dy : Infinity;
  let x, y;
  if (tx <= ty) {
    // Sale por un lado vertical: se limita la altura para no tapar botones y paneles.
    x = dx > 0 ? L.right : L.left;
    y = cy + dy * tx;
    const lo = dx > 0 ? L.rightMinY : L.leftMinY;
    const hi = dx > 0 ? L.rightMaxY : L.leftMaxY;
    y = y > hi ? hi : y < lo ? Math.min(lo, hi) : y;
  } else {
    y = dy > 0 ? L.bottom : L.top;
    x = cx + dx * ty;
    const xlo = dy > 0 ? L.bottomMinX : L.topMinX, xhi = dy > 0 ? L.bottomMaxX : L.topMaxX;
    x = x < xlo ? xlo : x > xhi ? xhi : x;
  }
  out.x = x; out.y = y; out.angle = Math.atan2(dy, dx);
  return out;
}

/**
 * Rectángulo interior para `edgePosition` según el modo (táctil o escritorio), el tamaño de
 * pantalla y los márgenes seguros. `extraTop` deja sitio a la barra del jefe.
 */
export function computeLayout(w, h, mode, safe, extraTop, out) {
  const m = T.layout.margin;
  out.w = w; out.h = h;
  out.left = safe.left + m;
  out.right = w - safe.right - m;
  out.top = safe.top + mode.top + extraTop;
  out.bottom = h - safe.bottom - Math.max(mode.bottomPx, mode.bottomFrac * h);
  const sideTop = safe.top + mode.sideTop;
  out.leftMinY = Math.max(sideTop, mode.leftMinY);
  out.leftMaxY = Math.min(out.bottom, h - safe.bottom - mode.leftMaxFromBottom);
  out.rightMinY = sideTop;
  out.rightMaxY = Math.min(out.bottom, h - safe.bottom - mode.rightMaxFromBottom);
  out.bottomMinX = Math.max(out.left, w * mode.cornerFrac);
  out.bottomMaxX = Math.min(out.right, w * (1 - mode.cornerFrac));
  out.topMinX = Math.max(out.left, safe.left + mode.topMinX);
  out.topMaxX = out.right;
  return out;
}

/** Lado de pantalla (0 arriba, 1 derecha, 2 abajo, 3 izquierda) -> peso del destello (puro). */
export function hurtWeights(ux, uy, out) {
  const m = Math.max(Math.abs(ux), Math.abs(uy)) || 1;
  out[0] = Math.max(0, -uy) / m;
  out[1] = Math.max(0, ux) / m;
  out[2] = Math.max(0, uy) / m;
  out[3] = Math.max(0, -ux) / m;
  return out;
}

function makeCand() {
  return { score: 0, kind: 0, icon: '', dist: 0, nx: 0, ny: 0, behind: false };
}

export class ThreatIndicators {
  constructor(game) {
    this.game = game;
    this.root = document.createElement('div');
    this.root.className = 'threats';
    game.uiRoot.appendChild(this.root);

    // Destello de daño: una franja por lado, la opacidad se reparte según la dirección del golpe.
    this.hurtEls = SIDES.map((s) => {
      const el = document.createElement('div');
      el.className = `hurt-dir ${s}`;
      this.root.appendChild(el);
      return el;
    });
    this.hurtW = new Float32Array(4);
    this.hurtShown = new Float32Array(4);
    this.hurtT = 0;

    // Pool de flechas.
    this.slots = [];
    for (let i = 0; i < MAX_ARROWS; i++) {
      const el = document.createElement('div');
      el.className = 'threat';
      el.style.display = 'none';
      const arrow = document.createElement('div');
      arrow.className = 'threat-arrow';
      const badge = document.createElement('div');
      badge.className = 'threat-badge';
      const icon = document.createElement('span');
      icon.className = 'threat-icon';
      const dist = document.createElement('span');
      dist.className = 'threat-dist';
      badge.append(icon, dist);
      el.append(arrow, badge);
      this.root.appendChild(el);
      this.slots.push({ el, arrow, icon, dist, kind: -1, iconTxt: '', distTxt: '', x: -9999, y: -9999, deg: -9999, shown: false });
    }
    this.shown = 0;

    // Candidatos (ordenados por prioridad) y sectores para agrupar zombis normales.
    this.cands = Array.from({ length: MAX_ARROWS + 1 }, makeCand);
    this.nc = 0;
    const S = T.sectors;
    this.secCount = new Int16Array(S);
    this.secX = new Float32Array(S);
    this.secZ = new Float32Array(S);
    this.secNear = new Float32Array(S);
    this.px = new Float32Array(MAX_ARROWS);
    this.py = new Float32Array(MAX_ARROWS);
    this.pIcon = new Array(MAX_ARROWS).fill('');

    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._pos = { x: 0, y: 0, angle: 0 };
    this._layout = {};
    this._safe = { top: 0, right: 0, bottom: 0, left: 0 };
    this._probe = document.createElement('div');
    this._probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;width:0;height:0;' +
      'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
    this.root.appendChild(this._probe);
    this._mw = -1; this._mh = -1; this._measureT = 0;
    this._touch = false;
    this._hudEl = null;
    this._acc = 0;
    this._visible = true;
    this._interval = 1 / T.updateHz;

    this._offHurt = game.bus.on('player:hurt', () => this.onHurt());
  }

  /** Márgenes seguros del dispositivo (muesca, barra de inicio): se mide al cambiar de tamaño. */
  measure(w, h) {
    const cs = getComputedStyle(this._probe);
    const s = this._safe;
    s.top = parseFloat(cs.paddingTop) || 0;
    s.right = parseFloat(cs.paddingRight) || 0;
    s.bottom = parseFloat(cs.paddingBottom) || 0;
    s.left = parseFloat(cs.paddingLeft) || 0;
    this._mw = w; this._mh = h; this._measureT = 0;
    this._hudEl = this.game.uiRoot.querySelector('.hud');
  }

  /** ¿Debe mostrarse algo? No en menús, en pausa ni con el jugador muerto. */
  active() {
    const g = this.game;
    return g.state === 'playing' && g.player.alive && !g.uiRoot.classList.contains('in-menu');
  }

  setVisible(v) {
    if (v === this._visible) return;
    this._visible = v;
    this.root.style.display = v ? '' : 'none';
    if (!v) this.clearArrows();
  }

  // ------------------------------------------------------------------ destello direccional
  onHurt() {
    const g = this.game;
    if (!g.player.alive || !this.active()) return;
    const cfg = T.hurt;
    const px = g.player.position.x, pz = g.player.position.z;
    let best = null, bestD = cfg.range * cfg.range;
    for (const z of g.zombies.active) {
      if (z.state !== Z_STATE.CHASE) continue;
      const dx = z.pos.x - px, dz = z.pos.z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD) { bestD = d2; best = z; }
    }
    // Sin zombi cerca (ácido, explosión...): queda solo el destello general del HUD.
    if (!best || bestD < 1e-4) return;
    const cam = g.cameraRig.camera;
    const w = g.canvas.clientWidth || 1, h = g.canvas.clientHeight || 1;
    const a = this._v.set(px, T.aimHeight, pz).project(cam);
    const b = this._v2.set(best.pos.x, T.aimHeight, best.pos.z).project(cam);
    const ux = (b.x - a.x) * w * 0.5, uy = -(b.y - a.y) * h * 0.5;
    if (ux * ux + uy * uy < 1e-6) return;
    hurtWeights(ux, uy, this.hurtW);
    this.hurtT = cfg.duration;
  }

  updateHurt(dt) {
    const cfg = T.hurt;
    if (this.hurtT <= 0) return;
    this.hurtT = Math.max(0, this.hurtT - dt);
    const k = (this.hurtT / cfg.duration) * cfg.strength;
    for (let i = 0; i < 4; i++) {
      const v = Math.round(this.hurtW[i] * k * 100) / 100;
      if (v !== this.hurtShown[i]) { this.hurtShown[i] = v; this.hurtEls[i].style.opacity = v; }
    }
  }

  clearHurt() {
    this.hurtT = 0;
    for (let i = 0; i < 4; i++) {
      if (this.hurtShown[i] !== 0) { this.hurtShown[i] = 0; this.hurtEls[i].style.opacity = 0; }
    }
  }

  // ------------------------------------------------------------------ flechas
  /** Inserta un candidato manteniendo la lista ordenada por `score` (menor = más prioritario). */
  addCand(score) {
    const c = this.cands;
    let n = this.nc;
    if (n < MAX_ARROWS) n = this.nc = n + 1;
    else if (score >= c[MAX_ARROWS - 1].score) return null;
    let i = n - 1;
    const item = c[i];
    item.score = score;
    while (i > 0 && c[i - 1].score > score) { c[i] = c[i - 1]; i--; }
    c[i] = item;
    return item;
  }

  /** ¿Está el punto NDC fuera del cuadro (con margen)? */
  isOffscreen(v) {
    const lim = T.offscreenNdc;
    return v.z > 1 || v.x > lim || v.x < -lim || v.y > lim || v.y < -lim;
  }

  gather() {
    const g = this.game;
    const cam = g.cameraRig.camera;
    const pp = g.player.position;
    const px = pp.x, pz = pp.z;
    const S = T.sectors;
    // Las cámaras del despacho alargan el alcance de los avisos (nivel II: especiales en todo el mapa).
    const d = g.despacho;
    const rs = T.specialRange * (d?.threatMul?.(true) ?? 1), rn = T.normalRange * (d?.threatMul?.(false) ?? 1);
    const rs2 = rs * rs, rn2 = rn * rn;
    const v = this._v;
    this.nc = 0;
    this.secCount.fill(0); this.secX.fill(0); this.secZ.fill(0); this.secNear.fill(1e9);

    for (const z of g.zombies.active) {
      if (z.state !== Z_STATE.CHASE) continue;
      const dx = z.pos.x - px, dz = z.pos.z - pz;
      const d2 = dx * dx + dz * dz;
      const boss = z.data.boss === true;
      const icon = boss ? T.bossIcon : T.specials[z.type];
      if (!boss && d2 > (icon ? rs2 : rn2)) continue;
      v.set(z.pos.x, T.aimHeight, z.pos.z).project(cam);
      if (!this.isOffscreen(v)) continue;
      const dist = Math.sqrt(d2);
      if (icon) {
        const c = this.addCand(boss ? dist - 10000 : dist);
        if (c) { c.kind = boss ? 2 : 1; c.icon = icon; c.dist = dist; c.nx = v.x; c.ny = v.y; c.behind = v.z > 1; }
      } else {
        let s = Math.floor(((Math.atan2(dz, dx) + Math.PI) / TAU) * S);
        if (s >= S) s = S - 1;
        this.secCount[s]++; this.secX[s] += z.pos.x; this.secZ[s] += z.pos.z;
        if (dist < this.secNear[s]) this.secNear[s] = dist;
      }
    }

    // Grupos de zombis normales: los sectores más poblados, hasta maxGeneric y hasta llenar el cupo.
    for (let n = 0; n < T.maxGeneric && this.nc < MAX_ARROWS; n++) {
      let best = -1, bestCount = T.groupMin - 1;
      for (let s = 0; s < S; s++) if (this.secCount[s] > bestCount) { bestCount = this.secCount[s]; best = s; }
      if (best < 0) break;
      const cnt = this.secCount[best];
      this.secCount[best] = 0; // ya usado
      v.set(this.secX[best] / cnt, T.aimHeight, this.secZ[best] / cnt).project(cam);
      if (!this.isOffscreen(v)) continue;
      const c = this.addCand(1000 + this.secNear[best]);
      if (c) { c.kind = 0; c.icon = ''; c.dist = this.secNear[best]; c.nx = v.x; c.ny = v.y; c.behind = v.z > 1; }
    }
  }

  layout() {
    const w = this.game.canvas.clientWidth || window.innerWidth;
    const h = this.game.canvas.clientHeight || window.innerHeight;
    if (w !== this._mw || h !== this._mh || (this._measureT += 1) > 60) this.measure(w, h);
    this._touch = this.game.uiRoot.classList.contains('touch');
    const mode = this._touch ? T.layout.touch : T.layout.desktop;
    const extra = this._hudEl?.classList.contains('boss-on') ? mode.bossBarExtra : 0;
    return computeLayout(w, h, mode, this._safe, extra, this._layout);
  }

  refreshArrows() {
    this.gather();
    const L = this.layout();
    const pos = this._pos;
    const minD2 = T.dedupePx * T.dedupePx;
    let shown = 0;
    for (let i = 0; i < this.nc && shown < MAX_ARROWS; i++) {
      const c = this.cands[i];
      edgePosition(c.nx, c.ny, c.behind, L, pos);
      // Si dos del mismo tipo caen casi en el mismo sitio, solo se dibuja la más cercana.
      let dup = false;
      for (let j = 0; j < shown; j++) {
        if (c.kind !== 0 && this.pIcon[j] !== c.icon) continue; // las genéricas ceden ante cualquier flecha cercana
        const ddx = this.px[j] - pos.x, ddy = this.py[j] - pos.y;
        if (ddx * ddx + ddy * ddy < minD2) { dup = true; break; }
      }
      if (dup) continue;
      this.px[shown] = pos.x; this.py[shown] = pos.y; this.pIcon[shown] = c.icon;
      this.paint(this.slots[shown], c, pos);
      shown++;
    }
    for (let i = shown; i < this.shown; i++) this.hideSlot(this.slots[i]);
    this.shown = shown;
  }

  paint(s, c, pos) {
    if (!s.shown) { s.shown = true; s.el.style.display = ''; }
    if (s.kind !== c.kind) {
      s.kind = c.kind;
      s.el.className = c.kind === 2 ? 'threat boss' : c.kind === 1 ? 'threat special' : 'threat generic';
    }
    if (s.iconTxt !== c.icon) { s.iconTxt = c.icon; s.icon.textContent = c.icon; }
    const d = Math.round(c.dist);
    if (s.distTxt !== d) { s.distTxt = d; s.dist.textContent = `${d} m`; }
    const x = Math.round(pos.x), y = Math.round(pos.y);
    if (x !== s.x || y !== s.y) { s.x = x; s.y = y; s.el.style.transform = `translate3d(${x}px,${y}px,0)`; }
    const deg = Math.round((pos.angle * 180) / Math.PI);
    if (deg !== s.deg) { s.deg = deg; s.arrow.style.transform = `rotate(${deg}deg)`; }
  }

  hideSlot(s) {
    if (!s.shown) return;
    s.shown = false;
    s.el.style.display = 'none';
    s.x = s.y = s.deg = -9999; // la próxima vez aparece sin deslizarse desde otro sitio
  }

  clearArrows() {
    for (const s of this.slots) this.hideSlot(s);
    this.shown = 0;
    this.nc = 0;
  }

  // ------------------------------------------------------------------ ciclo de vida
  update(dt) {
    const on = this.active();
    this.setVisible(on);
    if (!on) { if (this.hurtT > 0) this.clearHurt(); this._acc = this._interval; return; }
    this.updateHurt(dt);
    this._acc += dt;
    if (this._acc < this._interval) return;
    this._acc = 0;
    this.refreshArrows();
  }

  reset() {
    this.clearArrows();
    this.clearHurt();
    this._acc = this._interval;
    this._visible = true;
    this.root.style.display = '';
  }

  dispose() {
    this._offHurt?.();
    this.root.remove();
  }
}
