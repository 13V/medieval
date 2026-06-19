// ============================================================================
// effects.js — game "juice": floating damage numbers (DOM), 3D hit/explosion
// pops, expanding AoE rings, particle bursts, trails, flashes, death fades.
// ============================================================================
import * as THREE from 'three';

const SPHERE = new THREE.SphereGeometry(1, 12, 12);

// Shared disc geometry for boss aura / frost flash
const DISC = new THREE.CircleGeometry(1, 32);

// Max pooled particles cap (total across all bursts)
const MAX_PARTICLES = 300;

// ============================================================================
// Lightweight pooled particle system
// Each particle: pos, vel, age, life, size, color, gravity, startOpacity
// Rendered as a single Points object whose geometry is rebuilt each frame
// (affordable for up to MAX_PARTICLES particles).
// ============================================================================
class ParticlePool {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];

    // Build a Points object with a BufferGeometry we update each frame.
    this.geo = new THREE.BufferGeometry();
    const positions = new Float32Array(MAX_PARTICLES * 3);
    const colors    = new Float32Array(MAX_PARTICLES * 3);
    const sizes     = new Float32Array(MAX_PARTICLES);
    this.geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geo.setAttribute('color',    new THREE.BufferAttribute(colors,    3));
    this.geo.setAttribute('size',     new THREE.BufferAttribute(sizes,     1));
    this.geo.setDrawRange(0, 0);

    this.mat = new THREE.PointsMaterial({
      size: 0.18,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    this.pts = new THREE.Points(this.geo, this.mat);
    this.pts.frustumCulled = false;
    scene.add(this.pts);

    this._c = new THREE.Color();
  }

  spawn(pos, { count = 12, color = 0xffaa44, size = 0.22, speed = 5,
               life = 0.55, gravity = -4 } = {}) {
    const room = MAX_PARTICLES - this.particles.length;
    const n = Math.min(count, room);
    for (let i = 0; i < n; i++) {
      // random hemisphere direction (mostly upward + outward)
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.random() * Math.PI * 0.7; // 0..126°
      const spd   = speed * (0.4 + Math.random() * 0.6);
      this.particles.push({
        x: pos.x, y: pos.y + 0.3, z: pos.z,
        vx: Math.sin(phi) * Math.cos(theta) * spd,
        vy: Math.cos(phi) * spd * 0.8 + 1.5,
        vz: Math.sin(phi) * Math.sin(theta) * spd,
        age: 0,
        life: life * (0.7 + Math.random() * 0.6),
        size: size * (0.5 + Math.random() * 0.8),
        color,
        gravity,
      });
    }
  }

  update(dt) {
    const posArr  = this.geo.attributes.position.array;
    const colArr  = this.geo.attributes.color.array;
    const sizeArr = this.geo.attributes.size.array;
    let alive = 0;

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.life) { this.particles.splice(i, 1); continue; }
      p.vx *= 0.96;
      p.vz *= 0.96;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
    }

    // Pack surviving particles (order doesn't matter for Points)
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const k = 1 - p.age / p.life;          // 1→0 over lifetime
      const idx3 = alive * 3;
      posArr[idx3]     = p.x;
      posArr[idx3 + 1] = p.y;
      posArr[idx3 + 2] = p.z;
      this._c.setHex(p.color);
      colArr[idx3]     = this._c.r * k;
      colArr[idx3 + 1] = this._c.g * k;
      colArr[idx3 + 2] = this._c.b * k;
      sizeArr[alive]   = p.size * (0.4 + k * 0.6);
      alive++;
    }

    this.geo.setDrawRange(0, alive);
    if (alive > 0) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.color.needsUpdate    = true;
      this.geo.attributes.size.needsUpdate     = true;
    }
  }

  dispose() {
    this.scene.remove(this.pts);
    this.geo.dispose();
    this.mat.dispose();
  }
}

