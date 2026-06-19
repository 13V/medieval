// ============================================================================
// critters.js — Small living critters that make the medieval island feel alive.
//
// Adds:
//   1. Rabbits/squirrels (~10)  — hop across grass tiles in parabolic arcs
//   2. Butterflies      (~12)  — flutter low above the island, bright wings
//   3. Jumping fish     (~8)   — leap from the water ring around the island
//
// CONTRACT:
//   import * as THREE from 'three';
//   export function createCritters(scene, board, opts = {})
//   returns { update(dt, camera), dispose() }
//
// No external assets — everything built from THREE primitives.
// No new npm dependencies beyond three.
// ============================================================================

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Seeded PRNG (same LCG used across the codebase)
// ---------------------------------------------------------------------------

function makeLCG(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// RABBIT / SQUIRREL  mesh
// ---------------------------------------------------------------------------
// Anatomy: rounded body (sphere) + head (smaller sphere) + 2 tall ears
// (thin scaled boxes) + a fluffy tail (small sphere offset behind).
// Kept very small so it reads as "cute critter" at diorama scale.

const CRITTER_COLORS = [
  0xf5f5f5, // white
  0xd4b483, // tan/brown
  0xb0a090, // grey
  0xc8875a, // rust brown
  0xfaf0e6, // cream
];

function createRabbitMesh(rng) {
  const color = CRITTER_COLORS[Math.floor(rng() * CRITTER_COLORS.length)];
  const earColor = new THREE.Color(color).multiplyScalar(0.85).getHex();
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.85,
    metalness: 0.0,
    flatShading: true,
  });
  const earMat = new THREE.MeshStandardMaterial({
    color: earColor,
    roughness: 0.85,
    metalness: 0.0,
    flatShading: true,
  });

  const group = new THREE.Group();

  // Body — slightly squashed sphere
  const bodyGeo = new THREE.SphereGeometry(0.095, 5, 4);
  const body = new THREE.Mesh(bodyGeo, mat);
  body.scale.set(1, 0.85, 1.1);
  body.name = 'body';
  group.add(body);

  // Head — forward and up from body
  const headGeo = new THREE.SphereGeometry(0.06, 5, 4);
  const head = new THREE.Mesh(headGeo, mat);
  head.position.set(0, 0.1, 0.09);
  head.name = 'head';
  group.add(head);

  // Ears — two thin tall boxes standing up from head
  const earGeo = new THREE.BoxGeometry(0.025, 0.09, 0.018);
  const earL = new THREE.Mesh(earGeo, earMat);
  earL.position.set(-0.03, 0.175, 0.09);
  earL.rotation.z = 0.1;
  earL.name = 'earL';
  group.add(earL);

  const earR = new THREE.Mesh(earGeo, earMat);
  earR.position.set(0.03, 0.175, 0.09);
  earR.rotation.z = -0.1;
  earR.name = 'earR';
  group.add(earR);

  // Tail — fluffy poof behind the body
  const tailGeo = new THREE.SphereGeometry(0.038, 4, 3);
  const tail = new THREE.Mesh(tailGeo, mat);
  tail.position.set(0, 0.04, -0.105);
  tail.name = 'tail';
  group.add(tail);

  // Nose dot
  const noseGeo = new THREE.SphereGeometry(0.012, 3, 2);
  const noseMat = new THREE.MeshStandardMaterial({
    color: 0xff9999,
    roughness: 0.9,
    flatShading: true,
  });
  const nose = new THREE.Mesh(noseGeo, noseMat);
  nose.position.set(0, 0.09, 0.145);
  group.add(nose);

  group.castShadow = false;
  group.receiveShadow = false;
  return group;
}

// ---------------------------------------------------------------------------
// BUTTERFLY  mesh
// ---------------------------------------------------------------------------
// Two pairs of wing lobes (upper+lower) that fold around a vertical hinge.
// Bright saturated colors in a Kingshot palette.

