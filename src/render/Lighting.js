import * as THREE from 'three';
import dn from '../data/daynight.json';
import buildData from '../data/build.json';

// Iluminación día/noche. Número de luces FIJO (cambiarlo recompila todos los shaders):
// hemisférica + sol/luna (Renderer) + linterna + N luces de farola reasignadas a las más
// cercanas + 1 luz de alarma. El resto de farolas y lámparas son "charcos de luz" aditivos
// en el suelo (sin coste de iluminación).

function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const PAL = {};
for (const [k, p] of Object.entries(dn.palettes)) {
  PAL[k] = {
    background: new THREE.Color(p.background), hemiSky: new THREE.Color(p.hemiSky),
    hemiGround: new THREE.Color(p.hemiGround), sun: new THREE.Color(p.sun),
    hemiIntensity: p.hemiIntensity, sunIntensity: p.sunIntensity,
    fogNear: p.fogNear, fogFar: p.fogFar, exposure: p.exposure,
  };
}

export class Lighting {
  constructor(game) {
    this.game = game;
    this.cfg = dn.lights;
    const { scene } = game;
    this.r = game.renderer;
    this.nightFactor = 0;
    this.alarmTimer = 0;

    // Linterna del policía.
    const L = this.cfg;
    this.flashlight = new THREE.SpotLight(0xfff2d8, 0, L.flashlightDistance, THREE.MathUtils.degToRad(L.flashlightAngleDeg), L.flashlightPenumbra, 1.2);
    this.flashlight.shadow.mapSize.set(512, 512);
    this.flashlight.shadow.camera.near = 0.3;
    this.flashlight.shadow.bias = -0.002;
    scene.add(this.flashlight, this.flashlight.target);

    // Luces reales de farola (pocas) que se asignan a las farolas más cercanas.
    this.lampLights = [];
    for (let i = 0; i < L.lampPointLights; i++) {
      const pl = new THREE.PointLight(0xffd49a, 0, L.lampPointDistance, 1.5);
      scene.add(pl);
      this.lampLights.push(pl);
    }
    this.assignTimer = 0;
    this._sorted = []; // reutilizado al ordenar farolas por distancia

    // Focos construidos: unas pocas luces reales (las de los más cercanos al jugador) y un
    // charco de luz por foco.
    this.focoLights = [];
    for (let i = 0; i < L.focoPointLights; i++) {
      const pl = new THREE.PointLight(0xfff4e0, 0, L.focoPointDistance, 1.4);
      scene.add(pl);
      this.focoLights.push(pl);
    }
    this._focoVersion = -1;
    this._focoDrawn = [];
    this._focoSorted = [];

    // Luz roja de alarma.
    this.alarmLight = new THREE.PointLight(0xff2a2a, 0, 40, 1.2);
    scene.add(this.alarmLight);

    this.poolTexture = radialTexture();
    this.lampPools = null;
    this.interiorPools = null;
    this.anchors = [];
    this.setAnchors(game.grid.lights.map(({ i, j }) => ({ type: 'farola', x: game.grid.centerX(i), y: 4.3, z: game.grid.centerZ(j) })));

    this._c = new THREE.Color();
    this._v = new THREE.Vector3();
  }

  /** Reconstruye los charcos de luz a partir de los anchors (farolas del mapa o de PropRenderer). */
  setAnchors(anchors) {
    const { scene } = this.game;
    for (const m of [this.lampPools, this.interiorPools]) {
      if (m) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
    }
    this.anchors = anchors;
    this.lamps = anchors.filter((a) => a.type === 'farola');
    this.interior = anchors.filter((a) => a.type === 'lampara');
    this.lampPools = this.makePools(this.lamps, this.cfg.lampPoolRadius, 0xffcf8a);
    this.interiorPools = this.makePools(this.interior, this.cfg.interiorPoolRadius, 0xfff3d6);
    if (!this.focoPools) {
      this.focoPools = this.makePools(new Array(buildData.pieces.foco.maxCount).fill(null), this.cfg.focoPoolRadius, 0xfff6e2);
      this.focoPools.count = 0;
    }
  }

