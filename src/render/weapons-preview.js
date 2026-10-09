import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import config from '../data/config.json';
import weapons from '../data/weapons.json';
import { Renderer } from './Renderer.js';
import { buildPolice, makePose, computePose, PART_NAMES } from './BlockyCharacter.js';
import { weaponGeometry, grenadeGeometry, WEAPON_SPECS, WEAPON_MATERIAL_OPTIONS } from './WeaponModels.js';

// Página de desarrollo: cada arma suelta (fila de atrás, de perfil, con marcadores de boca y mano izquierda)
// y en la mano de un policía de bloques (fila de delante), con la colocación que usará el juego:
// armR.position (0, -0.62, 0.06), rotation.x = π/2, y el brazo con rotation.x = -π/2.
const canvas = document.getElementById('c');
const R = new Renderer(canvas, { ...config.quality.presets.alta, pixelRatio: 1.5 });
const scene = R.scene;
scene.fog.near = 300; scene.fog.far = 600;
R.sun.shadow.camera.left = -14; R.sun.shadow.camera.right = 14; R.sun.shadow.camera.top = 14; R.sun.shadow.camera.bottom = -14;

const weaponMat = new THREE.MeshStandardMaterial(WEAPON_MATERIAL_OPTIONS);

// ---------------------------------------------------------------- suelo (damero)
const X0 = -3, X1 = 20, Z0 = -4, Z1 = 5;
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

// ---------------------------------------------------------------- armas
const IDS = Object.keys(WEAPON_SPECS);
const DX = 1.9;           // separación entre armas
const ZW = -1.6;          // fila de armas sueltas
const ZP = 1.4;           // fila de policías
const labels = [];
const stats = [];
const markers = [];
const policeList = [];
const triOf = (g) => g.attributes.position.count / 3;
const addLabel = (name, x, y, z) => labels.push({ name, pos: new THREE.Vector3(x, y, z) });

function marker(parent, p, color, r = 0.012) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), new THREE.MeshBasicMaterial({ color, depthTest: false }));
  m.position.fromArray(p);
  m.renderOrder = 10;
  parent.add(m);
  markers.push(m);
  return m;
}

function meshOf(geo) {
  const m = new THREE.Mesh(geo, weaponMat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function standAt(x) {
  const stand = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.04, 0.5), new THREE.MeshStandardMaterial({ color: 0x59606c, roughness: 0.8 }));
  stand.position.set(x, 0.55, ZW);
  stand.castShadow = stand.receiveShadow = true;
  scene.add(stand);
}

const pose = makePose();
computePose(pose, 0, 0, 'police');

/** Policía con la pose de juego y sin la pistola de serie. */
function armedPolice(x) {
  const p = buildPolice();
  for (const c of [...p.parts.armR.children]) p.parts.armR.remove(c);
  for (const n of PART_NAMES) { p.parts[n].rotation.x = pose[n].x; p.parts[n].rotation.z = pose[n].z; }
  p.root.position.set(x, 0, ZP);
  scene.add(p.root);
  policeList.push(p.root);
  return p;
}

IDS.forEach((id, i) => {
  const x = i * DX;
  const geo = weaponGeometry(id);
  const spec = WEAPON_SPECS[id];
  // 1) arma suelta, de perfil (cañón hacia +X)
  const holder = new THREE.Group();
  holder.position.set(x, 0.95, ZW);
  holder.rotation.y = Math.PI / 2;
  holder.add(meshOf(geo));
  marker(holder, spec.muzzle, 0xff3030);
  if (spec.support) marker(holder, spec.support, 0x3a8dff);
  marker(holder, [0, 0, 0], 0x40e060, 0.01);
  scene.add(holder);
  standAt(x);
  addLabel(`${weapons[id].name} · ${triOf(geo)} tris`, x, 1.35, ZW);
  stats.push(`${id.padEnd(14)} ${String(triOf(geo)).padStart(4)} tris   largo ${spec.length.toFixed(2)} m`);

  // 2) en la mano de un policía
  const p = armedPolice(x);
  const wm = meshOf(weaponGeometry(id));
  wm.position.set(0, -0.62, 0.06);
  wm.rotation.x = Math.PI / 2;
  p.parts.armR.add(wm);
  marker(wm, spec.muzzle, 0xff3030, 0.012);
  if (spec.support) marker(wm, spec.support, 0x3a8dff, 0.012);
  addLabel(weapons[id].name, x, 2.0, ZP);
});

// granada: suelta (ampliada) y en la mano
{
  const x = IDS.length * DX;
  const g = grenadeGeometry();
  const m = meshOf(g);
  m.scale.setScalar(4);
  m.position.set(x, 0.95, ZW);
  scene.add(m);
  standAt(x);
  addLabel(`Granada (x4) · ${triOf(g)} tris`, x, 1.4, ZW);
  stats.push(`${'granada'.padEnd(14)} ${String(triOf(g)).padStart(4)} tris`);

  const p = armedPolice(x);
  const gm = meshOf(grenadeGeometry());
  gm.position.set(0, -0.68, 0.06);
  p.parts.armR.add(gm);
  addLabel('Granada en la mano', x, 2.0, ZP);
}
stats.push('', 'rojo = boca   azul = mano izquierda   verde = mano derecha (origen)');

// ---------------------------------------------------------------- cámara y vistas
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = false;
const cx = (IDS.length * DX) / 2;

const VIEWS = {
  'Todo': { target: [cx, 0.8, -0.1], dist: 21, pitch: 35 },
  'Armas sueltas': { target: [cx, 0.95, ZW], dist: 14, pitch: 14 },
  'Policías': { target: [cx, 1.1, ZP], dist: 14, pitch: 22 },
  'Cámara del juego (60°)': { target: [cx, 0.6, ZP], dist: 16, pitch: 60 },
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
/** Enfoca una posición arbitraria: focusAt(x, y, z, dist, pitchDeg, azimuthDeg). */
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
function toggle(text, checked, fn) {
  const l = document.createElement('label');
  l.innerHTML = `<input type="checkbox"${checked ? ' checked' : ''}> ${text}`;
  bar.appendChild(l);
  l.querySelector('input').onchange = (e) => { fn(e.target.checked); renderOnce(); };
}
toggle('marcadores', true, (on) => { for (const m of markers) m.visible = on; });
toggle('policías de perfil', false, (on) => { for (const r of policeList) r.rotation.y = on ? Math.PI / 2 : 0; });
toggle('policías', true, (on) => { for (const r of policeList) r.visible = on; });
toggle('alambre', false, (on) => { weaponMat.wireframe = on; });

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
  camera.fov = w / h < 1.2 ? Math.min(75, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(20)) / (w / h) * 1.2))) : 40;
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

window.renderOnce = renderOnce;
window.setView = setView;
window.focusAt = focus;
window.__R = R;
window.__scene = scene;
window.__camera = camera;
window.__controls = controls;

resize();
setView('Todo');
// Atajo para QA: weapons-preview.html#x,y,z,dist,pitch,azimut[,notabla]
if (location.hash.length > 1) {
  const a = location.hash.slice(1).split(',').map(Number);
  if (a.length >= 6 && a.slice(0, 6).every(Number.isFinite)) focus(...a.slice(0, 6));
  if (a[6]) statsEl.style.display = 'none';
}
