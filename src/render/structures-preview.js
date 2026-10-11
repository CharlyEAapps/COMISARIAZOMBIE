import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import config from '../data/config.json';
import build from '../data/build.json';
import { Renderer } from './Renderer.js';
import { buildPolice } from './BlockyCharacter.js';
import { createAtlasTexture } from './props/Atlas.js';
import {
  structureGeometry, doorLeafGeometry, doorFrameGeometry, doorSignGeometry, mineLightGeometry,
  structureGhostGeometry, transformerDamageGeometry, turretHeadGeometry, floodLensGeometry, STRUCTURE_MATERIAL_OPTIONS,
  structureJoinGeometry, joinShape, JOIN_TYPES,
} from './StructureModels.js';

// Página de desarrollo: todas las piezas de construcción y trampas en fila sobre un suelo de baldosa,
// con un policía de referencia (1,78 m). Una celda = 1 m; cada pieza ocupa la celda [i, i+1] × [0, 1].
const canvas = document.getElementById('c');
const R = new Renderer(canvas, { ...config.quality.presets.alta, pixelRatio: 1.5 });
const scene = R.scene;
scene.fog.near = 300; scene.fog.far = 600;
R.sun.shadow.camera.left = -24; R.sun.shadow.camera.right = 24; R.sun.shadow.camera.top = 24; R.sun.shadow.camera.bottom = -24;

