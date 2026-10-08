import * as THREE from 'three';

// Recorte de oclusión: los fragmentos que quedan entre la cámara y el jugador, dentro de
// un radio, se descartan con un tramado (dither). Funciona con InstancedMesh y no
// necesita transparencia real (sin problemas de orden de dibujado).
export const cutawayUniforms = {
  uCutTarget: { value: new THREE.Vector3() },
  uCutCam: { value: new THREE.Vector3() },
  uCutRadius: { value: 2.6 },
  uCutMinY: { value: 0.5 },
};

export function updateCutaway(cameraPos, targetPos) {
  cutawayUniforms.uCutCam.value.copy(cameraPos);
  cutawayUniforms.uCutTarget.value.copy(targetPos);
}

/** Aplica el recorte a un material estándar. */
export function withCutaway(material) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, cutawayUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCutWorld;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 cutW = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          cutW = instanceMatrix * cutW;
        #endif
        vCutWorld = (modelMatrix * cutW).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vCutWorld;
        uniform vec3 uCutTarget;
        uniform vec3 uCutCam;
        uniform float uCutRadius;
        uniform float uCutMinY;`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        {
          vec3 ab = uCutTarget - uCutCam;
          float t = dot(vCutWorld - uCutCam, ab) / dot(ab, ab);
          if (t < 0.985 && vCutWorld.y > uCutMinY) {
            vec3 closest = uCutCam + ab * clamp(t, 0.0, 1.0);
            float d = length(vCutWorld - closest);
            float fade = smoothstep(uCutRadius * 0.55, uCutRadius, d);
            // Tramado ordenado 4x4 (Bayer) para un recorte suave sin transparencia.
            ivec2 p = ivec2(mod(gl_FragCoord.xy, 4.0));
            int idx = p.x + p.y * 4;
            float bayer[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
            if (fade < (bayer[idx] + 0.5) / 16.0) discard;
          }
        }`,
      );
  };
  material.customProgramCacheKey = () => 'cutaway';
  return material;
}
