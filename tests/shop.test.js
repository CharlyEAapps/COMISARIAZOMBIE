import { describe, it, expect, beforeEach } from 'vitest';
import weapons from '../src/data/weapons.json';
import shopData from '../src/data/shop.json';
import { ShopSystem } from '../src/systems/ShopSystem.js';
import { WeaponSystem, weaponStats, upgradeCost, WEAPON_IDS } from '../src/systems/WeaponSystem.js';
import { EventBus } from '../src/core/EventBus.js';
import { PHASE } from '../src/systems/DayNight.js';

// Juego mínimo para la tienda y las armas.
function makeGame() {
  const game = {
    bus: new EventBus(),
    run: { points: 100000 },
    dayNight: { phase: PHASE.DAY, night: 1 },
    grid: { isShotBlocked: () => false, isWalkable: () => true },
    player: {
      data: { startWeapon: 'pistola' }, alive: true, hp: 100, maxHp: 100, medkits: 1, armor: 0, armorAbsorb: 0,
      position: { x: 0, z: 0 }, heal(n) { this.hp = Math.min(this.maxHp, this.hp + n); },
    },
    build: { all: new Set(), repairCostOf: () => 0, changed() {}, applyGrid() {} },
  };
  game.weapons = new WeaponSystem(game);
  game.shop = new ShopSystem(game);
  return game;
}

describe('Armas', () => {
  it('las mejoras escalan daño, cargador y recarga', () => {
    const d = weapons.fusil;
    const s0 = weaponStats(d), s3 = weaponStats(d, { damage: 3, mag: 3, reload: 3 });
    expect(s3.damage).toBeCloseTo(d.damage * 1.6);
    expect(s3.magSize).toBe(Math.round(d.magSize * 1.9));
    expect(s3.reloadTime).toBeCloseTo(d.reloadTime * 0.55);
    expect(s0.magSize).toBe(d.magSize);
  });

  it('el coste de las mejoras sube por nivel', () => {
    expect(upgradeCost(weapons.escopeta, 1)).toBeLessThan(upgradeCost(weapons.escopeta, 3));
    expect(upgradeCost(weapons.pistola, 1)).toBeGreaterThan(0); // la pistola usa precio base
  });

  it('cada arma tiene una ranura distinta (1-7)', () => {
    const slots = WEAPON_IDS.map((id) => weapons[id].slot);
    expect(new Set(slots).size).toBe(slots.length);
  });

  it('se empieza con la pistola y munición infinita', () => {
    const g = makeGame();
    expect(g.weapons.current).toBe('pistola');
    expect(g.weapons.weapon.reserve).toBe(-1);
    expect(g.weapons.grenades).toBe(weapons._granada.start);
  });

  it('la munición tiene tope', () => {
    const g = makeGame();
    g.weapons.give('escopeta');
    g.weapons.addAmmo('escopeta', 9999);
    expect(g.weapons.owned.get('escopeta').reserve).toBe(weapons.escopeta.maxReserve);
    expect(g.weapons.ammoFull('escopeta')).toBe(true);
  });
});

