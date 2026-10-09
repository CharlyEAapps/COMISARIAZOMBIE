import shopData from '../data/shop.json';
import weaponsData from '../data/weapons.json';
import interactions from '../data/interactions.json';
import { PHASE } from './DayNight.js';
import { WEAPON_IDS, tracksOf } from './WeaponSystem.js';

const MEDKIT_MAX = interactions._medkit.max;
const GRENADE = weaponsData._granada;
const TRACKS = weaponsData._upgrades.tracks;
const LEVELS = weaponsData._upgrades.levels;

/** Motivo legible por el que no se puede comprar un artículo. */
export const STATE_REASON = {
  poor: 'No tienes puntos suficientes',
  max: 'Ya está al máximo',
  owned: 'Ya lo tienes',
  locked: 'Requiere la mejora anterior',
  none: 'No hay nada que reparar',
};

// Tiendas físicas (armería, enfermería, almacén). Cada tienda genera su catálogo según el
// estado de la partida: armas que ya tienes, munición, mejoras, curas, desbloqueos de
// construcción… Todo se compra con los puntos de la partida; de noche, con recargo.
export class ShopSystem {
  constructor(game) {
    this.game = game;
    this.cfg = shopData;
    this.open = null; // id de la tienda abierta o null
    this.openAt = null;
    this.reset();
  }

  reset() {
    this.open = null;
    this.bought = {}; // id de artículo → veces comprado (vida máxima, etc.)
    this.unlocked = new Set(shopData.startUnlocked);
    this.armeriaDiscount = 0;
  }

  get surcharge() {
    return this.game.dayNight.phase === PHASE.NIGHT ? this.cfg.nightSurcharge : 1;
  }

  price(base) {
    return Math.ceil(base * this.surcharge);
  }

  /** Precio en la armería (con el descuento del tablón de mejoras). */
  armPrice(base) {
    return Math.ceil(base * (1 - this.armeriaDiscount) * this.surcharge);
  }

  isUnlocked(type, level) {
    return this.unlocked.has(`${type}:${level}`);
  }

  openShop(id, x, z) {
    this.open = id;
    this.openAt = { x, z };
    this.game.build?.setActive(false);
    this.game.bus.emit('shop:open', { id });
  }

  close() {
    if (!this.open) return;
    this.open = null;
    this.game.bus.emit('shop:close');
  }

  /** Se cierra sola si el jugador se aleja del mostrador o muere. */
  update() {
    if (!this.open) return;
    const p = this.game.player;
    if (!p.alive || Math.hypot(p.position.x - this.openAt.x, p.position.z - this.openAt.z) > this.cfg.closeDistance) this.close();
  }

  // ------------------------------------------------------------------ catálogos
  /**
   * Artículos de la tienda: [{ id, name, desc, price, section, state: 'ok'|'owned'|'max'|'locked'|'poor', note }]
   */
  catalog(shopId = this.open) {
    if (shopId === 'armeria') return this.armeria();
    if (shopId === 'enfermeria') return this.enfermeria();
    if (shopId === 'almacen') return this.almacen();
    return [];
  }

  finish(items) {
    const pts = this.game.run.points;
    for (const it of items) {
      if (!it.state) it.state = pts < it.price ? 'poor' : 'ok';
    }
    return items;
  }