const BUTTERFLY_PALETTES = [
  [0xff6b35, 0xffe066],   // orange + yellow
  [0xe040fb, 0xf8bbd9],   // purple + pink
  [0x29b6f6, 0xe1f5fe],   // sky blue + pale blue
  [0x66bb6a, 0xf9fbe7],   // green + lime white
  [0xffca28, 0xff7043],   // gold + deep orange
  [0xec407a, 0xfce4ec],   // hot pink + blush
  [0x26c6da, 0xb2ebf2],   // teal + light cyan
];

function createButterflyMesh(rng) {
  const paletteIdx = Math.floor(rng() * BUTTERFLY_PALETTES.length);
  const [cA, cB] = BUTTERFLY_PALETTES[paletteIdx];

  const matA = new THREE.MeshBasicMaterial({ color: cA, side: THREE.DoubleSide, transparent: true, opacity: 0.92 });
  const matB = new THREE.MeshBasicMaterial({ color: cB, side: THREE.DoubleSide, transparent: true, opacity: 0.88 });

  const group = new THREE.Group();

  // Hinge groups so wings rotate around Y
  const hingeL = new THREE.Group();
  hingeL.name = 'hingeL';
  const hingeR = new THREE.Group();
  hingeR.name = 'hingeR';
  group.add(hingeL, hingeR);

  // Build a wing shape as two triangles (upper lobe + lower lobe)
  function makeWingGeo(side) {
    const s = side; // +1 right, -1 left
    const geo = new THREE.BufferGeometry();
    // Upper lobe
    const uw = 0.11 * Math.abs(s);
    const uh = 0.085;
    // Lower lobe (smaller)
    const lw = 0.07 * Math.abs(s);
    const lh = 0.055;
    geo.setAttribute('position', new THREE.Float32BufferAttribute([
      // upper lobe: 3 verts
      0,    0,      0,   // hinge
      s * uw, uh,   0,   // tip up
      s * uw * 0.5, -0.01, 0, // trailing
      // lower lobe: 2 more verts
      s * lw, -lh,  0,  // lower tip
      s * lw * 0.4, -lh * 0.2, 0, // join
    ], 3));
    if (s > 0) {
      geo.setIndex([0, 1, 2,  0, 4, 3,  0, 2, 4]);
    } else {
      geo.setIndex([0, 2, 1,  0, 3, 4,  0, 4, 2]);
    }
    geo.computeVertexNormals();
    return geo;
  }

  const wL = new THREE.Mesh(makeWingGeo(-1), matA);
  wL.name = 'wingL';
  hingeL.add(wL);

  const wR = new THREE.Mesh(makeWingGeo(1), matB);
  wR.name = 'wingR';
  hingeR.add(wR);

  // Tiny body
  const bodyGeo = new THREE.CylinderGeometry(0.012, 0.008, 0.06, 4);
  const bodyMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.rotation.z = Math.PI / 2; // horizontal
  body.position.set(0, 0, 0);
  group.add(body);

  group.castShadow = false;
  return group;
}

// ---------------------------------------------------------------------------
// FISH  mesh
// ---------------------------------------------------------------------------
// Simple low-poly fish: tapered body (scaled sphere) + fan tail (triangle).

const FISH_COLORS = [
  0xff6d00, // bright orange
  0xffd600, // golden yellow
  0x00bcd4, // teal
  0xe91e63, // deep pink
  0x76ff03, // lime
  0x00e5ff, // cyan
];

