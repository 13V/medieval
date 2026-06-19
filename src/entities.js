// ============================================================================
// entities.js — Enemy, Tower, Projectile.
// ============================================================================
import * as THREE from 'three';
import { ENEMIES, TOWERS, SLOW, ECONOMY } from './config.js';
import { collectMaterials } from './assets.js';
import { Trail, BossAura, FrostShimmer } from './effects.js';

const FROST = new THREE.Color(0x8fe0ff);
const WHITE = new THREE.Color(0xffffff);

export const PROJECTILES = {
  arrow: 'units/neutral/projectile_arrow.gltf',
  cannonball: 'units/neutral/projectile_cannonball.gltf',
  catapult: 'units/neutral/projectile_catapult.gltf',
};

const now = () => performance.now() / 1000;

// ----------------------------------------------------------------------------
export class Enemy {
  constructor(game, type, hpMul) {
    this.game = game;
    this.type = type;
    const def = ENEMIES[type];
    this.def = def;
    this.maxHp = def.hp * hpMul;
    this.hp = this.maxHp;
    this.baseSpeed = def.speed;
    this.gold = def.gold;
    this.slowResist = def.slowResist;
    this.radius = def.radius;
    this.isBoss = type === 'boss';
    this.alive = true;
    this.reached = false;

    this.obj = game.assets.instance(def.model, { scale: def.scale, groundAlign: true, cloneMaterials: true });
    this.model = this.obj.children[0] || this.obj; // inner mesh — for procedural walk animation
    this.modelBaseY = this.model.position.y;
    this.walk = Math.random() * Math.PI * 2;
    this.mats = collectMaterials(this.obj);
    this.baseColors = this.mats.map((m) => m.color.clone());

    this.points = game.board.pathPoints;
    this.seg = 0;
    this.obj.position.copy(this.points[0]);
    game.scene.add(this.obj);

    this.slowAmount = 0;
    this.slowUntil = 0;
    this.flash = 0;

    this._tmp = new THREE.Vector3();
    this._buildHealthBar();

    // --- VFX additions ---
    // Boss aura
    this._bossAura = null;
    if (this.isBoss) {
      this._bossAura = new BossAura(game.scene);
    }

    // Frost shimmer (created lazily when first slowed; alive = false until then)
    this._frostShimmer = null;
    this._wasSlowed = false;
  }