  armeria() {
    const W = this.game.weapons;
    const items = [];
    for (const id of WEAPON_IDS) {
      const d = weaponsData[id];
      // Las armas siguen en la lista aunque ya las tengas: así los números 1-9 no se mueven.
      if (d.price > 0) {
        items.push({
          id: `weapon:${id}`, section: 'Armas', name: `${d.icon} ${d.name}`, desc: this.weaponDesc(d), flavor: d.flavor,
          price: this.armPrice(d.price), state: W.has(id) ? 'owned' : null,
        });
      }
      if (!W.has(id)) continue;
      if (d.ammoPack) {
        // Si solo cabe parte del paquete, se cobra la parte proporcional.
        const w = W.owned.get(id);
        const room = Math.max(0, d.maxReserve - w.reserve);
        const amount = Math.min(d.ammoPack.amount, room);
        items.push({
          id: `ammo:${id}`, section: 'Munición', name: `${d.icon} Munición de ${d.name.toLowerCase()} (+${amount || d.ammoPack.amount})`,
          desc: `Reserva ${w.reserve}/${d.maxReserve}`, amount,
          price: this.armPrice(Math.max(1, Math.ceil(d.ammoPack.price * (amount || d.ammoPack.amount) / d.ammoPack.amount))),
          state: amount ? null : 'max',
        });
      }
      for (const track of tracksOf(d)) {
        const t = TRACKS[track];
        const lvl = W.upgradeLevel(id, track);
        const cost = W.nextUpgradeCost(id, track);
        const amount = t.flat ? `+${t.perLevel}${t.unit ? ` ${t.unit}` : ''}` : `+${Math.round(t.perLevel * 100)} %`;
        items.push({
          id: `upgrade:${id}:${track}`, section: 'Mejoras', name: `${d.icon} ${d.name}: ${t.name} ${'★'.repeat(lvl)}${'☆'.repeat(LEVELS - lvl)}`,
          desc: `${amount} ${t.name.toLowerCase()}${track === 'reload' ? ' (más rápida)' : ''}`,
          price: cost ? this.armPrice(cost) : 0, state: cost ? null : 'max',
        });
      }
    }
    items.push({
      id: 'grenade', section: 'Munición', name: `💣 Granada (${W.grenades}/${GRENADE.max})`,
      desc: 'Se lanza con G hacia el cursor. ¡También te daña!', flavor: GRENADE.flavor, price: this.armPrice(GRENADE.price),
      state: W.grenades >= GRENADE.max ? 'max' : null,
    });
    // Agrupado por secciones en un orden fijo: primero lo que se puede comprar de nuevo.
    const order = ['Armas', 'Munición', 'Mejoras'];
    items.sort((x, y) => order.indexOf(x.section) - order.indexOf(y.section));
    return this.finish(items);
  }

  weaponDesc(d) {
    if (d.melee) return `Cuerpo a cuerpo: ${d.damage} de daño en arco, sin munición.`;
    const parts = [`${d.pellets > 1 ? `${d.pellets}×` : ''}${d.damage} daño`, `${d.magSize} balas`, `${d.fireRate}/s`];
    if (d.pierce) parts.push(`atraviesa ${d.pierce}`);
    if (d.stun) parts.push(`aturde ${d.stun} s y salta a ${d.chain}`);
    if (d.auto) parts.push('automática');
    return parts.join(' · ');
  }

  enfermeria() {
    const p = this.game.player;
    const items = [];
    for (const it of shopData.enfermeria) {
      const times = this.bought[it.id] ?? 0;
      let price = this.price(it.price + (it.priceStep ?? 0) * times);
      let state = null;
      if (it.id === 'botiquin' && p.medkits >= MEDKIT_MAX) state = 'max';
      if (it.id === 'curacion' && p.hp >= p.maxHp) state = 'max';
      if (it.id === 'chaleco') {
        // Chaleco dañado: se paga solo la parte que falta.
        const missing = Math.max(0, it.armor - p.armor);
        if (!missing) state = 'max';
        else price = this.price(Math.ceil(it.price * missing / it.armor));
      }
      if (it.max && times >= it.max) { state = 'max'; price = 0; }
      items.push({ id: it.id, section: 'Enfermería', name: it.name, desc: it.desc, flavor: it.flavor, price, state });
    }
    return this.finish(items);
  }

