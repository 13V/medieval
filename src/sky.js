// ============================================================================
// sky.js — Gorgeous procedural sky for the medieval hex tower-defense game.
//
// Exports:
//   createSky(scene, board, opts = {})
//     → { update(dt, camera), dispose() }
//
// Features:
//   1. Gradient sky dome  — BackSide sphere, custom GLSL, zenith deep-blue →
//      warm pale horizon, depthWrite false, renderOrder -1.
//   2. Horizon haze band  — thin additive torus/ring fading the sea into sky.
//   3. Sun disc           — procedural CanvasTexture core Sprite (additive).
//   4. Sun inner glow     — medium additive Sprite, slightly larger.
//   5. Sun outer halo     — large additive Sprite, very soft.
//   All camera-following objects track the camera position each frame so they
//   read as infinitely far away regardless of OrbitControls movement.
// ============================================================================

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert degrees to radians. */
const DEG2RAD = Math.PI / 180;

/**
 * Build a procedural circular gradient texture on a canvas.
 * @param {number} size   Canvas size in px (power-of-two recommended)
 * @param {Array}  stops  [{r,stop,a?}, ...] radial gradient colour stops
 * @returns {THREE.CanvasTexture}
 */
function makeRadialTexture(size, stops) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const grad = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
  for (const s of stops) {
    grad.addColorStop(s.stop, s.color);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Create an additive Sprite from a radial CanvasTexture.
 * @param {THREE.CanvasTexture} tex
 * @param {number}              size    World-space scale
 * @param {number|string}       color   Tint colour
 * @param {number}              opacity Material opacity
 */
function makeSprite(tex, size, color, opacity) {
  const mat = new THREE.SpriteMaterial({
    map: tex,
    color: color,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: opacity,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.setScalar(size);
  sprite.renderOrder = 1;
  return sprite;
}

// ---------------------------------------------------------------------------
// Sun textures (created once, shared across layers)
// ---------------------------------------------------------------------------

/** Crisp bright disc: opaque centre → transparent edge (hard falloff). */
function makeSunDiscTexture() {
  return makeRadialTexture(256, [
    { stop: 0.00, color: 'rgba(255,255,240,1.00)' },
    { stop: 0.38, color: 'rgba(255,248,200,1.00)' },
    { stop: 0.60, color: 'rgba(255,230,140,0.85)' },
    { stop: 0.78, color: 'rgba(255,200, 80,0.30)' },
    { stop: 1.00, color: 'rgba(255,180, 40,0.00)' },
  ]);
}

/** Medium inner corona — warm golden glow. */
function makeSunCoronaTexture() {
  return makeRadialTexture(256, [
    { stop: 0.00, color: 'rgba(255,240,160,0.90)' },
    { stop: 0.30, color: 'rgba(255,200, 80,0.55)' },
    { stop: 0.60, color: 'rgba(255,160, 30,0.20)' },
    { stop: 1.00, color: 'rgba(255,120,  0,0.00)' },
  ]);
}

/** Large outer halo — very diffuse, light amber. */
function makeSunHaloTexture() {
  return makeRadialTexture(256, [
    { stop: 0.00, color: 'rgba(255,220,120,0.40)' },
    { stop: 0.40, color: 'rgba(255,190, 60,0.18)' },
    { stop: 0.75, color: 'rgba(255,160, 20,0.06)' },
    { stop: 1.00, color: 'rgba(255,140,  0,0.00)' },
  ]);
}

// ---------------------------------------------------------------------------
// Sky dome GLSL
// ---------------------------------------------------------------------------

const SKY_VERT = /* glsl */`
varying vec3 vWorldPos;

void main() {
  // Transform to world space so the fragment shader can read world-Y
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAG = /* glsl */`
varying vec3 vWorldPos;

uniform vec3  uZenith;      // deep blue at top
uniform vec3  uMidSky;      // lighter mid-sky
uniform vec3  uHorizonHigh; // warm pale near-horizon
uniform vec3  uHorizonLow;  // very warm / slightly orange right at horizon
uniform float uRadius;      // sphere radius — used to normalise height

void main() {
  // Normalised height in [-1..1] relative to sphere centre.
  // Sky dome centre is at camera height; vWorldPos.y tracks that.
  // We only care about the vertical angle, so normalise by radius.
  float t = clamp(vWorldPos.y / uRadius, -1.0, 1.0);

  vec3 col;
  if (t >= 0.0) {
    // Upper hemisphere: zenith → mid-sky → upper horizon
    float tUpper = t; // 0 at equator, 1 at zenith
    // Two-stop blend: equator→mid at tUpper<0.35, mid→zenith above
    vec3 lower = mix(uHorizonHigh, uMidSky,  smoothstep(0.0, 0.35, tUpper));
    col        = mix(lower,        uZenith,  smoothstep(0.25, 0.85, tUpper));
  } else {
    // Lower hemisphere: horizon → slightly darker (sea / haze below)
    float tLower = -t; // 0 at equator, 1 at nadir
    col = mix(uHorizonLow, uHorizonHigh * 0.7, smoothstep(0.0, 0.5, tLower));
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Horizon haze band
// ---------------------------------------------------------------------------

const HAZE_VERT = /* glsl */`
varying float vAlpha;

void main() {
  // uv.y goes 0..1 across the band height; fade at both edges
  vAlpha = 1.0 - abs(uv.y * 2.0 - 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const HAZE_FRAG = /* glsl */`
varying float vAlpha;

uniform vec3  uHazeColor;
uniform float uOpacity;

void main() {
  gl_FragColor = vec4(uHazeColor, vAlpha * uOpacity);
}
`;

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Create the sky system and add it to the scene.
 *
 * @param {THREE.Scene}  scene
 * @param {object}       board   - Board API (read-only). Only board.radius used.
 * @param {object}       opts    - Optional overrides (currently unused).
 * @returns {{ update(dt: number, camera: THREE.Camera): void, dispose(): void }}
 */
export function createSky(scene, board, opts = {}) {
  // We use a Group so we can reposition everything by moving the group to the
  // camera position each frame → infinite-distance illusion.
  const group = new THREE.Group();
  group.renderOrder = -100;
  scene.add(group);

  // Camera far plane from game.js is 400; we want the dome to be very large
  // but safely inside that. Use 380 * 0.80 ≈ 300.
  const FAR = opts.far ?? 400;
  const DOME_RADIUS = FAR * 0.78; // 312 — well inside far plane

  // ------------------------------------------------------------------
  // 1. Sky dome
  // ------------------------------------------------------------------
  const domeSphereGeo = new THREE.SphereGeometry(DOME_RADIUS, 32, 18);

  const domeMat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: {
      uZenith:      { value: new THREE.Color(0x2e6bb5) },  // deep cornflower
      uMidSky:      { value: new THREE.Color(0x5b9bd9) },  // mid-sky blue
      uHorizonHigh: { value: new THREE.Color(0xb8daf5) },  // pale blue-white
      uHorizonLow:  { value: new THREE.Color(0xdcefff) },  // near-white warm
      uRadius:      { value: DOME_RADIUS },
    },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    transparent: false,
  });

  const dome = new THREE.Mesh(domeSphereGeo, domeMat);
  dome.renderOrder = -100;
  group.add(dome);

  // ------------------------------------------------------------------
  // 2. Horizon haze band
  //    A large, thin cylinder placed right at the equator of the dome.
  //    Additive blending so it brightens the horizon seamlessly.
  // ------------------------------------------------------------------
  const HAZE_HEIGHT = DOME_RADIUS * 0.12;   // band is ~12% of dome radius tall
  const HAZE_RADIUS = DOME_RADIUS * 0.995;  // just inside the dome

  const hazeGeo = new THREE.CylinderGeometry(
    HAZE_RADIUS, HAZE_RADIUS,
    HAZE_HEIGHT,
    64, 2,
    true  // open-ended
  );

  const hazeMat = new THREE.ShaderMaterial({
    vertexShader: HAZE_VERT,
    fragmentShader: HAZE_FRAG,
    uniforms: {
      uHazeColor: { value: new THREE.Color(0xd8eeff) },
      uOpacity:   { value: 0.28 },
    },
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });

  const hazeMesh = new THREE.Mesh(hazeGeo, hazeMat);
  // Position the haze band slightly below the equator so it sits on the horizon
  hazeMesh.position.y = -DOME_RADIUS * 0.06;
  hazeMesh.renderOrder = -99;
  group.add(hazeMesh);

  // ------------------------------------------------------------------
  // 3. Sun direction — elevation 28°, azimuth 135° (SE)
  //    dir = normalised vector pointing FROM origin TOWARD the sun.
  // ------------------------------------------------------------------
  const SUN_PHI   = (90 - 28) * DEG2RAD;  // polar angle from +Y (zenith)
  const SUN_THETA = 135 * DEG2RAD;        // azimuthal from +Z

  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, SUN_PHI, SUN_THETA);
  // sunDir now points toward the sun in world space

  // Place sun sprites along this direction at a fixed distance from origin.
  // Since the group follows the camera, distance from camera = distance here.
  const SUN_DIST = DOME_RADIUS * 0.90;

  const sunBasePos = sunDir.clone().multiplyScalar(SUN_DIST);

  // Create textures
  const texDisc   = makeSunDiscTexture();
  const texCorona = makeSunCoronaTexture();
  const texHalo   = makeSunHaloTexture();

  // World-space size of sprites; tune to taste.
  const DISC_SIZE   = DOME_RADIUS * 0.065;  // crisp inner disc
  const CORONA_SIZE = DOME_RADIUS * 0.145;  // inner glow
  const HALO_SIZE   = DOME_RADIUS * 0.38;   // outer soft halo

  const sunDisc   = makeSprite(texDisc,   DISC_SIZE,   0xfffff0, 1.00);
  const sunCorona = makeSprite(texCorona, CORONA_SIZE, 0xffe8a0, 0.80);
  const sunHalo   = makeSprite(texHalo,   HALO_SIZE,   0xffd060, 0.55);

  // Stack them at the same position; tiny offsets toward camera per layer
  // aren't needed — they all share the same depthTest:false renderOrder.
  sunDisc.position.copy(sunBasePos);
  sunCorona.position.copy(sunBasePos);
  sunHalo.position.copy(sunBasePos);

  group.add(sunHalo);
  group.add(sunCorona);
  group.add(sunDisc);

  // ------------------------------------------------------------------
  // Reusable scratch vector for update
  // ------------------------------------------------------------------
  const _camPos = new THREE.Vector3();

  // ------------------------------------------------------------------
  // 4. API
  // ------------------------------------------------------------------

  /**
   * Call once per frame from your render loop.
   * @param {number}            dt      Delta time in seconds (unused currently)
   * @param {THREE.Camera}      camera  Active camera
   */
  function update(dt, camera) {
    // Move the entire group to the camera's world position so the dome and
    // sun always appear infinitely far away regardless of camera travel.
    camera.getWorldPosition(_camPos);
    group.position.copy(_camPos);
  }

  /**
   * Release GPU resources when the sky is no longer needed.
   */
  function dispose() {
    scene.remove(group);

    dome.geometry.dispose();
    domeMat.dispose();

    hazeMesh.geometry.dispose();
    hazeMat.dispose();

    texDisc.dispose();
    texCorona.dispose();
    texHalo.dispose();

    sunDisc.material.dispose();
    sunCorona.material.dispose();
    sunHalo.material.dispose();
  }

  return { update, dispose };
}
