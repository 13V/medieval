// ============================================================================
// townlife.js — Bustling settlement dressing for the medieval hex tower-defense.
//
// Adds: chimney smoke plumes, hanging paper lanterns, market stalls with
// striped canopies and waving pennants, and occasional coin-glint sparkles.
//
// CONTRACT:
//   import * as THREE from 'three';
//   export function createTownLife(scene, board, opts = {}) { ... }
//   Returns { update(dt, camera), dispose() }
//
// Rules: THREE primitives + CanvasTexture only. No new npm deps.
//        Max 2 PointLights total (used for lanterns).
// ============================================================================

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Seeded RNG — deterministic layout, no Math.random side-effects.
// ---------------------------------------------------------------------------
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s ^= s >>> 16;
    return (s >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Palette — bright Kingshot / diorama cartoon style
// ---------------------------------------------------------------------------
const PAL = {
  smokeDark:      0x999999,
  smokeLight:     0xdddddd,
  lanternWarm:    0xffcc44,
  lanternPaper:   0xffeebb,
  lanternRim:     0x664400,
  stallWood:      0x8b6340,
  stallCounter:   0xc49a60,
  canopyA:        0xee3333,   // red stripe
  canopyB:        0xffffff,   // white stripe
  pennantGold:    0xffcc00,
  sparkleGold:    0xffee88,
};

// ---------------------------------------------------------------------------
// Canvas texture helpers
// ---------------------------------------------------------------------------

/** Soft radial disc — used for smoke and sparkle particles. */
function makeDiscTexture(size, innerRgba, outerRgba) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const cx = size / 2;
  const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
  g.addColorStop(0,   innerRgba);
  g.addColorStop(0.5, outerRgba);
  g.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

/** Soft glow disc — warm orange for lantern sprite. */
function makeLanternTexture() {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const cx = size / 2;
  // Outer warm halo
  const g = ctx.createRadialGradient(cx, cx, 1, cx, cx, cx);
  g.addColorStop(0,    'rgba(255,230,100,1)');
  g.addColorStop(0.25, 'rgba(255,190,60,0.85)');
  g.addColorStop(0.6,  'rgba(255,140,30,0.4)');
  g.addColorStop(1,    'rgba(255,100,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // Small bright core
  const g2 = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx * 0.22);
  g2.addColorStop(0,   'rgba(255,255,220,1)');
  g2.addColorStop(1,   'rgba(255,230,120,0)');
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

/** Horizontal red/white striped canopy texture. */
function makeCanopyTexture(colorA, colorB, stripeCount) {
  const w = 128, h = 64;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const stripeH = h / stripeCount;
  for (let i = 0; i < stripeCount; i++) {
    ctx.fillStyle = i % 2 === 0 ? colorA : colorB;
    ctx.fillRect(0, i * stripeH, w, stripeH);
  }
  // Slight shadow at front edge
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0,   'rgba(0,0,0,0)');
  grad.addColorStop(0.85,'rgba(0,0,0,0)');
  grad.addColorStop(1,   'rgba(0,0,0,0.18)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  return new THREE.CanvasTexture(c);
}

/** Sparkle star — four-point white/gold burst. */
function makeSparkleTexture() {
  const size = 32;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const cx = size / 2;
  // Soft disc
  const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
  g.addColorStop(0,    'rgba(255,250,200,1)');
  g.addColorStop(0.3,  'rgba(255,230,100,0.7)');
  g.addColorStop(1,    'rgba(255,200,50,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // Cross streaks
  ctx.strokeStyle = 'rgba(255,255,200,0.7)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(cx, 2); ctx.lineTo(cx, size - 2);
  ctx.moveTo(2, cx); ctx.lineTo(size - 2, cx);
  ctx.stroke();
  return new THREE.CanvasTexture(c);
}

// ---------------------------------------------------------------------------
// Helper: place object at board pos + offset
// ---------------------------------------------------------------------------
function placeAt(obj, pos, dx, dz, dy) {
  obj.position.set(pos.x + (dx || 0), pos.y + (dy || 0), pos.z + (dz || 0));
}

// ---------------------------------------------------------------------------
// 1. CHIMNEY SMOKE PLUMES
// ---------------------------------------------------------------------------

/**
 * Pick smoke spawn positions: castlePos area + a few scattered board.cells.
 */
function pickSmokePositions(board, count) {
  const positions = [];
  const rng = makeRng(0xDEAD0001);

  // Always add some near castle (up to 2)
  const cPos = board.castlePos;
  positions.push(new THREE.Vector3(cPos.x + 0.45, cPos.y, cPos.z + 0.3));
  positions.push(new THREE.Vector3(cPos.x - 0.5,  cPos.y, cPos.z - 0.2));

  // Scatter through board.cells (sorted deterministically via key)
  if (board.cells && board.cells.size > 0) {
    const cellArr = Array.from(board.cells.values());
    // Spread evenly: sample at regular intervals
    const step = Math.max(1, Math.floor(cellArr.length / (count - 2)));
    for (let i = step; positions.length < count && i < cellArr.length; i += step) {
      const cell = cellArr[i];
      // Small random offset so chimneys don't sit dead-centre
      const ox = (rng() - 0.5) * 0.4;
      const oz = (rng() - 0.5) * 0.4;
      positions.push(new THREE.Vector3(cell.pos.x + ox, cell.pos.y, cell.pos.z + oz));
    }
  }

  return positions.slice(0, count);
}

const SMOKE_PER_PLUME   = 28;   // particles per chimney
const SMOKE_LIFETIME    = 1.0;  // normalised 0→1 age
const SMOKE_RISE_HEIGHT = 1.6;  // world units above source
const WIND_X            = 0.12; // gentle eastward drift
const WIND_Z            = 0.06;

function createSmokePlume(pos, rng) {
  const positions = new Float32Array(SMOKE_PER_PLUME * 3);
  const ages      = new Float32Array(SMOKE_PER_PLUME);
  const speeds    = new Float32Array(SMOKE_PER_PLUME);
  const offsets   = new Float32Array(SMOKE_PER_PLUME * 2); // x,z spawn jitter

  for (let i = 0; i < SMOKE_PER_PLUME; i++) {
    ages[i]            = rng();                      // stagger start ages
    speeds[i]          = 0.20 + rng() * 0.15;
    offsets[i * 2]     = (rng() - 0.5) * 0.06;
    offsets[i * 2 + 1] = (rng() - 0.5) * 0.06;
  }

  const smokeTex = makeDiscTexture(32, 'rgba(195,195,195,0.6)', 'rgba(160,160,160,0.2)');

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.PointsMaterial({
    map:             smokeTex,
    size:            0.22,
    sizeAttenuation: true,
    transparent:     true,
    opacity:         0.5,
    depthWrite:      false,
    blending:        THREE.NormalBlending,
    color:           0xcccccc,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  // Offset the Points object to the chimney position so particles
  // work in local space (simplifies per-particle math)
  points.position.copy(pos);

  function update(dt) {
    const posAttr = geo.attributes.position;
    for (let i = 0; i < SMOKE_PER_PLUME; i++) {
      ages[i] += dt * speeds[i];
      if (ages[i] >= SMOKE_LIFETIME) {
        // Respawn at chimney base
        ages[i]            = 0;
        speeds[i]          = 0.20 + rng() * 0.15;
        offsets[i * 2]     = (rng() - 0.5) * 0.06;
        offsets[i * 2 + 1] = (rng() - 0.5) * 0.06;
      }
      const age = ages[i]; // 0..1
      // Rise with slight wind drift; expand horizontally as age grows
      const rise   = age * SMOKE_RISE_HEIGHT;
      const spread = age * 0.18;
      posAttr.setXYZ(
        i,
        offsets[i * 2]     + WIND_X * age + (rng() - 0.5) * spread * 0.3,
        rise + 0.05,
        offsets[i * 2 + 1] + WIND_Z * age + (rng() - 0.5) * spread * 0.3,
      );
    }
    posAttr.needsUpdate = true;
  }

  function dispose() {
    geo.dispose();
    mat.dispose();
    smokeTex.dispose();
  }

  return { points, update, dispose };
}

function createChimneySmoke(scene, board) {
  const rng    = makeRng(0xFADE1234);
  const count  = 5;
  const smokePositions = pickSmokePositions(board, count);
  const plumes = [];

  for (const pos of smokePositions) {
    const plume = createSmokePlume(pos, rng);
    scene.add(plume.points);
    plumes.push(plume);
  }

  function update(dt) {
    for (const p of plumes) p.update(dt);
  }

  function dispose() {
    for (const p of plumes) {
      scene.remove(p.points);
      p.dispose();
    }
  }

  return { update, dispose };
}

// ---------------------------------------------------------------------------
// 2. HANGING LANTERNS / PAPER LAMPS
// ---------------------------------------------------------------------------

const LANTERN_COUNT        = 8;
const LANTERN_SWAY_AMP     = 0.055;  // radians for pendulum swing
const LANTERN_SWAY_PERIOD  = 2.8;    // seconds per full swing

/**
 * Build a single paper-lantern: cylindrical body + top/bottom caps + glow sprite.
 * Returns { group, phase, swayAxis, update(dt) }.
 */
function makeLantern(rng, lanternTex) {
  const group = new THREE.Group();

  // Hanging string (very thin cylinder)
  const cordGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.18, 4);
  const cordMat = new THREE.MeshStandardMaterial({ color: 0x4a3010, roughness: 1 });
  const cord    = new THREE.Mesh(cordGeo, cordMat);
  cord.position.y = -0.09;   // string hangs downward from pivot at y=0
  group.add(cord);

  // Lantern body — faceted cylinder
  const bodyGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.13, 8);
  const bodyMat = new THREE.MeshStandardMaterial({
    color:      PAL.lanternPaper,
    emissive:   new THREE.Color(0xffaa22),
    emissiveIntensity: 0.7,
    roughness:  0.85,
    transparent: true,
    opacity:    0.88,
    side:       THREE.DoubleSide,
    flatShading: true,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = -0.22;
  group.add(body);

  // Top cap
  const capGeo = new THREE.CylinderGeometry(0.025, 0.065, 0.03, 8);
  const capMat = new THREE.MeshStandardMaterial({
    color: PAL.lanternRim, roughness: 0.9, flatShading: true,
  });
  const topCap = new THREE.Mesh(capGeo, capMat);
  topCap.position.y = -0.155;
  group.add(topCap);

  // Bottom cap
  const botCap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.065, 0.02, 0.03, 8),
    capMat,
  );
  botCap.position.y = -0.285;
  group.add(botCap);

  // Glow sprite (additive, behind the paper)
  const glowSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map:        lanternTex,
    color:      0xffcc44,
    transparent: true,
    opacity:    0.75,
    blending:   THREE.AdditiveBlending,
    depthWrite: false,
  }));
  glowSprite.scale.set(0.28, 0.28, 1);
  glowSprite.position.y = -0.22;
  group.add(glowSprite);

  const phase    = rng() * Math.PI * 2;
  const swayFreq = (1 / LANTERN_SWAY_PERIOD) * (0.85 + rng() * 0.3); // slight variation

  let time = rng() * 10; // stagger start

  function update(dt) {
    time += dt;
    // Pendulum: rotate group around local X axis
    group.rotation.x = LANTERN_SWAY_AMP * Math.sin(time * swayFreq * Math.PI * 2 + phase);
    // Flicker: emissive intensity pulse
    const flicker = 0.6 + 0.4 * Math.sin(time * 7.1 + phase)
                       + 0.15 * Math.sin(time * 13.7 + phase * 0.7);
    bodyMat.emissiveIntensity = flicker * 0.75;
    glowSprite.material.opacity = 0.5 + 0.35 * flicker;
  }

  function dispose() {
    cordGeo.dispose(); cordMat.dispose();
    bodyGeo.dispose(); bodyMat.dispose();
    capGeo.dispose();  capMat.dispose();
    glowSprite.material.map.dispose();
    glowSprite.material.dispose();
  }

  return { group, update, dispose };
}

