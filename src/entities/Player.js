import * as THREE from 'three';
import playerData from '../data/player.json';
import interactions from '../data/interactions.json';

const MEDKIT = interactions._medkit;
const FXP = config.fx.player;
const RELOAD = FXP.reload;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
import config from '../data/config.json';
import { buildPolice, computePose, makePose, PART_NAMES, PARTS, WEAPON_MOUNT, armAnglesToward, weaponPointInChar, reloadPhases } from '../render/BlockyCharacter.js';
import { resolveCircleVsGrid } from '../systems/Physics.js';
import { weaponGeometry, WEAPON_SPECS, WEAPON_MATERIAL_OPTIONS } from '../render/WeaponModels.js';

// Hombros y mano derecha en espacio del personaje (para orientar el brazo izquierdo al arma).
const SHOULDER_L = new THREE.Vector3().fromArray(PARTS.armL.pivot);
// Con el brazo derecho estirado al frente (rot.x = -90°), el soporte del arma queda en:
const MOUNT_CHAR = new THREE.Vector3(PARTS.armR.pivot[0], PARTS.armR.pivot[1] + WEAPON_MOUNT.position.z, -WEAPON_MOUNT.position.y);

export class Player {
  constructor(game) {
    this.game = game;
    this.data = playerData;
    this.radius = playerData.radius;
    const { root, parts, mount, muzzle } = buildPolice();
    this.mesh = root;
    this.parts = parts;
    this.muzzle = muzzle;
    // Arma visible: una malla en la mano cuya geometría cambia con el arma equipada.
    this.weaponGeos = new Map();
    this.weaponMesh = new THREE.Mesh(undefined, new THREE.MeshStandardMaterial(WEAPON_MATERIAL_OPTIONS));
    this.weaponMesh.castShadow = true;
    mount.add(this.weaponMesh);
    this.leftArmAim = null; // { x, z } rotación del brazo izquierdo hacia el guardamanos
    this.setWeapon(playerData.startWeapon);
    game.bus.on('weapon:switched', ({ id }) => this.setWeapon(id));
    this.pose = makePose();
    game.scene.add(root);

    this.position = root.position; // x,z lógicos; y=0
    this.facing = 0;               // ángulo en Y (0 = mirando a +Z)
    this.aimDir = new THREE.Vector3(0, 0, 1);
    this.velocity = new THREE.Vector3();
    this.push = { x: 0, z: 0 }; // empuje recibido (golpes de tanques y jefes)
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
    this.staminaDrainMul = 1; // vestuarios reformados (despacho del jefe)
    this.sprintLocked = false;
    this.hurtTimer = 0;
    this.medkits = 1;
    this.armor = 0;        // chaleco antibalas
    this.armorMax = 0;
    this.armorAbsorb = 0;  // fracción del daño que absorbe
    this.medkitTimer = 0;
    this.buffs = {}; // nombre → { value, timer }
    this.alive = true;
    this.mesh.rotation.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.push.x = this.push.z = 0;
  }

