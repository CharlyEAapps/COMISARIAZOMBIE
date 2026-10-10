import * as THREE from 'three';
import { withCutaway } from './Cutaway.js';
import { roomAt, ROOM_BY_ID } from '../systems/Station.js';

// Blockout del mapa a partir de la rejilla: un plano de suelo con textura por celda
// (1 draw call) y un InstancedMesh por tipo de obstáculo. En la fase 6 se sustituye por assets.

// Paleta "maqueta": tonos claros y suaves (referencia visual de Carlos).
export const FLOOR_COLORS = {
  hierba: [0x9cbb72, 0x9fbe75, 0x99b870],
  asfalto: [0x7e8187, 0x80838a, 0x7b7e84],
  interior: [0xe9e4d9, 0xb9b2a5], // damero de baldosas suave
};
const TEX_RES = 8; // píxeles de textura por celda (12,5 cm por píxel)

/**
 * Suelos de las salas (station.json → rooms[].floor): dibujo y paleta. x, y = píxel de la textura.
 *   checker = damero de 50 cm · small = damero de 25 cm · tiles = baldosa de 50 cm con junta ·
 *   planks = tarima · noise = moteado suave · speckle = terrazo · diamond = chapa estriada.
 */
export const ROOM_FLOORS = {
  damero: { pattern: 'checker', colors: [0xe9e4d9, 0xb9b2a5] },
  hormigon: { pattern: 'noise', colors: [0xa9a8a2, 0xa3a29c, 0xb0afa8] },
  hormigon_lineas: { pattern: 'noise', colors: [0x9c9c98, 0x969692, 0xa3a39e] },
  moqueta: { pattern: 'noise', colors: [0x7b8aa0, 0x7686a0, 0x8090a6] },
  linoleo: { pattern: 'small', colors: [0xddd6bb, 0xc9c3a8] },
  madera: { pattern: 'planks', colors: [0xb07a48, 0xa06c3e, 0xbb8552, 0x7a4e2c] },
  chapa: { pattern: 'diamond', colors: [0x8a929c, 0xa3abb5] },
  baldosa_blanca: { pattern: 'tiles', colors: [0xf0f1ec, 0xc9cec9] },
  baldosa_azul: { pattern: 'tiles', colors: [0xb4d2e4, 0x86a8bc] },
  terrazo: { pattern: 'speckle', colors: [0xe2dbcd, 0xc7b9a3, 0xf1ece2] },
};

const pixHash = (x, y) => (((x * 73856093) ^ (y * 19349663)) >>> 0) % 1000;

/** Color (hex) de un píxel del suelo de una sala. */
function roomFloorPixel(f, x, y) {
  const c = f.colors;
  switch (f.pattern) {
    case 'checker': return c[((x >> 2) + (y >> 2)) & 1];
    case 'small': return c[((x >> 1) + (y >> 1)) & 1];
    case 'tiles': return (x % 4 === 0 || y % 4 === 0) ? c[1] : c[0];
    case 'diamond': return ((x + y) % 4 === 0 || (x - y + 64) % 4 === 0) ? c[1] : c[0];
    case 'planks': {
      const plank = y >> 1, off = (plank * 5) % 16;
      if ((x + off) % 16 === 0) return c[3];
      return c[pixHash(plank, ((x + off) >> 4)) % 3];
    }
    case 'speckle': {
      const h = pixHash(x, y);
      return h < 45 ? c[1] : h < 90 ? c[2] : c[0];
    }
    default: return c[pixHash(x, y) % c.length];
  }
}

const BLOCK_STYLE = {
  '#': { color: 0xeee5d3, cutaway: true, cap: 0x2b2b30 },
  '=': { color: 0xb8bec4 },
  '|': { color: 0x3a3d42, bars: true },
  'c': { color: 0x2c4f8c, cutaway: true },
  'k': { color: 0x3f7a5a, cutaway: true },
  'o': { color: 0xc49a6c },
  'L': { color: 0x3a3a3e, pole: true },
};

export class MapRenderer {
  /**
   * @param {{ skip?: Iterable<string> }} [opts] tiles que dibuja otro sistema (p. ej. PropRenderer);
   *   su colisión sigue existiendo, solo se omite la caja provisional.
   */
  constructor(scene, grid, opts = {}) {
    this.scene = scene;
    this.grid = grid;
    this.skip = new Set(opts.skip ?? []);
    this.group = new THREE.Group();
    this.group.name = 'mapa';
    scene.add(this.group);
    this.buildFloor();
    this.buildBlocks();
  }