// ============================================================================
// Trail — a short fading line of recent positions for a projectile.
// ============================================================================
export class Trail {
  constructor(scene, { color = 0xffffff, maxPoints = 16, width = 2 } = {}) {
    this.scene = scene;
    this.maxPoints = maxPoints;
    this.positions = [];

    // We'll rebuild the LineGeometry each update (cheap for ≤16 pts)
    this.geo = new THREE.BufferGeometry();
    const arr = new Float32Array(maxPoints * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    this.geo.setDrawRange(0, 0);

    this.mat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      linewidth: width, // note: only >1 on WebGL1/some drivers; fallback is 1
    });

    this.line = new THREE.Line(this.geo, this.mat);
    this.line.frustumCulled = false;
    scene.add(this.line);
    this.alive = true;
  }

  addPoint(pos) {
    this.positions.push(pos.clone());
    if (this.positions.length > this.maxPoints) this.positions.shift();
    const arr = this.geo.attributes.position.array;
    for (let i = 0; i < this.positions.length; i++) {
      const p = this.positions[i];
      arr[i * 3]     = p.x;
      arr[i * 3 + 1] = p.y;
      arr[i * 3 + 2] = p.z;
    }
    this.geo.setDrawRange(0, this.positions.length);
    this.geo.attributes.position.needsUpdate = true;
    // Fade opacity based on how many points we have (fuller = more visible)
    this.mat.opacity = 0.55 * Math.min(1, this.positions.length / 6);
  }

  dispose() {
    if (!this.alive) return;
    this.alive = false;
    this.scene.remove(this.line);
    this.geo.dispose();
    this.mat.dispose();
  }
}