  /** Coloca los charcos de los focos construidos (solo cuando cambian las construcciones). */
  syncFocos() {
    const build = this.game.build;
    if (!build || build.version === this._focoVersion) return;
    this._focoVersion = build.version;
    const m = new THREE.Matrix4();
    const R = this.cfg.focoPoolRadius;
    const list = build.lights;
    const max = this.focoPools.instanceMatrix.count;
    // Los charcos son aditivos: si dos focos están muy juntos, se dibuja solo uno (si no,
    // la suma quema la imagen).
    const minD2 = (R * this.cfg.focoPoolSpacing) ** 2;
    let n = 0;
    for (const f of list) {
      if (n >= max) break;
      let near = false;
      for (let q = 0; q < n; q++) {
        const o = list[this._focoDrawn[q]];
        if ((o.cx - f.cx) ** 2 + (o.cz - f.cz) ** 2 < minD2) { near = true; break; }
      }
      if (near) continue;
      this._focoDrawn[n] = list.indexOf(f);
      m.makeScale(R * 2, 1, R * 2);
      m.setPosition(f.cx, 0.045, f.cz);
      this.focoPools.setMatrixAt(n++, m);
    }
    this.focoPools.count = n;
    this.focoPools.instanceMatrix.needsUpdate = true;
    this.assignTimer = 0; // reasignar las luces reales ya
  }

