// ============================================================================
// config.js — all tunable game data. No Three.js imports (unit-testable in Node).
// Balance + structure informed by research into Kingshot's "Rebel Invasion"
// tower-defense mode and tower-defense genre conventions (Kingdom Rush, BTD6,
// Realm Defense). See docs/RESEARCH.md.
// ============================================================================

// Model paths are relative to  public/assets/gltf/ .
export const MODELS = {
  tileGrass: 'tiles/base/hex_grass.gltf',
  tileRoad: 'tiles/base/hex_grass.gltf', // path tiles reuse grass mesh, tinted to dirt
  castle: 'buildings/blue/building_castle_blue.gltf',

  // Grass summer texture — loaded separately in board.js via TextureLoader.
  // Path relative to public/ (not the gltf subfolder).
  tileSummerTex: 'assets/gltf/tiles/base/hexagons_medieval_Summer.png',

  // All decoration models are listed here so game.js's manifest spread picks them up.
  // board.js groups them into sub-arrays below.
  decoTrees: [
    // trees — single
    'decoration/nature/tree_single_A.gltf',
    'decoration/nature/tree_single_B.gltf',
    // trees — clusters
    'decoration/nature/trees_A_small.gltf',
    'decoration/nature/trees_B_small.gltf',
    'decoration/nature/trees_A_medium.gltf',
    'decoration/nature/trees_B_medium.gltf',
    // hills with trees (great for border/framing)
    'decoration/nature/hills_A_trees.gltf',
    'decoration/nature/hills_B_trees.gltf',
    // rocks
    'decoration/nature/rock_single_A.gltf',
    'decoration/nature/rock_single_B.gltf',
    'decoration/nature/rock_single_C.gltf',
    // water plants (for moat fringe)
    'decoration/nature/waterplant_A.gltf',
    'decoration/nature/waterplant_B.gltf',
    // props — castle end theming
    'decoration/props/flag_blue.gltf',
    'decoration/props/flag_yellow.gltf',
    'decoration/props/barrel.gltf',
    'decoration/props/crate_A_small.gltf',
    // props — spawn end theming
    'decoration/props/tent.gltf',
    'decoration/props/resource_stone.gltf',
    'decoration/props/resource_lumber.gltf',
    // mountains / cliffs — rocky island sides & castle peak
    'decoration/nature/mountain_A.gltf',
    'decoration/nature/mountain_B.gltf',
    'decoration/nature/mountain_C.gltf',
    'decoration/nature/mountain_A_grass.gltf',
    'decoration/nature/mountain_B_grass.gltf',
    'decoration/nature/mountain_C_grass.gltf',
  ],

  // Sub-arrays for board.js to pick from (paths must be a subset of decoTrees above).
  decoNature: [
    'decoration/nature/tree_single_A.gltf',
    'decoration/nature/tree_single_B.gltf',
    'decoration/nature/trees_A_small.gltf',
    'decoration/nature/trees_B_small.gltf',
    'decoration/nature/trees_A_medium.gltf',
    'decoration/nature/trees_B_medium.gltf',
    'decoration/nature/hills_A_trees.gltf',
    'decoration/nature/hills_B_trees.gltf',
  ],
  decoRocks: [
    'decoration/nature/rock_single_A.gltf',
    'decoration/nature/rock_single_B.gltf',
    'decoration/nature/rock_single_C.gltf',
  ],
  decoWaterPlants: [
    'decoration/nature/waterplant_A.gltf',
    'decoration/nature/waterplant_B.gltf',
  ],
  decoCastleProps: [
    'decoration/props/flag_blue.gltf',
    'decoration/props/flag_yellow.gltf',
    'decoration/props/barrel.gltf',
    'decoration/props/crate_A_small.gltf',
  ],
  decoSpawnProps: [
    'decoration/props/tent.gltf',
    'decoration/props/resource_stone.gltf',
    'decoration/props/resource_lumber.gltf',
  ],
  decoCliffs: [
    'decoration/nature/mountain_A.gltf',
    'decoration/nature/mountain_B.gltf',
    'decoration/nature/mountain_C.gltf',
  ],
  decoCliffGrass: [
    'decoration/nature/mountain_A_grass.gltf',
    'decoration/nature/mountain_B_grass.gltf',
    'decoration/nature/mountain_C_grass.gltf',
  ],
};

