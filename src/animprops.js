// ============================================================================
// animprops.js — Animated Props for the medieval hex tower-defense game.
// Adds waving banners, campfires (with smoke), and glowing torches to the scene.
//
// Usage:
//   import { createAnimProps } from './animprops.js';
//   const animProps = createAnimProps(scene, board, opts);
//   // in game loop:
//   animProps.update(dt, camera);
//   // on cleanup:
//   animProps.dispose();
// ============================================================================
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Palette — matches the bright/vibrant Kingshot diorama style
// ---------------------------------------------------------------------------
const PAL = {
  poleWood:  0x7a5230,
  flagBlue:  0x2255cc,
  flagRed:   0xcc2222,
  flagGold:  0xe8c020,
  fireOrange:0xff6600,
  fireYellow:0xffee00,
  fireRed:   0xff2200,
  torchWood: 0x7a5230,
  logBrown:  0x5c3a1e,
  emberOrange:0xff7722,
  smoke:     0xaaaaaa,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Lay an object flat on the island: use pos.y from the board (already terrain-height). */
function placeAt(obj, pos, dx = 0, dz = 0) {
  obj.position.set(pos.x + dx, pos.y, pos.z + dz);
}

/** Cheap seeded pseudo-random (deterministic layout). */
function seededRand(seed) {
  let s = seed;
  return function () {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

// ---------------------------------------------------------------------------
// 1. WAVING BANNERS
// ---------------------------------------------------------------------------

const BANNER_VERT = /* glsl */`
  uniform float uTime;
  uniform float uWaveAmp;
  uniform float uWaveFreq;
  uniform float uWaveSpeed;

  void main() {
    vec3 pos = position;
    // 'x' runs from 0 (pole side) to ~1 (free edge).
    // Normalise against the flag width so amplitude scales toward the free edge.
    float t = (pos.x + 0.5); // 0..1 across width
    float wave = uWaveAmp * t * t * sin(uWaveFreq * pos.x - uWaveSpeed * uTime);
    // Also add a small vertical flutter
    float flutter = uWaveAmp * 0.25 * t * cos(uWaveFreq * 2.0 * pos.x - uWaveSpeed * 1.3 * uTime);
    pos.z += wave;
    pos.y += flutter;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const BANNER_FRAG = /* glsl */`
  uniform vec3 uColor;
  uniform vec3 uStripeColor;

  varying vec2 vUv; // not actually used — colour from position instead
  void main() {
    gl_FragColor = vec4(uColor, 1.0);
  }
`;

// We use a standard material but override with a ShaderMaterial for the wave.
function makeBannerMaterial(color, stripeColor) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime:        { value: 0 },
      uWaveAmp:     { value: 0.08 },
      uWaveFreq:    { value: 5.0 },
      uWaveSpeed:   { value: 2.2 },
      uColor:       { value: new THREE.Color(color) },
      uStripeColor: { value: new THREE.Color(stripeColor) },
    },
    vertexShader:   BANNER_VERT,
    fragmentShader: BANNER_FRAG,
    side: THREE.DoubleSide,
  });
}

/**
 * Build one flag pole + waving banner and return { group, material }.
 * @param {THREE.Color|number} flagColor
 * @param {THREE.Color|number} stripeColor
 */
function makeFlagPole(flagColor, stripeColor) {
  const group = new THREE.Group();

  // --- Pole ---
  const poleGeo = new THREE.CylinderGeometry(0.025, 0.03, 1.4, 6);
  const poleMat = new THREE.MeshStandardMaterial({
    color: PAL.poleWood,
    roughness: 0.85,
    metalness: 0.0,
    flatShading: true,
  });
  const poleMesh = new THREE.Mesh(poleGeo, poleMat);
  poleMesh.position.y = 0.7; // base at 0, tip at 1.4
  poleMesh.castShadow = true;
  group.add(poleMesh);

  // --- Pole tip finial (small sphere) ---
  const finialGeo = new THREE.SphereGeometry(0.045, 6, 4);
  const finialMat = new THREE.MeshStandardMaterial({
    color: PAL.flagGold,
    roughness: 0.4,
    metalness: 0.3,
    flatShading: true,
  });
  const finialMesh = new THREE.Mesh(finialGeo, finialMat);
  finialMesh.position.y = 1.42;
  group.add(finialMesh);

  // --- Banner cloth (subdivided plane for wave deformation) ---
  // Width = 0.45, Height = 0.3, subdivided 16x8 for smooth wave
  const flagGeo = new THREE.PlaneGeometry(0.45, 0.28, 16, 8);
  const flagMat = makeBannerMaterial(flagColor, stripeColor);
  const flagMesh = new THREE.Mesh(flagGeo, flagMat);
  // Pivot the flag so left edge is at the pole tip
  // PlaneGeometry is centred; shift right by half its width
  flagMesh.position.set(0.225, 1.28, 0.0);
  flagMesh.castShadow = false; // thin cloth; skip for perf
  group.add(flagMesh);

  return { group, material: flagMat };
}

/**
 * Place several flag poles near castlePos and scattered along the path.
 */
function createBanners(scene, board) {
  const banners = []; // { material }
  const rand = seededRand(42);

  const specs = [
    // Near castle: 3 flags
    { pos: board.castlePos, dx:  0.55, dz:  0.30, color: PAL.flagBlue, stripe: PAL.flagGold },
    { pos: board.castlePos, dx: -0.55, dz:  0.30, color: PAL.flagRed,  stripe: PAL.flagGold },
    { pos: board.castlePos, dx:  0.0,  dz: -0.55, color: PAL.flagGold, stripe: PAL.flagBlue },
    // Along path: pick 2 intermediate waypoints
  ];

  // Add 2 flags along path at ~1/3 and ~2/3
  if (board.pathPoints.length >= 3) {
    const i1 = Math.floor(board.pathPoints.length * 0.33);
    const i2 = Math.floor(board.pathPoints.length * 0.66);
    specs.push({ pos: board.pathPoints[i1], dx:  0.5, dz:  0.2, color: PAL.flagBlue, stripe: PAL.flagRed });
    specs.push({ pos: board.pathPoints[i2], dx: -0.5, dz:  0.2, color: PAL.flagRed,  stripe: PAL.flagGold });
  }

  for (const spec of specs) {
    const { group, material } = makeFlagPole(spec.color, spec.stripe);
    placeAt(group, spec.pos, spec.dx, spec.dz);
    // Stagger initial time so flags don't wave in sync
    material.uniforms.uTime.value = rand() * Math.PI * 2;
    scene.add(group);
    banners.push({ material });
  }

  return banners;
}

// ---------------------------------------------------------------------------
// 2. CAMPFIRES
// ---------------------------------------------------------------------------

/**
 * Make a tiny canvas texture: a radial gradient from warm fire core to transparent.
 */
function makeFireGradientTexture(innerColor, outerColor) {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
  grad.addColorStop(0,   innerColor);
  grad.addColorStop(0.5, outerColor);
  grad.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

/**
 * Build one campfire: logs ring + cone flame layers + smoke particles.
 * Returns { group, update(dt) }.
 */
function makeCampfire(rand) {
  const group = new THREE.Group();
  const disposables = [];

  // --- Log ring (4 small cylinders arranged in a cross) ---
  const logMat = new THREE.MeshStandardMaterial({
    color: PAL.logBrown,
    roughness: 0.95,
    flatShading: true,
  });
  disposables.push(logMat);

  const logPositions = [
    [0.12, 0, 0, 0],
    [-0.12, 0, 0, 0],
    [0, 0, 0.12, Math.PI / 2],
    [0, 0, -0.12, Math.PI / 2],
  ];
  const logGeo = new THREE.CylinderGeometry(0.025, 0.03, 0.28, 5);
  disposables.push(logGeo);
  for (const [lx, ly, lz, ry] of logPositions) {
    const log = new THREE.Mesh(logGeo, logMat);
    log.position.set(lx, ly + 0.015, lz);
    log.rotation.z = Math.PI / 2;
    log.rotation.y = ry;
    log.castShadow = true;
    group.add(log);
  }

  // --- Ember glow (flat circle on ground) ---
  const emberGeo = new THREE.CircleGeometry(0.07, 8);
  disposables.push(emberGeo);
  const emberMat = new THREE.MeshBasicMaterial({
    color: PAL.emberOrange,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  disposables.push(emberMat);
  const emberMesh = new THREE.Mesh(emberGeo, emberMat);
  emberMesh.rotation.x = -Math.PI / 2;
  emberMesh.position.y = 0.005;
  group.add(emberMesh);

  // --- Flame: two additive cone layers, inner + outer ---
  const flameTex = makeFireGradientTexture('rgba(255,240,180,1)', 'rgba(255,80,0,0.6)');
  disposables.push(flameTex);
  const flameTex2 = makeFireGradientTexture('rgba(255,180,0,0.9)', 'rgba(200,30,0,0.0)');
  disposables.push(flameTex2);

  // Use Sprite for cheapest billboarded flame
  const flameSpriteMat1 = new THREE.SpriteMaterial({
    map: flameTex,
    color: 0xffffff,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  disposables.push(flameSpriteMat1);
  const flameSpriteMat2 = new THREE.SpriteMaterial({
    map: flameTex2,
    color: 0xffffff,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  disposables.push(flameSpriteMat2);

  const flame1 = new THREE.Sprite(flameSpriteMat1);
  flame1.scale.set(0.22, 0.30, 1);
  flame1.position.y = 0.18;

  const flame2 = new THREE.Sprite(flameSpriteMat2);
  flame2.scale.set(0.14, 0.22, 1);
  flame2.position.y = 0.22;

  group.add(flame1, flame2);

  // --- Smoke particles (Points) ---
  const SMOKE_COUNT = 24;
  const smokePositions = new Float32Array(SMOKE_COUNT * 3);
  const smokeAlphas = new Float32Array(SMOKE_COUNT); // 0..1 for age
  const smokeSpeeds = new Float32Array(SMOKE_COUNT);
  const smokeOffsets = new Float32Array(SMOKE_COUNT * 2); // x,z drift

  // Initialise particle ages spread across the lifetime
  for (let i = 0; i < SMOKE_COUNT; i++) {
    smokeAlphas[i] = rand() * 1.0; // 0 = just born, 1 = dead
    smokeSpeeds[i] = 0.18 + rand() * 0.12;
    smokeOffsets[i * 2]     = (rand() - 0.5) * 0.06;
    smokeOffsets[i * 2 + 1] = (rand() - 0.5) * 0.06;
  }

  const smokeGeo = new THREE.BufferGeometry();
  smokeGeo.setAttribute('position', new THREE.BufferAttribute(smokePositions, 3));
  disposables.push(smokeGeo);

  const smokeCanvas = document.createElement('canvas');
  smokeCanvas.width = smokeCanvas.height = 32;
  {
    const ctx = smokeCanvas.getContext('2d');
    const g = ctx.createRadialGradient(16, 16, 1, 16, 16, 16);
    g.addColorStop(0,   'rgba(180,180,180,0.7)');
    g.addColorStop(0.6, 'rgba(150,150,150,0.3)');
    g.addColorStop(1,   'rgba(100,100,100,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
  }
  const smokeTex = new THREE.CanvasTexture(smokeCanvas);
  disposables.push(smokeTex);

  const smokeMat = new THREE.PointsMaterial({
    map: smokeTex,
    size: 0.18,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.NormalBlending,
    color: 0xcccccc,
  });
  disposables.push(smokeMat);

  const smokeParticles = new THREE.Points(smokeGeo, smokeMat);
  smokeParticles.renderOrder = 1;
  group.add(smokeParticles);

  // --- PointLight (warm, cheap, radius limited) ---
  const fireLight = new THREE.PointLight(0xff6600, 1.2, 1.4, 2);
  fireLight.position.y = 0.25;
  group.add(fireLight);

  // --- Flicker state ---
  let flickerTime = rand() * 100;

  function update(dt) {
    flickerTime += dt;

    // Flame flicker via scale/opacity noise
    const f1 = 0.85 + 0.15 * Math.sin(flickerTime * 7.3)
               + 0.08 * Math.sin(flickerTime * 13.1);
    const f2 = 0.80 + 0.20 * Math.sin(flickerTime * 5.7 + 1.1)
               + 0.10 * Math.sin(flickerTime * 17.3);

    const baseScale1 = 0.22;
    const baseScale2 = 0.14;
    flame1.scale.set(baseScale1 * f1, 0.30 * f1, 1);
    flame1.material.opacity = 0.75 + 0.25 * Math.sin(flickerTime * 9.1);

    flame2.scale.set(baseScale2 * f2, 0.22 * f2, 1);
    flame2.material.opacity = 0.65 + 0.35 * Math.sin(flickerTime * 11.7 + 0.5);

    // Ember pulse
    emberMesh.material.opacity = 0.6 + 0.4 * Math.sin(flickerTime * 4.2);

    // Fire light flicker
    fireLight.intensity = 1.0 + 0.4 * Math.sin(flickerTime * 6.0)
                              + 0.2 * Math.sin(flickerTime * 14.5);

    // Smoke particles
    const posAttr = smokeGeo.attributes.position;
    for (let i = 0; i < SMOKE_COUNT; i++) {
      smokeAlphas[i] += dt * smokeSpeeds[i];
      if (smokeAlphas[i] >= 1.0) {
        // Reset particle at base
        smokeAlphas[i] = 0;
        smokeSpeeds[i] = 0.18 + rand() * 0.12;
        smokeOffsets[i * 2]     = (rand() - 0.5) * 0.06;
        smokeOffsets[i * 2 + 1] = (rand() - 0.5) * 0.06;
      }
      const age = smokeAlphas[i]; // 0..1
      const rise = age * 0.9 + 0.05;
      // Slight horizontal drift (wind) — gentle left drift
      const drift = age * 0.15;
      posAttr.setXYZ(
        i,
        smokeOffsets[i * 2]     + drift * -0.5,
        rise,
        smokeOffsets[i * 2 + 1] + drift * 0.2,
      );
    }
    posAttr.needsUpdate = true;

    // Fade smoke by age (uses a single opacity; blend is approximate)
    // Opacity peaks mid-life
    smokeMat.opacity = 0.45 + 0.15 * Math.sin(flickerTime * 2.1);
  }

  function dispose() {
    for (const d of disposables) d.dispose();
  }

  return { group, update, dispose };
}

function createCampfires(scene, board) {
  const fires = [];
  const rand = seededRand(17);

  // One near spawn, one ~25% along path
  const spawnFire = makeCampfire(rand);
  placeAt(spawnFire.group, board.spawnPos, 0.55, 0.35);
  scene.add(spawnFire.group);
  fires.push(spawnFire);

  if (board.pathPoints.length >= 4) {
    const i = Math.floor(board.pathPoints.length * 0.25);
    const campFire = makeCampfire(rand);
    placeAt(campFire.group, board.pathPoints[i], -0.5, 0.4);
    scene.add(campFire.group);
    fires.push(campFire);
  }

  return fires;
}

// ---------------------------------------------------------------------------
// 3. GLOWING TORCHES
// ---------------------------------------------------------------------------

/**
 * Make a small torch: wooden post + emissive flame sprite, optional weak point light.
 * Returns { group, update(dt) }.
 */
function makeTorch(rand, addLight) {
  const group = new THREE.Group();
  const disposables = [];

  // --- Post ---
  const postGeo = new THREE.CylinderGeometry(0.018, 0.022, 0.45, 5);
  disposables.push(postGeo);
  const postMat = new THREE.MeshStandardMaterial({
    color: PAL.torchWood,
    roughness: 0.9,
    flatShading: true,
  });
  disposables.push(postMat);
  const postMesh = new THREE.Mesh(postGeo, postMat);
  postMesh.position.y = 0.225;
  postMesh.castShadow = true;
  group.add(postMesh);

  // --- Torch head (small basket) ---
  const headGeo = new THREE.CylinderGeometry(0.03, 0.025, 0.06, 6);
  disposables.push(headGeo);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0x4a3010,
    roughness: 0.8,
    flatShading: true,
  });
  disposables.push(headMat);
  const headMesh = new THREE.Mesh(headGeo, headMat);
  headMesh.position.y = 0.46;
  group.add(headMesh);

  // --- Flame sprite ---
  const flameTex = makeFireGradientTexture('rgba(255,230,120,1)', 'rgba(255,80,0,0.0)');
  disposables.push(flameTex);
  const flameMat = new THREE.SpriteMaterial({
    map: flameTex,
    color: 0xffffff,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  disposables.push(flameMat);
  const flameSprite = new THREE.Sprite(flameMat);
  flameSprite.scale.set(0.10, 0.14, 1);
  flameSprite.position.y = 0.54;
  group.add(flameSprite);

  // --- Optional point light (budget: max 2 lights across all torches) ---
  let ptLight = null;
  if (addLight) {
    ptLight = new THREE.PointLight(0xff8833, 0.7, 1.1, 2);
    ptLight.position.y = 0.55;
    group.add(ptLight);
  }

  // Flicker state
  let flickerTime = rand() * 100;

  function update(dt) {
    flickerTime += dt;
    const f = 0.85 + 0.15 * Math.sin(flickerTime * 8.5)
              + 0.07 * Math.sin(flickerTime * 14.3)
              + 0.05 * Math.sin(flickerTime * 22.1);
    flameSprite.scale.set(0.10 * f, 0.14 * f, 1);
    flameMat.opacity = 0.7 + 0.3 * Math.sin(flickerTime * 7.0);

    if (ptLight) {
      ptLight.intensity = 0.6 + 0.3 * Math.sin(flickerTime * 6.5)
                              + 0.15 * Math.sin(flickerTime * 15.0);
    }
  }

  function dispose() {
    for (const d of disposables) d.dispose();
  }

  return { group, update, dispose };
}

function createTorches(scene, board) {
  const torches = [];
  const rand = seededRand(99);

  // Positions: near castle + a few along path
  const torchSpecs = [];

  // 2 flanking castle entrance
  torchSpecs.push({ pos: board.castlePos, dx:  0.35, dz:  0.55, addLight: true });
  torchSpecs.push({ pos: board.castlePos, dx: -0.35, dz:  0.55, addLight: true });

  // Along path every ~3 waypoints (up to 4 torches, no extra lights)
  if (board.pathPoints.length >= 3) {
    const step = Math.max(2, Math.floor(board.pathPoints.length / 4));
    for (let i = step; i < board.pathPoints.length - 1 && torchSpecs.length < 6; i += step) {
      const side = torchSpecs.length % 2 === 0 ? 0.38 : -0.38;
      torchSpecs.push({ pos: board.pathPoints[i], dx: side, dz: 0.15, addLight: false });
    }
  }

  for (const spec of torchSpecs) {
    const torch = makeTorch(rand, spec.addLight);
    placeAt(torch.group, spec.pos, spec.dx, spec.dz);
    scene.add(torch.group);
    torches.push(torch);
  }

  return torches;
}

// ---------------------------------------------------------------------------
// PUBLIC API
// ---------------------------------------------------------------------------

/**
 * Create and add all animated props to the scene.
 *
 * @param {THREE.Scene} scene
 * @param {object}      board  — board API: castlePos, spawnPos, pathPoints, size, baseY
 * @param {object}      [opts]
 * @returns {{ update(dt: number, camera: THREE.Camera): void, dispose(): void }}
 */
export function createAnimProps(scene, board, opts = {}) {
  const banners  = createBanners(scene, board);
  const campfires = createCampfires(scene, board);
  const torches  = createTorches(scene, board);

  // Shared time accumulator for banner shaders
  let elapsed = 0;

  /**
   * Call every frame.
   * @param {number} dt            — delta time in seconds
   * @param {THREE.Camera} camera  — current camera (unused currently; reserved for billboard LOD)
   */
  function update(dt, camera) {
    elapsed += dt;

    // Update banner wave uniforms
    for (const banner of banners) {
      banner.material.uniforms.uTime.value = elapsed;
    }

    // Update campfires
    for (const fire of campfires) {
      fire.update(dt);
    }

    // Update torches
    for (const torch of torches) {
      torch.update(dt);
    }
  }

  /** Remove all objects and free GPU memory. */
  function dispose() {
    for (const fire of campfires) fire.dispose();
    for (const torch of torches)  torch.dispose();
    // Banner materials are shader materials — dispose them
    for (const banner of banners) banner.material.dispose();
  }

  return { update, dispose };
}
