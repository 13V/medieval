// ============================================================================
// wildlife.js — Ambient wildlife for the medieval hex tower-defense.
// Adds a small flock of birds gliding above the island and a couple of
// butterflies fluttering near ground level. All geometry is low-poly /
// silhouette-style to match the Kingshot/diorama art direction.
//
// CONTRACT:
//   import * as THREE from 'three';
//   export function createWildlife(scene, board, opts = {})
//   returns { update(dt, camera), dispose() }
// ============================================================================

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Seeded deterministic PRNG — same formula used by board.js. */
function makeLCG(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Build a tiny bird silhouette mesh.
 * Two triangular wings sharing a body vertex, forming a shallow V.
 * The mesh is split into three child objects so wings can rotate
 * independently: body (tiny cylinder) + leftWing + rightWing.
 */
function createBirdMesh(color) {
  const group = new THREE.Group();

  // Shared material — dark stylized silhouette
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });

  // Wing half-span and chord
  const span  = 0.28;  // half-span per wing
  const chord = 0.10;  // wing depth (front-to-back)

  // Left wing: a flat triangle in local XZ, hinge along X axis
  // Tip points toward -X, leading edge tilts slightly forward (+Z)
  const leftGeo = new THREE.BufferGeometry();
  leftGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    0,        0, 0,          // root (hinge)
   -span,     0, chord * 0.4, // tip forward
   -span * 0.5, 0, chord,    // trailing edge
  ], 3));
  leftGeo.setIndex([0, 1, 2]);
  leftGeo.computeVertexNormals();
  const leftWing = new THREE.Mesh(leftGeo, mat);
  leftWing.name = 'wingL';

  // Right wing: mirror of left
  const rightGeo = new THREE.BufferGeometry();
  rightGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    0,        0, 0,
    span,     0, chord * 0.4,
    span * 0.5, 0, chord,
  ], 3));
  rightGeo.setIndex([0, 2, 1]); // flip winding for DoubleSide consistency
  rightGeo.computeVertexNormals();
  const rightWing = new THREE.Mesh(rightGeo, mat);
  rightWing.name = 'wingR';

  // Tiny body dot so the bird reads as a unit
  const bodyGeo = new THREE.SphereGeometry(0.04, 4, 2);
  const body    = new THREE.Mesh(bodyGeo, mat);
  body.name = 'body';

  // Tail — small trailing triangle
  const tailGeo = new THREE.BufferGeometry();
  tailGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    0,     0,  0,
   -0.06,  0,  chord * 1.4,
    0.06,  0,  chord * 1.4,
  ], 3));
  tailGeo.setIndex([0, 1, 2]);
  tailGeo.computeVertexNormals();
  const tail = new THREE.Mesh(tailGeo, mat);
  tail.name = 'tail';

  group.add(body, leftWing, rightWing, tail);
  group.castShadow = false;
  group.receiveShadow = false;
  return group;
}

/**
 * Build a tiny butterfly: two quad "wings" (each a pair of triangles)
 * that rotate around a vertical hinge.  Bright flat colours.
 */
