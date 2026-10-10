import * as THREE from 'three';

// Atlas de sprites dibujado por código (Canvas 2D): rótulos, carteles, pantallas, banderas…
// Un único material con esta textura sirve a todos los rótulos del mapa (1 draw call).
// En Node (tests) no hay `document`: el diseño del atlas (rectángulos y UV) se calcula igual,
// solo se omite la textura.

export const ATLAS_SIZE = 2048;
const PAD = 4;
const FONT = '"Arial Black", "Segoe UI", Arial, sans-serif';

const SPRITES = {};
const def = (name, w, h, draw) => { SPRITES[name] = { w, h, draw }; };

// ---------- utilidades de dibujo ----------
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function fitText(ctx, s, cx, cy, maxW, px, color, weight = 'bold') {
  let size = px;
  ctx.font = `${weight} ${size}px ${FONT}`;
  while (ctx.measureText(s).width > maxW && size > 8) { size -= 2; ctx.font = `${weight} ${size}px ${FONT}`; }
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(s, cx, cy);
}
function star(ctx, cx, cy, r, color, points = 5) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const rad = i % 2 ? r * 0.45 : r;
    ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fill();
}
function plate(name, w, h, bg, fg, text, opts = {}) {
  def(name, w, h, (ctx) => {
    rr(ctx, 0, 0, w, h, opts.radius ?? 14);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.lineWidth = opts.border ?? 6;
    ctx.strokeStyle = opts.edge ?? fg;
    rr(ctx, 8, 8, w - 16, h - 16, 8);
    ctx.stroke();
    const left = opts.icon ? h * 0.9 : 0;
    if (opts.icon) opts.icon(ctx, h * 0.5 + 6, h / 2, h * 0.34);
    if (Array.isArray(text)) {
      fitText(ctx, text[0], left + (w - left) / 2, h * 0.36, w - left - 40, h * 0.34, fg);
      fitText(ctx, text[1], left + (w - left) / 2, h * 0.72, w - left - 40, h * 0.3, opts.fg2 ?? fg);
    } else {
      fitText(ctx, text, left + (w - left) / 2, h / 2 + 2, w - left - 40, h * 0.5, fg);
    }
  });
}
function redCross(ctx, cx, cy, r, bg = '#fff', fg = '#d9372f') {
  ctx.fillStyle = bg;
  rr(ctx, cx - r, cy - r, r * 2, r * 2, r * 0.25);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.fillRect(cx - r * 0.25, cy - r * 0.75, r * 0.5, r * 1.5);
  ctx.fillRect(cx - r * 0.75, cy - r * 0.25, r * 1.5, r * 0.5);
}
function face(ctx, x, y, w, h, skin, hair) {
  ctx.fillStyle = hair;
  ctx.fillRect(x + w * 0.18, y + h * 0.08, w * 0.64, h * 0.3);
  ctx.fillStyle = skin;
  ctx.fillRect(x + w * 0.22, y + h * 0.22, w * 0.56, h * 0.5);
  ctx.fillStyle = '#222';
  ctx.fillRect(x + w * 0.33, y + h * 0.4, w * 0.1, h * 0.07);
  ctx.fillRect(x + w * 0.57, y + h * 0.4, w * 0.1, h * 0.07);
  ctx.fillRect(x + w * 0.4, y + h * 0.58, w * 0.2, h * 0.04);
  ctx.fillStyle = '#394a6b';
  ctx.fillRect(x + w * 0.1, y + h * 0.75, w * 0.8, h * 0.25);
}
const SKINS = ['#e2b48c', '#c68c62', '#f0cba8', '#a8734a', '#d9a47a'];
const HAIRS = ['#2a1e16', '#5a3a22', '#161616', '#8a5a2b', '#b7a58c'];