function createLanterns(scene, board) {
  const rng        = makeRng(0xC0DE4321);
  const lanternTex = makeLanternTexture();

  // Collect candidate anchor positions: castle area + path waypoints
  const anchors = [];
  const cp = board.castlePos;
  // Around castle
  anchors.push(new THREE.Vector3(cp.x + 0.6, cp.y + 1.2, cp.z));
  anchors.push(new THREE.Vector3(cp.x - 0.6, cp.y + 1.2, cp.z));
  anchors.push(new THREE.Vector3(cp.x,        cp.y + 1.2, cp.z + 0.6));

  // Along path waypoints (skip first/last which are spawn/castle)
  if (board.pathPoints && board.pathPoints.length > 2) {
    const step = Math.max(1, Math.floor(board.pathPoints.length / 6));
    for (let i = step; i < board.pathPoints.length - 1 && anchors.length < LANTERN_COUNT + 2; i += step) {
      const wp = board.pathPoints[i];
      const side = anchors.length % 2 === 0 ? 0.45 : -0.45;
      anchors.push(new THREE.Vector3(wp.x + side, wp.y + 1.1, wp.z));
    }
  }

  const lanterns = [];
  let lightCount = 0;

  for (let i = 0; i < Math.min(LANTERN_COUNT, anchors.length); i++) {
    const anchor = anchors[i];
    const lant   = makeLantern(rng, lanternTex);

    // The group's origin is at the attachment point (ceiling hook)
    // Lantern body hangs below
    lant.group.position.copy(anchor);
    scene.add(lant.group);
    lanterns.push(lant);

    // Add max 2 PointLights total (budget constraint)
    if (lightCount < 2 && i < 2) {
      const ptLight = new THREE.PointLight(0xffaa33, 0.65, 1.8, 2);
      ptLight.position.copy(anchor).y -= 0.22;
      scene.add(ptLight);
      lant._ptLight = ptLight;
      lightCount++;
    }
  }

  function update(dt) {
    for (const l of lanterns) {
      l.update(dt);
      // Sync attached point light flicker with lantern (if it has one)
      if (l._ptLight) {
        l._ptLight.intensity =
          0.5 + 0.35 * Math.sin(l.group.rotation.x * 8 + Date.now() * 0.005);
      }
    }
  }

  function dispose() {
    lanternTex.dispose();
    for (const l of lanterns) {
      scene.remove(l.group);
      if (l._ptLight) scene.remove(l._ptLight);
      l.dispose();
    }
  }

  return { update, dispose };
}

