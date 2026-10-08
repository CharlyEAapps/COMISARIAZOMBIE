import { describe, it, expect, vi } from 'vitest';
import { FixedStepLoop } from '../src/core/FixedStepLoop.js';
import { EventBus } from '../src/core/EventBus.js';

describe('FixedStepLoop', () => {
  const cfg = { step: 1 / 60, maxSubSteps: 5 };

  it('ejecuta tantos pasos como caben en el tiempo acumulado', () => {
    const loop = new FixedStepLoop(cfg);
    const update = vi.fn();
    loop.advance(3 / 60 + 0.001, update);
    expect(update).toHaveBeenCalledTimes(3);
  });

  it('acumula frames cortos hasta completar un paso', () => {
    const loop = new FixedStepLoop(cfg);
    const update = vi.fn();
    loop.advance(1 / 120, update);
    expect(update).toHaveBeenCalledTimes(0);
    loop.advance(1 / 120 + 1e-6, update);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('limita los pasos tras un parón largo (espiral de la muerte)', () => {
    const loop = new FixedStepLoop(cfg);
    const update = vi.fn();
    loop.advance(10, update);
    expect(update).toHaveBeenCalledTimes(5);
    expect(loop.accumulator).toBeLessThanOrEqual(cfg.step);
  });

  it('devuelve un alpha de interpolación en [0,1)', () => {
    const loop = new FixedStepLoop(cfg);
    const alpha = loop.advance(1.5 / 60, () => {});
    expect(alpha).toBeGreaterThanOrEqual(0);
    expect(alpha).toBeLessThan(1);
  });
});

describe('EventBus', () => {
  it('emite a los suscriptores y permite desuscribirse', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    const off = bus.on('x', fn);
    bus.emit('x', 1);
    off();
    bus.emit('x', 2);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(1);
  });
});
