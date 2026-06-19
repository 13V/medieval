/**
 * foliage.js — Instanced grass tufts + flowers with wind sway
 * Stylized low-poly medieval diorama palette (Kingshot-style).
 *
 * Contract:
 *   import * as THREE from 'three';
 *   export function createFoliage(scene, board, opts = {}) -> { update(dt, camera), dispose() }
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Seeded LCG – mirrors the one used in board.js so we get reproducible layout
// ---------------------------------------------------------------------------
function makeLCG(seed = 42) {
  let s = seed >>> 0;
  return function rng() {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * One grass blade: a thin tapered quad rising along +Y.
 * UV.y == 0 at the base, 1 at the tip so the shader can sway the tip.
 *
 *   tip  (0, h, 0)
 *    |  \
 * (-w/2,0,0) -- (w/2,0,0)
 */
function buildBladeGeometry(width = 0.045, height = 0.22) {
  const geo = new THREE.BufferGeometry();
  // 3 vertices: left-base, right-base, tip
  const positions = new Float32Array([
    -width * 0.5, 0,      0,   // 0 left base
     width * 0.5, 0,      0,   // 1 right base
     0,           height, 0,   // 2 tip
  ]);
  const uvs = new Float32Array([
    0, 0,
    1, 0,
    0.5, 1,
  ]);
  const indices = new Uint16Array([0, 1, 2]);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Crossed billboards for a grass tuft: 3 blades rotated 60° apart around Y.
 * Each blade is a tapered quad; we bake all 3 into one merged geometry so the
 * InstancedMesh instance count stays low.
 */
function buildTuftGeometry(bladeW = 0.045, bladeH = 0.24, bladeCount = 3) {
  const meshes = [];
  for (let i = 0; i < bladeCount; i++) {
    const angle = (i / bladeCount) * Math.PI; // 0, 60°, 120°
    const blade = buildBladeGeometry(bladeW, bladeH);
    // Rotate around Y then add a slight random lean
    const mat = new THREE.Matrix4().makeRotationY(angle);
    blade.applyMatrix4(mat);
    meshes.push(blade);
  }
  return mergeGeometries(meshes, true);
}

/** Minimal geometry merge (no BufferGeometryUtils dep needed). */
function mergeGeometries(geos, disposeInputs = false) {
  let totalVerts = 0;
  let totalIdx = 0;
  for (const g of geos) {
    totalVerts += g.attributes.position.count;
    if (g.index) totalIdx += g.index.count;
  }

  const positions = new Float32Array(totalVerts * 3);
  const uvs       = new Float32Array(totalVerts * 2);
  const normals   = new Float32Array(totalVerts * 3);
  const indices   = new Uint16Array(totalIdx);

  let vOff = 0, iOff = 0, vtx = 0;
  for (const g of geos) {
    const pos = g.attributes.position.array;
    const uv  = g.attributes.uv      ? g.attributes.uv.array      : null;
    const nrm = g.attributes.normal   ? g.attributes.normal.array  : null;
    const cnt = g.attributes.position.count;

    positions.set(pos, vOff * 3);
    if (uv)  uvs.set(uv,   vOff * 2);
    if (nrm) normals.set(nrm, vOff * 3);

    if (g.index) {
      const src = g.index.array;
      for (let i = 0; i < src.length; i++) {
        indices[iOff + i] = src[i] + vOff;
      }
      iOff += src.length;
    }
    vOff += cnt;
    vtx  += cnt;
    if (disposeInputs) g.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('uv',       new THREE.BufferAttribute(uvs, 2));
  merged.setAttribute('normal',   new THREE.BufferAttribute(normals, 3));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  return merged;
}

/**
 * Tiny flower: a flat diamond (two crossed quads in XZ plane) plus a small
 * upright disc petal cluster rendered as a cone.
 * We keep it dead simple — a single upward-pointing cone with a fat tip.
 *
 *  cone base at y=0.18 (stem top), apex at y=0.30
 */
function buildFlowerGeometry() {
  // Stem: thin box
  const stemGeo = new THREE.CylinderGeometry(0.008, 0.01, 0.18, 4);
  stemGeo.translate(0, 0.09, 0);

  // Petal cluster: small cone pointing down (base = petal ring, tip = centre)
  const petalGeo = new THREE.ConeGeometry(0.06, 0.07, 6, 1, true);
  petalGeo.translate(0, 0.215, 0);

  return mergeGeometries([stemGeo, petalGeo], true);
}

// ---------------------------------------------------------------------------
// Shader chunks injected via onBeforeCompile for wind sway
// ---------------------------------------------------------------------------

// We store per-instance extra data in the color attribute (r = hue offset,
// g = scale, b = phase) but Three.js InstancedMesh already provides
// instanceColor. We use a separate InstancedBufferAttribute for the sway phase.

const WIND_VERT_PREAMBLE = /* glsl */`
  uniform float uTime;
  uniform float uWindStrength;
  attribute float aPhase;   // per-instance random phase [0..2PI]
`;

/**
 * Wind sway vertex shader injection.
 * `uv.y` encodes height along the blade (0 = base, 1 = tip).
 * We displace x by a sine wave scaled by uv.y^2 so the base is anchored.
 */
const WIND_VERT_INJECT = /* glsl */`
  // Wind sway — applied in local space before transform
  float swayFactor = uv.y * uv.y;                       // quadratic — base stays put
  float wave = sin(uTime * 1.4 + aPhase) * 0.5
             + sin(uTime * 2.1 + aPhase * 1.7) * 0.25; // subtle dual-frequency
  transformed.x += wave * swayFactor * uWindStrength;
  transformed.z += wave * 0.3 * swayFactor * uWindStrength;
`;

function buildGrassMaterial(color, windStrength = 0.07) {
  const mat = new THREE.MeshLambertMaterial({
    color,
    side: THREE.DoubleSide,
    alphaTest: 0.1,
  });

  const timeUniform = { value: 0 };
  mat.userData.timeUniform = timeUniform;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    shader.uniforms.uWindStrength = { value: windStrength };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WIND_VERT_PREAMBLE}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WIND_VERT_INJECT}`);

    mat.userData.shader = shader;
  };

  mat.needsUpdate = true;
  return mat;
}

/**
 * Flower material — no wind sway needed (flowers are rigid cones).
 * Simple MeshLambertMaterial with per-instance color.
 */
function buildFlowerMaterial(color) {
  return new THREE.MeshLambertMaterial({
    color,
    side: THREE.DoubleSide,
  });
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * @param {THREE.Scene} scene
 * @param {object} board  — { size:number, cells:Map<string,{col,row,pos:THREE.Vector3,height:number,occupied:boolean,deco:boolean}> }
 * @param {object} opts
 * @param {number} [opts.seed=12345]
 * @param {number} [opts.tuftsPerCell=3]       grass tufts per free tile
 * @param {number} [opts.flowersPerCell=0.4]   flowers per free tile (probability)
 * @param {number} [opts.maxGrass=3200]        hard cap on grass instances
 * @param {number} [opts.maxFlowers=800]       hard cap on flower instances
 * @param {number} [opts.windStrength=0.07]
 */
export function createFoliage(scene, board, opts = {}) {
  const {
    seed           = 12345,
    tuftsPerCell   = 3,
    flowersPerCell = 0.4,
    maxGrass       = 3200,
    maxFlowers     = 800,
    windStrength   = 0.07,
  } = opts;

  const rng = makeLCG(seed);
  const HEX_R = board.size; // circumradius of the hex tile

  // ---- collect free cells ---------------------------------------------------
  const freeCells = [];
  for (const cell of board.cells.values()) {
    if (!cell.occupied && !cell.deco) {
      freeCells.push(cell);
    }
  }

  // ---- determine instance counts --------------------------------------------
  const desiredGrass   = Math.min(freeCells.length * tuftsPerCell,   maxGrass);
  const desiredFlowers = Math.min(Math.ceil(freeCells.length * flowersPerCell), maxFlowers);

  // ---- Grass InstancedMesh -------------------------------------------------
  const tuftGeo = buildTuftGeometry(0.045, 0.26, 3);

  // Base grass green — vibrant, Kingshot-style
  const grassBaseColor  = new THREE.Color(0x4ec740); // bright lime-green
  const grassMat        = buildGrassMaterial(grassBaseColor, windStrength);
  grassMat.vertexColors = true; // enables instanceColor

  const grassMesh = new THREE.InstancedMesh(tuftGeo, grassMat, desiredGrass);
  grassMesh.castShadow    = false;
  grassMesh.receiveShadow = false;
  grassMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  // Per-instance sway phase attribute
  const grassPhases = new Float32Array(desiredGrass);

  // ---- Flower colors -------------------------------------------------------
  const FLOWER_COLORS = [
    new THREE.Color(0xff3f3f), // red
    new THREE.Color(0xffe033), // yellow
    new THREE.Color(0xffffff), // white
    new THREE.Color(0xcc44ff), // purple
    new THREE.Color(0xff8800), // orange
    new THREE.Color(0xff6688), // pink
  ];

  const flowerGeo = buildFlowerGeometry();
  const flowerMat = buildFlowerMaterial(0xffffff);
  flowerMat.vertexColors = true;

  const flowerMesh = new THREE.InstancedMesh(flowerGeo, flowerMat, desiredFlowers);
  flowerMesh.castShadow    = false;
  flowerMesh.receiveShadow = false;

  // ---- Scatter instances across free cells ----------------------------------
  const dummy = new THREE.Object3D();

  let grassIdx   = 0;
  let flowerIdx  = 0;

  // Shuffle freeCells so we fill evenly if we hit caps
  const shuffled = freeCells.slice().sort(() => rng() - 0.5);

  for (const cell of shuffled) {
    const cx = cell.pos.x;
    const cy = cell.pos.y;
    const cz = cell.pos.z;
    const scatter = HEX_R * 0.72; // max jitter radius (within the hex)

    // --- grass tufts --------------------------------------------------------
    const tuftsHere = tuftsPerCell;
    for (let t = 0; t < tuftsHere && grassIdx < desiredGrass; t++) {
      // Polar scatter within hex
      const angle = rng() * Math.PI * 2;
      const dist  = Math.sqrt(rng()) * scatter; // sqrt for uniform disk
      const ox    = Math.cos(angle) * dist;
      const oz    = Math.sin(angle) * dist;

      dummy.position.set(cx + ox, cy, cz + oz);
      dummy.rotation.set(0, rng() * Math.PI * 2, 0);
      const scale = 0.75 + rng() * 0.55; // 0.75 – 1.30
      dummy.scale.set(scale, scale + rng() * 0.2, scale);
      dummy.updateMatrix();

      grassMesh.setMatrixAt(grassIdx, dummy.matrix);

      // Hue-shift the green slightly per instance (yellow-green to blue-green)
      const hue = 0.28 + rng() * 0.10; // 0.28..0.38 in HSL (lime → emerald)
      const sat = 0.65 + rng() * 0.25;
      const lit = 0.38 + rng() * 0.14;
      const col = new THREE.Color().setHSL(hue, sat, lit);
      grassMesh.setColorAt(grassIdx, col);

      grassPhases[grassIdx] = rng() * Math.PI * 2;
      grassIdx++;
    }

    // --- flowers ------------------------------------------------------------
    if (rng() < flowersPerCell && flowerIdx < desiredFlowers) {
      const angle = rng() * Math.PI * 2;
      const dist  = Math.sqrt(rng()) * scatter;
      const ox    = Math.cos(angle) * dist;
      const oz    = Math.sin(angle) * dist;

      dummy.position.set(cx + ox, cy, cz + oz);
      dummy.rotation.set(0, rng() * Math.PI * 2, 0);
      const fscale = 0.7 + rng() * 0.6;
      dummy.scale.setScalar(fscale);
      dummy.updateMatrix();

      flowerMesh.setMatrixAt(flowerIdx, dummy.matrix);

      const flowerColor = FLOWER_COLORS[Math.floor(rng() * FLOWER_COLORS.length)];
      // Brighten slightly per instance
      const fc = flowerColor.clone();
      fc.multiplyScalar(0.85 + rng() * 0.3);
      flowerMesh.setColorAt(flowerIdx, fc);

      flowerIdx++;
    }
  }

  // Trim counts to actual placed instances
  const actualGrass   = grassIdx;
  const actualFlowers = flowerIdx;

  grassMesh.count   = actualGrass;
  flowerMesh.count  = actualFlowers;

  grassMesh.instanceMatrix.needsUpdate   = true;
  flowerMesh.instanceMatrix.needsUpdate  = true;
  if (grassMesh.instanceColor)   grassMesh.instanceColor.needsUpdate   = true;
  if (flowerMesh.instanceColor)  flowerMesh.instanceColor.needsUpdate  = true;

  // ---- Attach per-instance phase as a buffer attribute ----------------------
  // We need to attach aPhase after the geometry is built.
  // InstancedMesh shares geometry across instances, so we put phases on the geo.
  const phaseAttr = new THREE.InstancedBufferAttribute(grassPhases.slice(0, actualGrass), 1);
  tuftGeo.setAttribute('aPhase', phaseAttr);

  // ---- Add to scene ---------------------------------------------------------
  scene.add(grassMesh);
  scene.add(flowerMesh);

  // ---- Animation state ------------------------------------------------------
  let time = 0;

  // ---- Public API -----------------------------------------------------------
  return {
    /**
     * @param {number} dt  — seconds since last frame
     * @param {THREE.Camera} _camera  — unused (available for LOD if needed)
     */
    update(dt, _camera) {
      time += dt;

      // Drive the grass wind shader via the uniform stored on the material
      const tu = grassMat.userData.timeUniform;
      if (tu) tu.value = time;

      // Also update the shader uniform directly if the shader was compiled
      const shader = grassMat.userData.shader;
      if (shader && shader.uniforms.uTime) {
        shader.uniforms.uTime.value = time;
      }
    },

    dispose() {
      tuftGeo.dispose();
      flowerGeo.dispose();
      grassMat.dispose();
      flowerMat.dispose();

      scene.remove(grassMesh);
      scene.remove(flowerMesh);
    },
  };
}
