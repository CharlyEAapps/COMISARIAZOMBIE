import config from '../data/config.json';
import { WEAPON_IDS } from '../systems/WeaponSystem.js';

const T = config.touch;

/** Vector de un joystick: desplazamiento normalizado al radio (longitud ≤ 1) con zona muerta. */
export function stickVector(dx, dy, radius, dead) {
  const len = Math.hypot(dx, dy);
  const mag = Math.min(1, len / radius);
  if (len < 1e-6 || mag < dead) return { x: 0, y: 0, mag: 0 };
  return { x: (dx / len) * mag, y: (dy / len) * mag, mag };
}

// Controles táctiles (estilo "twin-stick" en horizontal): joystick de movimiento en la mitad
// izquierda (aparece donde pones el pulgar; al borde, esprinta), joystick de apuntado en la
// derecha (apunta y dispara mientras se mueve, con ayuda de apuntado) y botones de acción.
// En modo construcción, tocar el suelo construye (arrastrar hace filas). Todo se traduce a
// las mismas acciones abstractas de Input que el teclado y el ratón.
export class TouchControls {
  constructor(game) {
    this.game = game;
    const input = this.input = game.input;
    this.enabled = false;
    this.sticks = new Map(); // pointerId → { side, ox, oy, x, y }
    this.buildTouch = -1;    // pointerId que construye en modo construcción

    const root = this.root = document.createElement('div');
    root.className = 'touch-layer';
    root.innerHTML = `
      <div class="stick stick-left"><div class="stick-knob"></div></div>
      <div class="stick stick-right"><div class="stick-knob"></div></div>
      <div class="touch-buttons">
        <button class="tbtn tb-pause" data-a="pause" aria-label="Pausa">⏸</button>
        <button class="tbtn tb-weapon" data-act="weapon" aria-label="Cambiar arma">🔁</button>
        <button class="tbtn tb-reload" data-a="reload" aria-label="Recargar">R</button>
        <button class="tbtn tb-grenade" data-a="grenade" aria-label="Granada">💣</button>
        <button class="tbtn tb-medkit" data-a="medkit" aria-label="Botiquín">🩹</button>
        <button class="tbtn tb-use big" data-a="interact" data-hold="1" aria-label="Usar">✋</button>
        <button class="tbtn tb-build" data-a="build" aria-label="Construir">🔨</button>
        <button class="tbtn tb-night" data-a="ready" aria-label="Empezar la noche">🌙</button>
        <button class="tbtn tb-sell" data-a="alt" aria-label="Vender">💲</button>
      </div>
      <div class="rotate-hint panel"><div>📱↻</div><p>Gira el móvil: el turno se juega en horizontal.</p></div>`;
    game.uiRoot.prepend(root);
    this.knobL = root.querySelector('.stick-left');
    this.knobR = root.querySelector('.stick-right');

    // Botones: pulsar = flanco de la acción; los de mantener (usar) siguen pulsados.
    for (const b of root.querySelectorAll('.tbtn')) {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.enable();
        if (b.dataset.act === 'weapon') this.nextWeapon();
        else input.press(b.dataset.a);
        b.classList.add('down');
        b.setPointerCapture?.(e.pointerId);
      });
      const up = (e) => {
        b.classList.remove('down');
        if (b.dataset.hold) input.release(b.dataset.a);
        e.stopPropagation();
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
    }

    this._down = (e) => this.onDown(e);
    this._move = (e) => this.onMove(e);
    this._up = (e) => this.onUp(e);
    root.addEventListener('pointerdown', this._down);
    window.addEventListener('pointermove', this._move, { passive: false });
    window.addEventListener('pointerup', this._up);
    window.addEventListener('pointercancel', this._up);
    // Sin zoom por gestos ni menú contextual al mantener pulsado (iOS).
    this._noGesture = (e) => e.preventDefault();
    document.addEventListener('gesturestart', this._noGesture);
    root.addEventListener('contextmenu', this._noGesture);

