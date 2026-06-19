/**
 * clouds.js — Stylized low-poly cloud system for the medieval hex tower-defense.
 *
 * Contract:
 *   import * as THREE from 'three';
 *   export function createClouds(scene, board, opts = {})
 *   Returns { update(dt, camera), dispose() }
 *
 * Design intent:
 *   The island sits high on a mountain (BASE_LIFT ~2.6). Two cloud layers sell
 *   the "floating above the world" read:
 *
 *   1. LOW CLOUD SEA  — a ring of soft billboarded sprites orbiting *around*
 *      the island at y ≈ -0.8…+0.3, radius band board.radius*1.2…board.radius*4.
 *      They give the impression that the island punches up through a sea of cloud
 *      sitting in the valley below.
 *
 *   2. HIGH DRIFTING CLOUDS — a handful of larger clouds well above the scene
 *      (y ~14-24) that drift slowly across, adding sky life without cluttering
 *      the gameplay view.
 *
 *   All clouds use CanvasTexture sprite sheets (radial gradient puffs) rendered
 *   as THREE.Sprite (always camera-facing). No new npm deps; pure Three.js core.
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a soft puffy-cloud canvas texture.  Returns a THREE.CanvasTexture. */
function makePuffTexture(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Multiple overlapping radial gradients give a puffy multi-lobe look.
  const half = size / 2;

  // Background: fully transparent
  ctx.clearRect(0, 0, size, size);

  // Draw several overlapping soft circular blobs
  const blobs = [
    { x: 0.50, y: 0.50, r: 0.38, alpha: 0.85 }, // centre (largest)
    { x: 0.30, y: 0.52, r: 0.28, alpha: 0.75 }, // left lobe
    { x: 0.70, y: 0.52, r: 0.28, alpha: 0.75 }, // right lobe
    { x: 0.50, y: 0.35, r: 0.22, alpha: 0.65 }, // top bump
    { x: 0.35, y: 0.38, r: 0.18, alpha: 0.55 }, // upper-left
    { x: 0.65, y: 0.38, r: 0.18, alpha: 0.55 }, // upper-right
  ];

  ctx.globalCompositeOperation = 'source-over';
  for (const b of blobs) {
    const cx = b.x * size;
    const cy = b.y * size;
    const radius = b.r * size;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0.0, `rgba(255,255,255,${b.alpha})`);
    grad.addColorStop(0.5, `rgba(240,245,255,${b.alpha * 0.7})`);
    grad.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/** Build a slightly thinner, flatter texture for the low sea layer. */
function makeSeaTexture(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = Math.floor(size * 0.55); // flatter aspect
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const w = canvas.width;
  const h = canvas.height;

  const blobs = [
    { x: 0.50, y: 0.60, r: 0.42, alpha: 0.70 },
    { x: 0.25, y: 0.65, r: 0.30, alpha: 0.60 },
    { x: 0.75, y: 0.65, r: 0.30, alpha: 0.60 },
    { x: 0.50, y: 0.40, r: 0.25, alpha: 0.50 },
    { x: 0.15, y: 0.70, r: 0.20, alpha: 0.40 },
    { x: 0.85, y: 0.70, r: 0.20, alpha: 0.40 },
  ];

  for (const b of blobs) {
    const cx = b.x * w;
    const cy = b.y * h;
    const radius = b.r * Math.min(w, h);
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0.0, `rgba(255,255,255,${b.alpha})`);
    grad.addColorStop(0.55, `rgba(245,248,255,${b.alpha * 0.5})`);
    grad.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/** Linear interpolation helper. */
function lerp(a, b, t) { return a + (b - a) * t; }

/** Random float in [lo, hi]. */
function rand(lo, hi) { return lo + Math.random() * (hi - lo); }

// ---------------------------------------------------------------------------
// Cloud sea (low layer)
// ---------------------------------------------------------------------------

/**
 * Spawn N sprites that orbit the island at various radii and heights forming
 * a "sea of cloud" in the valley below the island.
 *
 * Each sprite stores drift data in userData:
 *   { angle, radius, speed, y, scaleX, scaleY, phaseOffset }
 */
function buildCloudSea(group, puffTex, seaTex, board, opts) {
  const count   = opts.seaCount   ?? 38;
  const rInner  = board.radius * (opts.seaRInner ?? 1.2);
  const rOuter  = board.radius * (opts.seaROuter ?? 4.0);
  const yLo     = opts.seaYLo    ?? -0.8;
  const yHi     = opts.seaYHi    ??  0.3;
  const speedLo = opts.seaSpeedLo ?? 0.008;
  const speedHi = opts.seaSpeedHi ?? 0.025;

  const sprites = [];

  for (let i = 0; i < count; i++) {
    // Alternate between puffy and sea textures for variety
    const tex = i % 3 === 0 ? puffTex : seaTex;

    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      opacity: rand(0.28, 0.62),
    });

    const sprite = new THREE.Sprite(mat);

    // Distribute in the radius band using sqrt for even area coverage
    const t = Math.sqrt(Math.random()); // bias toward outer ring
    const radius = lerp(rInner, rOuter, t);
    const angle  = rand(0, Math.PI * 2);
    const y      = rand(yLo, yHi);

    const scaleW = rand(4.5, 11.0);
    const scaleH = scaleW * (tex === seaTex ? rand(0.3, 0.5) : rand(0.5, 0.75));

    sprite.scale.set(scaleW, scaleH, 1);
    sprite.position.set(
      Math.cos(angle) * radius,
      y,
      Math.sin(angle) * radius
    );

    sprite.userData = {
      angle,
      radius,
      speed:       rand(speedLo, speedHi) * (Math.random() < 0.5 ? 1 : -1),
      y,
      scaleX:      scaleW,
      scaleY:      scaleH,
      phaseOffset: rand(0, Math.PI * 2),
    };

    group.add(sprite);
    sprites.push(sprite);
  }

  return sprites;
}

