import * as THREE from 'three';
import { withCutaway } from './Cutaway.js';
import { buildProps } from './props/PropFactory.js';
import { createAtlasTexture } from './props/Atlas.js';
import { COLOR_LAYERS, UV_LAYERS } from './props/Builder.js';
import propsData from '../data/props.json';

/**
 * Funde cada capa del PropBuilder en una malla (una por material) y las añade a `target`.
 * @returns {{ meshes: Record<string, THREE.Mesh>, geometries: THREE.BufferGeometry[], triangles: number }}
 */
export function bakeBuilder(builder, mats, target) {
  const meshes = {}, geometries = [];
  let triangles = 0;
  for (const name of [...COLOR_LAYERS, ...UV_LAYERS]) {
    const geo = builder.toGeometry(name);
    if (!geo) continue;
    geometries.push(geo);
    const mesh = new THREE.Mesh(geo, mats[name]);
    mesh.name = `props-${name}`;
    mesh.castShadow = name !== 'glass';
    mesh.receiveShadow = name === 'solid' || name === 'sign';
    mesh.frustumCulled = false; // las mallas abarcan todo el mapa
    target.add(mesh);
    meshes[name] = mesh;
    triangles += geo.attributes.position.count / 3;
  }
  return { meshes, geometries, triangles };
}

/** Materiales de los props (todos con el recorte de oclusión). */
export function makePropMaterials(atlas) {
  const solid = withCutaway(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.0 }));
  const glow = withCutaway(new THREE.MeshBasicMaterial({ vertexColors: true }));
  const red = withCutaway(new THREE.MeshBasicMaterial({ vertexColors: true }));
  const blue = withCutaway(new THREE.MeshBasicMaterial({ vertexColors: true }));
  const glass = withCutaway(new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.15, metalness: 0.0, transparent: true, opacity: 0.3, depthWrite: false,
  }));
  const sign = withCutaway(new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.7, alphaTest: 0.4 }));
  const screen = withCutaway(new THREE.MeshBasicMaterial({ map: atlas, alphaTest: 0.4 }));
  return { solid, glow, red, blue, glass, sign, screen };
}

/** Tiles que dibuja PropRenderer (MapRenderer los omite con `skip`). */
export const PROP_TILES = ['o', 'c', 'k', 'L'];

/**
 * Mobiliario, vehículos y decoración del mapa, horneados en muy pocas mallas:
 *   solid (vertexColors) · glow (emisivo) · sirenas roja y azul · cristal · rótulos · pantallas.
 * Cada prop se construye con primitivas con color por vértice y se funde por capa; el coste
 * total es de 7 draw calls con todos los materiales con el recorte de oclusión (Cutaway).
 */
export class PropRenderer {
  /**
   * @param {THREE.Scene} scene
   * @param {import('../systems/NavGrid.js').NavGrid} grid
   * @param {{ overrides?: object }} [opts] sustituye el contenido de props.json (tests)
   */
  constructor(scene, grid, opts = {}) {
    this.scene = scene;
    this.grid = grid;
    this.group = new THREE.Group();
    this.group.name = 'props';

    const { builder, instances } = buildProps(grid, opts.overrides ?? propsData);
    this.instances = instances;
    /** @type {{type:string,x:number,y:number,z:number,color:number}[]} */
    this.lightAnchors = builder.lights;
    /** @type {{id:string,type:string,label:string,x:number,z:number}[]} */
    this.interactAnchors = builder.interacts;

    this.atlas = createAtlasTexture();
    this.materials = makePropMaterials(this.atlas);

    const baked = bakeBuilder(builder, this.materials, this.group);
    this.meshes = baked.meshes;
    this.geometries = baked.geometries;
    this.triangles = baked.triangles;
    /** Mallas de las barras de luces de los coches (para parpadear en la fase 2). */
    this.sirenMeshes = [this.meshes.red, this.meshes.blue].filter(Boolean);
    this.drawCalls = Object.keys(this.meshes).length;
    scene.add(this.group);
  }

  /**
   * Enciende/apaga las luces de sirena. `phase` en segundos: alterna rojo y azul a ~4 Hz.
   * Con `on = false` quedan apagadas (gris oscuro).
   */
  setSirens(on, phase = 0) {
    const flash = Math.floor(phase * 8) % 2 === 0;
    const { red, blue } = this.materials;
    red.color.setScalar(on ? (flash ? 1 : 0.18) : 0.18);
    blue.color.setScalar(on ? (flash ? 0.18 : 1) : 0.18);
  }

  /** Atenúa/enciende las superficies emisivas (pantallas, faros, lámparas). */
  setGlow(level) {
    this.materials.glow.color.setScalar(level);
    this.materials.screen.color.setScalar(level);
  }

  dispose() {
    this.scene.remove(this.group);
    for (const g of this.geometries) g.dispose();
    for (const m of Object.values(this.materials)) m.dispose();
    this.atlas?.dispose();
    this.geometries.length = 0;
  }
}
