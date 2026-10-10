import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Rutas relativas ('./'): el build funciona igual en la raíz (Netlify) que en una subruta
// (GitHub Pages: /turno-de-noche/) sin tocar nada.
const BASE = './';

/** Inyecta en dist/sw.js la lista de archivos a precachear (relativos al scope del service worker). */
function swPrecache() {
  const walk = (dir, root = dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full, root) : [path.relative(root, full).split(path.sep).join('/')];
  });
  return {
    name: 'tdn-sw-precache',
    apply: 'build',
    writeBundle(options) {
      const out = options.dir;
      const swPath = path.join(out, 'sw.js');
      if (!out || !fs.existsSync(swPath)) return;
      const files = walk(out).filter((f) => f !== 'sw.js' && !f.endsWith('.map'));
      const audio = files.filter((f) => f.startsWith('audio/'));
      const core = ['./', ...files.filter((f) => !f.startsWith('audio/'))];
      const list = JSON.stringify({ core, audio });
      const src = fs.readFileSync(swPath, 'utf8');
      const next = src.replace(/\/\*PRECACHE_LIST\*\/[\s\S]*?\/\*END_PRECACHE_LIST\*\//, () => list);
      if (next === src) throw new Error('sw.js: no se encontró el marcador PRECACHE_LIST');
      fs.writeFileSync(swPath, next);
    },
  };
}

export default defineConfig({
  base: BASE,
  plugins: [swPrecache()],
});
