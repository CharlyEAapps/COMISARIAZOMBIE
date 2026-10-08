import * as THREE from 'three';
import playerData from '../data/player.json';
import interactions from '../data/interactions.json';

const MEDKIT = interactions._medkit;
import { buildPolice, computePose, makePose, PART_NAMES } from '../render/BlockyCharacter.js';
import { resolveCircleVsGrid } from '../systems/Physics.js';

export class Player {
  constructor(game) {
    this.game = game;
    this.data = playerData;
    this.radius = playerData.radius;
    const { root, parts, muzzle } = buildPolice();
    this.mesh = root;
    this.parts = parts;
    this.muzzle = muzzle;
    this.pose = makePose();
    game.scene.add(root);

    this.position = root.position; // x,z lógicos; y=0
    this.facing = 0;               // ángulo en Y (0 = mirando a +Z)
    this.aimDir = new THREE.Vector3(0, 0, 1);
    this.velocity = new THREE.Vector3();
    this.walkPhase = 0;
    this.reset();
  }

  reset() {
    const { grid } = this.game;
    const s = grid.playerStart;
    this.position.set(grid.centerX(s.i), 0, grid.centerZ(s.j));
    this.hp = this.data.maxHp;
    this.maxHp = this.data.maxHp;
    this.stamina = this.data.maxStamina;
    this.staminaDelay = 0;
    this.sprintLocked = false;
    this.hurtTimer = 0;
    this.medkits = 1;
    this.medkitTimer = 0;
    this.buffs = {}; // nombre → { value, timer }
    this.alive = true;
    this.mesh.rotation.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
  }

  heal(amount) {
    if (!this.alive) return;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    if (this.hp > before) this.game.floating?.spawn(`+${Math.round(this.hp - before)}`, this.position.x, 2.1, this.position.z, 'heal');
  }

  addBuff(name, value, seconds) {
    this.buffs[name] = { value, timer: seconds };
  }

  buff(name, fallback = 1) {
    const b = this.buffs[name];
    return b && b.timer > 0 ? b.value : fallback;
  }

  damage(amount) {
    if (!this.alive || this.game.debug.flags.godMode) return;
    this.hp = Math.max(0, this.hp - amount);
    this.hurtTimer = this.data.hurtFlashTime;
    this.game.bus.emit('player:hurt', { amount, hp: this.hp });
    this.game.effects.shake(this.data.hurtShake);
    if (this.hp <= 0) {
      this.alive = false;
      this.game.bus.emit('player:died');
    }
  }

  update(dt) {
    const { input } = this.game;
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    if (!this.alive) {
      // Caída hacia atrás al morir.
      this.mesh.rotation.x = Math.max(-Math.PI / 2, this.mesh.rotation.x - dt * 4);
      return;
    }

    for (const k in this.buffs) this.buffs[k].timer -= dt;

    // Botiquín (Q): curación tras un breve uso; se puede caminar mientras.
    if (this.medkitTimer > 0) {
      this.medkitTimer -= dt;
      // Si mientras tanto se ha llenado la vida (fuente, vending…), no se gasta.
      if (this.medkitTimer <= 0 && this.hp < this.maxHp) {
        this.medkits--;
        this.heal(MEDKIT.heal);
      }
    } else if (input.consume('medkit')) {
      if (this.medkits > 0 && this.hp < this.maxHp) this.medkitTimer = MEDKIT.useTime;
    }

    const moving = input.move.x !== 0 || input.move.y !== 0;
    // Al agotarse, no se puede volver a esprintar hasta recuperar un mínimo (evita parpadeos).
    if (this.stamina <= 0) this.sprintLocked = true;
    else if (this.stamina >= this.data.sprintMinStamina) this.sprintLocked = false;
    const wantsSprint = input.isHeld('sprint') && moving && !this.sprintLocked;
    const speed = (wantsSprint ? this.data.sprintSpeed : this.data.speed) *
      (this.medkitTimer > 0 ? MEDKIT.moveMul : 1) * this.buff('speed');
    this.velocity.set(input.move.x * speed, 0, input.move.y * speed);
    const x0 = this.position.x, z0 = this.position.z;
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    resolveCircleVsGrid(this.position, this.radius, this.game.grid);
    // Solo gasta resistencia si realmente avanza (no al empujar contra un muro).
    const moved = Math.hypot(this.position.x - x0, this.position.z - z0);
    if (wantsSprint && moved > speed * dt * 0.3) {
      this.stamina = Math.max(0, this.stamina - this.data.staminaDrain * dt);
      this.staminaDelay = this.data.staminaRegenDelay;
    } else if (this.staminaDelay > 0) {
      this.staminaDelay -= dt;
    } else {
      this.stamina = Math.min(this.data.maxStamina, this.stamina + this.data.staminaRegen * this.buff('staminaRegen') * dt);
    }

    // Orientación hacia el punto de apuntado.
    const aim = this.game.aimPoint;
    const dx = aim.x - this.position.x, dz = aim.z - this.position.z;
    if (dx * dx + dz * dz > 0.04) {
      this.facing = Math.atan2(dx, dz);
      this.aimDir.set(dx, 0, dz).normalize();
    }
    if (moving) this.walkPhase += dt * speed * 2.2;
  }

  /** Animación y aspecto; se llama una vez por frame de render. */
  render() {
    this.mesh.rotation.y = this.facing;
    const moving = this.velocity.lengthSq() > 0.01;
    computePose(this.pose, this.walkPhase, moving ? 1 : 0, 'police');
    // Las piernas se balancean respecto a la dirección de marcha, no de la mirada:
    // basta con el balanceo simple para el blockout.
    for (const n of PART_NAMES) {
      this.parts[n].rotation.x = this.pose[n].x;
      this.parts[n].rotation.z = this.pose[n].z;
    }
  }

  getMuzzleWorld(out) {
    this.mesh.updateMatrixWorld(true);
    return this.muzzle.getWorldPosition(out);
  }
}
