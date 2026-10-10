const TAP_SLOP = 10; // px que se puede mover el dedo y seguir contando como toque
const ARM_TIME = 4;  // s para confirmar la compra con el segundo toque

// Panel de tienda (DOM). Se abre al interactuar con un mostrador; se compra con clic o con
// las teclas 1-9; E, Esc o alejarse lo cierran. No pausa el juego: de noche, cuidado.
export class ShopPanel {
  constructor(game) {
    this.game = game;
    const el = document.createElement('div');
    el.className = 'shop panel interactive';
    el.innerHTML = `
      <div class="shop-head">
        <div><div class="shop-title" data-k="title"></div><div class="shop-sub" data-k="sub"></div></div>
        <div class="shop-points"><span class="label">Puntos</span><span class="val big" data-k="points">0</span></div>
        <button class="shop-close" data-k="close" aria-label="Cerrar">✕</button>
      </div>
      <div class="shop-night" data-k="night">🌙 De noche los precios suben un 50 %</div>
      <div class="shop-list" data-k="list"></div>
      <div class="shop-foot"><span class="kbd-only"><span class="key">1-9</span> comprar <span class="key">E</span>/<span class="key">Esc</span> cerrar</span><span class="touch-only">Toca un artículo para comprarlo</span></div>`;
    game.uiRoot.appendChild(el);
    this.el = el;
    this.k = {};
    el.querySelectorAll('[data-k]').forEach((e) => { this.k[e.dataset.k] = e; });
    el.addEventListener('mousedown', (e) => e.stopPropagation());
    // Comprar = TOCAR (pulsar y soltar casi sin moverse): deslizar la lista no compra nada.
    // El id se toma al pulsar, así que aunque la lista se re-renderice entre medias no se pierde.
    // En táctil hace falta doble toque: el primero marca el artículo y el segundo lo compra.
    this.armed = null;
    this.armedUntil = 0;
    this._press = null;
    this.k.list.addEventListener('pointerdown', (e) => {
      const row = e.target.closest('[data-id]');
      this._press = row ? { id: row.dataset.id, x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse' } : null;
    });
    this.k.list.addEventListener('pointerup', (e) => {
      const p = this._press;
      this._press = null;
      if (!p || Math.hypot(e.clientX - p.x, e.clientY - p.y) > TAP_SLOP) return;
      if (p.touch && !(this.armed === p.id && performance.now() < this.armedUntil)) {
        this.armed = p.id;
        this.armedUntil = performance.now() + ARM_TIME * 1000;
        this.render(true);
        this.game.audio?.play('ui_click');
        return;
      }
      this.armed = null;
      this.buy(p.id);
    });
    this.k.list.addEventListener('pointercancel', () => { this._press = null; });
    this.k.close.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); game.shop.close(); });
    this.items = [];
    this.signature = '';
    this.refreshTimer = 0;
  }

  buy(id) {
    const why = this.game.shop.whyNot(id);
    if (why) {
      this.game.hud.toast(`✋ ${why}`, 2);
      this.game.bus.emit('shop:denied', { id, why });
      return;
    }
    const msg = this.game.shop.buy(id);
    if (msg) this.game.hud.toast(msg, 3);
    this.render(true);
  }

  /** Compra por número (1-9) del artículo visible en esa posición. */
  buyIndex(n) {
    const it = this.items[n];
    if (it) this.buy(it.id);
  }

  update(dt) {
    const shop = this.game.shop;
    const open = !!shop.open;
    this.el.classList.toggle('show', open);
    if (!open) { this.signature = ''; return; }
    // Recién abierta: pintar ya (si no, durante un instante se vería la tienda anterior).
    if (this.signature === '') { this.render(true); this.refreshTimer = 0.25; return; }
    this.refreshTimer -= dt;
    if (this.refreshTimer <= 0) { this.refreshTimer = 0.25; this.render(); }
  }

  render(force = false) {
    const { shop, run } = this.game;
    const items = shop.catalog();
    this.k.points.textContent = String(run.points);
    // Solo se reconstruye la lista si cambia algo (los puntos ya se reflejan en el estado poor/ok).
    const sig = `${shop.open}|${items.map((i) => i.id + i.state + i.price + i.name + i.desc).join(',')}`;
    if (this.armed && performance.now() >= this.armedUntil) { this.armed = null; force = true; }
    if (!force && sig === this.signature) return;
    this.signature = sig;
    this.items = items;
    const info = shop.cfg.shops[shop.open];
    this.k.title.textContent = `${info.icon} ${info.name}`;
    this.k.sub.textContent = info.subtitle;
    this.k.night.style.display = shop.surcharge > 1 ? '' : 'none';
    let html = '', section = '';
    items.forEach((it, n) => {
      if (it.section !== section) { section = it.section; html += `<div class="shop-section">${section}</div>`; }
      const tag = {
        ok: `<span class="price">${it.price}</span>`,
        poor: `<span class="price poor">${it.price}</span>`,
        owned: '<span class="tag ok">✔ Tienes</span>',
        max: '<span class="tag">Máx.</span>',
        locked: '<span class="tag">🔒</span>',
        none: '<span class="tag">Nada que reparar</span>',
      }[it.state];
      const key = n < 9 ? `<span class="key">${n + 1}</span>` : '<span class="key blank"></span>';
      const armed = this.armed === it.id && performance.now() < this.armedUntil;
      const confirm = armed ? '<div class="confirm">👆 Toca otra vez para comprar</div>' : '';
      html += `<div class="shop-row ${it.state}${armed ? ' armed' : ''}" data-id="${it.id}">${key}<div class="shop-text"><div class="name">${it.name}</div><div class="desc">${it.desc}</div>${it.flavor ? `<div class="flavor">«${it.flavor}»</div>` : ''}${confirm}</div>${tag}</div>`;
    });
    this.k.list.innerHTML = html;
  }
}
