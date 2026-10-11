// Generador del mapa de la comisaría: node tools/genmap.cjs → src/data/map.json
// El exterior (calles, valla, aparcamiento, patio) se dibuja aquí; el EDIFICIO sale de
// src/data/station.json (salas, puertas, muebles y baldosas especiales). Para mover o añadir
// una sala basta con editar station.json y volver a ejecutar este script.
const fs = require('fs');
const path = require('path');
const station = require('../src/data/station.json');

const N = 80;
const g = Array.from({ length: N }, () => Array(N).fill(' '));
const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y][x] = c; };
const set = (x, y, c) => { g[y][x] = c; };
const box = (x0, y0, x1, y1, c) => { rect(x0, y0, x1, y0, c); rect(x0, y1, x1, y1, c); rect(x0, y0, x0, y1, c); rect(x1, y0, x1, y1, c); };

// ---------------------------------------------------------------- exterior
// Calles perimetrales (banda de 6)
rect(0, 0, 79, 79, '_'); rect(6, 6, 73, 73, ' ');
// Interior del recinto: asfalto con céspedes
rect(9, 9, 70, 63, '_');
rect(9, 15, 13, 36, ' ');            // césped oeste
rect(65, 15, 70, 22, ' ');           // césped noreste
rect(65, 28, 70, 36, ' ');           // césped sureste
rect(29, 64, 34, 73, '_');           // camino del portón a la calle
// Valla perimetral x8..71, y8..64
box(8, 8, 71, 64, '=');
rect(30, 64, 33, 64, '_');           // portón de vehículos sur (4)
rect(71, 24, 71, 27, '_');           // entrada peatonal este (4)
rect(8, 10, 8, 13, ' ');             // hueco roto noroeste (4)

// ---------------------------------------------------------------- edificio (station.json)
const [bx0, by0, bx1, by1] = station.building;
rect(bx0, by0, bx1, by1, '#');
const rooms = station.rooms.filter((r) => r.rect);
for (const r of rooms) { const [x0, y0, x1, y1] = r.rect; rect(x0, y0, x1, y1, '.'); }
for (const r of rooms) {
  const [x0, y0, x1, y1] = r.rect;
  for (const d of r.doors ?? []) {
    const w = d.w ?? 2;
    if (d.wall === 'N' || d.wall === 'S') {
      const y = d.wall === 'N' ? y0 - 1 : y1 + 1;
      rect(x0 + d.at, y, x0 + d.at + w - 1, y, 'D');
    } else {
      const x = d.wall === 'W' ? x0 - 1 : x1 + 1;
      rect(x, y0 + d.at, x, y0 + d.at + w - 1, 'D');
    }
  }
  for (const f of r.furniture ?? []) rect(x0 + f.x, y0 + f.y, x0 + f.x + (f.w ?? 1) - 1, y0 + f.y + (f.h ?? 1) - 1, 'o');
  for (const t of r.tiles ?? []) rect(x0 + t.x, y0 + t.y, x0 + t.x + (t.w ?? 1) - 1, y0 + t.y + (t.h ?? 1) - 1, t.ch);
}
// Caminos de asfalto hasta los accesos laterales
rect(64, 23, 70, 26, '_');

// ---------------------------------------------------------------- mobiliario exterior ('o')
rect(43, 10, 44, 10, 'o');           // transformador (patio norte)
rect(35, 61, 36, 62, 'o');           // caseta del portón
rect(38, 47, 39, 48, 'o');           // torre de vigilancia del patio sur
set(31, 39, 'o'); set(37, 39, 'o');  // mástiles de bandera junto a la entrada
rect(66, 19, 68, 19, 'o'); rect(66, 33, 68, 33, 'o'); rect(10, 31, 12, 31, 'o'); // bancos
for (const [x, y] of [[11, 18], [12, 28], [67, 16], [69, 21], [66, 30], [69, 35], [10, 35]]) set(x, y, 'o'); // árboles

// Contenedores (patio trasero)
rect(14, 9, 16, 10, 'k'); rect(48, 9, 50, 10, 'k'); rect(60, 9, 62, 10, 'k');
// Coches (parking)
for (const [x, y] of [[14, 42], [20, 42], [14, 50], [20, 50], [52, 42], [58, 50]]) rect(x, y, x + 3, y + 1, 'c');
// Farolas
for (const [x, y] of [[26, 40], [52, 40], [26, 56], [52, 56], [30, 11], [66, 11], [29, 66], [40, 3], [40, 76], [3, 40], [76, 40], [3, 10], [76, 10], [3, 70], [76, 70]]) set(x, y, 'L');
// Puntos de aparición
for (const [x, y] of [[20, 2], [60, 2], [15, 77], [62, 77], [2, 25], [2, 55], [77, 25], [77, 55]]) set(x, y, 'S');

// Sitio de las torres de los accesos (despacho.json → torreta_tejado.gateTowers, torre de
// vigilancia III): siempre libre de mobiliario, aunque la torre solo exista con la mejora.
const GT = require('../src/data/despacho.json').upgrades.torreta_tejado.gateTowers;
for (const { x, z } of GT.spots) {
  for (let y = z; y < z + GT.size; y++) for (let i = x; i < x + GT.size; i++) if (g[y][i] !== ' ' && g[y][i] !== '_') g[y][i] = '_';
}

const rows = g.map((r) => r.join(''));
fs.writeFileSync(path.join(__dirname, '..', 'src', 'data', 'map.json'), JSON.stringify({ name: 'Comisaría del Distrito 13', rows }, null, 2) + '\n');
console.log(rows.join('\n'));