  _buildHealthBar() {
    const b = new THREE.Box3().setFromObject(this.obj);
    const top = b.max.y + 0.25;
    this.hbW = this.isBoss ? 1.6 : 0.9;
    const bg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x101010, depthTest: false, transparent: true, opacity: 0.65 }));
    bg.scale.set(this.hbW + 0.06, 0.16, 1);
    bg.position.set(0, top, 0);
    bg.renderOrder = 998;
    const fill = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x6fbf5b, depthTest: false }));
    fill.scale.set(this.hbW, 0.12, 1);
    fill.position.set(0, top, 0);
    fill.renderOrder = 999;
    bg.visible = fill.visible = this.isBoss;
    this.obj.add(bg);
    this.obj.add(fill);
    this.hbBg = bg;
    this.hbFill = fill;
  }

  _updateHealthBar() {
    const frac = Math.max(0, this.hp / this.maxHp);
    const show = this.alive && (frac < 1 || this.isBoss);
    this.hbBg.visible = this.hbFill.visible = show;
    this.hbFill.scale.x = this.hbW * frac;
    this.hbFill.position.x = -(this.hbW * (1 - frac)) / 2;
    this.hbFill.material.color.setHex(frac > 0.5 ? 0x6fbf5b : frac > 0.25 ? 0xe0c14a : 0xd8453a);
  }

  applySlow(amount, duration) {
    const eff = Math.min(amount * (1 - this.slowResist), SLOW.maxSlow);
    const t = now();
    if (eff >= this.slowAmount || t > this.slowUntil) this.slowAmount = eff;
    this.slowUntil = Math.max(this.slowUntil, t + duration);
  }

  takeDamage(dmg) {
    if (!this.alive) return;
    this.hp -= dmg;
    this.flash = 1;
    if (dmg >= 1) this.game.effects.number(this.obj.position, String(Math.round(dmg)));
    // Small spark burst at the hit point
    this.game.effects.hitSparks(this.obj.position, 0xffee88);
    this._updateHealthBar();
    if (this.hp <= 0) this._die();
  }

  _die() {
    if (!this.alive) return;
    this.alive = false;

    // Build a visual clone for the fade-out effect.
    // Clone the obj Group — but only clone materials (not shared geometry).
    // We do NOT call _remove() immediately; instead we hand the clone to Effects.
    let cloneObj = null;
    let clonedMats = [];
    try {
      cloneObj = this.obj.clone(true);
      // Collect and individually clone materials on the clone so we own them
      cloneObj.traverse((o) => {
        if (o.isMesh && o.material) {
          const cm = o.material.clone();
          o.material = cm;
          clonedMats.push(cm);
        }
      });
      // Position the clone identically to current obj
      cloneObj.position.copy(this.obj.position);
      cloneObj.rotation.copy(this.obj.rotation);
      cloneObj.scale.copy(this.obj.scale);
    } catch (_e) {
      // If clone fails for any reason, graceful degradation
      cloneObj = null;
      clonedMats = [];
    }

    // Death particle poof + optional boss big explosion
    this.game.effects.deathPoof(this.obj.position, {
      color: this.isBoss ? 0xff2200 : 0xff7a4a,
      radius: this.radius,
      isBoss: this.isBoss,
      cloneObj,
      clonedMats,
    });

    this.game.onEnemyKilled(this);
    this._remove();
  }

  _reachCastle() {
    if (!this.alive) return;
    this.alive = false;
    this.reached = true;
    this.game.onEnemyReachedCastle(this);
    this._remove();
  }

  _remove() {
    this.game.scene.remove(this.obj);
    for (const m of this.mats) m.dispose();
    this.hbBg.material.dispose();
    this.hbFill.material.dispose();

    // Dispose VFX helpers
    if (this._bossAura) { this._bossAura.dispose(); this._bossAura = null; }
    if (this._frostShimmer) { this._frostShimmer.dispose(); this._frostShimmer = null; }
  }

  update(dt) {
    if (!this.alive) return;
    const t = now();

    // movement (with slow)
    const slowK = t < this.slowUntil ? this.slowAmount : 0;
    const speed = this.baseSpeed * (1 - slowK);
    const next = this.points[this.seg + 1];
    if (!next) { this._reachCastle(); return; }
    const pos = this.obj.position;
    this._tmp.subVectors(next, pos); // 3D — follow terrain height along the ramp
    const dist = this._tmp.length();
    const step = speed * dt;
    if (dist <= step || dist < 1e-4) {
      pos.copy(next);
      this.seg++;
      if (this.seg >= this.points.length - 1) { this._reachCastle(); return; }
    } else {
      this._tmp.multiplyScalar(step / dist);
      pos.add(this._tmp);
      this.obj.rotation.y = Math.atan2(this._tmp.x, this._tmp.z);
    }

    // lively march animation (visual only — does not affect path position)
    this.walk += dt * (2.2 + this.baseSpeed * 1.8);
    const amp = this.isBoss ? 0.16 : this.type === 'raider' ? 0.2 : 0.12;
    this.model.position.y = this.modelBaseY + Math.abs(Math.sin(this.walk)) * amp;
    this.model.rotation.z = Math.sin(this.walk) * 0.07;
    this.model.rotation.x = 0.05 + Math.sin(this.walk * 2) * 0.03;

    // visuals: slow tint + hit flash
    for (let i = 0; i < this.mats.length; i++) {
      const m = this.mats[i];
      m.color.copy(this.baseColors[i]).lerp(FROST, slowK * 0.75);
      if (this.flash > 0) {
        m.color.lerp(WHITE, this.flash);
        if (m.emissive) m.emissive.setScalar(this.flash * 0.5);
      } else if (m.emissive) {
        m.emissive.setScalar(0);
      }
    }
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 4);

    // Boss aura follows the enemy
    if (this._bossAura) {
      this._bossAura.update(dt);
      this._bossAura.setPosition(pos);
    }

    // Frost shimmer while slowed
    const isSlowed = slowK > 0.05;
    if (isSlowed && !this._frostShimmer) {
      // Lazily create shimmer on first slow
      this._frostShimmer = new FrostShimmer(this.game.scene);
    }
    if (this._frostShimmer) {
      this._frostShimmer.update(dt, pos, isSlowed);
    }
    this._wasSlowed = isSlowed;
  }
}

// ----------------------------------------------------------------------------
export class Tower {
  constructor(game, typeId, cell) {
    this.game = game;
    this.id = typeId;
    this.def = TOWERS[typeId];
    this.cell = cell;
    this.level = 0;
    this.invested = this.def.levels[0].cost;

    this.obj = game.assets.instance(this.def.model, {
      scale: this.def.modelScale,
      groundAlign: true,
      tint: this.def.tint ?? null,
      cloneMaterials: !!this.def.tint,
    });
    this.obj.position.copy(cell.pos);
    game.scene.add(this.obj);

    const b = new THREE.Box3().setFromObject(this.obj);
    this.muzzleY = b.max.y * 0.82;

    this.cooldown = 0;
    this._face = new THREE.Vector3();

    // Recoil state
    this._recoilT = 0;        // 0 = idle, >0 = animating (counts down)
    this._recoilDur = 0.22;   // seconds for full recoil cycle
    this._baseScale = 1.0;    // will be reset in upgrade()
  }

