import config from '../data/config.json';
import { WEAPON_IDS } from '../systems/WeaponSystem.js';

const P = config.gamepad;

/** Eje con zona muerta re-escalada (0 dentro de la zona; 0..1 fuera). */
export function deadzone(v, dz) {
  const a = Math.abs(v);
  return a < dz ? 0 : Math.sign(v) * (a - dz) / (1 - dz);
}

// Mando (Gamepad API, mapeo estándar): se lee una vez por frame y escribe en las mismas
// acciones abstractas de Input que el teclado y los controles táctiles.
export class GamepadInput {
  constructor(game) {
    this.game = game;
    this.prev = new Uint8Array(17); // botones pulsados en el frame anterior
    this.active = false;
  }

  poll() {
    const pads = navigator.getGamepads?.();
    if (!pads) return;
    let pad = null;
    for (const p of pads) if (p && p.connected && p.mapping === 'standard') { pad = p; break; }
    if (!pad) return;
    const input = this.game.input;
    const b = (i) => !!pad.buttons[i]?.pressed;
    const lx = deadzone(pad.axes[0] ?? 0, P.deadZone), ly = deadzone(pad.axes[1] ?? 0, P.deadZone);
    const rx = deadzone(pad.axes[2] ?? 0, P.deadZone), ry = deadzone(pad.axes[3] ?? 0, P.deadZone);
    const anyButton = pad.buttons.some((x) => x.pressed);
    // Solo toma el control si se toca el mando; si después se usa el teclado o el táctil,
    // suelta lo que tuviera pulsado.
    if (anyButton || lx || ly || rx || ry) input.lastDevice = 'pad';
    if (input.lastDevice !== 'pad') {
      if (this.active) this.releaseAll();
      return;
    }
    this.active = true;

    const len = Math.min(1, Math.hypot(lx, ly));
    const lk = len ? len / Math.hypot(lx, ly) : 0;
    input.stick.x = lx * lk;
    input.stick.y = ly * lk;
    const rmag = Math.min(1, Math.hypot(rx, ry));
    input.aim.active = rmag > 0;
    if (rmag > 0) { input.aim.x = rx / Math.hypot(rx, ry); input.aim.y = ry / Math.hypot(rx, ry); }

    // Botones mantenidos.
    const fire = b(7) || (P.stickFires && rmag >= P.fireAt);
    if (fire) input.hold('fire'); else input.release('fire');
    if (b(6)) input.hold('sprint'); else input.release('sprint');
    if (b(0)) input.hold('interact'); else input.release('interact');

    // Flancos: acción al pulsar.
    const edge = (i, fn) => { const now = b(i); if (now && !this.prev[i]) fn(); this.prev[i] = now ? 1 : 0; };
    const playing = this.game.state === 'playing';
    edge(2, () => input.press('reload'));
    edge(3, () => this.nextWeapon());
    edge(5, () => input.press('grenade'));
    edge(4, () => input.press('medkit'));
    edge(1, () => input.press(playing ? 'build' : 'pause'));
    edge(9, () => input.press('pause'));
    edge(8, () => input.press('ready'));
    edge(12, () => input.press('buildPage'));
    edge(13, () => input.press('buildPage'));
    edge(14, () => input.press('alt'));
    // En los menús, A confirma (jugar / reintentar).
    if (!playing && b(0) && !this.prev[16]) input.press('confirm');
    this.prev[16] = b(0) ? 1 : 0;
  }

  releaseAll() {
    const input = this.game.input;
    this.active = false;
    input.stick.x = input.stick.y = 0;
    input.aim.active = false;
    for (const a of ['fire', 'sprint', 'interact']) input.release(a);
  }

  nextWeapon() {
    const W = this.game.weapons;
    if (this.game.build.active) return;
    const owned = WEAPON_IDS.filter((id) => W.has(id));
    const next = owned[(owned.indexOf(W.current) + 1) % owned.length];
    if (next && next !== W.current) this.game.input.press(`weapon${W.defs[next].slot}`);
  }
}
