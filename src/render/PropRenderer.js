import * as THREE from 'three';
import { withCutaway } from './Cutaway.js';
import { buildProps, buildRoom, buildFacade } from './props/PropFactory.js';
import { PropBuilder } from './props/Builder.js';
import { ROOM_BY_ID } from '../systems/Station.js';
import { createAtlasTexture } from './props/Atlas.js';
import { COLOR_LAYERS, UV_LAYERS } from './props/Builder.js';
import propsData from '../data/props.json';

/**
 * Funde cada capa del PropBuilder en una malla (una por material) y las añade a `target`.
 * @returns {{ meshes: Record<string, THREE.Mesh>, geometries: THREE.BufferGeometry[], triangles: number }}
 */
export function bakeBuilder(builder, mats, target, culled = false) {
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
    // Las mallas comunes abarcan todo el mapa; las de una sala se recortan por su esfera.
    mesh.frustumCulled = culled;
    if (culled) geo.computeBoundingSphere();
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

    const { builder, instances, rooms, facade, interacts } = buildProps(grid, opts.overrides ?? propsData);
    this.instances = instances;
    /** @type {{type:string,x:number,y:number,z:number,color:number}[]} */
    this.lightAnchors = builder.lights;
    /** Puntos de interacción (los de las salas, tomados a nivel 0: no cambian con el nivel). */
    /** @type {{id:string,type:string,label:string,x:number,z:number}[]} */
    this.interactAnchors = interacts;

    this.atlas = createAtlasTexture();
    this.materials = makePropMaterials(this.atlas);

    const baked = bakeBuilder(builder, this.materials, this.group);
    this.meshes = baked.meshes;
    this.geometries = baked.geometries;
    this.triangles = baked.triangles;
    /** Mallas de las barras de luces de los coches (para parpadear en la fase 2). */
    this.sirenMeshes = [this.meshes.red, this.meshes.blue].filter(Boolean);
    this.drawCalls = Object.keys(this.meshes).length;

    // Salas con nivel y fachada: un grupo cada una, que se rehace al cambiar su nivel.
    /** @type {Map<string, {group: THREE.Group, geometries: THREE.BufferGeometry[], level: number, global: number, triangles: number}>} */
    this.rooms = new Map();
    for (const [id, r] of rooms) this.bakeRoom(id, r.builder, 0, 0);
    this.bakeRoom('fachada', facade.builder, 0, 0);
    this.rebuilds = 0;
    scene.add(this.group);
  }

  /** Funde el builder de una sala en su grupo (frustum culling por sala). */
  bakeRoom(id, builder, level, global) {
    let part = this.rooms.get(id);
    if (!part) {
      part = { group: new THREE.Group(), geometries: [], level: 0, global: 0, triangles: 0 };
      part.group.name = `sala-${id}`;
      this.group.add(part.group);
      this.rooms.set(id, part);
    }
    const baked = bakeBuilder(builder, this.materials, part.group, true);
    part.geometries = baked.geometries;
    part.triangles = baked.triangles;
    part.level = level;
    part.global = global;
  }

  /** Libera la geometría de una sala (los materiales son compartidos y no se tocan). */
  clearRoom(part) {
    for (const g of part.geometries) g.dispose();
    part.geometries = [];
    part.group.clear();
  }

  /**
   * Pone una sala (o 'fachada') a su nivel. Solo se reconstruye si cambia (o, en las que
   * dependen del nivel global, si cambia ese). @returns {boolean} se ha reconstruido
   */
  setRoomLevel(id, level, global = 0) {
    const part = this.rooms.get(id);
    if (!part) return false;
    const room = ROOM_BY_ID[id];
    const usesGlobal = id === 'fachada' || !!room?.globalLevel;
    if (part.level === level && (!usesGlobal || part.global === global)) return false;
    this.clearRoom(part);
    const b = new PropBuilder();
    if (id === 'fachada') buildFacade(b, this.grid, global);
    else buildRoom(b, this.grid, room, level, global);
    this.bakeRoom(id, b, level, global);
    this.rebuilds++;
    return true;
  }

  /** Draw calls totales de los props (común + salas). */
  get totalDrawCalls() {
    let n = this.drawCalls;
    for (const p of this.rooms.values()) n += p.group.children.length;
    return n;
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
    for (const part of this.rooms.values()) this.clearRoom(part);
    for (const m of Object.values(this.materials)) m.dispose();
    this.atlas?.dispose();
    this.geometries.length = 0;
  }
}
