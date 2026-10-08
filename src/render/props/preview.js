import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import config from '../../data/config.json';
import tiles from '../../data/tiles.json';
import map from '../../data/map.json';
import { Renderer } from '../Renderer.js';
import { MapRenderer } from '../MapRenderer.js';
import { PropRenderer, PROP_TILES, bakeBuilder, makePropMaterials } from '../PropRenderer.js';
import { createAtlasTexture } from './Atlas.js';
import { buildGallery } from './PropFactory.js';
import { NavGrid } from '../../systems/NavGrid.js';
import { updateCutaway } from '../Cutaway.js';
import { buildPolice } from '../BlockyCharacter.js';

// Página de desarrollo: galería de todos los props + mapa completo con NavGrid + MapRenderer + PropRenderer.
const canvas = document.getElementById('c');
const R = new Renderer(canvas, { ...config.quality.presets.alta, pixelRatio: 1.5 });
const scene = R.scene;
scene.fog.near = 300; scene.fog.far = 600;
R.sun.shadow.camera.left = -34; R.sun.shadow.camera.right = 34; R.sun.shadow.camera.top = 34; R.sun.shadow.camera.bottom = -34;

const grid = new NavGrid(map.rows, tiles, config.world.cellSize);
const mapRenderer = new MapRenderer(scene, grid, { skip: PROP_TILES });
const props = new PropRenderer(scene, grid);

// Galería al norte del mapa.
const galleryGroup = new THREE.Group();
scene.add(galleryGroup);
const atlas = createAtlasTexture();
const galleryMats = makePropMaterials(atlas);
const gallery = buildGallery({ x: 0, z: -62 });
bakeBuilder(gallery.builder, galleryMats, galleryGroup);

// Policías de referencia (1,78 m) junto a la galería y en la recepción.
const refs = [];
const g0 = gallery.rows[0];
for (const [x, z] of [[g0.x0 - 1.2, g0.z], [g0.x1 + 0.6, g0.z], [grid.centerX(38) + 0, grid.centerZ(33) + 0]]) {
  const p = buildPolice();
  p.root.position.set(x, 0, z);
  scene.add(p.root);
  refs.push(p.root);
}

const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 400);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = false;

// ---------------------------------------------------------------- vistas
const cell = (u, v) => new THREE.Vector3(grid.originX + u, 0, grid.originZ + v);
const VIEWS = {
  'Juego (recepción)': { target: cell(38.5, 31), dist: 16, pitch: 60 },
  'Calabozos': { target: cell(28, 18.5), dist: 14, pitch: 60 },
  'Oficinas': { target: cell(39, 18.5), dist: 14, pitch: 58 },
  'Armería': { target: cell(50, 18.5), dist: 14, pitch: 58 },
  'Pasillo': { target: cell(38, 25.5), dist: 20, pitch: 55 },
  'Enfermería': { target: cell(27.5, 31.5), dist: 13, pitch: 58 },
  'Almacén': { target: cell(50, 31.5), dist: 13, pitch: 58 },
  'Edificio': { target: cell(38.5, 25), dist: 52, pitch: 62 },
  'Aparcamiento': { target: cell(30, 47), dist: 30, pitch: 55 },
  'Patio norte': { target: cell(38, 11), dist: 24, pitch: 55 },
  'Entrada y mástiles': { target: cell(38.5, 38), dist: 20, pitch: 45 },
  'Portón sur': { target: cell(32, 62), dist: 18, pitch: 50 },
  'Césped': { target: cell(14, 24), dist: 22, pitch: 55 },
  'Mapa entero': { target: cell(40, 38), dist: 110, pitch: 78 },
};
gallery.rows.forEach((r, n) => {
  VIEWS[`Galería ${n + 1}`] = { target: new THREE.Vector3((r.x0 + r.x1) / 2, 0.6, r.z), dist: 17, pitch: 38 };
});
function setView(name, azimuthDeg = 0) {
  const v = VIEWS[name];
  if (!v) return;
  const pitch = THREE.MathUtils.degToRad(v.pitch), az = THREE.MathUtils.degToRad(azimuthDeg);
  controls.target.copy(v.target);
  camera.position.set(v.target.x + Math.sin(az) * Math.cos(pitch) * v.dist, Math.sin(pitch) * v.dist, v.target.z + Math.cos(az) * Math.cos(pitch) * v.dist);
  camera.lookAt(v.target);
  controls.update();
  renderOnce();
  highlight(name);
}

// ---------------------------------------------------------------- UI
const bar = document.getElementById('bar');
document.getElementById('hide').onclick = () => { bar.classList.toggle('hidden'); document.getElementById('stats').style.display = bar.classList.contains('hidden') ? 'none' : 'block'; };
const buttons = {};
for (const name of Object.keys(VIEWS)) {
  const b = document.createElement('button');
  b.textContent = name;
  b.onclick = () => setView(name);
  bar.appendChild(b);
  buttons[name] = b;
}
function highlight(name) { for (const [n, b] of Object.entries(buttons)) b.classList.toggle('on', n === name); }
const cutLabel = document.createElement('label');
cutLabel.innerHTML = '<input type="checkbox" id="cut"> recorte (cutaway)';
bar.appendChild(cutLabel);
const cutBox = cutLabel.querySelector('input');
cutBox.onchange = () => renderOnce();
const sirenLabel = document.createElement('label');
sirenLabel.innerHTML = '<input type="checkbox" id="sir"> sirenas';
bar.appendChild(sirenLabel);
const sirBox = sirenLabel.querySelector('input');
sirBox.onchange = () => renderOnce();