  makePools(list, radius, color) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: this.poolTexture, color, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    mesh.count = list.length;
    const m = new THREE.Matrix4();
    list.forEach((a, k) => {
      if (!a) return;
      m.makeScale(radius * 2, 1, radius * 2);
      m.setPosition(a.x, 0.04, a.z);
      mesh.setMatrixAt(k, m);
    });
    mesh.renderOrder = 2;
    mesh.frustumCulled = false;
    this.game.scene.add(mesh);
    return mesh;
  }

  /** Activa/desactiva sombras de la linterna según la calidad. */
  applyQuality(preset) {
    this.flashlight.castShadow = preset.shadows;
  }

  triggerAlarm(seconds) {
    this.alarmTimer = seconds;
  }

  /** Temporizadores de juego (paso fijo): misma fuente de verdad que la ralentización de zombis. */
  updateLogic(dt) {
    if (this.alarmTimer > 0) this.alarmTimer = Math.max(0, this.alarmTimer - dt);
  }

  dispose() {
    const { scene } = this.game;
    for (const m of [this.lampPools, this.interiorPools, this.focoPools]) {
      if (m) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
    }
    this.poolTexture.dispose();
    this.flashlight.dispose();
    for (const l of [...this.lampLights, ...this.focoLights, this.alarmLight]) { scene.remove(l); l.dispose(); }
  }

  update(dt) {
    const { game, r, cfg } = this;
    const dnSys = game.dayNight;
    const blend = dnSys.paletteBlend();
    const a = PAL[blend.from], b = PAL[blend.to], t = blend.t;
    const night = this.nightFactor = dnSys.nightFactor();

    // Paleta del cielo, niebla, luz ambiente y sol/luna.
    const scene = r.scene;
    scene.background.copy(a.background).lerp(b.background, t);
    scene.fog.color.copy(scene.background);
    scene.fog.near = a.fogNear + (b.fogNear - a.fogNear) * t;
    scene.fog.far = a.fogFar + (b.fogFar - a.fogFar) * t;
    r.hemi.color.copy(a.hemiSky).lerp(b.hemiSky, t);
    r.hemi.groundColor.copy(a.hemiGround).lerp(b.hemiGround, t);
    r.hemi.intensity = a.hemiIntensity + (b.hemiIntensity - a.hemiIntensity) * t;
    r.sun.color.copy(a.sun).lerp(b.sun, t);
    r.sun.intensity = a.sunIntensity + (b.sunIntensity - a.sunIntensity) * t;
    r.renderer.toneMappingExposure = a.exposure + (b.exposure - a.exposure) * t;
    // El sol recorre el cielo durante el día (sombras que giran); de noche, luna fija.
    r.sunAngle = dnSys.phase === 'dia' ? -0.9 + dnSys.progress * 1.8 : dnSys.phase === 'atardecer' ? 0.9 + dnSys.progress * 0.4 : 0.3;

    // Alarma: parpadeo rojo y ambiente teñido (tiempo de juego: se congela en pausa).
    if (this.alarmTimer > 0) {
      const pulse = 0.5 + 0.5 * Math.sin(game.time * Math.PI * 2 * cfg.alarmPulseHz);
      this.alarmLight.intensity = cfg.alarmLightIntensity * pulse;
      r.hemi.color.lerp(this._c.set(0xff3030), cfg.alarmTint * pulse);
      r.hemi.intensity += cfg.alarmHemiBoost * pulse;
    } else {
      this.alarmLight.intensity = 0;
    }

    // Linterna: sigue la dirección de apuntado del jugador.
    const p = game.player;
    const fl = this.flashlight;
    const dir = p.aimDir;
    const [curveA, curveB] = cfg.flashlightNightCurve;
    fl.intensity = p.alive ? cfg.flashlightIntensity * Math.max(0, night * curveA - curveB) : 0;
    // Sin luz no hace falta el pase de sombra (WebGLShadowMap no mira la intensidad). Pero el
    // mapa de sombras debe existir: si nunca se ha renderizado, los shaders muestrean una
    // textura de tipo incorrecto y WebGL descarta todos los draws que reciben sombra.
    fl.shadow.autoUpdate = fl.intensity > 0 || !fl.shadow.map;
    fl.position.set(p.position.x + dir.x * 0.9, 1.55, p.position.z + dir.z * 0.9);
    fl.target.position.set(p.position.x + dir.x * 9, 0, p.position.z + dir.z * 9);
    this.alarmLight.position.set(p.position.x, 6, p.position.z);

    // Charcos de luz de farolas e interiores.
    this.lampPools.material.opacity = cfg.lampPoolOpacity * night;
    this.lampPools.visible = night > 0.01;
    const interiorOn = game.power?.lightsOn && game.power?.generator;
    this.interiorPools.material.opacity = interiorOn ? cfg.interiorPoolOpacity * Math.max(cfg.interiorMinFactor, night) : 0;
    this.interiorPools.visible = !!interiorOn;
    if (interiorOn) {
      // Interior iluminado: algo más de luz ambiente.
      r.hemi.intensity += cfg.interiorHemiBoost * night;
    }

    // Reasignación periódica de las luces reales a las farolas más cercanas.
    this.assignTimer -= dt;
    if (this.assignTimer <= 0) {
      this.assignTimer = cfg.lampAssignInterval;
      const px = p.position.x, pz = p.position.z;
      const sorted = this._sorted;
      sorted.length = 0;
      for (const l of this.lamps) { l._d = (l.x - px) ** 2 + (l.z - pz) ** 2; sorted.push(l); }
      sorted.sort((x, y) => x._d - y._d);
      const maxD2 = cfg.lampMaxDistance * cfg.lampMaxDistance;
      for (let k = 0; k < this.lampLights.length; k++) {
        const pl = this.lampLights[k], l = sorted[k];
        if (l) pl.position.set(l.x, l.y - 0.3, l.z);
        pl.userData.active = !!l && l._d < maxD2;
      }
      const focos = this._focoSorted;
      focos.length = 0;
      for (const f of game.build?.lights ?? []) { f._d = (f.cx - px) ** 2 + (f.cz - pz) ** 2; focos.push(f); }
      focos.sort((x, y) => x._d - y._d);
      for (let k = 0; k < this.focoLights.length; k++) {
        const pl = this.focoLights[k], f = focos[k];
        if (f) pl.position.set(f.cx, cfg.focoHeight, f.cz);
        pl.userData.active = !!f && f._d < maxD2;
      }
    }
    for (const pl of this.lampLights) pl.intensity = pl.userData.active ? cfg.lampPointIntensity * night : 0;
    // Focos: se encienden al caer la noche (y algo al atardecer).
    this.syncFocos();
    const focoOn = Math.max(0, (night - cfg.focoMinNight) / (1 - cfg.focoMinNight));
    for (const pl of this.focoLights) pl.intensity = pl.userData.active ? cfg.focoPointIntensity * focoOn : 0;
    this.focoPools.material.opacity = cfg.focoPoolOpacity * focoOn;
    this.focoPools.visible = focoOn > 0.01 && this.focoPools.count > 0;
    this.focoGlow = focoOn;

    // Props: sirenas de los coches (atardecer, señuelo o alarma) y brillo de pantallas y lámparas.
    const props = game.props;
    if (props) {
      const sirens = game.zombies.decoy.timer > 0 || this.alarmTimer > 0 || dnSys.phase === 'atardecer';
      props.setSirens(sirens, game.time * cfg.sirenHz / 4);
      props.setGlow(night > 0.5 ? (interiorOn ? cfg.glowNightLit : cfg.glowNightDark) : cfg.glowDay);
    }

    // Ojos de los zombis: brillan de noche.
    const eyes = game.zombies.eyeMaterial;
    if (eyes) eyes.opacity = cfg.zombieEyesDay + (cfg.zombieEyesNight - cfg.zombieEyesDay) * night;
  }
}
