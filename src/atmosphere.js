/**
 * atmosphere.js — Floating dust/pollen motes + valley ground mist
 * Stylized low-poly medieval diorama mood layer.
 *
 * CONTRACT:
 *   import * as THREE from 'three';
 *   export function createAtmosphere(scene, board, opts = {}) { ... }
 *   Returns { update(dt, camera), dispose() }
 *
 * Objects are added to `scene` directly (world-space).
 * No external deps beyond three core.
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Seeded pseudo-random (no Math.random side-effects on caller). */
function makeRng(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/**
 * Build a soft radial-gradient CanvasTexture for mist sprites.
 * Centre is opaque white, edges fully transparent.
 */
function makeMistTexture(size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cx);
  grad.addColorStop(0.0, 'rgba(255,252,248,0.55)');
  grad.addColorStop(0.4, 'rgba(255,252,245,0.20)');
  grad.addColorStop(0.75, 'rgba(255,250,240,0.05)');
  grad.addColorStop(1.0, 'rgba(255,248,235,0.00)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Build a tiny soft disc CanvasTexture for dust/pollen mote Points.
 */
function makeMoteTexture(size = 32) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cx * 0.9);
  grad.addColorStop(0.0, 'rgba(255,248,215,1.0)');
  grad.addColorStop(0.5, 'rgba(255,240,190,0.6)');
  grad.addColorStop(1.0, 'rgba(255,235,170,0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Dust / pollen mote cloud
// ---------------------------------------------------------------------------

const MOTE_COUNT = 320;          // kept low for performance
const MOTE_SPREAD_XZ = 1.0;     // multiplier on board.radius
const MOTE_Y_MIN_OFFSET = 0.3;  // above board.baseY
const MOTE_Y_RANGE = 6.0;       // height band
const MOTE_SIZE_MIN = 0.04;
const MOTE_SIZE_MAX = 0.14;
const MOTE_OPACITY_BASE = 0.55;  // material opacity ceiling

/**
 * Creates a THREE.Points cloud for floating dust/pollen motes.
 */
function createMotesCloud(scene, board, rng) {
  const radius = board.radius * MOTE_SPREAD_XZ;
  const yBase = board.baseY + MOTE_Y_MIN_OFFSET;

  // positions (x,y,z per mote)
  const positions = new Float32Array(MOTE_COUNT * 3);
  // per-mote phase offset for twinkle (stored in a separate typed array, not a BufferAttribute)
  const phases = new Float32Array(MOTE_COUNT);
  // per-mote drift speed
  const driftSpeeds = new Float32Array(MOTE_COUNT * 3); // dx, dy, dz rate factors
  // per-mote initial sizes (vary via shader not easily — we vary positions/opacity over time)
  const sizes = new Float32Array(MOTE_COUNT);

  for (let i = 0; i < MOTE_COUNT; i++) {
    // scatter within a disc
    const angle = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * radius; // sqrt for uniform disc distribution
    positions[i * 3 + 0] = Math.cos(angle) * r;
    positions[i * 3 + 1] = yBase + rng() * MOTE_Y_RANGE;
    positions[i * 3 + 2] = Math.sin(angle) * r;

    phases[i] = rng() * Math.PI * 2;

    // drift: gentle upward + slow sideways meander
    driftSpeeds[i * 3 + 0] = (rng() - 0.5) * 0.18; // x drift rate
    driftSpeeds[i * 3 + 1] = 0.04 + rng() * 0.06;  // upward rate
    driftSpeeds[i * 3 + 2] = (rng() - 0.5) * 0.18; // z drift rate

    sizes[i] = MOTE_SIZE_MIN + rng() * (MOTE_SIZE_MAX - MOTE_SIZE_MIN);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  // We'll also store original radii so we can wrap motes back when they drift out
  geo.userData.phases = phases;
  geo.userData.driftSpeeds = driftSpeeds;
  geo.userData.sizes = sizes;
  geo.userData.radius = radius;
  geo.userData.yBase = yBase;
  geo.userData.yMax = yBase + MOTE_Y_RANGE;
  geo.userData.time = 0;

  const moteTex = makeMoteTexture(32);

  const mat = new THREE.PointsMaterial({
    size: MOTE_SIZE_MAX * 1.4,
    map: moteTex,
    vertexColors: false,
    color: new THREE.Color(1.0, 0.97, 0.85),
    transparent: true,
    opacity: MOTE_OPACITY_BASE,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });

  const points = new THREE.Points(geo, mat);
  points.name = 'atmosphereMotes';
  // Disable frustum culling so motes always draw even when bounding sphere clips
  points.frustumCulled = false;
  scene.add(points);

  return { points, mat, moteTex };
}

/**
 * Animate the motes each frame.
 */
function updateMotes(dt, moteObj) {
  const { points } = moteObj;
  const geo = points.geometry;
  const pos = geo.attributes.position;
  const { phases, driftSpeeds, sizes, radius, yBase, yMax } = geo.userData;

  geo.userData.time += dt;
  const t = geo.userData.time;

  for (let i = 0; i < MOTE_COUNT; i++) {
    const ix = i * 3;
    const iy = i * 3 + 1;
    const iz = i * 3 + 2;

    const ph = phases[i];
    const twinkleT = t * (0.3 + (ph * 0.1)) + ph;

    // Drift in world space — accumulate small per-frame nudge
    // Use a gentle sinusoidal meander to avoid straight lines
    pos.array[ix] += (driftSpeeds[ix] + Math.sin(twinkleT * 0.7 + ph) * 0.03) * dt;
    pos.array[iy] += driftSpeeds[iy] * dt;
    pos.array[iz] += (driftSpeeds[iz] + Math.cos(twinkleT * 0.5 + ph * 1.3) * 0.03) * dt;

    // Wrap vertically: when mote drifts above yMax, reset to yBase
    if (pos.array[iy] > yMax) {
      pos.array[iy] = yBase + Math.random() * 0.5; // slight variance on reset
      // reset xz within disc too
      const angle = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      pos.array[ix] = Math.cos(angle) * r;
      pos.array[iz] = Math.sin(angle) * r;
    }

    // Wrap horizontally: keep within radius
    const dx = pos.array[ix];
    const dz = pos.array[iz];
    const dist2 = dx * dx + dz * dz;
    if (dist2 > radius * radius * 1.1) {
      // Push back toward centre with slight randomness
      const angle2 = Math.random() * Math.PI * 2;
      const r2 = Math.sqrt(Math.random() * 0.5) * radius; // inner half
      pos.array[ix] = Math.cos(angle2) * r2;
      pos.array[iz] = Math.sin(angle2) * r2;
    }
  }

  pos.needsUpdate = true;

  // Global twinkle: vary material opacity sinusoidally
  moteObj.mat.opacity = MOTE_OPACITY_BASE * (0.7 + 0.3 * Math.sin(t * 0.4));
}

// ---------------------------------------------------------------------------
// Valley / ground mist sprites
// ---------------------------------------------------------------------------

const MIST_COUNT = 9;            // few large sprites is plenty
const MIST_OPACITY_MAX = 0.12;   // very subtle
const MIST_Y_MIN = -0.2;
const MIST_Y_MAX = 0.55;
const MIST_RADIUS_MIN_FACTOR = 0.9;
const MIST_RADIUS_MAX_FACTOR = 1.55;
const MIST_SCALE_MIN = 4.5;
const MIST_SCALE_MAX = 9.0;
const MIST_DRIFT_SPEED = 0.008;  // very slow drift

/**
 * Creates a group of billboard mist sprites around the island edges / valley.
 */
function createMistSprites(scene, board, rng) {
  const radius = board.radius;
  const mistTex = makeMistTexture(128);
  const sprites = [];

  for (let i = 0; i < MIST_COUNT; i++) {
    const mat = new THREE.SpriteMaterial({
      map: mistTex,
      color: new THREE.Color(0.98, 0.97, 0.94),
      transparent: true,
      opacity: MIST_OPACITY_MAX * (0.5 + rng() * 0.5),
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    const sprite = new THREE.Sprite(mat);

    // Scatter around island perimeter (ring between radius_min and radius_max)
    const angle = (i / MIST_COUNT) * Math.PI * 2 + rng() * 0.4;
    const r = radius * (MIST_RADIUS_MIN_FACTOR + rng() * (MIST_RADIUS_MAX_FACTOR - MIST_RADIUS_MIN_FACTOR));
    const y = MIST_Y_MIN + rng() * (MIST_Y_MAX - MIST_Y_MIN);
    sprite.position.set(Math.cos(angle) * r, y, Math.sin(angle) * r);

    const scale = MIST_SCALE_MIN + rng() * (MIST_SCALE_MAX - MIST_SCALE_MIN);
    sprite.scale.set(scale, scale * (0.35 + rng() * 0.25), 1);

    // Store drift metadata
    sprite.userData.driftAngle = angle;
    sprite.userData.driftRadius = r;
    sprite.userData.driftSpeed = MIST_DRIFT_SPEED * (0.5 + rng() * 1.0) * (rng() > 0.5 ? 1 : -1);
    sprite.userData.opacityBase = mat.opacity;
    sprite.userData.opacityPhase = rng() * Math.PI * 2;
    sprite.userData.opacityRate = 0.08 + rng() * 0.12;

    sprite.name = 'atmosphereMist';
    scene.add(sprite);
    sprites.push(sprite);
  }

  return { sprites, mistTex };
}

/**
 * Animate mist sprites (billboarding is automatic with THREE.Sprite).
 */
function updateMist(dt, mistObj) {
  const t = (mistObj.time = (mistObj.time || 0) + dt);

  for (const sprite of mistObj.sprites) {
    const ud = sprite.userData;

    // Slowly drift around the island in a gentle arc
    ud.driftAngle += ud.driftSpeed * dt;
    sprite.position.x = Math.cos(ud.driftAngle) * ud.driftRadius;
    sprite.position.z = Math.sin(ud.driftAngle) * ud.driftRadius;

    // Breathe opacity
    sprite.material.opacity =
      ud.opacityBase * (0.55 + 0.45 * Math.sin(t * ud.opacityRate + ud.opacityPhase));
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create atmosphere effects for the medieval hex tower-defense scene.
 *
 * @param {THREE.Scene} scene   - The Three.js scene.
 * @param {object}      board   - Board object with radius, baseY properties.
 * @param {object}      opts    - Optional overrides (reserved for future use).
 * @returns {{ update(dt: number, camera: THREE.Camera): void, dispose(): void }}
 */
export function createAtmosphere(scene, board, opts = {}) {
  const rng = makeRng(opts.seed != null ? opts.seed : 42);

  // 1. Floating dust/pollen motes
  const moteObj = createMotesCloud(scene, board, rng);

  // 2. Valley / ground mist sprites
  const mistObj = createMistSprites(scene, board, rng);
  mistObj.time = 0;

  // ---------------------------------------------------------------------------
  // update — called each frame with delta-time and camera
  // ---------------------------------------------------------------------------
  function update(dt, /* camera */ _camera) {
    // Clamp dt to avoid large jumps on tab-switch etc.
    const safeDt = Math.min(dt, 0.05);

    updateMotes(safeDt, moteObj);
    updateMist(safeDt, mistObj);
  }

  // ---------------------------------------------------------------------------
  // dispose — clean up GPU resources
  // ---------------------------------------------------------------------------
  function dispose() {
    // Motes
    scene.remove(moteObj.points);
    moteObj.points.geometry.dispose();
    moteObj.mat.dispose();
    moteObj.moteTex.dispose();

    // Mist sprites
    for (const sprite of mistObj.sprites) {
      scene.remove(sprite);
      sprite.material.dispose();
    }
    mistObj.mistTex.dispose();
  }

  return { update, dispose };
}