// ---------- rótulos ----------
plate('policia', 512, 160, '#1f3260', '#ffffff', 'POLICÍA', { icon: (c, x, y, r) => star(c, x, y, r, '#eab43c') });
plate('comisaria', 768, 256, '#1f3260', '#ffffff', ['COMISARÍA', 'DISTRITO 13'], {
  fg2: '#eab43c',
  icon: (c, x, y, r) => {
    c.fillStyle = '#eab43c';
    c.beginPath(); c.moveTo(x - r, y - r); c.lineTo(x + r, y - r); c.lineTo(x + r, y + r * 0.2); c.lineTo(x, y + r * 1.1); c.lineTo(x - r, y + r * 0.2); c.closePath(); c.fill();
    star(c, x, y - r * 0.1, r * 0.6, '#1f3260');
  },
});
plate('atencion', 640, 128, '#2f5fa8', '#ffffff', ['ATENCIÓN AL CIUDADANO', '(SOLO VIVOS)'], { fg2: '#f2c14e' });
plate('denuncias', 640, 128, '#3b7a55', '#ffffff', ['DENUNCIAS', 'SOLO CON CITA PREVIA'], { fg2: '#f2c14e' });
plate('armeria', 512, 160, '#46201f', '#f2c14e', 'ARMERÍA', {
  icon: (c, x, y, r) => { c.fillStyle = '#f2c14e'; c.fillRect(x - r, y - r * 0.2, r * 2, r * 0.45); c.fillRect(x - r * 0.1, y, r * 0.5, r * 0.9); c.fillRect(x + r * 0.6, y - r * 0.5, r * 0.4, r * 0.5); },
});
plate('enfermeria', 512, 160, '#f4f1ea', '#2f7d55', 'ENFERMERÍA', { icon: (c, x, y, r) => redCross(c, x, y, r) });
plate('almacen', 640, 160, '#c89c62', '#3a2412', ['ALMACÉN DE', 'PRUEBAS'], { border: 5 });
plate('calabozos', 512, 160, '#3a3d42', '#f0a04b', 'CALABOZOS');
plate('oficinas', 512, 160, '#2f5fa8', '#ffffff', 'OFICINAS');
plate('comisario', 512, 160, '#5e3d26', '#eab43c', 'COMISARIO', { icon: (c, x, y, r) => star(c, x, y, r, '#eab43c') });
plate('seguridad', 320, 100, '#2f5fa8', '#ffffff', 'SEGURIDAD', { border: 4 });
plate('solo_policia', 256, 256, '#1f3260', '#ffffff', ['SOLO', 'POLICÍA'], { fg2: '#eab43c' });
plate('acceso', 512, 128, '#d24a3e', '#ffffff', 'ACCESO RESTRINGIDO');
plate('policia_lado', 512, 100, '#1f3260', '#ffffff', 'POLICÍA', { radius: 18, border: 4 });
plate('policia_capo', 256, 90, '#1f3260', '#ffffff', 'POLICÍA', { radius: 12, border: 3 });
plate('municion', 256, 90, '#2b2b30', '#f2c14e', 'MUNICIÓN', { border: 4 });
plate('extintor', 96, 96, '#d24a3e', '#ffffff', 'EXT.', { border: 4 });
// Carteles con humor (negro, de oficina).
plate('no_morder', 640, 180, '#fbf9f1', '#b0271d', ['SE RUEGA NO MORDER', 'AL PERSONAL'], { fg2: '#3b4252' });
def('dias_sin_incidentes', 512, 300, (ctx, w, h) => {
  ctx.fillStyle = '#2f7d55'; rr(ctx, 0, 0, w, h, 14); ctx.fill();
  ctx.fillStyle = '#f7f9fa'; rr(ctx, 12, 12, w - 24, h - 24, 8); ctx.fill();
  fitText(ctx, 'LLEVAMOS', w / 2, 48, w - 60, 34, '#2f7d55');
  ctx.fillStyle = '#20242b'; ctx.fillRect(w / 2 - 70, 78, 140, 120);
  fitText(ctx, '0', w / 2, 140, 120, 104, '#e84a3e');
  fitText(ctx, 'DÍAS SIN INCIDENTES', w / 2, 240, w - 60, 38, '#2f7d55');
});