    // Móvil o tableta: táctil desde el principio.
    if (window.matchMedia?.('(pointer: coarse)').matches) this.enable();
  }

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.input.lastDevice = 'touch';
    this.game.uiRoot.classList.add('touch');
    // Pantalla pequeña: cámara algo más cerca (la rueda no existe en el móvil).
    const rig = this.game.cameraRig;
    rig.distance = Math.min(rig.distance, T.cameraDistance);
    rig.updateOffset();
  }

  /** Siguiente arma del inventario (por orden de ranura). */
  nextWeapon() {
    const W = this.game.weapons;
    const owned = WEAPON_IDS.filter((id) => W.has(id));
    const next = owned[(owned.indexOf(W.current) + 1) % owned.length];
    if (next && next !== W.current) this.input.press(`weapon${W.defs[next].slot}`);
  }

  // ------------------------------------------------------------------ joysticks y toques
  onDown(e) {
    if (e.pointerType === 'mouse') return;
    e.preventDefault();
    this.input.lastTouchAt = performance.now();
    this.enable();
    const w = window.innerWidth;
    const side = e.clientX < w * T.leftZone ? 'left' : 'right';
    // En modo construcción, la mano derecha toca el suelo para construir.
    if (side === 'right' && this.game.build.active) {
      this.buildTouch = e.pointerId;
      this.setPointer(e.clientX, e.clientY);
      this.input.press('fire');
      return;
    }
    if ([...this.sticks.values()].some((s) => s.side === side)) return;
    this.sticks.set(e.pointerId, { side, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY });
    this.root.setPointerCapture?.(e.pointerId);
    this.updateStick(side);
  }

  onMove(e) {
    if (e.pointerType === 'touch') this.input.lastTouchAt = performance.now();
    if (e.pointerId === this.buildTouch) {
      this.setPointer(e.clientX, e.clientY);
      e.preventDefault();
      return;
    }
    const s = this.sticks.get(e.pointerId);
    if (!s) return;
    e.preventDefault();
    s.x = e.clientX;
    s.y = e.clientY;
    // El joystick se arrastra con el dedo si este se pasa del radio (no hay que volver al centro).
    const dx = s.x - s.ox, dy = s.y - s.oy, len = Math.hypot(dx, dy), R = T.stickRadius * T.followFactor;
    if (len > R) { s.ox = s.x - (dx / len) * R; s.oy = s.y - (dy / len) * R; }
    this.updateStick(s.side);
  }

  onUp(e) {
    if (e.pointerId === this.buildTouch) {
      this.buildTouch = -1;
      this.input.release('fire');
      return;
    }
    const s = this.sticks.get(e.pointerId);
    if (!s) return;
    this.sticks.delete(e.pointerId);
    this.updateStick(s.side, true);
  }

  /** Toque → puntero del juego (para el suelo bajo el dedo en modo construcción). */
  setPointer(cx, cy) {
    const r = this.game.canvas.getBoundingClientRect();
    const p = this.input.pointer;
    p.x = cx - r.left;
    p.y = cy - r.top;
    p.ndcX = (p.x / r.width) * 2 - 1;
    p.ndcY = -(p.y / r.height) * 2 + 1;
    p.inside = true;
  }

  updateStick(side, released = false) {
    const s = [...this.sticks.values()].find((o) => o.side === side);
    const el = side === 'left' ? this.knobL : this.knobR;
    const input = this.input;
    if (!s || released) {
      el.classList.remove('on');
      el.style.left = el.style.top = '';
      el.firstElementChild.style.transform = '';
      if (side === 'left') { input.stick.x = input.stick.y = 0; input.release('sprint'); } else {
        input.aim.active = false;
        input.release('fire');
      }
      return;
    }
    const v = stickVector(s.x - s.ox, s.y - s.oy, T.stickRadius, T.deadZone);
    el.classList.add('on');
    el.style.left = `${s.ox}px`;
    el.style.top = `${s.oy}px`;
    el.firstElementChild.style.transform = `translate(${v.x * T.stickRadius}px, ${v.y * T.stickRadius}px)`;
    if (side === 'left') {
      input.stick.x = v.x;
      input.stick.y = v.y;
      if (v.mag >= T.sprintAt) input.hold('sprint'); else input.release('sprint');
    } else if (v.mag > 0) {
      input.aim.active = true;
      input.aim.x = v.x / v.mag;
      input.aim.y = v.y / v.mag;
      if (v.mag >= T.fireAt) input.hold('fire'); else input.release('fire');
    } else {
      input.release('fire');
    }
  }

  /** Estado visible de los botones según el contexto (cada frame, sin tocar el DOM si no cambia). */
  update() {
    if (!this.enabled) return;
    const g = this.game;
    const key = `${g.build.active ? 'b' : ''}${g.dayNight.phase === 'dia' ? 'd' : ''}${g.weapons.grenades > 0 ? 'g' : ''}${g.player.medkits > 0 ? 'm' : ''}${g.shop.open ? 's' : ''}`;
    if (key === this._key) return;
    this._key = key;
    this.root.classList.toggle('building', g.build.active);
    this.root.classList.toggle('day', g.dayNight.phase === 'dia');
    this.root.classList.toggle('no-grenade', g.weapons.grenades <= 0);
    this.root.classList.toggle('no-medkit', g.player.medkits <= 0);
    this.root.classList.toggle('shop-open', g.shop.open);
  }

  /** Suelta todo (al pausar o abrir un menú). */
  reset() {
    this.sticks.clear();
    this.buildTouch = -1;
    for (const side of ['left', 'right']) this.updateStick(side, true);
    this.input.release('interact');
  }

  dispose() {
    window.removeEventListener('pointermove', this._move);
    window.removeEventListener('pointerup', this._up);
    window.removeEventListener('pointercancel', this._up);
    document.removeEventListener('gesturestart', this._noGesture);
    this.root.remove();
  }
}