export const COLORS = {
  grass: 0x7bbf4f,
  path: 0xc9a25e,
  pathEdge: 0xb98e49,
  hoverOk: 0x6fe06a,
  hoverBad: 0xe05a4a,
  range: 0xffe08a,
  frost: 0x8fe0ff,
  // Environmental colors (used by board.js for water/moat framing)
  waterDeep: 0x1a4a6e,
  waterShallow: 0x2a6a9a,
  waterBackdrop: 0x1d3f5c,
};

export const ECONOMY = {
  startGold: 280,
  sellRefund: 0.6,        // fraction of total invested returned on sell
  callEarlyBonusPerSec: 2, // bonus gold per remaining prep second when starting early
};

export const CASTLE = { hp: 20 };

// Slowing rules (genre best practice: multiplicative, hard floor, bosses resist).
export const SLOW = {
  maxSlow: 0.8,           // never slow below 20% speed
};

// --------------------------------------------------------------------------
// Towers. Each has an ordered  levels[]  array (index 0 = level 1).
// damage = per shot, fireRate = shots/second, range/splash in world units.
// slow: { amount: 0..1 fraction, duration: seconds } applied on hit (in splash).
// --------------------------------------------------------------------------
export const TOWERS = {
  archer: {
    name: 'Archer', emoji: '🏹', swatch: '#8fb6e8',
    model: 'buildings/blue/building_watchtower_blue.gltf',
    modelScale: 1.5, projectile: 'arrow', shotColor: 0xffffff,
    desc: 'Fast single-target arrows. Cheap all-rounder.',
    levels: [
      { cost: 70,  range: 5.2, damage: 14, fireRate: 1.8, splash: 0 },
      { cost: 80,  range: 5.6, damage: 22, fireRate: 2.0, splash: 0 },
      { cost: 130, range: 6.2, damage: 36, fireRate: 2.3, splash: 0 },
    ],
  },
  cannon: {
    name: 'Cannon', emoji: '💣', swatch: '#caa45e',
    model: 'buildings/blue/building_tower_cannon_blue.gltf',
    modelScale: 1.4, projectile: 'cannonball', shotColor: 0x3a3a3a,
    desc: 'Slow, heavy splash damage. Great vs. crowds.',
    levels: [
      { cost: 120, range: 4.3, damage: 36, fireRate: 0.6, splash: 1.7 },
      { cost: 130, range: 4.6, damage: 58, fireRate: 0.65, splash: 1.9 },
      { cost: 210, range: 5.0, damage: 92, fireRate: 0.75, splash: 2.3 },
    ],
  },
  catapult: {
    name: 'Catapult', emoji: '🪨', swatch: '#9c7b4a',
    model: 'buildings/blue/building_tower_catapult_blue.gltf',
    modelScale: 1.4, projectile: 'catapult', shotColor: 0x6b4a2a,
    desc: 'Very long range lobbed splash. Slow to reload.',
    levels: [
      { cost: 160, range: 8.0, damage: 64, fireRate: 0.34, splash: 2.0 },
      { cost: 180, range: 8.6, damage: 104, fireRate: 0.38, splash: 2.3 },
      { cost: 270, range: 9.4, damage: 168, fireRate: 0.44, splash: 2.7 },
    ],
  },
  frost: {
    name: 'Frost', emoji: '❄️', swatch: '#8fe0ff',
    model: 'buildings/blue/building_tower_B_blue.gltf',
    modelScale: 1.5, projectile: 'frost', shotColor: 0x8fe0ff, tint: 0x9fe6ff,
    desc: 'Chills enemies in an area, slowing them dramatically.',
    levels: [
      { cost: 90,  range: 4.6, damage: 4,  fireRate: 1.2, splash: 1.5, slow: { amount: 0.40, duration: 1.6 } },
      { cost: 90,  range: 5.0, damage: 7,  fireRate: 1.3, splash: 1.7, slow: { amount: 0.55, duration: 2.0 } },
      { cost: 150, range: 5.4, damage: 11, fireRate: 1.4, splash: 2.0, slow: { amount: 0.70, duration: 2.4 } },
    ],
  },
};
export const TOWER_ORDER = ['archer', 'cannon', 'frost', 'catapult'];

