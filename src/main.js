import { Game } from './core/Game.js';

const game = new Game({
  canvas: document.getElementById('game-canvas'),
  uiRoot: document.getElementById('ui-root'),
});

// Acceso para depuración y para el agente de QA.
window.__game = game;

// PWA: service worker solo en producción (en dev estorbaría con la caché) y con ruta relativa,
// para que valga tanto en la raíz como en una subruta (GitHub Pages).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    try {
      console.warn('SWREG'); navigator.serviceWorker.register('./sw.js').then(r=>console.warn('SWOK',r.scope)).catch((e) => console.warn('Service worker:', e));
    } catch (e) {
      console.warn('Service worker:', e);
    }
  });
}
