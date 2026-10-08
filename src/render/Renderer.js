import * as THREE from 'three';

// Envoltorio del WebGLRenderer + escena + luces base. La iluminación día/noche
// completa vivirá en su propio sistema; aquí solo está lo mínimo.
export class Renderer {
  constructor(canvas, qualityPreset) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xbfd3e0);
    this.scene.fog = new THREE.Fog(0xbfd3e0, 45, 120);

    this.hemi = new THREE.HemisphereLight(0xeef3ff, 0x6b6250, 1.5);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
    this.sun.position.set(-20, 40, 15);
    this.sun.castShadow = true;
    const s = this.sun.shadow;
    s.camera.left = -30; s.camera.right = 30; s.camera.top = 30; s.camera.bottom = -30;
    s.camera.near = 1; s.camera.far = 120;
    s.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);

    this.applyQuality(qualityPreset);
  }

  applyQuality(preset) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.pixelRatio));
    this.renderer.shadowMap.enabled = preset.shadows;
    this.sun.castShadow = preset.shadows;
    this.sun.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }

  /** La sombra del sol sigue al foco de la cámara para cubrir siempre la zona visible. */
  followFocus(focus) {
    this.sun.target.position.copy(focus);
    this.sun.position.set(focus.x - 20, 40, focus.z + 15);
  }

  resize(w, h) {
    this.renderer.setSize(w, h, false);
  }

  render(camera) {
    this.renderer.render(this.scene, camera);
  }
}
