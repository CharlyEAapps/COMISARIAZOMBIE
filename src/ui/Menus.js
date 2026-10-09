import config from '../data/config.json';

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CONTROLS = [
  ['WASD / flechas', 'Moverse'], ['Mayús', 'Esprintar'], ['Ratón', 'Apuntar · clic: disparar'],
  ['R', 'Recargar'], ['1-7', 'Cambiar de arma'], ['G', 'Lanzar granada'], ['Q', 'Usar botiquín'],
  ['E (mantener)', 'Interactuar · abrir tiendas y puertas'], ['B', 'Modo construcción'],
  ['Tab', 'Cambiar de página de piezas'], ['Clic dcho ×2', 'Vender una pieza'], ['N', 'Empezar la noche ya'],
  ['Rueda', 'Zoom'], ['Esc', 'Pausa / volver'], ['Enter', 'Jugar / reintentar'], ['F1', 'Panel de depuración'],
];

const TAGLINES = [
  'Turno de doce horas. Las extras, ya si eso, el mes que viene.',
  'Comisaría del Distrito 13. Atención al ciudadano (solo vivos).',
  'Se ruega no morder al personal.',
  'El comisario está de vacaciones. Indefinidamente.',
];

// Menús del juego en DOM: principal, tablón de mejoras, récords, opciones, controles, pausa y
// fin de partida. Navegación con ratón; Esc vuelve atrás y Enter confirma (jugar/reintentar).
export class Menus {
  constructor(game) {
    this.game = game;
    this.root = document.createElement('div');
    this.root.className = 'menus';
    game.uiRoot.appendChild(this.root);
    this.stack = [];
    this.current = null;
    this.resetArmed = false;
    this.root.addEventListener('mousedown', (e) => e.stopPropagation());
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('input', (e) => this.onInput(e));
    this.root.addEventListener('change', (e) => this.onInput(e));
    game.bus.on('meta:runFinished', () => this.show('gameover', true));
  }

  get open() { return !!this.current; }

  /** Muestra una pantalla. reset = vaciar el historial (pantallas raíz). */
  show(name, reset = false) {
    if (reset) this.stack.length = 0;
    else if (this.current && this.current !== name) this.stack.push(this.current);
    this.current = name;
    this.resetArmed = false;
    this.render();
    this.root.classList.add('show');
    const inMenu = this.game.state === 'menu';
    this.game.uiRoot.classList.toggle('in-menu', inMenu);
    this.game.audio?.play('ui_click');
  }

  hide() {
    this.current = null;
    this.stack.length = 0;
    this.root.classList.remove('show');
    this.root.innerHTML = '';
    this.game.uiRoot.classList.remove('in-menu');
  }

  /** Esc: vuelve atrás; en la pausa, continúa la partida. */
  back() {
    if (!this.current) return;
    if (this.stack.length) {
      this.current = this.stack.pop();
      this.resetArmed = false;
      this.render();
      this.game.audio?.play('ui_click');
    } else if (this.current === 'pause') {
      this.game.resume();
    }
  }

  /** Enter: jugar desde el menú principal o reintentar tras caer. */
  confirm() {
    if (this.current === 'main' || this.current === 'gameover') this.game.startRun();
  }

  // ------------------------------------------------------------------ pantallas
  render() {
    const html = this[`screen_${this.current}`]?.() ?? '';
    this.root.innerHTML = `<div class="menu-screen menu-${this.current}">${html}</div>`;
  }

  medalsChip() {
    return `<span class="medals-chip" title="Medallas para el tablón">🎖️ ${this.game.meta.medals}</span>`;
  }

  screen_main() {
    const m = this.game.meta;
    const best = m.records[0];
    const tag = TAGLINES[(Math.random() * TAGLINES.length) | 0];
    return `
      <div class="menu-title"><h1>Turno de noche</h1><p>${esc(tag)}</p></div>
      <div class="panel menu-box">
        <button class="btn big" data-act="play">Empezar el turno <span class="key">Enter</span></button>
        <button class="btn ghost" data-go="tablon">Tablón de la comisaría ${this.medalsChip()}</button>
        <button class="btn ghost" data-go="records">Récords</button>
        <button class="btn ghost" data-go="options">Opciones</button>
        <button class="btn ghost" data-go="controls">Controles</button>
        ${best ? `<p class="menu-note">Mejor turno: <b>${best.points}</b> puntos · ${best.nights} noches</p>` : ''}
        ${m.store.ok ? '' : '<p class="menu-note warn">⚠ No se puede guardar el progreso en este navegador.</p>'}
      </div>`;
  }