def('salida', 320, 140, (ctx, w, h) => {
  rr(ctx, 0, 0, w, h, 14); ctx.fillStyle = '#1f8a4c'; ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 5; rr(ctx, 7, 7, w - 14, h - 14, 9); ctx.stroke();
  fitText(ctx, 'SALIDA', w * 0.58, h / 2 + 2, w * 0.6, h * 0.48, '#fff');
  ctx.fillStyle = '#fff';
  ctx.fillRect(18, h / 2 - 7, 36, 14);
  ctx.beginPath(); ctx.moveTo(60, h / 2 - 24); ctx.lineTo(88, h / 2); ctx.lineTo(60, h / 2 + 24); ctx.closePath(); ctx.fill();
});

def('stop', 128, 128, (ctx, w, h) => {
  ctx.fillStyle = '#d24a3e';
  ctx.beginPath();
  for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + (i * Math.PI) / 4; ctx[i ? 'lineTo' : 'moveTo'](w / 2 + Math.cos(a) * 62, h / 2 + Math.sin(a) * 62); }
  ctx.closePath(); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 5; ctx.stroke();
  fitText(ctx, 'STOP', w / 2, h / 2 + 2, 96, 40, '#fff');
});
def('parking', 128, 128, (ctx, w, h) => {
  rr(ctx, 0, 0, w, h, 14); ctx.fillStyle = '#2f5fa8'; ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 5; rr(ctx, 7, 7, w - 14, h - 14, 9); ctx.stroke();
  fitText(ctx, 'P', w / 2, h / 2 + 4, 90, 96, '#fff');
});

