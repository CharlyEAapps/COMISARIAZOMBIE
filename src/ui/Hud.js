import { PHASE } from '../systems/DayNight.js';
import { PIECE_ORDER } from '../systems/BuildSystem.js';
import { WEAPON_IDS } from '../systems/WeaponSystem.js';
import interactions from '../data/interactions.json';

const MEDKIT_TIME = interactions._medkit.useTime;

const PHASE_TEXT = {
  [PHASE.DAY]: (n) => `Día ${n}<br>Prepara la defensa`,
  [PHASE.DUSK]: (n) => `Atardecer<br>La noche ${n} se acerca`,
  [PHASE.NIGHT]: (n) => `Noche ${n}<br>Aguanta`,
  [PHASE.DAWN]: (n) => `Amanecer<br>Has sobrevivido`,
};

// HUD en DOM superpuesto al canvas. Estilo: paneles oscuros translúcidos, cifras
// monoespaciadas grandes, etiquetas pequeñas en versalitas y barras de color.
export class Hud {
  constructor(game) {
    this.game = game;
    const root = document.createElement('div');
    root.className = 'hud';
    root.innerHTML = `
      <div class="panel panel-status">
        <div class="clock"><span class="clock-big" data-k="time">07:00</span><span class="clock-sub" data-k="phase"></span></div>
        <div class="bar phase-bar"><div class="fill phase" data-k="phaseBar"></div></div>
        <div class="stat"><div class="stat-row"><span class="label">♥ Vida</span><span class="val" data-k="hpText">100</span></div><div class="bar"><div class="fill hp" data-k="hp"></div></div><div class="bar thin armor-bar" data-k="armorBar"><div class="fill armor" data-k="armor"></div></div></div>
        <div class="stat"><div class="stat-row"><span class="label">⚡ Resistencia</span><span class="val" data-k="stText">100</span></div><div class="bar"><div class="fill stamina" data-k="st"></div></div></div>
        <div class="stat-row score"><span class="label">★ Puntos</span><span class="val big" data-k="points">0</span></div>
        <div class="stat-row"><span class="label">☠ Bajas</span><span class="val" data-k="kills">0</span></div>
        <div class="stat-row" data-k="remainingRow"><span class="label">🧟 Quedan</span><span class="val danger-text" data-k="remaining">0</span></div>
        <div class="chips" data-k="chips"></div>
      </div>
      <div class="panel panel-case" data-k="case"><span class="label">📋 Caso de la noche</span><div data-k="caseText"></div></div>
      <div class="combo" data-k="combo"><span data-k="comboMult">×1</span><small data-k="comboCount">COMBO 0</small></div>
      <div class="panel panel-weapon">
        <div class="weapon-slots" data-k="slots"></div>
        <div class="stat-row"><span class="label" data-k="medkits">🩹 ×1 <span class="key small">Q</span></span><span class="label" data-k="grenades">💣 ×1 <span class="key small">G</span></span><span class="label" data-k="wname">Pistola</span></div>
        <div class="ammo"><span class="ammo-mag" data-k="mag">12</span><span class="ammo-res" data-k="res">/ ∞</span></div>
        <div class="bar thin"><div class="fill reload" data-k="reload"></div></div>
      </div>
      <div class="hurt" data-k="hurt"></div>
      <div class="toasts" data-k="toasts"></div>
      <div class="banner" data-k="banner"><div class="banner-title" data-k="bannerTitle"></div><div class="banner-sub" data-k="bannerSub"></div></div>
      <div class="build-bar" data-k="buildBar">
        <div class="build-info panel" data-k="buildInfo"></div>
        <div class="build-cards" data-k="buildCards"></div>
      </div>
      <div class="prompt-wrap">
        <div class="prompt panel" data-k="prompt">
          <span class="key">E</span><span data-k="promptText"></span>
          <div class="bar thin"><div class="fill prompt-fill" data-k="promptFill"></div></div>
        </div>
        <div class="prompt panel subtle" data-k="ready"><span class="key">B</span> Construir<span data-k="readyNight"> <span class="key">N</span> Empezar la noche ya</span></div>
      </div>
      <div class="hint panel" data-k="hint">
        <span class="key">WASD</span> mover <span class="key">Ratón</span> apuntar y disparar <span class="key">R</span> recargar <span class="key">1-7</span> armas <span class="key">G</span> granada <span class="key">E</span> interactuar <span class="key">Q</span> botiquín <span class="key">Esc</span> pausa
      </div>
      <div class="overlay" data-k="pause"><div class="panel modal"><h1>Pausa</h1><p>Pulsa <span class="key">Esc</span> para continuar</p></div></div>
      <div class="overlay" data-k="over">
        <div class="panel modal">
          <h1 class="danger">Has caído</h1>
          <div class="summary">
            <div><span class="label">Noches</span><span class="val big" data-k="oNights">0</span></div>
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
    // Tarjetas de piezas del modo construcción (clic para seleccionar).
    this.cards = PIECE_ORDER.map((type, n) => {
      const def = game.build.pieces[type];
      const el = document.createElement('div');
      el.className = 'build-card panel interactive';
      el.innerHTML = `<span class="key">${n + 1}</span><span class="icon">${def.icon}</span><span class="name">${def.name}</span><span class="cost"></span>`;
      el.addEventListener('mousedown', (e) => { e.stopPropagation(); game.build.selected = type; });
      this.el.buildCards.appendChild(el);
      return { type, el, cost: el.querySelector('.cost') };
    });
    this._last = {};
    this.hintTimer = 14;
    this.bannerTimer = 0;

    const bus = game.bus;
    bus.on('phase:atardecer', ({ night }) => this.banner(`Noche ${night}`, 'Suena la sirena… se acercan', 3.5));
    bus.on('phase:noche', ({ night }) => this.banner(`Noche ${night}`, 'Sobrevive hasta el amanecer', 2.5));
    bus.on('phase:dia', ({ night }) => { if (night > 1) this.banner(`Día ${night}`, 'Repara, compra y prepárate', 2.5); });
    bus.on('score:nightSummary', ({ night, lines, total }) => this.banner(`¡Noche ${night} superada!`, `${lines.join(' · ')}<br><b>+${total}</b>`, 5));
    bus.on('run:start', () => this.banner('Turno de noche', 'Comisaría del Distrito 13 · Día 1', 3));
  }

  /** Solo toca el DOM cuando cambia un valor. */
  set(key, value, prop = 'textContent') {
    const id = key + prop;
    if (this._last[id] === value) return;
    this._last[id] = value;
    if (prop === 'width') this.el[key].style.width = value;
    else if (prop === 'opacity') this.el[key].style.opacity = value;
    else if (prop === 'show') this.el[key].classList.toggle('show', value);
    else this.el[key][prop] = value;
  }

  banner(title, sub, seconds) {
    this.el.bannerTitle.textContent = title;
    this.el.bannerSub.innerHTML = sub;
    this.bannerTimer = seconds;
    this.el.banner.classList.remove('show');
    void this.el.banner.offsetWidth; // reinicia la animación CSS
    this.el.banner.classList.add('show');
  }

  toast(text, seconds = 4.5) {
    const el = document.createElement('div');
    el.className = 'toast panel';
    el.textContent = text;
    this.el.toasts.prepend(el);
    while (this.el.toasts.children.length > 4) this.el.toasts.lastChild.remove();
    setTimeout(() => el.classList.add('out'), seconds * 1000);
    setTimeout(() => el.remove(), seconds * 1000 + 400);
  }

  update(dt) {
    const { player, weapons, run, state, dayNight, waves, score, interactions, power } = this.game;
    const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    // Si la noche se alarga porque quedan zombis, el reloj se queda en 05:00 y lo indica.
    const overtime = dayNight.phase === PHASE.NIGHT && dayNight.t > dayNight.duration;
    this.set('time', overtime ? `${dayNight.formatClock()}+` : dayNight.formatClock());
    this.set('phase', PHASE_TEXT[dayNight.phase](dayNight.night), 'innerHTML');
    this.set('phaseBar', `${(dayNight.progress * 100).toFixed(1)}%`, 'width');
    if (this._last.phaseAttr !== dayNight.phase) {
      this._last.phaseAttr = dayNight.phase;
      this.el.phaseBar.dataset.phase = dayNight.phase;
    }
    this.set('hpText', String(Math.ceil(player.hp)));
    this.set('hp', `${(player.hp / player.maxHp) * 100}%`, 'width');
    this.set('stText', String(Math.round(player.stamina)));
    this.set('st', `${player.stamina / player.data.maxStamina * 100}%`, 'width');
    this.set('points', String(run.points));
    this.set('kills', String(run.kills));
    const night = dayNight.phase === PHASE.NIGHT;
    this.set('remainingRow', night, 'show');
    this.set('remaining', String(waves.remaining));

    // Chips de estado (como "Ausente / Pijama" de la referencia).
    const chips = [];
    if (player.buff('staminaRegen') > 1) chips.push('☕ Cafeinado');
    if (power.generator) chips.push(power.lightsOn ? '💡 Luces' : '🌑 Luces apagadas');
    if (this.game.lighting.alarmTimer > 0) chips.push('🚨 Alarma');
    if (this.game.zombies.decoy.timer > 0) chips.push('🚓 Sirena');
    const tr = this.game.build.transformer;
    if (tr && tr.hp <= 0) chips.push('<b class="danger-text">⚠ Sin corriente</b>');
    else if (tr && tr.hp < tr.maxHp) chips.push(`⚡ Transformador ${Math.round((tr.hp / tr.maxHp) * 100)} %`);
    this.set('chips', chips.map((c) => `<span class="chip">${c}</span>`).join(''), 'innerHTML');

    // Caso de la noche.
    this.set('case', !!score.objective, 'show');
    if (score.objective) {
      // El caso solo cuenta durante su noche (antes, "recibe menos de N de daño" ya saldría cumplido).
      const met = night && score.objectiveMet();
      this.set('caseText', `${score.objective.text} <b class="${met ? 'ok' : ''}">${met ? '✔' : `+${score.objective.reward}`}</b>`, 'innerHTML');
    }

    // Combo.
    const mult = score.multiplier;
    this.set('combo', score.combo >= 3, 'show');
    this.set('comboMult', `×${mult}`);
    this.set('comboCount', `COMBO ${score.combo}`);

    const w = weapons.weapon;
    this.set('wname', w.data.name);
    this.set('medkits', `🩹 ×${player.medkits} <span class="key small">Q</span>`, 'innerHTML');
    this.set('grenades', `💣 ×${weapons.grenades} <span class="key small">G</span>`, 'innerHTML');
    if (w.data.melee) {
      this.set('mag', '—');
      this.set('res', '');
    } else {
      this.set('mag', w.reloading > 0 ? '··' : String(w.mag));
      this.set('res', w.reserve < 0 ? '/ ∞' : `/ ${w.reserve}`);
    }
    const rl = w.reloading > 0 ? 1 - w.reloading / w.stats.reloadTime : player.medkitTimer > 0 ? 1 - player.medkitTimer / MEDKIT_TIME : 0;
    this.set('reload', `${(rl * 100).toFixed(0)}%`, 'width');
    this.el.mag.classList.toggle('low', !w.data.melee && w.mag <= Math.ceil(w.stats.magSize * 0.25));
    // Tira de armas: número de tecla e icono; resaltada la actual.
    const slotsKey = `${weapons.current}|${weapons.owned.size}`;
    if (this._last.slotsKey !== slotsKey) {
      this._last.slotsKey = slotsKey;
      this.set('slots', WEAPON_IDS.filter((id) => weapons.has(id))
        .map((id) => `<span class="wslot${id === weapons.current ? ' on' : ''}"><b>${weapons.defs[id].slot}</b>${weapons.defs[id].icon}</span>`).join(''), 'innerHTML');
    }
    this.set('armorBar', player.armor > 0, 'show');
    this.set('armor', `${player.armorMax ? (player.armor / player.armorMax) * 100 : 0}%`, 'width');

    const hurt = Math.max(player.hurtTimer / player.data.hurtFlashTime, player.hp < 30 ? 0.35 : 0);
    this.set('hurt', hurt.toFixed(2), 'opacity');

    // Aviso de interacción.
    const it = interactions.current;
    this.set('prompt', !!it && player.alive, 'show');
    if (it) {
      const av = interactions.availability(it);
      this.set('promptText', av.ok ? interactions.label(it) : `${interactions.label(it)} · <i>${av.reason}</i>`, 'innerHTML');
      this.el.prompt.classList.toggle('disabled', !av.ok);
      this.set('promptFill', `${(interactions.progress * 100).toFixed(0)}%`, 'width');
    }
    this.set('ready', !it && player.alive && !this.game.build.active, 'show');
    this.set('readyNight', dayNight.phase === PHASE.DAY ? '1' : '0', 'opacity');
    this.el.readyNight.style.display = dayNight.phase === PHASE.DAY ? '' : 'none';
    this.updateBuild();

    this.hintTimer -= dt;
    this.set('hint', this.hintTimer > 0 ? '1' : '0', 'opacity');

    if (this.bannerTimer > 0 && (this.bannerTimer -= dt) <= 0) this.el.banner.classList.remove('show');

    this.el.pause.classList.toggle('show', state === 'paused');
    this.el.over.classList.toggle('show', state === 'gameover');
    if (state === 'gameover') {
      this.set('oNights', String(run.nights ?? 0));
      this.set('oTime', fmt(run.time));
      this.set('oKills', String(run.kills));
      this.set('oPoints', String(run.points));
    }
  }

  /** Barra del modo construcción: piezas con coste y la acción sobre la celda señalada. */
  updateBuild() {
    const b = this.game.build;
    this.set('buildBar', b.active, 'show');
    if (this._last.building !== b.active) {
      this._last.building = b.active;
      this.root.classList.toggle('building', b.active);
    }
    if (!b.active) return;
    const pts = this.game.run.points;
    const shop = this.game.shop;
    for (const c of this.cards) {
      const cost = b.costOf(c.type);
      const locked = !shop.isUnlocked(c.type, 0);
      c.el.classList.toggle('selected', b.selected === c.type);
      c.el.classList.toggle('poor', pts < cost);
      c.el.classList.toggle('locked', locked);
      c.cost.textContent = locked ? '🔒' : String(cost);
    }
    const s = b.structures.get(b.hoverCell);
    const surcharge = Math.round((b.cfg.nightSurcharge - 1) * 100);
    let info;
    if (s) {
      const lvl = s.def.levels[s.level];
      const parts = [`<b>${s.def.icon} ${lvl.name}</b> ${Math.ceil(s.hp)}/${s.maxHp}`];
      if (!b.inReachXY(s.cx, s.cz)) {
        parts.push('<i>Demasiado lejos</i>');
      } else {
        const rc = b.repairCostOf(s), uc = b.upgradeCost(s);
        if (rc) parts.push(this.game.time < s.repairReady ? '<i>Reparando…</i>' : `<span class="key">Clic</span> Reparar (${rc})`);
        else if (uc && !b.upgradeUnlocked(s)) parts.push(`<i>🔒 ${s.def.levels[s.level + 1].name}: desbloquéalo en el almacén</i>`);
        else if (uc) parts.push(`<span class="key">Clic</span> Mejorar a ${s.def.levels[s.level + 1].name} (${uc})`);
        else parts.push('Nivel máximo');
        parts.push(b.sellArmed === s.id
          ? `<b class="danger-text">Clic dcho otra vez: vender (+${b.sellValue(s)})</b>`
          : `<span class="key">Clic dcho</span> Vender (+${b.sellValue(s)})`);
      }
      info = parts.join(' · ');
    } else if (b.hoverReason) {
      info = `<i>${b.hoverReason}</i> · <span class="key">Clic dcho</span> Salir`;
    } else {
      const def = b.pieces[b.selected];
      const drag = def.blocks && b.selected !== 'puerta' ? ' (arrastra para hacer una fila)' : '';
      const warn = b.selected === 'mina' ? ' · <i>¡También te daña a ti!</i>' : '';
      const width = b.hoverCells.length;
      const what = width > 1 ? `${def.name.toLowerCase()} de ${width} celdas (${b.placeCost(b.selected, b.hoverCell)})` : def.name.toLowerCase();
      info = `<span class="key">Clic</span> Construir ${what}${drag} · <span class="key">Clic dcho</span> Salir${b.isNight ? ` · <i>De noche +${surcharge} %</i>` : ''}${warn}`;
    }
    this.set('buildInfo', info, 'innerHTML');
  }

  reset() {
    this.el.toasts.innerHTML = '';
    this.hintTimer = 14;
  }
}