// ---------------------------------------------------------------------------
// 3. MARKET STALLS
// ---------------------------------------------------------------------------

/**
 * Make one market stall: counter box + striped canopy + waving pennant on top.
 * Returns { group, update(dt), dispose() }.
 */
function makeStall(rng, canopyTex, stripeColors) {
  const group = new THREE.Group();

  // --- Counter ---
  const counterGeo = new THREE.BoxGeometry(0.7, 0.22, 0.38);
  const counterMat = new THREE.MeshStandardMaterial({
    color:    PAL.stallCounter,
    roughness: 0.85,
    flatShading: true,
  });
  const counter = new THREE.Mesh(counterGeo, counterMat);
  counter.position.y = 0.11;
  counter.castShadow = true;
  counter.receiveShadow = true;
  group.add(counter);

  // --- Legs (4 posts) ---
  const legGeo = new THREE.CylinderGeometry(0.02, 0.025, 0.62, 5);
  const legMat = new THREE.MeshStandardMaterial({
    color: PAL.stallWood, roughness: 0.9, flatShading: true,
  });
  const legOffsets = [
    [ 0.31,  0.15], [-0.31,  0.15],
    [ 0.31, -0.15], [-0.31, -0.15],
  ];
  for (const [lx, lz] of legOffsets) {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(lx, 0.31, lz);
    leg.castShadow = true;
    group.add(leg);
  }

  // --- Canopy supports (two back uprights taller than front) ---
  const backPoleGeo = new THREE.CylinderGeometry(0.018, 0.022, 0.98, 5);
  for (const lx of [0.31, -0.31]) {
    const pole = new THREE.Mesh(backPoleGeo, legMat);
    pole.position.set(lx, 0.71, -0.15);
    pole.castShadow = true;
    group.add(pole);
  }
  const frontPoleGeo = new THREE.CylinderGeometry(0.018, 0.022, 0.72, 5);
  for (const lx of [0.31, -0.31]) {
    const pole = new THREE.Mesh(frontPoleGeo, legMat);
    pole.position.set(lx, 0.58, 0.15);
    pole.castShadow = true;
    group.add(pole);
  }

  // --- Striped canopy (tilted box geometry acting as a sloped roof) ---
  // We use a PlaneGeometry tilted slightly forward for the awning
  const canopyGeo = new THREE.PlaneGeometry(0.76, 0.44);
  const stallCanopyMat = new THREE.MeshStandardMaterial({
    map:           canopyTex,
    roughness:     0.8,
    side:          THREE.DoubleSide,
    flatShading:   false,
  });
  const canopy = new THREE.Mesh(canopyGeo, stallCanopyMat);
  // Tilt it: back higher than front, like an awning
  canopy.rotation.x = -Math.PI * 0.5 + 0.38;  // ~68 degrees from vertical ≈ 22deg slope
  canopy.position.set(0, 1.18, 0.04);
  canopy.castShadow  = true;
  canopy.receiveShadow = true;
  group.add(canopy);

  // --- Pennant on top-back-centre ---
  // Small triangular flag: PlaneGeometry with vertex-based wave
  const pennantGeo = new THREE.PlaneGeometry(0.18, 0.12, 6, 3);
  // Shape it into a triangle by pulling the right vertices toward a point
  const posArr = pennantGeo.attributes.position;
  for (let v = 0; v < posArr.count; v++) {
    const nx = (posArr.getX(v) + 0.09) / 0.18; // 0 at left edge, 1 at right tip
    // Taper: shrink height toward the right (tip)
    const scale = 1.0 - nx * 0.85;
    posArr.setY(v, posArr.getY(v) * scale);
  }
  posArr.needsUpdate = true;
  pennantGeo.computeVertexNormals();

  const pennantMat = new THREE.MeshStandardMaterial({
    color:       PAL.pennantGold,
    roughness:   0.7,
    side:        THREE.DoubleSide,
    flatShading: true,
  });
  const pennant = new THREE.Mesh(pennantGeo, pennantMat);
  // Pivot at left edge (hoist): shift geometry right so left edge is at origin
  pennant.position.set(0.0, 1.22, -0.17);
  group.add(pennant);

  // Small pole for pennant
  const pennantPoleGeo = new THREE.CylinderGeometry(0.008, 0.010, 0.15, 4);
  const ppole = new THREE.Mesh(pennantPoleGeo, legMat);
  ppole.position.set(0, 1.175, -0.17);
  group.add(ppole);

  // --- Produce items on counter (tiny stacked boxes for visual interest) ---
  const crateGeo = new THREE.BoxGeometry(0.10, 0.08, 0.10);
  const crateMat = new THREE.MeshStandardMaterial({
    color: 0xd4a55a, roughness: 0.9, flatShading: true,
  });
  for (let ci = 0; ci < 3; ci++) {
    const crate = new THREE.Mesh(crateGeo, crateMat);
    crate.position.set(-0.22 + ci * 0.18, 0.26, 0.0);
    crate.rotation.y = (rng() - 0.5) * 0.4;
    group.add(crate);
  }

  // Pennant wave animation state
  let waveTime = rng() * Math.PI * 2;
  const waveFreq  = 3.5 + rng() * 1.0;
  const waveAmp   = 0.09;
  const waveSpeed = 2.8 + rng() * 0.8;

  function update(dt) {
    waveTime += dt;
    // Wave pennant: deform vertices along X axis
    const pa = pennantGeo.attributes.position;
    for (let v = 0; v < pa.count; v++) {
      const nx = (pa.getX(v) + 0.09) / 0.18;  // 0..1
      const wave = waveAmp * nx * nx *
        Math.sin(waveFreq * nx - waveSpeed * waveTime);
      pa.setZ(v, wave);
    }
    pa.needsUpdate = true;
  }

  function dispose() {
    counterGeo.dispose(); counterMat.dispose();
    legGeo.dispose(); legMat.dispose();
    backPoleGeo.dispose(); frontPoleGeo.dispose();
    canopyGeo.dispose(); stallCanopyMat.dispose();
    pennantGeo.dispose(); pennantMat.dispose();
    pennantPoleGeo.dispose();
    crateGeo.dispose(); crateMat.dispose();
  }

  return { group, update, dispose };
}

