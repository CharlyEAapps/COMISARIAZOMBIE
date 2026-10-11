// Subtítulo de la radio y llamadas entrantes de la familia (lo que decide `systems/Story.js`).
// Un panel compacto: abajo a la izquierda en escritorio y, en el móvil, bajo los botones de
// construir/noche, sin tapar la franja superior, los avisos ni los botones. Tocarlo pasa al
// siguiente mensaje.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class RadioPanel {
  constructor(game) {
    this.game = game;
    const el = this.el = document.createElement('div');
    el.className = 'radio-feed panel interactive';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.title = 'Toca para pasar';
    // Antes de los avisos en el DOM: si alguna vez coinciden, el aviso queda por encima.
    const hud = game.hud;
    if (hud?.root && hud.el?.toasts) hud.root.insertBefore(el, hud.el.toasts);
    else (hud?.root ?? game.uiRoot).appendChild(el);
    this._onDown = (e) => {
      e.stopPropagation();
      e.preventDefault();
      game.story?.skip();
    };
    this._stop = (e) => e.stopPropagation();
    el.addEventListener('pointerdown', this._onDown);
    el.addEventListener('mousedown', this._stop);
    el.addEventListener('touchstart', this._stop, { passive: true });
    const bus = game.bus;
    this._unsub = [
      bus.on('story:show', (it) => this.render(it)),
      bus.on('story:stage', (it) => this.render(it)),
      bus.on('story:hide', () => this.hide()),
    ];
  }

  dispose() {
    for (const off of this._unsub) off();
    this.el.removeEventListener('pointerdown', this._onDown);
    this.el.removeEventListener('mousedown', this._stop);
    this.el.removeEventListener('touchstart', this._stop);
    this.el.remove();
  }

  render(it) {
    const el = this.el;
    let html;
    if (it.kind === 'call') {
      if (it.stage === 0) {
        html = `<div class="rf-line">${it.icon} <b class="rf-who">${esc(it.name)}</b> <span class="rf-tag">${it.night ? 'llamando… ¿ahora?' : 'llamada entrante…'}</span></div>`;
      } else {
        html = `<div class="rf-line">${it.icon} <b class="rf-who">${esc(it.name)}:</b> «${esc(it.text)}»</div>`;
        if (it.stage >= 2) html += `<div class="rf-line rf-reply"><b class="rf-who">${esc(it.replyName)}:</b> ${esc(it.reply)}</div>`;
      }
    } else {
      html = `<div class="rf-line">${it.icon} <b class="rf-who">${esc(it.name)}:</b> ${esc(it.text)}</div>`;
    }
    el.innerHTML = `${html}<span class="rf-skip" aria-hidden="true">⏭</span>`;
    el.classList.toggle('call', it.kind === 'call');
    el.classList.toggle('ringing', it.kind === 'call' && it.stage === 0);
    if (!el.classList.contains('show')) {
      void el.offsetWidth; // reinicia la animación de entrada (aunque se acabe de ocultar)
      el.classList.add('show');
    }
  }

  hide() {
    this.el.classList.remove('show', 'ringing');
  }
}