const solidMat = new THREE.MeshStandardMaterial(STRUCTURE_MATERIAL_OPTIONS);
const ghostMat = new THREE.MeshStandardMaterial({ vertexColors: false, color: 0x59d98a, transparent: true, opacity: 0.55, roughness: 0.6, depthWrite: false });
const lightMat = new THREE.MeshBasicMaterial({ vertexColors: true });
const signMat = new THREE.MeshStandardMaterial({ map: createAtlasTexture(), roughness: 0.7, alphaTest: 0.4, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

// ---------------------------------------------------------------- suelo (damero de baldosas, como el MapRenderer)
const X0 = -2, X1 = 80, Z0 = -3, Z1 = 6;
{
  const RES = 2, tw = (X1 - X0) * RES, th = (Z1 - Z0) * RES;
  const data = new Uint8Array(tw * th * 4);
  const pal = [0xe9e4d9, 0xb9b2a5];
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const v = pal[(x + y) & 1], k = (y * tw + x) * 4;
    data[k] = (v >> 16) & 255; data[k + 1] = (v >> 8) & 255; data[k + 2] = v & 255; data[k + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, tw, th, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, Z1 - Z0), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((X0 + X1) / 2, 0, (Z0 + Z1) / 2);
  floor.receiveShadow = true;
  scene.add(floor);
}

// ---------------------------------------------------------------- piezas
const items = []; // { group, solid, ghost, labelPos, name, tris }
const labels = [];
const cellZ = 0.5;
let ghostMode = false;
let turretYaw = 0.5; // la cabeza de la torreta apunta algo girada para verla de perfil

function addMesh(parent, geo, mat, shadows = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadows; m.receiveShadow = true;
  parent.add(m);
  return m;
}
function addLabel(name, x, y, z) { labels.push({ name, pos: new THREE.Vector3(x, y, z) }); }

let cell = 0;
const triOf = (g) => g.attributes.position.count / 3;
const stats = [];

function place(type, level, cx = cell + 0.5, label = true) {
  const def = build.pieces[type];
  const group = new THREE.Group();
  group.position.set(cx, 0, cellZ);
  scene.add(group);
  const geo = structureGeometry(type, level);
  const solid = addMesh(group, geo, solidMat);
  const ghostGeo = structureGhostGeometry(type);
  const extra = [];
  if (type === 'mina') extra.push(addMesh(group, mineLightGeometry(), lightMat, false));
  if (type === 'puerta' && level === 1) extra.push(addMesh(group, doorSignGeometry(1), signMat, false));
  if (type === 'torreta') {
    // la cabeza gira sobre su eje: en el juego va en un Group aparte colocado en y = headHeight
    const head = new THREE.Group();
    head.position.y = def.headHeight;
    head.rotation.y = turretYaw;
    group.add(head);
    const hm = addMesh(head, turretHeadGeometry(level), solidMat);
    extra.push(head);
    stats.push(`${('cabeza ' + level).padEnd(12)} ${String(triOf(hm.geometry)).padStart(4)} tris`);
  }
  if (type === 'foco') extra.push(addMesh(group, floodLensGeometry(), lightMat, false));
  items.push({ group, solid, geo, ghostGeo, extra });
  if (label) addLabel(`${def.name} · ${def.levels[level].name}`, cx, (type === 'torreta' ? 1.3 : def.height) + 0.25, cellZ);
  if (label) stats.push(`${(type + ' ' + level).padEnd(12)} ${String(triOf(geo)).padStart(4)} tris  h=${def.height}`);
  return group;
}

// Barricadas, sacos, puertas cerradas
for (let l = 0; l < 3; l++) { place('barricada', l); cell += 2; }
for (let l = 0; l < 2; l++) { place('sacos', l); cell += 2; }
for (let l = 0; l < 2; l++) { place('puerta', l); cell += 2; }

// Puertas abiertas 90° con doorFrameGeometry + doorLeafGeometry (bisagra en x = -0,5)
for (let l = 0; l < 2; l++) {
  const cx = cell + 0.5;
  const group = new THREE.Group();
  group.position.set(cx, 0, cellZ);
  scene.add(group);
  addMesh(group, doorFrameGeometry(l), solidMat);
  const hinge = new THREE.Group();
  hinge.position.set(-0.5, 0, 0);
  hinge.rotation.y = -Math.PI / 2;
  group.add(hinge);
  const leaf = new THREE.Group();
  leaf.position.set(0.5, 0, 0); // la geometría de la hoja tiene la bisagra en x = -0,5
  hinge.add(leaf);
  addMesh(leaf, doorLeafGeometry(l), solidMat);
  if (l === 1) addMesh(leaf, doorSignGeometry(1), signMat, false);
  items.push({ group, solid: null, geo: null, ghostGeo: null, extra: [] });
  addLabel(`Puerta ${l === 0 ? 'de seguridad' : 'blindada'} (hoja abierta)`, cx, 2.55, cellZ);
  stats.push(`${('hoja ' + l).padEnd(12)} ${String(triOf(doorLeafGeometry(l))).padStart(4)} tris  marco ${triOf(doorFrameGeometry(l))}`);
  cell += 2;
}

// Trampas
for (let l = 0; l < 2; l++) { place('pinchos', l); cell += 2; }
for (let l = 0; l < 2; l++) { place('cepo', l); cell += 2; }
place('mina', 0); cell += 2;

// Piezas de la fase 5: alambre, barril, valla, generador, torreta, foco
const afterTraps = cell;
cell = 32;
for (let l = 0; l < 2; l++) { place('alambre', l); cell += 2; }
place('barril', 0); cell += 2;
for (let l = 0; l < 2; l++) { place('valla', l); cell += 2; }
place('generador', 0); cell += 2;
for (let l = 0; l < 2; l++) { place('torreta', l); cell += 2; }
place('foco', 0); cell += 2;
// Uniones: cada pieza que se une, en un trazado con esquina, T y cruz (como las dibuja el juego).
{
  const PATTERN = ['XXX.', 'X.XX', 'XXX.']; // fila en T, cruz y esquinas
  let x0 = 32;
  for (const type of JOIN_TYPES) {
    build.pieces[type].levels.forEach((lv, level) => {
      const on = (i, j) => PATTERN[j]?.[i] === 'X';
      for (let j = 0; j < PATTERN.length; j++) for (let i = 0; i < PATTERN[j].length; i++) {
        if (!on(i, j)) continue;
        const mask = (on(i + 1, j) ? 1 : 0) | (on(i, j + 1) ? 2 : 0) | (on(i - 1, j) ? 4 : 0) | (on(i, j - 1) ? 8 : 0);
        const js = joinShape(mask);
        const m = addMesh(scene, structureJoinGeometry(type, level, js.shape), solidMat);
        m.position.set(x0 + i + 0.5, 0, cellZ + 2 + j);
        m.rotation.y = js.rot;
      }
      addLabel(`${build.pieces[type].name} · ${lv.name} (uniones)`, x0 + 2, build.pieces[type].height + 0.3, cellZ + 2);
      x0 += 5;
    });
  }
}
cell = afterTraps;
// Transformador (maqueta de 2×1) con la superposición de daño
{
  const cx = cell + 1;
  const group = new THREE.Group();
  group.position.set(cx, 0, cellZ);
  scene.add(group);
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 1.4, 1), new THREE.MeshStandardMaterial({ color: 0x6f8aa6, roughness: 0.8 }));
  body.position.y = 0.7; body.castShadow = true; body.receiveShadow = true;
  group.add(body);
  const g = transformerDamageGeometry();
  addMesh(group, g, solidMat);
  addLabel('Daño del transformador (maqueta 2×1×1,4)', cx, 2.5, cellZ);
  stats.push(`${'trafo daño'.padEnd(12)} ${String(triOf(g)).padStart(4)} tris`);
  cell += 4;
}

// Policías de referencia
const refs = [];
for (const x of [5.0, 11.0, 21.0, 32.0, 41.0, 49.0, 58.0]) {
  const p = buildPolice();
  p.root.position.set(x - 1.0, 0, 1.9);
  scene.add(p.root);
  refs.push(p.root);
}
addLabel('Policía 1,78 m', 4.0, 2.0, 1.9);

// ---------------------------------------------------------------- cámara y vistas
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = false;