  screen_tablon() {
    const list = this.game.meta.upgradeList();
    const cards = list.map((u) => {
      const stars = `${'★'.repeat(u.level)}${'☆'.repeat(u.maxLevel - u.level)}`;
      const btn = u.nextCost
        ? `<button class="btn small" data-buy="${u.id}" ${u.canBuy ? '' : 'disabled'}>Mejorar · 🎖️ ${u.nextCost}</button>`
        : '<span class="maxed">Al máximo</span>';
      return `<div class="upgrade-card panel ${u.level ? 'owned' : ''}">
        <div class="up-head"><span class="up-icon">${u.icon}</span><span class="up-name">${esc(u.name)}</span><span class="up-stars">${stars}</span></div>
        <div class="up-desc">${esc(u.desc)}</div><div class="up-flavor">«${esc(u.flavor)}»</div>${btn}</div>`;
    }).join('');
    return `
      <div class="menu-header"><h2>Tablón de la comisaría</h2>${this.medalsChip()}</div>
      <p class="menu-note">Las medallas se ganan en cada turno: por noche sobrevivida, hitos y logros. Las mejoras son permanentes.</p>
      <div class="upgrade-grid">${cards}</div>
      <div class="menu-footer"><button class="btn ghost" data-act="back">Volver <span class="key">Esc</span></button></div>`;
  }

  screen_records() {
    const rows = this.game.meta.records;
    const last = this.game.meta.lastRun;
    const body = rows.length ? rows.map((r, k) => `<tr class="${last && last.rank === k ? 'me' : ''}">
        <td>${k + 1}</td><td><b>${r.points}</b></td><td>${r.nights}</td><td>${r.kills}</td><td>${fmtTime(r.time)}</td><td>${esc(r.weapon || '—')}</td><td>${esc(r.date)}</td></tr>`).join('')
      : '<tr><td colspan="7" class="empty">Todavía no hay turnos registrados. El expediente está limpio. Sospechosamente limpio.</td></tr>';
    const st = this.game.meta.data.stats;
    return `
      <div class="menu-header"><h2>Récords</h2></div>
      <div class="panel menu-box wide">
        <table class="records"><thead><tr><th>#</th><th>Puntos</th><th>Noches</th><th>Bajas</th><th>Tiempo</th><th>Arma favorita</th><th>Fecha</th></tr></thead><tbody>${body}</tbody></table>
        <p class="menu-note">Turnos jugados: ${st.runs} · Mejor noche: ${st.bestNight} · Bajas totales: ${st.totalKills}</p>
      </div>
      <div class="menu-footer"><button class="btn ghost" data-act="back">Volver <span class="key">Esc</span></button></div>`;
  }

  screen_options() {
    const a = this.game.audio, s = this.game.meta.settings;
    const vol = (k, label) => `<label><span>${label}</span><input type="range" min="0" max="1" step="0.05" data-vol="${k}" value="${a?.volumes[k] ?? 1}"></label>`;
    const q = Object.keys(config.quality.presets)
      .map((n) => `<option value="${n}" ${this.game.qualityName === n ? 'selected' : ''}>${n[0].toUpperCase()}${n.slice(1)}</option>`).join('');
    return `
      <div class="menu-header"><h2>Opciones</h2></div>
      <div class="panel menu-box options">
        ${vol('music', '🎵 Música')}${vol('sfx', '🔊 Efectos')}${vol('master', '🎚️ General')}
        <label><span>🖥️ Calidad gráfica</span><select data-set="quality">${q}</select></label>
        <label><span>📳 Temblor de cámara</span><input type="checkbox" data-set="shake" ${s.shake === false ? '' : 'checked'}></label>
        ${this.game.state === 'menu' ? `<button class="btn danger small" data-act="reset">${this.resetArmed ? '¿Seguro? Pulsa otra vez para borrar todo' : 'Borrar el progreso (medallas, mejoras y récords)'}</button>` : ''}
      </div>
      <div class="menu-footer"><button class="btn ghost" data-act="back">Volver <span class="key">Esc</span></button></div>`;
  }

  screen_controls() {
    const rows = CONTROLS.map(([k, v]) => `<tr><td><span class="key">${esc(k)}</span></td><td>${esc(v)}</td></tr>`).join('');
    return `
      <div class="menu-header"><h2>Controles</h2></div>
      <div class="panel menu-box"><table class="controls">${rows}</table></div>
      <div class="menu-footer"><button class="btn ghost" data-act="back">Volver <span class="key">Esc</span></button></div>`;
  }

