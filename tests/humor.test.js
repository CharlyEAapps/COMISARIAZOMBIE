import { describe, it, expect } from 'vitest';
import humor from '../src/data/humor.json';
import zombies from '../src/data/zombies.json';
import { Bag } from '../src/systems/Humor.js';

describe('Humor', () => {
  it('la bolsa no repite hasta agotar la lista', () => {
    const list = ['a', 'b', 'c', 'd'];
    const bag = new Bag(list);
    const seen = new Set();
    for (let k = 0; k < list.length; k++) seen.add(bag.next());
    expect(seen.size).toBe(list.length);
    expect(list).toContain(bag.next());
  });

  it('una lista vacía devuelve cadena vacía', () => {
    expect(new Bag([]).next()).toBe('');
  });

  it('todos los tipos de zombi tienen frases al caer', () => {
    for (const t of Object.keys(zombies).filter((k) => !k.startsWith('_'))) {
      expect(humor.quips[t]?.length, t).toBeGreaterThan(0);
    }
  });

  it('las listas de textos no están vacías y los partes usan {kills}', () => {
    for (const k of ['night', 'day']) expect(humor.radio[k].length).toBeGreaterThan(3);
    for (const k of ['dayBanner', 'dawn', 'death', 'bossNames']) expect(humor[k].length).toBeGreaterThan(2);
    for (const list of Object.values(humor.events)) expect(list.length).toBeGreaterThan(0);
    expect(humor.dawn.some((s) => s.includes('{kills}'))).toBe(true);
  });
});