  get stats() { return this.def.levels[this.level]; }
  canUpgrade() { return this.level < this.def.levels.length - 1; }
  upgradeCost() { return this.canUpgrade() ? this.def.levels[this.level + 1].cost : 0; }
  sellValue() { return Math.floor(this.invested * ECONOMY.sellRefund); }

  upgrade() {
    if (!this.canUpgrade()) return false;
    this.level++;
    this.invested += this.stats.cost;
    this._baseScale = 1 + this.level * 0.07;
    this.obj.scale.setScalar(this._baseScale);
    this.muzzleY = new THREE.Box3().setFromObject(this.obj).max.y * 0.82;
    return true;
  }

  _getMuzzleWorldPos() {
    const p = new THREE.Vector3();
    p.copy(this.obj.position);
    p.y = this.muzzleY;
    // Push slightly forward along the tower's facing direction
    const fwd = new THREE.Vector3(
      Math.sin(this.obj.rotation.y),
      0,
      Math.cos(this.obj.rotation.y)
    );
    p.addScaledVector(fwd, 0.4);
    return p;
  }

  update(dt, enemies) {
    // Animate recoil
    if (this._recoilT > 0) {
      this._recoilT = Math.max(0, this._recoilT - dt);
      const k = this._recoilT / this._recoilDur; // 1→0
      // k=1 is right after firing (full punch), k=0 is recovered
      // Use a smooth ease: punch out quickly, ease back in
      const punch = k < 0.5
        ? k * 2              // 0→1 on the pull-back half (fired at k=1)
        : 2 - k * 2;        // 1→0 on the recover half
      // Actually: we want k=1 (just fired) = big scale-down + offset,
      // k=0 (recovered) = normal
      const recoilAmt = k;  // largest when just fired
      const bs = this._baseScale > 0 ? this._baseScale : (1 + this.level * 0.07);
      // X/Z scale squeeze, Y stretch for a quick squish-and-stretch
      this.obj.scale.set(
        bs * (1 - recoilAmt * 0.08),
        bs * (1 + recoilAmt * 0.12),
        bs * (1 - recoilAmt * 0.08)
      );
    }

    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.cooldown > 0) return;
    const s = this.stats;
    const r2 = s.range * s.range;
    const px = this.obj.position.x, pz = this.obj.position.z;

    // target the enemy furthest along the path that's in range
    let best = null, bestSeg = -1;
    for (const e of enemies) {
      if (!e.alive) continue;
      const dx = e.obj.position.x - px, dz = e.obj.position.z - pz;
      if (dx * dx + dz * dz <= r2 && e.seg > bestSeg) { bestSeg = e.seg; best = e; }
    }
    if (!best) return;

    this._face.subVectors(best.obj.position, this.obj.position);
    this.obj.rotation.y = Math.atan2(this._face.x, this._face.z);
    this.game.spawnProjectile(this, best);
    this.cooldown = 1 / s.fireRate;

    // --- Muzzle flash + recoil punch ---
    const muzzlePos = this._getMuzzleWorldPos();
    // Pick flash color based on tower type
    const flashColor = this.def.projectile === 'frost'
      ? 0x88ddff
      : this.def.projectile === 'arrow'
        ? 0xffeeaa
        : 0xff8844;
    this.game.effects.muzzleFlash(muzzlePos, flashColor);

    // Trigger recoil animation (count-down from full duration)
    this._recoilT = this._recoilDur;
    if (this._baseScale === 0) this._baseScale = 1 + this.level * 0.07;
  }

  dispose() {
    this.game.scene.remove(this.obj);
    if (this.def.tint) collectMaterials(this.obj).forEach((m) => m.dispose());
  }
}

// ----------------------------------------------------------------------------
const PROJ_TUNE = {
  arrow: { speed: 28, arc: 0.6, scale: 3.2 },
  cannonball: { speed: 17, arc: 1.6, scale: 3.0 },
  catapult: { speed: 13, arc: 4.0, scale: 3.2 },
  frost: { speed: 22, arc: 0.6, scale: 1 },
};