/**
 * Place 2–3 stalls near the castle / along the path.
 */
function createMarketStalls(scene, board) {
  const rng = makeRng(0xBA2AA800);

  // Canopy textures: alternate red/white and blue/white
  const canopyTexRed  = makeCanopyTexture('#ee3333', '#ffffff', 6);
  const canopyTexBlue = makeCanopyTexture('#2255cc', '#ffff99', 6);
  const canopyTexGold = makeCanopyTexture('#cc8800', '#ffffff', 6);

  const textures = [canopyTexRed, canopyTexBlue, canopyTexGold];

  // Stall placement positions (near castle and first path segment)
  const cp = board.castlePos;
  const stallSpecs = [
    { pos: cp, dx:  1.0, dz:  0.7, ry: -0.4 },
    { pos: cp, dx: -1.0, dz:  0.7, ry:  0.4 },
  ];

  // Third stall along the path if it's long enough
  if (board.pathPoints && board.pathPoints.length >= 3) {
    const wp = board.pathPoints[Math.floor(board.pathPoints.length * 0.35)];
    stallSpecs.push({ pos: wp, dx: 0.65, dz: 0.5, ry: Math.PI * 0.25 });
  }

  const stalls = [];

  for (let i = 0; i < stallSpecs.length; i++) {
    const spec  = stallSpecs[i];
    const stall = makeStall(rng, textures[i % textures.length], null);
    stall.group.position.set(
      spec.pos.x + spec.dx,
      spec.pos.y,
      spec.pos.z + spec.dz,
    );
    stall.group.rotation.y = spec.ry;
    scene.add(stall.group);
    stalls.push(stall);
  }

  function update(dt) {
    for (const s of stalls) s.update(dt);
  }

  function dispose() {
    for (const s of stalls) {
      scene.remove(s.group);
      s.dispose();
    }
    canopyTexRed.dispose();
    canopyTexBlue.dispose();
    canopyTexGold.dispose();
  }

  return { update, dispose };
}