// Marcas de depuración: puntos de interacción (verde) y anclas de luz (amarillo/rojo/azul/cian).
const anchorGroup = new THREE.Group();
anchorGroup.visible = false;
scene.add(anchorGroup);
{
  const post = new THREE.CylinderGeometry(0.06, 0.06, 1.2, 8); post.translate(0, 0.6, 0);
  const ball = new THREE.SphereGeometry(0.12, 8, 6);
  const mi = new THREE.MeshBasicMaterial({ color: 0x2cff7a, depthTest: false, transparent: true, opacity: 0.85 });
  for (const a of props.interactAnchors) {
    const m = new THREE.Mesh(post, mi);
    m.position.set(a.x, 0, a.z);
    m.renderOrder = 10;
    anchorGroup.add(m);
  }
  const lightColors = { farola: 0xffe066, sirena: 0xff4040, lampara: 0xffb347, pantalla: 0x59d2ff };
  for (const a of props.lightAnchors) {
    const m = new THREE.Mesh(ball, new THREE.MeshBasicMaterial({ color: lightColors[a.type] ?? 0xffffff, depthTest: false, transparent: true, opacity: 0.8 }));
    m.position.set(a.x, a.y, a.z);
    m.renderOrder = 10;
    anchorGroup.add(m);
  }
}
const anchorLabel = document.createElement('label');
anchorLabel.innerHTML = '<input type="checkbox"> anclas';
bar.appendChild(anchorLabel);
anchorLabel.querySelector('input').onchange = (e) => { anchorGroup.visible = e.target.checked; renderOnce(); };

const labelsDiv = document.getElementById('labels');
const labelEls = gallery.labels.map((l) => {
  const d = document.createElement('div');
  d.textContent = l.name;
  labelsDiv.appendChild(d);
  return { el: d, pos: new THREE.Vector3(l.x, l.y, l.z) };
});
const statsEl = document.getElementById('stats');
const _p = new THREE.Vector3();
const _t = new THREE.Vector3();

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  R.resize(w, h);
  camera.aspect = w / h;
  camera.fov = w / h < 1 ? Math.min(75, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(20)) / (w / h)))) : 40;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', () => { resize(); renderOnce(); });

let t0 = performance.now();
function renderOnce() {
  if (cutBox.checked) {
    _t.copy(controls.target); _t.y = 1;
    updateCutaway(camera.position, _t);
  } else {
    updateCutaway(camera.position, camera.position); // sin recorte
  }
  if (sirBox.checked) props.setSirens(true, (performance.now() - t0) / 1000);
  else props.setSirens(true, 0);
  R.followFocus(controls.target);
  R.render(camera);
  const w = window.innerWidth, h = window.innerHeight;
  for (const l of labelEls) {
    _p.copy(l.pos).project(camera);
    const vis = _p.z < 1 && _p.z > -1 && Math.abs(_p.x) < 1.1 && Math.abs(_p.y) < 1.1;
    l.el.style.display = vis ? 'block' : 'none';
    if (vis) { l.el.style.left = `${(_p.x * 0.5 + 0.5) * w}px`; l.el.style.top = `${(-_p.y * 0.5 + 0.5) * h}px`; }
  }
  const info = R.renderer.info;
  statsEl.textContent =
    `props: ${props.drawCalls} mallas · ${props.triangles.toLocaleString('es')} triángulos · ${props.instances.length} instancias\n` +
    `escena: ${info.render.calls} draw calls · ${info.render.triangles.toLocaleString('es')} tris\n` +
    `luces: ${props.lightAnchors.length} · interacción: ${props.interactAnchors.length}`;
}
controls.addEventListener('change', renderOnce);

// Renderizado continuo si la pestaña está visible; bajo demanda (renderOnce) si no.
function loop() {
  requestAnimationFrame(loop);
  if (sirBox.checked) renderOnce();
}
loop();

window.focusProp = (name, dist = 5, pitch = 38, az = 0) => {
  const l = gallery.labels.find((x) => x.name === name);
  if (!l) return false;
  VIEWS.__f = { target: new THREE.Vector3(l.x, 0.7, l.z), dist, pitch };
  setView('__f', az);
  return true;
};
window.renderOnce = renderOnce;
window.setView = setView;
window.__props = props;
window.__grid = grid;
window.__camera = camera;
window.__controls = controls;
window.__R = R;
window.__scene = scene;
window.__VIEWS = VIEWS;

resize();
setView('Juego (recepción)');
