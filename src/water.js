// ============================================================================
// water.js — animated stylized low-poly water for the medieval hex tower-defense.
// A single PlaneGeometry mesh with a custom ShaderMaterial.
//
// Features:
//   • Vertex-displaced wave animation (sum of sines over time).
//   • Toon/cartoon blue gradient: bright aqua near island → deeper blue horizon.
//   • Animated sun-sparkle highlights (moving specular blobs).
//   • Soft foam / surf ring around the island base.
//   • update(dt) advances a uniform time for all animations.
//
// Contract:
//   export function createWater(scene, board, opts = {})
//   Returns { mesh, update(dt, camera), dispose() }
// ============================================================================
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Vertex shader: applies wave displacement, computes UV and world position.
// ---------------------------------------------------------------------------
const VERT = /* glsl */`
  precision highp float;

  uniform float uTime;
  uniform float uAmplitude;

  varying vec2  vUv;
  varying vec3  vWorldPos;
  varying float vWaveHeight; // normalised 0..1 for sparkle mask

  // Simple sum-of-sines wave field.
  float wave(vec2 p, float freq, float speed, vec2 dir) {
    return sin(dot(p, dir) * freq + uTime * speed);
  }

  void main() {
    vUv = uv;
    vec3 pos = position;

    // Four overlapping sine waves for natural-looking surface.
    float w = 0.0;
    w += wave(pos.xz, 0.28,  0.55, vec2( 1.0,  0.6)) * 0.45;
    w += wave(pos.xz, 0.41,  0.80, vec2(-0.7,  1.0)) * 0.30;
    w += wave(pos.xz, 0.67,  1.10, vec2( 0.5, -0.8)) * 0.15;
    w += wave(pos.xz, 0.13,  0.35, vec2( 0.9,  0.4)) * 0.10;

    pos.y += w * uAmplitude;

    vWaveHeight = w * 0.5 + 0.5; // remap to 0..1
    vWorldPos   = (modelMatrix * vec4(pos, 1.0)).xyz;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// Fragment shader: colour, foam ring, sparkle highlights.
// ---------------------------------------------------------------------------
const FRAG = /* glsl */`
  precision highp float;

  uniform float uTime;
  uniform vec3  uColorShallow;  // bright aqua near shore
  uniform vec3  uColorDeep;     // deeper blue at horizon
  uniform vec3  uColorFoam;     // white-ish surf ring
  uniform vec3  uColorSparkle;  // sun glint colour
  uniform float uRadius;        // island radius in world units
  uniform float uFoamWidth;     // width of the foam band
  uniform float uFoamSoftness;  // edge feathering

  varying vec2  vUv;
  varying vec3  vWorldPos;
  varying float vWaveHeight;

  // ---------------------------------------------------------------------------
  // Cheap hash / noise for sparkle
  // ---------------------------------------------------------------------------
  float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p.yx + 19.19);
    return fract(p.x * p.y);
  }

  // Cellular-ish sparkle: bright dots that drift over time.
  float sparkle(vec2 uv, float t) {
    // Scroll the UV so highlights drift across the surface.
    vec2 scrolled = uv + vec2(t * 0.04, t * 0.015);
    vec2 cell = floor(scrolled * 18.0);
    vec2 frac = fract(scrolled * 18.0);

    float brightness = 0.0;
    // Check a 3×3 neighbourhood so sparks near cell edges aren't clipped.
    for (int iy = -1; iy <= 1; iy++) {
      for (int ix = -1; ix <= 1; ix++) {
        vec2 neighbour = vec2(float(ix), float(iy));
        vec2 c = cell + neighbour;

        // Animate the spark position within the cell using time.
        float rng  = hash21(c);
        float rng2 = hash21(c + 31.7);
        float rng3 = hash21(c + 74.3);

        // Speed and phase vary per spark.
        float spd   = 0.4 + rng * 0.6;
        float phase = rng3 * 6.2831;
        vec2  center = vec2(
          0.2 + rng  * 0.6 + 0.08 * sin(t * spd         + phase),
          0.2 + rng2 * 0.6 + 0.08 * cos(t * spd * 0.73  + phase)
        );

        // Flicker intensity: each spark pulses at its own rate.
        float flicker = 0.55 + 0.45 * sin(t * (2.5 + rng * 3.0) + phase);

        float d = length(frac - neighbour - center);
        float spot = smoothstep(0.09, 0.0, d) * flicker;
        brightness = max(brightness, spot);
      }
    }
    return brightness;
  }

  void main() {
    // ------------------------------------------------------------------
    // 1. Radial gradient: shallow (near island) → deep (far out).
    // ------------------------------------------------------------------
    float dist    = length(vWorldPos.xz);
    float tGrad   = smoothstep(uRadius * 0.5, uRadius * 3.5, dist);
    vec3  baseCol = mix(uColorShallow, uColorDeep, tGrad);

    // Subtle wave-crest brightening on high points of the surface.
    baseCol = mix(baseCol, uColorShallow, vWaveHeight * 0.18);

    // ------------------------------------------------------------------
    // 2. Foam / surf ring around the island base.
    // ------------------------------------------------------------------
    // Ring is centred at radius ≈ board.radius from the world origin.
    // Foam = white frothy band, softer on both edges.
    float foam = 0.0;
    {
      float inner = uRadius - uFoamWidth * 0.5;
      float outer = uRadius + uFoamWidth * 0.5;
      float t1    = smoothstep(inner - uFoamSoftness, inner, dist);
      float t2    = 1.0 - smoothstep(outer, outer + uFoamSoftness, dist);
      foam        = t1 * t2;

      // Animate a faint churn along the ring using time + angle.
      float angle  = atan(vWorldPos.z, vWorldPos.x);
      float churn  = 0.55 + 0.45 * sin(angle * 6.0 - uTime * 1.3)
                          * cos(angle * 3.5 + uTime * 0.8);
      foam *= clamp(churn, 0.0, 1.0);
    }
    baseCol = mix(baseCol, uColorFoam, foam * 0.82);

    // ------------------------------------------------------------------
    // 3. Sun sparkle highlights.
    // ------------------------------------------------------------------
    // Only visible in the shallow-to-mid zone; fade them in deeper water.
    float sparkleZone = 1.0 - smoothstep(uRadius * 1.0, uRadius * 4.0, dist);
    float spk = sparkle(vWorldPos.xz * 0.05, uTime) * sparkleZone;

    // Also modulate by wave height so sparks cluster on crests.
    spk *= 0.6 + 0.4 * vWaveHeight;

    baseCol += uColorSparkle * spk * 0.85;

    // ------------------------------------------------------------------
    // 4. Final alpha: fully opaque, but fade the far edges into fog-like
    //    transparency so the ocean doesn't hard-clip at the plane edge.
    // ------------------------------------------------------------------
    float edgeFade = 1.0 - smoothstep(uRadius * 4.2, uRadius * 5.0, dist);

    gl_FragColor = vec4(baseCol, edgeFade);
  }
