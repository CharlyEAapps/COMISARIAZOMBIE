// Capa de acciones abstractas. Teclado/ratón hoy; gamepad y táctil escribirán
// en los mismos campos (fase 8) sin que la lógica del juego cambie.

export const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  KeyR: 'reload',
  KeyE: 'interact',
  KeyQ: 'medkit',
  KeyG: 'grenade',
  KeyB: 'build',
  KeyN: 'ready',
  Tab: 'buildPage',
  Escape: 'pause',
  F1: 'debug',
  Enter: 'confirm', NumpadEnter: 'confirm',
  Digit1: 'weapon1', Digit2: 'weapon2', Digit3: 'weapon3', Digit4: 'weapon4', Digit5: 'weapon5',
  Digit6: 'weapon6', Digit7: 'weapon7', Digit8: 'weapon8', Digit9: 'weapon9',
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.held = new Set();      // acciones mantenidas
    this.pressed = new Set();   // flancos de subida pendientes de consumir por un paso lógico
    this.pointer = { x: 0, y: 0, ndcX: 0, ndcY: 0, inside: false };
    this.wheel = 0;
    this.move = { x: 0, y: 0 };
    this.stick = { x: 0, y: 0 };            // movimiento analógico (táctil o mando)
    this.aim = { active: false, x: 0, y: 1 }; // dirección de apuntado analógica (pantalla: x derecha, y abajo)
    this.captureTab = true; // Tab cambia de página de construcción (en los menús, no)
    this.lastDevice = 'kbm';

    this._onKeyDown = (e) => {
      // Escribiendo en un campo de texto (iniciales), las teclas no son del juego.
      const el = document.activeElement;
      if (el && el.tagName === 'INPUT' && el.type === 'text') return;
      const a = KEYMAP[e.code];
      if (!a) return;
      // Tab solo se captura en juego; en los menús sirve para recorrer los botones.
      if (a === 'buildPage' && !this.captureTab) return;
      // Con un desplegable o deslizador enfocado, Esc es suyo (no cierra el menú).
      if (a === 'pause' && /^(SELECT|INPUT)$/.test(document.activeElement?.tagName ?? '')) { document.activeElement.blur(); return; }
      if (a === 'debug' || a === 'pause' || a === 'buildPage') e.preventDefault();
      if (!this.held.has(a)) this.pressed.add(a);
      this.held.add(a);
      this.lastDevice = 'kbm';
    };
    this._onKeyUp = (e) => {
      const a = KEYMAP[e.code];
      if (a) this.held.delete(a);
    };
    // Los navegadores móviles generan ratón "de compatibilidad" tras los toques: se ignora.
    const fromTouch = () => performance.now() - this.lastTouchAt < 800;
    this.lastTouchAt = -1e9;
    this._onMouseDown = (e) => {
      if (fromTouch()) return;
      const a = e.button === 0 ? 'fire' : e.button === 2 ? 'alt' : null;
      if (!a) return;
      if (!this.held.has(a)) this.pressed.add(a);
      this.held.add(a);
      this.lastDevice = 'kbm';
    };
    this._onMouseUp = (e) => {
      if (e.button === 0) this.held.delete('fire');
      if (e.button === 2) this.held.delete('alt');
    };
    this._onMouseMove = (e) => {
      if (fromTouch()) return;
      const r = canvas.getBoundingClientRect();
      this.pointer.x = e.clientX - r.left;
      this.pointer.y = e.clientY - r.top;
      this.pointer.ndcX = (this.pointer.x / r.width) * 2 - 1;
      this.pointer.ndcY = -(this.pointer.y / r.height) * 2 + 1;
      this.pointer.inside = true;
    };
    this._onWheel = (e) => {
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    };
    this._onLeave = () => { this.pointer.inside = false; };
    this._onBlur = () => { this.held.clear(); this.pointer.inside = false; };
    this._onContext = (e) => e.preventDefault();

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    canvas.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('wheel', this._onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this._onContext);
    canvas.addEventListener('mouseleave', this._onLeave);
  }

  /** Recalcula los ejes; se llama una vez por frame antes de los pasos lógicos. */
  sample() {
    // Joystick (táctil o mando) si se está usando; si no, teclado.
    if (this.stick.x || this.stick.y) {
      this.move.x = this.stick.x;
      this.move.y = this.stick.y;
      return;
    }
    let x = 0, y = 0;
    if (this.held.has('left')) x -= 1;
    if (this.held.has('right')) x += 1;
    if (this.held.has('up')) y -= 1;
    if (this.held.has('down')) y += 1;
    const len = Math.hypot(x, y);
    this.move.x = len ? x / len : 0;
    this.move.y = len ? y / len : 0;
  }

  isHeld(action) { return this.held.has(action); }

  /** Pulsación desde un control en pantalla o mando (flanco + mantenida hasta release). */
  press(action) {
    this.pressed.add(action);
    this.held.add(action);
  }

  /** Mantener: solo genera flanco si no estaba ya mantenida. */
  hold(action) {
    if (!this.held.has(action)) this.pressed.add(action);
    this.held.add(action);
  }

  release(action) {
    this.held.delete(action);
  }

  /** ¿Se está jugando con controles analógicos (táctil o mando)? */
  get analog() { return this.lastDevice === 'touch' || this.lastDevice === 'pad'; }

  /** Devuelve true una sola vez por pulsación. */
  consume(action) {
    if (!this.pressed.has(action)) return false;
    this.pressed.delete(action);
    return true;
  }

  takeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  /** Al final de cada paso lógico se descartan los flancos no usados. */
  endStep() {
    this.pressed.clear();
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    this.canvas.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    this.canvas.removeEventListener('wheel', this._onWheel);
    this.canvas.removeEventListener('contextmenu', this._onContext);
    this.canvas.removeEventListener('mouseleave', this._onLeave);
  }
}