// ---------------------------------------------------------------------------
// High drifting clouds (upper layer)
// ---------------------------------------------------------------------------

/**
 * A high drifting cloud is composed of a small cluster of sprites (3–5) packed
 * together to look like a multi-lobe cartoon cloud.  The cluster moves as a
 * unit across the sky in a straight line and wraps.
 */
function buildClusterSprites(group, puffTex, cx, cy, cz, baseScale) {
  const lobes = [
    { dx:  0.0, dy:  0.0, dz: 0.0, s: 1.00 },
    { dx: -0.6, dy: -0.1, dz: 0.0, s: 0.72 },
    { dx:  0.6, dy: -0.1, dz: 0.0, s: 0.72 },
    { dx: -0.3, dy:  0.3, dz: 0.0, s: 0.55 },
    { dx:  0.3, dy:  0.3, dz: 0.0, s: 0.55 },
  ];

  const sprites = [];
  for (const l of lobes) {
    const mat = new THREE.SpriteMaterial({
      map: puffTex,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      opacity: rand(0.55, 0.80),
    });
    const s = new THREE.Sprite(mat);
    const sw = baseScale * l.s;
    const sh = sw * rand(0.6, 0.8);
    s.scale.set(sw, sh, 1);
    s.position.set(
      cx + l.dx * baseScale * 0.65,
      cy + l.dy * baseScale * 0.35,
      cz
    );
    s.userData = { localDx: l.dx, localDy: l.dy };
    group.add(s);
    sprites.push(s);
  }
  return sprites;
}

/**
 * Build high cloud clusters.  Each cluster has:
 *   { sprites[], cx, cy, cz, vx, vz, baseScale, wrapRadius }
 */