  screen_pause() {
    return `
      <div class="panel menu-box">
        <h2>Pausa</h2>
        <button class="btn big" data-act="resume">Continuar <span class="key">Esc</span></button>
        <button class="btn ghost" data-go="options">Opciones</button>
        <button class="btn ghost" data-go="controls">Controles</button>
        <button class="btn ghost danger-text" data-act="abandon">${this.abandonArmed ? '¿Seguro? Pulsa otra vez' : 'Abandonar el turno'}</button>
      </div>`;
  }

  screen_gameover() {
    const r = this.game.meta.lastRun;
    if (!r) return '';
    const kills = r.killsByType.length
      ? r.killsByType.map((k) => `<li><span>${esc(k.name)}</span><b>${k.n}</b></li>`).join('')
      : '<li><span>Ninguna. Ni una.</span><b>0</b></li>';
    const medals = r.medals.length
      ? r.medals.map((m) => `<li><span>${esc(m.label)}</span><b>+${m.medals} 🎖️</b></li>`).join('')
      : '<li><span>Sin medallas este turno</span><b>0</b></li>';
    const record = r.rank >= 0 ? `<div class="new-record">${r.rank === 0 ? '🏆 ¡Nuevo récord!' : `📋 Entra en el top ${this.game.meta.cfg.maxRecords}: puesto ${r.rank + 1}`}</div>` : '';
    return `
      <div class="panel menu-box wide gameover">
        <h1 class="danger">Has caído</h1>
        <p class="obit">${esc(this.game.hud.el.obit?.textContent || '')}</p>
        ${record}
        <div class="summary">
          <div><span class="label">Noches</span><span class="val big">${r.nights}</span></div>
          <div><span class="label">Tiempo</span><span class="val big">${fmtTime(r.time)}</span></div>
          <div><span class="label">Bajas</span><span class="val big">${r.kills}</span></div>
          <div><span class="label">Puntos</span><span class="val big">${r.points}</span></div>
        </div>
        <div class="go-cols">
          <div><h3>Bajas por tipo</h3><ul class="go-list">${kills}</ul>
            <p class="menu-note">Arma favorita: <b>${esc(r.favorite || '—')}</b> · Mejor combo: <b>${r.maxCombo}</b></p></div>
          <div><h3>Medallas</h3><ul class="go-list">${medals}</ul>
            <p class="menu-note">Total: <b>+${r.totalMedals} 🎖️</b> · Tienes ${this.game.meta.medals}${r.saved ? '' : ' · ⚠ no se ha podido guardar'}</p></div>
        </div>
        <div class="go-buttons">
          <button class="btn big" data-act="play">Reintentar <span class="key">Enter</span></button>
          <button class="btn ghost" data-go="tablon">Tablón ${this.medalsChip()}</button>
          <button class="btn ghost" data-act="menu">Menú principal</button>
        </div>
      </div>`;
  }

  // ------------------------------------------------------------------ interacción
  onClick(e) {
    const el = e.target.closest('[data-act],[data-go],[data-buy]');
    if (!el || el.disabled) return;
    const g = this.game;
    if (el.dataset.go) { this.show(el.dataset.go); return; }
    if (el.dataset.buy) {
      if (g.meta.buyUpgrade(el.dataset.buy)) g.audio?.play('ui_buy');
      else g.audio?.play('ui_error');
      this.render();
      return;
    }
    switch (el.dataset.act) {
      case 'play': g.startRun(); break;
      case 'resume': g.resume(); break;
      case 'back': this.back(); break;
      case 'menu': g.quitToMenu(); break;
      case 'abandon':
        if (this.abandonArmed) { this.abandonArmed = false; g.abandonRun(); } else { this.abandonArmed = true; this.render(); }
        break;
      case 'reset':
        if (this.resetArmed) { g.meta.resetProgress(); this.resetArmed = false; g.audio?.play('break'); } else this.resetArmed = true;
        this.render();
        break;
    }
  }

  onInput(e) {
    const t = e.target;
    const g = this.game;
    if (t.dataset.vol) g.audio?.setVolume(t.dataset.vol, Number(t.value));
    if (t.dataset.set === 'quality' && e.type === 'change') {
      g.setQuality(t.value);
      g.meta.setSetting('quality', t.value);
    }
    if (t.dataset.set === 'shake' && e.type === 'change') {
      g.meta.setSetting('shake', t.checked);
      g.effects.shakeMul = t.checked ? 1 : 0;
    }
  }
}
