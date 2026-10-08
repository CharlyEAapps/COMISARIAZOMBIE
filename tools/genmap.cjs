// Generador del mapa de la comisaría: node tools/genmap.cjs → src/data/map.json
const fs = require('fs');
const N = 80;
const g = Array.from({ length: N }, () => Array(N).fill(' '));
const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y][x] = c; };
const set = (x, y, c) => { g[y][x] = c; };
const box = (x0, y0, x1, y1, c) => { rect(x0, y0, x1, y0, c); rect(x0, y1, x1, y1, c); rect(x0, y0, x0, y1, c); rect(x1, y0, x1, y1, c); };

// Calles perimetrales (banda de 6)
rect(0, 0, 79, 79, '_'); rect(6, 6, 73, 73, ' ');
// Interior del recinto: asfalto con céspedes
rect(9, 9, 70, 63, '_');
rect(9, 15, 20, 34, ' ');            // césped oeste
rect(57, 15, 70, 21, ' ');           // césped noreste
rect(57, 30, 70, 35, ' ');           // césped sureste
rect(29, 64, 34, 73, '_');           // camino del portón a la calle
// Valla perimetral x8..71, y8..64
box(8, 8, 71, 64, '=');
rect(30, 64, 33, 64, '_');           // portón de vehículos sur (4)
rect(71, 24, 71, 27, '_');           // entrada peatonal este (4)
rect(8, 10, 8, 13, ' ');             // hueco roto noroeste (4)
rect(57, 24, 70, 27, '_');           // camino a la puerta lateral

// Edificio 34x22: x22..55, y14..35
rect(22, 14, 55, 35, '#');
rect(23, 15, 54, 34, '.');
// Pasillo central y24..27 x23..54
// Muros interiores
rect(23, 23, 54, 23, '#'); rect(23, 28, 54, 28, '#');
rect(33, 15, 33, 22, '#'); rect(44, 15, 44, 22, '#');
rect(32, 29, 32, 34, '#'); rect(45, 29, 45, 34, '#');
// Puertas interiores (2 celdas)
rect(27, 23, 28, 23, 'D'); rect(38, 23, 39, 23, 'D'); rect(49, 23, 50, 23, 'D');
rect(26, 28, 27, 28, 'D'); rect(38, 28, 39, 28, 'D'); rect(49, 28, 50, 28, 'D');
rect(33, 20, 33, 21, 'D'); rect(44, 20, 44, 21, 'D');
rect(32, 32, 32, 33, 'D'); rect(45, 32, 45, 33, 'D');
// Puertas exteriores
rect(38, 35, 39, 35, 'D'); rect(38, 14, 39, 14, 'D'); rect(55, 25, 55, 26, 'D');

// Calabozos
rect(27, 15, 27, 18, '|'); rect(30, 15, 30, 18, '|');
// Oficinas norte
for (const [x, y] of [[36, 17], [40, 17], [36, 20], [40, 20]]) rect(x, y, x + 1, y, 'o');
// Armería
set(52, 16, 'A'); rect(51, 17, 53, 17, 'o');
// Recepción
rect(35, 31, 37, 31, 'o'); rect(40, 31, 42, 31, 'o');
rect(34, 34, 36, 34, 'o'); rect(41, 34, 43, 34, 'o');
set(38, 33, 'P');
// Enfermería
set(24, 31, 'M'); rect(25, 30, 25, 32, 'o'); rect(28, 34, 31, 34, 'o');
// Almacén de pruebas
set(52, 30, 'W'); rect(50, 31, 52, 31, 'o'); rect(48, 34, 53, 34, 'o');

// Contenedores (patio trasero)
rect(14, 9, 16, 10, 'k'); rect(46, 9, 48, 10, 'k'); rect(60, 9, 62, 10, 'k');
// Coches (parking)
for (const [x, y] of [[14, 42], [20, 42], [14, 50], [20, 50], [52, 42], [58, 50]]) rect(x, y, x + 3, y + 1, 'c');
// Farolas
for (const [x, y] of [[26, 38], [52, 38], [26, 56], [52, 56], [30, 11], [66, 11], [29, 66], [40, 3], [40, 76], [3, 40], [76, 40], [3, 10], [76, 10], [3, 70], [76, 70]]) set(x, y, 'L');
// Puntos de aparición
for (const [x, y] of [[20, 2], [60, 2], [15, 77], [62, 77], [2, 25], [2, 55], [77, 25], [77, 55]]) set(x, y, 'S');

const rows = g.map(r => r.join(''));
fs.writeFileSync(require('path').join(__dirname, '..', 'src', 'data', 'map.json'), JSON.stringify({ name: 'Comisaría del Distrito 13', rows }, null, 2) + '\n');
console.log(rows.join('\n'));
