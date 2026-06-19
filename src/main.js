// ============================================================================
// main.js — entry point. Boots the game and loads assets.
// ============================================================================
import { Game } from './game.js';

const container = document.getElementById('app');
const game = new Game(container);
window.__GAME__ = game; // handy for debugging in the console

game.load().catch((err) => {
  console.error(err);
  const t = document.getElementById('load-text');
  if (t) t.textContent = 'Failed to load assets: ' + err.message;
});