// ---------- carteles de pared ----------
def('se_busca', 512, 256, (ctx, w, h) => {
  ctx.fillStyle = '#6b4a2e'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#c9a26a'; ctx.fillRect(10, 10, w - 20, h - 20);
  for (let k = 0; k < 3; k++) {
    const x = 22 + k * 160, y = 24;
    ctx.save();
    ctx.translate(x + 66, y + 100); ctx.rotate((k - 1) * 0.04); ctx.translate(-66, -100);
    ctx.fillStyle = '#f6f0dc'; ctx.fillRect(0, 0, 132, 200);
    fitText(ctx, 'SE BUSCA', 66, 22, 118, 24, '#b0271d');
    face(ctx, 18, 38, 96, 96, SKINS[(k * 2) % 5], HAIRS[(k * 3) % 5]);
    // Delitos de poca monta, de cuando aún había delitos.
    const [l1, l2] = [['EL DEL', 'TÁPER'], ['APARCA EN', 'DOBLE FILA'], ['NO RECICLA', '']][k];
    fitText(ctx, l1, 66, 154, 112, 17, '#333');
    if (l2) fitText(ctx, l2, 66, 175, 112, 17, '#333');
    ctx.fillStyle = '#d24a3e'; ctx.beginPath(); ctx.arc(66, 2, 6, 0, 7); ctx.fill();
    ctx.restore();
  }
});
def('corcho', 512, 384, (ctx, w, h) => {
  ctx.fillStyle = '#5b3d24'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#c4915a'; ctx.fillRect(14, 14, w - 28, h - 28);
  for (let i = 0; i < 700; i++) { ctx.fillStyle = i % 2 ? 'rgba(120,80,40,.35)' : 'rgba(230,190,140,.35)'; ctx.fillRect(14 + ((i * 97) % (w - 28)), 14 + ((i * 53) % (h - 28)), 3, 3); }
  const polaroids = [[40, 40, -0.06], [180, 30, 0.05], [320, 50, -0.03], [70, 200, 0.07], [230, 190, -0.05], [370, 210, 0.04]];
  polaroids.forEach(([x, y, r], k) => {
    ctx.save(); ctx.translate(x + 50, y + 55); ctx.rotate(r); ctx.translate(-50, -55);
    ctx.fillStyle = '#fbfaf3'; ctx.fillRect(0, 0, 100, 118);
    ctx.fillStyle = ['#7aa5c8', '#a8c987', '#d7a96b', '#c4a1d0'][k % 4]; ctx.fillRect(8, 8, 84, 76);
    face(ctx, 12, 10, 76, 72, SKINS[k % 5], HAIRS[(k + 1) % 5]);
    ctx.fillStyle = '#444'; ctx.fillRect(14, 94, 70, 5); ctx.fillRect(14, 104, 44, 5);
    ctx.fillStyle = '#d24a3e'; ctx.beginPath(); ctx.arc(50, 6, 6, 0, 7); ctx.fill();
    ctx.restore();
  });
  ctx.fillStyle = '#f2d85a'; ctx.fillRect(160, 300, 90, 64);
  ctx.fillStyle = '#e8a0a8'; ctx.fillRect(280, 296, 80, 70);
  ctx.fillStyle = '#7a6a2a'; for (let i = 0; i < 4; i++) { ctx.fillRect(170, 312 + i * 12, 70, 3); ctx.fillRect(290, 308 + i * 12, 60, 3); }
});
def('pizarra', 768, 448, (ctx, w, h) => {
  ctx.fillStyle = '#9aa2ab'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#f7f9fa'; ctx.fillRect(14, 14, w - 28, h - 28);
  ctx.fillStyle = '#3b4252'; ctx.font = `bold 34px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText('CASO 13-B', 34, 28);
  const pts = [[150, 170], [380, 130], [610, 190], [250, 330], [520, 340], [690, 320]];
  ctx.strokeStyle = '#d02a2a'; ctx.lineWidth = 3;
  ctx.beginPath(); [0, 1, 2, 5, 4, 3, 0, 4, 1, 3].forEach((n, i) => ctx[i ? 'lineTo' : 'moveTo'](pts[n][0], pts[n][1])); ctx.stroke();
  pts.forEach(([x, y], k) => {
    ctx.fillStyle = '#fff'; ctx.fillRect(x - 48, y - 40, 96, 100);
    ctx.strokeStyle = '#999'; ctx.lineWidth = 2; ctx.strokeRect(x - 48, y - 40, 96, 100);
    face(ctx, x - 40, y - 34, 80, 68, SKINS[k % 5], HAIRS[(k + 2) % 5]);
    ctx.fillStyle = '#333'; ctx.fillRect(x - 38, y + 40, 76, 5);
    ctx.fillStyle = '#d02a2a'; ctx.beginPath(); ctx.arc(x, y - 40, 7, 0, 7); ctx.fill();
  });
  ctx.fillStyle = '#f2d85a'; ctx.fillRect(40, 330, 70, 60); ctx.fillStyle = '#9ad0e8'; ctx.fillRect(640, 60, 70, 60);
  ctx.fillStyle = '#555'; for (let i = 0; i < 4; i++) { ctx.fillRect(48, 340 + i * 12, 54, 3); }
});
def('mapa', 384, 256, (ctx, w, h) => {
  ctx.fillStyle = '#6b4a2e'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#d7e6c4'; ctx.fillRect(8, 8, w - 16, h - 16);
  ctx.fillStyle = '#f7f4e8';
  for (let i = 1; i < 6; i++) { ctx.fillRect(8, 8 + i * 38, w - 16, 10); ctx.fillRect(8 + i * 58, 8, 10, h - 16); }
  ctx.fillStyle = '#9ec7e6'; ctx.fillRect(250, 120, 120, 70);
  ctx.fillStyle = '#c6d9ae'; ctx.fillRect(40, 60, 80, 50);
  ctx.fillStyle = '#1f3260'; ctx.fillRect(176, 106, 36, 28);
  star(ctx, 194, 120, 12, '#eab43c');
  [[90, 200, '#d24a3e'], [300, 50, '#d24a3e'], [140, 40, '#2f5fa8'], [330, 210, '#2f5fa8']].forEach(([x, y, c]) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, 8, 0, 7); ctx.fill(); });
});
def('aviso', 160, 200, (ctx, w, h) => {
  ctx.fillStyle = '#fbf9f1'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#d24a3e'; ctx.fillRect(0, 0, w, 36);
  fitText(ctx, 'AVISO', w / 2, 19, 120, 26, '#fff');
  ctx.fillStyle = '#556'; for (let i = 0; i < 9; i++) ctx.fillRect(14, 54 + i * 15, i % 3 === 2 ? 80 : 130, 5);
});
def('reloj', 128, 128, (ctx, w, h) => {
  ctx.fillStyle = '#fbfaf5'; ctx.beginPath(); ctx.arc(64, 64, 62, 0, 7); ctx.fill();
  ctx.fillStyle = '#222';
  for (let i = 0; i < 12; i++) { const a = (i * Math.PI) / 6; ctx.save(); ctx.translate(64 + Math.sin(a) * 50, 64 - Math.cos(a) * 50); ctx.rotate(a); ctx.fillRect(-2.5, -(i % 3 ? 5 : 9), 5, i % 3 ? 10 : 18); ctx.restore(); }
  ctx.strokeStyle = '#222'; ctx.lineCap = 'round';
  ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(64, 64); ctx.lineTo(64 - 20, 64 - 24); ctx.stroke();
  ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(64, 64); ctx.lineTo(64 + 38, 64 - 22); ctx.stroke();
  ctx.strokeStyle = '#d24a3e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(64, 64); ctx.lineTo(64 - 6, 64 + 40); ctx.stroke();
  ctx.fillStyle = '#d24a3e'; ctx.beginPath(); ctx.arc(64, 64, 6, 0, 7); ctx.fill();
});
def('escudo', 256, 320, (ctx, w, h) => {
  ctx.fillStyle = '#eab43c';
  ctx.beginPath(); ctx.moveTo(14, 14); ctx.lineTo(w - 14, 14); ctx.lineTo(w - 14, h * 0.55); ctx.quadraticCurveTo(w - 20, h * 0.85, w / 2, h - 10); ctx.quadraticCurveTo(20, h * 0.85, 14, h * 0.55); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#1f3260';
  ctx.beginPath(); ctx.moveTo(32, 32); ctx.lineTo(w - 32, 32); ctx.lineTo(w - 32, h * 0.54); ctx.quadraticCurveTo(w - 38, h * 0.8, w / 2, h - 34); ctx.quadraticCurveTo(38, h * 0.8, 32, h * 0.54); ctx.closePath(); ctx.fill();
  star(ctx, w / 2, h * 0.34, 62, '#eab43c');
  fitText(ctx, 'POLICÍA', w / 2, h * 0.62, w - 90, 36, '#fff');
  fitText(ctx, 'D-13', w / 2, h * 0.73, w - 120, 34, '#eab43c');
});
def('bandera_es', 384, 256, (ctx, w, h) => {
  ctx.fillStyle = '#c8302c'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#f4c430'; ctx.fillRect(0, h / 4, w, h / 2);
  ctx.fillStyle = '#b0392b'; ctx.fillRect(w * 0.16, h * 0.34, 36, 56);
  ctx.fillStyle = '#7d3b2a'; ctx.fillRect(w * 0.16 + 6, h * 0.34 + 8, 24, 22);
});
def('bandera_pol', 384, 256, (ctx, w, h) => {
  ctx.fillStyle = '#1f3260'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#eab43c'; ctx.fillRect(0, h - 30, w, 14);
  star(ctx, w / 2, h * 0.42, 74, '#eab43c');
  fitText(ctx, 'POLICÍA', w / 2, h * 0.82 - 14, w - 80, 40, '#fff');
});
def('cruz', 128, 128, (ctx) => { redCross(ctx, 64, 64, 60); });
def('botiquin', 160, 160, (ctx, w, h) => {
  rr(ctx, 0, 0, w, h, 14); ctx.fillStyle = '#f7f7f2'; ctx.fill();
  ctx.fillStyle = '#2fa05a'; ctx.fillRect(w / 2 - 14, 22, 28, 70); ctx.fillRect(w / 2 - 35, 43, 70, 28);
  fitText(ctx, 'BOTIQUÍN', w / 2, h - 28, w - 20, 24, '#2fa05a');
});
def('cuadro_elec', 128, 160, (ctx, w, h) => {
  rr(ctx, 0, 0, w, h, 8); ctx.fillStyle = '#8f98a2'; ctx.fill();
  ctx.fillStyle = '#f4c430'; ctx.beginPath(); ctx.moveTo(w / 2, 14); ctx.lineTo(w - 22, 100); ctx.lineTo(22, 100); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#222'; ctx.beginPath(); ctx.moveTo(w / 2 + 4, 34); ctx.lineTo(w / 2 - 14, 72); ctx.lineTo(w / 2 - 1, 72); ctx.lineTo(w / 2 - 6, 92); ctx.lineTo(w / 2 + 16, 56); ctx.lineTo(w / 2 + 2, 56); ctx.closePath(); ctx.fill();
  fitText(ctx, 'ELÉCTRICO', w / 2, 132, w - 12, 20, '#222');
});
def('alarma', 96, 128, (ctx, w, h) => {
  rr(ctx, 0, 0, w, h, 8); ctx.fillStyle = '#c92f26'; ctx.fill();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(w / 2, 50, 30, 0, 7); ctx.fill();
  ctx.fillStyle = '#e8281d'; ctx.beginPath(); ctx.arc(w / 2, 50, 24, 0, 7); ctx.fill();
  fitText(ctx, 'ALARMA', w / 2, 102, w - 8, 18, '#fff');
});
def('medicion', 192, 512, (ctx, w, h) => {
  ctx.fillStyle = '#f2efe4'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#222';
  for (let i = 0; i <= 34; i++) {
    const y = 12 + i * ((h - 24) / 34);
    const big = i % 2 === 0;
    ctx.fillRect(w * 0.12, y - (big ? 3 : 1.5), w * (big ? 0.76 : 0.45), big ? 6 : 3);
    if (big) { ctx.font = `bold 20px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(String(210 - i * 5), w * 0.62, y - 12); }
  }
  ctx.fillStyle = '#d24a3e'; ctx.fillRect(0, 0, w, 6); ctx.fillRect(0, h - 6, w, 6);
});