  almacen() {
    const items = [];
    for (const it of shopData.almacen) {
      if (it.id === 'kit_reparacion') {
        const cost = this.repairKitCost();
        items.push({ id: it.id, section: 'Mantenimiento', name: `🔧 ${it.name}`, desc: it.desc, flavor: it.flavor, price: cost, state: cost ? null : 'none' });
        continue;
      }
      const key = it.id.slice('unlock:'.length);
      let state = null, note = '';
      if (this.unlocked.has(key)) state = 'owned';
      else if (it.requires && !this.unlocked.has(it.requires.slice('unlock:'.length))) {
        state = 'locked';
        note = `Requiere: ${shopData.almacen.find((o) => o.id === it.requires)?.name ?? 'la mejora anterior'}`;
      }
      items.push({ id: it.id, section: 'Desbloqueos', name: it.name, desc: note || it.desc, flavor: it.flavor, price: this.price(it.price), state });
    }
    return this.finish(items);
  }

  /** Piezas que el kit puede reparar ahora (dañadas y fuera de su espera de reparación). */
  repairablePieces() {
    const b = this.game.build;
    const out = [];
    for (const s of b.all) if (s.hp < s.maxHp && this.game.time >= s.repairReady) out.push(s);
    return out;
  }

  /** Reparar todas las construcciones con descuento (repairCostOf ya incluye el recargo nocturno). */
  repairKitCost() {
    const kit = shopData.almacen.find((i) => i.id === 'kit_reparacion');
    let total = 0;
    for (const s of this.repairablePieces()) total += this.game.build.repairCostOf(s);
    return Math.ceil(total * (1 - kit.repairDiscount));
  }

  // ------------------------------------------------------------------ compras
  /** Motivo por el que no se puede comprar `itemId` ahora, o null si se puede. */
  whyNot(itemId) {
    const item = this.catalog().find((i) => i.id === itemId);
    if (!item) return 'No disponible';
    return item.state === 'ok' ? null : STATE_REASON[item.state] ?? 'No disponible';
  }

  /** @returns {string|null} mensaje de resultado (o null si no se pudo comprar) */
  buy(itemId) {
    const item = this.catalog().find((i) => i.id === itemId);
    if (!item || item.state !== 'ok') return null;
    const { game } = this;
    const W = game.weapons, p = game.player;
    game.run.points -= item.price;
    const [kind, a, b] = itemId.split(':');
    let msg = `Comprado: ${item.name}`;
    if (kind === 'weapon') {
      W.give(a);
      W.switchTo(a);
      msg = `${weaponsData[a].icon} Nueva arma: ${weaponsData[a].name} (tecla ${weaponsData[a].slot})`;
    } else if (kind === 'ammo') {
      W.addAmmo(a, item.amount);
    } else if (kind === 'upgrade') {
      W.applyUpgrade(a, b);
    } else if (kind === 'grenade') {
      W.grenades++;
    } else if (kind === 'unlock') {
      this.unlocked.add(`${a}:${b}`);
      msg = `🔓 Desbloqueado: ${item.name}`;
    } else if (kind === 'kit_reparacion') {
      for (const s of this.repairablePieces()) {
        s.hp = s.maxHp;
        s.repairReady = game.time + game.build.cfg.repairCooldown;
        game.build.applyGrid(s);
      }
      game.build.changed(false);
      msg = '🔧 Todas las construcciones reparadas';
    } else if (kind === 'botiquin') {
      p.medkits++;
    } else if (kind === 'curacion') {
      p.heal(p.maxHp);
    } else if (kind === 'chaleco') {
      const def = shopData.enfermeria.find((i) => i.id === 'chaleco');
      p.armor = def.armor;
      p.armorMax = def.armor;
      p.armorAbsorb = def.absorb;
    } else if (kind === 'vida_max') {
      const def = shopData.enfermeria.find((i) => i.id === 'vida_max');
      p.maxHp += def.amount;
      p.heal(def.amount);
    }
    this.bought[itemId] = (this.bought[itemId] ?? 0) + 1;
    game.bus.emit('shop:bought', { id: itemId, price: item.price });
    return msg;
  }
}
