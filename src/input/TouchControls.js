import config from '../data/config.json';
import { WEAPON_IDS } from '../systems/WeaponSystem.js';
import { PHASE } from '../systems/DayNight.js';

const T = config.touch;

/** Vector de un joystick: desplazamiento normalizado al radio (longitud ≤ 1) con zona muerta. */
export function stickVector(dx, dy, radius, dead) {
  const len = Math.hypot(dx, dy);
  const mag = Math.min(1, len / radius);
  if (len < 1e-6 || mag < dead) return { x: 0, y: 0, mag: 0 };
  return { x: (dx / len) * mag, y: (dy / len) * mag, mag };
}

const PHASE_SHORT = { [PHASE.DAY]: 'Día', [PHASE.DUSK]: 'Atardecer', [PHASE.NIGHT]: 'Noche', [PHASE.DAWN]: 'Amanecer' };

// Controles táctiles en horizontal, pensados para el móvil:
//  - Joystick de movimiento en la mitad izquierda (aparece donde apoyas el pulgar; al borde, esprinta).
//  - Joystick de disparo FIJO en la esquina inferior derecha (el pulgar no tapa la zona de juego):
//    apunta y dispara mientras se mueve, con ayuda de apuntado. Si tocas lejos de él, aparece donde
//    pongas el dedo.
//  - Botones en arco alrededor del joystick de disparo (recargar, granada, botiquín, usar), arma y
//    pausa arriba a la derecha, construir y empezar la noche arriba a la izquierda.
//  - HUD propio y compacto (franja superior); el HUD de escritorio se oculta en modo táctil.
// Todo se traduce a las mismas acciones abstractas de Input que el teclado y el ratón.
export class TouchControls {
  constructor(game) {
    this.game = game;
    const input = this.input = game.input;
    this.enabled = false;
    this.sticks = new Map(); // pointerId → { side, ox, oy, x, y, fixed }
    this.buildTouch = -1;    // pointerId que construye en modo construcción
    this._last = {};

    const root = this.root = document.createElement('div');
    root.className = 'touch-layer';
    root.innerHTML = `
      <div class="m-top">
        <div class="m-status">
          <div class="m-clock"><b data-m="time">07:00</b><span data-m="phase"></span><span class="m-power" data-m="power">⚡ Sin luz</span></div>
          <div class="m-bar"><div class="fill hp" data-m="hp"></div><span class="m-num" data-m="hpText">100</span></div>
          <div class="m-bar thin armor" data-m="armorWrap"><div class="fill armor" data-m="armor"></div></div>
          <div class="m-bar thin"><div class="fill stamina" data-m="st"></div></div>
        </div>
        <div class="m-center">
          <span class="m-points">★ <b data-m="points">0</b></span>
          <span class="m-rem" data-m="remWrap">🧟 <b data-m="rem">0</b></span>
        </div>
        <button class="m-weapon" data-act="weapon" aria-label="Cambiar de arma">
          <span class="m-wicon" data-m="wicon"></span>
          <span class="m-ammo"><b data-m="mag">12</b><small data-m="res">/∞</small></span>
          <span class="m-heat"><i data-m="heat"></i></span>
          <span class="m-swap">⇄</span>
          <div class="m-reload"><div class="fill reload" data-m="reload"></div></div>
        </button>
      </div>
      <div class="stick stick-left"><div class="stick-knob"></div></div>
      <div class="stick stick-right fixed"><div class="stick-knob"></div></div>
      <div class="touch-buttons">
        <button class="tbtn tb-pause" data-a="pause" aria-label="Pausa">⏸</button>
        <button class="tbtn tb-build" data-a="build" aria-label="Construir">🔨</button>
        <button class="tbtn tb-night" data-a="ready" aria-label="Empezar la noche">🌙</button>
        <button class="tbtn tb-reload" data-a="reload" aria-label="Recargar">⟳</button>
        <button class="tbtn tb-grenade" data-a="grenade" aria-label="Granada">💣<i data-m="grenades">1</i></button>
        <button class="tbtn tb-medkit" data-a="medkit" aria-label="Botiquín">🩹<i data-m="medkits">1</i></button>
        <button class="tbtn tb-use" data-a="interact" data-hold="1" aria-label="Usar">✋</button>
        <button class="tbtn tb-sell" data-a="alt" aria-label="Vender">💲</button>
      </div>
      <div class="rotate-hint panel"><div>📱↻</div><p>Gira el móvil: el turno se juega en horizontal.</p></div>`;
    game.uiRoot.prepend(root);
    this.knobL = root.querySelector('.stick-left');
    this.knobR = root.querySelector('.stick-right');
    this.m = {};
    root.querySelectorAll('[data-m]').forEach((e) => { this.m[e.dataset.m] = e; });

    // Botones: pulsar = flanco de la acción; los de mantener (usar) siguen pulsados.
    for (const b of root.querySelectorAll('.tbtn, .m-weapon')) {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.enable();
        input.lastTouchAt = performance.now();
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
    if (this.game.build.active) return;
    const owned = WEAPON_IDS.filter((id) => W.has(id));
    const next = owned[(owned.indexOf(W.current) + 1) % owned.length];
    if (next && next !== W.current) this.input.press(`weapon${W.defs[next].slot}`);
  }

  /** Centro del joystick de disparo fijo (esquina inferior derecha), en píxeles de la ventana. */
  fireCenter() {
    const b = this.knobR.getBoundingClientRect();
    if (b.width) return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    return { x: window.innerWidth - T.fireStickInset, y: window.innerHeight - T.fireStickInset };
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
    let ox = e.clientX, oy = e.clientY, fixed = false;
    if (side === 'right') {
      // Cerca del joystick fijo: se usa su centro (el pulgar se queda en la esquina).
      const c = this.fireCenter();
      if (Math.hypot(e.clientX - c.x, e.clientY - c.y) <= T.stickRadius * T.fireGrab) { ox = c.x; oy = c.y; fixed = true; }
    }
    this.sticks.set(e.pointerId, { side, ox, oy, x: e.clientX, y: e.clientY, fixed });
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
    // El de movimiento se arrastra con el dedo si este se pasa del radio; el fijo no se mueve.
    if (!s.fixed) {
      const dx = s.x - s.ox, dy = s.y - s.oy, len = Math.hypot(dx, dy), R = T.stickRadius * T.followFactor;
      if (len > R) { s.ox = s.x - (dx / len) * R; s.oy = s.y - (dy / len) * R; }
    }
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
      if (side === 'right') el.classList.add('fixed'); // vuelve a la esquina
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
    if (side === 'right') el.classList.toggle('fixed', s.fixed);
    if (!s.fixed) {
      el.style.left = `${s.ox}px`;
      el.style.top = `${s.oy}px`;
    }
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

  // ------------------------------------------------------------------ HUD móvil
  set(key, value, prop = 'textContent') {
    const id = key + prop;
    if (this._last[id] === value) return;
    this._last[id] = value;
    const el = this.m[key];
    if (prop === 'width') el.style.width = value;
    else if (prop === 'show') el.classList.toggle('show', value);
    else el[prop] = value;
  }

  toggle(cls, on) {
    if (this._last[cls] === on) return;
    this._last[cls] = on;
    this.root.classList.toggle(cls, on);
  }

  /** Estado de los botones y HUD móvil (cada frame, sin tocar el DOM si no cambia). */
  update() {
    if (!this.enabled) return;
    const g = this.game;
    const { player, weapons, run, dayNight, waves, interactions } = g;
    this.toggle('building', g.build.active);
    this.toggle('day', dayNight.phase === PHASE.DAY);
    this.toggle('no-grenade', weapons.grenades <= 0);
    this.toggle('no-medkit', player.medkits <= 0);
    this.toggle('shop-open', !!g.shop.open);
    // El botón de usar se ilumina cuando hay algo al alcance.
    const it = interactions.current;
    this.toggle('can-use', !!it && interactions.availability(it).ok);

    this.set('time', dayNight.formatClock());
    this.set('phase', `${PHASE_SHORT[dayNight.phase]} ${dayNight.night}`);
    const tr = g.build.transformer;
    this.set('power', !!tr && tr.hp <= 0, 'show');
    this.set('hpText', String(Math.ceil(player.hp)));
    this.set('hp', `${(player.hp / player.maxHp) * 100}%`, 'width');
    this.set('armorWrap', player.armor > 0, 'show');
    this.set('armor', `${player.armorMax ? (player.armor / player.armorMax) * 100 : 0}%`, 'width');
    this.set('st', `${(player.stamina / player.data.maxStamina) * 100}%`, 'width');
    this.set('points', String(run.points));
    const night = dayNight.phase === PHASE.NIGHT;
    this.set('remWrap', night, 'show');
    this.set('rem', String(waves.remaining));
    const w = weapons.weapon;
    this.set('wicon', w.data.icon);
    // Rifle láser: la barra de calor sustituye a la munición.
    const heat = !!w.data.heat;
    this.toggle('heat-weapon', heat);
    this.toggle('heat-locked', heat && w.locked);
    this.toggle('heat-hot', heat && !w.locked && w.heat >= w.data.heat.warnAt);
    if (heat) this.set('heat', `${(w.heat * 100).toFixed(0)}%`, 'width');
    else if (w.data.melee) { this.set('mag', '—'); this.set('res', ''); } else {
      this.set('mag', w.reloading > 0 ? '··' : String(w.mag));
      this.set('res', w.reserve < 0 ? '/∞' : `/${w.reserve}`);
    }
    const rl = w.reloading > 0 ? 1 - w.reloading / (w.reloadTotal || w.stats.reloadTime) : 0;
    this.set('reload', `${(rl * 100).toFixed(0)}%`, 'width');
    this.set('grenades', String(weapons.grenades));
    this.set('medkits', String(player.medkits));
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
