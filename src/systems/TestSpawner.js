import zombieData from '../data/zombies.json';

// Generador provisional de la fase 1: aparición continua con ritmo creciente.
// En la fase 2 lo sustituye el director de oleadas del ciclo día/noche.
export class TestSpawner {
  constructor(game) {
    this.game = game;
    this.cfg = zombieData._testSpawner;
    this.reset();
  }

  reset() {
    this.elapsed = 0;
    this.timer = this.cfg.initialDelay;
  }

  update(dt) {
    const { cfg, game } = this;
    this.elapsed += dt;
    this.timer -= dt;
    if (this.timer > 0) return;
    const ramp = Math.min(1, this.elapsed / cfg.rampSeconds);
    this.timer = cfg.startInterval + (cfg.minInterval - cfg.startInterval) * ramp;
    if (game.zombies.aliveCount >= cfg.maxAlive) return;
    this.spawnAtRandomPoint('caminante');
  }

  spawnAtRandomPoint(type) {
    const { grid, zombies } = this.game;
    const s = grid.spawns[(Math.random() * grid.spawns.length) | 0];
    const jitter = () => (Math.random() - 0.5) * 0.6;
    return zombies.spawn(type, grid.centerX(s.i) + jitter(), grid.centerZ(s.j) + jitter());
  }
}