`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * createWater — builds and adds an animated water surface to the scene.
 *
 * @param {THREE.Scene}  scene
 * @param {{ radius: number }} board   – only board.radius is read
 * @param {object} [opts]
 * @param {number} [opts.y=-0.5]       – vertical position of the surface
 * @param {number} [opts.size=200]     – total plane diameter (world units)
 * @param {number} [opts.segments=80]  – geometry subdivision (rows & cols)
 * @param {number} [opts.amplitude=0.08] – wave height amplitude
 *
 * @returns {{ mesh: THREE.Mesh, update(dt: number, camera?: THREE.Camera): void, dispose(): void }}
 */
export function createWater(scene, board, opts = {}) {
  const {
    y          = -0.5,
    size       = 200,
    segments   = 80,
    amplitude  = 0.08,
  } = opts;

  const radius = (board && board.radius != null) ? board.radius : 11.7;

  // ---- Geometry -----------------------------------------------------------
  // A single horizontal plane; vertex shader will wave-displace it.
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2); // make it lie flat (XZ plane)

  // ---- Uniforms -----------------------------------------------------------
  const uniforms = {
    uTime:         { value: 0.0 },
    uAmplitude:    { value: amplitude },

    // Colour palette — bright cartoon aqua → deep ocean blue
    uColorShallow: { value: new THREE.Color(0x5ab8d6) },  // bright aqua
    uColorDeep:    { value: new THREE.Color(0x1a6b9e) },  // deep blue
    uColorFoam:    { value: new THREE.Color(0xdff4fa) },  // surf white
    uColorSparkle: { value: new THREE.Color(0xfff8d0) },  // warm sun glint

    // Geometry parameters passed to the frag shader
    uRadius:       { value: radius },
    uFoamWidth:    { value: radius * 0.22 },   // foam ring width
    uFoamSoftness: { value: radius * 0.10 },   // feathering on ring edges
  };

  // ---- Material -----------------------------------------------------------
  const material = new THREE.ShaderMaterial({
    vertexShader:   VERT,
    fragmentShader: FRAG,
    uniforms,
    transparent:    true,    // for edge fade + foam alpha blend
    depthWrite:     false,   // avoids z-fighting under transparent edges
    side:           THREE.FrontSide,
  });

  // ---- Mesh ---------------------------------------------------------------
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = y;
  mesh.renderOrder = -1;   // render water before opaque objects
  mesh.receiveShadow = false; // shadows on transparent shader are complex; skip
  scene.add(mesh);

  // ---- Accumulated time ---------------------------------------------------
  let elapsed = 0.0;

  // ---- Public interface ---------------------------------------------------
  function update(dt /*, camera */) {
    elapsed += dt;
    uniforms.uTime.value = elapsed;
  }

  function dispose() {
    scene.remove(mesh);
    geometry.dispose();
    material.dispose();
  }

  return { mesh, update, dispose };
}