// ---------------------------------------------------------------------------
// 4. SPARKLE / COIN-GLINT near stalls (optional)
// ---------------------------------------------------------------------------

const SPARKLE_COUNT  = 12;
const SPARKLE_LIFE   = 1.4;  // seconds per sparkle lifetime

function createSparkles(scene, board) {
  const rng = makeRng(0x601DC01A);

  const sparkleTex = makeSparkleTexture();
  const positions  = new Float32Array(SPARKLE_COUNT * 3);
  const ages       = new Float32Array(SPARKLE_COUNT);
  const speeds     = new Float32Array(SPARKLE_COUNT);
  const phases     = new Float32Array(SPARKLE_COUNT);

  // Anchor around the castle market area
  const cp = board.castlePos;
  const cx = cp.x, cy = cp.y, cz = cp.z;
  const spread = 1.2;

  // Spawn positions for each sparkle (random within market square)
  const spawnX = new Float32Array(SPARKLE_COUNT);
  const spawnZ = new Float32Array(SPARKLE_COUNT);

  for (let i = 0; i < SPARKLE_COUNT; i++) {
    ages[i]   = rng() * SPARKLE_LIFE;   // stagger initial ages
    speeds[i] = 0.5 + rng() * 0.6;
    phases[i] = rng() * Math.PI * 2;
    spawnX[i] = cx + (rng() - 0.5) * spread * 2;
    spawnZ[i] = cz + (rng() - 0.5) * spread * 0.8 + 0.6;
    positions[i * 3]     = spawnX[i];
    positions[i * 3 + 1] = cy + 0.3;
    positions[i * 3 + 2] = spawnZ[i];
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.PointsMaterial({
    map:             sparkleTex,
    size:            0.14,
    sizeAttenuation: true,
    transparent:     true,
    opacity:         0.0,
    depthWrite:      false,
    blending:        THREE.AdditiveBlending,
    color:           PAL.sparkleGold,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  let globalTime = 0;

  function update(dt) {
    globalTime += dt;
    const posAttr = geo.attributes.position;
    let avgAlpha = 0;

    for (let i = 0; i < SPARKLE_COUNT; i++) {
      ages[i] += dt * speeds[i];
      if (ages[i] >= SPARKLE_LIFE) {
        ages[i]   = 0;
        spawnX[i] = cx + (rng() - 0.5) * spread * 2;
        spawnZ[i] = cz + (rng() - 0.5) * spread * 0.8 + 0.6;
      }
      const t = ages[i] / SPARKLE_LIFE;  // 0..1
      // Rise gently and arc
      const rise = t * 0.55;
      posAttr.setXYZ(
        i,
        spawnX[i] + 0.05 * Math.sin(globalTime * 3.1 + phases[i]),
        cy + 0.28 + rise,
        spawnZ[i] + 0.04 * Math.cos(globalTime * 2.7 + phases[i]),
      );
      // Alpha: bell curve (fade in then out)
      const a = Math.sin(t * Math.PI);
      avgAlpha += a;
    }

    posAttr.needsUpdate = true;
    // Drive single-opacity via average — approximate but cheap
    mat.opacity = (avgAlpha / SPARKLE_COUNT) * 0.85;
  }

  function dispose() {
    scene.remove(points);
    geo.dispose();
    mat.dispose();
    sparkleTex.dispose();
  }

  return { update, dispose };
}

// ---------------------------------------------------------------------------
// PUBLIC API
// ---------------------------------------------------------------------------

/**
 * Create and add all "town life" settlement dressing to the scene.
 *
 * @param {THREE.Scene}  scene   — Three.js scene
 * @param {object}       board   — Board object: radius, baseY, size,
 *                                 castlePos, spawnPos, pathPoints, cells
 * @param {object}       [opts]  — Optional overrides (reserved)
 * @returns {{ update(dt: number, camera: THREE.Camera): void, dispose(): void }}
 */
export function createTownLife(scene, board, opts = {}) {
  const smoke    = createChimneySmoke(scene, board);
  const lanterns = createLanterns(scene, board);
  const stalls   = createMarketStalls(scene, board);
  const sparkles = createSparkles(scene, board);

  /**
   * Animate all town-life elements.
   * @param {number}           dt      — Delta time in seconds.
   * @param {THREE.Camera}     camera  — Current camera (reserved for future LOD).
   */
  function update(dt, camera) {
    // Clamp dt to avoid jump on tab switch
    const d = Math.min(dt, 0.05);
    smoke.update(d);
    lanterns.update(d);
    stalls.update(d);
    sparkles.update(d);
  }

  /** Remove all objects from the scene and free GPU resources. */
  function dispose() {
    smoke.dispose();
    lanterns.dispose();
    stalls.dispose();
    sparkles.dispose();
  }

  return { update, dispose };
}
