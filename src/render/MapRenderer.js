import * as THREE from 'three';
import { withCutaway } from './Cutaway.js';

// Blockout del mapa a partir de la rejilla: un plano de suelo con textura por celda
// (1 draw call) y un InstancedMesh por tipo de obstáculo. En la fase 6 se sustituye por assets.

// Paleta "maqueta": tonos claros y suaves (referencia visual de Carlos).
const FLOOR_COLORS = {
  hierba: [0x9cbb72, 0x9fbe75, 0x99b870],
  asfalto: [0x9a9ca1, 0x9c9ea3, 0x989a9f],
  interior: [0xe9e4d9, 0xb9b2a5], // damero de baldosas suave
};
const TEX_RES = 2; // píxeles de textura por celda (damero de 50 cm)

const BLOCK_STYLE = {
  '#': { color: 0xeee5d3, cutaway: true, cap: 0x2b2b30, wallThickness: 0.3 },
  '=': { color: 0xb8bec4, thin: 0.12 },
  '|': { color: 0x3a3d42, thin: 0.15 },
  'c': { color: 0x2c4f8c, cutaway: true },
  'k': { color: 0x3f7a5a, cutaway: true },
  'o': { color: 0xc49a6c },
  'L': { color: 0x3a3a3e, pole: true },
};

export class MapRenderer {
  constructor(scene, grid) {
    this.scene = scene;
    this.grid = grid;
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
    const c = new THREE.Color();
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const i = (x / TEX_RES) | 0, j = (y / TEX_RES) | 0;
        const t = grid.tiles[grid.chars[grid.index(i, j)]];
        const palette = FLOOR_COLORS[t.floor] ?? FLOOR_COLORS.hierba;
        let v;
        if (t.floor === 'interior') v = palette[(x + y) & 1];
        else v = palette[(i * 7 + j * 13 + ((i * j) % 5)) % palette.length]; // variación estable por celda
        c.setHex(v);
        // El mapa ASCII tiene la fila 0 al norte; la textura se rellena de abajo arriba.
        const k = ((th - 1 - y) * tw + x) * 4;
        data[k] = c.r * 255; data[k + 1] = c.g * 255; data[k + 2] = c.b * 255; data[k + 3] = 255;
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
        if (!BLOCK_STYLE[ch]) continue;
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
   * Convierte celdas en cajas. Los muros se dibujan como tabiques finos que conectan
   * con sus vecinos (la colisión sigue siendo la celda completa); vallas y rejas son
   * finas según su orientación; el resto ocupa la celda entera.
   */
  buildPieces(ch, cells, style) {
    const { grid } = this;
    const cs = grid.cellSize;
    const same = (i, j) => grid.inBounds(i, j) && grid.chars[grid.index(i, j)] === ch;
    const pieces = [];
    for (const [i, j] of cells) {
      const cx = grid.centerX(i), cz = grid.centerZ(j);
      if (style.wallThickness) {
        const th = style.wallThickness, half = th / 2;
        const e = same(i + 1, j), w = same(i - 1, j), s = same(i, j + 1), n = same(i, j - 1);
        if (e || w) {
          const x0 = w ? cx - cs / 2 : cx - half, x1 = e ? cx + cs / 2 : cx + half;
          pieces.push({ i, j, x: (x0 + x1) / 2, z: cz, sx: x1 - x0, sz: th });
        }
        if (n || s) {
          const z0 = n ? cz - cs / 2 : cz - half, z1 = s ? cz + cs / 2 : cz + half;
          pieces.push({ i, j, x: cx, z: (z0 + z1) / 2, sx: th, sz: z1 - z0 });
        }
        if (!(e || w || n || s)) pieces.push({ i, j, x: cx, z: cz, sx: th, sz: th });
      } else if (style.thin) {
        const horiz = same(i + 1, j) || same(i - 1, j);
        const vert = same(i, j + 1) || same(i, j - 1);
        pieces.push({ i, j, x: cx, z: cz, sx: vert && !horiz ? style.thin : cs, sz: horiz && !vert ? style.thin : cs });
      } else if (style.pole) {
        pieces.push({ i, j, x: cx, z: cz, sx: 1, sz: 1 });
      } else {
        pieces.push({ i, j, x: cx, z: cz, sx: cs * 0.96, sz: cs * 0.96 });
      }
    }
    return pieces;
  }

  buildShopMarkers() {
    const { grid } = this;
    // Marcadores de tiendas (provisional): cilindro de color sobre el suelo.
    const shopColors = { armeria: 0xe8b23a, enfermeria: 0xd9473b, almacen: 0x3a7be8 };
    for (const [name, list] of Object.entries(grid.shops)) {
      for (const { i, j } of list) {
        const marker = new THREE.Mesh(
          new THREE.CylinderGeometry(0.4, 0.4, 0.05, 20),
          new THREE.MeshStandardMaterial({ color: shopColors[name], emissive: shopColors[name], emissiveIntensity: 0.4 }),
        );
        marker.position.set(grid.centerX(i), 0.03, grid.centerZ(j));
        marker.name = `tienda-${name}`;
        this.group.add(marker);
      }
    }
  }
}