const VIEWS = {
  'Todo': { target: [16, 0.4, 0.5], dist: 46, pitch: 52 },
  'Barricadas y sacos': { target: [5, 0.6, 0.5], dist: 13, pitch: 50 },
  'Puertas': { target: [14, 1.1, 0.5], dist: 14, pitch: 42 },
  'Trampas': { target: [22.5, 0.1, 0.5], dist: 10, pitch: 55 },
  'Transformador': { target: [29, 0.8, 0.5], dist: 8, pitch: 38 },
  'Alambre y barril': { target: [35.5, 0.4, 0.5], dist: 8, pitch: 45 },
  'Vallas': { target: [39.5, 0.8, 0.5], dist: 8, pitch: 40 },
  'Generador y torretas': { target: [45, 0.7, 0.5], dist: 9, pitch: 42 },
  'Foco': { target: [48.5, 1.2, 0.5], dist: 7, pitch: 30 },
  'Uniones (esquinas y T)': { target: [54, 0.6, 3.5], dist: 26, pitch: 52 },
  'Cámara del juego (60°)': { target: [5, 0.6, 0.5], dist: 16, pitch: 60 },
};
function setView(name, azimuthDeg = 0) {
  const v = VIEWS[name];
  if (!v) return false;
  const pitch = THREE.MathUtils.degToRad(v.pitch), az = THREE.MathUtils.degToRad(azimuthDeg);
  const t = new THREE.Vector3(...v.target);
  controls.target.copy(t);
  camera.position.set(t.x + Math.sin(az) * Math.cos(pitch) * v.dist, Math.sin(pitch) * v.dist + t.y, t.z + Math.cos(az) * Math.cos(pitch) * v.dist);
  camera.lookAt(t);
  controls.update();
  renderOnce();
  for (const [n, b] of Object.entries(buttons)) b.classList.toggle('on', n === name);
  return true;
}
/** Enfoca una posición arbitraria: focus(x, y, z, dist, pitchDeg, azimuthDeg). */
function focus(x, y, z, dist = 6, pitch = 45, az = 0) {
  VIEWS.__f = { target: [x, y, z], dist, pitch };
  return setView('__f', az);
}

// ---------------------------------------------------------------- UI
const bar = document.getElementById('bar');
const statsEl = document.getElementById('stats');
const buttons = {};
for (const name of Object.keys(VIEWS)) {
  const b = document.createElement('button');
  b.textContent = name;
  b.onclick = () => setView(name);
  bar.appendChild(b);
  buttons[name] = b;
}
const gl = document.createElement('label');
gl.innerHTML = '<input type="checkbox"> fantasma (colocación)';
bar.appendChild(gl);
gl.querySelector('input').onchange = (e) => {
  ghostMode = e.target.checked;
  for (const it of items) {
    if (!it.solid) continue;
    it.solid.geometry = ghostMode ? it.ghostGeo : it.geo;
    it.solid.material = ghostMode ? ghostMat : solidMat;
    it.solid.castShadow = !ghostMode;
    for (const m of it.extra) m.visible = !ghostMode;
  }
  renderOnce();
};
const wl = document.createElement('label');
wl.innerHTML = '<input type="checkbox"> alambre';
bar.appendChild(wl);
wl.querySelector('input').onchange = (e) => { solidMat.wireframe = e.target.checked; renderOnce(); };

const sl = document.createElement('label');
sl.innerHTML = '<input type="checkbox" checked> tabla de triángulos';
bar.appendChild(sl);
sl.querySelector('input').onchange = (e) => { statsEl.style.display = e.target.checked ? 'block' : 'none'; };

const labelsDiv = document.getElementById('labels');
const labelEls = labels.map((l) => {
  const d = document.createElement('div');
  d.textContent = l.name;
  labelsDiv.appendChild(d);
  return { el: d, pos: l.pos };
});
statsEl.textContent = stats.join('\n');
const _p = new THREE.Vector3();

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  R.resize(w, h);
  camera.aspect = w / h;
  // En ventanas estrechas se ensancha el FOV vertical para que el encuadre horizontal no se pierda.
  camera.fov = w / h < 1 ? Math.min(75, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(20)) / (w / h)))) : 40;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', () => { resize(); renderOnce(); });

function renderOnce() {
  R.followFocus(controls.target);
  R.render(camera);
  const w = window.innerWidth, h = window.innerHeight;
  for (const l of labelEls) {
    _p.copy(l.pos).project(camera);
    const vis = _p.z < 1 && _p.z > -1 && Math.abs(_p.x) < 1.1 && Math.abs(_p.y) < 1.1;
    l.el.style.display = vis ? 'block' : 'none';
    if (vis) { l.el.style.left = `${(_p.x * 0.5 + 0.5) * w}px`; l.el.style.top = `${(-_p.y * 0.5 + 0.5) * h}px`; }
  }
}
controls.addEventListener('change', renderOnce);
function loop() { requestAnimationFrame(loop); }
loop();

window.renderOnce = renderOnce;
window.setView = setView;
window.focusAt = focus;
window.__R = R;
window.__scene = scene;
window.__camera = camera;
window.__controls = controls;

resize();
setView('Todo');
// Atajo para QA: structures-preview.html#x,y,z,dist,pitch,azimut[,notabla]  (p. ej. #7.5,0.4,0.5,5.5,50,15,1)
if (location.hash.length > 1) {
  const a = location.hash.slice(1).split(',').map(Number);
  if (a.length >= 6 && a.slice(0, 6).every(Number.isFinite)) focus(...a.slice(0, 6));
  if (a[6]) { statsEl.style.display = 'none'; sl.querySelector('input').checked = false; }
}