// Trail colors per projectile kind
const TRAIL_COLORS = {
  arrow:      0xffdd88,
  cannonball: 0x888888,
  catapult:   0x997755,
  frost:      0x88ddff,
};

export class Projectile {
  constructor(game, tower, target) {
    this.game = game;
    this.target = target;
    const def = tower.def;
    const s = tower.stats;
    this.damage = s.damage;
    this.splash = s.splash || 0;
    this.slow = s.slow || null;
    const kind = def.projectile;
    this.kind = kind;
    this.tune = PROJ_TUNE[kind] || PROJ_TUNE.arrow;

    if (kind === 'frost') {
      const geo = new THREE.IcosahedronGeometry(0.18, 0);
      const mat = new THREE.MeshStandardMaterial({ color: 0x8fe0ff, emissive: 0x3aa0c8, emissiveIntensity: 0.8, flatShading: true });
      this.obj = new THREE.Mesh(geo, mat);
      this._ownGeo = geo; this._ownMat = mat;
    } else {
      this.obj = game.assets.instance(PROJECTILES[kind], { scale: this.tune.scale, groundAlign: false });
    }

    this.from = tower.obj.position.clone();
    this.from.y = tower.muzzleY;
    this.dest = target.obj.position.clone();
    this.dest.y += 0.5;
    this.obj.position.copy(this.from);
    game.scene.add(this.obj);

    this.dist = this.from.distanceTo(this.dest);
    this.dur = Math.max(0.07, this.dist / this.tune.speed);
    this.t = 0;
    this.alive = true;
    this._p = new THREE.Vector3();
    this._prev = this.from.clone();

    // Trail — arrow and frost get one; heavy shots only every other frame (handled below)
    this._trail = null;
    this._trailTimer = 0;
    const trailColor = TRAIL_COLORS[kind] || 0xffffff;
    const trailPts = kind === 'arrow' || kind === 'frost' ? 14 : 10;
    this._trail = new Trail(game.scene, { color: trailColor, maxPoints: trailPts });
  }

  update(dt) {
    if (!this.alive) return;
    if (this.target && this.target.alive) { this.dest.copy(this.target.obj.position); this.dest.y += 0.5; }
    this.t += dt / this.dur;
    if (this.t >= 1) { this._impact(); return; }

    this._p.copy(this.from).lerp(this.dest, this.t);
    this._p.y += Math.sin(Math.PI * this.t) * this.tune.arc;
    // orient along travel
    const d = this._p.clone().sub(this._prev);
    if (d.lengthSq() > 1e-6) {
      this.obj.lookAt(this._p.clone().add(d));
      this.obj.rotation.z += 0; // arrows model points along Z
    }
    this._prev.copy(this._p);
    this.obj.position.copy(this._p);
    this.obj.rotation.y += this.tune.arc === 0.6 ? 0 : dt * 6; // tumble for heavy shots

    // Add trail point (throttle for heavy projectiles to every ~0.04s)
    if (this._trail) {
      this._trailTimer += dt;
      const interval = (this.kind === 'cannonball' || this.kind === 'catapult') ? 0.04 : 0.025;
      if (this._trailTimer >= interval) {
        this._trailTimer = 0;
        this._trail.addPoint(this._p);
      }
    }
  }

  _impact() {
    this.alive = false;
    const hit = this.dest.clone();
    const enemies = this.game.enemies;
    const isFrost = !!this.slow;

    if (this.splash > 0) {
      const r2 = this.splash * this.splash;
      for (const e of enemies) {
        if (!e.alive) continue;
        const dx = e.obj.position.x - hit.x, dz = e.obj.position.z - hit.z;
        if (dx * dx + dz * dz <= r2) {
          if (this.damage > 0) e.takeDamage(this.damage);
          if (this.slow) e.applySlow(this.slow.amount, this.slow.duration);
        }
      }

      // Rich explosion VFX based on type
      if (isFrost) {
        this.game.effects.frostFlash(hit, this.splash);
        this.game.effects.ring(hit, { radius: this.splash, color: 0x8fe0ff, life: 0.45 });
      } else {
        // Cannon or catapult
        this.game.effects.cannonExplosion(hit, this.splash);
      }
    } else if (this.target && this.target.alive) {
      this.target.takeDamage(this.damage);
      this.game.effects.pop(this.target.obj.position, { color: 0xffe080, size: 0.5, life: 0.22 });
    }
    this._remove();
  }

  _remove() {
    this.game.scene.remove(this.obj);
    if (this._ownGeo) this._ownGeo.dispose();
    if (this._ownMat) this._ownMat.dispose();
    // Dispose trail
    if (this._trail) { this._trail.dispose(); this._trail = null; }
  }
}
