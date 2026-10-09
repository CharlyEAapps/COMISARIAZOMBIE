import * as THREE from 'three';
import config from '../data/config.json';
import zombieData from '../data/zombies.json';
import { withInstanceAlpha, instanceAttr, hex } from './Effects.js';

// Calcomanías de suelo (manchas oscuras donde cae un zombi, marcas de quemado de las
// explosiones): un único InstancedMesh de discos planos con polygonOffset y un atlas de dos
// baldosas generado por código (mancha irregular | chamusquina). Se desvanecen con la edad.
const D = config.fx.decals;
const TILE_STAIN = 0, TILE_SCORCH = 1;

/** Alfa de una calcomanía: llena al principio y se desvanece en la última fracción de su vida. */
export function decalAlpha(age, life, fadeFraction, maxAlpha) {
  if (age >= life) return 0;
  const fadeStart = life * (1 - fadeFraction);
  if (age <= fadeStart) return maxAlpha;
  const k = (age - fadeStart) / (life - fadeStart);
  return maxAlpha * (1 - k * k);
}

/** Crecimiento de la mancha en los primeros instantes (0.35 → 1). */
export function decalGrow(age, growTime = D.growTime) {
  const k = Math.min(1, age / growTime);
  return D.growFrom + (1 - D.growFrom) * (1 - (1 - k) * (1 - k));
}

/** Atlas de dos baldosas (solo canal alfa significativo; el color lo pone cada instancia). */
function makeAtlas(size) {
  const cv = document.createElement('canvas');
  cv.width = size * 2; cv.height = size;
  const ctx = cv.getContext('2d');
  const rnd = (() => { let s = 1234567; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  // Baldosa 0: mancha irregular con salpicaduras.
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.fillStyle = '#fff';
  const bumps = D.blobBumps, p1 = rnd() * 6, p2 = rnd() * 6;
  ctx.filter = `blur(${Math.max(1, size / 40)}px)`;
  ctx.beginPath();
  const N = 48;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = size * 0.3 * (1 + 0.13 * Math.sin(a * bumps + p1) + 0.07 * Math.sin(a * bumps * 2.3 + p2));
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.fill();
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2, d = size * (0.34 + rnd() * 0.12), r = size * (0.012 + rnd() * 0.03);
    ctx.beginPath(); ctx.arc(Math.cos(a) * d, Math.sin(a) * d, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  // Baldosa 1: chamusquina, centro denso y bordes deshilachados.
  ctx.save();
  ctx.translate(size * 1.5, size / 2);
  ctx.filter = `blur(${Math.max(1, size / 32)}px)`;
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.46);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.82, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, size * 0.46, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + rnd() * 0.3, r0 = size * 0.2, r1 = size * (0.34 + rnd() * 0.14);
    ctx.lineWidth = size * (0.015 + rnd() * 0.03);
    ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); ctx.stroke();
  }
  ctx.restore();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export class Decals {
  constructor(game) {
    this.game = game;
    const max = this.max = D.max;
    this.list = Array.from({ length: max }, () => ({ life: 0, age: 0, x: 0, y: 0, z: 0, yaw: 0, sx: 1, sz: 1, alpha: 1, fade: 0.5, tile: 0, color: new THREE.Color() }));
    this._idx = 0;
    this._serial = 0;
    this.texture = makeAtlas(D.textureSize);
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.alphaAttr = instanceAttr(geo, 'instanceAlpha', max);
    this.tileAttr = instanceAttr(geo, 'instanceTile', max);
    const mat = withInstanceAlpha(new THREE.MeshStandardMaterial({
      map: this.texture, color: 0xffffff, roughness: 1, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: D.polygonOffsetFactor, polygonOffsetUnits: D.polygonOffsetUnits,
    }), { tiles: 2 });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
    this.mesh.setColorAt(0, new THREE.Color());
    game.scene.add(this.mesh);

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();

    const bus = game.bus;
    this._unsub = [
      bus.on('zombie:killed', (e) => this.onKilled(e)),
      bus.on('explosion', ({ x, z, radius }) => this.scorch(x, z, radius)),
    ];
  }

  onKilled({ type, x, z, fallX = 0, fallZ = 0, selfDestruct }) {
    // Un explosivo que revienta deja la chamusquina de la explosión, no una mancha.
    if (selfDestruct) return;
    const scale = zombieData[type]?.scale ?? 1;
    const r = D.stainRadius * scale * (1 + (Math.random() - 0.5) * 2 * D.stainRadiusJitter);
    this.add(TILE_STAIN, x + fallX * D.stainOffset * scale, z + fallZ * D.stainOffset * scale, r, D.stainLife, D.stainFadeFraction, D.stainAlpha, hex(D.stainColor));
  }

  scorch(x, z, radius) {
    this.add(TILE_SCORCH, x, z, radius * D.scorchRadiusMul, D.scorchLife, D.scorchFadeFraction, D.scorchAlpha, hex(D.scorchColor));
  }

  /** Añade una calcomanía de radio `r` (sustituye a la más antigua si el pool está lleno). */
  add(tile, x, z, r, life, fade, alpha, color) {
    const d = this.list[this._idx];
    this._idx = (this._idx + 1) % this.max;
    d.life = life; d.age = 0; d.x = x; d.z = z;
    d.yaw = Math.random() * Math.PI * 2;
    const asp = D.stainAspect;
    const a = tile === TILE_STAIN ? asp[0] + Math.random() * (asp[1] - asp[0]) : 1;
    d.sx = r * 2 * a; d.sz = r * 2 / a;
    d.alpha = alpha; d.fade = fade; d.tile = tile;
    d.y = D.y + (this._serial++ % D.yCycle) * D.yStep;
    d.color.set(color);
  }

  update(dt) {
    const { _m, _q, _e, _v, _s } = this;
    const mesh = this.mesh, alpha = this.alphaAttr.array, tile = this.tileAttr.array;
    let count = 0;
    for (const d of this.list) {
      if (d.life <= 0) continue;
      d.age += dt;
      if (d.age >= d.life) { d.life = 0; continue; }
      const grow = d.tile === TILE_STAIN ? decalGrow(d.age) : 1;
      _e.set(0, d.yaw, 0);
      _q.setFromEuler(_e);
      _v.set(d.x, d.y, d.z);
      _s.set(d.sx * grow, 1, d.sz * grow);
      _m.compose(_v, _q, _s);
      mesh.setMatrixAt(count, _m);
      mesh.setColorAt(count, d.color);
      alpha[count] = decalAlpha(d.age, d.life, d.fade, d.alpha);
      tile[count] = d.tile;
      count++;
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.tileAttr.needsUpdate = true;
  }

  reset() {
    for (const d of this.list) d.life = 0;
    this.mesh.count = 0;
  }

  dispose() {
    for (const off of this._unsub) off();
    this._unsub.length = 0;
    this.game.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.texture.dispose();
    this.mesh.dispose();
  }
}