// ---------- pantallas (emisivas) ----------
def('pantalla_pc', 160, 96, (ctx, w, h) => {
  const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#78c0f2'); g.addColorStop(1, '#3a78d0');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#f4f7fa'; ctx.fillRect(14, 10, 84, 58); ctx.fillStyle = '#2f5fa8'; ctx.fillRect(14, 10, 84, 10);
  ctx.fillStyle = '#9ab'; for (let i = 0; i < 4; i++) ctx.fillRect(20, 28 + i * 9, i % 2 ? 50 : 66, 4);
  ctx.fillStyle = '#e8b23a'; ctx.fillRect(108, 14, 38, 26); ctx.fillStyle = '#4fa06a'; ctx.fillRect(108, 46, 38, 22);
  ctx.fillStyle = '#1b2a44'; ctx.fillRect(0, h - 12, w, 12);
});
def('pantalla_cam', 256, 160, (ctx, w, h) => {
  ctx.fillStyle = '#05100a'; ctx.fillRect(0, 0, w, h);
  const cols = ['#3d5a45', '#44564d', '#4a5a3d', '#3a4d55'];
  for (let k = 0; k < 4; k++) {
    const x = 4 + (k % 2) * 126, y = 4 + ((k / 2) | 0) * 78;
    ctx.fillStyle = cols[k]; ctx.fillRect(x, y, 122, 74);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(x + 8, y + 36, 40 + k * 8, 38); ctx.fillRect(x + 70, y + 20, 36, 54);
    ctx.fillStyle = 'rgba(255,255,255,.12)'; for (let i = 0; i < 14; i++) ctx.fillRect(x, y + i * 5.5, 122, 1);
    ctx.fillStyle = '#d6f5d8'; ctx.font = `bold 11px monospace`; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(`CAM ${k + 1}`, x + 5, y + 4);
    ctx.fillStyle = '#ff4a3a'; ctx.beginPath(); ctx.arc(x + 112, y + 9, 3.5, 0, 7); ctx.fill();
  }
});
def('pantalla_radio', 128, 80, (ctx, w, h) => {
  ctx.fillStyle = '#08210f'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#59f08a'; ctx.lineWidth = 2; ctx.beginPath();
  for (let x = 0; x < w; x += 2) { const y = h / 2 + Math.sin(x * 0.25) * Math.sin(x * 0.04) * 22; ctx[x ? 'lineTo' : 'moveTo'](x, y); }
  ctx.stroke();
  ctx.fillStyle = '#59f08a'; ctx.font = `bold 12px monospace`; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText('CH 13  ■', 6, 4);
});
def('panel_radio', 256, 96, (ctx, w, h) => {
  ctx.fillStyle = '#2a2f36'; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 6; i++) { ctx.fillStyle = '#9aa3ad'; ctx.beginPath(); ctx.arc(24 + i * 38, 30, 13, 0, 7); ctx.fill(); ctx.fillStyle = '#222'; ctx.fillRect(22 + i * 38, 20, 4, 11); }
  for (let i = 0; i < 12; i++) { ctx.fillStyle = ['#59f08a', '#f4c430', '#ff4a3a'][i % 3]; ctx.fillRect(14 + i * 20, 62, 12, 10); }
});
def('vending_front', 192, 384, (ctx, w, h) => {
  ctx.fillStyle = '#c92f26'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#1b2230'; ctx.fillRect(14, 14, 120, 300);
  const cols = ['#e8b23a', '#4fa06a', '#2f5fa8', '#e07a3a', '#e8a0a8', '#8a6fb0'];
  for (let r = 0; r < 6; r++) {
    ctx.fillStyle = '#5a6270'; ctx.fillRect(14, 14 + 50 * r + 40, 120, 4);
    for (let c = 0; c < 4; c++) { ctx.fillStyle = cols[(r * 2 + c) % 6]; ctx.fillRect(20 + c * 28, 14 + 50 * r + 8, 22, 32); }
  }
  ctx.fillStyle = '#e9e9e4'; ctx.fillRect(144, 20, 38, 56);
  ctx.fillStyle = '#222'; for (let i = 0; i < 9; i++) ctx.fillRect(148 + (i % 3) * 12, 100 + ((i / 3) | 0) * 14, 8, 8);
  ctx.fillStyle = '#59f08a'; ctx.fillRect(148, 30, 30, 12);
  ctx.fillStyle = '#111'; ctx.fillRect(148, 90 + 60, 28, 6); ctx.fillRect(20, 330, 150, 30);
  fitText(ctx, 'SNACKS', 95, 372, 120, 18, '#fff');
});
def('cafe_panel', 128, 96, (ctx, w, h) => {
  ctx.fillStyle = '#23262c'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#59f08a'; ctx.fillRect(14, 12, 54, 20);
  [['#e8b23a', 82, 14], ['#d24a3e', 82, 38], ['#4aa0e8', 82, 62], ['#e9e9e4', 18, 52]].forEach(([c, x, y]) => { ctx.fillStyle = c; ctx.fillRect(x, y, 26, 16); });
});