function createFishMesh(rng) {
  const color = FISH_COLORS[Math.floor(rng() * FISH_COLORS.length)];
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.4,
    metalness: 0.1,
    flatShading: true,
  });

  const group = new THREE.Group();

  // Body — elongated sphere
  const bodyGeo = new THREE.SphereGeometry(0.055, 5, 4);
  const body = new THREE.Mesh(bodyGeo, mat);
  body.scale.set(1.9, 0.65, 0.7);
  body.name = 'body';
  group.add(body);

  // Tail fin — flat triangle behind body
  const tailGeo = new THREE.BufferGeometry();
  tailGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.055, 0,     0,
    -0.14,  0.05,  0,
    -0.14, -0.05,  0,
  ], 3));
  tailGeo.setIndex([0, 1, 2, 0, 2, 1]);
  tailGeo.computeVertexNormals();
  const tail = new THREE.Mesh(tailGeo, mat);
  tail.name = 'tail';
  group.add(tail);

  // Dorsal fin
  const dorsalGeo = new THREE.BufferGeometry();
  dorsalGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    0.02,  0.055, 0,
    0.06,  0.09,  0,
    -0.03, 0.055, 0,
  ], 3));
  dorsalGeo.setIndex([0, 1, 2, 0, 2, 1]);
  dorsalGeo.computeVertexNormals();
  const dorsal = new THREE.Mesh(dorsalGeo, mat);
  dorsal.name = 'dorsal';
  group.add(dorsal);

  // Eye
  const eyeGeo = new THREE.SphereGeometry(0.012, 3, 2);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
  const eye = new THREE.Mesh(eyeGeo, eyeMat);
  eye.position.set(0.09, 0.018, 0.038);
  group.add(eye);

  group.castShadow = false;
  return group;
}

// ---------------------------------------------------------------------------
// SPLASH  — ring of particles that expand and fade on fish entry/exit
// ---------------------------------------------------------------------------

function createSplash(rng) {
  const group = new THREE.Group();
  group.visible = false;

  // Small ring that expands: we fake it with a torus that scales outward
  const ringGeo = new THREE.TorusGeometry(0.08, 0.015, 4, 10);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xaaddff,
    transparent: true,
    opacity: 0.7,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2; // lay flat
  ring.name = 'ring';
  group.add(ring);

  // A few tiny droplet spheres around the ring
  const dropMat = new THREE.MeshBasicMaterial({ color: 0xcceeff, transparent: true, opacity: 0.8 });
  const dropGeo = new THREE.SphereGeometry(0.018, 3, 2);
  const DROP_COUNT = 5;
  for (let i = 0; i < DROP_COUNT; i++) {
    const drop = new THREE.Mesh(dropGeo, dropMat);
    const angle = (i / DROP_COUNT) * Math.PI * 2 + rng() * 0.5;
    drop.position.set(
      Math.cos(angle) * (0.06 + rng() * 0.04),
      0,
      Math.sin(angle) * (0.06 + rng() * 0.04),
    );
    drop.name = `drop${i}`;
    group.add(drop);
  }

  return group;
}

// ---------------------------------------------------------------------------
// MAIN EXPORT
// ---------------------------------------------------------------------------

/**
 * @param {THREE.Scene} scene
 * @param {{ radius: number, baseY: number, size: number, cells: Map }} board
 * @param {object} opts
 */
