// Acumulador de paso fijo: la lógica avanza siempre en pasos de `step` segundos,
// independientemente de los FPS. Separado del requestAnimationFrame para poder testearlo.
export class FixedStepLoop {
  constructor({ step, maxSubSteps }) {
    this.step = step;
    this.maxSubSteps = maxSubSteps;
    this.accumulator = 0;
  }

  /**
   * @param {number} frameDt segundos reales desde el último frame
   * @param {(dt:number)=>void} update
   * @returns {number} alpha de interpolación [0,1) para el render
   */
  advance(frameDt, update) {
    // Tras una pestaña en segundo plano frameDt puede ser enorme: lo limitamos.
    this.accumulator += Math.min(frameDt, this.step * this.maxSubSteps);
    let steps = 0;
    while (this.accumulator >= this.step - 1e-9 && steps < this.maxSubSteps) {
      update(this.step);
      this.accumulator -= this.step;
      steps++;
    }
    if (steps === this.maxSubSteps) this.accumulator = Math.min(this.accumulator, this.step);
    return Math.max(0, this.accumulator / this.step);
  }
}
