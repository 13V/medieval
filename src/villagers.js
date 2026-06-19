/**
 * villagers.js — Wandering townsfolk for the medieval hex tower-defense.
 *
 * Contract:
 *   import * as THREE from 'three';
 *   export function createVillagers(scene, board, opts = {})
 *     → { update(dt, camera), dispose() }
 *
 * Actors are placed on random board.cells tiles and wander between them,
 * hugging the terrain height.  KayKit unit pawns receive a walk-bob
 * animation (bounce + waddle + lean) applied to a child wrapper so the
 * root transform stays clean.  Carts and horses get a gentler roll.
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Seeded LCG — same pattern used across the codebase
// ---------------------------------------------------------------------------
function makeLCG(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PAWN_SCALE   = 2.4;
const CART_SCALE   = 2.2;
const HORSE_SCALE  = 2.2;

const WALK_SPEED   = 1.4;   // world units / second
const PAUSE_MIN    = 1.0;   // seconds paused at each waypoint
const PAUSE_RANGE  = 2.0;   // +random extra

// Walk-bob magnitudes (applied to model child)
const BOB_AMP      = 0.10;  // vertical bounce
const WADDLE_AMP   = 0.07;  // rotation.z side sway
const LEAN_AMP     = 0.05;  // rotation.x forward lean
const BOB_FREQ     = 8.0;   // radians/second (footstep cadence)

// Gentler for carts / horses
const ROLL_AMP     = 0.04;
const ROLL_FREQ    = 4.0;

// How many neighbour hops to consider when picking next target
const SEARCH_HOPS  = 5;

const PAWN_PATHS = [
  'units/blue/unit_blue_full.gltf',
  'units/green/unit_green_full.gltf',
  'units/yellow/unit_yellow_full.gltf',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return a flat Array of all CellData values from board.cells */
function allCells(board) {
  return Array.from(board.cells.values());
}

/**
 * Pick a random cell that is:
 *  - not the current cell
 *  - within SEARCH_HOPS of current cell (Manhattan-ish distance on grid)
 *  - prefer !occupied and !deco
 */
function pickTarget(currentCell, cells, rng) {
  const maxDist = SEARCH_HOPS;
  const candidates = cells.filter(c => {
    if (c === currentCell) return false;
    const dc = Math.abs(c.col - currentCell.col);
    const dr = Math.abs(c.row - currentCell.row);
    return (dc + dr) <= maxDist;
  });
  if (candidates.length === 0) return cells[Math.floor(rng() * cells.length)];

  // Prefer free tiles (not occupied, not deco) but fall back if none
  const free = candidates.filter(c => !c.occupied && !c.deco);
  const pool = free.length > 0 ? free : candidates;
  return pool[Math.floor(rng() * pool.length)];
}

// ---------------------------------------------------------------------------
// Actor factory
// ---------------------------------------------------------------------------

/**
 * Create one actor object.
 *
 * @param {object}  opts
 * @param {string}  opts.path      - GLTF path string
 * @param {number}  opts.scale     - uniform scale
 * @param {object}  opts.cell      - starting CellData
 * @param {THREE.Group} opts.model - instantiated THREE.Group from board.assets
 * @param {'pawn'|'cart'|'horse'} opts.kind
 * @param {number}  opts.seed      - LCG seed offset
 * @param {Array}   opts.allCells  - flat array of all CellData
 */
function createActor({ path, scale, cell, model, kind, seed, allCells: cells }) {
  const rng = makeLCG(seed);

  // Place root at cell's tile-top centre
  model.position.copy(cell.pos);

  // Wrap the visual content in a child group so we can apply bob offsets
  // without disturbing the world-position root.
  const bobGroup = new THREE.Group();
  // Reparent all children of model into bobGroup, then add bobGroup to model
  while (model.children.length > 0) {
    bobGroup.add(model.children[0]);
  }
  model.add(bobGroup);

  // Stagger phase so actors don't all bob in sync
  const phase = rng() * Math.PI * 2;

  const actor = {
    model,
    bobGroup,
    kind,
    cell,           // current cell (where we started / last arrived)
    targetCell: null,
    // lerp state
    fromPos: cell.pos.clone(),
    toPos:   cell.pos.clone(),
    t: 0,           // 0..1 along current segment
    moving: false,
    pauseTime: PAUSE_MIN + rng() * PAUSE_RANGE, // initial pause before first move
    elapsed: 0,
    phase,
    cells,
    rng,
  };

  return actor;
}