export function createCritters(scene, board, opts = {}) {
  const rng = makeLCG(0xC0FFEE42);

  const R     = board.radius ?? 11.7;
  const baseY = board.baseY  ?? 2.6;
  // board.size is the tile half-width; used to know how large each cell is

  const RABBIT_COUNT    = opts.rabbitCount    ?? 10;
  const BUTTERFLY_COUNT = opts.butterflyCount ?? 12;
  const FISH_COUNT      = opts.fishCount      ?? 8;

  const root = new THREE.Group();
  root.name = 'critters';
  scene.add(root);

  // =========================================================================
  // 1.  RABBITS / SQUIRRELS
  // =========================================================================
  // Each rabbit:
  //   - Lives on a random, non-occupied, non-deco grass cell.
  //   - Hops toward a new target tile in a parabolic arc.
  //   - Squashes body on takeoff & landing, stretches in mid-air.
  //   - Brief pause between hops.
  //
  // State machine per rabbit:
  //   PAUSE → HOP → PAUSE → HOP …

  // Collect candidate tiles (grass tiles that are unoccupied)
  const candidateCells = [];
  if (board.cells) {
    for (const cell of board.cells.values()) {
      if (!cell.occupied) {
        candidateCells.push(cell);
      }
    }
  }

  // Fallback positions on the flat island if no cells available
  function randomIslandPos() {
    const angle = rng() * Math.PI * 2;
    const dist  = rng() * R * 0.7;
    return new THREE.Vector3(
      Math.cos(angle) * dist,
      baseY,
      Math.sin(angle) * dist,
    );
  }

  function randomCell() {
    if (candidateCells.length === 0) return null;
    return candidateCells[Math.floor(rng() * candidateCells.length)];
  }

  const RABBIT_HOP_HEIGHT = 0.38;   // peak arc above tile surface
  const RABBIT_HOP_DIST   = 0.9;    // typical hop distance in world units
  const RABBIT_HOP_DUR    = 0.45;   // seconds for one hop
  const RABBIT_PAUSE_MIN  = 0.6;
  const RABBIT_PAUSE_MAX  = 2.2;

  const rabbits = [];

  for (let i = 0; i < RABBIT_COUNT; i++) {
    const mesh = createRabbitMesh(rng);
    root.add(mesh);

    // Starting cell / position
    const startCell = randomCell();
    const startPos = startCell
      ? startCell.pos.clone()
      : randomIslandPos();

    mesh.position.copy(startPos);
    // Tiny random rotation so they don't all face the same way
    mesh.rotation.y = rng() * Math.PI * 2;

    const critter = {
      mesh,
      // Current tile centre (world)
      fromPos: startPos.clone(),
      toPos:   startPos.clone(),
      // Hop state
      state: 'PAUSE',     // 'PAUSE' | 'HOP'
      timer: rng() * RABBIT_PAUSE_MAX,   // stagger starts
      pauseDur: RABBIT_PAUSE_MIN + rng() * (RABBIT_PAUSE_MAX - RABBIT_PAUSE_MIN),
      hopDur:   RABBIT_HOP_DUR * (0.85 + rng() * 0.3),
      t: 0,               // 0..1 through current hop
      // per-instance rng
      rng: makeLCG((0xAB0000 + i * 0x137) >>> 0),
    };
    rabbits.push(critter);
  }

  /** Pick a new hop target near current position, clamped to island */
  function pickHopTarget(from, critterRng) {
    // Try to find a nearby unused candidate cell
    const angle = critterRng() * Math.PI * 2;
    const dist  = RABBIT_HOP_DIST * (0.7 + critterRng() * 0.8);
    const tx = from.x + Math.cos(angle) * dist;
    const tz = from.z + Math.sin(angle) * dist;

    // Find the closest candidate cell
    let bestCell = null;
    let bestD2 = Infinity;
    if (candidateCells.length > 0) {
      for (const cell of candidateCells) {
        const dx = cell.pos.x - tx;
        const dz = cell.pos.z - tz;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD2) { bestD2 = d2; bestCell = cell; }
      }
    }

    if (bestCell && bestD2 < (RABBIT_HOP_DIST * 2) * (RABBIT_HOP_DIST * 2)) {
      return bestCell.pos.clone();
    }

    // Fallback: step in a random direction, clamped to island
    let fx = from.x + Math.cos(angle) * RABBIT_HOP_DIST;
    let fz = from.z + Math.sin(angle) * RABBIT_HOP_DIST;
    const edge = R * 0.78;
    const fLen = Math.sqrt(fx * fx + fz * fz);
    if (fLen > edge) {
      fx = (fx / fLen) * edge;
      fz = (fz / fLen) * edge;
    }
    return new THREE.Vector3(fx, from.y, fz);
  }

  // =========================================================================
  // 2.  BUTTERFLIES
  // =========================================================================
  // Each butterfly wanders slowly just above the island surface,
  // flapping wings open/closed, drifting softly to random targets.

  const butterflies = [];

  for (let i = 0; i < BUTTERFLY_COUNT; i++) {
    const mesh = createButterflyMesh(rng);
    root.add(mesh);

    const angle = rng() * Math.PI * 2;
    const dist  = rng() * R * 0.8;
    const px = Math.cos(angle) * dist;
    const pz = Math.sin(angle) * dist;
    const py = baseY + 0.3 + rng() * 1.2;

    const bf = {
      mesh,
      px, py, pz,
      tx: px, ty: py, tz: pz,
      speed: 0.55 + rng() * 0.55,
      flapT: rng() * Math.PI * 2,
      flapSpeed: 5.5 + rng() * 5.0,
      wanderTimer: rng() * 2.0,
      wanderInterval: 1.2 + rng() * 2.2,
      bobT:   rng() * Math.PI * 2,
      bobSpeed: 1.8 + rng() * 2.5,
      bobAmp:  0.08 + rng() * 0.12,
      rng: makeLCG((0xBF0000 + i * 0x211) >>> 0),
    };
    mesh.position.set(px, py, pz);
    butterflies.push(bf);
  }

  // =========================================================================
  // 3.  JUMPING FISH
  // =========================================================================
  // Fish live in the water ring (radius 1.05..1.6 × board.radius).
  // They periodically leap up in a parabolic arc, re-entering with a splash.
  //
  // State: SUBMERGED (hidden, waiting) → RISING → FALLING → SPLASH → SUBMERGED

  const FISH_RING_MIN = R * 1.05;
  const FISH_RING_MAX = R * 1.50;
  const SEA_Y = -0.5;
  const FISH_PEAK_H = 1.1;    // height above sea surface at arc peak
  const FISH_JUMP_DUR = 1.0;  // seconds for a full arc
  const FISH_SPLASH_DUR = 0.4;

  const fish = [];

  for (let i = 0; i < FISH_COUNT; i++) {
    const mesh = createFishMesh(rng);
    root.add(mesh);
    mesh.visible = false;

    const splash = createSplash(rng);
    root.add(splash);

    const angle = rng() * Math.PI * 2;
    const r     = FISH_RING_MIN + rng() * (FISH_RING_MAX - FISH_RING_MIN);
    const fx = Math.cos(angle) * r;
    const fz = Math.sin(angle) * r;

    // Stagger jump times so they don't all jump at once
    const waitMin = 1.5 + rng() * 5.0;

    fish.push({
      mesh,
      splash,
      x: fx,
      z: fz,
      // jump arc controlled by angle around ring so fish arc toward/away from island
      jumpAngle: angle,
      state: 'SUBMERGED',
      timer: i * (6.0 / FISH_COUNT) + rng() * 1.5, // stagger
      waitDur: waitMin,
      jumpDur: FISH_JUMP_DUR * (0.8 + rng() * 0.4),
      splashDur: FISH_SPLASH_DUR,
      t: 0,
    });
  }

  // =========================================================================
  // UPDATE
  // =========================================================================

  function update(dt) {
    // -------------------------------------------------------------------------
    // RABBITS
    // -------------------------------------------------------------------------
    for (const r of rabbits) {
      r.timer -= dt;

      if (r.state === 'PAUSE') {
        // Idle: tiny ear wiggle so they look alive
        const earL = r.mesh.getObjectByName('earL');
        const earR = r.mesh.getObjectByName('earR');
        if (earL) earL.rotation.z = 0.1 + 0.05 * Math.sin(Date.now() * 0.003 + r.timer);
        if (earR) earR.rotation.z = -0.1 - 0.05 * Math.sin(Date.now() * 0.003 + r.timer + 1);

        if (r.timer <= 0) {
          // Begin a new hop
          r.state  = 'HOP';
          r.t      = 0;
          r.fromPos = r.mesh.position.clone();
          r.toPos   = pickHopTarget(r.fromPos, r.rng);
          r.timer   = r.hopDur;
          // Face hop direction
          const dx = r.toPos.x - r.fromPos.x;
          const dz = r.toPos.z - r.fromPos.z;
          if (dx * dx + dz * dz > 0.001) {
            r.mesh.rotation.y = Math.atan2(dx, dz);
          }
        }

      } else {
        // HOP: animate parabolic arc
        r.t = 1 - Math.max(0, r.timer / r.hopDur);
        const u = r.t; // 0..1

        // Lerp XZ
        const px = r.fromPos.x + (r.toPos.x - r.fromPos.x) * u;
        const pz = r.fromPos.z + (r.toPos.z - r.fromPos.z) * u;
        // Parabola: h = 4*peak*u*(1-u)
        const arcY = 4 * RABBIT_HOP_HEIGHT * u * (1 - u);
        const baseYPos = r.fromPos.y + (r.toPos.y - r.fromPos.y) * u;

        r.mesh.position.set(px, baseYPos + arcY, pz);

        // Squash-stretch: stretch at peak, squash at start/end
        const stretch = 0.15 * Math.sin(u * Math.PI); // 0 at ends, +0.15 at peak
        const scaleY = 1.0 + stretch;
        const scaleXZ = 1.0 / Math.max(0.6, scaleY); // conservation of volume
        r.mesh.scale.set(scaleXZ, scaleY, scaleXZ);

        // Squash extra on landing (last 15% of hop)
        if (u > 0.82) {
          const landT = (u - 0.82) / 0.18;
          const squash = 0.22 * landT;
          r.mesh.scale.set(1 + squash * 0.4, Math.max(0.6, 1 - squash), 1 + squash * 0.4);
        }

        // A little forward lean during hop
        r.mesh.rotation.x = -0.25 * Math.sin(u * Math.PI);

        if (r.timer <= 0) {
          // Landed
          r.state = 'PAUSE';
          r.mesh.position.copy(r.toPos);
          r.mesh.scale.set(1, 1, 1);
          r.mesh.rotation.x = 0;
          r.pauseDur = RABBIT_PAUSE_MIN + r.rng() * (RABBIT_PAUSE_MAX - RABBIT_PAUSE_MIN);
          r.timer = r.pauseDur;
        }
      }
    }

    // -------------------------------------------------------------------------
    // BUTTERFLIES
    // -------------------------------------------------------------------------
    for (const bf of butterflies) {
      bf.flapT       += bf.flapSpeed * dt;
      bf.bobT        += bf.bobSpeed  * dt;
      bf.wanderTimer += dt;

      // New wander target periodically
      if (bf.wanderTimer >= bf.wanderInterval) {
        bf.wanderTimer = 0;
        bf.wanderInterval = 1.2 + bf.rng() * 2.2;
        const a  = bf.rng() * Math.PI * 2;
        const d  = bf.rng() * R * 0.78;
        bf.tx = Math.cos(a) * d;
        bf.tz = Math.sin(a) * d;
        bf.ty = bf.py + (bf.rng() - 0.5) * 0.8;
        // Clamp altitude to stay just above island
        bf.ty = Math.max(baseY + 0.2, Math.min(baseY + 1.5, bf.ty));
      }

      // Smooth drift toward target
      const lr = Math.min(1, bf.speed * dt * 1.8);
      bf.px += (bf.tx - bf.px) * lr;
      bf.pz += (bf.tz - bf.pz) * lr;
      bf.py += (bf.ty - bf.py) * Math.min(1, bf.speed * dt * 0.9);

      const bob = Math.sin(bf.bobT) * bf.bobAmp;
      bf.mesh.position.set(bf.px, bf.py + bob, bf.pz);

      // Face direction of travel
      const dx = bf.tx - bf.px;
      const dz = bf.tz - bf.pz;
      if (dx * dx + dz * dz > 0.0001) {
        bf.mesh.rotation.y = Math.atan2(dx, dz);
      }

      // Wing flap: open/close around Y axis at hinge
      // sin goes 0..1, map to angle 0..maxOpen
      const flapAngle = (0.45 + 0.55 * Math.abs(Math.sin(bf.flapT))) * 1.25;
      const hingeL = bf.mesh.getObjectByName('hingeL');
      const hingeR = bf.mesh.getObjectByName('hingeR');
      if (hingeL) hingeL.rotation.y =  flapAngle;
      if (hingeR) hingeR.rotation.y = -flapAngle;

      // Tilt body with flap (slight roll gives life)
      bf.mesh.rotation.z = 0.12 * Math.sin(bf.flapT * 0.5);
    }

    // -------------------------------------------------------------------------
    // FISH
    // -------------------------------------------------------------------------
    for (const f of fish) {
      f.timer -= dt;

      if (f.state === 'SUBMERGED') {
        f.mesh.visible   = false;
        f.splash.visible = false;

        if (f.timer <= 0) {
          // Start jump
          f.state = 'JUMP';
          f.t     = 0;
          f.timer = f.jumpDur;
          f.mesh.visible = true;

          // Give the fish a fresh random position in the water ring
          const a = Math.random() * Math.PI * 2;
          const r2 = FISH_RING_MIN + Math.random() * (FISH_RING_MAX - FISH_RING_MIN);
          f.x = Math.cos(a) * r2;
          f.z = Math.sin(a) * r2;
          f.jumpAngle = a;

          f.mesh.position.set(f.x, SEA_Y, f.z);
          // Splash at jump origin
          f.splash.position.set(f.x, SEA_Y + 0.02, f.z);
          f.splash.visible = true;
          _animateSplash(f.splash, 0, f.splashDur);
        }

      } else if (f.state === 'JUMP') {
        f.t = 1 - Math.max(0, f.timer / f.jumpDur);
        const u = f.t; // 0..1

        // Parabolic arc: y = SEA_Y + 4*PEAK*u*(1-u)
        const arcY = 4 * FISH_PEAK_H * u * (1 - u);
        f.mesh.position.set(f.x, SEA_Y + arcY, f.z);

        // Rotate fish: pitched up during rise, down during fall
        // Angle = derivative of parabola: peak at u=0.5 → pitch 0, slope at edges
        const pitchAngle = (0.5 - u) * Math.PI * 0.75;
        f.mesh.rotation.z = pitchAngle;
        // Face outward from island (or back in)
        f.mesh.rotation.y = f.jumpAngle + Math.PI * 0.5;

        // Wobble tail fin while airborne
        const tail = f.mesh.getObjectByName('tail');
        if (tail) tail.rotation.y = 0.3 * Math.sin(f.t * Math.PI * 6);

        if (f.timer <= 0) {
          // Splash on re-entry
          f.state = 'SPLASH';
          f.timer = f.splashDur;
          f.mesh.visible = false;
          f.splash.position.set(f.x, SEA_Y + 0.02, f.z);
          f.splash.visible = true;
          f.splash.scale.set(1, 1, 1);
          const ring = f.splash.getObjectByName('ring');
          if (ring) { ring.scale.set(1, 1, 1); ring.material.opacity = 0.7; }
        }

      } else if (f.state === 'SPLASH') {
        // Animate splash ring expanding and fading
        const progress = 1 - Math.max(0, f.timer / f.splashDur);
        _updateSplash(f.splash, progress);

        if (f.timer <= 0) {
          f.state = 'SUBMERGED';
          f.timer = 3.0 + Math.random() * 5.0; // random wait before next jump
          f.splash.visible = false;
        }
      }
    }
  }

  // Small helpers for splash animation

  function _animateSplash(splashGroup, progress, _dur) {
    // Called on initial exit splash; just show it
    splashGroup.visible = true;
    const ring = splashGroup.getObjectByName('ring');
    if (ring) { ring.scale.set(0.3, 0.3, 0.3); ring.material.opacity = 0.8; }
  }

  function _updateSplash(splashGroup, progress) {
    // Expand ring, fade out
    const ring = splashGroup.getObjectByName('ring');
    if (ring) {
      const s = 0.5 + progress * 2.5;
      ring.scale.set(s, s, s);
      ring.material.opacity = Math.max(0, 0.7 * (1 - progress));
    }
    // Drop spheres arc up then fall
    for (let i = 0; i < 5; i++) {
      const drop = splashGroup.getObjectByName(`drop${i}`);
      if (drop) {
        const dy = 0.18 * Math.sin(progress * Math.PI) * (1 - progress);
        drop.position.y = dy;
        drop.material.opacity = Math.max(0, 0.8 * (1 - progress * 1.2));
      }
    }
  }

  // =========================================================================
  // DISPOSE
  // =========================================================================

  function dispose() {
    scene.remove(root);
    root.traverse((obj) => {
      if (obj.isMesh) {
        obj.geometry?.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material?.dispose();
        }
      }
    });
  }

  return { update, dispose };
}
