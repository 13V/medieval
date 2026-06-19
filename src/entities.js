// ============================================================================
// entities.js — Enemy, Tower, Projectile.
// ============================================================================
import * as THREE from 'three';
import { ENEMIES, TOWERS, SLOW, ECONOMY } from './config.js';
import { collectMaterials } from './assets.js';

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
    this._updateHealthBar();
    if (this.hp <= 0) this._die();
  }

  _die() {
    if (!this.alive) return;
    this.alive = false;
    this.game.effects.pop(this.obj.position, { color: 0xff7a4a, size: this.radius * 1.6 });
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
    this._tmp.subVectors(next, pos);
    this._tmp.y = 0;
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
  }

  get stats() { return this.def.levels[this.level]; }
  canUpgrade() { return this.level < this.def.levels.length - 1; }
  upgradeCost() { return this.canUpgrade() ? this.def.levels[this.level + 1].cost : 0; }
  sellValue() { return Math.floor(this.invested * ECONOMY.sellRefund); }

  upgrade() {
    if (!this.canUpgrade()) return false;
    this.level++;
    this.invested += this.stats.cost;
    this.obj.scale.setScalar(1 + this.level * 0.07);
    this.muzzleY = new THREE.Box3().setFromObject(this.obj).max.y * 0.82;
    return true;
  }

  update(dt, enemies) {
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
  }

  _impact() {
    this.alive = false;
    const hit = this.dest.clone();
    const enemies = this.game.enemies;

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
      const isFrost = !!this.slow;
      this.game.effects.pop(hit, { color: isFrost ? 0x8fe0ff : 0xffb050, size: this.splash * 1.4, life: 0.4 });
      if (isFrost) this.game.effects.ring(hit, { radius: this.splash, color: 0x8fe0ff, life: 0.45 });
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
  }
}
