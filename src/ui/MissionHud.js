import * as THREE from 'three';
import { PHASE } from '../systems/DayNight.js';
import { edgePosition } from './ThreatIndicators.js';
import missionData from '../data/missions.json';

// HUD de las misiones y del caso de la pizarra (sustituye al panel "Caso de la noche"):
//  - Escritorio: panel a la izquierda con descripción, estado en vivo y recompensa.
//  - Móvil: fichas compactas bajo el botón de pausa (arriba a la derecha) que no tapan los
//    botones ni la franja superior.
//  - Flechas en el borde de la pantalla hacia lo que hay que buscar o llevar (caja, gato, coche...).
//  - Barras de vida sobre el concejal, el coche y el gato.
// Se cuelga del contenedor del HUD (se oculta con él en los menús) y solo toca el DOM al cambiar.

const MAX_POINTERS = 2;
const MAX_BARS = 3;

const el = (cls, parent, tag = 'div') => {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
};

export class MissionHud {
  constructor(game) {
    this.game = game;
    this.root = el('mission-hud', game.hud.root);
    this.panel = el('mission-panel panel', this.root);
    this.chips = el('mission-chips', this.root);
    this.pointers = Array.from({ length: MAX_POINTERS }, () => {
      const e = el('mpoint', this.root);
      const arrow = el('mpoint-arrow', e);
      const badge = el('mpoint-badge', e);
      const icon = el('mpoint-icon', badge, 'span');
      const dist = el('mpoint-dist', badge, 'span');
      e.style.display = 'none';
      return { e, arrow, icon, dist, iconTxt: '', distTxt: '' };
    });
    this.bars = Array.from({ length: MAX_BARS }, () => {
      const e = el('mbar', this.root);
      const fill = el('mbar-fill', e);
      e.style.display = 'none';
      return { e, fill };
    });
    this.timer = 0;
    this.sig = '';
    this._v = new THREE.Vector3();
    this._pos = { x: 0, y: 0, angle: 0 };
    this._layout = {};
  }

  reset() {
    this.sig = '';
    this.timer = 0;
    this.panel.classList.remove('show');
    this.chips.innerHTML = '';
    for (const p of this.pointers) p.e.style.display = 'none';
    for (const b of this.bars) b.e.style.display = 'none';
  }

  dispose() { this.root.remove(); }

  update(dt) {
    const g = this.game;
    const M = g.missions;
    if (!M) return;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = missionData.common.hudRefresh;
      this.refreshText();
    }
    const live = g.state === 'playing' && g.player.alive && !g.uiRoot.classList.contains('in-menu');
    this.updatePointers(live);
    this.updateBars(live);
  }

  refreshText() {
    const g = this.game;
    const lines = g.missions.hudLines();
    const night = g.dayNight.phase === PHASE.NIGHT;
    const sig = lines.map((l) => `${l.key}|${l.short}|${l.state}|${l.reward}|${night}`).join('§');
    if (sig === this.sig) return;
    this.sig = sig;
    this.panel.classList.toggle('show', lines.length > 0);
    this.panel.innerHTML = lines.map((l) => `
      <div class="mrow ${l.state}">
        <div class="mrow-head"><span>${l.icon} ${l.name}${l.forced ? ' <em>evento</em>' : ''}</span><b>${l.state === 'ok' ? '✔' : l.state === 'bad' ? '✖' : `+${l.reward}`}</b></div>
        ${night ? '' : `<div class="mrow-desc">${l.desc}</div>`}
        <div class="mrow-live">${l.short.replace(/^[^:]+:\s*/, '')}</div>
      </div>`).join('');
    this.chips.innerHTML = lines.map((l) => `<div class="mchip ${l.state}">${l.icon} ${l.short}${l.state ? '' : ` <b>+${l.reward}</b>`}</div>`).join('');
  }

  layout(w, h, touch) {
    const L = this._layout;
    L.w = w; L.h = h;
    if (touch) {
      L.left = 28; L.right = w - 210; L.top = 100; L.bottom = h - 130;
      L.leftMinY = 130; L.leftMaxY = h - 160; L.rightMinY = 104; L.rightMaxY = h - 150;
      L.bottomMinX = 170; L.bottomMaxX = w - 250; L.topMinX = 120; L.topMaxX = w - 170;
    } else {
      L.left = 300; L.right = w - 40; L.top = 28; L.bottom = h - 100;
      L.leftMinY = 28; L.leftMaxY = h - 100; L.rightMinY = 28; L.rightMaxY = h - 200;
      L.bottomMinX = L.left; L.bottomMaxX = w - 200; L.topMinX = L.left; L.topMaxX = L.right;
    }
    return L;
  }

  updatePointers(live) {
    const g = this.game;
    const targets = live ? g.missions.targets() : [];
    const cam = g.cameraRig.camera;
    const w = g.canvas.clientWidth || 1, h = g.canvas.clientHeight || 1;
    const touch = g.uiRoot.classList.contains('touch');
    const L = this.layout(w, h, touch);
    const px = g.player.position.x, pz = g.player.position.z;
    // Las dos más cercanas.
    let shown = 0;
    for (let n = 0; n < targets.length && shown < MAX_POINTERS; n++) {
      const t = targets[n];
      const v = this._v.set(t.x, 1, t.z).project(cam);
      const sx = (v.x * 0.5 + 0.5) * w, sy = (-v.y * 0.5 + 0.5) * h;
      const behind = v.z > 1;
      const inside = !behind && sx > L.left && sx < L.right && sy > L.top && sy < L.bottom;
      if (inside) continue;
      edgePosition(v.x, v.y, behind, L, this._pos);
      const p = this.pointers[shown++];
      p.e.style.display = '';
      p.e.style.transform = `translate(${this._pos.x.toFixed(0)}px, ${this._pos.y.toFixed(0)}px)`;
      p.arrow.style.transform = `rotate(${this._pos.angle.toFixed(2)}rad)`;
      if (p.iconTxt !== t.icon) { p.iconTxt = t.icon; p.icon.textContent = t.icon; }
      const dist = `${Math.round(Math.hypot(t.x - px, t.z - pz))} m`;
      if (p.distTxt !== dist) { p.distTxt = dist; p.dist.textContent = dist; }
    }
    for (let k = shown; k < MAX_POINTERS; k++) this.pointers[k].e.style.display = 'none';
  }

  updateBars(live) {
    const g = this.game;
    let n = 0;
    if (live) {
      for (const e of g.missions.entities) {
        if (n >= MAX_BARS) break;
        if (e.maxHp <= 1 || e.state === 'carried' || e.state === 'safe') continue;
        if (e.kind === 'box') continue;
        const pr = g.floating.project(e.x, (e.y ?? 0) + (e.kind === 'car' ? 2.1 : e.kind === 'cat' ? 0.9 : 2.5), e.z);
        const b = this.bars[n];
        if (!pr.visible) continue;
        n++;
        b.e.style.display = '';
        b.e.style.transform = `translate(${pr.sx.toFixed(0)}px, ${pr.sy.toFixed(0)}px) translate(-50%, -50%)`;
        const f = Math.max(0, e.hp / e.maxHp);
        b.fill.style.width = `${(f * 100).toFixed(0)}%`;
        b.fill.style.background = f > 0.5 ? '#7fd36b' : f > 0.25 ? '#e8b23a' : '#d9473b';
      }
    }
    for (let k = n; k < MAX_BARS; k++) this.bars[k].e.style.display = 'none';
  }
}
