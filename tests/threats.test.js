import { describe, it, expect } from 'vitest';
import { edgePosition, computeLayout, hurtWeights } from '../src/ui/ThreatIndicators.js';
import config from '../src/data/config.json';

const mkL = () => computeLayout(800, 400, config.threats.layout.touch, { top: 0, right: 0, bottom: 0, left: 0 }, 0, {});
const out = () => ({ x: 0, y: 0, angle: 0 });

describe('Indicadores de amenaza: posición en el borde', () => {
  it('a la derecha, en el centro: pegada al borde derecho a media altura (dentro de su rango)', () => {
    const L = mkL();
    const o = edgePosition(2, 0, false, L, out());
    expect(o.x).toBeCloseTo(L.right);
    expect(o.y).toBeCloseTo(Math.min(200, L.rightMaxY));
    expect(o.angle).toBeCloseTo(0);
  });
  it('arriba (NDC y positivo): borde superior y ángulo hacia arriba', () => {
    const L = mkL();
    const o = edgePosition(0, 3, false, L, out());
    expect(o.y).toBeCloseTo(L.top);
    expect(o.x).toBeCloseTo(400);
    expect(o.angle).toBeCloseTo(-Math.PI / 2);
  });
  it('abajo: borde inferior y x limitada para no tapar la esquina del joystick', () => {
    const L = mkL();
    const o = edgePosition(-0.9, -3, false, L, out());
    expect(o.y).toBeCloseTo(L.bottom);
    expect(o.x).toBeGreaterThanOrEqual(L.bottomMinX - 1e-6);
    const c = edgePosition(0, -2, false, L, out());
    expect(c.x).toBeCloseTo(400);
    expect(c.angle).toBeCloseTo(Math.PI / 2);
  });
  it('en los lados no baja de la altura máxima (evita botones) ni sube de la franja del HUD', () => {
    const L = mkL();
    const low = edgePosition(5, -1, false, L, out());
    expect(low.x).toBeCloseTo(L.right);
    expect(low.y).toBeLessThanOrEqual(L.rightMaxY + 1e-6);
    const hi = edgePosition(5, 0.9, false, L, out());
    expect(hi.y).toBeGreaterThanOrEqual(L.rightMinY - 1e-6);
    const left = edgePosition(-5, 0.0, false, L, out());
    expect(left.x).toBeCloseTo(L.left);
    expect(left.y).toBeGreaterThanOrEqual(L.leftMinY - 1e-6);
  });
  it('la posición siempre queda dentro del rectángulo interior', () => {
    const L = mkL();
    const o = out();
    for (let a = 0; a < 360; a += 7) {
      for (const r of [1.1, 2, 8]) {
        edgePosition(Math.cos((a * Math.PI) / 180) * r, Math.sin((a * Math.PI) / 180) * r, false, L, o);
        expect(o.x).toBeGreaterThanOrEqual(L.left - 1e-6);
        expect(o.x).toBeLessThanOrEqual(L.right + 1e-6);
        expect(o.y).toBeGreaterThanOrEqual(Math.min(L.top, L.rightMinY) - 1e-6);
        expect(o.y).toBeLessThanOrEqual(L.bottom + 1e-6);
      }
    }
  });
  it('en el borde superior no invade la esquina de los botones de construir', () => {
    const L = mkL();
    const o = edgePosition(-0.95, 5, false, L, out());
    expect(o.y).toBeCloseTo(L.top);
    expect(o.x).toBeGreaterThanOrEqual(config.threats.layout.touch.topMinX - 1e-6);
  });
  it('detrás de la cámara se invierte la dirección', () => {
    const L = mkL();
    const o = edgePosition(2, 0, true, L, out());
    expect(o.x).toBeCloseTo(L.left);
    expect(Math.abs(o.angle)).toBeCloseTo(Math.PI);
  });
  it('respeta los márgenes seguros del dispositivo', () => {
    const L = computeLayout(800, 400, config.threats.layout.touch, { top: 20, right: 30, bottom: 10, left: 40 }, 0, {});
    expect(L.left).toBe(40 + config.threats.layout.margin);
    expect(L.right).toBe(800 - 30 - config.threats.layout.margin);
    expect(L.top).toBe(20 + config.threats.layout.touch.top);
    const extra = computeLayout(800, 400, config.threats.layout.touch, { top: 0, right: 0, bottom: 0, left: 0 }, 34, {});
    expect(extra.top).toBe(config.threats.layout.touch.top + 34);
  });
  it('en escritorio deja libre el panel de estado (izquierda) y el de arma (derecha abajo)', () => {
    const L = computeLayout(1280, 720, config.threats.layout.desktop, { top: 0, right: 0, bottom: 0, left: 0 }, 0, {});
    expect(edgePosition(-5, 0.5, false, L, out()).y).toBeGreaterThanOrEqual(430);
    expect(edgePosition(5, -0.9, false, L, out()).y).toBeLessThanOrEqual(720 - 200 + 1e-6);
  });
});

describe('Destello de daño direccional', () => {
  it('reparte el peso por lado según la dirección', () => {
    const w = new Float32Array(4);
    hurtWeights(1, 0, w);
    expect([...w]).toEqual([0, 1, 0, 0]);
    hurtWeights(0, -5, w);
    expect([...w]).toEqual([1, 0, 0, 0]);
    hurtWeights(-1, 1, w);
    expect([...w]).toEqual([0, 0, 1, 1]);
  });
});
