# ⚔️ Medieval Siege — Hex Tower Defense

A 3D, browser-based **wave / tower-defense** game inspired by **Kingshot's "Rebel Invasion"
defense mode** — rebel hordes march down a winding road toward your castle, and you build
and upgrade turrets (including **Frost towers that slow them to a crawl**) to stop them.

Built with **Three.js** and the **KayKit – Medieval Hexagon Pack** (CC0) low-poly 3D assets.

![tiles](https://img.shields.io/badge/engine-three.js-blue) ![assets](https://img.shields.io/badge/assets-KayKit%20CC0-green)

---

## ▶️ Run it

```bash
npm install      # installs three + vite
npm run dev      # start the dev server, then open the printed URL
```

Other commands:

```bash
npm run build    # production build to dist/
npm run preview  # serve the production build
npm test         # run the logic unit tests (hex math, path, waves, balance)
```

> The 3D models are served from `public/assets/gltf/`, so the game must be run from a
> web server (the commands above do this). Opening `index.html` from `file://` will not work.

---

## 🎮 How to play

You start with gold. Rebel waves spawn at the top of the road and follow it to your **castle**.
Every enemy that reaches the castle costs you castle HP — lose all 20 HP and it's over.
**Survive all 20 waves to win.** Bosses arrive at wave 10 and wave 20.

| Action | How |
| --- | --- |
| **Build a tower** | Tap a tower in the bottom bar, then tap a green plot beside the road |
| **Upgrade / sell** | Tap one of your towers to open its panel (3 levels each) |
| **Hero abilities** | Bottom-left: **Arrow Storm** (AoE damage) & **Frost Nova** (AoE slow) — tap, then tap the field |
| **Call wave early** | During prep, press **START WAVE** (or Space) for bonus gold |
| **Speed** | Bottom-right: pause / 1× / 2× (fast-forward) |
| **Camera** | Drag to orbit, right-drag to pan, scroll to zoom |

### Towers

| Tower | Role |
| --- | --- |
| 🏹 **Archer** | Cheap, fast single-target arrows |
| 💣 **Cannon** | Slow, heavy **splash** damage — great vs. crowds |
| ❄️ **Frost** | Low damage but **chills** enemies in an area, slowing them hard |
| 🪨 **Catapult** | Very long range lobbed **splash**, slow to reload |

Classic synergy: **Frost towers at a chokepoint + Cannons/Catapults** to clean up the slowed pack.
Bosses and brutes resist slows, so don't rely on freezing alone.

---

## 🧱 Tech & structure

Plain ES modules + Three.js (via Vite). No framework. Pure-logic modules are unit-tested in Node.

```
index.html, styles.css       # shell + HUD markup/skin
src/
  main.js        # boot
  game.js        # Three.js setup, state machine, input, economy, main loop
  config.js      # ALL tunable data (towers, enemies, waves, economy)   [Three-free]
  hex.js         # pointy-top hex math + serpentine road generator       [Three-free]
  waves.js       # per-wave spawn scheduler                              [Three-free]
  assets.js      # glTF loading / instancing / tinting
  board.js       # builds the hex board, road, castle, decorations, waypoints
  entities.js    # Enemy, Tower, Projectile
  effects.js     # floating damage numbers, hit/explosion pops, AoE rings
  hud.js         # DOM HUD
  audio.js       # tiny WebAudio SFX (no audio files)
tests/hex.test.mjs           # node --test
docs/RESEARCH.md             # the Kingshot / TD-genre research that shaped the design
```

Want to rebalance? Almost everything lives in **`src/config.js`** — tower stats, enemy stats,
the 20-wave generator, economy, and ability tuning.

---

## 🙏 Credits

- **Art:** [KayKit – Medieval Hexagon Pack](https://kaylousberg.com/) by **Kay Lousberg** — licensed **CC0** (free for personal & commercial use). Bundled in `public/assets/` with its license.
- **Engine:** [Three.js](https://threejs.org/).
- **Design research:** distilled from analysis of Kingshot's defense mode and the tower-defense genre — see [`docs/RESEARCH.md`](docs/RESEARCH.md).

This is a fan-made, original game inspired by the genre; it is not affiliated with Kingshot or Century Games.