// ============================================================================
// BossAura — pulsing additive ring at the boss's feet.
// ============================================================================
export class BossAura {
  constructor(scene) {
    this.scene = scene;

    // Outer ring
    const rGeo = new THREE.RingGeometry(0.8, 1.3, 48);
    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0xff3300,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.ring = new THREE.Mesh(rGeo, this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.08;
    this.ring.renderOrder = 1;
    this._rGeo = rGeo;

    // Inner disc glow
    const dGeo = new THREE.CircleGeometry(0.9, 40);
    this.discMat = new THREE.MeshBasicMaterial({
      color: 0xff6600,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.disc = new THREE.Mesh(dGeo, this.discMat);
    this.disc.rotation.x = -Math.PI / 2;
    this.disc.position.y = 0.05;
    this.disc.renderOrder = 1;
    this._dGeo = dGeo;

    this.group = new THREE.Group();
    this.group.add(this.ring);
    this.group.add(this.disc);
    scene.add(this.group);

    this._t = 0;
    this.alive = true;
  }

  update(dt) {
    if (!this.alive) return;
    this._t += dt;
    const pulse = 0.5 + 0.5 * Math.sin(this._t * 3.5);
    const pulse2 = 0.5 + 0.5 * Math.sin(this._t * 2.1 + 1.2);
    this.ringMat.opacity  = 0.55 + pulse  * 0.35;
    this.discMat.opacity  = 0.10 + pulse2 * 0.12;
    const rs = 1.0 + pulse * 0.18;
    this.ring.scale.setScalar(rs);
    this.disc.scale.setScalar(0.95 + pulse2 * 0.1);
  }

  setPosition(pos) {
    this.group.position.set(pos.x, 0.0, pos.z);
  }

  dispose() {
    if (!this.alive) return;
    this.alive = false;
    this.scene.remove(this.group);
    this._rGeo.dispose();
    this._dGeo.dispose();
    this.ringMat.dispose();
    this.discMat.dispose();
  }
}

// ============================================================================
// DeathFade — takes a cloned visual (Group) and fades/sinks it over ~0.35s,
// then disposes. Does NOT dispose shared geometry/materials — only the cloned
// materials created specifically for the fade copy.
// ============================================================================
class DeathFade {
  constructor(scene, obj, clonedMats, life = 0.35, isBoss = false) {
    this.scene = scene;
    this.obj = obj;
    this.clonedMats = clonedMats; // array of materials we own (and must dispose)
    this.life = life;
    this.age = 0;
    this.isBoss = isBoss;
    this.startY = obj.position.y;
    this.alive = true;
    scene.add(obj);
  }

  update(dt) {
    if (!this.alive) return false;
    this.age += dt;
    const k = this.age / this.life; // 0→1
    if (k >= 1) {
      this._dispose();
      return false;
    }
    const ease = 1 - k * k;         // ease out
    const scale = ease * (this.isBoss ? 1.4 : 1.0);
    this.obj.scale.setScalar(Math.max(0.01, scale));
    this.obj.position.y = this.startY - k * (this.isBoss ? 0.8 : 0.5);
    // Fade opacity on cloned materials
    for (const m of this.clonedMats) {
      if ('opacity' in m) {
        m.transparent = true;
        m.opacity = ease * 0.85;
      }
    }
    return true;
  }

  _dispose() {
    if (!this.alive) return;
    this.alive = false;
    this.scene.remove(this.obj);
    for (const m of this.clonedMats) m.dispose();
  }
}

// ============================================================================
// FrostShimmer — a few slow-falling cyan particles while an enemy is slowed.
// Managed externally; caller calls update(dt, pos, active) and dispose().
// ============================================================================
export class FrostShimmer {
  constructor(scene) {
    this.scene = scene;
    this._particles = []; // { x,y,z, vy, age, life }
    this._spawnTimer = 0;
    this._spawnRate = 0.12; // seconds between spawns

    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(24 * 3);
    const colors    = new Float32Array(24 * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
    geo.setDrawRange(0, 0);

    const mat = new THREE.PointsMaterial({
      size: 0.12,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    this.pts = new THREE.Points(geo, mat);
    this.pts.frustumCulled = false;
    scene.add(this.pts);
    this._geo = geo;
    this._mat = mat;
    this._c = new THREE.Color(0x8fe0ff);
    this.alive = true;
  }

  update(dt, pos, active) {
    if (!this.alive) return;

    // Spawn new flakes when active
    if (active) {
      this._spawnTimer -= dt;
      if (this._spawnTimer <= 0 && this._particles.length < 24) {
        this._spawnTimer = this._spawnRate;
        const angle = Math.random() * Math.PI * 2;
        const r = Math.random() * 0.5;
        this._particles.push({
          x: pos.x + Math.cos(angle) * r,
          y: pos.y + 1.2 + Math.random() * 0.8,
          z: pos.z + Math.sin(angle) * r,
          vy: -0.4 - Math.random() * 0.6,
          age: 0,
          life: 0.8 + Math.random() * 0.6,
        });
      }
    }

    // Update & pack
    const posArr = this._geo.attributes.position.array;
    const colArr = this._geo.attributes.color.array;
    let count = 0;
    for (let i = this._particles.length - 1; i >= 0; i--) {
      const p = this._particles[i];
      p.age += dt;
      p.y += p.vy * dt;
      if (p.age >= p.life || (!active && p.age > p.life * 0.5)) {
        this._particles.splice(i, 1);
        continue;
      }
      const k = 1 - p.age / p.life;
      const idx3 = count * 3;
      posArr[idx3]     = p.x;
      posArr[idx3 + 1] = p.y;
      posArr[idx3 + 2] = p.z;
      colArr[idx3]     = this._c.r * k;
      colArr[idx3 + 1] = this._c.g * k;
      colArr[idx3 + 2] = this._c.b * k;
      count++;
    }

    this._geo.setDrawRange(0, count);
    if (count > 0) {
      this._geo.attributes.position.needsUpdate = true;
      this._geo.attributes.color.needsUpdate    = true;
    }
  }

  dispose() {
    if (!this.alive) return;
    this.alive = false;
    this.scene.remove(this.pts);
    this._geo.dispose();
    this._mat.dispose();
  }
}

// ============================================================================
// Effects — public API used by game.js and entities.js.
// ============================================================================
export class Effects {
  constructor(scene, camera, renderer) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.numbers = [];
    this.pops = [];
    this._deathFades = [];

    // DOM layer for floating damage numbers
    this.layer = document.createElement('div');
    this.layer.id = 'fx-layer';
    document.body.appendChild(this.layer);

    this._v = new THREE.Vector3();

    // Pooled particle system (shared; additive sparks/bursts)
    this._pool = new ParticlePool(scene);
  }

  // --------------------------------------------------------------------------
  // number() — floating damage text (DOM sprite)
  // --------------------------------------------------------------------------
  number(pos, text, cls = '') {
    const el = document.createElement('div');
    el.className = 'dmg ' + cls;
    el.textContent = text;
    this.layer.appendChild(el);
    this.numbers.push({ el, pos: pos.clone(), age: 0, life: 0.9, rise: 1.6, drift: (Math.random() - 0.5) * 24 });
  }

  // --------------------------------------------------------------------------
  // pop() — quick expanding sphere flash (existing API, unchanged signature)
  // --------------------------------------------------------------------------
  pop(pos, { color = 0xffffff, size = 0.6, life = 0.32 } = {}) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const m = new THREE.Mesh(SPHERE, mat);
    m.position.copy(pos);
    m.position.y += 0.4;
    m.scale.setScalar(size * 0.3);
    this.scene.add(m);
    this.pops.push({ m, mat, age: 0, life, from: size * 0.3, to: size });
  }

  // --------------------------------------------------------------------------
  // ring() — expanding AoE ring (existing API, unchanged signature)
  // --------------------------------------------------------------------------
  ring(pos, { radius = 3, color = 0x8fe0ff, life = 0.5 } = {}) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const geo = new THREE.RingGeometry(radius * 0.55, radius * 0.72, 40);
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.copy(pos);
    m.position.y += 0.15;
    this.scene.add(m);
    this.pops.push({ m, mat, geo, age: 0, life, from: 0.6, to: 1.0, isRing: true });
  }

  // --------------------------------------------------------------------------
  // burst() — pooled particle burst (new public method)
  // --------------------------------------------------------------------------
  burst(pos, { count = 12, color = 0xffaa44, size = 0.22, speed = 5,
               life = 0.55, gravity = -4 } = {}) {
    this._pool.spawn(pos, { count, color, size, speed, life, gravity });
  }

  // --------------------------------------------------------------------------
  // flash() — instantaneous full-screen-ish additive flash sphere at a point;
  // used for muzzle flashes and impact flares.
  // --------------------------------------------------------------------------
  flash(pos, { color = 0xffffff, size = 0.7, life = 0.12 } = {}) {
    this.pop(pos, { color, size, life });
  }

  // --------------------------------------------------------------------------
  // dustRing() — a quick flat expanding ring close to the ground
  // --------------------------------------------------------------------------
  dustRing(pos, { radius = 1.5, color = 0xaa8855, life = 0.38 } = {}) {
    this.ring(pos, { radius, color, life });
  }

  // --------------------------------------------------------------------------
  // frostFlash() — icy flash ring + particles
  // --------------------------------------------------------------------------
  frostFlash(pos, radius = 1.5) {
    this.ring(pos, { radius, color: 0x8fe0ff, life: 0.4 });
    this.pop(pos, { color: 0xaaddff, size: radius * 0.8, life: 0.22 });
    this.burst(pos, { count: 18, color: 0x8fe0ff, size: 0.14, speed: 4.5,
                      life: 0.5, gravity: -2 });
  }

  // --------------------------------------------------------------------------
  // cannonExplosion() — fiery sparks + dust ring for cannon/catapult impact
  // --------------------------------------------------------------------------
  cannonExplosion(pos, radius = 1.7) {
    this.pop(pos, { color: 0xff6600, size: radius * 1.1, life: 0.28 });
    this.pop(pos, { color: 0xffcc44, size: radius * 0.6, life: 0.18 });
    this.dustRing(pos, { radius: radius * 0.9, color: 0x886644, life: 0.42 });
    this.burst(pos, { count: 22, color: 0xff8800, size: 0.20, speed: 6,
                      life: 0.55, gravity: -5 });
    this.burst(pos, { count: 10, color: 0xffee88, size: 0.13, speed: 9,
                      life: 0.35, gravity: -6 });
  }

  // --------------------------------------------------------------------------
  // hitSparks() — small spark burst at a hit point
  // --------------------------------------------------------------------------
  hitSparks(pos, color = 0xffee88) {
    this.burst(pos, { count: 8, color, size: 0.13, speed: 5, life: 0.32, gravity: -5 });
  }

  // --------------------------------------------------------------------------
  // muzzleFlash() — quick flash at tower muzzle position
  // --------------------------------------------------------------------------
  muzzleFlash(pos, color = 0xffffaa) {
    this.flash(pos, { color, size: 0.55, life: 0.09 });
    this.burst(pos, { count: 6, color, size: 0.11, speed: 4, life: 0.22, gravity: -3 });
  }

  // --------------------------------------------------------------------------
  // deathPoof() — enemy death visual: particle burst, and an optional fade
  // of a mesh clone (pass null cloneObj to skip).
  // cloneObj is a THREE.Object3D already positioned correctly.
  // clonedMats is an Array of materials we OWN (cloned exclusively for this fade).
  // --------------------------------------------------------------------------
  deathPoof(pos, { color = 0xff7a4a, radius = 0.55, isBoss = false,
                   cloneObj = null, clonedMats = [] } = {}) {
    // Particle burst
    const cnt = isBoss ? 40 : 18;
    const spd = isBoss ? 8  : 5;
    this.burst(pos, { count: cnt, color, size: 0.25, speed: spd, life: 0.65, gravity: -3.5 });
    this.burst(pos, { count: Math.floor(cnt * 0.6), color: 0xffdd88, size: 0.18,
                      speed: spd * 0.7, life: 0.45, gravity: -4 });
    this.pop(pos, { color, size: radius * 2.0, life: 0.38 });

    if (isBoss) {
      this.pop(pos, { color: 0xff2200, size: radius * 3.5, life: 0.5 });
      this.ring(pos, { radius: radius * 3, color: 0xff4400, life: 0.55 });
      this.ring(pos, { radius: radius * 1.5, color: 0xffaa00, life: 0.35 });
    }

    // Hand off visual clone for fade-out
    if (cloneObj) {
      const fade = new DeathFade(this.scene, cloneObj, clonedMats, isBoss ? 0.5 : 0.32, isBoss);
      this._deathFades.push(fade);
    }
  }

  // --------------------------------------------------------------------------
  // update() — tick all live effects. Called each frame from game.js.
  // --------------------------------------------------------------------------
  update(dt) {
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;

    // Floating damage numbers
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      n.age += dt;
      if (n.age >= n.life) { n.el.remove(); this.numbers.splice(i, 1); continue; }
      const k = n.age / n.life;
      this._v.copy(n.pos);
      this._v.y += 1.0 + k * n.rise;
      this._v.project(this.camera);
      const x = (this._v.x * 0.5 + 0.5) * w + n.drift * k;
      const y = (-this._v.y * 0.5 + 0.5) * h;
      const visible = this._v.z < 1;
      n.el.style.display = visible ? 'block' : 'none';
      n.el.style.transform = `translate(-50%,-50%) translate(${x}px, ${y}px) scale(${1 + (1 - k) * 0.3})`;
      n.el.style.opacity = String(1 - k * k);
    }

    // Pop spheres & rings
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.age += dt;
      const k = p.age / p.life;
      if (k >= 1) {
        this.scene.remove(p.m);
        p.mat.dispose();
        if (p.geo) p.geo.dispose();
        this.pops.splice(i, 1);
        continue;
      }
      const s = p.from + (p.to - p.from) * k;
      p.m.scale.setScalar(s);
      p.mat.opacity = (p.isRing ? 0.8 : 0.95) * (1 - k);
    }

    // Pooled particles
    this._pool.update(dt);

    // Death fades
    for (let i = this._deathFades.length - 1; i >= 0; i--) {
      const alive = this._deathFades[i].update(dt);
      if (!alive) this._deathFades.splice(i, 1);
    }
  }
}