// ---------- API ----------
const names = Object.keys(SPRITES).sort((a, b) => SPRITES[b].h - SPRITES[a].h);
{
  let x = PAD, y = PAD, rowH = 0;
  for (const n of names) {
    const s = SPRITES[n];
    if (x + s.w + PAD > ATLAS_SIZE) { x = PAD; y += rowH + PAD; rowH = 0; }
    s.x = x; s.y = y; x += s.w + PAD; rowH = Math.max(rowH, s.h);
  }
  if (y + rowH + PAD > ATLAS_SIZE) throw new Error('El atlas de props no cabe en 2048×2048');
}

export const SPRITE_NAMES = names;
export function spriteExists(name) { return !!SPRITES[name]; }
/** Relación de aspecto (ancho/alto) del sprite. */
export function spriteAspect(name) { const s = SPRITES[name]; return s.w / s.h; }
/** [u0, v0(abajo), u1, v1(arriba)] del sprite (mitad de texel de margen). */
export function spriteUV(name) {
  const s = SPRITES[name];
  if (!s) throw new Error(`Sprite desconocido: ${name}`);
  const m = 0.75; // margen en píxeles para no sangrar con el sprite vecino
  return [(s.x + m) / ATLAS_SIZE, 1 - (s.y + s.h - m) / ATLAS_SIZE, (s.x + s.w - m) / ATLAS_SIZE, 1 - (s.y + m) / ATLAS_SIZE];
}

/** Textura del atlas, o null si no hay DOM (tests en Node). */
export function createAtlasTexture() {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = ATLAS_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  for (const n of names) {
    const s = SPRITES[n];
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.beginPath(); ctx.rect(0, 0, s.w, s.h); ctx.clip();
    s.draw(ctx, s.w, s.h);
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}