function createButterflyMesh(colorA, colorB) {
  const group = new THREE.Group();

  const matA = new THREE.MeshBasicMaterial({ color: colorA, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
  const matB = new THREE.MeshBasicMaterial({ color: colorB, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });

  const w = 0.12; // wing width
  const h = 0.09; // wing height

  // Helper: build a simple "wing" quad (upper lobe only, good enough at this scale)
  function makeWingGeo(side) {
    const x = side * w;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([
      0,    0,   0,
      x,    h,   0,
      x,    0,   0,
      x * 0.6, -h * 0.5, 0,
      0,   -h * 0.3, 0,
    ], 3));
    // Two triangles forming the wing shape
    if (side > 0) {
      geo.setIndex([0, 1, 2,  0, 3, 1,  0, 4, 3]);
    } else {
      geo.setIndex([0, 2, 1,  0, 1, 3,  0, 3, 4]);
    }
    geo.computeVertexNormals();
    return geo;
  }

  const leftWing  = new THREE.Mesh(makeWingGeo(-1), matA);
  leftWing.name   = 'wingL';
  const rightWing = new THREE.Mesh(makeWingGeo( 1), matB);
  rightWing.name  = 'wingR';

  group.add(leftWing, rightWing);
  return group;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * @param {THREE.Scene}  scene
 * @param {{ radius: number, baseY: number }} board
 * @param {object} opts
 *   opts.birdCount     {number} 5–9 birds (default 7)
 *   opts.butterflyCount {number} 0–3 (default 2)
 *   opts.birdColor     {number} hex color (default dark grey)
 */
export function createWildlife(scene, board, opts = {}) {
  const rng = makeLCG(0xDEADBEEF);

  const R      = board.radius ?? 11.7;
  const baseY  = board.baseY  ?? 2.6;

  const BIRD_COUNT      = Math.max(5, Math.min(9, opts.birdCount      ?? 7));
  const BUTTERFLY_COUNT = Math.max(0, Math.min(3, opts.butterflyCount ?? 2));
  const BIRD_COLOR      = opts.birdColor ?? 0x1a1a2e;

  // Root group — added once to scene
  const root = new THREE.Group();
  root.name = 'wildlife';
  scene.add(root);

  // -------------------------------------------------------------------------
  // BIRDS
  // -------------------------------------------------------------------------

  /**
   * Each bird has a parametric flight path.
   * We alternate between circle and lemniscate (figure-eight) paths.
   *
   * Circle:     x = cx + r*cos(t),  z = cz + r*sin(t)
   * Lemniscate: x = cx + r*cos(t)/(1+sin²(t)),
   *             z = cz + r*sin(t)*cos(t)/(1+sin²(t))
   */

  /** Sample a circle path at parameter t. Returns {x, z}. */
  function circlePath(cx, cz, r, t) {
    return { x: cx + r * Math.cos(t), z: cz + r * Math.sin(t) };
  }

  /** Sample a lemniscate (Bernoulli) path at parameter t. Returns {x, z}. */
  function lemniscatePath(cx, cz, r, t) {
    const s2 = Math.sin(t) * Math.sin(t);
    const d  = 1 + s2;
    return {
      x: cx + r * Math.cos(t) / d,
      z: cz + r * Math.sin(t) * Math.cos(t) / d,
    };
  }

  const birds = [];

  for (let i = 0; i < BIRD_COUNT; i++) {
    const mesh = createBirdMesh(BIRD_COLOR);
    root.add(mesh);

    const useCircle = rng() > 0.4; // 60% circles, 40% figure-eights

    // Spread centres across the island, biased inward so birds stay visible
    const angle  = rng() * Math.PI * 2;
    const dist   = R * (0.25 + rng() * 0.45);
    const cx     = Math.cos(angle) * dist;
    const cz     = Math.sin(angle) * dist;

    const radius = R * (0.25 + rng() * 0.35);   // orbit radius
    const height = baseY + 5 + rng() * 7;        // y ∈ [baseY+5 … baseY+12]
    const speed  = (0.18 + rng() * 0.22) * (rng() < 0.5 ? 1 : -1); // varied speed + direction
    const phase  = rng() * Math.PI * 2;
    const flapSpeed   = 2.5 + rng() * 2.0;      // wing-flap Hz × 2π factor
    const flapAmp     = 0.35 + rng() * 0.25;    // max wing rotation in radians
    const heightBob   = 0.4 + rng() * 0.4;      // gentle altitude oscillation amplitude
    const heightPhase = rng() * Math.PI * 2;

    birds.push({
      mesh,
      useCircle,
      cx, cz,
      radius,
      height,
      speed,
      phase,
      flapSpeed,
      flapAmp,
      heightBob,
      heightPhase,
      t: phase,       // current parameter (accumulates over time)
      tHeight: heightPhase,
    });
  }

  // -------------------------------------------------------------------------
  // BUTTERFLIES
  // -------------------------------------------------------------------------

  const BUTTERFLY_COLORS = [
    [0xff6b35, 0xffd700], // orange + gold
    [0x7b2d8b, 0xf0c0e8], // purple + pink
    [0x2d8b5a, 0xc8ff80], // green + lime
  ];

  const butterflies = [];

  for (let i = 0; i < BUTTERFLY_COUNT; i++) {
    const [cA, cB] = BUTTERFLY_COLORS[i % BUTTERFLY_COLORS.length];
    const mesh = createButterflyMesh(cA, cB);
    root.add(mesh);

    // Wander centre — near island centre, low altitude
    const wx = (rng() - 0.5) * R * 0.6;
    const wz = (rng() - 0.5) * R * 0.6;
    const wy = baseY + 0.3 + rng() * 1.2;

    butterflies.push({
      mesh,
      // Current position
      px: wx, py: wy, pz: wz,
      // Wander target
      tx: wx, ty: wy, tz: wz,
      // Wander timer
      wanderTimer: 0,
      wanderInterval: 1.5 + rng() * 2.0,
      // Wing flap
      flapSpeed: 5 + rng() * 4,
      flapT: rng() * Math.PI * 2,
      // Move speed
      speed: 0.8 + rng() * 0.6,
      // Vertical bob
      bobAmp:   0.15 + rng() * 0.15,
      bobSpeed: 2.0  + rng() * 2.0,
      bobT:     rng() * Math.PI * 2,
      rng: makeLCG((0xABCD1234 + i * 0x99) >>> 0),
    });
  }

  // -------------------------------------------------------------------------
  // Reused temp objects to avoid per-frame allocations
  // -------------------------------------------------------------------------
  const _pos0 = new THREE.Vector3();
  const _pos1 = new THREE.Vector3();
  const _dir  = new THREE.Vector3();
  const _up   = new THREE.Vector3(0, 1, 0);
  const _quat = new THREE.Quaternion();
  const _mat3 = new THREE.Matrix4();

  // -------------------------------------------------------------------------
  // UPDATE
  // -------------------------------------------------------------------------

  function update(dt, _camera) {
    // -- Birds --
    for (const bird of birds) {
      bird.t       += bird.speed  * dt;
      bird.tHeight += dt;

      // Sample path
      let pos;
      if (bird.useCircle) {
        pos = circlePath(bird.cx, bird.cz, bird.radius, bird.t);
      } else {
        pos = lemniscatePath(bird.cx, bird.cz, bird.radius, bird.t);
      }

      // Height with gentle bob
      const y = bird.height + Math.sin(bird.tHeight * bird.heightBob * 0.8) * bird.heightBob;

      // Sample slightly ahead for orientation (banking)
      const dt2 = 0.05;
      let posAhead;
      if (bird.useCircle) {
        posAhead = circlePath(bird.cx, bird.cz, bird.radius, bird.t + dt2 * Math.sign(bird.speed));
      } else {
        posAhead = lemniscatePath(bird.cx, bird.cz, bird.radius, bird.t + dt2 * Math.sign(bird.speed));
      }

      _pos0.set(pos.x, y, pos.z);
      _pos1.set(posAhead.x, y, posAhead.z);

      bird.mesh.position.copy(_pos0);

      // Orient along velocity — look toward next sample point
      _dir.subVectors(_pos1, _pos0);
      if (_dir.lengthSq() > 1e-8) {
        _dir.normalize();
        // Build rotation: forward = _dir, up = world up
        // We'll use quaternion from lookAt equivalent
        _mat3.lookAt(_pos0, _pos1, _up);
        _quat.setFromRotationMatrix(_mat3);
        bird.mesh.quaternion.copy(_quat);

        // Banking: tilt into the turn (roll around the forward axis).
        // Approximate bank as the cross product's Y component scaled.
        const bankAngle = Math.atan2(_dir.x, _dir.z) * 0.4;
        bird.mesh.rotateX(bankAngle * 0.15); // subtle roll
      }

      // Wing flap — rotate wingL and wingR children around the X axis (dihedral)
      const flapAngle = Math.sin(bird.t * bird.flapSpeed) * bird.flapAmp;
      const wingL = bird.mesh.getObjectByName('wingL');
      const wingR = bird.mesh.getObjectByName('wingR');
      if (wingL) wingL.rotation.x = -flapAngle;
      if (wingR) wingR.rotation.x =  flapAngle;
    }

    // -- Butterflies --
    for (const bf of butterflies) {
      bf.flapT  += bf.flapSpeed * dt;
      bf.bobT   += bf.bobSpeed  * dt;
      bf.wanderTimer += dt;

      // Pick a new wander target periodically
      if (bf.wanderTimer >= bf.wanderInterval) {
        bf.wanderTimer = 0;
        bf.wanderInterval = 1.5 + bf.rng() * 2.0;
        bf.tx = (bf.rng() - 0.5) * R * 0.55;
        bf.tz = (bf.rng() - 0.5) * R * 0.55;
        bf.ty = bf.py + (bf.rng() - 0.5) * 0.6;
        // Clamp altitude
        bf.ty = Math.max(baseY + 0.2, Math.min(baseY + 2.5, bf.ty));
      }

      // Lerp toward wander target
      const lerpRate = bf.speed * dt;
      bf.px += (bf.tx - bf.px) * Math.min(1, lerpRate * 1.5);
      bf.pz += (bf.tz - bf.pz) * Math.min(1, lerpRate * 1.5);
      bf.py += (bf.ty - bf.py) * Math.min(1, lerpRate * 1.0);

      // Vertical bob on top of wander
      const bobY = Math.sin(bf.bobT) * bf.bobAmp;

      bf.mesh.position.set(bf.px, bf.py + bobY, bf.pz);

      // Face direction of travel
      const dx = bf.tx - bf.px;
      const dz = bf.tz - bf.pz;
      if (dx * dx + dz * dz > 0.001) {
        bf.mesh.rotation.y = Math.atan2(dx, dz);
      }

      // Wing flap — fold wings open/closed around Y axis of each wing child
      const openAngle = (0.5 + 0.5 * Math.sin(bf.flapT)) * 1.1; // 0 … ~1.1 rad
      const wingL = bf.mesh.getObjectByName('wingL');
      const wingR = bf.mesh.getObjectByName('wingR');
      if (wingL) wingL.rotation.y =  openAngle;
      if (wingR) wingR.rotation.y = -openAngle;
    }
  }

  // -------------------------------------------------------------------------
  // DISPOSE
  // -------------------------------------------------------------------------

  function dispose() {
    // Remove from scene
    scene.remove(root);

    // Dispose all geometry and materials in the subtree
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