  /** Empuja al jugador `distance` metros en la dirección (dx, dz) normalizada. */
  knockback(dx, dz, distance) {
    if (!this.alive || this.game.debug.flags.godMode) return;
    const v = distance * this.data.pushDecay;
    this.push.x += dx * v;
    this.push.z += dz * v;
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
    amount *= this.game.despacho?.damageTakenMul() ?? 1;
    // El chaleco absorbe parte del daño hasta agotarse.
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, amount * this.armorAbsorb);
      this.armor -= absorbed;
      amount -= absorbed;
      if (this.armor <= 0) this.game.hud?.toast('🦺 Tu chaleco está destrozado', 3);
    }
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
      if (this.medkits > 0 && this.hp < this.maxHp) {
        this.medkitTimer = MEDKIT.useTime;
        this.game.bus.emit('medkit:use');
      }
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
    // Movimiento en subpasos cortos: un empujón fuerte no atraviesa vallas ni rejas finas.
    const mx = (this.velocity.x + this.push.x) * dt, mz = (this.velocity.z + this.push.z) * dt;
    const sub = Math.max(1, Math.ceil(Math.hypot(mx, mz) / (this.radius * this.data.maxStepFraction)));
    for (let k = 0; k < sub; k++) {
      this.position.x += mx / sub;
      this.position.z += mz / sub;
      resolveCircleVsGrid(this.position, this.radius, this.game.grid);
    }
    const decay = Math.exp(-this.data.pushDecay * dt);
    this.push.x *= decay; this.push.z *= decay;
    // Solo gasta resistencia si realmente avanza (no al empujar contra un muro).
    const moved = Math.hypot(this.position.x - x0, this.position.z - z0);
    if (wantsSprint && moved > speed * dt * 0.3) {
      this.stamina = Math.max(0, this.stamina - this.data.staminaDrain * this.staminaDrainMul * dt);
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

  /** Cambia el arma que se ve en la mano y su punto de disparo. */
  setWeapon(id) {
    if (!this.weaponGeos.has(id)) this.weaponGeos.set(id, weaponGeometry(id));
    this.weaponMesh.geometry = this.weaponGeos.get(id);
    const spec = WEAPON_SPECS[id];
    this.muzzle.position.fromArray(spec.muzzle);
    this.weaponId = id;
    // Estado de la animación (respiración, recarga): se crea con la primera arma.
    if (!this._fx) {
      const mag = new THREE.Mesh(new THREE.BoxGeometry(...RELOAD.magSize), new THREE.MeshStandardMaterial({ color: Number(RELOAD.magColor), roughness: 0.6 }));
      mag.position.set(0, RELOAD.magHandY, 0.03);
      mag.castShadow = true;
      mag.visible = false;
      this.parts.armL.add(mag);
      this._fx = {
        mag, idle: 1, last: performance.now(), magZ: RELOAD.magwellZ,
        ph: { lower: 0, belt: 0, mag: 0, hasMag: false, bump: 0 },
        base: { x: 0, z: 0 }, tgt: { x: 0, z: 0 }, pt: new THREE.Vector3(),
      };
    }
    this._fx.magZ = spec.support ? spec.support[2] * 0.55 : RELOAD.magwellZ;
    // Armas de dos manos: el brazo izquierdo apunta al guardamanos (IK de un solo hueso:
    // con orden de Euler XYZ, la dirección del brazo (0,-1,0) gira primero en Z y luego en X).
    if (spec.support) {
      const t = MOUNT_CHAR.clone().add(new THREE.Vector3().fromArray(spec.support)).sub(SHOULDER_L).normalize();
      const z = Math.asin(THREE.MathUtils.clamp(t.x, -1, 1));
      this.leftArmAim = { x: Math.atan2(-t.z, -t.y), z };
    } else {
      // Pistola: sujeción a dos manos de siempre; táser y porra: brazo izquierdo relajado.
      this.leftArmAim = id === 'pistola' ? null : { x: 0, z: 0.08, relaxed: true };
    }
  }

  /** Animación y aspecto; se llama una vez por frame de render. */
  render() {
    const { game, pose, parts, data } = this;
    const fx = this._fx, ph = fx.ph;
    const W = game.weapons, t = game.time;
    this.mesh.rotation.y = this.facing;
    const speed = this.velocity.length();
    const moving = speed > 0.1;
    computePose(pose, this.walkPhase, moving ? 1 : 0, 'police');
    const relaxedLeft = !!this.leftArmAim?.relaxed;
    if (this.leftArmAim) {
      // Relajado: cuelga y se balancea al andar (como las piernas, en contrafase).
      pose.armL.x = relaxedLeft ? -pose.legL.x * 0.6 : this.leftArmAim.x;
      pose.armL.z = this.leftArmAim.z;
    }
    // Porra: golpe de arriba abajo mientras dura el ataque.
    if (this.weaponId === 'porra' && W?.meleeTimer > 0) {
      const p = W.defs.porra, sw = p.swing;
      const k = 1 - W.meleeTimer * p.fireRate; // 0 → 1 durante el golpe
      pose.armR.x = sw.raise + Math.min(1, k * sw.speed) * sw.sweep;
      pose.armR.z = sw.twistFrom + k * sw.twist;
    }

    // Capas de animación sobre la pose base (todas derivadas del estado del juego, así que
    // no hay nada que reiniciar al empezar de nuevo).
    const now = performance.now();
    const dtv = Math.min(0.1, (now - fx.last) / 1000);
    fx.last = now;
    fx.idle += ((moving ? 0 : 1) - fx.idle) * (1 - Math.exp(-8 * dtv));
    // Respiración en reposo: el pecho sube y baja, los brazos y la cabeza lo acompañan.
    const breath = Math.sin(t * FXP.breathSpeed) * fx.idle;
    pose.torso.x += breath * FXP.breathTorso;
    pose.armL.z += breath * FXP.breathArm;
    pose.armR.z -= breath * FXP.breathArm;
    pose.armR.x += Math.sin(t * FXP.breathSpeed * 0.8 + 1) * FXP.breathSway * fx.idle;
    parts.head.position.y = PARTS.head.pivot[1] + breath * FXP.breathHead;
    // Al esprintar se inclina hacia delante.
    const sprint = clamp01((speed / data.speed - 1) / (data.sprintSpeed / data.speed - 1));
    pose.torso.x += sprint * FXP.sprintLean;
    pose.head.x -= sprint * FXP.sprintLean * 0.7;
    // Retroceso del arma al disparar (el arma sube y el cuerpo se echa atrás).
    const rc = game.effects?.recoil ?? 0;
    if (rc > 0 && this.weaponId !== 'porra') {
      pose.armR.x -= rc * FXP.recoilArm;
      if (!relaxedLeft) pose.armL.x -= rc * FXP.recoilArm * 0.8;
      pose.torso.x -= rc * FXP.recoilTorso;
      pose.head.x += rc * FXP.recoilTorso * 0.5;
    }
    // Encogimiento al recibir daño.
    if (this.alive && this.hurtTimer > 0) {
      const k = this.hurtTimer / data.hurtFlashTime;
      pose.torso.x -= k * FXP.flinchTorso;
      pose.torso.z += Math.sin(t * 38) * k * FXP.flinchTorso * 0.4;
      pose.head.x -= k * FXP.flinchHead;
      pose.armR.x -= k * FXP.flinchArm;
      if (!relaxedLeft) pose.armL.x -= k * FXP.flinchArm;
    }
    // Recarga: el arma baja y se ladea, la mano izquierda va a la cartuchera, coge el cargador
    // y lo encaja; después se vuelve a la posición de tiro.
    const wp = W?.weapon;
    let cant = 0;
    ph.hasMag = false;
    if (this.alive && wp && wp.reloading > 0 && !wp.data.melee) {
      reloadPhases(ph, 1 - wp.reloading / (wp.reloadTotal || wp.stats.reloadTime));
      pose.armR.x += ph.lower * RELOAD.armDown + ph.bump * RELOAD.insertBump;
      pose.torso.x += ph.lower * RELOAD.torsoLean;
      pose.head.x += ph.lower * RELOAD.headDown;
      cant = ph.lower * RELOAD.cant;
      // Objetivo de la mano: el hueco del cargador del arma (ya girada con el brazo).
      weaponPointInChar(fx.pt, pose.armR.x, 0, RELOAD.magwellY, fx.magZ);
      armAnglesToward(fx.tgt, PARTS.armL.pivot[0], PARTS.armL.pivot[1], PARTS.armL.pivot[2], fx.pt.x, fx.pt.y, fx.pt.z);
      const wBase = 1 - ph.belt - ph.mag;
      pose.armL.x = pose.armL.x * wBase + RELOAD.beltX * ph.belt + fx.tgt.x * ph.mag;
      pose.armL.z = pose.armL.z * wBase + RELOAD.beltZ * ph.belt + fx.tgt.z * ph.mag;
    }
    this.weaponMesh.rotation.z = cant;
    fx.mag.visible = ph.hasMag;

    for (const n of PART_NAMES) {
      parts[n].rotation.x = pose[n].x;
      parts[n].rotation.z = pose[n].z;
    }
  }

  getMuzzleWorld(out) {
    this.mesh.updateMatrixWorld(true);
    return this.muzzle.getWorldPosition(out);
  }
}
