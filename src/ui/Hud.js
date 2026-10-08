// HUD en DOM superpuesto al canvas. Estilo: paneles oscuros translúcidos, cifras
// monoespaciadas grandes, etiquetas pequeñas en versalitas y barras de color.
export class Hud {
  constructor(game) {
    this.game = game;
    const root = document.createElement('div');
    root.className = 'hud';
    root.innerHTML = `
      <div class="panel panel-status">
        <div class="clock"><span class="clock-big" data-k="time">00:00</span><span class="clock-sub" data-k="phase">Turno de noche<br>Comisaría del Distrito 13</span></div>
        <div class="stat"><div class="stat-row"><span class="label">♥ Vida</span><span class="val" data-k="hpText">100</span></div><div class="bar"><div class="fill hp" data-k="hp"></div></div></div>
        <div class="stat"><div class="stat-row"><span class="label">⚡ Resistencia</span><span class="val" data-k="stText">100</span></div><div class="bar"><div class="fill stamina" data-k="st"></div></div></div>
        <div class="stat-row score"><span class="label">★ Puntos</span><span class="val big" data-k="points">0</span></div>
        <div class="stat-row"><span class="label">☠ Bajas</span><span class="val" data-k="kills">0</span></div>
      </div>
      <div class="panel panel-weapon">
        <span class="label" data-k="wname">Pistola</span>
        <div class="ammo"><span class="ammo-mag" data-k="mag">12</span><span class="ammo-res" data-k="res">/ ∞</span></div>
        <div class="bar thin"><div class="fill reload" data-k="reload"></div></div>
      </div>
      <div class="hurt" data-k="hurt"></div>
      <div class="hint panel" data-k="hint">
        <span class="key">WASD</span> mover <span class="key">Ratón</span> apuntar y disparar <span class="key">R</span> recargar <span class="key">Shift</span> correr <span class="key">Esc</span> pausa
      </div>
      <div class="overlay" data-k="pause"><div class="panel modal"><h1>Pausa</h1><p>Pulsa <span class="key">Esc</span> para continuar</p></div></div>
      <div class="overlay" data-k="over">
        <div class="panel modal">
          <h1 class="danger">Has caído</h1>
          <div class="summary">
            <div><span class="label">Tiempo</span><span class="val big" data-k="oTime">0:00</span></div>
            <div><span class="label">Bajas</span><span class="val big" data-k="oKills">0</span></div>
            <div><span class="label">Puntos</span><span class="val big" data-k="oPoints">0</span></div>
          </div>
          <button class="btn interactive" data-k="retry">Reintentar <span class="key">Enter</span></button>
        </div>
      </div>`;
    game.uiRoot.appendChild(root);
    this.root = root;
    this.el = {};
    root.querySelectorAll('[data-k]').forEach((e) => { this.el[e.dataset.k] = e; });
    this.el.retry.addEventListener('click', () => game.restart());
    this._last = {};
    this.hintTimer = 12;
  }

  /** Solo toca el DOM cuando cambia un valor. */
  set(key, value, prop = 'textContent') {
    const id = key + prop;
    if (this._last[id] === value) return;
    this._last[id] = value;
    if (prop === 'width') this.el[key].style.width = value;
    else if (prop === 'opacity') this.el[key].style.opacity = value;
    else this.el[key][prop] = value;
  }

  update(dt) {
    const { player, weapons, run, state } = this.game;
    const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    this.set('time', fmt(run.time));
    this.set('hpText', String(Math.ceil(player.hp)));
    this.set('hp', `${(player.hp / player.maxHp) * 100}%`, 'width');
    this.set('stText', String(Math.round(player.stamina)));
    this.set('st', `${player.stamina / player.data.maxStamina * 100}%`, 'width');
    this.set('points', String(run.points));
    this.set('kills', String(run.kills));

    const w = weapons.weapon;
    this.set('wname', w.data.name);
    this.set('mag', w.reloading > 0 ? '··' : String(w.mag));
    this.set('res', w.reserve < 0 ? '/ ∞' : `/ ${w.reserve}`);
    const rl = w.reloading > 0 ? 1 - w.reloading / w.data.reloadTime : 0;
    this.set('reload', `${(rl * 100).toFixed(0)}%`, 'width');
    this.el.mag.classList.toggle('low', w.mag <= Math.ceil(w.data.magSize * 0.25));

    const hurt = Math.max(player.hurtTimer / player.data.hurtFlashTime, player.hp < 30 ? 0.35 : 0);
    this.set('hurt', hurt.toFixed(2), 'opacity');

    this.hintTimer -= dt;
    this.set('hint', this.hintTimer > 0 ? '1' : '0', 'opacity');

    this.el.pause.classList.toggle('show', state === 'paused');
    this.el.over.classList.toggle('show', state === 'gameover');
    if (state === 'gameover') {
      this.set('oTime', fmt(run.time));
      this.set('oKills', String(run.kills));
      this.set('oPoints', String(run.points));
    }
  }
}
