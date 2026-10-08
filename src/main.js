import { Game } from './core/Game.js';

const game = new Game({
  canvas: document.getElementById('game-canvas'),
  uiRoot: document.getElementById('ui-root'),
});

// Acceso para depuración y para el agente de QA.
window.__game = game;
