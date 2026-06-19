// ============================================================================
// postfx.js — Post-processing pipeline for a vibrant low-poly diorama look.
//
// Pass order:
//  1. RenderPass          — standard scene render
//  2. GTAOPass            — subtle ambient occlusion (contact shadows / depth)
//  3. UnrealBloomPass     — gentle glow on bright highlights / FX emissives
//  4. TiltShiftPass       — vertical-gradient DoF for the toy/diorama miniature look
//  5. ColorGradePass      — contrast + saturation boost + soft vignette
//  6. OutputPass          — tone-map → sRGB (always last)
// ============================================================================
import * as THREE from 'three';
import { EffectComposer }  from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }      from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass }        from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass }      from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass }      from 'three/addons/postprocessing/OutputPass.js';

// ---------------------------------------------------------------------------
// Tilt-shift / miniature DoF shader
// A fast vertical-gradient separable blur: sharp through a horizontal focus
// band (centred in screen-Y), progressively blurred toward top and bottom.
// Uses a simple 9-tap Gaussian in two axis-aligned passes (horizontal then
// vertical), weighted by |y - focusY|^focusPower so blur is zero at the
// focus band.  Both passes share the same uniforms; 'horizontal' bool
// switches the sample axis.
// ---------------------------------------------------------------------------
const TiltShiftHShader = {
  name: 'TiltShiftHShader',
  uniforms: {
    tDiffuse:    { value: null },
    resolution:  { value: new THREE.Vector2(1, 1) },
    focusY:      { value: 0.5 },   // 0-1, where the sharp band is centred
    focusWidth:  { value: 0.22 },  // half-width of the in-focus band (in 0-1 screen space)
    blurMax:     { value: 4.0 },   // max blur radius in pixels at screen edge
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2      resolution;
    uniform float     focusY;
    uniform float     focusWidth;
    uniform float     blurMax;

    varying vec2 vUv;

    // Gaussian weights for a 9-tap kernel
    const float W[5] = float[5](0.2270270270, 0.1945945946, 0.1216216216,
                                 0.0540540541, 0.0162162162);

    void main() {
      // Distance from focus band centre, clamped so inside focus-width = 0
      float dy    = abs(vUv.y - focusY);
      float blur  = clamp((dy - focusWidth) / (0.5 - focusWidth), 0.0, 1.0);
      blur = blur * blur; // ease-in^2 for a softer transition
      float rad   = blur * blurMax;

      if (rad < 0.5) {
        // Fully sharp — just sample
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
      }

      // Horizontal blur pass
      vec2 step = vec2(rad / resolution.x, 0.0);
      vec4 color = texture2D(tDiffuse, vUv) * W[0];
      for (int i = 1; i < 5; i++) {
        float fi = float(i);
        color += texture2D(tDiffuse, vUv + step * fi) * W[i];
        color += texture2D(tDiffuse, vUv - step * fi) * W[i];
      }
      gl_FragColor = color;
    }
  `,
};

const TiltShiftVShader = {
  name: 'TiltShiftVShader',
  uniforms: {
    tDiffuse:    { value: null },
    resolution:  { value: new THREE.Vector2(1, 1) },
    focusY:      { value: 0.5 },
    focusWidth:  { value: 0.22 },
    blurMax:     { value: 4.0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2      resolution;
    uniform float     focusY;
    uniform float     focusWidth;
    uniform float     blurMax;

    varying vec2 vUv;

    const float W[5] = float[5](0.2270270270, 0.1945945946, 0.1216216216,
                                 0.0540540541, 0.0162162162);

    void main() {
      float dy    = abs(vUv.y - focusY);
      float blur  = clamp((dy - focusWidth) / (0.5 - focusWidth), 0.0, 1.0);
      blur = blur * blur;
      float rad   = blur * blurMax;

      if (rad < 0.5) {
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
      }

      // Vertical blur pass
      vec2 step = vec2(0.0, rad / resolution.y);
      vec4 color = texture2D(tDiffuse, vUv) * W[0];
      for (int i = 1; i < 5; i++) {
        float fi = float(i);
        color += texture2D(tDiffuse, vUv + step * fi) * W[i];
        color += texture2D(tDiffuse, vUv - step * fi) * W[i];
      }
      gl_FragColor = color;
    }
  `,
};

// ---------------------------------------------------------------------------
// Color-grade + vignette shader
// • Slight contrast S-curve (lift shadows, compress highlights slightly)
// • Saturation boost with a warm tint (push red/green slightly)
// • Soft radial vignette
// ---------------------------------------------------------------------------
const ColorGradeShader = {
  name: 'ColorGradeShader',
  uniforms: {
    tDiffuse:    { value: null },
    saturation:  { value: 1.18 },  // 1 = neutral
    contrast:    { value: 1.08 },  // subtle lift
    brightness:  { value: 0.02 },  // tiny positive lift to compensate AO darkening
    // warm tint applied in linear space before saturation
    tintR:       { value: 1.02 },
    tintG:       { value: 1.01 },
    tintB:       { value: 0.97 },
    // vignette
    vigStrength: { value: 0.38 },  // 0 = off, 1 = very dark edges
    vigSoftness: { value: 1.6 },   // radial falloff exponent
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float contrast;
    uniform float brightness;
    uniform float tintR;
    uniform float tintG;
    uniform float tintB;
    uniform float vigStrength;
    uniform float vigSoftness;

    varying vec2 vUv;

    // Luminance (Rec.709)
    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      vec3 c   = tex.rgb;

      // Warm tint
      c *= vec3(tintR, tintG, tintB);

      // Saturation
      float L  = luma(c);
      c = mix(vec3(L), c, saturation);

      // Contrast (centred on 0.5)
      c = (c - 0.5) * contrast + 0.5 + brightness;

      // Vignette — smooth radial falloff from centre
      vec2  uv2    = vUv * 2.0 - 1.0;        // -1..1
      float vd     = dot(uv2, uv2);           // 0 = centre, 2 = corner
      float vig    = 1.0 - vigStrength * pow(vd * 0.5, vigSoftness);
      c *= vig;

      gl_FragColor = vec4(clamp(c, 0.0, 1.0), tex.a);
    }
  `,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * createPostFX — build an EffectComposer with a full diorama post-processing
 * pipeline: AO → bloom → tilt-shift DoF → color-grade/vignette → output.
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene}         scene
 * @param {THREE.Camera}        camera
 * @returns {{ composer: EffectComposer, setSize: (w: number, h: number) => void }}
 */
export function createPostFX(renderer, scene, camera) {
  const w = window.innerWidth;
  const h = window.innerHeight;

  const composer = new EffectComposer(renderer);

  // ── 1. RenderPass ────────────────────────────────────────────────────────
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // ── 2. GTAOPass — subtle ambient occlusion ───────────────────────────────
  // Low radius + modest scale keeps it from muddying bright cartoon surfaces.
  // We use the Default output which composites AO onto the diffuse buffer.
  const gtao = new GTAOPass(scene, camera, w, h,
    /* parameters (GBuffer — use internal) */ undefined,
    /* aoParameters */ {
      radius:            0.25,   // small world-space radius → contact-shadow look
      distanceExponent:  2.0,
      thickness:         1.0,
      scale:             0.9,    // slightly reduced to keep it subtle
      samples:           16,     // good quality / performance balance
      distanceFallOff:   1.0,
      screenSpaceRadius: false,
    },
    /* pdParameters (Poisson denoise) */ {
      lumaPhi:    10,
      depthPhi:   2,
      normalPhi:  3,
      radius:     4,
      rings:      2,
      samples:    8,             // fewer denoise taps for speed
    }
  );
  gtao.output = GTAOPass.OUTPUT.Default; // composite AO onto the colour buffer
  gtao.blendIntensity = 0.65;           // dial back strength — we want subtle depth, not grime
  composer.addPass(gtao);

  // ── 3. UnrealBloomPass — bright highlights / emissive FX glow ────────────
  // High threshold means only very bright pixels (FX, torches, emissives) bloom.
  const resolution = new THREE.Vector2(w, h);
  const bloom = new UnrealBloomPass(resolution, 0.30, 0.50, 0.85);
  composer.addPass(bloom);

  // ── 4. Tilt-shift DoF — separable two-pass gradient blur ─────────────────
  // H pass then V pass.  focusY=0.48 keeps the board centre sharp.
  const tiltShiftH = new ShaderPass(TiltShiftHShader);
  tiltShiftH.uniforms.resolution.value.set(w, h);
  tiltShiftH.uniforms.focusY.value      = 0.48;
  tiltShiftH.uniforms.focusWidth.value  = 0.20;
  tiltShiftH.uniforms.blurMax.value     = 3.5;
  composer.addPass(tiltShiftH);

  const tiltShiftV = new ShaderPass(TiltShiftVShader);
  tiltShiftV.uniforms.resolution.value.set(w, h);
  tiltShiftV.uniforms.focusY.value      = 0.48;
  tiltShiftV.uniforms.focusWidth.value  = 0.20;
  tiltShiftV.uniforms.blurMax.value     = 3.5;
  composer.addPass(tiltShiftV);

  // ── 5. Color-grade + vignette ────────────────────────────────────────────
  const colorGrade = new ShaderPass(ColorGradeShader);
  composer.addPass(colorGrade);

  // ── 6. OutputPass — tone-map → sRGB (always last) ────────────────────────
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  // ── Resize ────────────────────────────────────────────────────────────────
  /**
   * @param {number} w
   * @param {number} h
   */
  function setSize(w, h) {
    composer.setSize(w, h);
    gtao.setSize(w, h);
    bloom.setSize(w, h);
    tiltShiftH.uniforms.resolution.value.set(w, h);
    tiltShiftV.uniforms.resolution.value.set(w, h);
    // ShaderPass / colorGrade has no explicit setSize — composer handles its RT
  }

  return { composer, setSize };
}