describe('Tiendas', () => {
  let g;
  beforeEach(() => { g = makeGame(); });

  it('comprar un arma cobra, la da y la equipa', () => {
    g.shop.open = 'armeria';
    const before = g.run.points;
    expect(g.shop.buy('weapon:escopeta')).toMatch(/Escopeta/);
    expect(g.run.points).toBe(before - weapons.escopeta.price);
    expect(g.weapons.has('escopeta')).toBe(true);
    expect(g.weapons.current).toBe('escopeta');
    // Sigue en la lista (los números 1-9 no se mueven) pero marcada como "Tienes"; ahora hay munición y mejoras.
    const cat = g.shop.catalog();
    const ids = cat.map((i) => i.id);
    expect(cat.find((i) => i.id === 'weapon:escopeta').state).toBe('owned');
    expect(g.shop.buy('weapon:escopeta')).toBe(null);
    expect(ids).toContain('ammo:escopeta');
    expect(ids).toContain('upgrade:escopeta:damage');
  });

  it('de noche todo cuesta más', () => {
    g.shop.open = 'armeria';
    const day = g.shop.catalog().find((i) => i.id === 'weapon:subfusil').price;
    g.dayNight.phase = PHASE.NIGHT;
    const night = g.shop.catalog().find((i) => i.id === 'weapon:subfusil').price;
    expect(night).toBe(Math.ceil(day * shopData.nightSurcharge));
  });

  it('sin puntos no se compra', () => {
    g.shop.open = 'armeria';
    g.run.points = 10;
    expect(g.shop.buy('weapon:fusil')).toBe(null);
    expect(g.weapons.has('fusil')).toBe(false);
    expect(g.run.points).toBe(10);
  });

  it('las mejoras llegan al nivel 3 y luego se marcan como máximo', () => {
    g.shop.open = 'armeria';
    for (let n = 0; n < 3; n++) expect(g.shop.buy('upgrade:pistola:mag')).toBeTruthy();
    expect(g.weapons.upgradeLevel('pistola', 'mag')).toBe(3);
    expect(g.shop.catalog().find((i) => i.id === 'upgrade:pistola:mag').state).toBe('max');
    expect(g.shop.buy('upgrade:pistola:mag')).toBe(null);
  });

  it('la porra no tiene mejoras de cargador ni recarga', () => {
    g.shop.open = 'armeria';
    g.shop.buy('weapon:porra');
    const ids = g.shop.catalog().map((i) => i.id);
    expect(ids).toContain('upgrade:porra:damage');
    expect(ids).not.toContain('upgrade:porra:mag');
  });

  it('enfermería: chaleco, vida máxima con tope y botiquines con tope', () => {
    g.shop.open = 'enfermeria';
    g.shop.buy('chaleco');
    expect(g.player.armor).toBe(100);
    for (let n = 0; n < 3; n++) g.shop.buy('vida_max');
    expect(g.player.maxHp).toBe(100 + 3 * shopData.enfermeria.find((i) => i.id === 'vida_max').amount);
    expect(g.shop.catalog().find((i) => i.id === 'vida_max').state).toBe('max');
    g.player.medkits = 3;
    expect(g.shop.catalog().find((i) => i.id === 'botiquin').state).toBe('max');
  });

  it('almacén: desbloqueos con requisitos', () => {
    g.shop.open = 'almacen';
    expect(g.shop.isUnlocked('barricada', 0)).toBe(true);
    expect(g.shop.isUnlocked('puerta', 0)).toBe(false);
    expect(g.shop.catalog().find((i) => i.id === 'unlock:barricada:2').state).toBe('locked');
    expect(g.shop.buy('unlock:barricada:2')).toBe(null);
    g.shop.buy('unlock:barricada:1');
    expect(g.shop.isUnlocked('barricada', 1)).toBe(true);
    expect(g.shop.buy('unlock:barricada:2')).toBeTruthy();
    expect(g.shop.catalog().find((i) => i.id === 'unlock:barricada:2').state).toBe('owned');
  });

  it('la munición casi llena se cobra en proporción', () => {
    g.shop.open = 'armeria';
    g.weapons.give('escopeta');
    const w = g.weapons.owned.get('escopeta');
    w.reserve = weapons.escopeta.maxReserve - 3;
    const it = g.shop.catalog().find((i) => i.id === 'ammo:escopeta');
    expect(it.amount).toBe(3);
    expect(it.price).toBe(Math.ceil(weapons.escopeta.ammoPack.price * 3 / weapons.escopeta.ammoPack.amount));
  });

  it('el táser mejora aturdimiento y saltos (no daño)', () => {
    g.shop.open = 'armeria';
    g.shop.buy('weapon:taser');
    const ids = g.shop.catalog().map((i) => i.id);
    expect(ids).toContain('upgrade:taser:stun');
    expect(ids).toContain('upgrade:taser:chain');
    expect(ids).not.toContain('upgrade:taser:damage');
    g.shop.buy('upgrade:taser:chain');
    expect(g.weapons.owned.get('taser').stats.chain).toBe(weapons.taser.chain + 1);
  });

  it('whyNot explica por qué no se puede comprar', () => {
    g.shop.open = 'armeria';
    g.run.points = 0;
    expect(g.shop.whyNot('weapon:fusil')).toMatch(/puntos/);
  });

  it('reset vuelve a los desbloqueos iniciales', () => {
    g.shop.buy = g.shop.buy.bind(g.shop);
    g.shop.open = 'almacen';
    g.shop.buy('unlock:mina:0');
    g.shop.reset();
    expect(g.shop.isUnlocked('mina', 0)).toBe(false);
  });
});
