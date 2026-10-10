import { describe, it, expect } from 'vitest';
import { stickVector } from '../src/input/TouchControls.js';
import { deadzone } from '../src/input/GamepadInput.js';

describe('Joystick táctil', () => {
  it('dentro de la zona muerta no mueve', () => {
    expect(stickVector(3, 0, 60, 0.15)).toEqual({ x: 0, y: 0, mag: 0 });
  });
  it('la longitud se limita a 1 y conserva la dirección', () => {
    const v = stickVector(120, 0, 60, 0.15);
    expect(v.mag).toBe(1);
    expect(v.x).toBeCloseTo(1);
    const w = stickVector(30, 40, 100, 0.15);
    expect(w.mag).toBeCloseTo(0.5);
    expect(w.x / w.y).toBeCloseTo(30 / 40);
  });
});

describe('Mando', () => {
  it('zona muerta re-escalada', () => {
    expect(deadzone(0.1, 0.2)).toBe(0);
    expect(deadzone(1, 0.2)).toBe(1);
    expect(deadzone(-0.6, 0.2)).toBeCloseTo(-0.5);
  });
});