// --------------------------------------------------------------------------
// Enemies. hp/speed/gold are base values; per-wave hpMul scales hp.
// slowResist 0..1 reduces applied slow amount (bosses mostly resist).
// --------------------------------------------------------------------------
export const ENEMIES = {
  footman: { name: 'Footman', model: 'units/red/unit_red_full.gltf',     hp: 56,   speed: 2.8, gold: 6,   scale: 2.6, slowResist: 0.0,  radius: 0.55 },
  raider:  { name: 'Raider',  model: 'units/red/horse_red_full.gltf',    hp: 34,   speed: 4.6, gold: 5,   scale: 2.1, slowResist: 0.0,  radius: 0.5 },
  brute:   { name: 'Brute',   model: 'units/red/unit_red_full.gltf',     hp: 330,  speed: 1.7, gold: 17,  scale: 4.2, slowResist: 0.35, radius: 0.8 },
  boss:    { name: 'Warlord', model: 'units/red/catapult_red_full.gltf', hp: 4200, speed: 1.4, gold: 160, scale: 3.0, slowResist: 0.7,  radius: 1.0 },
};

// Hero abilities (player-triggered, on cooldown). Targeted on the battlefield.
export const ABILITIES = {
  arrowstorm: { name: 'Arrow Storm', emoji: '🎯', cooldown: 18, radius: 3.4, damage: 70, color: 0xffd060 },
  frostnova:  { name: 'Frost Nova',  emoji: '❄️', cooldown: 22, radius: 4.2, slow: { amount: 0.6, duration: 3.2 }, color: 0x8fe0ff },
};
export const ABILITY_ORDER = ['arrowstorm', 'frostnova'];

// Board / level layout (offset "odd-r" coordinates, pointy-top hexes).
export const LEVEL = {
  cols: 11,
  rows: 9,
  corridorRows: [1, 3, 5, 7], // horizontal road corridors, bridged by 1-cell connectors
};

// --------------------------------------------------------------------------
// Wave generation. 20 waves, boss waves at 10 & 20, escalating composition.
// Returns: [{ index, isBoss, prep, hpMul, groups:[{type,count,interval,delay}] }]
//   interval = seconds between spawns within a group; delay = group start offset.
// --------------------------------------------------------------------------
export function generateWaves() {
  const waves = [];
  for (let w = 1; w <= 20; w++) {
    const hpMul = 1 + 0.14 * (w - 1);
    const isBoss = w === 10 || w === 20;
    const prep = w === 1 ? 16 : w <= 5 ? 12 : w <= 12 ? 10 : 8;
    const groups = [];

    if (isBoss) {
      const bossCount = w === 20 ? 2 : 1;
      groups.push({ type: 'boss', count: bossCount, interval: 7, delay: 0 });
      groups.push({ type: 'footman', count: 6 + w, interval: 0.7, delay: 2 });
      if (w >= 10) groups.push({ type: 'raider', count: 6, interval: 0.4, delay: 5 });
      if (w === 20) groups.push({ type: 'brute', count: 5, interval: 1.3, delay: 6 });
    } else {
      groups.push({
        type: 'footman',
        count: 5 + w,
        interval: Math.max(0.45, 0.95 - w * 0.02),
        delay: 0,
      });
      if (w >= 3) {
        groups.push({ type: 'raider', count: 3 + Math.floor(w * 0.7), interval: 0.4, delay: 1.5 });
      }
      if (w >= 5) {
        groups.push({ type: 'brute', count: Math.max(1, Math.floor((w - 3) / 2)), interval: 1.4, delay: 2.5 });
      }
    }
    waves.push({ index: w, isBoss, prep, hpMul, groups });
  }
  return waves;
}