// ---------------------------------------------------------------------------
// Update one actor
// ---------------------------------------------------------------------------
function updateActor(actor, dt) {
  if (actor.moving) {
    // --------------- WALKING ---------------
    const dist = actor.fromPos.distanceTo(actor.toPos);
    const step = dist > 0.001 ? (WALK_SPEED * dt) / dist : 1;
    actor.t = Math.min(actor.t + step, 1);

    // Lerp x/z, interpolate y from tile heights to hug terrain
    actor.model.position.x = actor.fromPos.x + (actor.toPos.x - actor.fromPos.x) * actor.t;
    actor.model.position.z = actor.fromPos.z + (actor.toPos.z - actor.fromPos.z) * actor.t;
    actor.model.position.y = actor.fromPos.y + (actor.toPos.y - actor.fromPos.y) * actor.t;

    // Face movement direction
    const dx = actor.toPos.x - actor.fromPos.x;
    const dz = actor.toPos.z - actor.fromPos.z;
    if (Math.abs(dx) + Math.abs(dz) > 0.001) {
      actor.model.rotation.y = Math.atan2(dx, dz);
    }

    // Walk-bob on the child group
    const freq  = actor.kind === 'pawn' ? BOB_FREQ  : ROLL_FREQ;
    const bAmp  = actor.kind === 'pawn' ? BOB_AMP   : ROLL_AMP;
    const wAmp  = actor.kind === 'pawn' ? WADDLE_AMP : ROLL_AMP * 0.5;
    const lAmp  = actor.kind === 'pawn' ? LEAN_AMP  : ROLL_AMP * 0.3;

    actor.elapsed += dt;
    const s = actor.elapsed * freq + actor.phase;

    if (actor.kind === 'pawn') {
      // Vertical bounce: always positive (both feet hit ground each cycle)
      actor.bobGroup.position.y = Math.abs(Math.sin(s)) * bAmp;
      // Side waddle
      actor.bobGroup.rotation.z = Math.sin(s) * wAmp;
      // Forward lean while moving
      actor.bobGroup.rotation.x = -lAmp;
    } else {
      // Cart / horse: gentle roll and bob
      actor.bobGroup.position.y = Math.abs(Math.sin(s * 0.5)) * bAmp;
      actor.bobGroup.rotation.z = Math.sin(s) * wAmp;
      actor.bobGroup.rotation.x = 0;
    }

    if (actor.t >= 1) {
      // Arrived
      actor.moving    = false;
      actor.cell      = actor.targetCell;
      actor.targetCell = null;
      actor.pauseTime = PAUSE_MIN + actor.rng() * PAUSE_RANGE;
      actor.elapsed   = 0;

      // Snap cleanly
      actor.model.position.copy(actor.toPos);
      // Reset bob
      actor.bobGroup.position.y  = 0;
      actor.bobGroup.rotation.z  = 0;
      actor.bobGroup.rotation.x  = 0;
    }

  } else {
    // --------------- PAUSING ---------------
    actor.elapsed += dt;
    // Idle sway — very subtle
    const idleSway = Math.sin(actor.elapsed * 1.2 + actor.phase) * 0.015;
    actor.bobGroup.rotation.z = idleSway;
    actor.bobGroup.position.y = 0;
    actor.bobGroup.rotation.x = 0;

    if (actor.elapsed >= actor.pauseTime) {
      // Pick a new target and start walking
      actor.targetCell = pickTarget(actor.cell, actor.cells, actor.rng);
      actor.fromPos    = actor.model.position.clone();
      actor.toPos      = actor.targetCell.pos.clone();
      actor.t          = 0;
      actor.moving     = true;
      actor.elapsed    = 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Create wandering townsfolk and add them to the scene.
 *
 * @param {THREE.Scene}  scene
 * @param {object}       board  - Board instance (see contract)
 * @param {object}       opts   - Optional overrides: { seed, numPawns, numCarts, numHorses }
 * @returns {{ update(dt: number, camera: THREE.Camera): void, dispose(): void }}
 */
export function createVillagers(scene, board, opts = {}) {
  const {
    seed      = 7,
    numPawns  = 12,   // 10–14 townsfolk
    numCarts  =  2,
    numHorses =  2,
  } = opts;

  const rng   = makeLCG(seed);
  const cells = allCells(board);

  if (cells.length === 0) {
    // Safety: no cells available, return no-op
    return {
      update() {},
      dispose() {},
    };
  }

  const actors  = [];
  const models  = []; // track for dispose

  /**
   * Instantiate one asset, place on a random cell, register actor.
   */
  function spawnActor(path, scale, kind) {
    // Pick a random cell (prefer unoccupied)
    const free = cells.filter(c => !c.occupied && !c.deco);
    const pool = free.length > 0 ? free : cells;
    const cell = pool[Math.floor(rng() * pool.length)];

    let model;
    try {
      model = board.assets.instance(path, { scale, groundAlign: true });
    } catch (e) {
      // Asset not ready — skip gracefully
      return;
    }
    scene.add(model);
    models.push(model);

    const actorSeed = (seed * 1000 + actors.length * 137 + 31) >>> 0;

    actors.push(createActor({
      path,
      scale,
      cell,
      model,
      kind,
      seed: actorSeed,
      allCells: cells,
    }));
  }

  // Spawn pawns — cycle through colour variants for variety
  for (let i = 0; i < numPawns; i++) {
    const path = PAWN_PATHS[i % PAWN_PATHS.length];
    spawnActor(path, PAWN_SCALE, 'pawn');
  }

  // Spawn merchant carts
  for (let i = 0; i < numCarts; i++) {
    spawnActor('units/neutral/cart_merchant.gltf', CART_SCALE, 'cart');
  }

  // Spawn horses
  for (let i = 0; i < numHorses; i++) {
    spawnActor('units/neutral/horse_A.gltf', HORSE_SCALE, 'horse');
  }

  // ---------------------------------------------------------------------------
  return {
    /**
     * Drive all actors every frame.
     * @param {number}          dt     - Delta time in seconds
     * @param {THREE.Camera}    camera - Unused (available for LOD / culling)
     */
    update(dt, _camera) {
      // Clamp dt so a tab-switch pause doesn't fling actors across the map
      const safeDt = Math.min(dt, 0.1);
      for (const actor of actors) {
        updateActor(actor, safeDt);
      }
    },

    /** Remove all models from scene and free geometry/material references. */
    dispose() {
      for (const model of models) {
        scene.remove(model);
        model.traverse(obj => {
          if (obj.isMesh) {
            if (obj.geometry)  obj.geometry.dispose();
            if (obj.material) {
              if (Array.isArray(obj.material)) {
                obj.material.forEach(m => m.dispose());
              } else {
                obj.material.dispose();
              }
            }
          }
        });
      }
      actors.length = 0;
      models.length = 0;
    },
  };
}