function buildHighClouds(group, puffTex, board, opts) {
  const count    = opts.highCount   ?? 7;
  const yLo      = opts.highYLo     ?? 14;
  const yHi      = opts.highYHi     ?? 24;
  const wrapR    = board.radius * (opts.highWrapR ?? 4.5);
  const speedLo  = opts.highSpeedLo ?? 0.4;
  const speedHi  = opts.highSpeedHi ?? 1.0;

  const clusters = [];

  for (let i = 0; i < count; i++) {
    const cx         = rand(-wrapR, wrapR);
    const cy         = rand(yLo, yHi);
    const cz         = rand(-wrapR, wrapR);
    const baseScale  = rand(6, 14);

    // Drift mostly along X or Z axis for a natural cross-sky motion
    const angle      = rand(0, Math.PI * 2);
    const speed      = rand(speedLo, speedHi);
    const vx         = Math.cos(angle) * speed;
    const vz         = Math.sin(angle) * speed;

    const sprites = buildClusterSprites(group, puffTex, cx, cy, cz, baseScale);

    clusters.push({ sprites, cx, cy, cz, vx, vz, baseScale, wrapR });
  }

  return clusters;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * createClouds — attach a two-layer cloud system to the scene.
 *
 * @param {THREE.Scene}  scene
 * @param {{ radius: number, baseY: number }} board
 * @param {object} [opts]
 *   — seaCount, seaRInner, seaROuter, seaYLo, seaYHi, seaSpeedLo, seaSpeedHi
 *   — highCount, highYLo, highYHi, highWrapR, highSpeedLo, highSpeedHi
 * @returns {{ update(dt: number, camera: THREE.Camera): void, dispose(): void }}
 */
export function createClouds(scene, board, opts = {}) {
  // Root group — everything lives here so disposal is clean.
  const group = new THREE.Group();
  group.name  = 'clouds';
  scene.add(group);

  // Shared textures (created once, shared across all sprites).
  const puffTex = makePuffTexture(256);
  const seaTex  = makeSeaTexture(256);

  // ---- Layer 1: cloud sea (low, surrounding the island) ----
  const seaSprites = buildCloudSea(group, puffTex, seaTex, board, opts);

  // ---- Layer 2: high drifting cloud clusters ----
  const highClusters = buildHighClouds(group, puffTex, board, opts);

  // Elapsed time accumulator (used for gentle vertical bobbing).
  let elapsed = 0;

  // ---------------------------------------------------------------------------
  // update — call each frame with the game's delta-time (seconds) and camera.
  // THREE.Sprite is always camera-facing automatically, so no manual billboarding
  // is needed.  We handle drift, wrap, and a subtle bob here.
  // ---------------------------------------------------------------------------
  function update(dt, _camera) {
    elapsed += dt;

    // -- Sea sprites: orbit around island --
    for (const s of seaSprites) {
      const ud = s.userData;
      ud.angle += ud.speed * dt;

      // Gentle vertical bob (very subtle, ~±0.15 units over ~15s period).
      const bob = Math.sin(elapsed * 0.4 + ud.phaseOffset) * 0.12;

      s.position.x = Math.cos(ud.angle) * ud.radius;
      s.position.z = Math.sin(ud.angle) * ud.radius;
      s.position.y = ud.y + bob;
    }

    // -- High clusters: linear drift + wrap --
    for (const c of highClusters) {
      c.cx += c.vx * dt;
      c.cz += c.vz * dt;

      // Wrap around when a cluster drifts too far from origin.
      const wr = c.wrapR;
      if (c.cx >  wr) c.cx -= wr * 2;
      if (c.cx < -wr) c.cx += wr * 2;
      if (c.cz >  wr) c.cz -= wr * 2;
      if (c.cz < -wr) c.cz += wr * 2;

      // Update each lobe sprite within the cluster.
      for (const s of c.sprites) {
        const ud = s.userData;
        s.position.x = c.cx + ud.localDx * c.baseScale * 0.65;
        s.position.z = c.cz;
        // y is fixed per-cluster (no bob for distant sky clouds — keeps them
        // feeling serene and far away).
        s.position.y = c.cy + ud.localDy * c.baseScale * 0.35;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // dispose — release GPU resources and remove from scene.
  // ---------------------------------------------------------------------------
  function dispose() {
    scene.remove(group);

    puffTex.dispose();
    seaTex.dispose();

    group.traverse((obj) => {
      if (obj.isMesh || obj.isSprite) {
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
        if (obj.geometry) obj.geometry.dispose();
      }
    });
  }

  return { update, dispose };
}