  buildFloor() {
    const { grid } = this;
    const tw = grid.w * TEX_RES, th = grid.h * TEX_RES;
    const data = new Uint8Array(tw * th * 4);
    const tileAt = (i, j) => grid.tiles[grid.chars[grid.index(i, j)]];
    // Celda "costura": interior que no pertenece a ninguna sala (muros, puertas, esquinas).
    const isSeam = (i, j) => grid.inBounds(i, j) && tileAt(i, j).floor === 'interior' && !roomAt(i, j);
    const seamSource = (i, j, west, north) => {
      const hi = west ? i - 1 : i + 1, vj = north ? j - 1 : j + 1;
      if (grid.inBounds(hi, j) && !isSeam(hi, j)) return [hi, j];
      if (grid.inBounds(i, vj) && !isSeam(i, vj)) return [i, vj];
      if (grid.inBounds(hi, vj) && !isSeam(hi, vj)) return [hi, vj];
      return [i, j];
    };
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        let i = (x / TEX_RES) | 0, j = (y / TEX_RES) | 0;
        // Muros y puertas son barras finas centradas en su celda: cada mitad de la celda lleva
        // el suelo del lado al que da (sala, pasillo o calle) para que no queden franjas sueltas.
        if (isSeam(i, j)) [i, j] = seamSource(i, j, (x % TEX_RES) < TEX_RES / 2, (y % TEX_RES) < TEX_RES / 2);
        const t = grid.tiles[grid.chars[grid.index(i, j)]];
        const palette = FLOOR_COLORS[t.floor] ?? FLOOR_COLORS.hierba;
        const room = t.floor === 'interior' ? roomAt(i, j) : null;
        const rf = room ? ROOM_FLOORS[ROOM_BY_ID[room].floor] : null;
        let v;
        if (rf) v = roomFloorPixel(rf, x, y);
        else if (t.floor === 'interior') v = roomFloorPixel(ROOM_FLOORS.damero, x, y);
        else v = palette[(i * 7 + j * 13 + ((i * j) % 5)) % palette.length]; // variación estable por celda
        // Bytes sRGB tal cual (la textura está marcada como sRGB): sin pasar por THREE.Color,
        // que los convertiría a lineal y oscurecería el suelo.
        // El mapa ASCII tiene la fila 0 al norte; la textura se rellena de abajo arriba.
        const k = ((th - 1 - y) * tw + x) * 4;
        data[k] = (v >> 16) & 255; data[k + 1] = (v >> 8) & 255; data[k + 2] = v & 255; data[k + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, tw, th, THREE.RGBAFormat);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    this.floorTexture = tex;

    const geo = new THREE.PlaneGeometry(grid.w * grid.cellSize, grid.h * grid.cellSize);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
    const floor = new THREE.Mesh(geo, mat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);

    // Suelo exterior más allá del mapa para que no se vea el vacío en los bordes.
    const outer = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ color: 0x8c8f95, roughness: 1 }),
    );
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.02;
    this.group.add(outer);
  }

  buildBlocks() {
    const { grid } = this;
    const byChar = new Map();
    for (let j = 0; j < grid.h; j++) {
      for (let i = 0; i < grid.w; i++) {
        const ch = grid.chars[grid.index(i, j)];
        if (!BLOCK_STYLE[ch] || this.skip.has(ch)) continue;
        if (!byChar.has(ch)) byChar.set(ch, []);
        byChar.get(ch).push([i, j]);
      }
    }

    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const pole = new THREE.CylinderGeometry(0.09, 0.12, 1, 8);
    pole.translate(0, 0.5, 0);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const tint = new THREE.Color();

    for (const [ch, cells] of byChar) {
      const style = BLOCK_STYLE[ch];
      const t = grid.tiles[ch];
      const pieces = this.buildPieces(ch, cells, style);
      if (style.bars) { this.buildBars(pieces, t.height, style.color); continue; }
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
      if (style.cutaway) withCutaway(mat);
      const mesh = new THREE.InstancedMesh(style.pole ? pole : box, mat, pieces.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      pieces.forEach((p, n) => {
        pos.set(p.x, 0, p.z);
        scl.set(p.sx, t.height, p.sz);
        m.compose(pos, q, scl);
        mesh.setMatrixAt(n, m);
        const v = 0.95 + (((p.i * 31 + p.j * 17) % 9) / 9) * 0.1;
        tint.setHex(style.color).multiplyScalar(v);
        mesh.setColorAt(n, tint);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.group.add(mesh);

      // Remate oscuro sobre los muros (estilo maqueta con muros cortados).
      if (style.cap) {
        const capMat = withCutaway(new THREE.MeshStandardMaterial({ color: style.cap, roughness: 0.6 }));
        const caps = new THREE.InstancedMesh(box, capMat, pieces.length);
        pieces.forEach((p, n) => {
          pos.set(p.x, t.height, p.z);
          scl.set(p.sx + 0.04, 0.07, p.sz + 0.04);
          m.compose(pos, q, scl);
          caps.setMatrixAt(n, m);
        });
        caps.castShadow = true;
        this.group.add(caps);
      }
    }

    this.buildShopMarkers();
  }

  /**
   * Convierte celdas en cajas. Los tiles finos (muros, vallas, rejas) usan exactamente
   * las cajas de colisión de NavGrid, así lo que se ve y lo que choca coincide siempre.
   */
  buildPieces(ch, cells, style) {
    const { grid } = this;
    const cs = grid.cellSize;
    const pieces = [];
    for (const [i, j] of cells) {
      const k = grid.index(i, j);
      if (grid.collisionInset[k] > 0) {
        for (let b = grid.boxStart[k], end = b + grid.boxCount[k]; b < end; b++) {
          const o = b * 4;
          const [x0, z0, x1, z1] = [grid.boxes[o], grid.boxes[o + 1], grid.boxes[o + 2], grid.boxes[o + 3]];
          pieces.push({ i, j, x: (x0 + x1) / 2, z: (z0 + z1) / 2, sx: x1 - x0, sz: z1 - z0 });
        }
      } else if (style.pole) {
        pieces.push({ i, j, x: grid.centerX(i), z: grid.centerZ(j), sx: 1, sz: 1 });
      } else {
        pieces.push({ i, j, x: grid.centerX(i), z: grid.centerZ(j), sx: cs * 0.96, sz: cs * 0.96 });
      }
    }
    return pieces;
  }

  /** Rejas de calabozo: barrotes verticales cada 16 cm más travesaños arriba y abajo. */
  buildBars(pieces, height, color) {
    const SPACING = 0.16, BAR = 0.045, RAIL = 0.07;
    const bars = [], rails = [];
    for (const p of pieces) {
      const alongX = p.sx >= p.sz;
      const len = alongX ? p.sx : p.sz;
      const n = Math.max(1, Math.round(len / SPACING));
      for (let k = 0; k < n; k++) {
        const o = -len / 2 + (k + 0.5) * (len / n);
        bars.push([alongX ? p.x + o : p.x, alongX ? p.z : p.z + o]);
      }
      for (const y of [0.08, height / 2, height - RAIL / 2]) rails.push({ p, y, alongX, len });
    }
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.6 });
    this.barMaterial = mat; // las rejas cambian de color con el nivel de los calabozos
    const barGeo = new THREE.BoxGeometry(BAR, height, BAR);
    barGeo.translate(0, height / 2, 0);
    const barMesh = new THREE.InstancedMesh(barGeo, mat, bars.length);
    const m = new THREE.Matrix4();
    bars.forEach(([x, z], k) => { m.makeTranslation(x, 0, z); barMesh.setMatrixAt(k, m); });
    const railMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, RAIL, 1), mat, rails.length);
    rails.forEach(({ p, y, alongX, len }, k) => {
      m.makeScale(alongX ? len : RAIL, 1, alongX ? RAIL : len);
      m.setPosition(p.x, y, p.z);
      railMesh.setMatrixAt(k, m);
    });
    for (const mesh of [barMesh, railMesh]) {
      mesh.castShadow = true;
      this.group.add(mesh);
    }
  }

  buildShopMarkers() {
    const { grid } = this;
    // Marcadores de tiendas (provisional): cilindro de color sobre el suelo.
    const shopColors = { armeria: 0xe8b23a, enfermeria: 0xd9473b, almacen: 0x3a7be8, despacho: 0x9b59d0 };
    const geo = new THREE.CylinderGeometry(0.4, 0.4, 0.05, 20);
    for (const [name, list] of Object.entries(grid.shops)) {
      const mat = new THREE.MeshStandardMaterial({ color: shopColors[name], emissive: shopColors[name], emissiveIntensity: 0.4 });
      for (const { i, j } of list) {
        const marker = new THREE.Mesh(geo, mat);
        marker.position.set(grid.centerX(i), 0.03, grid.centerZ(j));
        marker.name = `tienda-${name}`;
        this.group.add(marker);
      }
    }
  }
}
